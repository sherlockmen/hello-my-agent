/**
 * 06.3 保存之前，检查文件有没有变化 | [KEEP 来自 06.2] agent/agent-loop.ts
 *
 * 学习目标：先把文件修改展示给用户，等用户决定后再执行，并把真实结果告诉模型。
 * 输入：本轮问题、会话历史、模型、取消信号、过程观察者、审批回调和只读授权集合。
 * 输出：模型给出最终回答后保存本轮历史；工具失败先作为消息交回模型，让它继续处理。
 *
 * 全局主流程（本节版本）：
 *   Terminal -> 组成本轮消息 -> 请求模型 <------------------------+
 *                                 |                              |
 *                   +-- 最终回答 --> 提交 history -> 返回界面      |
 *                   +-- 工具请求 --> 权限判断                     |
 *                                       |                        |
 *                    deny --------------+--> 错误结果 ------------+
 *                    allow -------------+--> 执行只读工具 ------+ |
 *                    ask ---------------+--> 准备工具           | |
 *                                              |                | |
 *                      准备失败 --> 错误结果 -------------------+-+
 *                      准备成功 --> 等待审批                     | |
 *                                      |                        | |
 *                      拒绝 ----------+--> 错误结果 -------------+-+
 *                      批准 ----------+--> 有 prepared？         | |
 *                                             是 -> 执行已准备修改 |
 *                                             否 -> 执行只读工具 |
 *                                                          |    | |
 *                                           成功结果 / 工具错误--+-+
 *
 * [KEEP 来自 06.1] 写入先准备 preview 和 execute，再等待审批；只读准备返回 null。
 * 每个工具结果配回原调用 ID，再进入下一次模型请求。多个工具请求在本轮依次处理。
 * 每轮最多请求模型 8 次，最后一次仍要求工具时停止，避免执行后没有机会把结果交回模型。
 * 取消、未知异常或次数用尽时不提交本轮 history，但已经写入的文件不会因此恢复。
 * 运行观察：预览与批准先出现，随后才有执行记录，再由模型收到结果并回答。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
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
 * 让模型根据工具的实际结果继续工作，直到给出最终回答。
 *
 * - 接收本轮输入与已有历史。模型提出工具请求后，先查权限，再准备、审批和执行。
 * - 写入获批后调用已经保存的 execute；准备失败或用户拒绝，就把原因作为工具结果。
 * - 得到最终回答才把本轮消息加入正式历史，并返回累计用量和回答。
 * - 取消、空回答、未知异常或 8 次内没有最终回答时停止，不提交这轮历史。
 *
 * 会话只读授权仍由终端持有，只活在当前进程；写入批准不会加入这个集合。
 */
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
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
      let prepared: PreparedToolCall | null = null;
      if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
      if (permission.action === "ask") {
        try {
          // [KEEP 来自 06.1] prepareTool 只读取和计算 diff，不产生写入副作用。
          prepared = await prepareTool(call, signal);
        } catch (error) {
          if (!(error instanceof ToolError)) throw error;
          turn.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具准备失败：${error.message}`,
            isError: true,
          });
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_prepare",
            sequence: toolSequence,
            call,
            outcome: "error",
            error: error.message,
          });
          continue;
        }
        if (prepared) {
          emitAgentEvent(observer, {
            type: "tool_prepare",
            sequence: toolSequence,
            call,
            outcome: "success",
            previewChars: prepared.preview.length,
          });
        }
        emitAgentEvent(observer, {
          type: "approval_start",
          sequence: toolSequence,
          call,
          scope: permission.scope,
          allowSession: permission.remember,
          hasPreview: prepared !== null,
        });
        const response = requestApproval
          ? await requestApproval({
              call,
              reason: permission.reason,
              resource: permission.resource,
              scope: permission.scope,
              allowSession: permission.remember,
              ...(prepared ? { preview: prepared.preview } : {}),
            }, signal)
          : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
        emitAgentEvent(observer, {
          type: "approval_finish",
          sequence: toolSequence,
          call,
          response,
        });
        // [KEEP 来自 06.1] 写入批准不能保存；只有策略明确允许复用的读取范围才能进入 Set。
        if (response.decision === "allow_session") {
          if (permission.remember) sessionGrants.add(permission.scope);
          else rejection = "当前写入批准只适用于这一份差异预览";
        }
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
        // [KEEP 来自 06.1] 已准备的写入执行函数保存了用户刚刚看到的同一份内容。
        const result = prepared
          ? await executePreparedTool(prepared, signal)
          : await executeTool(call, signal);
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
