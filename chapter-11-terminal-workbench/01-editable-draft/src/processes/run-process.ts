/**
 * 11.1 多行草稿、粘贴与撤销 | [KEEP 来自 10.4] processes/run-process.ts
 *
 * 学习目标：启动外部程序后，负责它的输出、停止和同组进程清理。
 * 输入：程序名称、参数数组、真实 cwd、取消信号、时间与合计输出上限。
 * 输出：stdout/stderr、退出码、终止信号与可选停止原因；启动失败或取消向外抛出。
 * 状态：失败和取消会清理同组进程，不能撤销进程结束前已经产生的文件或网络副作用。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError
 *             +-- 是 -> spawn 独立进程组 -> 读取两条输出
 *   超时 / 超量 / 取消 -> 首次停止？-- 是 -> SIGTERM -> 300 ms 后 SIGKILL
 *                                   +-- 否 -> 保留第一次停止原因
 *   直接子进程 exit -> 请求清理同组残留 -> 等 close
 *   close -> 清理定时器和取消监听 -> 再清理同组残留
 *         -> 已取消？-- 是 -> 抛出取消原因
 *                    +-- 否 -> 启动失败？-- 是 -> ToolError
 *                                       +-- 否 -> 返回结果
 *
 * 输出预算按两条流的字节合计，默认 32 KiB；超出部分继续从管道读出，但不保存在内存。
 * 默认 30 秒只触发停止请求，随后还要等进程与管道关闭，不能把计时器返回当成进程已结束。
 * stdin 使用 ignore，子进程读到 EOF，不取走聊天或审批输入。
 * 只管理仍在本次 POSIX 进程组里的程序；脱离进程组的服务与操作系统隔离留到后续章节。
 * 观察：超时和超量返回已有日志与停止原因，取消在清理后向外结束本轮。
 */

import { spawn } from "node:child_process";
import { delimiter, dirname } from "node:path";
import { ToolError } from "../errors.js";

// [KEEP 来自 07.2] 命令和搜索共用这里的进程控制。
export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stopReason?: "timeout" | "output_limit";
};

/**
 * 给外部程序构造必要的环境变量，不直接复制 Agent 的全部环境。
 *
 * 返回包含 HOME、TMPDIR、语言设置、PATH 和 NO_COLOR 的新对象。
 * PATH 优先包含当前 Node 的目录，方便相同机器上的测试调用同一个 Node。
 * 不自动传递模型 API Key、NODE_OPTIONS 或 BASH_ENV；它并不限制磁盘与网络访问。
 */
function processEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`;
  env.NO_COLOR = "1";
  return env;
}

/**
 * 运行一次非交互进程，并在结束前处理它的输出和同组进程。
 *
 * file/args 直接交给 spawn，函数本身不拼接 shell 命令；调用方若传入 /bin/sh，才会执行 shell。
 * 时间与输出上限必须为正整数。两条输出共用字节预算，观察到超出字节时才记录 output_limit。
 * 超时或超量返回已有日志和停止原因，由调用方解释；用户取消在 close 后抛出 signal.reason。
 * 启动失败转换成 ToolError。close 时清理监听、定时器及同组残留，再决定成功返回还是抛错。
 * 它不保存完整日志、不回滚副作用，也不能追踪主动脱离当前 POSIX 进程组的程序。
 */
export function runProcess(
  file: string,
  args: string[],
  { cwd, signal, timeoutMs = 30_000, maxOutputBytes = 32 * 1024 }: {
    cwd: string; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number;
  },
): Promise<ProcessResult> {
  signal?.throwIfAborted();
  if (process.platform === "win32") throw new ToolError("本章进程组控制需要 macOS/Linux；Windows 请使用 WSL。");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new ToolError("进程时间与输出上限必须是正整数。");
  }
  return new Promise((resolveResult, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let stopReason: ProcessResult["stopReason"];
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(file, args, {
      cwd, env: processEnvironment(), shell: false, detached: true,
      // ignore 使子进程读取 stdin 时得到 EOF，不会争抢用户的输入。
      stdio: ["ignore", "pipe", "pipe"],
    });

    // detached 在 POSIX 下建立新进程组；负 pid 只指向本次启动的这一组。
    const killGroup = (sentSignal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, sentSignal); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(sentSignal);
      }
    };
    // 只接受第一次停止原因，避免同一次超量随后又被超时覆盖。
    const stop = (reason?: ProcessResult["stopReason"]) => {
      if (stopping) return;
      stopping = true;
      stopReason = reason;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), 300);
    };
    const onAbort = () => stop();
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    // 两条管道先到的数据先占用同一预算；超过预算的内容读出后直接丢弃。
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, maxOutputBytes - bytes);
      if (remaining) chunks.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += Math.min(remaining, chunk.length);
      if (chunk.length > remaining) stop("output_limit");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    // 直接子进程先退出、后台子进程仍持有管道时，也不能一直等 close。
    child.once("exit", () => {
      if (!stopping) {
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 300);
      }
    });
    let spawnError: Error | undefined;
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (exitCode, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      // 即使剩余子进程关闭了管道，也清理仍属于本次组的进程。
      killGroup("SIGKILL");
      if (signal?.aborted) { reject(signal.reason); return; }
      if (spawnError) {
        reject(new ToolError(`无法启动 ${file}：${(spawnError as NodeJS.ErrnoException).code ?? "未知错误"}`));
        return;
      }
      resolveResult({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode, signal: exitSignal, stopReason });
    });
  });
}
