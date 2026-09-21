/**
 * 05.1 让工具调用先经过权限策略 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：把权限判断放进工具请求与本地执行之间，形成无法绕过的统一入口。
 * 输入：终端文本、history、Model、取消信号和可选观察者。
 * 输出：allow 才执行工具；ask/deny 作为工具错误回给模型；最终成功才提交整轮消息。
 *
 * 全局主流程（本节版本）：
 *
 * +----------+      +----------------+      +----------------+
 * | Terminal | ---> | agentLoop      | ---> | model.generate |
 * +----^-----+      | turn + history |      +-------+--------+
 *      |            +-------+--------+              |
 *      |                    ^                 返回哪种结果？
 *      |                    |           +-----------+-----------+
 *      |          AgentEvent <-+        | final text            | tool call(s)
 *      |                    |           v                       v
 *      |                    |    提交完整 turn        decideToolPermission(call)
 *      |                    |           |                  | allow       | ask / deny
 *      |                    |           |                  v             v
 *      |                    |           |        executeTool        不执行工具
 *      |                    |           v                       |
 *      +--- 显示回答 <------+------- return                     v
 *                           +---------------- tool result / error result
 *                                      使用原调用 ID 再请求模型
 *
 * [NEW 05.1] 权限策略在注册表之前运行；模型文字、工具参数和 ToolError 都不能跳过它。
 * 取消、意外异常或第 8 次仍请求工具时停止并丢弃 turn，history 保持不变。
 * 运行观察：普通源码请求出现“允许执行”；.env、越界路径和待审批请求不会出现工具开始事件。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
// [NEW 05.1] Agent Loop 接入独立权限策略。
import { decideToolPermission } from "../permissions/policy.js";
import { executeTool } from "../tools/registry.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";

const MAX_MODEL_CALLS = 8;

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
 * - 输入：统一模型、正式历史、本轮用户文字、取消信号和可选事件观察者。
 * - 输出：得到最终回答时返回累计 `Reply`，并一次性提交本轮全部消息。
 * - 关键步骤：每个 ToolCall 先经过权限策略；allow 才进入注册表，其他决定带原调用 ID 回传。
 * - 失败方式：取消、未知异常、空回答或 8 次内没有最终回答时停止，正式历史保持不变。
 * - 职责边界：核心只编排权限与执行，不按工具名判断风险，也不生成终端文案。
 */
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
): Promise<Reply> {
  signal.throwIfAborted();
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let toolSequence = 0;
  let pendingToolResults = 0;

  for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
    // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
    signal.throwIfAborted();
    emitAgentEvent(observer, {
      type: "model_start",
      call: modelCall,
      contextMessages: history.length + turn.length,
      trigger: modelCall === 1
        ? { kind: "user", content: input }
        : { kind: "tool_results", count: pendingToolResults },
    });
    pendingToolResults = 0;
    const result = await model.generate([...history, ...turn], signal);
    inputTokens = addUsage(inputTokens, result.inputTokens);
    outputTokens = addUsage(outputTokens, result.outputTokens);
    truncated ||= result.truncated;
    emitAgentEvent(observer, {
      type: "model_finish",
      call: modelCall,
      outcome: result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
      toolRequests: result.toolCalls.length,
      text: result.text,
    });

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
      // [CHANGED 05.1] 每个 ToolCall 必须先得到权限决定，之后才能进入注册表。
      const permission = await decideToolPermission(call);
      emitAgentEvent(observer, {
        type: "permission_check",
        sequence: toolSequence,
        call,
        decision: permission,
      });
      if (permission.action !== "allow") {
        const reason = permission.action === "ask"
          ? `工具需要用户批准，但本节尚未接入审批：${permission.reason}`
          : `权限拒绝：${permission.reason}`;
        turn.push({ role: "tool", toolCallId: call.id, content: reason, isError: true });
        pendingToolResults += 1;
        continue;
      }
      emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
      try {
        // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
        const result = await executeTool(call, signal);
        turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: false });
        pendingToolResults += 1;
        emitAgentEvent(observer, {
          type: "tool_finish",
          sequence: toolSequence,
          call,
          outcome: "success",
          result,
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
        pendingToolResults += 1;
        emitAgentEvent(observer, {
          type: "tool_finish",
          sequence: toolSequence,
          call,
          outcome: "error",
          error: error.message,
        });
      }
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
