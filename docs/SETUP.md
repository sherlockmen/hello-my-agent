# 环境准备：从空目录到第一章

[返回全书](../README.md) · [第一章教学正文](../chapter-01-first-command/README.md) · [完整代码](../chapter-01-first-command/cli.ts)

这一页负责把第一章需要的运行环境准备好。我们先让 TypeScript 能编译成 JavaScript，再把编译结果注册为 `hello-my-agent` 命令。命令为什么这样组织、参数怎样决定行为，回到第一章正文继续理解。

已有配套仓库时，使用下一节的一条构建命令即可，它会安装依赖、选择源码、编译并注册。从空目录跟写时，从“检查环境”开始，做到“写第一段代码”后回到第一章，实现帮助与版本查询。本页中的“项目根目录”指包含 `package.json` 的目录。

## 已有配套仓库

在网站上阅读时，先取得[与教程同步的配套源码](https://github.com/sherlockmen/hello-my-agent/tree/master)。在准备存放练习项目的目录运行：

```bash
git clone --branch master --single-branch https://github.com/sherlockmen/hello-my-agent.git hello-my-agent-study
cd hello-my-agent-study
```

这个分支包含当前教程的全部小节源码、依赖锁文件和验收脚本。希望从空目录自己跟写时，继续使用下文的“检查环境”和“建立一个练习项目”。

读到第一章的“动手构建”后，在仓库根目录选择这一章：

```bash
npm run lesson:01
```

```bash
hello-my-agent
```

完成第一章后，按 [02.1 配置说明](../chapter-02-model-dialogue/01-configuration/README.md#第三步填写第一组配置) 填写根目录 `.env`，再进入第二章：

```bash
npm run lesson:02.1
```

进入 02.2 时运行 `npm run lesson:02.2`。TypeScript 构建配置由统一脚本根据小节选择源码；完整命令列在[第二章构建表](../chapter-02-model-dialogue/README.md#构建并选择每个小节)。构建成功后，帮助和版本可以直接运行：

```bash
hello-my-agent --help
```

```bash
hello-my-agent --version
```

`-h` 与 `--help` 等价，`-v` 与 `--version` 等价。它们都是同一个命令的选项。以下步骤用于从空目录建立项目。

## 检查环境

```bash
node --version
```

```bash
npm --version
```

需要 Node.js 22 或以上与 npm。当前实测：Node.js 22.23.2、npm 12.0.2、macOS arm64。`.nvmrc` 记录作者的 Node 版本，它本身不会自动安装或切换运行时。

如找不到命令，从 [Node.js 官网](https://nodejs.org/en/download) 安装满足要求的版本，重新打开终端再检查。下文采用 macOS / Linux shell 语法，目前只在 macOS 验证。

## 建立一个练习项目

在准备存放练习项目的目录执行以下命令。如果已经存在 `hello-my-agent-study`，请换一个未使用的目录名。

```bash
mkdir hello-my-agent-study
```

```bash
cd hello-my-agent-study
```

```bash
npm init -y
```

```bash
npm install --save-exact commander@14.0.3 openai@7.15.0 @anthropic-ai/sdk@0.126.0 ignore@7.0.9 react@19.3.0 ink@7.1.1 ink-text-input@6.0.0 wrap-ansi@9.0.2 string-width@8.2.2 @modelcontextprotocol/sdk@1.32.1 zod@4.6.7
```

```bash
npm install --save-dev --save-exact typescript@5.9.3 @types/node@22.20.3 @types/react@19.3.0
```

```bash
mkdir chapter-01-first-command
```

Commander 处理命令行参数，OpenAI 与 Anthropic SDK 接入模型，`ignore` 按 `.gitignore` 规则过滤搜索结果。第十章开始使用 React 保存界面状态、Ink 绘制终端界面、`ink-text-input` 接收输入，`wrap-ansi` 按终端列宽折行。第十一章再用 `string-width` 测量中文、emoji 等文本所占的终端列宽，帮助光标定位和窗口变化后的排版。第二十一章使用官方 MCP SDK 连接外部工具服务，`zod` 支持 SDK 的运行时数据校验。这些都属于运行依赖，因此安装后的命令也会带上它们。

TypeScript 用于检查和编译代码，`@types/node` 与 `@types/react` 分别提供 Node 和 React 的类型声明，属于开发依赖。开发时和安装后都运行编译生成的 JavaScript。第一章暂时只使用其中的 Commander，后续章节再逐步接入其他依赖。

`--save-exact` 固定直接依赖版本，锁文件记录完整依赖关系。从空目录建立项目时，使用上面的 `npm install` 命令声明依赖并生成锁文件。取得包含锁文件的配套仓库后，直接执行对应小节的构建命令，脚本会自动安装依赖。

若希望 npm 的日常输出简洁，在项目根目录创建 `.npmrc`，写入：

```ini
loglevel=warn
```

这会隐藏常规提示，仍保留警告与错误；不会隐藏 Agent 自己打印的内容。

## 根目录包清单

把根目录 `package.json` 改为下面的公共配置。它与当前仓库同步，包含第 01—25 章需要的脚本和依赖。学习第一章时先关注 `type`、`bin`、`lesson:01`、Commander 和 TypeScript；进入后续章节时，再回来看对应的 `lesson:02.N`—`lesson:25.N`、验收脚本、模型 SDK 和 `ignore`：

从空目录跟写时，包清单中出现一条脚本，不代表它依赖的文件已经创建。只完成第一章时，使用 `lesson:01`、`typecheck` 和下文的手动打包安装步骤；`verify` 需要完整配套仓库的章节与测试，`build` 和 `prepack` 当前也会选择尚未写到的 25.3。后面的 `check:*`、`exercise:*` 自动检查同样需要配套的 `tests/` 文件。

```json
{
  "name": "@sherlockmen/hello-my-agent",
  "version": "0.1.0-dev.1",
  "private": true,
  "description": "Hello, My Agent：从 0 到 npm 发布，亲手构建你的 TUI Coding Agent",
  "license": "MIT",
  "type": "module",
  "bin": {
    "hello-my-agent": "dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "node scripts/compile.mjs 25.3 --prepare",
    "lesson:01": "node scripts/compile.mjs 01 --prepare",
    "lesson:02.1": "node scripts/compile.mjs 02.1 --prepare",
    "lesson:02.2": "node scripts/compile.mjs 02.2 --prepare",
    "lesson:02.3": "node scripts/compile.mjs 02.3 --prepare",
    "lesson:02.4": "node scripts/compile.mjs 02.4 --prepare",
    "lesson:02.5": "node scripts/compile.mjs 02.5 --prepare",
    "lesson:02.6": "node scripts/compile.mjs 02.6 --prepare",
    "lesson:03.1": "node scripts/compile.mjs 03.1 --prepare",
    "lesson:03.2": "node scripts/compile.mjs 03.2 --prepare",
    "lesson:03.3": "node scripts/compile.mjs 03.3 --prepare",
    "lesson:04.1": "node scripts/compile.mjs 04.1 --prepare",
    "lesson:04.2": "node scripts/compile.mjs 04.2 --prepare",
    "lesson:04.3": "node scripts/compile.mjs 04.3 --prepare",
    "lesson:05.1": "node scripts/compile.mjs 05.1 --prepare",
    "lesson:05.2": "node scripts/compile.mjs 05.2 --prepare",
    "lesson:05.3": "node scripts/compile.mjs 05.3 --prepare",
    "lesson:06.1": "node scripts/compile.mjs 06.1 --prepare",
    "lesson:06.2": "node scripts/compile.mjs 06.2 --prepare",
    "lesson:06.3": "node scripts/compile.mjs 06.3 --prepare",
    "lesson:07.1": "node scripts/compile.mjs 07.1 --prepare",
    "lesson:07.2": "node scripts/compile.mjs 07.2 --prepare",
    "lesson:07.3": "node scripts/compile.mjs 07.3 --prepare",
    "lesson:08.1": "node scripts/compile.mjs 08.1 --prepare",
    "lesson:08.2": "node scripts/compile.mjs 08.2 --prepare",
    "lesson:08.3": "node scripts/compile.mjs 08.3 --prepare",
    "lesson:09.1": "node scripts/compile.mjs 09.1 --prepare",
    "lesson:09.2": "node scripts/compile.mjs 09.2 --prepare",
    "lesson:09.3": "node scripts/compile.mjs 09.3 --prepare",
    "lesson:10.1": "node scripts/compile.mjs 10.1 --prepare",
    "lesson:10.2": "node scripts/compile.mjs 10.2 --prepare",
    "lesson:10.3": "node scripts/compile.mjs 10.3 --prepare",
    "lesson:10.4": "node scripts/compile.mjs 10.4 --prepare",
    "lesson:11.1": "node scripts/compile.mjs 11.1 --prepare",
    "lesson:11.2": "node scripts/compile.mjs 11.2 --prepare",
    "lesson:11.3": "node scripts/compile.mjs 11.3 --prepare",
    "lesson:11.4": "node scripts/compile.mjs 11.4 --prepare",
    "lesson:11.5": "node scripts/compile.mjs 11.5 --prepare",
    "exercise:02": "node tests/verify-exercise-02.mjs",
    "exercise:04": "node tests/verify-exercise-04.mjs",
    "exercise:05": "node tests/verify-exercise-05.mjs",
    "exercise:06": "node tests/verify-exercise-06.mjs",
    "exercise:07": "node tests/verify-exercise-07.mjs",
    "exercise:08": "node tests/verify-exercise-08.mjs",
    "exercise:09": "node tests/verify-exercise-09.mjs",
    "exercise:10": "node tests/verify-exercise-10.mjs",
    "check:03": "node tests/verify-chapter-03.mjs",
    "check:04": "node tests/verify-chapter-04.mjs",
    "check:05": "node tests/verify-chapter-05.mjs",
    "check:06": "node tests/verify-chapter-06.mjs",
    "check:07": "node tests/verify-chapter-07.mjs",
    "check:08": "node tests/verify-chapter-08.mjs",
    "check:09": "node tests/verify-chapter-09.mjs",
    "check:10": "node tests/verify-chapter-10.mjs && python3 tests/verify-terminal-10.py",
    "check:tutorial": "node tests/verify-tutorial-markers.mjs",
    "check:02.3": "node tests/verify-install.mjs 3",
    "check:02.4": "node tests/verify-install.mjs 4",
    "typecheck": "tsc --noEmit",
    "prepack": "node scripts/compile.mjs 25.3",
    "verify": "npm run typecheck && npm run check:tutorial && node scripts/compile.mjs 25.3 && node tests/verify-install.mjs && node tests/verify-chapter-03.mjs && node tests/verify-chapter-04.mjs && node tests/verify-chapter-05.mjs && node tests/verify-chapter-06.mjs && node tests/verify-exercise-06.mjs && node tests/verify-chapter-07.mjs && node tests/verify-exercise-07.mjs && node tests/verify-chapter-08.mjs && node tests/verify-exercise-08.mjs && node tests/verify-chapter-09.mjs && node tests/verify-exercise-09.mjs && npm run check:10 && node tests/verify-exercise-10.mjs && npm run check:11 && npm run exercise:11 && npm run check:12 && npm run exercise:12 && npm run check:13 && npm run check:14 && npm run check:15 && npm run check:16 && npm run check:17 && npm run check:18 && npm run check:19 && npm run check:20 && npm run check:21 && npm run check:22 && npm run check:23 && npm run check:24 && npm run check:25 && node scripts/compile.mjs 25.3 && node -e \"if (!require('node:fs').existsSync('dist/subagents/runner.js')) throw new Error('默认构建未恢复到 25.3')\"",
    "check:11": "node tests/verify-chapter-11.mjs && python3 tests/verify-terminal-11.py",
    "exercise:11": "node tests/verify-exercise-11.mjs",
    "lesson:12.1": "node scripts/compile.mjs 12.1 --prepare",
    "lesson:12.2": "node scripts/compile.mjs 12.2 --prepare",
    "lesson:12.3": "node scripts/compile.mjs 12.3 --prepare",
    "lesson:12.4": "node scripts/compile.mjs 12.4 --prepare",
    "lesson:12.5": "node scripts/compile.mjs 12.5 --prepare",
    "check:12": "node tests/verify-chapter-12.mjs && python3 tests/verify-terminal-12.py",
    "exercise:12": "node tests/verify-exercise-12.mjs",
    "lesson:13.1": "node scripts/compile.mjs 13.1 --prepare",
    "check:13": "node tests/verify-chapter-13.mjs && node tests/verify-session-records.mjs && node tests/verify-session-resume.mjs && python3 tests/verify-terminal-13.py",
    "lesson:13.2": "node scripts/compile.mjs 13.2 --prepare",
    "lesson:13.3": "node scripts/compile.mjs 13.3 --prepare",
    "lesson:13.4": "node scripts/compile.mjs 13.4 --prepare",
    "lesson:14.1": "node scripts/compile.mjs 14.1 --prepare",
    "lesson:14.2": "node scripts/compile.mjs 14.2 --prepare",
    "lesson:14.3": "node scripts/compile.mjs 14.3 --prepare",
    "lesson:15.1": "node scripts/compile.mjs 15.1 --prepare",
    "lesson:15.2": "node scripts/compile.mjs 15.2 --prepare",
    "lesson:15.3": "node scripts/compile.mjs 15.3 --prepare",
    "check:14": "node tests/verify-chapter-14.mjs && python3 tests/verify-terminal-14.py",
    "check:15": "node tests/verify-chapter-15.mjs && python3 tests/verify-terminal-15.py",
    "lesson:16.1": "node scripts/compile.mjs 16.1 --prepare",
    "lesson:16.2": "node scripts/compile.mjs 16.2 --prepare",
    "lesson:16.3": "node scripts/compile.mjs 16.3 --prepare",
    "check:16": "node tests/verify-chapter-16.mjs && python3 tests/verify-terminal-16.py",
    "lesson:17.1": "node scripts/compile.mjs 17.1 --prepare",
    "lesson:17.2": "node scripts/compile.mjs 17.2 --prepare",
    "lesson:17.3": "node scripts/compile.mjs 17.3 --prepare",
    "check:17": "node tests/verify-chapter-17.mjs && python3 tests/verify-terminal-17.py",
    "lesson:18.1": "node scripts/compile.mjs 18.1 --prepare",
    "lesson:18.2": "node scripts/compile.mjs 18.2 --prepare",
    "lesson:18.3": "node scripts/compile.mjs 18.3 --prepare",
    "check:18": "node tests/verify-chapter-18.mjs && python3 tests/verify-terminal-18.py",
    "lesson:19.1": "node scripts/compile.mjs 19.1 --prepare",
    "lesson:19.2": "node scripts/compile.mjs 19.2 --prepare",
    "lesson:19.3": "node scripts/compile.mjs 19.3 --prepare",
    "check:19": "node tests/verify-chapter-19.mjs && python3 tests/verify-terminal-19.py",
    "lesson:20.1": "node scripts/compile.mjs 20.1 --prepare",
    "lesson:20.2": "node scripts/compile.mjs 20.2 --prepare",
    "lesson:20.3": "node scripts/compile.mjs 20.3 --prepare",
    "check:20": "node tests/verify-chapter-20.mjs && python3 tests/verify-terminal-20.py",
    "lesson:21.1": "node scripts/compile.mjs 21.1 --prepare",
    "lesson:21.2": "node scripts/compile.mjs 21.2 --prepare",
    "lesson:21.3": "node scripts/compile.mjs 21.3 --prepare",
    "check:21": "node tests/verify-chapter-21.mjs && python3 tests/verify-terminal-21.py",
    "lesson:22.1": "node scripts/compile.mjs 22.1 --prepare",
    "lesson:22.2": "node scripts/compile.mjs 22.2 --prepare",
    "lesson:22.3": "node scripts/compile.mjs 22.3 --prepare",
    "check:22": "node tests/verify-chapter-22.mjs && python3 tests/verify-terminal-22.py",
    "lesson:23.1": "node scripts/compile.mjs 23.1 --prepare",
    "lesson:23.2": "node scripts/compile.mjs 23.2 --prepare",
    "lesson:23.3": "node scripts/compile.mjs 23.3 --prepare",
    "check:23": "node tests/verify-chapter-23.mjs && python3 tests/verify-terminal-23.py",
    "lesson:24.1": "node scripts/compile.mjs 24.1 --prepare",
    "lesson:24.2": "node scripts/compile.mjs 24.2 --prepare",
    "lesson:24.3": "node scripts/compile.mjs 24.3 --prepare",
    "check:24": "node tests/verify-chapter-24.mjs && python3 tests/verify-terminal-24.py",
    "lesson:25.1": "node scripts/compile.mjs 25.1 --prepare",
    "lesson:25.2": "node scripts/compile.mjs 25.2 --prepare",
    "lesson:25.3": "node scripts/compile.mjs 25.3 --prepare",
    "check:25": "node tests/verify-chapter-25.mjs && python3 tests/verify-terminal-25.py"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.126.0",
    "@modelcontextprotocol/sdk": "1.32.1",
    "commander": "14.0.3",
    "ignore": "7.0.9",
    "ink": "7.1.1",
    "ink-text-input": "6.0.0",
    "openai": "7.15.0",
    "react": "19.3.0",
    "string-width": "8.2.2",
    "wrap-ansi": "9.0.2",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "22.20.3",
    "@types/react": "19.3.0",
    "typescript": "5.9.3"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sherlockmen/hello-my-agent.git"
  }
}
```

| 字段或操作 | 作用 |
| --- | --- |
| `type: module` | 使用 ESM 的 import / export |
| `bin` | 声明命令名 `hello-my-agent` 对应的入口文件 `dist/cli.js` |
| `files` | 指定将 `dist` 放入安装包；npm 还会包含包清单，以及已有的 README 和许可证 |
| `npm run build` | 按锁文件安装依赖、编译 TypeScript，成功后自动注册本地命令 |
| `npm run lesson:02.N`—`npm run lesson:25.N` | 选择、编译并注册对应小节；命令中不需要 `--` |
| `npm run exercise:02`、`04`、`05`、`06`、`07`、`08`、`09`、`10`、`11`、`12` | 运行对应章的练习验收 |
| `npm run check:03`—`npm run check:22` | 运行对应章的确定性验收 |
| `prepack` | 打包前只编译代码，不改变本地命令的指向 |
| `private: true` | 防止误发布，仍可本地注册、打包和安装 |

`build` 默认选择 25.3，`prepack` 也编译 25.3。小节脚本把编号交给 `scripts/compile.mjs`，按顺序运行 `npm ci`、编译和 `npm link`，成功后显示一行完成提示。安装失败时不会进入后续步骤。

`--include=dev` 确保编译所需的开发依赖也会安装；`--ignore-scripts` 跳过安装和注册时的生命周期脚本，当前依赖不需要这些脚本；`--no-audit` 和 `--no-fund` 省去这两步的审计和资助提示。每次构建都会按锁文件重新安装依赖，不需要手动清理 `node_modules`。

构建需要 `package-lock.json`，包清单与锁文件也必须一致。从空目录跟写时，下一步的 `npm install` 会生成或更新它。打包与验收使用已经安装的依赖，只执行同一份清理与编译脚本，不会切换本机命令。

**首次从空目录跟写时，还要创建 `scripts` 目录，将 [compile.mjs](../scripts/compile.mjs) 保存到 `scripts/compile.mjs`。** 上面的脚本都使用它。它按编号选择入口，只删除本项目的 `dist`，并在系统临时目录生成编译配置；切换章节不会把旧模块带进安装包。

本地学习无需 npm 账号。包名暂用 `@sherlockmen/hello-my-agent`；正式发布时再选择有权限的 scope 和包名。

修改包清单后更新锁文件：

```bash
npm install
```

## 配置 TypeScript 类型检查

根目录创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "types": [
      "node"
    ],
    "jsx": "react-jsx"
  },
  "include": [
    "chapter-*/**/*.ts",
    "chapter-*/**/*.tsx"
  ]
}
```

`include` 指定要检查的 TypeScript 文件；`noEmit` 表示只检查类型，不生成 JavaScript 文件。`NodeNext` 按 Node 的规则处理模块，`strict` 开启严格类型检查，`ES2022` 指定目标 JavaScript 语法版本。

第十章的界面会使用 `<Box>`、`<Text>` 这样的 JSX 写法，带 JSX 的 TypeScript 文件使用 `.tsx` 扩展名，所以检查范围也要包含 `.tsx`。`jsx: "react-jsx"` 告诉 TypeScript 按 React 的自动 JSX 运行时处理这些标签；构建时它们会变成 JavaScript 调用，安装后的命令仍由 Node.js 执行，不需要浏览器。

学习时只需维护这一份 TypeScript 配置。构建脚本根据小节编号补充 `rootDir`、`outDir` 和入口文件，临时配置不会写入仓库。

## 写第一段代码

创建 `chapter-01-first-command/cli.ts`：

```ts
#!/usr/bin/env node
// 第一行让类 Unix 系统找到 Node 执行入口；这里先把欢迎语输出到终端。
console.log("Hello，My Agent！");
```

在项目根目录安装依赖、编译并注册第一章：

```bash
npm run lesson:01
```

构建完成后运行下面的命令观察第一章输出：

```bash
hello-my-agent
```

此时应输出 `Hello，My Agent！`。接着回到[正文的动手构建](../chapter-01-first-command/README.md#动手构建)，完成帮助与版本查询。完成后，在跟写项目根目录检查类型、重新构建，再运行两个选项：

```bash
npm run typecheck
```

```bash
npm run lesson:01
```

```bash
hello-my-agent --help
```

```bash
hello-my-agent --version
```

构建成功后，命令入口会指向当前项目的构建文件。后续修改源码时，重新执行当前章节或小节的构建命令。在同一个 npm 环境中，这会更新同名命令指向的项目。

## 注册命令后如何找到它

构建脚本在编译成功后调用 [`npm link`](https://docs.npmjs.com/cli/v12/commands/npm-link/)，根据包清单的 `bin` 创建命令链接。在 macOS / Linux 上，链接位于 npm 全局前缀下的 `bin` 目录；这里的“全局前缀”就是 npm 存放全局安装内容的根目录。终端按 `PATH` 中的目录顺序查找命令。

检查当前终端找到的命令和 npm 前缀：

```bash
command -v hello-my-agent
```

```bash
npm prefix --global
```

如果第一条没有输出，先确认在包含 package.json 的项目根目录完成了构建与注册；若全局 bin 目录不在 PATH，可在当前终端执行：

```bash
PATH="$(npm prefix --global)/bin:$PATH" hello-my-agent --version
```

这条 PATH 设置只作用于紧随其后的这次命令。若之后仍找不到命令，将对应目录加入当前使用的 shell 配置。切换 Node/npm 环境后，也要核对其全局前缀与 PATH。如果构建时提示注册权限不足，请使用当前用户可写的 npm 环境，再执行当前小节的构建命令。

## 手动打包安装

命令已能在本机使用之后，再检查分发给别人的安装包。仍在项目根目录运行：

```bash
npm run lesson:01
```

```bash
npm pack --ignore-scripts
```

第一条命令保证 `dist` 中保存的是第一章产物。`--ignore-scripts` 让这次检查直接打包该产物，不再执行默认编译 25.3 的 `prepack`；否则从空目录只写到第一章时，npm 会尝试编译尚不存在的第二十五章源码。随后 npm 生成 `sherlockmen-hello-my-agent-0.1.0-dev.1.tgz`。这个文件名对应上面的包名和版本；如果修改了它们，后续命令也要使用实际生成的文件名。安装包包含 `dist/*.js`、`package.json`、`README.md` 和 `LICENSE`。

创建一个临时目录作为安装前缀，把包安装到那里：

```bash
agent_archive="$PWD/sherlockmen-hello-my-agent-0.1.0-dev.1.tgz"
```

```bash
agent_check_dir="$(mktemp -d)"
```

```bash
npm install --global --prefix "$agent_check_dir" --omit=dev --ignore-scripts "$agent_archive"
```

```bash
mkdir "$agent_check_dir/run-here"
```

`--omit=dev` 跳过开发依赖；`--ignore-scripts` 禁止安装脚本运行，避免安装时重新编译、掩盖包内缺少运行文件的问题。当前运行依赖不需要安装脚本。

下面三条命令都会在没有源码的临时目录中启动刚安装的命令。括号创建子 shell，所以目录切换和 `PATH` 修改不会影响当前终端：

```bash
(cd "$agent_check_dir/run-here" && PATH="$agent_check_dir/bin:$PATH" hello-my-agent)
```

```bash
(cd "$agent_check_dir/run-here" && PATH="$agent_check_dir/bin:$PATH" hello-my-agent --help)
```

```bash
(cd "$agent_check_dir/run-here" && PATH="$agent_check_dir/bin:$PATH" hello-my-agent --version)
```

退出括号中的子 shell 后，工作目录和 PATH 恢复；不会替换已有的本地命令链接。临时文件保留在 `$agent_check_dir`，方便继续检查安装结果。

## 启动报错怎么判断

| 现象 | 检查与处理 |
| --- | --- |
| command not found | 在项目根目录执行当前小节的构建命令，并按上节核对 PATH |
| 修改后仍是旧结果 | 重新执行当前小节的构建命令，并核对 PATH 中找到的命令位置 |
| `--prompt` 提示未知选项 | 当前构建的是 02.1；执行 `npm run lesson:02.2` 或更高小节 |
| --doctor 提示未知选项 | 完成第一章练习并执行 `npm run lesson:01` 重新构建 |
| regestry 配置警告 | 检查用户的 `.npmrc`；这是 `registry` 的拼写错误，与 Agent 代码无关 |
| 缺少 Node 或 npm | 安装所需 Node 版本，并重新打开终端检查 |

小节构建命令在项目根目录执行，自动完成依赖安装、构建和注册，但不调用模型。注册完成后，可以从第二章的小节目录运行 `hello-my-agent`；程序从当前目录向上查找 `.env`，在最近的 `package.json` 处停止。若切换 Conda 环境后仍报错，请根据错误检查 Node、npm 配置或命令注册，切换环境本身不会修正这些问题。

## 进入下一小节时怎样继续跟写

从第二章开始，每个小节都有自己的 `src/`。进入新小节时，先创建对应目录，把上一节已经完成的整个 `src/` 复制进去，再按“本节改动文件”和“动手构建”新增或修改。未列出的文件也要保留，因此复制的是整个目录，而不是只复制这次要改的文件。

例如，进入 02.2 时，把 `chapter-02-model-dialogue/01-configuration/src/` 的内容放到 `chapter-02-model-dialogue/02-first-reply/src/`。新目录里直接是 `cli.ts`、`config/` 等文件，不再多套一层 `src/`。之后只修改本节目录中的副本，各节都使用自己的文件，不从上一节导入代码。

完成章末练习后，先看练习页对下一章起点的说明。通常从完成练习后的代码继续；有些扩展可以保留在自己的跟写工程中，但下一章配套源码并未采用，要按该练习的说明衔接。第二章的 `/reset` 已作为第三章的起点，进入第三章前应先完成它。依赖、包清单和 `.env` 仍放在项目根目录，不需要每节再复制一份。使用完整配套仓库时，各节目录已经齐全，无需执行复制步骤。

## 保存与继续

根目录保存 [这份 .gitignore](../.gitignore)，保留源码、包清单、锁文件和 TypeScript 配置；依赖、构建产物、安装包及本地环境文件保持忽略。

继续第二章时执行 `npm run lesson:02.1`；第 03—07 章分别从 `npm run lesson:03.1`、`npm run lesson:04.1`、`npm run lesson:05.1`、`npm run lesson:06.1` 和 `npm run lesson:07.1` 开始。每个小节都提供一条构建命令；需要观察本节行为时，再运行对应的 `hello-my-agent` 示例。

## 第七章需要的系统命令

[第七章](../chapter-07-command-feedback/README.md)使用 macOS / Linux 的 `/bin/sh` 和 POSIX 进程组；Windows 在 WSL 中运行。命令从指定目录开始，但这不限制命令可以访问的文件或网络，执行前仍需查看本次审批。

到 [07.3](../chapter-07-command-feedback/03-ripgrep-search/README.md)再准备系统 `rg`。它不属于 npm 依赖，`npm run lesson:07.3` 不会自动安装。先检查：

```bash
rg --version
```

macOS 使用 Homebrew 且尚未安装时，执行：

```bash
brew install ripgrep
```

Linux / WSL 可按 [ripgrep 官方安装说明](https://github.com/BurntSushi/ripgrep#installation)准备。确认命令可用后，再运行第七章的搜索示例、`npm run check:07` 或完整 `npm run verify`。

第六章的匹配次数练习已经进入第七章代码。第七章的可选 `timeout_ms` 则在[章末练习](../chapter-07-command-feedback/EXERCISES.md)中完成，第八章会从该完成状态继续。
