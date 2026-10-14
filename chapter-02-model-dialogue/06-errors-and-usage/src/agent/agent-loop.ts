/**
 * 02.6 说明错误与显示用量 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：看清成功、失败与取消怎样穿过同一条主流程，并明确状态提交时机。
 * 输入：终端文本、共享 history、Model 和 AbortSignal。
 * 输出：成功时返回 Reply，由 CLI 或终端显示回答与用量；失败或取消时抛错，history 不变。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP 02.4]      [KEEP 02.3]       [KEEP 02.5]
 * +----------+    +-------------+    +----------------+
 * | Terminal | -> | agentLoop   | -> | Model adapter  |
 * +----^-----+    | + history   |    | provider API   |
 *      |          +------+------+    +-------+--------+
 *      |                 ^                   |
 *      |                 |              请求成功？
 *      |                 |          +--------+--------+
 *      |                 |          | 否             | 是
 *      |                 |          v                v
 *      |                 |   [NEW 02.6] errors   Reply + usage
 *      |                 |          |                |
 *      |                 |     安全文案               v
 *      |                 |          |        检查取消并提交历史
 *      +---- 显示结果 <---+----------+----------------+
 *
 * [NEW] 是错误解释与用量显示；Agent Loop 的提交规则仍沿用 02.3。
 * 网络、认证或响应检查失败时，异常交给 CLI 或终端解释；成功且未取消后核心才保存问答。
 * 运行观察：成功显示 token 用量；失败不泄露响应体，也不留下半轮历史。
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
