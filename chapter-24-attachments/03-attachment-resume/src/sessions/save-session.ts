/**
 * 24.3 附件会话恢复 | [CHANGED] sessions/save-session.ts
 *
 * 学习目标：把内存会话保存成版本明确、可逐行查看的 JSONL 检查点。
 * 输入：会话目录、模型消息、模式、清单和未交付补充；不接收模型连接配置或授权。
 * 输出：稳定会话 ID、新文件路径，以及写入并 sync 完成的检查点编号。
 * 状态：新建或锁后读取旧文件；调用 save/rename 时同步复制，再按同一序号写入。
 * 失败：append 或 sync 失败后停止追加；close 仍关闭句柄并核对 token 后释放锁。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   create -> mkdir -> randomUUID -> 锁(wx) -> 新文件(wx) -> 写元数据、sync
 *   resume -> 锁(wx/显式接管) -> 重读校验 -> 必要时截掉未完成尾片 -> 续接原 seq
 *   save(state) -> 立即投影、JSON.stringify -> 排到 tail -> writeFile(一行) -> sync -> 成功
 *                                                +-- 失败 -> 记住错误、停止该文件后续追加
 *   close -> 封住新写入 -> 等 tail（失败也等）-> close 文件句柄 -> 按 token 释放锁
 *
 * JSONL 的换行只分隔记录，正文中的换行由 JSON 转义；显示事件不是模型消息。
 * 恢复只提供数据，不重放历史工具，不恢复授权，不声称撤销过往文件操作。
 * sync 是本次保存的完成边界，不承诺异常断电或设备故障下绝对恢复。
 */
import type { CompactionState } from "../context/compaction.js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecutionMode, TaskItem } from "../agent/run-options.js";
import type { Message } from "../models/client.js";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, MAX_SESSION_BYTES, readSession, sessionPath, validateSessionName, validateSessionState, type ReadSessionResult } from "./read-session.js";

// [KEEP 来自 13.1] 本文件以下实现均为本节新增。
// [KEEP 来自 14.3] 文件恢复后的通知也以明确原因保存。
export type CheckpointReason = "run_start" | "run_end" | "reset" | "mode" | "queue_change" | "exit" | "file_restore";
export type SessionState = {
  // [KEEP 来自 16.1] 可选字段兼容旧检查点，完整 messages 不被摘要替代。
  context?: CompactionState;
  messages: readonly Message[];
  mode: ExecutionMode;
  tasks: readonly TaskItem[];
  pendingInputs: readonly { id: number; text: string; run: number }[];
  run: number;
  nextInputId: number;
};
export type SessionWriter = {
  readonly id: string;
  readonly path: string;
  readonly restored?: ReadSessionResult;
  save(state: SessionState, reason: CheckpointReason): Promise<number>;
  rename(name: string): Promise<number>;
  close(): Promise<void>;
};
export type SaveFeedback = { ok: boolean; message: string };

/**
 * 用固定存储文案解释文件系统错误，避免泄露原始路径、内容或任意错误消息。
 * 已设计的 UserFacingError 保留文案；已知 errno 指向权限、目录或磁盘，其他用存储兜底。
 */
export function explainSessionError(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EACCES" || code === "EPERM") return "没有写入权限，请检查会话目录权限。";
  if (code === "ENOSPC" || code === "EDQUOT") return "磁盘空间或配额不足，请检查存储空间。";
  if (code === "ENOTDIR" || code === "EISDIR" || code === "ENOENT") return "会话目录不可用，请检查目录路径。";
  if (code === "EEXIST") return "同名会话文件已存在，请重新启动以创建新的会话 ID。";
  if (code === "EMFILE" || code === "ENFILE") return "可用文件句柄不足，请关闭其他文件后重试。";
  return "文件保存未完成，请检查目录、权限和磁盘状态。";
}

/**
 * 只复制存储契约允许的会话字段，避免把活动对象或配置整包写入文件。
 * 输入可能在下一次 await 后继续改变；本函数立即深复制消息、调用、清单和队列。
 * 输出不含授权、连接配置、屏幕事件或编辑草稿；它们不属于恢复模型上下文的消息。
 */
// [CHANGED 24.3] 对白名单附件引用持久化，拒绝原始字节与额外字段。
function copySessionState(state: SessionState): SessionState {
  return {
    messages: state.messages.map((message): Message => {
      if (message.role === "tool") return { role: "tool", toolCallId: message.toolCallId, content: message.content, isError: message.isError };
      if (message.role === "user") return { role: "user", content: message.content, ...(message.attachments ? { attachments: message.attachments.map(ref => ({ ...ref })) } : {}) };
      return { role: "assistant", content: message.content, ...(message.toolCalls ? {
        toolCalls: message.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      } : {}) };
    }),
    mode: state.mode,
    tasks: state.tasks.map((item) => ({ id: item.id, text: item.text, status: item.status })),
    pendingInputs: state.pendingInputs.map((entry) => ({ id: entry.id, text: entry.text, run: entry.run })),
    run: state.run,
    nextInputId: state.nextInputId,
    ...(state.context ? { context: { summary: state.context.summary, through: state.context.through } } : {}),
  };
}

type LockRecord = { pid: number; token: string };
type HeldLock = { release(): Promise<void> };

/**
 * 只读一个有界、普通且未被替换的锁文件，返回拥有者和文件身份。
 * 无法解释的锁不会被视为空闲，避免误删其他进程或人工放置的文件。
 */
async function readLock(path: string) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4096) throw new UserFacingError("锁文件不是可识别的普通文件，请先人工检查，程序不会删除它。");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > 4096) throw new UserFacingError("锁文件在检查时发生变化，请重试。");
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error("锁过长");
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("锁不是对象");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Number.isSafeInteger(record.pid) || (record.pid as number) <= 0 || (record.pid as number) > 2_147_483_647
      || typeof record.token !== "string" || !/^[0-9a-f-]{36}$/.test(record.token)) throw new Error("锁字段无效");
    return { record: record as LockRecord, info };
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("锁文件内容无法识别，请先人工检查，程序不会删除它。");
  } finally { await file.close(); }
}

/**
 * 用 PID 检查占用是否仍有可能存在；权限不足也按占用处理。
 * PID 可能复用，所以活 PID 只意味着拒绝接管，不证明它仍是最初的会话进程。
 */
function processMayExist(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}

/**
 * 释放前重新确认 token 和普通文件身份，绝不删掉后来替换的锁。
 * 缺失或变更也作为异常报告；调用方不能把未核对的释放说成成功。
 */
async function releaseLock(path: string, token: string): Promise<void> {
  const current = await readLock(path);
  if (current.record.token !== token || current.record.pid !== process.pid) throw new UserFacingError("锁的拥有者已经变化，当前进程没有删除它。");
  const latest = await lstat(path);
  if (!latest.isFile() || latest.ino !== current.info.ino || latest.dev !== current.info.dev) throw new UserFacingError("锁文件已经变化，当前进程没有删除它。");
  await unlink(path);
}

/**
 * 以 wx 创建锁并写入当前 PID 和随机 token；失败只清理自己刚创建的同一文件。
 * 这里不删除已有锁，是否允许接管由 acquireLock 在恢复保护内决定。
 */
async function createLock(path: string, record: LockRecord): Promise<void> {
  const file = await open(path, "wx", 0o600);
  const info = await file.stat();
  try {
    await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    const current = await lstat(path).catch(() => undefined);
    if (current?.isFile() && current.ino === info.ino && current.dev === info.dev) await unlink(path).catch(() => {});
    throw error;
  } finally { await file.close(); }
}

/**
 * 获取整次写入期间持有的锁；死 PID 也必须由人显式选择恢复。
 * 接管先创建短暂的恢复保护文件，再原位改写旧锁，避免两个恢复者越过同一空档。
 * 异常留下的恢复保护不能自动清除：宁可提示检查，也不猜测另一个恢复者已经退出。
 */
async function acquireLock(path: string, recover: boolean): Promise<HeldLock> {
  const record = { pid: process.pid, token: randomUUID() };
  try { await createLock(path, record); }
  catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    const previous = await readLock(path);
    if (processMayExist(previous.record.pid)) throw new UserFacingError("会话仍被一个活进程占用，不能同时恢复或修改。");
    if (!recover) throw new UserFacingError("会话留有旧锁；确认工作区和进程后，使用 --recover 显式接管。");
    const recoveryPath = `${path}.recover`;
    try { await createLock(recoveryPath, record); }
    catch { throw new UserFacingError("已有恢复保护文件，请检查是否有其他恢复操作；程序不会自动删除它。"); }
    try {
      const current = await readLock(path);
      if (processMayExist(current.record.pid)) throw new UserFacingError("检查期间已有活进程占用会话，已停止接管。");
      const file = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await file.stat();
        if (!info.isFile() || info.ino !== current.info.ino || info.dev !== current.info.dev) throw new UserFacingError("锁文件在接管前发生变化，已停止接管。");
        await file.truncate(0);
        await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await file.sync();
      } finally { await file.close(); }
    } finally { await releaseLock(recoveryPath, record.token); }
  }
  return { release: () => releaseLock(path, record.token) };
}

/**
 * 用一个串行队列管理检查点和名称记录，两者共享序号与落盘完成边界。
 * 调用时复制数据；写入失败后封住所有后续追加，close 仍释放文件和当前锁。
 */
function makeWriter(id: string, path: string, file: FileHandle, lock: HeldLock, initialBytes: number, restored?: ReadSessionResult): SessionWriter {
  let sequence = restored?.seq ?? 0;
  let writtenBytes = initialBytes;
  let failure: unknown;
  let failed = false;
  let closing = false;
  // tail 始终被处理为 fulfilled；每次 save 自己的 Promise 仍保留真实写入结果。
  let tail: Promise<void> = Promise.resolve();
  let closed: Promise<void> | undefined;
  /**
   * 同步编码记录后接到 tail，真正写入时再检查大小和之前是否失败。
   * 这一入口同时服务保存与改名，避免相同 seq 或一行交错写入。
   */
  function append(type: "checkpoint" | "name", values: Record<string, unknown>): Promise<number> {
    if (closing) return Promise.reject(new UserFacingError("会话文件已经关闭或正在关闭。"));
    if (failed) return Promise.reject(failure);
    if (!Number.isSafeInteger(sequence + 1)) return Promise.reject(new UserFacingError("会话记录编号已达到限制，不能继续追加。"));
    const seq = ++sequence;
    let line: string;
    try { line = `${JSON.stringify({ version: 1, type, sessionId: id, seq, savedAt: new Date().toISOString(), ...values })}\n`; }
    catch (error) { failed = true; failure = error; return Promise.reject(error); }
    const pending = tail.then(async () => {
      if (failed) throw failure;
      try {
        const size = Buffer.byteLength(line);
        if (writtenBytes + size > MAX_SESSION_BYTES) throw new UserFacingError("会话文件将超过 64 MiB，已停止追加，请开启新会话。");
        await file.writeFile(line, "utf8");
        await file.sync();
        writtenBytes += size;
        return seq;
      } catch (error) { failed = true; failure = error; throw error; }
    });
    tail = pending.then(() => {}, () => {});
    return pending;
  }
  return { id, path, ...(restored ? { restored } : {}),
    /**
     * 调用时同步复制并编码一个完整检查点，再串行等待文件写入与 sync。
     * state 是当前会话白名单，reason 说明本次保存触发点；成功返回递增 seq。
     * 同一文件上不并发写入；任一写盘失败后，后续调用继续拒绝而不拼接潜在坏尾。
     */
    // [KEEP 来自 14.3] 同一序列保存文件恢复后的对话通知。
    save(state, reason) {
      try {
        if (!["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(reason)) throw new UserFacingError("不支持这个保存原因。");
        return append("checkpoint", { reason, state: validateSessionState(copySessionState(state)) });
      } catch (error) { return Promise.reject(error); }
    },
    /**
     * 名称记录与检查点串行保存，只改变显示名称，不替换最后状态或任务标记。
     * 先检查名称并去掉首尾空白；含控制字符或空名称时不产生记录。
     */
    rename(name) {
      try { return append("name", { name: validateSessionName(name) }); }
      catch (error) { return Promise.reject(error); }
    },
    /**
     * 封住新检查点，等待所有已排队保存，再关闭句柄。
     * 重复 close 复用同一 Promise；保存失败已由各次 save 报告，仍执行句柄关闭。
     * close 本身失败继续抛给入口，调用方不能把它说成正常完成。
     */
    close() {
      closing = true;
      closed ??= tail.then(async () => {
        let closingError: unknown;
        try { await file.close(); } catch (error) { closingError = error; }
        try { await lock.release(); } catch (error) { closingError ??= error; }
        if (closingError) throw new UserFacingError(`会话关闭或释放锁失败：${explainSessionError(closingError)}`);
      });
      return closed;
    },
  };
}

/**
 * 创建新会话并持锁，元数据 sync 完成后才交出保存入口。
 * 新头记录额外保存工作区真实路径，旧版只有 cwd 的文件仍由读取器兼容。
 */
// [KEEP 来自 14.1] 来源元数据与新 UUID 同时落盘，原会话不被打开写入。
export async function createSessionWriter(directory = DEFAULT_SESSION_DIRECTORY, parent?: { sessionId: string; seq: number }): Promise<SessionWriter> {
  if (parent) { sessionPath(parent.sessionId); if (!Number.isSafeInteger(parent.seq) || parent.seq < 0) throw new UserFacingError("分支来源序号无效。"); }
  const sessionDirectory = resolve(directory), id = randomUUID(), path = sessionPath(id, sessionDirectory);
  let lock: HeldLock;
  try {
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    lock = await acquireLock(`${path.slice(0, -6)}.lock`, false);
  } catch (error) { throw new UserFacingError(`无法准备会话目录或锁：${explainSessionError(error)}`); }
  let file: FileHandle | undefined;
  try {
    file = await open(path, "wx", 0o600);
    const line = `${JSON.stringify({ version: 1, type: "session", sessionId: id, createdAt: new Date().toISOString(), cwd: process.cwd(), workspace: await realpath(process.cwd()), ...(parent ? { parent } : {}) })}\n`;
    await file.writeFile(line, "utf8");
    await file.sync();
    return makeWriter(id, path, file, lock, Buffer.byteLength(line));
  } catch (error) {
    await file?.close().catch(() => {});
    await lock.release();
    throw new UserFacingError(`无法创建会话文件：${explainSessionError(error)}`);
  }
}

/**
 * 先占有旧会话的写入权，再重读所有记录；恢复采用的快照来自锁内检查。
 * 只有显式 recover 才允许处理未结束标记或截断未换行尾片，完整坏行始终拒绝。
 * 返回的 restored 是数据与警告，调用方仍须检查工作区并让用户决定下一步。
 */
export async function resumeSessionWriter(id: string, directory = DEFAULT_SESSION_DIRECTORY, recover = false): Promise<SessionWriter> {
  const path = sessionPath(id, directory);
  let lock: HeldLock;
  try { lock = await acquireLock(`${path.slice(0, -6)}.lock`, recover); }
  catch (error) { throw new UserFacingError(`无法取得会话写入权：${explainSessionError(error)}`); }
  let file: FileHandle | undefined;
  try {
    const restored = await readSession(id, directory);
    if ((restored.interrupted || restored.hasTrailingFragment) && !recover) throw new UserFacingError("会话有未结束任务或未完成尾片；请核对工作区和进程后使用 --recover。");
    const before = await lstat(path);
    file = await open(path, constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new UserFacingError("会话文件在恢复前发生变化，已停止恢复。");
    if (restored.hasTrailingFragment) { await file.truncate(restored.validBytes); await file.sync(); }
    return makeWriter(id, path, file, lock, restored.validBytes, restored);
  } catch (error) {
    await file?.close().catch(() => {});
    await lock.release();
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError(`无法恢复会话：${explainSessionError(error)}`);
  }
}

/**
 * 把存储结果变成人类界面可分别显示的反馈，保存失败不抛进模型任务。
 * 未注入 writer 时返回 undefined，保留旧章节与离线调用者的使用方式。
 * 成功反馈只在 sync 后产生；失败明确说明内存仍在、该文件不再追加。
 */
export async function saveSessionCheckpoint(writer: SessionWriter | undefined, state: SessionState, reason: CheckpointReason): Promise<SaveFeedback | undefined> {
  if (!writer) return undefined;
  try {
    const seq = await writer.save(state, reason);
    return { ok: true, message: `会话已保存：检查点 #${seq}（${writer.id}）` };
  } catch (error) {
    return { ok: false, message: `会话保存失败：${explainSessionError(error)}；当前内存仍保留，该文件已停止追加，后续模型任务需换新会话。` };
  }
}
