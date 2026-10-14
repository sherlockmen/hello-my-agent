/**
 * 09.2 按顺序接收执行事件 | [KEEP] tools/ripgrep.ts
 *
 * 学习目标：共用进程执行器，但按 rg 的规则解释退出状态与失败。
 * 输入：本地程序组装的参数数组、项目根和取消信号；输出：完整收集到的预算内进程结果。
 * 状态：失败时不把残缺输出当作搜索结果；本文件不修改会话历史或搜索目标。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数数组 -> 加入固定选项和内置排除 -> runProcess("rg", ...)
 *   无法启动？-- 是 -> ToolError；找不到时提示安装
 *             +-- 否 -> 超时或超量？-- 是 -> ToolError，要求缩小查询
 *                                   +-- 否 -> 退出码 0 或 1？-- 是 -> 返回
 *                                                          +-- 否 -> 返回错误原因
 *
 * 每次 rg 任务最多运行 10 秒、合计收集 256 KiB；没有 shell，查询不会变成 shell 操作。
 * 0 表示找到匹配，1 表示没有匹配，其他状态不能解释为空结果。
 * 排除规则放在模型的正向范围后面，环境配置与内置目录不能被重新包含。
 * 观察：rg 不存在时有安装提示，无效正则会保留 rg 的诊断，不静默退回同步搜索。
 */

import { ToolError } from "../errors.js";
import { runProcess, type ProcessResult } from "../processes/run-process.js";

// [KEEP 来自 07.3] 沿用 rg 参数约束、进程预算和退出状态解释。
/**
 * 执行一次固定用途的 rg 请求，返回可以继续解析的完整输出。
 *
 * args 由 glob 或 grep 在本地构造，查询、选项和路径按数组分开，不交给 shell 解释。
 * 禁用用户 rg 配置和父目录/全局忽略规则，再把内置排除放在模型范围之后。
 * 执行时采用 10 秒与两条输出合计 256 KiB 的预算；缺少 rg、被限额停止或异常退出都抛出 ToolError。
 * 只放行退出码 0 与 1，调用方据此解析路径或 JSON；不解析被截断的半行内容。
 * 本层保留 rg 自身的文件忽略语义，根 .gitignore 的再次过滤在 glob 中完成。
 */
export async function runRipgrep(
  args: string[], cwd: string, signal?: AbortSignal, paths: string[] = ["."],
): Promise<ProcessResult> {
  const exclusions = [".git", ".agents", ".codex", "node_modules", "dist"]
    .flatMap((name) => ["--iglob", `!**/${name}/**`]);
  exclusions.push("--iglob", "!**/.env", "--iglob", "!**/.env.*", "--iglob", "!**/.envrc");
  let result: ProcessResult;
  try {
    result = await runProcess("rg", [
      "--no-config", "--color", "never", "--hidden", "--no-ignore-global", "--no-ignore-parent",
      "--no-require-git", "--threads", "1", ...args, ...exclusions,
      "--", ...paths,
    ], { cwd, signal, timeoutMs: 10_000, maxOutputBytes: 256 * 1024 });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ToolError && error.message.includes("ENOENT")) {
      throw new ToolError("找不到 rg。请先安装 ripgrep，并确认 rg --version 可以运行。");
    }
    throw error;
  }
  if (result.stopReason) throw new ToolError(`rg 因 ${result.stopReason === "timeout" ? "超过 10 秒" : "输出超过 256 KiB"} 停止，请缩小 glob 或 query。`);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new ToolError(`rg 搜索失败（退出码 ${result.exitCode ?? "无"}）：${result.stderr.slice(0, 1000)}`);
  }
  return result;
}
