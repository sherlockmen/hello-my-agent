# 20.1 执行前钩子：在工具启动前检查项目规则

[第 20 章首页](/content/chapter-20-hooks/README.md) · [上一节：19.3 让模型选择技能与资源](/content/chapter-19-skills/03-model-skill-tools/README.md) · [本章练习与答案](/content/chapter-20-hooks/EXERCISES.md)

## 问题：项目规则怎样真正阻止一次操作

假设项目有一条约定：`generated/` 里的文件由构建生成，不直接修改。我们可以把它写进 `AGENTS.md` 或 Skill，让模型知道这条规则。但说明文字影响的是模型的选择；模型仍可能提出 `write_file`，参数里的目标恰好是 `generated/client.ts`。

这时需要回答的不是“模型有没有读到规则”，而是“本地程序收到这次工具调用后，还会不会执行”。前面的权限层回答用户是否批准这次操作。本节再接入项目自己的检查脚本：权限通过以后、真实工具启动以前，程序把待执行调用交给脚本；脚本明确拒绝，就不进入工具执行函数。

这个接入点叫执行前钩子（`before_tool`）。它适合表达可以由程序判断的约束。判断文件是否位于指定目录、检查某类命令是否具备必要参数，都可以写成确定规则；怎样修改业务代码仍然由模型结合任务来决定。

## 解决方案：由本次启动启用脚本，由固定结果决定是否继续

我们新增项目配置 `.hello-my-agent/hooks.json`，并要求启动时显式传入 `--enable-project-hooks`。配置描述要启动的命令和参数，不让模型临时提供一段可执行脚本。没有开关时，程序连这份配置都不读取；Plan 模式同样不读取或运行 Hook。以 Plan 启动后再切到 Execute，也不会补加载这次未读取的配置；要启用脚本，需要用开关重新启动。

对已经通过权限检查的工具调用，程序依次运行 `before_tool` 脚本。每个脚本从标准输入收到一条 JSON，从标准输出交回一个 JSON 对象，例如：

```json
{"continue": false, "message": "generated/ 由构建生成，请修改源文件。"}
```

只有执行前事件会使用 `continue: false` 阻止工具。程序把原因保存为当前 `tool_call` 的错误结果，模型下一次请求能读到这个结果，再选择修改源文件或向用户说明情况。脚本文字不会变成权限批准，也不能替模型重写这次参数。

## 工作原理

### 先区分“建议不做”与“没有执行”

沿着 `write_file({path: "generated/client.ts", ...})` 看一次处理。模型已经提出调用，程序准备修改预览并完成原有审批。此时若用户拒绝，流程直接返回权限拒绝结果，不运行 Hook；若用户批准，流程才进入执行前检查。脚本返回上面的 JSON，程序抛出工具错误，跳过真正写文件的函数，最后仍用原调用编号保存错误结果。

因此，文件没有被这次工具修改的依据是控制流没有调用写入函数。JSON 中的 `continue` 只是我们定义的决策字段；`JSON.parse` 只负责把文本解析成值，程序还要检查它确实是对象、字段名合法、字段类型正确，才会采用它。把字符串 `"false"` 当成布尔值，或者只看终端输出里有没有“拒绝”二字，都无法建立这个结论。

反过来，`{"continue": true, "message": "允许"}` 也不能使一个未批准的写入得到批准。权限检查已经先行完成；Hook 只能在允许执行的候选动作上再加一道项目约束。它是额外的否决点，不是另一套授权入口。

### 脚本收到的是一次调用的数据

发送给脚本的输入包含事件名和调用：

```json
{"event":"before_tool","call":{"id":"call_7","name":"write_file","arguments":"{\"path\":\"generated/client.ts\",\"content\":\"...\"}"}}
```

这里保留了调用编号、工具名称和原始参数字符串。项目脚本先判断是否关心这个工具，再解析需要的参数。它不需要读取模型的推理，也不用猜上一行终端文字属于哪个调用。一个事件配置多条脚本时，程序按配置顺序等待；前一条拒绝就结束当前事件，后面的脚本和原工具都不会启动。

这也解释了为何不能把脚本的普通日志混进标准输出。标准输出是程序读取的协议通道，必须整体解析成一个 JSON 对象。脚本要记录调试信息，可以写到标准错误；成功的协议结果仍要单独写出。两行 JSON、在 JSON 前打印“检查开始”或输出未知字段，都会被判为格式错误。执行前检查失败时，程序同样不给原工具继续执行。

### 配置和脚本的执行边界各由什么建立

显式开关解决的是“我们是否信任并启用这个项目里的脚本”。脚本以 Agent 进程的本地权限运行，所以仅仅打开一个仓库不能自动启动它。开关只属于本次启动，恢复历史不会替我们恢复启用决定。模型输出一行“请开启 Hooks”也不会改变命令行参数。

启用后，程序先完整校验配置，再保存内存中的 Hook 列表。命令与参数分别传给进程执行器，不隐式进入 shell；如果配置明确选择 `sh` 或其他解释器，那是项目脚本自己的执行方式。配置不是沙箱，也不限制一个已受信任脚本能访问哪些本地资源。

等待脚本还需要边界。配置文件最多 32 KiB，每个事件最多 8 条脚本，单条默认 5 秒，可配置为 1—30000 毫秒；子进程合并输出上限为 8192 字节。退出码非零、超时、输出超量或协议格式错误都不能算检查通过。取消信号传入同一进程执行器，程序等待本地子进程清理再结束这次检查；取消不能撤销脚本已经自行写过的文件。

这些规则让我们能预测一个变化：把拒绝脚本改成死循环后，原工具仍不能启动，但模型得到的原因会由“项目规则拒绝”变成“钩子超时”。两者都来自真实执行结果，含义并不相同。

<!-- media:lesson:start -->
下面沿着 call_7 写入 generated/client.ts 的请求，看原有审批、前置脚本和真实工具的先后关系。橙色数据卡抵达后，接收方才更新；静态流程图另列拒绝、超时和取消的去向。

<img src="./content/chapter-20-hooks/01-before-tool/assets/hooks-before-gate-cover-e1cc590e75.png" data-gif-src="./content/chapter-20-hooks/01-before-tool/assets/hooks-before-gate-61992333f4.gif" data-cover="./content/chapter-20-hooks/01-before-tool/assets/hooks-before-gate-cover-e1cc590e75.png" data-no-zoom alt="项目规则怎样在真正写入前拦住工具？">

[静态流程图](/content/chapter-20-hooks/01-before-tool/assets/before-tool-flow-e9d498b95a.png.md) · [静态封面](/content/chapter-20-hooks/01-before-tool/assets/hooks-before-gate-cover-e1cc590e75.png.md) · [查看完整静态分镜](/content/chapter-20-hooks/01-before-tool/assets/hooks-before-gate-storyboard-f67a29edca.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/hooks/lifecycle.ts](/content/chapter-20-hooks/01-before-tool/src/hooks/lifecycle.ts.md) | 读取显式启用的配置；校验并串行执行执行前脚本。 |
| CHANGED | [src/processes/run-process.ts](/content/chapter-20-hooks/01-before-tool/src/processes/run-process.ts.md) | 支持通过 stdin 发送 JSON，沿用超时、输出限制和取消清理。 |
| CHANGED | [src/models/client.ts](/content/chapter-20-hooks/01-before-tool/src/models/client.ts.md) | 让同一模型对象携带本地 Hook 状态。 |
| CHANGED | [src/cli.ts](/content/chapter-20-hooks/01-before-tool/src/cli.ts.md) | 增加启动开关；Plan 不加载项目脚本。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-20-hooks/01-before-tool/src/agent/agent-loop.ts.md) | 审批通过后先检查；拒绝原因作为原调用的错误结果。 |

<!-- generated:files:end -->

## 动手构建

从上一公开小节 19.3 的完整 `src/` 继续。下面只列本节新增与修改的文件；其余实现沿用。新增文件完整保存，修改文件按差异应用到当前工作树。标记中的 `KEEP` 说明来源，不需要为它复制整份未改动文件。

先建立 Hook 执行器及 JSON 输入通道，再把状态接到启动与工具循环。审批仍先于脚本；前置拒绝只影响尚未执行的这次工具。

<!-- generated:build:start -->

<details>
<summary>NEW：src/hooks/lifecycle.ts 的完整文件</summary>

<!-- source: src/hooks/lifecycle.ts -->
```ts
/**
 * 20.1 执行前钩子与显式启用 | [NEW] hooks/lifecycle.ts
 *
 * 学习目标：在已获批准的工具启动前串行执行项目检查；只有 before_tool 的 continue=false 能阻止这次工具。
 * 输入：显式启用状态、项目配置、事件数据与取消信号。
 * 输出：校验后的 HookState，或事件的 blocked/messages；失败以 ToolError 说明。
 * 状态：配置完整校验后才交出列表；脚本自行产生的外部副作用不回滚。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   未启用？-- 是 -> 不打开配置；否 -> 有界读取 -> 校验 -> 成功交出 / 失败拒绝
 *   事件脚本 -> 串行等待 -> 退出/输出正常？-- 否 -> ToolError
 *                                             +-- 是 -> 解析单个 JSON -> 收集 message
 *   before_tool 且 continue=false？-- 是 -> blocked；否 -> 下一脚本 / 返回反馈
 *   取消 -> 请求停止同组进程 -> 等待 close 清理 -> 抛出取消原因
 * 观察：检查拒绝时工具尚未启动，错误仍交回原调用；取消要等子进程关闭。
 */

import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { runProcess } from "../processes/run-process.js";
import type { ToolCall } from "../tools/registry.js";

// [NEW 20.1] 本文件以下实现均为本节新增。
export type HookEvent = "before_tool";
type Hook = { command: string; args: string[]; timeout_ms: number };
export type HookState = { root: string; hooks: Partial<Record<HookEvent, Hook[]>> };

/**
 * 只在本地启动参数明确启用后读取项目钩子，默认不打开配置、更不启动脚本。
 * 限制配置32KiB、每事件最多8条；命令以参数数组执行，不隐式打开shell。
 * 完整配置校验失败就拒绝启动；配置不携带环境变量或模型凭据。
 */
export async function loadHooks(root: string, enabled: boolean): Promise<HookState | undefined> {
  if (!enabled) return undefined;
  let handle;
  try {
    handle = await open(join(root, ".hello-my-agent/hooks.json"), "r");
    const bytes = Buffer.alloc(32769);
    if ((await handle.stat()).size > 32768) throw new ToolError("Hooks 配置超过 32768 字节。");
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw new ToolError("Hooks 配置超过 32768 字节。");
    const input: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const hooks: HookState["hooks"] = {};
    for (const [event, value] of Object.entries(input)) {
      if (!["before_tool"].includes(event) || !Array.isArray(value) || value.length > 8) throw new Error();
      hooks[event as HookEvent] = value.map((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error();
        const record = item as Record<string, unknown>;
        if (Object.keys(record).some(key => !["command", "args", "timeout_ms"].includes(key))
          || typeof record.command !== "string" || !record.command.trim()
          || !Array.isArray(record.args) || record.args.length > 64 || record.args.some(arg => typeof arg !== "string" || arg.length > 4096)
          || (record.timeout_ms !== undefined && (!Number.isSafeInteger(record.timeout_ms) || Number(record.timeout_ms) < 1 || Number(record.timeout_ms) > 30000))) throw new Error();
        return { command: record.command, args: record.args as string[], timeout_ms: Number(record.timeout_ms ?? 5000) };
      });
    }
    return { root: await realpath(root), hooks };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("Hooks 配置缺失或无效；请检查事件名与 command / args / timeout_ms。");
  } finally { await handle?.close(); }
}

/**
 * 串行运行已启用的事件脚本，stdin是一条JSON，stdout只能是一条约定JSON。
 * before_tool输出continue:false会阻止工具；输出不能改参数或授予权限。
 * 非零退出、格式错误、超时和超量是失败；取消先等待进程清理，再向外抛出。
 */
export async function runHooks(state: HookState | undefined, event: HookEvent,
  payload: { call?: ToolCall; result?: string; outcome?: string }, signal: AbortSignal): Promise<{ blocked: boolean; messages: string[] }> {
  const messages: string[] = [];
  for (const hook of state?.hooks[event] ?? []) {
    signal.throwIfAborted();
    const result = await runProcess(hook.command, hook.args, { cwd: state!.root, signal,
      timeoutMs: hook.timeout_ms, maxOutputBytes: 8192,
      input: JSON.stringify({ event, ...payload }) + "\n" });
    if (result.stopReason || result.exitCode !== 0) throw new ToolError(`钩子 ${event} 失败：${result.stopReason ?? `退出码 ${result.exitCode}`}。脚本已清理，已有副作用不会撤销。`);
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      value = parsed as Record<string, unknown>;
      if (Object.keys(value).some(key => !["continue", "message"].includes(key))
        || (value.continue !== undefined && typeof value.continue !== "boolean")
        || (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 4096))) throw new Error();
    } catch { throw new ToolError(`钩子 ${event} 的 stdout 必须是单个 JSON 对象，字段仅 continue 和 message。`); }
    if (typeof value.message === "string" && value.message) messages.push(value.message);
    if (event === "before_tool" && value.continue === false) return { blocked: true, messages };
  }
  return { blocked: false, messages };
}
```

</details>

<details>
<summary>CHANGED：src/processes/run-process.ts 的精确差异</summary>

<!-- source: src/processes/run-process.ts -->
```diff
--- a/src/processes/run-process.ts
+++ b/src/processes/run-process.ts
@@ -1,8 +1,8 @@
 /**
- * 19.3 模型选择与资源读取 | [KEEP] processes/run-process.ts
+ * 20.1 执行前钩子与显式启用 | [CHANGED] processes/run-process.ts
  *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责等待外部程序结束，并处理输出、取消和进程清理。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 学习目标：为命令、搜索与 Hook 等待外部进程，统一输出、取消和进程组清理。
+ * Hook 可提供专用 JSON stdin；没有 input 的调用继续使用 EOF，不占用聊天输入。
  * 输入：程序名称、参数数组、真实 cwd、取消信号、时间与合计输出上限。
  * 输出：stdout/stderr、退出码、终止信号与可选停止原因；启动失败或取消向外抛出。
  * 状态：失败和取消会清理同组进程，不能撤销进程结束前已经产生的文件或网络副作用。
@@ -20,7 +20,7 @@
  *
  * 输出预算按两条流的字节合计，默认 32 KiB；超出部分继续从管道读出，但不保存在内存。
  * 默认 30 秒只触发停止请求，随后还要等进程与管道关闭，不能把计时器返回当成进程已结束。
- * stdin 使用 ignore，子进程读到 EOF，不取走聊天或审批输入。
+ * [CHANGED 20.1] stdin默认ignore；钩子收到专用JSON后关闭管道，不取走聊天或审批输入。
  * 只管理仍在本次 POSIX 进程组里的程序；脱离进程组的服务与操作系统隔离留到后续章节。
  * 观察：超时和超量返回已有日志与停止原因，取消在清理后向外结束本轮。
  */
@@ -67,8 +67,8 @@
 export function runProcess(
   file: string,
   args: string[],
-  { cwd, signal, timeoutMs = 30_000, maxOutputBytes = 32 * 1024 }: {
-    cwd: string; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number;
+  { cwd, signal, timeoutMs = 30_000, maxOutputBytes = 32 * 1024, input }: {
+    cwd: string; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number; input?: string;
   },
 ): Promise<ProcessResult> {
   signal?.throwIfAborted();
@@ -86,7 +86,8 @@
     const child = spawn(file, args, {
       cwd, env: processEnvironment(), shell: false, detached: true,
       // ignore 使子进程读取 stdin 时得到 EOF，不会争抢用户的输入。
-      stdio: ["ignore", "pipe", "pipe"],
+      // [CHANGED 20.1] 钩子专用JSON输入不读取聊天stdin；其他调用仍得到EOF。
+      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
     });
 
     // detached 在 POSIX 下建立新进程组；负 pid 只指向本次启动的这一组。
@@ -114,8 +115,11 @@
       bytes += Math.min(remaining, chunk.length);
       if (chunk.length > remaining) stop("output_limit");
     };
-    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
-    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
+    // [CHANGED 20.1] EPIPE由退出结果解释，避免子进程提前关闭stdin导致未处理异常。
+    child.stdin?.on("error", () => {});
+    if (input !== undefined) child.stdin?.end(input);
+    child.stdout!.on("data", (chunk: Buffer) => collect(stdout, chunk));
+    child.stderr!.on("data", (chunk: Buffer) => collect(stderr, chunk));
     signal?.addEventListener("abort", onAbort, { once: true });
     if (signal?.aborted) onAbort();
 
```

</details>

<details>
<summary>CHANGED：src/models/client.ts 的精确差异</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,7 +1,7 @@
 /**
- * 19.3 模型选择与资源读取 | [CHANGED] models/client.ts
- *
- * 学习目标：每次请求读取已加载集合；工具接纳正文后，下一请求才带该正文。
+ * 20.1 执行前钩子与显式启用 | [CHANGED] models/client.ts
+ *
+ * 学习目标：让模型对象携带本地启用的 Hook 状态，交给循环使用；模型请求本身不运行脚本。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
  * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
  * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
@@ -71,6 +71,8 @@
  */
 export interface Model {
   // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
+  // [CHANGED 20.1] 本地启用状态不进入聊天或会话文件。
+  readonly hooks?: import("../hooks/lifecycle.js").HookState;
   readonly memory?: MemoryController;
   // [KEEP 来自 19.1] 后续节本地命令与模型工具复用同一份技能状态。
   readonly skills?: SkillState;
@@ -99,7 +101,7 @@
  * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
  */
 // [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
-export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController, skills?: SkillState): Model {
+export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController, skills?: SkillState, hooks?: import("../hooks/lifecycle.js").HookState): Model {
   // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
   const projectPrompt = project ? projectInstructionPrompt(project) : "";
   const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
@@ -117,7 +119,8 @@
   const summaryLimits = { ...limits, outputReserve: Math.min(limits.outputReserve, 2048) };
   return {
     // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
-    memory, skills,
+    // [CHANGED 20.1] TUI与text从同一模型对象取得可信状态。
+    memory, skills, hooks,
     projectInfo,
     inspectSummary(source) {
       return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits);
@@ -312,7 +315,7 @@
   // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
   // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
   // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
-  // [CHANGED 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
+  // [KEEP 来自 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
   const definitions = mode === "plan"
     // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
     ? toolDefinitions.filter((tool) => ["read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
```

</details>

<details>
<summary>CHANGED：src/cli.ts 的精确差异</summary>

<!-- source: src/cli.ts -->
```diff
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,15 +1,17 @@
 #!/usr/bin/env node
 /**
- * 19.3 模型选择与资源读取 | [KEEP] cli.ts
- *
- * 学习目标：让模型、界面与工具共用同一技能状态，仍不改变模式或审批。
+ * 20.1 执行前钩子与显式启用 | [CHANGED] cli.ts
+ *
+ * 学习目标：装配既有能力，并只在本次显式启用且非 Plan 时加载项目 Hook。
  * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
  * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
  * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
  *
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
  *   [KEEP 来自 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
- *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 只把名称/用途交给模型和启动信息
+ *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 名称/用途交给模型和启动信息
+ *   项目 Hook 开关且非 Plan？-- 是 -> 校验同根 hooks.json -> 传给模型/任务
+ *                              +-- 否 -> 不读取配置、不启动脚本
  *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
  *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
  *                            +-- 是 -> 继续检查运行方式
@@ -37,6 +39,8 @@
  */
 
 // [KEEP 来自 18.1] 本地记忆动作在模型配置与会话创建前完成。
+// [CHANGED 20.1] 项目脚本必须由本次启动显式启用。
+import { loadHooks } from "./hooks/lifecycle.js";
 // [KEEP 来自 19.1] 固定项目目录发现元信息，不加载正文。
 import { discoverSkills, skillInfo } from "./skills/catalog.js";
 import { createMemoryController, memoryCommand } from "./memory/commands.js";
@@ -81,7 +85,7 @@
 }
 // [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
 // [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
-type CliOptions = Options & { memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
+type CliOptions = Options & { enableProjectHooks?: boolean;  memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
 const program = new Command();
 program
   // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
@@ -90,6 +94,8 @@
   .version(packageJson.version, "-v, --version", "显示版本号")
   .helpOption("-h, --help", "显示帮助")
   // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
+  // [CHANGED 20.1] 仅这次启动授权项目生命周期脚本；恢复会话不恢复启用状态。
+  .option("--enable-project-hooks", "明确启用项目 .hello-my-agent/hooks.json 中的脚本")
   .option("--doctor", "显示当前运行环境")
   // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
   .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
@@ -207,7 +213,9 @@
     // [KEEP 来自 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
     const memory = await createMemoryController(project.root);
     const skills = await discoverSkills(project.root);
-    const model = createModel(config, project, memory, skills);
+    // [CHANGED 20.1] Plan不读取/运行钩子；执行模式没有显式开关也不读取。
+    const hooks = await loadHooks(project.root, Boolean(options.enableProjectHooks) && mode !== "plan");
+    const model = createModel(config, project, memory, skills, hooks);
     for (const line of skillInfo(skills)) console.error(line);
     for (const line of projectInstructionInfo(project)) console.error(line);
     // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,7 @@
 /**
- * 19.3 模型选择与资源读取 | [CHANGED] agent/agent-loop.ts
+ * 20.1 执行前钩子与显式启用 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：把同一技能状态传入真实工具；load后下一system带正文，resource由原调用结果回模型。
+ * 学习目标：在本次审批后、工具启动前等待项目检查；检查拒绝或失败也要给原调用留下结果。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -51,6 +51,7 @@
  *                  |  次数已用完时不取走剩余补充，界面队列仍保留
  *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
  *                                       +-- 否 -> 保存 assistant 调用 -> C
+ *   [CHANGED 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
  *   C: [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
  *                                                             +-- 否 -> 原有 deny / ask / allow
  *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
@@ -58,8 +59,8 @@
  *                                                             +-- 批准 -> 执行 -> D
  *      [KEEP 来自 18.2] propose_memory -> 完整正文/依据预览 -> allow_once -> 锁内保存
  *                     拒绝/取消不执行闭包；已保存结果回原调用，下一任务才刷新记忆
- *      [CHANGED 19.3] load_skill -> 完整接纳Map -> 成功摘要回D -> 下一请求system加入正文
- *      [CHANGED 19.3] read_skill_resource -> 已加载技能内有界读取 -> 文字/来源回D
+ *      [KEEP 来自 19.3] load_skill -> 完整接纳Map -> 成功摘要回D -> 下一请求system加入正文
+ *      [KEEP 来自 19.3] read_skill_resource -> 已加载技能内有界读取 -> 文字/来源回D
  *                     资源随原toolCallId结果进下一请求；失败同样有结果，取消走X
  *      allow -> 注册表找到工具 -> 执行 -> D
  *        [KEEP 来自 14.2] write_file / edit_file -> 先保存前后内容检查点，成功才实际写入
@@ -93,9 +94,11 @@
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
  * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
- * 运行观察：本地估算不是服务商计数或容量保证；服务商 usage 缺失时保持未知，摘要也有独立预算，失败或取消不采用候选；完整记录不删除。
+ * 运行观察：即使用户批准，before_tool 仍可阻止尚未执行的操作；原调用收到错误后模型才能继续判断。
  */
 
+// [CHANGED 20.1] 钩子在原审批完成后运行，不能创造批准。
+import { runHooks } from "../hooks/lifecycle.js";
 import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
 import { explainError, ToolError, UserFacingError } from "../errors.js";
 import { boundToolResult, clippedToolText } from "../context/tool-results.js";
@@ -150,7 +153,7 @@
   const context = options.context ?? emptyCompaction();
   // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
-  // [NEW 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
+  // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
   const toolOptions: RunOptions = { ...options, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
   const turn: Message[] = [{ role: "user", content: input }];
   let inputTokens: number | null = 0;
@@ -360,6 +363,11 @@
           // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
           // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
           // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
+          // [CHANGED 20.1] 取消或before失败时尚未启动工具。
+          if (mode !== "plan") {
+            const before = await runHooks(model.hooks, "before_tool", { call }, signal);
+            if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
+          }
           const result = prepared
             ? await executePreparedTool(prepared, signal)
             : await executeTool(call, signal, toolOptions);
```

</details>

<!-- generated:build:end -->

## 运行验证

先回到仓库根，编译本节完整快照：

```bash
npm run lesson:20.1
```

示例脚本也是完整 TypeScript。仓库中的 [examples/before-tool.ts](/content/chapter-20-hooks/examples/before-tool.ts.md) 与下方内容一致；跟写时将它保存为该文件，再编译。标准输出只写协议 JSON，错误信息写到标准错误。

<details>
<summary>展开完整项目脚本</summary>

```ts
/**
 * 20.1 执行前检查示例 | [NEW 练习] before-tool.ts
 * 学习目标：用项目脚本阻止写入 generated/；这是项目约定，不是操作系统沙箱。
 * 输入：Agent 在工具已获批准后写入 stdin 的单个 before_tool JSON。
 * 输出：stdout 只写一个 continue/message JSON；解析失败写 stderr 并非零退出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整读 stdin -> 对象/事件有效？-- 否 -> 失败退出；是 -> 写入或编辑？
 *     否 -> continue=true；是 -> 检查 path -> generated 内？-- 是 -> continue=false；否 -> true
 * 状态与观察：本脚本不改文件；拒绝时真实工具尚未启动，核心再把原因交回原调用。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

// [NEW 练习] 项目自定义 before_tool 协议实现。

/**
 * 等 stdin 结束后再解析一整份 JSON。
 * stdout 专供返回协议使用；输入或解析失败交给 main 的错误收尾。
 */
async function readInput(): Promise<unknown> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return JSON.parse(text);
}

/**
 * 要求已解析值为非数组对象，再允许调用者读取字段。
 * JSON 字符串、数组和 null 虽然合法，却不是这个协议所需的事件对象。
 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要对象");
  return value as Record<string, unknown>;
}

/**
 * 以当前工作目录为基准，比较 path 与 generated 的词法相对位置。
 * 结果只表达项目路径约定，没有解析符号链接，也不能作为文件系统隔离保证。
 */
function generated(path: string): boolean {
  const inside = relative(resolve("generated"), resolve(path));
  return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/**
 * 验证 before_tool 事件，只检查 write_file 与 edit_file 的 path。
 * 返回 continue=false 让核心阻止尚未开始的调用；其他工具按本项目规则通过。
 */
async function main(): Promise<void> {
  const event = object(await readInput());
  if (event.event !== "before_tool") throw new Error("不是 before_tool");
  const call = object(event.call);
  let blocked = false;
  if (call.name === "write_file" || call.name === "edit_file") {
    if (typeof call.arguments !== "string") throw new Error("缺少调用参数");
    const args = object(JSON.parse(call.arguments));
    if (typeof args.path !== "string") throw new Error("缺少 path");
    blocked = generated(args.path);
  }
  process.stdout.write(JSON.stringify(blocked
    ? { continue: false, message: "generated/ 由构建生成，请修改源文件。" }
    : { continue: true }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

</details>

仍在仓库根执行以下准备命令。临时项目的 `package.json` 固定工具工作区；脚本编译到这个项目自己的元数据目录。

```bash
export HMA_REPO="$PWD"
DEMO="$(mktemp -d)"
mkdir -p "$DEMO/.hello-my-agent/compiled" "$DEMO/generated" "$DEMO/src"
cat > "$DEMO/package.json" <<'JSON'
{"private":true,"type":"module"}
JSON
"$HMA_REPO/node_modules/.bin/tsc" "$HMA_REPO/chapter-20-hooks/examples/before-tool.ts" \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck \
  --outDir "$DEMO/.hello-my-agent/compiled"
cat > "$DEMO/.hello-my-agent/hooks.json" <<'JSON'
{
  "before_tool": [
    {
      "command": "node",
      "args": [
        ".hello-my-agent/compiled/before-tool.js"
      ],
      "timeout_ms": 5000
    }
  ]
}
JSON
cd "$DEMO"
```

启用项目检查，提交下面的单次请求。工具准备好写入预览后，批准这次操作；Hook 检查发生在批准之后。

```bash
hello-my-agent --enable-project-hooks --prompt "请用 write_file 在 generated/client.ts 创建 export const value = 1;，不要执行命令；若被阻止，解释原因。"
```

如果模型发出该调用，过程应显示执行前钩子阻止，且 `generated/client.ts` 不存在；同一调用的错误结果返回模型，最终说明由模型组织。模型是否严格选择该工具、错误后是否换路径，属于它的决定，不能只凭最终措辞证明检查生效。固定请求与文件断言见本章练习一。

把目标改为 `src/client.ts` 再试，项目规则允许后仍需原来的写入审批。省略 `--enable-project-hooks` 后，配置存在也不会运行；切到 `--mode plan` 后同样不运行脚本，写入由 Plan 策略拒绝。

实验结束后返回仓库根；临时项目可按需保留或删除。

```bash
cd "$HMA_REPO"
rm -rf "$DEMO"
```

## 本节完成后的 Agent

现在，受信任项目可以在工具启动前增加确定性约束。启用由本地参数决定，执行仍需原权限检查；脚本拒绝与失败会回到原工具调用。下一节把检查放到工具返回以后，让检查信息参与模型下一步判断。

本节已落地的实现与限制如上；本章已于 2026-10-15 按用户通知确认完成。
