# 第 33 章：接入真实执行隔离

[上一章：代码检查与语言服务](/content/chapter-32-code-intelligence/README.md) · [课程进度](/content/docs/PROGRESS.md) · [练习与完整答案](/content/chapter-33-execution-sandbox/EXERCISES.md)

前面的 Agent 会展示 shell 命令，等待用户批准，再启动进程。工作目录也会检查真实路径。不过，命令一旦启动，`printf x > ../outside.txt` 仍然能离开当前目录。审批回答了“是否执行这次请求”，目录检查回答了“从哪里开始执行”；现在还需要让操作系统限制进程实际能做什么。

本章接入 Anthropic Sandbox Runtime，把前台命令、项目检查和后台命令放进同一套文件与网络规则。我们使用自己创建的临时文件和假密钥做越界实验：先确认宿主进程能访问，再确认沙箱命令被拒绝。最后加入一个不需要模型密钥的诊断入口，区分依赖已找到、规则已生成和限制已经实验验证。

| 小节 | 我们要得到什么 | 关键判断 |
| --- | --- | --- |
| [33.1 让命令真正进入沙箱](/content/chapter-33-execution-sandbox/01-sandbox-runtime/README.md) | 前台命令与项目检查受系统规则约束 | 先生成真实隔离命令，失败时不启动原命令 |
| [33.2 把隔离接到审批、工作区与后台任务](/content/chapter-33-execution-sandbox/02-connect-execution/README.md) | pipe 与 PTY 后台命令使用相同规则 | 批准后包装，原始命令供预览，包装结果供启动 |
| [33.3 诊断隔离状态并验证不同通道](/content/chapter-33-execution-sandbox/03-diagnose-boundaries/README.md) | 查看依赖与边界，运行真实自检 | 宿主对照成功、沙箱越界失败、目标副作用未发生 |

本章锁定 `@anthropic-ai/sandbox-runtime@0.0.79`，需要 Node.js 22.12 或更新版本。macOS 使用系统 `sandbox-exec`；Linux 使用运行时要求的 bubblewrap、socat 等依赖，缺少依赖就明确失败。本章配套验收在 macOS 上运行。运行时仍在演进，升级版本后需要重新执行边界实验。

隔离范围是本章接入的 shell 执行通道。模型请求、内置文件工具、语言服务器、Hooks 和 MCP 各有自己的执行位置与授权方式，不能因为 shell 被隔离就宣称整个 Agent 都在沙箱里。三个小节保留独立、累计的 TypeScript 快照，完整继承第 32 章的项目检查与语言服务。
