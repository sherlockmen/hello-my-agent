/**
 * 21.3 连接状态取消与关闭 | [KEEP] sessions/fork-session.ts
 * 学习目标：复制上下文到新身份，原会话字节不变。
 * 输入：来源 ID 与会话目录；输出：持锁的新 writer 和复制后的状态。
 * 状态：只复制最后完整状态；不执行工具，不复制文件检查点或授权。
 * 失败：来源占用、中断、坏尾或工作区不同都拒绝；源文件保持原样。
 */
import { realpath } from "node:fs/promises";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, readSession } from "./read-session.js";
import { createSessionWriter, resumeSessionWriter, type SessionWriter } from "./save-session.js";

// [KEEP 来自 14.1] 本文件以下实现均为本节新增。
/** 锁住来源后读取最后有效状态，新建独立身份并复制状态；无工具重放。 */
export async function forkSessionWriter(id: string, directory = DEFAULT_SESSION_DIRECTORY): Promise<SessionWriter> {
  // 来源也拿写入锁，但只读状态后关闭；不追加、不截断、不清理坏尾。
  const sourceWriter = await resumeSessionWriter(id, directory);
  try {
  const source = sourceWriter.restored!;
  if ((source.header.workspace ?? await realpath(source.header.cwd)) !== await realpath(process.cwd())) throw new UserFacingError("分支来源属于另一个工作区，请先进入来源目录。");
  const writer = await createSessionWriter(directory, { sessionId: id, seq: source.seq });
  try {
    if (source.state) await writer.save(source.state, "exit");
    const restored = await readSession(writer.id, directory);
    return { ...writer, restored };
  } catch (error) { await writer.close(); throw error; }
  } finally { await sourceWriter.close(); }
}
