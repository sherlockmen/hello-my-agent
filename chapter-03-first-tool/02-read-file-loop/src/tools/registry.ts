/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] tools/registry.ts
 *
 * 学习目标：让 Agent Loop 只通过一个入口查找并执行工具。
 * 输入：统一的 ToolCall，包含调用 ID、名称和 JSON 参数。
 * 输出：已知名称转交对应实现；未知名称抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      name == read_file？
 *   | ToolCall | ---> | 是 --> readFileTool(arguments) --> 文本
 *   +----------+      | 否 --> ToolError
 *
 * 关键点：模型只能请求工具，真正可执行的名称由本地注册表决定。
 * 调用 ID 不参与文件读取；Agent Loop 会用它把结果配回原来的工具请求。
 * 运行观察：read_file 可以执行；任何未注册名称都不会变成函数调用。
 */

import { ToolError } from "../errors.js";
import { readFileDefinition, readFileTool } from "./read-file.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition];

// [NEW 03.2] 使用显式分支即可覆盖当前唯一工具；工具增多后再扩展注册方式。
/**
 * 把已登记的工具名称对应到本地实现。
 *
 * 输入是通过模型适配层检查的 ToolCall；这里只在明确的名称分支里调用工具。
 * 成功返回工具的文本结果，未知名称抛出 ToolError；具体参数仍由对应工具校验。
 * 调用 ID 留给 Agent Loop 配对结果，注册表不修改历史，也不负责终端显示。
 */
export async function executeTool(call: ToolCall): Promise<string> {
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments);
  throw new ToolError(`未知工具：${call.name}`);
}
