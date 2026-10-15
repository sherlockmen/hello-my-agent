# 15.3 显示预算并在超限时停止

[第 15 章首页](/content/chapter-15-context-budget/README.md) · [上一节：15.2 缩短工具结果并保留完整日志](/content/chapter-15-context-budget/02-bound-tool-results/README.md) · [本章练习与答案](/content/chapter-15-context-budget/EXERCISES.md)

## 问题：第一条请求放得下，工具返回以后可能放不下

Agent 先请求模型，模型决定运行 `npm test`，工具返回测试结果，然后程序还要请求模型解释结果。第一次请求的预算够用，不表示第二次也够用：历史中刚增加了工具调用和结果，输入已经变大。

只在用户按 Enter 时检查一次，会漏掉同一任务内部的后续调用。把所有工具结果都裁短，也不能保证许多结果加起来仍在窗口内。我们需要在真正发出每次模型请求的地方作判断，并让停止原因清楚地回到界面。

本节把上一节已经显示的估算变成执行条件：输入估算加输出预留不超过本地窗口，才调用模型；超出时，当前任务停止，已有历史和实际操作结果保留。

## 解决方案：每次调用前重新计算，超预算就结束本轮

核心循环在选择本轮系统提示、工具定义和当前消息以后，重新计算预算。先发出预算事件，让 text/TUI 显示同一份判断依据，再检查剩余估算。

剩余大于或等于零时，照常调用模型。小于零时，发出明确的超预算停止结果，不创建下一次网络请求，也不让模型临时猜一个总结。消费者仍通过已有的任务收尾路径恢复输入、保存状态并处理尚未交付的要求。

这一步只负责决定继续还是停止。本章不自动删历史、不把旧消息改成摘要；第 16 章再在保留约束与结果的前提下压缩上下文。

## 工作原理

### 检查位置必须靠近真正的模型调用

继续用一个便于心算的教学预算。配置窗口为 8,000，输出预留 2,000，第一次输入估算 5,500，剩余还有 500，所以程序允许请求。模型返回 `run_command` 调用，工具执行完，把结果加入历史；第二次输入变成 6,300。

```text
第一次：8,000 - 2,000 - 5,500 = 500   → 发出模型请求
工具执行完成，调用与结果进入历史
第二次：8,000 - 2,000 - 6,300 = -300 → 停止，不发出第二次请求
```

这些数字是演示计算，不是实际模型用量。关键在于两次估算之间历史变了，所以必须重算。系统提示随模式变化，可用工具也可能随当前模式选择；检查要使用这次真正准备发送的对象，不能拿任务开始时的旧数组和旧提示作保证。

检查之后到调用模型之间不再修改本次输入，预算事件与是否调用使用同一个结果。边界也明确：剩余为零允许发出，负数停止。这个条件检验的是本地估算，并不证明服务商一定接受；请求仍可能被真实窗口、协议或分词差异拒绝。

### 停止下一次请求，不会倒退已经发生的操作

上例第二次超预算时，测试命令已经结束，工具调用与结果也已经成对保存。程序停止的是“再请模型解释结果”这一步，不是撤销刚才的命令。若工具已经写入文件，那项修改仍在；需要恢复时，按第 14 章检查实际文件与检查点。

当前用户消息也保留在历史。程序没有因为没有最终回答就删除要求，或把工具结果丢掉腾空间。界面显示超预算原因、输入估算、输出预留和本地窗口，使我们知道为什么缺少后续回答，而不是一直看着一个等待动画。

如果一开始就超预算，连第一次模型请求也不发出，本轮不会因此产生新的模型工具调用。如果工具结束后才超预算，则保留已经完成的工具及结果。两种情况都走正常的本地收尾，区别来自检查时历史已经包含什么。

### 核心决定停止，界面负责结束等待和保存

预算判断放在核心循环，所以 text 与 TUI 不会各自实现一套不同规则。核心发出停止结果后，消费者结束当前运行状态，保留本轮历史、清单和队列，保存任务结束状态，再重新接受输入。每次检查前，核心可能已把本轮补充从队列收进消息历史；这表示本地接纳，不表示服务已经收到。若随后超预算，这些补充留在历史里，尚未收取的条目仍留在队列，不会为这次拒绝补发请求。

TUI 的预算显示来自最近一次预算事件。它展示的是最近一次准备请求时的估算，不是在后台实时分析键入中的草稿；服务实际用量仍来自响应事件。两组数字并排出现时，不能把一次本地拒绝理解为服务已经收到了这次请求或产生了新 usage。

超预算以后仅再输入一句“继续”，通常不能解决问题：那句话也会增加历史，剩余空间不会自动变大。本章可以先本地导出会话，核对已有结果；需要另起上下文时，使用现有的新会话或重置能力。重置前先保存需要保留的约束与结论，不能把清空当成有选择的压缩。

### 预算停止、服务失败和用户取消的原因不同

预算停止发生在本地调用前；服务失败发生在请求已经尝试以后；用户取消可能发生在等待响应或工具执行中。界面应该保留真实原因，不能统一写成“没有空间”，也不能用请求取消推断外部副作用已经恢复。

本节的输出预留继续传给两个 provider 的生成上限参数。模型如果用完上限，也可能只给出不完整文本或没有形成有效工具调用，这仍要按模型响应与原协议验证处理；输出预留保证的是请求参数有上限，不保证每次模型都完成任务。

费用估计也维持原来的来源条件。本地拒绝一次请求，不会给它凭空增加服务用量或费用；已经完成调用的 usage 可以继续显示，缺报部分仍是未知。这样显示才能帮助我们解释一次任务到底走到了哪里。

<!-- generated:media:start -->
下面仍使用教学窗口 8,000。第一次请求通过后，模型提出测试调用；工具结果回到历史才使下一份输入增长，第二次预算因此在请求发出前停止。

<img src="./content/chapter-15-context-budget/03-enforce-budget/assets/budget-gate-cover-851386bd66.png" data-gif-src="./content/chapter-15-context-budget/03-enforce-budget/assets/budget-gate-91556333eb.gif" data-cover="./content/chapter-15-context-budget/03-enforce-budget/assets/budget-gate-cover-851386bd66.png" data-no-zoom alt="第一次预算通过后发请求，模型调用移向测试工具，结果返回历史后重新估算，第二次预算超限因而不发HTTP">

[静态封面](/content/chapter-15-context-budget/03-enforce-budget/assets/budget-gate-cover-851386bd66.png.md) · [查看完整静态分镜](/content/chapter-15-context-budget/03-enforce-budget/assets/budget-gate-storyboard-2577a8b61f.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-15-context-budget/03-enforce-budget/src/agent/agent-loop.ts.md) | 预算事件之后、model_start 之前拒绝超限调用并保留完整历史 |
| CHANGED | [src/models/client.ts](/content/chapter-15-context-budget/03-enforce-budget/src/models/client.ts.md) | 直接调用模型客户端时也在发请求前执行同一预算条件 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 15.2 的完整 `src/` 继续，目标目录为 `chapter-15-context-budget/03-enforce-budget/`。显示与配置已经具备，本节只把预算检查接在每次模型调用之前。复用现有事件和结束路径，不额外创建一条绕开会话保存的异常出口。

<!-- generated:build:start -->
### 1. 预算事件之后、model_start 之前拒绝超限调用并保留完整历史

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,7 @@
 /**
- * 15.2 限制大工具结果 | [CHANGED] agent/agent-loop.ts
+ * 15.3 发送前检查预算 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：先保存完整工具正文，再把有明确省略和可续读引用的头尾交回模型。
+ * 学习目标：在每次发送前检查输入估算和输出预留，超限保留历史并停止请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -33,7 +33,8 @@
  *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
  *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
  *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
- *      本节先显示预算；尚未启用超限停止 -> 请求模型
+ *      [NEW 15.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> X（不发 HTTP，不删历史）
+ *                                                      +-- 是 -> 请求模型
  *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
  *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
  *                                                                        +-- 是 -> B
@@ -57,11 +58,11 @@
  *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
  *                                                +-- 否 -> ToolError 或取消 -> D / X
  *                            TUI 面板独占输入；旧请求结束后旧回调失效
- *   D: 工具已返回 -> [NEW 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
+ *   D: 工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
  *                                                        +-- 是 -> 写完整本地日志、sync、关闭
  *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
  *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
- *      [NEW 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
+ *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
  *      保存正文 / 裁剪正文与原调用 ID、错误标记 -> 过程事件 -> 本批还有调用？-- 是 -> C
  *                                                                             +-- 否 -> A
  *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
@@ -161,6 +162,8 @@
       const messages = [...history, ...turn];
       const budget = model.inspectContext?.(messages, mode);
       if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
+      // [NEW 15.3] 下一份输入已完整准备，先过本地预算门；超限不发送、不删除任何历史。
+      if (budget && !budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送，历史已保留；请缩小任务或新建会话，本节不自动压缩。`);
       emitAgentEvent(observer, {
         type: "model_start",
         call: modelCall,
@@ -312,7 +315,7 @@
           const result = prepared
             ? await executePreparedTool(prepared, signal)
             : await executeTool(call, signal, toolOptions);
-          // [NEW 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
+          // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
           executingCallId = undefined;
           let modelContent: string;
           try { modelContent = (await boundToolResult(result.content, signal, options.toolResultDirectory)).content; }
```

</details>

### 2. 直接调用模型客户端时也在发请求前执行同一预算条件

在上一节的 `src/models/client.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/models/client.ts（CHANGED）</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,5 +1,5 @@
 /**
- * 15.2 限制大工具结果 | [CHANGED] models/client.ts
+ * 15.3 发送前检查预算 | [CHANGED] models/client.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责按本轮模式组装请求，收齐并检查模型结果。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -102,6 +102,11 @@
     },
     estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
     async generate(messages, signal, onText, options = {}) {
+    // [NEW 15.3] 直接调用模型适配器也执行相同门槛，避免绕过 Agent Loop 发出超本地预算的请求。
+    signal.throwIfAborted();
+    const { prompt, definitions } = requestParts(options.mode ?? "execute");
+    const budget = estimateContext(messages, prompt, definitions, limits);
+    if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
     const deadline = AbortSignal.timeout(60_000);
     try {
       return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText, options.mode ?? "execute", limits);
@@ -265,12 +270,12 @@
 function requestParts(mode: ExecutionMode): { prompt: string; definitions: typeof toolDefinitions } {
   // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
   // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
-  // [CHANGED 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
+  // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
   const definitions = mode === "plan"
     // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
     ? toolDefinitions.filter((tool) => ["read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user"].includes(tool.name))
     : toolDefinitions;
-  // [CHANGED 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
+  // [KEEP 来自 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
   const prompt = systemPrompt + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
     ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
     : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根目录编译并链接本节：

```bash
npm run lesson:15.3
```

真实服务的响应长度不固定，不能用“让模型多说几句”精确验证边界。先运行[本章练习](/content/chapter-15-context-budget/EXERCISES.md)里的内存模型实验：刚好等于窗口时调用一次；超出一个估算 Token 时调用零次；工具结果使下一次超限时，只允许第一次模型调用，保留工具结果后停止。

然后回到加法项目启动 TUI，观察预算显示：

```bash
cd docs/.work/ch13-typescript-demo
hello-my-agent
```

按本章配置方式使用一个足够小的本地窗口，输入一段足够长的要求。应看到明确的超预算停止说明，界面回到可输入状态，且没有新的模型回答。把窗口调回实际所接服务的合理配置后再继续真实任务，不要把演示的小窗口留作日常设置。

需要检查已有讨论时，正常退出并使用 `--export`；导出是本地操作，不需要为了检查这轮发生了什么再请求模型。

## 本节完成后的 Agent

Agent 现在在每次调用模型前重新估算完整输入，并为输出保留空间。长工具结果先保存本机、短版本进入历史；如果总预算仍不足，程序明确停止，保留已发生的结果并结束等待。下一章将研究如何压缩历史，使继续任务有明确的信息保留依据。
