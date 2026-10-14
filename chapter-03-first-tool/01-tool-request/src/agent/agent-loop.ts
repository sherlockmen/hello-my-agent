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
 * 区分最终回答和工具请求，先让主循环认识新的响应形式。
 *
 * 输入是模型、已完成历史、本次用户文字和取消信号。请求时使用历史加本次输入的临时数组。
 * 只有非空最终文本才和用户消息一起加入 history；收到工具请求时用阶段提示停止。
 * 模型异常、空回答或取消同样不提交本次消息。本节还不解析参数，也不读取文件。
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
