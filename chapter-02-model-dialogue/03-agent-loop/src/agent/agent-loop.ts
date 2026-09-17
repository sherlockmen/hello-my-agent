/**
 * 02.3 建立 Agent Loop 核心 | [NEW] agent/agent-loop.ts
 *
 * 学习目标：建立全书固定的 Agent 主流程，并保证完整成功的问答才能进入历史。
 * 输入：CLI 提交的用户文本、已有 history 和 AbortSignal。
 * 输出：最终回答返回 CLI；失败或取消时抛错，history 保持不变。
 *
 * 全局主流程（本节版本）：
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
 * 关键点：agentLoop 先构造候选上下文，成功且未取消后才一次性提交历史。
 * 当前只有“模型直接回答”路径；工具请求与重复调用会在第三章接入这张图。
 * 运行观察：成功保存两条消息，失败和取消保存零条消息。
 */

import type { Message, Model, Reply } from "../models/client.js";

// [NEW 02.3] 本轮只接收普通文本，成功后一起保存 user 与 assistant 消息。
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
