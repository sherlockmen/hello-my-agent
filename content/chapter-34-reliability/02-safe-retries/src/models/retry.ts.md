# retry.ts

`chapter-34-reliability/02-safe-retries/src/models/retry.ts`

<a href="./content/chapter-34-reliability/02-safe-retries/src/models/retry.ts" download>下载原始文件</a>

```typescript
/**
 * 34.2 只重试可以安全重发的请求 | [NEW] models/retry.ts
 *
 * 学习目标：把重试限制为一次模型传输，不接触工具、历史或审批。
 * 输入：请求闭包、同一个总期限信号、仍可重发的判断与安全观察回调。
 * 输出：完整结果和尝试次数；认证、请求、未知、本地错误及已交付文字不重试。
 * 本文件局部流程：尝试 -> 成功返回；失败分类 -> 可重发且未满3次？-> 可取消退避 -> 重试。
 * 状态：等待也接收取消；失败保留原原因；不承诺远端恰好处理一次或免于重复计费。
 * 观察：第2/3次尝试仍属于同一个模型决策，只有完整结果才能进入后续工具流程。
 */
// [NEW 34.2] SDK内部重试仍关闭；本函数是唯一显式重试层。
import { setTimeout as delay } from "node:timers/promises";
import { UserFacingError } from "../errors.js";
import { classifyModelError, type ModelErrorKind } from "./model-errors.js";

export type RetryNotice = { attempt: number; delayMs: number; kind: ModelErrorKind };

/**
 * 最多尝试三次；500ms基数按2倍增长，再加入0至同等基数的抖动。
 * shouldRetry由调用者判断是否已经显示文字；signal同时约束请求和等待。
 * settings只供本地测试缩短退避和固定随机数，模型输入不能控制策略。
 * 不解析Retry-After；回调故障不改变请求结果，取消则抛出signal原始reason。
 */
export async function withModelRetry<T>(
  operation: () => Promise<T>, signal: AbortSignal, shouldRetry: () => boolean,
  onRetry?: (notice: RetryNotice) => void,
  settings: { baseDelayMs?: number; random?: () => number } = {},
): Promise<{ result: T; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await operation();
      signal.throwIfAborted();
      return { result, attempts: attempt };
    } catch (error) {
      signal.throwIfAborted();
      const kind = classifyModelError(error);
      if (attempt >= 3 || error instanceof UserFacingError || !shouldRetry()
        || !["rate_limit", "unavailable", "connection"].includes(kind)) throw error;
      const base = (settings.baseDelayMs ?? 500) * 2 ** (attempt - 1);
      const delayMs = Math.round(base * (1 + (settings.random ?? Math.random)()));
      try { onRetry?.({ attempt: attempt + 1, delayMs, kind }); } catch { /* 观察故障不产生新决策。 */ }
      try { await delay(delayMs, undefined, { signal }); }
      catch (waitingError) { signal.throwIfAborted(); throw waitingError; }
    }
  }
}
```
