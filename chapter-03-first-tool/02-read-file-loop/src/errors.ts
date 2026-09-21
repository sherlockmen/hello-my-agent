/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] errors.ts
 *
 * 学习目标：把内部异常转换成读者可以采取行动的固定提示，同时避免泄露请求细节。
 * 输入：配置错误、ToolError、OpenAI / Anthropic SDK 错误或未知异常。
 * 输出：一段安全的中文提示，不返回原始响应体、请求头、密钥或堆栈。
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
 * 关键点：ToolError 继承 UserFacingError，二者都只能使用程序预先设计的安全文案；外部错误只按类型和状态码分类。
 * 运行观察：不同失败原因给出不同建议，任何提示都不包含测试密钥。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// [KEEP 来自 02.6] 只有这种错误的 message 可以原样显示；创建时必须使用安全文案。
export class UserFacingError extends Error {}

// [NEW 03.2] 工具边界只用经过设计的安全文案创建此错误；03.3 会把它作为结果反馈给模型。
export class ToolError extends UserFacingError {}

/**
 * 把任意运行时错误转换成可以安全显示、便于排查的中文提示。
 *
 * - 输入：捕获到的未知错误，可能来自本地校验、OpenAI SDK、Anthropic SDK 或程序内部。
 * - 输出：返回不包含密钥、响应体、请求头和堆栈的固定提示文字。
 * - 关键步骤：先保留程序自建的安全文案，再按超时、连接和 HTTP 状态分类，最后使用兜底提示。
 * - 失败方式：本函数不抛错；无法识别的错误也会返回通用安全文案。
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
