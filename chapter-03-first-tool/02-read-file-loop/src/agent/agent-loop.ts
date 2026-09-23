/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在已有主循环里接通“请求工具 -> 本地执行 -> 回传结果 -> 再判断”。
 * 输入：终端文本、history、支持工具消息的 Model 和 AbortSignal。
 * 输出：最终回答与累计用量；任一步失败时，本轮候选消息不写入 history。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP]             [CHANGED 03.2]        [KEEP 03.1]
 * +----------+      +----------------+     +----------------+
 * | Terminal | ---> | agentLoop      | --> | model.generate |
 * +----^-----+      | turn + history |     +-------+--------+
 *      |            +-------+--------+             |
 *      |                    ^                返回哪种结果？
 *      |                    |          +-----------+-----------+
 *      |                    |          | final text            | tool call(s)
 *      |                    |          v                       v
 *      |                    |   提交完整 turn          [NEW 03.2] registry
 *      |                    |          |                       |
 *      |                    |          v                 validate + read_file
 *      +--- 显示回答 <------+------ return                     |
 *                           |                                  v
 *                           +-------- tool result + call ID ----+
 *
 * 异常或取消 -----------------> 丢弃 turn，不修改 history，向外抛错
 * 第 8 次仍请求工具 ----------> 不执行该工具，停止并丢弃 turn
 *
 * [NEW] 是本地工具执行和结果回传；回传后沿箭头再次请求模型，形成 Agent Loop。
 * 模型只生成结构化请求，Node.js 才真正读取文件；调用 ID 负责配对请求与结果。
 * 只有拿到最终回答才提交整个 turn，避免下次会话继承一条不完整消息链。
 * 运行观察：模型先请求 read_file，收到文件内容后再生成最终回答。
 */

import { UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { executeTool } from "../tools/registry.js";

// [NEW 03.2] 开始循环时，同时规定最多请求模型几次。
const MAX_MODEL_CALLS = 8;

/**
 * 累加本轮各次模型请求报告的用量。
 *
 * total 或 value 为 null，表示有一次用量未知，合计也只能返回 null。
 * 两项都有数字时才相加，避免把不完整的统计显示成完整总量。
 */
// [NEW 03.2] 一轮可能多次请求模型，因此累计用量。
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 执行模型提出的工具请求，再带着结果请求模型，直到得到最终回答。
 *
 * 输入是模型、已完成历史、用户文字和取消信号。本轮消息先保存在局部 turn 中。
 * 工具请求与结果按调用 ID 配对；没有新的工具请求时，才把完整 turn 加入 history 并返回累计用量。
 * 最多请求模型 8 次，第 8 次仍要用工具就停止，避免执行无法再发回模型的操作。
 * 工具失败、模型异常或取消都会抛给外层，本轮不保存；把 ToolError 发回模型留到 03.3。
 */
// [CHANGED 03.2] 主循环开始执行已登记工具，并把带调用 ID 的结果追加到本轮候选消息。
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

    // 先保存模型提出的完整调用，再逐个保存同 ID 的结果；下一次请求才能还原因果关系。
    turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      signal.throwIfAborted();
      const content = await executeTool(call);
      turn.push({ role: "tool", toolCallId: call.id, content, isError: false });
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
