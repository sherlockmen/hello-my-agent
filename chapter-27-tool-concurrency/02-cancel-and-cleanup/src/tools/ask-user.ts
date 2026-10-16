/**
 * 27.2 取消与收尾 | [KEEP] tools/ask-user.ts
 *
 * 学习目标：保存已完成的问答工具结果；本文件沿用等待答案并交回原调用的职责。
 * 输入：模型给出的问题和选项 JSON、可选问答 handler、取消信号。
 * 输出：包含问题与答案的工具结果；调用 ID 由核心继续绑定。
 * 状态：本文件不直接读取键盘、不改文件、不授予权限；没有回答不能猜测决定。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError；是 -> 有 handler？-- 否 -> ToolError
 *                                                     +-- 是 -> 等回答
 *   等待后已取消？-- 是 -> 抛出取消原因；否 -> 回答有效？-- 否 -> ToolError
 *                                                             +-- 是 -> 原调用的结果
 * handler 负责交互等待；ToolError 由核心变成错误工具结果，取消由本轮中断路径处理。
 * 运行观察：模型先请求澄清，收到该工具结果后才继续决策。
 */
// [KEEP 来自 12.3] 不明确的需求交给用户澄清，答案仍绑定原来的工具调用 ID。
import { ToolError } from "../errors.js";
import type { QuestionHandler, UserQuestion } from "../agent/run-options.js";
import type { ToolExecutionResult } from "./types.js";

export const askUserDefinition = {
  name: "ask_user",
  description: "询问会影响实现的重要缺失信息。question 是一个明确问题，choices 是最多 4 个简短选项，也可为空以接收自由回答。没有回答时不能猜测用户决定。",
  inputSchema: {
    type: "object" as const,
    properties: {
      question: { type: "string" as const, minLength: 1, maxLength: 500 },
      choices: {
        type: "array" as const,
        maxItems: 4,
        items: { type: "string" as const, minLength: 1, maxLength: 80 },
      },
    },
    required: ["question", "choices"],
    additionalProperties: false,
  },
};

/**
 * 检查模型提出的问题和选项，得到交互界面能使用的问答内容。
 * 问题最长 500 个 UTF-16 单元，最多 4 个选项，每个最长 80 个单元；选项去空白后不能重复。
 * 返回整理后的问题和选项；JSON、字段或内容不符合要求时抛出 ToolError，尚未开始等待用户。
 */
function parseQuestion(argumentsJson: string): UserQuestion {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("ask_user 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("ask_user 参数必须是包含 question 和 choices 的对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("question" in input) || !("choices" in input)) {
    throw new ToolError("ask_user 参数必须且只能包含 question 和 choices。");
  }
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 500) {
    throw new ToolError("ask_user question 必须为 1–500 字符的非空问题。");
  }
  if (!Array.isArray(input.choices) || input.choices.length > 4) {
    throw new ToolError("ask_user choices 必须是最多 4 个选项的数组，也可以为空。");
  }
  const choices = input.choices.map((choice: unknown) => {
    if (typeof choice !== "string" || !choice.trim() || choice.length > 80) {
      throw new ToolError("ask_user 每个选项必须为 1–80 字符的非空文字。");
    }
    return choice.trim();
  });
  if (new Set(choices).size !== choices.length) throw new ToolError("ask_user choices 不能包含重复选项。");
  return { question: input.question.trim(), choices };
}

/**
 * 等用户回答这次澄清，再把答案作为工具结果返回。
 * 输入是问题参数、专用 handler 和本轮信号；没有 handler 就报告无法等待。
 * 等待后先检查取消，再检查非空答案和 32000 个 UTF-16 单元上限；未回答时抛出 ToolError。
 * 返回问题与答案，核心负责将结果绑定原调用 ID；回答不能批准文件修改或命令。
 */
export async function askUserTool(
  argumentsJson: string, handler: QuestionHandler | undefined, signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const request = parseQuestion(argumentsJson);
  if (!handler) throw new ToolError("当前运行方式无法等待用户回答。请说明缺少的信息，不能猜测用户选择。");
  // [KEEP 来自 12.3] 此处真正等待专用问答，不用观察事件或普通聊天代替答案。
  const answer = await handler(request, signal);
  // 取消与答案同时发生时，旧答案不能继续进入模型历史。
  signal.throwIfAborted();
  // [KEEP 来自 12.3] 未答和空答成为工具错误，模型不能猜测用户决定。
  if (answer === null || typeof answer !== "string" || !answer.trim()) {
    throw new ToolError("用户没有回答这次澄清问题。请说明缺少的信息，不能猜测答案。");
  }
  if (answer.length > 32_000) throw new ToolError("用户回答不能超过 32000 字符。");
  return {
    content: JSON.stringify({ question: request.question, answer: answer.trim() }, null, 2),
    metadata: { kind: "ask_user", question: request.question, answer: answer.trim() },
  };
}
