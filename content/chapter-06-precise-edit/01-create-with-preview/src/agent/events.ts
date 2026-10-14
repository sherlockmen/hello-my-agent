/**
 * 06.1 先预览，再创建文件 | [CHANGED] agent/events.ts
 *
 * Agent Loop 用事件告诉界面“刚刚发生了什么”，终端再把它转成界面上显示的文字。
 * 这次增加准备成功或失败的通知，以及审批是否带有预览的信息，方便看清准备、审批、执行的顺序。
 * 事件中的工具参数仍可能含有完整正文。structuredClone() 防止观察者改回原对象，不负责隐藏内容；
 * 所以终端要选出需要显示的字段，不能直接打印或记录整个事件。
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
  // [CHANGED 06.1] 准备成功时记录预览长度，让界面知道内容已准备好；不在事件中另存 diff。
  // call 仍含原始参数，所以显示时还要挑选字段，不能直接打印整个事件。
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
  // [CHANGED 06.1] hasPreview 只说明审批界面收到 diff；原始 call 仍保留工具参数。
  // 观察者抛错不能批准、拒绝或启动工具。
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
