/**
 * 34.3 停止无进展任务并保留成果 | [KEEP] processes/takeover.ts
 *
 * Ink suspendTerminal期间的唯一stdin读者。Ctrl+] detach，Ctrl+C交子终端，Ctrl+D按行规送EOF。
 * detach或取消仅收回终端；退出Agent由JobManager.close另行停止自有进程。
 */
import { ToolError } from "../errors.js";
import type { JobManager } from "./jobs.js";

// [KEEP 来自 26.2] 本地人类终端拥有单独的输入通道；没有模型stdin工具。
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
