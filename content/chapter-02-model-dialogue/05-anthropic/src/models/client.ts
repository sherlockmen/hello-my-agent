/**
 * 02.5 接入 Anthropic 接口 | [CHANGED] models/client.ts
 *
 * 学习目标：隐藏 OpenAI 与 Anthropic 的字段差异，让上层只调用统一的 Model.generate()。
 * 输入：Config、当前消息数组和 AbortSignal。
 * 输出：统一的纯文本 Reply；没有可用文本或响应要求工具调用时抛出提示。
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
 * 关键点：SDK 负责发送请求、认证和处理取消；本模块转换消息格式并检查响应，调用方只使用 Reply。
 * 运行观察：切换 provider 后，agentLoop() 和终端仍收到相同形状的 Reply。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../config/load-config.js";

// [KEEP] 消息角色与纯文本结果；两种协议都返回同一种 Reply。
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };

// [KEEP] 两种协议共用的模型接口：接收消息和取消信号，异步返回回答。
// 这是本教程的 TypeScript 接口；generate 是本地方法，不是服务商的 HTTP 路径。
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}

// [KEEP] 只创建用户选择的客户端。超时单位是毫秒；本章关闭自动重试，避免一次输入发送多次。
// 显式关闭 SDK 调试日志，错误由入口或终端转换为固定提示后输出，避免记录请求头或原始响应。
/**
 * 按已选协议准备客户端，让调用方仍然只使用 generate()。
 *
 * config 包含经过本地检查的协议、密钥、模型和基础地址。
 * 这里只创建当前需要的 SDK 客户端，关闭自动重试与日志，再返回带 generate() 的普通对象。
 * 实际请求由 generate() 转交 requestReply()，因此创建对象本身不会发送消息。
 * SDK 初始化若失败，异常交回入口；这里不保存会话历史。
 */
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  // 显式固定认证方式，不额外混入 SDK 从环境读取的租户标识或 Bearer Token。
  // [CHANGED 02.5] 按协议创建需要的客户端，对外仍提供同一个 generate 方法。
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // 调用方只需发送消息；SDK 对象、模型 ID 和两种协议的字段差异留在本模块。
  return { generate: (messages, signal) => requestReply(client, config.model, messages, signal) };
}

// [CHANGED 02.5] 把原来的 OpenAI 请求移入这里，再加入 Anthropic 分支。
/**
 * 把当前消息发给所选服务，再把回答转换成统一结果。
 *
 * 输入包括 SDK 客户端、模型 ID、消息和取消信号。
 * OpenAI 分支使用 chat.completions，Anthropic 分支使用 messages，分别按各自的字段收发。
 * 两个分支都返回 { text }，所以调用方不必判断服务商。
 * 请求失败时继续抛出 SDK 异常；空文本或当前不能处理的工具请求则抛出 UserFacingError。
 * 这里只转换消息和响应，不修改会话历史。
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
    return { text };
  }

  // [NEW 02.5] Anthropic Messages：system 是独立字段，messages 保存 user/assistant 对话。
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
  return { text };
}
