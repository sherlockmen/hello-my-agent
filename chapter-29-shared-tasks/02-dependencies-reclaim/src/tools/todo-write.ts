/**
 * 29.2 依赖与失联回收 | [KEEP] tools/todo-write.ts
 *
 * 学习目标：保存会话中的真实清单；本文件沿用完整校验后替换内存清单的职责。
 * 输入：模型的 JSON 参数、共用 TaskState 和本轮取消信号。
 * 输出：新清单正文给模型，独立拷贝的条目给界面。
 * 状态：最多 8 项、ID 不重复、最多一项进行中；解析失败或提交前已取消时旧清单不变。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数 -> JSON 对象、条目、ID、状态全部有效？-- 否 -> ToolError，旧清单不变
 *                                                     +-- 是 -> 再查取消 -> 一次替换清单 -> 结果
 * 清单只存在当前会话内存；completed 是模型报告的进度，不能证明代码或测试已通过。
 * 运行观察：错误更新保留上一份清单，合法空数组可以清空清单。
 */
// [KEEP 来自 12.2] 校验完整新清单后再替换会话状态，不产生文件写入。
import { ToolError } from "../errors.js";
import type { TaskItem, TaskState } from "../agent/run-options.js";
import type { ToolExecutionResult } from "./types.js";

export const todoWriteDefinition = {
  name: "todo_write",
  description: "创建或更新本次会话的任务清单。items 是完整的新清单，最多 8 项，同时最多一项执行中；仅更新内存，不表示任务已真正完成。",
  inputSchema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array" as const,
        maxItems: 8,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const, minLength: 1, maxLength: 80 },
            text: { type: "string" as const, minLength: 1, maxLength: 200 },
            status: { type: "string" as const, enum: ["pending", "in_progress", "completed"] },
          },
          required: ["id", "text", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

/**
 * 把模型给出的完整新清单检查成可提交的条目。
 * 先解析 JSON，再检查字段、最多 8 项、去空白后的 ID 不重复和最多一项进行中。
 * 返回一份新数组；任何一项有问题就抛出 ToolError，此时尚未修改旧清单。
 */
function parseTasks(argumentsJson: string): TaskItem[] {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("todo_write 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("todo_write 参数必须是只包含 items 的对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Array.isArray(input.items) || input.items.length > 8) {
    throw new ToolError("todo_write items 必须是最多 8 项的数组，且不能包含其他参数。");
  }
  const ids = new Set<string>();
  let inProgress = 0;
  // [KEEP 来自 12.2] 每一项先转成新条目；某一项失败就停止，尚未改旧清单。
  return input.items.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ToolError("todo_write 的每一项必须包含 id、text 和 status。");
    }
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 3 || !("id" in item) || !("text" in item) || !("status" in item)) {
      throw new ToolError("todo_write 的每一项必须且只能包含 id、text 和 status。");
    }
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 80
      || typeof item.text !== "string" || !item.text.trim() || item.text.length > 200) {
      throw new ToolError("任务 id 必须为 1–80 字符、text 必须为 1–200 字符的非空文字。");
    }
    const id = item.id.trim();
    if (ids.has(id)) throw new ToolError(`任务 id 不能重复：${id}`);
    ids.add(id);
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") {
      throw new ToolError("任务 status 只能是 pending、in_progress 或 completed。");
    }
    if (item.status === "in_progress" && ++inProgress > 1) {
      throw new ToolError("同一时刻最多只能有一项任务处于 in_progress。");
    }
    return { id, text: item.text.trim(), status: item.status };
  });
}

/**
 * 把通过完整校验的清单一次写入会话内存。
 * 输入是模型参数、会话共用的清单和取消信号；提交前再次检查取消。
 * 返回给模型的清单正文和给界面的独立拷贝；失败保留旧清单。
 * 模型标为完成只表达进度，不能代替命令结果或测试检查。
 */
export async function todoWriteTool(
  argumentsJson: string, tasks: TaskState, signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const items = parseTasks(argumentsJson);
  signal.throwIfAborted();
  // [KEEP 来自 12.2] 校验和取消检查都通过后，只有这里一次替换完整清单。
  tasks.items = items;
  return {
    content: JSON.stringify({ items }, null, 2),
    metadata: { kind: "todo_write", items: structuredClone(items) },
  };
}
