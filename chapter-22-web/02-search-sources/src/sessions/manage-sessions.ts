/**
 * 22.2 显式搜索提供方与来源摘要 | [KEEP] sessions/manage-sessions.ts
 *
 * 学习目标：从可信记录生成列表、标题和 Markdown；管理动作不创建模型请求。
 * 输入：会话目录、搜索文字、明确的会话 ID 和可选导出路径。
 * 输出：摘要列表、追加的名称记录或只读 Markdown 副本。
 * 状态：命名复用独占 writer；读取与导出不改历史，不执行历史中的工具。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   列目录 -> 逐个 readSession -> 摘要 / 报告损坏文件 -> 搜索 -> 显示
 *   改名 -> resumeSessionWriter 拿锁 -> rename -> close 释放锁
 *   导出 -> readSession -> Markdown -> stdout / wx 新文件；已有目标拒绝覆盖
 */
import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, readSession, validateSessionName, type ReadSessionResult } from "./read-session.js";
import { resumeSessionWriter, explainSessionError } from "./save-session.js";

// [KEEP 来自 13.4] 摘要保留完整 ID；标题只是便于辨认的标签，不能代替身份。
export type SessionSummary = { id: string; name: string; updatedAt: string; cwd: string; messages: number; pending: number; interrupted: boolean };
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");

/** 顺序读取每个候选文件；一个损坏文件不让其他会话从列表消失。 */
export async function listSessions(directory = DEFAULT_SESSION_DIRECTORY, search = ""): Promise<{ sessions: SessionSummary[]; warnings: string[] }> {
  let entries;
  try { entries = await readdir(resolve(directory), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [], warnings: [] };
    throw new UserFacingError(`无法列出会话：${explainSessionError(error)}`);
  }
  const sessions: SessionSummary[] = [], warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.slice(0, -6);
    try {
      const record = await readSession(id, directory);
      const messages = record.state?.messages ?? [];
      const name = record.name ?? messages.find((message) => message.role === "user")?.content.split("\n")[0].slice(0, 60) ?? "未命名会话";
      const searchable = [id, name, record.header.cwd, ...messages.map((message) => message.content)].join("\n").toLocaleLowerCase();
      if (search && !searchable.includes(search.toLocaleLowerCase())) continue;
      sessions.push({ id, name: plain(name), updatedAt: record.updatedAt ?? record.header.createdAt, cwd: plain(record.header.cwd), messages: messages.length, pending: record.state?.pendingInputs.length ?? 0, interrupted: record.interrupted });
      warnings.push(...record.warnings.map((warning) => `${id}：${plain(warning)}`));
    } catch (error) { warnings.push(`${plain(entry.name)}：${error instanceof UserFacingError ? plain(error.message) : "无法读取，已跳过"}`); }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { sessions, warnings };
}

/** 改名追加一条事件，沿用锁与保存队列；不重写已有消息和工具结果。 */
export async function renameSession(id: string, name: string, directory?: string): Promise<number> {
  const title = validateSessionName(name);
  const writer = await resumeSessionWriter(id, directory);
  try { return await writer.rename(title); } finally { await writer.close(); }
}

/** 采用足够长的围栏，记录里的 Markdown 不会提前关闭代码块。 */
function block(text: string, language = "text"): string {
  const lengths = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...lengths.map((length) => length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}

/** 将验证后的一个快照投影为阅读副本，保留调用 ID 与结果，不伪装成可恢复文件。 */
export function sessionMarkdown(record: ReadSessionResult): string {
  const lines = [`# ${plain(record.name ?? "会话导出")}`, "", `会话 ID：${record.header.sessionId}`, "", `工作区：${plain(record.header.cwd)}`, "", "这是本地保存状态的阅读副本。工具文字不会被执行；项目文件和访问权限不在导出范围。", ""];
  if (record.interrupted) lines.push("> 上次任务没有留下结束记录；以下内容不能证明崩溃前的操作已经完成。", "");
  for (const warning of record.warnings) lines.push(`> ${plain(warning)}`, "");
  for (const message of record.state?.messages ?? []) {
    lines.push(`## ${message.role === "user" ? "用户" : message.role === "assistant" ? "Agent" : `工具 ${plain(message.toolCallId)} · ${message.isError ? "失败" : "已返回"}`}`, "", block(message.content), "");
    if (message.role === "assistant") for (const call of message.toolCalls ?? []) lines.push(`调用 ${plain(call.id)}：${plain(call.name)}`, "", block(call.arguments, "json"), "");
  }
  if (record.state) {
    lines.push("## 本地状态", "", `模式：${record.state.mode}；任务编号：${record.state.run}；下一补充编号：${record.state.nextInputId}。`, "");
    for (const task of record.state.tasks) lines.push(block(`${task.id} · ${task.status} · ${task.text}`), "");
    lines.push("## 尚未交付的补充", "", "这些文字保持原任务归属；导出不表示它们已经发送给模型。", "");
    for (const input of record.state.pendingInputs) lines.push(block(`#${input.id} → 任务 ${input.run}\n${input.text}`), "");
  }
  return lines.join("\n");
}

/** 默认交给 stdout；显式路径只创建新文件，避免覆盖已有笔记或符号链接。 */
export async function exportSession(id: string, directory?: string, destination?: string): Promise<string> {
  const markdown = sessionMarkdown(await readSession(id, directory));
  if (destination !== undefined) {
    if (!destination.trim()) throw new UserFacingError("--export-to 不能为空。");
    try { await writeFile(resolve(destination), markdown, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) { throw new UserFacingError(`无法导出会话（已有文件不会覆盖）：${explainSessionError(error)}`); }
  }
  return markdown;
}
