# save-session.ts

`chapter-13-session-persistence/01-save-session/src/sessions/save-session.ts`

<a href="./content/chapter-13-session-persistence/01-save-session/src/sessions/save-session.ts" download>下载原始文件</a>

```typescript
/**
 * 13.1 保存会话 | [NEW] sessions/save-session.ts
 *
 * 学习目标：把内存会话保存成版本明确、可逐行查看的 JSONL 检查点。
 * 输入：会话目录、模型消息、模式、清单和未交付补充；不接收模型连接配置或授权。
 * 输出：稳定会话 ID、新文件路径，以及写入并 sync 完成的检查点编号。
 * 状态：每次启动创建新文件；调用 save 时同步复制白名单，再按顺序写入。
 * 失败：append 或 sync 失败后停止追加，内存会话仍可继续；保存失败后，close 仍会尝试关闭句柄。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   create -> mkdir -> randomUUID -> open(wx) -> 写元数据、sync
 *   save(state) -> 立即投影、JSON.stringify -> 排到 tail -> writeFile(一行) -> sync -> 成功
 *                                                +-- 失败 -> 记住错误、停止该文件后续追加
 *   close -> 封住新 save -> 等 tail（失败也等）-> close 文件句柄
 *
 * JSONL 的换行只分隔记录，正文中的换行由 JSON 转义；显示事件不是模型消息。
 * 本节只写新会话，不读取、恢复或锁住旧文件，也不修复损坏尾行。
 * sync 是本次保存的完成边界，不承诺异常断电或设备故障下绝对恢复。
 */
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecutionMode, TaskItem } from "../agent/run-options.js";
import type { Message } from "../models/client.js";
import { UserFacingError } from "../errors.js";

// [NEW 13.1] 本文件以下实现均为本节新增。
export type CheckpointReason = "run_end" | "reset" | "mode" | "queue_change" | "exit";
export type SessionState = {
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
  save(state: SessionState, reason: CheckpointReason): Promise<number>;
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
function copySessionState(state: SessionState): SessionState {
  return {
    messages: state.messages.map((message): Message => {
      if (message.role === "tool") return { role: "tool", toolCallId: message.toolCallId, content: message.content, isError: message.isError };
      if (message.role === "user") return { role: "user", content: message.content };
      return { role: "assistant", content: message.content, ...(message.toolCalls ? {
        toolCalls: message.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      } : {}) };
    }),
    mode: state.mode,
    tasks: state.tasks.map((item) => ({ id: item.id, text: item.text, status: item.status })),
    pendingInputs: state.pendingInputs.map((entry) => ({ id: entry.id, text: entry.text, run: entry.run })),
    run: state.run,
    nextInputId: state.nextInputId,
  };
}

/**
 * 为本次进程创建一个独立会话文件，并返回串行保存与关闭入口。
 * directory 缺省为用户目录下的 .hello-my-agent/sessions，显式目录按当前 cwd 解析。
 * 元数据写入并 sync 后才返回；创建失败关闭已打开句柄并向调用方抛错。
 * wx 防止覆盖同名文件，权限限制新建目录和文件；这里没有跨进程锁或恢复逻辑。
 */
export async function createSessionWriter(directory = join(homedir(), ".hello-my-agent", "sessions")): Promise<SessionWriter> {
  const sessionDirectory = resolve(directory);
  const id = randomUUID();
  const path = join(sessionDirectory, `${id}.jsonl`);
  let file;
  try {
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    file = await open(path, "wx", 0o600);
  } catch (error) { throw new UserFacingError(`无法创建会话文件：${explainSessionError(error)}`); }
  try {
    await file.writeFile(`${JSON.stringify({ version: 1, type: "session", sessionId: id, createdAt: new Date().toISOString(), cwd: process.cwd() })}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close().catch(() => {});
    throw new UserFacingError(`无法初始化会话文件：${explainSessionError(error)}`);
  }
  let sequence = 0;
  let failure: unknown;
  let failed = false;
  let closing = false;
  // tail 始终被处理为 fulfilled；每次 save 自己的 Promise 仍保留真实写入结果。
  let tail: Promise<void> = Promise.resolve();
  let closed: Promise<void> | undefined;
  return {
    id,
    path,
    /**
     * 调用时同步复制并编码一个完整检查点，再串行等待文件写入与 sync。
     * state 是当前会话白名单，reason 说明本次保存触发点；成功返回递增 seq。
     * 同一文件上不并发写入；任一写盘失败后，后续调用继续拒绝而不拼接潜在坏尾。
     */
    save(state, reason) {
      if (closing) return Promise.reject(new UserFacingError("会话文件已经关闭或正在关闭。"));
      if (failed) return Promise.reject(failure);
      const seq = ++sequence;
      // 必须在排队前复制；不能等旧写入完成后才读取可能已改变的 state。
      let line: string;
      try {
        line = `${JSON.stringify({ version: 1, type: "checkpoint", sessionId: id, seq, savedAt: new Date().toISOString(), reason, state: copySessionState(state) })}\n`;
      } catch (error) { failed = true; failure = error; return Promise.reject(error); }
      const pending = tail.then(async () => {
        if (failed) throw failure;
        try {
          await file.writeFile(line, "utf8");
          await file.sync();
          return seq;
        } catch (error) {
          failed = true;
          failure = error;
          throw error;
        }
      });
      tail = pending.then(() => {}, () => {});
      return pending;
    },
    /**
     * 封住新检查点，等待所有已排队保存，再关闭句柄。
     * 重复 close 复用同一 Promise；保存失败已由各次 save 报告，仍执行句柄关闭。
     * close 本身失败继续抛给入口，调用方不能把它说成正常完成。
     */
    close() {
      closing = true;
      closed ??= tail.then(async () => {
        try { await file.close(); } catch (error) { throw new UserFacingError(`会话文件关闭失败：${explainSessionError(error)}`); }
      });
      return closed;
    },
  };
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
    return { ok: false, message: `会话保存失败：${explainSessionError(error)}；内存会话仍可继续，该文件已停止追加。` };
  }
}
```
