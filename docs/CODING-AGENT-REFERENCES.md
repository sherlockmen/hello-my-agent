# Claude Code、Gemini CLI 与课程大纲的能力核对

核对日期：2026-09-16。比较对象是 [36 章课程大纲](planning/COURSE.md) 和 [能力与验收清单](planning/CAPABILITIES.md)。这里只核对官方公开文档中的产品行为；没有运行厂商产品、真实模型或生产服务，也不推测闭源内部实现。

**“已覆盖”表示课程已经提出相应教学目标，不表示代码已经实现。** 当前仅第一章完成试写。以下“建议”是对本课程的设计判断，与厂商事实分开；本文件不直接变更章数。

## 结论

现有大纲的 Agent Loop、读改测、审批取消、会话恢复、上下文压缩、Skills/Hooks/MCP、子 Agent、worktree、团队协作、沙箱及评测等主干已经明确。本文件保留厂商机制与来源；按作者明确的 **CLI + TUI Agent** 边界，当前优先级以 [修订后的缺口复核](CODING-AGENT-GAP-REVIEW.md)为准，重点是终端交互、任务干预和本地运行。下表中的浏览器和远端 PR/CI 属于扩展示例，本地代码评审与非交互协议仍属主线。工具发现与缓存效率、项目加载信任、故障停止策略需要从概念扩展成可验收行为。

## 缺失或需要加深的机制

| 机制与判断 | 官方公开事实及来源 | 当前落点 | 建议补充与验收场景 |
| --- | --- | --- | --- |
| **Git、代码评审到 PR/CI 交付：缺少完整闭环** | Claude Code 的常见工作流包含创建 PR；官方 GitHub Action 能处理 issue、推送提交、创建 PR，并运行评审工作流。[PR 工作流](https://code.claude.com/docs/en/common-workflows#create-pull-requests)、[GitHub Actions](https://code.claude.com/docs/en/github-actions) | 06 有 diff；19 有评审 Skill；25 有只读审查角色；28 有 worktree 与整合；36 的 CI 主要服务本产品发布。尚无一个明确的“完成业务代码改动并交付 PR”验收。 | 增加明确的 Git 工作流：记录起点和用户已有改动，确定评审 base/head，区分 staged/unstaged，按文件选取提交，生成有证据的评审发现，关联测试结果、commit、PR 与 CI。验收：练习仓库预放一处用户未提交改动，Agent 修复另一处 bug；评审给出真实文件位置，提交不夹带用户改动；CI 失败后读取结果并修复，不把“PR 已创建”当成成功。外部写入依用户授权执行，自动合并不是完成标准。 |
| **浏览器操作与运行时验证：缺失** | Claude Code 的 Chrome 集成能操作页面、读取 DOM 与控制台、测试本地应用交互。[Chrome 集成](https://code.claude.com/docs/en/chrome) | 22 的 Web Fetch/搜索是读资料，24 是理解输入截图；E13 并不要求启动应用并实际操作页面。 | 在 MCP、附件、后台进程之后接入一条浏览器工具通路，复用成熟运行时即可。验收：启动隔离练习应用，填写无效表单，读取页面错误和控制台，修改后重走同一流程；保留动作、断言、截图与运行版本；结束时清理本任务浏览器和服务。截图看起来正常不等于交互通过。 |
| **非交互模式的完整协议：部分覆盖，需加深** | Gemini CLI 提供 JSON/JSONL 输出、工具事件、最终结果及不同退出码；其权限引擎在非交互模式把 `ask_user` 当作拒绝。[Headless](https://geminicli.com/docs/cli/headless/)、[Policy engine](https://geminicli.com/docs/reference/policy-engine/)；Claude Code 还公开 schema 输出和程序化调用。[Programmatic usage](https://code.claude.com/docs/en/headless) | CAPABILITIES 已写“命令与 JSON 结果”，09 有事件，10 要求非交互等价，故不能说完全没规划。COURSE 尚未定义流格式、无人审批及退出契约。 | 明确 stdin、参数、stdout/stderr 分工，事件版本、唯一最终结果、成功/失败/预算耗尽/取消状态、无终端时的授权策略，以及 schema 校验失败。验收：上层程序逐行解析 JSONL，运行提示不污染数据；关闭输入、输出管道断开、无人批准写入均在有限时间退出；TUI 和非交互复用同一权限和执行核心。 |
| **MCP 工具定义按需发现：部分覆盖，需加深** | Claude Code 的 MCP tool search 延迟加载完整工具定义，避免启动时把所有 schema 放进上下文；工具能力存在供应商兼容条件。[MCP tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search) | 19 的 Skills 正文已按需加载，21 有 MCP“发现”，但未明确大量工具的 schema 预算、检索和延迟注册。 | 增加本地工具目录、可搜索元信息、按需暴露完整参数结构、工具变化后的失效处理；用当前协议能支持的实现，不能直接假设支持 Claude 的特殊字段。验收：注册数百个模拟工具，初始上下文不包含所有 schema；搜索出目标后才调用，未知/过期工具被拒绝，最终调用仍经过权限检查。 |
| **Prompt cache 与实际用量：部分覆盖，需加深** | Claude Code 文档说明稳定请求前缀、模型切换、压缩及工具集合变化与缓存的关系；Gemini CLI 说明缓存能力与认证路径有关。[Prompt caching](https://code.claude.com/docs/en/prompt-caching)、[Gemini token caching](https://geminicli.com/docs/cli/token-caching/) | 15 已有预算/实际用量，16 有压缩，23 有协议能力。未显式涉及 cache read/write、稳定前缀或缓存不支持时的表现。 | 讲清缓存减少重复处理，压缩减少携带内容，二者作用不同。组织稳定前缀，保留供应商用量原字段并映射为可比较指标；没有缓存字段就标“未知/不支持”。验收：同一任务控制变量比较固定与变化前缀，报告缓存/未缓存输入和完成质量；不通过增加无用上下文追求命中率，不把本地估价当账单。 |
| **配置、认证与项目加载信任：已有基础，需形成统一边界** | Gemini CLI 有目录信任机制，可在加载项目配置前处理信任；官方文档注明该功能默认关闭，启用后未信任目录在 headless 模式会失败。Claude Code 也记录交互与 `-p` 模式信任行为差异。[Trusted folders](https://geminicli.com/docs/cli/trusted-folders/)、[Claude security](https://code.claude.com/docs/en/security)；Gemini 认证区分登录、API key、Vertex AI 与 headless 环境。[Authentication](https://geminicli.com/docs/get-started/authentication/) | 02 有 Key 和配置优先级练习，05 有权限，17 有规则来源，20 要求项目脚本明确启用，21 有 MCP 认证，31 有扩展包。缺统一的“启动加载什么、来自哪里、是否会执行”定义。 | 把配置覆盖次序、来源展示、无效配置诊断、密钥脱敏、信任撤销和项目 Hook/MCP 启动纳入同一流程。验收：陌生仓库携带项目设置与启动脚本；未获信任时不执行；非交互不会无限等对话框；错误日志/会话/导出包不含凭据；切换模型端点不把上一端点密钥误发过去。厂商默认值是参考事实，不直接复制为本书策略。 |
| **恢复、重试和停止：已有覆盖，需细化状态** | Claude Agent SDK 区分轮次上限与费用上限，返回对应结束结果；Claude Code 的程序化模式公开重试事件、信号退出和子进程清理语义。[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)、[Programmatic usage](https://code.claude.com/docs/en/headless) | 03 有循环上限，07—08 有超时取消，13 明确不重放副作用，27 有预算/父子取消，30 有停止条件，34 有错误分类与 429。因此不属于“缺失重试/取消”。 | 补齐可重试/需配置修复/永久失败分类、退避期间取消、总时间/token/次数预算、重复失败无进展检测；明确生成停止与业务任务完成是两回事。验收：注入 429→成功、401、不完整工具参数、命令成功但日志未写完、连续相同失败；不会无界重试或重复写入；收到终止信号后不再启动新工具；恢复后保留准确终态与证据。 |

## 已明确覆盖，不应再作为“少了一项功能”重复加章

这些条目按当前课程文本判断。深度仍须靠后续完整代码、故障实验和真实任务证明。

| 课程已提出的机制 | 对应章节/验收 | 与本次官方核对的关系 |
| --- | --- | --- |
| 核心循环、文件与命令工具、工具参数校验、轮次上限 | 02—08，E01—E06 | 与 [Claude Agent SDK 的循环和工具反馈说明](https://code.claude.com/docs/en/agent-sdk/agent-loop)同属基础骨架；不应以增加更多工具名代替实现质量。 |
| 明确权限入口、Plan 模式、输入补充与取消 | 05、08、11—12，E04—E06 | [Gemini policy engine](https://geminicli.com/docs/reference/policy-engine/)证实权限是独立执行决策；本课程已有执行层边界。需补的是无人交互和启动配置的策略。 |
| 子 Agent、后台工作、worktree、并行和团队状态 | 25—30，E15—E18 | 已有独立上下文、隔离、整合与任务生命周期；本次发现的是交付闭环未明确，不是缺少多 Agent。 |
| 恢复不重复副作用、上下文压缩、能力评测 | 13—16、34—35，E07—E09 | 已写关键不变量；需把具体故障与缓存行为写实，不能将其描述为完全空白。 |

## 产品范围之外或后续扩展

| 能力 | 官方依据 | 对本书的判断 |
| --- | --- | --- |
| 完整 SDK、IDE 插件和 ACP 接入 | Claude Code 有 Python/TypeScript SDK；Gemini CLI 的 ACP 以 stdio JSON-RPC 提供会话、输入、取消等控制。[Claude programmatic usage](https://code.claude.com/docs/en/headless)、[Gemini ACP](https://geminicli.com/docs/cli/acp-mode/) | “可嵌入”接口值得预留，09 的核心/UI 分离正是基础；先做可靠 headless 与最小 TypeScript 调用示例。完整 SDK 稳定性承诺、多个编辑器插件、双向 ACP 可作为后续专题。LSP 获取诊断与 IDE 作为宿主接入是不同能力。 |
| 厂商托管云任务、远程控制、移动端、多租户管理 | Claude Code 官方区分托管云隔离环境和连接本地进程的 Remote Control。[Cloud/Remote Control 安全边界](https://code.claude.com/docs/en/security#cloud-execution-security) | 当前目标是可 npm 安装的本地 TUI Agent；这些属于额外部署和服务产品，不应为追齐厂商入口数量而挤入核心教程。沙箱与后台任务仍必须按原计划完成。 |
| 供应商自动模型路由 | Gemini CLI 公开了模型失败时的 fallback 路由。[Model routing](https://geminicli.com/docs/cli/model-routing/) | 23 的多协议和能力检查是必备；自动选模型不是最低完成标准。若引入 fallback，要展示切换原因、上下文兼容、用量归属与数据去向，不做静默跨供应商切换。 |

## 建议的编写优先级

1. 以本地 CLI + TUI 运行为主线，优先落实输入/焦点、任务干预、终端恢复、交互进程、本地评审与可靠非交互协议；浏览器和 PR/CI 留作扩展示例，按教学负担决定是否拆章。
2. 在原有 02/05/15/16/20/21/23/34 中加入配置与信任、缓存/工具发现、恢复停止的具体验收；保留现有逐步递进方式。
3. 先用模拟模型、临时仓库、模拟 MCP 服务核验执行机制，再用真实模型评价任务完成情况。官方有某个产品功能，并不证明我们的实现或同名功能已经可用。

本文件保留官方资料核对，当前建议已按用户明确的 CLI + TUI 产品范围修订；正式章号和章节代码未改变。
