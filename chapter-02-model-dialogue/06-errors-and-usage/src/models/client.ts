/**
 * 02.6 说明错误与显示用量 | [CHANGED] models/client.ts
 *
 * 学习目标：隐藏 OpenAI 与 Anthropic 的字段差异，让上层只调用统一的 Model.generate()。
 * 输入：Config、当前消息数组和 AbortSignal。
 * 输出：统一的文本、token 用量和截断标记；空文本、工具调用或不支持的内容会抛出安全错误。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-----------------+
 *   | Config.provider |
 *   +--------+--------+
 *            +-- openai ----> +------------------+
 *            |                | Chat Completions |
 *            |                +--------+---------+
 *            +-- anthropic --> +--------------+
 *                             | Messages API |
 *                             +------+-------+
 *                                    v
 *                          +-------------------+
 *                          | validate/normalize|
 *                          +---------+---------+
 *                                    | 失败 --> UserFacingError
 *                                    | 成功 --> Reply
 *
 * 关键点：SDK 负责 HTTP、认证和取消；本模块负责协议转换与响应边界。上层不出现服务商字段。
 * 运行观察：切换 provider 后，agentLoop() 和终端仍收到相同形状的 Reply。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, type Config } from "../config/load-config.js";
// [CHANGED 02.6] 安全错误类迁移到独立错误模块。
import { UserFacingError } from "../errors.js";

// [KEEP] 消息角色与模型结果。null 用量表示未知，truncated 表示输出达到上限。
export type Message = { role: "user" | "assistant"; content: string };
// [CHANGED 02.6] 在文本结果上追加用量与截断信息，核心的执行顺序不变。
export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};

// [KEEP] 两种协议共用的模型接口：接收消息和取消信号，异步返回回答。
// 这是本教程的 TypeScript 接口；generate 是本地方法，不是服务商的 HTTP 路径。
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}

// [KEEP] 只创建用户选择的客户端。超时单位是毫秒；本章关闭自动重试，避免一次输入发送多次。
// 显式关闭 SDK 调试日志，错误只由 errors.ts 的格式化函数转换后输出，避免记录请求头或原始响应。
/**
 * 根据已经校验的配置创建统一模型对象，隐藏 OpenAI 与 Anthropic SDK 的差异。
 *
 * - 输入：`config` 包含已选服务商、密钥、模型 ID 和基础地址。
 * - 输出：返回只暴露 `generate()` 的 `Model`，调用方不需要判断服务商。
 * - 关键步骤：只创建当前协议的 SDK 客户端，并关闭自动重试与 SDK 日志。
 * - 前置条件：协议、必填值和地址已经由 `readConfig()` 校验。
 * - 失败方式：不捕获 SDK 初始化异常；创建对象时不发送请求，真正的请求发生在 `generate()` 中。
 */
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // 调用方只需发送消息；SDK 对象、模型 ID 和两种协议的字段差异留在本模块。
  return { generate: (messages, signal) => requestReply(client, config.model, messages, signal) };
}

/**
 * 把服务商返回的用量字段转换成通过基础数字检查的 token 数量。
 *
 * - 输入：来自远程响应的未知值，运行时可能不是数字、不是有限值或小于 0。
 * - 输出：通过检查时返回服务商报告的非负数字；否则返回 `null`。
 * - 关键原因：`null` 表示没有可展示的用量值，不能用 `0` 冒充没有消耗。
 * - 准确性边界：本函数不验证统计方法或数值是否真实，只检查 JavaScript 数字格式。
 * - 失败方式：本函数不抛错，因为用量缺失不应让已经成功的回答失败。
 */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 发送完整上下文，并把两种服务商响应转换成统一的文本、用量和截断状态。
 *
 * - 输入：SDK 客户端、模型 ID、消息数组和取消信号。
 * - 输出：两个协议都返回同一种 `Reply`，未知用量使用 `null`。
 * - 关键步骤：分别读取两种协议的文本、usage 和停止原因，再归一化字段名称。
 * - 失败方式：SDK 异常向上传递；空文本或本节不支持的工具请求抛出 `UserFacingError`。
 * - 职责边界：只做协议转换，不修改会话历史，也不估算 token 或价格。
 */
async function requestReply(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<Reply> {
  if (client instanceof OpenAI) {
    // OpenAI 兼容接口：系统说明也放在 messages 中；SDK 负责 JSON、HTTP 和认证头。
    const response = await client.chat.completions.create({
      model, messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: false,
    }, { signal });
    const choice = response.choices?.[0];
    const text = choice?.message?.content;
    // 本章没有注册工具。遇到空文本或工具调用，明确失败，不把空回答写入历史。
    if (typeof text !== "string" || !text.trim() || choice?.message?.tool_calls?.length) {
      throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
    }
    return {
      text, inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: choice.finish_reason === "length",
    };
  }

  // Anthropic Messages：system 是独立字段，messages 保存 user/assistant 对话。
  // max_tokens 是本次最多生成的 token 数，并不表示一定会生成这么多。
  const response = await client.messages.create({
    model, system: systemPrompt, messages, max_tokens: 2048, stream: false,
  }, { signal });
  // content 是内容块数组；本章只接收文本，工具调用留给后续章节。
  const text = response.content.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  if (!text.trim() || response.stop_reason === "tool_use") {
    throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
  }
  return {
    text, inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: response.stop_reason === "max_tokens",
  };
}
