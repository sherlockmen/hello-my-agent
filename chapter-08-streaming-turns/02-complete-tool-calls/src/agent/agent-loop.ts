/**
 * 08.2 收齐工具参数，再执行 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：我们把“流停止了”和“响应完成了”分开判断，再决定能否执行工具。
 * 输入：本轮问题、已有历史、模型、取消信号、观察者、审批回调和会话只读授权。
 * 输出：生成期间发出文字事件；只有正常最终回答才提交历史，失败不提交本轮。
 *
 * 全局主流程（本节版本）：
 *   [KEEP] 用户输入 -> 建立本轮 turn -> A: 请求模型
 *   A -> [KEEP] 文字片段 -> 观察者显示；同时继续等待完整结果
 *     -> 请求失败 -> X
 *     -> [CHANGED] 完整结果 -> 结束原因与调用数量一致？-- 否 -> X
 *                                                    +-- 是 -> B
 *   B: 有工具？-- 否 -> 回答非空？-- 否 -> X
 *              |                 +-- 是 -> 提交 history -> 返回 Reply -> 结束本轮
 *              +-- 是 -> 已是第 8 次模型请求？-- 是 -> X
 *                                             +-- 否 -> 保存 assistant 调用 -> C
 *   C: 逐个工具权限判断 -- deny -> 拒绝结果 -> D
 *                       +-- allow -> 执行只读工具 -> D
 *                       +-- ask -> 准备预览 -- ToolError -> 错误结果 -> D
 *                                          +-- 成功 -> 用户批准？-- 否 -> 拒绝结果 -> D
 *                                                                +-- 是 -> 执行 -> D
 *   D: 保存工具正文与 isError（ToolError 也转成错误结果）
 *      -> 本批还有调用？-- 是 -> C
 *                       +-- 否 -> A（带上全部工具结果）
 *   X: 错误、取消或次数用尽 -> 不提交本轮历史 -> 向界面抛错
 *
 * [NEW] 表示本节新增，[CHANGED] 表示本节调整，[KEEP] 表示沿用。
 * 每次模型请求和工具开始前检查取消；未预期的异常也走 X，普通 ToolError 则留在工具循环中。
 * 模型层已经检查整批工具的 ID 与 JSON；本层还要检查结束原因和工具数量是否对应。
 * length、refusal、未知状态与不一致结果会在权限判断之前停止，屏幕上有文字也不例外。
 * 字段值与文件范围仍由权限和具体工具检查；取消或失败不会撤销之前已发生的副作用。
 * 运行观察：工具参数未收齐、响应截断或模型拒绝时，本次响应中的工具不会执行。
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
 * 让模型读取真实工具结果，继续决策，直到本轮完成或中断。
 *
 * - 输入：本轮问题、已有历史和共用取消信号；观察者显示进度，审批回调收集用户决定。
 * - 文字显示：onText 产生的片段转成事件；只有完整 ModelResult 才进入后续判断。
 * - 工具处理：每个调用先过权限，文件写入与命令先准备、再批准，拒绝和 ToolError 也回给模型。
 * - 结果处理：isError=true 仍保留工具正文，例如测试失败时模型还需要读取错误报告。
 * - 历史提交：成功时保存完整 turn；取消、空回答、未知异常或次数用尽时不提交本轮。
 * - 职责边界：工具实现负责文件和进程操作；本函数不会回滚副作用，也不把写入批准保存为会话授权。
 */
// [CHANGED 08.2] 先判断完整响应的结束状态，再进入工具或最终回答分支。
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
    // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
    const result = await model.generate([...history, ...turn], signal, (text) => {
      if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });
    });
    inputTokens = addUsage(inputTokens, result.inputTokens);
    outputTokens = addUsage(outputTokens, result.outputTokens);
    truncated ||= result.truncated;
    emitAgentEvent(observer, {
      type: "model_finish",
      call: modelCall,
      // [CHANGED 08.2] 长度上限和拒绝不会伪装成成功回答。
      finishReason: result.finishReason,
      outcome: !["stop", "tool_calls"].includes(result.finishReason) ? "incomplete"
        : result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
      toolRequests: result.toolCalls.length,
      text: result.text,
    });

    // [NEW 08.2] 正常结束与工具数量必须一致，完整响应才允许进入权限判断。
    if (result.finishReason === "length") throw new UserFacingError("回答达到输出上限，本次响应未完成；其中的工具请求不会执行。");
    if (result.finishReason === "refusal") throw new UserFacingError("模型拒绝了本次请求，本次响应中的工具请求不会执行。");
    if (result.finishReason !== (result.toolCalls.length ? "tool_calls" : "stop")) {
      throw new UserFacingError("模型结束原因与内容不一致，或当前接口返回了不支持的结束原因。");
    }
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
