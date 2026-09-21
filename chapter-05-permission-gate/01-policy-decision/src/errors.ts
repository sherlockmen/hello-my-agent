/**
 * 05.1 让工具调用先经过权限策略 | [KEEP 来自 04.3] errors.ts
 *
 * 学习目标：把可以安全公开的业务错误和未知内部异常分开。
 * 输入：配置、模型、搜索工具或文件系统抛出的未知异常。
 * 输出：终端可执行的排查提示；ToolError 还可以作为工具结果反馈给模型。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   error --> ToolError？ ------ 是 --> Agent Loop 生成错误工具结果
 *         +-> UserFacingError？- 是 --> 终端显示安全文案
 *         +-> SDK / 网络错误？- 是 --> 转换为分类提示
 *         +-> 其他 -----------------> 通用错误提示
 *
 * 关键点：只有经过设计的 ToolError 文案进入模型上下文，未知异常不会直接泄露路径或响应体。
 * 运行观察：无效搜索参数会反馈给模型；认证、限流和内部错误仍由终端安全说明。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// [KEEP 来自 02.6] 只有这种错误的 message 可以原样显示；创建时必须使用安全文案。
export class UserFacingError extends Error {}

// [KEEP 来自 03.2] 工具边界只用经过设计的安全文案创建此错误。
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
