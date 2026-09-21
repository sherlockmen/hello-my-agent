/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/types.ts
 *
 * 本节新增 grep 的结构化位置元数据。给模型的匹配正文仍保存在 `content`，
 * 观察事件只需读取不含源码正文的 path、line 和 column。
 */

export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: number }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] }
  // [CHANGED 04.2] grep 为界面提供位置元数据，匹配正文仍只进入 content。
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
