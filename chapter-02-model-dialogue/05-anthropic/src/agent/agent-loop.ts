/**
 * 02.5 接入 Anthropic 接口 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：让同一个 Agent Loop 通过统一 Model 接口调用两种服务商协议。
 * 输入：终端文本、共享 history、已按配置创建的 Model 和 AbortSignal。
 * 输出：两种协议都返回 Reply；核心保存成功问答，再由 CLI 或终端显示。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP 02.4]        [KEEP 02.3]         [CHANGED 02.5]
 * +----------+      +-------------+      +--------------------+
 * | Terminal | ---> | agentLoop   | ---> | Model adapter      |
 * +----^-----+      | + history   |      +---------+----------+
 *      |            +------+------+                |
 *      |                   ^               provider?
 *      |                   |            +------+------+
 *      |                   |            | OpenAI     | Anthropic
 *      |                   |            v            v
 *      |                   |       Chat API     Messages API
 *      |                   |            +------+------+
 *      |                   |                   |
 *      +--- 显示 Reply <---+--- 统一 Reply <----+
 *
 * 请求失败或取消 -> 不提交历史，由调用方处理；成功且未取消 -> 核心保存问答，再返回 Reply。
 * [CHANGED] 只发生在模型适配层；Agent Loop 不需要知道服务商字段差异。
 * 适配器负责把统一 Message 转成各自协议，并把响应还原成相同的 Reply。
 * 运行观察：切换 AGENT_PROVIDER 后，终端和 history 的控制流程保持一致。
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
