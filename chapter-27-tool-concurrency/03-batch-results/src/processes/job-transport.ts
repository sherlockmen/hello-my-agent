/**
 * 27.3 整批结果屏障 | [KEEP] processes/job-transport.ts
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

// [KEEP 来自 26.2] transport只暴露本次创建的句柄；不能用任意PID构造它。
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
