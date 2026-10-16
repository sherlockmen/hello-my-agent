# 25.2 让只读角色真正只能读取材料

[第 25 章首页](/content/chapter-25-subagents/README.md) · [上一节：25.1 子会话](/content/chapter-25-subagents/01-child-sessions/README.md) · [本章练习与答案](/content/chapter-25-subagents/EXERCISES.md)

## 问题

在子模型的提示词里写“只读检查，不要修改文件”，可以表达任务要求，却不能阻止程序执行一次 `write_file`。模型可能误解任务，也可能在读到文件内容里的指令后提出越界调用。

如果 `review` 子 Agent 仍拿到 shell、写文件、MCP 或继续委派的能力，那么“只读角色”就只是一句希望。本节需要让程序执行边界与角色承诺一致。

## 解决方案

角色由程序映射到固定的工具白名单。本章 `explore` 和 `review` 都只允许 `read_file`、`glob`、`grep`：前者侧重定位结构和入口，后者侧重依据材料报告问题。任务文字改变工作目标，不改变可用工具。

白名单应用两次：构造模型请求时只发送这些工具定义；实际执行工具时再次拒绝不在名单内的名称。父任务已有的权限规则仍然生效，子角色只收紧能力。

## 工作原理

### 一、可见工具定义告诉模型有哪些合法动作

模型根据工具定义选择动作。我们不把全部父工具发给子模型，再期望它记住“不要使用其中大部分”。子请求只带三个只读工具，模型更容易用搜索、列路径和读文件组织工作。

例如，审查任务是“检查会话恢复是否校验附件缺失”。子模型可以搜索 `missing`，读相关实现，再给出文件位置与证据。它没有修改任务，也不需要通过 shell 执行命令才能完成这一范围。

这里的 `review` 是本课程定义的角色，不是运行测试或复现所有缺陷的完整审查环境。它能确认静态材料中显示的行为；缺少运行证据时，应把判断写成待核实问题。

### 二、执行入口再次判断，防止未知调用越过限制

即使请求里没列出 `write_file`，我们也不能把模型响应视为可信命令。服务仍可能返回一个未知工具名，或返回上一轮遗留的调用。

执行前检查名字是否属于当前子角色。若不属于，程序形成工具错误结果，不执行该动作。错误沿原调用编号送回子模型，子模型下一次决策才能看到“这条路不可用”，改用已允许的读取动作或解释限制。

这比只把错误显示给人更完整：子模型本身也需要观察错误，才能停止重复提出同一动作。程序约束动作，工具结果帮助模型调整计划。

### 三、白名单只收紧，不能越过父任务限制

允许一个工具名，仍不代表任何参数都能执行。读取工具继续检查工作区路径和参数；父任务当前模式与权限规则也继续适用。

子模型不能通过委派绕开这些规则。本章不向子请求提供 `delegate_task`，也不提供 MCP、网页或写入工具。这样一条子任务不会再无限生成更深的子任务，角色范围和运行成本也更容易解释。

只读也不等于没有成本：模型请求会消耗时间和 token，读取结果会占用上下文。因此子任务仍需要步骤上限与取消。限制动作种类，不能代替限制任务的生命周期。

### 四、返回证据，使父模型有机会核对

子模型最终文本可能写着“没有问题”，但父模型不能只看这句话。程序从成功的本地工具元数据收集最多 32 条证据：`read` 表示实际读取的路径和行范围，`match` 表示搜索命中的行，`listed` 只表示列路径时发现过该文件。列出一个文件不等于读过正文；最终文本自行提及一个路径，也不会给证据列表增加记录。返回结果让父模型知道子任务检查过哪些位置、最终是否正常结束。

本地证据证明某个工具得到过某份结果，不自动证明子模型结论正确。父模型需要结合原任务核对：路径是否相关，引用是否支持结论，有没有缺少关键文件。范围过窄时，可以继续读取或重新委派。

把权限限制与证据返回放在一起，得到的才是可使用的角色：它做得到承诺范围内的读取，也不能把“我检查过”当成不需要依据的完成信号。

<!-- media:lesson:start -->
下面让 review 子模型先提出越界写入，再看错误如何回到它的下一次请求。之后真实读取形成的本地证据，与最终文字自称检查过的路径并排显示：模型文字不能给自己增加证据。

<img src="./content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-cover-21ce14d2c8.png" data-gif-src="./content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-8baf6f33e8.gif" data-cover="./content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-cover-21ce14d2c8.png" data-no-zoom alt="只读角色怎样在真正执行前拒绝越界工具？">

[静态流程图](/content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-flow-1742dd26f0.png.md) · [静态封面](/content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-cover-21ce14d2c8.png.md) · [查看完整静态分镜](/content/chapter-25-subagents/02-readonly-roles/assets/child-readonly-evidence-storyboard-4a8b2513ca.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/subagents/runner.ts](/content/chapter-25-subagents/02-readonly-roles/src/subagents/runner.ts.md) | 从成功本地工具元数据收集有界证据，保留未知用量。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-25-subagents/02-readonly-roles/src/agent/agent-loop.ts.md) | 在已有白名单执行边界上校准子任务结果和观察。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 25.1 的完整 `src/` 继续。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线，不需要复制仓库内最终快照覆盖自己的实现。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/subagents/runner.ts 的精确差异</summary>

<!-- source: src/subagents/runner.ts -->
```diff
--- a/src/subagents/runner.ts
+++ b/src/subagents/runner.ts
@@ -1,5 +1,5 @@
 /**
- * 25.1 独立子会话 | [NEW] subagents/runner.ts
+ * 25.2 只读角色与结果 | [CHANGED] subagents/runner.ts
  *
  * 学习目标：用相同循环创建独立子会话，父任务等待结构化结果再继续。
  * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
@@ -16,11 +16,11 @@
 import { DEFAULT_CONTEXT_LIMITS, estimateContext } from "../context/budget.js";
 import { ToolError, UserFacingError } from "../errors.js";
 
-// [NEW 25.1] 建立独立历史与子会话，复用循环并收集结构化终态。
 export const CHILD_TOOLS = ["read_file", "glob", "grep"] as const;
 export type ChildRole = "explore" | "review";
 export type ChildStatus = "completed" | "failed" | "cancelled" | "budget_exhausted";
-export type ChildEvidence = { path: string; startLine?: number; endLine?: number };
+// [CHANGED 25.2] 从成功本地工具元数据收集有界证据，保留未知用量。
+export type ChildEvidence = { kind: "read" | "match" | "listed"; path: string; startLine?: number; endLine?: number };
 export type ChildResult = { sessionId: string; parentSessionId: string; role: ChildRole; status: ChildStatus; summary: string; evidence: ChildEvidence[]; usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; cacheWriteTokens: number | null }; modelCalls: number; requestTokensReserved: number; error?: string };
 export type ChildOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver; depth?: number; maxModelCalls?: number; requestTokenBudget?: number };
 
@@ -72,10 +72,12 @@
   const history: Message[] = [], metrics = { calls: 0, responses: 0, reserved: 0 };
   const result: ChildResult = { sessionId: randomUUID(), parentSessionId, role, status: "failed", summary: "", evidence: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }, modelCalls: 0, requestTokensReserved: 0 };
   let writer: SessionWriter | undefined;
+  let usageReports = 0;
   const maxCalls = Math.min(4, Math.max(1, Math.floor(Number.isFinite(options.maxModelCalls) ? options.maxModelCalls! : 4)));
   const tokenBudget = Math.min(32_768, Math.max(1, Math.floor(Number.isFinite(options.requestTokenBudget) ? options.requestTokenBudget! : 32_768)));
   const observe: AgentObserver = event => {
-    if (event.type === "model_usage") result.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens ?? null, cacheWriteTokens: event.cacheWriteTokens ?? null };
+    if (event.type === "model_usage") { usageReports++; result.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens ?? null, cacheWriteTokens: event.cacheWriteTokens ?? null }; }
+    collectEvidence(result.evidence, event);
     options.observer?.(event);
   };
   try {
@@ -86,11 +88,12 @@
     const reply = await agentLoop(childModel(model, role, maxCalls, tokenBudget, metrics), history, task, signal, observe, options.requestApproval, new Set(), { mode: "plan", allowedTools: [...CHILD_TOOLS], childDepth: 1, maxModelCalls: maxCalls });
     result.status = "completed"; result.summary = reply.text;
   } catch (error) {
-    result.status = signal.aborted ? "cancelled" : error instanceof ChildBudgetError || metrics.calls >= maxCalls ? "budget_exhausted" : "failed";
+    result.status = signal.aborted ? "cancelled" : error instanceof ChildBudgetError ? "budget_exhausted" : "failed";
     result.error = signal.aborted ? "父任务取消，子任务已停止。" : error instanceof UserFacingError || error instanceof ToolError ? error.message : "子任务未取得完整结果。";
   } finally {
     // 请求发出而未取得完整响应时用量未知；本地清理事件或初始零不能证明没有消耗。
     if (metrics.responses < metrics.calls) result.usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null };
+    if (usageReports < metrics.calls) result.usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null };
     result.modelCalls = metrics.calls; result.requestTokensReserved = metrics.reserved;
     if (writer) {
       try { await writer.save({ messages: history, mode: "plan", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_end"); }
@@ -100,3 +103,24 @@
   }
   return result;
 }
+
+/**
+ * 证据只取成功只读工具的本地 metadata；模型最终文字不能自行添加路径或行号。
+ * read 区分实际读取范围，match 区分搜索命中，listed 仅说明目录枚举发现；有界去重后返回父任务。
+ */
+function collectEvidence(evidence: ChildEvidence[], event: import("../agent/events.js").AgentEvent): void {
+  if (event.type !== "tool_finish" || event.outcome !== "success" || event.result.isError) return;
+  const metadata = event.result.metadata;
+  const candidates: ChildEvidence[] = [];
+  if (metadata.kind === "read_file" && "startLine" in metadata) {
+    const args = JSON.parse(event.call.arguments) as { path: string };
+    candidates.push({ kind: "read", path: args.path.trim(), startLine: metadata.startLine, endLine: metadata.endLine });
+  } else if (metadata.kind === "grep") {
+    candidates.push(...metadata.locations.map(item => ({ kind: "match" as const, path: item.path, startLine: item.line, endLine: item.line })));
+  } else if (metadata.kind === "glob") candidates.push(...metadata.paths.map(path => ({ kind: "listed" as const, path })));
+  for (const item of candidates) {
+    if (evidence.length >= 32) break;
+    if (!item.path || item.path.startsWith("/") || item.path.split(/[\\/]/).includes("..")) continue;
+    if (!evidence.some(old => JSON.stringify(old) === JSON.stringify(item))) evidence.push(item);
+  }
+}
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,5 +1,5 @@
 /**
- * 25.1 独立子会话 | [CHANGED] agent/agent-loop.ts
+ * 25.2 只读角色与结果 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -109,7 +109,7 @@
 // [KEEP 来自 21.1] 每次调用重新检查当前定义是否可用。
 // [KEEP 来自 22.1] 网页也使用同一条审批与原调用结果通道。
 import { randomUUID } from "node:crypto";
-import { runSubagent } from "../subagents/runner.js";
+import { ChildBudgetError, runSubagent } from "../subagents/runner.js";
 import { webDefinitions, citationFeedback } from "../web/client.js";
 import { mcpDefinitions } from "../mcp/client.js";
 import { runHooks } from "../hooks/lifecycle.js";
@@ -148,7 +148,7 @@
  * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
  */
 // [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
-// [CHANGED 25.1] 顺序等待子任务，并按原工具编号把结果交给父模型。
+// [CHANGED 25.2] 在已有白名单执行边界上校准子任务结果和观察。
 export async function agentLoop(
   model: Model,
   history: Message[],
@@ -417,6 +417,12 @@
           let result = prepared
             ? await executePreparedTool(prepared, signal, toolOptions)
             : await executeTool(call, signal, toolOptions);
+          if (result.metadata.kind === "subagent") {
+            const childUsage = result.metadata.result.usage;
+            inputTokens = addUsage(inputTokens, childUsage.inputTokens); outputTokens = addUsage(outputTokens, childUsage.outputTokens);
+            cachedInputTokens = addUsage(cachedInputTokens, childUsage.cachedInputTokens); cacheWriteTokens = addUsage(cacheWriteTokens, childUsage.cacheWriteTokens);
+            emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
+          }
           if (result.metadata.kind === "subagent" && signal.aborted) {
             turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: true });
             executingCallId = undefined;
@@ -481,6 +487,7 @@
       }
     }
 
+    if (options.childDepth) throw new ChildBudgetError("子任务已用尽模型决策次数，尚未得到完整最终回答。");
     throw new UserFacingError(`Agent 连续请求模型 ${maxModelCalls} 次仍未得到最终回答，已停止本轮。`);
   } catch (error) {
     // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:25.2
```

再按照 [本章完整答案](/content/chapter-25-subagents/EXERCISES.md?id=%E6%9E%84%E5%BB%BA%E4%B8%8E%E8%BF%90%E8%A1%8C) 的“单独编译练习”步骤，准备 `SUBAGENT_EXERCISE`。本节只运行第 2 组，运行命令与上面的构建命令分开：

```bash
node "$SUBAGENT_EXERCISE/verify-subagents.js" 2
```

输出“通过二”说明越界写入成为子工具错误，磁盘没有新文件；真实读取形成 read 证据，最终文字编造的路径没有进入证据。只看到模型说“只读”不足以支持这些结论。

## 本节完成后的 Agent

现在，只读角色在工具定义和执行入口都受到约束，结果带回真实本地证据。下一节把同一子任务的活动与终态显示出来，并核对取消后的本地收尾。

本节状态：待用户确认。
