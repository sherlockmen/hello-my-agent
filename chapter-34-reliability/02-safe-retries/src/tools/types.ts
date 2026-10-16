/**
 * 34.2 只重试可以安全重发的请求 | [KEEP] tools/types.ts
 *
 * 学习目标：用同一工具契约携带网页启用状态、来源及字节元数据；网页正文通过 content 回模型，显示信息通过 metadata 回界面。
 * 输入：本地网页状态、工具准备出的预览和执行闭包，或已取得的正文、来源与截断标志。
 * 输出：PreparedToolCall 用于审批；ToolExecutionResult.content 给模型，metadata 给界面。
 * 状态：这里只有类型声明，不会执行操作，也没有运行时状态提交。
 *
 * 本文件局部流程（数据关系；全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 准备结果 -> preview / execute；执行结果 -> content / metadata。
 * isError=true 也可以有完整 content：测试非零退出时，报告不能随错误标记一起丢掉。
 * 这里定义数据形状，不执行命令或修改文件。观察：终端能直接显示退出码和两条输出。
 */

import type { TaskItem } from "../agent/run-options.js";

// [KEEP 来自 07.1] 命令输出和退出状态同时交给模型与界面。
// [KEEP 来自 21.1] 外部JSON Schema保留原样，工具名由可信映射提供。
export type ToolDefinition = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; [key: string]: unknown } };
// [KEEP 来自 22.1] 来源只由已完整读完的真实HTTP响应提供。
// [KEEP 来自 28.1] 界面直接消费工作区身份，不从工具正文猜测。
export type ToolResultMetadata =
  // [KEEP 来自 32.2] 保存源码身份与符号位置，界面仍沿用普通工具结果。
  | { kind: "code_intelligence"; result: import("../language-service/client.js").CodeResult }
  // [KEEP 来自 29.1] 结果与正文由同一份协调者快照产生。
  | { kind: "shared_tasks"; tasks: import("../collaboration/coordinator.js").SharedTask[] }
  // [KEEP 来自 29.3] 消息与ack在独立元数据中显示，不冒充任务完成。
  | { kind: "agent_messages"; messages: import("../collaboration/coordinator.js").AgentMessage[] }

  | { kind: "worktree"; worktree: import("../workspaces/worktrees.js").WorktreeSnapshot | null }
  // [KEEP 来自 26.1] Job状态在内存登记表；保存metadata不表示能恢复控制权。
  | { kind: "job"; job: import("../processes/jobs.js").JobSnapshot | null }
  | { kind: "subagent"; result: import("../subagents/runner.js").ChildResult }
  | { kind: "web"; sources: import("../web/client.js").WebSource[]; bytes: number; truncated: boolean }
  | { kind: "mcp"; server: string; tool: string }
  // [KEEP 来自 19.3] 来源由工具结构化返回，界面不从正文猜测路径。
  | { kind: "load_skill" | "read_skill_resource"; name: string; path: string; bytes: number; sha256: string }
  // [KEEP 来自 18.2] 已保存编号供界面检查，正文仍回传模型。
  | { kind: "memory"; id: string }
  // [KEEP 来自 12.3] 澄清答案与问题有独立显示字段，不必从正文重新解析。
  | { kind: "ask_user"; question: string; answer: string | null }
  // [KEEP 来自 12.2] 清单条目作为界面数据返回，正文仍交给模型。
  | { kind: "todo_write"; items: TaskItem[] }
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
