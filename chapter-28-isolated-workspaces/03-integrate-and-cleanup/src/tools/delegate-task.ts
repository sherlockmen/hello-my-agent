/**
 * 28.3 整合与清理 | [KEEP] tools/delegate-task.ts
 *
 * 学习目标：把委派结果返回给原工具调用，不把子助手文字当作完成证明。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：参数校验 -> 核心注入runner -> ChildResult JSON + error标记
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { parseChildTask, type ChildResult } from "../subagents/runner.js";
import { ToolError } from "../errors.js";
import type { RunOptions } from "../agent/run-options.js";
import type { ToolDefinition, ToolExecutionResult } from "./types.js";

export const delegateTaskDefinition: ToolDefinition = { name: "delegate_task", description: "串行委派一个有独立历史和预算的只读探索或审查子任务。子助手仅可 read_file/glob/grep，不能写文件、运行命令、访问网络或继续委派。等待结构化状态、用量和文件证据后再汇总。", inputSchema: { type: "object", properties: { role: { type: "string", enum: ["explore", "review"] }, task: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["role", "task"], additionalProperties: false } };

/**
 * 委派使用核心注入的执行入口；工具参数不能提供函数、连接或权限。
 * 完整结构化结果回到原 tool_call_id；失败不被包装成成功的最终回答。
 */
export async function delegateTaskTool(argumentsJson: string, signal: AbortSignal, options: RunOptions): Promise<ToolExecutionResult> {
  parseChildTask(argumentsJson);
  if (!options.delegateTask) throw new ToolError("当前运行没有子任务执行入口。");
  const result: ChildResult = await options.delegateTask(argumentsJson, signal);
  return { content: JSON.stringify(result), isError: result.status !== "completed", metadata: { kind: "subagent", result } };
}
