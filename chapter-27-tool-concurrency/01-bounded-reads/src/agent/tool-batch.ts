/**
 * 27.1 有界只读并发 | [NEW] agent/tool-batch.ts
 *
 * 学习目标：只让相邻本地只读调用共享有限容量，其他调用构成串行屏障。
 * 输入：带稳定 sequence/callID 的完整调用批、父取消信号、单项执行函数。
 * 输出：所有已启动工作收尾后返回；意外错误停止发放新工作，等同伴结束再抛出。
 * 本文件流程（全局见 agent-loop.ts）：
 *   queued -> 相邻只读段 / 单项屏障 -> 最多 N 个 running -> 终态 -> 下一段
 * 白名单不代表原子文件快照；外部进程仍可能改文件。Hooks 可执行脚本，启用时整批串行。
 */
import type { ToolCall } from "../tools/registry.js";

// [NEW 27.1] 新工具默认串行；load_skill 改已加载集合，必须先完成再读资源。
const PARALLEL_READS = new Set(["read_file", "glob", "grep", "read_tool_result", "read_job", "read_skill_resource"]);
export type BatchItem = { call: ToolCall; sequence: number };
export type ToolState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type BatchOptions = { concurrency?: number; serial?: boolean };
export const isParallelRead = (call: ToolCall): boolean => PARALLEL_READS.has(call.name);

/**
 * 只接受本地配置的 1..4 个槽；模型参数不能改变容量。
 * 非整数或超出范围时在调度前失败。
 */
export function batchConcurrency(value = 2): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) throw new Error("toolConcurrency 必须为 1..4 的整数");
  return value;
}

/**
 * 发放前检查取消；容量必须等执行函数真正 settle 才归还。
 * 当前相邻读取段收尾后才进入下一段或单项串行屏障。
 */
export async function runToolBatch(
  items: readonly BatchItem[], signal: AbortSignal,
  execute: (item: BatchItem, signal: AbortSignal) => Promise<boolean>,
  state: (item: BatchItem, state: ToolState) => void,
  options: BatchOptions = {},
): Promise<void> {
  const capacity = options.serial ? 1 : batchConcurrency(options.concurrency);
  for (const item of items) state(item, "queued");
  let firstError: unknown;
  let failed = false;
  for (let offset = 0; offset < items.length;) {
    if (failed || signal.aborted) break;
    const start = offset++;
    if (!options.serial && isParallelRead(items[start].call)) {
      while (offset < items.length && isParallelRead(items[offset].call)) offset += 1;
    }
    const segment = items.slice(start, offset);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(capacity, segment.length) }, async () => {
      while (!failed && !signal.aborted && cursor < segment.length) {
        const item = segment[cursor++];
        state(item, "running");
        try { state(item, await execute(item, signal) ? "succeeded" : "failed"); }
        catch (error) { if (!failed) firstError = error; failed = true; state(item, "cancelled"); }
      }
    }));
    if (failed || signal.aborted) {
      for (const item of segment.slice(cursor)) state(item, "cancelled");
      break;
    }
  }
  if (failed) throw firstError;
  signal.throwIfAborted();
}
