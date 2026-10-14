/**
 * 07.2 停止卡住或输出过多的命令 | [KEEP 来自 07.1] agent/events.ts
 *
 * 学习目标：沿用结构化事件，让界面观察命令的准备、审批与执行，不参与执行决策。
 * 输入：Agent Loop 刚刚发生的模型、工具和审批状态；输出：交给观察者的一份事件副本。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   没有观察者 -> 返回 / 有观察者 -> 深拷贝事件 -> 调用观察者 -> 失败也不改变核心结果。
 * 准备与审批事件沿用第六章，preview 现在也可以表示命令和工作目录。
 * 事件中的参数和命令输出仍可能含有敏感信息，structuredClone 只防止修改原对象，不负责隐藏。
 * 观察：终端使用元数据显示退出码，不需要从模型的最终回答里猜执行结果。
 */

import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";

export type AgentEvent =
  | {
      type: "model_start";
      call: number;
      contextMessages: number;
      trigger: { kind: "user"; content: string } | { kind: "tool_results"; count: number };
    }
  | {
      type: "model_finish";
      call: number;
      outcome: "tools" | "final" | "empty";
      toolRequests: number;
      text: string;
    }
  | { type: "permission_check"; sequence: number; call: ToolCall; decision: PermissionDecision }
  // [KEEP 来自 06.1] 成功事件只额外保存 previewChars，不复制完整预览；原始 call 仍可能包含完整参数。
  // 消费者必须把原始事件投影成安全展示字段，不能把字符数误认为整个事件已经脱敏。
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      previewChars: number;
    }
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    }
  // [KEEP 来自 06.1] 观察者只知道是否有预览；完整文件 diff 或命令预览由审批适配器展示。
  | {
      type: "approval_start";
      sequence: number;
      call: ToolCall;
      scope: string;
      allowSession: boolean;
      hasPreview: boolean;
    }
  | { type: "approval_finish"; sequence: number; call: ToolCall; response: ApprovalResponse }
  | { type: "tool_start"; sequence: number; call: ToolCall }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      result: ToolExecutionResult;
    }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    };

export type AgentObserver = (event: AgentEvent) => void;

/**
 * 把事件快照交给可选观察者，同时隔离观察者自身的异常。
 *
 * - 输入：可选观察者和 Agent Loop 刚刚产生的生命周期事实。
 * - 输出：观察者存在时同步收到一份深拷贝；不存在时直接返回。
 * - 关键原因：structuredClone() 防止观察者修改工具请求或结果对象。
 * - 失败方式：终端或 TUI 观察者抛出的异常会被隔离，不会改变核心执行。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 观察通道是旁路，不能改变模型、工具和历史的执行结果。
  }
}
