/**
 * 11.2 找回旧问题，补全当前输入 | [KEEP 来自 10.4] tools/run-command.ts
 *
 * 学习目标：让模型选择本次时间上限，同时让本地校验和审批看到同一个值。
 * 输入：command、cwd、可选 timeout_ms；省略时使用 30000 毫秒。
 * 输出：带命令、目录和时间的预览；批准后返回真实进程结果。
 * 状态：准备失败时没有启动命令；执行后失败或取消可能已有副作用，不自动回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   JSON -> 检查字段 -> timeout_ms 合法？-- 否 -> ToolError
 *                                      +-- 是 -> 保存 timeoutMs -> 预览
 *   批准 -> 复查目录 -> runProcess 使用同一个 timeoutMs -> 返回输出与状态
 *
 * timeout_ms 必须是 100—60000 之间的整数，不把字符串或 null 自动变成数字。
 * 本次等待时间和命令一起保存，审批后不重新采用默认值，也不保存为会话授权。
 * 时间到达只触发停止过程，仍要等同组清理与管道关闭；它不是命令隔离或回滚。
 * 观察：100 毫秒的常驻命令提前返回 timeout，省略字段时预览显示 30000。
 */

// [KEEP 来自 07.2] spawn 的生命周期交给共享执行器。
import { runProcess } from "../processes/run-process.js";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [KEEP 来自 07.1] 命令定义、参数检查和目录复查继续沿用。
export const runCommandDefinition = {
  name: "run_command",
  description: "经用户逐次批准，在指定项目目录执行非交互 shell 命令；返回 stdout、stderr 和退出码。",
  inputSchema: {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: "完整 shell 命令，例如 node --test；不能包含密钥。" },
      cwd: { type: "string" as const, description: "相对于项目根的执行目录；项目根传入 .。" },
      // [KEEP 来自第 07 章练习] Schema 告诉模型可选字段及范围，本地还会重新校验。
      timeout_ms: {
        type: "integer" as const,
        minimum: 100,
        maximum: 60_000,
        description: "本次命令最多等待多少毫秒；省略时为 30000，范围 100—60000。",
      },
    },
    required: ["command", "cwd"],
    additionalProperties: false,
  },
};

/**
 * 检查模型是否把命令、目录和本次等待时间说清楚。
 *
 * - 输入：未经信任的 JSON 字符串，只接受 command、cwd 与可选 timeout_ms。
 * - 输出：通过检查的 command、cwd 和 timeoutMs；字符串去掉首尾空白后交给后续准备步骤。
 * - 命令检查：原字符串不超过 4000 个字符，去掉空白后仍有内容，并排除 NUL 等指定控制字符。
 * - 目录检查：不超过 500 个字符的项目相对目录，不接受控制字符、绝对路径或 .. 分段。
 * - 时间检查：省略时使用 30000 毫秒，提供时必须是 100—60000 的整数；不自动转换字符串或 null。
 * - 失败方式：无效参数抛出 ToolError；这里只检查参数，真实目录稍后再查。
 */
// [KEEP 来自第 07 章练习] 返回已校验的等待时间，后面的预览和执行共用它。
function parseArguments(argumentsJson: string): { command: string; cwd: string; timeoutMs: number } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("run_command 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("run_command 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["command", "cwd", "timeout_ms"].includes(key))) {
    throw new ToolError("run_command 参数只能包含 command、cwd 和可选 timeout_ms。");
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
  // [KEEP 来自第 07 章练习] 只在字段未提供时用默认值；null、布尔值和数字字符串都不是有效整数。
  const timeoutMs = input.timeout_ms === undefined ? 30_000 : input.timeout_ms;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs)
      || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ToolError("timeout_ms 必须是 100—60000 之间的整数。" );
  }
  return { command: input.command.trim(), cwd: input.cwd.trim(), timeoutMs };
}

/**
 * 把受控进程的状态和输出整理成模型能够继续使用的结果。
 *
 * - 输入：本次批准的命令、真实 cwd、timeoutMs 和取消信号；进程生命周期交给 runProcess。
 * - 输出：保留 stdout、stderr、退出码、信号与停止原因，供模型和界面各自使用。
 * - 结果判断：退出码不是 0，或时间、输出达到上限时，返回 isError=true，仍保留已经收集的日志。
 * - 失败方式：启动失败抛出 ToolError，由主循环反馈给模型；用户取消则向外传播取消原因并结束本轮。
 * - 职责边界：stderr 有字不能单独证明命令失败，本函数也不会撤销命令已经发生的副作用。
 */
// [KEEP 来自 07.2] 命令和 rg 搜索共用同一个进程执行器。
// [KEEP 来自第 07 章练习] timeoutMs 来自本次审批的准备结果，不在执行时重新决定。
async function executeCommand(
  command: string, cwd: string, signal: AbortSignal, timeoutMs: number,
): Promise<ToolExecutionResult> {
  const result = await runProcess("/bin/sh", ["-c", command], { cwd, signal, timeoutMs });
  const { exitCode, signal: exitSignal, stdout, stderr, stopReason } = result;
  return {
    isError: exitCode !== 0 || Boolean(stopReason),
    metadata: { kind: "run_command", ...result },
    content: `cwd: ${cwd}\n退出码: ${exitCode ?? "无"}\n信号: ${exitSignal ?? "无"}`
      + `\n停止原因: ${stopReason ?? "命令已退出"}`
      + `\nstdout:\n${stdout || "（空）"}\nstderr:\n${stderr || "（空）"}`,
  };
}

/**
 * 先把本次命令和目录展示清楚，把启动进程留到用户批准之后。
 *
 * - 输入：命令参数、项目根目录和可选取消信号；准备阶段不会启动进程。
 * - 输出：preview 展示命令、真实 cwd 与等待时间，execute 闭包保存同一份已经检查的输入。
 * - 关键步骤：解析参数后确认 cwd 检查时位于项目内，并记录目录的 dev/ino 身份。
 * - 执行检查：批准后复查目录身份，发现变化就抛出 ToolError，否则用保存的 timeoutMs 执行命令。
 * - 职责边界：路径检查与启动仍有时间间隔，也不限制命令自行访问其他路径，不能当作 shell 沙箱。
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
    // [KEEP 来自第 07 章练习] 用户在启动前也能看到本次等待时间。
    preview: `工作目录：${JSON.stringify(cwd)}\n命令：${JSON.stringify(input.command)}\n最长运行时间（毫秒）：${input.timeoutMs}\n只批准这一次执行。`,
    async execute(executionSignal) {
      executionSignal.throwIfAborted();
      const current = await stat(cwd).catch(() => null);
      if (!current || current.dev !== before.dev || current.ino !== before.ino) {
        throw new ToolError("工作目录在等待审批期间发生了变化，请重新请求执行。");
      }
      return executeCommand(input.command, cwd, executionSignal, input.timeoutMs);
    },
  };
}
