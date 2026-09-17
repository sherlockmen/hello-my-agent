/**
 * 02.4 连续输入与会话历史 | [KEEP] models/client.ts
 *
 * 学习目标：把普通消息转换成 OpenAI Chat Completions 请求，并取出可用的文本回答。
 * 输入：模型配置、user/assistant 消息数组和 AbortSignal。
 * 输出：{ text }；空文本或工具调用会抛出 UserFacingError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+   +---------------+   +-------------+   +----------+
 *   | messages |-->| add system    |-->| SDK request |-->| response |
 *   +----------+   +---------------+   +-------------+   +----+-----+
 *                                                             v
 *                                                        可用文本？
 *                                                         | 否 --> UserFacingError
 *                                                         | 是 --> Reply
 *
 * 关键点：超时设为 60 秒，关闭自动重试和调试日志，避免一次输入被重复发送或敏感响应进入日志。
 * 运行观察：有效配置得到一条文本回答；空回答不会写入会话历史。
 */

import OpenAI from "openai";
import { systemPrompt, UserFacingError, type Config } from "../config/load-config.js";

// [KEEP 来自 02.2] user 是提问，assistant 是模型回答；暂时只处理纯文本。
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };
// generate 是本地 TypeScript 方法，真正的服务商请求由下方 SDK 方法完成。
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}

export function createModel(config: Config): Model {
  const client = new OpenAI({
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off",
    organization: null, project: null,
  });
  return {
    async generate(messages, signal) {
      // system 说明规则，user/assistant 保存问答；每次请求都重新传入上下文。
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: false,
      }, { signal });
      const choice = response.choices?.[0];
      const text = choice?.message?.content;
      // 尚无工具能力；拒绝工具调用或空文本，避免把无效响应当作成功回答。
      if (typeof text !== "string" || !text.trim() || choice?.message?.tool_calls?.length) {
        throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
      }
      return { text };
    },
  };
}
