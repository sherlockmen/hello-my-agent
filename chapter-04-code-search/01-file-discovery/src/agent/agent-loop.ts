/**
 * 04.1 控制文件搜索范围 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：复用有界 Agent Loop，把取消信号传给文件工具，并报告内部执行步骤。
 * 输入：终端文本、history、支持工具消息的 Model、AbortSignal 和可选进度回调。
 * 输出：执行时报告模型与工具步骤；最终回答成功时提交整轮消息。
 *
 * 全局主流程（本节版本）：
 *
 * +----------+      +----------------+      +----------------+
 * | Terminal | ---> | agentLoop      | ---> | model.generate |
 * +----^-----+      | turn + history |      +-------+--------+
 *      |            +-------+--------+              |
 *      |                    ^                 返回哪种结果？
 *      |                    |           +-----------+-----------+
 *      |         进度回调 <-+           | final text            | tool call(s)
 *      |                    |           v                       v
 *      |                    |    提交完整 turn        executeTool(call, signal)
 *      |                    |           |                  glob
 *      |                    |           v                       |
 *      +--- 显示回答 <------+------- return                     v
 *                           +---------------- tool result / error result
 *                                      使用原调用 ID 再请求模型
 *
 * [CHANGED] Agent Loop 不按工具名称增加分支；本节把取消信号传给工具注册表，
 * 同时用结构化回调报告“请求模型、开始工具、工具结束”，让终端可观察内部循环。
 * 取消、意外异常或第 8 次仍请求工具时停止并丢弃 turn，history 保持不变。
 * 运行观察：模型可以连续查找、搜索和读取，最后一次性提交完整消息链。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { executeTool, getRegisteredToolName } from "../tools/registry.js";

const MAX_MODEL_CALLS = 8;

export type AgentProgress =
  | { type: "model_start"; call: number }
  | { type: "tool_start"; sequence: number; name: string }
  | { type: "tool_finish"; sequence: number; name: string; isError: boolean };

export type ProgressReporter = (event: AgentProgress) => void;

/**
 * 尝试报告进度，但不让界面故障改变 Agent 的执行结果。
 *
 * - 输入：可选的同步观察回调和一条不含工具参数、结果或模型调用 ID 的事件。
 * - 输出：没有返回值；回调抛出的异常会被隔离。
 * - 关键原因：终端进度只是观察通道，显示失败不等于模型或工具执行失败。
 * - 职责边界：本章不保证异步事件送达和背压；第 09 章建立完整事件流时再处理。
 */
function reportProgressSafely(
  reporter: ProgressReporter | undefined,
  event: AgentProgress,
): void {
  try {
    reporter?.(event);
  } catch {
    // 进度展示是尽力而为的旁路，不能打断核心执行。
  }
}

/**
 * 把新一次模型调用的 token 数累加到本轮总量。
 *
 * - 输入：当前累计值和本次调用值；任一值都可能是表示未知的 `null`。
 * - 输出：两项都已知时返回和；任一项未知时返回 `null`。
 * - 关键原因：部分缺失的数据不能计算出真实总量，继续显示数字会造成误导。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 运行有次数上限的工具循环，并把可恢复的工具错误反馈给模型。
 *
 * - 输入：统一模型、正式历史、本轮用户文字、取消信号和可选进度回调。
 * - 输出：得到最终回答时返回累计 `Reply`，并一次性提交本轮全部消息。
 * - 关键步骤：成功结果和 `ToolError` 都带原调用 ID 回传；模型据此继续推理。
 * - 失败方式：取消、未知异常、空回答或 8 次内没有最终回答时停止，正式历史保持不变。
 * - 职责边界：进度回调只观察步骤，不读取或修改历史；内部异常不会伪装成工具结果。
 */
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  reportProgress?: ProgressReporter,
): Promise<Reply> {
  signal.throwIfAborted();
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let toolSequence = 0;

  for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
    // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
    signal.throwIfAborted();
    reportProgressSafely(reportProgress, { type: "model_start", call: modelCall });
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
      toolSequence += 1;
      const progressName = getRegisteredToolName(call.name);
      reportProgressSafely(reportProgress, {
        type: "tool_start", sequence: toolSequence, name: progressName,
      });
      try {
        // [CHANGED 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
        const content = await executeTool(call, signal);
        turn.push({ role: "tool", toolCallId: call.id, content, isError: false });
        reportProgressSafely(reportProgress, {
          type: "tool_finish", sequence: toolSequence, name: progressName, isError: false,
        });
      } catch (error) {
        // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
        if (!(error instanceof ToolError)) throw error;
        turn.push({
          role: "tool",
          toolCallId: call.id,
          content: `工具执行失败：${error.message}`,
          isError: true,
        });
        reportProgressSafely(reportProgress, {
          type: "tool_finish", sequence: toolSequence, name: progressName, isError: true,
        });
      }
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
