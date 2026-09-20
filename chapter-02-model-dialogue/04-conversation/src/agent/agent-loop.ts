/**
 * 02.4 连续输入与会话历史 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：把单轮 Agent 放进终端会话，使多轮输入共享同一份历史。
 * 输入：终端逐行提交的用户文本、已有 history 和 AbortSignal。
 * 输出：每轮最终回答返回终端；/exit、EOF 或 Ctrl+C 结束外层会话。
 *
 * 全局主流程（本节版本）：
 *
 * [NEW 02.4]                 [KEEP 02.3]             [KEEP 02.3]
 * +----------------+        +----------------+       +----------------+
 * | Terminal input | -----> | agentLoop      | ----> | model.generate |
 * +-------+--------+        | history+input  |       +-------+--------+
 *         |                 +-------+--------+               |
 *    /exit/EOF?                     ^                  成功返回文本？
 *    | 是 -> 结束                    |                  | 否 -> 不提交并报错
 *    | 否                           |                  | 是
 *    +------------------------------+                  v
 *                                             append user + assistant
 *                                                        |
 *                                                        v
 * Terminal 等待下一行 <-------- 显示回答 <---------------+
 *
 * [NEW] 是终端会话循环；[KEEP] 是上一节建立的单轮 Agent 与模型调用。
 * 外层循环等待不同的用户输入；agentLoop 仍只完成其中一轮，且本节还没有工具循环。
 * history 只在终端启动时创建一次，所以第二轮请求能带上第一轮成功的问答。
 * 运行观察：连续提问时保留上下文；退出信号不会被发送给模型。
 */

import type { Message, Model, Reply } from "../models/client.js";

// [KEEP 来自 02.3] 本轮只接收普通文本，成功后一起保存 user 与 assistant 消息。
// ui/terminal.ts 一次只调用一轮；同一 history 不应同时交给多个并发调用修改。
/**
 * 执行一轮没有工具调用的 Agent，并在成功后一次性提交完整问答。
 *
 * - 输入：统一模型、可变历史数组、本轮用户文字和取消信号。
 * - 输出：返回模型的 `Reply`，并把本轮 user/assistant 两条消息追加到 `history`。
 * - 关键步骤：先复制历史构造候选上下文，等待模型成功，再次检查取消后才提交状态。
 * - 失败方式：请求失败或取消时异常向上传递，原历史保持不变。
 * - 职责边界：本节只调用模型一次，不处理工具请求。
 */
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
