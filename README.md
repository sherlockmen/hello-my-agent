# Hello, My Agent

**你好，我的 Agent：从 0 到 npm 发布，亲手构建你的 TUI Coding Agent。**

Build Your Own TUI Coding Agent — From Scratch to npm

用 TypeScript 从第一个命令开始，逐章构建自己的 Coding Agent：接通模型、增加工具和权限、管理会话与上下文、制作 TUI、实现扩展与协作，最终发布别人可以安装使用的 npm 包。

**每章讲清一个主要机制，保留完整实现。** 下一章在前章代码上继续增加能力；旧章节保留，方便运行、比较和回看。基础编程能力是先修要求，Agent 知识在书内连续讲解。

源码和练习答案配有中文教学注释：从文件开头的问题与流程，到关键语句的参数、数据变化和设计原因，帮助你边读边构建。后续章节遵守同一份 [注释规范](docs/AUTHORING.md#教学代码注释所有章节必需)。

## 开始学习

[阅读第一章](chapter-01-first-command/README.md) · [查看第一章代码](chapter-01-first-command/cli.ts) · [从空目录跟写](docs/SETUP.md)

在仓库根目录安装一次依赖，然后选择章节运行：

```bash
npm ci
npm run chapter:01
npm run chapter:01 -- --help
npm run chapter:01 -- --version
```

`npm run` 后面填写 `package.json` 中的脚本名：这里的 `chapter:01` 会启动 `chapter-01-first-command/cli.ts`。文件名 `cli.ts` 不是脚本名；早期的 `s01` 命令已改为 `chapter:01`。单独执行 `npm run` 可以查看当前可用脚本。

第一章只显示欢迎语、帮助和版本信息，无需 API Key。Node.js 要求 22 或以上；目前已在 Node.js 22.23.2、npm 12.0.2、macOS arm64 验证，其他平台待验证。

## 章节目录

| 章节 | 本章解决的问题 | 实现 |
| --- | --- | --- |
| [第 01 章：自己的命令](chapter-01-first-command/README.md) | 怎样把源码变成可安装的命令？ | [cli.ts](chapter-01-first-command/cli.ts)，试写稿 |
| 第 02 章：模型与对话 | 怎样调用模型并保留多轮消息？ | 待编写 |
| 第 03 章：工具与循环 | 怎样执行模型请求的工具，再回传结果？ | 待编写 |

完整路线为 [六部分、36 章](docs/planning/COURSE.md)，包含 TUI、子 Agent、Skills、MCP、任务协作与发布。后续章节完成时加入目录。

## 仓库结构

```text
hello-my-agent/
  README.md                 全书入口与章节导航
  package.json              统一依赖、章节运行命令、npm 包信息
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
    planning/               原规划与完整能力清单
    verification/           实际验证记录
  tests/                    全书共用的验收脚本
```

章节目录按 `chapter-编号-主题` 命名，代码文件按职责命名。第一章的 `cli.ts` 负责命令入口，`cli-with-doctor.ts` 展示环境诊断练习的完成状态。每章保留当时的完整实现，依赖在根目录统一管理；早期保持单文件，需要拆分时随正文引入模块。

本书沿自己的 36 章路线，从可安装的命令逐步构建有工具、权限、会话管理和协作能力的 TUI Coding Agent。问题驱动的讲解和逐章可运行的组织方式借鉴了 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)，具体取舍见 [参考记录](docs/REFERENCE-STRUCTURE.md)。

## 运行、练习与安装验证

以下命令都在根目录执行：

```bash
npm run exercise:01 -- --doctor
npm run typecheck
npm run build
npm start -- --version
npm run verify
```

`build` 当前编译第一章，得到 `dist/cli.js`；`verify` 生成真实 tarball，在临时位置安装并离开源码目录运行，最后清理临时文件。实际发布前会把编译入口推进到最终整合章节。

[练习完整答案](chapter-01-first-command/EXERCISES.md) · [当前进度](docs/PROGRESS.md) · [验证记录](docs/verification/01-first-command.md)

当前只有第一章试写稿，尚未发布 npm 包。

## 许可证

本仓库原创教程与代码采用 [MIT](LICENSE)。引用外部材料时保留其来源与相应许可要求。
