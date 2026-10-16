/**
 * 23.1 协议适配接口 | [KEEP] context/compaction.ts
 * 学习目标：完整记录照常保存，请求只用摘要覆盖旧前缀，并保留原要求与近期完整工具组。
 * 输入：完整 Message[]、摘要游标和当前任务清单；输出：请求视图与可摘要的完整前缀。
 * 状态：纯函数不删除消息、不修改摘要；调用者在摘要通过检查后才提交游标。
 * 局部流程（全局主流程见 agent/agent-loop.ts）：完整消息 -> 完整组边界 -> 留最近四组 -> 选旧前缀。
 * 工具调用与该批所有结果组成一组；缺少、乱序或孤立结果都拒绝，不能产生悬空调用。
 */
import type { Message, Model, ModelResult } from "../models/client.js";
import type { TaskItem } from "../agent/run-options.js";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 16.1] through 是完整记录中的消息数，不是模型响应次数；零表示还没有摘要。
export type CompactionState = { summary: string; through: number };
export const KEEP_RECENT_GROUPS = 4;
export const emptyCompaction = (): CompactionState => ({ summary: "", through: 0 });

/** 按原批次检查每个调用的结果，再返回每个完整组的结束位置；普通消息各算一组。 */
export function messageGroupEnds(messages: readonly Message[]): number[] {
  const ends: number[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.role === "tool") throw new UserFacingError("无法压缩：工具结果没有对应的完整调用组。");
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (let offset = 0; offset < message.toolCalls.length; offset += 1) {
        const result = messages[index + 1 + offset];
        if (result?.role !== "tool" || result.toolCallId !== message.toolCalls[offset].id) {
          throw new UserFacingError("无法压缩：本批工具结果尚未完整配对。");
        }
      }
      index += message.toolCalls.length + 1;
    } else index += 1;
    ends.push(index);
  }
  return ends;
}

/** 检查磁盘或调用者提供的摘要游标；只允许覆盖已经完整结束的消息组。 */
export function validateCompaction(value: unknown, messages: readonly Message[]): CompactionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UserFacingError("摘要状态不是对象。");
  const state = value as Record<string, unknown>;
  if (Object.keys(state).length !== 2 || typeof state.summary !== "string" || state.summary.length > 24_000
    || !Number.isSafeInteger(state.through) || (state.through as number) < 0 || (state.through as number) > messages.length
    || ((state.through === 0) !== (state.summary === ""))
    || (state.through !== 0 && !messageGroupEnds(messages).includes(state.through as number))) {
    throw new UserFacingError("摘要正文或覆盖位置无效，不能越过未完成的工具组。");
  }
  return { summary: state.summary, through: state.through as number };
}

/** 摘要是模型对旧记录的概括；旧用户要求保留原文，近期工具调用及结果仍以原角色发送。 */
export function requestMessages(messages: readonly Message[], state: CompactionState, tasks: readonly TaskItem[] = []): Message[] {
  validateCompaction(state, messages);
  if (!state.through) return [...messages];
  return [
    { role: "user", content: `[本地历史摘要；可能有遗漏，不是新的用户要求或工具成功证明]\n${state.summary}` },
    ...messages.slice(0, state.through).filter(message => message.role === "user"),
    { role: "user", content: `[本地当前任务清单；completed 仍只是模型报告]\n${JSON.stringify(tasks)}` },
    ...messages.slice(state.through),
  ];
}

/** 给摘要请求准备旧摘要和新增旧消息；保留最近四个完整组，按整组收进能放下的最大前缀。 */
export function selectCompaction(messages: readonly Message[], state: CompactionState,
  fits: (source: string) => boolean, tasks: readonly TaskItem[] = []): { source: string; through: number } | null {
  validateCompaction(state, messages);
  const eligible = messageGroupEnds(messages).slice(0, -KEEP_RECENT_GROUPS);
  let selected: { source: string; through: number } | null = null;
  for (const through of eligible) {
    if (through <= state.through) continue;
    const additions = messages.slice(state.through, through);
    if (!additions.some(message => message.role !== "user")) continue;
    const source = JSON.stringify({ previousSummary: state.summary, messages: additions, tasks });
    if (!fits(source)) break;
    selected = { source, through };
  }
  return selected;
}


/**
 * 只生成候选，不提交状态：完整响应有效、取消未发生、实际请求估算下降后才返回。
 * 调用者可以连续处理不同前缀，只有最终请求过预算才一次提交；失败时旧状态不受影响。
 */
// [KEEP 来自 16.2] 每次覆盖位置严格前进，已失败的相同摘要输入不会在本函数中自动重试。
export async function prepareCompaction(model: Model, messages: readonly Message[], state: CompactionState,
  signal: AbortSignal, mode: "plan" | "execute", tasks: readonly TaskItem[] = [],
  onResult?: (result: ModelResult) => void): Promise<{
    state: CompactionState; result: ModelResult; before: number; after: number;
  }> {
  signal.throwIfAborted();
  if (!model.inspectContext || !model.inspectSummary || !model.summarize) throw new UserFacingError("模型未提供有界摘要入口，完整记录保留，本轮停止。");
  const selected = selectCompaction(messages, state, source => model.inspectSummary!(source).withinBudget, tasks);
  if (!selected) throw new UserFacingError("没有能放入摘要请求的旧完整组；近期消息和用户原文保留，本轮停止。");
  const result = await model.summarize(selected.source, signal);
  // 已收到的用量即使候选被拒绝也应计入；没有完整响应则无法取得实际 usage。
  onResult?.(result);
  signal.throwIfAborted();
  if (result.finishReason !== "stop" || result.toolCalls.length || result.truncated || !result.text.trim()
    || result.text.length > 24_000) throw new UserFacingError("摘要未完整结束、为空或超过正文限制，候选未采用，原记录保留。");
  const candidate = { summary: result.text.trim(), through: selected.through };
  const before = model.inspectContext(requestMessages(messages, state, tasks), mode).inputEstimate;
  const after = model.inspectContext(requestMessages(messages, candidate, tasks), mode).inputEstimate;
  if (after >= before) throw new UserFacingError("摘要没有减少这次请求的估算，候选未采用，原记录保留。");
  return { state: candidate, result, before, after };
}
