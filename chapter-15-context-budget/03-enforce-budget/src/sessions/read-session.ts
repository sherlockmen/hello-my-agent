/**
 * 15.3 发送前检查预算 | [KEEP] sessions/read-session.ts
 *
 * 学习目标：先检查文件内容，再把最后一个完整、可信的状态交给恢复入口。
 * 输入：会话 UUID 与保存目录；磁盘里的 JSON 仍是未知数据，不能直接当作 SessionState。
 * 输出：会话头、最后状态、记录序号、未结束标记和有效字节边界；不执行历史工具。
 * 状态：只读取，不修改文件；只有没有换行的最后一段可以作为未完成写入忽略。
 * 失败：中间坏行、未来版本、非法状态或符号链接都停止读取，原文件保持不变。
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import type { Message } from "../models/client.js";
import type { CheckpointReason, SessionState } from "./save-session.js";

// [KEEP 来自 13.2] 大小限制约束一次读取的内存；本章还没有增量索引或历史压缩。
export const MAX_SESSION_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SESSION_DIRECTORY = join(homedir(), ".hello-my-agent", "sessions");
// [KEEP 来自 14.1] 可选来源让旧记录继续可读。
export type SessionHeader = { version: 1; type: "session"; sessionId: string; createdAt: string; cwd: string; workspace?: string; parent?: { sessionId: string; seq: number } };
export type ReadSessionResult = {
  header: SessionHeader;
  state?: SessionState;
  seq: number;
  warnings: string[];
  interrupted: boolean;
  name?: string;
  lastReason?: CheckpointReason | "run_start";
  validBytes: number;
  hasTrailingFragment: boolean;
  updatedAt: string;
};

/** 只把 UUID 组合成目录内文件名，拒绝路径片段、扩展名和相对路径穿越。 */
export function sessionPath(id: string, directory = DEFAULT_SESSION_DIRECTORY): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new UserFacingError("会话 ID 必须是完整的小写 UUID，不能是文件路径。");
  }
  return join(resolve(directory), `${id}.jsonl`);
}

/** 检查一条 JSON 的对象形状，拒绝数组、null 和未约定的字段。 */
function objectWithKeys(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要对象");
  const object = value as Record<string, unknown>;
  if (required.some(key => !(key in object)) || Object.keys(object).some(key => !required.includes(key) && !optional.includes(key))) throw new Error("字段不符合记录格式");
  return object;
}

/** 检查不用于终端控制或路径解析的非空文字；保留原始正文，不改写历史。 */
function text(value: unknown, limit = MAX_SESSION_BYTES): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("文字为空或过长");
  return value;
}

/** 序号和队列编号只能使用可精确比较的整数，不能接受负数、小数或 NaN。 */
function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("编号不是有效整数");
  return value;
}

/** 名称只用于显示和搜索，长度有界，不接收终端控制字符。 */
export function validateSessionName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new UserFacingError("会话名称必须是 1 到 80 个字符的文字。");
  if (/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new UserFacingError("会话名称不能包含控制字符。");
  const name = value.trim();
  return name;
}

/**
 * 校验一份完整快照并重建白名单数据。
 * 工具结果必须紧跟自己的调用批次、逐一对应；这里只检查关系，不调用工具注册表。
 * 队列编号、任务归属和下一编号一起检查，避免恢复后发生编号碰撞或跨任务投递。
 */
export function validateSessionState(value: unknown): SessionState {
  const state = objectWithKeys(value, ["messages", "mode", "tasks", "pendingInputs", "run", "nextInputId"]);
  if (state.mode !== "plan" && state.mode !== "execute") throw new Error("未知模式");
  const run = integer(state.run, 0), nextInputId = integer(state.nextInputId, 1);
  if (!Array.isArray(state.messages) || !Array.isArray(state.tasks) || !Array.isArray(state.pendingInputs)) throw new Error("状态列表不是数组");
  let expected: string[] = [];
  const messages: Message[] = state.messages.map((value): Message => {
    const message = objectWithKeys(value, ["role", "content"], ["toolCalls", "toolCallId", "isError"]);
    if (typeof message.content !== "string") throw new Error("消息正文不是文字");
    if (message.role === "tool") {
      objectWithKeys(message, ["role", "content", "toolCallId", "isError"]);
      if (!expected.length || message.toolCallId !== expected.shift() || typeof message.isError !== "boolean") throw new Error("工具调用与结果不配对");
      return { role: "tool", content: message.content, toolCallId: message.toolCallId as string, isError: message.isError };
    }
    if (expected.length) throw new Error("工具批次缺少结果");
    if (message.role === "user") {
      objectWithKeys(message, ["role", "content"]);
      text(message.content);
      return { role: "user", content: message.content };
    }
    if (message.role !== "assistant") throw new Error("未知消息角色");
    objectWithKeys(message, ["role", "content"], ["toolCalls"]);
    if (message.toolCalls === undefined) return { role: "assistant", content: message.content };
    if (!Array.isArray(message.toolCalls)) throw new Error("工具调用不是数组");
    const toolCalls = message.toolCalls.map(value => {
      const call = objectWithKeys(value, ["id", "name", "arguments"]);
      const id = text(call.id), name = text(call.name);
      if (typeof call.arguments !== "string") throw new Error("工具参数不是文字");
      const args: unknown = JSON.parse(call.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数不是对象");
      return { id, name, arguments: call.arguments };
    });
    expected = toolCalls.map(call => call.id);
    if (new Set(expected).size !== expected.length) throw new Error("同批工具 ID 重复");
    return { role: "assistant", content: message.content, toolCalls };
  });
  if (expected.length) throw new Error("工具批次缺少结果");
  if (state.tasks.length > 8 || state.pendingInputs.length > 20) throw new Error("状态列表超过限制");
  const taskIds = new Set<string>();
  let working = 0;
  const tasks = state.tasks.map((value): SessionState["tasks"][number] => {
    const item = objectWithKeys(value, ["id", "text", "status"]);
    const id = text(item.id, 80), description = text(item.text, 200);
    if (id !== id.trim() || taskIds.has(id)) throw new Error("任务 ID 重复或包含首尾空白");
    taskIds.add(id);
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") throw new Error("未知任务状态");
    if (item.status === "in_progress" && ++working > 1) throw new Error("多个任务同时进行中");
    return { id, text: description, status: item.status };
  });
  let previousId = 0;
  const pendingInputs = state.pendingInputs.map(value => {
    const entry = objectWithKeys(value, ["id", "text", "run"]);
    const id = integer(entry.id, 1), owner = integer(entry.run, 1), content = text(entry.text, 32_000);
    if (id <= previousId || id >= nextInputId || owner > run) throw new Error("队列编号或所属任务不符合计数");
    previousId = id;
    return { id, text: content, run: owner };
  });
  return { messages, mode: state.mode, tasks, pendingInputs, run, nextInputId };
}

/**
 * 逐行检查指定会话，返回最后一个完整检查点和有效前缀的字节长度。
 * 首行必须是对应 UUID 的版本 1 会话头；完整坏行不能略过，末尾未换行片段不参与恢复。
 * 使用只读且不跟随符号链接的句柄，最多读取 64 MiB；失败不会修改原文件。
 */
export async function readSession(id: string, directory?: string): Promise<ReadSessionResult> {
  const path = sessionPath(id, directory);
  let bytes: Buffer;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new UserFacingError("会话文件必须是普通文件，不能是符号链接。");
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new UserFacingError("会话文件在读取前发生变化，请重试。");
      if (info.size > MAX_SESSION_BYTES) throw new UserFacingError("会话文件超过 64 MiB，本章暂不读取超大历史。");
      // 有界 read 防止另一个进程持续追加时 readFile 超出启动时检查的大小。
      bytes = Buffer.alloc(Math.min(info.size + 1, MAX_SESSION_BYTES + 1));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      bytes = bytes.subarray(0, offset);
      if (bytes.length > MAX_SESSION_BYTES) throw new UserFacingError("会话文件超过 64 MiB，本章暂不读取超大历史。");
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("无法读取会话文件，请检查 ID、目录和访问权限。");
  }
  const validBytes = bytes.lastIndexOf(10) + 1;
  if (!validBytes) throw new UserFacingError("会话头尚未完整写入，无法读取。");
  let contents: string;
  try { contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, validBytes)); }
  catch { throw new UserFacingError("完整记录含有无效 UTF-8，无法读取。"); }
  const lines = contents.slice(0, -1).split("\n");
  let header: SessionHeader | undefined, state: SessionState | undefined, seq = 0;
  let interrupted = false, name: string | undefined, lastReason: ReadSessionResult["lastReason"], updatedAt = "";
  for (let index = 0; index < lines.length; index++) {
    try {
      const record = objectWithKeys(JSON.parse(lines[index]), ["version", "type", "sessionId"], index === 0
        ? ["createdAt", "cwd", "workspace", "parent"] : ["seq", "savedAt", "reason", "state", "name"]);
      if (record.version !== 1) throw new Error("不支持这个记录版本");
      if (record.sessionId !== id) throw new Error("会话 ID 不一致");
      if (index === 0) {
        objectWithKeys(record, ["version", "type", "sessionId", "createdAt", "cwd"], ["workspace", "parent"]);
        if (record.type !== "session" || !Number.isFinite(Date.parse(text(record.createdAt))) || !isAbsolute(text(record.cwd))) throw new Error("会话头无效");
        if (record.workspace !== undefined && !isAbsolute(text(record.workspace))) throw new Error("工作区路径无效");
        // [KEEP 来自 14.1] 来源只描述分支起点，不赋予新文件改写源会话的权限。
        if (record.parent !== undefined) {
          const parent = objectWithKeys(record.parent, ["sessionId", "seq"]);
          sessionPath(text(parent.sessionId)); integer(parent.seq, 0);
          if (parent.sessionId === id) throw new Error("分支不能指向自身");
        }
        header = { version: 1, type: "session", sessionId: id, createdAt: record.createdAt as string, cwd: record.cwd as string,
          ...(record.workspace !== undefined ? { workspace: record.workspace as string } : {}),
          ...(record.parent !== undefined ? { parent: record.parent as { sessionId: string; seq: number } } : {}) };
        updatedAt = header.createdAt;
        continue;
      }
      if (integer(record.seq, 1) !== seq + 1 || !Number.isFinite(Date.parse(text(record.savedAt)))) throw new Error("记录序号或时间无效");
      if (record.type === "name") {
        objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "name"]);
        name = validateSessionName(record.name);
      } else {
        objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "reason", "state"]);
        // [KEEP 来自 14.3] 文件恢复通知不倒退消息历史，也不标记新的模型任务。
        if (record.type !== "checkpoint" || !["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(record.reason as string)) throw new Error("未知检查点类型");
        const nextState = validateSessionState(record.state);
        if (state && (nextState.run < state.run || nextState.nextInputId < state.nextInputId)) throw new Error("会话计数不能倒退");
        state = nextState;
        lastReason = record.reason as ReadSessionResult["lastReason"];
        if (record.reason === "run_start") interrupted = true;
        if (record.reason === "run_end" || record.reason === "exit") interrupted = false;
      }
      updatedAt = record.savedAt as string;
      seq++;
    } catch {
      throw new UserFacingError(`会话第 ${index + 1} 行不是支持的完整记录（版本、字段、编号或工具配对有误），已停止读取，原文件未修改。`);
    }
  }
  const hasTrailingFragment = validBytes < bytes.length;
  const warnings = hasTrailingFragment ? ["末尾有未换行片段，已忽略该片段；前面的完整记录仍可查看，原文件未修改。"] : [];
  if (interrupted) warnings.push("最后启动的任务没有结束记录，可能已有未记录的操作；继续前请核对工作区和进程，不要直接重做工具。");
  return { header: header!, state, seq, warnings, interrupted, name, lastReason, validBytes, hasTrailingFragment, updatedAt };
}
