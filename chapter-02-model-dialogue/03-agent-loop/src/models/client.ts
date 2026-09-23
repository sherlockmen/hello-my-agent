/**
 * 02.3 建立 Agent Loop 核心 | [KEEP] models/client.ts
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
 * 运行观察：得到可用文本时返回 Reply；空回答会抛错，由调用方显示原因。
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

/**
 * 准备一个能接收消息、返回回答的 OpenAI 兼容模型对象。
 *
 * config 来自 readConfig()，已经检查过必填值和地址格式。
 * 创建 SDK 客户端时不发送请求；调用返回对象的 generate() 才会请求服务。
 * 客户端设置 60 秒超时，并关闭自动重试和日志，避免一次输入被重复发送或输出原始请求信息。
 * 请求异常继续交给调用方处理，历史也由调用方管理。
 */
export function createModel(config: Config): Model {
  const client = new OpenAI({
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off",
    organization: null, project: null,
  });
  return {
    /**
     * 发送这次消息，并从 OpenAI 兼容响应中取出可用的文本。
     *
     * messages 是调用方准备的问答，signal 用来传递取消状态。
     * 程序先在消息前加入系统说明，再等待 SDK 请求；响应有非空文本且没有工具请求时返回 { text }。
     * 不满足本节要求时抛出 UserFacingError，网络或取消等 SDK 异常继续向外传递。
     * 这个方法只负责消息收发和结果检查，不会修改传入的历史数组。
     */
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
