# 16.3 超限时压缩，再继续原任务

[第 16 章首页](/content/chapter-16-context-compaction/README.md) · [上一节：16.2 生成摘要并核对替换结果](/content/chapter-16-context-compaction/02-generate-summary/README.md) · [练习与答案](/content/chapter-16-context-compaction/EXERCISES.md) · [下一章：加载项目说明与规则](/content/chapter-17-project-instructions/README.md)

## 问题：生成了摘要，还要把原任务接回正确的位置

Agent 已执行测试并拿到结果，准备让模型判断负数用例是否满足要求，却在预算检查时发现下一份请求放不下。现在有了摘要能力，可以先缩短旧过程。

关键不只是“调用一下摘要模型”。原任务必须等候选准备结束，重新组成输入，确认预算允许后才发下一次决策请求。压缩期间收到补充、发生取消或仍然超限，都不能把任务误显示成已经完成。

## 解决方案：在原来的预算关口等待压缩，再重新检查

本节直接扩展第 15 章的预算检查。装得下照常请求；装不下则尝试摘要，得到较短候选以后重建请求并重算。最终能装下，才一次采用这次候选，再继续原 Agent Loop。

每项用户任务总共最多尝试两次摘要，而且每次都必须概括更多完整旧消息、确实减少输入。仍然放不下就停止，保留完整历史和先前采用的摘要。原任务的模型决策仍最多八次，不会因为压缩而获得无限继续的机会。

## 工作原理

### 先处理完工具结果，才有稳定的压缩起点

延续加法例子：模型提出读取源码和测试文件，两项工具按顺序返回。程序把调用和每份结果都记好，回到准备下一次请求的位置。

这时才判断预算和压缩。原因是，最近一批结果尚未收齐时，程序还不知道这一批到底发生了什么。若一边读取第二个文件，一边根据只有第一份结果的历史生成摘要，后面的决策就可能把“还没得到”误当成“没有执行”。

因此，这里等待的是当前模型响应提出的完整工具清单处理结束，不是等待整个加法任务结束。工具失败也有明确错误结果，完整清单处理完以后同样可以进入预算判断。摘要只看到已经有交代的组，不接管正在运行的工具。

### 原流程停在准备请求的位置，摘要结束后才往下走

下面用教学数值看一次成功过程：本地窗口 8,000、输出预留 2,000，下一份普通输入估算 6,300，超出 300。程序先不发送这份普通请求。

```text
工具清单处理完 → 完整输入 6,300 → 放不下
                                ↓
                  等待摘要完整返回并校验
                                ↓
                  候选视图输入 5,700 → 放得下
                                ↓
                   采用候选 → 请求模型继续任务
```

核心在等待摘要时，保留了“本次任务正准备第几次决策”的执行位置。摘要返回后，控制流从这个位置继续，重新检查候选；没有另一条并行的普通请求绕过检查先发出去。这就是等待能够保证顺序的原因：后面的发送步骤只位于等待完成后的成功分支里。

这段等待没有冻结整个程序。界面仍接收操作，但新文字先去本地队列，取消仍能改变取消信号。它们怎样影响当前任务，由同一个核心在明确检查点处理，不由界面直接改写已经准备的请求。

### 补充要求只在已有的收取位置进入消息

第 12 章的 Enter 规则继续有效。核心在准备这一轮前，先把属于当前任务的补充收进历史，然后才选择旧组、估算与压缩。这些文字属于用户原文保护范围，不会因为需要腾空间就被摘要替掉。

如果摘要进行期间又按 Enter，新文字先留在队列。这次摘要请求已经准备好，不能把后来的文字倒塞进已发送内容。核心之后回到下一次补充检查位置时再收取；若任务达到限度或在此之前停止，保留未交付文字并提示。

因此，“压缩后继续”不表示所有恰好同时到来的要求都已经交给模型。是否收下、是否进入某次请求、模型是否落实，仍是三个不同进度。若模型先给出最终回答，核心仍按原规则检查是否有补充、是否还有次数，再决定结束或继续。

### 最终候选装得下以后，才一次采用

第一次摘要可能把输入从 6,300 降到 6,100，仍超过可用的 6,000。程序可以沿候选继续选择更多旧组，在本项任务还剩摘要额度时最多再尝试一次。第二次若降到 5,700，最终才一次提交新的摘要与覆盖位置。

如果第二次失败、被取消，或仍然超过预算，整次未采用的候选都丢弃。会话继续保留进入这次压缩之前的摘要状态；完整历史从来没删。这样不会出现“界面说压缩失败，本地却悄悄换成第一份候选”的情况。

不能继续选择时也停止：例如只剩必须原样保留的用户要求与近期四组，或一组大到摘要请求也放不下。重试相同材料不会自然变小，所以当前机制不循环碰运气。

### 采用到内存，与保存到磁盘是两个时刻

最终候选通过预算以后，核心先把它记成当前内存中的压缩状态，接着发送原任务请求。普通会话保存仍在已有的任务收尾路径执行，记录完整历史与这份压缩状态，并同步文件。

因此，“采用摘要”不等于“磁盘已经持久保存”。若之后用户取消，程序先结束本地请求或工具清理，再按原路径保存状态；若此时程序崩溃，恢复依据仍是上一次完整保存记录。保存失败也应提示，不能把尚未落盘的内存说成可恢复。

即使摘要已经采用，后面的普通模型请求仍可能失败，或因真实分词差异被服务拒绝。程序保留已经取得的数据与采用状态，按已有失败路径收尾；本地估算通过没有保证远端一定接受，更没有保证模型完成测试。

### 摘要调用与任务决策各自计数，停止不撤销副作用

摘要请求不执行工具，所以单独计入最多两次的压缩尝试；原任务仍最多八次决策请求。两次摘要额度在整项任务内共享，不会在每次决策前重置。两类请求实际返回的服务用量都累计，不能因为摘要属于内部整理就隐藏消耗。

如果第八次决策返回最终回答，按第 12 章规则结束；若它仍提出新的工具调用，没有第九次接收结果，本批就不执行。压缩只解决输入过长，没有改掉这个停止条件。

取消期间，摘要本身没有文件副作用。此前工具已经改过的文件仍然存在，不能因丢弃摘要候选就称为恢复。需要撤回时，仍核对第 14 章的检查点与当前文件；远端生成是否立即停止也不由本地摘要状态证明。

<!-- generated:media:start -->
下面先看两次读取逐项返回，再看原任务停在预算关口，等待两份候选后继续测试。移动卡表示正在交付的内容，到达后才更新状态；摘要期间提交的“也测零”先进入本地队列。最后一帧单独说明第二次摘要失败的去向。

<img src="./content/chapter-16-context-compaction/03-compact-and-continue/assets/compact-continue-cover-3fe926da03.png" data-gif-src="./content/chapter-16-context-compaction/03-compact-and-continue/assets/compact-continue-1b055b2958.gif" data-cover="./content/chapter-16-context-compaction/03-compact-and-continue/assets/compact-continue-cover-3fe926da03.png" data-no-zoom alt="两份读取结果齐全后检查预算，摘要候选两次最终一次采用，再按权限运行测试并把实际结果交回模型">

[静态封面](/content/chapter-16-context-compaction/03-compact-and-continue/assets/compact-continue-cover-3fe926da03.png.md) · [查看完整静态分镜](/content/chapter-16-context-compaction/03-compact-and-continue/assets/compact-continue-storyboard-ec0054c5b0.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/events.ts](/content/chapter-16-context-compaction/03-compact-and-continue/src/agent/events.ts.md) | 区分压缩开始、候选完成与最终采用或保留旧状态 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-16-context-compaction/03-compact-and-continue/src/agent/agent-loop.ts.md) | 预算不足时等待有界压缩，只在普通请求可发送后提交候选 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-16-context-compaction/03-compact-and-continue/src/ui/teaching-trace.ts.md) | 把候选与最终结果解释成可区分的本地状态 |
| CHANGED | [src/ui/tui/state.ts](/content/chapter-16-context-compaction/03-compact-and-continue/src/ui/tui/state.ts.md) | 保存压缩过程与结果供TUI显示 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-16-context-compaction/03-compact-and-continue/src/ui/tui/app.tsx.md) | 展示压缩状态，继续沿用同一任务和取消入口 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 16.2 的完整 `src/` 继续，目标目录是 `chapter-16-context-compaction/03-compact-and-continue/`。复用原来的任务、补充队列、取消与保存路径，把压缩放在发出普通模型请求之前。界面消费压缩事件，不另开一条能独立续跑的任务。

<!-- generated:build:start -->
### 1. 区分压缩开始、候选完成与最终采用或保留旧状态

在上一节的 `src/agent/events.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/events.ts（CHANGED）</summary>

<!-- source: src/agent/events.ts -->
```diff
--- a/src/agent/events.ts
+++ b/src/agent/events.ts
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] agent/events.ts
+ * 16.3 自动压缩后继续任务 | [CHANGED] agent/events.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责传递已经发生的模型、权限和工具事件。
  * 输入：runAgent 的开始/结束通知，或 Agent Loop 已发生的过程事件。
@@ -32,7 +32,12 @@
 // [KEEP 来自 09.1] 整轮任务开始与结束也使用事件通知。
 export type AgentEvent =
   | { type: "run_start" }
-  // [NEW 15.1] 估算是下次请求输入的本地预测；usage 是服务商已报告的本轮累计，缺失为 null。
+  // [NEW 16.3] 摘要准备、候选与实际采用分开；这些事件不能执行工具或修改历史。
+  | { type: "compaction_start"; attempt: number }
+  | { type: "compaction_candidate"; attempt: number; before: number; after: number; through: number }
+  | { type: "compaction_finish"; outcome: "applied"; through: number }
+  | { type: "compaction_finish"; outcome: "retained"; message: string }
+  // [KEEP 来自 15.1] 估算是下次请求输入的本地预测；usage 是服务商已报告的本轮累计，缺失为 null。
   | { type: "context_budget"; call: number; budget: ContextBudget }
   | { type: "model_usage"; call: number; inputTokens: number | null; outputTokens: number | null; costEstimateUsd: number | null }
   | { type: "run_finish"; outcome: "completed"; reply: Reply }
```

</details>

### 2. 预算不足时等待有界压缩，只在普通请求可发送后提交候选

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,7 @@
 /**
- * 16.1 区分完整记录与请求视图 | [CHANGED] agent/agent-loop.ts
+ * 16.3 自动压缩后继续任务 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：在每次发送前检查输入估算和输出预留，超限保留历史并停止请求。
+ * 学习目标：预算不足时有界生成摘要，确认完整请求适配后继续，失败保留原记录。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -33,7 +33,9 @@
  *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
  *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
  *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
- *      [KEEP 来自 15.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> X（不发 HTTP，不删历史）
+ *      [CHANGED 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
+ *           -> 候选仍超限 / 失败 / 取消？-- 是 -> X（原视图与完整记录保留）
+ *                                       +-- 否 -> 提交摘要游标，再请求模型
  *                                                      +-- 是 -> 请求模型
  *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
  *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
@@ -82,11 +84,11 @@
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
  * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
- * 运行观察：本地估算不是服务商计数或容量保证；服务商 usage 缺失时保持未知，本节不自动摘要。
+ * 运行观察：本地估算不是服务商计数或容量保证；服务商 usage 缺失时保持未知，摘要也有独立预算，失败或取消不采用候选；完整记录不删除。
  */

-import { emptyCompaction, requestMessages } from "../context/compaction.js";
-import { ToolError, UserFacingError } from "../errors.js";
+import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
+import { explainError, ToolError, UserFacingError } from "../errors.js";
 import { boundToolResult, clippedToolText } from "../context/tool-results.js";
 import type { Message, Model, Reply } from "../models/client.js";
 import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
@@ -135,7 +137,7 @@
   signal.throwIfAborted();
   // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
   const mode = options.mode ?? "execute";
-  // [NEW 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
+  // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
   const context = options.context ?? emptyCompaction();
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
@@ -146,6 +148,8 @@
   let truncated = false;
   let toolSequence = 0;
   let pendingToolResults = 0;
+  // [NEW 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
+  let compactionAttempts = 0;

   // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
   let executingCallId: string | undefined;
@@ -162,11 +166,40 @@
       }
       signal.throwIfAborted();
       // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
-      const messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
-      const budget = model.inspectContext?.(messages, mode);
+      let messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
+      let budget = model.inspectContext?.(messages, mode);
       if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
-      // [KEEP 来自 15.3] 下一份输入已完整准备，先过本地预算门；超限不发送、不删除任何历史。
-      if (budget && !budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送，历史已保留；请缩小任务或新建会话，本节不自动压缩。`);
+      // [NEW 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
+      if (budget && !budget.withinBudget) {
+        const candidate = { ...context };
+        try {
+          while (!budget.withinBudget && compactionAttempts < 2) {
+            compactionAttempts += 1;
+            emitAgentEvent(observer, { type: "compaction_start", attempt: compactionAttempts });
+            const prepared = await prepareCompaction(model, [...history, ...turn], candidate, signal, mode,
+              toolOptions.tasks?.items, result => {
+                inputTokens = addUsage(inputTokens, result.inputTokens);
+                outputTokens = addUsage(outputTokens, result.outputTokens);
+                emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
+                  costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
+              });
+            Object.assign(candidate, prepared.state);
+            messages = requestMessages([...history, ...turn], candidate, toolOptions.tasks?.items);
+            budget = model.inspectContext!(messages, mode);
+            emitAgentEvent(observer, { type: "compaction_candidate", attempt: compactionAttempts,
+              before: prepared.before, after: prepared.after, through: candidate.through });
+          }
+          signal.throwIfAborted();
+          if (!budget.withinBudget) throw new UserFacingError("本项任务的摘要次数已用尽，请求仍超出本地预算；候选未采用，完整记录保留。");
+          Object.assign(context, candidate);
+          emitAgentEvent(observer, { type: "compaction_finish", outcome: "applied", through: context.through });
+          emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
+        } catch (error) {
+          emitAgentEvent(observer, { type: "compaction_finish", outcome: "retained",
+            message: signal.aborted ? "压缩已取消，旧请求视图和完整记录保留。" : explainError(error) });
+          throw error;
+        }
+      }
       emitAgentEvent(observer, {
         type: "model_start",
         call: modelCall,
```

</details>

### 3. 把候选与最终结果解释成可区分的本地状态

在上一节的 `src/ui/teaching-trace.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/teaching-trace.ts（CHANGED）</summary>

<!-- source: src/ui/teaching-trace.ts -->
```diff
--- a/src/ui/teaching-trace.ts
+++ b/src/ui/teaching-trace.ts
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] ui/teaching-trace.ts
+ * 16.3 自动压缩后继续任务 | [CHANGED] ui/teaching-trace.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责从结构化事件整理过程说明，保留模型正文的用途。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
@@ -134,7 +134,13 @@
  * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
  */
 export function formatTeachingTrace(event: AgentEvent): string[] {
-  // [NEW 15.1] 估算和已报告用量使用不同标签；它们没有工具 sequence。
+  // [NEW 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
+  if (event.type === "compaction_start") return [`正在压缩旧记录：本项任务第 ${event.attempt}/2 次摘要准备，完整记录保留。`];
+  if (event.type === "compaction_candidate") return [`摘要候选：输入估算 ${event.before} → ${event.after}，覆盖前 ${event.through} 条；尚未采用。`];
+  if (event.type === "compaction_finish") return [event.outcome === "applied"
+    ? `压缩已采用：摘要覆盖前 ${event.through} 条，请求预算已通过；完整记录仍保留。`
+    : `压缩未采用：${toTraceText(event.message, 160)}`];
+  // [KEEP 来自 15.1] 估算和已报告用量使用不同标签；它们没有工具 sequence。
   if (event.type === "context_budget") {
     const b = event.budget;
     return [`第 ${event.call} 次请求 · 本地估算：输入约 ${b.inputEstimate} + 输出预留 ${b.outputReserve} / 窗口 ${b.windowTokens} token；余量约 ${b.remainingEstimate}（可能与服务商不同）`];
```

</details>

### 4. 保存压缩过程与结果供TUI显示

在上一节的 `src/ui/tui/state.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/state.ts（CHANGED）</summary>

<!-- source: src/ui/tui/state.ts -->
```diff
--- a/src/ui/tui/state.ts
+++ b/src/ui/tui/state.ts
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] ui/tui/state.ts
+ * 16.3 自动压缩后继续任务 | [CHANGED] ui/tui/state.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责把已收到的事件累积成界面状态。
  * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
@@ -70,7 +70,11 @@
  */
 export function updateRunView(view: RunView, event: AgentEvent): RunView {
   if (event.type === "run_start") return emptyRunView();
-  // [NEW 15.1] 预算与 usage 独立保存；错误或取消不会抹掉已经取得的服务商用量。
+  // [NEW 16.3] 压缩状态独立于模型正文和工具 sequence，取消由原本 run_finish 收尾。
+  if (event.type === "compaction_start" || event.type === "compaction_candidate" || event.type === "compaction_finish") {
+    return { ...view, status: formatTeachingTrace(event).join(" ") };
+  }
+  // [KEEP 来自 15.1] 预算与 usage 独立保存；错误或取消不会抹掉已经取得的服务商用量。
   if (event.type === "context_budget") return { ...view, budget: formatTeachingTrace(event).join(" ") };
   if (event.type === "model_usage") return { ...view, usage: formatTeachingTrace(event).join(" ") };
   // [KEEP 来自 12.4] 用户补充没有工具 sequence。
```

</details>

### 5. 展示压缩状态，继续沿用同一任务和取消入口

在上一节的 `src/ui/tui/app.tsx` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/app.tsx（CHANGED）</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 16.1 区分完整记录与请求视图 | [CHANGED] ui/tui/app.tsx
+ * 16.3 自动压缩后继续任务 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：在任务和保存状态之外单独显示本地预算，让输入估算与服务商用量各有明确来源。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -71,7 +71,7 @@
  * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
  */
 type Session = {
-  // [NEW 16.1] 摘要视图独立于完整历史，组件重绘不会重建。
+  // [KEEP 来自 16.1] 摘要视图独立于完整历史，组件重绘不会重建。
   context: CompactionState;
   // [KEEP 来自 12.1] 会话模式供下一轮启动取快照。
   mode: ExecutionMode;
@@ -389,6 +389,10 @@
           // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
           // [KEEP 来自 12.4] 只在核心确认收取并加入本次上下文后显示确认。
           if (event.type === "input_applied" && !session.closing) append("本地", `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${event.text}`);
+          // [NEW 16.3] 已采用或未采用的结论留在本地阅读记录，不写成模型消息。
+          if (event.type === "compaction_finish" && !session.closing) append("本地", event.outcome === "applied"
+            ? `压缩已采用：前 ${event.through} 条旧记录改用摘要发送，完整记录仍保存。`
+            : `压缩未采用：${event.message}`);
           current = updateRunView(current, event);
           if (!session.closing) setView(current);
         }
```

</details>
<!-- generated:build:end -->

## 运行验证

先编译并注册本节。

```bash
npm run lesson:16.3
```

进入演示工作区后正常运行。

```bash
hello-my-agent
```

连续调查与测试会增加历史。达到本地预算时，应先看到压缩状态，成功后再看到原任务继续请求；失败或取消应结束等待并保留已有内容。真实服务需要足够的材料才可能触发，不必为了演示反复运行修改命令；章末实验使用固定模型返回精确检查成功、失败和取消。

## 本节完成后的 Agent

Agent 现在会在需要时尝试缩短旧过程，同时保留用户原文、近期完整消息组与完整本地历史。它能确认“候选完成且预算允许”，不能确认摘要语义永远正确或后续任务一定成功。下一章加入项目说明，让每次请求也能携带当前项目的开发约定。
