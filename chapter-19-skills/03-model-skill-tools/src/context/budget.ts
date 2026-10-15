/**
 * 19.3 模型选择与资源读取 | [KEEP] context/budget.ts
 *
 * 学习目标：区分发出前的本地估算、服务商返回的用量和按配置价格计算的费用估计。
 * 输入：准备发送的系统提示、工具定义、消息，以及本地选择的窗口和输出预留。
 * 输出：分别列出的估算与剩余预算；不探测服务商窗口，也不承诺精确 token 数。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   文本 UTF-8 字节 -> 启发式 token 数；系统 + 工具 + 消息 -> 本次输入估算
 *   窗口 - 输出预留 - 输入估算 -> 剩余预算；服务商 usage + 本地单价 -> 非账单费用估计
 */
import type { Message } from "../models/client.js";

// [KEEP 来自 15.1] 窗口与价格来自本地配置，不是服务商已经确认的模型规格。
export type ContextLimits = {
  windowTokens: number;
  outputReserve: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
};
export type ContextBudget = {
  inputEstimate: number;
  systemEstimate: number;
  toolsEstimate: number;
  messagesEstimate: number;
  windowTokens: number;
  outputReserve: number;
  remainingEstimate: number;
  withinBudget: boolean;
};
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { windowTokens: 32_768, outputReserve: 2_048 };

/**
 * 用 UTF-8 字节数作统一的本地近似，避免把字符数冒充服务商 tokenizer 的结果。
 * 每三个字节约算一个 token；中文、英文、代码的真实切分都可能不同。
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 3);
}

/**
 * 把本次输入的各部分相加，再扣除本地为输出预留的位置。
 * 消息按 JSON 文本估算，包含角色、工具调用 ID 和参数；每项再加 8 的消息开销。
 * 工具定义含名称、说明、参数 Schema；额外 32 代表协议开销的近似，不是精确协议计费。
 * withinBudget 只比较本地数字，服务商仍可能按自己的窗口和切分拒绝请求。
 */
export function estimateContext(messages: Message[], prompt: string, definitions: unknown[], limits: ContextLimits): ContextBudget {
  const systemEstimate = estimateTextTokens(prompt) + 8;
  const toolsEstimate = estimateTextTokens(JSON.stringify(definitions)) + 16;
  const messagesEstimate = messages.reduce((sum, message) => sum + estimateTextTokens(JSON.stringify(message)) + 8, 0) + 32;
  const inputEstimate = systemEstimate + toolsEstimate + messagesEstimate;
  const remainingEstimate = limits.windowTokens - limits.outputReserve - inputEstimate;
  return { inputEstimate, systemEstimate, toolsEstimate, messagesEstimate, windowTokens: limits.windowTokens,
    outputReserve: limits.outputReserve, remainingEstimate, withinBudget: remainingEstimate >= 0 };
}

/**
 * 用服务商报告的本次 usage 和用户提供的美元单价计算费用估计。
 * 任一用量或单价缺失时返回 null；缓存、折扣等账单规则未计入，不能当作实际扣费。
 */
export function estimateCostUsd(input: number | null, output: number | null, limits: ContextLimits): number | null {
  if (input === null || output === null || limits.inputPricePerMillion === undefined || limits.outputPricePerMillion === undefined) return null;
  const cost = (input * limits.inputPricePerMillion + output * limits.outputPricePerMillion) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}
