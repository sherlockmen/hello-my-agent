/**
 * 11.5 按终端列宽排版 | [KEEP 来自 10.4] ui/input.ts
 *
 * 学习目标：让取消解除当前的输入等待，同时保留终端给下一轮使用。
 * 输入：readline 的 line / close 事件，以及可选的单轮取消信号。
 * 输出：read 返回一行或 EOF；取消则拒绝本次 Promise，不关闭 readline。
 * 状态：取消只解除当前等待；clear 丢弃排队行，dispose 清理本文件监听，不替调用方关闭终端。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] line -> 有等待者？-- 是 -> 清理取消监听 -> 交给等待者
 *                           +-- 否 -> 放入队列
 *   read -> 已取消或已有等待者？-- 是 -> 抛错
 *                                +-- 否 -> 队列有行？-- 是 -> 取出一行
 *                                                     +-- 否 -> 已关闭？-- 是 -> EOF
 *                                                                      +-- 否 -> 等待
 *   等待 -> line -> 返回一行 / close -> EOF / abort -> 移除等待者并拒绝
 *   clear -> 丢弃排队行；dispose -> 结束等待并移除本文件监听
 *
 * [KEEP] 表示沿用 08.3 已建立的输入读取器。聊天和审批只在轮到自己时调用 read，不能并行争抢输入。
 * 取消先清空 pending，再拒绝 Promise；下一次 read 因此不会留下旧审批等待者。
 * 输入队列只属于当前终端，没有持久化；dispose 不替调用方关闭终端。
 * 运行观察：审批时 Ctrl+C 后，新输入会被下一轮聊天读取，不会变成旧审批的答案。
 */
import type { Interface } from "node:readline";

// [KEEP 来自 08.3] 本文件以下实现沿用 08.3。
/**
 * 为一个 readline 输入建立可以取消的单消费者读取入口。
 *
 * - 输入：调用方创建的 readline Interface；本函数立即订阅 line 和 close，保存提前到达的行。
 * - 输出：read 按顺序返回一行，关闭且队列已空时返回 EOF；clear 丢弃队列，dispose 清理监听。
 * - 等待方式：队列没有行时才保存一个 pending，line、close 或 abort 都会先解除它再结束等待。
 * - 失败方式：信号已取消或同时发起第二个读取时抛错；等待期间取消则以 signal.reason 拒绝 Promise。
 * - 职责边界：取消一个 read 不关闭终端；dispose 结束本地等待，readline 本身仍由创建者关闭。
 */
export function createLineReader(input: Interface) {
  const queue: string[] = [];
  let closed = false;
  let pending: { resolve: (value: IteratorResult<string>) => void; reject: (reason: unknown) => void; cleanup: () => void } | undefined;
  // line 只交给当前等待者；没有等待者时排队，保留提前送达的管道输入。
  const onLine = (value: string) => {
    if (!pending) { queue.push(value); return; }
    const waiter = pending;
    pending = undefined;
    waiter.cleanup();
    waiter.resolve({ value, done: false });
  };
  // EOF 结束当前等待；已经排队的行仍可以被后续 read 取完。
  const onClose = () => {
    closed = true;
    if (!pending) return;
    const waiter = pending;
    pending = undefined;
    waiter.cleanup();
    waiter.resolve({ value: undefined, done: true });
  };
  input.on("line", onLine);
  input.on("close", onClose);
  return {
    read(signal?: AbortSignal): Promise<IteratorResult<string>> {
      signal?.throwIfAborted();
      if (pending) throw new Error("同一终端只能有一个输入等待者。");
      if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => {
        // 先移除旧等待者，再拒绝 Promise，下一次 read 才能安全接管输入。
        const abort = () => {
          pending = undefined;
          signal?.removeEventListener("abort", abort);
          reject(signal?.reason);
        };
        pending = { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) };
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    clear() { queue.length = 0; },
    dispose() { onClose(); input.off("line", onLine); input.off("close", onClose); },
  };
}
