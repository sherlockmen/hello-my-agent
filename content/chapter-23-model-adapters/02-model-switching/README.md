# 23.2 在任务之间切换模型配置

[第 23 章首页](/content/chapter-23-model-adapters/README.md) · [上一节：23.1 适配接口](/content/chapter-23-model-adapters/01-adapter-contract/README.md) · [本章练习与答案](/content/chapter-23-model-adapters/EXERCISES.md)

## 问题

上一节让两种协议遵守同一条工具循环，但选择模型仍然不能只是改一个模型名字。

假设当前配置使用 OpenAI 兼容端点。我们把模型名改成一个 Claude 模型，却仍沿用原来的请求地址和密钥，请求就不会自动变成 Anthropic Messages。模型名回答“向哪个模型发问”，协议、端点和凭据回答“怎样把请求送到它那里”；这几项必须配套。

另一个问题发生在任务进行中。模型已经请求读取文件，程序正在等结果；此时切换配置，下一次模型请求究竟应由哪个模型接着处理？如果前半轮和后半轮随意使用不同配置，错误和用量也很难解释。

## 解决方案

我们为每份**模型配置（model profile）**配套准备协议、模型标识、能力声明及连接。对外展示的 profile 只含协议、模型标识和能力，连接凭据留在客户端内部。用户通过 `/model` 查看当前配置，通过 `/model <openai|anthropic> <model-id> [images|text]` 在空闲时切换。

切换的单位是后续任务。正在运行的任务先沿原配置结束或取消；程序空闲后，才接受新配置。配置切换不重写已有会话文本，下一次请求会把内部历史转换成新协议所需的形式。

## 工作原理

### 一、显示出来的配置应能解释当前请求

输入 `/model` 时，我们需要看到当前协议、模型名及能力，而不是只有一个无法判断来源的名字。后面附加图片失败时，这些信息能直接解释：当前配置是否允许图片，程序准备使用哪一种请求形式。

显示配置时不会打印密钥。密钥的用途是认证请求，不是充当会话内容。程序根据所选协议读取对应的配置来源；切到 Anthropic 时，不能因为 OpenAI 那边有一份可用凭据，就拿它去尝试另一个服务。

这也说明“切换成功”只证明本地配置通过检查。模型 ID 是否存在、当前账号是否有访问权，仍需真实服务响应确认。我们不会通过本地字符串校验，宣称远端模型已经可用。

### 二、先准备新配置，再替换当前配置

一次切换应先解析命令，检查提供方、模型标识和该协议所需配置。只有这些步骤成功，程序才替换当前模型客户端。若缺少目标协议凭据，命令返回明确错误，原配置仍能继续使用。

例如，当前 OpenAI 配置可用，而环境里没有 Anthropic 凭据。此时执行 `/model anthropic example-model text`，预期结果是“目标配置缺少凭据”，而不是把当前客户端改成一个半初始化对象。失败之后再次 `/model`，仍应看到原配置。

这个先准备、后替换的顺序，使切换成为一个有明确结果的本地动作：成功就使用完整的新配置；失败就保留完整的旧配置。它避免了“名字已换、连接还没换”的中间状态。

### 三、为什么只允许空闲时切换

一次 Agent 任务通常包含多次模型请求：第一次提出工具调用，第二次读取工具结果，也可能继续调用更多工具。我们把这些请求视作同一轮任务的连续决策。

任务忙碌时拒绝切换，便能保证这轮请求始终使用启动时的配置。用户可以先取消任务，等待程序回到空闲，再切换。这样取消仍由原来的任务控制处理，切换命令无需接管一个正在进行的流，也无需猜测工具结果应该送给谁。

会话历史则保持协议无关。下一轮使用新模型时，23.1 的适配器会重新转换历史里的用户消息、工具调用及结果。新模型可能得出不同判断，这是模型行为差异；编号丢失、凭据错配和半轮切换，则是程序可以避免的状态错误。

### 四、能力选项是本地声明，需要与真实模型对应

命令中的 `images` 和 `text` 用来声明这份配置是否接收图片。程序据此在请求前检查附件，不能据此给模型增加视觉能力。我们应根据目标模型官方文档填写，第一次使用时仍通过一个明确的图片任务观察服务响应。

切换保留历史，也保留历史带来的输入要求。例如，旧消息已经关联图片，而新配置声明为 `text`，切换本身可以成功，下一次请求仍会因为历史图片而被拒绝。第 24 章会把这项检查落实到完整请求。

下一节会把这条原则扩展到错误与用量：程序能确定的就明确说明，服务没有报告的就保留为未知。

<!-- media:lesson:start -->
下面先在空闲时把协议、模型、能力和凭据整组换成 B，再观察工具执行期间的切换被拒绝。当前配置和命令草稿都能沿图追踪；这里的 A、B 是教学名称，本地切换不证明远端型号可用。

<img src="./content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-cover-98095edd64.png" data-gif-src="./content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-a3d1edff69.gif" data-cover="./content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-cover-98095edd64.png" data-no-zoom alt="模型配置什么时候可以整组切换？">

[静态流程图](/content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-flow-9d9a6a1a31.png.md) · [静态封面](/content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-cover-98095edd64.png.md) · [查看完整静态分镜](/content/chapter-23-model-adapters/02-model-switching/assets/model-profile-switch-storyboard-ef3321f315.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/config/load-config.ts](/content/chapter-23-model-adapters/02-model-switching/src/config/load-config.ts.md) | 按目标协议重新读取对应凭据和完整配置。 |
| CHANGED | [src/models/client.ts](/content/chapter-23-model-adapters/02-model-switching/src/models/client.ts.md) | 管理可切换的 profile 与覆盖整轮任务的引用计数锁。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-23-model-adapters/02-model-switching/src/agent/agent-loop.ts.md) | 从模型决策到工具与摘要结束，持有同一模型配置。 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-23-model-adapters/02-model-switching/src/ui/terminal.ts.md) | 接收本地 /model 命令并展示结果。 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-23-model-adapters/02-model-switching/src/ui/tui/app.tsx.md) | 切换成功才收取命令，忙或失败时保留原稿。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 23.1 的完整 `src/` 继续。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线，不需要复制仓库内最终快照覆盖自己的实现。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/config/load-config.ts 的精确差异</summary>

<!-- source: src/config/load-config.ts -->
```diff
--- a/src/config/load-config.ts
+++ b/src/config/load-config.ts
@@ -1,5 +1,5 @@
 /**
- * 23.1 协议适配接口 | [CHANGED] config/load-config.ts
+ * 23.2 空闲切换模型 | [CHANGED] config/load-config.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责读取模型连接配置和已有工具能力说明。
  * 输入：provider、model、baseUrl 选项和对应的环境配置。
@@ -25,7 +25,6 @@
 
 // [KEEP] 可选字段对应 Commander 的选项；读取后统一转成必填的 Config。
 export type Options = { provider?: string; model?: string; baseUrl?: string };
-// [CHANGED 23.1] 把图片能力声明纳入本地配置，供统一 profile 使用。
 export type Config = {
   provider: "openai" | "anthropic";
   apiKey: string;
@@ -79,6 +78,7 @@
  * - 失败方式：协议名不支持、必填字段缺失或地址不安全时抛出 `UserFacingError`。
  * - 职责边界：这里只处理配置，不创建 SDK 客户端，也不发送请求。
  */
+// [CHANGED 23.2] 按目标协议重新读取对应凭据和完整配置。
 export function readConfig(options: Options): Config {
   const fileEnv = readProjectEnv();
   // 空字符串视为未配置；trim 去掉复制配置时带入的首尾空格。
@@ -111,7 +111,9 @@
   const contextLimits: ContextLimits = { windowTokens, outputReserve,
     inputPricePerMillion: optionalPrice(env("AGENT_INPUT_PRICE_PER_MILLION"), "AGENT_INPUT_PRICE_PER_MILLION"),
     outputPricePerMillion: optionalPrice(env("AGENT_OUTPUT_PRICE_PER_MILLION"), "AGENT_OUTPUT_PRICE_PER_MILLION") };
-  return { provider, apiKey, model, baseURL, contextLimits };
+  const imageSetting = env(`${prefix}_IMAGE_INPUT`);
+  if (imageSetting !== undefined && imageSetting !== "true" && imageSetting !== "false") throw new UserFacingError(`${prefix}_IMAGE_INPUT 只能是 true 或 false。`);
+  return { provider, apiKey, model, baseURL, contextLimits, imageInput: imageSetting === "true" };
 }
 
 /**
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
- * 23.1 协议适配接口 | [CHANGED] models/client.ts
+ * 23.2 空闲切换模型 | [CHANGED] models/client.ts
  *
  * 学习目标：每次估算和请求使用相同来源编号提示及工具定义；URL与正文保留在工具消息中，提示不复制网页正文。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -39,7 +39,7 @@
 // [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
 import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
 import { createProtocolAdapter, SUMMARY_PROMPT, type ModelProfile } from "./protocol.js";
-import { systemPrompt, type Config } from "../config/load-config.js";
+import { readConfig, systemPrompt, type Config } from "../config/load-config.js";
 import { UserFacingError } from "../errors.js";
 // [KEEP 来自 21.1] 动态定义与预算、两种模型协议使用同一份列表。
 // [KEEP 来自 22.1] 网络工具和本地工具共用请求定义、预算与Plan过滤。
@@ -73,13 +73,15 @@
  * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
  * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
  */
-// [CHANGED 23.1] 循环只依赖统一适配接口，保留同一消息、预算与工具定义。
+// [CHANGED 23.2] 管理可切换的 profile 与覆盖整轮任务的引用计数锁。
 export interface Model {
   // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
   // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
   // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
   // [KEEP 来自 22.1] 网页启用只来自本次启动。
   readonly profile?: ModelProfile;
+  beginRun?(): () => void;
+  command?(text: string): { ok: boolean; message: string };
   readonly web?: WebState;
   readonly mcp?: McpState;
   readonly hooks?: import("../hooks/lifecycle.js").HookState;
@@ -115,32 +117,55 @@
   // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
   const projectPrompt = project ? projectInstructionPrompt(project) : "";
   const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
-  const adapter = createProtocolAdapter(config);
+  let adapter = createProtocolAdapter(config);
+  let activeRequests = 0;
   // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
   // [KEEP 来自 12.1] 适配层将模式传给请求组装，沿用原取消和期限处理。
-  const limits = config.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
+  let limits = config.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
   // [KEEP 来自 16.2] 专用摘要不继承执行工具；输出预留也计入摘要自己的本地预算。
-  const summaryLimits = { ...limits, outputReserve: Math.min(limits.outputReserve, 2048) };
+  const summaryLimits = () => ({ ...limits, outputReserve: Math.min(limits.outputReserve, 2048) });
   return {
     // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
     // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
-    memory, skills, hooks, mcp, web, profile: adapter.profile,
+    memory, skills, hooks, mcp, web,
+    get profile() { return structuredClone(adapter.profile); },
+    beginRun() {
+      activeRequests += 1; let released = false;
+      return () => { if (!released) { released = true; activeRequests -= 1; } };
+    },
+    command(text) {
+      if (activeRequests) return { ok: false, message: "任务正在进行；本次切换未执行，请在空闲时重试。" };
+      const match = /^\/model(?: (openai|anthropic) ([^\s]{1,200})(?: (images|text))?)?$/.exec(text.trim());
+      if (!match) return { ok: false, message: "用法：/model；/model <openai|anthropic> <模型ID> [images|text]。" };
+      if (match[1]) {
+        try {
+          // 重新读取目标协议专用凭据，不继承旧连接的密钥、地址或价格。
+          const candidate = readConfig({ provider: match[1], model: match[2] });
+          if (match[3]) candidate.imageInput = match[3] === "images";
+          const next = createProtocolAdapter(candidate);
+          adapter = next; limits = candidate.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
+        } catch (error) { return { ok: false, message: error instanceof UserFacingError ? error.message : "模型配置无法创建，旧连接保留。" }; }
+      }
+      const profile = adapter.profile;
+      return { ok: true, message: `当前模型：${profile.provider}/${profile.model}；工具/流式：启用；图片：${profile.capabilities.images ? "本地声明支持" : "未声明支持"}。能力声明仍需服务端验证；历史保留，预算随连接更新。` };
+    },
     projectInfo,
     inspectSummary(source) {
-      return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits);
+      return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits());
     },
     async summarize(source, signal) {
       signal.throwIfAborted();
       const messages: Message[] = [{ role: "user", content: source }];
-      if (!estimateContext(messages, SUMMARY_PROMPT, [], summaryLimits).withinBudget) throw new UserFacingError("摘要请求本身超出本地预算，未发送。");
+      if (!estimateContext(messages, SUMMARY_PROMPT, [], summaryLimits()).withinBudget) throw new UserFacingError("摘要请求本身超出本地预算，未发送。");
       const deadline = AbortSignal.timeout(60_000);
+      activeRequests += 1;
       try {
-        return await adapter.summarize(source, AbortSignal.any([signal, deadline]), summaryLimits.outputReserve);
+        return await adapter.summarize(source, AbortSignal.any([signal, deadline]), summaryLimits().outputReserve);
       } catch (error) {
         signal.throwIfAborted();
         if (deadline.aborted) throw new UserFacingError("摘要超过 60 秒，候选未采用；不会自动重试同一段内容。");
         throw error;
-      }
+      } finally { activeRequests -= 1; }
     },
     inspectContext(messages, mode = "execute") {
       const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web), [...mcpDefinitions(mcp), ...webDefinitions(web)]);
@@ -157,13 +182,14 @@
     const budget = estimateContext(messages, prompt, definitions, limits);
     if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
     const deadline = AbortSignal.timeout(60_000);
+    activeRequests += 1;
     try {
       return await adapter.generate(messages, AbortSignal.any([signal, deadline]), onText, { prompt, definitions, limits });
     } catch (error) {
       signal.throwIfAborted();
       if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
       throw error;
-    }
+    } finally { activeRequests -= 1; }
   } };
 }
 
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
- * 22.3 来源台账与引用核验 | [CHANGED] agent/agent-loop.ts
+ * 23.2 空闲切换模型 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -51,7 +51,7 @@
  *                  |  次数已用完时不取走剩余补充，界面队列仍保留
  *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
  *                                       +-- 否 -> 保存 assistant 调用 -> C
- *   [CHANGED 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
+ *   [KEEP 来自 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
  *   [KEEP 来自 22.2] 固定搜索endpoint -> 本次查询审批 -> 有界JSON响应 -> 真正返回的URL/摘要 -> 模型
  *   [KEEP 来自 22.1] 明确启用 -> URL/本次审批 -> 单一期限/逐块限额/逐跳校验 -> 真实来源与正文 -> 模型
  *   [KEEP 来自 21.3] close/断线/定义变化 -> 撤下可调用定义；取消先关闭本地传输，远端副作用仍需核实
@@ -146,6 +146,7 @@
  * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
  */
 // [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
+// [CHANGED 23.2] 从模型决策到工具与摘要结束，持有同一模型配置。
 export async function agentLoop(
   model: Model,
   history: Message[],
@@ -159,6 +160,7 @@
   options: RunOptions = {},
 ): Promise<Reply> {
   signal.throwIfAborted();
+  const releaseRun = model.beginRun?.();
   // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
   const mode = options.mode ?? "execute";
   // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
@@ -268,7 +270,7 @@
       if (result.toolCalls.length === 0) {
         if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
         signal.throwIfAborted();
-        // [CHANGED 22.3] 不编造修复后的引用；本地核验反馈随最终结果显示并保存。
+        // [KEEP 来自 22.3] 不编造修复后的引用；本地核验反馈随最终结果显示并保存。
         const feedback = citationFeedback(model.web, result.text);
         const finalText = result.text + (feedback ? `\n\n${feedback}` : "");
         turn.push({ role: "assistant", content: finalText });
@@ -469,5 +471,5 @@
       : "[本地状态] 本轮因错误中断。已执行的操作不会自动撤销；继续前先核实工具结果。" });
     history.push(...turn);
     throw error;
-  }
+  } finally { releaseRun?.(); }
 }
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
- * 20.3 结束钩子与有界收尾 | [CHANGED] ui/terminal.ts
+ * 23.2 空闲切换模型 | [CHANGED] ui/terminal.ts
  *
  * 学习目标：消费同一任务事件，显示模型正文，并在结束后补打新增的本地反馈。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -90,11 +90,11 @@
  * - 避免重复：每次 model_start 重置是否显示过文字的记录，reply 对照最后一次决策已显示原文，只补最终结果新增的尾部。
  * - 职责边界：这里只保存显示状态，不提交历史；已显示的片段也不能证明本轮已经成功。
  */
-// [CHANGED 20.3] 本轮保留最后一次模型已显示正文，最终回复只补本地收尾新增尾部。
+// [KEEP 来自 20.3] 本轮保留最后一次模型已显示正文，最终回复只补本地收尾新增尾部。
 export function createTurnRenderer() {
   let opened = false;
   let streamed = false;
-  // [CHANGED 20.3] 最终Reply可追加本地收尾；保留已显示原文，只补尚未显示的尾部。
+  // [KEEP 来自 20.3] 最终Reply可追加本地收尾；保留已显示原文，只补尚未显示的尾部。
   let displayedText = "";
   const finish = () => {
     if (opened) process.stdout.write("\n");
@@ -259,6 +259,7 @@
 // [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
 // [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
 // [KEEP 来自 13.1] writer 由 CLI 管理；可选参数方便离线调用，不改变模型接口。
+// [CHANGED 23.2] 接收本地 /model 命令并展示结果。
 export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
@@ -328,6 +329,7 @@
       const text = value.trim();
       if (!text) continue;
       if (text === "/exit") break;
+      if (/^\/model(?:\s|$)/.test(text)) { console.error(screenText(model.command?.(text).message ?? "当前模型不支持本地切换。")); continue; }
       // [KEEP 来自 19.2] 加载时 Ctrl+C 只取消本地读取，finally 后才接下一行。
       if (/^\/(skills|skill)(?:\s|$)/.test(text)) {
         active = new AbortController();
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
- * 19.3 模型选择与资源读取 | [KEEP] ui/tui/app.tsx
+ * 23.2 空闲切换模型 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：显示模型的加载与资源结果；本地命令、审批、任务取消保持各自入口。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -178,6 +178,7 @@
  */
 // [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
 // [KEEP 来自 12.5] 界面接入本节操作；具体状态和按键变化在对应分支标明。
+// [CHANGED 23.2] 切换成功才收取命令，忙或失败时保留原稿。
 function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
   // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
   const [draft, setDraft] = useState(newDraft());
@@ -292,6 +293,7 @@
     setDraft(newDraft());
     // 本地命令只改本地会话；它们不作为 user 消息送给模型。
     if (prompt === "/exit") { quit(0); return; }
+    if (/^\/model(?:\s|$)/.test(prompt)) { const result = model.command?.(prompt); append("本地", result?.message ?? "当前模型不支持本地切换。"); if (!result?.ok) setDraft(draft); return; }
     // [KEEP 来自 19.2] 本地加载拥有独立取消控制器；退出等待读取句柄关闭，不产生用户消息。
     if (/^\/(skills|skill)(?:\s|$)/.test(prompt)) {
       const controller = new AbortController();
@@ -355,7 +357,7 @@
    * 识别必须在空闲时本地处理的命令。
    * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
    */
-  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
+  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
   /**
    * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
    * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:23.2
```

再按照 [本章完整答案](/content/chapter-23-model-adapters/EXERCISES.md?id=%E6%9E%84%E5%BB%BA%E4%B8%8E%E8%BF%90%E8%A1%8C) 的“单独编译练习”步骤，准备 `MODEL_EXERCISE`。本节只运行第 2 组，运行命令与上面的构建命令分开：

```bash
node "$MODEL_EXERCISE/verify-models.js" 2
```

输出“通过二”说明持有整轮锁时切换被拒绝、释放后替换完整配置、错误命令保留当前状态。再用交互入口执行 /model 观察当前 profile；显示配置成功不代表远端接受该模型。

需要观察交互入口时，在同一份编译结果上另行运行：

```bash
node dist/cli.js --output tui
```

## 本节完成后的 Agent

现在，空闲时可以选择下一次任务的模型配置；请求、工具和压缩之间保持同一配置。历史仍然沿用，因此下一节要明确解释能力声明、兼容失败和有证据的用量。

本节状态：待用户确认。
