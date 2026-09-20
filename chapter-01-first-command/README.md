# 第 01 章：从空目录到自己的命令

[全书目录](../README.md) · [完整源码](cli.ts) · [环境与从零搭建](../docs/SETUP.md) · [练习答案](EXERCISES.md)

**本章目标：从空目录开始，做出一个可以安装、支持帮助和版本查询的 `hello-my-agent` 命令。** 本章只输出固定文本，不调用模型，无需 API Key。本章已于 2026-09-16 确认完成。

## 问题

我们要写一个 Coding Agent，也就是能理解编程目标并逐步使用工具完成任务的程序。先不考虑模型、文件和工具，只看使用者怎样启动它。

下面的 TypeScript 文件已经能输出一句欢迎语：

```ts
#!/usr/bin/env node
// 第一行让类 Unix 系统找到 Node 执行入口；这里先把欢迎语输出到终端。
console.log("Hello，My Agent！");
```

但是，把这个文件交给另一个人后，还会遇到三个问题：

1. **怎样找到并启动程序？** 使用者未必知道入口文件在哪，也不应该每次输入文件路径。
2. **怎样运行 TypeScript 源码？** 发布后的命令不能要求使用者另外安装 TypeScript 运行工具，因此需要生成 Node.js 可以直接执行的 JavaScript。
3. **怎样知道命令的用法和版本？** 命令需要在忘记参数或排查问题时，自己显示帮助和版本信息。

因此，本章要解决的问题是：**怎样把一个只能在源码目录中运行的 TypeScript 文件，变成可以安装、启动并查询帮助和版本的命令？** 本章只建立命令入口，模型能力从第二章开始接入。

## 解决方案

用 TypeScript 编写入口，编译为 JavaScript，再让 npm 把命令名连接到编译后的文件。读者只需记住 `hello-my-agent` 这个命令名。

```mermaid
flowchart LR
  A[cli.ts] -->|tsc 编译| B[dist/cli.js]
  B -->|build 自动注册| C[hello-my-agent 命令]
  C -->|Node 运行| B
  B -->|npm pack 打包| D[安装包]
```

本章的入口源码是 [cli.ts](cli.ts)，编译后的运行文件是 `dist/cli.js`。Commander 负责解析命令行参数；后续章节在这个基础上增加模型和工具能力。

## 工作原理

先把“运行一个命令”理解成四个程序接力，而不是 TypeScript 文件自己变成了命令：

```text
用户输入 hello-my-agent --help
  -> shell 在 PATH 中寻找名为 hello-my-agent 的命令入口
  -> npm 创建的入口指向 dist/cli.js
  -> 操作系统根据 #!/usr/bin/env node 启动 Node
  -> Commander 解析 --help，选择帮助分支并结束
```

这四层各自解决一个问题：shell 负责找到命令，npm 负责把命令名映射到文件，Node 负责执行 JavaScript，Commander 负责根据参数选择行为。最容易误解的是 `.name("hello-my-agent")`：它只改变帮助中显示的名字，不能让 shell 找到命令；真正建立命令入口的是 `package.json` 的 `bin`。

本章只打通本地命令的启动和参数分支。模型、网络、历史与工具都还没有进入这条执行链。

### 第一步：登记命令收到参数后应该做什么

入口中的这一段声明命令行为：

```ts
const program = new Command();

program
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  .action(() => {
    console.log("Hello，My Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

program.parse();
```

`.action()` 保存一个函数，并不立即执行。直到最后的 `.parse()` 读取参数，Commander 才决定这次调用走哪条路径：

| 用户输入 | 实际发生什么 |
| --- | --- |
| `hello-my-agent` | 执行 `.action()` 中的函数 |
| `hello-my-agent --help` | 输出帮助并结束 |
| `hello-my-agent --version` | 输出版本并结束 |
| `hello-my-agent --versoin` | 选项拼写错误，输出错误并以退出码 `1` 结束 |

`.version(packageJson.version, "-v, --version", "显示版本号")` 中，第一项是要打印的版本，第二项注册两个等价选项，第三项是帮助文字。`hello-my-agent -v` 与 `hello-my-agent --version` 都是直接运行同一个命令；本书示例统一采用含义更完整的 `--version`。帮助选项的 `-h` 与 `--help` 同理。

`-v` 和 `--version` 分别是短选项和长选项，前面的短横线属于选项写法。运行时照着输入即可；不要写成 `hello-my-agent version`，本章没有定义这样的子命令。

这里一串 `.name().description()` 叫链式调用：每个方法配置一项信息后返回这个命令对象，因此可以接着调用下一个方法。

### 第二步：从程序自己的位置读取版本

`packageJson.version` 从哪里来？入口前面读取了根目录的包清单：

```ts
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
```

`import.meta.url` 是当前程序文件的 URL。`new URL("../package.json", import.meta.url)` 以这个文件为基准，定位上一级目录中的包清单。源码在 `chapter-01-first-command/cli.ts`，编译产物在 `dist/cli.js`；两者的上一级目录中都有本包的 `package.json`。构建脚本保持这个输出位置。

`readFileSync(..., "utf8")` 按 UTF-8 编码读取文本，`JSON.parse(...)` 再把 JSON 文本转成对象。这样，后面就能通过 `packageJson.version` 取得版本号。

不要改成 `readFileSync("package.json")`。那样会从**当前工作目录**找文件：如果你在别人的项目里运行 Agent，就可能读到别人的版本号，或根本找不到文件。

例如，在 `/work/demo` 运行已安装的命令时，工作目录是 `/work/demo`，但版本号仍应来自 Agent 安装目录中的包清单。练习中的环境诊断会用到这两个目录的区别。

可以把这理解成两套坐标：

- `import.meta.url` 以**程序文件**为原点，适合查找 Agent 自己的版本、模板和内置资源。
- `process.cwd()` 以**用户启动命令的位置**为原点，适合查找用户项目中的源码、配置和工作文件。

如果在 `/work/demo` 启动安装在另一个目录的 Agent，前者仍指向 Agent 安装目录，后者则是 `/work/demo`。混用两套坐标，是 CLI 离开源码目录后最常见的路径错误之一。

### 第三步：用 bin 把命令名连接到运行文件

[package.json](../package.json) 的 `bin` 字段建立这条连接：

```json
{
  "bin": {
    "hello-my-agent": "dist/cli.js"
  }
}
```

这里只展示 `package.json` 的 `bin` 字段，完整配置在 [环境准备](../docs/SETUP.md#根目录包清单)。npm 安装或链接这个包时，会读取 `bin`，创建一个名为 `hello-my-agent` 的命令入口，并让它指向 `dist/cli.js`。

在 macOS / Linux 上，shell 先按 `PATH` 的目录顺序找到这个入口。系统读取文件第一行 `#!/usr/bin/env node` 后，再从 `PATH` 中寻找 Node，用 Node 执行其余 JavaScript。`bin` 解决“命令名对应哪个文件”，shebang 解决“这个文件交给哪个解释器”；两者缺一不可。

例如，输入 `hello-my-agent --version` 时，完整路径是：shell 找到命令入口 → 入口到达 `dist/cli.js` → Node 执行文件 → Commander 识别 `--version` → 打印从本包 `package.json` 读取的版本 → 进程以成功状态结束。

## 动手构建

如果你从空目录跟写，先按 [环境准备](../docs/SETUP.md) 建立项目，做到“写第一段代码”，确认 `hello-my-agent` 能打印欢迎语，再回到这里。已经下载配套仓库的读者可以直接对照源码阅读，并按下方“运行验证”检查结果。

在自己的 `chapter-01-first-command/cli.ts` 中，按下面顺序补齐功能：

1. 导入 Node 的文件读取函数和 Commander。
2. 相对入口读取包清单，取出版本号。
3. 创建命令对象，注册帮助、版本和默认操作。
4. 最后解析参数。

完整文件如下，包含与 [本章源码](cli.ts) 一致的中文教学注释。先读文件头的问题与流程，再按 1—4 四个步骤跟写；关键语句旁会解释参数含义和设计原因：

```ts
#!/usr/bin/env node

/**
 * 第 01 章：从空目录到自己的命令。
 *
 * 要解决的问题：别人安装这个包后，怎样在自己的项目里启动命令、查看帮助和版本？
 * 本章实现命令入口、帮助和版本查询；下一章在这个入口接入模型。
 *
 * 执行流程：
 *   读取本包版本 -> 登记命令规则 -> 解析用户参数
 *                                  | 无参数        -> 显示欢迎语
 *                                  | --help / -h   -> 显示帮助，结束
 *                                  | --version / -v -> 显示版本，结束
 *                                  | 不支持的参数  -> 报错，结束
 *
 * 两个概念：CLI 是命令行界面；入口文件是 Node 开始执行程序的文件。
 * 构建脚本会自动注册命令；npm 根据 package.json 的 bin 将命令名连接到入口文件。
 * 第一行的 #!/usr/bin/env node 让类 Unix 系统通过 PATH 找到 Node 执行它。
 *
 * 在项目根目录执行 npm run lesson:01，一次完成依赖安装、编译与注册。
 * 准备完成后直接运行以下命令；修改源码后重新执行小节命令即可：
 *   hello-my-agent           -> 显示欢迎语
 *   hello-my-agent --help    -> 显示帮助
 *   hello-my-agent --version -> 显示 package.json 中的版本；-v 是它的简写
 */

// 1. 准备依赖：Node 负责读本地文件，Commander 负责解析命令参数。
// node:fs 是 Node 自带的文件模块，无需安装；commander 是本项目的运行依赖。
import { readFileSync } from "node:fs";
import { Command } from "commander";

// 2. 读取 Agent 自己的版本，避免在代码里再维护一份版本字符串。
// import.meta.url 是当前文件的 URL；new URL("../package.json", ...) 据此定位包清单。
// 源码在 chapter-01-first-command/，编译后在 dist/；从这两个目录向上一层都能找到清单。
// 例如用户在 /work/demo 启动已安装的命令，这里仍读取 Agent 安装目录的清单。
// 若只写 readFileSync("package.json")，就会从当前工作目录查找，可能读错文件或找不到。
// "utf8" 指定文本编码；JSON.parse 把读到的 JSON 文本转成对象，供后面读取 version。
// 这里在启动时同步读取一次小文件；文件缺失或 JSON 无效时直接报错，便于发现安装问题。
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// 3. 创建命令对象并登记规则；此时还没有开始解析用户输入。
// 下面的方法返回同一个命令对象，所以可以用 .name().description() 连续配置。
const program = new Command();

program
  // 设置帮助中显示的命令名；本机的命令入口由 npm 根据 bin 字段创建。
  .name("hello-my-agent")
  // 设置帮助中的简介，让使用者知道命令的用途。
  .description("你好，我的 Agent：从 0 到 npm 发布")
  // 三个参数依次是版本号、等价选项、帮助文字；-v 与 --version 都会显示版本并结束。
  .version(packageJson.version, "-v, --version", "显示版本号")
  // -h 与 --help 都会显示帮助并结束；Commander 根据已登记的规则生成帮助内容。
  .helpOption("-h, --help", "显示帮助")
  // 把 () => { ... } 这个函数交给 Commander，等解析参数后再决定是否调用。
  // 按本章规则，无参数启动时执行这里；请求帮助或版本时不会执行。下一章在此接入模型。
  .action(() => {
    console.log("Hello，My Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

// 4. 开始解析：不传参数时，parse() 默认读取 Node 提供的命令行参数数组 process.argv。
// 数组前两项是 Node 和入口文件的路径，Commander 跳过它们，再处理用户输入的参数。
// 例如运行 hello-my-agent --help，这里解析的用户参数就是 --help。
// 必须先登记规则再调用 parse()；未知选项或多余的位置参数会报错，并以退出码 1 结束。
program.parse();
```

代码写好后，在跟写项目根目录执行 `npm run lesson:01`，自动安装依赖、更新编译产物并注册命令。接下来分别运行 `hello-my-agent` 和 `hello-my-agent --help`，比较默认输出与帮助输出。

## 本章实现清单

第一章从空目录开始，完成后具备以下内容：

| 部分 | 空目录 | 本章完成后 |
| --- | --- | --- |
| 入口行为 | 无 | 根据参数显示欢迎语、帮助或版本 |
| 版本信息 | 无 | 从本包的 `package.json` 读取 |
| 构建过程 | 无 | 将 `cli.ts` 编译为 `dist/cli.js` |
| 安装入口 | 无 | `bin` 把 `hello-my-agent` 连接到编译后的入口 |

后续第二章会保留这些行为，在默认操作中接入模型。第一章目录仍保留这一版本。

## 运行验证

在**仓库根目录**（包含 `package.json` 的目录）执行本章构建命令：

```bash
npm run lesson:01
```

这条命令一次完成依赖安装、选择第一章、编译与注册。准备完成后这样运行：

```bash
hello-my-agent
hello-my-agent --help
hello-my-agent --version
```

已经完成准备的读者，改完代码后仍执行同一条构建命令。这些本地操作无需 npm 账号，自动注册只影响本机命令，不会发布 npm 包。

默认操作输出：

```text
Hello，My Agent！
命令已启动。下一章，我们会给它接上模型。
```

帮助中应该有 `-h, --help` 和 `-v, --version`；版本输出 `0.1.0-dev.1`。请求帮助或版本时不会输出欢迎语，因为 Commander 处理这两个选项后就结束了程序，不会执行 `.action()` 中的回调。

继续在仓库根目录运行全书验收：

```bash
npm run verify
```

`verify` 会把第一章源码单独编译到临时目录，并在源码目录之外检查欢迎语、版本和 `--doctor` 练习答案。它还会打包并临时安装当前默认章节，验证 `package.json` 中的 `bin`、`files` 和依赖声明能生成可执行的 npm 包，最后清理临时文件。[手动打包安装](../docs/SETUP.md#手动打包安装) 展示了打包和安装步骤。

这组检查分别回答两个问题：第一章代码离开源码目录后还能否运行，以及当前项目能否形成可安装的 npm 包。

## 失败实验：把参数拼错

命令注册完成后，输入一个拼错的选项：

```bash
hello-my-agent --versoin
```

错误输出中应包含 `unknown option '--versoin'`。在 macOS / Linux 终端中，紧接着执行 `echo $?`，应得到退出码 `1`。`$?` 表示上一条命令的退出码，`0` 通常表示成功，非零表示失败。改为运行 `hello-my-agent --version`，再执行 `echo $?`，应得到 `0`。

Commander 帮我们拒绝未知输入。后续让其他程序自动调用 Agent 时，它们也会用退出码判断任务是否成功。

如果改了源码但运行结果没变，先在该项目根目录执行 `npm run lesson:01`。若结果仍不符，用 `command -v hello-my-agent` 查看终端找到的命令位置，再按 [命令查找说明](../docs/SETUP.md#注册命令后如何找到它) 检查。

## 小练习

给命令增加 `--doctor`，打印 Node 版本、系统与架构、当前工作目录。原来的欢迎语、帮助和版本行为继续保留。

思考：显示当前工作目录时应该使用 `process.cwd()` 还是 `import.meta.url`？为什么这里与读取版本号不同？

完成练习并重新构建后，运行 `hello-my-agent --doctor`。具体步骤和完整代码见 [练习答案](EXERCISES.md)。

## 接下来

命令已经能启动，但回答仍是写死的两行文字。下一章要解决的是：怎样把输入发给模型，以及为什么第二次提问时需要保留第一次的消息。

[继续第 02 章：接通模型并持续对话](../chapter-02-model-dialogue/README.md)。
