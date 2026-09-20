/**
 * 04.1 控制文件搜索范围 | [NEW] tools/types.ts
 *
 * 工具同时产生两种输出：`content` 进入模型上下文，`metadata` 进入观察事件。
 * 元数据只保存结构化事实，不包含终端文案；普通终端、JSONL 和后续 TUI 可以各自决定怎样显示。
 */

export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: number }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};
