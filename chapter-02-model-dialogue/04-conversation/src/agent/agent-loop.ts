/**
 * 02.4 连续输入与会话历史 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：把单轮 Agent 放进终端会话，使多轮输入共享同一份历史。
 * 输入：终端逐行提交的用户文本、已有 history 和 AbortSignal。
 * 输出：成功后把 Reply 返回终端；失败或取消时抛错，history 保持不变。
 * /exit、EOF 和 Ctrl+C 由外层终端处理，不作为用户问题交给核心。
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
 *                                             再次取消？ -- 是 -> 不提交并抛错
 *                                                | 否
 *                                                v
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
// 调用方需要等这一轮结束，再把同一 history 交给下一轮，避免两轮同时修改历史。
/**
 * 完成当前这轮文本问答，成功且未取消后才把问答存进历史。
 *
 * model、history、input 和 signal 都由调用方提供；同一份 history 要按顺序使用。
 * 先用旧历史和新问题创建本轮消息数组，再等待模型返回，最后再次检查取消。
 * 通过检查后，把用户问题与模型回答一起追加到 history，并返回 Reply 给调用方显示。
 * 请求失败或取消时抛出异常，原历史保持不变；本节还没有需要重复调用模型的工具分支。
 */
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  // 1. 先检查取消，再用旧历史和新问题另建一个数组；这一步还不修改 history。
  signal.throwIfAborted();
  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];

  // 2. 调用模型。协议转换与空回答检查由 models/client.ts 完成。
  // [第 03 章扩展位置，尚未实现] 在这里处理工具调用 -> 回传结果 -> 再调用模型。
  const reply = await model.generate(messages, signal);

  // 3. 再检查取消，然后把问答一起存进历史；服务刚好返回也不等于用户仍需要这轮结果。
  signal.throwIfAborted();
  history.push(userMessage, { role: "assistant", content: reply.text });
  return reply;
}
