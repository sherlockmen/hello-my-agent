/**
 * 02.6 说明错误与显示用量 | [NEW] errors.ts
 *
 * 学习目标：让用户知道请求失败后先检查哪里，同时避免把原始请求与响应直接显示出来。
 * 输入：配置错误、OpenAI / Anthropic SDK 错误或未知异常。
 * 输出：程序自建的提示，或按错误类型选择的固定中文提示；不展开 SDK 原始异常。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-------+
 *   | error |
 *   +---+---+
 *       v
 *   UserFacingError？ -- 是 --> 返回安全文案
 *       | 否
 *       v
 *   SDK error？ -------- 否 --> 返回通用提示
 *       | 是
 *       v
 *   +-------------------------------+
 *   | timeout / network / HTTP code |
 *   +---------------+---------------+
 *                   v
 *   401 / 403 / 404 / 429 / 5xx / other --> 对应检查建议
 *
 * 关键点：只有程序自己创建的 UserFacingError 可以原样展示；外部错误只按类型和状态码分类。
 * 运行观察：不同失败原因给出不同建议，任何提示都不包含测试密钥。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// [NEW 02.6] 本文件以下实现均为本节新增。
// 这种错误的 message 会原样显示，创建时就要使用不含敏感内容的提示。
export class UserFacingError extends Error {}

/**
 * 把捕获到的错误转成用户可以据此排查的提示。
 *
 * error 可能来自本地检查、两种 SDK，或其他未知位置。
 * 程序自建的 UserFacingError 已使用可显示的文案，直接返回；SDK 错误按超时、网络和状态码选择固定提示。
 * 无法识别时返回通用提示，不展开原始异常，也不打印响应体、请求头或堆栈。
 * UserFacingError 本身不会脱敏，创建它时就必须避免放入凭据和原始响应。
 */
export function explainError(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return "请求超过 60 秒，请稍后重试，或检查接口连接。";
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError) {
    return "无法连接模型服务，请检查网络和接口地址。";
  }
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) {
    if (error.status === 401) return "认证失败（401），请检查所选协议的 API Key 与接口是否匹配。";
    if (error.status === 403) return "没有访问权限（403），请检查账号与模型权限。";
    if (error.status === 404) return "接口或模型不存在（404），请检查接口地址和模型 ID。";
    if (error.status === 429) return "请求受限（429），请检查额度或稍后重试。";
    if (error.status && error.status >= 500) return "模型服务暂时不可用，请稍后重试。";
    return "模型服务拒绝了请求，请检查协议、模型与配置。";
  }
  return "本次操作失败，请检查配置和服务状态后重试。";
}
