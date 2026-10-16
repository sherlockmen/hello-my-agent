# manifest.ts

`chapter-31-extension-packages/01-install-local-package/src/extensions/manifest.ts`

<a href="./content/chapter-31-extension-packages/01-install-local-package/src/extensions/manifest.ts" download>下载原始文件</a>

```typescript
/**
 * 31.1 安装本地扩展包 | [NEW] extensions/manifest.ts
 * 学习目标：把本地目录读成有界快照，验证完成后才交给安装器。
 * 输入：显式选择的普通目录、取消信号；输出：清单与文件字节，不执行代码。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   普通目录？否 -> 拒绝；是 -> 有界读取全部文件 -> 清单/路径有效？否 -> 拒绝；是 -> 快照
 * 状态：读取失败不改变安装目录；安装器会对复制品再次校验。
 * 边界：拒绝已存在的链接，不是抵抗恶意并发替换的操作系统沙箱。
 */
// [NEW 31.1] 有界读取包、验证清单版本与包内路径。

import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ToolError } from "../errors.js";

// [KEEP 来自 31.1] 本文件实现均始于本地安装。
export const EXTENSION_LIMITS = { packages: 16, files: 128, fileBytes: 262144, totalBytes: 1048576 } as const;
export type ExtensionManifest = { id: string; version: string; apiVersion: 1; requires?: string[]; skills?: string; hooks?: string; mcp?: string };
export type PackageSnapshot = { root: string; manifest: ExtensionManifest; files: Map<string, Buffer> };

/**
 * 仅接纳可稳定映射到拥有目录的包 ID，不接受路径。
 */
export function extensionId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,11}$/.test(value)) throw new ToolError("扩展 id 须为 1—12 位小写字母、数字或连字符，并以字母开头。");
  return value;
}

/**
 * 约束清单中的文件位置；每段必须是普通包内容，不展开环境变量。
 */
export function packagePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 256 || !value || value.includes("\\")
    || value.split("/").some(part => !part || !/^[a-zA-Z0-9_.-]+$/.test(part)
      || [".", "..", ".git", ".hello-my-agent", ".codex", ".agents", ".ssh", ".envrc", "node_modules"].includes(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part))) throw new ToolError("扩展路径须为包内普通相对路径，不能包含越界、环境文件或元数据目录。");
  return value;
}

/**
 * 验证本教程支持的清单协议；版本只是精确版本，不实现 semver 范围。
 */
export function parseManifest(input: unknown): ExtensionManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolError("extension.json 必须是对象。");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["id", "version", "apiVersion", "requires", "skills", "hooks", "mcp"].includes(key))) throw new ToolError("extension.json 含未知字段。");
  const id = extensionId(value.id);
  if (typeof value.version !== "string" || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value.version)) throw new ToolError("扩展 version 须为精确 x.y.z 版本。");
  if (value.apiVersion !== 1) throw new ToolError("扩展 API 不兼容：本程序只支持 apiVersion: 1。");
  if (value.requires !== undefined && (!Array.isArray(value.requires) || value.requires.length > 8)) throw new ToolError("requires 须为最多 8 个包 ID。");
  const requires = (value.requires as unknown[] | undefined)?.map(extensionId);
  if (requires?.includes(id) || new Set(requires).size !== (requires?.length ?? 0)) throw new ToolError("扩展依赖不能重复或依赖自身。");
  const manifest: ExtensionManifest = { id, version: value.version, apiVersion: 1, ...(requires?.length ? { requires } : {}) };
  for (const key of ["skills", "hooks", "mcp"] as const) if (value[key] !== undefined) manifest[key] = packagePath(value[key]);
  if (!manifest.skills && !manifest.hooks && !manifest.mcp) throw new ToolError("扩展须至少声明一种 skills/hooks/mcp 能力。");
  return manifest;
}

/**
 * 确认目录当前为真实普通目录；调用者仍须在写入前重新检查。
 */
export async function ordinaryDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new ToolError("扩展目录必须是无链接的普通目录。");
}

/**
 * 用一个文件句柄读取有界字节并检查身份，拒绝 FIFO、链接与读取中的变化。
 */
async function readBytes(path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > EXTENSION_LIMITS.fileBytes) throw new ToolError("扩展文件不是普通文件或超过单文件预算。");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw new ToolError("扩展文件身份已变化。");
    const buffer = Buffer.alloc(EXTENSION_LIMITS.fileBytes + 1);
    let size = 0;
    while (size < buffer.length) { signal.throwIfAborted(); const result = await file.read(buffer, size, buffer.length - size, size); if (!result.bytesRead) break; size += result.bytesRead; }
    const after = await file.stat(), current = await lstat(path);
    if (size > EXTENSION_LIMITS.fileBytes || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs
      || current.dev !== info.dev || current.ino !== info.ino || await realpath(path) !== path) throw new ToolError("读取期间扩展文件发生变化或超限。");
    signal.throwIfAborted();
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}

/**
 * 读取整个包的有限快照；环境文件、元数据、链接和超过预算的包在复制前就被拒绝。
 * 只接纳文件与目录；manifest 引用的目标必须实际存在。
 */
export async function readPackage(source: string, signal: AbortSignal): Promise<PackageSnapshot> {
  const chosen = resolve(source);
  if ((await lstat(chosen)).isSymbolicLink()) throw new ToolError("扩展来源不能是链接。 ");
  const root = await realpath(chosen); await ordinaryDirectory(root);
  const files = new Map<string, Buffer>(); let total = 0, directories = 0;
  const visit = async (directory: string, prefix: string): Promise<void> => {
    signal.throwIfAborted(); await ordinaryDirectory(directory);
    if (++directories > 64) throw new ToolError("扩展目录超过 64 项。");
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const name = entry.name;
      const label = packagePath(prefix + name), path = join(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) throw new ToolError(`扩展不接受链接：${label}。`);
      if (info.isDirectory()) { await visit(path, `${label}/`); continue; }
      if (files.size >= EXTENSION_LIMITS.files) throw new ToolError("扩展文件超过 128 项。");
      const bytes = await readBytes(path, signal); total += bytes.length;
      if (total > EXTENSION_LIMITS.totalBytes) throw new ToolError("扩展总字节超过 1 MiB。");
      files.set(label, bytes);
    }
  };
  await visit(root, "");
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("extension.json"))); }
  catch { throw new ToolError("extension.json 缺失或不是有效 UTF-8 JSON。"); }
  const manifest = parseManifest(input);
  for (const key of ["hooks", "mcp"] as const) if (manifest[key] && !files.has(manifest[key]!)) throw new ToolError(`扩展缺少 ${key} 文件：${manifest[key]}。`);
  if (manifest.skills && ![...files.keys()].some(path => path.startsWith(`${manifest.skills}/`) && path.endsWith("/SKILL.md"))) throw new ToolError("skills 目录没有 SKILL.md。");
  return { root, manifest, files };
}
```
