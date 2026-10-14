# 能力覆盖、参考依据与验收

版本：v0.1，2026-09-16。所有“本书目标”都是待实现的验收要求，不是已完成能力。下表不用于计算“完成大厂能力的百分之几”。

## 能力与章节对应

| 能力 | 本书目标与深度 | 对应章节 | 公开参考 |
| --- | --- | --- | --- |
| 编码主循环 | 自己实现消息、调用、执行、反馈、停止，完成读改测 | 02—08 | [Claude Code 主循环说明](https://code.claude.com/docs/en/how-claude-code-works) |
| 文件和命令工具 | 检索、分段读取、精确修改、diff、shell、退出码 | 03—07 | [OpenCode 工具](https://opencode.ai/docs/tools/) |
| 权限与用户干预 | allow/ask/deny、执行前检查、Plan 模式、审批/提问/取消 | 05、08、11—12 | [OpenCode 权限](https://opencode.ai/docs/permissions/) |
| TUI 与非交互模式 | 一个核心的两种入口，输入、进度、审批、命令与 JSON 结果 | 01、09—12 | [Gemini CLI 架构](https://google-gemini.github.io/gemini-cli/docs/architecture.html) |
| 会话与文件恢复 | 持久化、继续、分支、有限撤销、格式版本 | 13—14 | [Claude Code 检查点](https://code.claude.com/docs/en/checkpointing) |
| 上下文治理 | 预算、工具输出裁剪、自动压缩、关键约束保留 | 15—16 | [OpenCode 压缩源码](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/compaction.ts) |
| 项目规则与长期记忆 | 作用范围、来源、查看和更正，跨会话读取 | 17—18 | [Claude Code 记忆](https://code.claude.com/docs/en/memory) |
| Skills | 发现、元信息、按需加载、手动使用、相对资源 | 19 | [Claude Code Skills](https://code.claude.com/docs/en/skills) |
| Hooks | 事件触发、阻止、超时、返回结果、异常隔离 | 20 | [Claude Code Hooks](https://code.claude.com/docs/en/hooks) |
| MCP | 本地和远端工具接入，命名、认证、断线与生命周期 | 21 | [OpenCode MCP](https://opencode.ai/docs/mcp-servers/) |
| 网页与附件 | 可追溯资料获取、搜索接入、图像能力检测 | 22、24 | [OpenCode 工具](https://opencode.ai/docs/tools/)，图像协议以正式选择的 SDK 文档和模型实测补证 |
| 多模型 | 至少两种 API 协议经过工具调用和流式验证 | 23 | [OpenCode Providers](https://opencode.ai/docs/providers/)；本书不照搬其供应商数量 |
| 子 Agent | 独立会话、工具范围、权限、状态、结果和恢复 | 25—27 | [OpenCode TaskTool](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/task.ts) |
| 并行写入 | 需要时隔离工作树，保留成果，检查后整合并处理冲突 | 28 | [Claude Code 子 Agent isolation](https://code.claude.com/docs/en/sub-agents) |
| 团队协作 | 有限数量工作者、共享任务、依赖、认领与消息 | 29 | [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)；具体租约设计是本书方案，不声称复刻内部实现 |
| 后台与定时 | 可查询、可停止、可恢复的任务元数据和明确运行时约束 | 26—27、30 | [Claude Code 调度](https://code.claude.com/docs/en/scheduled-tasks) |
| 扩展包 | 安装和组合已有扩展，命名与兼容性管理 | 31 | [OpenCode 插件](https://opencode.ai/docs/plugins/) |
| 代码诊断 | 测试/类型检查加一条语言服务接入，失败时可降级 | 07、32 | [OpenCode LSP](https://opencode.ai/docs/lsp/) |
| 系统隔离 | 使用现成运行时，验证文件和网络边界，诊断缺依赖 | 33 | [Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime) |
| 可靠性与交付 | 错误分类、日志、预算、离线/真实评测、安装发布升级 | 全程及 34—36 | [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/)、[可信发布](https://docs.npmjs.com/trusted-publishers/)；具体故障验收由本书设计 |

## 端到端验收任务

每个任务使用独立练习仓库副本，保存起始状态、模型配置、输入、工具日志、变更和验证结果。

| 编号 | 用户要完成的事情 | 判定依据 |
| --- | --- | --- |
| E01 | 解释工单筛选的实现 | 引用真实文件位置，说明调用关系，未修改文件 |
| E02 | 修复已给定的筛选 bug | 目标测试和原回归通过；检查 diff 满足需求 |
| E03 | 增加工单标签功能 | 跨文件改动正确，新增测试与已有测试通过 |
| E04 | 先制定计划，再由用户决定执行 | Plan 阶段写入尝试被执行层阻止；批准后才修改 |
| E05 | 拒绝修改并补充新要求 | 被拒操作无副作用；后续方案使用新要求 |
| E06 | 中止生成或卡住的命令 | 请求结束、相关进程清理、TUI 可继续交互；状态准确 |
| E07 | 崩溃后恢复正在处理的任务 | 记录可读；已完成操作不重放；不确定操作被明确标记 |
| E08 | 尝试新方案后撤销文件修改 | 检查点内变更可恢复；用户后续修改不会被静默抹除 |
| E09 | 在大日志与长会话中继续修复 | 有界输出和压缩起作用，关键约束与工具消息配对保留 |
| E10 | 新会话遵守项目规则与已保存知识 | 能追溯加载来源；失效记忆可以修正；无越权 |
| E11 | 调用评审 Skill 和格式化 Hook | 按需加载正文，钩子结果可见，失败或超时不挂死 |
| E12 | 查询 MCP 提供的知识资料 | 工具发现、权限与结果正常；断线有可诊断错误 |
| E13 | 根据在线文档或截图修正问题 | 正文来源可追溯；附件能力与模型匹配；不能声称未做过的检索 |
| E14 | 更换第二种模型协议完成同一任务 | 工具参数和结果配对正确，流式与取消均工作 |
| E15 | 委派探索、实现、审查子任务 | 独立上下文、状态与来源可见；主任务核验实际结果 |
| E16 | 并行改两个相关模块 | 工作区状态明确；可以整合或明确报告冲突；不丢失任何任务成果 |
| E17 | 工作者失败后继续团队任务 | 任务认领和消息不重复；失败工作可重新分配或终止 |
| E18 | 后台执行验证或定时检查 | UI 不阻塞，完成有通知，取消有效，不重叠无限运行 |
| E19 | 安装扩展并获得诊断能力 | 扩展冲突和语言服务失败可诊断；已有核心能力继续可用 |
| E20 | 限制命令的文件和网络访问 | 用实际越界尝试证明边界；不可用时不会假装成功隔离 |
| E21 | 通过 npm 安装并升级 | 无源码仓库也能运行；帮助、版本、配置、会话迁移、读改测均验证 |

## 两类验证不能混用

**工程行为测试**：模拟模型响应、工具失败、超时、断线和重启，验证状态、权限、副作用和资源清理。要求可重复；模型不参与决定期望结果。

**真实模型评测**：使用相同任务、起始版本和验收标准，记录成功率、失败原因、耗时与 token 用量。公开配置和尝试次数；不删除失败记录，不仅展示精选成功案例。性能或成本比较必须在同等任务完成条件下进行。

每项能力状态按“尚未实现 / 可运行 / 失败场景已验证 / 真实任务已验证”标记。书中只有通过对应证据的能力才描述为已完成。

## 关键不变量

- 工具参数完整且校验通过之后才执行；不从尚未完成的流式 JSON 中提前执行。
- 权限在执行前生效，覆盖内置工具、MCP 和子 Agent；模型说明不能覆盖执行规则。
- 恢复消息不会自动重放有副作用的工具；中断于外部副作用和日志写入之间时，不承诺严格 exactly-once。
- 取消是一条可追踪的控制路径，要清理请求、进程、监听器和需要终止的子任务。
- 大输出、上下文、并发数量、任务深度与重复重试均有边界。
- 工作区隔离、文件撤销和系统沙箱有各自适用范围；失败不静默降级。
- 摘要和记忆有来源与可纠正机制；系统只把已实际执行的验证当作证据。
- 正式安装包必须经过测试，不能只证明开发目录能运行。
