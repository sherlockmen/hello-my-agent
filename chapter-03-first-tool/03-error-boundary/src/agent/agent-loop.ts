/**
 * 03.3 把工具失败反馈给模型 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：把可预期的工具失败接回同一循环，让模型修正参数或解释原因。
 * 输入：终端文本、history、支持工具消息的 Model 和 AbortSignal。
 * 输出：成功时提交完整消息链；工具错误继续循环，意外错误和超限停止且不提交。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP]             [KEEP 03.2]           [KEEP 03.1]
 * +----------+      +----------------+     +----------------+
 * | Terminal | ---> | agentLoop      | --> | model.generate |
 * +----^-----+      | turn + history |     +-------+--------+
 *      |            +-------+--------+             |
 *      |                    ^                返回哪种结果？
 *      |                    |          +-----------+-----------+
 *      |                    |          | final text            | tool call(s)
 *      |                    |          v                       v
 *      |                    |   提交完整 turn             executeTool
 *      |                    |          |                       |
 *      |                    |          v                  执行成功？
 *      +--- 显示回答 <------+------ return              +-----+-----+
 *                           |                            | 是       | 否
 *                           |                            v          v
 *                           |                     tool result   [NEW 03.3]
 *                           |                            |       error result
 *                           +----------------------------+----------+
 *                                      使用原调用 ID 再请求模型
 *
 * 意外异常、取消或第 8 次仍请求工具 -> 停止并丢弃 turn，history 不变
 *
 * [NEW] 是错误工具结果分支；成功工具结果与循环结构沿用 03.2。
 * ToolError 的安全文案可以回给模型；未知内部异常继续向外抛出，避免泄露敏感信息。
 * 工具成功或失败都必须带原调用 ID，模型才能知道结果属于哪一次请求。
 * 运行观察：模型收到 isError 结果后，可以修正路径、重新调用或解释失败。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { executeTool } from "../tools/registry.js";

const MAX_MODEL_CALLS = 8;

/**
 * 累加本轮各次模型请求报告的用量。
 *
 * total 或 value 为 null，表示有一次用量未知，合计也只能返回 null。
 * 两项都有数字时才相加，避免把不完整的统计显示成完整总量。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 让模型根据工具的成功或失败结果继续处理当前用户要求。
 *
 * 输入是模型、已完成历史、用户文字和取消信号。本轮消息先放在 turn，最终回答出现后才一起加入 history。
 * 工具成功和 ToolError 都用原调用 ID 返回；其他异常、取消或 8 次内仍无最终回答时停止，本轮不保存。
 * 第 8 次若还请求工具，先停止，不执行已经没有机会反馈的最后一批操作。
 */
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  signal.throwIfAborted();
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;

  for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
    // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
    signal.throwIfAborted();
    const result = await model.generate([...history, ...turn], signal);
    inputTokens = addUsage(inputTokens, result.inputTokens);
    outputTokens = addUsage(outputTokens, result.outputTokens);
    truncated ||= result.truncated;

    if (result.toolCalls.length === 0) {
      if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
      signal.throwIfAborted();
      turn.push({ role: "assistant", content: result.text });
      history.push(...turn);
      return { text: result.text, inputTokens, outputTokens, truncated };
    }

    // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
    if (modelCall === MAX_MODEL_CALLS) break;

    turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      signal.throwIfAborted();
      try {
        const content = await executeTool(call);
        turn.push({ role: "tool", toolCallId: call.id, content, isError: false });
      } catch (error) {
        // [CHANGED 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
        if (!(error instanceof ToolError)) throw error;
        turn.push({
          role: "tool",
          toolCallId: call.id,
          content: `工具执行失败：${error.message}`,
          isError: true,
        });
      }
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
