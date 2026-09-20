/**
 * 03.1 识别模型的工具请求 | [CHANGED] models/client.ts
 *
 * 学习目标：向两种模型协议发送同一份工具定义，并把不同响应统一成 ToolCall。
 * 输入：普通对话消息、read_file 定义、AbortSignal。
 * 输出：文本、工具请求、用量和截断状态；不在这里访问文件系统。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      +-----------------------+
 *   | messages | ---> | provider request      |
 *   +----------+      | OpenAI tools/function |
 *                     | Anthropic tools        |
 *                     +-----------+-----------+
 *                                 v
 *                         返回了工具请求？
 *                           | 否 --> text result
 *                           | 是
 *                           v
 *                     +------------------+
 *                     | normalize fields |
 *                     | id/name/arguments|
 *                     +--------+---------+
 *                              v
 *                         ModelResult
 *
 * 关键点：模型只“提出”工具请求；协议适配层不拥有文件权限，也不执行工具。
 * OpenAI 的 arguments 本来就是 JSON 字符串；Anthropic 的 input 先转成字符串，
 * 让后续本地执行入口使用同一套解析和校验规则。服务商响应属于外部输入，
 * 即使 SDK 提供了 TypeScript 类型，也要在运行时检查三个字段确实是非空字符串。
 * 运行观察：无论 provider 为哪一种，agentLoop() 都能看到经过校验的统一 toolCalls。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";

// [KEEP 来自 02.6] 本节还没有工具结果消息，因此历史仍只有普通 user/assistant 文本。
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};

// [NEW 03.1] 一次模型响应可以给出最终文本，也可以要求程序执行一个或多个工具。
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
 * 发送上下文和工具定义，把两种服务商响应转换成统一的 `ModelResult`。
 *
 * - 输入：已创建的 SDK 客户端、模型 ID、当前消息和用于取消请求的 `AbortSignal`。
 * - 输出：统一的文本、工具请求、token 用量和截断状态。
 * - OpenAI 分支：调用 `chat.completions`，工具定义放在 `tools[].function`。
 * - Anthropic 分支：调用 `messages`，工具参数结构放在 `tools[].input_schema`。
 * - 共同输出：两个分支都把服务商响应转换成同一种 `ModelResult`。
 * - 请求失败：网络、认证、限流、服务端、取消或协议解析异常由 SDK 向上传递。
 * - 响应失败：没有可用结果，或结果既无文本也无工具请求时，抛出 `UserFacingError`。
 * - 字段失败：工具调用字段由 `normalizeToolCall()` 检查，无效时拒绝整次响应。
 * - 边界：这里只识别并转换工具请求，不解析参数，也不执行本地工具。
 */
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: true,
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
      text,
      toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: choice.finish_reason === "length",
    };
  }

  const response = await client.messages.create({
    model,
    system: systemPrompt,
    messages,
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    max_tokens: 2048,
    stream: false,
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
    text,
    toolCalls,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: response.stop_reason === "max_tokens",
  };
}
