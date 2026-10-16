/**
 * 29.2 依赖与失联回收 | [KEEP] agent/tool-batch.ts
 *
 * 学习目标：只让相邻本地只读调用共享有限容量，其他调用构成串行屏障。
 * 输入：带稳定 sequence/callID 的完整调用批、父取消信号、单项执行函数。
 * 输出：所有已启动工作收尾后返回；意外错误停止发放新工作，等同伴结束再抛出。
 * 本文件流程（全局见 agent-loop.ts）：
 *   queued -> 相邻只读段 / 单项屏障 -> 最多 N 个 running -> 终态 -> 下一段
 * 白名单不代表原子文件快照；外部进程仍可能改文件。Hooks 可执行脚本，启用时整批串行。
 */
import type { ToolCall } from "../tools/registry.js";

// [KEEP 来自 27.1] 新工具默认串行；load_skill 改已加载集合，必须先完成再读资源。
const PARALLEL_READS = new Set(["read_file", "glob", "grep", "read_tool_result", "read_job", "read_skill_resource"]);
export type BatchItem = { call: ToolCall; sequence: number };
// [KEEP 来自 27.3] 屏障摘要按调用身份返回；界面完成顺序不改变下一次模型消息配对。
export type BatchObservation = BatchItem & { state: ToolState; started: boolean };
/**
 * [KEEP 来自 27.3] 整批入队前校验原调用身份，禁止空 ID 或同批重复 ID。
 * 校验失败时不发排队事件，也不启动任何真实操作。
 */
export function validateBatch(items: readonly BatchItem[]): void {
  const ids = new Set<string>();
  for (const { call } of items) {
    if (!call.id.trim() || ids.has(call.id)) throw new Error("工具批调用ID必须非空且唯一");
    ids.add(call.id);
  }
}
// [KEEP 来自 27.2] 超时的两种终态分别说明在队列中、还是开始执行后超期。
export type ToolState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "queue_timeout" | "execution_timeout";
export type BatchFailure = { state: "cancelled" | "queue_timeout" | "execution_timeout"; started: boolean; message: string };
export type BatchOptions = { concurrency?: number; serial?: boolean;
  queueTimeoutMs?: number; executionTimeoutMs?: number;
  onFailure?: (item: BatchItem, failure: BatchFailure) => void;
};
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
 * [KEEP 来自 27.2] 排队与执行使用两只独立时钟，范围由本地控制。
 * 省略时使用各自默认值；无效期限在调用入队前失败。
 */
function deadline(value: number | undefined, fallback: number): number {
  const ms = value ?? fallback;
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 60_000) throw new Error("工具期限必须为 1..60000 毫秒的整数");
  return ms;
}

/**
 * [KEEP 来自 27.2] 超期只发出停止请求，始终 await 执行函数 settle 后归还容量。
 * fs 的 realpath/stat/readFile 请求不能强杀，可能超过期限后才返回；本调度器不会提前释放槽。
 * 只读白名单才有期限，其权限/审批等待也计入领槽后的执行期限。
 * 非白名单调用沿用原信号与语义，远端效果不能撤回。
 */
export async function runToolBatch(
  items: readonly BatchItem[], signal: AbortSignal,
  execute: (item: BatchItem, signal: AbortSignal) => Promise<boolean>,
  state: (item: BatchItem, state: ToolState) => void,
  options: BatchOptions = {},
): Promise<BatchObservation[]> {
  // [KEEP 来自 27.3] 在任何排队事件和真实操作前拒绝无法配对的调用。
  validateBatch(items);
  const started = new Set<string>();
  const capacity = options.serial ? 1 : batchConcurrency(options.concurrency);
  const queueMs = deadline(options.queueTimeoutMs, 10_000), executionMs = deadline(options.executionTimeoutMs, 15_000);
  const batch = new AbortController();
  const cancel = () => batch.abort(signal.reason);
  if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
  const status = new Map(items.map(item => [item, "queued" as ToolState]));
  const queueTimers = new Map<BatchItem, ReturnType<typeof setTimeout>>();
  const change = (item: BatchItem, next: ToolState) => { status.set(item, next); state(item, next); };
  const fail = (item: BatchItem, failure: BatchFailure) => { options.onFailure?.(item, failure); change(item, failure.state); };
  let firstError: unknown, failed = false;
  try {
    for (const item of items) {
      state(item, "queued");
      if (isParallelRead(item.call)) queueTimers.set(item, setTimeout(() => {
        if (status.get(item) === "queued") fail(item, { state: "queue_timeout", started: false, message: "排队期限已到；该调用没有启动。" });
      }, queueMs));
    }
    for (let offset = 0; offset < items.length;) {
      if (batch.signal.aborted) break;
      const start = offset++;
      if (!options.serial && isParallelRead(items[start].call)) {
        while (offset < items.length && isParallelRead(items[offset].call)) offset += 1;
      }
      const segment = items.slice(start, offset);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(capacity, segment.length) }, async () => {
        while (!batch.signal.aborted && cursor < segment.length) {
          const item = segment[cursor++];
          if (status.get(item) !== "queued") continue;
          clearTimeout(queueTimers.get(item));
          const own = new AbortController();
          const abort = () => own.abort(batch.signal.reason);
          batch.signal.addEventListener("abort", abort, { once: true });
          let timedOut = false;
          // [KEEP 来自 27.2] 执行时钟从真正领槽起算，超时不以 Promise.race 提前腾槽。
          const timer = isParallelRead(item.call) ? setTimeout(() => {
            timedOut = true; own.abort(new Error("只读工具执行期限已到"));
          }, executionMs) : undefined;
          // [KEEP 来自 27.3] 记录领过槽的身份，排队超时不能误报已开始。
          started.add(item.call.id);
          change(item, "running");
          try {
            const succeeded = await execute(item, own.signal);
            if (timedOut) fail(item, { state: "execution_timeout", started: true, message: "执行期限已到；底层操作已返回并完成本地收尾，容量现已归还。" });
            else if (batch.signal.aborted) fail(item, { state: "cancelled", started: true, message: "本轮已中断；底层操作已返回，已执行的效果不会自动撤销。" });
            else change(item, succeeded ? "succeeded" : "failed");
          } catch (error) {
            if (timedOut) fail(item, { state: "execution_timeout", started: true, message: "执行期限已到；停止请求后已等待底层收尾，容量现已归还。" });
            else if (batch.signal.aborted) fail(item, { state: "cancelled", started: true, message: "本轮已中断；停止请求后已等待底层返回，可能已发生的效果需核实。" });
            else {
              if (!failed) { firstError = error; failed = true; }
              fail(item, { state: "cancelled", started: true, message: "工具异常中断；已等待执行函数返回。" });
              batch.abort(error);
            }
          } finally {
            clearTimeout(timer); batch.signal.removeEventListener("abort", abort);
          }
        }
      }));
    }
    // [KEEP 来自 27.2] 未发放的调用也有终态；父取消必须等待所有已启动工作收尾。
    for (const item of items) if (status.get(item) === "queued") fail(item, { state: "cancelled", started: false, message: "本轮在该工具启动前中断，这个调用未执行。" });
    if (failed) throw firstError;
    signal.throwIfAborted();
    // [KEEP 来自 27.3] 这是整批结果屏障；不是先完成一项就请求一次模型。
    return items.map(item => ({ ...item, state: status.get(item)!, started: started.has(item.call.id) }));
  } finally {
    for (const timer of queueTimers.values()) clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
