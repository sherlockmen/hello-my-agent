/**
 * 06.1 先预览，再创建文件 | [CHANGED] tools/registry.ts
 *
 * 学习目标：收到工具名后找到对应实现，让主循环不用直接认识每种文件工具。
 * 输入：模型提出的工具名、JSON 参数和本轮取消信号。
 * 输出：读取直接返回工具结果；写入先返回预览和函数，批准后再执行。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   prepareTool -> 写入工具？-- 是 --> 调用准备函数 -> 返回 preview / execute，或抛错
 *                           +-- 否 --> 返回 null
 *   executeTool -> 已登记的只读工具？-- 是 --> 调用工具 -> 返回结果，或抛错
 *                                   +-- 否 --> 拒绝直接写入或未知工具
 *   executePreparedTool -> 调用保存的 execute -> 返回实际结果，或抛错
 *
 * permissions/policy.ts 决定这次能不能执行，这里只负责把调用交给正确的工具。
 * 准备完成时文件还没保存；执行保存的函数以后，才知道真正的结果。
 * 运行观察：文件工具准备成功后先出现审批，读取工具继续沿用原来的执行方式。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [CHANGED 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
export const toolDefinitions = [readFileDefinition, globDefinition, grepDefinition, writeFileDefinition];

/**
 * 找到本次写入工具，先让它准备内容和预览。
 *
 * write_file 返回 PreparedToolCall，只读工具返回 null。
 * 主循环在权限判断之后、询问用户之前调用这里，所以准备函数不能保存文件。
 * 准备失败时抛出的 ToolError 会回到主循环，再作为工具错误告诉模型。
 */
// [NEW 06.1] Agent Loop 在 ask 之后、审批之前调用这个准备入口。
export async function prepareTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<PreparedToolCall | null> {
  signal.throwIfAborted();
  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal);
  return null;
}

/**
 * 执行已登记的只读工具，拒绝绕过预览的直接写入。
 *
 * 输入是模型请求和取消信号。找到对应的读取实现就返回它的结果，
 * 写入或未知工具则抛出 ToolError。调用 ID 和结果怎样加入历史，由 Agent Loop 处理。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  if (call.name === writeFileDefinition.name) {
    throw new ToolError("write_file 必须先生成差异预览并获得本次批准。");
  }
  throw new ToolError(`未知工具：${call.name}`);
}

/**
 * 调用已经准备好、并由主循环批准的写入函数。
 *
 * 这里直接把取消信号传给 prepared.execute，返回它的结果或继续抛出错误。
 * 不再生成正文，所以真正保存的内容仍来自之前准备的那份数据。
 * 是否获批由调用方检查；具体文件检查和写入仍在工具内部完成。
 */
// [NEW 06.1] 写入副作用只有这一条注册表出口。
export function executePreparedTool(
  prepared: PreparedToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  return prepared.execute(signal);
}
