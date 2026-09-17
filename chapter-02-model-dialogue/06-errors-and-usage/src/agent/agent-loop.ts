/**
 * 02.6 说明错误与显示用量 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：定义一轮 Agent 执行，并保证只有完整成功的问答才能进入历史。
 * 输入：Model、已有 history、本轮 input 和 AbortSignal。
 * 输出：成功时返回 Reply 并追加 user/assistant；失败或取消时抛错且历史不变。
 *
 * 执行流程：
 *   +---------+   +-------------------+   +----------------+
 *   | history |-->| history + input   |-->| model.generate |
 *   +---------+   +-------------------+   +--------+-------+
 *                                                 | 失败 / 取消 --> 历史不变 --> 抛错
 *                                                 | 回答
 *                                                 v
 *                                            再检查取消？
 *                                             | 是 --> 历史不变 --> throw
 *                                             | 否
 *                                             v
 *                               +-------------------------+
 *                               | append user + assistant |
 *                               +------------+------------+
 *                                            v
 *                                       return Reply
 *
 * 关键点：先用新数组构造候选上下文，模型成功且未取消后才修改原 history。
 * 本章还没有工具调用，一轮只请求一次模型；第三章会在这里加入真正的工具循环。
 * 运行观察：成功保存两条消息，失败和取消保存零条消息。
 */

import type { Message, Model, Reply } from "../models/client.js";

// [KEEP 来自 02.3] 本轮只接收普通文本，成功后一起保存 user 与 assistant 消息。
// ui/terminal.ts 一次只调用一轮；同一 history 不应同时交给多个并发调用修改。
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  // 1. 组织当前上下文。复制历史后追加新问题，失败时原历史保持不变。
  signal.throwIfAborted();
  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];

  // 2. 调用模型。协议转换与空回答检查由 models/client.ts 完成。
  // [第 03 章扩展位置，尚未实现] 在这里处理工具调用 -> 回传结果 -> 再调用模型。
  const reply = await model.generate(messages, signal);

  // 3. 确认没有取消，再一起提交问答。即使服务刚好返回，也不能保存已取消的轮次。
  signal.throwIfAborted();
  history.push(userMessage, { role: "assistant", content: reply.text });
  return reply;
}
