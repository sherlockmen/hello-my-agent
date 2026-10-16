/**
 * 34.3 停止无进展任务并保留成果 | [KEEP] schedules/runtime.ts
 *
 * 学习目标：把持久定义交给同一个只读子Agent，每次启动先保存次数和token预留。
 * 输入：clock、真实runner与store；输出：持久运行记录，active只存在本进程。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   tick -> enabled且到期且不active？否 -> 跳过；是 -> 有剩余预算？
 *       否 -> paused；是 -> 原子保存running/次数/预留/下次时间 -> 启动runner
 *   runner真正settle -> 保存终态 -> 删除active；取消仍要等待同一个Promise
 *   关闭 -> 拒绝新tick -> abort全部 -> await settle -> 交还store给入口关闭
 * 观察：错过多个间隔只合并执行一次，同一任务从不重叠。
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import type { Model } from "../models/client.js";
import { runSubagent, type ChildResult } from "../subagents/runner.js";
import { UserFacingError } from "../errors.js";
import { RUN_TOKEN_RESERVATION, ScheduleStore, type Schedule, type ScheduleRun, type ScheduleState } from "./store.js";

// [KEEP 来自 30.2] 继续使用真实runner和同一预算。
export type ScheduleResult = Pick<ChildResult, "sessionId" | "status" | "summary" | "modelCalls" | "requestTokensReserved" | "error">;
export type ScheduleRunner = (schedule: Schedule, runId: string, signal: AbortSignal, reservation: number) => Promise<ScheduleResult>;
type Active = { controller: AbortController; settled: Promise<void> };

/**
 * 将固定只读角色接到已有runSubagent；磁盘定义不能提供权限、工具列表或任意执行器。
 * 每次使用新子历史与新授权集合，累计token预留上限交给子模型的真正请求入口检查。
 */
export function createScheduleRunner(model: Model, directory: string): ScheduleRunner {
  return async (schedule, runId, signal, reservation) => {
    if (await realpath(process.cwd()) !== schedule.workspace) throw new UserFacingError("请从任务创建时的工作区启动serve，不能替换任务的读取根目录。");
    return runSubagent(model, JSON.stringify({ role: "explore", task: schedule.prompt }), signal,
      { parentSessionId: runId, sessionDirectory: join(directory, "child-sessions"), maxModelCalls: 4, requestTokenBudget: reservation });
  };
}

/** 定位本地编号；未知编号变成可读错误，不能误改数组中的另一项。 */
function scheduleById(state: ScheduleState, id: string): Schedule {
  const schedule = state.schedules.find(item => item.id === id);
  if (!schedule) throw new UserFacingError(`未知定时任务编号：${id}`);
  return schedule;
}

/**
 * 离线CLI和serve内控制共用同一个状态修改；管理不需要模型连接。
 * stopped与用尽预算不能恢复；恢复重新计时，不补暂停期间错过的间隔。
 */
export async function changeScheduleState(store: ScheduleStore, action: "pause" | "resume" | "stop", id: string, now = Date.now()): Promise<void> {
  await store.update(state => {
    const task = scheduleById(state, id);
    if (action === "stop") { task.state = "stopped"; return; }
    if (task.state === "stopped") throw new UserFacingError("stopped任务不能恢复，请创建新编号。");
    if (action === "pause") task.state = "paused";
    else {
      if (task.attempts >= task.maxRuns || task.reservedTokens >= task.maxTokens) throw new UserFacingError("预算用尽的任务不能恢复，请创建新编号。");
      task.state = "enabled"; task.nextRunAt = now + task.intervalMs;
    }
  });
}

// [KEEP 来自 30.3] 磁盘running不是进程还活着的证明；显式恢复只记录未知结局。
/**
 * store已取得独占锁后，将旧running标记interrupted并暂停相应定义。
 * 不重放、不中退次数或token；用户核对后resume才重新计时。
 */
export async function recoverInterrupted(store: ScheduleStore, now = Date.now()): Promise<void> {
  if (!store.snapshot().runs.some(run => run.status === "running")) return;
  await store.update(state => {
    for (const run of state.runs) {
      if (run.status !== "running") continue;
      run.status = "interrupted"; run.finishedAt = Math.max(run.startedAt, now);
      run.summary = "旧进程未留下终态，完成情况未知；本次恢复没有重新执行。";
      const task = scheduleById(state, run.scheduleId);
      if (task.state !== "stopped") task.state = "paused";
    }
  });
}

/**
 * 持有当前进程的active与取消控制器；store锁由调用方持有直到close完成。
 * tick串行只负责启动，runner在后台执行；active保存到终态提交成功才删除。
 */
export class Scheduler {
  private active = new Map<string, Active>();
  private dispatch: Promise<void> = Promise.resolve();
  private closing = false;
  private failure: unknown;
  constructor(readonly store: ScheduleStore, private runner: ScheduleRunner, private clock: () => number = Date.now) {
    if (store.snapshot().runs.some(run => run.status === "running")) throw new UserFacingError("存在未收尾的running记录，请核对旧进程后使用--recover显式恢复。");
  }

  /** 返回本进程真实持有的任务数量；取消请求尚未settle时仍占据active。 */
  get activeCount(): number { return this.active.size; }

  /**
   * 原子保存running与预算后才允许启动；到期落后多个间隔也只启动一个实例。
   * 下次时间从本次检查时刻重新计算；active时不补队列，结束后最多合并一次过期机会。
   */
  tick(): Promise<void> {
    const operation = this.dispatch.then(async () => {
      if (this.closing) return;
      if (this.failure) throw this.failure;
      const now = this.clock(), launches: { schedule: Schedule; run: ScheduleRun }[] = [];
      const snapshot = this.store.snapshot();
      if (!snapshot.schedules.some(item => item.state === "enabled" && item.nextRunAt <= now && !this.active.has(item.id))) return;
      await this.store.update(state => {
        for (const schedule of state.schedules) {
          if (schedule.state !== "enabled" || schedule.nextRunAt > now || this.active.has(schedule.id)) continue;
          const remaining = schedule.maxTokens - schedule.reservedTokens;
          if (schedule.attempts >= schedule.maxRuns || remaining <= 0) { schedule.state = "paused"; continue; }
          const reservation = Math.min(RUN_TOKEN_RESERVATION, remaining);
          const run: ScheduleRun = { id: randomUUID(), scheduleId: schedule.id, scheduledAt: schedule.nextRunAt,
            startedAt: now, finishedAt: null, status: "running", reservation, summary: "", childSessionId: null,
            modelCalls: 0, requestTokensReserved: 0 };
          schedule.attempts++; schedule.reservedTokens += reservation; schedule.nextRunAt = now + schedule.intervalMs;
          state.runs.push(run);
          // 只丢最旧终态详情；任务累计次数和预留计数一直保留，不能靠截断历史重获预算。
          while (state.runs.length > 128) { const index = state.runs.findIndex(item => item.status !== "running"); if (index < 0) throw new UserFacingError("运行记录没有可清理的终态。"); state.runs.splice(index, 1); }
          launches.push({ schedule: structuredClone(schedule), run: structuredClone(run) });
        }
      });
      for (const { schedule, run } of launches) this.launch(schedule, run);
    });
    this.dispatch = operation.catch(() => {}); return operation;
  }

  /**
   * 先登记active再进入runner；runner抛错也转成有界终态，原始错误不写进文件。
   * 保存失败时保留active并封住调度，由serve停止后报告存储失败。
   */
  private launch(schedule: Schedule, run: ScheduleRun): void {
    const controller = new AbortController();
    const settled = Promise.resolve().then(async () => {
      let result: ScheduleResult;
      try { result = await this.runner(schedule, run.id, controller.signal, run.reservation); }
      catch { result = { sessionId: "", status: controller.signal.aborted ? "cancelled" : "failed", summary: "子任务没有取得完整结果。", modelCalls: 0, requestTokensReserved: 0 }; }
      await this.store.update(state => {
        const record = state.runs.find(item => item.id === run.id);
        if (!record || record.status !== "running") throw new UserFacingError("当前运行记录已经改变，拒绝覆盖。");
        record.status = controller.signal.aborted ? "cancelled" : result.status;
        record.finishedAt = Math.max(run.startedAt, this.clock()); record.summary = (result.summary || result.error || "未取得摘要。").slice(0, 2000);
        record.childSessionId = /^[0-9a-f-]{36}$/.test(result.sessionId) ? result.sessionId : null;
        record.modelCalls = result.modelCalls; record.requestTokensReserved = result.requestTokensReserved;
        const task = scheduleById(state, schedule.id);
        if (task.state === "enabled" && (task.attempts >= task.maxRuns || task.reservedTokens >= task.maxTokens)) task.state = "paused";
      });
      this.active.delete(schedule.id);
    });
    this.active.set(schedule.id, { controller, settled });
    void settled.catch(error => { this.failure = error; });
  }

  /** 暂停只禁止新的到期启动；已经开始的只读任务继续保存自己的结果。 */
  async pause(id: string): Promise<void> { await changeScheduleState(this.store, "pause", id, this.clock()); }

  /** 恢复从当前时刻重新计时，不补暂停期间的次数；预算没有充值入口。 */
  async resume(id: string): Promise<void> { await changeScheduleState(this.store, "resume", id, this.clock()); }

  // [KEEP 来自 30.3] stopped先落盘，再abort；等待终态提交成功才向控制入口报告停止完成。
  /**
   * 永久禁止新的启动；若同任务正在tick中提交，先等该tick登记active。
   * 取消只是请求，真实settle和终态写盘完成之前，active仍存在。
   */
  async stop(id: string): Promise<void> {
    await changeScheduleState(this.store, "stop", id, this.clock());
    await this.dispatch;
    const item = this.active.get(id);
    if (item) { item.controller.abort(new UserFacingError("定时任务已停止。")); await item.settled; }
  }

  /**
   * 关闭先禁新调度，等待正在提交的tick，再取消并等待每个真实runner。
   * 下层若不理会取消，close也会继续等待；没有超时后假装释放active的分支。
   */
  async close(): Promise<void> {
    this.closing = true; await this.dispatch;
    const active = [...this.active.values()];
    for (const item of active) item.controller.abort(new UserFacingError("定时执行器正在关闭。"));
    const results = await Promise.allSettled(active.map(item => item.settled));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (this.failure) throw this.failure;
  }
}
