# Hello, My Agent

**你好，我的 Agent：从 0 到 npm 发布，亲手构建你的 TUI Coding Agent。**

Build Your Own TUI Coding Agent — From Scratch to npm

用 TypeScript 从第一个命令开始，逐章构建自己的 Coding Agent：接通模型、增加工具和权限、制作 TUI、管理会话与上下文、实现扩展与协作，最终发布别人可以安装使用的 npm 包。

CLI 是在终端中通过命令和选项操作的程序；TUI 是在终端中持续刷新内容、响应键盘操作的交互界面；Coding Agent 则是在程序控制下调用模型和本地工具来完成编程任务的 Agent。本书先建立 CLI 和 Agent 核心，再逐步增加 TUI。

**每章讲清一个主要机制，并提供可以运行的完整实现。** 你会先理解问题和执行流程，再修改代码、运行命令并检查结果。基础编程能力是先修要求，Agent 知识会在书中按顺序讲解。

## 开始学习

[从第一章开始](chapter-01-first-command/README.md) · [已完成：第二章](chapter-02-model-dialogue/README.md) · [继续第三章](chapter-03-first-tool/README.md) · [从空目录跟写](docs/SETUP.md)

第一次学习时先构建第一章：

```bash
npm run lesson:01
hello-my-agent
```

第一章不需要 API Key。完成第一章及 `--doctor` 练习后，再按 [02.1 配置说明](chapter-02-model-dialogue/01-configuration/README.md#填写第一组配置) 填写根目录 `.env`，进入第二章：

```bash
npm run lesson:02.1
```

每个小节的构建脚本已经包含对应源码的依赖安装、编译与命令注册。进入下一小节时只需更换编号，例如 `npm run lesson:02.2`。六个小节的命令列在[第二章构建表](chapter-02-model-dialogue/README.md#构建并选择每个小节)。02.2 和 02.3 只有带 `--prompt` 提问时才会调用模型；从 02.4 开始，无参数启动的连续会话也会调用模型。`--help`、`--version` 和 `--doctor` 不会调用模型。`-h`、`-v` 分别是帮助和版本的简写。

本地注册的命令指向当前仓库的构建产物。遇到找不到命令或运行了另一份代码时，按 [环境说明](docs/SETUP.md#注册命令后如何找到它) 检查。

第一章无需 API Key；02.1 只验证配置，不请求模型，02.2 才开始单次请求，02.4 开始连续会话，02.5 接入 Anthropic。帮助与版本始终无需密钥。Node.js 要求 22 或以上；目前已在 Node.js 22.23.2、npm 12.0.2、macOS arm64 验证，其他平台待验证。

## 章节目录

| 章节 | 本章解决的问题 | 实现 |
| --- | --- | --- |
| [第 01 章：从空目录到自己的命令](chapter-01-first-command/README.md) | 怎样把源码变成可安装的命令？ | [cli.ts](chapter-01-first-command/cli.ts)，已确认完成 |
| [第 02 章：接通模型并持续对话](chapter-02-model-dialogue/README.md) | 怎样接通模型并建立 Agent Loop 的无工具路径？ | [六个递进小节](chapter-02-model-dialogue/README.md)，已确认完成 |
| [第 03 章：第一个工具与 Agent Loop](chapter-03-first-tool/README.md) | 怎样执行模型请求的工具，再回传结果？ | [三个递进小节](chapter-03-first-tool/README.md)，待确认完成 |

完整路线与完成状态见 [六部分、36 章课程进度表](docs/PROGRESS.md)，包含 TUI、子 Agent、Skills、MCP、任务协作与发布。

## 仓库结构

```text
hello-my-agent/
  README.md                 全书入口与章节导航
  package.json              统一依赖、构建脚本、npm 命令入口
  package-lock.json         全书依赖锁文件
  tsconfig.json             各章共享的类型检查配置
  scripts/compile.mjs       按小节编号选择、编译并注册源码
  chapter-01-first-command/  第 01 章：构建可安装的命令
    README.md               本章中文讲解
    cli.ts                  命令行入口，本章完整实现
    EXERCISES.md             练习思路与运行说明
    cli-with-doctor.ts       加入环境诊断后的完整练习答案
  chapter-02-model-dialogue/ 第 02 章：六个递进小节
    README.md               按顺序学习的导航
    EXERCISES.md             本章练习与完整替换代码
    01-configuration/       02.1 配置，从两个源码文件开始
      README.md             本节讲解与运行步骤
      src/
        cli.ts              命令入口
        config/
          load-config.ts    配置读取
    02-first-reply/         02.2 第一次模型请求
    03-agent-loop/          02.3 一轮 Agent 执行的核心
    04-conversation/        02.4 连续输入与历史
    05-anthropic/           02.5 增加第二种协议
    06-errors-and-usage/    02.6 错误分类与用量
      README.md
      src/
        cli.ts              装配模块与启动
        config/             配置读取
        agent/              Agent Loop 核心
        models/             模型接口与协议转换
        ui/                 终端输入和显示，后续扩展 TUI
        errors.ts           共用错误类型与提示
  chapter-03-first-tool/     第 03 章：第一个工具与 Agent Loop
    README.md               工具循环的完整原理与章节导航
    EXERCISES.md             多工具请求练习与完整答案
    01-tool-request/         03.1 工具定义与请求归一化
    02-read-file-loop/       03.2 读取文件并回传结果
    03-error-boundary/       03.3 把工具失败反馈给模型
      src/
        agent/              有界 Agent Loop
        tools/              read_file 与本地注册表
        models/             双协议工具消息转换
  .env.example              模型配置模板，不含真实密钥
  docs/
    SETUP.md                环境与从空目录搭建
    AUTHORING.md            章节编写规则
    PROGRESS.md             36 章目录、完成状态与完成日期
    planning/               原规划与完整能力清单
    verification/           实际验证记录
  tests/                    全书共用的验收脚本
```

章节目录按 `chapter-编号-主题` 命名，代码文件按职责命名。第一章的 `cli.ts` 负责命令入口，`cli-with-doctor.ts` 展示环境诊断练习的完成状态。每章保留当时的完整实现，依赖在根目录统一管理。从第二章开始，每个小节的源码放进独立的 `src/`，按配置、Agent 核心、模型接入和终端交互分目录，仍可独立运行。目录随功能逐步出现，练习放在章目录；后续工具、权限和会话能力也各归其模块。具体分工见 [第二章执行链](chapter-02-model-dialogue/README.md#六个小节怎样组成一条执行链)。

## 运行、练习与安装验证

在仓库根目录运行完整验收：

```bash
npm run verify
```

`verify` 会检查类型、构建、生成 `.tgz` 安装包，并在临时目录安装和验证。第二章检查 Agent 核心、协议、历史与取消规则；第三章检查工具参数、路径边界、调用 ID、错误反馈、轮次上限和双协议工具消息。这些检查使用本地模拟接口，不需要真实密钥。只需检查类型时，可以运行 `npm run typecheck`。运行 Agent 时仍然直接输入 `hello-my-agent`。

第一章练习增加的 `--doctor` 会从第二章开始保留，用于查看 Node 版本、运行平台和当前工作目录。第二章练习增加的 `/reset` 会从第三章开始保留，用于清空当前会话历史。

完成第二章 `/reset` 练习后，运行 `npm run exercise:02`。这条命令编译读者实际修改的终端文件，并用本地模拟接口检查两种协议中的历史是否真正清空。

[第三章练习](chapter-03-first-tool/EXERCISES.md) · [当前进度](docs/PROGRESS.md) · [第三章验证记录](docs/verification/03-first-tool.md)

第一章和第二章已确认完成；第三章正文、代码和本地验收已经具备，等待你的完成确认。npm 包尚未发布。

## 许可证

本仓库原创教程与代码采用 [MIT](LICENSE)。引用外部材料时保留其来源与相应许可要求。
