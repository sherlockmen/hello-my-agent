/**
 * 05.2 在终端中完成一次审批 | [KEEP 来自 04.3] tools/registry.ts
 *
 * 学习目标：收到工具名后找到本地对应实现，让主循环不用直接调用每个文件工具。
 * 输入：已经过权限检查的工具请求，以及本轮取消信号。
 * 输出：工具给模型的 content 和给界面的 metadata；未知工具名抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具名已登记？-- 是 --> 调用 read_file / glob / grep --> 返回结果或抛错
 *                 +-- 否 --> ToolError
 *
 * 登记列表说明程序提供哪些工具，不能代替本次请求的权限判断。
 * 调用 ID、错误结果和消息历史仍由 Agent Loop 处理。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
import type { ToolExecutionResult } from "./types.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition, globDefinition, grepDefinition];

/**
 * 找到本地工具并执行，返回它的实际结果。
 *
 * 按名称选择 read_file、glob 或 grep，未知名称抛出 ToolError。
 * 权限检查应已由调用方完成；调用 ID、错误怎样写回消息，都由 Agent Loop 处理。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
