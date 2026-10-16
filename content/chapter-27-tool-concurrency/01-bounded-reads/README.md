# 27.1 有界只读并发：两个人查资料，一个人改文件

[第 27 章首页](/content/chapter-27-tool-concurrency/README.md) · [上一节：26.3 作业生命周期](/content/chapter-26-interactive-jobs/03-job-lifecycle/README.md) · [本章练习与答案](/content/chapter-27-tool-concurrency/EXERCISES.md)

模型同一次回答里提出三次读取：看项目说明、看入口文件、搜索测试。它们的参数已经确定，读取彼此不需要等待；如果每次都等前一项结束，总耗时接近三次等待之和。我们希望前两次同时开始，谁先读完就让第三次接上，但同时在执行的数量始终不超过两个。

这个问题与26章不同。后台作业登记后可以跨轮存活；这里的一批读取必须在本轮结束前交齐结果。调度改变的是每项操作何时开始，不能丢掉它所属的工具调用，也不能让写文件或审批顺序悄悄改变。

## 先画出允许重叠的区间

假设模型按顺序发来五项调用：

| 原顺序 | 调用 | 能否与旁边的读取重叠 |
| --- | --- | --- |
| 0 | 读取 `README.md` | 可以与下一项组成读取段 |
| 1 | 搜索 `src/` | 可以与上一项组成读取段 |
| 2 | 写入 `notes.txt` | 单独执行，前后读取必须等它结束 |
| 3 | 读取 `notes.txt` | 写入结束后才进入下一读取段 |
| 4 | 读取测试文件 | 可以与第3项重叠 |

第2项是一个**串行屏障**：它前面的读取全部收尾后，才允许它开始；它完成后，才允许后面的读取开始。如果把五项一次性投入并发，第3项就可能读到旧文件，用户批准操作的次序也可能失去意义。

程序不尝试理解任意命令的业务依赖，而是先采用保守范围：只有 `read_file`、`glob`、`grep`、`read_tool_result`、`read_job` 和 `read_skill_resource` 这六类已有的本地只读操作可以组成相邻读取段。新工具默认作为屏障；网络、MCP、子 Agent、命令和写入都不在此范围内。`load_skill` 虽然像“读说明”，却会改变当前会话的已加载集合，所以也要先完成，再允许读取它的资源。

“只读”也不表示整个段获得同一时刻的文件快照。外部编辑器仍可能在两次读取之间改文件；本节保证的是本 Agent 的启动次序与资源数量。若前后结果矛盾，模型需要再次读取核实。

## 容量满了，工作在队列里等

在表中的第一个读取段里，容量为2，程序给第0和第1项各发一个执行名额。即使第1项先完成，第2项写入也要等第0项结束；它不能因为空出一个名额就越过屏障。若另一个读取段里有三次连续读取，前两项占满容量，其中一项完成后，第三次读取才可以补上。我们可以把一次调用分为 `queued`、`running`，最后到达 `succeeded`、`failed` 或 `cancelled`。队列不是另外一种工具，它只保存还没有开始的调用。

名额的归还依据是执行函数的 Promise 已经完成或拒绝。调用刚发出取消请求、界面刚显示“停止中”，都不能证明它不再占用资源。27.2会把这一点展开，加入每项自己的期限与清理等待。

默认容量是2，可由本地运行选项设为1–4的整数。模型提供的工具参数没有并发度字段，不能要求程序给自己无限名额。设为1就退回逐项执行，便于比较与排查。这个限额只覆盖本节调度的本地工具，不会自动限制26章已有的后台作业；后者仍使用自己的活跃作业限额。

## 同时读取，仍逐项过原有检查

取得执行名额后，一项调用仍要经过已有的工具查找、参数解析、权限判断与结果处理。并发没有把这些步骤合并成一次批量批准，也没有让只读工具获得写权限。若多个敏感读取都需要批准，程序让审批入口一次只处理一个请求，避免几个读取同时抢占同一个问答界面；等到自己的批准后，该项才继续执行。每项调用保留原来的 callID 和原始位置，不能用“第几个完成”代替身份。

还有一条容易忽略的副作用来源：Hooks。读文件工具之前或之后，Hook 可能执行脚本并改变状态。本节在启用 Hooks 时保守地把整批调度退回串行，避免只看工具名称就宣称没有副作用。

现在先保证一个完整路径：模型给出调用批，程序划分相邻读取段，在每段里最多执行N项，每项真正收尾才归还名额，跨过屏障后再进入下一段。原始调用身份一路保留，结果最终仍要回到各自的模型工具消息。后面两节会继续回答：队列里等太久怎么办，以及倒序完成的结果怎样整批交回模型。

<!-- media:lesson:start -->
下面用三次连续读取解释补位，再用write和after解释跨段等待。本节结果仍可按完成次序进入历史，27.3才增加统一提交顺序；固定callID始终保留归属。

<img src="./content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-cover-6f2ceb55be.png" data-gif-src="./content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-7d968cfa16.gif" data-cover="./content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-cover-6f2ceb55be.png" data-no-zoom alt="空出一个名额，下一项一定能开始吗？">

[静态流程图](/content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-flow-4d604b444f.png.md) · [静态封面](/content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-cover-6f2ceb55be.png.md) · [查看完整静态分镜](/content/chapter-27-tool-concurrency/01-bounded-reads/assets/tool-bounded-read-segments-storyboard-dadee023dd.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/agent/tool-batch.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/agent/tool-batch.ts.md) | 划分相邻只读段与串行屏障，限制活跃数量，并发布每项调度状态。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/agent/agent-loop.ts.md) | 预先固定调用编号，把原有单项权限链交给有界调度器。 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/agent/run-options.ts.md) | 接受本地并发容量选项，默认2，模型不能修改。 |
| CHANGED | [src/agent/events.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/agent/events.ts.md) | 以固定sequence和callID记录排队、执行与终态。 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/ui/teaching-trace.ts.md) | 在教学跟踪输出中显示调度状态。 |
| CHANGED | [src/ui/tui/state.ts](/content/chapter-27-tool-concurrency/01-bounded-reads/src/ui/tui/state.ts.md) | 按固定编号更新工具行，保留已取得的结果内容。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 26.3 的完整 `src/` 继续。本节目标目录是 `chapter-27-tool-concurrency/01-bounded-reads`。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线。

<!-- generated:build:start -->

<details>
<summary>NEW：src/agent/tool-batch.ts 的完整文件</summary>

<!-- source: src/agent/tool-batch.ts -->
```ts
/**
 * 27.1 有界只读并发 | [NEW] agent/tool-batch.ts
 *
 * 学习目标：只让相邻本地只读调用共享有限容量，其他调用构成串行屏障。
 * 输入：带稳定 sequence/callID 的完整调用批、父取消信号、单项执行函数。
 * 输出：所有已启动工作收尾后返回；意外错误停止发放新工作，等同伴结束再抛出。
 * 本文件流程（全局见 agent-loop.ts）：
 *   queued -> 相邻只读段 / 单项屏障 -> 最多 N 个 running -> 终态 -> 下一段
 * 白名单不代表原子文件快照；外部进程仍可能改文件。Hooks 可执行脚本，启用时整批串行。
 */
import type { ToolCall } from "../tools/registry.js";

// [NEW 27.1] 新工具默认串行；load_skill 改已加载集合，必须先完成再读资源。
const PARALLEL_READS = new Set(["read_file", "glob", "grep", "read_tool_result", "read_job", "read_skill_resource"]);
export type BatchItem = { call: ToolCall; sequence: number };
export type ToolState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type BatchOptions = { concurrency?: number; serial?: boolean };
export const isParallelRead = (call: ToolCall): boolean => PARALLEL_READS.has(call.name);

/**
 * 只接受本地配置的 1..4 个槽；模型参数不能改变容量。
 * 非整数或超出范围时在调度前失败。
 */
export function batchConcurrency(value = 2): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) throw new Error("toolConcurrency 必须为 1..4 的整数");
  return value;
}

/**
 * 发放前检查取消；容量必须等执行函数真正 settle 才归还。
 * 当前相邻读取段收尾后才进入下一段或单项串行屏障。
 */
export async function runToolBatch(
  items: readonly BatchItem[], signal: AbortSignal,
  execute: (item: BatchItem, signal: AbortSignal) => Promise<boolean>,
  state: (item: BatchItem, state: ToolState) => void,
  options: BatchOptions = {},
): Promise<void> {
  const capacity = options.serial ? 1 : batchConcurrency(options.concurrency);
  for (const item of items) state(item, "queued");
  let firstError: unknown;
  let failed = false;
  for (let offset = 0; offset < items.length;) {
    if (failed || signal.aborted) break;
    const start = offset++;
    if (!options.serial && isParallelRead(items[start].call)) {
      while (offset < items.length && isParallelRead(items[offset].call)) offset += 1;
    }
    const segment = items.slice(start, offset);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(capacity, segment.length) }, async () => {
      while (!failed && !signal.aborted && cursor < segment.length) {
        const item = segment[cursor++];
        state(item, "running");
        try { state(item, await execute(item, signal) ? "succeeded" : "failed"); }
        catch (error) { if (!failed) firstError = error; failed = true; state(item, "cancelled"); }
      }
    }));
    if (failed || signal.aborted) {
      for (const item of segment.slice(cursor)) state(item, "cancelled");
      break;
    }
  }
  if (failed) throw firstError;
  signal.throwIfAborted();
}
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,8 @@
 /**
- * 26.1 后台作业 | [CHANGED] agent/agent-loop.ts
+ * 27.1 有界只读并发 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
+ * [CHANGED 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
+ * 学习目标：让相邻白名单读取共享有限容量，保留每项原权限链、调用身份与串行屏障。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -50,7 +51,7 @@
  *                  |                                              +-- 否 -> 提交历史、返回回答
  *                  |  次数已用完时不取走剩余补充，界面队列仍保留
  *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
- *                                       +-- 否 -> 保存 assistant 调用 -> C
+ *                                       +-- 否 -> 保存 assistant 调用 -> S
  *   [KEEP 来自 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
  *   [KEEP 来自 22.2] 固定搜索endpoint -> 本次查询审批 -> 有界JSON响应 -> 真正返回的URL/摘要 -> 模型
  *   [KEEP 来自 22.1] 明确启用 -> URL/本次审批 -> 单一期限/逐块限额/逐跳校验 -> 真实来源与正文 -> 模型
@@ -58,7 +59,10 @@
  *   [KEEP 来自 21.2] HTTP配置 -> HTTPS/loopback校验 -> 固定Bearer环境变量 -> 官方StreamableHTTP
  *   [KEEP 来自 21.1] 显式MCP配置 -> SDK握手 -> 分页发现/命名 -> 模型定义 -> 逐次审批 -> SDK调用/原调用结果
  *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
- *   C: [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
+ *   S: [CHANGED 27.1] 固定 sequence/callID -> 相邻白名单只读段最多 N 项；其他调用为串行屏障
+ *       -> 每项分别进入 C；Hooks 启用时整批串行；当前段全部收尾后才进入下一段
+ *       -> 全部段收尾 -> 本批观察齐全 -> A
+ *   C: 单项调用 -> [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
  *                                                             +-- 否 -> 原有 deny / ask / allow
  *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
  *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
@@ -77,14 +81,13 @@
  *                                                +-- 否 -> ToolError 或取消 -> D / X
  *                            TUI 面板独占输入；旧请求结束后旧回调失效
  *   [KEEP 来自 20.2] 工具真实结果 -> after_tool -> 追加反馈或失败说明 -> D；取消保留已知结果
- *   D: 工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
+ *   D: 单项工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
  *                                                        +-- 是 -> 写完整本地日志、sync、关闭
  *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
  *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
  *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
- *      保存正文 / 裁剪正文与原调用 ID、错误标记 -> 过程事件 -> 本批还有调用？-- 是 -> C
- *                                                                             +-- 否 -> A
- *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
+ *      [CHANGED 27.1] 保存本项正文 / 裁剪正文、原调用 ID 与错误标记 -> 本项过程事件 -> 返回 S
+ *      一批调用全部有结果后才回到下一次模型请求
  *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
  *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
  *   [KEEP 来自 20.3] runAgent -> 非取消的完成/错误 -> stop一次 -> 本地反馈；取消不启动stop
@@ -102,7 +105,7 @@
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
  * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
- * 运行观察：真实网页结果进入下一次模型输入；未知或缺少编号会附本地反馈，真实编号配错结论仍需人工核实。
+ * 运行观察：读取按调用身份显示进度；串行屏障等待当前读取段收尾，本批观察齐全后模型才继续。
  */

 // [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
@@ -122,6 +125,8 @@
 import type { PreparedToolCall } from "../tools/types.js";
 import { emitAgentEvent, type AgentObserver } from "./events.js";
 import type { RunOptions } from "./run-options.js";
+// [NEW 27.1] 原单项权限链由调度器调用，相邻白名单读取才共用有限容量。
+import { runToolBatch } from "./tool-batch.js";

 const MAX_MODEL_CALLS = 8;

@@ -148,7 +153,7 @@
  * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
  */
 // [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
-// [KEEP 25.3] 只把子状态转发给父观察者，子文字留在子历史。
+// [KEEP 来自 25.3] 只把子状态转发给父观察者，子文字留在子历史。
 export async function agentLoop(
   model: Model,
   history: Message[],
@@ -176,7 +181,6 @@
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
   // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
-  // [CHANGED 26.1] 会话登记表传入每次工具执行，单轮结束不关闭后台作业。
   const toolOptions: RunOptions = { ...options, jobs: model.jobs ?? options.jobs, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
   toolOptions.delegateTask = async (argumentsJson, childSignal) => {
     if (options.childDepth || ++childCount > 3) throw new ToolError("每轮最多三个只读子任务，子任务不能继续委派。");
@@ -184,6 +188,16 @@
       // [KEEP 来自 25.3] 子增量和模型编号不混入父流；结构化状态与最终工具结果分别转交。
       observer: event => { if (event.type === "child_state") emitAgentEvent(observer, event); },
     });
+  };
+  // [NEW 27.1] 多个只读调用可能请求敏感文件审批；同一界面一次只显示一个批准请求。
+  let approvalTail = Promise.resolve();
+  const orderedApproval: ApprovalHandler = async (request, approvalSignal) => {
+    const previous = approvalTail;
+    let release!: () => void;
+    approvalTail = new Promise<void>(resolve => { release = resolve; });
+    await previous;
+    try { approvalSignal.throwIfAborted(); return await requestApproval!(request, approvalSignal); }
+    finally { release(); }
   };
   const attachments = model.attachments?.take();
   const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
@@ -204,7 +218,8 @@
   let compactionAttempts = 0;

   // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
-  let executingCallId: string | undefined;
+  // [CHANGED 27.1] 并发时可能同时有多个尚未返回结果的调用。
+  const executingCallIds = new Set<string>();
   try {
     // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
     await model.memory?.refresh(signal);
@@ -316,29 +331,31 @@
       if (modelCall === maxModelCalls) break;

       turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
-      for (const call of result.toolCalls) {
-        signal.throwIfAborted();
-        toolSequence += 1;
+      // [NEW 27.1] 先固定编号，后续完成乱序不会改变调用身份；副作用与依赖工具是屏障。
+      const items = result.toolCalls.map((call, index) => ({ call, sequence: toolSequence + index + 1 }));
+      toolSequence += items.length;
+      await runToolBatch(items, signal, async ({ call, sequence }, callSignal) => {
+        callSignal.throwIfAborted();
         // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
         const permission = options.allowedTools && !options.allowedTools.includes(call.name)
           ? { action: "deny" as const, reason: `子任务不允许工具：${call.name}` }
           : await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
         emitAgentEvent(observer, {
           type: "permission_check",
-          sequence: toolSequence,
+          sequence,
           call,
           decision: permission,
         });
         let rejection: string | null = null;
         let prepared: PreparedToolCall | null = null;
         // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
-        signal.throwIfAborted();
+        callSignal.throwIfAborted();
         if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
         if (permission.action === "ask") {
           try {
             // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
             // [KEEP 来自 14.2] 把本地文件检查点入口传到写入准备层。
-            prepared = await prepareTool(call, signal, toolOptions);
+            prepared = await prepareTool(call, callSignal, toolOptions);
           } catch (error) {
             if (!(error instanceof ToolError)) throw error;
             turn.push({
@@ -350,17 +367,17 @@
             pendingToolResults += 1;
             emitAgentEvent(observer, {
               type: "tool_prepare",
-              sequence: toolSequence,
+              sequence,
               call,
               outcome: "error",
               error: error.message,
             });
-            continue;
+            return false;
           }
           if (prepared) {
             emitAgentEvent(observer, {
               type: "tool_prepare",
-              sequence: toolSequence,
+              sequence,
               call,
               outcome: "success",
               previewChars: prepared.preview.length,
@@ -368,27 +385,27 @@
           }
           emitAgentEvent(observer, {
             type: "approval_start",
-            sequence: toolSequence,
+            sequence,
             call,
             scope: permission.scope,
             allowSession: permission.remember,
             hasPreview: prepared !== null,
           });
           const response = requestApproval
-            ? await requestApproval({
+            ? await orderedApproval({
                 call,
                 reason: permission.reason,
                 resource: permission.resource,
                 scope: permission.scope,
                 allowSession: permission.remember,
                 ...(prepared ? { preview: prepared.preview } : {}),
-              }, signal)
+              }, callSignal)
             : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
           // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
-          signal.throwIfAborted();
+          callSignal.throwIfAborted();
           emitAgentEvent(observer, {
             type: "approval_finish",
-            sequence: toolSequence,
+            sequence,
             call,
             response,
           });
@@ -403,59 +420,59 @@
         if (rejection) {
           turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
           pendingToolResults += 1;
-          continue;
+          return false;
         }
         // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
-        signal.throwIfAborted();
-        executingCallId = call.id;
-        emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
+        callSignal.throwIfAborted();
+        executingCallIds.add(call.id);
+        emitAgentEvent(observer, { type: "tool_start", sequence, call });
         try {
           // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
           // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
           // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
           // [KEEP 来自 20.1] 取消或before失败时尚未启动工具。
           if (mode !== "plan") {
-            const before = await runHooks(model.hooks, "before_tool", { call }, signal);
+            const before = await runHooks(model.hooks, "before_tool", { call }, callSignal);
             if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
           }
           let result = prepared
-            ? await executePreparedTool(prepared, signal, toolOptions)
-            : await executeTool(call, signal, toolOptions);
+            ? await executePreparedTool(prepared, callSignal, toolOptions)
+            : await executeTool(call, callSignal, toolOptions);
           if (result.metadata.kind === "subagent") {
             const childUsage = result.metadata.result.usage;
             inputTokens = addUsage(inputTokens, childUsage.inputTokens); outputTokens = addUsage(outputTokens, childUsage.outputTokens);
             cachedInputTokens = addUsage(cachedInputTokens, childUsage.cachedInputTokens); cacheWriteTokens = addUsage(cacheWriteTokens, childUsage.cacheWriteTokens);
             emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
           }
-          if (result.metadata.kind === "subagent" && signal.aborted) {
+          if (result.metadata.kind === "subagent" && callSignal.aborted) {
             turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: true });
-            executingCallId = undefined;
-            emitAgentEvent(observer, { type: "tool_finish", sequence: toolSequence, call, outcome: "success", result });
-            signal.throwIfAborted();
+            executingCallIds.delete(call.id);
+            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result });
+            callSignal.throwIfAborted();
           }
           // [KEEP 来自 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
           if (mode !== "plan") {
             try {
-              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, signal);
+              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, callSignal);
               if (after.messages.length) result = { ...result, content: `${result.content}\n\n[本地执行后钩子反馈；不是权限]\n${after.messages.join("\n")}` };
             } catch (error) {
               if (!(error instanceof ToolError)) {
                 turn.push({ role: "tool", toolCallId: call.id, content: result.content + "\n[本地状态] 后置钩子中断；工具已返回，副作用未撤销。", isError: result.isError ?? false });
-                executingCallId = undefined;
+                executingCallIds.delete(call.id);
                 throw error;
               }
               result = { ...result, content: `${result.content}\n[本地执行后钩子失败] ${error.message}` };
             }
           }
           // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
-          executingCallId = undefined;
+          executingCallIds.delete(call.id);
           let modelContent: string;
-          try { modelContent = (await boundToolResult(result.content, signal, options.toolResultDirectory)).content; }
+          try { modelContent = (await boundToolResult(result.content, callSignal, options.toolResultDirectory)).content; }
           catch (error) {
             // 原工具的错误标记保持不变；给本次调用留下明确摘要，不声明不存在的日志引用。
             const content = `[本地状态：工具已返回，但完整日志未保存；本轮停止，以下仅为头尾，不能找回被省略部分]\n${clippedToolText(result.content)}`;
             turn.push({ role: "tool", toolCallId: call.id, content, isError: result.isError ?? false });
-            emitAgentEvent(observer, { type: "tool_finish", sequence: toolSequence, call, outcome: "success", result: { ...result, content } });
+            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result: { ...result, content } });
             throw error;
           }
           // [KEEP 来自 07.1] 非零退出码仍是错误；裁剪不改变原调用编号或成功/失败。
@@ -463,11 +480,13 @@
           pendingToolResults += 1;
           emitAgentEvent(observer, {
             type: "tool_finish",
-            sequence: toolSequence,
+            sequence,
             call,
             outcome: "success",
             result: { ...result, content: modelContent },
           });
+          // [CHANGED 27.1] 工具返回的错误标记也决定调度终态，避免 succeeded 覆盖界面失败状态。
+          return !result.isError;
         } catch (error) {
           // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
           if (!(error instanceof ToolError)) throw error;
@@ -478,17 +497,19 @@
             isError: true,
           });
           // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
-          executingCallId = undefined;
+          executingCallIds.delete(call.id);
           pendingToolResults += 1;
           emitAgentEvent(observer, {
             type: "tool_finish",
-            sequence: toolSequence,
+            sequence,
             call,
             outcome: "error",
             error: error.message,
           });
+          return false;
         }
-      }
+      }, (item, state) => emitAgentEvent(observer, { type: "tool_state", ...item, state }),
+      { concurrency: options.toolConcurrency, serial: Boolean(model.hooks) });
     }

     if (options.childDepth) throw new ChildBudgetError("子任务已用尽模型决策次数，尚未得到完整最终回答。");
@@ -503,7 +524,7 @@
       for (const call of message.toolCalls ?? []) {
         if (completed.has(call.id)) continue;
         turn.push({ role: "tool", toolCallId: call.id, isError: true,
-          content: call.id === executingCallId
+          content: executingCallIds.has(call.id)
             ? "操作已开始，但本轮中断前没有取得完整结果。可能已发生部分修改，请先核实当前文件或进程状态，不要直接重试。"
             : "本轮在该工具启动前中断，这个调用未执行。" });
         completed.add(call.id);
```

</details>

<details>
<summary>CHANGED：src/agent/run-options.ts 的精确差异</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,8 +1,8 @@
 /**
- * 26.1 后台作业 | [CHANGED] agent/run-options.ts
+ * 27.1 有界只读并发 | [CHANGED] agent/run-options.ts
  *
- * 学习目标：把本进程已启用的 WebState 传给工具执行层；模型不能从网页文字选择配置或取得运行权限。
- * 输入：本地入口选定的模式、会话状态、已加载的网页配置与本轮交互回调。
+ * 学习目标：以本地选项限制只读并发容量，并保留每项原权限链。
+ * 输入：本地入口选定的模式、会话控制对象、调度限制与本轮交互回调。
  * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
  * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
  * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
@@ -62,7 +62,9 @@
 // [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 // [KEEP 来自 19.3] 工具使用进程内已发现目录，模型不能自行选择根目录。
 export type RunOptions = {
-  // [NEW 26.1] 作业属于会话，不能从磁盘恢复PID；子任务allowlist仍阻止启动。
+  // [NEW 27.1] 本地入口配置容量；未列入白名单或有 Hooks 的调用仍串行。
+  toolConcurrency?: number;
+  // [KEEP 来自 26.1] 作业属于会话，不能从磁盘恢复PID；子任务allowlist仍阻止启动。
   jobs?: import("../processes/jobs.js").JobManager;
   sessionId?: string;
   childSessionDirectory?: string;
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
- * 25.3 子任务状态 | [CHANGED] agent/events.ts
+ * 27.1 有界只读并发 | [CHANGED] agent/events.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责传递已经发生的模型、权限和工具事件。
  * 输入：runAgent 的开始/结束通知，或 Agent Loop 已发生的过程事件。
@@ -30,10 +30,10 @@

 // [KEEP 来自 08.1] 原有观察通道增加文字片段，TUI 与文本界面可消费同一种事件。
 // [KEEP 来自 09.1] 整轮任务开始与结束也使用事件通知。
-// [CHANGED 25.3] 定义子任务身份、角色、状态与说明的观察事件。
+// [KEEP 来自 25.3] 定义子任务身份、角色、状态与说明的观察事件。
 export type AgentEvent =
   | { type: "run_start" }
-  // [NEW 25.3] 子会话状态独立于父模型 call 和工具 sequence，不包含子文字增量。
+  // [KEEP 来自 25.3] 子会话状态独立于父模型 call 和工具 sequence，不包含子文字增量。
   | { type: "child_state"; sessionId: string; parentSessionId: string; role: import("../subagents/runner.js").ChildRole; status: "starting" | "running" | import("../subagents/runner.js").ChildStatus; detail: string }
   // [KEEP 来自 16.3] 摘要准备、候选与实际采用分开；这些事件不能执行工具或修改历史。
   | { type: "compaction_start"; attempt: number }
@@ -90,6 +90,8 @@
       hasPreview: boolean;
     }
   | { type: "approval_finish"; sequence: number; call: ToolCall; response: ApprovalResponse }
+  // [NEW 27.1] sequence/callID 从请求顺序固定，不按完成先后重编号。
+  | { type: "tool_state"; sequence: number; call: ToolCall; state: import("./tool-batch.js").ToolState }
   | { type: "tool_start"; sequence: number; call: ToolCall }
   | {
       type: "tool_finish";
```

</details>

<details>
<summary>CHANGED：src/ui/teaching-trace.ts 的精确差异</summary>

<!-- source: src/ui/teaching-trace.ts -->
```diff
--- a/src/ui/teaching-trace.ts
+++ b/src/ui/teaching-trace.ts
@@ -1,7 +1,7 @@
 /**
- * 25.3 子任务状态 | [CHANGED] ui/teaching-trace.ts
- *
- * 学习目标：从真实网页结果元数据展示来源数量、字节和截断状态；外部工具参数在审批中完整展示，轨迹只显示摘要。
+ * 27.1 有界只读并发 | [CHANGED] ui/teaching-trace.ts
+ *
+ * 学习目标：显示固定sequence对应的排队、运行与终态，及时反馈真实工具进展。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
  * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
  *
@@ -18,7 +18,7 @@
  *
  * [KEEP 来自 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
  * 该事件没有工具 sequence，必须先于通用工具分支处理。
- * 运行观察：抓取完成后轨迹展示真实来源与结果大小；失败沿原工具显示，摘要不能替代交给模型的实际正文。
+ * 运行观察：工具状态与整批事件决定轨迹行；摘要不改变原工具结果或下一次模型输入。
  */

 import type { AgentEvent } from "../agent/events.js";
@@ -143,7 +143,7 @@
  * - 显示规则：工具状态来自元数据，参数与摘要经过字段筛选、控制字符处理和长度限制。
  * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
  */
-// [CHANGED 25.3] 把子状态转换成可读过程说明。
+// [KEEP 来自 25.3] 把子状态转换成可读过程说明。
 export function formatTeachingTrace(event: AgentEvent): string[] {
   if (event.type === "child_state") return [`子任务 ${event.role} ${event.sessionId}：${event.status} · ${toTraceText(event.detail, 160)}`];
   // [KEEP 来自 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
@@ -241,6 +241,8 @@
     ];
   }

+  // [NEW 27.1] 排队/运行/终态属于同一调用，结果正文仍由 tool_finish 展示。
+  if (event.type === "tool_state") return [`[工具 #${event.sequence} ${event.call.id}] ${event.call.name}: ${event.state}`];
   const tool = describeToolCall(event.call);
   if (event.type === "tool_start") {
     return [
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
- * 25.3 子任务状态 | [CHANGED] ui/tui/state.ts
+ * 27.1 有界只读并发 | [CHANGED] ui/tui/state.ts
  *
  * 学习目标：把同一轮事件累积成显示状态；结束时采用包含本地 stop 反馈的完整回答，避免只留下较早的模型片段。
  * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
@@ -27,7 +27,7 @@
 import { formatTeachingTrace } from "../teaching-trace.js";

 // [KEEP 来自 10.2] RunView 继续保存显示数据，不替代模型历史。
-// [CHANGED 25.3] 按子会话编号保存最新显示状态。
+// [KEEP 来自 25.3] 按子会话编号保存最新显示状态。
 export type RunView = {
   status: string;
   answers: { call: number; text: string }[];
@@ -105,7 +105,9 @@
   };
   // 前面的分支已经处理整轮与模型事件；剩下的事件都有工具 sequence，可更新同一行。
   const old = view.tools.find((tool) => tool.sequence === event.sequence);
-  const status = event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
+  // [NEW 27.1] 调度状态按固定 sequence 更新；终态不覆盖此前收到的完整结果。
+  const status = event.type === "tool_state" ? ({ queued: "排队中", running: "执行中", succeeded: "完成", failed: "失败", cancelled: "已中断" }[event.state])
+    : event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
     : event.type === "tool_prepare" ? event.outcome === "success" ? "预览已准备" : "准备失败"
     : event.type === "approval_start" ? "等待批准"
     : event.type === "approval_finish" ? event.response.decision === "deny" ? "已拒绝" : "已批准"
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:27.1
```

先直接使用公开的调度器验证名额与屏障。执行函数在这里是可控制完成时刻的替身，用于观察调度；它没有绕过正式工具的权限链。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runToolBatch } from './dist/agent/tool-batch.js';
const items = ['r1', 'r2', 'r3', 'write', 'r4'].map((id, index) => ({
  call: { id, name: id === 'write' ? 'write_file' : 'read_file', arguments: '{}' },
  sequence: index + 1,
}));
let active = 0, peak = 0;
const order = [], states = [];
await runToolBatch(items, new AbortController().signal, async ({ call }) => {
  active += 1; peak = Math.max(peak, active); order.push('start:' + call.id);
  await delay(call.id === 'r1' ? 70 : 10);
  order.push('end:' + call.id); active -= 1; return true;
}, (item, state) => states.push([item.call.id, state]), { concurrency: 2 });
assert.equal(peak, 2);
assert.ok(order.indexOf('start:r3') < order.indexOf('end:r1'));
assert.ok(order.indexOf('start:write') > order.indexOf('end:r1'));
assert.ok(order.indexOf('start:r4') > order.indexOf('end:write'));
for (const { call } of items) assert.deepEqual(states.filter(([id]) => id === call.id).map(([, state]) => state), ['queued', 'running', 'succeeded']);
console.log('通过：容量2、先完成先归还、写入构成前后屏障。');
NODE
```

`r2`先结束后，`r3`应在`r1`结束前开始；写入必须等前三次读取全部结束，后面的`r4`必须等写入结束。这里把完成顺序控制为可重复的实验，不能只用“总共变快了”证明容量正确。

配套仓库另用真实临时文件和模型替身检查每项结果仍按原callID配对，错误读取不丢掉同伴结果，Plan不会执行写入；也检查启用Hooks时串行。

```bash
LESSON_27=01-bounded-reads node tests/verify-chapter-27.mjs
```

## 本节完成后的 Agent

同一批相邻本地读取现在能共享最多N个名额，有副作用与依赖状态的工具仍按原顺序构成屏障。固定sequence用于界面追踪，callID用于模型结果配对；本节结果消息仍可能按真实完成次序加入，27.3再收束为统一的原调用顺序。下一节先解决排队、期限与清理何时结束。

本节状态：待用户确认。
