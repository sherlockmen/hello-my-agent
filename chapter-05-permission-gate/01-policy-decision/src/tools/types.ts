/**
 * 05.1 让工具调用先经过权限策略 | [KEEP 来自 04.3] tools/types.ts
 *
 * 04.3 已给 read_file 元数据加入实际行号范围和 `hasMore`。第五章沿用这份契约：
 * 模型接收带行号正文，界面只读取结构化范围，不需要反向解析正文字符串。
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
