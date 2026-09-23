/**
 * 04.3 把代码位置变成上下文 | [KEEP 来自 04.1] agent/events.ts
 *
 * 学习目标：让界面知道主循环进行到哪一步，而不参与执行决定。
 * 输入：主循环产生的模型开始、模型返回、工具开始和工具返回事件。
 * 输出：把事件副本交给可选观察者；观察者出错也不修改主循环的数据。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   event -> 有观察者？ -- 否 --> 返回
 *                  | 是
 *                  v
 *              复制事件 -> 同步调用观察者
 *                               | 成功 --> 返回
 *                               | 抛错 --> 接住异常后返回
 *
 * 事件记录数量、请求和结果，不决定终端文案。当前消费者是教学终端；
 * 第 09 章继续扩展 JSONL 和送达方式，第 10 章再接入 TUI。
 * 运行观察：关闭观察者仍可得到同样的工具结果，显示失败不会中止一次成功读取。
 */

import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";

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
 * 把当前步骤交给观察者显示，同时保护主循环正在使用的数据。
 *
 * 有 observer 时，同步发送 structuredClone() 得到的副本；没有时直接返回。
 * 观察者即使修改副本，也不会改到真实工具参数；观察者抛出异常时，这里会接住它。
 * 因此显示失败不会变成工具执行失败。此处不等待异步回调，异步送达留到第 09 章。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 观察通道是旁路，不能改变模型、工具和历史的执行结果。
  }
}
