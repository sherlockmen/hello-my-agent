/**
 * 27.1 有界只读并发 | [KEEP] processes/jobs.ts
 *
 * 会话内自有进程登记表。start 等真实 spawn；pipe wait 等 close，PTY wait 等原生 onExit。
 * 终态前解除订阅并发完自有进程组停止请求；不宣称能追踪自行脱离进程组的后代。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   spawn -> running；显式输出标记匹配 -> ready通知；transport收尾 -> 终态通知
 *   未匹配就退出 -> ended_before_ready；退出CLI -> stop自有作业 -> 等真实收尾
 * 观察：PID不证明服务就绪；ready只证明声明的输出已出现，不验证端口或HTTP健康。
 * 只保存有界尾日志；不从历史文件恢复 PID，不接管用户原有服务，也不构成沙箱。
 */
import { EventEmitter } from "node:events";
import { spawnJobTransport, type Transport } from "./job-transport.js";
import { randomUUID } from "node:crypto";
import { ToolError } from "../errors.js";

// [KEEP 来自 26.1] JobID 是本实例的引用，PID 仅供观察，不能作为外部控制入口。
// [KEEP 来自 26.3] 进程状态与输出就绪分别记录；历史证据不会随尾日志淘汰。
export type JobSnapshot = {
  readiness: "not_configured" | "waiting" | "ready" | "ended_before_ready";
  readyText: string | null; readyAt: string | null; evidence: string | null;
  transport: "pipe" | "pty";
  id: string; pid: number | null; command: string; cwd: string;
  state: "starting" | "running" | "stopping" | "exited" | "failed";
  startedAt: string | null; endedAt: string | null;
  exitCode: number | null; signal: string | null;
  stopReason?: "user" | "timeout" | "shutdown" | "start_cancelled";
  log: string; retainedBytes: number; droppedBytes: number;
};
// [KEEP 来自 26.2] 默认pipe仍非交互；pty才有终端输入通道。
export type JobInput = { command: string; cwd: string; timeoutMs: number; transport?: "pipe" | "pty"; readyText?: string };
type Entry = { snapshot: JobSnapshot; child: Transport; owner?: symbol; done: Promise<JobSnapshot>;
  stop: (reason: NonNullable<JobSnapshot["stopReason"]>) => void };

// [KEEP 来自 26.3] 通知只供本地显示；不会伪造工具结果或自动触发模型请求。
export type JobNotice = { type: "ready" | "ended"; job: JobSnapshot };

/** 管理一个 CLI 会话创建的 POSIX 进程；已登记后台任务不绑定单轮模型信号。 */
export class JobManager {
  private readonly entries = new Map<string, Entry>();
  private readonly output = new EventEmitter();
  private closed = false;
  private closing?: Promise<void>;
  constructor(readonly limits = { active: 4, history: 32, logBytes: 64 * 1024 }) {
    if (![limits.active, limits.history, limits.logBytes].every(n => Number.isInteger(n) && n > 0)
        || limits.history < limits.active) throw new ToolError("作业限额必须为正整数，历史限额不能小于活跃限额。");
  }

  // [KEEP 来自 26.3] 观察者异常不能妨碍进程清理；解除订阅后不会再收到本会话通知。
  subscribe(listener: (notice: JobNotice) => void): () => void {
    this.output.on("notice", listener); return () => { this.output.off("notice", listener); };
  }
  private notify(type: JobNotice["type"], job: JobSnapshot): void {
    for (const listener of this.output.listeners("notice")) {
      try { listener({ type, job: structuredClone(job) }); } catch { /* 本地观察失败不改变作业状态。 */ }
    }
  }
  /** 只返回脱离内部对象的观察快照，调用者不能修改登记表。 */
  list(): JobSnapshot[] { return [...this.entries.values()].map(entry => structuredClone(entry.snapshot)); }
  /** 不接受 PID；未知、已淘汰或旧会话的 JobID 均拒绝。 */
  get(id: string): JobSnapshot { return structuredClone(this.entry(id).snapshot); }
  /** pipe等close；PTY等原生onExit、订阅解除和本进程组停止请求发完。 */
  wait(id: string): Promise<JobSnapshot> { return this.entry(id).done.then(value => structuredClone(value)); }
  /** 停止只作用于本登记表创建的进程组，重复请求保留第一个原因。 */
  async stop(id: string, reason: NonNullable<JobSnapshot["stopReason"]> = "user"): Promise<JobSnapshot> {
    const entry = this.entry(id); entry.stop(reason); return this.wait(id);
  }
  // [KEEP 来自 26.2] owner只授予本地接管桥，不能被模型调用参数伪造。
  /** 人类独占PTY，返回的句柄不进入模型工具；释放只detach，不kill。 */
  attach(id: string, onData: (data: string) => void): { write(data: string): void; eof(): void; resize(cols: number, rows: number): void; onExit(listener: () => void): () => void; detach(): void } {
    const entry = this.entry(id);
    if (entry.snapshot.transport !== "pty" || !entry.child.write) throw new ToolError("pipe作业为非交互且stdin已EOF；只有PTY作业可接管。");
    if (entry.snapshot.state !== "running") throw new ToolError("只能接管仍在运行的PTY作业。");
    if (entry.owner) throw new ToolError("该PTY已有终端所有者。");
    const owner = Symbol(id); entry.owner = owner;
    const listener = (jobId: string, data: string) => { if (jobId === id) onData(data); };
    this.output.on("data", listener);
    /** 每次写入都复查所有权，detach后的旧闭包不能继续注入stdin。 */
    const check = () => { if (entry.owner !== owner || entry.snapshot.state !== "running") throw new ToolError("PTY接管已结束。"); };
    return {
      write(data) { check(); entry.child.write!(data); },
      // PTY中的Ctrl+D交给终端行规：空行通常交付EOF；raw应用可以自行处理它。
      eof() { check(); entry.child.write!("\x04"); },
      resize(cols, rows) { check(); if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 1000 || rows < 1 || rows > 1000) throw new ToolError("终端尺寸必须是1–1000的整数。"); entry.child.resize!(cols, rows); },
      onExit: handler => { const listener = (jobId: string) => { if (jobId === id) handler(); }; this.output.on("exit", listener); return () => { this.output.off("exit", listener); }; },
      detach: () => { if (entry.owner === owner) entry.owner = undefined; this.output.off("data", listener); },
    };
  }
  /** 会话退出封住新启动，等待所有自有作业；重复关闭共用同一个 Promise。 */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= Promise.all([...this.entries.keys()].map(id => this.stop(id, "shutdown"))).then(() => undefined);
  }
  /** 本地记录查找不提供导入、恢复或按任意 PID 发信号的后门。 */
  private entry(id: string): Entry {
    const entry = this.entries.get(id); if (!entry) throw new ToolError("未知 JobID；只能访问本次会话创建且尚未淘汰的作业。");
    return entry;
  }
  /** 验证限额后启动真实 /bin/sh；启动失败不返回 started，启动取消先等清理再抛出。 */
  async start(input: JobInput, signal?: AbortSignal): Promise<JobSnapshot> {
    signal?.throwIfAborted();
    if (process.platform === "win32") throw new ToolError("作业需要 macOS/Linux 的 POSIX 进程组；Windows 请使用 WSL。");
    if (this.closed) throw new ToolError("作业管理器已关闭。");
    if (!input.command.trim() || input.command.length > 4000 || /\x00/.test(input.command)
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 60_000) throw new ToolError("作业命令或运行期限无效。");
    // [KEEP 来自 26.3] 标记在批准时已经声明；只做有界字面匹配，不执行模型提供的正则。
    if (input.readyText !== undefined && (typeof input.readyText !== "string" || !input.readyText.trim() || input.readyText.length > 200 || /[\r\n\x00]/.test(input.readyText))) throw new ToolError("ready_text必须是1–200字符的单行字面标记。");
    const active = [...this.entries.values()].filter(e => !["exited", "failed"].includes(e.snapshot.state));
    if (active.length >= this.limits.active) throw new ToolError(`活跃作业已达上限 ${this.limits.active}，请先停止或等待已有作业。`);
    while (this.entries.size >= this.limits.history) {
      const oldest = [...this.entries.values()].find(e => ["exited", "failed"].includes(e.snapshot.state));
      if (!oldest) throw new ToolError("作业历史已满。"); this.entries.delete(oldest.snapshot.id);
    }
    const id = randomUUID();
    const snapshot: JobSnapshot = { readiness: input.readyText ? "waiting" : "not_configured", readyText: input.readyText ?? null, readyAt: null, evidence: null, transport: input.transport ?? "pipe", id, pid: null, command: input.command, cwd: input.cwd, state: "starting",
      startedAt: null, endedAt: null, exitCode: null, signal: null, log: "", retainedBytes: 0, droppedBytes: 0 };
    if (input.transport !== undefined && input.transport !== "pipe" && input.transport !== "pty") throw new ToolError("transport只能是pipe或pty。");
    const child = spawnJobTransport(input.command, input.cwd, input.transport ?? "pipe");
    let finish!: (snapshot: JobSnapshot) => void;
    const done = new Promise<JobSnapshot>(resolve => { finish = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined, hardKill: ReturnType<typeof setTimeout> | undefined;
    let totalBytes = 0;
    // [KEEP 来自 26.3] 跨输出块最多保留标记长度减一的尾部，匹配内存不随日志增长。
    let readyTail = "";
    /** 只向该transport真实创建的进程组发信号。 */
    const kill = (name: NodeJS.Signals) => child.kill(name);
    /** 持续读取transport输出：pipe排空stdout/stderr，PTY读取单通道；只保留合计byte上限的尾部。 */
    const append = (data: string) => {
      totalBytes += Buffer.byteLength(data);
      const bytes = Buffer.from(snapshot.log + data);
      const excess = Math.max(0, bytes.length - this.limits.logBytes);
      // UTF-8 切片可能产生边缘替换符；再次按字节裁去首字符，保证严格内存预算。
      snapshot.log = bytes.subarray(excess).toString("utf8");
      while (Buffer.byteLength(snapshot.log) > this.limits.logBytes) snapshot.log = snapshot.log.slice(1);
      snapshot.retainedBytes = Buffer.byteLength(snapshot.log);
      snapshot.droppedBytes = totalBytes - snapshot.retainedBytes;
      // [KEEP 来自 26.3] 保留精确声明和观察时刻；即使该行后来被尾日志淘汰，也能核对依据。
      if (snapshot.readiness === "waiting" && input.readyText) {
        const text = readyTail + data;
        if (text.includes(input.readyText)) {
          snapshot.readiness = "ready"; snapshot.readyAt = new Date().toISOString(); snapshot.evidence = input.readyText;
          this.notify("ready", snapshot); readyTail = "";
        } else readyTail = text.slice(-(input.readyText.length - 1 || 1));
      }
      this.output.emit("data", id, data);
    };
    /** 第一次停止记录原因，宽限 300ms 后升级；Promise 仍等待对应transport收尾。 */
    const stop = (reason: NonNullable<JobSnapshot["stopReason"]>) => {
      if (["exited", "failed"].includes(snapshot.state) || snapshot.stopReason) return;
      snapshot.stopReason = reason; snapshot.state = "stopping"; kill("SIGTERM");
      hardKill = setTimeout(() => kill("SIGKILL"), 300);
    };
    this.entries.set(id, { snapshot, child, done, stop });
    const unlistenData = child.onData(append);
    const unlistenExit = child.onExit(() => { kill("SIGTERM"); hardKill ??= setTimeout(() => kill("SIGKILL"), 300); });
    void child.finished.then(({ code, signal: exitSignal, error }) => {
      clearTimeout(timer); clearTimeout(hardKill); kill("SIGKILL");
      unlistenData(); unlistenExit();
      snapshot.exitCode = code; snapshot.signal = exitSignal;
      snapshot.endedAt = new Date().toISOString(); snapshot.state = error ? "failed" : "exited";
      // [KEEP 来自 26.3] 只有transport真正收尾才发布终态；未匹配的声明不会变成ready。
      if (snapshot.readiness === "waiting") snapshot.readiness = "ended_before_ready";
      this.notify("ended", snapshot);
      this.output.emit("exit", id);
      finish(structuredClone(snapshot));
    });
    /** 取消仅覆盖启动窗口；登记成功后后台作业归会话，不归某一轮。 */
    const abort = () => stop("start_cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await child.started;
      snapshot.pid = child.pid!; snapshot.startedAt = new Date().toISOString();
      if (signal?.aborted || this.closed) {
        stop(this.closed ? "shutdown" : "start_cancelled"); await done;
        signal?.throwIfAborted(); throw new ToolError("会话在启动作业期间关闭。");
      }
      // [KEEP 来自 26.3] 极短进程可能已收尾，不能用spawn回调把终态覆写为running。
      if (!["exited", "failed"].includes(snapshot.state)) {
        snapshot.state = "running"; timer = setTimeout(() => stop("timeout"), input.timeoutMs);
      }
      return structuredClone(snapshot);
    } catch (error) {
      stop("start_cancelled"); await done;
      if (signal?.aborted) throw signal.reason;
      throw new ToolError(`作业启动失败：${error instanceof Error ? error.message : "未知原因"}`);
    } finally { signal?.removeEventListener("abort", abort); }
  }
}

/** 有界状态和日志同时给模型/本地命令；state=running 仅证明进程已启动。 */
// [KEEP 来自 26.3] 展示就绪证据和时间，不从PID或退出码推测服务可用。
export function describeJob(job: JobSnapshot): string {
  return `JobID: ${job.id}\nPID: ${job.pid ?? "无"}\n状态: ${job.state}\n就绪: ${job.readiness}\n声明标记: ${JSON.stringify(job.readyText)}\n就绪时刻: ${job.readyAt ?? "无"}\n输出证据: ${JSON.stringify(job.evidence)}\n退出码: ${job.exitCode ?? "无"}\n信号: ${job.signal ?? "无"}\n停止原因: ${job.stopReason ?? "无"}\n日志尾部 (${job.retainedBytes} bytes，已丢弃 ${job.droppedBytes} bytes):\n${job.log || "（空）"}`;
}

/** 人类本地查询和停止不进入模型上下文；不从聊天文字推导批准。 */
export async function jobCommand(text: string, jobs?: JobManager): Promise<string> {
  if (!jobs) throw new ToolError("当前会话未连接作业管理器。");
  if (text === "/jobs") return jobs.list().map(job => `${job.id} ${job.state} pid=${job.pid ?? "无"}`).join("\n") || "本次会话没有作业。";
  const match = /^\/(job|stop) ([0-9a-f-]{36})$/.exec(text);
  if (!match) throw new ToolError("用法：/jobs；/job <JobID>；/stop <JobID>。");
  return describeJob(match[1] === "stop" ? await jobs.stop(match[2]!) : jobs.get(match[2]!));
}
