/**
 * 04.1 控制文件搜索范围 | [CHANGED] tools/registry.ts
 *
 * 学习目标：在允许列表中登记 read_file 和 glob，并把统一请求转交给对应工具。
 * 输入：模型返回的工具名称、JSON 参数和本轮取消信号。
 * 输出：工具给模型的 content 与给观察事件的 metadata；未知名称抛出 ToolError。
 *
 * 本文件只负责“允许什么、执行哪个”。终端文案位于 ui/teaching-trace.ts，
 * 因此以后接入 JSONL 或 TUI 时不需要修改注册表。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
import type { ToolExecutionResult } from "./types.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [CHANGED 04.1] 允许列表加入 glob；工具统一返回 ToolExecutionResult。
export const toolDefinitions = [readFileDefinition, globDefinition];

/**
 * 在本地允许列表中查找并执行模型请求的工具。
 *
 * 调用 ID 由 Agent Loop 配回消息；注册表不修改历史，也不生成任何界面文本。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
