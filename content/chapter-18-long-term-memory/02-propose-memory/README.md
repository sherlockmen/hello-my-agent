# 18.2 让模型提出记忆候选

[第 18 章首页](/content/chapter-18-long-term-memory/README.md) · [上一节：18.1 显式保存项目记忆](/content/chapter-18-long-term-memory/01-save-memory/README.md) · [下一节：18.3 检查与纠正记忆](/content/chapter-18-long-term-memory/03-manage-memory/README.md) · [练习与答案](/content/chapter-18-long-term-memory/EXERCISES.md)

## 问题：发现值得保留的信息，不等于获得保存许可

修复测试时，模型可能读到 `package.json`，发现真正的单元测试入口是 `npm run test:unit`。如果每次都要求用户重新抄一遍，长期记忆很难自然融入任务；如果模型读到什么就直接保存，临时猜测与过期结论又会不断进入后续任务。

我们需要一个中间状态：模型提出“建议保存什么、为什么”，用户看过具体内容后决定。模型说“这很重要”不能代替用户确认，普通回答里说“已记住”也不能代替写入结果。

## 解决方案：候选走完整预览与逐次批准

本节注册 `propose_memory({ content, reason })`。`content` 是要保存的完整正文，`reason` 解释它为什么值得跨任务保留。准备阶段校验参数并生成预览；用户选择 `allow_once` 后，执行阶段才把同一份候选交给上一节的存储器。

候选是一次项目写入，Plan 模式直接拒绝。它不使用宽泛的持久授权，也不能用正文中的“已经获准”绕过审批。

## 工作原理

### 把“建议”留在准备阶段，把“事实”留在写入结果里

模型返回的工具调用只表达意图。准备阶段把正文和理由完整显示出来，让用户能看到将来每次任务可能读到的文字。预览后的执行参数保持为同一份已验证数据，不能批准一段文字、落盘另一段文字。

批准后，存储器创建 `active` 条目，来源为 `model`，来源说明保留本次 `reason`，并写入 `add` 操作。工具成功结果带回条目 ID 和下一任务生效的提示。到这一步，“候选”才成为磁盘里可列出、可查看的记录。

理由是追溯线索，不是真实性证明。用户仍应比较正文与这次读到的文件或运行结果。例如测试命令应来自当前 `package.json`，不该因为模型用了肯定语气就保存。

### 三个没有写入的出口都要能解释

| 停在哪里 | 返回什么 | 文件怎样变化 |
| --- | --- | --- |
| Plan 模式或参数无效 | 原调用对应的工具错误 | 没有进入保存器 |
| 用户拒绝预览 | 拒绝结果回到原调用 | 不新增条目 |
| 等待确认或提交点前取消 | 本地补齐未完成调用状态，停止当前任务 | 不接纳半份候选 |

磁盘替换完成后才收到取消，则写入已发生；用户可用 `list`/`show` 核对，不能把“回答中断”解释成“文件回滚”。若存储器发现坏 JSON 或锁冲突，工具得到保存失败，旧文件保留。

当前任务仍继续时，批准、拒绝或工具错误都按原调用 ID 加入工具消息，供下一次模型请求使用。模型才能据此说“已保存 ID …”“用户拒绝了保存”或改用其他方法完成修复。只在界面通知、却不把结果加入消息，会让模型误以为建议已经执行。

取消整项任务走另一条路：Agent Loop 保留已经返回的结果；尚未启动的调用补上“未执行”，已开始却没有完整结果的调用补上“状态需核实”，再加入本地取消说明并提交到历史。文本/TUI 消费者等清理结束，按第 13 章保存会话检查点后交还输入；此时不会为了让模型解释取消而续发当前任务。只有用户后来明确提交新任务，历史才会按既有请求与压缩规则再次被使用。保存检查点失败会单独报告，不能因此声称模型任务仍在继续。

### 当前任务知道写入结果，下项任务才把新条目当作记忆

假设任务 A 开始时尚无记忆。中途批准保存后，任务 A 的后续请求会看到这次工具成功结果，因此知道刚才发生了写入；但专用记忆参考仍保持任务开始时的快照。任务 B 开始刷新，才在专用记忆块中读到新条目。

这两条通道解决不同问题：工具结果说明“本次动作是否完成”，记忆块说明“本任务固定采用哪些已保存事实”。既能完整交代写入，也保持一项任务内预算与请求依据一致。

<!-- generated:media:start -->
下面是机制示意，不是终端录屏。下面只展开逐次批准的成功主线。注意保存后仍有两种材料：t1 结果告诉任务 A 写入成功，任务 A 的专用记忆仍为空；等用户开始任务 B，刷新才把 m1 变成新参考。拒绝、Plan 和取消的去向见静态流程图。

<img src="./content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-cover-13bf012602.png" data-gif-src="./content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-2ed5d7383e.gif" data-cover="./content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-cover-13bf012602.png" data-no-zoom alt="模型候选经完整预览仅本次批准后保存，当前任务只得到工具结果，下一个用户任务才刷新专用记忆">

[静态流程图](/content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-flow-a165c49d6b.png.md) · [静态封面](/content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-cover-13bf012602.png.md) · [查看完整静态分镜](/content/chapter-18-long-term-memory/02-propose-memory/assets/memory-proposal-approval-storyboard-46ce8d5b2c.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/tools/propose-memory.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/tools/propose-memory.ts.md) | 准备完整候选预览，批准后执行捕获的保存动作 |
| CHANGED | [src/tools/types.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/tools/types.ts.md) | 为实际工具回执补充可检查的结构化信息 |
| CHANGED | [src/tools/registry.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/tools/registry.ts.md) | 在同一注册表接入本节工具的定义与执行 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/agent/run-options.ts.md) | 把本地可信状态传给任务执行入口 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/permissions/policy.ts.md) | 在本地策略中保留模式与专用入口边界 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/agent/agent-loop.ts.md) | 让任务快照、审批工具和真实结果接回决策循环 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-18-long-term-memory/02-propose-memory/src/ui/teaching-trace.ts.md) | 从真实事件显示来源和本节结果 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 18.1 的完整 `src/` 继续，目标为 `chapter-18-long-term-memory/02-propose-memory/`。新增工具的参数校验、完整预览与批准后执行，复用现有审批、结果回传和记忆存储，不建立第二份记忆文件。

<!-- generated:build:start -->
### 1. 准备完整候选预览，批准后执行捕获的保存动作

新建 `src/tools/propose-memory.ts`，完整内容如下。

<details>
<summary>完整文件：src/tools/propose-memory.ts（NEW）</summary>

<!-- source: src/tools/propose-memory.ts -->
```ts
/**
 * 18.2 确认模型提出的记忆 | [NEW] tools/propose-memory.ts
 * 输入：模型候选正文和理由；输出：项目范围、正文和来源预览，以及批准后才运行的保存闭包。
 * 状态：准备与拒绝不写盘；保存成功仅影响下一项用户任务。没有本地项目入口不能推测存储位置。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：JSON校验 -> 固定候选 -> 展示审批 -> allow_once -> 原子保存。
 * 观察：聊天、项目文字或模型声称已批准都不能替代实际审批返回值。
 */
import { ToolError, UserFacingError } from "../errors.js";
import { changeMemory, memoryText } from "../memory/store.js";
import type { PreparedToolCall } from "./types.js";

// [NEW 18.2] 本文件以下实现均为本节新增。
export const proposeMemoryDefinition = {
  name: "propose_memory",
  description: "建议保存本项目可复用的长期记忆。content是最多1000字正文，reason说明来源或依据（最多240字）。程序展示项目范围与候选，用户逐次批准后才保存；拒绝不保存。不能保存密钥或把规则、历史自动当记忆；成功在下一项用户任务生效。",
  inputSchema: {
    type: "object" as const,
    properties: { content: { type: "string" as const, minLength: 1, maxLength: 1000 }, reason: { type: "string" as const, minLength: 1, maxLength: 240 } },
    required: ["content", "reason"], additionalProperties: false,
  },
};

/**
 * 校验并固定这次候选；返回的execute只能由既有逐次审批通道调用。
 */
export async function prepareMemory(argumentsJson: string, root: string | undefined, signal: AbortSignal): Promise<PreparedToolCall> {
  signal.throwIfAborted();
  if (!root) throw new ToolError("当前运行未连接项目记忆，不能保存模型候选。");
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw new ToolError("propose_memory参数不是有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("propose_memory需要content和reason。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("content" in input) || !("reason" in input)) throw new ToolError("propose_memory只能包含content和reason。");
  let content: string, reason: string;
  try { content = memoryText(input.content); reason = memoryText(input.reason, 240); }
  catch (error) { throw new ToolError(error instanceof Error ? error.message : "候选内容无效。"); }
  const source = { kind: "model" as const, detail: `模型建议，用户逐次批准；依据：${reason}` };
  return {
    preview: `保存项目长期记忆\n真实项目根：${JSON.stringify(root)}\n候选正文：${content}\n来源：${source.detail}\n保存到：.hello-my-agent/memory.json\n仅本次批准；保存后在下一项用户任务加载。`,
    async execute(activeSignal) {
      let entry;
      try { entry = await changeMemory(root, { action: "add", content, source }, activeSignal); }
      catch (error) { activeSignal.throwIfAborted(); if (error instanceof UserFacingError) throw new ToolError(error.message); throw error; }
      return { content: `记忆已保存：${entry!.id}；来源：${source.detail}。下一项用户任务加载；当前任务请求快照未改变。`, metadata: { kind: "memory", id: entry!.id } };
    },
  };
}
```

</details>

### 2. 为实际工具回执补充可检查的结构化信息

在上一节的 `src/tools/types.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/types.ts（CHANGED）</summary>

<!-- source: src/tools/types.ts -->
```diff
--- a/src/tools/types.ts
+++ b/src/tools/types.ts
@@ -1,8 +1,7 @@
 /**
- * 13.1 保存会话 | [KEEP] tools/types.ts
+ * 18.2 确认模型提出的记忆 | [CHANGED] tools/types.ts
  *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责区分给模型的工具正文和给界面的结果数据。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 学习目标：保存结果的ID进入界面元数据，完整回执仍作为工具正文交给模型。
  * 输入：工具给出的预览与执行函数，或已运行完成的结果正文与元数据。
  * 输出：PreparedToolCall 用于审批；ToolExecutionResult.content 给模型，metadata 给界面。
  * 状态：这里只有类型声明，不会执行操作，也没有运行时状态提交。
@@ -17,6 +16,8 @@
 
 // [KEEP 来自 07.1] 命令输出和退出状态同时交给模型与界面。
 export type ToolResultMetadata =
+  // [CHANGED 18.2] 已保存编号供界面检查，正文仍回传模型。
+  | { kind: "memory"; id: string }
   // [KEEP 来自 12.3] 澄清答案与问题有独立显示字段，不必从正文重新解析。
   | { kind: "ask_user"; question: string; answer: string | null }
   // [KEEP 来自 12.2] 清单条目作为界面数据返回，正文仍交给模型。
```

</details>

### 3. 在同一注册表接入本节工具的定义与执行

在上一节的 `src/tools/registry.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/registry.ts（CHANGED）</summary>

<!-- source: src/tools/registry.ts -->
```diff
--- a/src/tools/registry.ts
+++ b/src/tools/registry.ts
@@ -1,5 +1,5 @@
 /**
- * 15.2 限制大工具结果 | [CHANGED] tools/registry.ts
+ * 18.2 确认模型提出的记忆 | [CHANGED] tools/registry.ts
  *
  * 学习目标：让模型能按日志编号取回被裁剪的内容；本文件注册只读日志工具，并把本轮日志目录传给对应实现。
  * 输入：模型给出的工具名称、JSON 参数与取消信号。
@@ -20,12 +20,14 @@
  */
 
 // [KEEP 来自 07.1] 命令和文件修改复用同一条准备、审批通道。
+// [CHANGED 18.2] 模型候选复用现有预览、审批、执行通道。
+import { prepareMemory, proposeMemoryDefinition } from "./propose-memory.js";
 import { prepareRunCommand, runCommandDefinition } from "./run-command.js";
 import { ToolError } from "../errors.js";
 import { globDefinition, globTool } from "./glob.js";
 import { grepDefinition, grepTool } from "./grep.js";
 import { readFileDefinition, readFileTool } from "./read-file.js";
-// [NEW 15.2] 日志读取只接受保存后生成的编号，不开放任意磁盘路径。
+// [KEEP 来自 15.2] 日志读取只接受保存后生成的编号，不开放任意磁盘路径。
 import { readToolResultDefinition, readToolResultTool } from "./read-tool-result.js";
 import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
 import { editFileDefinition, prepareEditFile } from "./edit-file.js";
@@ -43,12 +45,14 @@
 // [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
 // [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
 export const toolDefinitions = [
-  // [NEW 15.2] 让模型能发现按编号补读完整日志的只读工具。
+  // [KEEP 来自 15.2] 让模型能发现按编号补读完整日志的只读工具。
   readToolResultDefinition,
   // [KEEP 来自 07.1] 命令工具也要先批准，不能直接执行。
   readFileDefinition, globDefinition, grepDefinition, writeFileDefinition, editFileDefinition, runCommandDefinition,
   todoWriteDefinition,
   askUserDefinition,
+  // [CHANGED 18.2] 只是提出候选；并非直接写入入口。
+  proposeMemoryDefinition,
 ];
 
 /**
@@ -66,6 +70,8 @@
   options: RunOptions = {},
 ): Promise<PreparedToolCall | null> {
   signal.throwIfAborted();
+  // [CHANGED 18.2] 存储范围来自本地控制器，模型参数不能选择目录。
+  if (call.name === proposeMemoryDefinition.name) return prepareMemory(call.arguments, options.memoryRoot, signal);
   if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal, options.fileCheckpoints);
   // [KEEP 来自 06.2] 精确替换也必须在审批前解析当前文件并生成 diff。
   if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal, options.fileCheckpoints);
@@ -91,13 +97,13 @@
   if (call.name === todoWriteDefinition.name) return todoWriteTool(call.arguments, options.tasks ?? { items: [] }, signal);
   // [KEEP 来自 12.3] 分发给问答工具，等待本地 handler 后返回原调用结果。
   if (call.name === askUserDefinition.name) return askUserTool(call.arguments, options.askUser, signal);
-  // [NEW 15.2] 使用保存日志时的同一个目录，避免编号指向另一处存储。
+  // [KEEP 来自 15.2] 使用保存日志时的同一个目录，避免编号指向另一处存储。
   if (call.name === readToolResultDefinition.name) return readToolResultTool(call.arguments, signal, options.toolResultDirectory);
   if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
   if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
   if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
   // [KEEP 来自 07.1] 拒绝绕过审批的直接执行。
-  if (call.name === writeFileDefinition.name || call.name === editFileDefinition.name || call.name === runCommandDefinition.name) {
+  if (call.name === proposeMemoryDefinition.name || call.name === writeFileDefinition.name || call.name === editFileDefinition.name || call.name === runCommandDefinition.name) {
     throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
   }
   throw new ToolError(`未知工具：${call.name}`);
```

</details>

### 4. 把本地可信状态传给任务执行入口

在上一节的 `src/agent/run-options.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/run-options.ts（CHANGED）</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,7 +1,7 @@
 /**
- * 16.1 区分完整记录与请求视图 | [CHANGED] agent/run-options.ts
+ * 18.2 确认模型提出的记忆 | [CHANGED] agent/run-options.ts
  *
- * 学习目标：保存会话时辨明运行选项与持久状态；本文件沿用整轮控制数据约定。
+ * 学习目标：把本地确定的记忆根传给审批工具；模型参数不能选择保存项目。
  * 输入：本地入口选定的模式、会话清单、问答 handler 与本轮队列回调。
  * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
  * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
@@ -61,7 +61,9 @@
  */
 // [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 export type RunOptions = {
-  // [NEW 16.1] 摘要只改变请求视图；完整消息仍由会话保存。
+  // [CHANGED 18.2] 只由本地记忆控制器提供，候选参数不能改项目范围。
+  memoryRoot?: string;
+  // [KEEP 来自 16.1] 摘要只改变请求视图；完整消息仍由会话保存。
   context?: CompactionState;
   // [KEEP 来自 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
   toolResultDirectory?: string;
```

</details>

### 5. 在本地策略中保留模式与专用入口边界

在上一节的 `src/permissions/policy.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/permissions/policy.ts（CHANGED）</summary>

<!-- source: src/permissions/policy.ts -->
```diff
--- a/src/permissions/policy.ts
+++ b/src/permissions/policy.ts
@@ -1,7 +1,7 @@
 /**
- * 18.1 显式保存项目记忆 | [CHANGED] permissions/policy.ts
- *
- * 学习目标：专用记忆与通用文件权限分别处理；通用工具不能改写专用元数据，读取仍需审批。
+ * 18.2 确认模型提出的记忆 | [CHANGED] permissions/policy.ts
+ *
+ * 学习目标：专用记忆入口与通用文件权限分别处理；模型建议只允许逐次批准，Plan始终禁写。
  * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
  * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
  * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
@@ -53,7 +53,7 @@
   signal: AbortSignal,
 ) => Promise<ApprovalResponse>;
 
-// [CHANGED 18.1] 专用元数据目录不能从通用写入入口绕过记忆控制器。
+// [KEEP 来自 18.1] 专用元数据目录不能从通用写入入口绕过记忆控制器。
 const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex", ".hello-my-agent"]);
 
 /**
@@ -175,9 +175,11 @@
   if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };
 
   // [KEEP 来自 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
-  if (mode === "plan" && ["write_file", "edit_file", "run_command"].includes(call.name)) {
+  if (mode === "plan" && ["write_file", "edit_file", "run_command", "propose_memory"].includes(call.name)) {
     return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
   }
+  // [CHANGED 18.2] 候选不能用会话授权，也不能靠项目文字跳过逐次审批。
+  if (call.name === "propose_memory") return { action: "ask", reason: "长期记忆会跨会话保留，请核对正文、项目范围和来源", resource: "本项目长期记忆", scope: "propose_memory:once", remember: false };
   // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
   // [KEEP 来自 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
   if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
```

</details>

### 6. 让任务快照、审批工具和真实结果接回决策循环

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,5 +1,5 @@
 /**
- * 18.1 显式保存项目记忆 | [CHANGED] agent/agent-loop.ts
+ * 18.2 确认模型提出的记忆 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：在新任务首次估算前刷新并固定记忆；后续工具回合仍共用同一份参考。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -11,7 +11,7 @@
  *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
  *                                                         +-- 有效 -> 配置、模型、消费者
  *   [KEEP 来自 13.3] text / TUI -> 新建 ID 或锁定、校验并恢复指定会话；jsonl 仍只输出事件
- *   [CHANGED 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
+ *   [KEEP 来自 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
  *   [KEEP 来自 13.4] --sessions / --search / --rename / --export -> 本地管理记录，不请求模型
  *   [KEEP 来自 14.1] --fork ID -> 复制可信状态到新 ID；保留来源记录，不继承旧轮占用或授权
  *   [KEEP 来自 14.3] 空闲 /changes、/restore ID -> 查看差异或按当前内容核验后恢复；不执行旧工具
@@ -28,7 +28,7 @@
  *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
  *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
  *                                                                   +-- 否 -> 建立本轮消息
- *   [CHANGED 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
+ *   [KEEP 来自 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
  *   [KEEP 来自 12.1] 固定本轮模式 -> A
  *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
  *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
@@ -54,6 +54,8 @@
  *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
  *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
  *                                                             +-- 批准 -> 执行 -> D
+ *      [CHANGED 18.2] propose_memory -> 完整正文/依据预览 -> allow_once -> 锁内保存
+ *                     拒绝/取消不执行闭包；已保存结果回原调用，下一任务才刷新记忆
  *      allow -> 注册表找到工具 -> 执行 -> D
  *        [KEEP 来自 14.2] write_file / edit_file -> 先保存前后内容检查点，成功才实际写入
  *        [KEEP 来自 12.2] todo_write -> 全部条目校验成功？-- 否 -> ToolError、旧清单不变
@@ -143,7 +145,8 @@
   const context = options.context ?? emptyCompaction();
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
-  const toolOptions: RunOptions = { ...options, tasks: options.tasks ?? { items: [] } };
+  // [CHANGED 18.2] 模型只能提出正文和理由，不能选择记忆根；根由当前模型控制器提供。
+  const toolOptions: RunOptions = { ...options, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
   const turn: Message[] = [{ role: "user", content: input }];
   let inputTokens: number | null = 0;
   let outputTokens: number | null = 0;
@@ -156,7 +159,7 @@
   // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
   let executingCallId: string | undefined;
   try {
-    // [CHANGED 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
+    // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
     await model.memory?.refresh(signal);
     for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
       // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
@@ -277,7 +280,7 @@
           try {
             // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
             // [KEEP 来自 14.2] 把本地文件检查点入口传到写入准备层。
-            prepared = await prepareTool(call, signal, options);
+            prepared = await prepareTool(call, signal, toolOptions);
           } catch (error) {
             if (!(error instanceof ToolError)) throw error;
             turn.push({
```

</details>

### 7. 从真实事件显示来源和本节结果

在上一节的 `src/ui/teaching-trace.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/teaching-trace.ts（CHANGED）</summary>

<!-- source: src/ui/teaching-trace.ts -->
```diff
--- a/src/ui/teaching-trace.ts
+++ b/src/ui/teaching-trace.ts
@@ -1,7 +1,7 @@
 /**
- * 16.3 自动压缩后继续任务 | [CHANGED] ui/teaching-trace.ts
- *
- * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责从结构化事件整理过程说明，保留模型正文的用途。
+ * 18.2 确认模型提出的记忆 | [CHANGED] ui/teaching-trace.ts
+ *
+ * 学习目标：从真实保存结果显示记忆编号；模型建议、用户批准和写入成功分别观察。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
  * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
  *
@@ -88,6 +88,8 @@
 function describeToolResult(metadata: ToolResultMetadata): string {
   // [KEEP 来自 12.3] 回答是工具结果，不当作文件内容。
   // [KEEP 来自 12.3] 澄清结果显示已答或未答，不当作文件结果。
+  // [CHANGED 18.2] 保存结果只报告已落盘编号，不声称本次请求已加载。
+  if (metadata.kind === "memory") return `记忆已保存 ${metadata.id}；下一项用户任务加载`;
   if (metadata.kind === "ask_user") return metadata.answer === null ? "用户未回答本次澄清" : `已收到回答：${toTraceText(metadata.answer, 120)}`;
   // [KEEP 来自 12.2] 内存任务没有文件行数。
   // [KEEP 来自 12.2] 显示清单报告的数量，不把 completed 解释为测试通过。
@@ -134,7 +136,7 @@
  * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
  */
 export function formatTeachingTrace(event: AgentEvent): string[] {
-  // [NEW 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
+  // [KEEP 来自 16.3] 只在 applied 时说已采用，生成候选不等于请求已经发出。
   if (event.type === "compaction_start") return [`正在压缩旧记录：本项任务第 ${event.attempt}/2 次摘要准备，完整记录保留。`];
   if (event.type === "compaction_candidate") return [`摘要候选：输入估算 ${event.before} → ${event.after}，覆盖前 ${event.through} 条；尚未采用。`];
   if (event.type === "compaction_finish") return [event.outcome === "applied"
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根编译，再准备一个新项目，避免已有相同条目影响观察。

```bash
npm run lesson:18.2
```

```bash
MEMORY_DEMO="$(mktemp -d)"
cd "$MEMORY_DEMO"
cat > package.json <<'JSON'
{"private":true,"scripts":{"test:unit":"node --test"}}
JSON
hello-my-agent
```

在文本模式或 TUI 提交：“本项目测试命令是 npm run test:unit。请把这条事实作为长期记忆候选提交，理由是后续修复需要正确的测试入口，先让我确认。”真实模型是否调用工具取决于其响应；只有出现 `propose_memory` 的真实预览，才进入本节要观察的分支。

第一次选择拒绝，随后输入 `/memory list`，应仍没有新增条目。再次提交，核对完整正文和理由后选择仅本次批准。输入 `/memory list`，应出现 `model` 来源的新 ID；`/memory show <id>` 应保留该理由。不能把模型回答中的“好的”当作批准入口。

另启 `hello-my-agent --mode plan` 重试同类请求：即使模型提出保存，也应得到模式拒绝，文件修订号不增加。章末实验通过真实执行器与确定参数，验证拒绝和批准，便于把本地机制与模型选择分开判断。

## 本节完成后的 Agent

Agent 能把工作中发现的信息提为候选，并让用户控制真实写入。保存后还需要纠正过时信息；下一节让每条记录的 ID、状态与操作历史发挥作用。
