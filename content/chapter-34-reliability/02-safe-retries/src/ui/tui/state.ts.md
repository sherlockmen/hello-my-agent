# state.ts

`chapter-34-reliability/02-safe-retries/src/ui/tui/state.ts`

<a href="./content/chapter-34-reliability/02-safe-retries/src/ui/tui/state.ts" download>下载原始文件</a>

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
