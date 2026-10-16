/**
 * 34.2 只重试可以安全重发的请求 | [KEEP] schedules/store.ts
 *
 * 学习目标：让时间规则与运行记录有独立、可校验的磁盘来源。
 * 输入：本地管理命令；输出：schema=1 的原子快照，不保存连接配置或权限。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   open -> 取得独占锁？否 -> busy；是 -> 有界读取 -> 校验 -> 管理
 *   update -> 复制 -> 修改 -> 校验 -> 临时文件sync -> rename -> 提交内存
 *   失败 -> 保留上次完整快照并封住后续写入；close -> 等待队列 -> 释放自有锁
 * 观察：重开后定义仍在，文件存在不会启动模型或恢复授权。
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 30.1] 定义、运行记录与独占锁沿用前节。
export const DEFAULT_SCHEDULE_DIRECTORY = join(homedir(), ".hello-my-agent", "schedules");
export const MAX_SCHEDULE_BYTES = 524_288;
export const RUN_TOKEN_RESERVATION = 32_768;
export type Schedule = {
  id: string; prompt: string; workspace: string; intervalMs: number; nextRunAt: number;
  state: "enabled" | "paused" | "stopped"; maxRuns: number; maxTokens: number;
  attempts: number; reservedTokens: number;
};
export type ScheduleRun = {
  id: string; scheduleId: string; scheduledAt: number; startedAt: number; finishedAt: number | null;
  status: "running" | "completed" | "failed" | "cancelled" | "budget_exhausted" | "interrupted";
  reservation: number; summary: string; childSessionId: string | null;
  modelCalls: number; requestTokensReserved: number;
};
export type ScheduleState = { schema: 1; schedules: Schedule[]; runs: ScheduleRun[] };
export type NewSchedule = Pick<Schedule, "id" | "prompt" | "workspace" | "intervalMs" | "maxRuns" | "maxTokens">;

/** 检查对象只有约定字段；磁盘或CLI输入中的额外配置不能混入持久状态。 */
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new UserFacingError("定时任务数据字段不符合 schema=1。");
}
/** 整数边界同时拒绝NaN、小数、无穷与不安全整数。 */
function integer(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
/** 逐项校验完整快照；类型声明不能代替磁盘输入、预算和关联编号检查。 */
export function validateScheduleState(value: unknown): asserts value is ScheduleState {
  fields(value, ["schema", "schedules", "runs"]);
  if (value.schema !== 1 || !Array.isArray(value.schedules) || value.schedules.length > 32 || !Array.isArray(value.runs) || value.runs.length > 128) throw new UserFacingError("定时任务版本或条目数量无效。");
  const ids = new Set<string>(), runIds = new Set<string>();
  for (const item of value.schedules) {
    fields(item, ["id", "prompt", "workspace", "intervalMs", "nextRunAt", "state", "maxRuns", "maxTokens", "attempts", "reservedTokens"]);
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(item.id) || ids.has(item.id)
      || typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt.length > 2000
      || typeof item.workspace !== "string" || !isAbsolute(item.workspace) || item.workspace.length > 4096
      || !integer(item.intervalMs, 1000, 86_400_000) || !integer(item.nextRunAt, 0, 8_000_000_000_000_000)
      || typeof item.state !== "string" || !["enabled", "paused", "stopped"].includes(item.state)
      || !integer(item.maxRuns, 1, 100) || !integer(item.maxTokens, 1, 1_000_000)
      || !integer(item.attempts, 0, item.maxRuns as number) || !integer(item.reservedTokens, 0, item.maxTokens as number)) throw new UserFacingError("定时任务定义、编号或预算无效。");
    ids.add(item.id);
  }
  const active = new Set<string>();
  for (const run of value.runs) {
    fields(run, ["id", "scheduleId", "scheduledAt", "startedAt", "finishedAt", "status", "reservation", "summary", "childSessionId", "modelCalls", "requestTokensReserved"]);
    if (typeof run.id !== "string" || !/^[0-9a-f-]{36}$/.test(run.id) || runIds.has(run.id)
      || typeof run.scheduleId !== "string" || !ids.has(run.scheduleId)
      || !integer(run.scheduledAt, 0, 8_000_000_000_000_000) || !integer(run.startedAt, 0, 8_000_000_000_000_000)
      || typeof run.status !== "string" || !["running", "completed", "failed", "cancelled", "budget_exhausted", "interrupted"].includes(run.status)
      || (run.status === "running" ? run.finishedAt !== null || active.has(run.scheduleId) : !integer(run.finishedAt, run.startedAt as number, 8_000_000_000_000_000))
      || !integer(run.reservation, 1, RUN_TOKEN_RESERVATION) || typeof run.summary !== "string" || run.summary.length > 2000
      || (run.childSessionId !== null && (typeof run.childSessionId !== "string" || !/^[0-9a-f-]{36}$/.test(run.childSessionId)))
      || !integer(run.modelCalls, 0, 4) || !integer(run.requestTokensReserved, 0, run.reservation as number)) throw new UserFacingError("定时任务运行记录无效。");
    runIds.add(run.id); if (run.status === "running") active.add(run.scheduleId);
  }
}

type LockRecord = { pid: number; token: string };
type HeldLock = { release(): Promise<void> };

/**
 * 只读一个有界、普通且未被替换的锁文件，返回拥有者和文件身份。
 * 无法解释的锁不会被视为空闲，避免误删其他进程或人工放置的文件。
 */
async function readLock(path: string) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4096) throw new UserFacingError("锁文件不是可识别的普通文件，请先人工检查，程序不会删除它。");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size > 4096) throw new UserFacingError("锁文件在检查时发生变化，请重试。");
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error("锁过长");
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("锁不是对象");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Number.isSafeInteger(record.pid) || (record.pid as number) <= 0 || (record.pid as number) > 2_147_483_647
      || typeof record.token !== "string" || !/^[0-9a-f-]{36}$/.test(record.token)) throw new Error("锁字段无效");
    return { record: record as LockRecord, info };
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("锁文件内容无法识别，请先人工检查，程序不会删除它。");
  } finally { await file.close(); }
}

/**
 * 用 PID 检查占用是否仍有可能存在；权限不足也按占用处理。
 * PID 可能复用，所以活 PID 只意味着拒绝接管，不证明它仍是最初的定时任务存储进程。
 */
function processMayExist(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}

/**
 * 释放前重新确认 token 和普通文件身份，绝不删掉后来替换的锁。
 * 缺失或变更也作为异常报告；调用方不能把未核对的释放说成成功。
 */
async function releaseLock(path: string, token: string): Promise<void> {
  const current = await readLock(path);
  if (current.record.token !== token || current.record.pid !== process.pid) throw new UserFacingError("锁的拥有者已经变化，当前进程没有删除它。");
  const latest = await lstat(path);
  if (!latest.isFile() || latest.ino !== current.info.ino || latest.dev !== current.info.dev) throw new UserFacingError("锁文件已经变化，当前进程没有删除它。");
  await unlink(path);
}

/**
 * 以 wx 创建锁并写入当前 PID 和随机 token；失败只清理自己刚创建的同一文件。
 * 这里不删除已有锁，是否允许接管由 acquireLock 在恢复保护内决定。
 */
async function createLock(path: string, record: LockRecord): Promise<void> {
  const file = await open(path, "wx", 0o600);
  const info = await file.stat();
  try {
    await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    const current = await lstat(path).catch(() => undefined);
    if (current?.isFile() && current.ino === info.ino && current.dev === info.dev) await unlink(path).catch(() => {});
    throw error;
  } finally { await file.close(); }
}

/**
 * 获取整次写入期间持有的锁；死 PID 也必须由人显式选择恢复。
 * 接管先创建短暂的恢复保护文件，再原位改写旧锁，避免两个恢复者越过同一空档。
 * 异常留下的恢复保护不能自动清除：宁可提示检查，也不猜测另一个恢复者已经退出。
 */
async function acquireLock(path: string, recover: boolean): Promise<HeldLock> {
  const record = { pid: process.pid, token: randomUUID() };
  try { await createLock(path, record); }
  catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    const previous = await readLock(path);
    if (processMayExist(previous.record.pid)) throw new UserFacingError("定时任务存储仍被一个活进程占用，不能同时恢复或修改。");
    if (!recover) throw new UserFacingError("定时任务存储留有旧锁；确认工作区和进程后，使用 --recover 显式接管。");
    const recoveryPath = `${path}.recover`;
    try { await createLock(recoveryPath, record); }
    catch { throw new UserFacingError("已有恢复保护文件，请检查是否有其他恢复操作；程序不会自动删除它。"); }
    try {
      const current = await readLock(path);
      if (processMayExist(current.record.pid)) throw new UserFacingError("检查期间已有活进程占用定时任务存储，已停止接管。");
      const file = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await file.stat();
        if (!info.isFile() || info.ino !== current.info.ino || info.dev !== current.info.dev) throw new UserFacingError("锁文件在接管前发生变化，已停止接管。");
        await file.truncate(0);
        await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await file.sync();
      } finally { await file.close(); }
    } finally { await releaseLock(recoveryPath, record.token); }
  }
  return { release: () => releaseLock(path, record.token) };
}

/**
 * 读取同一个普通文件句柄，最多读上限加一字节；坏JSON和未知版本都拒绝，不覆盖旧文件。
 * 缺少文件表示首次使用；检查时已经是符号链接或特殊文件则拒绝。
 */
async function readState(path: string): Promise<ScheduleState> {
  let file: FileHandle;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: 1, schedules: [], runs: [] }; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_SCHEDULE_BYTES) throw new UserFacingError("定时任务文件不是有界普通文件。");
    const buffer = Buffer.alloc(MAX_SCHEDULE_BYTES + 1); let offset = 0;
    while (offset < buffer.length) { const part = await file.read(buffer, offset, buffer.length - offset, offset); if (!part.bytesRead) break; offset += part.bytesRead; }
    if (offset > MAX_SCHEDULE_BYTES) throw new UserFacingError("定时任务文件超过大小上限。");
    let value: unknown;
    try { value = JSON.parse(buffer.subarray(0, offset).toString("utf8")); } catch { throw new UserFacingError("定时任务文件不是完整JSON，旧内容未被修改。"); }
    validateScheduleState(value); return value;
  } finally { await file.close(); }
}

/**
 * 独占整个管理动作或serve生命周期；磁盘成功rename后才替换内存快照。
 * snapshot返回副本，所有异步修改共用一条队列，避免完成回调互相覆盖。
 */
export class ScheduleStore {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private failed = false;
  private constructor(readonly directory: string, private state: ScheduleState, private lock: HeldLock) {}

  /** 打开目录、持有独占锁再读取；打开失败仍释放自己取得的锁。 */
  static async open(directory = DEFAULT_SCHEDULE_DIRECTORY, recover = false): Promise<ScheduleStore> {
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
    const root = await realpath(resolve(directory));
    const lock = await acquireLock(join(root, "store.lock"), recover);
    try { return new ScheduleStore(root, await readState(join(root, "store.json")), lock); }
    catch (error) { await lock.release(); throw error; }
  }

  /** 返回已提交状态的副本；持锁期间没有其他合规写入者。 */
  snapshot(): ScheduleState { return structuredClone(this.state); }

  // [KEEP 来自 30.2] 参数错误可以改正；真正写盘失败则要求serve停止并释放锁。
  /** 只读暴露封写状态，让控制输入也能触发服务收尾。 */
  get hasWriteFailure(): boolean { return this.failed; }

  /**
   * 在串行队列里修改副本并写入同目录临时文件；失败封住后续写入，原快照保持可读。
   * rename保证正常文件系统中读到旧版或新版；不声称断电后目录项一定持久化。
   */
  update(change: (next: ScheduleState) => void): Promise<void> {
    if (this.closed) return Promise.reject(new UserFacingError("定时任务存储已经关闭。"));
    const operation = this.queue.then(async () => {
      if (this.failed) throw new UserFacingError("上次保存失败，定时任务存储已停止接收修改。");
      const next = structuredClone(this.state); change(next); validateScheduleState(next);
      const text = `${JSON.stringify(next)}\n`;
      if (Buffer.byteLength(text) > MAX_SCHEDULE_BYTES) throw new UserFacingError("定时任务快照超过大小上限。");
      const temporary = join(this.directory, `.store-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(text, "utf8"); await file.sync(); } finally { await file.close(); }
        await rename(temporary, join(this.directory, "store.json")); this.state = next;
      } catch (error) { this.failed = true; throw error; }
      finally { await unlink(temporary).catch(() => {}); }
    });
    this.queue = operation.catch(() => {}); return operation;
  }

  /** 创建定义时保存真实工作区；首次到期是创建时间加间隔，不会立即请求模型。 */
  async create(input: NewSchedule, now = Date.now()): Promise<void> {
    const workspace = await realpath(input.workspace);
    await this.update(next => {
      next.schedules.push({ id: input.id, prompt: input.prompt.trim(), workspace, intervalMs: input.intervalMs,
        nextRunAt: now + input.intervalMs, state: "enabled", maxRuns: input.maxRuns, maxTokens: input.maxTokens,
        attempts: 0, reservedTokens: 0 });
    });
  }

  /** 等待已排队的提交，再释放独占锁；重复关闭不会删掉后来持有者的锁。 */
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    await this.queue; await this.lock.release();
  }
}
