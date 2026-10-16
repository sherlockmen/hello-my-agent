/**
 * 35.1 固定任务与离线回放 | [KEEP] tools/shared-task-tools.ts
 * 学习目标：给模型有界任务操作，身份、完成状态和worker权限由本地代码决定。
 * 输入：严格JSON参数、本会话协调者和本地绑定；不接任意路径、worker配置或完成声明。
 * 输出：结构化metadata与同一份JSON正文，沿原工具消息返回父模型。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   校验精确字段 -> Plan/child边界 -> create/read/run或消息操作 -> 快照返回
 * 观察：本地内存操作不授予文件写入或命令权限；run只启动固定只读worker。
 */
import { ToolError } from "../errors.js";
import type { RunOptions } from "../agent/run-options.js";
import type { SharedTaskInput } from "../collaboration/coordinator.js";
import type { ToolDefinition, ToolExecutionResult } from "./types.js";

// [KEEP 来自 29.1] 三个任务入口沿用；29.2由协调者验证依赖。
const emptySchema = { type: "object" as const, properties: {}, additionalProperties: false };
export const sharedTaskDefinitions: ToolDefinition[] = [
  { name: "create_shared_tasks", description: "登记1–32项只读调查任务；不能指定worker或完成状态。", inputSchema: { type: "object", properties: { tasks: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { id: { type: "string" }, task: { type: "string" }, role: { enum: ["explore", "review"] }, depends_on: { type: "array", items: { type: "string" } } }, required: ["id", "task", "role"], additionalProperties: false } } }, required: ["tasks"], additionalProperties: false } },
  { name: "read_shared_tasks", description: "只读当前进程共享任务的归属、租约与结构化结果。", inputSchema: emptySchema },
  { name: "run_shared_tasks", description: "等待最多两个本地只读worker调度结束；完成依据来自本地子会话观察。", inputSchema: emptySchema },
  { name: "send_agent_message", description: "向本任务对端发送消息；client_id用于本轮去重，消息不能完成任务。", inputSchema: { type: "object", properties: { task_id: { type: "string" }, lease_token: { type: "integer", minimum: 1 }, to: { enum: ["parent", "worker-1", "worker-2"] }, client_id: { type: "string" }, body: { type: "string" } }, required: ["task_id", "lease_token", "to", "client_id", "body"], additionalProperties: false } },
  { name: "read_agent_messages", description: "只读本身份、本任务租约下尚未ack的消息；读取不自动确认。", inputSchema: { type: "object", properties: { task_id: { type: "string" }, lease_token: { type: "integer", minimum: 1 } }, required: ["task_id", "lease_token"], additionalProperties: false } },
  { name: "ack_agent_message", description: "本身份按message_id显式确认一条消息；不会改变任务状态。", inputSchema: { type: "object", properties: { task_id: { type: "string" }, lease_token: { type: "integer", minimum: 1 }, message_id: { type: "string" } }, required: ["task_id", "lease_token", "message_id"], additionalProperties: false } },
];
export const sharedTaskMutations = new Set(["create_shared_tasks", "run_shared_tasks", "send_agent_message", "ack_agent_message"]);
/** 参数必须是对象且字段完全匹配；拒绝额外权限、身份或完成声明。 */
function object(json: string, required: string[], optional: string[] = []): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new ToolError("共享任务参数必须为JSON对象。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("共享任务参数必须为JSON对象。");
  const args = value as Record<string, unknown>;
  if (required.some(key => !(key in args)) || Object.keys(args).some(key => !required.includes(key) && !optional.includes(key))) throw new ToolError("共享任务字段不匹配，不能增加身份或权限。");
  return args;
}
/** 执行内存登记或真实调度；副作用入口再次拒绝Plan和子层递归调度。 */
export async function sharedTaskTool(name: string, json: string, signal: AbortSignal, options: RunOptions): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const coordinator = options.sharedTasks; if (!coordinator) throw new ToolError("本会话没有共享任务协调者。");
  if (options.mode === "plan" && sharedTaskMutations.has(name)) throw new ToolError("Plan模式只读取共享任务，不启动worker或修改收件箱。");
  if (options.childDepth && ["create_shared_tasks", "run_shared_tasks"].includes(name)) throw new ToolError("只读worker不能递归创建或启动共享任务。");
  // [KEEP 来自 29.3] from来自可信绑定，模型只能选择当前任务对应的对端。
  if (["send_agent_message", "read_agent_messages", "ack_agent_message"].includes(name)) {
    const fields = name === "send_agent_message" ? ["to", "client_id", "body"] : name === "ack_agent_message" ? ["message_id"] : [];
    const args = object(json, ["task_id", "lease_token", ...fields]);
    if (typeof args.task_id !== "string" || !Number.isSafeInteger(args.lease_token) || Number(args.lease_token) < 1) throw new ToolError("消息需要有效task_id和lease_token。");
    const actor = options.sharedWorker?.workerId ?? "parent";
    if (options.sharedWorker && (args.task_id !== options.sharedWorker.taskId || args.lease_token !== options.sharedWorker.token)) throw new ToolError("worker不能访问其他任务或租约。");
    const lease = coordinator.messageLease(args.task_id, args.lease_token as number, actor);
    let messages;
    if (name === "send_agent_message") {
      if (!["parent", "worker-1", "worker-2"].includes(String(args.to)) || typeof args.client_id !== "string" || typeof args.body !== "string") throw new ToolError("消息字段类型错误。");
      messages = [coordinator.sendMessage(lease, actor, args.to as import("../collaboration/coordinator.js").AgentIdentity, args.client_id, args.body)];
    } else if (name === "ack_agent_message") {
      if (typeof args.message_id !== "string") throw new ToolError("message_id必须是字符串。");
      messages = [coordinator.acknowledgeMessage(lease, actor, args.message_id)];
    } else messages = coordinator.readMessages(lease, actor);
    return { content: JSON.stringify({ messages }), metadata: { kind: "agent_messages", messages } };
  }
  let tasks;
  if (name === "create_shared_tasks") {
    const args = object(json, ["tasks"]);
    if (!Array.isArray(args.tasks)) throw new ToolError("tasks必须是数组。");
    const inputs: SharedTaskInput[] = args.tasks.map(item => {
      const input = object(JSON.stringify(item), ["id", "task", "role"], ["depends_on"]);
      if (typeof input.id !== "string" || typeof input.task !== "string" || input.role !== "explore" && input.role !== "review" || input.depends_on !== undefined && (!Array.isArray(input.depends_on) || input.depends_on.some(value => typeof value !== "string"))) throw new ToolError("任务字段类型错误。");
      return { id: input.id, task: input.task, role: input.role, dependsOn: input.depends_on as string[] | undefined };
    });
    tasks = coordinator.create(inputs);
  } else {
    object(json, []);
    if (name === "read_shared_tasks") tasks = coordinator.list();
    else if (name === "run_shared_tasks" && options.runSharedTasks) tasks = await options.runSharedTasks(signal);
    else throw new ToolError("未知共享任务工具或调度入口未绑定。");
  }
  return { content: JSON.stringify({ tasks }), metadata: { kind: "shared_tasks", tasks } };
}
