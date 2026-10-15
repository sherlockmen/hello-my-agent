# file-checkpoints.ts

`chapter-14-session-checkpoints/02-file-checkpoints/src/sessions/file-checkpoints.ts`

<a href="./content/chapter-14-session-checkpoints/02-file-checkpoints/src/sessions/file-checkpoints.ts" download>下载原始文件</a>

```typescript
/**
 * 14.2 文件检查点 | [NEW] sessions/file-checkpoints.ts
 * 学习目标：批准写入后、真正改文件前，先留下可核对的原文与预期结果。
 * 输入：会话身份、真实工作区、单个工具的 before/after；输出：独立检查点 UUID。
 * 状态：每次 write_file/edit_file 一份记录，位于会话目录的 <会话ID>.files 中。
 * 失败：任何检查或保存失败都不放行工具写入；命令和外部程序不在捕获范围。
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, sessionPath } from "./read-session.js";

// [NEW 14.2] 本文件以下实现均为本节新增。
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 14 * MAX_FILE_BYTES; // JSON 的控制字符转义会放大正文，读取仍必须有界。
export type FileCheckpoint = { version: 1; id: string; sessionId: string; workspace: string; path: string; createdAt: string; before: string | null; after: string };
export type FileCheckpointStore = {
  record(path: string, before: string | null, after: string, workspace: string): Promise<string>;
  list(): Promise<FileCheckpoint[]>;
  read(id: string): Promise<FileCheckpoint>;
};

/** 每一段都拒绝链接和硬保护路径，不把链接别名当作可恢复文件。 */
async function safeTarget(path: string, workspace: string): Promise<string> {
  const parts = path.replaceAll("\\", "/").split("/");
  const name = basename(path).toLowerCase();
  if (!path || path.length > 500 || isAbsolute(path) || win32.isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)
    || parts.some(part => !part || part === "." || part === ".." || [".git", ".agents", ".codex", ".hello-my-agent"].includes(part.toLowerCase()))
    || name === ".env" || name.startsWith(".env.") || name === ".envrc") throw new UserFacingError("检查点只允许项目内非保护的相对文件路径。");
  const root = await realpath(workspace);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new UserFacingError("检查点不接受符号链接或非目录父路径。");
    } catch (error) { if (i !== parts.length - 1 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const actual = relative(root, current);
  if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) throw new UserFacingError("检查点路径越界。");
  return current;
}

/** 有界读取普通文件，身份与字节来自同一句柄；UTF-8 无损才接受。 */
async function readText(path: string, allowMissing = false) {
  let file: FileHandle;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) throw new UserFacingError("文件检查点只支持单链接、1 MiB 以内的普通 UTF-8 文本文件。");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
    if (length > MAX_FILE_BYTES) throw new UserFacingError("文件超过 1 MiB。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new UserFacingError("文件不是有效 UTF-8，未创建检查点。"); }
    if (text.includes("\0")) throw new UserFacingError("二进制文件不在检查点范围。");
    return { text, info };
  } finally { await file.close(); }
}

/** 会话目录只保存本会话检查点；新分支不继承旧分支的文件恢复权。 */
export function createFileCheckpointStore(sessionId: string, directory = DEFAULT_SESSION_DIRECTORY): FileCheckpointStore {
  const folder = sessionPath(sessionId, directory).slice(0, -6) + ".files";
  async function ensureFolder() {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new UserFacingError("文件检查点目录必须是真实目录。");
  }
  async function read(id: string): Promise<FileCheckpoint> {
    sessionPath(id);
    const folderInfo = await lstat(folder);
    if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink()) throw new UserFacingError("文件检查点目录无效。");
    const file = await open(join(folder, `${id}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_RECORD_BYTES) throw new UserFacingError("文件检查点记录类型或大小无效。");
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let length = 0;
      while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
      if (length > MAX_RECORD_BYTES) throw new UserFacingError("文件检查点记录过大。");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new UserFacingError("文件检查点格式无效。");
      const item = value as FileCheckpoint;
      if (Object.keys(item).sort().join() !== "after,before,createdAt,id,path,sessionId,version,workspace" || item.version !== 1 || item.id !== id || item.sessionId !== sessionId
        || typeof item.workspace !== "string" || !isAbsolute(item.workspace) || typeof item.path !== "string" || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
        || (item.before !== null && typeof item.before !== "string") || typeof item.after !== "string"
        || Buffer.byteLength(item.before ?? "") > MAX_FILE_BYTES || Buffer.byteLength(item.after) > MAX_FILE_BYTES || (item.before ?? "").includes("\0") || item.after.includes("\0")) throw new UserFacingError("文件检查点字段无效。");
      return item;
    } finally { await file.close(); }
  }
  return {
    async record(path, before, after, workspace) {
      if (Buffer.byteLength(before ?? "") > MAX_FILE_BYTES || Buffer.byteLength(after) > MAX_FILE_BYTES || after.includes("\0")) throw new UserFacingError("文件检查点正文超过限制或不是文本。");
      const root = await realpath(workspace), target = await safeTarget(path, root);
      const current = await readText(target, true);
      if ((current?.text ?? null) !== before) throw new UserFacingError("文件在准备检查点时已变化，工具写入已停止。");
      await ensureFolder();
      const id = randomUUID();
      const item: FileCheckpoint = { version: 1, id, sessionId, workspace: root, path, createdAt: new Date().toISOString(), before, after };
      const file = await open(join(folder, `${id}.json`), "wx", 0o600);
      try { await file.writeFile(`${JSON.stringify(item)}\n`, "utf8"); await file.sync(); }
      finally { await file.close(); }
      return id;
    },
    read,
    async list() {
      let names: string[];
      try { names = await readdir(folder); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      const items: FileCheckpoint[] = [];
      for (const name of names) if (/^[0-9a-f-]{36}\.json$/.test(name)) items.push(await read(name.slice(0, -5)));
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },
  };
}
```
