/**
 * 09.1 让界面知道任务何时结束 | [KEEP] models/client.ts
 *
 * 学习目标：文字可以提前显示，工具参数必须收齐并检查后再交给主循环。
 * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
 * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
 * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 请求流 -> 文字片段 -> onText
 *                  +-> 完整消息 -> 归一化结束原因
 *   OpenAI 工具参数 -> SDK 累积的完整字符串 ------------------+
 *   Anthropic 参数 -> 按内容块 index 保存原始 JSON 片段         |
 *                  -> message_stop 与片段顺序有效？-- 否 -> 抛错
 *                                                 +-- 是 ----+
 *   完整结果 -> 正常文本或工具结束？-- 否 -> 返回结束原因，不返回工具
 *                                  +-- 是 -> 检查支持的工具类型与参数
 *   每个调用 ID 非空且批内唯一、参数为完整 JSON 对象？-- 否 -> 整批抛错
 *                                                     +-- 是 -> 返回 ModelResult
 *   请求、解析、超时或取消失败 -> 抛错，不返回半份结果
 *
 * [KEEP] 表示沿用前节。SDK 的流中途对象可能来自部分 JSON 解析，不能证明参数已经完整。
 * Anthropic 的执行参数来自本地累积的原始字符串；内容块结束后仍要通过 JSON.parse。
 * 这些检查只确认协议和 JSON 对象形状；字段值、路径与审批仍由已有工具和权限代码负责。
 * 每次 generate 设置独立的 60 秒期限，不自动重试；失败不改历史，也不在这里启动工具。
 * 运行观察：一批调用中只要有一份参数损坏，整批都不会进入权限与执行阶段。
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
// [KEEP 来自 08.2] 把两种接口的结束原因转成核心可以统一判断的值。
export type ModelFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "unsupported";
// [KEEP 来自 08.2] 完整结果同时携带结束原因，主循环据此决定是否继续。
export type ModelResult = Reply & { toolCalls: ToolCall[]; finishReason: ModelFinishReason };

export interface Model {
  // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
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
// [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
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
 * 检查完整响应中的整批调用，避免先执行前一个、随后才发现后一个参数损坏。
 *
 * - 输入：基础字段已经归一化的 ToolCall 数组；空数组表示本次没有工具请求。
 * - 输出：全部通过时返回同一数组，检查本身不执行任何工具。
 * - 关键步骤：检查这一批 ID 是否重复，再用 JSON.parse 检查每份参数是完整 JSON 对象。
 * - 失败方式：重复 ID、无效 JSON、null、数组或其他非对象值都会抛出 UserFacingError。
 * - 职责边界：工具是否存在、对象允许哪些字段、字段值与路径是否合法，仍由权限和工具实现检查。
 */
// [KEEP 来自 08.2] JSON.parse 检查完整语法，不采用流中途的部分解析对象。
function validateToolCalls(calls: ToolCall[]): ToolCall[] {
  const ids = new Set<string>();
  for (const call of calls) {
    if (ids.has(call.id)) throw new UserFacingError("模型返回了重复的工具调用 ID，本批工具未执行。");
    ids.add(call.id);
    let value: unknown;
    try { value = JSON.parse(call.arguments); }
    catch { throw new UserFacingError("工具参数没有收齐或不是合法 JSON，本批工具未执行。"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new UserFacingError("工具参数必须是完整 JSON 对象，本批工具未执行。");
    }
  }
  return calls;
}

/**
 * 把两种协议的结束原因转换成主循环认识的几种状态。
 *
 * - 输入：接口给出的原始结束原因，运行时也可能是未知值。
 * - 输出：普通结束、工具请求、长度上限、拒绝，或 unsupported；未知值不会默认为成功。
 * - 关键原因：收到最后一个片段只说明流停止，不能说明回答或工具参数已经正常完成。
 * - 职责边界：这里只转换值；网络中断由 SDK 抛错，是否接受结果由 Agent Loop 判断。
 */
// [KEEP 来自 08.2] stop_sequence 属于正常文本停止，本课程不设置自定义停止序列。
function finishReason(reason: unknown): ModelFinishReason {
  if (reason === "stop" || reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "tool_calls" || reason === "tool_use") return "tool_calls";
  if (reason === "length" || reason === "max_tokens") return "length";
  if (reason === "content_filter" || reason === "refusal") return "refusal";
  return "unsupported";
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
 * 接收模型文字和工具参数，等完整消息检查通过后返回统一结果。
 *
 * - 输入：SDK 客户端、模型 ID、本地消息数组、请求取消信号和可选文字回调。
 * - 输出：文字片段通过 onText 提前显示；返回值另有完整文本、工具调用、用量和结束原因。
 * - 关键步骤：OpenAI 使用 SDK 完整累积的参数；Anthropic 另外按内容块 index 累积原始 JSON 字符串。
 * - 参数检查：只在正常结束原因下检查整批工具的 ID 与 JSON 对象；字段值仍留给本地工具检查。
 * - 失败方式：SDK 失败、Anthropic 流未完整结束、片段顺序无效或参数损坏时抛错，不返回可执行的半份调用。
 * - 职责边界：length、refusal 等结束原因交给 Agent Loop 报告；这里不批准工具，也不提交历史。
 */
// [KEEP 来自 08.2] 片段用于显示，完整响应才进入统一结果。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
  onText?: (text: string) => void,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    // [KEEP 来自 08.1] SDK 解析 SSE 并累积完整响应，content.delta 用来及时显示新文字。
    const stream = client.chat.completions.stream({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          // [KEEP 来自 08.1] 第 07 章练习的 timeout_ms 保持可选；本地仍会完整校验工具参数。
          parameters: tool.inputSchema, strict: false,
        },
      })),
      stream_options: { include_usage: true },
    }, { signal });
    stream.on("content.delta", ({ delta }) => onText?.(delta));
    const response = await stream.finalChatCompletion();
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    // [KEEP 来自 08.2] 结束原因正常才接收工具；拒绝和截断只交给核心说明。
    const reason = choice.message.refusal ? "refusal" : finishReason(choice.finish_reason);
    if (choice.message.tool_calls?.some((call) => call.type !== "function")) {
      throw new UserFacingError("接口返回了本章尚不支持的工具类型，本批工具未执行。");
    }
    const calls = reason === "tool_calls" || reason === "stop"
      ? (choice.message.tool_calls ?? []).filter((call) => call.type === "function")
        .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments))
      : [];
    return {
      text: choice.message.content ?? "", toolCalls: validateToolCalls(calls), finishReason: reason,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: reason === "length",
    };
  }

  // [KEEP 来自 08.2] Anthropic 的文字和工具参数分开接收；SDK 负责 SSE 与完整消息聚合。
  const stream = client.messages.stream({
    model, system: systemPrompt, messages: toAnthropicMessages(messages),
    tools: toolDefinitions.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema,
    })),
    max_tokens: 2048,
  }, { signal });
  const argumentsByIndex = new Map<number, { json: string; initial: unknown; closed: boolean }>();
  let messageStopped = false;
  let invalidSequence = false;
  stream.on("text", (text) => onText?.(text));
  stream.on("streamEvent", (event) => {
    if (event.type === "message_stop") messageStopped = true;
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      if (argumentsByIndex.has(event.index)) invalidSequence = true;
      argumentsByIndex.set(event.index, { json: "", initial: event.content_block.input, closed: false });
    }
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      const part = argumentsByIndex.get(event.index);
      if (!part || part.closed) invalidSequence = true;
      else part.json += event.delta.partial_json;
    }
    if (event.type === "content_block_stop") {
      const part = argumentsByIndex.get(event.index);
      if (part) part.closed = true;
    }
  });
  const response = await stream.finalMessage();
  if (!messageStopped || invalidSequence) {
    throw new UserFacingError("模型流没有完整结束或工具片段顺序无效，本批工具未执行。");
  }
  const reason = finishReason(response.stop_reason);
  const calls: ToolCall[] = [];
  if (reason === "tool_calls" || reason === "stop") {
    for (const [index, block] of response.content.entries()) {
      if (block.type === "text") continue;
      if (block.type !== "tool_use") throw new UserFacingError("接口返回了本章不支持的内容类型，本批工具未执行。");
      const part = argumentsByIndex.get(index);
      if (!part?.closed) throw new UserFacingError("工具参数还没有结束，本批工具未执行。");
      // SDK 的部分 JSON 快照方便界面展示，但执行必须检查完整的原始参数字符串。
      calls.push(normalizeToolCall(block.id, block.name, part.json || JSON.stringify(part.initial)));
    }
  }
  return {
    text: response.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
    toolCalls: validateToolCalls(calls), finishReason: reason,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: reason === "length",
  };
}
