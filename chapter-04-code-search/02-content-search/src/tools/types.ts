/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节给 grep 增加位置元数据，包含路径、行号和列号，不保存匹配正文。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
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
