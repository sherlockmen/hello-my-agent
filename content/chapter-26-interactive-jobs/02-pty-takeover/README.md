# 26.2 把真实终端交给交互程序

[第 26 章首页](/content/chapter-26-interactive-jobs/README.md) · [上一节：26.1 后台作业](/content/chapter-26-interactive-jobs/01-background-jobs/README.md) · [本章练习与答案](/content/chapter-26-interactive-jobs/EXERCISES.md)

## 问题：后台进程还在等输入

26.1 能让命令继续运行，并在工具返回后持续保存日志。但它启动的是非交互 pipe 作业，父侧 stdin 已经关闭。现在启动一个询问名字的脚本：`read name` 收到 EOF，不能等待我们在 Agent 输入框里回答。即使把 stdin 一直留着，直接转发聊天文字也没有解决问题：终端的回显、Ctrl+C、窗口大小和全屏应用需要的控制信息仍然缺失。

更直接的冲突是键盘归谁。Agent 的输入框和交互脚本若同时读取同一份 stdin，输入的名字可能变成新问题，退出子程序的 Ctrl+C 也可能取消模型回答。我们需要一个真正的子终端，以及一次明确的输入交接。

## 解决方案：创建 PTY，再由人类独占接管

`start_job` 增加 `transport`：省略时仍是 `pipe`；需要人工交互时选 `pty`。PTY 是操作系统提供的伪终端，子进程连接它之后，可以把 stdin/stdout 当作终端使用。本节通过 `node-pty` 创建真实 PTY，并保留原来的 JobID、审批、运行期限和日志限额。[node-pty 官方说明](https://github.com/microsoft/node-pty)

例如模型按批准的命令启动“输入名字、打印结果后继续等待输入”的 PTY 作业。工具返回 JobID 后，模型这一轮先结束；用户在空闲 TUI 输入 `/fg <JobID>`，Ink 暂停读取键盘和绘制画面，接管桥把真实终端输入送给这个 PTY。用户输入 `Ada`，子程序打印 `HELLO:Ada`；按 Ctrl+] 可以把终端还给 Agent，作业继续运行。以后再接管同一个 JobID，或用 `/stop` 明确停止。

模型仍只有启动、观察和停止三个入口，没有向作业写 stdin 的工具。`/fg` 来自用户的本地命令；它不会作为一条聊天消息提交，也不会让接管期间的输入变成模型消息。

## 工作原理

### pipe 与 PTY 保留不同的完成证据

`spawnJobTransport` 把两种进程连接方式接到同一个管理器，但没有把 pipe 伪装成终端。

| 观察对象 | pipe 作业 | PTY 作业 |
| --- | --- | --- |
| 创建方式 | Node `child_process.spawn` | `node-pty.spawn` 在本章 POSIX 系统上创建伪终端 |
| 输入 | 父侧立即 `end()`，非交互 EOF | 保留终端输入，由当前接管者写入 |
| 输出 | 分别读取 stdout、stderr，再合进尾日志 | 终端输出本来就在同一通道中，不能再区分两条流 |
| 窗口信息 | 没有终端行列数 | 接管时设置当前尺寸，并继续转发 resize |
| 结束依据 | 子进程和 stdio 的 `close` | `node-pty` 的退出通知，并解除本地订阅 |

创建 PTY 时先用 80×24；`/fg` 时读取当前 stdout 的 `columns`、`rows`，再设置子终端。因此把窗口从 80 列缩到 40 列，子程序获得的是新的终端宽度，可以自行重排；管理器没有把旧文本重新折行来冒充 resize。接管前积累的有界尾日志先显示一次，此后的实时输出直接写到终端，同时继续进入有界日志。

`start_job` 返回仍只证明已创建了进程。PTY 的原生启动异常会成为工具错误，附上依赖重建方向；另一些失败发生在进程已经取得 PID 之后，例如子进程切换目录失败并退出。必须再读取退出状态和日志，不能把所有错误都归成“尚未启动”。原生依赖的构建与真实终端检查见[环境准备](/content/docs/SETUP.md?id=%E7%AC%AC%E4%BA%8C%E5%8D%81%E5%85%AD%E7%AB%A0%E9%9C%80%E8%A6%81%E7%9A%84%E7%9C%9F%E5%AE%9E-pty-%E4%BE%9D%E8%B5%96)。

### `/fg` 怎样保证只有一个键盘读者

TUI 只在当前模型轮结束后受理 `/fg`。它先用 `suspendTerminal` 暂停 Ink 底层的 stdin 读取和终端输出，再运行接管桥；接管结束后恢复同一棵 React 组件树并重绘。React 组件中的输入订阅保持原样，`session.external` 同步阻止业务提交，避免恢复 stdin 后还要等待输入框重新激活、漏掉第一条新聊天。草稿、聊天历史和作业登记表仍由原会话持有。[Ink 的终端暂停接口](https://github.com/vadimdemedes/ink#suspendterminalcallback)

接管桥先检查真实 stdin/stdout 都是 TTY，再向 `JobManager.attach` 申请这个作业的独占句柄。管理器只接受当前登记表中仍在 running 的 PTY；pipe、旧 JobID、已退出作业或已经被接管的 PTY 都会拒绝。登记表保存一个本地生成的 owner，写入和 resize 每次都复查它。detach 撤掉 owner 和输出监听后，旧闭包再写入也会失败。

桥把外层终端设成 raw 模式，以取得按键字节；它监听 `readable`，用 `stdin.read()` 拉取输入，每次持续读到 `null`，让下一次可读通知能够重新到来。桥没有切到持续消费的 flowing 模式，因此撤下监听、Ink 尚未恢复的间隙，新到的输入仍能留在流缓冲区中。若只依靠“最后关掉一个 data 监听”，这段间隙的字节可能已经被流消费，回来后第一条聊天就会缺字。

### 三个控制键分别交给谁

接管期间，普通输入和 Ctrl+C、Ctrl+D 的字节都写入子 PTY。外层 raw 模式使 Ctrl+C 不再先变成本地 Node 的 SIGINT；子终端若启用通常的信号行规，会把它解释为给子程序前台进程组的中断。子程序可以处理或忽略该信号，所以按 Ctrl+C 也不能直接推断进程已经退出。[Node 的 raw 模式说明](https://nodejs.org/api/tty.html)

Ctrl+D 在这里也不是关闭 PTY 的方法：它是交给子终端的 `0x04`。通常的 canonical 行模式下，空行时按它会让下一次读取获得 EOF；若当前已有字符，会先交付那些字符。处于 raw 模式的子应用则可以自行解释这个键。因而全屏编辑器与普通 `read`、`cat` 的表现可能不同。

Ctrl+] 由接管桥截获，含义是分离。它把该字节前面的输入交给 PTY，随即停止接受新输入，并把本次读取中已缓冲的剩余内容消费后丢弃，直到 `read()` 返回 `null`。随后解除输入、窗口与退出监听，释放 owner 并恢复原 raw 状态。这些剩余字节既不写入子程序，也不冒充返回后的聊天；等“已收回终端”出现后再输入下一条问题。临时接管操作被取消也只做分离；停止作业仍需 `/stop`、获批的 `stop_job`、期限到达或整次 CLI 退出。

接管桥也在等待作业退出。比如 `cat` 在空行收到 EOF 后自然结束，管理器收到 PTY 的退出结果，更新状态并按 JobID 通知桥；桥随即停止接收输入，结束等待，进入与分离相同的 `finally` 清理：撤销监听、释放 owner、恢复原 raw 状态。这时不需要再按 Ctrl+]；Ctrl+C 或运行期限若确实导致作业退出，也会沿这条路径自动归还终端。

桥返回后，外层还要等待 `suspendTerminal` 恢复终端，TUI 才显示“已收回终端；/job核对状态，/stop显式停止。”这个反馈证明输入已交还，不证明子进程已退出。

### 接管观察怎样回到模型

用户输入名字后，交互输出会进入管理器的尾日志，但不会自动追加一条工具消息。`/job` 只提供本地查看；模型需要再次调用 `read_job`，取得同一个 JobID 的新快照。该结果仍按本次工具调用编号进入历史，下一次模型请求才据此判断名字是否被读取、作业还在运行，或者已经退出。

读取结果会同时考虑状态、退出码、终止信号和停止原因。尤其 PTY 可能报告退出码 0 同时带有终止信号，不能只看到 0 就写“成功完成”。启动失败、非零退出、信号或停止原因都会成为后续判断的依据。

整次 CLI 退出时先取消并等待接管桥归还终端，再调用 `jobs.close()`。pipe 等待 close，PTY 等待 `node-pty` 的退出通知、解除本地订阅，并完成向自有进程组的停止请求。这个保证不等于能追踪自行脱离原进程组的所有后代，也不承诺无限保留尾输出。停止仍不会回滚已写文件或已发出的网络请求；用户原有服务不在登记表内，不会因为模型给出一个 PID 就被接管或停止。

<!-- media:lesson:start -->
下面沿J1的一次接管追踪键盘owner：输入与尺寸进入真实PTY，Ctrl+]归还聊天但不停止进程，再接管后实际EOF才可能退出。最后的read_job是单独工具观察，不是接管自动触发。

<img src="./content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-cover-ff67b5a416.png" data-gif-src="./content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-983b522717.gif" data-cover="./content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-cover-ff67b5a416.png" data-no-zoom alt="接管PTY时，谁拥有这一刻的键盘？">

[静态流程图](/content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-flow-b7ec0e2586.png.md) · [静态封面](/content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-cover-ff67b5a416.png.md) · [查看完整静态分镜](/content/chapter-26-interactive-jobs/02-pty-takeover/assets/pty-terminal-owner-storyboard-a23630a0dc.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/processes/job-transport.ts](/content/chapter-26-interactive-jobs/02-pty-takeover/src/processes/job-transport.ts.md) | 分别启动 pipe 与真实 PTY，保留各自输入、尺寸与退出依据。 |
| NEW | [src/processes/takeover.ts](/content/chapter-26-interactive-jobs/02-pty-takeover/src/processes/takeover.ts.md) | 在 Ink 暂停期间独占 stdin，转发按键与尺寸，并在分离后归还终端。 |
| CHANGED | [src/processes/jobs.ts](/content/chapter-26-interactive-jobs/02-pty-takeover/src/processes/jobs.ts.md) | 登记 transport，为运行中的 PTY 授予独占接管句柄，并复查 owner。 |
| CHANGED | [src/tools/job-tools.ts](/content/chapter-26-interactive-jobs/02-pty-takeover/src/tools/job-tools.ts.md) | 验证 transport 参数，保持逐次审批，并结合信号和停止原因报告结果。 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-26-interactive-jobs/02-pty-takeover/src/ui/terminal.ts.md) | 在普通文本入口解释人工接管需要 TUI，不抢用聊天输入。 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-26-interactive-jobs/02-pty-takeover/src/ui/tui/app.tsx.md) | 空闲时暂停 Ink 并接管，退出时先等终端归还再清理作业。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 26.1 的完整 `src/` 继续。本节目标目录是 `chapter-26-interactive-jobs/02-pty-takeover`。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线。

本节新增原生依赖 `node-pty@1.1.0`。自己跟写时先按[真实 PTY 依赖准备](/content/docs/SETUP.md?id=%E7%AC%AC%E4%BA%8C%E5%8D%81%E5%85%AD%E7%AB%A0%E9%9C%80%E8%A6%81%E7%9A%84%E7%9C%9F%E5%AE%9E-pty-%E4%BE%9D%E8%B5%96)补装并完成原生构建；配套仓库的小节命令会自动执行源码重建。缺少构建工具或匹配 Node 头文件时，先处理原生构建错误，再继续下面的运行验证。

<!-- generated:build:start -->

<details>
<summary>NEW：src/processes/job-transport.ts 的完整文件</summary>

<!-- source: src/processes/job-transport.ts -->
```ts
/**
 * 26.2 真实PTY | [NEW] processes/job-transport.ts
 *
 * pipe 经 child_process.spawn，PTY 经 node-pty.spawn/forkpty；两者绝不互相冒充。
 * pipe 明确交付EOF；PTY保留终端行规、信号、回显与窗口大小，由人类独占接管。
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";
import * as pty from "node-pty";
import { ToolError } from "../errors.js";
import { processEnvironment } from "./run-process.js";

// [NEW 26.2] transport只暴露本次创建的句柄；不能用任意PID构造它。
export type Transport = {
  readonly pid: number | undefined; started: Promise<void>;
  finished: Promise<{ code: number | null; signal: string | null; error?: Error }>;
  onData(listener: (data: string) => void): () => void;
  onExit(listener: () => void): () => void;
  kill(signal: NodeJS.Signals): void;
  write?(data: string): void; resize?(cols: number, rows: number): void;
};
/** 把node-pty的数字信号转成可核查名称；0代表正常退出而非SIG0。 */
function signalName(value?: number): string | null {
  return value ? Object.entries(constants.signals).find(([,number]) => number === value)?.[0] ?? String(value) : null;
}
/** 为真实进程提供同一观察面；stdout/stderr在PTY中天然合并，不能声称仍有两条流。 */
export function spawnJobTransport(command: string, cwd: string, transport: "pipe" | "pty"): Transport {
  const events = new EventEmitter();
  /** 订阅函数返回解除入口，避免每次fg/detach遗留监听。 */
  const listen = (event: string, listener: (...args: any[]) => void) => { events.on(event, listener); return () => { events.off(event, listener); }; };
  if (transport === "pty") {
    let terminal: pty.IPty;
    try { terminal = pty.spawn("/bin/sh", ["-c", command], { cwd, env: processEnvironment(), name: "xterm-256color", cols: 80, rows: 24 }); }
    catch (error) { throw new ToolError(`真实PTY启动失败：${error instanceof Error ? error.message : "未知原因"}。请检查node-pty原生依赖；可使用npm_config_build_from_source=true npm rebuild node-pty --foreground-scripts重新构建。`); }
    let finish!: (value: { code: number; signal: string | null }) => void;
    const finished = new Promise<{ code: number; signal: string | null }>(resolve => { finish = resolve; });
    const data = terminal.onData(value => events.emit("data", value));
    const exit = terminal.onExit(value => { events.emit("exit"); data.dispose(); exit.dispose(); finish({ code: value.exitCode, signal: signalName(value.signal) }); });
    return { pid: terminal.pid, started: Promise.resolve(), finished,
      onData: listener => listen("data", listener), onExit: listener => listen("exit", listener),
      kill(signal) { try { process.kill(-terminal.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") terminal.kill(signal); } },
      write: data => terminal.write(data), resize: (cols, rows) => terminal.resize(cols, rows),
    };
  }
  const child = spawn("/bin/sh", ["-c", command], { cwd, env: processEnvironment(), detached: true, stdio: "pipe" });
  let error: Error | undefined;
  const started = new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.on("error", value => { error = value; });
  const out = new StringDecoder("utf8"), err = new StringDecoder("utf8");
  child.stdout.on("data", (data: Buffer) => events.emit("data", out.write(data)));
  child.stderr.on("data", (data: Buffer) => events.emit("data", err.write(data)));
  child.stdin.on("error", () => {}); child.stdin.end();
  child.once("exit", () => events.emit("exit"));
  const finished = new Promise<{ code: number | null; signal: string | null; error?: Error }>(resolve => child.once("close", (code, signal) => {
    events.emit("data", out.end()); events.emit("data", err.end()); resolve({ code, signal, error });
  }));
  return { get pid() { return child.pid; }, started, finished,
    onData: listener => listen("data", listener), onExit: listener => listen("exit", listener),
    kill(signal) { if (child.pid !== undefined) try { process.kill(-child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal); } },
  };
}
```

</details>

<details>
<summary>NEW：src/processes/takeover.ts 的完整文件</summary>

<!-- source: src/processes/takeover.ts -->
```ts
/**
 * 26.2 真实PTY | [NEW] processes/takeover.ts
 *
 * Ink suspendTerminal期间的唯一stdin读者。Ctrl+] detach，Ctrl+C交子终端，Ctrl+D按行规送EOF。
 * detach或取消仅收回终端；退出Agent由JobManager.close另行停止自有进程。
 */
import { ToolError } from "../errors.js";
import type { JobManager } from "./jobs.js";

// [NEW 26.2] 本地人类终端拥有单独的输入通道；没有模型stdin工具。
/** 把真实人类终端短暂交给一个PTY；无TTY拒绝，不与readline或Ink抢输入。 */
export async function takeoverJob(jobs: JobManager, id: string, signal: AbortSignal,
  input = process.stdin, output = process.stdout): Promise<"detached" | "exited"> {
  signal.throwIfAborted();
  if (!input.isTTY || !output.isTTY) throw new ToolError("前台接管需要真实TTY；请使用 --output tui 终端入口。");
  const beforeRaw = input.isRaw;
  let accepting = true, detach!: () => void;
  const detached = new Promise<"detached">(resolve => { detach = () => { accepting = false; resolve("detached"); }; });
  const attachment = jobs.attach(id, data => output.write(data));
  let finish!: () => void;
  const exited = new Promise<"exited">(resolve => { finish = () => { accepting = false; resolve("exited"); }; });
  const unsubscribeExit = attachment.onExit(finish);
  /** Ctrl+]只消费到分离键；同一个chunk的其余内容不泄漏回聊天。 */
  const onInput = (chunk: Buffer | string) => {
    const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const split = data.indexOf("\x1d");
    try { if (split >= 0) { if (split > 0) attachment.write(data.slice(0, split)); detach(); } else attachment.write(data); }
    catch { detach(); }
  };
  /** 与Ink一样在readable模式拉取；每次读到null以重新武装readable；分离键之后已缓冲的字节在本次交接中丢弃。 */
  const onReadable = () => { let chunk: Buffer | string | null; while ((chunk = input.read() as Buffer | string | null) !== null) { if (accepting) onInput(chunk); } };
  /** 窗口改变只交给当前PTY；超限尺寸保留上一次有效值。 */
  const resize = () => { try { attachment.resize(output.columns || 80, output.rows || 24); } catch { /* 退出中的PTY无需重试。 */ } };
  try {
    input.setRawMode(true); input.pause();
    output.write(`\r\n接管 JobID ${id}；Ctrl+] 分离，Ctrl+C 交给子程序，Ctrl+D 按终端行规送EOF。\r\n`);
    output.write(jobs.get(id).log); resize();
    input.on("readable", onReadable); input.on("end", detach); output.on("resize", resize);
    signal.addEventListener("abort", detach, { once: true });
    if (signal.aborted) detach();
    return await Promise.race([detached, exited]);
  } finally {
    input.off("readable", onReadable); input.off("end", detach); output.off("resize", resize);
    signal.removeEventListener("abort", detach); unsubscribeExit(); attachment.detach();
    input.setRawMode(beforeRaw);
  }
}
```

</details>

<details>
<summary>CHANGED：src/processes/jobs.ts 的精确差异</summary>

<!-- source: src/processes/jobs.ts -->
```diff
--- a/src/processes/jobs.ts
+++ b/src/processes/jobs.ts
@@ -1,17 +1,18 @@
 /**
- * 26.1 后台作业 | [NEW] processes/jobs.ts
+ * 26.2 真实PTY | [CHANGED] processes/jobs.ts
  *
- * 会话内自有进程登记表。start 等真实 spawn；wait 等 close，stop/close 等清理。
+ * 会话内自有进程登记表。start 等真实 spawn；pipe wait 等 close，PTY wait 等原生 onExit。
+ * 终态前解除订阅并发完自有进程组停止请求；不宣称能追踪自行脱离进程组的后代。
  * 只保存有界尾日志；不从历史文件恢复 PID，不接管用户原有服务，也不构成沙箱。
  */
-import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
+import { EventEmitter } from "node:events";
+import { spawnJobTransport, type Transport } from "./job-transport.js";
 import { randomUUID } from "node:crypto";
-import { StringDecoder } from "node:string_decoder";
 import { ToolError } from "../errors.js";
-import { processEnvironment } from "./run-process.js";

-// [NEW 26.1] JobID 是本实例的引用，PID 仅供观察，不能作为外部控制入口。
+// [KEEP 来自 26.1] JobID 是本实例的引用，PID 仅供观察，不能作为外部控制入口。
 export type JobSnapshot = {
+  transport: "pipe" | "pty";
   id: string; pid: number | null; command: string; cwd: string;
   state: "starting" | "running" | "stopping" | "exited" | "failed";
   startedAt: string | null; endedAt: string | null;
@@ -19,13 +20,15 @@
   stopReason?: "user" | "timeout" | "shutdown" | "start_cancelled";
   log: string; retainedBytes: number; droppedBytes: number;
 };
-export type JobInput = { command: string; cwd: string; timeoutMs: number };
-type Entry = { snapshot: JobSnapshot; child: ChildProcessWithoutNullStreams; done: Promise<JobSnapshot>;
+// [CHANGED 26.2] 默认pipe仍非交互；pty才有终端输入通道。
+export type JobInput = { command: string; cwd: string; timeoutMs: number; transport?: "pipe" | "pty" };
+type Entry = { snapshot: JobSnapshot; child: Transport; owner?: symbol; done: Promise<JobSnapshot>;
   stop: (reason: NonNullable<JobSnapshot["stopReason"]>) => void };

 /** 管理一个 CLI 会话创建的 POSIX 进程；已登记后台任务不绑定单轮模型信号。 */
 export class JobManager {
   private readonly entries = new Map<string, Entry>();
+  private readonly output = new EventEmitter();
   private closed = false;
   private closing?: Promise<void>;
   constructor(readonly limits = { active: 4, history: 32, logBytes: 64 * 1024 }) {
@@ -37,11 +40,32 @@
   list(): JobSnapshot[] { return [...this.entries.values()].map(entry => structuredClone(entry.snapshot)); }
   /** 不接受 PID；未知、已淘汰或旧会话的 JobID 均拒绝。 */
   get(id: string): JobSnapshot { return structuredClone(this.entry(id).snapshot); }
-  /** 等直接子进程、输出流关闭以及本进程组的停止请求发完。 */
+  /** pipe等close；PTY等原生onExit、订阅解除和本进程组停止请求发完。 */
   wait(id: string): Promise<JobSnapshot> { return this.entry(id).done.then(value => structuredClone(value)); }
   /** 停止只作用于本登记表创建的进程组，重复请求保留第一个原因。 */
   async stop(id: string, reason: NonNullable<JobSnapshot["stopReason"]> = "user"): Promise<JobSnapshot> {
     const entry = this.entry(id); entry.stop(reason); return this.wait(id);
+  }
+  // [NEW 26.2] owner只授予本地接管桥，不能被模型调用参数伪造。
+  /** 人类独占PTY，返回的句柄不进入模型工具；释放只detach，不kill。 */
+  attach(id: string, onData: (data: string) => void): { write(data: string): void; eof(): void; resize(cols: number, rows: number): void; onExit(listener: () => void): () => void; detach(): void } {
+    const entry = this.entry(id);
+    if (entry.snapshot.transport !== "pty" || !entry.child.write) throw new ToolError("pipe作业为非交互且stdin已EOF；只有PTY作业可接管。");
+    if (entry.snapshot.state !== "running") throw new ToolError("只能接管仍在运行的PTY作业。");
+    if (entry.owner) throw new ToolError("该PTY已有终端所有者。");
+    const owner = Symbol(id); entry.owner = owner;
+    const listener = (jobId: string, data: string) => { if (jobId === id) onData(data); };
+    this.output.on("data", listener);
+    /** 每次写入都复查所有权，detach后的旧闭包不能继续注入stdin。 */
+    const check = () => { if (entry.owner !== owner || entry.snapshot.state !== "running") throw new ToolError("PTY接管已结束。"); };
+    return {
+      write(data) { check(); entry.child.write!(data); },
+      // PTY中的Ctrl+D交给终端行规：空行通常交付EOF；raw应用可以自行处理它。
+      eof() { check(); entry.child.write!("\x04"); },
+      resize(cols, rows) { check(); if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 1000 || rows < 1 || rows > 1000) throw new ToolError("终端尺寸必须是1–1000的整数。"); entry.child.resize!(cols, rows); },
+      onExit: handler => { const listener = (jobId: string) => { if (jobId === id) handler(); }; this.output.on("exit", listener); return () => { this.output.off("exit", listener); }; },
+      detach: () => { if (entry.owner === owner) entry.owner = undefined; this.output.off("data", listener); },
+    };
   }
   /** 会话退出封住新启动，等待所有自有作业；重复关闭共用同一个 Promise。 */
   close(): Promise<void> {
@@ -67,20 +91,17 @@
       if (!oldest) throw new ToolError("作业历史已满。"); this.entries.delete(oldest.snapshot.id);
     }
     const id = randomUUID();
-    const snapshot: JobSnapshot = { id, pid: null, command: input.command, cwd: input.cwd, state: "starting",
+    const snapshot: JobSnapshot = { transport: input.transport ?? "pipe", id, pid: null, command: input.command, cwd: input.cwd, state: "starting",
       startedAt: null, endedAt: null, exitCode: null, signal: null, log: "", retainedBytes: 0, droppedBytes: 0 };
-    const child = spawn("/bin/sh", ["-c", input.command], { cwd: input.cwd, env: processEnvironment(), detached: true, stdio: "pipe" });
+    if (input.transport !== undefined && input.transport !== "pipe" && input.transport !== "pty") throw new ToolError("transport只能是pipe或pty。");
+    const child = spawnJobTransport(input.command, input.cwd, input.transport ?? "pipe");
     let finish!: (snapshot: JobSnapshot) => void;
     const done = new Promise<JobSnapshot>(resolve => { finish = resolve; });
     let timer: ReturnType<typeof setTimeout> | undefined, hardKill: ReturnType<typeof setTimeout> | undefined;
-    let spawnError: Error | undefined;
     let totalBytes = 0;
-    /** 仅向 spawn 创建的 POSIX 组发信号；退出清理不扫描全机 PID 或端口。 */
-    const kill = (name: NodeJS.Signals) => {
-      if (child.pid === undefined) return;
-      try { process.kill(-child.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(name); }
-    };
-    /** 持续排空两条管道，只保留合计 byte 上限的尾部，避免日志反压堵住进程。 */
+    /** 只向该transport真实创建的进程组发信号。 */
+    const kill = (name: NodeJS.Signals) => child.kill(name);
+    /** 持续读取transport输出：pipe排空stdout/stderr，PTY读取单通道；只保留合计byte上限的尾部。 */
     const append = (data: string) => {
       totalBytes += Buffer.byteLength(data);
       const bytes = Buffer.from(snapshot.log + data);
@@ -90,36 +111,30 @@
       while (Buffer.byteLength(snapshot.log) > this.limits.logBytes) snapshot.log = snapshot.log.slice(1);
       snapshot.retainedBytes = Buffer.byteLength(snapshot.log);
       snapshot.droppedBytes = totalBytes - snapshot.retainedBytes;
+      this.output.emit("data", id, data);
     };
-    /** 第一次停止记录原因，宽限 300ms 后升级；Promise 仍等待 close。 */
+    /** 第一次停止记录原因，宽限 300ms 后升级；Promise 仍等待对应transport收尾。 */
     const stop = (reason: NonNullable<JobSnapshot["stopReason"]>) => {
       if (["exited", "failed"].includes(snapshot.state) || snapshot.stopReason) return;
       snapshot.stopReason = reason; snapshot.state = "stopping"; kill("SIGTERM");
       hardKill = setTimeout(() => kill("SIGKILL"), 300);
     };
     this.entries.set(id, { snapshot, child, done, stop });
-    const stdout = new StringDecoder("utf8"), stderr = new StringDecoder("utf8");
-    child.stdout.on("data", (data: Buffer) => append(stdout.write(data)));
-    child.stderr.on("data", (data: Buffer) => append(stderr.write(data)));
-    // [NEW 26.1] Noninteractive pipe gets EOF; it never reads the chat input.
-    child.stdin.end();
-    child.stdin.on("error", () => { /* 子进程自行关闭 stdin 不使会话崩溃。 */ });
-    child.on("error", error => { spawnError = error; });
-    child.once("exit", () => { kill("SIGTERM"); hardKill ??= setTimeout(() => kill("SIGKILL"), 300); });
-    child.once("close", (code, exitSignal) => {
+    const unlistenData = child.onData(append);
+    const unlistenExit = child.onExit(() => { kill("SIGTERM"); hardKill ??= setTimeout(() => kill("SIGKILL"), 300); });
+    void child.finished.then(({ code, signal: exitSignal, error }) => {
       clearTimeout(timer); clearTimeout(hardKill); kill("SIGKILL");
-      append(stdout.end()); append(stderr.end());
+      unlistenData(); unlistenExit();
       snapshot.exitCode = code; snapshot.signal = exitSignal;
-      snapshot.endedAt = new Date().toISOString(); snapshot.state = spawnError ? "failed" : "exited";
+      snapshot.endedAt = new Date().toISOString(); snapshot.state = error ? "failed" : "exited";
+      this.output.emit("exit", id);
       finish(structuredClone(snapshot));
     });
     /** 取消仅覆盖启动窗口；登记成功后后台作业归会话，不归某一轮。 */
     const abort = () => stop("start_cancelled");
     signal?.addEventListener("abort", abort, { once: true });
     try {
-      await new Promise<void>((resolve, reject) => {
-        child.once("spawn", resolve); child.once("error", reject);
-      });
+      await child.started;
       snapshot.pid = child.pid!; snapshot.startedAt = new Date().toISOString();
       if (signal?.aborted || this.closed) {
         stop(this.closed ? "shutdown" : "start_cancelled"); await done;
```

</details>

<details>
<summary>CHANGED：src/tools/job-tools.ts 的精确差异</summary>

<!-- source: src/tools/job-tools.ts -->
```diff
--- a/src/tools/job-tools.ts
+++ b/src/tools/job-tools.ts
@@ -1,5 +1,5 @@
 /**
- * 26.1 后台作业 | [NEW] tools/job-tools.ts
+ * 26.2 真实PTY | [CHANGED] tools/job-tools.ts
  * 模型只能批准启动/停止和只读观察；没有模型 stdin 工具。JobID 来自本会话真实 spawn。
  */
 import { ToolError } from "../errors.js";
@@ -7,17 +7,17 @@
 import { prepareRunCommand } from "./run-command.js";
 import type { PreparedToolCall, ToolExecutionResult } from "./types.js";

-// [NEW 26.1] start_job 与 run_command 的等待退出语义各自明确。
+// [KEEP 来自 26.1] start_job 与 run_command 的等待退出语义各自明确。
 export const startJobDefinition = {
-  name: "start_job", description: "逐次批准后启动后台 pipe 作业，返回真实 JobID；running 不证明服务就绪。作业属于当前CLI会话；用read_job观察、stop_job停止。",
-  inputSchema: { type: "object" as const, properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 60_000 } }, required: ["command", "cwd"], additionalProperties: false },
+  name: "start_job", description: "逐次批准后启动后台 pipe 或真实PTY作业，返回真实 JobID；running 不证明服务就绪。作业属于当前CLI会话；用read_job观察、stop_job停止。",
+  inputSchema: { type: "object" as const, properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 60_000 }, transport: { type: "string", enum: ["pipe", "pty"], description: "省略为非交互pipe；需要人类终端输入时选择真实pty" } }, required: ["command", "cwd"], additionalProperties: false },
 };
 export const readJobDefinition = {
   name: "read_job", description: "只读本次会话自有JobID的当前状态与有界尾日志；不知道ID时返回列表。旧会话的PID不能恢复。",
   inputSchema: { type: "object" as const, properties: { job_id: { type: "string" } }, additionalProperties: false },
 };
 export const stopJobDefinition = {
-  name: "stop_job", description: "逐次批准后停止本会话自有JobID，等待进程与管道关闭后返回结果。",
+  name: "stop_job", description: "逐次批准后停止本会话自有JobID，等待对应transport收尾（pipe close / PTY onExit与订阅清理）后返回结果。",
   inputSchema: { type: "object" as const, properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false },
 };
 /** 参数、ID 与登记表在本地检查；不能靠模型给出的 PID 选中外部程序。 */
@@ -30,14 +30,18 @@
 }
 /** 每条观察把同一状态同时送给模型与界面，不把stderr非空直接视为失败。 */
 function result(job: JobSnapshot): ToolExecutionResult {
-  return { content: describeJob(job), isError: job.state === "failed" || (job.state === "exited" && (job.exitCode !== 0 || Boolean(job.stopReason))), metadata: { kind: "job", job } };
+  return { content: describeJob(job), isError: job.state === "failed" || (job.state === "exited" && (job.exitCode !== 0 || Boolean(job.signal) || Boolean(job.stopReason))), metadata: { kind: "job", job } };
 }
 /** 启动/停止均先保存本次参数；批准前不启动或发信号。 */
 export async function prepareJob(name: string, json: string, jobs: JobManager | undefined, signal: AbortSignal): Promise<PreparedToolCall> {
   if (!jobs) throw new ToolError("当前会话未连接作业管理器。");
   if (name === "start_job") {
-    const prepared = await prepareRunCommand(json, undefined, signal, async (command, cwd, executionSignal, timeoutMs) => result(await jobs.start({ command, cwd, timeoutMs }, executionSignal)));
-    return { ...prepared, preview: `启动后台作业（不会等待退出）\n${prepared.preview}\n只管理本会话自有进程组；日志有界，退出Agent会清理作业。` };
+    // [NEW 26.2] 先验证transport，再把其余参数交给已有命令/目录验证，禁止未知字段。
+    let input: Record<string, unknown>; try { const parsed = JSON.parse(json); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); input = parsed; } catch { throw new ToolError("start_job参数必须是JSON对象。"); }
+    const { transport = "pipe", ...commandInput } = input;
+    if (transport !== "pipe" && transport !== "pty") throw new ToolError("transport只能是pipe或pty。");
+    const prepared = await prepareRunCommand(JSON.stringify(commandInput), undefined, signal, async (command, cwd, executionSignal, timeoutMs) => result(await jobs.start({ command, cwd, timeoutMs, transport }, executionSignal)));
+    return { ...prepared, preview: `启动后台作业（不会等待退出），transport=${transport}\n${prepared.preview}\n只管理本会话自有进程组；日志有界，退出Agent会清理作业。` };
   }
   const id = parseId(json, true)!;
   const job = jobs.get(id);
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
- * 26.1 后台作业 | [CHANGED] ui/terminal.ts
+ * 26.2 真实PTY | [CHANGED] ui/terminal.ts
  *
  * 学习目标：消费同一任务事件，显示模型正文，并在结束后补打新增的本地反馈。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -45,7 +45,7 @@
 import type { AgentEvent } from "../agent/events.js";
 import { explainError, UserFacingError } from "../errors.js";
 import { createFileCheckpointCommands } from "../sessions/file-checkpoints.js";
-// [NEW 26.1] 人类本地命令只使用当前进程登记表。
+// [KEEP 来自 26.1] 人类本地命令只使用当前进程登记表。
 import { jobCommand } from "../processes/jobs.js";
 import type { Message, Model, Reply } from "../models/client.js";
 import type { ApprovalHandler } from "../permissions/policy.js";
@@ -331,7 +331,9 @@
       const text = value.trim();
       if (!text) continue;
       if (text === "/exit") break;
-      // [NEW 26.1] 本地停止等待进程和输出流关闭，查询不触发模型请求。
+      // [NEW 26.2] text的行读取器始终拥有stdin；接管只能使用可暂停Ink的TUI。
+      if (/^\/fg(?:\s|$)/.test(text)) { console.error("PTY接管请使用 --output tui；text入口只支持/jobs /job /stop。"); continue; }
+      // [CHANGED 26.2] 本地停止等待对应transport收尾，查询不触发模型请求。
       if (/^\/(jobs|job|stop)(?:\s|$)/.test(text)) {
         try { console.error(screenText(await jobCommand(text, model.jobs))); }
         catch (error) { console.error(screenText(explainError(error))); }
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
- * 26.1 后台作业 | [CHANGED] ui/tui/app.tsx
+ * 26.2 真实PTY | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：显示模型的加载与资源结果；本地命令、审批、任务取消保持各自入口。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -57,7 +57,9 @@
 import { Transcript, runEntries, type Entry } from "./transcript.js";
 import { editExternally } from "./system-actions.js";
 import { createFileCheckpointCommands, type FileCheckpointStore } from "../../sessions/file-checkpoints.js";
-// [NEW 26.1] 本地作业命令不作为模型消息或权限记录。
+// [KEEP 来自 26.1] 本地作业命令不作为模型消息或权限记录。
+// [NEW 26.2] Ink暂停期间，独占的人类输入通道才会监听stdin。
+import { takeoverJob } from "../../processes/takeover.js";
 import { jobCommand } from "../../processes/jobs.js";
 import type { Message, Model } from "../../models/client.js";
 import { streamAgentRun } from "../../agent/run-stream.js";
@@ -294,7 +296,18 @@
     setDraft(newDraft());
     // 本地命令只改本地会话；它们不作为 user 消息送给模型。
     if (prompt === "/exit") { quit(0); return; }
-    // [NEW 26.1] 停止等close后才恢复输入；日志由现有显示层转义。
+    // [NEW 26.2] suspendTerminal暂停Ink唯一底层读者；保留React输入订阅，避免resume早于active效果。
+    if (/^\/fg(?:\s|$)/.test(prompt)) {
+      const match = /^\/fg ([0-9a-f-]{36})$/.exec(prompt);
+      if (!match || !model.jobs) { append("本地", "用法：/fg <本次会话PTY的JobID>。"); return; }
+      const controller = new AbortController();
+      session.external = { controller, done: (async () => {
+        try { await suspendTerminal(async () => { await takeoverJob(model.jobs!, match[1]!, controller.signal); }); }
+        catch (error) { if (!session.closing) append("本地", explainError(error)); }
+        finally { session.external = undefined; if (!session.closing) setNotice("已收回终端；/job核对状态，/stop显式停止。"); }
+      })() }; return;
+    }
+    // [CHANGED 26.2] 停止等对应transport收尾后才恢复输入；日志由现有显示层转义。
     if (/^\/(jobs|job|stop)(?:\s|$)/.test(prompt)) {
       session.clearing = true;
       session.done = (async () => {
@@ -381,7 +394,7 @@
    * 识别必须在空闲时本地处理的命令。
    * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
    */
-  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|jobs|job|stop|attach|attachments|detach|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
+  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|jobs|job|stop|fg|attach|attachments|detach|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
   /**
    * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
    * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
@@ -598,7 +611,7 @@
       session.controller?.abort();
       session.external?.controller.abort();
       await Promise.all([session.done, session.external?.done]);
-      // [NEW 26.1] 所有自有作业清理后才卸载终端；普通run结束不执行这里。
+      // [KEEP 来自 26.1] 所有自有作业清理后才卸载终端；普通run结束不执行这里。
       await model.jobs?.close();
       const feedback = await checkpointTui(session, "exit");
       let closeError: unknown;
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:26.2
```

先运行一个不调用模型、也不需要外层终端接管的探针。它直接取得本地 owner 句柄，确认内层确实是终端、输入能到达、尺寸真实改变、旧 owner 不能再写，并在空行送 EOF 后等到退出。这里的句柄只用于本地验证，没有增加模型的 stdin 工具。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { JobManager } from './dist/processes/jobs.js';
const jobs = new JobManager();
async function until(id, check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = jobs.get(id);
    if (check(job)) return job;
    if (job.state === 'exited' || job.state === 'failed') throw new Error(job.log);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('等待 PTY 观察超时');
}
try {
  const job = await jobs.start({
    transport: 'pty', cwd: process.cwd(), timeoutMs: 8000,
    command: String.raw`stty -echo; test -t 0 || exit 9; printf 'READY\n'; IFS= read -r name; printf 'HELLO:%s\n' "$name"; stty size; cat; printf 'EOF_OK\n'`,
  });
  await until(job.id, current => current.log.includes('READY'));
  const owner = jobs.attach(job.id, () => {});
  assert.throws(() => jobs.attach(job.id, () => {}), /所有者/);
  owner.resize(93, 31);
  owner.write('Ada\n');
  await until(job.id, current => current.log.includes('HELLO:Ada') && /31\s+93/.test(current.log));
  owner.detach();
  assert.throws(() => owner.write('STALE'), /接管已结束/);
  assert.equal(jobs.get(job.id).state, 'running');
  const next = jobs.attach(job.id, () => {});
  next.eof();
  const ended = await jobs.wait(job.id);
  next.detach();
  assert.equal(ended.exitCode, 0);
  assert.equal(ended.signal, null);
  assert.equal(ended.stopReason, undefined);
  assert.match(ended.log, /EOF_OK/);
  console.log('通过：真实 PTY、输入、93×31、独占、分离、重新接管与 EOF。');
} finally { await jobs.close(); }
NODE
```

接着用真实终端检查外层交接。启动 TUI：

```bash
hello-my-agent --output tui
```

请模型“用 start_job 启动 transport=pty、期限 60000 毫秒的作业，命令为 `printf 'NAME?\n'; IFS= read -r name; printf 'HELLO:%s\n' "$name"; stty size; cat`，返回 JobID”。核对批准的是这条命令和项目目录。等本轮回答结束，在输入框提交 `/fg <实际JobID>`，不要照抄尖括号。

看到接管提示后输入 `Ada` 并回车，应看到 `HELLO:Ada` 和当前尺寸。此时输入的是子程序的数据，Agent 不应出现一条叫 Ada 的新问题。改变窗口尺寸后，PTY 会收到新尺寸；这个示例只在 `stty size` 执行时打印一次，不能要求它在每次 resize 后自动再打印。

保持 `cat` 在等待，按 Ctrl+]。等 TUI 出现“已收回终端”后，用 `/job <同一个JobID>` 确认仍在运行；再发一条普通问题，确认聊天可以继续。随后让模型通过 `read_job` 读取该 JobID，核对返回中包含刚才的 `HELLO:Ada`；本地看过日志不代表模型已经读到它。

最后再次 `/fg` 接管，在空行按 Ctrl+D，让 canonical 模式的 `cat` 收到 EOF。返回 TUI 后用 `/job` 核对退出信息。若想检查 Ctrl+C，可以重新启动同样的作业，在 `cat` 等待时接管并按 Ctrl+C，再读退出状态和信号；不要预设所有交互程序都按同一种方式处理它。60 秒期限若先到，先重新启动，再做接管实验。

以上探针和交互步骤适用于自己跟写的项目。完整配套仓库还可分别运行进程与真实终端检查；需要系统 Python 3 和可用的 `node-pty` 原生模块：

```bash
LESSON_26=02-pty-takeover node tests/verify-chapter-26.mjs
```

```bash
LESSON_26=02-pty-takeover python3 tests/verify-terminal-26.py
```

后一个检查在 16×40、40×110 两种外层终端里实际执行接管，检查唯一输入、93×31 resize、子程序收到 Ctrl+C、分离不停止、EOF、恢复后新聊天，以及退出等待自有作业和终端恢复。它使用模型替身核对消息边界，不把一次随机模型回答当作输入交接的证明。

## 本节完成后的 Agent

现在同一份作业登记表可以持有非交互 pipe 与真实 PTY。用户通过本地 `/fg` 独占接管，把输入与尺寸交给子终端，再明确分离；模型仍需用 `read_job` 取得新的观察。启动、接管归还和进程退出是三种不同的完成依据。[26.3](/content/chapter-26-interactive-jobs/03-job-lifecycle/README.md) 将继续整理后台运行、就绪证据与退出清理。

本节状态：待用户确认。
