# 27.2 超时与清理：停止等待之前，先等操作收尾

[第 27 章首页](../README.md) · [上一节：27.1 有界只读并发](../01-bounded-reads/README.md) · [本章练习与答案](../EXERCISES.md)

容量为1时，第一个读取占住名额，后面的读取只能排队。现在给这两项各设一个“20毫秒期限”：第二项可能20毫秒都没有开始，第一项却可能已经读了20毫秒。若它们最后都叫“超时”，模型就无法知道哪一项从未执行、哪一项已经开始但没有取得正常结果。

本节给排队与执行分别计时，并为每次执行建立独立的取消信号。更关键的是：期限到了只提出停止请求，名额要等底层执行真正返回之后才释放。否则，一个慢操作仍在占用资源，队列却已经放进另一个，容量上限就只剩下界面上的数字。

## 两只时钟分别从哪里开始

一批工具请求到达后，所有项目先登记为 `queued`。对本地只读白名单中的项目，排队时钟从这时开始，到领到名额为止。等待前一个读取段、串行屏障或已有操作，都属于这段排队时间。

假设批次开始为0毫秒，容量为1，第一个读取到50毫秒才收尾；第二项的排队期限是20毫秒。20毫秒到达时，第二项应变为 `queue_timeout`，结果明确说明“没有启动”。到50毫秒名额空出，调度器会跳过它，不能再偷偷执行一次。

执行时钟则在领取名额、进入单项执行链时开始。白名单读取领槽后的权限检查、等待用户批准、实际读取与结果保存，都计入这只执行时钟；此前排队用掉的时间不从它扣除。超期后进入 `execution_timeout` 的依据包括两件事：已经提出停止请求，并且底层操作已经返回、完成了本地收尾。单靠计时器触发，还不能形成这个终态。

| 限制 | 默认值 | 到期后的事实 |
| --- | --- | --- |
| 排队期限 | 10000毫秒 | 尚未启动，后续不再领名额 |
| 执行期限 | 15000毫秒 | 给本项发停止信号，等待执行返回后记录超时 |

本地 `toolQueueTimeoutMs` 与 `toolExecutionTimeoutMs` 可分别设置1–60000的整数毫秒。这两只新时钟只用于本地只读白名单，非白名单的写入、命令、MCP、Web等调用不加本章计时器，仍按各自已有的信号与期限执行；所有调用的授权规则沿用原权限与审批机制。

因此，一个敏感读取已经领槽、正在等用户批准时，默认15000毫秒执行期限仍会到期，程序给本项停止信号，等执行链真正收尾后记录执行超时。这里“已经执行”指已经进入占用名额的执行链，不必然说明文件已经打开。反过来，若前面的串行操作长时间等待批准，后面的只读项尚未领槽，也可能耗尽排队期限，得到未启动的超时结果。超时只说明本地执行链的状态，不承诺撤回已经发生的远端效果。

## 为什么每项要有自己的取消信号

假设两个读取同时运行，只有其中一个超时。若直接取消整轮共享信号，另一个正常读取也会被无故打断。我们为已领名额的每项建立子控制器：单项超时只取消自己；用户取消整轮时，再向所有已启动项目传播。

执行函数收到的是这个子信号。它在已有的文件遍历、工具执行与日志保存中传递，能响应取消的步骤便尽快结束。没有开始的项目不需要创建底层操作，只需得到“未执行”的结果。每项结束后清掉计时器和信号监听，避免上一项的期限影响后来的工作。

这里的取消是协作式的。Node 的某些文件系统请求即使收到信号，也无法强行中止正在进行的操作；某个实现如果忽略信号，也可能在期限之后才返回。本节会一直占着该名额等待它，不能宣布“20毫秒内一定结束”。这个限制让容量语义保持真实，也让使用者知道停止按钮为何有时还要等。

## 超期了，为什么还不能用 Promise.race 返回

把执行 Promise 与计时器放进 `Promise.race`，计时器先完成时就返回，看似实现了超时；但另一个 Promise 不会因此消失。若它还在读取或清理，而调度器已把名额交给下一项，实际同时运行数量就会超过上限。

正确的顺序是：计时器触发，给本项发出停止信号，继续等待它原来的 Promise；无论它最终正常返回还是因取消拒绝，都先结束这次执行，再发布超时终态和归还名额。超时结果会交回原callID，使模型可以决定缩小读取范围、调整计划或向用户解释。正常的同伴结果继续保留，不因一项超时而消失。

整轮取消也按这个顺序收尾：停止发放新工作，通知已启动项目，等待它们都返回，为未启动项目留下取消说明，然后才让外层循环结束这一轮。若出现意料外的程序异常，也先停止同伴并等待收尾，再把异常抛给外层修补消息历史。取消已经执行过的操作仍不等于撤销效果，不能依据“已取消”就自动重试有副作用的动作。

现在我们有了两个独立答案：项目为何没有正常结果，以及它的资源是否已经归还。下一节将把这些答案与成功内容一起收齐，形成下一次模型请求的完整观察。

<!-- media:lesson:start -->
下面使用受控的70ms底层等待区分两只时钟：held在10ms收到停止请求却继续占槽，queued在25ms未启动就过期，直到held真实返回才释放容量。毫秒值用于说明先后，实际系统调度可能更晚。

![期限到了，名额为什么还不能归还？](assets/tool-timeout-real-cleanup-a42dc177ba.gif)

[静态流程图](assets/tool-timeout-real-cleanup-flow-cdaf3954f7.png) · [静态封面](assets/tool-timeout-real-cleanup-cover-1e015977c4.png) · [查看完整静态分镜](assets/tool-timeout-real-cleanup-storyboard-88f82e052b.jpg)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/tool-batch.ts](src/agent/tool-batch.ts) | 分别计算排队与执行期限，逐项传播取消，等待真实收尾后归还容量。 |
| CHANGED | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 把超时和取消说明交回原callID，保留已有结果与执行事实。 |
| CHANGED | [src/agent/run-options.ts](src/agent/run-options.ts) | 提供本地排队与执行期限选项。 |
| CHANGED | [src/tools/read-file.ts](src/tools/read-file.ts) | 取消或读完后等待文件流close，返回不早于资源关闭。 |
| CHANGED | [src/ui/tui/state.ts](src/ui/tui/state.ts) | 区分显示排队超时和执行超时。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](../../docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 27.1 的完整 `src/` 继续。本节目标目录是 `chapter-27-tool-concurrency/02-cancel-and-cleanup`。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/agent/tool-batch.ts 的精确差异</summary>

<!-- source: src/agent/tool-batch.ts -->
```diff
--- a/src/agent/tool-batch.ts
+++ b/src/agent/tool-batch.ts
@@ -1,5 +1,5 @@
 /**
- * 27.1 有界只读并发 | [NEW] agent/tool-batch.ts
+ * 27.2 取消与收尾 | [CHANGED] agent/tool-batch.ts
  *
  * 学习目标：只让相邻本地只读调用共享有限容量，其他调用构成串行屏障。
  * 输入：带稳定 sequence/callID 的完整调用批、父取消信号、单项执行函数。
@@ -10,11 +10,16 @@
  */
 import type { ToolCall } from "../tools/registry.js";

-// [NEW 27.1] 新工具默认串行；load_skill 改已加载集合，必须先完成再读资源。
+// [KEEP 来自 27.1] 新工具默认串行；load_skill 改已加载集合，必须先完成再读资源。
 const PARALLEL_READS = new Set(["read_file", "glob", "grep", "read_tool_result", "read_job", "read_skill_resource"]);
 export type BatchItem = { call: ToolCall; sequence: number };
-export type ToolState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
-export type BatchOptions = { concurrency?: number; serial?: boolean };
+// [CHANGED 27.2] 超时的两种终态分别说明在队列中、还是开始执行后超期。
+export type ToolState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "queue_timeout" | "execution_timeout";
+export type BatchFailure = { state: "cancelled" | "queue_timeout" | "execution_timeout"; started: boolean; message: string };
+export type BatchOptions = { concurrency?: number; serial?: boolean;
+  queueTimeoutMs?: number; executionTimeoutMs?: number;
+  onFailure?: (item: BatchItem, failure: BatchFailure) => void;
+};
 export const isParallelRead = (call: ToolCall): boolean => PARALLEL_READS.has(call.name);

 /**
@@ -25,10 +30,21 @@
   if (!Number.isSafeInteger(value) || value < 1 || value > 4) throw new Error("toolConcurrency 必须为 1..4 的整数");
   return value;
 }
+/**
+ * [NEW 27.2] 排队与执行使用两只独立时钟，范围由本地控制。
+ * 省略时使用各自默认值；无效期限在调用入队前失败。
+ */
+function deadline(value: number | undefined, fallback: number): number {
+  const ms = value ?? fallback;
+  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 60_000) throw new Error("工具期限必须为 1..60000 毫秒的整数");
+  return ms;
+}

 /**
- * 发放前检查取消；容量必须等执行函数真正 settle 才归还。
- * 当前相邻读取段收尾后才进入下一段或单项串行屏障。
+ * [CHANGED 27.2] 超期只发出停止请求，始终 await 执行函数 settle 后归还容量。
+ * fs 的 realpath/stat/readFile 请求不能强杀，可能超过期限后才返回；本调度器不会提前释放槽。
+ * 只读白名单才有期限，其权限/审批等待也计入领槽后的执行期限。
+ * 非白名单调用沿用原信号与语义，远端效果不能撤回。
  */
 export async function runToolBatch(
   items: readonly BatchItem[], signal: AbortSignal,
@@ -37,30 +53,69 @@
   options: BatchOptions = {},
 ): Promise<void> {
   const capacity = options.serial ? 1 : batchConcurrency(options.concurrency);
-  for (const item of items) state(item, "queued");
-  let firstError: unknown;
-  let failed = false;
-  for (let offset = 0; offset < items.length;) {
-    if (failed || signal.aborted) break;
-    const start = offset++;
-    if (!options.serial && isParallelRead(items[start].call)) {
-      while (offset < items.length && isParallelRead(items[offset].call)) offset += 1;
+  const queueMs = deadline(options.queueTimeoutMs, 10_000), executionMs = deadline(options.executionTimeoutMs, 15_000);
+  const batch = new AbortController();
+  const cancel = () => batch.abort(signal.reason);
+  if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
+  const status = new Map(items.map(item => [item, "queued" as ToolState]));
+  const queueTimers = new Map<BatchItem, ReturnType<typeof setTimeout>>();
+  const change = (item: BatchItem, next: ToolState) => { status.set(item, next); state(item, next); };
+  const fail = (item: BatchItem, failure: BatchFailure) => { options.onFailure?.(item, failure); change(item, failure.state); };
+  let firstError: unknown, failed = false;
+  try {
+    for (const item of items) {
+      state(item, "queued");
+      if (isParallelRead(item.call)) queueTimers.set(item, setTimeout(() => {
+        if (status.get(item) === "queued") fail(item, { state: "queue_timeout", started: false, message: "排队期限已到；该调用没有启动。" });
+      }, queueMs));
     }
-    const segment = items.slice(start, offset);
-    let cursor = 0;
-    await Promise.all(Array.from({ length: Math.min(capacity, segment.length) }, async () => {
-      while (!failed && !signal.aborted && cursor < segment.length) {
-        const item = segment[cursor++];
-        state(item, "running");
-        try { state(item, await execute(item, signal) ? "succeeded" : "failed"); }
-        catch (error) { if (!failed) firstError = error; failed = true; state(item, "cancelled"); }
+    for (let offset = 0; offset < items.length;) {
+      if (batch.signal.aborted) break;
+      const start = offset++;
+      if (!options.serial && isParallelRead(items[start].call)) {
+        while (offset < items.length && isParallelRead(items[offset].call)) offset += 1;
       }
-    }));
-    if (failed || signal.aborted) {
-      for (const item of segment.slice(cursor)) state(item, "cancelled");
-      break;
+      const segment = items.slice(start, offset);
+      let cursor = 0;
+      await Promise.all(Array.from({ length: Math.min(capacity, segment.length) }, async () => {
+        while (!batch.signal.aborted && cursor < segment.length) {
+          const item = segment[cursor++];
+          if (status.get(item) !== "queued") continue;
+          clearTimeout(queueTimers.get(item));
+          const own = new AbortController();
+          const abort = () => own.abort(batch.signal.reason);
+          batch.signal.addEventListener("abort", abort, { once: true });
+          let timedOut = false;
+          // [NEW 27.2] 执行时钟从真正领槽起算，超时不以 Promise.race 提前腾槽。
+          const timer = isParallelRead(item.call) ? setTimeout(() => {
+            timedOut = true; own.abort(new Error("只读工具执行期限已到"));
+          }, executionMs) : undefined;
+          change(item, "running");
+          try {
+            const succeeded = await execute(item, own.signal);
+            if (timedOut) fail(item, { state: "execution_timeout", started: true, message: "执行期限已到；底层操作已返回并完成本地收尾，容量现已归还。" });
+            else if (batch.signal.aborted) fail(item, { state: "cancelled", started: true, message: "本轮已中断；底层操作已返回，已执行的效果不会自动撤销。" });
+            else change(item, succeeded ? "succeeded" : "failed");
+          } catch (error) {
+            if (timedOut) fail(item, { state: "execution_timeout", started: true, message: "执行期限已到；停止请求后已等待底层收尾，容量现已归还。" });
+            else if (batch.signal.aborted) fail(item, { state: "cancelled", started: true, message: "本轮已中断；停止请求后已等待底层返回，可能已发生的效果需核实。" });
+            else {
+              if (!failed) { firstError = error; failed = true; }
+              fail(item, { state: "cancelled", started: true, message: "工具异常中断；已等待执行函数返回。" });
+              batch.abort(error);
+            }
+          } finally {
+            clearTimeout(timer); batch.signal.removeEventListener("abort", abort);
+          }
+        }
+      }));
     }
+    // [NEW 27.2] 未发放的调用也有终态；父取消必须等待所有已启动工作收尾。
+    for (const item of items) if (status.get(item) === "queued") fail(item, { state: "cancelled", started: false, message: "本轮在该工具启动前中断，这个调用未执行。" });
+    if (failed) throw firstError;
+    signal.throwIfAborted();
+  } finally {
+    for (const timer of queueTimers.values()) clearTimeout(timer);
+    signal.removeEventListener("abort", cancel);
   }
-  if (failed) throw firstError;
-  signal.throwIfAborted();
 }
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,8 +1,9 @@
 /**
- * 27.1 有界只读并发 | [CHANGED] agent/agent-loop.ts
+ * 27.2 取消与收尾 | [CHANGED] agent/agent-loop.ts
  *
- * [CHANGED 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
- * 学习目标：让相邻白名单读取共享有限容量，保留每项原权限链、调用身份与串行屏障。
+ * [KEEP 来自 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
+ * [CHANGED 27.2] 排队期限 / 领槽后的执行期限 -> 发停止请求 -> await底层收尾 -> 归还槽。
+ * 学习目标：区分排队与执行期限，发出停止请求后等待底层真实收尾，再归还容量。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -59,7 +60,7 @@
  *   [KEEP 来自 21.2] HTTP配置 -> HTTPS/loopback校验 -> 固定Bearer环境变量 -> 官方StreamableHTTP
  *   [KEEP 来自 21.1] 显式MCP配置 -> SDK握手 -> 分页发现/命名 -> 模型定义 -> 逐次审批 -> SDK调用/原调用结果
  *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
- *   S: [CHANGED 27.1] 固定 sequence/callID -> 相邻白名单只读段最多 N 项；其他调用为串行屏障
+ *   S: [KEEP 来自 27.1] 固定 sequence/callID -> 相邻白名单只读段最多 N 项；其他调用为串行屏障
  *       -> 每项分别进入 C；Hooks 启用时整批串行；当前段全部收尾后才进入下一段
  *       -> 全部段收尾 -> 本批观察齐全 -> A
  *   C: 单项调用 -> [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
@@ -86,7 +87,7 @@
  *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
  *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
  *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
- *      [CHANGED 27.1] 保存本项正文 / 裁剪正文、原调用 ID 与错误标记 -> 本项过程事件 -> 返回 S
+ *      [KEEP 来自 27.1] 保存本项正文 / 裁剪正文、原调用 ID 与错误标记 -> 本项过程事件 -> 返回 S
  *      一批调用全部有结果后才回到下一次模型请求
  *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
  *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
@@ -125,7 +126,7 @@
 import type { PreparedToolCall } from "../tools/types.js";
 import { emitAgentEvent, type AgentObserver } from "./events.js";
 import type { RunOptions } from "./run-options.js";
-// [NEW 27.1] 原单项权限链由调度器调用，相邻白名单读取才共用有限容量。
+// [KEEP 来自 27.1] 原单项权限链由调度器调用，相邻白名单读取才共用有限容量。
 import { runToolBatch } from "./tool-batch.js";

 const MAX_MODEL_CALLS = 8;
@@ -189,7 +190,7 @@
       observer: event => { if (event.type === "child_state") emitAgentEvent(observer, event); },
     });
   };
-  // [NEW 27.1] 多个只读调用可能请求敏感文件审批；同一界面一次只显示一个批准请求。
+  // [KEEP 来自 27.1] 多个只读调用可能请求敏感文件审批；同一界面一次只显示一个批准请求。
   let approvalTail = Promise.resolve();
   const orderedApproval: ApprovalHandler = async (request, approvalSignal) => {
     const previous = approvalTail;
@@ -218,7 +219,7 @@
   let compactionAttempts = 0;

   // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
-  // [CHANGED 27.1] 并发时可能同时有多个尚未返回结果的调用。
+  // [KEEP 来自 27.1] 并发时可能同时有多个尚未返回结果的调用。
   const executingCallIds = new Set<string>();
   try {
     // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
@@ -331,7 +332,9 @@
       if (modelCall === maxModelCalls) break;

       turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
-      // [NEW 27.1] 先固定编号，后续完成乱序不会改变调用身份；副作用与依赖工具是屏障。
+      // [KEEP 来自 27.1] 先固定编号，后续完成乱序不会改变调用身份；副作用与依赖工具是屏障。
+      // [NEW 27.2] 相同ID在另一批复用时，也只找当前批已有结果。
+      const batchTurnStart = turn.length;
       const items = result.toolCalls.map((call, index) => ({ call, sequence: toolSequence + index + 1 }));
       toolSequence += items.length;
       await runToolBatch(items, signal, async ({ call, sequence }, callSignal) => {
@@ -485,7 +488,7 @@
             outcome: "success",
             result: { ...result, content: modelContent },
           });
-          // [CHANGED 27.1] 工具返回的错误标记也决定调度终态，避免 succeeded 覆盖界面失败状态。
+          // [KEEP 来自 27.1] 工具返回的错误标记也决定调度终态，避免 succeeded 覆盖界面失败状态。
           return !result.isError;
         } catch (error) {
           // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
@@ -509,7 +512,17 @@
           return false;
         }
       }, (item, state) => emitAgentEvent(observer, { type: "tool_state", ...item, state }),
-      { concurrency: options.toolConcurrency, serial: Boolean(model.hooks) });
+      // [NEW 27.2] 超时与取消交代原调用身份；已返回的真实结果保留并补充本地状态。
+      { concurrency: options.toolConcurrency, serial: Boolean(model.hooks),
+        queueTimeoutMs: options.toolQueueTimeoutMs, executionTimeoutMs: options.toolExecutionTimeoutMs,
+        onFailure: ({ call, sequence }, failure) => {
+          const last = turn.slice(batchTurnStart).reverse().find(message => message.role === "tool" && message.toolCallId === call.id);
+          if (last?.role === "tool") { last.content += `\n[本地状态] ${failure.message}`; last.isError = true; }
+          else { turn.push({ role: "tool", toolCallId: call.id, content: failure.message, isError: true }); pendingToolResults += 1; }
+          executingCallIds.delete(call.id);
+          emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "error", error: last?.role === "tool" ? last.content : failure.message });
+        },
+      });
     }

     if (options.childDepth) throw new ChildBudgetError("子任务已用尽模型决策次数，尚未得到完整最终回答。");
```

</details>

<details>
<summary>CHANGED：src/agent/run-options.ts 的精确差异</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,7 +1,7 @@
 /**
- * 27.1 有界只读并发 | [CHANGED] agent/run-options.ts
+ * 27.2 取消与收尾 | [CHANGED] agent/run-options.ts
  *
- * 学习目标：以本地选项限制只读并发容量，并保留每项原权限链。
+ * 学习目标：以本地选项分别配置只读排队与执行期限，模型不能通过工具参数放宽限制。
  * 输入：本地入口选定的模式、会话控制对象、调度限制与本轮交互回调。
  * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
  * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
@@ -62,8 +62,11 @@
 // [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 // [KEEP 来自 19.3] 工具使用进程内已发现目录，模型不能自行选择根目录。
 export type RunOptions = {
-  // [NEW 27.1] 本地入口配置容量；未列入白名单或有 Hooks 的调用仍串行。
+  // [KEEP 来自 27.1] 本地入口配置容量；未列入白名单或有 Hooks 的调用仍串行。
   toolConcurrency?: number;
+  // [NEW 27.2] 白名单只读调用从入批开始计排队，从领槽开始计执行；超期后仍等待收尾。
+  toolQueueTimeoutMs?: number;
+  toolExecutionTimeoutMs?: number;
   // [KEEP 来自 26.1] 作业属于会话，不能从磁盘恢复PID；子任务allowlist仍阻止启动。
   jobs?: import("../processes/jobs.js").JobManager;
   sessionId?: string;
```

</details>

<details>
<summary>CHANGED：src/tools/read-file.ts 的精确差异</summary>

<!-- source: src/tools/read-file.ts -->
```diff
--- a/src/tools/read-file.ts
+++ b/src/tools/read-file.ts
@@ -1,11 +1,11 @@
 /**
- * 19.3 模型选择与资源读取 | [KEEP] tools/read-file.ts
- *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责按行读取项目源码，告诉模型后面是否还有内容。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 27.2 取消与收尾 | [CHANGED] tools/read-file.ts
+ *
+ * 学习目标：按行读取项目源码并等待读取资源真正关闭，再归还调度容量。
+ * 阅读说明：取消请求继续传给stream；realpath/stat等文件系统请求不能强杀，只能等返回后检查取消。
  * 输入：path、从 1 开始的 offset 和 1 到 400 之间的 limit。
  * 输出：给模型的带行号片段，以及给界面的行号范围与续读状态。
- * 状态：失败或取消会结束读取；本文件不写文件，也不自行向会话历史提交内容。
+ * 状态：失败或取消会destroy读取流，等待close后返回；本文件不写文件，也不提交会话历史。
  *
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
  *   +------------------+
@@ -183,7 +183,10 @@
   signal?.throwIfAborted();
   const input = parseArguments(argumentsJson);
   const filePath = await resolveReadableFile(input.path, projectRoot);
+  // [NEW 27.2] 不可强杀的路径/属性请求已返回后再检查取消；关闭事件才确认读取资源收尾。
+  signal?.throwIfAborted();
   const stream = createReadStream(filePath, { encoding: "utf8", signal });
+  const closed = new Promise<void>(resolve => stream.once("close", resolve));
   const lines = createInterface({ input: stream, crlfDelay: Infinity });
   const selected: string[] = [];
   let lineNumber = 0;
@@ -203,6 +206,8 @@
   } finally {
     lines.close();
     stream.destroy();
+    // [NEW 27.2] 不让 Promise 的返回早于文件描述符关闭。
+    await closed;
   }

   if (lineNumber === 0 && input.offset === 1) {
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
- * 27.1 有界只读并发 | [CHANGED] ui/tui/state.ts
+ * 27.2 取消与收尾 | [CHANGED] ui/tui/state.ts
  *
  * 学习目标：把同一轮事件累积成显示状态；结束时采用包含本地 stop 反馈的完整回答，避免只留下较早的模型片段。
  * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
@@ -99,14 +99,15 @@
   if (event.type === "run_finish") return { ...view,
     answers: event.outcome === "completed" ? view.answers.map((answer, index) => index === view.answers.length - 1 ? { ...answer, text: screenText(event.reply.text) } : answer) : view.answers,
     tools: event.outcome === "completed" ? view.tools : view.tools.map((tool) =>
-      ["完成", "失败", "准备失败", "已拒绝"].includes(tool.status) ? tool : { ...tool, status: "已中断" }),
+      ["完成", "失败", "准备失败", "已拒绝", "排队超时", "执行超时", "已中断"].includes(tool.status) ? tool : { ...tool, status: "已中断" }),
     status: event.outcome === "completed" ? "已完成" : event.outcome === "cancelled" ? "已取消本轮" : `运行失败：${screenText(event.message)}`,
     usage: view.usage || (event.outcome === "completed" ? `服务商报告本轮累计：输入 ${event.reply.inputTokens ?? "未知"} / 输出 ${event.reply.outputTokens ?? "未知"} token` : ""),
   };
   // 前面的分支已经处理整轮与模型事件；剩下的事件都有工具 sequence，可更新同一行。
   const old = view.tools.find((tool) => tool.sequence === event.sequence);
-  // [NEW 27.1] 调度状态按固定 sequence 更新；终态不覆盖此前收到的完整结果。
-  const status = event.type === "tool_state" ? ({ queued: "排队中", running: "执行中", succeeded: "完成", failed: "失败", cancelled: "已中断" }[event.state])
+  // [KEEP 来自 27.1] 调度状态按固定 sequence 更新；终态不覆盖此前收到的完整结果。
+  // [CHANGED 27.2] 分开展示排队与执行超时，整轮结束保留这些已确认终态。
+  const status = event.type === "tool_state" ? ({ queued: "排队中", running: "执行中", succeeded: "完成", failed: "失败", cancelled: "已中断", queue_timeout: "排队超时", execution_timeout: "执行超时" }[event.state])
     : event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
     : event.type === "tool_prepare" ? event.outcome === "success" ? "预览已准备" : "准备失败"
     : event.type === "approval_start" ? "等待批准"
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:27.2
```

先用可控制收尾的执行函数检查两只时钟。第一批让正在执行的项超时，但它还要40毫秒清理；下一项必须等清理结束。第二批让队列项目超时，确认它根本没有进入执行函数。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runToolBatch } from './dist/agent/tool-batch.js';
const items = ['slow', 'next'].map((id, index) => ({
  call: { id, name: 'read_file', arguments: '{}' }, sequence: index + 1,
}));
const order = [], failures = [];
await runToolBatch(items, new AbortController().signal, async ({ call }, signal) => {
  order.push('start:' + call.id);
  if (call.id === 'slow') await new Promise(resolve => signal.addEventListener('abort', () => {
    order.push('stop-requested');
    setTimeout(() => { order.push('cleanup-ended'); resolve(); }, 40);
  }, { once: true }));
  return true;
}, () => {}, { concurrency: 1, queueTimeoutMs: 1000, executionTimeoutMs: 15,
  onFailure: (item, failure) => failures.push([item.call.id, failure]),
});
assert.ok(order.indexOf('start:next') > order.indexOf('cleanup-ended'));
assert.equal(failures[0][0], 'slow');
assert.equal(failures[0][1].state, 'execution_timeout');
assert.equal(failures[0][1].started, true);
const started = [], expired = [];
await runToolBatch(items, new AbortController().signal, async ({ call }) => {
  started.push(call.id); await delay(70); return true;
}, () => {}, { concurrency: 1, queueTimeoutMs: 20, executionTimeoutMs: 1000,
  onFailure: (item, failure) => expired.push([item.call.id, failure]),
});
assert.deepEqual(started, ['slow']);
assert.equal(expired[0][0], 'next');
assert.equal(expired[0][1].state, 'queue_timeout');
assert.equal(expired[0][1].started, false);
console.log('通过：执行超期等清理，排队超期不启动。');
NODE
```

注意这不是“计时器结束就返回”的实验：断言比较的是 `cleanup-ended` 与 `start:next` 的实际顺序。配套仓库还使用真实读取和真实子进程，检查忽略TERM时继续等KILL和close、父取消收尾、定时器/监听解除与原callID的结果。

```bash
LESSON_27=02-cancel-and-cleanup node tests/verify-chapter-27.mjs
```

## 本节完成后的 Agent

每个只读项现在分别知道排了多久、执行了多久、是否真正启动，以及停止后何时归还名额。单项超时留下自己的观察；整轮取消先等已经启动的工作收尾。下一节把这些终态与正常结果按原调用身份收齐，再允许模型继续。

本节状态：待用户确认。
