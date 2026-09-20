/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在固定主流程中接通“请求工具 -> 本地执行 -> 回传结果 -> 再判断”。
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
 * 运行有次数上限的工具循环，直到模型给出最终回答。
 *
 * - 输入：统一模型、正式历史、本轮用户文字和取消信号。
 * - 输出：返回最终 `Reply`，并在整轮成功后把用户、助手和工具消息一起提交到历史。
 * - 关键步骤：请求模型；有工具请求时执行并回传同一调用 ID；没有工具请求时提交最终回答。
 * - 失败方式：工具异常、取消、空回答或 8 次内没有最终回答时抛错，正式历史保持不变。
 * - 职责边界：本节只处理工具成功结果，工具失败后的模型自我修正留到 03.3。
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
