/**
 * 07.3 让搜索也使用受控子进程 | [KEEP 来自 07.2] tools/types.ts
 *
 * 学习目标：区分操作准备、实际执行结果，以及命令本身是否成功。
 * 输入：工具给出的预览与执行函数，或已运行完成的结果正文与元数据。
 * 输出：PreparedToolCall 用于审批；ToolExecutionResult.content 给模型，metadata 给界面。
 *
 * 数据关系：准备 -> preview / execute -> 用户批准 -> 实际结果 -> 模型与界面。
 * isError=true 也可以有完整 content：测试非零退出时，报告不能随错误标记一起丢掉。
 * 这里定义数据形状，不执行命令或修改文件。观察：终端能直接显示退出码和两条输出。
 */

// [KEEP 来自 07.1] 命令输出和退出状态同时交给模型与界面。
export type ToolResultMetadata =
  | { kind: "run_command"; exitCode: number | null; signal: string | null; stdout: string; stderr: string; stopReason?: "timeout" | "output_limit" }
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
  // [KEEP 来自 06.3] backupPath 是工具已经创建的真实恢复位置；模型和界面不从 content 解析它。
  | { kind: "edit_file"; path: string; bytes: number; backupPath: string };

export type ToolExecutionResult = {
  // [KEEP 来自 07.1] 命令可以正常返回结果，但测试本身失败。
  isError?: boolean;
  content: string;
  metadata: ToolResultMetadata;
};

/**
 * 把操作预览和批准后要调用的函数放在一起。
 *
 * preview 给人看；execute 闭包记住本次文件修改或命令，以及执行前需复查的数据。
 * 主循环等待审批后继续使用这个结果：拒绝就跳过，批准就为当前请求执行一次。
 * preview 只用来展示，不拿它写文件或当作待执行的 shell 命令。
 */
// [KEEP 来自 06.1] 准备结果把参数检查和预览，与真正写入或启动命令分开。
export type PreparedToolCall = {
  preview: string;
  execute(signal: AbortSignal): Promise<ToolExecutionResult>;
};
