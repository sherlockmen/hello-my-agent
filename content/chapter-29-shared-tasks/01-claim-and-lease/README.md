# 29.1 认领与租约：同一项调查只能交给当前持有者

[第 29 章首页](/content/chapter-29-shared-tasks/README.md) · [上一节：28.3 整合与清理](/content/chapter-28-isolated-workspaces/03-integrate-and-cleanup/README.md) · [下一节：29.2 依赖与失联回收](/content/chapter-29-shared-tasks/02-dependencies-reclaim/README.md)

用户要检查登录流程。我们希望一个子助手读入口，另一个读校验，最后由父模型整理两份发现。第25章的`delegate_task`一次等待一个子会话；本节新增的`run_shared_tasks`则让两个固定本地worker从同一张任务表取活，最多同时运行两个只读子会话。

worker是调度器里的一条执行循环，名字固定为`worker-1`、`worker-2`。它不是模型给自己起的身份；每次拿到任务后，它才创建一个第25章的独立子会话。任务ID辨认要做的事，workerID辨认当前执行者，子会话ID辨认这一次模型历史，三个编号用途不同。

## 从用户要求到共享任务

父模型先调用`create_shared_tasks`提交两项只读调查，再调用不带参数的`run_shared_tasks`。登记表保存任务正文、只读角色、状态、认领次数、持有者和本轮token；正文可以由模型提出，归属和状态只能由协调者修改。总量最多32项，ID不能重复；完整批次校验通过后才加入，坏参数不会留下一半任务。

```json
{"tasks":[
  {"id":"entry","role":"explore","task":"读取登录入口文件，说明它怎样调用校验。"},
  {"id":"validation","role":"review","task":"读取登录校验实现，列出有文件依据的遗漏。"}
]}
```

29.1的任务彼此独立，`depends_on`必须为空。调度器启动后，两个worker各自取一项。任务取得的观察最终保存在同一条任务记录中；父模型收到的是这张表的快照，不是两份子会话原始聊天拼在一起。

## 为什么认领必须一次做完

假设两个worker都先读取“entry仍是pending”，再等待某个Promise，之后各自写“我负责entry”，两次读取之间就可能交错。我们把“寻找pending → 检查worker空闲 → 写入owner、running和token”放进一个没有`await`的同步方法。当前进程的JavaScript调用一次跑完这段方法，另一个worker开始认领时就能看见已经更新的状态，因此会取下一项。

这里的“原子”只针对这一进程里、这一实例的同步检查和写入。它不保护另一CLI进程，也没有数据库事务或跨机器锁。`createModel`为整个CLI会话创建一个`SharedCoordinator`，`RunOptions.sharedTasks`把同一实例交给工具；调度器另有批次锁，防止两个`run_shared_tasks`同时复用这两个固定身份。

## 租约为什么还要带token

认领后，worker只能在一段有效期内代表这项任务提交观察，这段有效期叫租约。我们保存`expiresAt`，并在每次认领时让`token`递增。以entry为例，第一次认领是`entry / worker-1 / token=1`；它过期并收尾后，下一次可能是`entry / worker-1 / token=2`。即使worker名字相同，两轮权限也不同。

读取当前任务、续租、发送消息和提交结果前，都必须核对任务ID、owner、token和期限。旧token的结果在新一轮开始后会被拒绝；已经超过期限的结果，即使定时器还没来得及处理，也不能提交。只按任务ID写入结果会让慢返回的旧调查覆盖新调查，token就是用来辨认这份观察属于哪一次认领。

协调者的默认租约是15秒，本地代码可配置30到60000毫秒，模型没有这个参数。runner收到真实子事件时续租，包括模型或工具进展；没有进展超过期限，就请求停止。因此这里把“失联”定义为超过本地进展期限，不能据此断言网络或模型已经崩溃。长时间没有响应也会触发同样处理。

## 请求停止后，为什么还要等

租约过期时，协调者先把任务改为`stopping`，随后调用本轮AbortController。`stopping`仍占有原owner和token，不能被认领。runner继续`await runSubagent`，直到子循环结束、最终检查点保存且会话句柄关闭；只有这个Promise返回后，才把过期任务重新放回`pending`。每项最多认领两次，第二次仍过期就记`failed`，避免无限重试。

这个等待防止旧worker还在读文件或保存会话时，新worker已经开始同一项。如果底层迟迟不响应取消，这项任务会继续停在`stopping`，整个调度工具继续等待，不会假装已经回收。我们用`Promise.allSettled`等待两个worker，某一条循环出错也不提前放掉另一条的清理。

父轮取消时也先停止并等待，但已认领任务最终记`cancelled`，不再自动重试。还没被认领的任务保持`pending`，已经完成的任务与结果留在内存表中；下一轮可以先读表再决定是否继续剩余任务。当前实现不自动重置`failed`或`cancelled`，需要重新调查时建立新的任务ID。取消停止了本次只读调查，没有“撤销读取”这一步；已保存的子会话JSONL仍在本机，进程退出后内存表不会恢复。

## 什么时候能写completed

worker实际调用第25章的`runSubagent`。子模型只能看到`read_file`、`glob`、`grep`，实际执行还有allowlist和原权限策略检查；敏感读取需要审批，两个worker的审批通过同一队列依次展示。父模型已有的命令、写文件、工作区与外部工具能力不会传给子模型。

子模型说“全部完成”不能让共享任务完成。协调者读取本地构造的`ChildResult`：子循环正常返回、检查点与句柄收尾没有把状态改为失败，并且成功只读工具收集到至少一条文件证据，才写`completed`。没有证据、预算耗尽或子会话保存失败记`failed`；子结果明确取消则记`cancelled`。模型摘要只作为待评估的发现保存，不参与完成判断。这项判断证明调查过程取得了本地观察，不证明答案正确、覆盖全部需求或测试通过。

## 结果怎样回到父模型和界面

调度器等所有worker结束，返回任务快照。`shared-task-tools.ts`用同一份快照生成JSON正文与`shared_tasks`元数据；注册表沿原工具入口交给Agent Loop，正文按原调用ID写入父历史。下一次`generate`因此能看到每项状态、子摘要、文件证据与错误，再决定补读、解释失败或组织答复。子会话的原始模型文字和工具消息仍留在独立JSONL里。

协调者还发出`shared_task_state`事件，TUI按任务ID更新一行，显示worker和token；子会话行继续按会话ID展示。界面采用程序事件，不从“我已完成”这句模型回答猜测状态。Plan模式仅能`read_shared_tasks`，不能登记、启动worker或修改消息；实际工具入口也再次拒绝，隐藏工具定义不是唯一保护。

<!-- media:lesson:start -->
沿着entry与validation追踪同步认领、两份只读子会话和结果回流。移动卡到达后接收方才更新；静态图补充旧token、取消和进程退出的边界。

<img src="./content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-cover-b44670992b.png" data-gif-src="./content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-ae5eec77c1.gif" data-cover="./content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-cover-b44670992b.png" data-no-zoom alt="两项只读调查，怎样避免被重复认领？">

[静态流程图](/content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-flow-858e5d56cb.png.md) · [静态封面](/content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-cover-b44670992b.png.md) · [查看完整静态分镜](/content/chapter-29-shared-tasks/01-claim-and-lease/assets/shared-claim-lease-storyboard-b3a3701997.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/agent/agent-loop.ts.md) | 绑定本轮协调者与真实调度回调，等待结束后沿tool消息进入下一次generate。 |
| CHANGED | [src/agent/events.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/agent/events.ts.md) | 增加由本地发出的共享任务状态事件。 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/agent/run-options.ts.md) | 携带会话协调者、调度回调与可信worker绑定。 |
| NEW | [src/collaboration/coordinator.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/collaboration/coordinator.ts.md) | 保存归属与递增租约，校验结果；逐节加入依赖图与消息确认。 |
| NEW | [src/collaboration/runner.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/collaboration/runner.ts.md) | 两个固定worker运行真实只读子会话，取消或过期先await清理再开放认领。 |
| CHANGED | [src/models/client.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/models/client.ts.md) | 为CLI会话创建唯一协调者，提供模型使用说明并过滤Plan工具。 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/permissions/policy.ts.md) | 共享操作限制在本地执行模式，保留所有原文件权限。 |
| CHANGED | [src/tools/registry.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/tools/registry.ts.md) | 统一发现并分发共享工具，不绕过allowedTools。 |
| NEW | [src/tools/shared-task-tools.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/tools/shared-task-tools.ts.md) | 校验有界参数，将同一快照作为正文和metadata返回。 |
| CHANGED | [src/tools/types.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/tools/types.ts.md) | 声明共享任务和消息的结构化观察。 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/ui/teaching-trace.ts.md) | 把实际归属、消息ID和ack转成终端摘要。 |
| CHANGED | [src/ui/tui/state.ts](/content/chapter-29-shared-tasks/01-claim-and-lease/src/ui/tui/state.ts.md) | 按任务ID保存最新本地状态。 |
| CHANGED | [src/ui/tui/transcript.tsx](/content/chapter-29-shared-tasks/01-claim-and-lease/src/ui/tui/transcript.tsx.md) | 在TUI历史中分别显示共享任务与子会话。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md)准备依赖和模型配置，再从上一公开小节的完整`src/`继续。本节目标目录是`chapter-29-shared-tasks/01-claim-and-lease`。新增文件完整保存；修改文件应用下面的精确差异，未列出的文件沿用。所有实现都在本节目录内，不从其他章节导入。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,9 +1,10 @@
 /**
- * 28.3 整合与清理 | [KEEP] agent/agent-loop.ts
+ * 29.1 认领与租约 | [CHANGED] agent/agent-loop.ts
  *
  * [KEEP 来自 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
  * [KEEP 来自 27.2] 排队期限 / 领槽后的执行期限 -> 发停止请求 -> await底层收尾 -> 归还槽。
  * [KEEP 来自 27.3] 每项独立缓冲 -> 同伴全部收尾 -> 按原callID顺序提交整批观察 -> 下一次模型。
+ * 全局共享调查：父generate -> create/run工具 -> 固定worker认领 -> 只读子Agent Loop -> 保存关闭 -> 任务快照tool消息 -> 父下一次generate。
  * 学习目标：每项单独保存观察，同伴收尾后按原调用身份提交整批结果，再请求模型。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
@@ -124,6 +125,8 @@
 import { boundToolResult, clippedToolText } from "../context/tool-results.js";
 import { requestFailedBeforeSending, type Message, type Model, type ModelResult, type Reply } from "../models/client.js";
 import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
+// [NEW 29.1] 共享调度仍用同一权限/工具/模型返回链路。
+import { runSharedTasks } from "../collaboration/runner.js";
 import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
 import type { PreparedToolCall } from "../tools/types.js";
 import { emitAgentEvent, type AgentObserver } from "./events.js";
@@ -185,7 +188,7 @@
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
   // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
   // [KEEP 来自 28.1] 本轮采用CLI对象持有的自有工作区登记；不把Git身份写进会话恢复状态。
-  const toolOptions: RunOptions = { ...options, jobs: model.jobs ?? options.jobs, worktrees: model.worktrees ?? options.worktrees, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
+  const toolOptions: RunOptions = { ...options, jobs: model.jobs ?? options.jobs, worktrees: model.worktrees ?? options.worktrees, sharedTasks: model.sharedTasks ?? options.sharedTasks, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
   toolOptions.delegateTask = async (argumentsJson, childSignal) => {
     if (options.childDepth || ++childCount > 3) throw new ToolError("每轮最多三个只读子任务，子任务不能继续委派。");
     return runSubagent(model, argumentsJson, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory, requestApproval, depth: options.childDepth ?? 0,
@@ -202,6 +205,12 @@
     await previous;
     try { approvalSignal.throwIfAborted(); return await requestApproval!(request, approvalSignal); }
     finally { release(); }
+  };
+  // [NEW 29.1] 等所有worker子会话收尾后返回，结果继续成为tool消息进入下一次generate。
+  toolOptions.runSharedTasks = childSignal => {
+    if (options.childDepth || mode === "plan" || !toolOptions.sharedTasks) throw new ToolError("当前模式或子层不能启动共享worker。");
+    return runSharedTasks(model, toolOptions.sharedTasks, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory,
+      requestApproval: requestApproval ? orderedApproval : undefined, observer });
   };
   const attachments = model.attachments?.take();
   const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
```

</details>

<details>
<summary>CHANGED：src/agent/events.ts 的精确差异</summary>

<!-- source: src/agent/events.ts -->
```diff
--- a/src/agent/events.ts
+++ b/src/agent/events.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] agent/events.ts
+ * 29.1 认领与租约 | [CHANGED] agent/events.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责传递已经发生的模型、权限和工具事件。
  * 输入：runAgent 的开始/结束通知，或 Agent Loop 已发生的过程事件。
@@ -34,6 +34,8 @@
 export type AgentEvent =
   | { type: "run_start" }
   // [KEEP 来自 25.3] 子会话状态独立于父模型 call 和工具 sequence，不包含子文字增量。
+  // [NEW 29.1] 任务归属由协调者发出，与子会话编号分别显示。
+  | { type: "shared_task_state"; taskId: string; workerId: import("../collaboration/coordinator.js").WorkerId; token: number; state: import("../collaboration/coordinator.js").SharedTaskState; detail: string }
   | { type: "child_state"; sessionId: string; parentSessionId: string; role: import("../subagents/runner.js").ChildRole; status: "starting" | "running" | import("../subagents/runner.js").ChildStatus; detail: string }
   // [KEEP 来自 16.3] 摘要准备、候选与实际采用分开；这些事件不能执行工具或修改历史。
   | { type: "compaction_start"; attempt: number }
```

</details>

<details>
<summary>CHANGED：src/agent/run-options.ts 的精确差异</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] agent/run-options.ts
+ * 29.1 认领与租约 | [CHANGED] agent/run-options.ts
  *
  * 学习目标：传递会话持有的工作区管理器与本地调度选项，模型不能自行选择控制对象。
  * 输入：本地入口选定的模式、会话控制对象、调度限制与本轮交互回调。
@@ -71,6 +71,9 @@
   jobs?: import("../processes/jobs.js").JobManager;
   // [KEEP 来自 28.1] 当前CLI持有自有工作区登记，child不继承写入能力。
   worktrees?: import("../workspaces/worktrees.js").WorktreeManager;
+  // [NEW 29.1] 当前会话共享同一登记；回调只由本地Agent Loop绑定。
+  sharedTasks?: import("../collaboration/coordinator.js").SharedCoordinator;
+  runSharedTasks?: (signal: AbortSignal) => Promise<import("../collaboration/coordinator.js").SharedTask[]>;
   sessionId?: string;
   childSessionDirectory?: string;
   childDepth?: number;
```

</details>

<details>
<summary>NEW：src/collaboration/coordinator.ts 的完整代码</summary>

<!-- source: src/collaboration/coordinator.ts -->
```ts
/**
 * 29.1 认领与租约 | [NEW] collaboration/coordinator.ts
 * 学习目标：由一个同步登记表决定任务归属，模型文字不能改变归属或完成状态。
 * 输入：已校验的任务、可信本地worker身份、当前租约与只读子会话结果。
 * 输出：防御性快照；非法转换抛ToolError且不接受旧结果。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   create -> pending -> claim(无await) -> running -> 检查归属/期限 -> completed或failed
 *   running -> stop -> stopping -> 子Promise及清理结束 -> settleStopped -> pending或cancelled/failed
 * 关键原因：停止信号不能证明旧worker结束，stopping期间不允许第二次认领。
 * 观察：每次认领token递增，过期结果不能覆盖下一轮；登记只属于当前进程。
 */
import { ToolError } from "../errors.js";
import type { ChildResult, ChildRole } from "../subagents/runner.js";

// [NEW 29.1] 本文件以下实现均为本节新增。
export type SharedTaskState = "pending" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
export type WorkerId = "worker-1" | "worker-2";
export type WorkerLease = { taskId: string; workerId: WorkerId; token: number };
export type SharedTaskInput = { id: string; task: string; role: ChildRole; dependsOn?: string[] };
export type SharedTask = SharedTaskInput & { dependsOn: string[]; state: SharedTaskState; token: number; attempts: number; owner?: WorkerId; expiresAt?: number; stopReason?: "expired" | "cancelled"; result?: ChildResult; error?: string };

/**
 * 单进程唯一协调者保存内存状态；所有读写都经过当前实例，不从历史恢复控制权。
 * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
 */
export class SharedCoordinator {
  private readonly tasks = new Map<string, SharedTask>();
  private running = false;

  readonly leaseMs: number;
  private readonly clock: () => number;
  /**
   * 本地入口决定时钟和租约长度；测试可传可控时钟，模型没有配置入口。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  constructor(options: { leaseMs?: number; clock?: () => number } = {}) {
    this.leaseMs = options.leaseMs ?? 15_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs < 30 || this.leaseMs > 60_000) throw new ToolError("租约必须在30–60000毫秒之间。");
    this.clock = options.clock ?? Date.now;
  }
  /**
   * 批量验证后一次登记；重复ID、缺失依赖或循环不会留下半批任务。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  create(inputs: SharedTaskInput[]): SharedTask[] {
    if (!inputs.length || this.tasks.size + inputs.length > 32) throw new ToolError("共享任务总数为1–32项。");
    const next = new Map(this.tasks);
    for (const input of inputs) {
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(input.id) || next.has(input.id)) throw new ToolError("任务ID无效或重复。");
      if (!input.task.trim() || input.task.length > 2000 || !["explore", "review"].includes(input.role)) throw new ToolError("任务需要只读角色及1–2000字符正文。");
      const dependsOn = [...(input.dependsOn ?? [])];
      if (dependsOn.length > 16 || new Set(dependsOn).size !== dependsOn.length) throw new ToolError("依赖最多16项且不能重复。");
      next.set(input.id, { id: input.id, task: input.task.trim(), role: input.role, dependsOn, state: "pending", token: 0, attempts: 0 });
    }
    if ([...next.values()].some(task => task.dependsOn.length)) throw new ToolError("29.1暂不支持任务依赖。");
    for (const [id, task] of next) this.tasks.set(id, task);
    this.refreshBlocked(); return this.list();
  }
  /**
   * 复制任务和子结果，观察者或模型工具不能通过返回对象修改登记表。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  list(): SharedTask[] { return structuredClone([...this.tasks.values()]); }
  /**
   * 只允许一个本地调度批次持有这张表，防止并发run重复使用固定worker身份。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  beginRun(): void { if (this.running) throw new ToolError("共享任务调度已经在运行。"); this.running = true; }
  /**
   * 所有worker和子清理完成后释放调度批次；不会清空已完成的任务与结果。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  endRun(): void { this.running = false; }
  /**
   * 检查空闲与依赖后同步认领；检查和写owner之间没有await，所以不会交错。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  claim(workerId: WorkerId): WorkerLease | null {
    if (!["worker-1", "worker-2"].includes(workerId)) throw new ToolError("未知本地worker。");
    if ([...this.tasks.values()].some(task => task.owner === workerId && ["running", "stopping"].includes(task.state))) throw new ToolError("worker尚未结束上一项任务。");
    this.refreshBlocked();
    const task = [...this.tasks.values()].find(task => task.state === "pending" && task.dependsOn.every(id => this.tasks.get(id)?.state === "completed"));
    if (!task) return null;
    task.state = "running"; task.owner = workerId; task.token++; task.attempts++; task.expiresAt = this.clock() + this.leaseMs;
    delete task.error; delete task.stopReason;
    return { taskId: task.id, workerId, token: task.token };
  }
  /**
   * 每次读取、心跳、消息或提交前核对任务ID、worker和token；期限过后也不能接受。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  current(lease: WorkerLease, allowStopping = false): SharedTask {
    const task = this.tasks.get(lease.taskId);
    if (!task || task.owner !== lease.workerId || task.token !== lease.token || (task.state !== "running" && !(allowStopping && task.state === "stopping"))) throw new ToolError("旧租约或任务归属已经失效。");
    if (!allowStopping && this.expired(lease)) throw new ToolError("租约已经过期，结果不能提交。");
    return structuredClone(task);
  }
  /**
   * 以协调者时钟检查当前租约是否过期；不会顺便开放认领。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  expired(lease: WorkerLease): boolean { const task = this.tasks.get(lease.taskId); return !!task && task.owner === lease.workerId && task.token === lease.token && task.state === "running" && this.clock() >= task.expiresAt!; }
  /**
   * worker发生真实进展时续租；迟到心跳不能让已经过期的租约复活。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  heartbeat(lease: WorkerLease): void { this.current(lease); this.tasks.get(lease.taskId)!.expiresAt = this.clock() + this.leaseMs; }
  /**
   * 只有子循环正常结束、检查点关闭且有本地文件证据才记completed；摘要不参与判断。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  finish(lease: WorkerLease, result: ChildResult): void {
    this.current(lease); const task = this.tasks.get(lease.taskId)!;
    task.result = structuredClone(result);
    task.state = result.status === "completed" && result.evidence.length > 0 ? "completed" : result.status === "cancelled" ? "cancelled" : "failed";
    if (task.state !== "completed") task.error = result.error ?? "没有取得成功只读工具的结构化文件证据。";
    this.refreshBlocked();
  }
  /**
   * 先占住停止中的归属，再请求底层取消；此方法本身不证明子会话已经清理。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  stop(lease: WorkerLease, reason: "expired" | "cancelled"): void {
    this.current(lease, true); const task = this.tasks.get(lease.taskId)!;
    task.state = "stopping"; task.stopReason = reason;
  }
  /**
   * 调用方已await旧子Promise及清理后，才允许过期任务再次认领；重试最多两轮。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  settleStopped(lease: WorkerLease): void {
    this.current(lease, true); const task = this.tasks.get(lease.taskId)!;
    if (task.state !== "stopping") throw new ToolError("必须先停止并等待子任务收尾。");
    task.state = task.stopReason === "cancelled" ? "cancelled" : task.attempts < 2 ? "pending" : "failed";
    task.error = task.stopReason === "cancelled" ? "父轮取消，子会话已收尾。" : "租约过期，旧子会话已收尾。";
    delete task.owner; delete task.expiresAt; this.refreshBlocked();
  }
  /**
   * 前置任务失败、取消或已经阻塞时向后传播；未结束的依赖继续等待。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  private refreshBlocked(): void {
    // [KEEP 来自 29.1] 本节任务彼此独立，没有依赖需要传播。
  }

}
```

</details>

<details>
<summary>NEW：src/collaboration/runner.ts 的完整代码</summary>

<!-- source: src/collaboration/runner.ts -->
```ts
/**
 * 29.1 认领与租约 | [NEW] collaboration/runner.ts
 * 学习目标：让固定本地worker实际运行只读子会话，并等清理后提交或开放重领。
 * 输入：当前Model、唯一协调者、父取消和可信运行选项；不接收模型生成的worker权限。
 * 输出：任务快照；父取消等所有子Promise结束后继续向外抛出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   锁批次 -> 两个worker各自claim -> runSubagent -> 等子检查点/close -> finish -> 再claim
 *   超期/父取消 -> stopping + abort -> 仍await子Promise -> settleStopped -> 重试或取消
 * 观察：同时最多两个只读worker；abort尚未完成时同一任务仍不可认领。
 */
import { emitAgentEvent, type AgentObserver } from "../agent/events.js";
import type { Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { runSubagent } from "../subagents/runner.js";
import { SharedCoordinator, type WorkerId, type WorkerLease } from "./coordinator.js";

// [NEW 29.1] 本文件以下实现均为本节新增。
export type SharedRunOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver };
/**
 * 用固定worker实际调度只读子循环，单项失败保存在登记表。
 * 输入为唯一协调者、本地选项与父信号；输出是所有worker收尾后的防御性快照。
 * 父取消等两个worker及子检查点关闭后抛出；内部失败也不提前放掉另一worker。
 */
export async function runSharedTasks(model: Model, coordinator: SharedCoordinator, signal: AbortSignal, options: SharedRunOptions = {}) {
  signal.throwIfAborted(); coordinator.beginRun();
  /**
   * 只发本地状态，模型总结和消息正文不能冒充调度事件。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  const notify = (lease: WorkerLease) => {
    const task = coordinator.list().find(task => task.id === lease.taskId)!;
    emitAgentEvent(options.observer, { type: "shared_task_state", taskId: task.id, workerId: lease.workerId, token: lease.token, state: task.state, detail: task.error ?? `${task.role}；第${task.attempts}次认领` });
  };
  /**
   * 每个固定身份串行认领；下一次认领必定晚于旧子会话完整返回。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  const worker = async (workerId: WorkerId) => {
    while (!signal.aborted) {
      const lease = coordinator.claim(workerId); if (!lease) return;
      notify(lease);
      const controller = new AbortController();
      /**
       * 先锁为stopping再abort，随后仍由下面的await等待子会话清理。
       * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
       */
      const stop = (reason: "expired" | "cancelled") => {
        const task = coordinator.list().find(task => task.id === lease.taskId)!;
        if (task.state !== "running") return;
        coordinator.stop(lease, reason); notify(lease); controller.abort(new Error(reason === "expired" ? "共享任务租约过期" : "父任务取消"));
      };
      const onAbort = () => stop("cancelled"); signal.addEventListener("abort", onAbort, { once: true });
      // [NEW 29.1] 只观察期限，不在定时器中直接开放认领。
      const timer = setInterval(() => { if (coordinator.expired(lease)) stop("expired"); }, Math.max(10, Math.floor(coordinator.leaseMs / 4)));
      try {
        if (signal.aborted) onAbort();
        const task = coordinator.current(lease, true);

        const result = await runSubagent(model, JSON.stringify({ role: task.role, task: task.task }), controller.signal, {
          parentSessionId: options.parentSessionId, sessionDirectory: options.sessionDirectory, requestApproval: options.requestApproval,

          observer: event => {
            // [NEW 29.1] 收到实际子事件才续租；无进展超过期限就停止本轮。
            try { coordinator.heartbeat(lease); } catch { stop("expired"); }
            if (event.type === "child_state") emitAgentEvent(options.observer, event);
          },
        });
        // [NEW 29.1] 即使子返回先于定时器，也不能提交已超期结果。
        if (coordinator.expired(lease)) stop("expired");
        if (coordinator.list().find(task => task.id === lease.taskId)!.state === "running") coordinator.finish(lease, result);
      } catch (error) {
        stop("cancelled"); throw error;
      } finally {
        clearInterval(timer);
        signal.removeEventListener("abort", onAbort);
        if (coordinator.list().find(task => task.id === lease.taskId)!.state === "stopping") coordinator.settleStopped(lease);
        notify(lease);
      }
    }
  };
  try {
    const settled = await Promise.allSettled([worker("worker-1"), worker("worker-2")]);
    signal.throwIfAborted();
    const failed = settled.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return coordinator.list();
  }
  finally { coordinator.endRun(); }
}
```

</details>

<details>
<summary>CHANGED：src/models/client.ts 的精确差异</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] models/client.ts
+ * 29.1 认领与租约 | [CHANGED] models/client.ts
  *
  * 学习目标：每次估算和请求使用相同来源编号提示及工具定义；URL与正文保留在工具消息中，提示不复制网页正文。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -41,6 +41,8 @@
 import { createAttachmentState, type AttachmentRef, type AttachmentState } from "../attachments/store.js";
 // [KEEP 来自 26.1] 会话级进程所有权不在消息或会话文件里。
 // [KEEP 来自 28.1] text/TUI共用同一模型对象持有的会话工作区登记。
+// [NEW 29.1] createModel为整个CLI会话持有单一协调者。
+import { SharedCoordinator } from "../collaboration/coordinator.js";
 import { WorktreeManager } from "../workspaces/worktrees.js";
 import { JobManager } from "../processes/jobs.js";
 import { safeModelError } from "./model-errors.js";
@@ -102,6 +104,8 @@
   readonly jobs?: import("../processes/jobs.js").JobManager;
   // [KEEP 来自 28.1] 不随消息持久化，也不导入旧CLI的Git目录。
   readonly worktrees?: WorktreeManager;
+  // [NEW 29.1] 不从会话JSON恢复控制权。
+  readonly sharedTasks?: SharedCoordinator;
   // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
   // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
   // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
@@ -150,6 +154,8 @@
   const jobs = new JobManager();
   // [KEEP 来自 28.1] 创建管理器不创建Git工作区，副作用必须等工具批准。
   const worktrees = new WorktreeManager();
+  // [NEW 29.1] 本地构造，不接受模型配置worker数或租约。
+  const sharedTasks = new SharedCoordinator();
   let adapter = createProtocolAdapter(config);
   let activeRequests = 0;
   // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
@@ -160,7 +166,7 @@
   return {
     // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
     // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
-    memory, skills, hooks, mcp, web, attachments, jobs, worktrees,
+    memory, skills, hooks, mcp, web, attachments, jobs, worktrees, sharedTasks,
     get profile() { return structuredClone(adapter.profile); },
     beginRun() {
       activeRequests += 1; let released = false;
@@ -243,10 +249,10 @@
   // [KEEP 来自 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
   const definitions = mode === "plan"
     // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
-    ? toolDefinitions.filter((tool) => ["read_worktree", "read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
+    ? toolDefinitions.filter((tool) => ["read_shared_tasks", "read_worktree", "read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
     : [...toolDefinitions, ...external];
   // [KEEP 来自 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
-  const prompt = systemPrompt + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
+  const prompt = systemPrompt + " 共享调查先create_shared_tasks登记，再run_shared_tasks等待真实只读子会话。read_shared_tasks查看本地状态；摘要、todo或消息不能更改共享任务终态。" + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
     ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
     : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
   return { prompt: prompt + projectPrompt, definitions: allowedTools ? definitions.filter(tool => allowedTools.includes(tool.name)) : definitions };
```

</details>

<details>
<summary>CHANGED：src/permissions/policy.ts 的精确差异</summary>

<!-- source: src/permissions/policy.ts -->
```diff
--- a/src/permissions/policy.ts
+++ b/src/permissions/policy.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] permissions/policy.ts
+ * 29.1 认领与租约 | [CHANGED] permissions/policy.ts
  *
  * 学习目标：把本次启用的网页工具与 MCP 一并列为外部工具；Plan 硬拒绝，执行模式仍逐次询问，网页文字不产生批准。
  * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
@@ -24,6 +24,8 @@
  */

 // [KEEP 来自 28.1] 副作用集合由实际登记的工作区工具生成，不给会话记住权限。
+// [NEW 29.1] 本地共享状态可在执行模式操作，Plan不得启动worker。
+import { sharedTaskDefinitions, sharedTaskMutations } from "../tools/shared-task-tools.js";
 import { worktreeMutations } from "../tools/worktree-tools.js";
 import { realpath } from "node:fs/promises";
 import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
@@ -187,10 +189,12 @@
   if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };

   // [KEEP 来自 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
-  if (mode === "plan" && (worktreeMutations.has(call.name) || ["write_file", "edit_file", "run_command", "propose_memory", "start_job", "stop_job"].includes(call.name))) {
+  if (mode === "plan" && (sharedTaskMutations.has(call.name) || worktreeMutations.has(call.name) || ["write_file", "edit_file", "run_command", "propose_memory", "start_job", "stop_job"].includes(call.name))) {
     return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
   }
   // [KEEP 来自 28.1] 只读登记不会授予路径控制；创建/命令/后续副作用逐次审批。
+  // [NEW 29.1] 这里只允许固定协调者动作，不给文件、命令或外部工具授权。
+  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return { action: "allow", reason: "当前进程固定只读worker与有界共享登记" };
   if (call.name === "read_worktree") return { action: "allow", reason: "只读当前CLI自有Git工作区状态" };
   if (worktreeMutations.has(call.name)) return { action: "ask", reason: "工作区操作可能修改本地Git或文件，请核对本次身份、版本和命令", resource: typeof input.worktree_id === "string" ? input.worktree_id : "当前仓库的固定HEAD", scope: `${call.name}:once`, remember: false };
   // [KEEP 来自 19.3] 只读专用入口仍自行检查名字、路径和大小；不会授权其他工具。
```

</details>

<details>
<summary>CHANGED：src/tools/registry.ts 的精确差异</summary>

<!-- source: src/tools/registry.ts -->
```diff
--- a/src/tools/registry.ts
+++ b/src/tools/registry.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] tools/registry.ts
+ * 29.1 认领与租约 | [CHANGED] tools/registry.ts
  *
  * 学习目标：分别准备网页 URL 或搜索查询的完整预览，复制本次参数；批准后才执行对应的网络请求。
  * 输入：模型给出的工具名称、JSON 参数与取消信号。
@@ -29,6 +29,8 @@
 // [KEEP 来自 22.1] 网页GET也先固定参数和本次审批预览。
 // [KEEP 来自 26.1] 后台作业沿用统一准备/审批通道，只读观察只访问会话登记表。
 // [KEEP 来自 28.1] 自有工作区修改仍走同一prepare/approval入口。
+// [NEW 29.1] 共享工具只使用本地RunOptions绑定。
+import { sharedTaskDefinitions, sharedTaskTool } from "./shared-task-tools.js";
 import { worktreeDefinitions, worktreeMutations, readWorktree, prepareWorktree } from "./worktree-tools.js";
 import { prepareJob, readJob, startJobDefinition, readJobDefinition, stopJobDefinition } from "./job-tools.js";
 import { delegateTaskDefinition, delegateTaskTool } from "./delegate-task.js";
@@ -59,6 +61,8 @@
 // [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
 // [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
 export const toolDefinitions = [
+  // [NEW 29.1] 调度和消息入口与普通工具一起发现。
+  ...sharedTaskDefinitions,
   // [KEEP 来自 28.1] 只读身份和逐次批准命令分开登记。
   ...worktreeDefinitions,
   // [KEEP 来自 26.1] 启动与停止逐次审批，观察不执行进程。
@@ -137,6 +141,8 @@
   signal.throwIfAborted();
   if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
   // [KEEP 来自 28.1] 只读快照直接执行；副作用禁止绕过预览和审批。
+  // [NEW 29.1] 仍经过allowedTools和权限策略，工具内部再次检查模式。
+  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return sharedTaskTool(call.name, call.arguments, signal, options);
   if (call.name === "read_worktree") return readWorktree(call.arguments, options.worktrees, signal);
   if (worktreeMutations.has(call.name)) throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
   // [KEEP 来自 21.1] 主循环先审批，注册表只按已发现映射执行。
```

</details>

<details>
<summary>NEW：src/tools/shared-task-tools.ts 的完整代码</summary>

<!-- source: src/tools/shared-task-tools.ts -->
```ts
/**
 * 29.1 认领与租约 | [NEW] tools/shared-task-tools.ts
 * 学习目标：给模型有界任务操作，身份、完成状态和worker权限由本地代码决定。
 * 输入：严格JSON参数、本会话协调者和本地绑定；不接任意路径、worker配置或完成声明。
 * 输出：结构化metadata与同一份JSON正文，沿原工具消息返回父模型。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   校验精确字段 -> Plan/child边界 -> create/read/run或消息操作 -> 快照返回
 * 观察：本地内存操作不授予文件写入或命令权限；run只启动固定只读worker。
 */
import { ToolError } from "../errors.js";
import type { RunOptions } from "../agent/run-options.js";
import type { SharedTaskInput } from "../collaboration/coordinator.js";
import type { ToolDefinition, ToolExecutionResult } from "./types.js";

// [NEW 29.1] 本文件以下实现均为本节新增。
const emptySchema = { type: "object" as const, properties: {}, additionalProperties: false };
export const sharedTaskDefinitions: ToolDefinition[] = [
  { name: "create_shared_tasks", description: "登记1–32项只读调查任务；不能指定worker或完成状态。", inputSchema: { type: "object", properties: { tasks: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { id: { type: "string" }, task: { type: "string" }, role: { enum: ["explore", "review"] }, depends_on: { type: "array", items: { type: "string" } } }, required: ["id", "task", "role"], additionalProperties: false } } }, required: ["tasks"], additionalProperties: false } },
  { name: "read_shared_tasks", description: "只读当前进程共享任务的归属、租约与结构化结果。", inputSchema: emptySchema },
  { name: "run_shared_tasks", description: "等待最多两个本地只读worker调度结束；完成依据来自本地子会话观察。", inputSchema: emptySchema },

];
export const sharedTaskMutations = new Set(["create_shared_tasks", "run_shared_tasks"]);
/**
 * 解析工具JSON，核对必需与可选字段，返回尚待业务类型检查的对象。
 * 多余权限、身份、完成声明或坏JSON一律抛ToolError，不留下登记变化。
 */
function object(json: string, required: string[], optional: string[] = []): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new ToolError("共享任务参数必须为JSON对象。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("共享任务参数必须为JSON对象。");
  const args = value as Record<string, unknown>;
  if (required.some(key => !(key in args)) || Object.keys(args).some(key => !required.includes(key) && !optional.includes(key))) throw new ToolError("共享任务字段不匹配，不能增加身份或权限。");
  return args;
}
/**
 * 把严格JSON参数交给本会话协调者，返回同源正文和结构化metadata。
 * 输入身份来自RunOptions；Plan和子层递归启动在这里再次拒绝。
 * 解析或归属错误抛ToolError进入原工具错误通道，父取消继续抛出。
 */
export async function sharedTaskTool(name: string, json: string, signal: AbortSignal, options: RunOptions): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const coordinator = options.sharedTasks; if (!coordinator) throw new ToolError("本会话没有共享任务协调者。");
  if (options.mode === "plan" && sharedTaskMutations.has(name)) throw new ToolError("Plan模式只读取共享任务，不启动worker或修改收件箱。");
  if (options.childDepth && ["create_shared_tasks", "run_shared_tasks"].includes(name)) throw new ToolError("只读worker不能递归创建或启动共享任务。");

  let tasks;
  if (name === "create_shared_tasks") {
    const args = object(json, ["tasks"]);
    if (!Array.isArray(args.tasks)) throw new ToolError("tasks必须是数组。");
    const inputs: SharedTaskInput[] = args.tasks.map(item => {
      const input = object(JSON.stringify(item), ["id", "task", "role"], ["depends_on"]);
      if (typeof input.id !== "string" || typeof input.task !== "string" || input.role !== "explore" && input.role !== "review" || input.depends_on !== undefined && (!Array.isArray(input.depends_on) || input.depends_on.some(value => typeof value !== "string"))) throw new ToolError("任务字段类型错误。");
      return { id: input.id, task: input.task, role: input.role, dependsOn: input.depends_on as string[] | undefined };
    });
    tasks = coordinator.create(inputs);
  } else {
    object(json, []);
    if (name === "read_shared_tasks") tasks = coordinator.list();
    else if (name === "run_shared_tasks" && options.runSharedTasks) tasks = await options.runSharedTasks(signal);
    else throw new ToolError("未知共享任务工具或调度入口未绑定。");
  }
  return { content: JSON.stringify({ tasks }), metadata: { kind: "shared_tasks", tasks } };
}
```

</details>

<details>
<summary>CHANGED：src/tools/types.ts 的精确差异</summary>

<!-- source: src/tools/types.ts -->
```diff
--- a/src/tools/types.ts
+++ b/src/tools/types.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] tools/types.ts
+ * 29.1 认领与租约 | [CHANGED] tools/types.ts
  *
  * 学习目标：用同一工具契约携带网页启用状态、来源及字节元数据；网页正文通过 content 回模型，显示信息通过 metadata 回界面。
  * 输入：本地网页状态、工具准备出的预览和执行闭包，或已取得的正文、来源与截断标志。
@@ -20,6 +20,9 @@
 // [KEEP 来自 22.1] 来源只由已完整读完的真实HTTP响应提供。
 // [KEEP 来自 28.1] 界面直接消费工作区身份，不从工具正文猜测。
 export type ToolResultMetadata =
+  // [NEW 29.1] 结果与正文由同一份协调者快照产生。
+  | { kind: "shared_tasks"; tasks: import("../collaboration/coordinator.js").SharedTask[] }
+
   | { kind: "worktree"; worktree: import("../workspaces/worktrees.js").WorktreeSnapshot | null }
   // [KEEP 来自 26.1] Job状态在内存登记表；保存metadata不表示能恢复控制权。
   | { kind: "job"; job: import("../processes/jobs.js").JobSnapshot | null }
```

</details>

<details>
<summary>CHANGED：src/ui/teaching-trace.ts 的精确差异</summary>

<!-- source: src/ui/teaching-trace.ts -->
```diff
--- a/src/ui/teaching-trace.ts
+++ b/src/ui/teaching-trace.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] ui/teaching-trace.ts
+ * 29.1 认领与租约 | [CHANGED] ui/teaching-trace.ts
  *
  * 学习目标：展示工作区比较双方的固定版本与当前评审有效性，使过期批准可见。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
@@ -87,6 +87,9 @@
  * 命令是否失败由结果的 isError 交给外层决定，这里不会因为 stderr 有文字就改判结果。
  */
 function describeToolResult(metadata: ToolResultMetadata): string {
+  // [NEW 29.1] 只显示结构化归属，不从模型文字推断成功。
+  if (metadata.kind === "shared_tasks") return metadata.tasks.map(task => `${toTraceText(task.id, 60)}：${task.state} · ${task.owner ?? "未认领"} · token ${task.token}`).join("；");
+
   // [KEEP 来自 12.3] 回答是工具结果，不当作文件内容。
   // [KEEP 来自 12.3] 澄清结果显示已答或未答，不当作文件结果。
   // [KEEP 来自 18.2] 保存结果只报告已落盘编号，不声称本次请求已加载。
@@ -151,6 +154,8 @@
  */
 // [KEEP 来自 25.3] 把子状态转换成可读过程说明。
 export function formatTeachingTrace(event: AgentEvent): string[] {
+  // [NEW 29.1] 与工具sequence无关，安全处理任务ID显示。
+  if (event.type === "shared_task_state") return [`共享任务 ${toTraceText(event.taskId, 60)}：${event.state} · ${event.workerId} · token ${event.token} · ${toTraceText(event.detail, 160)}`];
   if (event.type === "child_state") return [`子任务 ${event.role} ${event.sessionId}：${event.status} · ${toTraceText(event.detail, 160)}`];
   // [KEEP 来自 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
   if (event.type === "compaction_start") return [`正在压缩旧记录：本项任务第 ${event.attempt}/2 次摘要准备，完整记录保留。`];
```

</details>

<details>
<summary>CHANGED：src/ui/tui/state.ts 的精确差异</summary>

<!-- source: src/ui/tui/state.ts -->
```diff
--- a/src/ui/tui/state.ts
+++ b/src/ui/tui/state.ts
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] ui/tui/state.ts
+ * 29.1 认领与租约 | [CHANGED] ui/tui/state.ts
  *
  * 学习目标：把同一轮事件累积成显示状态；结束时采用包含本地 stop 反馈的完整回答，避免只留下较早的模型片段。
  * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
@@ -31,6 +31,8 @@
 export type RunView = {
   status: string;
   answers: { call: number; text: string }[];
+  // [NEW 29.1] 按任务ID保存本地最新归属，不复用模型todo状态。
+  sharedTasks: Extract<AgentEvent, { type: "shared_task_state" }>[];
   children: Extract<AgentEvent, { type: "child_state" }>[];
   tools: { sequence: number; name: string; status: string; detail: string }[];
   usage: string;
@@ -45,7 +47,7 @@
  * - 关键原因：每轮模型调用号和工具步骤号会重新计数，旧数组不能带进下一轮。
  */
 export function emptyRunView(): RunView {
-  return { status: "执行中", answers: [], children: [], tools: [], usage: "", budget: "" };
+  return { status: "执行中", answers: [], sharedTasks: [], children: [], tools: [], usage: "", budget: "" };
 }

 /**
@@ -74,6 +76,12 @@
   // [KEEP 来自 27.3] 整批结束不冒充整轮结束，保留每项结果。
   if (event.type === "tool_batch_finish") return { ...view, status: formatTeachingTrace(event).join(" ") };
   if (event.type === "run_start") return emptyRunView();
+  // [NEW 29.1] 在通用工具sequence分支之前处理无sequence的调度状态。
+  if (event.type === "shared_task_state") {
+    const task = { ...event, taskId: screenText(event.taskId), detail: screenText(event.detail) };
+    return { ...view, status: formatTeachingTrace(event).join(" "), sharedTasks: view.sharedTasks.some(item => item.taskId === task.taskId)
+      ? view.sharedTasks.map(item => item.taskId === task.taskId ? task : item) : [...view.sharedTasks, task] };
+  }
   if (event.type === "child_state") {
     const child = { ...event, detail: screenText(event.detail) };
     return { ...view, status: formatTeachingTrace(event).join(" "), children: view.children.some(item => item.sessionId === child.sessionId)
@@ -137,6 +145,7 @@
  */
 export function runTranscript(view: RunView): string {
   return [...view.answers.filter((answer) => answer.text).map((answer) => answer.text),
+    ...view.sharedTasks.map(task => `共享任务 ${task.taskId}：${task.state} · ${task.workerId} · token ${task.token}\n${task.detail}`),
     ...view.children.map(child => `子任务 ${child.role} ${child.sessionId}：${child.status}\n${child.detail}`),
     ...view.tools.map((tool) => `工具 #${tool.sequence} ${tool.name}：${tool.status}\n${tool.detail}`),
     `状态：${view.status}${view.usage ? ` · ${view.usage}` : ""}`].join("\n\n");
```

</details>

<details>
<summary>CHANGED：src/ui/tui/transcript.tsx 的精确差异</summary>

<!-- source: src/ui/tui/transcript.tsx -->
```diff
--- a/src/ui/tui/transcript.tsx
+++ b/src/ui/tui/transcript.tsx
@@ -1,5 +1,5 @@
 /**
- * 28.3 整合与清理 | [KEEP] ui/tui/transcript.tsx
+ * 29.1 认领与租约 | [CHANGED] ui/tui/transcript.tsx
  *
  * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责浏览完整模型文字和工具结果，保留正在看的正文位置。
  * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
@@ -42,6 +42,8 @@
 // [KEEP 来自 25.3] 从本地子状态生成可区分的任务条目。
 export function runEntries(view: RunView, run: number): Entry[] {
   return [
+    // [NEW 29.1] 独立显示任务归属与租约，详情沿用历史区展开。
+    ...view.sharedTasks.map((task): Entry => ({ id: `${run}:shared:${task.taskId}`, label: "本地", text: `共享任务 ${task.taskId}：${task.state} · ${task.workerId} · token ${task.token}`, details: task.detail })),
     ...view.children.map((child): Entry => ({ id: `${run}:child:${child.sessionId}`, label: "本地", text: `子任务 ${child.role}：${child.status} · ${child.sessionId}`, details: child.detail })),
     ...view.tools.map((tool): Entry => ({ id: `${run}:tool:${tool.sequence}`, label: "工具", text: `${tool.name}：${tool.status}`, details: tool.detail })),
     ...view.answers.filter((answer) => answer.text).map((answer): Entry => ({ id: `${run}:answer:${answer.call}`, label: "Agent", text: answer.text })),
```

</details>

<!-- generated:build:end -->

先在仓库根目录构建本节快照：

```bash
npm run lesson:29.1
```

再启动本节程序：

```bash
node dist/cli.js
```

输入“并行调查登录入口和校验文件，各自给出真实文件依据，再汇总发现”，在execute模式下观察两个共享任务行与独立子会话。模型选择工具具有不确定性；必要时明确要求先create_shared_tasks再run_shared_tasks。正常返回的表中应能区分completed与failed，不能只看最终回答的措辞。

无需模型凭据的本地行为核对：

```bash
node tests/verify-chapter-29.mjs
```

这条自检为三节分别构建，使用可控模型替身但实际走Agent Loop、文件读取、子会话保存和父工具回传；还让取消后的模型延迟结束，核对旧调用收尾之前没有重领。它不评估真实模型的分析质量。

## 小结

我们把共享调查的归属交给同步登记表，用任务ID、worker和递增token检查本轮提交；runner等待真实子会话收尾后才提交结果或重试。下一节让前置结果决定后续何时可认领，以及失败应该怎样阻塞后续。
