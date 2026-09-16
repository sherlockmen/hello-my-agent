# Hello, My Agent

**你好，我的 Agent：从 0 到 npm 发布，亲手构建你的 TUI Coding Agent。**

Build Your Own TUI Coding Agent — From Scratch to npm

用 TypeScript 从第一个命令开始，逐章构建自己的 Coding Agent：接通模型、增加工具和权限、制作 TUI、管理会话与上下文、实现扩展与协作，最终发布别人可以安装使用的 npm 包。

**每章讲清一个主要机制，保留完整实现。** 下一章在前章代码上继续增加能力；旧章节保留，方便运行、比较和回看。基础编程能力是先修要求，Agent 知识在书内连续讲解。

源码和练习答案配有中文教学注释：从文件开头的问题与流程，到关键语句的参数、数据变化和设计原因，帮助你边读边构建。后续章节遵守同一份 [注释规范](docs/AUTHORING.md#教学代码注释所有章节必需)。

## 开始学习

[阅读第一章](chapter-01-first-command/README.md) · [查看第一章代码](chapter-01-first-command/cli.ts) · [从空目录跟写](docs/SETUP.md)

已有配套仓库时，首次在仓库根目录（包含 `package.json` 的目录）安装依赖、构建并注册命令：

```bash
npm ci
npm run build
npm link
```

完成后，统一直接使用这个命令：

```bash
hello-my-agent
hello-my-agent --help
hello-my-agent --version
```

`-v` 是 `--version` 的简写，`-h` 是 `--help` 的简写，两种写法效果相同；正文示例统一使用长选项。npm 负责安装依赖、编译和注册命令。准备完成后，运行 Agent 只需输入 `hello-my-agent` 及所需选项。修改源码后，在仓库根目录重新执行 `npm run build`，再运行命令。

本地注册的命令指向当前仓库的构建产物。遇到找不到命令或运行了另一份代码时，按 [环境说明](docs/SETUP.md#注册命令后如何找到它) 检查。

第一章只显示欢迎语、帮助和版本信息，无需 API Key。Node.js 要求 22 或以上；目前已在 Node.js 22.23.2、npm 12.0.2、macOS arm64 验证，其他平台待验证。

## 章节目录

| 章节 | 本章解决的问题 | 实现 |
| --- | --- | --- |
| [第 01 章：从空目录到自己的命令](chapter-01-first-command/README.md) | 怎样把源码变成可安装的命令？ | [cli.ts](chapter-01-first-command/cli.ts)，试写稿 |
| 第 02 章：接通模型并持续对话 | 怎样调用模型并保留多轮消息？ | 待编写 |
| 第 03 章：第一个工具与 Agent Loop | 怎样执行模型请求的工具，再回传结果？ | 待编写 |

完整路线与完成状态见 [六部分、36 章课程进度表](docs/PROGRESS.md)，包含 TUI、子 Agent、Skills、MCP、任务协作与发布。该表按作者的明确通知标记章节完成；[初版大纲](docs/planning/COURSE.md) 保留原规划。后续章节编写后加入阅读目录。

## 仓库结构

```text
hello-my-agent/
  README.md                 全书入口与章节导航
  package.json              统一依赖、构建脚本、npm 命令入口
  package-lock.json         全书依赖锁文件
  tsconfig.json             各章共享的类型检查配置
  tsconfig.build.json       当前可安装版本的编译入口
  chapter-01-first-command/  第 01 章：构建可安装的命令
    README.md               本章中文讲解
    cli.ts                  命令行入口，本章完整实现
    EXERCISES.md             练习思路与运行说明
    cli-with-doctor.ts       加入环境诊断后的完整练习答案
  docs/
    SETUP.md                环境与从空目录搭建
    AUTHORING.md            章节编写规则
    PROGRESS.md             36 章目录、完成状态与完成日期
    planning/               原规划与完整能力清单
    verification/           实际验证记录
  tests/                    全书共用的验收脚本
```

章节目录按 `chapter-编号-主题` 命名，代码文件按职责命名。第一章的 `cli.ts` 负责命令入口，`cli-with-doctor.ts` 展示环境诊断练习的完成状态。每章保留当时的完整实现，依赖在根目录统一管理；早期保持单文件，需要拆分时随正文引入模块。

本书沿自己的 36 章路线，从可安装的命令逐步构建有工具、权限、会话管理和协作能力的 TUI Coding Agent。问题驱动的讲解和逐章可运行的组织方式借鉴了 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)，具体取舍见 [参考记录](docs/REFERENCE-STRUCTURE.md)。

## 运行、练习与安装验证

在仓库根目录运行完整验收：

```bash
npm run verify
```

`verify` 会检查类型、构建、生成 `.tgz` 安装包，并在临时目录安装和验证。只需检查类型时，可以运行 `npm run typecheck`。运行 Agent 时仍然直接输入 `hello-my-agent`。

第一章练习在独立跟写项目中增加 `--doctor`。完成练习、构建并注册对应项目后，用 `hello-my-agent --doctor` 查看环境；正式主线暂不包含这个选项。

[练习完整答案](chapter-01-first-command/EXERCISES.md) · [当前进度](docs/PROGRESS.md) · [验证记录](docs/verification/01-first-command.md)

当前只有第一章试写稿，尚未发布 npm 包。

## 许可证

本仓库原创教程与代码采用 [MIT](LICENSE)。引用外部材料时保留其来源与相应许可要求。
