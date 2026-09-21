/**
 * 05.3 记住本次运行中的批准 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：用户选择“本次会话允许”后，记住这条批准，避免重复询问。
 * 输入：终端文本、history、Model、取消信号、观察者、审批回调和已批准记录 Set。
 * 输出：已有相同批准记录时直接执行；没有记录时仍需询问；最终成功才提交整轮消息。
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
 *      |                    |           |                  | allow       | ask       | deny
 *      |                    |           |                  |             v           v
 *      |                    |           |                  |        用户批准？    不执行
 *      |                    |           |                  |    once / session | deny
 *      |                    |           |                  +----------+---------+--> 不执行
 *      |                    |           |                             v
 *      |                    |           |                    executeTool
 *      |                    |           v                       |
 *      +--- 显示回答 <------+------- return                     v
 *                           +---------------- tool result / error result
 *                                      使用原调用 ID 再请求模型
 *
 * [NEW 05.3] allow_session 把本地策略生成的批准记录放入 Set；后续请求仍先执行 deny 检查。
 * 取消、意外异常或第 8 次仍请求工具时停止并丢弃 turn，history 保持不变。
 * 运行观察：第一次读取 .git 文件选择 s；同一进程再次读取 .git 时不再等待批准。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
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
 * - 关键步骤：先检查禁止规则，再查询已批准记录；只有用户选择 allow_session 才保存新记录。
 * - 失败方式：取消、未知异常、空回答或 8 次内没有最终回答时停止，正式历史保持不变。
 * - 职责边界：核心不持久化授权；集合由会话入口拥有，进程结束后自然失效。
 *   Agent Loop 会等待审批回调；只有 allow_once 或 allow_session 才会进入工具注册表。
 *   sessionGrants 是保存批准记录的 Set，只活在当前进程；/reset 只清空对话历史。
 */
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [CHANGED 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
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
      const permission = await decideToolPermission(call, sessionGrants);
      emitAgentEvent(observer, {
        type: "permission_check",
        sequence: toolSequence,
        call,
        decision: permission,
      });
      let rejection: string | null = null;
      if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
      if (permission.action === "ask") {
        emitAgentEvent(observer, {
          type: "approval_start",
          sequence: toolSequence,
          call,
          scope: permission.scope,
        });
        const response = requestApproval
          ? await requestApproval({
              call,
              reason: permission.reason,
              resource: permission.resource,
              scope: permission.scope,
            }, signal)
          : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
        emitAgentEvent(observer, {
          type: "approval_finish",
          sequence: toolSequence,
          call,
          response,
        });
        // [CHANGED 05.3] 只保存本地策略生成的批准记录，不接受模型自己声明权限。
        if (response.decision === "allow_session") sessionGrants.add(permission.scope);
        if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
      }
      if (rejection) {
        turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
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
