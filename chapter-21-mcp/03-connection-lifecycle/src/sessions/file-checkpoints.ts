/**
 * 21.3 连接状态取消与关闭 | [KEEP] sessions/file-checkpoints.ts
 * 学习目标：先保存可核对的文件检查点，再用预览与二次核对控制单文件恢复。
 * 输入：会话身份、真实工作区、单个工具的 before/after 或检查点 ID。
 * 输出：检查点 UUID、改动列表、恢复预览；明确确认且目标未变才恢复。
 * 状态：每次 write_file/edit_file 一份记录，位于会话目录的 <会话ID>.files 中。
 * 失败：检查点保存失败不放行工具写入；恢复前冲突不覆盖，恢复写入失败可能留下部分内容。
 * 边界：命令与外部程序不在捕获范围；文件恢复不倒退对话，调用方追加重新读取通知。
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { createUnifiedDiff } from "../tools/change-preview.js";
import { findProjectRoot } from "../tools/workspace.js";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, sessionPath } from "./read-session.js";

// [KEEP 来自 14.2] 本文件以下实现均为本节新增。
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

// [KEEP 来自 14.3] 预览保留当时的文件身份，确认时重新比较，不能只相信“之前看过”。
/**
 * 准备单个文件的恢复预览，不修改目标。
 * 先核对真实工作区和当前全文，再把文件身份记入 execute；确认时重新核对身份与字节。
 * 恢复只涉及本文件，写入途中失败可能留下部分内容，检查点原文仍保留。
 */
export async function prepareFileRestore(store: FileCheckpointStore, id: string, workspace = findProjectRoot()) {
  const item = await store.read(id), root = await realpath(workspace);
  if (item.workspace !== root) throw new UserFacingError("检查点属于另一个真实工作区，不会恢复。");
  const target = await safeTarget(item.path, root), current = await readText(target, true);
  if (!current || current.text !== item.after) {
    if ((current?.text ?? null) === item.before) throw new UserFacingError("文件已是检查点之前的状态；没有需要恢复的内容。");
    throw new UserFacingError("恢复冲突：当前文件不等于本次工具预期的修改后内容；未覆盖，请先人工核对或先恢复较新的检查点。");
  }
  const preview = createUnifiedDiff(item.path, item.after, item.before ?? "")
    + (item.before === null ? "\n恢复动作：删除这次创建的文件。" : "\n恢复动作：写回修改前的完整原文。")
    + "\n只恢复这个文件；对话、命令、网络请求和其他外部副作用不会撤销。";
  return { item, preview, async execute(): Promise<void> {
    await safeTarget(item.path, root);
    let file: FileHandle | undefined;
    try {
      file = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.dev !== current.info.dev || info.ino !== current.info.ino || info.size > MAX_FILE_BYTES) throw new UserFacingError("恢复冲突：预览后的文件身份或类型已变化，未覆盖。");
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1); let length = 0;
      while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
      if (!bytes.subarray(0, length).equals(Buffer.from(item.after))) throw new UserFacingError("恢复冲突：预览后内容已变化，未覆盖。");
      // shortcut: 这里不是系统文件锁；比较之后其他进程仍可能写入，协作项目需先停止并发编辑。
      const latest = await lstat(target);
      if (latest.isSymbolicLink() || latest.dev !== info.dev || latest.ino !== info.ino) throw new UserFacingError("恢复冲突：路径已替换，未覆盖。");
      if (item.before === null) { await file.close(); file = undefined; await unlink(target); }
      else {
        await file.truncate(0);
        const content = Buffer.from(item.before); let written = 0;
        while (written < content.length) { const result = await file.write(content, written, content.length - written, written); if (!result.bytesWritten) throw new UserFacingError("恢复写入未完成；检查点原文仍在，请人工核对目标。"); written += result.bytesWritten; }
        await file.sync();
      }
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw new UserFacingError("恢复未完成；检查点原文仍在，请核对文件状态，程序不会自动重试。");
    } finally { await file?.close(); }
  } };
}

// [KEEP 来自 14.3] 本地命令共用一个已预览计划，文字入口与 TUI 都要求再次明确确认。
/**
 * 为一个终端会话保存最近一次恢复预览，供文字入口和 TUI 共用。
 * 只有同一 ID 已预览才接受 confirm；执行前消费计划，执行或准备失败后清除计划。
 * 返回恢复结果给调用方，由调用方追加通知并保存会话历史。
 */
export function createFileCheckpointCommands(store?: FileCheckpointStore) {
  let prepared: Awaited<ReturnType<typeof prepareFileRestore>> | undefined;
  return async (command: string): Promise<{ message: string; restored?: FileCheckpoint }> => {
    if (!store) return { message: "本入口未启用文件检查点。" };
    try {
      if (command === "/changes") {
        const items = await store.list();
        return { message: items.length ? items.map(item => `${item.id}  ${item.before === null ? "新增" : "修改"} ${item.path}  ${item.createdAt}`).join("\n") + "\n/restore <ID> 预览单个文件；同一路径从最新改动开始核对。" : "本会话没有文件检查点；命令和外部修改不在记录范围。" };
      }
      const match = /^\/restore ([0-9a-f-]{36})( confirm)?$/.exec(command);
      if (!match) return { message: "用法：/changes；/restore <完整ID> 先预览，再 /restore <完整ID> confirm。" };
      if (!match[2]) { prepared = await prepareFileRestore(store, match[1]); return { message: prepared.preview + `\n确认执行：/restore ${match[1]} confirm` }; }
      if (!prepared || prepared.item.id !== match[1]) return { message: "请先执行 /restore <ID> 查看本次恢复预览，再确认。" };
      const plan = prepared; prepared = undefined;
      await plan.execute();
      return { message: `已恢复文件：${plan.item.path}；对话历史保留，下一轮需重新读取文件。`, restored: plan.item };
    } catch (error) { prepared = undefined; return { message: error instanceof UserFacingError ? error.message : "检查点无法读取或路径不可访问；未执行恢复，请核对记录。" }; }
  };
}
