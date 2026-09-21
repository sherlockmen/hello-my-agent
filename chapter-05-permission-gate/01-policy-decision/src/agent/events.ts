/**
 * 05.1 让工具调用先经过权限策略 | [CHANGED] agent/events.ts
 *
 * 本节增加 permission_check，让界面知道工具为什么被允许、待确认或拒绝。
 * 事件只描述事实；当前终端、第 09 章 JSONL 和第 10 章 TUI 使用同一接口。
 */

import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { PermissionDecision } from "../permissions/policy.js";

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
  // [CHANGED 05.1] 权限判断成为可观察事件，但观察者仍不能批准操作。
  | { type: "permission_check"; sequence: number; call: ToolCall; decision: PermissionDecision }
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
