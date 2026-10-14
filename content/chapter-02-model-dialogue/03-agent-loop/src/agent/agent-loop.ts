/**
 * 02.3 建立 Agent Loop 核心 | [NEW] agent/agent-loop.ts
 *
 * 学习目标：把一轮问答放到同一个函数中处理，并在成功且未取消后保存问答。
 * 输入：CLI 提交的用户文本、已有 history 和 AbortSignal。
 * 输出：最终回答返回 CLI；失败或取消时抛错，history 保持不变。
 *
 * 全局主流程（本节版本）：
 * 调用前已取消 -> 抛错，不发请求；未取消 -> 进入下面的请求过程。
 *
 * [KEEP 02.2]          [NEW 02.3]             [KEEP 02.2]
 * +------------+      +----------------+      +-----------------+
 * | CLI input  | ---> | agentLoop      | ---> | model.generate  |
 * +------------+      | history+input  |      | provider API    |
 *                     +-------+--------+      +--------+--------+
 *                             ^                        |
 *                             |                 成功返回文本？
 *                             |                 +------+------+
 *                             |                 | 否          | 是
 *                             |                 v             v
 *                             |          history 不变    再检查取消？
 *                             |          向外抛错        | 是 -> 不提交
 *                             |                          | 否
 *                             |                          v
 *                             +---------- append user + assistant
 *                                                        |
 *                                                        v
 *                                                   CLI 显示回答
 *
 * [NEW] 表示本节建立的核心；[KEEP] 表示从前一节沿用的入口和模型请求。
 * 关键点：agentLoop 先准备本轮消息，等模型返回且确认未取消，再把问题和回答一起存进历史。
 * 当前只有“模型直接回答”路径；工具请求与重复调用会在第三章接入这张图。
 * 运行观察：成功保存两条消息，失败和取消保存零条消息。
 */

import type { Message, Model, Reply } from "../models/client.js";

// [NEW 02.3] 本文件以下实现均为本节新增。
// 本轮只接收普通文本，成功后一起保存 user 与 assistant 消息。
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
