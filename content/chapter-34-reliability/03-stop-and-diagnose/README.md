# 34.3 停止无进展任务并保留成果

现在我们能看见任务在哪一步，也能等一次临时网络故障。但如果某个操作既不返回结果，也不报告进展，终端可能一直停在“正在执行”。与其等用户猜测，我们让整轮运行监督这段沉默。

本节增加无进展看门狗、可配置的等待上限、无需网络的配置诊断，以及文本简洁输出。它们共同回答一件事：程序现在知道什么、正在等什么、停止后留下什么。

## 没有事件，是一种需要核对的事实

默认连续 90 秒没有进展事件，看门狗通过内部 `AbortController` 请求停止。模型文字增量、一次模型或工具状态推进、压缩结果等会重新计时；它不依据终端有没有刷新来判断。text、TUI、JSONL 都消费同一个 runtime，因此更换界面不会改变检测规则。

等待用户批准或回答问题时暂停计时。runtime 跟随实际审批、问答 Promise 的开始与结束；只读子任务和共享 worker 沿用同一个审批入口，因此子审批也会暂停父监督，不必把子事件编号混入父流。否则用户只是离开终端几分钟，程序就会误把正常的人类等待判为故障。并发工具中只要仍有一项等待用户，这段等待也不计入沉默上限；最后一个人类等待结束后重新计时。

没有事件不等于操作必然死锁。一个长时间不输出的合法命令也可能触发它，事件不断却重复做无用工作的循环则主要由已有模型决策次数上限兜住。本节提供 `--idle-timeout <秒>` 调整 1—3,600 秒的上限；关闭监督并不是恢复办法，应该先确定哪一阶段需要更长时间。

## 请求取消与确认结束之间还有一段路

[Node.js 的 AbortController 文档](https://nodejs.org/api/globals.html#class-abortcontroller)说明，`abort()` 发出信号供观察者响应。它不会自动终止任意 Promise，更不会撤销已经完成的文件写入。所以看门狗只请求取消，不用 `Promise.race` 丢下原任务后立刻显示“已停止”。

组合后的信号沿模型请求、退避、工具、子任务和进程等待传下去。进程执行器发送终止请求后仍等待自己实际拥有的进程收尾；MCP、LSP 与 sandbox 继续沿用前两章各自的关闭和诊断边界。Agent Loop 收齐已完成项，并为未完成项写明“未启动”或“已开始、结果不确定”，之后才退出。`runAgent` 最后关闭诊断文件、发出 `run_finish`，事件流也要等待原运行 Promise 结束。

因此，无进展触发会显示为 error，用户主动取消显示为 cancelled。两者都会保留历史和真实工作成果。若某个自定义适配器完全忽略取消信号，runtime 仍只能等待它实际结束，不能声称已经确认停止；这也是我们要求每个执行边界遵守取消契约的原因。

## 失败保留哪些东西

| 已发生的事实 | 失败后的处理 | 下一轮能依据什么 |
| --- | --- | --- |
| 已取得完整工具结果 | 写入当前轮历史，text/TUI 再保存会话 | 模型收到真实工具消息，而不是重新猜测。 |
| 工具输出过大 | 保留既有完整输出文件，模型只收到裁剪内容与位置 | 用户核对原文；诊断日志只有长度和状态。 |
| 文件已成功修改 | 文件、已有备份和检查点保留 | 用户显式检查或恢复；取消不会自动回滚。 |
| 操作已启动、没有完整结果 | 历史注明结果不确定 | 先查文件、进程或远端状态，再决定是否重做。 |
| 模型只返回半段文字或参数 | 界面可能已显示，历史不记作完整响应 | 下一轮依据已提交记录继续，不把残片当成批准的工具调用。 |
| 诊断文件写入失败 | 任务结果保留，通知说明日志不完整 | 使用会话与工作区事实核对，不声称日志齐全。 |

续聊恢复的是信息，不是自动重放命令。外部副作用完成到本地记录写入之间仍有间隙，进程突然退出可能留下不确定状态；本章没有承诺跨文件、进程和远端服务的 exactly-once。

## 先诊断配置，再决定是否联网

`--doctor` 仍然在创建模型与会话之前执行。现在它还调用同一份配置校验，报告协议、模型配置是否完整、预算是否有效；缺密钥时显示缺少哪个变量，不显示值。它不创建 SDK、不启动工具、不发网络请求，因此“配置检查通过”只说明本地输入可用于尝试连接，不证明服务可达或账户有权限。

`--quiet` 只用于文本输出。它省略过程讲解，保留模型正文、审批、失败说明和最终诊断位置；原始事件、日志和工具结果仍完整走原通道。需要机器消费则继续用 JSONL，不能把一段简短终端文字当作稳定协议。简洁输出也不会隐藏审批 diff 或替用户批准操作。

<!-- media:lesson:start -->
把“请求停止”“实际退出”“原循环完成”“发布 final”分开追踪；watchdog 与用户取消得到不同状态。

<img src="./content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-cover-6079330069.png" data-gif-src="./content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-6d1986971d.gif" data-cover="./content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-cover-6079330069.png" data-no-zoom alt="监控器发出 abort，为什么还不能说已经结束？">

[静态流程图](/content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-flow-ffe339c5af.png.md) · [静态封面](/content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-cover-6079330069.png.md) · [查看完整静态分镜](/content/chapter-34-reliability/03-stop-and-diagnose/assets/watchdog-stop-wait-storyboard-786215e5dd.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- changes:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/run-options.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/agent/run-options.ts.md) | 接收无进展上限与文本简洁选项。 |
| CHANGED | [src/agent/run.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/agent/run.ts.md) | 合并用户与看门狗信号，等待原任务收尾并清除计时器。 |
| CHANGED | [src/cli.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/cli.ts.md) | 接通配置诊断、上限校验与文本简洁开关。 |
| NEW | [src/diagnostics/config.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/diagnostics/config.ts.md) | 复用本地配置校验，返回安全诊断。 |
| NEW | [src/diagnostics/watchdog.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/diagnostics/watchdog.ts.md) | 人类等待可暂停的无进展计时器，只请求取消。 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-34-reliability/03-stop-and-diagnose/src/ui/terminal.ts.md) | 按选项省略过程，仍显示诊断和结果。 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-34-reliability/03-stop-and-diagnose/src/ui/tui/app.tsx.md) | 将无进展上限传给 TUI 内的每轮任务。 |
<!-- changes:end -->

## 动手构建

从 34.2 继续。看门狗放在 `runAgent` 外层观察同一组事件；CLI 只负责校验秒数并交给 runtime，不复制一份取消流程。下面的文件均可按完整内容替换。

<!-- source:start -->

<!-- build-file: src/agent/run-options.ts -->
<details>
<summary>src/agent/run-options.ts 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [CHANGED] agent/run-options.ts
 *
 * 学习目标：传递会话持有的工作区管理器与本地调度选项，模型不能自行选择控制对象。
 * 输入：本地入口选定的模式、会话控制对象、调度限制与本轮交互回调。
 * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
 * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
 * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
 *   本地界面 -> 本轮选项 -> 核心 / 工具 / 模型请求
 * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
 * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
 */
import type { CompactionState } from "../context/compaction.js";
import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";

// [KEEP 来自 12.1] 模式由本地运行入口选择，默认继续执行。
/**
 * 本地入口可选的两种运行模式。
 * plan 只调查和制定计划；execute 仍需遵守每次工具的权限与审批。
 */
export type ExecutionMode = "plan" | "execute";

// [KEEP 来自 12.2] 容器由会话持有，切换模式和开始新一轮不会丢失任务清单。
/**
 * 清单中的一个步骤和模型报告的进度。
 * ID 用来辨认条目，状态不是测试证明；数量和字段限制由 todo_write 运行时检查。
 */
export type TaskItem = {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
};
/**
 * 会话持有的可替换清单容器。
 * 工具先校验完整新数组再替换 items，失败时旧数组继续使用。
 */
export type TaskState = { items: TaskItem[] };

// [KEEP 来自 12.3] 答案只交回正在等待的工具调用；null 表示用户未回答。
/**
 * 这次澄清要显示的问题与选项。
 * 选项可为空，用户仍可自由回答；内容约束由 ask_user 检查。
 */
export type UserQuestion = { question: string; choices: string[] };
/**
 * 界面提供的专用问答等待入口。
 * 返回有效答案或表示未回答的 null；取消和显示失败可拒绝 Promise。
 */
export type QuestionHandler = (request: UserQuestion, signal: AbortSignal) => Promise<string | null>;

// [KEEP 来自 12.4] ID 用于界面确认哪条补充已被核心收取。
/**
 * 核心实际收取的一条补充。
 * ID 供界面确认哪条已加入上下文；所属轮由界面回调闭包固定。
 */
export type QueuedInput = { id: number; text: string };

/**
 * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
 * 省略可选项时使用默认模式或缺省交互；回调仅负责本轮，不能把旧轮补充带进新轮。
 */
// [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
// [KEEP 来自 19.3] 工具使用进程内已发现目录，模型不能自行选择根目录。
export type RunOptions = {
  // [CHANGED 34.3] 本地沉默上限和文本表现不进入模型工具参数或会话权限。
  noProgressTimeoutMs?: number;
  quiet?: boolean;
  // [KEEP 来自 34.1] 本地运行标识由事件流生成；日志目录不来自模型参数。
  runId?: string;
  diagnosticDirectory?: string;
  // [KEEP 来自 32.2] 只接受本地绑定的语言服务，不序列化进会话。
  languageService?: import("../language-service/client.js").LanguageService;
  // [KEEP 来自 27.1] 本地入口配置容量；未列入白名单或有 Hooks 的调用仍串行。
  toolConcurrency?: number;
  // [KEEP 来自 27.2] 白名单只读调用从入批开始计排队，从领槽开始计执行；超期后仍等待收尾。
  toolQueueTimeoutMs?: number;
  toolExecutionTimeoutMs?: number;
  // [KEEP 来自 26.1] 作业属于会话，不能从磁盘恢复PID；子任务allowlist仍阻止启动。
  jobs?: import("../processes/jobs.js").JobManager;
  // [KEEP 来自 28.1] 当前CLI持有自有工作区登记，child不继承写入能力。
  worktrees?: import("../workspaces/worktrees.js").WorktreeManager;
  // [KEEP 来自 29.1] 当前会话共享同一登记；回调只由本地Agent Loop绑定。
  sharedTasks?: import("../collaboration/coordinator.js").SharedCoordinator;
  runSharedTasks?: (signal: AbortSignal) => Promise<import("../collaboration/coordinator.js").SharedTask[]>;
  // [KEEP 来自 29.3] worker只能访问本地绑定的任务和租约，模型不能自报身份。
  sharedWorker?: import("../collaboration/coordinator.js").WorkerLease;
  sessionId?: string;
  childSessionDirectory?: string;
  childDepth?: number;
  maxModelCalls?: number;
  allowedTools?: readonly string[];
  delegateTask?: (argumentsJson: string, signal: AbortSignal) => Promise<import("../subagents/runner.js").ChildResult>;
  // [KEEP 来自 21.1] 连接只存内存，不写会话或给模型选择配置路径。
  // [KEEP 来自 22.1] 本地网页启用状态不写会话。
  web?: import("../web/client.js").WebState;
  mcp?: import("../mcp/client.js").McpState;
  skills?: import("../skills/catalog.js").SkillState;
  // [KEEP 来自 18.2] 只由本地记忆控制器提供，候选参数不能改项目范围。
  memoryRoot?: string;
  // [KEEP 来自 16.1] 摘要只改变请求视图；完整消息仍由会话保存。
  context?: CompactionState;
  // [KEEP 来自 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
  toolResultDirectory?: string;
  fileCheckpoints?: FileCheckpointStore;
  // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
  mode?: ExecutionMode;
  // [KEEP 来自 12.2] 清单容器跨模型请求和工具调用共用。
  tasks?: TaskState;
  // [KEEP 来自 12.3] 问答是被工具等待的控制入口，观察事件不能替代它。
  askUser?: QuestionHandler;
  // [KEEP 来自 12.4] 由核心请求前主动收取，保持当前轮 FIFO 顺序。
  takePendingInputs?: () => QueuedInput[];
  // [KEEP 来自 12.4] 最终回答后只检查是否待处理，不提前移出队列。
  hasPendingInputs?: () => boolean;
};
```

</details>

<!-- build-file: src/agent/run.ts -->
<details>
<summary>src/agent/run.ts 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [CHANGED] agent/run.ts
 *
 * 学习目标：等待核心任务与本地 stop 收尾，再统一发出整轮结束事件；本层不再请求模型，也不负责保存会话文件。
 * 职责说明：历史由核心提交，会话文件由消费者保存；本文件只组织整轮调用、结束脚本与通知。
 * 输入：模型、历史、用户问题、取消信号、可选观察者、审批函数和会话只读授权。
 * 输出：run_start 与一次 run_finish 通知；成功返回 Reply，失败继续抛出原因。
 * 状态：核心仍负责成功或中断后的历史提交；外层通知不新增工具副作用，也不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] run_start -> 调用 agentLoop -> 成功？-- 是 -> 等 stop 或失败说明 -> run_finish/completed -> 返回 Reply
 *                                                   +-- 否 -> 选择取消原因或原错误
 *   信号已取消且原因不是 UserFacingError？-- 是 -> run_finish/cancelled -> 抛出原因
 *                                        +-- 否 -> run_finish/error -> 抛出原因
 *
 * 整轮可能包含多次模型请求；model_finish 只说明一次模型返回，run_finish 才说明整轮结束。
 * 事件发送复用 emitAgentEvent，观察者直接抛错不会成为任务失败；同步观察仍会占用当前线程。
 *
 * [KEEP 来自 12.1] RunOptions 随同一轮传入核心；本层不重新选择模式或处理工具业务。
 * 运行观察：模型最终回答先返回，stop 反馈随后补入本地回答；run_finish 在收尾之后发出，取消不启动新脚本。
 */
// [KEEP 来自 20.3] 结束钩子复用同一个有界进程执行器。
// [KEEP 来自 34.1] 所有直接/流式运行共用诊断边界。
// [CHANGED 34.3] 内部错误信号与用户信号合并，仍等待原始agentLoop完成。
import { createProgressWatchdog } from "../diagnostics/watchdog.js";
import { randomUUID } from "node:crypto";
import { openRunLog } from "../diagnostics/logger.js";
import type { AgentEvent } from "./events.js";
import { runHooks } from "../hooks/lifecycle.js";
import { agentLoop } from "./agent-loop.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import { explainError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import type { RunOptions } from "./run-options.js";

// [KEEP 来自 09.1] 本文件以下实现沿用 09.1。
/**
 * 为一次完整任务通知开始和结束，让消费者不用猜最后一次模型响应是否已经结束任务。
 *
 * - 输入：沿用核心所需的模型、历史、问题、取消信号，以及观察者、审批函数和会话只读授权。
 * - 输出：先发 run_start；核心返回后发 completed 结束事件，再原样返回 Reply。
 * - 失败方式：核心抛错时优先采用已取消信号的 reason，发结束事件后继续抛出同一原因。
 * - 状态区分：信号已取消且原因不是 UserFacingError 时记为 cancelled；其余失败记为 error。
 * - 职责边界：本函数不重新实现模型与工具循环；历史提交、审批和资源清理由原有核心及工具负责。
 * - 观察限制：观察者抛错会被事件函数捕获；同步回调仍占用当前线程，并不代表显示可以无限耗时。
 */
export async function runAgent(
  model: Model, history: Message[], input: string, signal: AbortSignal,
  observer?: AgentObserver, requestApproval?: ApprovalHandler,
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 新增可选运行选项，沿同一轮向核心传递。
  options: RunOptions = {},
): Promise<Reply> {
  // [KEEP 来自 34.1] UUID只由本地生成；注入值也先校验，不能成为任意文件路径。
  const runId = options.runId && /^[0-9a-f-]{36}$/i.test(options.runId) ? options.runId : randomUUID();
  const watchdog = createProgressWatchdog(options.noProgressTimeoutMs);
  signal = AbortSignal.any([signal, watchdog.signal]);
  const log = openRunLog(runId, options.diagnosticDirectory);
  // [CHANGED 34.3] 子任务复用同一审批函数；跟随真实Promise暂停，不混入子事件编号。
  const approve: ApprovalHandler | undefined = requestApproval
    ? (request, approvalSignal) => watchdog.waitForHuman(() => requestApproval(request, approvalSignal)) : undefined;
  const askUser = options.askUser;
  const runOptions = askUser ? { ...options,
    askUser: (request: Parameters<typeof askUser>[0], questionSignal: AbortSignal) =>
      watchdog.waitForHuman(() => askUser(request, questionSignal)) } : options;
  /** 诊断先关闭再送出最终事件；日志故障不替换任务的原始成功或失败。 */
  const notify = (event: AgentEvent): void => {
    // [CHANGED 34.3] 观察推进与人类等待；超期本身不伪造完成事件。
    watchdog.observe(event);
    if (event.type === "run_finish") emitAgentEvent(observer, { ...event, diagnostics: log.finish(event) });
    else { log.record(event); emitAgentEvent(observer, event); }
  };
  // 先通知开始，即使传入的信号已经取消，外层仍能说明这次任务的结束状态。
  notify({ type: "run_start" });
  try {
    let reply = await agentLoop(model, history, input, signal, notify, approve, sessionGrants, runOptions);
    // [KEEP 来自 20.3] 完成后只收尾一次，反馈明确来自本地，不再调用模型。
    if (options.mode !== "plan" && model.hooks?.hooks.stop?.length) {
      let feedback: string;
      try { feedback = (await runHooks(model.hooks, "stop", { outcome: "completed" }, signal)).messages.join("\n"); }
      catch (error) { signal.throwIfAborted(); feedback = `结束钩子失败：${explainError(error)}`; }
      if (feedback) {
        const content = `[本地结束钩子反馈；不是模型回答或权限]\n${feedback}`;
        history.push({ role: "assistant", content });
        reply = { ...reply, text: `${reply.text}\n\n${content}` };
      }
    }
    notify({ type: "run_finish", outcome: "completed", reply });
    return reply;
  } catch (error) {
    // 内部停止也可能使用取消信号；UserFacingError 表示需要报告的失败，不能全算用户取消。
    // [KEEP 来自 20.3] 错误也可收尾；取消不再启动新脚本。收尾失败保持原错误。
    if (!signal.aborted && options.mode !== "plan" && model.hooks?.hooks.stop?.length) {
      try {
        const stop = await runHooks(model.hooks, "stop", { outcome: "error" }, signal);
        if (stop.messages.length) history.push({ role: "assistant", content: `[本地结束钩子反馈] ${stop.messages.join("\n")}` });
      } catch (stopError) {
        history.push({ role: "assistant", content: `[本地结束钩子失败] ${explainError(stopError)}` });
      }
    }
    const reason = signal.aborted ? signal.reason : error;
    const cancelled = signal.aborted && !(reason instanceof UserFacingError);
    notify({ type: "run_finish", outcome: cancelled ? "cancelled" : "error",
      message: cancelled ? "本轮任务已取消。" : explainError(reason) });
    throw reason;
  } finally { watchdog.dispose(); }
}
```

</details>

<!-- build-file: src/cli.ts -->
<details>
<summary>src/cli.ts 完整文件</summary>

```typescript
#!/usr/bin/env node
/**
 * 34.3 停止无进展任务并保留成果 | [CHANGED] cli.ts
 *
 * 学习目标：保留原有 CLI 装配与本地管理，所有自有任务结束后释放共享隔离资源。
 * 输入：模型选项与本地管理选项；--sandbox-info/check 在模型配置前独占处理。
 * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
 * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 30.1] argv[2]=schedule？-- 是 -> 独立定时管理 -> 结束；否 -> 普通聊天入口
 *   显式网页/搜索选项且非 Plan？-- 是 -> 完整校验本地配置 -> 创建 WebState；否 -> 不启用网页
 *   配置失败 -> 启动错误；配置成功只装配工具，不提前抓取或查询
 *   [KEEP 来自 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
 *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 只把名称/用途交给模型和启动信息
 *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
 *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
 *                            +-- 是 -> 继续检查运行方式
 *   [KEEP] auto？-- 是 -> 无 --prompt 且 stdin/stdout 为 TTY、TERM 非 dumb？
 *                     是 -> tui；否 -> text
 *                +-- 否 -> 保留显式选择
 *   tui？-- 是 -> stdin/stdout 为 TTY、TERM 非 dumb，且没有 --prompt？
 *                否 -> 抛错；是 -> 读取配置、创建模型 -> 动态载入 app -> startTui
 *        +-- 否 -> jsonl 但缺少 --prompt？-- 是 -> 抛错
 *                                          +-- 否 -> 读取配置、创建模型
 *   [KEEP 来自 13.1] text / tui -> 创建新会话文件、显示 ID 和路径 -> 消费者 -> finally close
 *   非 TUI 分支 -> 无 --prompt？-- 是 -> startTerminal
 *                              +-- 否 -> 内容为空？-- 是 -> 抛错
 *                                                  +-- 否 -> jsonl / text 单次消费者
 *   运行抛错 -> explainError -> stderr、exit 1；单次用户取消由消费者设 exit 130
 *
 * auto 在没有 --prompt、stdin/stdout 都是 TTY 且 TERM 不是 dumb 时选择 tui，其余选择 text。
 * TUI 只接受连续输入，单次任务继续用 text 或 jsonl；JSONL 必须同时给 --prompt。
 * 动态 import 只在 tui 分支载入 React / Ink，脚本模式不需要初始化终端界面。
 * --help、--version 不读取模型配置；--doctor 只做本地校验，不创建SDK或联网。
 *
 * [KEEP 来自 12.1] --mode plan|execute 在创建模型前校验，再传给每种消费者。
 * [KEEP 来自 12.2] 非 TUI 入口为当前会话准备共用清单；TUI 在 startTui 内创建自己的清单。
 * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
 */
// [KEEP 来自 31.3] 无需密钥的管理入口及显式启动、退出收尾。


// [KEEP 来自 18.1] 本地记忆动作在模型配置与会话创建前完成。
// [KEEP 来自 20.1] 项目脚本必须由本次启动显式启用。
// [KEEP 来自 21.1] 显式配置授权启动服务，退出始终关闭本次连接。
// [KEEP 来自 22.1] 网络开关不读取网页或会话里的指令。
import { closeSandbox } from "./sandbox/runtime.js";
import { sandboxInfo, runSandboxCheck, formatSandboxReport } from "./sandbox/diagnostics.js";
import { runCodeCommand } from "./code-command.js";
import { loadWeb } from "./web/client.js";
import { runScheduleCommand } from "./schedules/commands.js";
import { ExtensionManager } from "./extensions/manager.js";
import { extensionCommand } from "./extensions/commands.js";
import { connectMcp, mcpInfo } from "./mcp/client.js";
import { loadHooks } from "./hooks/lifecycle.js";
// [KEEP 来自 19.1] 固定项目目录发现元信息，不加载正文。
import { discoverSkills, skillInfo } from "./skills/catalog.js";
import { createMemoryController, memoryCommand } from "./memory/commands.js";
import { findProjectRoot } from "./project/instructions.js";
import { dirname } from "node:path";
// [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
import { readFileSync } from "node:fs";
// [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
import { forkSessionWriter } from "./sessions/fork-session.js";
import { realpath } from "node:fs/promises";
import { Command } from "commander";
// [CHANGED 34.3] doctor只复用本地校验，不创建SDK或任何执行资源。
import { diagnoseConfiguration } from "./diagnostics/config.js";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import type { ExecutionMode, RunOptions } from "./agent/run-options.js";
// [KEEP 来自 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";
// [KEEP 来自 13.1] 入口创建并最终关闭 writer，模型配置不进入存储模块。
import { createSessionWriter, resumeSessionWriter } from "./sessions/save-session.js";
// [KEEP 来自 13.4] 本地管理复用读取与写入协议，无需模型配置。
import { listSessions, renameSession, exportSession } from "./sessions/manage-sessions.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [CHANGED 34.3] 保留环境三项检查，并追加本地配置校验。
/**
 * 显示运行环境并校验本地模型配置；不发网络请求。
 *
 * - 输入：本次启动的模型选项；版本、平台、架构和工作目录来自 Node.js 的 `process`。
 * - 输出：向终端打印环境与安全配置状态，不打印配置值。
 * - 关键原因：诊断捕获缺项，只给本地说明；缺少 API Key 时也能运行。
 * - 职责边界：读取并校验 `.env`；不创建模型客户端，也不发送网络请求。
 */
function printDoctor(options: Options): void {
  // [CHANGED 34.3] 只返回白名单结果，绝不打印配置对象。
  for (const line of diagnoseConfiguration(options)) console.log(line);
}
// [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
// [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
type CliOptions = Options & { quiet?: boolean; idleTimeout?: string; sandboxInfo?: boolean; sandboxCheck?: boolean; extension?: string[]; enableExtension?: string[]; enableProjectHooks?: boolean; mcpConfig?: string; mcpInfo?: boolean; enableWeb?: boolean; webSearchConfig?: string;  memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [CHANGED 34.3] --doctor 捕获配置缺项后直接结束，没有 API Key 也能使用。
  // [KEEP 来自 20.1] 仅这次启动授权项目生命周期脚本；恢复会话不恢复启用状态。
  // [KEEP 来自 21.1] 不自动读取仓库中的MCP启动命令。
  // [KEEP 来自 22.1] 启用仅注册，真正GET仍逐次审批。
  // [KEEP 来自 22.2] 提供配置也明确启用网页工具；无提供方不注册web_search。
  .option("--web-search-config <path>", "配置JSON GET搜索提供方(endpoint/queryParam/tokenEnv)")
  .option("--enable-web", "明确启用逐次审批的网页抓取工具")
  .option("--extension <command...>", "本地扩展管理：list/install/diagnose/uninstall，无需模型密钥")
  .option("--enable-extension <id...>", "仅本进程明确启用列出的已安装扩展；可能启动脚本和服务")
  .option("--mcp-config <path>", "明确启用指定MCP配置（会启动或连接其中的服务）")
  .option("--mcp-info", "连接、发现并诊断指定MCP配置后退出，无需模型密钥")
  .option("--enable-project-hooks", "明确启用项目 .hello-my-agent/hooks.json 中的脚本")
  .option("--sandbox-info", "显示隔离依赖、规则和实际通道范围，不执行边界实验")
  .option("--sandbox-check", "用临时样本主动验证真实文件与网络限制")
  // [CHANGED 34.3] 简洁只改变text呈现；沉默上限传给共同runtime。
  .option("--quiet", "text只显示正文、审批、失败与诊断位置")
  .option("--idle-timeout <seconds>", "无进展上限秒数（1—3600，默认90）")
  .option("--doctor", "显示环境并静态检查模型配置，不联网")
  // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
  .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
  // [KEEP 来自 18.1] 显式管理命令无需API Key。
  .option("--memory <command>", "本地项目记忆：list、show <id>、add <正文>、edit <id> <正文>、invalidate <id> <理由>、delete <id>")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 10.4] 默认值改为 auto；显式 text、tui、jsonl 仍由用户选择。
  .option("--output <format>", "输出格式：auto、tui、text 或 jsonl", "auto")
  // [KEEP 来自 12.1] 增加启动模式选项，默认 execute。
  .option("--mode <mode>", "模式：plan 或 execute（新会话默认 execute，恢复沿用已保存模式）")
  // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
  .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
  // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
  // [KEEP 来自 14.1] fork 创建新身份；resume 继续旧身份。
  .option("--fork <id>", "从指定会话的最后完整状态创建新分支，不重放工具")
  .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
  .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
  // [KEEP 来自 13.4] 显式管理动作在读取模型配置前完成。
  .option("--sessions", "列出本地会话，可配合 --search")
  .option("--search <text>", "在会话 ID、名称、工作区和已保存消息中搜索")
  .option("--rename <id>", "给指定会话追加名称，需要 --name")
  .option("--name <text>", "会话名称，1—80 个字符")
  .option("--export <id>", "将指定会话导出为 Markdown，默认输出到 stdout")
  .option("--export-to <path>", "导出到一个尚不存在的文件，需要 --export")
  // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    // [KEEP 来自 33.3] 独占管理分支在模型、扩展和服务连接之前结束；不需要模型凭据。
    if (options.sandboxInfo || options.sandboxCheck) {
      const allowed = new Set(["output", options.sandboxInfo ? "sandboxInfo" : "sandboxCheck"]);
      if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
          && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
        throw new UserFacingError("--sandbox-info 与 --sandbox-check 请分别单独使用。");
      }
      if (options.sandboxInfo) {
        const info = await sandboxInfo(findProjectRoot()); console.log(info.text);
        if (!info.available) process.exitCode = 1;
      } else {
        const report = await runSandboxCheck(); console.log(formatSandboxReport(report));
        if (!report.passed) process.exitCode = 1;
      }
      return;
    }
    // [KEEP 来自 18.1] 管理动作拒绝混用提问、会话和连接选项；Plan只可查询。
    if (options.memory !== undefined) {
      if (options.prompt !== undefined || options.projectInfo || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.output !== "auto" || options.sessionDir !== undefined || options.resume !== undefined || options.recover
        || options.fork !== undefined || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--memory请单独使用，可配合--mode plan查询。");
      if (!["execute", "plan"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode只能是plan或execute。");
      console.log(await memoryCommand(findProjectRoot(), options.memory, options.mode as ExecutionMode | undefined));
      return;
    }
    // [KEEP 来自 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
    if (options.projectInfo) {
      if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
        || options.sessionDir !== undefined || options.resume !== undefined || options.recover || options.fork !== undefined
        || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--project-info 请单独使用，不与提问、模型、模式、会话或输出选项混用。 ");
      const project = await loadProjectInstructions();
      for (const line of projectInstructionInfo(project)) console.log(line);
      return;
    }
    // [KEEP 来自 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
    const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
    if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
    if (options.search !== undefined && !options.sessions) throw new UserFacingError("--search 必须与 --sessions 一起使用。");
    if (options.name !== undefined && options.rename === undefined) throw new UserFacingError("--name 必须与 --rename <id> 一起使用。");
    if (options.exportTo !== undefined && options.export === undefined) throw new UserFacingError("--export-to 必须与 --export <id> 一起使用。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (management) {
      if (options.fork !== undefined || options.resume !== undefined || options.recover || options.prompt !== undefined || options.doctor
        || options.mode !== undefined || options.model !== undefined || options.provider !== undefined || options.baseUrl !== undefined || options.output !== "auto") {
        throw new UserFacingError("本地会话管理请单独使用，不与恢复、提问、模型或输出模式选项混用。");
      }
      if (options.sessions) {
        const result = await listSessions(options.sessionDir, options.search);
        for (const warning of result.warnings) console.error(`会话提示：${warning}`);
        if (!result.sessions.length) console.log("没有匹配的本地会话。");
        for (const session of result.sessions) console.log(`${session.id}  ${session.name}\n  ${session.updatedAt} · ${session.messages} 条消息 · ${session.pending} 条待交付${session.interrupted ? " · 上次中断" : ""}\n  ${session.cwd}`);
      } else if (options.rename !== undefined) {
        if (options.name === undefined) throw new UserFacingError("--rename <id> 需要 --name <text>。");
        const seq = await renameSession(options.rename, options.name, options.sessionDir);
        console.log(`名称已保存：${options.rename} · 第 ${seq} 条记录。`);
      } else {
        const markdown = await exportSession(options.export!, options.sessionDir, options.exportTo);
        if (options.exportTo === undefined) process.stdout.write(markdown);
        else console.log(`已导出：${options.exportTo}`);
      }
      return;
    }
    // [KEEP 来自 21.1] 本地诊断在readConfig前完成，不需要模型凭据。
    if (options.mcpInfo) {
      if (!options.mcpConfig) throw new UserFacingError("--mcp-info 需要 --mcp-config <path>。");
      const mcp = await connectConfiguredMcp(options.mcpConfig, findProjectRoot());
      try { for (const line of mcpInfo(mcp)) console.log(line); } finally { await mcp?.close(); }
      return;
    }
    // [KEEP 来自 31.1] 本地安装与诊断无需模型凭据，完成后一定关闭管理器。
    if (options.extension) {
      if (options.enableExtension || options.prompt || options.resume || options.fork || options.mcpConfig || options.enableProjectHooks) throw new UserFacingError("--extension 不与运行或其他能力启用参数混用。");
      if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
      if (options.extension[0] === "enable") throw new UserFacingError("独立管理命令不保留进程；请用 --enable-extension <id...> 启动，或在会话中 /extension enable <id>。");
      const root = findProjectRoot(), manager = new ExtensionManager(root, await discoverSkills(root));
      const controller = new AbortController(), cancel = () => controller.abort(new UserFacingError("扩展操作已取消。"));
      process.once("SIGINT", cancel);
      try { console.log(await extensionCommand(options.extension, manager, options.mode ?? "execute", controller.signal)); }
      finally { process.removeListener("SIGINT", cancel); await manager.close(); }
      return;
    }
    if (options.doctor) {
      printDoctor(options);
      return;
    }
    // [KEEP 来自 12.1] 创建模型前检查模式，非法值不会启动任务。
    if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
    let mode: ExecutionMode = options.mode === "plan" ? "plan" : "execute";
    // [KEEP 来自 12.1] 把启动模式传到 text、JSONL 和连续会话入口。
    // [KEEP 来自 12.2] 非 TUI 入口创建共用清单；TUI 在自己的会话内创建。
    // [CHANGED 34.3] 严格秒数校验发生在模型与会话创建前。
    const idleTimeout = options.idleTimeout ?? "90";
    if (!/^[1-9]\d*$/.test(idleTimeout) || Number(idleTimeout) > 3600) throw new UserFacingError("--idle-timeout 必须为 1 至 3600 的整数秒。");
    if (options.quiet && options.output !== "auto" && options.output !== "text") throw new UserFacingError("--quiet 只支持 text 输出。");
    if (options.quiet) options.output = "text";
    const runOptions: RunOptions = { mode, tasks: { items: [] }, quiet: options.quiet, noProgressTimeoutMs: Number(idleTimeout) * 1000 };
    // [KEEP 来自 10.4] 校验允许 auto，下一步再把它解析成具体消费者。
    if (!["auto", "tui", "text", "jsonl"].includes(options.output ?? "auto")) throw new UserFacingError("--output 只能是 auto、tui、text 或 jsonl。");
    // [KEEP 来自 10.4] 只在真实终端的连续会话中自动选择 TUI；--prompt 和管道默认仍用文本。
    if (options.output === "auto") options.output = options.prompt === undefined
      && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb" ? "tui" : "text";
    // [KEEP 来自 10.1] 只有真实终端才能把按键交给 Ink；单次问题继续使用已有输出模式。
    if (options.output === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === "dumb")) {
      throw new UserFacingError("TUI 需要交互终端，请使用 --output text 或 --output jsonl --prompt 提问。");
    }
    if (options.output === "tui" && options.prompt !== undefined) throw new UserFacingError("TUI 使用连续输入；单次提问请使用 --output text 或 jsonl。");
    if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
    // [KEEP 来自 13.1] 在创建模型和文件前拒绝不支持的组合与空问题。
    if (options.output === "jsonl" && options.sessionDir !== undefined) throw new UserFacingError("--session-dir 只支持 text 或 tui；JSONL 机器输出暂不保存会话。");
    if (options.recover && options.resume === undefined) throw new UserFacingError("--recover 必须与 --resume <id> 一起使用。");
    if (options.resume !== undefined && options.output === "jsonl") throw new UserFacingError("会话恢复只支持 text 或 tui。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
    if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
    // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
    if (options.enableExtension?.length && (mode === "plan" || options.resume || options.fork)) throw new UserFacingError("启动启用扩展仅支持新的execute会话；恢复后请在本地明确启用。");
    const project = await loadProjectInstructions();
    const config = readConfig(options);
    // [KEEP 来自 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
    const memory = await createMemoryController(project.root);
    const skills = await discoverSkills(project.root);
    // [KEEP 来自 20.1] Plan不读取/运行钩子；执行模式没有显式开关也不读取。
    const hooks = await loadHooks(project.root, Boolean(options.enableProjectHooks) && mode !== "plan");
    // [KEEP 来自 21.1] Plan不启动本地服务；恢复与新启动都必须再次显式选择。
    const mcp = mode === "plan" ? undefined : await connectConfiguredMcp(options.mcpConfig, project.root);
    const extensions = new ExtensionManager(project.root, skills, hooks, mcp);
    let model: ReturnType<typeof createModel> | undefined;
    try {
    // [KEEP 来自 31.2] 启动显式启用也接收Ctrl+C；只在资源收尾后离开初始化阶段。
    const extensionAbort = new AbortController(), cancelExtension = () => extensionAbort.abort(new UserFacingError("扩展初始化已取消。"));
    process.once("SIGINT", cancelExtension);
    try { for (const id of options.enableExtension ?? []) console.error(await extensions.enable(id, mode, extensionAbort.signal)); }
    finally { process.removeListener("SIGINT", cancelExtension); }
    const web = mode === "plan" ? undefined : await loadWeb(Boolean(options.enableWeb), options.webSearchConfig);
    model = createModel(config, project, memory, skills, extensions.hooks, extensions.mcp, web, extensions);
    for (const line of mcpInfo(model.mcp)) console.error(line);
    for (const line of skillInfo(skills)) console.error(line);
    for (const line of projectInstructionInfo(project)) console.error(line);
    // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
    if (options.output === "jsonl") {
      await runJsonlPrompt(model, options.prompt!, runOptions);
      return;
    }
    // [KEEP 来自 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
    const writer = options.fork !== undefined
      ? await forkSessionWriter(options.fork, options.sessionDir)
      : options.resume !== undefined
      ? await resumeSessionWriter(options.resume, options.sessionDir, options.recover)
      : await createSessionWriter(options.sessionDir);
    // [KEEP 来自 14.2] 文件恢复数据与会话同属一个身份，分支自动使用新的目录。
    runOptions.fileCheckpoints = createFileCheckpointStore(writer.id, dirname(writer.path));
    console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
    try {
      // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
      const restored = writer.restored;
      const initial = restored?.state;
      if (restored) {
        const workspace = restored.header.workspace ?? await realpath(restored.header.cwd);
        if (workspace !== await realpath(process.cwd())) throw new UserFacingError(`工作区不同：请先进入 ${restored.header.cwd} 再恢复，当前目录不会执行旧任务。`);
        for (const warning of restored.warnings) console.error(`恢复提示：${warning}`);
        console.error(`已恢复 ${initial?.messages.length ?? 0} 条消息；等待新要求，不重放旧工具；本进程权限需重新确认。`);
        if (initial?.pendingInputs.length) console.error(`保留 ${initial.pendingInputs.length} 条旧补充；不会自动交给新任务，请在 TUI 队列中明确选择发送。`);
      }
      mode = (options.mode ?? initial?.mode ?? "execute") as ExecutionMode;
      runOptions.mode = mode;
      if (options.prompt === undefined) {
        // [KEEP 来自 10.1] 选择 TUI 时才载入 React / Ink，不让脚本模式初始化界面。
        if (options.output === "tui") {
          const { startTui } = await import("./ui/tui/app.js");
          // [KEEP 来自 13.1] 会话 writer 与启动模式一起交给 TUI，授权仍由 TUI 保存在内存。
          // [CHANGED 34.3] TUI也接受同一个本地超时选项，不依赖默认值碰巧一致。
          await startTui(model, mode, writer, initial, runOptions.fileCheckpoints, runOptions.noProgressTimeoutMs);
        } else await startTerminal(model, runOptions, writer, initial);
      } else await runSinglePrompt(model, options.prompt, runOptions, writer, initial);
    } finally {
      // [KEEP 来自 13.1] 消费者先等任务和最后检查点；即使保存失败，这里仍关闭句柄。
      await writer.close();
    }
    // [KEEP 来自 26.1] 退出等待自有作业清理；即使close失败也关闭MCP。
    } finally { try { await model?.jobs?.close(); } finally { try { await model?.languageService?.close(); } finally { try { await extensions.close(); } finally { await mcp?.close(); } } } }
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  // [KEEP 来自 30.3] schedule动作结束后不再进入普通聊天入口。
  if (process.argv[2] === "code") await runCodeCommand(process.argv.slice(3));
  else if (process.argv[2] === "schedule") await runScheduleCommand(process.argv.slice(3));
  else await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
} finally {
  // [KEEP 来自 33.1] parseAsync 已等待各入口和自有作业收尾，最后释放共享隔离资源。
  try { await closeSandbox(); }
  catch (error) { console.error(`隔离清理失败：${explainError(error)}`); process.exitCode = 1; }
}

/**
 * [KEEP 来自 21.1] 让启动时的 Ctrl+C 也能停止正在建立的 MCP 连接。
 * 输入是本地配置路径与已确定的项目根；取消信号交给连接器，等待它关闭已启动的服务。
 * 无论连接成功、失败还是取消，最后都移除本次 SIGINT 监听，避免影响之后的任务。
 */
async function connectConfiguredMcp(path: string | undefined, root: string) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("MCP初始化已取消。"));
  process.once("SIGINT", cancel);
  try { return await connectMcp(path, root, controller.signal); }
  finally { process.removeListener("SIGINT", cancel); }
}
```

</details>

<!-- build-file: src/diagnostics/config.ts -->
<details>
<summary>src/diagnostics/config.ts 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [NEW] diagnostics/config.ts
 *
 * 学习目标：无需网络、SDK或密钥展示，诊断所选协议的本地配置。
 * 输入：与正常启动相同的命令行选项、环境和项目.env；输出：安全的状态行。
 * 本文件局部流程：原环境信息 -> readConfig校验 -> 通过摘要 / 本地缺项说明。
 * 状态：不创建客户端、不修改环境、不启动服务；失败不输出原始配置或异常对象。
 * 观察：本地通过不证明接口可达、密钥有权限或远端模型支持工具。
 */
// [NEW 34.3] 复用同一校验规则；只输出受控协议名与本地安全错误。
import { readConfig, type Options } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";

/**
 * 返回已有Node/平台/目录信息及模型配置检查；缺凭据也能正常执行。
 * readConfig会解析.env，但不会把键值注入环境；这里只采用其安全的UserFacingError。
 * 未知异常只给固定文案，不串联原始message、URL或密钥。
 */
export function diagnoseConfiguration(options: Options): string[] {
  const lines = [`Node: ${process.version}`, `Platform: ${process.platform} ${process.arch}`, `Working directory: ${process.cwd()}`];
  try {
    const config = readConfig(options);
    lines.push(`模型配置：本地检查通过（${config.provider}；密钥、模型、基础地址和预算已校验）`);
  } catch (error) {
    lines.push(`模型配置：${error instanceof UserFacingError ? error.message : "本地检查失败，请核对配置文件和读取权限。"}`);
  }
  lines.push("没有发送网络请求；本地检查不证明服务可达或账户权限有效。");
  return lines;
}
```

</details>

<!-- build-file: src/diagnostics/watchdog.ts -->
<details>
<summary>src/diagnostics/watchdog.ts 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [NEW] diagnostics/watchdog.ts
 *
 * 学习目标：监督沉默时间，区分人类等待与未报告进展；停止请求不能代替完成确认。
 * 输入：毫秒上限与同一运行的事件；输出：只供运行层合并的AbortSignal。
 * 状态：审批/澄清等待期间暂停，最后一项等待结束重新计时；dispose清除计时器。
 * 本文件局部流程：进展 -> 重设计时；人类等待 -> 暂停；沉默超期 -> abort(UserFacingError)。
 * 失败：超期只发停止请求，runAgent仍await原任务；已完成文件与历史不回滚。
 * 观察：用户主动取消与无进展错误有不同最终状态，不能据此承诺远端副作用已撤销。
 */
// [NEW 34.3] 看门狗不使用Promise.race抢先返回，也不拥有子进程控制权。
import type { AgentEvent } from "../agent/events.js";
import { UserFacingError } from "../errors.js";

/**
 * 创建默认90秒的沉默监督器；允许本地测试注入更短期限。
 * 只有运行状态事件重置计时，等待用户时暂停；定时器不阻止Node自行退出。
 * 触发后不再重置，dispose幂等；调用方必须继续等待真正的运行Promise结束。
 */
export function createProgressWatchdog(timeoutMs = 90_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new UserFacingError("无进展上限必须为 1 至 3600000 毫秒。");
  }
  const controller = new AbortController(), waiting = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, humanWait = 0;
  /** 清除旧计时器，只有运行且不等人时重新开始一段沉默计时。 */
  function arm(): void {
    clearTimeout(timer);
    if (disposed || controller.signal.aborted || waiting.size) return;
    timer = setTimeout(() => controller.abort(new UserFacingError("任务长时间没有进展，已请求停止；已完成操作和历史保留，请核对诊断。")), timeoutMs);
    timer.unref();
  }
  /** 审批和ask_user按工具序号分别计数，防止并发等待中一项结束便提前恢复。 */
  function observe(event: AgentEvent): void {
    if (event.type === "approval_start") waiting.add(`approval:${event.sequence}`);
    if (event.type === "approval_finish") waiting.delete(`approval:${event.sequence}`);
    if (event.type === "tool_start" && event.call.name === "ask_user") waiting.add(`question:${event.sequence}`);
    if (event.type === "tool_finish") waiting.delete(`question:${event.sequence}`);
    if (event.type === "run_finish") { dispose(); return; }
    arm();
  }
  /**
   * 跟随真实人类回调的Promise暂停，覆盖父流不转发审批事件的只读子任务。
   * 每次等待有独立编号；并行审批一项结束时，其他等待仍保持暂停。
   */
  async function waitForHuman<T>(operation: () => Promise<T>): Promise<T> {
    const key = `handler:${++humanWait}`;
    waiting.add(key); arm();
    try { return await operation(); }
    finally { waiting.delete(key); arm(); }
  }
  /** 清除所有等待与计时，不取消已经完成的操作，也不报告任务完成。 */
  function dispose(): void { disposed = true; clearTimeout(timer); waiting.clear(); }
  arm();
  return { signal: controller.signal, observe, waitForHuman, dispose };
}
```

</details>

<!-- build-file: src/ui/terminal.ts -->
<details>
<summary>src/ui/terminal.ts 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：在聊天之前处理本地扩展命令，等操作或取消收尾后显示结果。
 * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
 * 输出：stdout 显示模型正文；stderr 显示过程、审批、输入提示、本地状态与用量。
 * 状态：文本消费者沿用 09.3 的输出位置；失败或取消等待清理，不撤销已经发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 19.2] 空闲 /skills -> 本地目录；/skill review -> 完整校验 -> loaded Map -> 下一请求system
 *                    失败/取消只显示诊断，旧集合保留；退出不持久化loaded
 *   事件流 -> showRun -> renderer -> 模型文字？-- 是 -> stdout
 *                                            +-- 否 -> [KEEP] 步骤说明写 stderr
 *   completed -> Reply -> 正文已显示？-- 否 -> stdout 补正文
 *                                    +-- 是 -> 只补最终Reply新增尾部（收尾/引用反馈）
 *                         -> [KEEP] 用量与截断提示写 stderr
 *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
 *                                                             +-- 否 -> deny
 *   [KEEP 来自 18.1] /memory -> 等本地命令完成 -> 显示回执；不新增user消息
 *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
 *   [KEEP 来自 13.1] 本轮 finally / reset / 有效 mode -> 白名单检查点 -> 等保存 -> stderr 反馈
 *   [KEEP 来自 13.1] 连续会话退出 -> 最后检查点；CLI 随后关闭 writer
 *
 * text 模式仍带终端标签，机器逐行解析使用另一个消费者 ui/jsonl.ts。
 * 两种输出模式使用相同的执行事件；本文件保持文本界面的交互审批，JSONL 不经过这里。
 * 颜色仍按 stdout.isTTY 决定；stdout 重定向时正文不含 ANSI 标签颜色。
 *
 * [KEEP 来自 12.1] /mode 是空闲本地命令；提交普通问题时把模式快照传入本轮。
 * [KEEP 来自 12.2] 清单在连续会话内复用，不因开始下一轮或切换模式重建。
 * [KEEP 来自 12.3] 澄清和审批共用 lines.read(signal)；/skip 或 EOF 表示没有回答。
 * 文本界面串行等待本轮结束；运行中的补充队列属于 TUI。
 * 运行观察：重定向 stdout 能保存模型文字，步骤、用量和本地提示留在 stderr。
 */

// [KEEP 来自 19.2] 本地读取等待完成，结果只写本地显示。
import { extensionCommand } from "../extensions/commands.js";
import { skillCommand } from "../skills/catalog.js";
import { screenText } from "./tui/state.js";
import { createInterface } from "node:readline";
// [KEEP 来自 08.3] 输入等待可以独立取消，不关闭整个终端。
import { createLineReader } from "./input.js";
// [KEEP 来自 09.1] 整轮通知由 runAgent 包装，Agent Loop 的决策逻辑沿用。
// [KEEP 来自 09.2] 终端通过异步迭代接收同一轮的结构化事件。
import { emptyCompaction } from "../context/compaction.js";
import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError, UserFacingError } from "../errors.js";
import { createFileCheckpointCommands } from "../sessions/file-checkpoints.js";
// [KEEP 来自 26.1] 人类本地命令只使用当前进程登记表。
import { jobCommand } from "../processes/jobs.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { formatTeachingTrace } from "./teaching-trace.js";
import type { RunOptions, QuestionHandler } from "../agent/run-options.js";
// [KEEP 来自 13.1] 存储只接收模型历史与本地会话白名单，不接收显示器或授权。
import { saveSessionCheckpoint, type SessionWriter, type CheckpointReason, type SessionState } from "../sessions/save-session.js";

// ANSI 颜色只用于交互终端：用户标签为青色，Agent 标签为紫色。
// 输出被管道或文件接收时不加控制字符，便于日志和脚本读取。
/**
 * 根据输出目标决定是否给终端标签添加 ANSI 颜色。
 *
 * - 输入：要显示的文字和 ANSI 颜色编号。
 * - 输出：交互终端得到带颜色的字符串；管道或文件得到原始纯文本。
 * - 关键原因：转义字符适合人眼终端，不应混入日志、重定向文件或测试结果。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

/**
 * 把模型、权限和工具步骤写到 stderr，让 stdout 保留模型文字。
 *
 * - 输入：执行过程中的 AgentEvent；teaching-trace 负责选择字段和整理短说明。
 * - 输出：每条过程说明写入 stderr，模型与工具标签沿用终端配色。
 * - 关键原因：脚本重定向 stdout 时，不会把步骤说明混入模型正文。
 * - 职责边界：本函数只显示过程，连续文字仍由 renderer 写 stdout，也不在这里批准工具。
 */
// [KEEP 来自 09.3] 过程记录写入 stderr，stdout 留给模型文字。
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.error(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.error(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.error(line);
  }
}

/**
 * 创建本轮专用的显示器，让连续文字和步骤记录按顺序出现。
 *
 * - 输入：本轮 AgentEvent；输出是 observe、finish 和 reply 三个显示入口。
 * - 显示片段：第一次 text_delta 写出 Agent 标签，后续片段直接追加；切到步骤或错误提示前补换行。
 * - 完整响应：某次模型决策没有发出片段时，model_finish 仍可显示完整文字。
 * - 避免重复：每次 model_start 重置是否显示过文字的记录，reply 对照最后一次决策已显示原文，只补最终结果新增的尾部。
 * - 职责边界：这里只保存显示状态，不提交历史；已显示的片段也不能证明本轮已经成功。
 */
// [KEEP 来自 20.3] 本轮保留最后一次模型已显示正文，最终回复只补本地收尾新增尾部。
export function createTurnRenderer(quiet = false) {
  let opened = false;
  let streamed = false;
  // [KEEP 来自 20.3] 最终Reply可追加本地收尾；保留已显示原文，只补尚未显示的尾部。
  let displayedText = "";
  const finish = () => {
    if (opened) process.stdout.write("\n");
    opened = false;
  };
  const observe = (event: AgentEvent) => {
    if (event.type === "text_delta") {
      if (!opened) process.stdout.write(`${colorLabel("Agent", 35)} > `);
      opened = true;
      streamed = true;
      displayedText += event.text;
      process.stdout.write(event.text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ""));
      return;
    }
    finish();
    if (event.type === "model_start") { streamed = false; displayedText = ""; }
    if (event.type === "model_finish" && !streamed && event.text) {
      console.log(`${colorLabel("Agent", 35)} > ${event.text}`);
      streamed = true;
      displayedText = event.text;
    }
    // [CHANGED 34.3] quiet保留最终诊断；审批仍由独立handler完整显示。
    if (!quiet || event.type === "run_finish") printProgress(event);
  };
  return { observe, finish, reply: (reply: Reply) => {
    finish();
    const remaining = streamed && reply.text.startsWith(displayedText)
      ? reply.text.slice(displayedText.length).replace(/^\n+/, "") : reply.text;
    printReply({ ...reply, text: remaining }, Boolean(remaining), !quiet);
  } };
}

// [KEEP 来自 09.2] 显示与执行分开推进，结果仍由同一条事件流给出。
/**
 * 顺序显示一轮记录，并从正常结束事件中取回完整回答。
 *
 * - 输入：streamAgentRun 返回的异步记录和本轮 renderer；记录外壳在这里拆出 event。
 * - 输出：每条事件交给 renderer.observe，读完整条流后返回 completed 事件中的 Reply。
 * - 关键原因：text_delta 只表示一段文字，只有 run_finish/completed 才能提供本轮成功结果。
 * - 失败方式：事件流抛错时继续向外传播；流正常结束却没有完整回答时抛出 UserFacingError。
 * - 提前退出：显示抛错会结束异步迭代，生成器随后取消任务并等待清理；这里不提交会话历史。
 */
async function showRun(records: AsyncIterable<AgentRecord>, renderer: ReturnType<typeof createTurnRenderer>): Promise<Reply> {
  let reply: Reply | undefined;
  for await (const { event } of records) {
    renderer.observe(event);
    if (event.type === "run_finish" && event.outcome === "completed") reply = event.reply;
  }
  if (!reply) throw new UserFacingError("任务没有返回完整结果。");
  return reply;
}

/**
 * 让审批和聊天共用同一个可取消的行读取器。
 *
 * - 输入：createLineReader 的返回对象与是否可交互；输出是供 Agent Loop 等待的审批函数。
 * - 关键步骤：先向 stderr 显示完整操作预览，再读取 y / s / n；文件写入和命令只接受本次批准。
 * - 取消处理：read(signal) 会移除本次等待者并拒绝 Promise，旧审批不会继续占用下一轮输入。
 * - 失败方式：非交互运行与 EOF 返回拒绝；取消原因向 Agent Loop 传播，不伪装成用户批准。
 * - 职责边界：这里只收集决定，不执行工具，也不自行保存会话授权。
 */
// [KEEP 来自 08.3] 行读取器接收本轮信号，取消审批无需关闭整个终端。
// [KEEP 来自 09.3] 审批提示写入 stderr，不混入模型正文。
export function createApprovalHandler(
  lines: ReturnType<typeof createLineReader> | undefined,
  interactive: boolean,
): ApprovalHandler {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!interactive || !lines) {
      return { decision: "deny", reason: "非交互运行不能请求批准" };
    }
    console.error(`审批请求：${request.call.name} 将访问 ${request.resource}`);
    console.error(`原因：${request.reason}`);
    // [KEEP 来自 06.1] 审批界面展示工具准备的完整操作，不用模型的承诺代替预览。
    // [KEEP 来自 07.1] 同一处审批既展示文件 diff，也展示命令和 cwd。
    if (request.preview) console.error(`操作预览：\n${request.preview}`);
    process.stderr.write(request.allowSession
      ? "请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝："
      : "请选择：[y] 执行这次操作，[N] 拒绝：");
    // [KEEP 来自 08.3] 取消会移除审批等待者，下一轮聊天不会再被它读取。
    const { value, done } = await lines.read(signal);
    signal.throwIfAborted();
    const choice = done ? "" : value.trim().toLowerCase();
    if (choice === "y") return { decision: "allow_once" };
    if (choice === "s" && request.allowSession) return { decision: "allow_session" };
    return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
  };
}

/**
 * 让澄清和聊天、审批串行使用同一个行读取器。
 * 只有可交互终端且存在 lines 时返回 handler，否则返回 undefined。
 * handler 显示问题和选项，循环等待非空编号或文字；/skip 或 EOF 返回 null。
 * 每次读取使用本轮信号，取消向工具传播；答案只交回原问答等待，不进入下一轮普通聊天。
 */
// [KEEP 来自 09.3] 本地状态写入 stderr。
// [KEEP 来自 12.3] 审批、澄清与普通问题串行使用同一读取器。
export function createQuestionHandler(lines: ReturnType<typeof createLineReader> | undefined, interactive: boolean): QuestionHandler | undefined {
  if (!interactive || !lines) return undefined;
  return async (request, signal) => {
    signal.throwIfAborted();
    console.error(`澄清问题：${request.question}`);
    request.choices.forEach((choice, index) => console.error(`${index + 1}. ${choice}`));
    while (true) {
      process.stderr.write("回答（编号或文字；/skip 跳过）：");
      const { value, done } = await lines.read(signal);
      signal.throwIfAborted();
      if (done || value.trim() === "/skip") return null;
      const answer = value.trim();
      if (!answer) { console.error("回答不能为空，请重输或 /skip。"); continue; }
      const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      return request.choices[index] ?? answer;
    }
  };
}

/**
 * 显示本进程已经批准的只读访问范围。
 * 空集合显示没有范围，否则逐项打印到 stderr；只读显示不扩大或撤销授权。
 */
function printSessionGrants(sessionGrants: ReadonlySet<string>): void {
  if (sessionGrants.size === 0) {
    console.error("本次会话没有已批准的权限范围。");
    return;
  }
  console.error("本次会话已批准：");
  for (const scope of sessionGrants) console.error(`- ${scope}`);
}

/**
 * 处理只属于本地终端的权限命令。
 *
 * - 输入：一行用户文字和当前进程共享的 sessionGrants。
 * - 输出：识别并处理 `/permissions` 时返回 `true`；普通文字返回 `false`。
 * - 关键原因：调用方根据布尔值 `continue`，本地命令不会进入模型消息。
 * - 职责边界：这里只查看批准范围，不修改授权集合；/reset 清历史也不会撤销它。
 */
// [KEEP 来自 05.3] 本地命令只查看会话授权，不进入模型消息。
export function handlePermissionCommand(
  text: string,
  sessionGrants: ReadonlySet<string>,
): boolean {
  if (text !== "/permissions") return false;
  printSessionGrants(sessionGrants);
  return true;
}

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续读取聊天输入，在本轮结束清理后再接收下一次任务。
 *
 * - 输入：已创建的 Model、运行选项和可选 writer；聊天、本地命令和 Ctrl+C 来自同一个终端。
 * - 输出：每轮显示回答或中断原因；/exit、EOF 或空闲时 Ctrl+C 结束会话。
 * - 关键步骤：每次普通问题创建 controller 和 renderer，history 与 sessionGrants 在整个会话内复用。
 * - 本轮执行：消费 streamAgentRun，由 showRun 逐条显示并从 completed 事件取得 Reply。
 * - 取消处理：Ctrl+C 取消 active、清空排队行与未提交草稿；等任务清理后才清空 active。
 * - 会话终止：SIGTERM / SIGHUP 取消本轮、保存最后状态，并保留对应退出码 143 / 129。
 * - 状态处理：核心保存本轮历史，/reset 只清空历史，不撤销授权或工具副作用。
 * - 职责边界：本地命令不进入模型，失败也不自动重试已经执行的工具。
 * - 输出位置：输入提示、readline 回显、本地命令和中断说明写入 stderr，模型文字仍由 renderer 写 stdout。
 */
// [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
// [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
// [KEEP 来自 13.1] writer 由 CLI 管理；可选参数方便离线调用，不改变模型接口。
export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
  options = { ...options, sessionId: writer?.id ?? options.sessionId };
  // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
  const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
  let mode = options.mode ?? initial?.mode ?? "execute";
  // [KEEP 来自 12.2] 持续会话复用清单，下一轮与模式切换不重建。
  const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
  // [KEEP 来自 13.1] 文本会话没有补充队列，但保留统一状态结构和任务计数。
  let run = initial?.run ?? 0;
  const pendingInputs = structuredClone([...(initial?.pendingInputs ?? [])]);
  const nextInputId = initial?.nextInputId ?? 1;
  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs, run, nextInputId });
  /**
   * 在明确触发点保存当前文本会话，并单独报告存储结果。
   * 失败设 exitCode=1 并保留 history 与 tasks；下一轮必须先成功保存 run_start 才能请求模型。
   */
  const checkpoint = async (reason: CheckpointReason) => {
    const feedback = await saveSessionCheckpoint(writer, snapshot(), reason);
    if (feedback) { console.error(feedback.message); if (!feedback.ok) process.exitCode = 1; }
  };
  // [KEEP 来自 14.3] 本地恢复命令串行执行，确认前不改文件。
  const fileCommand = createFileCheckpointCommands(options.fileCheckpoints);
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  // [KEEP 来自 26.3] 会话级通知即使模型空闲也可见；不写入模型历史。
  const unsubscribeJobs = model.jobs?.subscribe(({ type, job }) => {
    console.error(screenText(`[作业${type === "ready" ? "输出就绪" : "已结束"}] ${job.id} ${job.state} readiness=${job.readiness}${job.evidence ? ` evidence=${JSON.stringify(job.evidence)}` : ""}`));
  });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  // [KEEP 来自 12.3] 交互问答复用同一行读取器，不能与聊天竞争输入。
  const askUser = options.askUser ?? createQuestionHandler(lines, terminal);
  const sessionGrants = new Set<string>();
  let active: AbortController | undefined;
  let exiting = false;
  const stop = () => {
    if (active) {
      active.abort();
      lines.clear();
      // [KEEP 来自 08.3] 丢弃未按回车的审批草稿，避免 y 残留成下一轮的 ynext。
      if (terminal) {
        input.write(null, { ctrl: true, name: "u" });
        input.write(null, { ctrl: true, name: "k" });
        process.stderr.write("\n");
      }
      return;
    }
    exiting = true;
    input.close();
    process.exitCode = 130;
  };
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  // [KEEP 来自 13.1] 终止和挂断关闭整个会话，当前任务仍先完成取消清理与保存。
  /** 以指定退出码结束文本会话，取消本轮并关闭输入；循环 finally 负责最后保存。 */
  const exit = (code: number) => { exiting = true; active?.abort(); input.close(); process.exitCode = code; };
  /** 将 SIGTERM 交给正常会话清理入口。 */
  const terminate = () => exit(143);
  /** 将 SIGHUP 交给正常会话清理入口。 */
  const hangup = () => exit(129);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  console.error(`当前模式：${mode}；/mode plan|execute 切换模式。`);
  console.error("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stderr.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      // [KEEP 来自 26.2] text的行读取器始终拥有stdin；接管只能使用可暂停Ink的TUI。
      if (/^\/fg(?:\s|$)/.test(text)) { console.error("PTY接管请使用 --output tui；text入口只支持/jobs /job /stop。"); continue; }
      // [KEEP 来自 26.2] 本地停止等待对应transport收尾，查询不触发模型请求。
      if (/^\/(jobs|job|stop)(?:\s|$)/.test(text)) {
        try { console.error(screenText(await jobCommand(text, model.jobs))); }
        catch (error) { console.error(screenText(explainError(error))); }
        continue;
      }
      if (/^\/model(?:\s|$)/.test(text)) { console.error(screenText(model.command?.(text).message ?? "当前模型不支持本地切换。")); continue; }
      if (/^\/(attach|attachments|detach)(?:\s|$)/.test(text)) {
        active = new AbortController();
        try { console.error(screenText((await model.attachments?.command(text, active.signal))?.message ?? "当前模型未连接附件状态。")); }
        catch (error) { console.error(active.signal.aborted ? "附件读取已取消，原待发送引用保留。" : screenText(explainError(error))); }
        finally { active = undefined; }
        continue;
      }
      // [KEEP 来自 31.2] 与TUI共用本地命令，结果不进入模型历史。
      if (/^\/extension(?:\s|$)/.test(text)) {
        active = new AbortController();
        try { console.error(screenText(await extensionCommand(text, model.extensions, mode, active.signal))); }
        catch (error) { console.error(screenText(explainError(error))); }
        finally { active = undefined; }
        continue;
      }
      // [KEEP 来自 19.2] 加载时 Ctrl+C 只取消本地读取，finally 后才接下一行。
      if (/^\/(skills|skill)(?:\s|$)/.test(text)) {
        active = new AbortController();
        try { console.error(screenText(model.skills ? (await skillCommand(text, model.skills, active.signal) ?? "") : "当前运行未连接技能目录。")); }
        catch (error) { console.error(active.signal.aborted ? "技能加载已取消，未接纳半份正文。" : screenText(explainError(error))); }
        finally { active = undefined; }
        continue;
      }
      // [KEEP 来自 18.1] 空闲本地管理不进入历史，也不触发模型。
      if (/^\/memory(?:\s|$)/.test(text)) {
        console.error(model.memory ? await model.memory.command(text, mode) : "当前运行未连接项目记忆。");
        continue;
      }
      // [KEEP 来自 14.3] 只在任务循环外处理文件恢复，不会与工具并发。
      if (/^\/(changes|restore)(?:\s|$)/.test(text)) {
        const result = await fileCommand(text); console.error(result.message);
        if (result.restored) { history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
        continue;
      }
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        Object.assign(context, emptyCompaction());
        console.error("已清空当前对话，下次提问将开始新的上下文。");
        // [KEEP 来自 13.1] reset 只清模型历史，保存后的清单与授权规则各自不变。
        await checkpoint("reset");
        continue;
      }
      // [KEEP 来自 12.1] 空闲本地切换模式，不把命令发送给模型。
      if (text === "/mode" || text.startsWith("/mode ")) {
        const requested = text.slice(6).trim();
        if (requested === "plan" || requested === "execute") mode = requested;
        console.error(`当前模式：${mode}${requested && requested !== "plan" && requested !== "execute" ? "；用法：/mode plan|execute" : ""}`);
        // [KEEP 来自 13.1] 查询和无效 mode 不写文件；有效本地模式操作才保存。
        if (requested === "plan" || requested === "execute") await checkpoint("mode");
        continue;
      }
      active = new AbortController();
      // [KEEP 来自 13.1] 新任务计数也属于会话检查点。
      run++;
      // [CHANGED 34.3] 文本简洁选项不改变事件或执行。
      const renderer = createTurnRenderer(options.quiet);
      try {
        // [KEEP 来自 13.3] 开始标记落盘后才能调用模型；写入失败时不启动外部操作。
        await writer?.save(snapshot(), "run_start");
        active.signal.throwIfAborted();
        // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
        const reply = await showRun(streamAgentRun(model, history, text, active.signal,
          // [KEEP 来自 12.2] 每轮固定模式，并把共用清单传到核心。
          requestApproval, sessionGrants, { ...options, context, mode, tasks, askUser }), renderer);
        renderer.reply(reply);
        // [KEEP 来自 13.1] 整个会话退出已设置 SIGTERM/SIGHUP 退出码时，不由本轮覆写。
        if (!exiting) process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.error("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
          // [KEEP 来自 13.1] 会话正在退出时保留对应信号码，取消本轮不把它改成成功。
          if (!exiting) process.exitCode = 0;
        } else {
          console.error(`错误：${explainError(error)} 已保留本轮状态，可以继续输入；程序不会自动重试。`);
          // [KEEP 来自 13.1] 普通任务错误仍设 1，整会话终止则保留信号退出码。
          if (!exiting) process.exitCode = 1;
        }
      } finally {
        // [KEEP 来自 13.1] 流已清理并提交成功或中断历史；保存完成后才接收下一轮。
        await checkpoint("run_end");
        active = undefined;
      }
    }
  } finally {
    active?.abort();
    // [KEEP 来自 13.1] EOF、本地退出或终止都保存最后状态；CLI 在返回后 close。
    await checkpoint("exit");
    // [KEEP 来自 26.3] 退出先等自有作业收尾，最后移除本地通知。
    try { await model.jobs?.close(); } finally { unsubscribeJobs?.(); }
    lines.dispose();
    input.off("SIGINT", stop);
    input.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
  }
}

/**
 * 处理一次 --prompt 提问，完成或中断后退出，不进入连续聊天。
 *
 * - 输入：已创建的模型、非空问题、运行选项和可选 writer；可交互时询问审批，其他情况默认拒绝 ask。
 * - 执行方式：消费 streamAgentRun，逐条显示事件，流结束后取得完整 Reply。
 * - 输出：生成期间显示文字和步骤，成功时补上用量，已经显示的正文不会重复打印。
 * - 取消处理：Ctrl+C / SIGINT、SIGTERM、SIGHUP 分别设退出码 130、143、129，等模型或工具清理后保存。
 * - 失败方式：非取消错误继续交给 CLI 说明；finally 结束显示行、关闭输入并移除本次监听。
 * - 存储边界：finally 保存已提交历史并显示结果；本节只保存，不读取旧会话或自动重试。
 * - 输出位置：审批与 readline 回显使用 stderr，正文保留在 stdout。
 */
// [KEEP 来自 08.3] 单次模式也使用可取消读取，并在退出时释放输入监听。
// [KEEP 来自 09.3] readline 的回显与审批提示使用 stderr。
// [KEEP 来自 13.1] 单次文本提问也有完整历史，writer 的关闭仍归 CLI。
export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
  options = { ...options, sessionId: writer?.id ?? options.sessionId };
  // [KEEP 来自 13.3] 历史只成为新请求的上下文，旧工具不会从这里再次调度。
  const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
  const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
  const mode = options.mode ?? initial?.mode ?? "execute";
  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs: initial?.pendingInputs ?? [], run: (initial?.run ?? 0) + 1, nextInputId: initial?.nextInputId ?? 1 });
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    : undefined;
  // [KEEP 来自 08.3] 单次模式的审批也复用可取消读取。
  const lines = input ? createLineReader(input) : undefined;
  // [KEEP 来自 07.2] 单次模式也传播 Ctrl+C，先取消子进程再关闭输入。
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    input?.close();
    process.exitCode = 130;
  };
  input?.on("SIGINT", stop);
  process.on("SIGINT", stop);
  // [KEEP 来自 13.1] 终止信号也等待流清理和最后检查点，避免直接退出丢掉取消历史。
  /** 取消单次任务并保留 SIGTERM 退出码，finally 随后保存。 */
  const terminate = () => { controller.abort(); input?.close(); process.exitCode = 143; };
  /** 取消单次任务并保留 SIGHUP 退出码，finally 随后保存。 */
  const hangup = () => { controller.abort(); input?.close(); process.exitCode = 129; };
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  // [KEEP 来自 08.1] 单次提问使用相同的增量显示器。
  // [CHANGED 34.3] 单次文本任务使用同一呈现策略。
  const renderer = createTurnRenderer(options.quiet);
  try {
    const signal = controller.signal;
    await writer?.save(snapshot(), "run_start");
    signal.throwIfAborted();
    if (!options.quiet) console.error(`当前模式：${mode}`);
    // [KEEP 来自 09.2] 单次提问复用同一个事件消费者。
    // [KEEP 来自 13.1] 保留真实 Message[]，不从 stdout 或 AgentRecord 重建上下文。
    const reply = await showRun(streamAgentRun(model, history, prompt, signal,
      // [KEEP 来自 12.3] 单次文本任务也可等待澄清；非交互环境没有问答入口。
      createApprovalHandler(lines, interactive), new Set<string>(), { ...options, context, mode, tasks, askUser: options.askUser ?? createQuestionHandler(lines, interactive) }), renderer);
    if (!controller.signal.aborted) renderer.reply(reply);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    renderer.finish();
    controller.abort();
    // [KEEP 来自 13.1] 单次任务收尾就是最后检查点；成功、失败和取消都保存已提交状态。
    const feedback = await saveSessionCheckpoint(writer, snapshot(), "run_end");
    if (feedback) { console.error(feedback.message); if (!feedback.ok) process.exitCode = 1; }
    process.off("SIGINT", stop);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    lines?.dispose();
    input?.off("SIGINT", stop);
    input?.close();
  }
}

// [KEEP 来自 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
/**
 * 补上尚未显示的模型正文，并把用量信息写到 stderr。
 *
 * - 输入：统一 Reply 与 showText；false 表示正文已逐段显示，不必再次打印。
 * - 输出：需要补出的正文写 stdout，用量与截断提示写 stderr。
 * - 关键原因：用量来自模型接口报告，未知值仍显示“未知”，不由文本长度推算 token 或费用。
 * - 职责边界：只显示结果，不提交历史，也不再次请求模型。
 */
// [KEEP 来自 08.1] 文字已经逐段显示时，只补用量，不重复整段回答。
// [KEEP 来自 09.3] 正文写入 stdout，用量与提示写入 stderr。
// [CHANGED 34.3] 简洁输出保留正文和截断提示，省略统计行。
export function printReply(reply: Reply, showText = true, showUsage = true): void {
  if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // [KEEP 来自 15.1] 显示服务商报告的本轮累计；缺失仍写未知，不用本地估算填补。
  if (showUsage) console.error(`服务商报告本轮累计：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.error("提示：回答达到输出上限，可能尚未完整。");
}
```

</details>

<!-- build-file: src/ui/tui/app.tsx -->
<details>
<summary>src/ui/tui/app.tsx 完整文件</summary>

```typescript
/**
 * 34.3 停止无进展任务并保留成果 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：让扩展管理与任务共享忙碌边界，并显示实际完成或清理失败的本地结果。
 * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
 * 输出：草稿、历史、模式、本地预算、服务商用量、保存状态和审批面板。
 * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
 * 失败：保留已收到的结果，等事件流清理后解除忙碌；取消不会撤销工具操作。
 *
 * 本文件局部流程（界面操作；全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
 *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
 *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
 *   [KEEP 来自 18.1] 空闲 /memory -> 本地命令槽 -> 等待结束 -> 历史显示回执；不发模型
 *   [KEEP 来自 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
 *   [KEEP 来自 12.4] 普通 Enter -> 忙碌？-- 是 -> 本地命令？-- 是 -> 保留草稿、提示等待
 *                                         +-- 否 -> 校验补充、加入当前轮队列、清草稿
 *                              +-- 否 -> 本地命令或 startRun
 *   [KEEP 来自 12.4] Ctrl+S -> 校验并记住新要求 -> clearing 锁住提交 -> abort 旧任务
 *                   -> [KEEP 来自 13.1] await 旧 done（流清理和检查点保存）-> closing？-- 是 -> 结束；否 -> startRun
 *   [KEEP 来自 12.2] 任务清单工具结果 -> 会话内清单 -> 摘要和至多三项进度
 *   [KEEP 来自 12.3] ask_user -> waitForAnswer -> 问答面板独占输入 -> 原问答 Promise
 *                   -> 回答 / Esc / 取消 -> 关闭面板，普通草稿继续保留
 *   [KEEP 来自 12.4] startRun -> 用当前 run 绑定收取回调 -> 事件流 -> input_applied 才显示生效
 *                   -> [KEEP 来自 13.1] finally 等清理 -> 保存检查点 -> 解除占用，未收取队列留存
 *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；正在编辑队列时暂不切换
 *   [KEEP 来自 12.5] 队列 -> e 编辑 / x 撤回 -> 固定 ID 查找；已收取 -> 编辑稿留存
 *                    空闲 Enter -> 再查 ID -> 移出队列 -> 作为新任务发送
 *   [KEEP 来自 15.1] context_budget -> 独立预算行；model_usage -> 历史状态，缺失用量显示未知
 *   [KEEP 来自 15.1] 预算多占一行 -> 历史 / 队列视口减一行；16 行时隐藏任务摘要保住草稿
 *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
 *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
 *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑
 *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑、撤回 -> 调用时复制白名单 -> 保存反馈
 *   [KEEP 来自 13.1] 正常退出 -> 最后检查点 -> close（失败仍恢复终端）-> 卸载、反馈
 *
 * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
 * 清单进度是模型通过工具报告的状态；实际测试是否成功要看命令的结果。
 * 输入队列最多 20 项，每项最多 32000 个 UTF-16 单元；拒绝入队时保留草稿。
 * 运行观察：队列编辑稿与普通草稿分开，失效条目不会把编辑内容写到邻项。
 */
// [KEEP 来自 19.1] 来源作为本地显示条目，不进入模型历史。
import { extensionCommand } from "../../extensions/commands.js";
import { skillInfo, skillCommand } from "../../skills/catalog.js";
// [KEEP 来自 26.3] 订阅随组件装卸，通知不创建模型回合。
import { useEffect, useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [KEEP 来自 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { QuestionPanel, waitForAnswer, type PendingQuestion } from "./questions.js";
// [KEEP 来自 12.5] 引入 input-queue 的本节类型或实现。
import { newInputQueue, enqueueInput, takePendingInputs, hasPendingInputs, validateQueuedText, type InputQueue, removeQueuedInput, type QueueEntry } from "./input-queue.js";
// [KEEP 来自 12.5] 引入 queue-panel 的本节类型或实现。
import { QueuePanel } from "./queue-panel.js";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import { createFileCheckpointCommands, type FileCheckpointStore } from "../../sessions/file-checkpoints.js";
// [KEEP 来自 26.1] 本地作业命令不作为模型消息或权限记录。
// [KEEP 来自 26.2] Ink暂停期间，独占的人类输入通道才会监听stdin。
import { takeoverJob } from "../../processes/takeover.js";
import { jobCommand } from "../../processes/jobs.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
import { emptyCompaction, type CompactionState } from "../../context/compaction.js";
import type { ExecutionMode, TaskState } from "../../agent/run-options.js";
// [KEEP 来自 13.1] 模型消息与未交付补充分开投影，授权和显示状态不进入文件。
import { saveSessionCheckpoint, type SessionWriter, type CheckpointReason, type SaveFeedback, type SessionState } from "../../sessions/save-session.js";

// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
/**
 * 当前 TUI 会话的控制与长期状态。
 * 模式供新一轮取快照；历史和只读授权在各轮之间复用。
 * 清单由会话持有，不因切换模式或取消一轮而重建。
 * 队列跨轮保留，所属轮由条目的 run 与收取回调限定；clearing 保护打断清理期间的提交。
 * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
 */
type Session = {
  // [CHANGED 34.3] 只继承本地沉默上限，不从历史恢复控制选项。
  noProgressTimeoutMs?: number;
  // [KEEP 来自 16.1] 摘要视图独立于完整历史，组件重绘不会重建。
  context: CompactionState;
  // [KEEP 来自 12.1] 会话模式供下一轮启动取快照。
  mode: ExecutionMode;
  // [KEEP 来自 12.2] 会话清单独立于单轮控制器。
  tasks: TaskState;
  // [KEEP 来自 12.4] 补充队列跨轮保留，条目各自记所属轮。
  queue: InputQueue;
  // [KEEP 来自 12.4] 打断清理期间锁住提交，防止并发开新轮。
  clearing: boolean;
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
  external?: { controller: AbortController; done: Promise<void> };
  // [KEEP 来自 13.1] writer 跨轮复用；保存反馈单独显示，不混入模型执行状态。
  // [KEEP 来自 14.2] 会话长期持有检查点入口，组件重绘不重建。
  fileCheckpoints?: FileCheckpointStore;
  // [KEEP 来自 14.3] 预览计划属于会话，不随 React 重绘丢失。
  fileCommand: ReturnType<typeof createFileCheckpointCommands>;
  writer?: SessionWriter;
  saveRequest: number;
  saveMessage: string;
};

// [KEEP 来自 13.1] 界面动作和退出共用一次白名单检查点，不依赖 React effect。
/**
 * 保存当前 TUI 会话，并保留最新一次请求的反馈。
 * 调用立即将白名单传给 writer，同步复制之后才 await；权限、显示条目和草稿没有入口。
 * 较早保存完成不覆盖较新请求的状态；失败仅报告存储结果，内存会话仍可继续。
 */
async function checkpointTui(session: Session, reason: CheckpointReason): Promise<SaveFeedback | undefined> {
  const request = ++session.saveRequest;
  const feedback = await saveSessionCheckpoint(session.writer, {
    messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items,
    pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId,
  }, reason);
  if (feedback && request === session.saveRequest) session.saveMessage = feedback.message;
  if (feedback && !feedback.ok) process.exitCode = 1;
  return feedback;
}


/**
 * 让用户逐页查看完整请求，再明确提交这一次审批决定。
 *
 * - 输入：当前 PendingApproval 与终端尺寸；request 和 respond 属于同一次核心审批等待。
 * - 输出：当前页、提示和一个审批输入框；next / prev 只翻页，y / n / s 还要按 Enter 才提交。
 * - 状态：page、answer、hint 属于这次面板；请求 key 或窗口尺寸改变时由父组件重新挂载并清空。
 * - 批准条件：窗口至少 40 列、16 行且已经到最后一页；窗口足够大时任意页都可输入 n 拒绝。
 * - 小窗口：工作区暂停输入；放大后继续审批，或用 Ctrl+C 取消本轮任务、Ctrl+D 退出。
 * - 粘贴处理：审批输入不接收粘贴，复制来的正文不能变成审批按键。
 * - 关键原因：不能在只显示了部分修改时批准全部内容；尺寸变化后需按新分页重新查看。
 * - 职责边界：本函数只检查显示条件，s 是否属于可记住的只读范围仍由 pending.respond 检查。
 */
// [KEEP 来自 10.3] 审批面板继续只处理本次请求。
function ApprovalPanel({ pending, columns, rows }: { pending: PendingApproval; columns: number; rows: number }) {
  const pages = approvalPages(pending.request, columns, rows);
  const [page, setPage] = useState(0);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const tooSmall = columns < 40 || rows < 16;
  usePaste(() => setHint("审批不接受粘贴，请手动输入 y、n 或 s 后回车。"));
  // 翻页只更新画面；窗口足够大时任意页可拒绝，批准还要到最后一页。
  /**
   * 检查本次审批输入，翻页或交回明确决定。
   * next / prev 只切换页；批准前必须在足够大的窗口查看到最后一页，拒绝可在任意完整页提交。
   * respond 继续检查本次决定和可记住范围，本函数不能把粘贴文字变成批准。
   */
  const submit = (value: string) => {
    const choice = value.trim().toLowerCase();
    setAnswer("");
    if (choice === "next" && page < pages.length - 1) { setPage(page + 1); setHint(""); return; }
    if (choice === "prev" && page > 0) { setPage(page - 1); setHint(""); return; }
    if (choice !== "n" && (tooSmall || page !== pages.length - 1)) { setHint("请先逐页查看完整内容，或输入 n 拒绝。"); return; }
    if (!pending.respond(choice)) setHint("请输入 y、n，或当前请求允许的 s，再按 Enter。");
  };
  // [KEEP 来自 11.5] 审批的颜色和光标装饰尊重 NO_COLOR，判断规则不靠颜色表达。
  return <Box borderStyle="round" borderColor={useColor ? "yellow" : undefined} paddingX={1} flexDirection="column">
    <Text bold={useColor} color={useColor ? "yellow" : undefined}>等待批准 · 第 {page + 1}/{pages.length} 页</Text>
    {tooSmall ? <Text>窗口过小，请放大至至少 40 列、16 行后继续审批；Ctrl+C 取消本轮任务，Ctrl+D 退出。</Text> : <Text>{pages[page]}</Text>}
    <Text dimColor={useColor}>next 下一页 · prev 上一页 · n 拒绝</Text>
    <Text>{!tooSmall && page === pages.length - 1 ? `y 批准本次${pending.request.allowSession && !pending.request.preview ? " · s 本次会话允许" : ""}；输入后按 Enter` : "查看到最后一页后才能批准"}</Text>
    {hint && <Text color={useColor ? "yellow" : undefined}>{hint}</Text>}
    <Box><Text color={useColor ? "yellow" : undefined}>审批 &gt; </Text><TextInput focus={!tooSmall} showCursor={useColor} value={answer}
      onChange={(value) => setAnswer(screenText(value).replace(/[\r\n\t]/g, " "))} onSubmit={submit} /></Box>
  </Box>;
}

/**
 * 把草稿、会话控制和执行事件连成可操作的终端工作区。
 * 普通任务只由提交 handler 启动；组件重绘不创建模型请求。
 * 焦点决定普通按键由哪一区处理，审批或澄清占用时暂停工作区输入。
 * 忙碌 Enter 入当前轮补充队列；Ctrl+S 先保存要求、取消旧轮并等清理，再开新轮。
 * 队列焦点使用独立编辑稿，保存和单独发送都重新查固定 ID。
 * 局部 current 顺序累积事件；finally 等事件流清理后才解除占用。
 * 显示条目与模型历史分别保存；本组件不直接执行工具、提交历史或撤销副作用。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
// [KEEP 来自 12.5] 界面接入本节操作；具体状态和按键变化在对应分支标明。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  // [KEEP 来自 13.3] 从模型消息重建阅读条目；不恢复旧流、审批等待或工具执行器。
  const [entries, setEntries] = useState<Entry[]>(() => [
    // [KEEP 来自 17.1] 进入 TUI 后仍可在历史区查看本次实际加载来源。
    ...(model.projectInfo ? [{ id: "project-instructions", label: "本地" as const, text: screenText(model.projectInfo.join("\n")) }] : []),
    ...(model.skills ? [{ id: "skill-catalog", label: "本地" as const, text: screenText(skillInfo(model.skills).join("\n")) }] : []),
    ...session.history.map((message, index): Entry => ({
      id: `restored-${index}`,
      label: message.role === "user" ? "你" : message.role === "assistant" ? "Agent" : "工具",
      text: screenText(message.role === "tool" ? `${message.toolCallId} · ${message.isError ? "失败" : "已返回"}` : message.content),
      ...(message.role === "tool" ? { details: screenText(message.content) } : {}),
    })),
    ...(session.writer?.restored ? [{ id: "restored-notice", label: "本地" as const, text: "会话已恢复；等待新要求，不重放旧工具。权限需重新确认，旧补充保留原任务归属。" }] : []),
  ]);
  const [busy, setBusy] = useState(false);
  // [KEEP 来自 12.5] 焦点增加队列；草稿、历史、队列只由当前焦点处理普通键。
  const [focus, setFocus] = useState<"draft" | "history" | "queue">("draft");
  const [notice, setNotice] = useState("");
  // [KEEP 来自 13.1] 保存状态有独立一行，模型完成或取消不等于保存成功。
  const [saveMessage, setSaveMessage] = useState(session.saveMessage);
  const [, refreshQueue] = useState(0);
  const [editing, setEditing] = useState(false);
  // [KEEP 来自 12.5] 编辑队列时暂停全局焦点切换，独立编辑稿继续保留。
  const [queueEditing, setQueueEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  // [KEEP 来自 12.3] 澄清面板保存当前请求，与审批和普通草稿分开。
  const [question, setQuestion] = useState<PendingQuestion>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // [KEEP 来自 11.5] 先判断窗口是否容得下工作区，再决定普通输入是否激活。
  const tooSmall = columns < 40 || rows < 16;
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  /**
   * 把本地提示或已提交问题加入显示记录。
   * 分配稳定显示 ID，并以函数式更新追加到旧条目后；这里不提交模型历史。
   */
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };
  // [KEEP 来自 26.3] 输出就绪和终态单独进入本地记录，正文来自同一个登记表快照。
  useEffect(() => model.jobs?.subscribe(({ type, job }) => {
    if (!session.closing) append("本地", `[作业${type === "ready" ? "输出就绪" : "已结束"}] ${job.id} ${job.state} readiness=${job.readiness}${job.evidence ? ` evidence=${JSON.stringify(job.evidence)}` : ""}`);
  }), [model, session]);
  // [KEEP 来自 13.1] 只由明确操作调用；编辑草稿与 Enter 入队不自动刷盘。
  /**
   * 启动一次检查点并刷新独立保存状态，不改变模型任务的成功、失败或取消结果。
   * 保存失败由 checkpointTui 转为反馈，fire-and-forget 本地操作不会产生未处理拒绝。
   */
  const checkpoint = async (reason: CheckpointReason) => {
    if (session.writer) { session.saveMessage = "正在保存会话…"; setSaveMessage(session.saveMessage); }
    await checkpointTui(session, reason);
    if (!session.closing) setSaveMessage(session.saveMessage);
  };

  // [KEEP 来自 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
  /**
   * 在空闲时把终端交给外部编辑器，再取回仍未发送的草稿。
   * 任务、审批、问答或退出正在占用时只提示等待。
   * 编辑成功形成一次草稿修改；失败保留原文，结束后解除外部占用。
   */
  const openEditor = () => {
    if (session.done || session.external || session.closing || session.clearing || approval || question) { setNotice("请在当前任务结束后编辑草稿。"); return; }
    const controller = new AbortController();
    setEditing(true);
    session.external = { controller, done: (async () => {
      try {
        let text = draft.text;
        await suspendTerminal(async () => { text = await editExternally(draft.text, controller.signal); });
        if (!session.closing) { setDraft(changeDraft(draft, text)); setNotice("已取回编辑内容，按 Enter 才会发送。"); }
      } catch (error) { if (!session.closing) setNotice(screenText((error as Error).message)); }
      finally { session.external = undefined; if (!session.closing) setEditing(false); }
    })() };
  };
  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [KEEP 来自 11.5] 小窗口保留取消与退出，暂停焦点切换和外部编辑入口。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // [KEEP 来自 12.4] 忙碌 Enter 进入当前轮补充队列，本地命令仍需空闲处理。
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    // [KEEP 来自 12.4] Ctrl+S 只从草稿入口打断并发送，不抢审批或问答输入。
    if (!tooSmall && key.ctrl && input === "s" && focus === "draft" && !approval && !question && !editing) void interruptAndSend(draft.text);
    if (!tooSmall && key.ctrl && input === "g" && focus === "draft") openEditor();
    // [KEEP 来自 12.5] 三处焦点循环，队列编辑和清理期间不切换。
    if (!tooSmall && key.ctrl && input === "o" && !approval && !question && !queueEditing && !session.clearing) setFocus((old) => old === "draft" ? "history" : old === "history" ? "queue" : "draft");
  });

  /**
   * 处理普通草稿 Enter，决定本地命令、排队补充或新任务。
   * 忙碌时普通文字校验后入当前 run 队列，成功才清草稿；本地命令保留到空闲处理。
   * 新任务记录已发送问题，并使用启动时的模式快照；失败提示不会自动重发。
   */
  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing || session.external || session.clearing) return;
    if (session.done) {
      if (isLocalCommand(value.trim())) { setNotice("本地命令需等待本轮结束；草稿已保留。"); return; }
      try {
        // [KEEP 来自 12.4] 校验和入队成功才清草稿；入队不表示已加入上下文。
        const entry = enqueueInput(session.queue, value, session.run);
        setDraft(newDraft());
        refreshQueue((old) => old + 1);
        setNotice(`补充 #${entry.id} 已排队，尚未送到模型；Ctrl+S 可打断并发送草稿。`);
      } catch (error) { setNotice((error as Error).message); }
      return;
    }
    setNotice("");
    const prompt = value.trim();
    if (!prompt) return;
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    // [KEEP 来自 26.2] suspendTerminal暂停Ink唯一底层读者；保留React输入订阅，避免resume早于active效果。
    if (/^\/fg(?:\s|$)/.test(prompt)) {
      const match = /^\/fg ([0-9a-f-]{36})$/.exec(prompt);
      if (!match || !model.jobs) { append("本地", "用法：/fg <本次会话PTY的JobID>。"); return; }
      const controller = new AbortController();
      session.external = { controller, done: (async () => {
        try { await suspendTerminal(async () => { await takeoverJob(model.jobs!, match[1]!, controller.signal); }); }
        catch (error) { if (!session.closing) append("本地", explainError(error)); }
        finally { session.external = undefined; if (!session.closing) setNotice("已收回终端；/job核对状态，/stop显式停止。"); }
      })() }; return;
    }
    // [KEEP 来自 26.2] 停止等对应transport收尾后才恢复输入；日志由现有显示层转义。
    if (/^\/(jobs|job|stop)(?:\s|$)/.test(prompt)) {
      session.clearing = true;
      session.done = (async () => {
        try { append("本地", await jobCommand(prompt, model.jobs)); }
        catch (error) { append("本地", explainError(error)); }
        finally { session.done = undefined; session.clearing = false; }
      })(); return;
    }
    if (/^\/model(?:\s|$)/.test(prompt)) { const result = model.command?.(prompt); append("本地", result?.message ?? "当前模型不支持本地切换。"); if (!result?.ok) setDraft(draft); return; }
    if (/^\/(attach|attachments|detach)(?:\s|$)/.test(prompt)) {
      const controller = new AbortController();
      session.controller = controller; session.clearing = true; setNotice("正在检查附件，Ctrl+C 可取消…");
      setDraft(draft);
      session.done = (async () => {
        try {
          const result = await model.attachments?.command(prompt, controller.signal);
          if (!session.closing) { append("本地", result?.message ?? "当前模型未连接附件状态。"); if (result?.ok) setDraft(newDraft()); }
        } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件读取已取消，原稿与待发送引用保留。" : explainError(error)); }
        finally { session.controller = undefined; session.done = undefined; session.clearing = false; if (!session.closing) setNotice("附件操作已结束；/attachments 可核对待发送列表。"); }
      })();
      return;
    }
    // [KEEP 来自 31.2] 本地能力管理占用同一忙碌槽；取消完成清理后才接受新任务。
    if (/^\/extension(?:\s|$)/.test(prompt)) {
      const controller = new AbortController();
      session.controller = controller; session.clearing = true; setNotice("正在处理扩展；Ctrl+C 可取消…");
      session.done = (async () => {
        try { const result = await extensionCommand(prompt, model.extensions, session.mode, controller.signal); if (!session.closing) append("本地", result); }
        catch (error) { if (!session.closing) append("本地", explainError(error)); }
        finally { session.controller = undefined; session.done = undefined; session.clearing = false; if (!session.closing) setNotice("扩展操作已结束；/extension list 可核对状态。"); }
      })();
      return;
    }
    // [KEEP 来自 19.2] 本地加载拥有独立取消控制器；退出等待读取句柄关闭，不产生用户消息。
    if (/^\/(skills|skill)(?:\s|$)/.test(prompt)) {
      const controller = new AbortController();
      session.controller = controller; session.clearing = true; setNotice("正在读取技能，Ctrl+C 可取消…");
      session.done = (async () => {
        try {
          const result = model.skills ? await skillCommand(prompt, model.skills, controller.signal) : "当前运行未连接技能目录。";
          if (!session.closing && result) append("本地", result);
        } catch (error) {
          if (!session.closing) append("本地", controller.signal.aborted ? "技能加载已取消；完整读取结束前不会加入正文。" : explainError(error));
        } finally {
          session.controller = undefined; session.done = undefined; session.clearing = false;
          if (!session.closing) { setView((current) => ({ ...current, status: "就绪" })); setNotice("技能读取已结束；/skills 可核对来源和加载状态。"); }
        }
      })();
      return;
    }
    // [KEEP 来自 18.1] 异步记忆管理占用本地命令槽，结束前不启动模型任务。
    if (/^\/memory(?:\s|$)/.test(prompt)) {
      session.clearing = true; setNotice("正在处理项目记忆…");
      session.done = (async () => {
        try {
          const result = model.memory ? await model.memory.command(prompt, session.mode) : "当前运行未连接项目记忆。";
          if (!session.closing) append("本地", result);
        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("记忆操作已结束；新任务开始时刷新有效记忆。"); }
      })();
      return;
    }
    // [KEEP 来自 14.3] 立即占用，直到恢复和通知保存完成才开放下一任务。
    if (/^\/(changes|restore)(?:\s|$)/.test(prompt)) {
      session.clearing = true; setNotice("正在核对文件检查点…");
      session.done = (async () => {
        try {
          const result = await session.fileCommand(prompt);
          if (!session.closing) append("本地", result.message);
          if (result.restored) { session.history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
        } catch (error) {
          if (!session.closing) append("本地", error instanceof Error ? error.message : "文件操作未完成，请核对目标。");
        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("文件操作已结束；Ctrl+O 可在历史区查看完整预览。"); }
      })();
      return;
    }
    // [KEEP 来自 13.1] 清空后的模型历史进入检查点；授权不写入文件。
    if (prompt === "/reset") { session.history.length = 0;
      Object.assign(session.context, emptyCompaction()); append("本地", "对话历史已清空；会话授权保留。"); void checkpoint("reset"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    // [KEEP 来自 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
    if (prompt === "/mode" || prompt.startsWith("/mode ")) {
      const mode = prompt.slice(6).trim();
      if (mode === "plan" || mode === "execute") session.mode = mode;
      append("本地", `当前模式：${session.mode}${mode && mode !== "plan" && mode !== "execute" ? "；用法：/mode plan|execute" : ""}`);
      // [KEEP 来自 13.1] 查询或非法 mode 不保存，有效本地模式操作才建立检查点。
      if (mode === "plan" || mode === "execute") void checkpoint("mode");
      return;
    }
    setDraft(draft);
    startRun(prompt);
  };

  /**
   * 识别必须在空闲时本地处理的命令。
   * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
   */
  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|jobs|job|stop|fg|attach|attachments|detach|changes|restore|memory|skills|skill|extension)(?:\s|$)/.test(text);
  /**
   * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
   * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
   * 等待后若已退出就停止；否则解锁、清草稿并 startRun。旧轮未收取队列仍留存。
   */
  const interruptAndSend = async (value: string) => {
    if (session.closing || session.external || session.clearing || approval || question || editing || tooSmall) return;
    let prompt: string;
    try { prompt = validateQueuedText(value); } catch (error) { setNotice((error as Error).message); return; }
    if (isLocalCommand(prompt)) { setNotice("Ctrl+S 需要新的任务要求，本地命令请在空闲时使用。"); return; }
    // [KEEP 来自 12.4] 先保存 prompt，再锁住提交入口，旧轮清理过程中禁止重入。
    session.clearing = true;
    setNotice("正在打断当前任务，清理完毕后发送草稿…");
    // [KEEP 来自 12.4] 先记住旧 done；abort 只是请求停止，必须继续等待清理。
    const previous = session.done;
    session.controller?.abort();
    // [KEEP 来自 13.1] done 延伸到历史检查点保存结束；旧任务清理与保存都结束才开新轮。
    await previous;
    // [KEEP 来自 12.4] 等待期间若已退出，停止发送已保存的新要求。
    if (session.closing) return;
    session.clearing = false;
    startRun(prompt);
  };

  /**
   * 为空闲提交建立一次任务，并顺序消费它的事件。
   * 立即占住 session.done，创建新控制器、run 编号和模式快照；会话清单与历史继续复用。
   * 队列回调闭包固定当前 run，只能收取这一轮条目；askUser 只展示当前问答。
   * finally 等流清理后解除忙碌、保存显示结果，并提示未收取补充仍保留。
   */
  const startRun = (prompt: string, queuedId?: number) => {
    if (session.closing || session.external || session.clearing || session.done) return;
    if (!model.attachments?.pending.length) {
      if (queuedId === undefined) setDraft(newDraft());
      startPreparedRun(prompt, queuedId); return;
    }
    const controller = new AbortController();
    session.controller = controller; session.clearing = true; setNotice("正在预检待发送附件，Ctrl+C 可取消…");
    session.done = (async () => {
      let accepted = false;
      try {
        await model.attachments?.preflight(controller.signal, model.profile?.capabilities.images === true);
        controller.signal.throwIfAborted(); accepted = true;
      } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件预检已取消；原稿与待发送引用保留。" : explainError(error)); }
      finally { session.controller = undefined; session.done = undefined; session.clearing = false; }
      if (!accepted || session.closing) return;
      if (queuedId === undefined) setDraft(newDraft());
      setNotice(""); startPreparedRun(prompt, queuedId);
    })();
  };

  /**
   * 预检已经通过才提交问题；SDK 请求仍会重新读取和核对实际发送字节。
   * 这里继续复用原队列、取消、会话保存与审批流程，不在失败回调覆盖用户新输入。
   */
  const startPreparedRun = (prompt: string, queuedId?: number) => {
    if (session.closing || session.external || session.clearing || session.done) return;
    session.prompts = [...session.prompts, prompt].slice(-100);
    append("你", prompt);
    const run = ++session.run;
    const historyLength = session.history.length;
    setBusy(true);
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();

    // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
    // [KEEP 来自 14.2] 本轮获批准的写入使用当前会话文件检查点。
    // [CHANGED 34.3] 本轮runtime与text/JSONL共用相同监督上限。
    const options = { noProgressTimeoutMs: session.noProgressTimeoutMs, sessionId: session.writer?.id, context: session.context, fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
      // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
      askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
        if (!session.closing) setQuestion(pending);
      }),
      // [KEEP 来自 12.4] 收取闭包绑定 startRun 的 run，旧队列不注入新轮。
      takePendingInputs: () => { const inputs = takePendingInputs(session.queue, run); if (inputs.length && !session.closing) refreshQueue((old) => old + 1); return inputs; },
      // [KEEP 来自 12.4] 终轮回答后可检查剩余补充，尚不移出条目。
      hasPendingInputs: () => hasPendingInputs(session.queue, run),
    };
    session.controller = controller;
    session.done = (async () => {
      let current = emptyRunView();
      try {
        // [KEEP 来自 13.3] 先记下本轮开始前的状态；失败则停止，不调用模型。
        await session.writer?.save({ messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items, pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId }, "run_start");
        controller.signal.throwIfAborted();
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
          if (!session.closing) setApproval(pending);
        }), session.grants, options)) {
          // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          // [KEEP 来自 12.4] 只在核心确认收取并加入本次上下文后显示确认。
          if (event.type === "input_applied" && !session.closing) append("本地", `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${event.text}`);
          // [KEEP 来自 16.3] 已采用或未采用的结论留在本地阅读记录，不写成模型消息。
          if (event.type === "compaction_finish" && !session.closing) append("本地", event.outcome === "applied"
            ? `压缩已采用：前 ${event.through} 条旧记录改用摘要发送，完整记录仍保存。`
            : `压缩未采用：${event.message}`);
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // [KEEP 来自 13.3] 重发文字进入历史后才移出旧队列；开始前失败则保留，避免丢失已保存文字。
        const committed = session.history[historyLength];
        // [KEEP 来自 24.1] 提交前失败时取回清掉的原稿；用户已写的新草稿不能被覆盖。
        if (queuedId === undefined && !session.closing && !(committed?.role === "user" && committed.content === prompt)) {
          setDraft((currentDraft) => currentDraft.text ? currentDraft : newDraft(prompt));
        }
        if (queuedId !== undefined && committed?.role === "user" && committed.content === prompt
          && session.queue.items.find((item) => item.id === queuedId)?.text === prompt) {
          removeQueuedInput(session.queue, queuedId);
          if (!session.closing) refreshQueue((old) => old + 1);
        }
        // [KEEP 来自 13.1] 生成器已完成清理、提交 history；保存结果另行显示，done 继续占用。
        await checkpoint("run_end");
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          // [KEEP 来自 12.3] 任务结束清掉当前面板，普通草稿未被改写。
          setQuestion(undefined);
          setBusy(false);
          // [KEEP 来自 12.4] 本轮剩余补充继续留存，下一轮不会自动使用。
          if (hasPendingInputs(session.queue, run)) setNotice("本轮已结束；未生效的补充仍保留在队列，不会自动进入下一轮。");
        }
      }
    })();
  };

  /**
   * 把空闲时选中的待发送补充作为新任务提交。
   * 先检查任务和交互占用，再按原 ID 找到条目；已经失效时提示且不重复发送。
   * 保留旧条目直到新任务提交历史，随后与结果一起保存；不改原普通草稿。
   */
  const sendQueued = (entry: QueueEntry) => {
    if (session.done || session.closing || session.external || session.clearing || approval || question) return;
    // [KEEP 来自 13.3] 重发前查原 ID；旧条目仍保留在开始检查点中。
    const pending = session.queue.items.find((item) => item.id === entry.id);
    if (!pending) { setNotice("该补充已被收取，不能重复发送。"); return; }
    setNotice(`已将补充 #${pending.id} 作为新的任务发送。`);
    startRun(pending.text, pending.id);
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。

  // [KEEP 来自 12.2] 按窗口显示摘要和至多三项，不丢弃真实清单。
  // [KEEP 来自 15.1] 最小 16 行已占满；暂隐清单摘要，实际任务数据仍留在会话中。
  const taskLines = session.tasks.items.length === 0 || rows < 17 ? 0 : 1 + (rows >= 20 ? Math.min(3, session.tasks.items.length, rows - 18) : 0);
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  // [KEEP 来自 12.2] 下方清单区域从会话读取进度，显示报告不等于测试通过。
  // [KEEP 来自 12.3] 下方澄清面板用独立 key 挂载，占用时隐藏普通区但保留草稿。
  // [KEEP 来自 12.5] 下方队列焦点连接专用面板，编辑稿与普通草稿分别保存。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史 / 队列</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消任务 · Ctrl+D 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    {question && <QuestionPanel key={question.key} pending={question} columns={columns} rows={rows} />}
    <Box display={approval || question ? "none" : "flex"} flexDirection="column">
      {taskLines > 0 && <Box flexDirection="column">
        <Text wrap="truncate">任务：{session.tasks.items.filter((item) => item.status === "completed").length}/{session.tasks.items.length} 已完成 · {session.tasks.items.filter((item) => item.status === "in_progress").length} 进行中 · {session.tasks.items.filter((item) => item.status === "pending").length} 待办</Text>
        {session.tasks.items.slice(0, taskLines - 1).map((item) => <Text key={item.id} wrap="truncate">{item.status === "completed" ? "[完成]" : item.status === "in_progress" ? "[进行]" : "[待办]"} {screenText(item.text).replace(/\n/g, " ")}</Text>)}
      </Box>}
      <Box display={focus === "queue" ? "none" : "flex"} flexDirection="column">
        {/* [KEEP 来自 13.1] 保存状态占一行，历史视口相应减少高度。 */}
        <Transcript entries={display} active={focus === "history" && !approval && !question && !editing && !session.clearing && !tooSmall} width={columns} height={Math.max(2, rows - 14 - taskLines)} />
      </Box>
      <Box display={focus === "queue" ? "flex" : "none"} flexDirection="column">
        {/* [KEEP 来自 13.1] onChange 只在队列成功编辑或撤回时调用，不保存独立编辑草稿。 */}
        <QueuePanel queue={session.queue} active={focus === "queue" && !approval && !question && !editing && !session.clearing && !tooSmall} busy={Boolean(session.done || session.clearing)} width={columns} height={Math.max(2, rows - 14 - taskLines)} onChange={() => { refreshQueue((old) => old + 1); void checkpoint("queue_change"); }} onSend={sendQueued} onEditingChange={setQueueEditing} />
      </Box>
      <Text wrap="truncate">模式：{session.mode} · 状态：{view.status} · 待发送补充：{session.queue.items.length}</Text>
      {/* [KEEP 来自 13.1] 存储反馈不是 run_finish，不改模型任务状态。 */}
      {/* [KEEP 来自 15.1] 预算独占一行，历史和队列视口相应减少一行。 */}
      <Text wrap="truncate">{view.budget || "本地预算：等待请求估算；不是服务商实际用量"}</Text>
      <Text wrap="truncate">保存：{saveMessage}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · Enter 排队补充，Ctrl+S 打断并发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !question && !editing && !session.clearing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 / 排队 · Ctrl+S 打断发送 · Ctrl+J 换行 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}

/**
 * 创建整次 TUI 会话，并在退出前等占用全部清理。
 * 输入是模型和启动模式；会话对象只创建一次，重绘或单轮取消不重建历史和授权。
 * 会话还保存清单与补充队列；它们不会随开始下一轮而重置。
 * Ctrl+C 忙碌时取消本轮，空闲时退出；外部编辑占用期间交给编辑器。
 * 退出先设置 closing 阻止新提交，再取消并等待任务和外部编辑，保存并关闭后才卸载。
 */
// [KEEP 来自 13.1] CLI 注入 writer；TUI 退出前保存和关闭，CLI finally 可幂等重复关闭。
export async function startTui(model: Model, initialMode: ExecutionMode = "execute", writer?: SessionWriter, initial?: SessionState, fileCheckpoints?: FileCheckpointStore, noProgressTimeoutMs?: number): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  // [KEEP 来自 13.1] 会话 ID 已在 writer 创建时固定，任务和组件重绘都不会重建文件。
  // [KEEP 来自 13.3] 深拷贝可信快照，编号接着走；新一轮不能收取旧 run 的补充。
  const history = structuredClone([...(initial?.messages ?? [])]);
  const queue = initial ? { items: structuredClone([...initial.pendingInputs]), nextId: initial.nextInputId } : newInputQueue();
  // [CHANGED 34.3] 参数留在内存，不写白名单会话。
  const session: Session = { noProgressTimeoutMs, context: structuredClone(initial?.context ?? emptyCompaction()), mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, fileCommand: createFileCheckpointCommands(fileCheckpoints), saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
  let instance: ReturnType<typeof render> | undefined;
  // [KEEP 来自 13.1] 退出 Promise 只创建一次；保存和关闭都结束才恢复终端。
  let shutdown: Promise<void> | undefined;
  /**
   * 完成一次整会话退出，顺序等待任务、最终检查点与文件关闭。
   * 保存或关闭失败设退出码 1 并报告，仍卸载恢复终端；重复入口共享 shutdown。
   */
  const finishSession = (code: number): Promise<void> => {
    shutdown ??= (async () => {
      session.closing = true;
      session.controller?.abort();
      session.external?.controller.abort();
      await Promise.all([session.done, session.external?.done]);
      // [KEEP 来自 26.1] 所有自有作业清理后才卸载终端；普通run结束不执行这里。
      await model.jobs?.close();
      const feedback = await checkpointTui(session, "exit");
      let closeError: unknown;
      try { await writer?.close(); } catch (error) { closeError = error; }
      process.exitCode = (feedback && !feedback.ok) || closeError ? 1 : code;
      instance?.unmount();
      if (feedback) console.error(`${feedback.message}\n保存文件：${writer!.path}`);
      if (closeError) console.error(`会话文件关闭失败：${explainError(closeError)}`);
    })();
    return shutdown;
  };
  /**
   * 开始退出，封住新提交后等待当前任务与外部编辑结束。
   * 取消对应控制器，清理完成才设置退出码并卸载界面；重复退出直接返回。
   */
  const quit = (code: number) => {
    if (session.closing) return;
    // [KEEP 来自 13.1] finishSession 同步封住新提交，直到保存并关闭后才卸载。
    void finishSession(code);
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  /**
   * 让 Ctrl+C 根据当前占用选择取消本轮或退出。
   * 外部编辑占用时留给编辑器；有任务控制器时只取消它，空闲时以 130 退出。
   */
  const interrupt = () => { if (session.external) return; if (session.controller) session.controller.abort(); else quit(130); };
  /**
   * 将 SIGTERM 交给同一退出清理入口，保留退出码 143。
   */
  const terminate = () => quit(143);
  /**
   * 将 SIGHUP 交给同一退出清理入口，保留退出码 129。
   */
  const hangup = () => quit(129);
  /**
   * 输入结束时正常退出，仍等待现有占用清理。
   */
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // [KEEP 来自 10.4] 界面按键和进程 SIGINT 使用同一个 interrupt 选择取消或退出。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false, alternateScreen: true });
    await instance.waitUntilExit();
  } finally {
    // [KEEP 来自 13.1] 挂载失败或其他退出也执行同一保存与关闭顺序。
    await finishSession(process.exitCode === undefined ? 0 : Number(process.exitCode));
    // 无论正常退出还是挂载失败，只移除本次添加的监听，避免下次进入界面收到重复通知。
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    process.stdin.off("end", endInput);
  }
}
```

</details>

<!-- source:end -->

## 运行验证

```bash
npm run lesson:34.3
```

先做不会联网的检查：

```bash
hello-my-agent --doctor
```

然后用简洁输出执行任务：

```bash
hello-my-agent --output text --quiet --idle-timeout 90 --prompt "读取 package.json，说明构建命令"
```

正常回答后应保留诊断位置；若需要审批，预览与问题仍可见。验证脚本使用短时间限制检查沉默模型、审批暂停、恢复计时及中断历史；真实运行中不要为了制造故障而把有用长任务的上限随意缩短。

```bash
node tests/verify-chapter-34.mjs
```

再次强调完成依据：触发了取消信号，只能说明停止请求已经发出；收到最终事件并且原运行 Promise 已经结束，才说明本次 runtime 已完成自己的收尾。保留的结果仍需要按其真实状态核对，不能因为终端回到输入框就推导远端操作被撤销。

[本章练习与完整答案](/content/chapter-34-reliability/EXERCISES.md) · [返回本章](/content/chapter-34-reliability/README.md)
