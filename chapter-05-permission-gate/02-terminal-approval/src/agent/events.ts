/**
 * 05.2 在终端中完成一次审批 | [CHANGED] agent/events.ts
 *
 * 学习目标：让界面显示什么时候开始等待审批，以及用户作出了什么选择。
 * 输入：Agent Loop 产生的模型、权限、审批和工具事件。
 * 输出：观察者收到事件副本；观察者不存在或抛错时，不改变主循环的处理。
 * 事件只报告已经发生的事，真正的审批回答由 ApprovalHandler 返回。
 * 副本防止观察者改动原对象，但不会自动隐藏参数；界面仍要挑选适合显示的字段。
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
  // [CHANGED 05.2] 审批开始与结束只报告状态，真正决定由 ApprovalHandler 返回。
  | { type: "approval_start"; sequence: number; call: ToolCall; scope: string }
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
 * 把刚发生的事件交给观察者，并避免显示失败打断主循环。
 *
 * 有观察者就同步交给它一份深拷贝，没有则直接返回。副本防止改动原对象，
 * try/catch 则隔离观察者抛出的异常；这两步都不负责审批或隐藏事件中的内容。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 观察通道是旁路，不能改变模型、工具和历史的执行结果。
  }
}
