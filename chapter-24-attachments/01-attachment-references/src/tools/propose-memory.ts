/**
 * 24.1 附件引用 | [KEEP] tools/propose-memory.ts
 * 输入：模型候选正文和理由；输出：项目范围、正文和来源预览，以及批准后才运行的保存闭包。
 * 状态：准备与拒绝不写盘；保存成功仅影响下一项用户任务。没有本地项目入口不能推测存储位置。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：JSON校验 -> 固定候选 -> 展示审批 -> allow_once -> 原子保存。
 * 观察：聊天、项目文字或模型声称已批准都不能替代实际审批返回值。
 */
import { ToolError, UserFacingError } from "../errors.js";
import { changeMemory, memoryText } from "../memory/store.js";
import type { PreparedToolCall } from "./types.js";

// [KEEP 来自 18.2] 本文件以下实现均为本节新增。
export const proposeMemoryDefinition = {
  name: "propose_memory",
  description: "建议保存本项目可复用的长期记忆。content是最多1000字正文，reason说明来源或依据（最多240字）。程序展示项目范围与候选，用户逐次批准后才保存；拒绝不保存。不能保存密钥或把规则、历史自动当记忆；成功在下一项用户任务生效。",
  inputSchema: {
    type: "object" as const,
    properties: { content: { type: "string" as const, minLength: 1, maxLength: 1000 }, reason: { type: "string" as const, minLength: 1, maxLength: 240 } },
    required: ["content", "reason"], additionalProperties: false,
  },
};

/**
 * 校验并固定这次候选；返回的execute只能由既有逐次审批通道调用。
 */
export async function prepareMemory(argumentsJson: string, root: string | undefined, signal: AbortSignal): Promise<PreparedToolCall> {
  signal.throwIfAborted();
  if (!root) throw new ToolError("当前运行未连接项目记忆，不能保存模型候选。");
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw new ToolError("propose_memory参数不是有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("propose_memory需要content和reason。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("content" in input) || !("reason" in input)) throw new ToolError("propose_memory只能包含content和reason。");
  let content: string, reason: string;
  try { content = memoryText(input.content); reason = memoryText(input.reason, 240); }
  catch (error) { throw new ToolError(error instanceof Error ? error.message : "候选内容无效。"); }
  const source = { kind: "model" as const, detail: `模型建议，用户逐次批准；依据：${reason}` };
  return {
    preview: `保存项目长期记忆\n真实项目根：${JSON.stringify(root)}\n候选正文：${content}\n来源：${source.detail}\n保存到：.hello-my-agent/memory.json\n仅本次批准；保存后在下一项用户任务加载。`,
    async execute(activeSignal) {
      let entry;
      try { entry = await changeMemory(root, { action: "add", content, source }, activeSignal); }
      catch (error) { activeSignal.throwIfAborted(); if (error instanceof UserFacingError) throw new ToolError(error.message); throw error; }
      return { content: `记忆已保存：${entry!.id}；来源：${source.detail}。下一项用户任务加载；当前任务请求快照未改变。`, metadata: { kind: "memory", id: entry!.id } };
    },
  };
}
