/**
 * 03.1 识别模型的工具请求 | [NEW] tools/registry.ts
 *
 * 学习目标：把工具定义集中成模型可读取的列表，并规定统一的工具请求形状。
 * 输入：各工具模块导出的定义，以及模型接口返回的服务商字段。
 * 输出：toolDefinitions 和统一的 ToolCall；本节尚不执行工具。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +---------------------+      +-----------------+
 *   | read_file definition| ---> | toolDefinitions |
 *   +---------------------+      +--------+--------+
 *                                         |
 *                                         v
 *                                +-----------------+
 *                                | models/client   |
 *                                | sends tools     |
 *                                +--------+--------+
 *                                         |
 *                          provider tool call fields
 *                                         v
 *                                +-----------------+
 *                                | ToolCall        |
 *                                | id/name/args    |
 *                                +-----------------+
 *
 * 关键点：调用 ID 由模型接口生成，用来把将来的工具结果配回原请求。
 * 参数先保存成 JSON 字符串，等本地准备执行时再解析并检查。
 * 运行观察：两种模型协议返回不同字段，上层最终都收到相同的 ToolCall。
 */

import { readFileDefinition } from "./read-file.js";

// [NEW 03.1] 以下请求类型与工具列表均为本节新增。
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [NEW 03.1] 目前只有一个工具，因此普通数组已经足够，不引入插件框架。
export const toolDefinitions = [readFileDefinition];
