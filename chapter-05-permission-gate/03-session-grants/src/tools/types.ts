/**
 * 05.3 让 Agent 记住本次运行的批准 | [KEEP 来自 04.3] tools/types.ts
 *
 * 学习目标：把发给模型的工具正文和供界面显示的摘要数据分开。
 * 输入：文件工具执行后获得的路径、位置、行号和截断信息。
 * 输出：ToolExecutionResult 用 content 保存正文，用 metadata 保存对应摘要数据。
 * 只定义数据形状，不执行工具或修改历史。界面读取 metadata，不用从正文里反向解析数量。
 */

export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: 0 }
  | {
      kind: "read_file";
      lineCount: number;
      startLine: number;
      endLine: number;
      hasMore: boolean;
    }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] }
  | {
      kind: "grep";
      count: number;
      truncated: boolean;
      locations: Array<{ path: string; line: number; column: number }>;
    };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};
