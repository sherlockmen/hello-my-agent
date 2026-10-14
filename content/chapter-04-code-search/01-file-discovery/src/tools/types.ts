/**
 * 04.1 控制文件搜索范围 | [NEW] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节引入正文与元数据两个字段，glob 返回路径，read_file 返回行数。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
 */

// [NEW 04.1] 本文件以下工具结果与观察元数据契约均为本节新增。
export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: number }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};
