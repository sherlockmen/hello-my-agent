/**
 * 04.1 控制文件搜索范围 | [CHANGED] tools/registry.ts
 *
 * 学习目标：在原有 read_file 之外注册 glob，让模型先找路径再读取内容。
 * 输入：统一的 ToolCall，包含调用 ID、名称和 JSON 参数。
 * 输出：已知名称转交对应实现；未知名称抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      name？
 *   | ToolCall | ---> +-- read_file --> readFileTool --> 文本
 *   +----------+      +-- glob ------> globTool -----> 路径列表
 *                     +-- 其他 ----------------------> ToolError
 *
 * 关键点：工具注册表同时提供模型可见的定义和本地可执行的分派，两边名称必须一致。
 * glob 只发现路径，read_file 才读取内容；模型不能通过生成任意函数名获得新能力。
 * 运行观察：模型可以先请求 glob，再根据结果选择文件交给 read_file。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { readFileDefinition, readFileTool } from "./read-file.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition, globDefinition];

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
 * - 输出：`read_file` 返回文件内容，`glob` 返回路径列表。
 * - 关键步骤：只按显式允许的名称分派，并把同一个取消信号传入具体工具。
 * - 失败方式：名称未注册或参数失败时抛出 `ToolError`；取消时保留 `AbortError`。
 * - 职责边界：调用 ID 由 Agent Loop 配回结果，本函数不修改会话历史。
 */
export async function executeTool(call: ToolCall, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
