/**
 * 08.1 让回答逐段显示 | [CHANGED] models/client.ts
 *
 * 学习目标：让文字一段段到达界面，同时保留一份用于后续判断的完整响应。
 * 输入：本地消息、当前工具定义、取消信号，以及接收新增文字的 onText 回调。
 * 输出：onText 收到显示片段；generate 的 Promise 返回完整文本、工具请求和用量。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [CHANGED] generate -> 合并用户取消信号与 60 秒期限 -> 选择协议
 *                          +-- OpenAI -> SDK 接收流 -> content.delta -> onText
 *                          |                          -> finalChatCompletion
 *                          |                             -> 正常结束？-- 否 -> 抛错
 *                          |                                         +-- 是 -> 统一结果
 *                          +-- Anthropic -> 非流式请求 -> 完整响应 -> 统一结果
 *   统一结果 -> 文字和工具都为空？-- 是 -> 抛错
 *                                +-- 否 -> 返回 ModelResult
 *   请求、解析或取消失败 -> 向调用方抛错，不返回半份 ModelResult
 *
 * [CHANGED] 表示本节修改；未标记的协议转换与工具定义沿用上一基线。
 * OpenAI SDK 负责接收 SSE 和累积完整响应，content.delta 只负责把新文字送出去。
 * 本节 Anthropic 仍一次返回完整响应；08.2 再让它流式接收，并统一结束原因与工具参数检查。
 * 每次 generate 的 60 秒期限包含接收正文的时间；本文件不执行工具，也不修改会话历史。
 * 运行观察：OpenAI 回答未结束时已经能看到前半句，结束后才拿到完整结果。
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
  // [CHANGED 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void): Promise<ModelResult>;
}

/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：只暴露 generate 的 Model；创建对象时不发送请求，调用 generate 时才开始。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
 */
// [CHANGED 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // [CHANGED 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  return { async generate(messages, signal, onText) {
    const deadline = AbortSignal.timeout(60_000);
    try {
      return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText);
    } catch (error) {
      signal.throwIfAborted();
      if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
      throw error;
    }
  } };
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
 * 校验接口给出的基础字段，再建立本地 ToolCall。
 *
 * - 输入：调用 ID、工具名称和参数字符串；三项都属于外部响应。
 * - 输出：三个字段都是非空字符串时，返回保留原值的统一 ToolCall。
 * - 关键原因：TypeScript 类型只在编译时生效，不能代替对实际响应的检查。
 * - 失败方式：任一字段无效时抛出 UserFacingError，该响应不会进入工具执行阶段。
 * - 职责边界：这里只检查字段类型与空值，不解析 JSON，也不判断这个工具是否获准执行。
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
 * 把本地消息发给模型，并把完整响应转换成统一结果。
 *
 * - 输入：SDK 客户端、模型 ID、消息数组、请求取消信号，以及可选的文字回调。
 * - 输出：OpenAI 接收期间通过 onText 传递新文字；Promise 最后返回完整文本、工具请求和用量。
 * - 关键步骤：OpenAI 等 finalChatCompletion 完成后检查结束原因；Anthropic 本节仍等待非流式响应。
 * - 失败方式：OpenAI 结束原因异常、没有候选或两种协议都没有可用内容时抛错；SDK 错误也向上传递。
 * - 当前范围：Anthropic 的 max_tokens 仍只标为 truncated；两种协议的统一完成判断在 08.2 加入。
 * - 职责边界：显示片段不等于正式结果；本函数不执行工具，也不把片段写入会话历史。
 */
// [CHANGED 08.1] 片段用于显示，完整响应才进入统一结果。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
  onText?: (text: string) => void,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    // [CHANGED 08.1] SDK 解析 SSE 并累积完整响应，content.delta 用来及时显示新文字。
    const stream = client.chat.completions.stream({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          // [CHANGED 08.1] 第 07 章练习的 timeout_ms 保持可选；本地仍会完整校验工具参数。
          parameters: tool.inputSchema, strict: false,
        },
      })),
      stream_options: { include_usage: true },
    }, { signal });
    stream.on("content.delta", ({ delta }) => onText?.(delta));
    const response = await stream.finalChatCompletion();
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments));
    // [NEW 08.1] 文字可能已经显示，结束原因不正常时仍不能执行工具或提交历史。
    if (choice.finish_reason !== (toolCalls.length ? "tool_calls" : "stop")) {
      throw new UserFacingError("模型响应未正常完成，已停止本轮；屏幕上的文字可能不完整。");
    }
    const text = choice.message.content ?? "";
    if (!text.trim() && toolCalls.length === 0) {
      throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
    }
    return {
      text, toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: false,
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
