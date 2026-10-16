/**
 * 30.2 到期与真实执行 | [KEEP] collaboration/coordinator.ts
 * 学习目标：由一个同步登记表决定任务归属，模型文字不能改变归属或完成状态。
 * 输入：已校验的任务、可信本地worker身份、当前租约与只读子会话结果。
 * 输出：防御性快照；非法转换抛ToolError且不接受旧结果。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   create -> pending -> claim(无await) -> running -> 检查归属/期限 -> completed或failed
 *   running -> stop -> stopping -> 子Promise及清理结束 -> settleStopped -> pending或cancelled/failed
 * 关键原因：停止信号不能证明旧worker结束，stopping期间不允许第二次认领。
 * 观察：每次认领token递增，过期结果不能覆盖下一轮；登记只属于当前进程。
 */
import { ToolError } from "../errors.js";
import type { ChildResult, ChildRole } from "../subagents/runner.js";

// [KEEP 来自 29.1] 单协调者和递增token继续决定归属。
export type SharedTaskState = "pending" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
export type WorkerId = "worker-1" | "worker-2";
export type WorkerLease = { taskId: string; workerId: WorkerId; token: number };
export type SharedTaskInput = { id: string; task: string; role: ChildRole; dependsOn?: string[] };
export type SharedTask = SharedTaskInput & { dependsOn: string[]; state: SharedTaskState; token: number; attempts: number; owner?: WorkerId; expiresAt?: number; stopReason?: "expired" | "cancelled"; result?: ChildResult; error?: string };
// [KEEP 来自 29.3] 消息身份与租约分开保存；ack不修改任务状态。
export type AgentIdentity = "parent" | WorkerId;
export type AgentMessage = { id: string; clientId: string; taskId: string; token: number; from: AgentIdentity; to: AgentIdentity; body: string; acknowledged: boolean };
/** 单进程唯一协调者保存内存状态；所有读写都经过当前实例，不从历史恢复控制权。 */
export class SharedCoordinator {
  private readonly tasks = new Map<string, SharedTask>();
  private running = false;
  // [KEEP 来自 29.3] 去重范围绑定发送者、任务及租约，不把重试消息串入下一轮。
  private readonly messages: AgentMessage[] = [];
  private messageSequence = 0;
  readonly leaseMs: number;
  private readonly clock: () => number;
  /** 本地入口决定时钟和租约长度；测试可传可控时钟，模型没有配置入口。 */
  constructor(options: { leaseMs?: number; clock?: () => number } = {}) {
    this.leaseMs = options.leaseMs ?? 15_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs < 30 || this.leaseMs > 60_000) throw new ToolError("租约必须在30–60000毫秒之间。");
    this.clock = options.clock ?? Date.now;
  }
  /** 批量验证后一次登记；重复ID、缺失依赖或循环不会留下半批任务。 */
  create(inputs: SharedTaskInput[]): SharedTask[] {
    if (!inputs.length || this.tasks.size + inputs.length > 32) throw new ToolError("共享任务总数为1–32项。");
    const next = new Map(this.tasks);
    for (const input of inputs) {
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(input.id) || next.has(input.id)) throw new ToolError("任务ID无效或重复。");
      if (!input.task.trim() || input.task.length > 2000 || !["explore", "review"].includes(input.role)) throw new ToolError("任务需要只读角色及1–2000字符正文。");
      const dependsOn = [...(input.dependsOn ?? [])];
      if (dependsOn.length > 16 || new Set(dependsOn).size !== dependsOn.length) throw new ToolError("依赖最多16项且不能重复。");
      next.set(input.id, { id: input.id, task: input.task.trim(), role: input.role, dependsOn, state: "pending", token: 0, attempts: 0 });
    }
    // [KEEP 来自 29.2] 完整图验证通过才提交新任务。
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new ToolError("任务依赖不能成环。");
      if (visited.has(id)) return;
      const task = next.get(id); if (!task) throw new ToolError("依赖任务不存在。");
      visiting.add(id); for (const dependency of task.dependsOn) visit(dependency);
      visiting.delete(id); visited.add(id);
    };
    for (const id of next.keys()) visit(id);
    for (const [id, task] of next) this.tasks.set(id, task);
    this.refreshBlocked(); return this.list();
  }
  /** 复制任务和子结果，观察者或模型工具不能通过返回对象修改登记表。 */
  list(): SharedTask[] { return structuredClone([...this.tasks.values()]); }
  /** 只允许一个本地调度批次持有这张表，防止并发run重复使用固定worker身份。 */
  beginRun(): void { if (this.running) throw new ToolError("共享任务调度已经在运行。"); this.running = true; }
  /** 所有worker和子清理完成后释放调度批次；不会清空已完成的任务与结果。 */
  endRun(): void { this.running = false; }
  /** 检查空闲与依赖后同步认领；检查和写owner之间没有await，所以不会交错。 */
  claim(workerId: WorkerId): WorkerLease | null {
    if (!["worker-1", "worker-2"].includes(workerId)) throw new ToolError("未知本地worker。");
    if ([...this.tasks.values()].some(task => task.owner === workerId && ["running", "stopping"].includes(task.state))) throw new ToolError("worker尚未结束上一项任务。");
    this.refreshBlocked();
    const task = [...this.tasks.values()].find(task => task.state === "pending" && task.dependsOn.every(id => this.tasks.get(id)?.state === "completed"));
    if (!task) return null;
    task.state = "running"; task.owner = workerId; task.token++; task.attempts++; task.expiresAt = this.clock() + this.leaseMs;
    delete task.error; delete task.stopReason;
    return { taskId: task.id, workerId, token: task.token };
  }
  /** 每次读取、心跳、消息或提交前核对任务ID、worker和token；期限过后也不能接受。 */
  current(lease: WorkerLease, allowStopping = false): SharedTask {
    const task = this.tasks.get(lease.taskId);
    if (!task || task.owner !== lease.workerId || task.token !== lease.token || (task.state !== "running" && !(allowStopping && task.state === "stopping"))) throw new ToolError("旧租约或任务归属已经失效。");
    if (!allowStopping && this.expired(lease)) throw new ToolError("租约已经过期，结果不能提交。");
    return structuredClone(task);
  }
  /** 以协调者时钟检查当前租约是否过期；不会顺便开放认领。 */
  expired(lease: WorkerLease): boolean { const task = this.tasks.get(lease.taskId); return !!task && task.owner === lease.workerId && task.token === lease.token && task.state === "running" && this.clock() >= task.expiresAt!; }
  /** worker发生真实进展时续租；迟到心跳不能让已经过期的租约复活。 */
  heartbeat(lease: WorkerLease): void { this.current(lease); this.tasks.get(lease.taskId)!.expiresAt = this.clock() + this.leaseMs; }
  /** 只有子循环正常结束、检查点关闭且有本地文件证据才记completed；摘要不参与判断。 */
  finish(lease: WorkerLease, result: ChildResult): void {
    this.current(lease); const task = this.tasks.get(lease.taskId)!;
    task.result = structuredClone(result);
    task.state = result.status === "completed" && result.evidence.length > 0 ? "completed" : result.status === "cancelled" ? "cancelled" : "failed";
    if (task.state !== "completed") task.error = result.error ?? "没有取得成功只读工具的结构化文件证据。";
    this.refreshBlocked();
  }
  /** 先占住停止中的归属，再请求底层取消；此方法本身不证明子会话已经清理。 */
  stop(lease: WorkerLease, reason: "expired" | "cancelled"): void {
    this.current(lease, true); const task = this.tasks.get(lease.taskId)!;
    task.state = "stopping"; task.stopReason = reason;
  }
  /** 调用方已await旧子Promise及清理后，才允许过期任务再次认领；重试最多两轮。 */
  settleStopped(lease: WorkerLease): void {
    this.current(lease, true); const task = this.tasks.get(lease.taskId)!;
    if (task.state !== "stopping") throw new ToolError("必须先停止并等待子任务收尾。");
    task.state = task.stopReason === "cancelled" ? "cancelled" : task.attempts < 2 ? "pending" : "failed";
    task.error = task.stopReason === "cancelled" ? "父轮取消，子会话已收尾。" : "租约过期，旧子会话已收尾。";
    delete task.owner; delete task.expiresAt; this.refreshBlocked();
  }
  /** 前置任务失败、取消或已经阻塞时向后传播；未结束的依赖继续等待。 */
  private refreshBlocked(): void {
    // [KEEP 来自 29.2] 失败向后阻塞，等待中的依赖不算失败。
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of this.tasks.values()) if (task.state === "pending") {
        const blocked = task.dependsOn.find(id => ["failed", "cancelled", "blocked"].includes(this.tasks.get(id)!.state));
        if (blocked) { task.state = "blocked"; task.error = `前置任务${blocked}没有完成。`; changed = true; }
      }
    }
  }
  // [KEEP 来自 29.3] 发送、收取、确认分别检查归属，完成任务仍由finish读取ChildResult决定。
  /** 查询任务本轮身份，父入口不能伪造worker；已完成的本轮消息仍可收取与确认。 */
  messageLease(taskId: string, token: number, actor: AgentIdentity): WorkerLease {
    const task = this.tasks.get(taskId);
    if (!task || !task.owner || task.token !== token || !["running", "completed", "failed", "cancelled"].includes(task.state) || actor !== "parent" && actor !== task.owner) throw new ToolError("消息任务或租约已经失效。");
    if (task.state === "running" && this.expired({ taskId, workerId: task.owner, token })) throw new ToolError("消息租约已经过期。");
    return { taskId, workerId: task.owner, token };
  }
  /** 用发送者提供的clientId去重；重复ID但正文或收件人不同会拒绝，不悄悄覆盖。 */
  sendMessage(lease: WorkerLease, from: AgentIdentity, to: AgentIdentity, clientId: string, body: string): AgentMessage {
    this.current(lease); this.messageLease(lease.taskId, lease.token, from);
    if (from === "parent" ? to !== lease.workerId : to !== "parent") throw new ToolError("消息只在父Agent与该任务当前worker之间传递。");
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(clientId) || !body.trim() || body.length > 2000) throw new ToolError("消息需要1–60字符client_id及1–2000字符正文。");
    const previous = this.messages.find(item => item.taskId === lease.taskId && item.token === lease.token && item.from === from && item.clientId === clientId);
    if (previous) {
      if (previous.to !== to || previous.body !== body.trim()) throw new ToolError("重复消息ID的内容不一致。");
      return structuredClone(previous);
    }
    if (this.messages.length >= 128) throw new ToolError("当前进程最多登记128条消息。");
    const message: AgentMessage = { id: `message-${++this.messageSequence}`, clientId, taskId: lease.taskId, token: lease.token, from, to, body: body.trim(), acknowledged: false };
    this.messages.push(message); return structuredClone(message);
  }
  /** 返回指定收件人尚未确认的本轮消息；读取不等于确认，也不会完成任务。 */
  readMessages(lease: WorkerLease, recipient: AgentIdentity): AgentMessage[] {
    this.messageLease(lease.taskId, lease.token, recipient);
    return structuredClone(this.messages.filter(item => item.taskId === lease.taskId && item.token === lease.token && item.to === recipient && !item.acknowledged));
  }
  /** 收件人按服务端生成的message-ID显式确认；重复确认返回相同结果。 */
  acknowledgeMessage(lease: WorkerLease, recipient: AgentIdentity, messageId: string): AgentMessage {
    this.messageLease(lease.taskId, lease.token, recipient);
    const message = this.messages.find(item => item.id === messageId && item.taskId === lease.taskId && item.token === lease.token && item.to === recipient);
    if (!message) throw new ToolError("没有属于当前收件人和租约的消息。");
    message.acknowledged = true; return structuredClone(message);
  }
}
