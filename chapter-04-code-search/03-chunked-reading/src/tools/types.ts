/**
 * 04.3 把代码位置变成上下文 | [CHANGED] tools/types.ts
 *
 * 本节给 read_file 元数据加入实际行号范围和 `hasMore`。模型继续接收带行号正文，
 * 界面则可以只显示本次读取了哪一段，不需要反向解析正文字符串。
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
