# 34.2 只重试可以安全重发的请求

模型请求刚发出就收到 429，用户尚未看到回答，也没有新工具执行。这时稍等再请求一次，可能避开临时限流。但如果测试已经运行、文件已经写入，直接重新执行整轮任务，就会把已发生的操作再次交给模型安排。

本节把重试边界收在模型适配器外面。重试的是同一份消息、系统提示和工具定义，不是 `runAgent`，也不是工具的 `execute`。一个完整响应通过结束原因检查以后，Agent Loop 才准备工具、请求审批并执行。

## 先分清哪些失败值得再试

本地程序只查看 SDK 错误的状态码和类别，不复制远端错误正文。认证失败、请求参数错误、未知错误与本地校验失败立即结束；429、5xx 和连接类错误可以进入有限重试。这个选择是本课程的恢复策略，并非“所有服务商都保证这些请求没有处理过”。

[OpenAI SDK 的重试说明](https://github.com/openai/openai-node#retries)列出了默认会重试的一组错误，并允许用 `maxRetries: 0` 关闭。我们继续保留协议层的 `maxRetries: 0`，让本节只有一层重试计数，避免本地三次尝试再乘上 SDK 内部重试。

还有一个更严格的门槛：一旦本次请求已经向界面交付非空文字，就不再自动重发。否则用户会先看到半段旧回答，再看到一段重新生成的回答，程序却无法把两者可靠地接成同一次响应。工具参数片段尚未成为完整工具调用，也不会提前执行；最终失败时它们仍不进入历史。

## 退避是在等待下一次尝试

最多尝试 3 次，包括第一次。第 1 次失败后等待约 500—1,000ms，第 2 次失败后等待约 1,000—2,000ms；随机抖动让多个客户端不在同一时刻再次冲向服务。等待本身接收取消信号。用户在退避期间取消，runtime 结束这次等待，不再发出下一次请求。

每次重试前发出 `model_retry`：记录同一个模型 call、即将开始的尝试编号、错误类别和等待毫秒数。日志于是可以解释“一个 model_start 为什么耗时更久”。重试不会占用 Agent Loop 的下一次决策编号，因为我们尚未取得本次决策的完整结果。

所有尝试与等待共用原有 60 秒请求期限。成功后仍先返回完整 `ModelResult`，由 Agent Loop 核对结束原因，才可能执行工具。达到次数或总期限后，程序交出安全的本地失败说明；不再请求模型，也不把请求失败伪造成工具结果。这份最小实现使用本地退避，不解析服务端 `Retry-After`，需要严格遵守该字段的接入应另行补足策略。

## 再试成功不等于前面免费

连接断开时，客户端不知道远端是否已经生成并计费。即使第 2 次请求成功，第 1 次的 usage 也可能永远拿不到。因此，只要发生重试，返回的累计用量就降为 `null`；不能用最后一次成功的 token 数冒充全部消耗。

我们保证的是本地不会因为传输重试重复调用工具，不是远端请求恰好处理一次。MCP 的写操作、shell 命令、文件修改都不在这层重试中。工具执行失败时，原来的结果通道仍把真实错误交给模型；若模型再次提出同一操作，它仍须重新经过权限与审批，这与本节的自动传输重试是两回事。

举例说，第 1 次模型决策要求写文件，用户批准后写入成功。总结请求收到 429，程序只重发包含“写入成功”工具消息的总结请求。文件工具不重新执行；重试仍失败，则历史保留那次写入结果和本地中断说明，文件也留在工作区，等待用户检查或显式恢复检查点。

<!-- media:lesson:start -->
以“文件已写好、总结 429”为例，固定 history 只重发单次模型请求，已成功的工具始终只执行一次。

<img src="./content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-cover-b0dfa9748d.png" data-gif-src="./content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-cb520e3c0e.gif" data-cover="./content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-cover-b0dfa9748d.png" data-no-zoom alt="总结遇到 429，怎样重试而不再写一次文件？">

[静态流程图](/content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-flow-8cdaa2a0d1.png.md) · [静态封面](/content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-cover-b0dfa9748d.png.md) · [查看完整静态分镜](/content/chapter-34-reliability/02-safe-retries/assets/model-only-retries-storyboard-9471837daf.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- changes:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-34-reliability/02-safe-retries/src/agent/agent-loop.ts.md) | 同一决策编号接收重试通知。 |
| CHANGED | [src/agent/events.ts](/content/chapter-34-reliability/02-safe-retries/src/agent/events.ts.md) | 声明模型重试观察事件。 |
| CHANGED | [src/diagnostics/logger.ts](/content/chapter-34-reliability/02-safe-retries/src/diagnostics/logger.ts.md) | 记录尝试次数、类别与退避。 |
| CHANGED | [src/models/client.ts](/content/chapter-34-reliability/02-safe-retries/src/models/client.ts.md) | 只包装单次模型请求；已交付文字后停止重试，用量不确定时返回 null。 |
| CHANGED | [src/models/model-errors.ts](/content/chapter-34-reliability/02-safe-retries/src/models/model-errors.ts.md) | 识别 SDK 与传输连接错误，返回不含服务商原文的说明。 |
| NEW | [src/models/retry.ts](/content/chapter-34-reliability/02-safe-retries/src/models/retry.ts.md) | 分类后有限重试，退避等待可取消。 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-34-reliability/02-safe-retries/src/ui/teaching-trace.ts.md) | 显示正在等待的重试及其原因。 |
| CHANGED | [src/ui/tui/state.ts](/content/chapter-34-reliability/02-safe-retries/src/ui/tui/state.ts.md) | 在 TUI 中显示诊断结果及当前重试状态。 |
<!-- changes:end -->

## 动手构建

从 34.1 继续。重试函数不认识模型工具，也不保存历史；它只拥有“尝试、判断、等待、再尝试”这段短流程。client 决定当前请求是否仍满足重发条件，Agent Loop 继续负责工具与消息提交。

<!-- source:start -->

<!-- build-file: src/agent/agent-loop.ts -->
<details>
<summary>src/agent/agent-loop.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] agent/agent-loop.ts
 *
 * [KEEP 来自 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
 * [KEEP 来自 27.2] 排队期限 / 领槽后的执行期限 -> 发停止请求 -> await底层收尾 -> 归还槽。
 * [KEEP 来自 27.3] 每项独立缓冲 -> 同伴全部收尾 -> 按原callID顺序提交整批观察 -> 下一次模型。
 * 学习目标：每项单独保存观察，同伴收尾后按原调用身份提交整批结果，再请求模型。
 * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
 * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
 * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
 *
 * 全局主流程（从这里进入各模块）：
 *   [KEEP 来自 29.1–29.3] 父generate -> create/run共享任务工具 -> 固定worker认领 -> 只读子循环
 *       -> 保存关闭 -> 任务快照tool消息 -> 父下一次generate；消息send/read/ack只传线索，不替代任务完成
 *   [KEEP 来自 30.1] CLI schedule create/list -> 本地锁/校验/快照 -> 结束，不加载模型配置
 *   [KEEP 来自 30.2] schedule serve -> 到期且无active？-- 否 -> 等下一tick；是 -> 预算预留落盘 -> 只读runSubagent
 *       -> 工具观察回到子模型 -> runner settle -> 终态写盘 -> 释放active -> 下一tick
 *   [KEEP 来自 30.3] stop -> stopped落盘 -> abort -> await真实settle；显式恢复 -> interrupted/paused，不重放
 *   [KEEP 来自 19.1] 启动discoverSkills -> 名称/用途目录常驻参考，不读正文
 *   [KEEP 来自 19.2] 空闲 /skill review -> 完整读取接纳 -> loaded Map -> 后续system正文
 *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
 *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
 *                                                         +-- 有效 -> 配置、模型、消费者
 *   [KEEP 来自 13.3] text / TUI -> 新建 ID 或锁定、校验并恢复指定会话；jsonl 仍只输出事件
 *   [KEEP 来自 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
 *   [KEEP 来自 13.4] --sessions / --search / --rename / --export -> 本地管理记录，不请求模型
 *   [KEEP 来自 14.1] --fork ID -> 复制可信状态到新 ID；保留来源记录，不继承旧轮占用或授权
 *   [KEEP 来自 14.3] 空闲 /changes、/restore ID -> 查看差异或按当前内容核验后恢复；不执行旧工具
 *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
 *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
 *   [KEEP 来自 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
 *   [KEEP 来自 12.4] TUI Enter -> 正在运行？-- 是 -> 校验补充 -> 记入当前轮 FIFO 队列
 *                                           +-- 否 -> 本地命令或新一轮问题
 *   [KEEP 来自 12.4] Ctrl+S -> 先保存新要求、锁住提交 -> abort 旧轮 -> 等旧 done
 *                   -> 已退出？-- 是 -> 结束；否 -> 新控制器、新一轮（旧队列留存）
 *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；队列 e 编辑、x 撤回、空闲 Enter 发送
 *                  -> 每次按固定 ID 查找；已收取？-- 是 -> 保留编辑稿、可 Ctrl+B 复制
 *                                                   +-- 否 -> 校验后保存原条目
 *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
 *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
 *                                                                   +-- 否 -> 建立本轮消息
 *   [KEEP 来自 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
 *   [KEEP 来自 12.1] 固定本轮模式 -> A
 *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
 *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
 *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
 *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
 *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
 *      [KEEP 来自 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
 *           -> 候选仍超限 / 失败 / 取消？-- 是 -> X（原视图与完整记录保留）
 *                                       +-- 否 -> 提交摘要游标，再请求模型
 *                                                      +-- 是 -> 请求模型
 *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
 *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
 *                                                                        +-- 是 -> B
 *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
 *                  |                         +-- 是 -> 保存 assistant 回答
 *                  |  [KEEP 来自 12.4] 仍有补充且未到第 8 次？-- 是 -> A（继续决策）
 *                  |                                              +-- 否 -> 提交历史、返回回答
 *                  |  次数已用完时不取走剩余补充，界面队列仍保留
 *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
 *                                       +-- 否 -> 保存 assistant 调用 -> S
 *   [KEEP 来自 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
 *   [KEEP 来自 22.2] 固定搜索endpoint -> 本次查询审批 -> 有界JSON响应 -> 真正返回的URL/摘要 -> 模型
 *   [KEEP 来自 22.1] 明确启用 -> URL/本次审批 -> 单一期限/逐块限额/逐跳校验 -> 真实来源与正文 -> 模型
 *   [KEEP 来自 21.3] close/断线/定义变化 -> 撤下可调用定义；取消先关闭本地传输，远端副作用仍需核实
 *   [KEEP 来自 21.2] HTTP配置 -> HTTPS/loopback校验 -> 固定Bearer环境变量 -> 官方StreamableHTTP
 *   [KEEP 来自 21.1] 显式MCP配置 -> SDK握手 -> 分页发现/命名 -> 模型定义 -> 逐次审批 -> SDK调用/原调用结果
 *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
 *   S: [KEEP 来自 27.1] 固定 sequence/callID -> 相邻白名单只读段最多 N 项；其他调用为串行屏障
 *       -> 每项分别进入 C；Hooks 启用时整批串行；当前段全部收尾后才进入下一段
 *       -> 全部段收尾 -> 本批观察齐全 -> A
 *   [KEEP 来自 28.1] create/read/run_worktree_command -> 会话自有ID/base/path -> 同一gate -> 实际状态回D
 *   C: 单项调用 -> [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
 *                                                             +-- 否 -> 原有 deny / ask / allow
 *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
 *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
 *                                                             +-- 批准 -> 执行 -> D
 *      [KEEP 来自 18.2] propose_memory -> 完整正文/依据预览 -> allow_once -> 锁内保存
 *                     拒绝/取消不执行闭包；已保存结果回原调用，下一任务才刷新记忆
 *      [KEEP 来自 19.3] load_skill -> 完整接纳Map -> 成功摘要回D -> 下一请求system加入正文
 *      [KEEP 来自 19.3] read_skill_resource -> 已加载技能内有界读取 -> 文字/来源回D
 *                     资源随原toolCallId结果进下一请求；失败同样有结果，取消走X
 *      allow -> 注册表找到工具 -> 执行 -> D
 *        [KEEP 来自 14.2] write_file / edit_file -> 先保存前后内容检查点，成功才实际写入
 *        [KEEP 来自 12.2] todo_write -> 全部条目校验成功？-- 否 -> ToolError、旧清单不变
 *                                                     +-- 是 -> 一次替换内存清单 -> D
 *        [KEEP 来自 12.3] ask_user -> 校验问题 -> 专用 handler 等回答
 *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
 *                                                +-- 否 -> ToolError 或取消 -> D / X
 *                            TUI 面板独占输入；旧请求结束后旧回调失效
 *   [KEEP 来自 20.2] 工具真实结果 -> after_tool -> 追加反馈或失败说明 -> D；取消保留已知结果
 *   D: 单项工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
 *                                                        +-- 是 -> 写完整本地日志、sync、关闭
 *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
 *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
 *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
 *      [KEEP 来自 27.1] 保存本项正文 / 裁剪正文、原调用 ID 与错误标记 -> 本项过程事件 -> 返回 S
 *      一批调用全部有结果后才回到下一次模型请求
 *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
 *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
 *   [KEEP 来自 20.3] runAgent -> 非取消的完成/错误 -> stop一次 -> 本地反馈；取消不启动stop
 *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
 *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
 *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
 *   [KEEP 来自 13.1] text / TUI 流清理完 -> Message[] 已提交 -> 白名单检查点 -> 串行 append、sync
 *                  -> 成功 / 保存失败反馈（模型结果另行显示）；TUI done 此后才解除占用
 *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑撤回 -> 白名单检查点；Enter 入队仍只改内存
 *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
 *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
 *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
 *   [KEEP 来自 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
 *
 * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
 * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
 * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
 * 运行观察：读取按调用身份显示进度；串行屏障等待当前读取段收尾，本批观察齐全后模型才继续。
 */

// [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
// [KEEP 来自 21.1] 每次调用重新检查当前定义是否可用。
// [KEEP 来自 22.1] 网页也使用同一条审批与原调用结果通道。
import { randomUUID } from "node:crypto";
import { ChildBudgetError, runSubagent } from "../subagents/runner.js";
import { webDefinitions, citationFeedback } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import { runHooks } from "../hooks/lifecycle.js";
import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
import { explainError, ToolError, UserFacingError } from "../errors.js";
import { boundToolResult, clippedToolText } from "../context/tool-results.js";
import { requestFailedBeforeSending, type Message, type Model, type ModelResult, type Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
// [KEEP 来自 29.1] 共享调度仍用同一权限/工具/模型返回链路。
import { runSharedTasks } from "../collaboration/runner.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import type { RunOptions } from "./run-options.js";
// [KEEP 来自 27.1] 原单项权限链由调度器调用，相邻白名单读取才共用有限容量。
import { runToolBatch, validateBatch } from "./tool-batch.js";

const MAX_MODEL_CALLS = 8;

/**
 * 把新一次模型调用的 token 数累加到本轮总量。
 *
 * - 输入：当前累计值和本次调用值；任一值都可能是表示未知的 `null`。
 * - 输出：两项都已知时返回和；任一项未知时返回 `null`。
 * - 关键原因：部分缺失的数据不能计算出真实总量，继续显示数字会造成误导。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 让模型读到问题和真实工具结果，继续决策直到本轮完成或中断。
 * 进入前先检查取消；本轮模式在入口固定，模型提示与权限策略都使用它。
 * 清单容器在这轮工具之间共用；工具完整校验后更新内存，核心不从回答文字推断进度。
 * 每次模型请求前取出当前轮 FIFO 补充，加入本轮消息；上一批工具先全部产生结果。
 * 最终回答后还有补充且未用尽 8 次请求时继续；用尽次数不收取剩余补充。
 * 每个工具先过权限，写入与命令先准备再审批；拒绝和 ToolError 也回给原调用。
 * ask_user 通过注册表等待专用 handler，答案仍是该次工具结果。
 * 成功提交完整本轮消息并返回回答；开始后中断则补齐工具结果、保存说明，再抛出原因。
 * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
 */
// [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
// [KEEP 来自 25.3] 只把子状态转发给父观察者，子文字留在子历史。
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 增加本轮控制选项；调用方把模式快照传到核心。
  options: RunOptions = {},
): Promise<Reply> {
  signal.throwIfAborted();
  const releaseRun = model.beginRun?.();
  // [KEEP 来自 24.1] 验证失败尚未提交 user 消息，也不取走 pending；结束时释放切换锁。
  try { await model.attachments?.preflight(signal, model.profile?.capabilities.images === true); }
  catch (error) { releaseRun?.(); throw error; }
  // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
  const mode = options.mode ?? "execute";
  const maxModelCalls = Math.min(MAX_MODEL_CALLS, Math.max(1, Math.floor(options.maxModelCalls ?? MAX_MODEL_CALLS)));
  const parentSessionId = options.sessionId ?? randomUUID();
  let childCount = 0;
  // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
  const context = options.context ?? emptyCompaction();
  // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
  // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
  // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
  // [KEEP 来自 28.1] 本轮采用CLI对象持有的自有工作区登记；不把Git身份写进会话恢复状态。
  const toolOptions: RunOptions = { ...options, jobs: model.jobs ?? options.jobs, worktrees: model.worktrees ?? options.worktrees, sharedTasks: model.sharedTasks ?? options.sharedTasks, languageService: model.languageService ?? options.languageService, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
  toolOptions.delegateTask = async (argumentsJson, childSignal) => {
    if (options.childDepth || ++childCount > 3) throw new ToolError("每轮最多三个只读子任务，子任务不能继续委派。");
    return runSubagent(model, argumentsJson, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory, requestApproval, depth: options.childDepth ?? 0,
      // [KEEP 来自 25.3] 子增量和模型编号不混入父流；结构化状态与最终工具结果分别转交。
      observer: event => { if (event.type === "child_state") emitAgentEvent(observer, event); },
    });
  };
  // [KEEP 来自 27.1] 多个只读调用可能请求敏感文件审批；同一界面一次只显示一个批准请求。
  let approvalTail = Promise.resolve();
  const orderedApproval: ApprovalHandler = async (request, approvalSignal) => {
    const previous = approvalTail;
    let release!: () => void;
    approvalTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { approvalSignal.throwIfAborted(); return await requestApproval!(request, approvalSignal); }
    finally { release(); }
  };
  // [KEEP 来自 29.1] 等所有worker子会话收尾后返回，结果继续成为tool消息进入下一次generate。
  toolOptions.runSharedTasks = childSignal => {
    if (options.childDepth || mode === "plan" || !toolOptions.sharedTasks) throw new ToolError("当前模式或子层不能启动共享worker。");
    return runSharedTasks(model, toolOptions.sharedTasks, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory,
      requestApproval: requestApproval ? orderedApproval : undefined, observer });
  };
  const attachments = model.attachments?.take();
  const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let cachedInputTokens: number | null = 0, cacheWriteTokens: number | null = 0;
  // [KEEP 来自 23.3] 已发送但未收齐结果时，累计值不能继续冒充整轮总量；未发送的预检拒绝保留旧值。
  const incompleteUsage = (call: number, error: unknown) => {
    if (requestFailedBeforeSending(error)) return;
    inputTokens = outputTokens = cachedInputTokens = cacheWriteTokens = null;
    emitAgentEvent(observer, { type: "model_usage", call, inputTokens, outputTokens,
      costEstimateUsd: null, cachedInputTokens, cacheWriteTokens });
  };
  let toolSequence = 0;
  let pendingToolResults = 0;
  // [KEEP 来自 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
  let compactionAttempts = 0;

  // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
  // [KEEP 来自 27.1] 并发时可能同时有多个尚未返回结果的调用。
  const executingCallIds = new Set<string>();
  try {
    // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
    await model.memory?.refresh(signal);
    for (let modelCall = 1; modelCall <= maxModelCalls; modelCall += 1) {
      // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
      signal.throwIfAborted();

      // [KEEP 来自 12.4] 每次请求前收取当前轮 FIFO 补充；上一批调用已有完整工具结果。
      for (const queued of options.takePendingInputs?.() ?? []) {
        turn.push({ role: "user", content: queued.text });
        // [KEEP 来自 12.4] 此事件只确认核心已收取并加入本次上下文，不保证远端收到。
        emitAgentEvent(observer, { type: "input_applied", ...queued, call: modelCall });
      }
      signal.throwIfAborted();
      // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
      let messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
      let budget = model.inspectContext?.(messages, mode);
      if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
      // [KEEP 来自 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
      if (budget && !budget.withinBudget) {
        const candidate = { ...context };
        try {
          while (!budget.withinBudget && compactionAttempts < 2) {
            compactionAttempts += 1;
            emitAgentEvent(observer, { type: "compaction_start", attempt: compactionAttempts });
            const prepared = await prepareCompaction(model, [...history, ...turn], candidate, signal, mode,
              toolOptions.tasks?.items, result => {
                inputTokens = addUsage(inputTokens, result.inputTokens);
                outputTokens = addUsage(outputTokens, result.outputTokens);
                cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
                cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
                emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
                  costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
              }, error => incompleteUsage(modelCall, error));
            Object.assign(candidate, prepared.state);
            messages = requestMessages([...history, ...turn], candidate, toolOptions.tasks?.items);
            budget = model.inspectContext!(messages, mode);
            emitAgentEvent(observer, { type: "compaction_candidate", attempt: compactionAttempts,
              before: prepared.before, after: prepared.after, through: candidate.through });
          }
          signal.throwIfAborted();
          if (!budget.withinBudget) throw new UserFacingError("本项任务的摘要次数已用尽，请求仍超出本地预算；候选未采用，完整记录保留。");
          Object.assign(context, candidate);
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "applied", through: context.through });
          emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
        } catch (error) {
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "retained",
            message: signal.aborted ? "压缩已取消，旧请求视图和完整记录保留。" : explainError(error) });
          throw error;
        }
      }
      emitAgentEvent(observer, {
        type: "model_start",
        call: modelCall,
        contextMessages: messages.length,
        trigger: modelCall === 1
          ? { kind: "user", content: input }
          : { kind: "tool_results", count: pendingToolResults },
      });
      pendingToolResults = 0;
      // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
      // [KEEP 来自 12.1] 模型请求也接收本轮模式；工具隐藏只是辅助。
      let result: ModelResult;
      try {
        result = await model.generate(messages, signal, (text) => {
          if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });
        // [CHANGED 34.2] 通知同一次决策内的退避；只有generate完整返回后才准备工具。
        }, { mode, onRetry: notice => emitAgentEvent(observer, { type: "model_retry", call: modelCall, ...notice }) });
      } catch (error) { incompleteUsage(modelCall, error); throw error; }
      inputTokens = addUsage(inputTokens, result.inputTokens);
      outputTokens = addUsage(outputTokens, result.outputTokens);
      truncated ||= result.truncated;
      cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
      cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
      // [KEEP 来自 15.1] 任一次 usage 缺失后累计值保持未知，不以估算补充；费用只按用户配置计算。
      emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
        costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
      emitAgentEvent(observer, {
        type: "model_finish",
        call: modelCall,
        // [KEEP 来自 08.2] 长度上限和拒绝不会伪装成成功回答。
        finishReason: result.finishReason,
        outcome: !["stop", "tool_calls"].includes(result.finishReason) ? "incomplete"
          : result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
        toolRequests: result.toolCalls.length,
        text: result.text,
      });

      // [KEEP 来自 08.2] 正常结束与工具数量必须一致，完整响应才允许进入权限判断。
      if (result.finishReason === "length") throw new UserFacingError("回答达到输出上限，本次响应未完成；其中的工具请求不会执行。");
      if (result.finishReason === "refusal") throw new UserFacingError("模型拒绝了本次请求，本次响应中的工具请求不会执行。");
      if (result.finishReason !== (result.toolCalls.length ? "tool_calls" : "stop")) {
        throw new UserFacingError("模型结束原因与内容不一致，或当前接口返回了不支持的结束原因。");
      }
      if (result.toolCalls.length === 0) {
        if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
        signal.throwIfAborted();
        // [KEEP 来自 22.3] 不编造修复后的引用；本地核验反馈随最终结果显示并保存。
        const feedback = citationFeedback(model.web, result.text);
        const finalText = result.text + (feedback ? `\n\n${feedback}` : "");
        turn.push({ role: "assistant", content: finalText });

        // [KEEP 来自 12.4] 最终回答后仍有补充且有请求预算就继续；第 8 次后的剩余条目保留。
        if (modelCall < maxModelCalls && options.takePendingInputs && options.hasPendingInputs?.()) continue;
        history.push(...turn);
        return { text: finalText, inputTokens, outputTokens, truncated, cachedInputTokens, cacheWriteTokens };
      }

      // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
      if (modelCall === maxModelCalls) break;

      // [KEEP 来自 27.1] 先固定编号，后续完成乱序不会改变调用身份；副作用与依赖工具是屏障。
      const items = result.toolCalls.map((call, index) => ({ call, sequence: toolSequence + index + 1 }));
      // [KEEP 来自 27.3] 无法配对的响应尚未进入历史，也没有工具开始。
      validateBatch(items);
      turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      toolSequence += items.length;
      const observations = new Map(items.map(item => [item.call.id, [] as Message[]]));
      let batchFailed = false, batchError: unknown;
      try {
      await runToolBatch(items, signal, async ({ call, sequence }, callSignal) => {
        // [KEEP 来自 27.3] 同伴不会写进本项数组；完成顺序仅影响即时事件。
        const callMessages = observations.get(call.id)!;
        callSignal.throwIfAborted();
        // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
        const permission = options.allowedTools && !options.allowedTools.includes(call.name)
          ? { action: "deny" as const, reason: `子任务不允许工具：${call.name}` }
          : await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
        emitAgentEvent(observer, {
          type: "permission_check",
          sequence,
          call,
          decision: permission,
        });
        let rejection: string | null = null;
        let prepared: PreparedToolCall | null = null;
        // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
        callSignal.throwIfAborted();
        if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
        if (permission.action === "ask") {
          try {
            // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
            // [KEEP 来自 14.2] 把本地文件检查点入口传到写入准备层。
            prepared = await prepareTool(call, callSignal, toolOptions);
          } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            callMessages.push({
              role: "tool",
              toolCallId: call.id,
              content: `工具准备失败：${error.message}`,
              isError: true,
            });
            pendingToolResults += 1;
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence,
              call,
              outcome: "error",
              error: error.message,
            });
            return false;
          }
          if (prepared) {
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence,
              call,
              outcome: "success",
              previewChars: prepared.preview.length,
            });
          }
          emitAgentEvent(observer, {
            type: "approval_start",
            sequence,
            call,
            scope: permission.scope,
            allowSession: permission.remember,
            hasPreview: prepared !== null,
          });
          const response = requestApproval
            ? await orderedApproval({
                call,
                reason: permission.reason,
                resource: permission.resource,
                scope: permission.scope,
                allowSession: permission.remember,
                ...(prepared ? { preview: prepared.preview } : {}),
              }, callSignal)
            : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
          // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
          callSignal.throwIfAborted();
          emitAgentEvent(observer, {
            type: "approval_finish",
            sequence,
            call,
            response,
          });
          // [KEEP 来自 06.1] 写入和命令批准都不能保存；只有可复用的读取范围进入 Set。
          if (response.decision === "allow_session") {
            if (permission.remember) sessionGrants.add(permission.scope);
            // [KEEP 来自 07.1] 写入与命令都只能批准当前操作。
            else rejection = "当前批准只适用于这一次操作预览";
          }
          if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
        }
        if (rejection) {
          callMessages.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
          pendingToolResults += 1;
          return false;
        }
        // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
        callSignal.throwIfAborted();
        executingCallIds.add(call.id);
        emitAgentEvent(observer, { type: "tool_start", sequence, call });
        try {
          // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
          // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
          // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
          // [KEEP 来自 20.1] 取消或before失败时尚未启动工具。
          if (mode !== "plan") {
            const before = await runHooks(model.hooks, "before_tool", { call }, callSignal);
            if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
          }
          let result = prepared
            ? await executePreparedTool(prepared, callSignal, toolOptions)
            : await executeTool(call, callSignal, toolOptions);
          if (result.metadata.kind === "subagent") {
            const childUsage = result.metadata.result.usage;
            inputTokens = addUsage(inputTokens, childUsage.inputTokens); outputTokens = addUsage(outputTokens, childUsage.outputTokens);
            cachedInputTokens = addUsage(cachedInputTokens, childUsage.cachedInputTokens); cacheWriteTokens = addUsage(cacheWriteTokens, childUsage.cacheWriteTokens);
            emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
          }
          if (result.metadata.kind === "subagent" && callSignal.aborted) {
            callMessages.push({ role: "tool", toolCallId: call.id, content: result.content, isError: true });
            executingCallIds.delete(call.id);
            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result });
            callSignal.throwIfAborted();
          }
          // [KEEP 来自 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
          if (mode !== "plan") {
            try {
              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, callSignal);
              if (after.messages.length) result = { ...result, content: `${result.content}\n\n[本地执行后钩子反馈；不是权限]\n${after.messages.join("\n")}` };
            } catch (error) {
              if (!(error instanceof ToolError)) {
                callMessages.push({ role: "tool", toolCallId: call.id, content: result.content + "\n[本地状态] 后置钩子中断；工具已返回，副作用未撤销。", isError: result.isError ?? false });
                executingCallIds.delete(call.id);
                throw error;
              }
              result = { ...result, content: `${result.content}\n[本地执行后钩子失败] ${error.message}` };
            }
          }
          // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
          executingCallIds.delete(call.id);
          let modelContent: string;
          try { modelContent = (await boundToolResult(result.content, callSignal, options.toolResultDirectory)).content; }
          catch (error) {
            // 原工具的错误标记保持不变；给本次调用留下明确摘要，不声明不存在的日志引用。
            const content = `[本地状态：工具已返回，但完整日志未保存；本轮停止，以下仅为头尾，不能找回被省略部分]\n${clippedToolText(result.content)}`;
            callMessages.push({ role: "tool", toolCallId: call.id, content, isError: result.isError ?? false });
            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result: { ...result, content } });
            throw error;
          }
          // [KEEP 来自 07.1] 非零退出码仍是错误；裁剪不改变原调用编号或成功/失败。
          callMessages.push({ role: "tool", toolCallId: call.id, content: modelContent, isError: result.isError ?? false });
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence,
            call,
            outcome: "success",
            result: { ...result, content: modelContent },
          });
          // [KEEP 来自 27.1] 工具返回的错误标记也决定调度终态，避免 succeeded 覆盖界面失败状态。
          return !result.isError;
        } catch (error) {
          // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
          if (!(error instanceof ToolError)) throw error;
          callMessages.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具执行失败：${error.message}`,
            isError: true,
          });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallIds.delete(call.id);
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence,
            call,
            outcome: "error",
            error: error.message,
          });
          return false;
        }
      }, (item, state) => emitAgentEvent(observer, { type: "tool_state", ...item, state }),
      // [KEEP 来自 27.2] 超时与取消交代原调用身份；已返回的真实结果保留并补充本地状态。
      { concurrency: options.toolConcurrency, serial: Boolean(model.hooks),
        queueTimeoutMs: options.toolQueueTimeoutMs, executionTimeoutMs: options.toolExecutionTimeoutMs,
        onFailure: ({ call, sequence }, failure) => {
          // [KEEP 来自 27.3] 超时/取消也填入同一项；真实结果已返回时追加状态，不重复一份消息。
          const callMessages = observations.get(call.id)!;
          const last = callMessages[callMessages.length - 1];
          if (last?.role === "tool") { last.content += `\n[本地状态] ${failure.message}`; last.isError = true; }
          else { callMessages.push({ role: "tool", toolCallId: call.id, content: failure.message, isError: true }); pendingToolResults += 1; }
          executingCallIds.delete(call.id);
          emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "error", error: last?.role === "tool" ? last.content : failure.message });
        },
      });
      } catch (error) { batchFailed = true; batchError = error; }
      finally {
        // [KEEP 来自 27.3] 即使父取消或同伴异常，也先提交已取得的真实结果及未启动交代。
        for (const { call } of items) turn.push(...observations.get(call.id)!);
        pendingToolResults = items.length;
        emitAgentEvent(observer, { type: "tool_batch_finish", call: modelCall,
          results: items.length, interrupted: batchFailed });
      }
      if (batchFailed) throw batchError;

    }

    if (options.childDepth) throw new ChildBudgetError("子任务已用尽模型决策次数，尚未得到完整最终回答。");
    throw new UserFacingError(`Agent 连续请求模型 ${maxModelCalls} 次仍未得到最终回答，已停止本轮。`);
  } catch (error) {
    // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
    // 每个批次单独配对：后续模型请求即使复用同一个 ID，也不能借用前一批的完成记录。
    const lastBatch = turn.map((message) => message.role === "assistant" && Boolean(message.toolCalls?.length)).lastIndexOf(true);
    const completed = new Set(turn.slice(lastBatch + 1).filter((message) => message.role === "tool").map((message) => message.toolCallId));
    for (const message of lastBatch < 0 ? [] : [turn[lastBatch]]) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        if (completed.has(call.id)) continue;
        turn.push({ role: "tool", toolCallId: call.id, isError: true,
          content: executingCallIds.has(call.id)
            ? "操作已开始，但本轮中断前没有取得完整结果。可能已发生部分修改，请先核实当前文件或进程状态，不要直接重试。"
            : "本轮在该工具启动前中断，这个调用未执行。" });
        completed.add(call.id);
      }
    }
    // 这条状态由本地程序生成，明确标注来源，不把它冒充模型完成的回答。
    // [KEEP 来自 09.2] 按取消原因写入本地状态；队列或输出故障是错误，普通取消才记为取消。
    const cancelled = signal.aborted && !(signal.reason instanceof UserFacingError);
    turn.push({ role: "assistant", content: cancelled
      ? "[本地状态] 本轮已取消。已执行的操作不会自动撤销；继续前先核实工具结果。"
      : "[本地状态] 本轮因错误中断。已执行的操作不会自动撤销；继续前先核实工具结果。" });
    history.push(...turn);
    throw error;
  } finally { releaseRun?.(); }
}
```

</details>

<!-- build-file: src/agent/events.ts -->
<details>
<summary>src/agent/events.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] agent/events.ts
 *
 * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责传递已经发生的模型、权限和工具事件。
 * 输入：runAgent 的开始/结束通知，或 Agent Loop 已发生的过程事件。
 * 输出：可选观察者同步收到一份深拷贝；没有观察者或通知失败时直接返回。
 * 状态：复制事件不修改历史；观察者直接抛错被捕获，但耗时和显式取消不由这里隔离。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] run_start / run_finish 与已有过程事件 -> 有观察者？-- 否 -> 返回
 *                                                                +-- 是 -> structuredClone
 *   复制成功？-- 否 -> 捕获异常 -> 返回
 *             +-- 是 -> 调用观察者 -> 成功 / 抛错 -> 返回
 *
 * run_finish 的 completed 带 Reply，cancelled/error 带说明；model_finish 仍只描述一次模型调用。
 * 观察者只接收事件，审批 handler 才是核心等待的控制入口，事件本身不能授予权限。
 * 深拷贝只保护原对象，不隐藏参数或正文里的敏感信息，也不会把同步回调变成独立线程。
 *
 * [KEEP 来自 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：一个 run_start 到一个 run_finish 之间，可以包含多次 model_start/model_finish。
 */

// [KEEP 来自 08.2] 事件展示统一结束原因。
// [KEEP 来自 34.1] 最终通知携带白名单诊断状态，不复制正文到日志。
import type { RunDiagnostics } from "../diagnostics/logger.js";
import type { ContextBudget } from "../context/budget.js";
import type { ModelFinishReason, Reply } from "../models/client.js";
import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";

// [KEEP 来自 08.1] 原有观察通道增加文字片段，TUI 与文本界面可消费同一种事件。
// [KEEP 来自 09.1] 整轮任务开始与结束也使用事件通知。
// [KEEP 来自 25.3] 定义子任务身份、角色、状态与说明的观察事件。
export type AgentEvent =
  | { type: "run_start" }
  // [KEEP 来自 25.3] 子会话状态独立于父模型 call 和工具 sequence，不包含子文字增量。
  // [KEEP 来自 29.1] 任务归属由协调者发出，与子会话编号分别显示。
  | { type: "shared_task_state"; taskId: string; workerId: import("../collaboration/coordinator.js").WorkerId; token: number; state: import("../collaboration/coordinator.js").SharedTaskState; detail: string }
  | { type: "child_state"; sessionId: string; parentSessionId: string; role: import("../subagents/runner.js").ChildRole; status: "starting" | "running" | import("../subagents/runner.js").ChildStatus; detail: string }
  // [KEEP 来自 16.3] 摘要准备、候选与实际采用分开；这些事件不能执行工具或修改历史。
  | { type: "compaction_start"; attempt: number }
  | { type: "compaction_candidate"; attempt: number; before: number; after: number; through: number }
  | { type: "compaction_finish"; outcome: "applied"; through: number }
  | { type: "compaction_finish"; outcome: "retained"; message: string }
  // [KEEP 来自 15.1] 估算是下次请求输入的本地预测；usage 是服务商已报告的本轮累计，缺失为 null。
  | { type: "context_budget"; call: number; budget: ContextBudget }
  | { type: "model_usage"; call: number; inputTokens: number | null; outputTokens: number | null; costEstimateUsd: number | null; cachedInputTokens?: number | null; cacheWriteTokens?: number | null }
  | { type: "run_finish"; outcome: "completed"; reply: Reply; diagnostics?: RunDiagnostics }
  | { type: "run_finish"; outcome: "cancelled" | "error"; message: string; diagnostics?: RunDiagnostics }
  // [CHANGED 34.2] 传输重试仍属于同一次模型call，观察事件不能重放工具。
  | ({ type: "model_retry"; call: number } & import("../models/retry.js").RetryNotice)
  | { type: "text_delta"; call: number; text: string }
  // [KEEP 来自 12.4] 核心收取确认带补充 ID、文字和请求次数，不使用工具 sequence。
  | { type: "input_applied"; id: number; text: string; call: number }
  | {
      type: "model_start";
      call: number;
      contextMessages: number;
      trigger: { kind: "user"; content: string } | { kind: "tool_results"; count: number };
    }
  | {
      type: "model_finish";
      call: number;
      // [KEEP 来自 08.2] 停止生成不一定代表回答完成。
      outcome: "tools" | "final" | "empty" | "incomplete";
      finishReason: ModelFinishReason;
      toolRequests: number;
      text: string;
    }
  | { type: "permission_check"; sequence: number; call: ToolCall; decision: PermissionDecision }
  // [KEEP 来自 06.1] 成功事件只额外保存 previewChars，不复制完整预览；原始 call 仍可能包含完整参数。
  // 消费者仍需选择展示字段；不能因为某项只给出字符数，就认为整个事件已经脱敏。
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      previewChars: number;
    }
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    }
  // [KEEP 来自 06.1] 观察者只知道是否有预览；完整文件 diff 或命令预览由审批适配器展示。
  | {
      type: "approval_start";
      sequence: number;
      call: ToolCall;
      scope: string;
      allowSession: boolean;
      hasPreview: boolean;
    }
  | { type: "approval_finish"; sequence: number; call: ToolCall; response: ApprovalResponse }
  // [KEEP 来自 27.1] sequence/callID 从请求顺序固定，不按完成先后重编号。
  // [KEEP 来自 27.3] 屏障发生在所有结果已经按调用顺序提交之后。
  | { type: "tool_batch_finish"; call: number; results: number; interrupted: boolean }
  | { type: "tool_state"; sequence: number; call: ToolCall; state: import("./tool-batch.js").ToolState }
  | { type: "tool_start"; sequence: number; call: ToolCall }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      result: ToolExecutionResult;
    }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    };

export type AgentObserver = (event: AgentEvent) => void;

/**
 * 把已经产生的事件副本交给观察者，捕获观察者直接抛出的异常。
 *
 * - 输入：可选观察者，以及 runAgent 或 Agent Loop 刚刚产生的结构化事件。
 * - 输出：观察者存在时同步收到一份深拷贝；不存在时直接返回。
 * - 关键原因：structuredClone 防止观察者通过事件对象修改原工具请求或结果。
 * - 失败方式：拷贝失败或观察者直接抛错时在这里结束通知，不把该异常继续抛给核心。
 * - 职责边界：拷贝不隐藏敏感信息，也不隔离耗时；观察者显式触发取消信号仍会影响本轮执行。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 这里只捕获通知过程抛出的异常；观察者触发的取消信号仍由执行链正常处理。
  }
}
```

</details>

<!-- build-file: src/diagnostics/logger.ts -->
<details>
<summary>src/diagnostics/logger.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] diagnostics/logger.ts
 *
 * 学习目标：从富事件中只提取诊断需要的编号、状态、耗时和数量。
 * 输入：本轮本地 UUID、事件，以及可选日志目录；输出：JSONL 与最终保存状态。
 * 状态：计时和计数只属于本轮；任何磁盘错误只降低 complete，不改变任务结果。
 * 本文件局部流程：创建独占文件 -> 白名单投影 -> 有界追加 -> 最终记录 -> 关闭。
 * 分支：增量不落盘；普通记录超限停止追加；失败不抛出或复制原始错误。
 * 观察：日志没有提示词、工具参数、正文、路径或远端错误；失败仍保留原任务成果。
 */
// [KEEP 来自 34.1] 不序列化原始事件，文件只接收本地生成的白名单对象。
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.js";

export type RunDiagnostics = { runId: string; path?: string; complete: boolean };
type Fields = Record<string, string | number | boolean | null>;
const MAX_RECORDS = 10_000;

/**
 * 提取数字和封闭枚举；不保留远端文本、工具名或原始调用 ID。
 * 未列出的事件只记录种类；text_delta 连种类也不逐片记录，避免长输出膨胀。
 */
function project(event: AgentEvent): Fields {
  const data: Fields = { event: event.type };
  if ("call" in event && typeof event.call === "number") data.call = event.call;
  if ("sequence" in event) data.toolSequence = event.sequence;
  if ("outcome" in event) data.outcome = event.outcome;
  // [CHANGED 34.2] 白名单只留重试数字和封闭类别，不记录原始错误。
  if (event.type === "model_retry") { data.attempt = event.attempt; data.delayMs = event.delayMs; data.kind = event.kind; }
  if (event.type === "model_start") data.contextMessages = event.contextMessages;
  if (event.type === "model_finish") {
    data.finishReason = event.finishReason;
    data.toolRequests = event.toolRequests;
    data.textChars = event.text.length;
  }
  if (event.type === "model_usage") {
    data.inputTokens = event.inputTokens; data.outputTokens = event.outputTokens;
    data.cachedInputTokens = event.cachedInputTokens ?? null;
    data.cacheWriteTokens = event.cacheWriteTokens ?? null;
  }
  if (event.type === "tool_finish" && event.outcome === "success") {
    data.contentChars = event.result.content.length;
    data.isError = Boolean(event.result.isError);
    if (event.result.metadata.kind === "run_command") {
      data.exitCode = event.result.metadata.exitCode;
      if (event.result.metadata.stopReason) data.stopReason = event.result.metadata.stopReason;
    }
  }
  if (event.type === "tool_batch_finish") {
    data.results = event.results; data.interrupted = event.interrupted;
  }
  return data;
}

/**
 * 打开本轮诊断文件并返回同步的小记录写入器，创建失败也返回可用的空写入器。
 * runId 由运行层生成 UUID；文件独占创建且权限0600，日志目录可供隔离测试注入。
 * 普通记录上限10,000，结束记录另有一个位置；finish等待本地写入关闭后报告状态。
 * 同步记录不等于事务或fsync；崩溃掉电仍可能缺少尾部，日志也不恢复任务执行权。
 */
export function openRunLog(runId: string, directory = join(homedir(), ".hello-my-agent", "logs")) {
  const start = performance.now(), starts = new Map<string, number>();
  let fd: number | undefined, path: string | undefined, complete = true, sequence = 0, finished = false;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    path = join(directory, `${runId}.jsonl`);
    fd = openSync(path, "wx", 0o600);
  } catch { path = undefined; complete = false; }

  /** 追加投影后的单行，写盘错误只标记诊断不完整，绝不抛给任务。 */
  function record(event: AgentEvent): void {
    if (finished || event.type === "text_delta") return;
    const elapsedMs = Math.round(performance.now() - start);
    const key = event.type.startsWith("model_") && "call" in event ? `model:${event.call}`
      : "sequence" in event ? `tool:${event.sequence}` : undefined;
    if (key && (event.type === "model_start" || event.type === "tool_start")) starts.set(key, elapsedMs);
    const fields = project(event);
    if (key && (event.type === "model_finish" || event.type === "tool_finish") && starts.has(key)) {
      fields.durationMs = elapsedMs - starts.get(key)!; starts.delete(key);
    }
    if (event.type !== "run_finish" && sequence >= MAX_RECORDS) { complete = false; return; }
    if (event.type === "run_finish") fields.logComplete = complete;
    const line = JSON.stringify({ version: 1, runId, sequence: ++sequence, elapsedMs, ...fields }) + "\n";
    if (fd !== undefined) {
      try {
        const bytes = Buffer.from(line);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error("日志写入没有推进");
          offset += written;
        }
      } catch { complete = false; }
    }
  }

  /** 结束记录落盘后关闭句柄，返回真实保存状态；重复finish不重复写入。 */
  function finish(event: Extract<AgentEvent, { type: "run_finish" }>): RunDiagnostics {
    if (!finished) {
      record(event); finished = true;
      if (fd !== undefined) { try { closeSync(fd); } catch { complete = false; } }
    }
    return { runId, ...(path ? { path } : {}), complete };
  }
  return { record, finish };
}
```

</details>

<!-- build-file: src/models/client.ts -->
<details>
<summary>src/models/client.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] models/client.ts
 *
 * 学习目标：每次请求读取同一组能力对象，整轮运行持有扩展使用票据。
 * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
 * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
 * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   本地来源台账 -> 只列编号/类型的提示 -> 同时用于估算与 generate；正文仍由 tool 消息携带
 *   [KEEP] 请求流 -> 文字片段 -> onText
 *                  +-> 完整消息 -> 归一化结束原因
 *   OpenAI 工具参数 -> SDK 累积的完整字符串 ------------------+
 *   Anthropic 参数 -> 按内容块 index 保存原始 JSON 片段         |
 *                  -> message_stop 与片段顺序有效？-- 否 -> 抛错
 *                                                 +-- 是 ----+
 *   完整结果 -> 正常文本或工具结束？-- 否 -> 返回结束原因，不返回工具
 *                                  +-- 是 -> 检查支持的工具类型与参数
 *   每个调用 ID 非空且批内唯一、参数为完整 JSON 对象？-- 否 -> 整批抛错
 *                                                     +-- 是 -> 返回 ModelResult
 *   请求、解析、超时或取消失败 -> 抛错，不返回半份结果
 *
 * [KEEP] 表示沿用前节。SDK 的流中途对象可能来自部分 JSON 解析，不能证明参数已经完整。
 * Anthropic 的执行参数来自本地累积的原始字符串；内容块结束后仍要通过 JSON.parse。
 * 这些检查只确认协议和 JSON 对象形状；字段值、路径与审批仍由已有工具和权限代码负责。
 * 每次 generate 的 60 秒总期限覆盖最多三次尝试和退避；已有文字不重发，失败不改历史或启动工具。
 *
 * [KEEP 来自 12.1] 每次请求使用本轮模式；Plan 隐藏写入、编辑和命令工具，提示只调查和计划。
 * 筛选工具帮助模型选择；permissions/policy.ts 的硬拒绝才保证禁止请求不会执行。
 * [KEEP 来自 12.2] 提示模型使用 todo_write 报告进度；这不会把报告变成测试证明。
 * [KEEP 来自 12.3] 提示模型用 ask_user 澄清重要缺失信息，并在 Plan 的可见列表中保留它。
 * 运行观察：来源编号提示会随实际取得的来源更新；预算估算与 generate 使用相同提示，存在编号不证明引用语义正确。
 */

// [KEEP 来自 18.1] 记忆快照由明确任务边界刷新，估算和发送读取同一字符串。
// [KEEP 来自 19.1] 目录和正文由本地会话持有；组装提示不读取磁盘。
import { skillPrompt, type SkillState } from "../skills/catalog.js";
import type { MemoryController } from "../memory/commands.js";
// [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
import { createAttachmentState, type AttachmentRef, type AttachmentState } from "../attachments/store.js";
// [KEEP 来自 26.1] 会话级进程所有权不在消息或会话文件里。
// [KEEP 来自 28.1] text/TUI共用同一模型对象持有的会话工作区登记。
// [KEEP 来自 29.1] createModel为整个CLI会话持有单一协调者。
// [KEEP 来自 32.2] 构造客户端不启动语言服务器。
import { LanguageService } from "../language-service/client.js";
import { SharedCoordinator } from "../collaboration/coordinator.js";
import { WorktreeManager } from "../workspaces/worktrees.js";
import { JobManager } from "../processes/jobs.js";
// [CHANGED 34.2] 重试只包住协议请求，不包住Agent Loop或工具。
import { withModelRetry, type RetryNotice } from "./retry.js";
import { safeModelError } from "./model-errors.js";
import { createProtocolAdapter, SUMMARY_PROMPT, type ModelProfile } from "./protocol.js";
import { readConfig, systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
// [KEEP 来自 21.1] 动态定义与预算、两种模型协议使用同一份列表。
// [KEEP 来自 22.1] 网络工具和本地工具共用请求定义、预算与Plan过滤。
import { webDefinitions, webPrompt, type WebState } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import type { McpState } from "../mcp/client.js";
import type { ToolDefinition } from "../tools/types.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ExecutionMode } from "../agent/run-options.js";
import { DEFAULT_CONTEXT_LIMITS, estimateContext, estimateCostUsd, type ContextBudget, type ContextLimits } from "../context/budget.js";

// [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
export type Message =
  | { role: "user"; content: string; attachments?: AttachmentRef[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };

export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
};
// [KEEP 来自 08.2] 把两种接口的结束原因转成核心可以统一判断的值。
export type ModelFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "unsupported";
// [KEEP 来自 08.2] 完整结果同时携带结束原因，主循环据此决定是否继续。
export type ModelResult = Reply & { toolCalls: ToolCall[]; finishReason: ModelFinishReason };

// [KEEP 来自 23.3] 只记录请求异常的本地边界，不改错误对象或 Model 接口；旧测试模型未标记时保守视为可能已发送。
const failedRequestStarts = new WeakMap<object, boolean>();
export function requestFailedBeforeSending(error: unknown): boolean {
  return typeof error === "object" && error !== null && failedRequestStarts.get(error) === false;
}
async function trackRequest<T>(operation: (onRequestStart: () => void) => Promise<T>): Promise<T> {
  let started = false;
  try { return await operation(() => { started = true; }); }
  catch (error) {
    if (typeof error === "object" && error !== null) failedRequestStarts.set(error, started);
    throw error;
  }
}

/**
 * 核心使用的统一模型接口。
 * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
 * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
 */
export type ModelRequestScope = { allowedTools?: readonly string[]; rolePrompt?: string };

export interface Model {
  // [KEEP 来自 26.1] 单轮结束保留registry；整次CLI退出才close。
  readonly jobs?: import("../processes/jobs.js").JobManager;
  // [KEEP 来自 28.1] 不随消息持久化，也不导入旧CLI的Git目录。
  readonly worktrees?: WorktreeManager;
  // [KEEP 来自 29.1] 不从会话JSON恢复控制权。
  readonly sharedTasks?: SharedCoordinator;
  // [KEEP 来自 32.2] 同一CLI会话共用，退出时由CLI关闭。
  readonly languageService?: LanguageService;
  // [KEEP 来自 31.2] 显式本地扩展入口，不属于模型工具。
  readonly extensions?: import("../extensions/manager.js").ExtensionManager;
  // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
  // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
  // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
  // [KEEP 来自 22.1] 网页启用只来自本次启动。
  readonly attachments?: AttachmentState;
  readonly profile?: ModelProfile;
  beginRun?(): () => void;
  command?(text: string): { ok: boolean; message: string };
  readonly web?: WebState;
  readonly mcp?: McpState;
  readonly hooks?: import("../hooks/lifecycle.js").HookState;
  readonly memory?: MemoryController;
  // [KEEP 来自 19.1] 后续节本地命令与模型工具复用同一份技能状态。
  readonly skills?: SkillState;
  // [KEEP 来自 17.1] 来源是本地启动信息，不是模型接收确认。
  readonly projectInfo?: readonly string[];
  // [KEEP 来自 16.2] 摘要使用独立、无工具的请求，先估算其输入，返回完整结果才考虑采用。
  inspectSummary?(source: string): ContextBudget;
  summarize?(source: string, signal: AbortSignal): Promise<ModelResult>;
  // [KEEP 来自 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
  inspectContext?(messages: Message[], mode?: ExecutionMode, scope?: ModelRequestScope): ContextBudget;
  estimateCost?(input: number | null, output: number | null): number | null;
  // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  // [KEEP 来自 12.1] 模式参数只影响本轮请求组装，本地权限策略还会再次检查。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void,
    options?: { mode?: ExecutionMode; onRetry?: (notice: RetryNotice) => void } & ModelRequestScope): Promise<ModelResult>;
}

/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：Model 可在本地估算请求；创建对象和 inspectContext 都不发送 HTTP，generate 才发送。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志；本地重试只包住当前模型请求，最终失败仍交回外层。
 */
// [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController, skills?: SkillState, hooks?: import("../hooks/lifecycle.js").HookState, mcp?: McpState, web?: WebState, extensions?: import("../extensions/manager.js").ExtensionManager): Model {
  // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
  const projectPrompt = project ? projectInstructionPrompt(project) : "";
  const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
  const attachments = createAttachmentState();
  // [KEEP 来自 26.1] createModel一次创建，后续run共用；不会从历史加载PID。
  const jobs = new JobManager();
  // [KEEP 来自 28.1] 创建管理器不创建Git工作区，副作用必须等工具批准。
  const worktrees = new WorktreeManager();
  // [KEEP 来自 29.1] 本地构造，不接受模型配置worker数或租约。
  const sharedTasks = new SharedCoordinator();
  const languageService = new LanguageService();
  let adapter = createProtocolAdapter(config);
  let activeRequests = 0;
  // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  // [KEEP 来自 12.1] 适配层将模式传给请求组装，沿用原取消和期限处理。
  let limits = config.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
  // [KEEP 来自 16.2] 专用摘要不继承执行工具；输出预留也计入摘要自己的本地预算。
  const summaryLimits = () => ({ ...limits, outputReserve: Math.min(limits.outputReserve, 2048) });
  return {
    // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
    // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
    memory, skills, hooks, mcp, web, attachments, jobs, worktrees, sharedTasks, languageService, extensions,
    get profile() { return structuredClone(adapter.profile); },
    beginRun() {
      const releaseExtensions = extensions?.beginUse();
      activeRequests += 1; let released = false;
      return () => { if (!released) { released = true; activeRequests -= 1; releaseExtensions?.(); } };
    },
    command(text) {
      if (activeRequests) return { ok: false, message: "任务正在进行；本次切换未执行，请在空闲时重试。" };
      const match = /^\/model(?: (openai|anthropic) ([^\s]{1,200})(?: (images|text))?)?$/.exec(text.trim());
      if (!match) return { ok: false, message: "用法：/model；/model <openai|anthropic> <模型ID> [images|text]。" };
      if (match[1]) {
        try {
          // 重新读取目标协议专用凭据，不继承旧连接的密钥、地址或价格。
          const candidate = readConfig({ provider: match[1], model: match[2] });
          if (match[3]) candidate.imageInput = match[3] === "images";
          const next = createProtocolAdapter(candidate);
          adapter = next; limits = candidate.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
        } catch (error) { return { ok: false, message: error instanceof UserFacingError ? error.message : "模型配置无法创建，旧连接保留。" }; }
      }
      const profile = adapter.profile;
      return { ok: true, message: `当前模型：${profile.provider}/${profile.model}；工具/流式：启用；图片：${profile.capabilities.images ? "本地声明支持" : "未声明支持"}。能力声明仍需服务端验证；历史保留，预算随连接更新。` };
    },
    projectInfo,
    inspectSummary(source) {
      return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits());
    },
    async summarize(source, signal) {
      return trackRequest(async onRequestStart => {
        signal.throwIfAborted();
        const messages: Message[] = [{ role: "user", content: source }];
        if (!estimateContext(messages, SUMMARY_PROMPT, [], summaryLimits()).withinBudget) throw new UserFacingError("摘要请求本身超出本地预算，未发送。");
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          return await adapter.summarize(source, AbortSignal.any([signal, deadline]), summaryLimits().outputReserve, onRequestStart);
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("摘要超过 60 秒，候选未采用；不会自动重试同一段内容。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
    inspectContext(messages, mode = "execute", scope = {}) {
      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web) + (scope.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], scope.allowedTools);
      return estimateContext(messages, prompt, definitions, limits);
    },
    estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
    async generate(messages, signal, onText, options = {}) {
      return trackRequest(async onRequestStart => {
        // [KEEP 来自 15.3] 直接调用模型适配器也执行相同门槛，避免绕过 Agent Loop 发出超本地预算的请求。
        signal.throwIfAborted();
        // [KEEP 来自 19.1] 本次请求固定相同字符串；加载工具完成后下一次请求才重组正文。
        // [KEEP 来自 22.3] 估算和真实发送共用同份已登记来源提示。
        const references = projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web);
        const { prompt, definitions } = requestParts(options.mode ?? "execute", references + (options.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], options.allowedTools);
        const budget = estimateContext(messages, prompt, definitions, limits);
        if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          // [CHANGED 34.2] 任何已交付文字都会封闭自动重发，所有尝试共享总期限。
          const requestSignal = AbortSignal.any([signal, deadline]);
          let deliveredText = false;
          const { result, attempts } = await withModelRetry(() => adapter.generate(messages, requestSignal, text => {
            if (text.length) deliveredText = true;
            onText?.(text);
          }, { prompt, definitions, limits, onRequestStart }), requestSignal, () => !deliveredText, options.onRetry);
          // 失败尝试的usage可能未知，不能用最后一次成功的用量冒充整项消耗。
          return attempts === 1 ? result : { ...result, inputTokens: null, outputTokens: null,
            cachedInputTokens: null, cacheWriteTokens: null };
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
  };
}

/**
 * 为估算与真实发送生成同一套系统提示和可见工具，避免估算漏掉隐藏的请求部分。
 * 模式在本轮固定；这里仅组织数据，不探测服务商窗口，也不产生权限批准。
 */
// [KEEP 来自 21.1] 扩展列表只由本地已建立连接提供。
function requestParts(mode: ExecutionMode, projectPrompt = "", external: ToolDefinition[] = [], allowedTools?: readonly string[]): { prompt: string; definitions: ToolDefinition[] } {
  // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
  // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
  // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
  // [KEEP 来自 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
  const definitions = mode === "plan"
    // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
    ? toolDefinitions.filter((tool) => ["code_intelligence", "read_shared_tasks", "read_worktree", "read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
    : [...toolDefinitions, ...external];
  // [KEEP 来自 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
  const prompt = systemPrompt + " 共享调查先create_shared_tasks登记，再run_shared_tasks等待真实只读子会话。read_shared_tasks查看本地状态；摘要、todo或消息不能更改共享任务终态。" + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
    ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
    : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
  return { prompt: prompt + projectPrompt, definitions: allowedTools ? definitions.filter(tool => allowedTools.includes(tool.name)) : definitions };
}
```

</details>

<!-- build-file: src/models/model-errors.ts -->
<details>
<summary>src/models/model-errors.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] models/model-errors.ts
 *
 * 学习目标：用可处理的错误类别解释失败，避免把服务商原文中的凭据输出。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：SDK错误 -> status/连接类型分类 -> 安全文案；本模块不发请求
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { UserFacingError } from "../errors.js";
export type ModelErrorKind = "authentication" | "rate_limit" | "request" | "unavailable" | "connection" | "unknown";

/**
 * 只读状态、SDK连接类型与有限层cause中的网络错误码，不打印远端message、请求头或URL。
 * 分类不表示请求可以安全重放；流已经交付文字时，调用者仍禁止重试。
 * 本地预算与协议校验的 UserFacingError 由调用方保留，真正取消优先保留原 signal.reason。
 */
export function classifyModelError(error: unknown): ModelErrorKind {
  const value = error && typeof error === "object" ? error as { status?: unknown; name?: unknown } : {};
  const status = value.status;
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "unavailable";
  if (typeof status === "number" && status >= 400) return "request";
  // [CHANGED 34.2] SDK的APIConnectionError.name可能只是Error，不能只靠名字识别。
  if (error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError) return "connection";
  let cause: unknown = error;
  for (let depth = 0; depth < 3 && cause && typeof cause === "object"; depth++) {
    const item = cause as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
      "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT"].includes(item.code)) return "connection";
    cause = item.cause;
  }
  if (typeof value.name === "string" && /Connection|Timeout|Abort/.test(value.name)) return "connection";
  return "unknown";
}

/**
 * 返回不包含服务端原文的错误。
 * 不会替调用方重发可能已经消耗 token 的请求。
 */
export function safeModelError(error: unknown): UserFacingError {
  if (error instanceof UserFacingError) return error;
  const messages: Record<ModelErrorKind, string> = {
    authentication: "模型认证或访问权限失败，请核对当前协议专用密钥。",
    rate_limit: "模型服务限流或配额不足，请核对配额后再自行重试。",
    request: "模型服务拒绝请求，请核对模型ID、工具/图片能力与上下文限制。",
    // [CHANGED 34.2] 最终失败不冒充从未尝试重发；摘要仍没有自动重试。
    unavailable: "模型服务暂时不可用，允许的重试已结束或当前请求不宜重发。",
    connection: "模型连接中断或超时，已接收片段不是完整回答。",
    unknown: "模型请求失败，未取得可执行的完整结果。",
  };
  return new UserFacingError(messages[classifyModelError(error)]);
}
```

</details>

<!-- build-file: src/models/retry.ts -->
<details>
<summary>src/models/retry.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [NEW] models/retry.ts
 *
 * 学习目标：把重试限制为一次模型传输，不接触工具、历史或审批。
 * 输入：请求闭包、同一个总期限信号、仍可重发的判断与安全观察回调。
 * 输出：完整结果和尝试次数；认证、请求、未知、本地错误及已交付文字不重试。
 * 本文件局部流程：尝试 -> 成功返回；失败分类 -> 可重发且未满3次？-> 可取消退避 -> 重试。
 * 状态：等待也接收取消；失败保留原原因；不承诺远端恰好处理一次或免于重复计费。
 * 观察：第2/3次尝试仍属于同一个模型决策，只有完整结果才能进入后续工具流程。
 */
// [NEW 34.2] SDK内部重试仍关闭；本函数是唯一显式重试层。
import { setTimeout as delay } from "node:timers/promises";
import { UserFacingError } from "../errors.js";
import { classifyModelError, type ModelErrorKind } from "./model-errors.js";

export type RetryNotice = { attempt: number; delayMs: number; kind: ModelErrorKind };

/**
 * 最多尝试三次；500ms基数按2倍增长，再加入0至同等基数的抖动。
 * shouldRetry由调用者判断是否已经显示文字；signal同时约束请求和等待。
 * settings只供本地测试缩短退避和固定随机数，模型输入不能控制策略。
 * 不解析Retry-After；回调故障不改变请求结果，取消则抛出signal原始reason。
 */
export async function withModelRetry<T>(
  operation: () => Promise<T>, signal: AbortSignal, shouldRetry: () => boolean,
  onRetry?: (notice: RetryNotice) => void,
  settings: { baseDelayMs?: number; random?: () => number } = {},
): Promise<{ result: T; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await operation();
      signal.throwIfAborted();
      return { result, attempts: attempt };
    } catch (error) {
      signal.throwIfAborted();
      const kind = classifyModelError(error);
      if (attempt >= 3 || error instanceof UserFacingError || !shouldRetry()
        || !["rate_limit", "unavailable", "connection"].includes(kind)) throw error;
      const base = (settings.baseDelayMs ?? 500) * 2 ** (attempt - 1);
      const delayMs = Math.round(base * (1 + (settings.random ?? Math.random)()));
      try { onRetry?.({ attempt: attempt + 1, delayMs, kind }); } catch { /* 观察故障不产生新决策。 */ }
      try { await delay(delayMs, undefined, { signal }); }
      catch (waitingError) { signal.throwIfAborted(); throw waitingError; }
    }
  }
}
```

</details>

<!-- build-file: src/ui/teaching-trace.ts -->
<details>
<summary>src/ui/teaching-trace.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] ui/teaching-trace.ts
 *
 * 学习目标：展示工作区比较双方的固定版本与当前评审有效性，使过期批准可见。
 * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
 * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 事件 -> run_start / run_finish？-- 是 -> 空数组，结果由调用方处理
 *                                             +-- 否 -> text_delta？-- 是 -> 空数组，正文由 renderer 追加
 *                                                                   +-- 否 -> 按事件类型选择字段
 *   字段 -> 控制字符清理、常见凭据特征隐藏与长度限制 -> 返回文本行
 *
 * run_finish 只提供整轮结果，不需要再打印一次最终正文；model_finish 仍解释单次决策的结果。
 * 工具状态来自元数据，命令退出码非零是失败，stderr 有字不能单独证明失败。
 * stdout/stderr 摘要各保留前 240 个清理后字符，超出再加省略号，不改变交给模型的工具正文。
 * 常见凭据检测不等于完整脱敏；原始事件仍可能包含敏感内容，不能直接作为公开日志。
 *
 * [KEEP 来自 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：工具状态与整批事件决定轨迹行；摘要不改变原工具结果或下一次模型输入。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";

const MAX_TRACE_VALUE_CHARS = 60;

/**
 * 把不可信文字转换成可以放进单行终端记录的短文本。
 *
 * - 输入：用户问题、工具参数或路径，以及本次允许的最大字符数。
 * - 输出：移除控制字符、合并空白、隐藏常见凭据特征并按长度截断的字符串。
 * - 职责边界：只处理界面副本，不修改 Agent Event 中的原始值。
 */
function toTraceText(value: string, maxChars = MAX_TRACE_VALUE_CHARS): string {
  // [KEEP 来自 07.1] 只整理显示副本，不改变原始命令或工具结果。
  const oneLine = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (/secret|api[\s_-]?key|token|password|authorization/i.test(oneLine)) return "[已隐藏]";
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

/**
 * 根据本地工具 Schema 生成名称和参数摘要。
 *
 * - 输入：事件中的原始 ToolCall。
 * - 输出：已注册工具只显示 Schema 声明的字段；未知工具使用固定名称且不展示参数。
 * - 显示边界：解析失败和超长参数不展开；控制字符及常见凭据特征会被处理，不保证识别所有敏感信息。
 */
function describeToolCall(call: ToolCall): { name: string; input: string } {
  const definition = toolDefinitions.find((tool) => tool.name === call.name);
  // [KEEP 来自 21.1] 扩展参数仅在审批面板完整显示，过程记录不猜测外部Schema。
  if (!definition) return { name: call.name.startsWith("mcp__") || call.name.startsWith("web_") ? toTraceText(call.name) : "未知工具", input: "参数见本次审批" };
  if (call.arguments.length > 1000) return { name: definition.name, input: "参数无法解析" };

  let input: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(call.arguments);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { name: definition.name, input: "参数无法解析" };
    }
    input = value as Record<string, unknown>;
  } catch {
    return { name: definition.name, input: "参数无法解析" };
  }

  const fields = Object.keys(definition.inputSchema.properties).map((key) => {
    const value = input[key];
    // [KEEP 来自 06.1] 这里只投影终端摘要；原始 AgentEvent.call.arguments 仍保留完整参数。
    // 文件正文改为字符数，其他文字还会经过控制字符清理、限长和凭据隐藏。
    if (["content", "old_text", "new_text"].includes(key) && typeof value === "string") {
      return `${key}=<${value.length} 字符>`;
    }
    if (typeof value === "string") return `${key}=${JSON.stringify(toTraceText(value))}`;
    if (typeof value === "number" || typeof value === "boolean") return `${key}=${value}`;
    return `${key}=<无效>`;
  });
  return { name: definition.name, input: fields.join("，") };
}

/**
 * 把工具自己的元数据变成终端摘要，不从模型回答反推执行情况。
 *
 * 文件工具提供路径、位置和数量；命令还提供退出码、信号、停止原因及两条输出。
 * 返回值只给终端显示，输出会清理、限长并隐藏常见凭据特征；不改工具 content。
 * 命令是否失败由结果的 isError 交给外层决定，这里不会因为 stderr 有文字就改判结果。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  // [KEEP 来自 29.1] 只显示结构化归属，不从模型文字推断成功。
  if (metadata.kind === "shared_tasks") return metadata.tasks.map(task => `${toTraceText(task.id, 60)}：${task.state} · ${task.owner ?? "未认领"} · token ${task.token}`).join("；");
  // [KEEP 来自 29.3] ack只代表收件人确认。
  if (metadata.kind === "agent_messages") return metadata.messages.map(item => `${item.id} · ${item.from}→${item.to} · ack=${item.acknowledged}`).join("；") || "本轮没有未确认消息";

  // [KEEP 来自 12.3] 回答是工具结果，不当作文件内容。
  // [KEEP 来自 12.3] 澄清结果显示已答或未答，不当作文件结果。
  // [KEEP 来自 18.2] 保存结果只报告已落盘编号，不声称本次请求已加载。
  // [KEEP 来自 19.3] 来源与版本直接来自结构化结果；资源正文仍回原工具消息。
  // [KEEP 来自 21.1] 来源取真实映射，正文仍显示在工具详情。
  // [KEEP 来自 22.1] 界面来源来自结构化真实响应，不从网页正文猜测。
  // [KEEP 来自 28.1] 直接显示结构化Git身份；控制字符仍只影响显示副本。
  // [KEEP 来自 28.2] 比较目标、当前HEAD与被审SHA，明确旧批准是否仍有效。
  if (metadata.kind === "worktree") {
    const item = metadata.worktree;
    return item ? `WorktreeID ${toTraceText(item.id, 36)}；${item.state}；目录 ${toTraceText(item.path, 200)}；分支 ${toTraceText(item.branch, 100)}；base ${item.baseSha}；HEAD ${item.headSha ?? "未知"}；目标 ${toTraceText(item.currentTargetBranch, 100)}@${item.targetSha ?? "未知"}；dirty ${item.dirty} / 目标dirty ${item.targetDirty}；被审SHA ${item.review?.reviewedSha ?? "无"}；批准有效 ${item.reviewValid}` : "当前CLI工作区登记列表";
  }
  if (metadata.kind === "subagent") return `子任务 ${metadata.result.role}：${metadata.result.status}；会话 ${metadata.result.sessionId}`;
  if (metadata.kind === "web") return `网页 ${metadata.sources.length} 个来源 · ${metadata.bytes} 字节${metadata.truncated ? " · 文本截断" : ""}`;
  if (metadata.kind === "mcp") return `MCP ${toTraceText(metadata.server)}/${toTraceText(metadata.tool)}`;
  if (metadata.kind === "load_skill" || metadata.kind === "read_skill_resource") return `${metadata.kind === "load_skill" ? "已加载正文" : "已读取资源"} ${toTraceText(metadata.name)}；来源 ${toTraceText(metadata.path, 160)}；${metadata.bytes} 字节；SHA256 ${toTraceText(metadata.sha256, 64)}`;
  if (metadata.kind === "memory") return `记忆已保存 ${metadata.id}；下一项用户任务加载`;
  if (metadata.kind === "ask_user") return metadata.answer === null ? "用户未回答本次澄清" : `已收到回答：${toTraceText(metadata.answer, 120)}`;
  // [KEEP 来自 12.2] 内存任务没有文件行数。
  // [KEEP 来自 12.2] 显示清单报告的数量，不把 completed 解释为测试通过。
  if (metadata.kind === "todo_write") return `任务清单：${metadata.items.length} 项，${metadata.items.filter((item) => item.status === "completed").length} 项已完成`;
  // [KEEP 来自 06.3] 只在工具成功事件中显示经过结构化元数据传来的备份路径；
  // 内容过期检测或备份失败走错误分支，不伪装成成功结果。
  // [KEEP 来自 07.1] 用退出码判断命令状态，stdout/stderr 分开显示。
  if (metadata.kind === "run_command") {
    return `退出码 ${metadata.exitCode ?? "无"}${metadata.signal ? `；信号 ${metadata.signal}` : ""}`
      + `${metadata.stopReason ? `；${metadata.stopReason === "timeout" ? "运行超时" : "输出超过上限"}` : ""}`
      + `\n  stdout：${metadata.stdout ? toTraceText(metadata.stdout, 240) : "（空）"}`
      + `\n  stderr：${metadata.stderr ? toTraceText(metadata.stderr, 240) : "（空）"}`;
  }
  if (metadata.kind === "edit_file") {
    return `已精确修改 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）；备份：${toTraceText(metadata.backupPath, 120)}`;
  }
  if (metadata.kind === "write_file") {
    return `已创建 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）`;
  }
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }
  if (metadata.kind === "grep") {
    const examples = metadata.locations.slice(0, 2)
      .map(({ path, line, column }) => `${toTraceText(path)}:${line}:${column}`)
      .join("，");
    return `${metadata.count} 个匹配位置${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  if (metadata.kind !== "read_file" || metadata.lineCount === 0 || !("startLine" in metadata)) return "0 行文件内容";
  return `${metadata.lineCount} 行源码（第 ${metadata.startLine}—${metadata.endLine} 行）`;
}

/**
 * 把一个结构化事件整理成终端能逐行显示的简短说明。
 *
 * - 输入：来自 runAgent 或 Agent Loop 的 AgentEvent。
 * - 输出：模型、权限和工具步骤返回纯文本行；run_start、run_finish 和 text_delta 返回空数组。
 * - 关键原因：整轮结果由调用方处理，文字片段由 renderer 追加，重复排版会把同一回答打印两次。
 * - 显示规则：工具状态来自元数据，参数与摘要经过字段筛选、控制字符处理和长度限制。
 * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
 */
// [KEEP 来自 25.3] 把子状态转换成可读过程说明。
export function formatTeachingTrace(event: AgentEvent): string[] {
  // [KEEP 来自 29.1] 与工具sequence无关，安全处理任务ID显示。
  if (event.type === "shared_task_state") return [`共享任务 ${toTraceText(event.taskId, 60)}：${event.state} · ${event.workerId} · token ${event.token} · ${toTraceText(event.detail, 160)}`];
  if (event.type === "child_state") return [`子任务 ${event.role} ${event.sessionId}：${event.status} · ${toTraceText(event.detail, 160)}`];
  // [KEEP 来自 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
  if (event.type === "compaction_start") return [`正在压缩旧记录：本项任务第 ${event.attempt}/2 次摘要准备，完整记录保留。`];
  if (event.type === "compaction_candidate") return [`摘要候选：输入估算 ${event.before} → ${event.after}，覆盖前 ${event.through} 条；尚未采用。`];
  if (event.type === "compaction_finish") return [event.outcome === "applied"
    ? `压缩已采用：摘要覆盖前 ${event.through} 条，请求预算已通过；完整记录仍保留。`
    : `压缩未采用：${toTraceText(event.message, 160)}`];
  // [KEEP 来自 15.1] 估算和已报告用量使用不同标签；它们没有工具 sequence。
  if (event.type === "context_budget") {
    const b = event.budget;
    return [`第 ${event.call} 次请求 · 本地估算：输入约 ${b.inputEstimate} + 输出预留 ${b.outputReserve} / 窗口 ${b.windowTokens} token；余量约 ${b.remainingEstimate}（可能与服务商不同）`];
  }
  if (event.type === "model_usage") return [`服务商报告本轮累计：输入 ${event.inputTokens ?? "未知"} / 输出 ${event.outputTokens ?? "未知"} token；`
    + `缓存读取 ${event.cachedInputTokens ?? "未知"} / 写入 ${event.cacheWriteTokens ?? "未知"} token；`
    + (event.costEstimateUsd === null ? "费用未估计（用量或本地单价缺失）" : `费用估计 $${event.costEstimateUsd.toFixed(6)}（按本地单价，非账单）`)];
  // [KEEP 来自 09.1] 整轮事件供界面判断任务状态，不重复打印最终正文。
  // [KEEP 来自 34.1] 不重复回答正文，只显示本轮诊断关联与真实保存状态。
  if (event.type === "run_finish") return event.diagnostics
    ? [`诊断 ${event.diagnostics.runId}：${toTraceText(event.diagnostics.path ?? "未创建文件", 1000)}${event.diagnostics.complete ? "" : "（未完整保存）"}`] : [];
  if (event.type === "run_start") return [];
  // [KEEP 来自 08.1] 连续文字由终端追加，不能每段都包装成一行日志。
  if (event.type === "text_delta") return [];
  // [KEEP 来自 12.4] 在通用工具分支前处理补充确认。
  // [KEEP 来自 12.4] 在工具分支前显示核心收取确认，不声称远端收到。
  if (event.type === "input_applied") return [`补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${toTraceText(event.text, 120)}`];
  // [CHANGED 34.2] 明确这是同一请求的下一次尝试，不能理解为又执行了一轮工具。
  if (event.type === "model_retry") return [`模型第 ${event.call} 次决策：${event.kind}，等待 ${event.delayMs}ms 后开始第 ${event.attempt}/3 次尝试。`];
  if (event.type === "model_start") {
    const received = event.trigger.kind === "user"
      ? `新增用户问题「${toTraceText(event.trigger.content, 100)}」`
      : `新增 ${event.trigger.count} 条工具结果`;
    return [
      `模型 > 第 ${event.call} 次决策`,
      `  收到：${received}；Agent Loop 消息链共 ${event.contextMessages} 条。`,
    ];
  }

  if (event.type === "model_finish") {
    const result = event.outcome === "tools"
      ? `${event.toolRequests} 个工具请求。`
      // [KEEP 来自 08.2] 已经看到文字，也可能仍是未完成的响应。
      : event.outcome === "incomplete"
        ? `响应未完成（${event.finishReason}），本次响应中的工具不会执行。`
      : event.outcome === "final"
        ? "最终回答，交给终端显示。"
        : "空结果，本轮将停止并报告错误。";
    return [`模型 < 第 ${event.call} 次决策`, `  返回：${result}`];
  }

  // [KEEP 来自 27.3] 单项完成事件可乱序，整批收齐后才继续模型。
  if (event.type === "tool_batch_finish") return [`[工具批 ${event.call}] ${event.results} 项观察已收齐${event.interrupted ? "；本轮中断" : "，交回模型"}`];
  if (event.type === "permission_check") {
    const tool = describeToolCall(event.call);
    const decision = event.decision.action === "allow"
      ? "允许执行"
      : event.decision.action === "ask"
        ? "需要用户确认"
        : "拒绝执行";
    return [
      `权限 < 第 ${event.sequence} 步：${tool.name}`,
      `  判断：${decision}；原因：${toTraceText(event.decision.reason, 100)}。`,
      ...(event.decision.action === "ask"
        ? [`  请求：${toTraceText(event.decision.resource)}；可批准范围：${toTraceText(event.decision.scope)}。`]
        : []),
    ];
  }

  // [KEEP 来自 07.1] 预览不再只代表文件修改，命令也走这个事件。
  if (event.type === "tool_prepare") {
    const tool = describeToolCall(event.call);
    return event.outcome === "success"
      ? [
          `准备 < 第 ${event.sequence} 步：${tool.name} 已生成操作预览`,
          `  结果：完整预览共 ${event.previewChars} 个字符；此时尚未执行。`,
        ]
      : [
          `准备 < 第 ${event.sequence} 步：${tool.name} 无法生成操作预览`,
          `  原因：${toTraceText(event.error, 100)}；错误将交回模型重新决策。`,
        ];
  }

  // [KEEP 来自 07.1] 当前预览可能是命令，也可能是文件 diff。
  if (event.type === "approval_start") {
    return [
      `审批 > 第 ${event.sequence} 步：等待用户决定`,
      event.hasPreview
        ? "  范围：只批准随后显示的这一次完整操作，不保存为会话权限。"
        : `  范围：${toTraceText(event.scope)}${event.allowSession ? "，可选择本次会话复用" : ""}。`,
    ];
  }

  if (event.type === "approval_finish") {
    const result = event.response.decision === "allow_once"
      ? "允许一次"
      // [KEEP 来自 05.3] 终端明确区分单次允许和会话允许。
      : event.response.decision === "allow_session"
        ? "允许本次会话"
        : "拒绝";
    return [
      `审批 < 第 ${event.sequence} 步：${result}`,
    ];
  }

  // [KEEP 来自 27.1] 排队/运行/终态属于同一调用，结果正文仍由 tool_finish 展示。
  if (event.type === "tool_state") return [`[工具 #${event.sequence} ${event.call.id}] ${event.call.name}: ${event.state}`];
  const tool = describeToolCall(event.call);
  if (event.type === "tool_start") {
    return [
      `工具 > 第 ${event.sequence} 步：${tool.name}`,
      `  执行：${tool.input}。`,
    ];
  }

  // [KEEP 来自 07.1] 测试失败有完整结果，不等于执行器自身抛出异常。
  const failed = event.outcome === "error";
  const commandFailed = !failed && event.result.isError;
  return [
    `工具 < 第 ${event.sequence} 步：${tool.name}${failed || commandFailed ? " 失败" : " 完成"}`,
    `  返回：${failed ? "执行失败" : describeToolResult(event.result.metadata)}。`,
    `  去向：${failed || commandFailed ? "错误与输出" : "结果"}已加入当前回合，下一次模型决策会收到。`,
  ];
}
```

</details>

<!-- build-file: src/ui/tui/state.ts -->
<details>
<summary>src/ui/tui/state.ts 完整文件</summary>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [CHANGED] ui/tui/state.ts
 *
 * 学习目标：把同一轮事件累积成显示状态；结束时采用包含本地 stop 反馈的完整回答，避免只留下较早的模型片段。
 * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
 * 输出：新的显示状态，或本轮结束后留在终端的文字记录；本文件没有终端写入和执行副作用。
 * 状态：更新时返回新对象，不修改传入状态或模型历史；失败与取消只改变显示中的结束状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件 -> run_start？-- 是 -> 空白本轮状态
 *                      +-- 否 -> 模型事件？-- 是 -> 按 call 更新文字与阶段
 *                                         +-- 否 -> run_finish？-- 是 -> 采用完整 Reply、写结束状态与用量
 *                                                              |       非 completed 时标记未结束工具为已中断
 *                                                              +-- 否 -> 按 sequence 新建或替换工具行
 *   工具完成 -> 保存完整结果的显示副本 -> 历史区折叠或展开；本轮结束 -> 留存记录
 *
 * 模型的 call 和工具的 sequence 各有用途；都不能替代事件外壳中的送达序号。
 * answers 保存本轮已经收到的文字，画面只显示末尾是 app.tsx 的选择，不在这里丢弃文字。
 * 工具完成前 detail 保存过程摘要，完成后保存完整结果的显示副本，供历史区按需展开。
 * 显示副本经过控制字符处理；模型历史仍由核心保存，不能用 RunView 替代。
 *
 * [KEEP 来自 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：整轮完成后能看到模型回答及本地结束反馈；错误或取消保留已收到的内容，并收束未结束的工具状态。
 */
import type { AgentEvent } from "../../agent/events.js";
import { formatTeachingTrace } from "../teaching-trace.js";

// [KEEP 来自 10.2] RunView 继续保存显示数据，不替代模型历史。
// [KEEP 来自 25.3] 按子会话编号保存最新显示状态。
export type RunView = {
  status: string;
  answers: { call: number; text: string }[];
  // [KEEP 来自 29.1] 按任务ID保存本地最新归属，不复用模型todo状态。
  sharedTasks: Extract<AgentEvent, { type: "shared_task_state" }>[];
  children: Extract<AgentEvent, { type: "child_state" }>[];
  tools: { sequence: number; name: string; status: string; detail: string }[];
  usage: string;
  budget: string;
};

/**
 * 为新一轮任务建立独立的显示状态。
 *
 * - 输入：无参数；调用方在开始任务或收到 run_start 时使用。
 * - 输出：状态为“执行中”，文字、工具和用量均为空的全新对象。
 * - 关键原因：每轮模型调用号和工具步骤号会重新计数，旧数组不能带进下一轮。
 */
export function emptyRunView(): RunView {
  return { status: "执行中", answers: [], sharedTasks: [], children: [], tools: [], usage: "", budget: "" };
}

/**
 * 把终端控制字符显示成可见文字，同时保留正文的换行。
 *
 * - 输入：模型、工具或用户提供的显示文本；这些内容不能直接取得终端控制能力。
 * - 输出：被处理的控制字符写成可见的反斜杠 u 加四位十六进制，制表符显示为四个空格。
 * - 关键原因：直接删除字符会让预览看不出原文含有什么；可见转义保留了这项信息。
 * - 职责边界：只生成显示副本，不改模型历史、待写入正文或审批请求，也不做凭据脱敏。
 */
export function screenText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\t/g, "    ");
}

/**
 * 根据一条已发生的事件，返回下一份画面数据。
 *
 * - 输入：上一份 RunView 和有序送达的事件；model_start 必须先于该次文字增量。
 * - 输出：保留旧内容并更新相关字段的新对象，调用方再把它交给 React 显示。
 * - 文字处理：按模型 call 追加片段；没有收到片段时，用 model_finish 的完整文字补齐。
 * - 工具处理：按工具 sequence 更新状态；完成前显示摘要，tool_finish 后保存完整结果的显示副本，不从正文猜测成功或失败。
 * - 结束处理：只有 completed 记录用量；错误或取消把尚未结束的工具标为“已中断”。
 * - 职责边界：这里只处理显示副本，不发起网络请求、不执行工具，也不替用户作出审批决定。
 */
export function updateRunView(view: RunView, event: AgentEvent): RunView {
  // [KEEP 来自 27.3] 整批结束不冒充整轮结束，保留每项结果。
  if (event.type === "tool_batch_finish") return { ...view, status: formatTeachingTrace(event).join(" ") };
  if (event.type === "run_start") return emptyRunView();
  // [KEEP 来自 29.1] 在通用工具sequence分支之前处理无sequence的调度状态。
  if (event.type === "shared_task_state") {
    const task = { ...event, taskId: screenText(event.taskId), detail: screenText(event.detail) };
    return { ...view, status: formatTeachingTrace(event).join(" "), sharedTasks: view.sharedTasks.some(item => item.taskId === task.taskId)
      ? view.sharedTasks.map(item => item.taskId === task.taskId ? task : item) : [...view.sharedTasks, task] };
  }
  if (event.type === "child_state") {
    const child = { ...event, detail: screenText(event.detail) };
    return { ...view, status: formatTeachingTrace(event).join(" "), children: view.children.some(item => item.sessionId === child.sessionId)
      ? view.children.map(item => item.sessionId === child.sessionId ? child : item) : [...view.children, child] };
  }
  // [KEEP 来自 16.3] 压缩状态独立于模型正文和工具 sequence，取消由原本 run_finish 收尾。
  if (event.type === "compaction_start" || event.type === "compaction_candidate" || event.type === "compaction_finish") {
    return { ...view, status: formatTeachingTrace(event).join(" ") };
  }
  // [KEEP 来自 15.1] 预算与 usage 独立保存；错误或取消不会抹掉已经取得的服务商用量。
  if (event.type === "context_budget") return { ...view, budget: formatTeachingTrace(event).join(" ") };
  if (event.type === "model_usage") return { ...view, usage: formatTeachingTrace(event).join(" ") };
  // [KEEP 来自 12.4] 用户补充没有工具 sequence。
  // [KEEP 来自 12.4] 补充确认先独立处理，它没有工具 sequence。
  if (event.type === "input_applied") return { ...view, status: `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文` };
  // [CHANGED 34.2] 重试仍属于同一次模型决策，没有工具 sequence。
  if (event.type === "model_retry") return { ...view, status: formatTeachingTrace(event).join(" ") };
  if (event.type === "model_start") return { ...view, status: `模型第 ${event.call} 次决策`, answers: [...view.answers, { call: event.call, text: "" }] };
  if (event.type === "text_delta") return { ...view, answers: view.answers.map((answer) => answer.call === event.call ? { ...answer, text: answer.text + screenText(event.text) } : answer) };
  // 有的 Model 实现不发送文字回调；只在尚无片段时补完整文字，避免重复一遍回答。
  if (event.type === "model_finish") return { ...view,
    status: event.outcome === "tools" ? `收到 ${event.toolRequests} 个工具请求` : "模型已返回，等待本轮结束",
    answers: view.answers.map((answer) => answer.call === event.call && !answer.text ? { ...answer, text: screenText(event.text) } : answer),
  };
  // run_finish 才结束整轮；异常结束后保留已完成的结果，只收束仍在等待或执行的状态。
  // [KEEP 来自 20.3] 运行结果含本地收尾反馈，替换最后回答，避免只保留较早的模型片段。
  if (event.type === "run_finish") return { ...view,
    answers: event.outcome === "completed" ? view.answers.map((answer, index) => index === view.answers.length - 1 ? { ...answer, text: screenText(event.reply.text) } : answer) : view.answers,
    tools: event.outcome === "completed" ? view.tools : view.tools.map((tool) =>
      ["完成", "失败", "准备失败", "已拒绝", "排队超时", "执行超时", "已中断"].includes(tool.status) ? tool : { ...tool, status: "已中断" }),
    // [KEEP 来自 34.1] 诊断定位随最终状态保留在 TUI 历史。
    status: [event.outcome === "completed" ? "已完成" : event.outcome === "cancelled" ? "已取消本轮" : `运行失败：${screenText(event.message)}`, ...formatTeachingTrace(event)].join(" · "),
    usage: view.usage || (event.outcome === "completed" ? `服务商报告本轮累计：输入 ${event.reply.inputTokens ?? "未知"} / 输出 ${event.reply.outputTokens ?? "未知"} token` : ""),
  };
  // 前面的分支已经处理整轮与模型事件；剩下的事件都有工具 sequence，可更新同一行。
  const old = view.tools.find((tool) => tool.sequence === event.sequence);
  // [KEEP 来自 27.1] 调度状态按固定 sequence 更新；终态不覆盖此前收到的完整结果。
  // [KEEP 来自 27.2] 分开展示排队与执行超时，整轮结束保留这些已确认终态。
  const status = event.type === "tool_state" ? ({ queued: "排队中", running: "执行中", succeeded: "完成", failed: "失败", cancelled: "已中断", queue_timeout: "排队超时", execution_timeout: "执行超时" }[event.state])
    : event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
    : event.type === "tool_prepare" ? event.outcome === "success" ? "预览已准备" : "准备失败"
    : event.type === "approval_start" ? "等待批准"
    : event.type === "approval_finish" ? event.response.decision === "deny" ? "已拒绝" : "已批准"
    : event.type === "tool_start" ? "执行中"
    : event.outcome === "error" || event.result.isError ? "失败" : "完成";
  // [KEEP 来自 11.3] 完成时保留完整工具正文的显示副本，折叠由历史区决定，不能在这里截成摘要。
  // [KEEP 来自 28.1] 身份摘要来自同一元数据；工具全文仍保留在展开详情。
  const identity = event.type === "tool_finish" && event.outcome === "success" && event.result.metadata.kind === "worktree"
    ? `${formatTeachingTrace(event).join("\n")}\n` : "";
  const tool = { sequence: event.sequence, name: screenText(event.call.name), status,
    detail: event.type === "tool_finish" ? identity + screenText(event.outcome === "success" ? event.result.content : event.error) : old?.detail ?? formatTeachingTrace(event).join("\n") };
  return { ...view, status: `${tool.name}：${status}`, tools: old
    ? view.tools.map((item) => item.sequence === event.sequence ? tool : item)
    : [...view.tools, tool] };
}

/**
 * 把本轮显示数据整理成一条可留在终端滚动记录中的消息。
 *
 * - 输入：事件消费结束后的 RunView，包括各次模型文字、每个工具的当前详情和结束状态。
 * - 输出：用空行分隔的文字；没有正文的模型调用会跳过，结束状态始终保留。
 * - 关键原因：运行中的区域只显示少量末尾内容，结束后仍需保留本轮已收到的文字供回看。
 * - 职责边界：生成的文字不写入模型历史，也不是完整事件日志；当前界面通过 transcript.tsx 把同一份状态拆成可选择的消息。
 */
export function runTranscript(view: RunView): string {
  return [...view.answers.filter((answer) => answer.text).map((answer) => answer.text),
    ...view.sharedTasks.map(task => `共享任务 ${task.taskId}：${task.state} · ${task.workerId} · token ${task.token}\n${task.detail}`),
    ...view.children.map(child => `子任务 ${child.role} ${child.sessionId}：${child.status}\n${child.detail}`),
    ...view.tools.map((tool) => `工具 #${tool.sequence} ${tool.name}：${tool.status}\n${tool.detail}`),
    `状态：${view.status}${view.usage ? ` · ${view.usage}` : ""}`].join("\n\n");
}
```

</details>

<!-- source:end -->

## 运行验证

```bash
npm run lesson:34.2
```

```bash
hello-my-agent --output text --prompt "读取 package.json，说明构建命令"
```

正常服务不会为了演示故意制造失败。仓库验证脚本会启动本地 HTTP 测试端点：先返回 429，再返回完整响应；并检查退避期间取消不会产生下一次请求、已有文字后断线不会重发、已执行的文件工具不会重复写入。认证失败也应直接结束。

```bash
node tests/verify-chapter-34.mjs
```

打开诊断文件，重试应出现在同一个 call 之内；若发生过重试，用量应为 null。若最后仍失败，核对历史中的已完成工具结果，再决定后续任务，不能把“网络恢复了”当作“前一轮没有副作用”。

[下一节：停止无进展任务并保留成果](/content/chapter-34-reliability/03-stop-and-diagnose/README.md) · [练习](/content/chapter-34-reliability/EXERCISES.md)
