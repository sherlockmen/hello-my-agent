/**
 * 06.3 保存之前，检查文件有没有变化 | [CHANGED] tools/types.ts
 *
 * 学习目标：分清“准备好了”和“已经执行完了”这两种结果。
 * 输入：工具准备的 diff 和执行函数，以及实际执行后的结果正文与元数据。
 * 输出：PreparedToolCall 交给主循环审批；ToolExecutionResult 分别供模型和界面使用。
 *
 * 数据关系：准备 -> preview 给人看 / execute 在批准后调用 -> 实际工具结果。
 * 这里只定义类型，不读写文件，也不记住批准。运行时应先看到预览，执行后才看到成功结果。
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
    }
  // [KEEP 来自 06.1] 写入结果只暴露路径和字节数，完整内容由审批 diff 展示。
  | { kind: "write_file"; path: string; bytes: number }
  // [CHANGED 06.3] backupPath 是工具已经创建的真实恢复位置；模型和界面不从 content 解析它。
  | { kind: "edit_file"; path: string; bytes: number; backupPath: string };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};

/**
 * 把要显示的预览和批准后要调用的函数放在一起。
 *
 * preview 给人看；execute 闭包记住本次的路径、正文和检查数据。
 * 主循环等待审批后继续使用这个结果：拒绝就跳过，批准就为当前请求执行一次。
 * 实际文件内容来自准备时的正文，不是带有差异标记的 preview。
 */
// [KEEP 来自 06.1] 待执行修改把无副作用的准备阶段与真正写入分开。
export type PreparedToolCall = {
  preview: string;
  execute(signal: AbortSignal): Promise<ToolExecutionResult>;
};
