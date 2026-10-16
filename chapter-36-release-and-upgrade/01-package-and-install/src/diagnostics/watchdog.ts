/**
 * 36.1 安装包与补全 | [KEEP] diagnostics/watchdog.ts
 *
 * 学习目标：监督沉默时间，区分人类等待与未报告进展；停止请求不能代替完成确认。
 * 输入：毫秒上限与同一运行的事件；输出：只供运行层合并的AbortSignal。
 * 状态：审批/澄清等待期间暂停，最后一项等待结束重新计时；dispose清除计时器。
 * 本文件局部流程：进展 -> 重设计时；人类等待 -> 暂停；沉默超期 -> abort(UserFacingError)。
 * 失败：超期只发停止请求，runAgent仍await原任务；已完成文件与历史不回滚。
 * 观察：用户主动取消与无进展错误有不同最终状态，不能据此承诺远端副作用已撤销。
 */
// [KEEP 来自 34.3] 看门狗不使用Promise.race抢先返回，也不拥有子进程控制权。
import type { AgentEvent } from "../agent/events.js";
import { UserFacingError } from "../errors.js";

/**
 * 创建默认90秒的沉默监督器；允许本地测试注入更短期限。
 * 只有运行状态事件重置计时，等待用户时暂停；定时器不阻止Node自行退出。
 * 触发后不再重置，dispose幂等；调用方必须继续等待真正的运行Promise结束。
 */
export function createProgressWatchdog(timeoutMs = 90_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new UserFacingError("无进展上限必须为 1 至 3600000 毫秒。");
  }
  const controller = new AbortController(), waiting = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, humanWait = 0;
  /** 清除旧计时器，只有运行且不等人时重新开始一段沉默计时。 */
  function arm(): void {
    clearTimeout(timer);
    if (disposed || controller.signal.aborted || waiting.size) return;
    timer = setTimeout(() => controller.abort(new UserFacingError("任务长时间没有进展，已请求停止；已完成操作和历史保留，请核对诊断。")), timeoutMs);
    timer.unref();
  }
  /** 审批和ask_user按工具序号分别计数，防止并发等待中一项结束便提前恢复。 */
  function observe(event: AgentEvent): void {
    if (event.type === "approval_start") waiting.add(`approval:${event.sequence}`);
    if (event.type === "approval_finish") waiting.delete(`approval:${event.sequence}`);
    if (event.type === "tool_start" && event.call.name === "ask_user") waiting.add(`question:${event.sequence}`);
    if (event.type === "tool_finish") waiting.delete(`question:${event.sequence}`);
    if (event.type === "run_finish") { dispose(); return; }
    arm();
  }
  /**
   * 跟随真实人类回调的Promise暂停，覆盖父流不转发审批事件的只读子任务。
   * 每次等待有独立编号；并行审批一项结束时，其他等待仍保持暂停。
   */
  async function waitForHuman<T>(operation: () => Promise<T>): Promise<T> {
    const key = `handler:${++humanWait}`;
    waiting.add(key); arm();
    try { return await operation(); }
    finally { waiting.delete(key); arm(); }
  }
  /** 清除所有等待与计时，不取消已经完成的操作，也不报告任务完成。 */
  function dispose(): void { disposed = true; clearTimeout(timer); waiting.clear(); }
  arm();
  return { signal: controller.signal, observe, waitForHuman, dispose };
}
