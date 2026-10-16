/**
 * 29.3 Agent 消息与确认 | [KEEP] hooks/lifecycle.ts
 *
 * 学习目标：执行前钩子与显式启用；本文件把可信本地配置接到现有工具与取消通道。
 * 输入：本地配置或工具请求、取消信号；输出：完整结果或可诊断的错误。
 * 状态：完整校验后才提交内存状态；外部副作用不能靠取消自动撤销。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   校验输入 -> 有效？-- 否 -> 错误；是 -> 等待操作 -> 完成 / 失败 / 取消 -> 清理
 * 观察：失败有明确反馈，取消等待本地清理，不把外部文字当作批准。
 */

import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { runProcess } from "../processes/run-process.js";
import type { ToolCall } from "../tools/registry.js";

// [KEEP 来自 20.1] 执行器基础始于20.1，扩展的事件与分支在对应位置另行标记。
// [KEEP 来自 20.2] 后置输出作为反馈，不重新执行原工具。
// [KEEP 来自 20.3] stop只收尾一次，不把反馈重新交模型而形成结束循环。
export type HookEvent = "before_tool" | "after_tool" | "stop";
type Hook = { command: string; args: string[]; timeout_ms: number };
export type HookState = { root: string; hooks: Partial<Record<HookEvent, Hook[]>> };

/**
 * 只在本地启动参数明确启用后读取项目钩子，默认不打开配置、更不启动脚本。
 * 限制配置32KiB、每事件最多8条；命令以参数数组执行，不隐式打开shell。
 * 完整配置校验失败就拒绝启动；配置不携带环境变量或模型凭据。
 */
export async function loadHooks(root: string, enabled: boolean): Promise<HookState | undefined> {
  if (!enabled) return undefined;
  let handle;
  try {
    handle = await open(join(root, ".hello-my-agent/hooks.json"), "r");
    const bytes = Buffer.alloc(32769);
    if ((await handle.stat()).size > 32768) throw new ToolError("Hooks 配置超过 32768 字节。");
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw new ToolError("Hooks 配置超过 32768 字节。");
    const input: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const hooks: HookState["hooks"] = {};
    for (const [event, value] of Object.entries(input)) {
      if (!["before_tool", "after_tool", "stop"].includes(event) || !Array.isArray(value) || value.length > 8) throw new Error();
      hooks[event as HookEvent] = value.map((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error();
        const record = item as Record<string, unknown>;
        if (Object.keys(record).some(key => !["command", "args", "timeout_ms"].includes(key))
          || typeof record.command !== "string" || !record.command.trim()
          || !Array.isArray(record.args) || record.args.length > 64 || record.args.some(arg => typeof arg !== "string" || arg.length > 4096)
          || (record.timeout_ms !== undefined && (!Number.isSafeInteger(record.timeout_ms) || Number(record.timeout_ms) < 1 || Number(record.timeout_ms) > 30000))) throw new Error();
        return { command: record.command, args: record.args as string[], timeout_ms: Number(record.timeout_ms ?? 5000) };
      });
    }
    return { root: await realpath(root), hooks };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("Hooks 配置缺失或无效；请检查事件名与 command / args / timeout_ms。");
  } finally { await handle?.close(); }
}

/**
 * 串行运行已启用的事件脚本，stdin是一条JSON，stdout只能是一条约定JSON。
 * before_tool输出continue:false会阻止工具；输出不能改参数或授予权限。
 * 非零退出、格式错误、超时和超量是失败；取消先等待进程清理，再向外抛出。
 */
export async function runHooks(state: HookState | undefined, event: HookEvent,
  payload: { call?: ToolCall; result?: string; outcome?: string }, signal: AbortSignal): Promise<{ blocked: boolean; messages: string[] }> {
  const messages: string[] = [];
  for (const hook of state?.hooks[event] ?? []) {
    signal.throwIfAborted();
    const result = await runProcess(hook.command, hook.args, { cwd: state!.root, signal,
      timeoutMs: hook.timeout_ms, maxOutputBytes: 8192,
      input: JSON.stringify({ event, ...payload }) + "\n" });
    if (result.stopReason || result.exitCode !== 0) throw new ToolError(`钩子 ${event} 失败：${result.stopReason ?? `退出码 ${result.exitCode}`}。脚本已清理，已有副作用不会撤销。`);
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      value = parsed as Record<string, unknown>;
      if (Object.keys(value).some(key => !["continue", "message"].includes(key))
        || (value.continue !== undefined && typeof value.continue !== "boolean")
        || (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 4096))) throw new Error();
    } catch { throw new ToolError(`钩子 ${event} 的 stdout 必须是单个 JSON 对象，字段仅 continue 和 message。`); }
    if (typeof value.message === "string" && value.message) messages.push(value.message);
    if (event === "before_tool" && value.continue === false) return { blocked: true, messages };
  }
  return { blocked: false, messages };
}
