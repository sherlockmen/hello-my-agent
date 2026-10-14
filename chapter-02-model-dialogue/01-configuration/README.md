# 02.1 读取模型配置

[第二章导航](../README.md) · [上一节](../../chapter-01-first-command/README.md) · [下一节：02.2](../02-first-reply/README.md)

**本节目标：让命令从 `.env`、环境变量或命令行读取模型配置。运行后只显示配置已就绪，暂不发送模型请求。**

## 问题：命令已经能启动，接下来要连接哪个模型

第一章的命令已经可以安装和运行，但它每次只打印同样的欢迎语。接下来，我们要把问题交给真正的模型，让它根据输入生成回答。

发送请求前，程序得先知道三件事：向哪个地址发送、使用哪个模型，以及用哪份 API Key 证明调用者的身份。模型 ID 用来选择服务提供的具体模型；API Key 是服务商签发的访问凭据；基础地址则决定请求发到哪里。这三项要配套使用，不能只从别处复制一个模型名就开始请求。

直接把它们写进源码当然能用，但换模型就得改代码、重新构建，密钥也容易跟着代码提交到仓库。我们希望日常配置保存在本机，需要临时换模型时，再用命令行覆盖一次。

所以，这一节先让程序读懂配置。等它能明确告诉用户“本次准备连接哪个模型”，下一节再真正发送问题。

## 解决方案：启动时读配置，检查好再交给模型模块

我们把日常配置放在项目的 `.env` 文件中，也允许环境变量和命令行选项提供配置。程序启动时找到这些值，按约定的顺序选择，再检查密钥、模型名有没有填写，地址格式是否符合要求。

这几件事集中放在配置模块中。入口调用 `readConfig()`，成功后得到一份 `Config`，里面就是本次要使用的值；缺少必要信息时，程序显示原因并结束。

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

帮助和版本查询不需要连接模型，所以仍由 Commander 提前处理。第一章练习中的 `--doctor` 也会在读取模型配置之前结束。

## 工作原理

### 日常配置与临时选择为什么分开

假设 `.env` 中保存的是 `OPENAI_MODEL=model-a`，但我们这次想试试 `model-c`。如果每次都修改文件，试完还得记得改回来；临时选项更合适：本次启动传入 `--model model-c`，程序只在内存中使用它，文件仍保留原来的值。

环境变量又适合另一种场景。比如 shell、容器或部署系统已经提供了配置，程序应该能直接使用，而不强制要求磁盘上有 `.env`。这就是保留三个来源的原因。它们同时提供同一个字段时，本节按下面的顺序选择第一个非空值：

```text
命令行选项 > process.env > 最近项目的 .env > 默认值
```

如果文件写着 `model-a`、环境变量写着 `model-b`、命令行指定 `model-c`，最终选择的就是 `model-c`。优先级只决定本次读取什么，不会改写文件，也不会反过来修改启动 Agent 的 shell。

这里的“非空”包括去掉首尾空白后仍有内容。只填了几个空格不算模型名，程序会继续找下一个来源。密钥和模型没有默认值；只有基础地址在未填写时使用 OpenAI 的公开地址。

API Key 不提供命令行选项，因为启动参数可能进入 shell 历史或进程列表。密钥放在 `.env` 或环境变量中，可以减少这种暴露机会；包含密钥的整个 `Config` 也不能直接打印。

### 从子目录启动，怎样找到同一份配置

第一章读取版本时，程序沿着自己的安装位置找 `package.json`。模型配置不同：它属于当前正在使用 Agent 的项目，因此这次要从 `process.cwd()`，也就是用户启动命令的目录开始找。

例如，配置保存在仓库根目录，用户在 `chapter-02-model-dialogue/01-configuration` 中运行命令。程序先检查这个目录，没找到 `.env` 就向上一层继续。找到一份后立即使用，不会把沿途的多份文件混在一起。

程序也不能一直找上去。遇到最近的 `package.json`，就把这里作为当前项目的边界：先检查同目录的 `.env`，没有就停止。这样，在另一个 Node 项目里启动时，就不会继续找到其上级目录中无关项目的配置。没有遇到包清单时，查找到文件系统根目录也会停止。

下面是查找部分的主线，省略了读取失败的处理；“动手构建”会给出完整文件：

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

`parent === directory` 表示已经到了根目录。返回 `{}` 则表示没找到文件配置；程序仍可以使用命令行和环境变量，不会因为没有 `.env` 就立即失败。

### `.env` 是文本，要读出来才会成为配置

Node 不会因为一个文件叫 `.env`，就自动使用其中的内容。程序要先读取文本，再解析其中的键和值：

```ts
const fileEnv = parseEnv(readFileSync(envPath, "utf8"));
// 例如：{ OPENAI_MODEL: "gpt-5" }
```

本书要求 Node 22，可以直接使用内置的 [parseEnv()](https://nodejs.org/api/environment_variables.html#programmatic-apis)。它处理引号、空白和注释，返回一个普通对象，不把文件内容自动写进 `process.env`。三个来源因此仍然分开，程序可以自己决定每一项用哪个值。

配置只在启动时读取一次，而且读完之前还不能请求模型，所以这里使用同步文件读取。它让读取、解析、检查按顺序完成；当前不需要为这一步再引入异步调度或配置库。读取或解析发生异常时，程序只提示检查文件和权限，不把配置正文带进错误信息。

### 检查的是本地输入，还不是账号能否使用

配置模块的输入和输出有一个区别：输入可以缺项，成功返回的结果必须完整。

```ts
export type Options = { model?: string; baseUrl?: string };
export type Config = { apiKey: string; model: string; baseURL: string };
```

`Options` 里的问号表示这些选项可以不传，因为程序还可以从别处找到值。`Config` 的三个字段都是必填的；模型模块拿到它后，就不用再到处找环境变量。

但 TypeScript 类型不能替程序检查真实输入。`readConfig()` 仍要判断密钥和模型名是否非空，并用 `new URL()` 解析基础地址。解析成功后，还要检查它使用 HTTP(S)，且没有夹带用户名、密码、查询参数或片段。SDK 会在基础地址后面补上接口路径，因此这里保存的应是基础地址，不是完整的请求 URL。

`baseUrl` 是命令行选项 `--base-url` 对应的名字，`baseURL` 是 SDK 使用的字段名。配置模块返回时也顺便完成这次名称转换。

这些检查只能回答“本地信息是否填写完整、地址结构是否合适”。随便写一个非空密钥也可能通过，模型 ID 也可能根本不存在。它们能否被服务接受，要到下一节发出请求才知道。

### 为什么把读取和检查放在同一个模块

模型模块只需要一份能使用的配置，不需要知道它来自文件还是 shell。把选择顺序和检查集中起来，临时覆盖、子目录启动以及缺少字段都会走同一套规则，入口也只负责调用和显示。

Node 的 `process.loadEnvFile()` 或 `dotenv.config()` 也能读取配置，但会把读取结果放进进程环境；本节保留独立对象，方便看清每个值从哪里来。固定使用 `node --env-file=.env` 则要求启动命令知道文件位置，不如从当前项目查找适合这个 CLI。

目前只有三项配置，Node 标准库和普通条件判断已经够用。第 17 章会继续讨论项目配置的作用范围与信任，第 23 章再加入运行中的模型切换和凭据管理。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 登记模型与地址选项，在启动 Agent 时读取并使用配置。 |
| 新增 | [src/config/load-config.ts](src/config/load-config.ts) | 读取三项模型配置，检查缺失值和地址。 |

## 动手构建

从空目录跟写时，先创建 `chapter-02-model-dialogue/01-configuration/`。下面的 `src/` 都位于这个目录中；入口从第一章完成 `--doctor` 练习后的代码继续，第二步会说明怎样放入本节。已有配套仓库时，直接对照本节的 `src/` 即可。

### 第一步：实现配置模块

本节开始按职责分文件。先在本小节新建 `src/config/`，创建 `src/config/load-config.ts`。下面的完整文件与[本节源码](src/config/load-config.ts)一致：

```ts
/**
 * 02.1 读取模型配置 | [NEW] config/load-config.ts
 *
 * 学习目标：从三个来源读取配置，按固定优先级合并，并在返回前完成校验。
 * 输入：--model / --base-url、process.env，以及当前项目最近的 .env。
 * 输出：包含 apiKey、model、baseURL 的 Config；无效输入抛出 UserFacingError。
 *
 * 本文件局部流程（当前启动主流程见 cli.ts）：
 *   +-----------+   +-------------+   +--------------+   +--------+
 *   | CLI options |-->|             |   | required     |   |        |
 *   | process.env|->| first value |-->| fields + URL |-->| Config |
 *   | .env      |-->|             |   | validation   |   |        |
 *   | defaults  |-->|             |   +------+-------+   +--------+
 *   +-----------+   +-------------+          |
 *                                           +-- 失败 --> UserFacingError
 *   优先级：CLI options > process.env > .env > defaults
 *
 * 关键点：优先级是 CLI options > process.env > .env > defaults；查找 .env 时不越过最近的 package.json。
 * 本节只读取配置，不发送请求。 配置对象含有 API Key，不能整体写入日志。
 * 运行观察：命令行模型名可以临时覆盖 .env，但不会修改文件。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

// [NEW 02.1] 本文件以下实现均为本节新增。
// Options 允许输入缺项，Config 则表示检查完成后可以使用的配置。
export type Options = { model?: string; baseUrl?: string };
export type Config = { apiKey: string; model: string; baseURL: string };
// 这个错误使用程序预先编写的提示；创建时不放密钥，显示时也不展开外部异常。
export class UserFacingError extends Error {}

// [NEW 02.1] 从当前目录向上寻找最近项目的 .env；遇到 package.json 后不再越过项目边界。
/**
 * 找到当前项目使用的 .env，把文件中的键和值读成普通对象。
 *
 * 从用户启动命令的目录开始，每一层先找 .env，再看是否已到 package.json。
 * 找到文件就返回解析结果；到达项目边界或根目录仍未找到时，返回空对象，
 * 让调用方继续使用命令行和环境变量提供的配置。
 * 读取或解析抛出异常时，改用固定的 UserFacingError，避免回显配置正文。
 * 返回的对象与 process.env 分开，文件内容不会自动覆盖进程环境。
 */
function readProjectEnv(): Record<string, string | undefined> {
  let directory = process.cwd();
  while (true) {
    const envPath = join(directory, ".env");
    if (existsSync(envPath)) {
      try {
        // parseEnv 只解析选中的文件，不把其他字段写入 process.env。
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

/**
 * 为这次启动选出完整的模型配置，并在发送请求前检查它。
 *
 * options 来自命令行；其余值从进程环境和项目 .env 取得。
 * 每个字段先用命令行选项，再用环境变量和文件值，最后才考虑默认地址。
 * 去除空白后仍为空的值视为未填写；缺少密钥或模型、地址格式不符合要求时抛出提示。
 * 成功返回 apiKey、model 和 baseURL，但不验证远端是否接受它们，也不发送请求。
 */
export function readConfig(options: Options): Config {
  const fileEnv = readProjectEnv();
  // 空值视为没填。优先级：命令行 > 环境变量 > .env > 默认值。
  const env = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim();
  const apiKey = env("OPENAI_API_KEY");
  const model = options.model?.trim() || env("OPENAI_MODEL");
  if (!apiKey) throw new UserFacingError("缺少 OPENAI_API_KEY。请在当前目录、项目根目录的 .env 或环境变量中配置。");
  if (!model) throw new UserFacingError("缺少 OPENAI_MODEL。请填写服务商提供的模型 ID，或使用 --model。");
  const baseURL = options.baseUrl?.trim() || env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  let url: URL;
  try { url = new URL(baseURL); } catch {
    throw new UserFacingError("接口地址无效，请检查 OPENAI_BASE_URL 或 --base-url。");
  }
  // 地址可能误带凭据，报错时只说明规则，不回显原值。
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new UserFacingError("接口地址须为 HTTP(S) 基础地址，不能含用户名、密码、查询参数或片段。");
  }
  return { apiKey, model, baseURL };
}
```

这个文件先查找 `.env`，再为每个字段选择优先级最高的非空值。检查通过后返回完整 `Config`；检查不通过则抛出提示，让入口结束启动。

### 第二步：让命令入口读取配置

把第一章完成练习后的命令入口放到本小节的 `src/cli.ts`，保留文件首行、版本读取和原来的命令规则。构建后入口仍是 `dist/cli.js`，所以读取版本时的相对路径不变。先加入配置模块导入：

```ts
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
```

把第一章练习中的三行诊断输出移进 `printDoctor()`，放在读取 `packageJson` 之后、创建 `program` 之前。输出内容没有改变，只是给这段操作起了名字：

```ts
// [CHANGED 02.1] 把第一章练习的诊断输出收进函数；仍在读取模型配置前执行。
/**
 * 显示当前命令使用的 Node、平台和工作目录，方便比较运行环境。
 *
 * 这些值来自当前进程的 process，函数依次打印三行诊断信息。
 * 入口在读取模型配置之前调用它，所以缺少 API Key 时也能查看环境。
 * 这里不测试网络或模型，也不判断显示出来的版本是否满足要求。
 */
function printDoctor(): void {
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Working directory: ${process.cwd()}`);
}
```

保留已经登记的 `--doctor`，在它后面加入 `--model` 与 `--base-url`，再替换原来的 `.action()`。下面从 `--doctor` 开始展示连续的这一段，不要重复添加已有选项：

```ts
.option("--doctor", "显示当前运行环境")
.option("--model <id>", "本次使用的模型 ID")
.option("--base-url <url>", "本次使用的接口基础地址")
.action(() => {
  const options = program.opts<Options & { doctor?: boolean }>();
  if (options.doctor) {
    printDoctor();
    return;
  }
  const config = readConfig(options);
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

本节不请求模型，可以先用非空的练习值观察配置是否读取成功。下一节发送真实请求前，必须换成服务商提供的真实值。兼容服务的密钥、模型、地址要来自同一服务；基础地址不要追加 `/chat/completions`。

根目录 `.env` 已被 Git 忽略。可以在仓库根目录或第二章的小节目录运行已经构建的 `hello-my-agent`：程序都会向上找到这份配置。如果小节目录中另有 `.env`，程序优先使用离启动目录最近的一份。根目录 `.env.example` 还列出 02.5 才会使用的 Anthropic 字段，本节先不用填写。

### 第四步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.1
```

这条 npm 命令只构建并注册本节，不读取配置，也不调用模型。完成后运行默认命令检查配置，再检查帮助和版本：

```bash
hello-my-agent
```

```bash
hello-my-agent --help
```

```bash
hello-my-agent --version
```

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

## 本节完成后的 Agent

此时，Agent 的启动链已经能够把外部配置转换成程序内部可以使用的 `Config`：

```text
命令行参数 / 环境变量 / .env / 默认值
                  -> readConfig()
                  -> 校验并生成 Config
                  -> 显示配置已就绪
```

Agent 现在知道应该连接哪个地址、使用哪个模型和哪份凭据，但还没有发出网络请求，因此配置是否真的可用仍未得到验证。下一节将把 `Config` 交给模型客户端，完成第一次真实回答。
