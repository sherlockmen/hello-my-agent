# 09.3 让脚本读懂执行过程

[上一节：按顺序接收执行事件](../02-event-stream/README.md) · [第 09 章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

## 问题：脚本怎样知道某句话是回答，还是运行提示

前两节已经让终端按顺序接收一轮任务的开始、过程和结束。如果我们想写一个脚本统计工具调用，最直接的想法是保存终端输出，再查找“工具开始”“工具完成”这些文字。

但这些文字是给人阅读的，可能改写，也可能出现在模型回答本身。模型说“读取完成”，不代表文件工具真的执行过；一段回答里有换行，也不表示开始了一个新事件。脚本需要读取程序已经确认的事件字段，不能靠句子猜测状态。

## 解决方案：每行输出一条完整 JSON 记录

本节增加 `--output text|jsonl`。默认 `text` 保留面向人的终端显示；选择 `jsonl` 时，程序把上一节的事件封套逐条写出，每一行都是独立的 JSON 对象。

**JSONL** 是 JSON Lines 的简称，也就是“一行一份 JSON”。它使用 UTF-8，每行各自是合法 JSON，换行用来分隔记录。[JSON Lines 格式说明](https://jsonlines.org/)给出了这一约定。脚本每读完一行，就可以用 `JSON.parse()` 得到一个完整对象，不需要等整个任务结束后再解析一个大数组。

数据从哪里来仍然很清楚：Agent Loop 产生模型、工具和权限事件，任务入口补上开始与结束，事件流加上本轮编号和顺序号，JSONL 消费者负责逐行写出。模型不需要学会这个格式，也不负责拼这些 JSON。

## 工作原理

### 一行里的换行符，为什么不会拆成两条记录

假设一次文字事件的正文是两行：

```text
先构建项目。
再启动命令。
```

写成 JSONL 后，正文中的换行会被 `JSON.stringify()` 转成 `\n`。文件中实际仍只有下面这一行：

```json
{"version":1,"runId":"本轮生成的唯一编号","sequence":5,"event":{"type":"text_delta","call":2,"text":"先构建项目。\n再启动命令。"}}
```

这一行末尾才是分隔记录的真实换行。脚本读取整行后调用 `JSON.parse()`，字段 `event.text` 里的 `\n` 又会还原成正文换行。引号、反斜杠也由同一个序列化函数处理，所以不要手工拼 JSON 字符串。

消费者仍然要看 `event.type`。`text_delta` 只是一段用于显示的文字；确认本轮结果时，要等待 `run_finish`，检查它的结束状态。流中已经出现文字，不能代替成功结束。

### 标准输出留给数据，诊断走标准错误

命令行程序通常有两个输出通道。**标准输出**是 `stdout`，常用于把结果交给文件或下一条命令；**标准错误**是 `stderr`，适合显示运行提示和失败诊断。它们在终端里可能出现在一起，但可以分别重定向。

JSONL 模式约定 `stdout` 只包含事件记录。欢迎语、颜色控制字符或一行“用量：……”都不能混进去，否则脚本读到这一行时，`JSON.parse()` 就会失败。任务中的失败通过结束事件表示；需要给人看的诊断放到 `stderr`。

文本模式也沿用这个分工：模型文字写到 `stdout`，步骤、审批与用量说明写到 `stderr`。这样把回答保存到文件时，过程提示仍可以留在终端；而需要准确区分事件的脚本，应选择 JSONL 模式。

退出码再给外层脚本一个简短结果：正常完成为 `0`，失败为 `1`，用户取消为 `130`。脚本可以据此决定是否继续下一步；需要知道哪一个工具发生了什么，再读事件里的细节。

### JSONL 模式只接收一次提问

本节要求 `--output jsonl` 同时提供 `--prompt`。一次命令对应一轮任务，标准输出里也只有这一轮的事件。没有给 `--prompt` 时，程序直接给出用法错误，不进入连续聊天。

这里同样没有交互审批。模型请求普通项目文件时，原来的只读策略仍可允许；模型请求修改文件或运行命令时，原来的 `ask` 会得到默认拒绝。拒绝结果继续交回模型，模型可以据此说明没能完成什么，或者选择允许的下一步。

因此，某次工具被拒绝不一定让整轮失败。如果模型收到拒绝后正常给出回答，结束状态仍可能是 `completed`。它表示这轮对话走完了，并不把被拒绝的操作变成成功。脚本要验证文件是否写入，不能只看退出码 `0`。

### 输出慢了先等待，输出断了就停止

输出管道不一定能立即接收所有内容。JSONL 消费者每写一行，都等待这次写入完成，再从事件流取下一条；已有的事件队列吸收期间的速度差。这里的“写入完成”只表示这段数据已由输出流处理，不表示下游脚本已经解析，也不保证文件已经持久保存到磁盘。[Node.js 的 write 回调说明](https://nodejs.org/docs/latest-v22.x/api/stream.html#writablewritechunk-encoding-callback)区分了这一点。

如果下游程序关闭了管道，继续请求模型和执行工具已经没有输出接收者。写入失败会让消费者退出迭代，上一节的清理分支随即取消本轮，并等待核心清理完成，然后让命令以失败结束。

用户在等待输出时按 Ctrl+C，也要解除当前写入等待。程序先结束消费并等待 Agent 清理；如果输出依然堵着，就放弃未写完的输出，并以 `130` 退出。因此，接收端可能只收到半行，或者没有收到最后的结束记录，不能只靠文件的最后一行判断这次取消。

如果输出只是一直很慢，待处理事件最终达到上一节的队列上限，本轮也会停止。它不会悄悄删掉一半文字再当作正常完成，也不会把积压事件无限保存在内存中。输出已经断开时，程序无法保证最后的结束记录还能写到接收端；外层还需要检查进程退出状态。

### 这些记录还不是会话存档

JSONL 只是数据的排版方式。把这次输出保存成文件，可以事后查看发生了什么；但当前程序没有实现读取这份文件、恢复会话、定位中断位置和避免重做工具的流程。第十三章会继续处理这些问题。

同时，序列化没有自动脱敏。事件可能包含用户问题、完整工具参数和工具返回内容，模型回答也可能引用本地文件。需要保存或分享时，应按实际用途选择字段、限制内容并处理敏感信息；不能因为每行都是合法 JSON，就把它当作适合公开的日志。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/ui/jsonl.ts](src/ui/jsonl.ts) | 每次等待一行 JSON 写入，非交互审批默认拒绝，输出失败时停止本轮 |
| CHANGED | [src/cli.ts](src/cli.ts) | 增加输出选项，检查参数并选择消费者 |
| CHANGED | [src/ui/terminal.ts](src/ui/terminal.ts) | 模型文字留在标准输出，步骤、审批与本地状态改到标准错误 |

## 动手构建

把 09.2 的完整 `src/` 复制到 `chapter-09-observable-runs/03-jsonl-output/src/`。本节新增 JSONL 消费者，并让命令入口选择文本或 JSONL 输出。

### 新增逐行写出事件的消费者

新增 `ui/jsonl.ts`，完整文件如下：

```ts
/**
 * 09.3 让脚本读懂执行过程 | [NEW] ui/jsonl.ts
 *
 * 学习目标：把一次任务的事件输出约定固定下来，让脚本逐行读取 JSON。
 * 输入：已创建的模型和 --prompt；SIGINT 与 stdout 错误也会通知本轮停止。
 * 输出：stdout 每行一条 AgentRecord；取消说明与 CLI 错误使用 stderr。
 * 状态：本次使用空历史；ask 默认拒绝。失败或取消等待核心清理，但不回滚已发生的操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [NEW] 注册 SIGINT / stdout error -> streamAgentRun（ask 返回 deny）
 *   下一条记录 -> stdout 已出错？-- 是 -> 抛错并结束消费
 *                               +-- 否 -> JSON.stringify + 换行 -> write
 *   write -> 回调成功 -> 读取下一条；流读完 -> 清理监听 -> 返回
 *         +-> 回调失败 / stdout error -> 停止消费 -> 等生成器清理 -> 向 CLI 抛错
 *   SIGINT -> 尚未取消？-- 否 -> 保留原停止原因
 *                       +-- 是 -> abort -> 拒绝当前写入等待 -> 停止消费
 *   用户取消后 -> 等模型与工具清理 -> stderr 说明、exitCode=130 -> 清理监听
 *            -> 写入回调仍未结束？-- 是 -> process.exit(130)
 *                                 +-- 否 -> 正常返回
 *
 * JSONL 指每一行都是独立 JSON；字符串中的换行会编码成转义，不会拆成多条记录。
 * 写入回调完成后才消费下一条，避免在本消费者里无限积累待写行；慢输出仍可能让事件队列超限。
 * 下游保持管道打开却不读取时，write 回调可能一直不结束。取消会解除 Promise 等待，
 * 但系统写请求仍可能让 Node 进程无法退出，所以先等 Agent 清理，再在这个窄分支主动退出。
 * 主动退出可能留下半行或缺少 run_finish；脚本读取 JSONL 时必须同时检查进程退出状态。
 * JSON 编码不是脱敏，记录可能包含完整问题、工具参数、模型与工具正文，不应直接当作公开日志。
 * 运行观察：--output jsonl --prompt 的 stdout 可逐行 JSON.parse，审批输入不会阻塞脚本。
 */
import { streamAgentRun } from "../agent/run-stream.js";
import { UserFacingError } from "../errors.js";
import type { Model } from "../models/client.js";

// [NEW 09.3] 本文件以下实现均为本节新增。
/**
 * 运行一次提问，把每条执行记录写成独立的一行 JSON，供另一个程序读取。
 *
 * - 输入：已创建的模型和已校验的 prompt；本次使用空历史，不进入连续聊天。
 * - 输出：stdout 每行一个完整 AgentRecord，不加终端标签、颜色或教学摘要。
 * - 写入顺序：等待当前 write 回调结束再取下一条；回调完成只表示交给输出流，不代表下游已经处理。
 * - 审批规则：遇到 ask 直接返回 deny；不创建输入读取器，也不从管道文字推断用户批准。
 * - 取消处理：首次 SIGINT 取消同一轮，也拒绝正在等待的写入 Promise；结束消费时先等生成器清理模型与工具。
 * - 失败方式：stdout 出错会请求取消，退出消费时等待核心清理，再将可显示的错误交给 CLI。
 * - 退出方式：用户取消后设退出码 130 并清理监听；写入回调仍未完成时才主动 process.exit(130)。
 * - 取舍原因：拒绝 Promise 没有取消系统写请求，单设 exitCode 仍可能等管道；主动退出则可能丢掉半行或结束记录。
 * - 数据边界：JSON.stringify 只编码数据；原始问题、工具参数和正文仍可能包含敏感信息。
 * - 职责边界：消费端要结合退出状态判断结果是否完整；已经发生的工具副作用不会撤销。
 */
export async function runJsonlPrompt(model: Model, prompt: string): Promise<void> {
  const controller = new AbortController();
  let outputError: Error | undefined;
  let interrupted = false;
  // 只在 write 回调结束时清空；取消 Promise 等待，并不代表系统写入已经结束。
  let writing = false;
  // 只接受首次停止原因；如果输出故障已经触发取消，随后按 Ctrl+C 不把它改记为用户取消。
  const stop = () => {
    if (controller.signal.aborted) return;
    interrupted = true;
    controller.abort();
  };
  // 以可显示错误取消，让核心历史与 run_finish 都记录 error，而不是用户取消。
  const onOutputError = (error: Error) => { outputError = error; controller.abort(new UserFacingError("标准输出已关闭或写入失败。")); };
  process.on("SIGINT", stop);
  process.stdout.on("error", onOutputError);
  try {
    const records = streamAgentRun(model, [], prompt, controller.signal,
      async () => ({ decision: "deny", reason: "JSONL 模式不交互审批，本次操作未获批准" }));
    for await (const record of records) {
      if (outputError) throw outputError;
      // 等 write 回调后才继续拉取；这确认本行已交给输出流，并不确认下游已经处理。
      await new Promise<void>((resolve, reject) => {
        // 管道保持打开却没人读取时，write 回调可能不返回；abort 让消费者能先结束等待。
        const stopWriting = () => {
          reject(controller.signal.reason);
        };
        controller.signal.addEventListener("abort", stopWriting, { once: true });
        writing = true;
        process.stdout.write(`${JSON.stringify(record)}\n`, (error) => {
          // 只有真实回调才说明这次写入结束；正常完成时也要移除单次取消监听。
          writing = false;
          controller.signal.removeEventListener("abort", stopWriting);
          if (error) reject(error); else resolve();
        });
        // 信号可能在监听建立前已经取消，补查一次，避免留下无法解除的写入等待。
        if (controller.signal.aborted) stopWriting();
      });
    }
  } catch (error) {
    // 首次原因为用户取消时保持 130，不让随后出现的输出错误覆盖它。
    if (interrupted) {
      process.exitCode = 130;
      console.error("本次任务已取消。");
    } else {
      if (outputError) throw new UserFacingError("标准输出已关闭或写入失败，任务已停止。已执行的操作不会自动撤销。");
      throw error;
    }
  } finally {
    // for await 退出已等待生成器清理真实任务，再移除这个消费者的进程与输出监听。
    controller.abort();
    process.off("SIGINT", stop);
    process.stdout.off("error", onOutputError);
  }
  // Agent 已清理完，但未完成的系统写请求仍可能阻止 Node 退出，单设 exitCode 无法解除它。
  // 仅在用户取消且写入仍未完成时主动退出；这会放弃剩余输出，可能留下半行或缺少结束记录。
  if (interrupted && writing) process.exit(130);
}
```

这个入口没有创建 `readline`，遇到需要确认的调用就返回拒绝。它也没有直接调用工具，仍由 `streamAgentRun()` 进入相同核心。

每次循环只写当前这一行。`write` 的回调放进 Promise，成功就继续取下一条；这次等待也监听取消，避免下游不再读取时 Ctrl+C 仍然卡住。退出迭代后先等待流的清理，只有用户已经取消且输出仍未写完时，才用 `process.exit(130)` 放弃剩余输出；其他情况仍正常返回。

`SIGINT` 与输出错误分别记录，才能把用户取消的 `130` 与输出故障的 `1` 区分开。

### 在命令入口选择输出方式

在 `cli.ts` 的导入区加入：

```ts
// [NEW 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
```

把 `CliOptions` 替换为：

```ts
// [CHANGED 09.3] output 只供入口选择消费者，不并入模型连接配置。
type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string };
```

在 `--provider` 选项后加入 `--output`，并把紧随其后的 `.action(...)` 整段替换为下面内容。此前的选项，以及文件末尾的 `parseAsync()` 和错误处理保持原样：

```ts
// [NEW 09.3] 输出格式只影响消费者，不改变模型与工具协议。
.option("--output <format>", "输出格式：text 或 jsonl", "text")
// [CHANGED 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
.action(async () => {
  const options = program.opts<CliOptions>();
  if (options.doctor) {
    printDoctor();
    return;
  }
  // [NEW 09.3] 启动前明确机器模式的输入与输出约定。
  if (!["text", "jsonl"].includes(options.output ?? "text")) throw new UserFacingError("--output 只能是 text 或 jsonl。");
  if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
  const config = readConfig(options);
  const model = createModel(config);
  if (options.prompt === undefined) {
    await startTerminal(model);
    return;
  }
  if (!options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
  // [CHANGED 09.3] 两种显示方式共用核心。
  if (options.output === "jsonl") await runJsonlPrompt(model, options.prompt);
  else await runSinglePrompt(model, options.prompt);
});
```

输出选项先检查，再读取模型配置。这样缺少 `--prompt` 时可以直接说明用法问题，也不会先启动任务。`--help`、`--version` 和 `--doctor` 仍是独立的文字入口，不产生任务事件；读取 JSONL 时不要把这些诊断选项混到执行命令里。

### 把文本终端的提示移到标准错误

JSONL 消费者没有使用文本显示器，所以它的标准输出已经只含 JSON。接下来调整 `ui/terminal.ts`，让文本模式也把模型正文和运行提示分开。

先用下面的实现替换 `printProgress()`，原来的函数说明保留：

```ts
// [CHANGED 09.3] 过程记录写入 stderr，stdout 留给模型文字。
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.error(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.error(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.error(line);
  }
}
```

然后在 `createApprovalHandler()` 里，把显示审批请求、原因、预览和选择提示的部分替换为：

```ts
console.error(`审批请求：${request.call.name} 将访问 ${request.resource}`);
console.error(`原因：${request.reason}`);
// [KEEP 来自 06.1] 审批界面展示工具准备的完整操作，不用模型的承诺代替预览。
// [KEEP 来自 07.1] 同一处审批既展示文件 diff，也展示命令和 cwd。
if (request.preview) console.error(`操作预览：\n${request.preview}`);
process.stderr.write(request.allowSession
  ? "请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝："
  : "请选择：[y] 执行这次操作，[N] 拒绝：");
```

`printSessionGrants()` 也只显示本地状态，把该函数替换为：

```ts
// [CHANGED 09.3] 本地状态写入 stderr。
function printSessionGrants(sessionGrants: ReadonlySet<string>): void {
  if (sessionGrants.size === 0) {
    console.error("本次会话没有已批准的权限范围。");
    return;
  }
  console.error("本次会话已批准：");
  for (const scope of sessionGrants) console.error(`- ${scope}`);
}
```

`startTerminal()` 中的输入回显、欢迎语、输入提示、重置说明和取消说明一起改到标准错误。为避免遗漏分散的位置，把该函数替换为下面内容，原来的函数说明保留：

```ts
// [CHANGED 09.3] 输入提示与本地交互输出使用 stderr。
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  const sessionGrants = new Set<string>();
  let active: AbortController | undefined;
  let exiting = false;
  const stop = () => {
    if (active) {
      active.abort();
      lines.clear();
      // [KEEP 来自 08.3] 丢弃未按回车的审批草稿，避免 y 残留成下一轮的 ynext。
      if (terminal) {
        input.write(null, { ctrl: true, name: "u" });
        input.write(null, { ctrl: true, name: "k" });
        process.stderr.write("\n");
      }
      return;
    }
    exiting = true;
    input.close();
    process.exitCode = 130;
  };
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.error("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stderr.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        console.error("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      active = new AbortController();
      const renderer = createTurnRenderer();
      try {
        // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
        const reply = await showRun(streamAgentRun(model, history, text, active.signal,
          requestApproval, sessionGrants), renderer);
        renderer.reply(reply);
        process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.error("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
          process.exitCode = 0;
        } else {
          console.error(`错误：${explainError(error)} 已保留本轮状态，可以继续输入；程序不会自动重试。`);
          process.exitCode = 1;
        }
      } finally {
        // 必须先等请求或工具完成清理，再允许下一轮使用新信号。
        active = undefined;
      }
    }
  } finally {
    active?.abort();
    lines.dispose();
    input.off("SIGINT", stop);
    input.close();
    process.off("SIGINT", stop);
  }
}
```

单次模式也可能等待审批。在 `runSinglePrompt()` 开头，把创建输入接口的部分替换为：

```ts
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const input = interactive
  ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  : undefined;
```

最后把 `printReply()` 替换为：

```ts
// [CHANGED 09.3] 正文写入 stdout，用量与提示写入 stderr。
export function printReply(reply: Reply, showText = true): void {
  if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.error(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.error("提示：回答达到输出上限，可能尚未完整。");
}
```

逐段显示文字的 `createTurnRenderer()` 继续写入标准输出。至此，回答正文、过程提示和结构化事件各自经过已经选定的消费者，核心无需了解它们最后显示在哪里。

## 运行验证

在仓库根目录构建本节：

```bash
npm run lesson:09.3
```

再把同一次读取任务保存为 JSONL：

```bash
hello-my-agent --output jsonl --prompt "请调用 read_file 读取 README.md，告诉我这个项目怎样启动。" > /tmp/hello-my-agent-run.jsonl
```

命令结束后，立即在同一个终端运行下面的命令。`$?` 只保存该终端上一条命令的退出码，中间不要先运行解析脚本，也不要另开终端：

```bash
echo $?
```

正常完成时预期为 `0`。输出文件应从 `run_start` 开始，以唯一的 `run_finish` 结束；中间能看到模型请求、读取事件和回答文字。真实模型是否按要求调用工具仍取决于服务，本章固定检查会用确定输入验证这些结构。

用 Node.js 逐行解析，并打印顺序号与事件名：

```bash
node --input-type=module -e 'import { readFileSync } from "node:fs"; const records = readFileSync("/tmp/hello-my-agent-run.jsonl", "utf8").trim().split("\n").map(JSON.parse); for (const record of records) console.log(record.sequence, record.event.type);'
```

如果每一行都能解析，说明没有把普通终端提示混到数据中。序号应从 1 开始连续增加，而且同一文件里的 `runId` 保持一致。取消、失败和输出断开的分支由固定检查使用可控输入确认。

### 确认参数限制

只选择 JSONL、不提供提问：

```bash
hello-my-agent --output jsonl
```

预期在标准错误中提示必须提供 `--prompt`，退出码为 `1`，标准输出没有任何 JSONL 任务事件，因为任务还没有开始。

### 完成本章的固定检查

使用完整配套仓库并完成 09.3 后，在仓库根目录运行：

```bash
npm run check:09
```

这些检查使用本地模型替身，验证事件与输出约定，不访问真实模型服务。它们不能代替真实服务的账号配置与回答质量验证。

## 本节完成后的 Agent

同一个 Agent 现在有两种输出：文本终端按人阅读的方式显示，JSONL 消费者按脚本读取的方式逐行写出。两者接收相同的模型、工具、权限与结束事件，执行逻辑仍在原有核心中。

先做[章末练习](../EXERCISES.md)，再进入 [10.1 把对话放进一个界面](../../chapter-10-terminal-ui/01-first-screen/README.md)。下一章先让用户在 React / Ink 界面中完成一次问答，再把本节的事件转换成当前显示状态。文字、模型步骤和工具状态因此能够随执行变化，审批和取消也继续接回原有核心。
