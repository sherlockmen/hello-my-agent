/**
 * 03.1 识别模型的工具请求 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在固定主流程中区分“最终回答”和“工具请求”。
 * 输入：终端文本、已有 history、能够返回工具请求的 Model 和 AbortSignal。
 * 输出：文本回答照常提交；工具请求主动停止，history 保持不变。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP 第二章]       [CHANGED 03.1]        [CHANGED 03.1]
 * +----------+       +---------------+      +----------------+
 * | Terminal | ----> | agentLoop     | ---> | model.generate |
 * +----^-----+       | history+input |      | + tool schema  |
 *      |             +-------+-------+      +-------+--------+
 *      |                     ^                      |
 *      |                     |                返回哪种结果？
 *      |                     |          +-----------+-----------+
 *      |                     |          | final text            | tool call
 *      |                     |          v                       v
 *      +-- 显示并等待下一行 <-+-- 提交问答        [NEW 03.1] 明确停止
 *                                                       history 不变
 *
 * [CHANGED] 表示模型结果和 Agent 判断新增了工具分支；终端会话仍沿用第二章。
 * 本节只证明程序能识别结构化工具请求，还没有把请求交给本地工具执行。
 * 主动停止可以避免把没有执行过的工具请求误当成成功回答。
 * 运行观察：普通问题仍能回答；触发 read_file 时看到明确的边界提示。
 */

import { UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

/**
 * 执行一轮 Agent，并把“最终回答”和“尚未支持的工具请求”分开处理。
 *
 * - 输入：统一模型、已有历史、本轮用户文字和取消信号。
 * - 输出：只有得到非空最终文本时才返回 `Reply` 并提交完整问答。
 * - 关键步骤：先请求模型，再检查 `toolCalls`，最后检查文本和取消状态。
 * - 失败方式：收到工具请求、空回答、模型异常或取消时抛错，历史保持不变。
 * - 职责边界：本节只识别工具请求，不解析参数，也不执行文件读取。
 */
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  signal.throwIfAborted();
  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];
  const result = await model.generate(messages, signal);

  // [NEW 03.1] 能识别不等于能执行；先用明确边界防止错误地提交空回答。
  if (result.toolCalls.length > 0) {
    throw new UserFacingError("已收到模型的工具请求；03.2 将执行 read_file 并回传结果。");
  }
  if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");

  signal.throwIfAborted();
  const reply: Reply = result;
  history.push(userMessage, { role: "assistant", content: result.text });
  return reply;
}
