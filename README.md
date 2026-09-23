# Hello, My Agent

**你好，我的 Agent：从 0 到 npm 发布，亲手构建你的 TUI Coding Agent。**

Build Your Own TUI Coding Agent — From Scratch to npm

我们用 TypeScript 从第一个命令开始，逐章做出自己的 Coding Agent：先接通模型，让它能使用工具，再加入权限、会话、上下文和 TUI，继续实现扩展与协作，最终发布别人可以安装使用的 npm 包。

CLI 是在终端中通过命令和选项操作的程序；TUI 是在终端中持续刷新内容、响应键盘操作的交互界面；Coding Agent 则是在程序控制下调用模型和本地工具来完成编程任务的 Agent。本书先建立 CLI 和 Agent 核心，再逐步增加 TUI。

**每章讲清一个主要机制，并提供可以运行的完整实现。** 本书面向具备 TypeScript 基础、用过 Coding Agent、想弄明白它怎样工作的开发者。我们先从熟悉的使用过程理解问题，再看程序用什么方法解决，最后跟着代码实现并检查结果。每节的解释都放在正文中，不需要先打开源码补课。

## 开始学习

[从第一章开始](chapter-01-first-command/README.md) · [已完成：第六章](chapter-06-precise-edit/README.md) · [待确认：第五章](chapter-05-permission-gate/README.md) · [当前：第七章](chapter-07-command-feedback/README.md) · [课程进度](docs/PROGRESS.md) · [从空目录跟写](docs/SETUP.md)

第一次学习，先阅读[第一章的问题与原理](chapter-01-first-command/README.md)，到“动手构建”时再运行：

```bash
npm run lesson:01
```

```bash
hello-my-agent
```

第一章不需要 API Key。完成第一章及 `--doctor` 练习后，再按 [02.1 配置说明](chapter-02-model-dialogue/01-configuration/README.md#第三步填写第一组配置) 填写根目录 `.env`，进入第二章：

```bash
npm run lesson:02.1
```

每个小节的构建脚本已经包含对应源码的依赖安装、编译与命令注册。进入下一小节时只需更换编号，例如 `npm run lesson:02.2`。六个小节的命令列在[第二章构建表](chapter-02-model-dialogue/README.md#构建并选择每个小节)。02.2 和 02.3 只有带 `--prompt` 提问时才会调用模型；从 02.4 开始，无参数启动的连续会话也会调用模型。`--help`、`--version` 和 `--doctor` 不会调用模型。`-h`、`-v` 分别是帮助和版本的简写。

本地注册的命令指向当前仓库的构建产物。遇到找不到命令或运行了另一份代码时，按 [环境说明](docs/SETUP.md#注册命令后如何找到它) 检查。

Node.js 要求 22 或以上；目前已在 Node.js 22.23.2、npm 12.0.2、macOS arm64 验证，其他平台待验证。需要从空目录一步步建立工程时，按[环境准备](docs/SETUP.md)完成初始化，再回到第一章继续。

## 章节目录

| 章节 | 本章解决的问题 | 实现 |
| --- | --- | --- |
| [第 01 章：从空目录到自己的命令](chapter-01-first-command/README.md) | 怎样把源码变成可安装的命令？ | [cli.ts](chapter-01-first-command/cli.ts)，已确认完成 |
| [第 02 章：接通模型并持续对话](chapter-02-model-dialogue/README.md) | 怎样接通模型并建立 Agent Loop 的无工具路径？ | [六个递进小节](chapter-02-model-dialogue/README.md)，已确认完成 |
| [第 03 章：第一个工具与 Agent Loop](chapter-03-first-tool/README.md) | 怎样执行模型请求的工具，再回传结果？ | [三个递进小节](chapter-03-first-tool/README.md)，已确认完成 |
| [第 04 章：让 Agent 找到代码](chapter-04-code-search/README.md) | 怎样发现文件、定位代码并分段读取？ | [三个递进小节](chapter-04-code-search/README.md)，已确认完成 |
| [第 05 章：工具执行之前，先检查权限](chapter-05-permission-gate/README.md) | 怎样在执行工具前强制区分允许、询问和拒绝？ | [三个递进小节](chapter-05-permission-gate/README.md)，待确认 |
| [第 06 章：让 Agent 先预览，再修改文件](chapter-06-precise-edit/README.md) | 怎样让用户先看清改动，并在文件变化后取消旧修改？ | [三个递进小节](chapter-06-precise-edit/README.md)，已确认完成 |
| [第 07 章：执行测试并读取结果](chapter-07-command-feedback/README.md) | 怎样运行命令、根据测试结果继续修改，并停止卡住的命令或搜索？ | [三个递进小节](chapter-07-command-feedback/README.md)，待确认 |

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
  chapter-04-code-search/    第 04 章：让 Agent 找到代码
    README.md               文件发现、内容搜索与分段读取原理
    EXERCISES.md             搜索结果上限练习与完整答案
    01-file-discovery/       04.1 控制文件搜索范围
    02-content-search/       04.2 把文本目标变成代码位置
    03-chunked-reading/      04.3 把代码位置变成上下文
      src/agent/
        events.ts            核心向终端、日志与后续 TUI 发送的结构化事件
      src/tools/
        types.ts             模型内容与观察元数据的工具结果契约
        workspace.ts        共享项目根和忽略规则
        glob.ts             路径发现
        grep.ts             内容搜索
        read-file.ts        分段读取
      src/ui/
        teaching-trace.ts    把事件转换成安全的中文教学记录
  chapter-05-permission-gate/ 第 05 章：工具执行之前，先检查权限
    README.md               权限决策、审批与会话范围的完整原理
    EXERCISES.md             主动撤销会话授权的练习与答案
    01-policy-decision/      05.1 allow、ask、deny 策略
    02-terminal-approval/    05.2 终端一次审批
    03-session-grants/       05.3 会话范围授权
      src/permissions/
        policy.ts            执行前权限判断与审批契约
  chapter-06-precise-edit/    第 06 章：让 Agent 先预览，再修改文件
    README.md                预览、唯一替换、变化检测与备份原理
    EXERCISES.md             重复匹配计数练习与完整答案
    01-create-with-preview/  06.1 先预览，再创建文件
    02-exact-replacement/    06.2 找到原文，只替换这一处
    03-change-guard/         06.3 保存之前，检查文件有没有变化
      src/tools/
        change-preview.ts   生成安全、完整的差异预览
        write-file.ts       新文件预览与创建
        edit-file.ts        精确替换、变化检测与备份
  chapter-07-command-feedback/ 第 07 章：执行测试并读取结果
    README.md                命令反馈、进程停止与 rg 搜索
    EXERCISES.md              为本次命令选择等待时间
    01-run-command/          07.1 执行测试并读懂结果
    02-process-lifecycle/    07.2 停止卡住或输出过多的命令
    03-ripgrep-search/       07.3 让搜索也使用受控子进程
      src/tools/
        run-command.ts      命令准备、审批与结果转换
        ripgrep.ts          rg 参数和退出状态
      src/processes/
        run-process.ts      输出、时间上限、取消与进程组清理
    demo/                   故意失败的加法函数与测试
  .env.example              模型配置模板，不含真实密钥
  docs/
    SETUP.md                环境与从空目录搭建
    EDITORIAL-WORKFLOW.md   主 Agent、作者子 Agent 与学习者读者的编审流程
    AUTHORING.md            作者子 Agent 的统一教程写作规则
    READER-REVIEW.md        Agent 开发学习者的读懂检查规则
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

`verify` 会检查类型、构建、生成 `.tgz` 安装包，并在临时目录安装和验证。第二章检查 Agent 核心、协议、历史与取消规则；第三章检查工具参数、路径边界、调用 ID、错误反馈、轮次上限和双协议工具消息；第四章检查文件发现、忽略规则、内容搜索、结果上限与分段读取；第五章检查权限优先级、终端审批和会话范围；第六章检查差异预览、唯一替换、写入前复核和备份；第七章检查实际命令反馈、进程停止、取消与 rg 搜索。模型请求使用本地模拟接口，不需要真实密钥；第七章还需要系统中的 `rg`，准备方法见 [07.3](chapter-07-command-feedback/03-ripgrep-search/README.md#先准备系统-rg)。只需检查类型时，可以运行 `npm run typecheck`。运行 Agent 时仍然直接输入 `hello-my-agent`。默认 `build` 和打包入口当前选择第七章完成版 `07.3`；学习时用各节自己的 `lesson` 命令选择版本。

第一章练习增加的 `--doctor` 会从第二章开始保留，用于查看 Node 版本、运行平台和当前工作目录。第二章练习增加的 `/reset` 会从第三章开始保留，用于清空当前会话历史。

完成第二章 `/reset` 练习后，运行 `npm run exercise:02`。这条命令编译读者实际修改的终端文件，并用本地模拟接口检查两种协议中的历史是否真正清空。

[第七章练习](chapter-07-command-feedback/EXERCISES.md) · [当前进度](docs/PROGRESS.md) · [第七章验证记录](docs/verification/07-command-feedback.md)

第一章到第四章及第六章已确认完成；第五章与第七章成果已具备，等待分别确认。npm 包尚未发布。

## 许可证

本仓库原创教程与代码采用 [MIT](LICENSE)。引用外部材料时保留其来源与相应许可要求。
