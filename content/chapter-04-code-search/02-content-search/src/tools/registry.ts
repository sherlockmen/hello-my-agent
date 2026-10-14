/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/registry.ts
 *
 * 学习目标：让主循环通过同一个入口找到本地工具。
 * 输入：ToolCall 中的名称与 JSON 参数，以及本轮取消信号。
 * 输出：工具产生的 content 与 metadata；未知名称抛出 ToolError，不修改历史。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   ToolCall -> 已取消？ -- 是 --> 抛出取消异常
 *                   | 否
 *                   v
 *               名称已登记？ -- 否 --> ToolError
 *                   | 是
 *                   v
 *               read_file / glob / grep -> 对应工具结果
 *
 * 本节增加 grep，Agent Loop 仍然只调用同一个 executeTool()。
 * 登记只说明程序提供什么工具；第 05 章再独立判断某次请求是否允许执行。
 * 运行观察：新增工具仍按原调用 ID 回传，未登记名称不会变成任意函数调用。
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
 * 把已登记的工具名称对应到本地实现并把同一个取消信号交给工具。
 *
 * 输入是通过模型适配层检查的 ToolCall；这里只在明确的名称分支里调用工具。
 * 成功返回工具的content 和 metadata，未知名称抛出 ToolError；具体参数仍由对应工具校验。
 * 调用 ID 留给 Agent Loop 配对结果，注册表不修改历史，也不负责终端显示。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  // [NEW 04.2] 新增内容搜索分支，继续传递同一个取消信号。
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
