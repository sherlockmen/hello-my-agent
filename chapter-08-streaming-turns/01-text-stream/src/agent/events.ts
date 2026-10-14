/**
 * 08.1 让回答逐段显示 | [CHANGED] agent/events.ts
 *
 * 学习目标：沿用观察通道，把生成中的文字也交给界面，不让显示逻辑进入主循环。
 * 输入：Agent Loop 产生的文字片段、完整模型结果、权限与工具事件。
 * 输出：观察者收到事件副本；没有观察者时不做事，观察者失败也不改变执行结果。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [NEW] text_delta 或 [KEEP] 其他事件 -> 有观察者？-- 否 -> 返回
 *                                               +-- 是 -> 拷贝事件 -> 调用观察者
 *   拷贝或观察失败 -> 捕获异常 -> 返回；成功 -> 返回
 *
 * [NEW] 表示新增文字事件，[KEEP] 表示沿用；call 把片段归到本轮的某次模型请求。
 * text_delta 只说明有新文字，model_finish 才描述完整返回内容；两者都不产生工具批准。
 * structuredClone 防止观察者修改原始数据，但不会自动隐藏参数或命令输出中的敏感信息。
 * 运行观察：终端收到片段就显示文字，工具请求仍走原来的权限与审批事件。
 */

import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";

// [CHANGED 08.1] 原有观察通道增加文字片段，后续 TUI 可消费同一种事件。
export type AgentEvent =
  | { type: "text_delta"; call: number; text: string }
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
