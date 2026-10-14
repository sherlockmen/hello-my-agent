/**
 * 07.2 停止卡住或输出过多的命令 | [KEEP 来自 07.1] agent/agent-loop.ts
 *
 * 学习目标：让模型根据真实的文件或命令结果决定下一步，不把工具调用当成已经成功。
 * 输入：本轮问题、历史、模型、取消信号、事件观察者、审批回调和会话只读授权。
 * 输出：最终回答与用量；有最终回答才提交本轮历史。取消或未知异常直接交给界面。
 *
 * 全局主流程（本节版本）：
 *   用户输入 -> 组成本轮消息 -> 请求模型 <------------------------------+
 *                                |                                     |
 *                  无工具且有回答？-- 是 -> 提交 history -> 返回界面     |
 *                                +-- 否 -> 工具请求 -> 权限判断         |
 *                                         |                            |
 *                       deny ------------+-> 拒绝结果 -----------------+
 *                       allow -----------+-> 只读工具 ---------------+ |
 *                       ask -------------+-> 准备 preview / execute    | |
 *                                            |                        | |
 *                       准备失败 ------------+-> 错误结果 ------------+-+
 *                       准备成功 ------------+-> 等待审批              | |
 *                                                   |                 | |
 *                                   拒绝 ----------+-> 拒绝结果 -------+-+
 *                                   批准 ----------+-> 执行 prepared    | |
 *                                                      或只读工具     | |
 *                                                           |         | |
 *                     [KEEP 来自 07.1] 结果正文 + isError ------------+-+
 *   每次调用前检查取消；最多请求模型 8 次，最后一次仍要工具就停止本轮。
 *
 * 命令使用 runProcess；取消信号进入进程组清理，清理完成后向外结束本轮。
 * 文件修改和命令都先准备、再逐次批准；这里只选择执行入口，不实现文件操作或进程控制。
 * 工具有结果但 isError=true 时仍带着正文回模型；ToolError 也转成带调用 ID 的错误消息。
 * 取消、未知异常或次数用尽不提交本轮历史，已经产生的文件和命令副作用不会自动撤销。
 * 观察：测试退出码为 1 时，下一次模型请求仍能收到失败报告，而不是丢掉日志退出。
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
 * 输入是本轮问题、已有历史与各层共用的取消信号。每个工具请求都先经过权限判断。
 * 文件写入和命令先准备预览，再等待本次批准；拒绝或准备失败也会作为工具结果回模型。
 * 工具返回 isError=true 时保留完整结果正文，不能把测试失败变成一句笼统异常。
 * 有最终回答才提交本轮历史；取消、空回答、未知异常或调用次数用尽时不提交。
 * 会话只读授权由终端持有，写入和命令的批准不会加入这个集合。
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
          // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
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
        // [KEEP 来自 06.1] 写入和命令批准都不能保存；只有可复用的读取范围进入 Set。
        if (response.decision === "allow_session") {
          if (permission.remember) sessionGrants.add(permission.scope);
          // [KEEP 来自 07.1] 写入与命令都只能批准当前操作。
          else rejection = "当前批准只适用于这一次操作预览";
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
        // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
        const result = prepared
          ? await executePreparedTool(prepared, signal)
          : await executeTool(call, signal);
        // [KEEP 来自 07.1] 非零退出码表示本次命令失败，保留输出供模型决定下一步。
        turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: result.isError ?? false });
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
