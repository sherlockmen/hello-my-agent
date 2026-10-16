# shared-task-tools.ts

`chapter-29-shared-tasks/01-claim-and-lease/src/tools/shared-task-tools.ts`

<a href="./content/chapter-29-shared-tasks/01-claim-and-lease/src/tools/shared-task-tools.ts" download>下载原始文件</a>

```typescript
/**
 * 29.1 认领与租约 | [NEW] tools/shared-task-tools.ts
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

// [NEW 29.1] 本文件以下实现均为本节新增。
const emptySchema = { type: "object" as const, properties: {}, additionalProperties: false };
export const sharedTaskDefinitions: ToolDefinition[] = [
  { name: "create_shared_tasks", description: "登记1–32项只读调查任务；不能指定worker或完成状态。", inputSchema: { type: "object", properties: { tasks: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { id: { type: "string" }, task: { type: "string" }, role: { enum: ["explore", "review"] }, depends_on: { type: "array", items: { type: "string" } } }, required: ["id", "task", "role"], additionalProperties: false } } }, required: ["tasks"], additionalProperties: false } },
  { name: "read_shared_tasks", description: "只读当前进程共享任务的归属、租约与结构化结果。", inputSchema: emptySchema },
  { name: "run_shared_tasks", description: "等待最多两个本地只读worker调度结束；完成依据来自本地子会话观察。", inputSchema: emptySchema },

];
export const sharedTaskMutations = new Set(["create_shared_tasks", "run_shared_tasks"]);
/**
 * 解析工具JSON，核对必需与可选字段，返回尚待业务类型检查的对象。
 * 多余权限、身份、完成声明或坏JSON一律抛ToolError，不留下登记变化。
 */
function object(json: string, required: string[], optional: string[] = []): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new ToolError("共享任务参数必须为JSON对象。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("共享任务参数必须为JSON对象。");
  const args = value as Record<string, unknown>;
  if (required.some(key => !(key in args)) || Object.keys(args).some(key => !required.includes(key) && !optional.includes(key))) throw new ToolError("共享任务字段不匹配，不能增加身份或权限。");
  return args;
}
/**
 * 把严格JSON参数交给本会话协调者，返回同源正文和结构化metadata。
 * 输入身份来自RunOptions；Plan和子层递归启动在这里再次拒绝。
 * 解析或归属错误抛ToolError进入原工具错误通道，父取消继续抛出。
 */
export async function sharedTaskTool(name: string, json: string, signal: AbortSignal, options: RunOptions): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const coordinator = options.sharedTasks; if (!coordinator) throw new ToolError("本会话没有共享任务协调者。");
  if (options.mode === "plan" && sharedTaskMutations.has(name)) throw new ToolError("Plan模式只读取共享任务，不启动worker或修改收件箱。");
  if (options.childDepth && ["create_shared_tasks", "run_shared_tasks"].includes(name)) throw new ToolError("只读worker不能递归创建或启动共享任务。");

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
```
