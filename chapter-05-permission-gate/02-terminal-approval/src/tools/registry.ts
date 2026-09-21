/**
 * 05.2 在终端中完成一次审批 | [KEEP 来自 04.3] tools/registry.ts
 *
 * 学习目标：复用 read_file、glob 和 grep 的统一允许列表与分派入口。
 * 输入：模型返回的工具名称、JSON 参数和本轮取消信号。
 * 输出：工具给模型的 content 与给观察事件的 metadata；未知名称抛出 ToolError。
 *
 * read_file 的参数和结果已在 04.3 扩展。第五章沿用同一注册表，它仍只负责按名称分派，
 * 不跟随权限策略、界面展示或工具内部结果结构增加条件。
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
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
