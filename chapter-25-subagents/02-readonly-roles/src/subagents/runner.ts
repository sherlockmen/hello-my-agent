/**
 * 25.2 只读角色与结果 | [CHANGED] subagents/runner.ts
 *
 * 学习目标：用相同循环创建独立子会话，父任务等待结构化结果再继续。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：delegate_task -> 新JSONL/独立history -> 只读AgentLoop -> 保存/关闭 -> ChildResult
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { randomUUID } from "node:crypto";
import { agentLoop } from "../agent/agent-loop.js";
import type { AgentObserver } from "../agent/events.js";
import type { Message, Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { createSessionWriter, type SessionWriter } from "../sessions/save-session.js";
import { DEFAULT_CONTEXT_LIMITS, estimateContext } from "../context/budget.js";
import { ToolError, UserFacingError } from "../errors.js";

export const CHILD_TOOLS = ["read_file", "glob", "grep"] as const;
export type ChildRole = "explore" | "review";
export type ChildStatus = "completed" | "failed" | "cancelled" | "budget_exhausted";
// [CHANGED 25.2] 从成功本地工具元数据收集有界证据，保留未知用量。
export type ChildEvidence = { kind: "read" | "match" | "listed"; path: string; startLine?: number; endLine?: number };
export type ChildResult = { sessionId: string; parentSessionId: string; role: ChildRole; status: ChildStatus; summary: string; evidence: ChildEvidence[]; usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; cacheWriteTokens: number | null }; modelCalls: number; requestTokensReserved: number; error?: string };
export type ChildOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver; depth?: number; maxModelCalls?: number; requestTokenBudget?: number };

export class ChildBudgetError extends UserFacingError {}

/**
 * 委派参数只接纳明确角色和有界任务；没有路径、权限、命令或子工具配置入口。
 * 不合法参数在创建子会话或发送模型请求前变为普通工具错误。
 */
export function parseChildTask(argumentsJson: string): { role: ChildRole; task: string } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw new ToolError("委派参数必须是 JSON 对象。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("委派参数必须是 JSON 对象。");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).sort().join() !== "role,task" || args.role !== "explore" && args.role !== "review" || typeof args.task !== "string" || !args.task.trim() || args.task.length > 2000) throw new ToolError("委派需要 role=explore|review 和 1–2000 字符的 task，不能增加权限字段。");
  return { role: args.role, task: args.task.trim() };
}

/**
 * 包装同一模型连接，但只携带本次角色与只读定义；不暴露共享管理状态或父历史。
 * 请求次数和累计输入估算加输出预留在真正 generate 前扣除，缺少服务商 usage 也有本地硬边界。
 */
function childModel(model: Model, role: ChildRole, maxCalls: number, tokenBudget: number, metrics: { calls: number; responses: number; reserved: number }): Model {
  const scope = { allowedTools: [...CHILD_TOOLS], rolePrompt: role === "explore" ? "你是只读探索子助手。调查任务需要的文件和调用关系，区分事实与猜测；返回简明发现、未解决问题。只读，不执行命令，不委派。" : "你是只读审查子助手。审查已有文件，优先报告可定位的问题、影响和不确定性；没有证据不要编造缺陷。只读，不执行命令，不委派。" };
  return {
    beginRun: model.beginRun?.bind(model),
    inspectContext: (messages, mode) => model.inspectContext?.(messages, mode, scope) ?? estimateContext(messages, scope.rolePrompt, [], DEFAULT_CONTEXT_LIMITS),
    estimateCost: model.estimateCost?.bind(model),
    async generate(messages, signal, onText, options) {
      signal.throwIfAborted();
      const budget = model.inspectContext?.(messages, "plan", scope) ?? estimateContext(messages, scope.rolePrompt, [], DEFAULT_CONTEXT_LIMITS);
      const charge = budget.inputEstimate + budget.outputReserve;
      if (!budget.withinBudget || metrics.calls >= maxCalls || metrics.reserved + charge > tokenBudget) throw new ChildBudgetError("子任务请求次数或本地累计 token 预留已用尽。");
      metrics.calls++; metrics.reserved += charge;
      const response = await model.generate(messages, signal, onText, { ...options, mode: "plan", ...scope });
      metrics.responses++; return response;
    },
  };
}

/**
 * 复用 Agent Loop 创建独立的串行子会话；父调用 await 返回，不建立后台工作或并行调度。
 * 子历史、清单、摘要游标、授权与预算各自持有；父取消等待子循环、检查点与句柄关闭。
 * 失败和取消仍返回结构化状态，写盘失败不会掩盖原取消，finally 总尝试关闭会话锁。
 */
export async function runSubagent(model: Model, argumentsJson: string, signal: AbortSignal, options: ChildOptions = {}): Promise<ChildResult> {
  const { role, task } = parseChildTask(argumentsJson);
  const parentSessionId = options.parentSessionId ?? randomUUID();
  const history: Message[] = [], metrics = { calls: 0, responses: 0, reserved: 0 };
  const result: ChildResult = { sessionId: randomUUID(), parentSessionId, role, status: "failed", summary: "", evidence: [], usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }, modelCalls: 0, requestTokensReserved: 0 };
  let writer: SessionWriter | undefined;
  let usageReports = 0;
  const maxCalls = Math.min(4, Math.max(1, Math.floor(Number.isFinite(options.maxModelCalls) ? options.maxModelCalls! : 4)));
  const tokenBudget = Math.min(32_768, Math.max(1, Math.floor(Number.isFinite(options.requestTokenBudget) ? options.requestTokenBudget! : 32_768)));
  const observe: AgentObserver = event => {
    if (event.type === "model_usage") { usageReports++; result.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens ?? null, cacheWriteTokens: event.cacheWriteTokens ?? null }; }
    collectEvidence(result.evidence, event);
    options.observer?.(event);
  };
  try {
    signal.throwIfAborted();
    if ((options.depth ?? 0) >= 1) throw new UserFacingError("子任务深度最多为 1，子助手不能继续委派。");
    writer = await createSessionWriter(options.sessionDirectory, { sessionId: parentSessionId, seq: 0 }); result.sessionId = writer.id;
    await writer.save({ messages: [], mode: "plan", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_start");
    const reply = await agentLoop(childModel(model, role, maxCalls, tokenBudget, metrics), history, task, signal, observe, options.requestApproval, new Set(), { mode: "plan", allowedTools: [...CHILD_TOOLS], childDepth: 1, maxModelCalls: maxCalls });
    result.status = "completed"; result.summary = reply.text;
  } catch (error) {
    result.status = signal.aborted ? "cancelled" : error instanceof ChildBudgetError ? "budget_exhausted" : "failed";
    result.error = signal.aborted ? "父任务取消，子任务已停止。" : error instanceof UserFacingError || error instanceof ToolError ? error.message : "子任务未取得完整结果。";
  } finally {
    // 请求发出而未取得完整响应时用量未知；本地清理事件或初始零不能证明没有消耗。
    if (metrics.responses < metrics.calls) result.usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null };
    if (usageReports < metrics.calls) result.usage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null };
    result.modelCalls = metrics.calls; result.requestTokensReserved = metrics.reserved;
    if (writer) {
      try { await writer.save({ messages: history, mode: "plan", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_end"); }
      catch { if (result.status === "completed") result.status = "failed"; result.error = `${result.error ?? ""} 子会话检查点保存失败。`.trim(); }
      finally { try { await writer.close(); } catch { if (result.status === "completed") result.status = "failed"; result.error = `${result.error ?? ""} 子会话关闭失败。`.trim(); } }
    }
  }
  return result;
}

/**
 * 证据只取成功只读工具的本地 metadata；模型最终文字不能自行添加路径或行号。
 * read 区分实际读取范围，match 区分搜索命中，listed 仅说明目录枚举发现；有界去重后返回父任务。
 */
function collectEvidence(evidence: ChildEvidence[], event: import("../agent/events.js").AgentEvent): void {
  if (event.type !== "tool_finish" || event.outcome !== "success" || event.result.isError) return;
  const metadata = event.result.metadata;
  const candidates: ChildEvidence[] = [];
  if (metadata.kind === "read_file" && "startLine" in metadata) {
    const args = JSON.parse(event.call.arguments) as { path: string };
    candidates.push({ kind: "read", path: args.path.trim(), startLine: metadata.startLine, endLine: metadata.endLine });
  } else if (metadata.kind === "grep") {
    candidates.push(...metadata.locations.map(item => ({ kind: "match" as const, path: item.path, startLine: item.line, endLine: item.line })));
  } else if (metadata.kind === "glob") candidates.push(...metadata.paths.map(path => ({ kind: "listed" as const, path })));
  for (const item of candidates) {
    if (evidence.length >= 32) break;
    if (!item.path || item.path.startsWith("/") || item.path.split(/[\\/]/).includes("..")) continue;
    if (!evidence.some(old => JSON.stringify(old) === JSON.stringify(item))) evidence.push(item);
  }
}
