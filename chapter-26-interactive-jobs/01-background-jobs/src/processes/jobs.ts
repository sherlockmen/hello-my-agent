/**
 * 26.1 后台作业 | [NEW] processes/jobs.ts
 *
 * 会话内自有进程登记表。start 等真实 spawn；wait 等 close，stop/close 等清理。
 * 只保存有界尾日志；不从历史文件恢复 PID，不接管用户原有服务，也不构成沙箱。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { ToolError } from "../errors.js";
import { processEnvironment } from "./run-process.js";

// [NEW 26.1] JobID 是本实例的引用，PID 仅供观察，不能作为外部控制入口。
export type JobSnapshot = {
  id: string; pid: number | null; command: string; cwd: string;
  state: "starting" | "running" | "stopping" | "exited" | "failed";
  startedAt: string | null; endedAt: string | null;
  exitCode: number | null; signal: string | null;
  stopReason?: "user" | "timeout" | "shutdown" | "start_cancelled";
  log: string; retainedBytes: number; droppedBytes: number;
};
export type JobInput = { command: string; cwd: string; timeoutMs: number };
type Entry = { snapshot: JobSnapshot; child: ChildProcessWithoutNullStreams; done: Promise<JobSnapshot>;
  stop: (reason: NonNullable<JobSnapshot["stopReason"]>) => void };

/** 管理一个 CLI 会话创建的 POSIX 进程；已登记后台任务不绑定单轮模型信号。 */
export class JobManager {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(readonly limits = { active: 4, history: 32, logBytes: 64 * 1024 }) {
    if (![limits.active, limits.history, limits.logBytes].every(n => Number.isInteger(n) && n > 0)
        || limits.history < limits.active) throw new ToolError("作业限额必须为正整数，历史限额不能小于活跃限额。");
  }

  /** 只返回脱离内部对象的观察快照，调用者不能修改登记表。 */
  list(): JobSnapshot[] { return [...this.entries.values()].map(entry => structuredClone(entry.snapshot)); }
  /** 不接受 PID；未知、已淘汰或旧会话的 JobID 均拒绝。 */
  get(id: string): JobSnapshot { return structuredClone(this.entry(id).snapshot); }
  /** 等直接子进程、输出流关闭以及本进程组的停止请求发完。 */
  wait(id: string): Promise<JobSnapshot> { return this.entry(id).done.then(value => structuredClone(value)); }
  /** 停止只作用于本登记表创建的进程组，重复请求保留第一个原因。 */
  async stop(id: string, reason: NonNullable<JobSnapshot["stopReason"]> = "user"): Promise<JobSnapshot> {
    const entry = this.entry(id); entry.stop(reason); return this.wait(id);
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
    const active = [...this.entries.values()].filter(e => !["exited", "failed"].includes(e.snapshot.state));
    if (active.length >= this.limits.active) throw new ToolError(`活跃作业已达上限 ${this.limits.active}，请先停止或等待已有作业。`);
    while (this.entries.size >= this.limits.history) {
      const oldest = [...this.entries.values()].find(e => ["exited", "failed"].includes(e.snapshot.state));
      if (!oldest) throw new ToolError("作业历史已满。"); this.entries.delete(oldest.snapshot.id);
    }
    const id = randomUUID();
    const snapshot: JobSnapshot = { id, pid: null, command: input.command, cwd: input.cwd, state: "starting",
      startedAt: null, endedAt: null, exitCode: null, signal: null, log: "", retainedBytes: 0, droppedBytes: 0 };
    const child = spawn("/bin/sh", ["-c", input.command], { cwd: input.cwd, env: processEnvironment(), detached: true, stdio: "pipe" });
    let finish!: (snapshot: JobSnapshot) => void;
    const done = new Promise<JobSnapshot>(resolve => { finish = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined, hardKill: ReturnType<typeof setTimeout> | undefined;
    let spawnError: Error | undefined;
    let totalBytes = 0;
    /** 仅向 spawn 创建的 POSIX 组发信号；退出清理不扫描全机 PID 或端口。 */
    const kill = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(name); }
    };
    /** 持续排空两条管道，只保留合计 byte 上限的尾部，避免日志反压堵住进程。 */
    const append = (data: string) => {
      totalBytes += Buffer.byteLength(data);
      const bytes = Buffer.from(snapshot.log + data);
      const excess = Math.max(0, bytes.length - this.limits.logBytes);
      // UTF-8 切片可能产生边缘替换符；再次按字节裁去首字符，保证严格内存预算。
      snapshot.log = bytes.subarray(excess).toString("utf8");
      while (Buffer.byteLength(snapshot.log) > this.limits.logBytes) snapshot.log = snapshot.log.slice(1);
      snapshot.retainedBytes = Buffer.byteLength(snapshot.log);
      snapshot.droppedBytes = totalBytes - snapshot.retainedBytes;
    };
    /** 第一次停止记录原因，宽限 300ms 后升级；Promise 仍等待 close。 */
    const stop = (reason: NonNullable<JobSnapshot["stopReason"]>) => {
      if (["exited", "failed"].includes(snapshot.state) || snapshot.stopReason) return;
      snapshot.stopReason = reason; snapshot.state = "stopping"; kill("SIGTERM");
      hardKill = setTimeout(() => kill("SIGKILL"), 300);
    };
    this.entries.set(id, { snapshot, child, done, stop });
    const stdout = new StringDecoder("utf8"), stderr = new StringDecoder("utf8");
    child.stdout.on("data", (data: Buffer) => append(stdout.write(data)));
    child.stderr.on("data", (data: Buffer) => append(stderr.write(data)));
    // [NEW 26.1] Noninteractive pipe gets EOF; it never reads the chat input.
    child.stdin.end();
    child.stdin.on("error", () => { /* 子进程自行关闭 stdin 不使会话崩溃。 */ });
    child.on("error", error => { spawnError = error; });
    child.once("exit", () => { kill("SIGTERM"); hardKill ??= setTimeout(() => kill("SIGKILL"), 300); });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer); clearTimeout(hardKill); kill("SIGKILL");
      append(stdout.end()); append(stderr.end());
      snapshot.exitCode = code; snapshot.signal = exitSignal;
      snapshot.endedAt = new Date().toISOString(); snapshot.state = spawnError ? "failed" : "exited";
      finish(structuredClone(snapshot));
    });
    /** 取消仅覆盖启动窗口；登记成功后后台作业归会话，不归某一轮。 */
    const abort = () => stop("start_cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve); child.once("error", reject);
      });
      snapshot.pid = child.pid!; snapshot.startedAt = new Date().toISOString();
      if (signal?.aborted || this.closed) {
        stop(this.closed ? "shutdown" : "start_cancelled"); await done;
        signal?.throwIfAborted(); throw new ToolError("会话在启动作业期间关闭。");
      }
      snapshot.state = "running";
      timer = setTimeout(() => stop("timeout"), input.timeoutMs);
      return structuredClone(snapshot);
    } catch (error) {
      stop("start_cancelled"); await done;
      if (signal?.aborted) throw signal.reason;
      throw new ToolError(`作业启动失败：${error instanceof Error ? error.message : "未知原因"}`);
    } finally { signal?.removeEventListener("abort", abort); }
  }
}

/** 有界状态和日志同时给模型/本地命令；state=running 仅证明进程已启动。 */
export function describeJob(job: JobSnapshot): string {
  return `JobID: ${job.id}\nPID: ${job.pid ?? "无"}\n状态: ${job.state}\n退出码: ${job.exitCode ?? "无"}\n信号: ${job.signal ?? "无"}\n停止原因: ${job.stopReason ?? "无"}\n日志尾部 (${job.retainedBytes} bytes，已丢弃 ${job.droppedBytes} bytes):\n${job.log || "（空）"}`;
}

/** 人类本地查询和停止不进入模型上下文；不从聊天文字推导批准。 */
export async function jobCommand(text: string, jobs?: JobManager): Promise<string> {
  if (!jobs) throw new ToolError("当前会话未连接作业管理器。");
  if (text === "/jobs") return jobs.list().map(job => `${job.id} ${job.state} pid=${job.pid ?? "无"}`).join("\n") || "本次会话没有作业。";
  const match = /^\/(job|stop) ([0-9a-f-]{36})$/.exec(text);
  if (!match) throw new ToolError("用法：/jobs；/job <JobID>；/stop <JobID>。");
  return describeJob(match[1] === "stop" ? await jobs.stop(match[2]!) : jobs.get(match[2]!));
}
