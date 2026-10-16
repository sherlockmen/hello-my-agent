# runner.ts

`chapter-29-shared-tasks/01-claim-and-lease/src/collaboration/runner.ts`

<a href="./content/chapter-29-shared-tasks/01-claim-and-lease/src/collaboration/runner.ts" download>下载原始文件</a>

```typescript
/**
 * 29.1 认领与租约 | [NEW] collaboration/runner.ts
 * 学习目标：让固定本地worker实际运行只读子会话，并等清理后提交或开放重领。
 * 输入：当前Model、唯一协调者、父取消和可信运行选项；不接收模型生成的worker权限。
 * 输出：任务快照；父取消等所有子Promise结束后继续向外抛出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   锁批次 -> 两个worker各自claim -> runSubagent -> 等子检查点/close -> finish -> 再claim
 *   超期/父取消 -> stopping + abort -> 仍await子Promise -> settleStopped -> 重试或取消
 * 观察：同时最多两个只读worker；abort尚未完成时同一任务仍不可认领。
 */
import { emitAgentEvent, type AgentObserver } from "../agent/events.js";
import type { Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { runSubagent } from "../subagents/runner.js";
import { SharedCoordinator, type WorkerId, type WorkerLease } from "./coordinator.js";

// [NEW 29.1] 本文件以下实现均为本节新增。
export type SharedRunOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver };
/**
 * 用固定worker实际调度只读子循环，单项失败保存在登记表。
 * 输入为唯一协调者、本地选项与父信号；输出是所有worker收尾后的防御性快照。
 * 父取消等两个worker及子检查点关闭后抛出；内部失败也不提前放掉另一worker。
 */
export async function runSharedTasks(model: Model, coordinator: SharedCoordinator, signal: AbortSignal, options: SharedRunOptions = {}) {
  signal.throwIfAborted(); coordinator.beginRun();
  /**
   * 只发本地状态，模型总结和消息正文不能冒充调度事件。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  const notify = (lease: WorkerLease) => {
    const task = coordinator.list().find(task => task.id === lease.taskId)!;
    emitAgentEvent(options.observer, { type: "shared_task_state", taskId: task.id, workerId: lease.workerId, token: lease.token, state: task.state, detail: task.error ?? `${task.role}；第${task.attempts}次认领` });
  };
  /**
   * 每个固定身份串行认领；下一次认领必定晚于旧子会话完整返回。
   * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
   */
  const worker = async (workerId: WorkerId) => {
    while (!signal.aborted) {
      const lease = coordinator.claim(workerId); if (!lease) return;
      notify(lease);
      const controller = new AbortController();
      /**
       * 先锁为stopping再abort，随后仍由下面的await等待子会话清理。
       * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
       */
      const stop = (reason: "expired" | "cancelled") => {
        const task = coordinator.list().find(task => task.id === lease.taskId)!;
        if (task.state !== "running") return;
        coordinator.stop(lease, reason); notify(lease); controller.abort(new Error(reason === "expired" ? "共享任务租约过期" : "父任务取消"));
      };
      const onAbort = () => stop("cancelled"); signal.addEventListener("abort", onAbort, { once: true });
      // [NEW 29.1] 只观察期限，不在定时器中直接开放认领。
      const timer = setInterval(() => { if (coordinator.expired(lease)) stop("expired"); }, Math.max(10, Math.floor(coordinator.leaseMs / 4)));
      try {
        if (signal.aborted) onAbort();
        const task = coordinator.current(lease, true);

        const result = await runSubagent(model, JSON.stringify({ role: task.role, task: task.task }), controller.signal, {
          parentSessionId: options.parentSessionId, sessionDirectory: options.sessionDirectory, requestApproval: options.requestApproval,

          observer: event => {
            // [NEW 29.1] 收到实际子事件才续租；无进展超过期限就停止本轮。
            try { coordinator.heartbeat(lease); } catch { stop("expired"); }
            if (event.type === "child_state") emitAgentEvent(options.observer, event);
          },
        });
        // [NEW 29.1] 即使子返回先于定时器，也不能提交已超期结果。
        if (coordinator.expired(lease)) stop("expired");
        if (coordinator.list().find(task => task.id === lease.taskId)!.state === "running") coordinator.finish(lease, result);
      } catch (error) {
        stop("cancelled"); throw error;
      } finally {
        clearInterval(timer);
        signal.removeEventListener("abort", onAbort);
        if (coordinator.list().find(task => task.id === lease.taskId)!.state === "stopping") coordinator.settleStopped(lease);
        notify(lease);
      }
    }
  };
  try {
    const settled = await Promise.allSettled([worker("worker-1"), worker("worker-2")]);
    signal.throwIfAborted();
    const failed = settled.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return coordinator.list();
  }
  finally { coordinator.endRun(); }
}
```
