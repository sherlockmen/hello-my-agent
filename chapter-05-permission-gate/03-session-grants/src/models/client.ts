/**
 * 05.3 让批准只在明确范围内复用 | [KEEP 来自 04.3] models/client.ts
 *
 * 学习目标：让统一消息和工具定义在 OpenAI 兼容接口与 Anthropic 接口之间转换。
 * 输入：user、assistant、tool 三类本地消息，以及当前注册的 glob、grep、分段 read_file 工具定义。
 * 输出：服务商需要的请求结构，以及统一的文本、ToolCall 和用量结果。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   local Message[] + toolDefinitions
 *            +-- OpenAI ----> assistant.tool_calls + role=tool
 *            +-- Anthropic -> tool_use + user.tool_result
 *                                      |
 *                                      v
 *                              provider response
 *                                      |
 *                                      v
 *                          text + normalized ToolCall[]
 *
 * 关键点：协议适配层只传递工具定义和消息，不执行本地搜索，也不提交会话历史。
 * 工具请求和结果必须保留同一个调用 ID；服务商响应进入核心前仍要校验基础字段。
 * 运行观察：两种协议都能看到当前工具列表，并把结果转换成同一个本地消息结构。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";

// [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };

export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};
export type ModelResult = Reply & { toolCalls: ToolCall[] };

export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<ModelResult>;
}

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
  return { generate: (messages, signal) => requestResult(client, config.model, messages, signal) };
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
 * 校验远程接口给出的工具调用基础字段，再建立本地 `ToolCall`。
 *
 * - 输入：调用 ID、工具名称和参数字符串；三项都属于不可信的外部数据。
 * - 输出：三个字段都是非空字符串时返回统一 `ToolCall`。
 * - 关键原因：TypeScript 类型只在编译时生效，不能保证兼容接口实际返回合法字段。
 * - 失败方式：任一字段无效时抛出 `UserFacingError`，请求不会进入工具执行阶段。
 * - 职责边界：这里只检查字段类型和空值；JSON 语法与工具参数由执行入口校验。
 */
function normalizeToolCall(id: unknown, name: unknown, argumentsJson: unknown): ToolCall {
  if (typeof id !== "string" || !id.trim()
    || typeof name !== "string" || !name.trim()
    || typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    throw new UserFacingError("接口返回了无效的工具请求：调用 ID、名称和参数必须是非空字符串。");
  }
  return { id, name, arguments: argumentsJson };
}

/**
 * 把本地统一消息转换成 OpenAI Chat Completions 使用的消息结构。
 *
 * - 输入：可能包含 user、assistant 和 tool 的本地 `Message[]`。
 * - 输出：返回 OpenAI 所需的消息数组，并保留工具调用 ID。
 * - 关键步骤：工具结果转换成 `role=tool`，助手工具请求转换成 `tool_calls`。
 * - 职责边界：只转换内存数据，不发送请求，也不执行工具。
 */
function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "user") return message;
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  });
}

/**
 * 把本地统一消息转换成 Anthropic Messages 使用的内容块结构。
 *
 * - 输入：可能包含 user、assistant 和连续 tool 结果的本地 `Message[]`。
 * - 输出：返回 Anthropic 消息数组，连续工具结果会合并到同一条 user 消息。
 * - 关键步骤：助手调用变成 `tool_use`，工具结果变成带原调用 ID 的 `tool_result`。
 * - 失败方式：已保存的工具参数不是有效 JSON 时，`JSON.parse()` 会抛错并停止请求。
 * - 职责边界：只转换内存数据，不发送请求，也不执行工具。
 */
function toAnthropicMessages(messages: Message[]): MessageParam[] {
  const converted: MessageParam[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (!message) break;
    if (message.role === "tool") {
      // Anthropic 把连续工具结果放进同一条 user 消息；OpenAI 则使用独立的 role=tool。
      const results: ContentBlockParam[] = [];
      while (messages[index]?.role === "tool") {
        const toolMessage = messages[index] as Extract<Message, { role: "tool" }>;
        results.push({
          type: "tool_result",
          tool_use_id: toolMessage.toolCallId,
          content: toolMessage.content,
          is_error: toolMessage.isError,
        });
        index += 1;
      }
      converted.push({ role: "user", content: results });
      continue;
    }
    if (message.role === "user") {
      converted.push(message);
      index += 1;
      continue;
    }
    const content: ContentBlockParam[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: JSON.parse(call.arguments) });
    }
    converted.push({ role: "assistant", content });
    index += 1;
  }
  return converted;
}

/**
 * 发送完整消息链和工具定义，并把服务商响应转换成统一的 `ModelResult`。
 *
 * - 输入：SDK 客户端、模型 ID、本地消息数组和取消信号。
 * - 输出：统一的文本、工具请求、token 用量和截断状态。
 * - 关键步骤：先把本地消息转换成所选协议，再发送工具定义，最后归一化响应字段。
 * - 请求失败：网络、认证、限流、服务端、取消或协议解析异常由 SDK 向上传递。
 * - 响应失败：没有候选结果，或结果既无文本也无工具请求时抛出 `UserFacingError`。
 * - 职责边界：只转换请求和响应，不执行本地工具，也不提交会话历史。
 */
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          parameters: tool.inputSchema, strict: true,
        },
      })),
      stream: false,
    }, { signal });
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments));
    const text = choice.message.content ?? "";
    if (!text.trim() && toolCalls.length === 0) {
      throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
    }
    return {
      text, toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: choice.finish_reason === "length",
    };
  }

  const response = await client.messages.create({
    model, system: systemPrompt, messages: toAnthropicMessages(messages),
    tools: toolDefinitions.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema,
    })),
    max_tokens: 2048, stream: false,
  }, { signal });
  const text = response.content.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  const toolCalls: ToolCall[] = response.content
    .filter((block) => block.type === "tool_use")
    .map((block) => normalizeToolCall(block.id, block.name, JSON.stringify(block.input)));
  if (!text.trim() && toolCalls.length === 0) {
    throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
  }
  return {
    text, toolCalls,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: response.stop_reason === "max_tokens",
  };
}
