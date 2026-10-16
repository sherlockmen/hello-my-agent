# connection-profile.ts

`chapter-36-release-and-upgrade/03-config-and-session-upgrade/src/config/connection-profile.ts`

<a href="./content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/src/config/connection-profile.ts" download>下载原始文件</a>

```typescript
/**
 * 36.3 配置与会话升级 | [CHANGED] config/connection-profile.ts
 *
 * 学习目标：让显式的非凭据连接配置进入已有的环境配置合并过程。
 * 输入：用户明确提供的 JSON 路径；输出：通过校验的连接选项。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   普通文件 -> 限制大小 -> 解析版本与字段 -> 安全连接选项 / 拒绝
 * 状态：只读取，不创建 SDK、不写配置；失败不会回显原文。
 * 观察：--config 不提供时，仍只有原先环境配置；密钥不允许写进 JSON。
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 36.1] 配置文件只有连接字段，不接受凭据或未来未知字段。
export type ConnectionProfile = { provider: "openai" | "anthropic"; model: string; baseUrl?: string };

/**
 * 读取不超过 64 KiB 的普通配置文件，拒绝符号链接和特殊文件。
 * 使用打开后的文件描述符检查大小，错误只给固定说明；不打印路径或原文。
 */
export function readProfileText(path: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65_536) throw new Error("invalid profile");
    // 多读一个字节即可判断超额；并发增长也不会触发无界读入。
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > 65_536) throw new Error("profile grew");
    return buffer.subarray(0, length).toString("utf8");
  } catch {
    throw new UserFacingError("无法读取连接配置：需要不超过 64 KiB 的普通 JSON 文件，不能使用符号链接。");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** 将 JSON 解为对象；解析异常中可能含配置原文，因此不转发原始错误。 */
export function parseProfile(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch { throw new UserFacingError("连接配置不是有效的 JSON 对象。"); }
}

/**
 * 校验一个已知连接对象；只接受两个协议、非空模型和安全基础地址。
 * baseUrl 不允许凭据、查询或片段；未知字段包括误填的 apiKey，全部拒绝。
 */
export function validateConnection(value: Record<string, unknown>, allowed: string[]): ConnectionProfile {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new UserFacingError("连接配置包含未知字段；请删除密钥及未支持的设置。");
  if (value.provider !== "openai" && value.provider !== "anthropic") throw new UserFacingError("连接配置 provider 只能是 openai 或 anthropic。");
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 256 || /[\r\n\0]/.test(value.model)) throw new UserFacingError("连接配置需要非空且不超过 256 字符的模型 ID。");
  let baseUrl: string | undefined;
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== "string" || !value.baseUrl.trim() || value.baseUrl.length > 2048) throw new UserFacingError("连接配置 baseUrl 无效。");
    baseUrl = value.baseUrl.trim();
    let url: URL;
    try { url = new URL(baseUrl); } catch { throw new UserFacingError("连接配置 baseUrl 无效。"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new UserFacingError("连接配置 baseUrl 只能是没有凭据、查询和片段的 HTTP(S) 地址。");
  }
  return { provider: value.provider, model: value.model.trim(), ...(baseUrl ? { baseUrl } : {}) };
}

// [CHANGED 36.3] v2 只接受明确的顶层结构，迁移器与启动读取器共用校验。
/** 校验已知 v2 的连接对象，不接受未来未知顶层设置或凭据字段。 */
export function validateProfileV2(value: Record<string, unknown>): ConnectionProfile {
  if (value.version !== 2 || Object.keys(value).some(key => !["version", "connection"].includes(key))) throw new UserFacingError("连接配置不是受支持的 v2 结构。");
  const connection = value.connection;
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) throw new UserFacingError("连接配置 v2 需要 connection 对象。");
  return validateConnection(connection as Record<string, unknown>, ["provider", "model", "baseUrl"]);
}

/** 只读取有效 v2；旧格式提示显式迁移，不在普通启动中写配置。 */
export function readConnectionProfile(path: string | undefined): Partial<ConnectionProfile> {
  if (path === undefined) return {};
  const value = parseProfile(readProfileText(path));
  if (value.version === 1) throw new UserFacingError("连接配置是 v1，请先运行 migrate-config <路径>。");
  if (value.version !== 2) throw new UserFacingError("连接配置版本不支持，不能读取未知新格式。");
  return validateProfileV2(value);
}
```
