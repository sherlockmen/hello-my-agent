/**
 * 03.3 把工具失败反馈给模型 | [KEEP 来自 03.2] models/client.ts
 *
 * 学习目标：让统一消息既能保存工具请求，也能保存按调用 ID 配对的工具结果。
 * 输入：user、assistant、tool 三类本地消息和 read_file 定义。
 * 输出：两种协议各自需要的请求结构，以及统一的 ModelResult。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-------------------------+
 *   | local Message[]         |
 *   | user / assistant / tool |
 *   +------------+------------+
 *                +-- OpenAI ----> assistant.tool_calls + role=tool
 *                |
 *                +-- Anthropic -> tool_use + user.tool_result
 *                                      |
 *                                      v
 *                                provider response
 *                                      |
 *                                      v
 *                          text + normalized ToolCall[]
 *
 * 关键点：工具请求和工具结果必须使用同一个调用 ID，否则模型无法判断结果属于哪次请求。
 * 本地 Message 隔离服务商格式；Agent Loop 不需要知道 tool_calls 或 tool_result 字段。
 * 服务商响应属于外部输入，进入本地 ToolCall 前仍要检查 ID、名称和参数。
 * 运行观察：第二次模型请求同时包含第一次的工具请求和对应结果。
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
 * 按配置创建模型客户端，让主循环始终通过 generate() 请求模型。
 *
 * config 已由 readConfig() 检查；这里只创建所选协议的 SDK 对象，不立即发送请求。
 * 返回的 generate() 记住客户端和模型 ID，之后接收消息与取消信号。
 * 关闭 SDK 自动重试和日志，让本章的一次调用对应一次请求，避免额外输出请求细节。
 * 初始化异常继续交给调用方处理；网络请求发生在 generate() 中。
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
 * 读取服务商报告的用量；缺少可用数字时保留“未知”。
 *
 * value 来自远程响应，只有有限且不小于 0 的数字才原样返回，否则返回 null。
 * null 不能换成 0，否则会把“接口没报告”显示成“没有消耗”。
 * 这里只检查数字格式，不验证服务商的统计是否准确，也不因用量缺失让回答失败。
 */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 把服务商返回的工具字段整理成主循环能使用的 ToolCall。
 *
 * ID、名称和参数都必须是非空字符串，否则抛出 UserFacingError，停止处理本次响应。
 * SDK 的类型不能保证兼容接口实际返回了什么，所以仍要在运行时检查。
 * 这里还不解析参数 JSON，也不判断工具是否存在；这些工作留给本地工具入口。
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
 * 把本地消息转换成 OpenAI 接口能识别的工具对话。
 *
 * 输入包含用户文字、模型请求和工具结果。输出保留原来的消息顺序与调用 ID，
 * 让 tool_call_id 能找到前面 assistant 消息中的请求。
 * 这里只转换内存中的数据，不发送请求，也不执行工具。
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
 * 把本地消息转换成 Anthropic 的内容块，并把工具结果配回请求。
 *
 * 模型请求转换为 tool_use，结果转换为同 ID 的 tool_result；
 * 连续的工具结果放进同一条 user 消息，满足这个接口对结果消息的组织方式。
 * 返回转换后的数组，不发送请求。若历史里的参数不是合法 JSON，转换会抛错。
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
 * 发送消息和当前工具说明，再把服务商响应整理成 ModelResult。
 *
 * 输入是客户端、模型 ID、消息数组和取消信号；根据客户端协议发送相应字段。
 * 返回文本、工具请求、用量和截断状态。只要含有工具请求，文本为空也可以是正常响应。
 * 既没有文字也没有工具请求时抛出 UserFacingError；工具基础字段由 normalizeToolCall() 检查。
 * 网络、认证、取消或消息转换失败继续向外抛出；这里不执行工具，也不保存会话历史。
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
