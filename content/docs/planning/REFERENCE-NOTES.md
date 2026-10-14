# 参考研究：Agent 能力与教学依据

核对日期：2026-09-16。范围：官方公开文档与 OpenCode / Gemini CLI 公开代码；本次未进行运行测试。以下区分已观察到的产品行为与本书的教学方案。能力对照见 [CAPABILITIES.md](/content/docs/planning/CAPABILITIES.md)，连续章序见 [COURSE.md](/content/docs/planning/COURSE.md)。

## 当前核对的源码版本

- OpenCode `dev`：`e03db9bc6908f75c9334d8aa997deeaac81c0298`。已读取该 commit 的 [task.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/task.ts)、[compaction.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/compaction.ts) 和 [edit.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/edit.ts)。分析摘取子任务与压缩机制，不宣称完整审计整个仓库。
- Gemini CLI `main`：`6a466a7e2fe2b1255752c1e74f69b31f0216084d`。已读取该 commit 的 [CLI package.json](https://github.com/google-gemini/gemini-cli/blob/6a466a7e2fe2b1255752c1e74f69b31f0216084d/packages/cli/package.json)，并核对官方架构页面；此 commit 的 `docs/architecture.md` 获取失败，未据此声称读过固定版本架构文件。
- 官方网页为核对日可见内容，未来会变化。正式章节须记录所据文档日期及本书自己的代码标签。

## 能力研究补充

### 主循环、工具与终端交互

Claude Code [工作原理](https://code.claude.com/docs/en/how-claude-code-works)描述获取上下文、执行和验证的循环，以及文件、搜索、执行和网络等工具类别。本书将“验证”落到实际退出码、测试与变更证据，不能只依靠最终回复。

Gemini CLI [架构说明](https://google-gemini.github.io/gemini-cli/docs/architecture.html)区分 CLI、core 和 tools；已读取的包依赖含 React 与 Ink 分支。本书借鉴职责划分，实际采用的 Ink 版本在试写后锁定，不直接复制其依赖版本或整个架构。

### 工具与权限

OpenCode [工具文档](https://opencode.ai/docs/tools/)列出文件读取、搜索、精确编辑、命令、任务清单、提问和网络工具。[权限文档](https://opencode.ai/docs/permissions/)提供允许、询问和拒绝等决策。本书使用统一执行入口，让审批覆盖内置与扩展工具；具体保护规则由本书测试约束。

### 上下文压缩

OpenCode 固定 commit 的 compaction.ts 同时含旧工具结果裁剪、近期消息保留预算和摘要处理。本书借鉴分层处理，自己编写直白实现，不沿用源码中的 Effect 框架、默认阈值或全部运行层次。

### 项目说明、记忆、Skills 与 Hooks

Claude Code [记忆文档](https://code.claude.com/docs/en/memory)区分用户编写的项目说明和系统记录的经验，并提供查看修改入口。[Skills 文档](https://code.claude.com/docs/en/skills)描述元信息发现和内容按需使用。[Hooks 文档](https://code.claude.com/docs/en/hooks)定义生命周期触发。由此在本书中分别安排章节，避免把提示内容、经验记录和强制执行规则混在一起。

### MCP、插件与语言服务

OpenCode [MCP 文档](https://opencode.ai/docs/mcp-servers/)覆盖本地和远端服务、认证与工具配置；[插件文档](https://opencode.ai/docs/plugins/)说明扩展模块和生命周期；[LSP 文档](https://opencode.ai/docs/lsp/)说明诊断接入及语言服务成本。本书在完成内置能力后引入这些连接层，并提供服务不可用时的明确处理。

### 文件检查点与系统隔离

Claude Code [检查点文档](https://code.claude.com/docs/en/checkpointing)明确说明 Bash 命令造成的文件改变不在常规撤销范围。本书同样要按实际可追踪的写入界定撤销能力。

[sandbox-runtime](https://github.com/anthropics/sandbox-runtime)提供文件和网络隔离，运行方式和依赖随系统不同；本次读取的 README 将原生 Windows 支持标为 alpha。本书把它作为集成候选，并将 WSL2 纳入 Windows 的隔离教学路线；最终支持矩阵须用实际运行证明。

### 调度、模型与发布

Claude Code [定时任务文档](https://code.claude.com/docs/en/scheduled-tasks)可用于区分当前运行进程中的调度与持续后台服务。本书明确进程退出和错过触发的处理，不暗示关闭终端后仍会自动工作。

OpenCode [Providers 文档](https://opencode.ai/docs/providers/)可作为多供应商接入参考。本次 DeepSeek 工具调用页面两次获取失败，未验证具体模型或 API 行为；本书的首个模型、第二种协议和图像能力，须在试写中根据官方 SDK 与真实请求确认。

npm [pack 文档](https://docs.npmjs.com/cli/v11/commands/npm-pack/)和[可信发布文档](https://docs.npmjs.com/trusted-publishers/)分别作为实际安装产物和 CI 发布的依据；首次包创建、账号配置和正式发布均待执行，当前没有发布任何包。

## 子 Agent 专项研究

### Claude Code：子 Agent 上下文与工作区分别配置

官方说明子 Agent 有独立上下文、提示词、工具权限；默认从主会话当前工作目录开始，可通过 `isolation: worktree` 使用独立工作树。因此，“独立上下文”不能推导为“默认独立代码副本”。

来源：[Create custom subagents](https://code.claude.com/docs/en/sub-agents)。这支持公开行为的判断，不代表拿到了完整内部源码。

### Claude Code Agent Teams：并行写同一文件仍会产生冲突

官方文档区分子 Agent 与有共享任务表、直接沟通能力的 Agent Teams，并建议把文件责任分开以避免覆盖。不能将团队协调或 worktree 视为自动解决一切合并冲突。

来源：[Agent Teams](https://code.claude.com/docs/en/agent-teams)。

### Codex：委派、跟进、等待与结束构成生命周期

官方文档介绍子 Agent 的创建、后续指令、等待结果和结束线程，以及子 Agent 继承父任务权限的行为；建议先用于可独立开展的探索等工作，并注意并行写入的冲突和协调成本。本次所读页面没有给出所有子 Agent 默认使用独立 worktree 的证据。

来源：[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。

### OpenCode：可直接参考的 TaskTool 执行链

当前 `task.ts` 中可见：检查委派权限和嵌套深度，解析子 Agent 配置，创建或恢复带 parentID 的子会话，设置子会话权限，执行 prompt，处理完成、错误、取消并回传结果。前台执行注册取消事件，并在清理阶段移除监听。后台子 Agent 在此开发版本受实验开关控制。

来源：[TaskTool 源码](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts)、[Agents 文档](https://opencode.ai/docs/agents/)。链接指向可变开发分支，编写正式章节前应锁定参考 commit 与本书依赖。

## 本书采用的教学方案

由助手根据已确认目标与上述证据制定，不声称是所有厂商统一实现。

1. 用一个委派工具调用已有 Agent 循环，创建独立消息记录，完成第一次子任务和结果回传。
2. 为子任务增加可用工具、权限、深度与资源限制。
3. 处理完成、失败、取消及恢复，明确前台和后台任务的生命周期差别。
4. 展示多个独立子任务并行执行，TUI 能查看状态，主 Agent 能收集结果。
5. 对并行修改代码的场景加入 Git worktree 隔离，检查并整合结果，显式处理冲突和未完成任务。

每一步复用前面的主循环、工具、权限、会话和 TUI 能力。worktree 是工作树隔离机制，不等于系统安全沙箱。

## 纳入教程的故障案例

- 一个子任务失败，其他子任务仍在执行：状态和结果如何表示。
- 用户取消父任务：哪些子任务必须停止，取消如何传播。
- 子 Agent 试图执行超出权限的操作：执行前拒绝，并回传可理解的结果。
- 主会话不能把子 Agent 的口头“完成”当作测试已通过：检查修改和实际验证结果。
- 两个独立工作树产生冲突：保留工作成果，明确展示冲突，避免静默覆盖。

## 后续研究规范

各模块记录参考来源、核对日期、正式写作时锁定的版本、教学改写理由及验证方式。可以借鉴多家机制，但在本项目统一实现；沿用代码时记录来源并保留对应许可要求。闭源实现只描述可验证的公开行为。
