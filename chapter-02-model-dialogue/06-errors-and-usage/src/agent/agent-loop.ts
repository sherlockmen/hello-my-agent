/**
 * 02.6 说明错误与显示用量 | [KEEP] agent/agent-loop.ts
 *
 * 学习目标：看清成功、失败与取消怎样穿过同一条主流程，并明确状态提交时机。
 * 输入：终端文本、共享 history、Model 和 AbortSignal。
 * 输出：成功时显示回答与用量；失败时显示安全错误，history 不变。
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
 * 网络、鉴权和协议错误先转成安全文案；成功响应才把问答写入 history。
 * 运行观察：成功显示 token 用量；失败不泄露响应体，也不留下半轮历史。
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
