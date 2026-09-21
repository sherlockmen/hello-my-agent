/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/registry.ts
 *
 * 学习目标：把 grep 加入允许列表，让同一个分派入口可以读取文件、发现路径和搜索内容。
 * 输入：模型返回的工具名称、JSON 参数和本轮取消信号。
 * 输出：工具给模型的 content 与给观察事件的 metadata；未知名称抛出 ToolError。
 *
 * 本文件只负责“允许什么、执行哪个”。终端文案位于 ui/teaching-trace.ts，
 * 新增工具不会让 Agent Loop 出现按工具名称编写的分支。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
// [CHANGED 04.2] 注册表接入 grep 定义与执行函数。
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
