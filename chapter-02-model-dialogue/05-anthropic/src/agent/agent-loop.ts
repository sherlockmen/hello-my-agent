/**
 * 02.5 接入 Anthropic 接口 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：让同一个 Agent Loop 通过统一 Model 接口调用两种服务商协议。
 * 输入：终端文本、共享 history、已按配置创建的 Model 和 AbortSignal。
 * 输出：两种协议都归一为 Reply，再按相同规则提交历史并显示。
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
 * [CHANGED] 只发生在模型适配层；Agent Loop 不需要知道服务商字段差异。
 * 适配器负责把统一 Message 转成各自协议，并把响应还原成相同的 Reply。
 * 运行观察：切换 AGENT_PROVIDER 后，终端和 history 的控制流程保持一致。
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
