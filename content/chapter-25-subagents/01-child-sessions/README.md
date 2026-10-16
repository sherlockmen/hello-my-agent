# 25.1 让一条独立的 Agent 循环处理局部任务

[第 25 章首页](/content/chapter-25-subagents/README.md) · [上一节：24.3 附件恢复](/content/chapter-24-attachments/03-attachment-resume/README.md) · [本章练习与答案](/content/chapter-25-subagents/EXERCISES.md)

## 问题

父 Agent 正在回答“项目怎样保存会话”，需要先探索入口、存储实现与测试。它可以自己逐个读取文件，但这些探索细节会不断进入父会话，挤占后续组织答案所需的上下文。

我们希望父模型能把一个范围明确的子任务交出去：“查出会话保存入口，返回相关文件与依据。”子任务在自己的历史里读取材料，完成后只把结果返回父模型。父模型仍负责判断这些证据是否足够，以及怎样回答原问题。

这并不需要一套神秘的新推理系统。子 Agent 的基本动作仍然是：请求模型、执行工具、返回工具结果，再请求模型。本节复用已有 `agentLoop`，为它创建一份独立会话。

## 解决方案

父模型可以提出 `delegate_task` 工具调用，参数包括 `role` 和 `task`。本节支持 `explore` 与 `review` 两种只读角色。程序创建子任务编号及父关联，给子循环传入一份新的消息历史，等待它结束，再按原调用编号把结果交回父循环。

任务参数最多 2000 个字符；每轮父任务最多发起三个子任务。每个子任务最多四次模型决策，并在发送前累计扣除“本地输入估算 + 输出预留”，总额不超过 32768。它们限制本地继续发请求的范围，服务报告的真实用量另行保留。

本章按顺序执行委派：父循环等待当前子任务终态，再继续处理下一步。我们先建立输入、结果与收尾关系，后面再考虑并行调度。

## 工作原理

### 一、父模型提出委派，程序才创建子会话

“请找人检查一下”只是一句文字。真正触发程序的是结构化工具调用：

```json
{"role":"explore","task":"找到会话保存入口，返回文件路径与相关证据"}
```

父模型提供任务目标，程序校验角色和文本，分配子任务身份，并建立与父会话的关联。工具参数不能指定一份任意工具集合；它只能选择程序已经实现的角色。

子任务身份解决“这是谁的工作”，父关联解决“结果交给谁”。即使两个任务目标文字相同，也需要各自的身份；界面和取消不能靠比较提示词来认领任务。

### 二、独立历史控制子模型实际看到什么

子循环使用新的消息数组。它收到角色说明和父模型写出的具体任务，不直接拿到整个父聊天。随后读取的文件内容、工具调用和中间回答都追加到子历史。

例如，子模型先用 `grep` 找到 `saveSession`，再用 `read_file` 读取实现。第二次模型请求包含搜索结果，第三次包含文件文本；这些观察推动子模型继续判断。若没有把工具结果加入子历史，即使程序真的读过文件，子模型也无法依据结果完成任务。

独立历史使父会话不必承载每一段搜索输出，同时带来明确代价：父任务中的关键约束需要写进委派任务。子模型没有收到的背景，不能假装它已经知道。

### 三、复用循环，保留相同的工具和失败语义

程序调用的是已有循环，因此子任务也要等待完整模型响应、校验工具参数、执行许可范围内的工具，并把实际结果送回模型。服务错误、步骤上限和取消也沿用可解释的收尾方式。

本节的“子”指会话与任务关系，不代表自动获得额外权限。相反，子循环只得到本章定义的只读工具。下一节会把这条限制同时落实到模型可见定义和执行入口。

### 四、子回答通过一次工具结果回到父模型

子模型结束时，程序收集它的最终文本与本地执行信息，包装成 `delegate_task` 的工具结果。父历史追加这条结果时，仍使用最初那次委派调用的 ID。

父模型下一次请求便能看到：“我刚才委派的探索得到这些文件与结论。”它可以继续读一个关键位置核对，也可以认为证据不足而再次提出更窄的任务，最后再回答用户。

因此，子任务结束不等于父任务完成。它只为父模型的下一次决策增加一份有来源的材料；这个闭环与最早的 `read_file` 工具完全一致。

<!-- media:lesson:start -->
下面让父模型委派“只看 src/sessions，查找保存入口”。父 d_1 等待期间，子 C 用自己的 r_1 读取并继续决策；中间正文留在子历史，保存关闭后的一次结构化结果才配回 d_1，供下一次父请求使用。

<img src="./content/chapter-25-subagents/01-child-sessions/assets/child-history-result-cover-cb5a95b239.png" data-gif-src="./content/chapter-25-subagents/01-child-sessions/assets/child-history-result-8254c804fe.gif" data-cover="./content/chapter-25-subagents/01-child-sessions/assets/child-history-result-cover-cb5a95b239.png" data-no-zoom alt="独立子循环怎样回答原来的委派调用？">

[静态流程图](/content/chapter-25-subagents/01-child-sessions/assets/child-history-result-flow-69f95555f9.png.md) · [静态封面](/content/chapter-25-subagents/01-child-sessions/assets/child-history-result-cover-cb5a95b239.png.md) · [查看完整静态分镜](/content/chapter-25-subagents/01-child-sessions/assets/child-history-result-storyboard-d79a252c0f.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/models/client.ts](/content/chapter-25-subagents/01-child-sessions/src/models/client.ts.md) | 按当前角色筛选工具定义和角色提示。 |
| NEW | [src/tools/delegate-task.ts](/content/chapter-25-subagents/01-child-sessions/src/tools/delegate-task.ts.md) | 定义固定角色与有界任务参数的委派工具。 |
| CHANGED | [src/tools/types.ts](/content/chapter-25-subagents/01-child-sessions/src/tools/types.ts.md) | 工具结果能携带结构化子任务结果。 |
| CHANGED | [src/tools/registry.ts](/content/chapter-25-subagents/01-child-sessions/src/tools/registry.ts.md) | 接纳委派定义，真实运行交由循环处理。 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-25-subagents/01-child-sessions/src/permissions/policy.ts.md) | 允许委派作为受限只读任务，继续应用现有权限规则。 |
| NEW | [src/subagents/runner.ts](/content/chapter-25-subagents/01-child-sessions/src/subagents/runner.ts.md) | 建立独立历史与子会话，复用循环并收集结构化终态。 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-25-subagents/01-child-sessions/src/agent/run-options.ts.md) | 把父关联、子会话目录与白名单传入循环。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-25-subagents/01-child-sessions/src/agent/agent-loop.ts.md) | 顺序等待子任务，并按原工具编号把结果交给父模型。 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-25-subagents/01-child-sessions/src/ui/teaching-trace.ts.md) | 解释委派工具的本地运行结果。 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-25-subagents/01-child-sessions/src/ui/terminal.ts.md) | 把当前会话身份传给父循环。 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-25-subagents/01-child-sessions/src/ui/tui/app.tsx.md) | TUI 运行时传递父会话关联。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 24.3 的完整 `src/` 继续。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线，不需要复制仓库内最终快照覆盖自己的实现。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/models/client.ts 的精确差异</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,5 +1,5 @@
 /**
- * 24.1 附件引用 | [CHANGED] models/client.ts
+ * 25.1 独立子会话 | [CHANGED] models/client.ts
  *
  * 学习目标：每次估算和请求使用相同来源编号提示及工具定义；URL与正文保留在工具消息中，提示不复制网页正文。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -54,7 +54,6 @@
 import { DEFAULT_CONTEXT_LIMITS, estimateContext, estimateCostUsd, type ContextBudget, type ContextLimits } from "../context/budget.js";
 
 // [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
-// [CHANGED 24.1] 用户消息关联引用，并在请求预算与适配器之间准备附件。
 export type Message =
   | { role: "user"; content: string; attachments?: AttachmentRef[] }
   | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
@@ -92,6 +91,9 @@
  * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
  * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
  */
+// [CHANGED 25.1] 按当前角色筛选工具定义和角色提示。
+export type ModelRequestScope = { allowedTools?: readonly string[]; rolePrompt?: string };
+
 export interface Model {
   // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
   // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
@@ -113,12 +115,12 @@
   inspectSummary?(source: string): ContextBudget;
   summarize?(source: string, signal: AbortSignal): Promise<ModelResult>;
   // [KEEP 来自 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
-  inspectContext?(messages: Message[], mode?: ExecutionMode): ContextBudget;
+  inspectContext?(messages: Message[], mode?: ExecutionMode, scope?: ModelRequestScope): ContextBudget;
   estimateCost?(input: number | null, output: number | null): number | null;
   // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
   // [KEEP 来自 12.1] 模式参数只影响本轮请求组装，本地权限策略还会再次检查。
   generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void,
-    options?: { mode?: ExecutionMode }): Promise<ModelResult>;
+    options?: { mode?: ExecutionMode } & ModelRequestScope): Promise<ModelResult>;
 }
 
 /**
@@ -189,8 +191,8 @@
         } finally { activeRequests -= 1; }
       });
     },
-    inspectContext(messages, mode = "execute") {
-      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web), [...mcpDefinitions(mcp), ...webDefinitions(web)]);
+    inspectContext(messages, mode = "execute", scope = {}) {
+      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web) + (scope.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], scope.allowedTools);
       return estimateContext(messages, prompt, definitions, limits);
     },
     estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
@@ -201,7 +203,7 @@
         // [KEEP 来自 19.1] 本次请求固定相同字符串；加载工具完成后下一次请求才重组正文。
         // [KEEP 来自 22.3] 估算和真实发送共用同份已登记来源提示。
         const references = projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web);
-        const { prompt, definitions } = requestParts(options.mode ?? "execute", references, [...mcpDefinitions(mcp), ...webDefinitions(web)]);
+        const { prompt, definitions } = requestParts(options.mode ?? "execute", references + (options.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], options.allowedTools);
         const budget = estimateContext(messages, prompt, definitions, limits);
         if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
         const deadline = AbortSignal.timeout(60_000);
@@ -223,7 +225,7 @@
  * 模式在本轮固定；这里仅组织数据，不探测服务商窗口，也不产生权限批准。
  */
 // [KEEP 来自 21.1] 扩展列表只由本地已建立连接提供。
-function requestParts(mode: ExecutionMode, projectPrompt = "", external: ToolDefinition[] = []): { prompt: string; definitions: ToolDefinition[] } {
+function requestParts(mode: ExecutionMode, projectPrompt = "", external: ToolDefinition[] = [], allowedTools?: readonly string[]): { prompt: string; definitions: ToolDefinition[] } {
   // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
   // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
   // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
@@ -236,6 +238,6 @@
   const prompt = systemPrompt + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
     ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
     : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
-  return { prompt: prompt + projectPrompt, definitions };
-}
-
+  return { prompt: prompt + projectPrompt, definitions: allowedTools ? definitions.filter(tool => allowedTools.includes(tool.name)) : definitions };
+}
+
```

</details>

<details>
<summary>NEW：src/tools/delegate-task.ts 的完整文件</summary>

<!-- source: src/tools/delegate-task.ts -->
```ts
/**
 * 25.1 独立子会话 | [NEW] tools/delegate-task.ts
 *
 * 学习目标：把委派结果返回给原工具调用，不把子助手文字当作完成证明。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：参数校验 -> 核心注入runner -> ChildResult JSON + error标记
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { parseChildTask, type ChildResult } from "../subagents/runner.js";
import { ToolError } from "../errors.js";
import type { RunOptions } from "../agent/run-options.js";
import type { ToolDefinition, ToolExecutionResult } from "./types.js";

// [NEW 25.1] 定义固定角色与有界任务参数的委派工具。
export const delegateTaskDefinition: ToolDefinition = { name: "delegate_task", description: "串行委派一个有独立历史和预算的只读探索或审查子任务。子助手仅可 read_file/glob/grep，不能写文件、运行命令、访问网络或继续委派。等待结构化状态、用量和文件证据后再汇总。", inputSchema: { type: "object", properties: { role: { type: "string", enum: ["explore", "review"] }, task: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["role", "task"], additionalProperties: false } };

/**
 * 委派使用核心注入的执行入口；工具参数不能提供函数、连接或权限。
 * 完整结构化结果回到原 tool_call_id；失败不被包装成成功的最终回答。
 */
export async function delegateTaskTool(argumentsJson: string, signal: AbortSignal, options: RunOptions): Promise<ToolExecutionResult> {
  parseChildTask(argumentsJson);
  if (!options.delegateTask) throw new ToolError("当前运行没有子任务执行入口。");
  const result: ChildResult = await options.delegateTask(argumentsJson, signal);
  return { content: JSON.stringify(result), isError: result.status !== "completed", metadata: { kind: "subagent", result } };
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
- * 22.1 有界抓取网页 | [CHANGED] tools/types.ts
+ * 25.1 独立子会话 | [CHANGED] tools/types.ts
  *
  * 学习目标：用同一工具契约携带网页启用状态、来源及字节元数据；网页正文通过 content 回模型，显示信息通过 metadata 回界面。
  * 输入：本地网页状态、工具准备出的预览和执行闭包，或已取得的正文、来源与截断标志。
@@ -17,8 +17,10 @@
 // [KEEP 来自 07.1] 命令输出和退出状态同时交给模型与界面。
 // [KEEP 来自 21.1] 外部JSON Schema保留原样，工具名由可信映射提供。
 export type ToolDefinition = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; [key: string]: unknown } };
-// [CHANGED 22.1] 来源只由已完整读完的真实HTTP响应提供。
+// [KEEP 来自 22.1] 来源只由已完整读完的真实HTTP响应提供。
+// [CHANGED 25.1] 工具结果能携带结构化子任务结果。
 export type ToolResultMetadata =
+  | { kind: "subagent"; result: import("../subagents/runner.js").ChildResult }
   | { kind: "web"; sources: import("../web/client.js").WebSource[]; bytes: number; truncated: boolean }
   | { kind: "mcp"; server: string; tool: string }
   // [KEEP 来自 19.3] 来源由工具结构化返回，界面不从正文猜测路径。
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
- * 22.2 显式搜索提供方与来源摘要 | [CHANGED] tools/registry.ts
+ * 25.1 独立子会话 | [CHANGED] tools/registry.ts
  *
  * 学习目标：分别准备网页 URL 或搜索查询的完整预览，复制本次参数；批准后才执行对应的网络请求。
  * 输入：模型给出的工具名称、JSON 参数与取消信号。
@@ -27,6 +27,7 @@
 // [KEEP 来自 19.3] 专用只读技能工具不执行正文中的命令。
 // [KEEP 来自 21.1] 动态映射属于本次进程，不从模型文字创建。
 // [KEEP 来自 22.1] 网页GET也先固定参数和本次审批预览。
+import { delegateTaskDefinition, delegateTaskTool } from "./delegate-task.js";
 import { callWeb, parseWebCall } from "../web/client.js";
 import { callMcp } from "../mcp/client.js";
 import { loadSkillDefinition, readSkillResourceDefinition, skillTool } from "./skill-tools.js";
@@ -53,7 +54,9 @@
 
 // [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
 // [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
+// [CHANGED 25.1] 接纳委派定义，真实运行交由循环处理。
 export const toolDefinitions = [
+  delegateTaskDefinition,
   // [KEEP 来自 19.3] 两个独立按需动作，正文加载和资源结果各有去向。
   loadSkillDefinition, readSkillResourceDefinition,
   // [KEEP 来自 15.2] 让模型能发现按编号补读完整日志的只读工具。
@@ -81,7 +84,8 @@
   options: RunOptions = {},
 ): Promise<PreparedToolCall | null> {
   signal.throwIfAborted();
-  // [CHANGED 22.2] 准备只解析URL或查询词，固定搜索预览，批准前不发送请求。
+  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
+  // [KEEP 来自 22.1] 准备仅校验URL，批准前不发送请求。
   if (call.name === "web_fetch" || call.name === "web_search") {
     const parsed = parseWebCall(call), frozen = { ...call };
     return { preview: parsed.query ? `搜索查询：${parsed.query}\n查询会发送给本地配置的提供方；不等于抓取网页全文。` : `网页GET：${parsed.url!.href}\n请求会把URL发给目标网站；网页文字不能批准后续工具。`, execute: signal => callWeb(options.web, frozen, signal) };
@@ -117,7 +121,9 @@
   options: RunOptions = {},
 ): Promise<ToolExecutionResult> {
   signal.throwIfAborted();
+  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
   // [KEEP 来自 21.1] 主循环先审批，注册表只按已发现映射执行。
+  if (call.name === delegateTaskDefinition.name) return delegateTaskTool(call.arguments, signal, options);
   if (call.name === "web_fetch" || call.name === "web_search") return callWeb(options.web, call, signal);
   if (call.name.startsWith("mcp__")) return callMcp(options.mcp, call, signal);
   // [KEEP 来自 19.3] 串行等待完整读取，再回传当前调用的结果。
@@ -149,7 +155,9 @@
 export function executePreparedTool(
   prepared: PreparedToolCall,
   signal: AbortSignal,
+  options: RunOptions = {},
 ): Promise<ToolExecutionResult> {
   signal.throwIfAborted();
+  if (options.allowedTools) throw new ToolError("子任务不允许执行需准备的操作。");
   return prepared.execute(signal);
 }
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
- * 22.1 有界抓取网页 | [CHANGED] permissions/policy.ts
+ * 25.1 独立子会话 | [CHANGED] permissions/policy.ts
  *
  * 学习目标：把本次启用的网页工具与 MCP 一并列为外部工具；Plan 硬拒绝，执行模式仍逐次询问，网页文字不产生批准。
  * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
@@ -162,6 +162,7 @@
  * 返回 ask 时附本地生成的 scope 和 remember；只有可记住的只读范围才可进入授权集合。
  * 这里只返回决定，准备和执行仍要检查参数与路径，拒绝不会运行工具。
  */
+// [CHANGED 25.1] 允许委派作为受限只读任务，继续应用现有权限规则。
 export async function decideToolPermission(
   call: ToolCall,
   // [KEEP 来自 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
@@ -172,7 +173,7 @@
   // [KEEP 来自 21.1] 可信控制器传入本进程已发现的工具集合。
   externalTools: ReadonlySet<string> = new Set(),
 ): Promise<PermissionDecision> {
-  // [CHANGED 22.1] MCP与网页共用外部工具集合，逐次批准，Plan一律拒绝。
+  // [KEEP 来自 21.1] MCP说明和readOnlyHint不能跳过逐次批准，Plan一律拒绝。
   if (externalTools.has(call.name)) {
     if (!parseArguments(call.arguments)) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };
     if (mode === "plan") return { action: "deny", reason: "Plan 模式不调用外部网络工具" };
@@ -195,6 +196,7 @@
   // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
   // [KEEP 来自 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
   if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
+  if (call.name === "delegate_task") return { action: "allow", reason: "独立只读子任务，实际工具仍按原权限逐次检查" };
   if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
   // [KEEP 来自 12.3] 放行澄清等待；答案不产生文件或命令批准。
   if (call.name === "ask_user") return { action: "allow", reason: "澄清问题只等待用户回答，不授予工具执行权限" };
```

</details>

<details>
<summary>NEW：src/subagents/runner.ts 的完整文件</summary>

<!-- source: src/subagents/runner.ts -->
```ts
/**
 * 25.1 独立子会话 | [NEW] subagents/runner.ts
 *
 * 学习目标：用相同循环创建独立子会话，父任务等待结构化结果再继续。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：delegate_task -> 新JSONL/独立history -> 只读AgentLoop -> 保存/关闭 -> ChildResult
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { randomUUID } from "node:crypto";
import { agentLoop } from "../agent/agent-loop.js";
import type { AgentObserver } from "../agent/events.js";
import type { Message, Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { createSessionWriter, type SessionWriter } from "../sessions/save-session.js";
import { DEFAULT_CONTEXT_LIMITS, estimateContext } from "../context/budget.js";
import { ToolError, UserFacingError } from "../errors.js";

// [NEW 25.1] 建立独立历史与子会话，复用循环并收集结构化终态。
export const CHILD_TOOLS = ["read_file", "glob", "grep"] as const;
export type ChildRole = "explore" | "review";
export type ChildStatus = "completed" | "failed" | "cancelled" | "budget_exhausted";
export type ChildEvidence = { path: string; startLine?: number; endLine?: number };
export type ChildResult = { sessionId: string; parentSessionId: string; role: ChildRole; status: ChildStatus; summary: string; evidence: ChildEvidence[]; usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; cacheWriteTokens: number | null }; modelCalls: number; requestTokensReserved: number; error?: string };
export type ChildOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver; depth?: number; maxModelCalls?: number; requestTokenBudget?: number };

export class ChildBudgetError extends UserFacingError {}

/**
 * 委派参数只接纳明确角色和有界任务；没有路径、权限、命令或子工具配置入口。
 * 不合法参数在创建子会话或发送模型请求前变为普通工具错误。
 */
export function parseChildTask(argumentsJson: string): { role: ChildRole; task: string } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw new ToolError("委派参数必须是 JSON 对象。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("委派参数必须是 JSON 对象。");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).sort().join() !== "role,task" || args.role !== "explore" && args.role !== "review" || typeof args.task !== "string" || !args.task.trim() || args.task.length > 2000) throw new ToolError("委派需要 role=explore|review 和 1–2000 字符的 task，不能增加权限字段。");
  return { role: args.role, task: args.task.trim() };
}

/**
 * 包装同一模型连接，但只携带本次角色与只读定义；不暴露共享管理状态或父历史。
 * 请求次数和累计输入估算加输出预留在真正 generate 前扣除，缺少服务商 usage 也有本地硬边界。
 */
function childModel(model: Model, role: ChildRole, maxCalls: number, tokenBudget: number, metrics: { calls: number; responses: number; reserved: number }): Model {
  const scope = { allowedTools: [...CHILD_TOOLS], rolePrompt: role === "explore" ? "你是只读探索子助手。调查任务需要的文件和调用关系，区分事实与猜测；返回简明发现、未解决问题。只读，不执行命令，不委派。" : "你是只读审查子助手。审查已有文件，优先报告可定位的问题、影响和不确定性；没有证据不要编造缺陷。只读，不执行命令，不委派。" };
  return {
    beginRun: model.beginRun?.bind(model),
    inspectContext: (messages, mode) => model.inspectContext?.(messages, mode, scope) ?? estimateContext(messages, scope.rolePrompt, [], DEFAULT_CONTEXT_LIMITS),
    estimateCost: model.estimateCost?.bind(model),
    async generate(messages, signal, onText, options) {
      signal.throwIfAborted();
      const budget = model.inspectContext?.(messages, "plan", scope) ?? estimateContext(messages, scope.rolePrompt, [], DEFAULT_CONTEXT_LIMITS);
      const charge = budget.inputEstimate + budget.outputReserve;
      if (!budget.withinBudget || metrics.calls >= maxCalls || metrics.reserved + charge > tokenBudget) throw new ChildBudgetError("子任务请求次数或本地累计 token 预留已用尽。");
      metrics.calls++; metrics.reserved += charge;
      const response = await model.generate(messages, signal, onText, { ...options, mode: "plan", ...scope });
      metrics.responses++; return response;
    },
  };
}

/**
 * 复用 Agent Loop 创建独立的串行子会话；父调用 await 返回，不建立后台工作或并行调度。
 * 子历史、清单、摘要游标、授权与预算各自持有；父取消等待子循环、检查点与句柄关闭。
 * 失败和取消仍返回结构化状态，写盘失败不会掩盖原取消，finally 总尝试关闭会话锁。
 */
export async function runSubagent(model: Model, argumentsJson: string, signal: AbortSignal, options: ChildOptions = {}): Promise<ChildResult> {
  const { role, task } = parseChildTask(argumentsJson);
  const parentSessionId = options.parentSessionId ?? randomUUID();
  const history: Message[] = [], metrics = { calls: 0, responses: 0, reserved: 0 };
  const result: ChildResult = { sessionId: randomUUID(), parentSessionId, role, status: "failed", summary: "", evidence: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }, modelCalls: 0, requestTokensReserved: 0 };
  let writer: SessionWriter | undefined;
  const maxCalls = Math.min(4, Math.max(1, Math.floor(Number.isFinite(options.maxModelCalls) ? options.maxModelCalls! : 4)));
  const tokenBudget = Math.min(32_768, Math.max(1, Math.floor(Number.isFinite(options.requestTokenBudget) ? options.requestTokenBudget! : 32_768)));
  const observe: AgentObserver = event => {
    if (event.type === "model_usage") result.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens ?? null, cacheWriteTokens: event.cacheWriteTokens ?? null };
    options.observer?.(event);
  };
  try {
    signal.throwIfAborted();
    if ((options.depth ?? 0) >= 1) throw new UserFacingError("子任务深度最多为 1，子助手不能继续委派。");
    writer = await createSessionWriter(options.sessionDirectory, { sessionId: parentSessionId, seq: 0 }); result.sessionId = writer.id;
    await writer.save({ messages: [], mode: "plan", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_start");
    const reply = await agentLoop(childModel(model, role, maxCalls, tokenBudget, metrics), history, task, signal, observe, options.requestApproval, new Set(), { mode: "plan", allowedTools: [...CHILD_TOOLS], childDepth: 1, maxModelCalls: maxCalls });
    result.status = "completed"; result.summary = reply.text;
  } catch (error) {
    result.status = signal.aborted ? "cancelled" : error instanceof ChildBudgetError || metrics.calls >= maxCalls ? "budget_exhausted" : "failed";
    result.error = signal.aborted ? "父任务取消，子任务已停止。" : error instanceof UserFacingError || error instanceof ToolError ? error.message : "子任务未取得完整结果。";
  } finally {
    // 请求发出而未取得完整响应时用量未知；本地清理事件或初始零不能证明没有消耗。
    if (metrics.responses < metrics.calls) result.usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null };
    result.modelCalls = metrics.calls; result.requestTokensReserved = metrics.reserved;
    if (writer) {
      try { await writer.save({ messages: history, mode: "plan", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_end"); }
      catch { if (result.status === "completed") result.status = "failed"; result.error = `${result.error ?? ""} 子会话检查点保存失败。`.trim(); }
      finally { try { await writer.close(); } catch { if (result.status === "completed") result.status = "failed"; result.error = `${result.error ?? ""} 子会话关闭失败。`.trim(); } }
    }
  }
  return result;
}
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
- * 22.1 有界抓取网页 | [CHANGED] agent/run-options.ts
+ * 25.1 独立子会话 | [CHANGED] agent/run-options.ts
  *
  * 学习目标：把本进程已启用的 WebState 传给工具执行层；模型不能从网页文字选择配置或取得运行权限。
  * 输入：本地入口选定的模式、会话状态、已加载的网页配置与本轮交互回调。
@@ -61,9 +61,16 @@
  */
 // [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 // [KEEP 来自 19.3] 工具使用进程内已发现目录，模型不能自行选择根目录。
+// [CHANGED 25.1] 把父关联、子会话目录与白名单传入循环。
 export type RunOptions = {
+  sessionId?: string;
+  childSessionDirectory?: string;
+  childDepth?: number;
+  maxModelCalls?: number;
+  allowedTools?: readonly string[];
+  delegateTask?: (argumentsJson: string, signal: AbortSignal) => Promise<import("../subagents/runner.js").ChildResult>;
   // [KEEP 来自 21.1] 连接只存内存，不写会话或给模型选择配置路径。
-  // [CHANGED 22.1] 本地网页启用状态不写会话。
+  // [KEEP 来自 22.1] 本地网页启用状态不写会话。
   web?: import("../web/client.js").WebState;
   mcp?: import("../mcp/client.js").McpState;
   skills?: import("../skills/catalog.js").SkillState;
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
- * 24.1 附件引用 | [CHANGED] agent/agent-loop.ts
+ * 25.1 独立子会话 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -108,6 +108,8 @@
 // [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
 // [KEEP 来自 21.1] 每次调用重新检查当前定义是否可用。
 // [KEEP 来自 22.1] 网页也使用同一条审批与原调用结果通道。
+import { randomUUID } from "node:crypto";
+import { runSubagent } from "../subagents/runner.js";
 import { webDefinitions, citationFeedback } from "../web/client.js";
 import { mcpDefinitions } from "../mcp/client.js";
 import { runHooks } from "../hooks/lifecycle.js";
@@ -146,6 +148,7 @@
  * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
  */
 // [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
+// [CHANGED 25.1] 顺序等待子任务，并按原工具编号把结果交给父模型。
 export async function agentLoop(
   model: Model,
   history: Message[],
@@ -160,17 +163,24 @@
 ): Promise<Reply> {
   signal.throwIfAborted();
   const releaseRun = model.beginRun?.();
-  // [CHANGED 24.1] 验证失败尚未提交 user 消息，也不取走 pending；结束时释放切换锁。
+  // [KEEP 来自 24.1] 验证失败尚未提交 user 消息，也不取走 pending；结束时释放切换锁。
   try { await model.attachments?.preflight(signal, model.profile?.capabilities.images === true); }
   catch (error) { releaseRun?.(); throw error; }
   // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
   const mode = options.mode ?? "execute";
+  const maxModelCalls = Math.min(MAX_MODEL_CALLS, Math.max(1, Math.floor(options.maxModelCalls ?? MAX_MODEL_CALLS)));
+  const parentSessionId = options.sessionId ?? randomUUID();
+  let childCount = 0;
   // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
   const context = options.context ?? emptyCompaction();
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
   // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
   const toolOptions: RunOptions = { ...options, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
+  toolOptions.delegateTask = async (argumentsJson, childSignal) => {
+    if (options.childDepth || ++childCount > 3) throw new ToolError("每轮最多三个只读子任务，子任务不能继续委派。");
+    return runSubagent(model, argumentsJson, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory, requestApproval, depth: options.childDepth ?? 0 });
+  };
   const attachments = model.attachments?.take();
   const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
   let inputTokens: number | null = 0;
@@ -194,7 +204,7 @@
   try {
     // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
     await model.memory?.refresh(signal);
-    for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
+    for (let modelCall = 1; modelCall <= maxModelCalls; modelCall += 1) {
       // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
       signal.throwIfAborted();
 
@@ -293,20 +303,22 @@
         turn.push({ role: "assistant", content: finalText });
 
         // [KEEP 来自 12.4] 最终回答后仍有补充且有请求预算就继续；第 8 次后的剩余条目保留。
-        if (modelCall < MAX_MODEL_CALLS && options.takePendingInputs && options.hasPendingInputs?.()) continue;
+        if (modelCall < maxModelCalls && options.takePendingInputs && options.hasPendingInputs?.()) continue;
         history.push(...turn);
         return { text: finalText, inputTokens, outputTokens, truncated, cachedInputTokens, cacheWriteTokens };
       }
 
       // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
-      if (modelCall === MAX_MODEL_CALLS) break;
+      if (modelCall === maxModelCalls) break;
 
       turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
       for (const call of result.toolCalls) {
         signal.throwIfAborted();
         toolSequence += 1;
         // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
-        const permission = await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
+        const permission = options.allowedTools && !options.allowedTools.includes(call.name)
+          ? { action: "deny" as const, reason: `子任务不允许工具：${call.name}` }
+          : await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
         emitAgentEvent(observer, {
           type: "permission_check",
           sequence: toolSequence,
@@ -403,8 +415,14 @@
             if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
           }
           let result = prepared
-            ? await executePreparedTool(prepared, signal)
+            ? await executePreparedTool(prepared, signal, toolOptions)
             : await executeTool(call, signal, toolOptions);
+          if (result.metadata.kind === "subagent" && signal.aborted) {
+            turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: true });
+            executingCallId = undefined;
+            emitAgentEvent(observer, { type: "tool_finish", sequence: toolSequence, call, outcome: "success", result });
+            signal.throwIfAborted();
+          }
           // [KEEP 来自 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
           if (mode !== "plan") {
             try {
@@ -463,7 +481,7 @@
       }
     }
 
-    throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
+    throw new UserFacingError(`Agent 连续请求模型 ${maxModelCalls} 次仍未得到最终回答，已停止本轮。`);
   } catch (error) {
     // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
     // 每个批次单独配对：后续模型请求即使复用同一个 ID，也不能借用前一批的完成记录。
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
- * 23.3 能力与错误 | [CHANGED] ui/teaching-trace.ts
+ * 25.1 独立子会话 | [CHANGED] ui/teaching-trace.ts
  *
  * 学习目标：从真实网页结果元数据展示来源数量、字节和截断状态；外部工具参数在审批中完整展示，轨迹只显示摘要。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
@@ -86,6 +86,7 @@
  * 返回值只给终端显示，输出会清理、限长并隐藏常见凭据特征；不改工具 content。
  * 命令是否失败由结果的 isError 交给外层决定，这里不会因为 stderr 有文字就改判结果。
  */
+// [CHANGED 25.1] 解释委派工具的本地运行结果。
 function describeToolResult(metadata: ToolResultMetadata): string {
   // [KEEP 来自 12.3] 回答是工具结果，不当作文件内容。
   // [KEEP 来自 12.3] 澄清结果显示已答或未答，不当作文件结果。
@@ -93,6 +94,7 @@
   // [KEEP 来自 19.3] 来源与版本直接来自结构化结果；资源正文仍回原工具消息。
   // [KEEP 来自 21.1] 来源取真实映射，正文仍显示在工具详情。
   // [KEEP 来自 22.1] 界面来源来自结构化真实响应，不从网页正文猜测。
+  if (metadata.kind === "subagent") return `子任务 ${metadata.result.role}：${metadata.result.status}；会话 ${metadata.result.sessionId}`;
   if (metadata.kind === "web") return `网页 ${metadata.sources.length} 个来源 · ${metadata.bytes} 字节${metadata.truncated ? " · 文本截断" : ""}`;
   if (metadata.kind === "mcp") return `MCP ${toTraceText(metadata.server)}/${toTraceText(metadata.tool)}`;
   if (metadata.kind === "load_skill" || metadata.kind === "read_skill_resource") return `${metadata.kind === "load_skill" ? "已加载正文" : "已读取资源"} ${toTraceText(metadata.name)}；来源 ${toTraceText(metadata.path, 160)}；${metadata.bytes} 字节；SHA256 ${toTraceText(metadata.sha256, 64)}`;
@@ -142,7 +144,6 @@
  * - 显示规则：工具状态来自元数据，参数与摘要经过字段筛选、控制字符处理和长度限制。
  * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
  */
-// [CHANGED 23.3] 显示缓存用量时保留未知状态。
 export function formatTeachingTrace(event: AgentEvent): string[] {
   // [KEEP 来自 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
   if (event.type === "compaction_start") return [`正在压缩旧记录：本项任务第 ${event.attempt}/2 次摘要准备，完整记录保留。`];
```

</details>

<details>
<summary>CHANGED：src/ui/terminal.ts 的精确差异</summary>

<!-- source: src/ui/terminal.ts -->
```diff
--- a/src/ui/terminal.ts
+++ b/src/ui/terminal.ts
@@ -1,5 +1,5 @@
 /**
- * 24.1 附件引用 | [CHANGED] ui/terminal.ts
+ * 25.1 独立子会话 | [CHANGED] ui/terminal.ts
  *
  * 学习目标：消费同一任务事件，显示模型正文，并在结束后补打新增的本地反馈。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -259,8 +259,9 @@
 // [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
 // [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
 // [KEEP 来自 13.1] writer 由 CLI 管理；可选参数方便离线调用，不改变模型接口。
-// [CHANGED 24.1] 管理当前待发送附件与本地命令。
+// [CHANGED 25.1] 把当前会话身份传给父循环。
 export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
+  options = { ...options, sessionId: writer?.id ?? options.sessionId };
   // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
   // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
@@ -434,6 +435,7 @@
 // [KEEP 来自 09.3] readline 的回显与审批提示使用 stderr。
 // [KEEP 来自 13.1] 单次文本提问也有完整历史，writer 的关闭仍归 CLI。
 export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
+  options = { ...options, sessionId: writer?.id ?? options.sessionId };
   // [KEEP 来自 13.3] 历史只成为新请求的上下文，旧工具不会从这里再次调度。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
   // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
```

</details>

<details>
<summary>CHANGED：src/ui/tui/app.tsx 的精确差异</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 24.1 附件引用 | [CHANGED] ui/tui/app.tsx
+ * 25.1 独立子会话 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：显示模型的加载与资源结果；本地命令、审批、任务取消保持各自入口。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -178,6 +178,7 @@
  */
 // [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
 // [KEEP 来自 12.5] 界面接入本节操作；具体状态和按键变化在对应分支标明。
+// [CHANGED 25.1] TUI 运行时传递父会话关联。
 function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
   // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
   const [draft, setDraft] = useState(newDraft());
@@ -439,7 +440,7 @@
 
     // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
     // [KEEP 来自 14.2] 本轮获批准的写入使用当前会话文件检查点。
-    const options = { context: session.context, fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
+    const options = { sessionId: session.writer?.id, context: session.context, fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
       // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
       askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
         if (!session.closing) setQuestion(pending);
@@ -474,7 +475,7 @@
       } finally {
         // [KEEP 来自 13.3] 重发文字进入历史后才移出旧队列；开始前失败则保留，避免丢失已保存文字。
         const committed = session.history[historyLength];
-        // [CHANGED 24.1] 提交前失败时取回清掉的原稿；用户已写的新草稿不能被覆盖。
+        // [KEEP 来自 24.1] 提交前失败时取回清掉的原稿；用户已写的新草稿不能被覆盖。
         if (queuedId === undefined && !session.closing && !(committed?.role === "user" && committed.content === prompt)) {
           setDraft((currentDraft) => currentDraft.text ? currentDraft : newDraft(prompt));
         }
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:25.1
```

再按照 [本章完整答案](/content/chapter-25-subagents/EXERCISES.md?id=%E6%9E%84%E5%BB%BA%E4%B8%8E%E8%BF%90%E8%A1%8C) 的“单独编译练习”步骤，准备 `SUBAGENT_EXERCISE`。本节只运行第 1 组，运行命令与上面的构建命令分开：

```bash
node "$SUBAGENT_EXERCISE/verify-subagents.js" 1
```

输出“通过一”说明实际读取正文进入子模型的后续请求，父模型只收到按原委派编号返回的结构化结果，子会话另有 JSONL。模型替身只安排动作，不替代真实文件读取和循环。

## 本节完成后的 Agent

现在，父模型可以委派一个明确任务，等待独立子历史取得观察，再通过原工具编号收到结构化结果。下一节进一步核对只读边界与返回证据。

本节状态：待用户确认。
