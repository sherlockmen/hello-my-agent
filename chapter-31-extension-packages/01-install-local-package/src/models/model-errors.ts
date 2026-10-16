/**
 * 31.1 安装本地扩展包 | [KEEP] models/model-errors.ts
 *
 * 学习目标：用可处理的错误类别解释失败，避免把服务商原文中的凭据输出。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：SDK错误 -> status/name分类 -> 安全文案；不自动重试
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { UserFacingError } from "../errors.js";
export type ModelErrorKind = "authentication" | "rate_limit" | "request" | "unavailable" | "connection" | "unknown";

/**
 * 只读 status/name，不打印远端 message、请求头或 URL；分类不表示请求可以安全重放。
 * 本地预算与协议校验的 UserFacingError 由调用方保留，真正取消优先保留原 signal.reason。
 */
export function classifyModelError(error: unknown): ModelErrorKind {
  const value = error && typeof error === "object" ? error as { status?: unknown; name?: unknown } : {};
  const status = value.status;
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "unavailable";
  if (typeof status === "number" && status >= 400) return "request";
  if (typeof value.name === "string" && /Connection|Timeout|Abort/.test(value.name)) return "connection";
  return "unknown";
}

/**
 * 返回不包含服务端原文的错误。
 * 不会替调用方重发可能已经消耗 token 的请求。
 */
export function safeModelError(error: unknown): UserFacingError {
  if (error instanceof UserFacingError) return error;
  const messages: Record<ModelErrorKind, string> = {
    authentication: "模型认证或访问权限失败，请核对当前协议专用密钥。",
    rate_limit: "模型服务限流或配额不足，请核对配额后再自行重试。",
    request: "模型服务拒绝请求，请核对模型ID、工具/图片能力与上下文限制。",
    unavailable: "模型服务暂时不可用，本次请求不会自动重试。",
    connection: "模型连接中断或超时，已接收片段不是完整回答。",
    unknown: "模型请求失败，未取得可执行的完整结果。",
  };
  return new UserFacingError(messages[classifyModelError(error)]);
}
