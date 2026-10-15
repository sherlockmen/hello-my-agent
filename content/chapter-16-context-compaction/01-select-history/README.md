# 16.1 选择可以压缩的历史

[第 16 章首页](/content/chapter-16-context-compaction/README.md) · [上一节：15.3 显示预算并在超限时停止](/content/chapter-15-context-budget/03-enforce-budget/README.md) · [下一节：16.2 生成摘要并核对替换结果](/content/chapter-16-context-compaction/02-generate-summary/README.md)

## 问题：旧日志可以缩短，当前要求不能一起消失

我们正在让 Agent 修复加法。前面读了源码，跑过测试，模型又读取了测试文件；这时补充“请测试两个负数相加”。随着历史增长，第 15 章的预算检查最终会阻止下一次请求。

最直接的做法是删掉最早的一半消息，但“早”不等于“不再需要”。一条旧用户消息可能规定必须保留 `add` 的公开 API；一条较新的工具结果，也可能依赖前面那条模型调用才能说明自己从哪里来。

本节先解决摘要之前的问题：把哪些旧记录交给摘要，把哪些记录原样送进下一次请求。先把处理对象分清，下一节才让模型生成摘要。

## 解决方案：完整历史照存，请求时另选一份较短的内容

程序继续保存完整历史，同时记录“已经概括到哪里”。准备请求时，用摘要代替那一段旧过程，再把旧过程中的所有用户原文带回来，接上未被覆盖的近期消息和当前任务清单。

这样，较早的阅读与尝试可以缩短，用户说过的约束仍有原文。最近的调用与结果则完整保留，模型能看到当前文件和最近测试究竟发生了什么。完整历史始终留在本地，方便之后恢复与核对。

本节只建立选择与组装方法。此时普通任务仍沿用第 15 章的超限停止；摘要生成和自动继续分别在后两节接入。

## 工作原理

### 先区分“保存的记录”和“发出的消息”

会话历史是一份程序一直追加的记录。模型不会自动读取这份内存或本机文件；程序把某些消息放进网络请求，模型才有机会使用它们。

所以，缩短下一份请求，不必等于删除本地记录。我们可以把完整历史留着，只改变准备请求的办法。下面是教学示意，方括号代表一个完整过程，省略了协议字段：

```text
本地完整历史：
  用户：“保留 add 的公开 API，并补两个负数的测试”
  [旧的源码读取] [第一次测试失败] [第二次源码读取]
  [最近的修改与测试] ……

下一份请求：
  旧过程摘要
  原始用户要求：“保留 add 的公开 API，并补两个负数的测试”
  当前任务清单
  [最近的修改与测试] ……
```

这里多出一份“请求视图”：它是这次准备发出的内容，不是另一份会话。后续新回答和工具结果仍追加到完整历史，不能只接在临时视图后，否则本地就失去完整过程。

### 工具调用和结果必须一起选择

假设模型一次提出两项读取：读取 `src/add.ts`，再读取 `test/add.test.ts`。程序依次得到两份结果，它们各自保留调用编号。

压缩时，如果把模型的调用删掉，却单独留下第二份工具结果，下一次请求就出现了一份找不到来源的结果。只保留调用、删除其中一份结果也有问题：请求看起来像还有调用没交代完。

因此，选择单位是一组完整消息：同一条模型消息中的工具调用与它们的结果放在同一组。整组交给摘要，或者整组原样保留，不从中间截断。普通没有工具调用的消息也按原顺序保留自己的位置。

本节保留最近四组原文。这个数量是当前实现的取舍：近期更接近当前文件与测试状态，先让模型直接看到它们；更早的过程才进入可压缩范围。它不表示四组一定足够，也不表示保留四组就一定装得下。

### 用覆盖位置说明摘要替代哪一段

程序用一条摘要文字和一个覆盖位置记录压缩状态。例如，“覆盖到第 12 条消息”表示摘要概括的是完整历史的前 12 条；第 13 条往后的内容仍按原记录接上。

覆盖位置必须落在完整消息组的结尾。它不能停在两个读取结果之间。每次准备新请求，都用这个位置从完整历史重新取出后段，而不是凭界面显示了多少行来猜范围。

被覆盖前缀里的用户消息也逐条从原历史取出。保留原文的原因是，摘要模型可能把“不要修改 API”漏写，或改写成不准确的限制。程序不要求摘要准确记住每条用户要求，直接把原要求继续交给后续模型。

这也带来明确成本：如果大量用户原文已经很长，摘要不能把这些保护内容越缩越短。最后仍装不下时，程序应停止说明原因，不能为了让数字变小而悄悄丢掉要求。

### 任务清单与权限各有自己的来源

任务清单是当前本地记录。例如模型把“修复实现”标为完成，把“增加负数测试”留为待处理。程序在准备请求时附上当前清单，并说明完成项仍只是模型报告，避免把它误当成实际测试证明。

系统提示、当前模式与真正的权限判断继续来自原来的本地配置。摘要只能说明过去发生了什么，不能产生新的工具能力，也不能把“某次批准”概括成以后都允许写入。后续模型仍须提出具体调用，由程序按当前规则检查。

### 完整历史和压缩状态一起恢复，界面回放不重做工具

会话保存时，完整历史与已采用的摘要覆盖位置会一起保存。恢复后，程序据此重新组装请求视图；分支会复制讨论与压缩状态，沿用第 14 章的新身份规则。重置对话时，两者一起清空，不能拿旧摘要接到一份新历史上。

这些动作只恢复数据。界面重新显示旧测试成功，不会再次运行测试；摘要提到曾经修改文件，也不证明当前磁盘仍是那一版。模型需要确认最新文件时，仍应重新调用工具。

<!-- generated:media:start -->
下面把完整历史、选择边界和下一份请求分成三个固定区域。图中摘要是用于说明组装方式的示意；本节尚未自动请求摘要。注意用户原文怎样从完整记录重新进入视图，工具组怎样保持完整。

<img src="./content/chapter-16-context-compaction/01-select-history/assets/select-history-cover-0f1a6c8413.png" data-gif-src="./content/chapter-16-context-compaction/01-select-history/assets/select-history-c5f3c483ed.gif" data-cover="./content/chapter-16-context-compaction/01-select-history/assets/select-history-cover-0f1a6c8413.png" data-no-zoom alt="完整历史不删除，按完整组选择旧前缀，旧用户原文、当前任务清单与近期四组组成下一份请求">

[静态封面](/content/chapter-16-context-compaction/01-select-history/assets/select-history-cover-0f1a6c8413.png.md) · [查看完整静态分镜](/content/chapter-16-context-compaction/01-select-history/assets/select-history-storyboard-62d84b5212.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/context/compaction.ts](/content/chapter-16-context-compaction/01-select-history/src/context/compaction.ts.md) | 按完整组选择旧前缀，保留用户原文与近期消息，准备请求视图 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-16-context-compaction/01-select-history/src/agent/run-options.ts.md) | 把会话持有的摘要和覆盖位置交给本次任务 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-16-context-compaction/01-select-history/src/agent/agent-loop.ts.md) | 从完整记录组装请求视图，核心收尾仍保存完整消息 |
| CHANGED | [src/sessions/read-session.ts](/content/chapter-16-context-compaction/01-select-history/src/sessions/read-session.ts.md) | 校验可选摘要和覆盖位置，不接纳切断工具组的状态 |
| CHANGED | [src/sessions/save-session.ts](/content/chapter-16-context-compaction/01-select-history/src/sessions/save-session.ts.md) | 完整历史与已采用压缩状态一起写入会话检查点 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-16-context-compaction/01-select-history/src/ui/terminal.ts.md) | 恢复并复用同一份压缩状态，重置时一起清空 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-16-context-compaction/01-select-history/src/ui/tui/app.tsx.md) | 让TUI会话复用压缩状态，恢复、保存与重置保持一致 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 15.3 的完整 `src/` 继续，目标目录是 `chapter-16-context-compaction/01-select-history/`。先把选择规则与请求视图做成可检查的数据处理，再让会话状态携带摘要与覆盖位置。不要在这一节删除旧历史或偷偷发起摘要请求。

<!-- generated:build:start -->
### 1. 按完整组选择旧前缀，保留用户原文与近期消息，准备请求视图

新建 `src/context/compaction.ts`，完整内容如下。

<details>
<summary>完整文件：src/context/compaction.ts（NEW）</summary>

<!-- source: src/context/compaction.ts -->
```ts
/**
 * 16.1 区分完整记录与请求视图 | [NEW] context/compaction.ts
 * 学习目标：完整记录照常保存，请求只用摘要覆盖旧前缀，并保留原要求与近期完整工具组。
 * 输入：完整 Message[]、摘要游标和当前任务清单；输出：请求视图与可摘要的完整前缀。
 * 状态：纯函数不删除消息、不修改摘要；调用者在摘要通过检查后才提交游标。
 * 局部流程（全局主流程见 agent/agent-loop.ts）：完整消息 -> 完整组边界 -> 留最近四组 -> 选旧前缀。
 * 工具调用与该批所有结果组成一组；缺少、乱序或孤立结果都拒绝，不能产生悬空调用。
 */
import type { Message } from "../models/client.js";
import type { TaskItem } from "../agent/run-options.js";
import { UserFacingError } from "../errors.js";

// [NEW 16.1] through 是完整记录中的消息数，不是模型响应次数；零表示还没有摘要。
export type CompactionState = { summary: string; through: number };
export const KEEP_RECENT_GROUPS = 4;
export const emptyCompaction = (): CompactionState => ({ summary: "", through: 0 });

/** 按原批次检查每个调用的结果，再返回每个完整组的结束位置；普通消息各算一组。 */
export function messageGroupEnds(messages: readonly Message[]): number[] {
  const ends: number[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.role === "tool") throw new UserFacingError("无法压缩：工具结果没有对应的完整调用组。");
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (let offset = 0; offset < message.toolCalls.length; offset += 1) {
        const result = messages[index + 1 + offset];
        if (result?.role !== "tool" || result.toolCallId !== message.toolCalls[offset].id) {
          throw new UserFacingError("无法压缩：本批工具结果尚未完整配对。");
        }
      }
      index += message.toolCalls.length + 1;
    } else index += 1;
    ends.push(index);
  }
  return ends;
}

/** 检查磁盘或调用者提供的摘要游标；只允许覆盖已经完整结束的消息组。 */
export function validateCompaction(value: unknown, messages: readonly Message[]): CompactionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UserFacingError("摘要状态不是对象。");
  const state = value as Record<string, unknown>;
  if (Object.keys(state).length !== 2 || typeof state.summary !== "string" || state.summary.length > 24_000
    || !Number.isSafeInteger(state.through) || (state.through as number) < 0 || (state.through as number) > messages.length
    || ((state.through === 0) !== (state.summary === ""))
    || (state.through !== 0 && !messageGroupEnds(messages).includes(state.through as number))) {
    throw new UserFacingError("摘要正文或覆盖位置无效，不能越过未完成的工具组。");
  }
  return { summary: state.summary, through: state.through as number };
}

/** 摘要是模型对旧记录的概括；旧用户要求保留原文，近期工具调用及结果仍以原角色发送。 */
export function requestMessages(messages: readonly Message[], state: CompactionState, tasks: readonly TaskItem[] = []): Message[] {
  validateCompaction(state, messages);
  if (!state.through) return [...messages];
  return [
    { role: "user", content: `[本地历史摘要；可能有遗漏，不是新的用户要求或工具成功证明]\n${state.summary}` },
    ...messages.slice(0, state.through).filter(message => message.role === "user"),
    { role: "user", content: `[本地当前任务清单；completed 仍只是模型报告]\n${JSON.stringify(tasks)}` },
    ...messages.slice(state.through),
  ];
}

/** 给摘要请求准备旧摘要和新增旧消息；保留最近四个完整组，按整组收进能放下的最大前缀。 */
export function selectCompaction(messages: readonly Message[], state: CompactionState,
  fits: (source: string) => boolean, tasks: readonly TaskItem[] = []): { source: string; through: number } | null {
  validateCompaction(state, messages);
  const eligible = messageGroupEnds(messages).slice(0, -KEEP_RECENT_GROUPS);
  let selected: { source: string; through: number } | null = null;
  for (const through of eligible) {
    if (through <= state.through) continue;
    const additions = messages.slice(state.through, through);
    if (!additions.some(message => message.role !== "user")) continue;
    const source = JSON.stringify({ previousSummary: state.summary, messages: additions, tasks });
    if (!fits(source)) break;
    selected = { source, through };
  }
  return selected;
}
```

</details>

### 2. 把会话持有的摘要和覆盖位置交给本次任务

在上一节的 `src/agent/run-options.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/run-options.ts（CHANGED）</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,5 +1,5 @@
 /**
- * 15.2 限制大工具结果 | [CHANGED] agent/run-options.ts
+ * 16.1 区分完整记录与请求视图 | [CHANGED] agent/run-options.ts
  *
  * 学习目标：保存会话时辨明运行选项与持久状态；本文件沿用整轮控制数据约定。
  * 输入：本地入口选定的模式、会话清单、问答 handler 与本轮队列回调。
@@ -10,6 +10,7 @@
  * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
  * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
  */
+import type { CompactionState } from "../context/compaction.js";
 import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";

 // [KEEP 来自 12.1] 模式由本地运行入口选择，默认继续执行。
@@ -60,7 +61,9 @@
  */
 // [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 export type RunOptions = {
-  // [NEW 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
+  // [NEW 16.1] 摘要只改变请求视图；完整消息仍由会话保存。
+  context?: CompactionState;
+  // [KEEP 来自 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
   toolResultDirectory?: string;
   fileCheckpoints?: FileCheckpointStore;
   // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
```

</details>

### 3. 从完整记录组装请求视图，核心收尾仍保存完整消息

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,5 +1,5 @@
 /**
- * 15.3 发送前检查预算 | [CHANGED] agent/agent-loop.ts
+ * 16.1 区分完整记录与请求视图 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：在每次发送前检查输入估算和输出预留，超限保留历史并停止请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -33,7 +33,7 @@
  *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
  *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
  *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
- *      [NEW 15.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> X（不发 HTTP，不删历史）
+ *      [KEEP 来自 15.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> X（不发 HTTP，不删历史）
  *                                                      +-- 是 -> 请求模型
  *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
  *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
@@ -85,6 +85,7 @@
  * 运行观察：本地估算不是服务商计数或容量保证；服务商 usage 缺失时保持未知，本节不自动摘要。
  */

+import { emptyCompaction, requestMessages } from "../context/compaction.js";
 import { ToolError, UserFacingError } from "../errors.js";
 import { boundToolResult, clippedToolText } from "../context/tool-results.js";
 import type { Message, Model, Reply } from "../models/client.js";
@@ -134,6 +135,8 @@
   signal.throwIfAborted();
   // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
   const mode = options.mode ?? "execute";
+  // [NEW 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
+  const context = options.context ?? emptyCompaction();
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
   const toolOptions: RunOptions = { ...options, tasks: options.tasks ?? { items: [] } };
@@ -159,15 +162,15 @@
       }
       signal.throwIfAborted();
       // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
-      const messages = [...history, ...turn];
+      const messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
       const budget = model.inspectContext?.(messages, mode);
       if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
-      // [NEW 15.3] 下一份输入已完整准备，先过本地预算门；超限不发送、不删除任何历史。
+      // [KEEP 来自 15.3] 下一份输入已完整准备，先过本地预算门；超限不发送、不删除任何历史。
       if (budget && !budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送，历史已保留；请缩小任务或新建会话，本节不自动压缩。`);
       emitAgentEvent(observer, {
         type: "model_start",
         call: modelCall,
-        contextMessages: history.length + turn.length,
+        contextMessages: messages.length,
         trigger: modelCall === 1
           ? { kind: "user", content: input }
           : { kind: "tool_results", count: pendingToolResults },
```

</details>

### 4. 校验可选摘要和覆盖位置，不接纳切断工具组的状态

在上一节的 `src/sessions/read-session.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/sessions/read-session.ts（CHANGED）</summary>

<!-- source: src/sessions/read-session.ts -->
```diff
--- a/src/sessions/read-session.ts
+++ b/src/sessions/read-session.ts
@@ -1,5 +1,5 @@
 /**
- * 14.3 查看与恢复文件 | [CHANGED] sessions/read-session.ts
+ * 16.1 区分完整记录与请求视图 | [CHANGED] sessions/read-session.ts
  *
  * 学习目标：先检查文件内容，再把最后一个完整、可信的状态交给恢复入口。
  * 输入：会话 UUID 与保存目录；磁盘里的 JSON 仍是未知数据，不能直接当作 SessionState。
@@ -13,6 +13,7 @@
 import { isAbsolute, join, resolve } from "node:path";
 import { UserFacingError } from "../errors.js";
 import type { Message } from "../models/client.js";
+import { validateCompaction } from "../context/compaction.js";
 import type { CheckpointReason, SessionState } from "./save-session.js";

 // [KEEP 来自 13.2] 大小限制约束一次读取的内存；本章还没有增量索引或历史压缩。
@@ -75,7 +76,7 @@
  * 队列编号、任务归属和下一编号一起检查，避免恢复后发生编号碰撞或跨任务投递。
  */
 export function validateSessionState(value: unknown): SessionState {
-  const state = objectWithKeys(value, ["messages", "mode", "tasks", "pendingInputs", "run", "nextInputId"]);
+  const state = objectWithKeys(value, ["messages", "mode", "tasks", "pendingInputs", "run", "nextInputId"], ["context"]);
   if (state.mode !== "plan" && state.mode !== "execute") throw new Error("未知模式");
   const run = integer(state.run, 0), nextInputId = integer(state.nextInputId, 1);
   if (!Array.isArray(state.messages) || !Array.isArray(state.tasks) || !Array.isArray(state.pendingInputs)) throw new Error("状态列表不是数组");
@@ -131,7 +132,9 @@
     previousId = id;
     return { id, text: content, run: owner };
   });
-  return { messages, mode: state.mode, tasks, pendingInputs, run, nextInputId };
+  // [NEW 16.1] 恢复时再次核对游标是否位于完整组边界。
+  return { messages, mode: state.mode, tasks, pendingInputs, run, nextInputId,
+    ...(state.context === undefined ? {} : { context: validateCompaction(state.context, messages) }) };
 }

 /**
@@ -201,7 +204,7 @@
         name = validateSessionName(record.name);
       } else {
         objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "reason", "state"]);
-        // [CHANGED 14.3] 文件恢复通知不倒退消息历史，也不标记新的模型任务。
+        // [KEEP 来自 14.3] 文件恢复通知不倒退消息历史，也不标记新的模型任务。
         if (record.type !== "checkpoint" || !["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(record.reason as string)) throw new Error("未知检查点类型");
         const nextState = validateSessionState(record.state);
         if (state && (nextState.run < state.run || nextState.nextInputId < state.nextInputId)) throw new Error("会话计数不能倒退");
```

</details>

### 5. 完整历史与已采用压缩状态一起写入会话检查点

在上一节的 `src/sessions/save-session.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/sessions/save-session.ts（CHANGED）</summary>

<!-- source: src/sessions/save-session.ts -->
```diff
--- a/src/sessions/save-session.ts
+++ b/src/sessions/save-session.ts
@@ -1,5 +1,5 @@
 /**
- * 14.3 查看与恢复文件 | [CHANGED] sessions/save-session.ts
+ * 16.1 区分完整记录与请求视图 | [CHANGED] sessions/save-session.ts
  *
  * 学习目标：把内存会话保存成版本明确、可逐行查看的 JSONL 检查点。
  * 输入：会话目录、模型消息、模式、清单和未交付补充；不接收模型连接配置或授权。
@@ -18,6 +18,7 @@
  * 恢复只提供数据，不重放历史工具，不恢复授权，不声称撤销过往文件操作。
  * sync 是本次保存的完成边界，不承诺异常断电或设备故障下绝对恢复。
  */
+import type { CompactionState } from "../context/compaction.js";
 import { randomUUID } from "node:crypto";
 import { constants } from "node:fs";
 import { lstat, mkdir, open, realpath, unlink, type FileHandle } from "node:fs/promises";
@@ -28,9 +29,11 @@
 import { DEFAULT_SESSION_DIRECTORY, MAX_SESSION_BYTES, readSession, sessionPath, validateSessionName, validateSessionState, type ReadSessionResult } from "./read-session.js";

 // [KEEP 来自 13.1] 本文件以下实现均为本节新增。
-// [CHANGED 14.3] 文件恢复后的通知也以明确原因保存。
+// [KEEP 来自 14.3] 文件恢复后的通知也以明确原因保存。
 export type CheckpointReason = "run_start" | "run_end" | "reset" | "mode" | "queue_change" | "exit" | "file_restore";
 export type SessionState = {
+  // [NEW 16.1] 可选字段兼容旧检查点，完整 messages 不被摘要替代。
+  context?: CompactionState;
   messages: readonly Message[];
   mode: ExecutionMode;
   tasks: readonly TaskItem[];
@@ -82,6 +85,7 @@
     pendingInputs: state.pendingInputs.map((entry) => ({ id: entry.id, text: entry.text, run: entry.run })),
     run: state.run,
     nextInputId: state.nextInputId,
+    ...(state.context ? { context: { summary: state.context.summary, through: state.context.through } } : {}),
   };
 }

@@ -232,7 +236,7 @@
      * state 是当前会话白名单，reason 说明本次保存触发点；成功返回递增 seq。
      * 同一文件上不并发写入；任一写盘失败后，后续调用继续拒绝而不拼接潜在坏尾。
      */
-    // [CHANGED 14.3] 同一序列保存文件恢复后的对话通知。
+    // [KEEP 来自 14.3] 同一序列保存文件恢复后的对话通知。
     save(state, reason) {
       try {
         if (!["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(reason)) throw new UserFacingError("不支持这个保存原因。");
```

</details>

### 6. 恢复并复用同一份压缩状态，重置时一起清空

在上一节的 `src/ui/terminal.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/terminal.ts（CHANGED）</summary>

<!-- source: src/ui/terminal.ts -->
```diff
--- a/src/ui/terminal.ts
+++ b/src/ui/terminal.ts
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] ui/terminal.ts
+ * 16.1 区分完整记录与请求视图 | [CHANGED] ui/terminal.ts
  *
  * 学习目标：分别显示请求前的本地预算、响应后的服务用量和会话保存结果，不把估算当成实际计费。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -34,6 +34,7 @@
 import { createLineReader } from "./input.js";
 // [KEEP 来自 09.1] 整轮通知由 runAgent 包装，Agent Loop 的决策逻辑沿用。
 // [KEEP 来自 09.2] 终端通过异步迭代接收同一轮的结构化事件。
+import { emptyCompaction } from "../context/compaction.js";
 import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
 import type { AgentEvent } from "../agent/events.js";
 import { explainError, UserFacingError } from "../errors.js";
@@ -246,6 +247,8 @@
 export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
+  // [NEW 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
+  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
   let mode = options.mode ?? initial?.mode ?? "execute";
   // [KEEP 来自 12.2] 持续会话复用清单，下一轮与模式切换不重建。
   const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
@@ -253,7 +256,7 @@
   let run = initial?.run ?? 0;
   const pendingInputs = structuredClone([...(initial?.pendingInputs ?? [])]);
   const nextInputId = initial?.nextInputId ?? 1;
-  const snapshot = (): SessionState => ({ messages: history, mode, tasks: tasks.items, pendingInputs, run, nextInputId });
+  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs, run, nextInputId });
   /**
    * 在明确触发点保存当前文本会话，并单独报告存储结果。
    * 失败设 exitCode=1 并保留 history 与 tasks；下一轮必须先成功保存 run_start 才能请求模型。
@@ -319,6 +322,7 @@
       if (handlePermissionCommand(text, sessionGrants)) continue;
       if (text === "/reset") {
         history.length = 0;
+        Object.assign(context, emptyCompaction());
         console.error("已清空当前对话，下次提问将开始新的上下文。");
         // [KEEP 来自 13.1] reset 只清模型历史，保存后的清单与授权规则各自不变。
         await checkpoint("reset");
@@ -344,7 +348,7 @@
         // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
         const reply = await showRun(streamAgentRun(model, history, text, active.signal,
           // [KEEP 来自 12.2] 每轮固定模式，并把共用清单传到核心。
-          requestApproval, sessionGrants, { ...options, mode, tasks, askUser }), renderer);
+          requestApproval, sessionGrants, { ...options, context, mode, tasks, askUser }), renderer);
         renderer.reply(reply);
         // [KEEP 来自 13.1] 整个会话退出已设置 SIGTERM/SIGHUP 退出码时，不由本轮覆写。
         if (!exiting) process.exitCode = 0;
@@ -395,9 +399,11 @@
 export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 历史只成为新请求的上下文，旧工具不会从这里再次调度。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
+  // [NEW 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
+  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
   const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
   const mode = options.mode ?? initial?.mode ?? "execute";
-  const snapshot = (): SessionState => ({ messages: history, mode, tasks: tasks.items, pendingInputs: initial?.pendingInputs ?? [], run: (initial?.run ?? 0) + 1, nextInputId: initial?.nextInputId ?? 1 });
+  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs: initial?.pendingInputs ?? [], run: (initial?.run ?? 0) + 1, nextInputId: initial?.nextInputId ?? 1 });
   const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
   const input = interactive
     ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
@@ -431,7 +437,7 @@
     // [KEEP 来自 13.1] 保留真实 Message[]，不从 stdout 或 AgentRecord 重建上下文。
     const reply = await showRun(streamAgentRun(model, history, prompt, signal,
       // [KEEP 来自 12.3] 单次文本任务也可等待澄清；非交互环境没有问答入口。
-      createApprovalHandler(lines, interactive), new Set<string>(), { ...options, mode, tasks, askUser: options.askUser ?? createQuestionHandler(lines, interactive) }), renderer);
+      createApprovalHandler(lines, interactive), new Set<string>(), { ...options, context, mode, tasks, askUser: options.askUser ?? createQuestionHandler(lines, interactive) }), renderer);
     if (!controller.signal.aborted) renderer.reply(reply);
   } catch (error) {
     if (!controller.signal.aborted) throw error;
@@ -463,7 +469,7 @@
 // [KEEP 来自 09.3] 正文写入 stdout，用量与提示写入 stderr。
 export function printReply(reply: Reply, showText = true): void {
   if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
-  // [CHANGED 15.1] 显示服务商报告的本轮累计；缺失仍写未知，不用本地估算填补。
+  // [KEEP 来自 15.1] 显示服务商报告的本轮累计；缺失仍写未知，不用本地估算填补。
   console.error(`服务商报告本轮累计：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
   if (reply.truncated) console.error("提示：回答达到输出上限，可能尚未完整。");
 }
```

</details>

### 7. 让TUI会话复用压缩状态，恢复、保存与重置保持一致

在上一节的 `src/ui/tui/app.tsx` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/app.tsx（CHANGED）</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] ui/tui/app.tsx
+ * 16.1 区分完整记录与请求视图 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：在任务和保存状态之外单独显示本地预算，让输入估算与服务商用量各有明确来源。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -25,8 +25,8 @@
  *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；正在编辑队列时暂不切换
  *   [KEEP 来自 12.5] 队列 -> e 编辑 / x 撤回 -> 固定 ID 查找；已收取 -> 编辑稿留存
  *                    空闲 Enter -> 再查 ID -> 移出队列 -> 作为新任务发送
- *   [NEW 15.1] context_budget -> 独立预算行；model_usage -> 历史状态，缺失用量显示未知
- *   [NEW 15.1] 预算多占一行 -> 历史 / 队列视口减一行；16 行时隐藏任务摘要保住草稿
+ *   [KEEP 来自 15.1] context_budget -> 独立预算行；model_usage -> 历史状态，缺失用量显示未知
+ *   [KEEP 来自 15.1] 预算多占一行 -> 历史 / 队列视口减一行；16 行时隐藏任务摘要保住草稿
  *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
  *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
  *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑
@@ -57,6 +57,7 @@
 import type { Message, Model } from "../../models/client.js";
 import { streamAgentRun } from "../../agent/run-stream.js";
 import { explainError } from "../../errors.js";
+import { emptyCompaction, type CompactionState } from "../../context/compaction.js";
 import type { ExecutionMode, TaskState } from "../../agent/run-options.js";
 // [KEEP 来自 13.1] 模型消息与未交付补充分开投影，授权和显示状态不进入文件。
 import { saveSessionCheckpoint, type SessionWriter, type CheckpointReason, type SaveFeedback, type SessionState } from "../../sessions/save-session.js";
@@ -70,6 +71,8 @@
  * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
  */
 type Session = {
+  // [NEW 16.1] 摘要视图独立于完整历史，组件重绘不会重建。
+  context: CompactionState;
   // [KEEP 来自 12.1] 会话模式供下一轮启动取快照。
   mode: ExecutionMode;
   // [KEEP 来自 12.2] 会话清单独立于单轮控制器。
@@ -106,7 +109,7 @@
 async function checkpointTui(session: Session, reason: CheckpointReason): Promise<SaveFeedback | undefined> {
   const request = ++session.saveRequest;
   const feedback = await saveSessionCheckpoint(session.writer, {
-    messages: session.history, mode: session.mode, tasks: session.tasks.items,
+    messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items,
     pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId,
   }, reason);
   if (feedback && request === session.saveRequest) session.saveMessage = feedback.message;
@@ -298,7 +301,8 @@
       return;
     }
     // [KEEP 来自 13.1] 清空后的模型历史进入检查点；授权不写入文件。
-    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); void checkpoint("reset"); return; }
+    if (prompt === "/reset") { session.history.length = 0;
+      Object.assign(session.context, emptyCompaction()); append("本地", "对话历史已清空；会话授权保留。"); void checkpoint("reset"); return; }
     if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
     if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
     // [KEEP 来自 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
@@ -362,7 +366,7 @@

     // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
     // [KEEP 来自 14.2] 本轮获批准的写入使用当前会话文件检查点。
-    const options = { fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
+    const options = { context: session.context, fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
       // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
       askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
         if (!session.closing) setQuestion(pending);
@@ -377,7 +381,7 @@
       let current = emptyRunView();
       try {
         // [KEEP 来自 13.3] 先记下本轮开始前的状态；失败则停止，不调用模型。
-        await session.writer?.save({ messages: session.history, mode: session.mode, tasks: session.tasks.items, pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId }, "run_start");
+        await session.writer?.save({ messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items, pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId }, "run_start");
         controller.signal.throwIfAborted();
         for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
           if (!session.closing) setApproval(pending);
@@ -433,7 +437,7 @@
   // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。

   // [KEEP 来自 12.2] 按窗口显示摘要和至多三项，不丢弃真实清单。
-  // [NEW 15.1] 最小 16 行已占满；暂隐清单摘要，实际任务数据仍留在会话中。
+  // [KEEP 来自 15.1] 最小 16 行已占满；暂隐清单摘要，实际任务数据仍留在会话中。
   const taskLines = session.tasks.items.length === 0 || rows < 17 ? 0 : 1 + (rows >= 20 ? Math.min(3, session.tasks.items.length, rows - 18) : 0);
   const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
   // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
@@ -461,7 +465,7 @@
       </Box>
       <Text wrap="truncate">模式：{session.mode} · 状态：{view.status} · 待发送补充：{session.queue.items.length}</Text>
       {/* [KEEP 来自 13.1] 存储反馈不是 run_finish，不改模型任务状态。 */}
-      {/* [NEW 15.1] 预算独占一行，历史和队列视口相应减少一行。 */}
+      {/* [KEEP 来自 15.1] 预算独占一行，历史和队列视口相应减少一行。 */}
       <Text wrap="truncate">{view.budget || "本地预算：等待请求估算；不是服务商实际用量"}</Text>
       <Text wrap="truncate">保存：{saveMessage}</Text>
       <Box borderStyle="round" flexDirection="column" paddingX={1}>
@@ -488,7 +492,7 @@
   // [KEEP 来自 13.3] 深拷贝可信快照，编号接着走；新一轮不能收取旧 run 的补充。
   const history = structuredClone([...(initial?.messages ?? [])]);
   const queue = initial ? { items: structuredClone([...initial.pendingInputs]), nextId: initial.nextInputId } : newInputQueue();
-  const session: Session = { mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, fileCommand: createFileCheckpointCommands(fileCheckpoints), saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
+  const session: Session = { context: structuredClone(initial?.context ?? emptyCompaction()), mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, fileCommand: createFileCheckpointCommands(fileCheckpoints), saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
   let instance: ReturnType<typeof render> | undefined;
   // [KEEP 来自 13.1] 退出 Promise 只创建一次；保存和关闭都结束才恢复终端。
   let shutdown: Promise<void> | undefined;
```

</details>
<!-- generated:build:end -->

## 运行验证

先在仓库根目录编译并注册本节。

```bash
npm run lesson:16.1
```

然后进入加法演示工作区，正常开始或恢复会话。

```bash
hello-my-agent
```

这一节尚未自动生成摘要，普通对话的超限行为仍与 15.3 相同。选择规则用本章练习中的确定消息检查：尤其核对双调用是否成组、用户原文是否仍在、完整历史是否未被删除。没有看到压缩提示不表示构建失败。

## 本节完成后的 Agent

Agent 现在能在完整历史之外描述一份请求视图，也能保存它已经覆盖到哪里。下一节要解决的是：怎样取得一份能用的摘要，怎样判断它值得采用，以及失败时怎样保住原有材料。
