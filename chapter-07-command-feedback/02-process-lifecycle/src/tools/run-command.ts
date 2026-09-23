/**
 * 07.2 停止卡住或输出过多的命令 | [CHANGED] tools/run-command.ts
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
 * 进程启动、合计输出预算和同组清理交给 processes/run-process.ts；这里解释成工具结果。
 * 观察：先看到命令与目录，批准后才运行；测试失败仍会把 stdout 和 stderr 交回模型。
 */

// [CHANGED 07.2] spawn 的生命周期交给共享执行器。
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
 * 把受控进程的结束状态与输出整理成模型能够使用的工具结果。
 *
 * 输入是本次批准的 command、真实 cwd 和取消信号；runProcess 负责实际进程生命周期。
 * 退出码不是 0，或者因时间/输出上限停止时，返回 isError=true，同时保留已收集的日志。
 * stdout 和 stderr 不用来互相推断成功与失败；信号终止时可能没有数字退出码。
 * 启动失败抛出 ToolError，由主循环转成工具错误交回模型，模型仍可继续决策。
 * 用户取消则向外传播取消原因，结束当前回合，不再请求模型。
 */
// [CHANGED 07.2] 命令不再自行管理子进程；搜索将在 07.3 复用同一执行器。
async function executeCommand(command: string, cwd: string, signal: AbortSignal): Promise<ToolExecutionResult> {
  const result = await runProcess("/bin/sh", ["-c", command], { cwd, signal });
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
