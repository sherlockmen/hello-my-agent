/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/registry.ts
 *
 * 学习目标：把 grep 加入允许列表，让模型能从路径发现继续缩小到具体代码行。
 * 输入：统一的 ToolCall，包含调用 ID、名称和 JSON 参数。
 * 输出：已知名称转交对应实现；未知名称抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      name？
 *   | ToolCall | ---> +-- read_file --> readFileTool --> 文件内容
 *   +----------+      +-- glob ------> globTool -----> 路径列表
 *                     +-- grep ------> grepTool -----> 匹配位置
 *                     +-- 其他 ----------------------> ToolError
 *
 * 关键点：glob 回答“哪些文件名符合条件”，grep 回答“代码出现在哪一行”，read_file 读取上下文。
 * 注册表只分派已登记名称；新增工具不会改变 Agent Loop 的控制结构。
 * 运行观察：模型可以依次使用 glob、grep 和 read_file 完成一次代码定位。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition, globDefinition, grepDefinition];

/**
 * 把模型给出的工具名转换成可以安全显示的本地名称。
 *
 * - 输入：模型返回的未可信工具名。
 * - 输出：注册表中的规范名称；未注册时返回固定文字“未知工具”。
 * - 关键原因：过程输出不能直接打印模型生成的名称，否则换行和控制字符会污染终端。
 * - 职责边界：这里只生成显示名称，不判断参数，也不执行工具。
 */
export function getRegisteredToolName(name: string): string {
  return toolDefinitions.find((tool) => tool.name === name)?.name ?? "未知工具";
}

/**
 * 在程序允许使用的工具列表中查找并执行模型请求的工具。
 *
 * - 输入：已经过协议基础字段检查的统一 `ToolCall`，以及本轮 `AbortSignal`。
 * - 输出：按名称返回文件内容、路径列表或内容匹配位置。
 * - 关键步骤：只按显式允许的名称分派，并把同一个取消信号传入具体工具。
 * - 失败方式：名称未注册或参数失败时抛出 `ToolError`；取消时保留 `AbortError`。
 * - 职责边界：调用 ID 由 Agent Loop 配回结果，本函数不修改会话历史。
 */
export async function executeTool(call: ToolCall, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
