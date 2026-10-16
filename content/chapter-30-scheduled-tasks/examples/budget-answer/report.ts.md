# report.ts

`chapter-30-scheduled-tasks/examples/budget-answer/report.ts`

<a href="./content/chapter-30-scheduled-tasks/examples/budget-answer/report.ts" download>下载原始文件</a>

```typescript
/**
 * 30.3 练习答案 | [NEW] schedules/report.ts
 * 学习目标：从已校验快照生成剩余额度报告，显示额度与允许执行是不同判断。
 * 输入：store.snapshot()；输出：JSON可显示的报告，不改状态、不读取密钥。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：已提交定义/最近记录 -> 逐项计算 -> 报告
 * 观察：stopped即使有余额也仍显示stopped，不会因为报告重新启动。
 */
import type { ScheduleState } from "../../03-stop-and-recover/src/schedules/store.js";

// [NEW 30.3 练习] 本文件只生成管理报告，不能成为绕过调度条件的启动入口。
/** 从累计计数计算余额，最新运行只作为观察；没有记录显示never。 */
export function scheduleBudgetReport(state: ScheduleState) {
  return state.schedules.map(task => ({
    id: task.id,
    state: task.state,
    remainingRuns: task.maxRuns - task.attempts,
    remainingTokenReservation: task.maxTokens - task.reservedTokens,
    lastStatus: [...state.runs].reverse().find(run => run.scheduleId === task.id)?.status ?? "never",
  }));
}
```
