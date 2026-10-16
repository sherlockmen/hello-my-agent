/**
 * 36.2 发布门禁 | [KEEP] diagnostics/logger.ts
 *
 * 学习目标：从富事件中只提取诊断需要的编号、状态、耗时和数量。
 * 输入：本轮本地 UUID、事件，以及可选日志目录；输出：JSONL 与最终保存状态。
 * 状态：计时和计数只属于本轮；任何磁盘错误只降低 complete，不改变任务结果。
 * 本文件局部流程：创建独占文件 -> 白名单投影 -> 有界追加 -> 最终记录 -> 关闭。
 * 分支：增量不落盘；普通记录超限停止追加；失败不抛出或复制原始错误。
 * 观察：日志没有提示词、工具参数、正文、路径或远端错误；失败仍保留原任务成果。
 */
// [KEEP 来自 34.1] 不序列化原始事件，文件只接收本地生成的白名单对象。
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../agent/events.js";

export type RunDiagnostics = { runId: string; path?: string; complete: boolean };
type Fields = Record<string, string | number | boolean | null>;
const MAX_RECORDS = 10_000;

/**
 * 提取数字和封闭枚举；不保留远端文本、工具名或原始调用 ID。
 * 未列出的事件只记录种类；text_delta 连种类也不逐片记录，避免长输出膨胀。
 */
function project(event: AgentEvent): Fields {
  const data: Fields = { event: event.type };
  if ("call" in event && typeof event.call === "number") data.call = event.call;
  if ("sequence" in event) data.toolSequence = event.sequence;
  if ("outcome" in event) data.outcome = event.outcome;
  // [KEEP 来自 34.2] 白名单只留重试数字和封闭类别，不记录原始错误。
  if (event.type === "model_retry") { data.attempt = event.attempt; data.delayMs = event.delayMs; data.kind = event.kind; }
  if (event.type === "model_start") data.contextMessages = event.contextMessages;
  if (event.type === "model_finish") {
    data.finishReason = event.finishReason;
    data.toolRequests = event.toolRequests;
    data.textChars = event.text.length;
  }
  if (event.type === "model_usage") {
    data.inputTokens = event.inputTokens; data.outputTokens = event.outputTokens;
    data.cachedInputTokens = event.cachedInputTokens ?? null;
    data.cacheWriteTokens = event.cacheWriteTokens ?? null;
  }
  if (event.type === "tool_finish" && event.outcome === "success") {
    data.contentChars = event.result.content.length;
    data.isError = Boolean(event.result.isError);
    if (event.result.metadata.kind === "run_command") {
      data.exitCode = event.result.metadata.exitCode;
      if (event.result.metadata.stopReason) data.stopReason = event.result.metadata.stopReason;
    }
  }
  if (event.type === "tool_batch_finish") {
    data.results = event.results; data.interrupted = event.interrupted;
  }
  return data;
}

/**
 * 打开本轮诊断文件并返回同步的小记录写入器，创建失败也返回可用的空写入器。
 * runId 由运行层生成 UUID；文件独占创建且权限0600，日志目录可供隔离测试注入。
 * 普通记录上限10,000，结束记录另有一个位置；finish等待本地写入关闭后报告状态。
 * 同步记录不等于事务或fsync；崩溃掉电仍可能缺少尾部，日志也不恢复任务执行权。
 */
export function openRunLog(runId: string, directory = join(homedir(), ".hello-my-agent", "logs")) {
  const start = performance.now(), starts = new Map<string, number>();
  let fd: number | undefined, path: string | undefined, complete = true, sequence = 0, finished = false;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    path = join(directory, `${runId}.jsonl`);
    fd = openSync(path, "wx", 0o600);
  } catch { path = undefined; complete = false; }

  /** 追加投影后的单行，写盘错误只标记诊断不完整，绝不抛给任务。 */
  function record(event: AgentEvent): void {
    if (finished || event.type === "text_delta") return;
    const elapsedMs = Math.round(performance.now() - start);
    const key = event.type.startsWith("model_") && "call" in event ? `model:${event.call}`
      : "sequence" in event ? `tool:${event.sequence}` : undefined;
    if (key && (event.type === "model_start" || event.type === "tool_start")) starts.set(key, elapsedMs);
    const fields = project(event);
    if (key && (event.type === "model_finish" || event.type === "tool_finish") && starts.has(key)) {
      fields.durationMs = elapsedMs - starts.get(key)!; starts.delete(key);
    }
    if (event.type !== "run_finish" && sequence >= MAX_RECORDS) { complete = false; return; }
    if (event.type === "run_finish") fields.logComplete = complete;
    const line = JSON.stringify({ version: 1, runId, sequence: ++sequence, elapsedMs, ...fields }) + "\n";
    if (fd !== undefined) {
      try {
        const bytes = Buffer.from(line);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error("日志写入没有推进");
          offset += written;
        }
      } catch { complete = false; }
    }
  }

  /** 结束记录落盘后关闭句柄，返回真实保存状态；重复finish不重复写入。 */
  function finish(event: Extract<AgentEvent, { type: "run_finish" }>): RunDiagnostics {
    if (!finished) {
      record(event); finished = true;
      if (fd !== undefined) { try { closeSync(fd); } catch { complete = false; } }
    }
    return { runId, ...(path ? { path } : {}), complete };
  }
  return { record, finish };
}
