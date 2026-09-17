# 02.1 读取模型配置

[第二章导航](../README.md) · [上一节](../../chapter-01-first-command/README.md) · [下一节：02.2](../02-first-reply/README.md)

**本节目标：让命令从 `.env`、环境变量或命令行读取模型配置。运行后只显示配置已就绪，暂不发送模型请求。**

## 问题

第一章已经建立了可运行的命令入口，但它打印的是固定文本，还不知道应该连接哪个模型服务。模型客户端至少需要三个运行时数据：用于认证的 API Key、指定能力的模型 ID，以及决定请求发往哪里的基础地址。

这些数据不能简单写死在源码中：

- 密钥进入 Git 会造成泄露。
- 模型和地址写死后，每次切换服务都要修改并重新构建。
- 只读取一个固定位置的 `.env`，命令进入项目子目录后可能找不到配置。

命令行、系统环境变量和 `.env` 还可能同时提供同一字段。如果没有明确优先级，程序就无法解释最终使用了哪个值。

因此，本节真正要解决的是：**怎样从多个外部来源取得配置，确定覆盖顺序，并在任何网络请求发生前，把可能缺失或格式错误的字符串转换成一份结构完整、可以交给模型客户端的配置。**

## 解决方案

把“配置从哪里来、谁的优先级更高、怎样判断配置有效”集中放进 `readConfig()`。命令入口只接收选项并使用检查后的 `Config`，不直接读取 `.env`。

```text
+----------------+
| parse CLI      |
+-------+--------+
        |
        +-- --help / --version --> 显示信息 --> 结束
        |
        +-- default action
                |
                v
命令行选项 -> +----------------+
process.env ->| readConfig     |
.env -------->| merge + check  |
              +-------+--------+
                      |
              +-------+--------+
              | valid config?  |
              +---+--------+---+
                  | 否     | 是
                  v        v
             安全提示   Config --> 就绪提示
```

配置读取只发生在真正启动 Agent 时。帮助和版本由 Commander 在此之前处理，因此查看说明不需要模型配置。

## 工作原理

先把配置读取理解成一条**从外部字符串到完整配置对象的加工流水线**。`.env`、环境变量和命令行选项提供的都只是原始字符串；程序先找到它们，再按优先级选择，最后检查必填项和地址格式。只有走完整条流水线的结果，才能成为下游使用的 `Config`。

```text
三个外部来源
  -> 找到候选值
  -> 按命令行选项 > process.env > .env > 默认值选择
  -> 去除空白并检查缺失值
  -> 解析并限制 URL
  -> 生成 Config
```

例如，`.env` 写着 `OPENAI_MODEL=model-a`，当前 shell 设置了 `OPENAI_MODEL=model-b`，命令又传入 `--model model-c`，最终应使用 `model-c`。命令结束后，另外两个来源都不会被改写；优先级只决定本次进程读取哪个值。

最容易误解的是把 `.env` 当成 Node 会自动加载的特殊文件。它本质上仍是磁盘上的普通文本；只有程序明确读取并解析后，里面的内容才进入内存。本节只完成配置转换，不创建模型客户端，也不发送网络请求。

### 第一步：先规定配置模块的输入和输出

在 [src/config/load-config.ts](src/config/load-config.ts) 中定义两个类型：

```ts
export type Options = { model?: string; baseUrl?: string };
export type Config = { apiKey: string; model: string; baseURL: string };
```

`Options` 是尚未检查的外部输入，所以字段可以缺失。`Config` 是 `readConfig()` 成功后的输出，所以三个字段都是必填项。这个区别建立了一条边界：配置模块之外的代码不必反复判断 `apiKey` 是否存在。

`baseUrl` 对应命令行选项 `--base-url`，遵循本项目普通变量的驼峰命名；`baseURL` 是 OpenAI SDK 构造参数使用的字段名。`readConfig()` 在返回 `Config` 时完成这次名称转换。

密钥没有命令行选项。命令行通常会被 shell 历史记录，某些系统还允许其他进程查看启动参数；把密钥限制在 `.env` 或环境变量中，可以减少意外暴露。

### 第二步：找到当前项目的 `.env`

`.env` 是普通文本文件，Node 不会因为文件名特殊就自动读取它。`readProjectEnv()` 从 `process.cwd()` 开始，逐级向父目录查找：

```ts
let directory = process.cwd();
while (true) {
  const envPath = join(directory, ".env");
  if (existsSync(envPath)) {
    return parseEnv(readFileSync(envPath, "utf8"));
  }
  if (existsSync(join(directory, "package.json"))) return {};
  const parent = dirname(directory);
  if (parent === directory) return {};
  directory = parent;
}
```

循环每次先检查当前目录，再把 `directory` 改成父目录。它有三个结束条件：

- 找到 `.env`：读取文件并立即返回。
- 遇到最近的 `package.json`：说明已经到达当前项目边界，没有 `.env` 就停止。
- 到达文件系统根目录：已经没有父目录，停止查找。

因此，在 `chapter-02-model-dialogue/01-configuration` 中启动命令时，程序可以找到仓库根目录的配置。在另一个 Node 项目中启动时，程序会停在那个项目的边界，不会继续向上误读无关项目的密钥。

`readFileSync()` 在这里是有意选择。配置只在启动阶段读取一次，而且在配置完成前不能发模型请求。同步读取让“读取 → 解析 → 校验”按固定顺序结束，代码也更直接。若应用需要在运行期间频繁刷新很多配置文件，再改用异步文件 API；当前场景没有这种需要。

### 第三步：把 `.env` 文本解析成对象

`readFileSync()` 得到的是一整段字符串，例如 `OPENAI_MODEL=gpt-5`。Node 内置的 `parseEnv()` 负责处理引号、空白、注释等 `.env` 语法，并返回普通对象：

```ts
const fileEnv = parseEnv(readFileSync(envPath, "utf8"));
// 例如：{ OPENAI_MODEL: "gpt-5" }
```

本项目要求 Node 22，因此直接使用标准库，不再安装只为解析一个文件而存在的依赖。更关键的是，[Node.js 的 `parseEnv()`](https://nodejs.org/api/environment_variables.html#programmatic-apis)接收 `.env` 原始文本并返回普通对象，不会把文件内容写入全局的 `process.env`。`readConfig()` 因而可以明确决定每个来源的优先级，测试时也更容易看清数据来自哪里。

解析可能因为文件格式或读取权限失败。源码用 `try/catch` 把底层异常转换成固定提示，不回显文件内容，避免配置值跟着错误日志泄露。

### 第四步：按明确顺序合并三个来源

命令行参数来自 `process.argv`。shell 启动 Node 进程时，已经把输入按参数拆开；Commander 再把字符串转换成 `model`、`baseUrl` 等有名字的选项。这些值只属于当前进程，程序结束后就消失。

环境变量来自 `process.env`。它们由父进程复制给子进程，因此 Agent 可以读取，但修改 `process.env` 不会反向修改已经运行的 shell。`.env` 则只是磁盘文件；Node 不会自动读取它，本节通过 `readFileSync()` 取得文本，再用 `parseEnv()` 解析成普通对象。

`readConfig()` 使用下面的优先级：

```text
命令行选项 > process.env > 最近项目的 .env > 默认值
```

越靠左的来源，越能表达“这一次运行明确要用什么”：

- `--model`：临时覆盖一次运行使用的模型。
- `process.env`：由当前 shell、容器或部署系统注入配置。
- `.env`：保存本机项目的日常开发配置。
- 默认值：只用于公开且稳定的 OpenAI 基础地址。

密钥和模型没有安全可靠的默认值，因此缺失时必须报错。

源码中的 `trim() || ...` 还把空字符串视为“没有填写”。如果较高优先级传入空白，就继续查找下一来源，而不会把空白当作有效模型名。

### 第五步：把外部字符串校验成 Config

配置值都来自进程外部，TypeScript 不能证明它们在运行时有效。`Config` 类型只能约束通过检查后的代码，无法让缺失的环境变量凭空出现。因此 `readConfig()` 必须先检查非空值，再用 `new URL()` 解析地址，并限制协议、用户名、密码、查询参数和片段。

校验通过后，下游拿到的是完整 `Config`；校验失败时，程序尚未创建 SDK 客户端，也没有发送网络请求。这样可以把本地配置错误与远程服务错误清楚地区分开。

`new URL()` 负责语法解析，后面的条件继续限制协议、用户名、密码、查询参数和片段。这里只允许 HTTP(S) 基础地址，是因为 SDK 会在它后面拼接具体接口路径。禁止地址内嵌凭据还能避免错误信息或日志意外携带认证材料。

### 第六步：在需要模型时调用 readConfig()

在 [src/cli.ts](src/cli.ts) 中导入 `readConfig()`，登记 `--model` 和 `--base-url`，把默认操作改为：

```ts
.action(() => {
  const config = readConfig(program.opts<Options>());
  console.log("Hello，My Agent！");
  console.log(`配置已就绪，模型：${config.model}。本节不发送模型请求。`);
});
```

这段短代码省略了源码中的注释。不要打印整个 `config`，因为它包含密钥；只显示确认运行所需的非敏感字段。

### 为什么选择这种方案

这个方案把四件事放在一个入口完成：查找文件、解析文本、合并来源、校验结果。调用方只接收 `Config`，不会在模型模块和终端模块里重复读取环境变量。它还保留了三个实用性质：命令行覆盖不会改写文件，父进程环境变量不会被 `.env` 覆盖，解析 `.env` 不会修改全局进程状态。

配置量目前只有三项，普通 TypeScript 和 Node 标准库已经足够。增加配置框架或模式库只会让初学者同时学习更多 API；当字段数量增长、出现嵌套结构或复杂联合校验时，再引入 Zod 等运行时模式库更合适。

### 还有哪些方案

| 方案 | 适合场景 | 本节没有选择的原因 |
| --- | --- | --- |
| Node 的 `process.loadEnvFile()` | 希望一次把文件字段全部写入 `process.env` | 它会修改进程级全局状态，配置来源和覆盖顺序不如当前实现直观。 |
| `dotenv.config()` | 需要兼容旧版 Node，或项目已经使用 dotenv | 本项目最低版本为 Node 22，标准库已经覆盖当前需求；再加依赖没有获得新能力。 |
| `node --env-file=.env` | 启动脚本始终掌握 `.env` 的固定位置 | 全局安装的 CLI 可能从不同项目和子目录启动，固定相对路径不够灵活。 |
| 把值写进 JSON/TS 配置文件 | 配置不含秘密，并且需要提交共享 | API Key 不应进入仓库；临时覆盖也会变成写文件操作。 |
| 使用 Zod 等模式库 | 配置字段很多，存在复杂格式和条件关系 | 当前只有三个字段，手写边界校验更短，也更便于学习数据流。 |

选择方案的标准不是“哪一个最流行”，而是它是否满足本节的真实约束：从项目目录启动、来源优先级可见、不污染全局状态、密钥不进入命令历史，以及在网络请求之前失败。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 新增 | `src/config/load-config.ts` | 查找、合并并校验配置。 |
| 修改 | `src/cli.ts` | 登记覆盖选项，在默认操作中读取配置。 |

### 第一步：实现配置模块

创建 `src/config/load-config.ts`。下面是本节可以直接运行的完整实现；源码中的[教学注释版](src/config/load-config.ts)还标出了输入、输出和失败分支。

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export type Options = { model?: string; baseUrl?: string };
export type Config = { apiKey: string; model: string; baseURL: string };
export class UserFacingError extends Error {}

function readProjectEnv(): Record<string, string | undefined> {
  let directory = process.cwd();
  while (true) {
    const envPath = join(directory, ".env");
    if (existsSync(envPath)) {
      try {
        return parseEnv(readFileSync(envPath, "utf8"));
      } catch {
        throw new UserFacingError("无法读取项目的 .env，请检查文件格式和读取权限。");
      }
    }
    if (existsSync(join(directory, "package.json"))) return {};
    const parent = dirname(directory);
    if (parent === directory) return {};
    directory = parent;
  }
}

export function readConfig(options: Options): Config {
  const fileEnv = readProjectEnv();
  const env = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim();
  const apiKey = env("OPENAI_API_KEY");
  const model = options.model?.trim() || env("OPENAI_MODEL");
  if (!apiKey) {
    throw new UserFacingError("缺少 OPENAI_API_KEY。请在当前目录、项目根目录的 .env 或环境变量中配置。");
  }
  if (!model) {
    throw new UserFacingError("缺少 OPENAI_MODEL。请填写服务商提供的模型 ID，或使用 --model。");
  }
  const baseURL = options.baseUrl?.trim() || env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new UserFacingError("接口地址无效，请检查 OPENAI_BASE_URL 或 --base-url。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new UserFacingError("接口地址须为 HTTP(S) 基础地址，不能含用户名、密码、查询参数或片段。");
  }
  return { apiKey, model, baseURL };
}
```

这个文件先查找 `.env`，再为每个字段选择优先级最高的非空值。函数只有两种结果：返回完整 `Config`，或在创建模型客户端之前抛出安全错误。

### 第二步：让命令入口读取配置

在 `src/cli.ts` 中导入配置模块：

```ts
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
```

在 `.helpOption()` 后面登记两个命令行选项，并把默认操作改成下面这样：

```ts
.option("--model <id>", "本次使用的模型 ID")
.option("--base-url <url>", "本次使用的接口基础地址")
.action(() => {
  const config = readConfig(program.opts<Options>());
  console.log("Hello，My Agent！");
  console.log(`配置已就绪，模型：${config.model}。本节不发送模型请求。`);
});
```

最后用 `try/catch` 包住参数解析，只显示程序自己编写的安全提示：

```ts
try {
  program.parse();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "配置读取失败，请检查当前目录。"}`);
  process.exitCode = 1;
}
```

### 第三步：填写第一组配置

在仓库根目录新建或编辑 `.env`。保留已有内容，先填写这三项：

```dotenv
OPENAI_API_KEY=此处填写服务商密钥
OPENAI_MODEL=此处填写服务商模型ID
OPENAI_BASE_URL=https://api.openai.com/v1
```

本节不请求模型，可以先用非空的练习值观察配置是否读取成功。下一节发送真实请求前，必须换成服务商给你的值。兼容服务的密钥、模型、地址要来自同一服务；基础地址不要追加 `/chat/completions`。

根目录 `.env` 已被 Git 忽略。你可以在仓库根目录或第二章的小节目录运行已经构建的 `hello-my-agent`：程序都会向上找到这份配置。如果小节目录中另有 `.env`，程序优先使用离启动目录最近的一份。根目录 `.env.example` 还列出后续 Anthropic 字段，本节先不用填写。

### 第四步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.1
```

这条 npm 命令只构建并注册本节，不读取配置，也不调用模型。完成后运行默认命令检查配置，再检查帮助和版本：

```bash
hello-my-agent
hello-my-agent --help
hello-my-agent --version
```

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 登记模型与地址选项，在启动 Agent 时读取并使用配置。 |
| 新增 | [src/config/load-config.ts](src/config/load-config.ts) | 读取三项模型配置，检查缺失值和地址。 |

## 运行验证

应看到欢迎语和“配置已就绪”提示，然后退出。没有 HTTP 请求，也不会产生模型用量。再用下面的命令验证命令行覆盖：

```bash
hello-my-agent --model lesson-model
```

输出应显示 `lesson-model`，`.env` 文件不会被修改。这个结果只能证明本地字段存在且地址结构有效；密钥、模型 ID 和远端服务是否真实可用，要到下一节发出请求后才能确认。

## 失败实验

暂时移走 `.env` 中的 `OPENAI_API_KEY`，并确认环境变量中也没有它，然后运行 `hello-my-agent`。程序应提示缺少 `OPENAI_API_KEY`。再运行 `hello-my-agent --help` 和 `hello-my-agent --version`，它们仍应正常输出。

## 小练习

用 `hello-my-agent --model lesson-model` 临时覆盖 `.env` 中的模型名。解释为什么命令结束后 `.env` 的内容没有变化。

参考答案：`--model` 只存在于本次进程的参数中。`readConfig()` 读取它并放入内存中的 `Config`，没有执行任何写文件操作，所以 `.env` 不会改变。

## 接下来

配置已经能读取，但还没有调用模型。下一节只做一次请求。
