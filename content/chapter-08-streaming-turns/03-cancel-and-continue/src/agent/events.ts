/**
 * 08.3 中断当前任务，继续对话 | [KEEP 来自 08.2] agent/events.ts
 *
 * 学习目标：让界面区分正常完成、请求工具和未完成的模型响应。
 * 输入：Agent Loop 的文字、模型结束、权限与工具事件；输出：观察者收到一份副本。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] model_finish 携带 finishReason；text_delta 仍只携带文字片段
 *   事件 -> 有观察者？-- 否 -> 返回
 *                    +-- 是 -> 拷贝事件 -> 调用观察者
 *   拷贝或观察失败 -> 捕获异常 -> 返回；成功 -> 返回
 *
 * [KEEP] 表示沿用前节。outcome=incomplete 告诉界面本次响应没有正常完成，不能把“停止生成”当作成功。
 * 事件只报告已经发生的状态，审批 handler 才是主循环等待的控制入口。
 * 深拷贝只防止修改原对象，不负责隐藏敏感信息；显示层仍需选字段并整理输出。
 * 运行观察：长度上限或拒绝可以显示独立状态，文字片段依旧逐段出现。
 */

// [KEEP 来自 08.2] 事件展示统一结束原因。
import type { ModelFinishReason } from "../models/client.js";
import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";

// [KEEP 来自 08.1] 原有观察通道增加文字片段，后续 TUI 可消费同一种事件。
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
      // [KEEP 来自 08.2] 停止生成不一定代表回答完成。
      outcome: "tools" | "final" | "empty" | "incomplete";
      finishReason: ModelFinishReason;
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
