/**
 * 07.1 执行测试并读懂结果 | [NEW] tools/run-command.ts
 *
 * 学习目标：把命令的退出状态与输出交回模型，让测试结果参与下一次判断。
 * 输入：模型提供的 command、cwd 和本轮取消信号。
 * 输出：准备时返回命令预览与 execute；执行后返回 stdout、stderr、退出码和错误标记。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError
 *             +-- 是 -> cwd 是项目内的真实目录？-- 否 -> ToolError
 *                                               +-- 是 -> 保存目录身份与命令 -> 返回预览
 *   主循环批准后调用 execute -> 目录身份仍相同？-- 否 -> ToolError
 *                                              +-- 是 -> 执行命令 -> 输出和退出状态
 *
 * 这里不读取用户决定，也不在准备阶段启动命令；审批由主循环和终端完成。
 * 非零退出码属于有诊断内容的执行结果，保留报告并标记 isError，供模型决定下一步。
 * cwd 是运行起点，不是沙箱；目录检查也没有锁住路径，不能限制命令读写磁盘或联网。
 * execFile 提供 30 秒与每条流 16 KiB 的限制，本节只管理直接启动的进程。
 * 观察：先看到命令与目录，批准后才运行；测试失败仍会把 stdout 和 stderr 交回模型。
 */

import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [NEW 07.1] 本文件以下实现均为本节新增。
export const runCommandDefinition = {
  name: "run_command",
  description: "经用户逐次批准，在指定项目目录执行非交互 shell 命令；返回 stdout、stderr 和退出码。",
  inputSchema: {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: "完整 shell 命令，例如 node --test；不能包含密钥。" },
      cwd: { type: "string" as const, description: "相对于项目根的执行目录；项目根传入 .。" },
    },
    required: ["command", "cwd"],
    additionalProperties: false,
  },
};

/**
 * 检查模型有没有把本次命令和运行目录说清楚。
 *
 * 输入是未经信任的 JSON 字符串，先检查对象和字段，再检查 command 与 cwd 的值。
 * command 去掉首尾空白后必须有内容；原字符串不能超过 4000 字符或包含 NUL。
 * cwd 只能是 500 字符以内的项目相对目录，不接受控制字符、绝对路径或 ..。
 * 通过后返回整理后的两个字符串；失败抛出 ToolError。这里只检查文字，真实目录稍后再查。
 */
function parseArguments(argumentsJson: string): { command: string; cwd: string } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("run_command 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("run_command 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["command", "cwd"].includes(key))) {
    throw new ToolError("run_command 参数只能包含 command 和 cwd。");
  }
  if (typeof input.command !== "string" || !input.command.trim() || input.command.length > 4000
      || /[\x00\x80-\x9f\u202a-\u202e\u2066-\u2069]/.test(input.command)) {
    throw new ToolError("command 必须是 1—4000 个字符的非空命令，不能包含 NUL 或不可见方向控制字符。");
  }
  if (typeof input.cwd !== "string" || !input.cwd.trim() || input.cwd.length > 500
      || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(input.cwd) || isAbsolute(input.cwd) || win32.isAbsolute(input.cwd)
      || input.cwd.split(/[\\/]/).includes("..")) {
    throw new ToolError("cwd 必须是项目内的相对目录，不能使用绝对路径或 ..。");
  }
  return { command: input.command.trim(), cwd: input.cwd.trim() };
}

/**
 * 给子进程提供基本运行环境，避免直接复制整个 Agent 的环境变量。
 *
 * 保留 HOME、TMPDIR、LANG、LC_ALL，PATH 优先包含当前 Node 所在目录，并设置 NO_COLOR。
 * 返回的新对象不自动带入模型 API Key，也不带 NODE_OPTIONS 或 shell 启动配置变量。
 * 它只控制继承哪些环境变量，不能阻止命令通过磁盘或网络取得其他内容。
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
 * 执行一次 shell 命令，保留成功与失败的实际报告。
 *
 * command 与真实 cwd 已在准备时确定，批准后才传入本函数；signal 沿用当前回合。
 * execFile 启动 /bin/sh -c，异步收集 stdout/stderr；30 秒超时，每条流各限 16 KiB。
 * 回调里的数字错误码表示命令非零退出，仍返回日志和 isError=true；启动失败抛出 ToolError。
 * 用户取消向外抛出取消原因，不再让模型继续；stdin 关闭使非交互命令读到 EOF。
 * 本节只终止直接子进程，07.2 再处理 shell 启动的同组后续进程。
 */
function executeCommand(command: string, cwd: string, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = execFile("/bin/sh", ["-c", command], {
      cwd, env: processEnvironment(), encoding: "utf8", signal,
      timeout: 30_000, maxBuffer: 16 * 1024, killSignal: "SIGKILL",
    }, (error, stdout, stderr) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const code = error?.code;
      if (error && typeof code === "string" && code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && !error.killed) {
        reject(new ToolError(`无法启动 shell：${code}`));
        return;
      }
      const exitCode = error ? (typeof code === "number" ? code : null) : 0;
      const stopReason: "output_limit" | "timeout" | undefined = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit"
        : error?.killed ? "timeout" : undefined;
      const metadata = { kind: "run_command" as const, exitCode,
        signal: error?.signal ?? null, stdout, stderr, stopReason };
      resolveResult({
        isError: Boolean(error), metadata,
        content: `cwd: ${cwd}\n退出码: ${exitCode ?? "无"}\n停止原因: ${stopReason ?? "命令已退出"}`
          + `\nstdout:\n${stdout || "（空）"}\nstderr:\n${stderr || "（空）"}`,
      });
    });
    // 子进程读取 stdin 时立即得到 EOF，不会取走聊天或审批输入。
    child.stdin?.end();
  });
}

/**
 * 准备这一次命令，把启动进程留到用户批准之后。
 *
 * 解析参数后，查到 cwd 的真实位置并确认在项目内，记下目录的 dev/ino。
 * 返回的 preview 展示完整命令与真实目录；execute 闭包保留同一份输入，批准后才调用。
 * execute 先复查目录身份，发现等待期间被替换就抛出 ToolError，否则执行保存的命令。
 * 准备时不启动进程；路径检查与启动仍有时间间隔，也不限制命令自行访问其他路径。
 */
export async function prepareRunCommand(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  if (process.platform === "win32") throw new ToolError("本章命令工具需要 macOS 或 Linux 的 /bin/sh；Windows 请在 WSL 中运行。");
  const input = parseArguments(argumentsJson);
  let cwd: string;
  try {
    const root = await realpath(projectRoot);
    cwd = await realpath(resolve(root, input.cwd));
    const path = relative(root, cwd);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new ToolError("cwd 的真实位置在项目外。");
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("cwd 目录不存在或无法访问。");
  }
  const before = await stat(cwd).catch(() => null);
  if (!before || !before.isDirectory()) throw new ToolError("cwd 必须是可访问的目录。");
  signal?.throwIfAborted();
  return {
    preview: `工作目录：${JSON.stringify(cwd)}\n命令：${JSON.stringify(input.command)}\n只批准这一次执行。`,
    async execute(executionSignal) {
      executionSignal.throwIfAborted();
      const current = await stat(cwd).catch(() => null);
      if (!current || current.dev !== before.dev || current.ino !== before.ino) {
        throw new ToolError("工作目录在等待审批期间发生了变化，请重新请求执行。");
      }
      return executeCommand(input.command, cwd, executionSignal);
    },
  };
}
