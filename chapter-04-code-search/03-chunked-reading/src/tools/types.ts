/**
 * 04.3 把代码位置变成上下文 | [CHANGED] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节给 read_file 增加起止行和 hasMore，空文件单独用 lineCount=0 表示。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
 */

export type ToolResultMetadata =
  // [CHANGED 04.3] read_file 元数据开始区分空文件和带范围的源码片段。
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
