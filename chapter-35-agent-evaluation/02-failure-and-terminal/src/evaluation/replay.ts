/**
 * 35.2 故障与终端回归 | [CHANGED] evaluation/replay.ts
 * 学习目标：把固定响应交给真实核心，并要求上一批工具结果已经进入消息
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：响应清单 -> 核对调用ID -> 完整ModelResult。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import type { Message, Model, ModelResult } from "../models/client.js";
import type { ToolCall } from "../tools/registry.js";

// [CHANGED 35.2] 故障名字同时进入报告，不能与任务完成混为一列。
export type Scenario = "repair" | "claim-only" | "denied" | "missing-file" | "protected-edit" | "cancel-after-edit";
export const SCENARIOS: readonly Scenario[] = ["repair", "claim-only", "denied", "missing-file", "protected-edit", "cancel-after-edit"];

/** 只建立模型请求的数据，不直接读取、编辑或测试样本。 */
function call(id: string, name: string, input: Record<string, unknown>): ToolCall {
  return { id, name, arguments: JSON.stringify(input) };
}

/** 固定响应不伪造远端用量，空值不表示一次免费在线请求。 */
function result(toolCalls: ToolCall[] = [], text = ""): ModelResult {
  return { text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop",
    inputTokens: null, outputTokens: null, truncated: false };
}

/**
 * 逐次给出读、改、测决定；下一次调用先核对上一批结果，而不是绕开Agent Loop。
 * 每个实例独占游标；缺失结果或额外调用抛错，暴露漏回传与终止分支回归。
 */
export function createReplay(scenario: Scenario = "repair"): Model {
  let frames = [
    result([call("read-source", "read_file", { path: "src/add.mjs", offset: 1, limit: 40 }),
      call("read-tests", "read_file", { path: "test/add.test.mjs", offset: 1, limit: 40 })]),
    result([call("fix-add", "edit_file", { path: "src/add.mjs", old_text: "return a - b;", new_text: "return a + b;" })]),
    result([call("test-add", "check_project", { script: "test" })]),
    result([], "加法已修复，测试通过。"),
  ];
  // [CHANGED 35.2] 只改模型决定；拒绝仍来自审批器，取消来自本地控制器。
  if (scenario === "claim-only") frames = [result([], "已经修好，全部测试通过。")];
  if (scenario === "denied" || scenario === "cancel-after-edit") frames = [frames[0], frames[1], result([], "本次操作结束。")];
  if (scenario === "missing-file") frames = [result([call("missing", "read_file", { path: "missing.mjs", offset: 1, limit: 20 })]), result([], "读取未完成。")];
  if (scenario === "protected-edit") frames = [frames[0], result([call("edit-tests", "edit_file", { path: "test/add.test.mjs", old_text: '"positive"', new_text: '"changed"' })]), result([], "本次操作结束。")];
  let index = 0;
  return {
    async generate(messages: Message[], signal: AbortSignal) {
      signal.throwIfAborted();
      const previous = frames[index - 1];
      for (const tool of previous?.toolCalls ?? []) {
        if (!messages.some(message => message.role === "tool" && message.toolCallId === tool.id)) {
          throw new Error("回放没有收到上一批全部工具结果。");
        }
      }
      const frame = frames[index++];
      if (!frame) throw new Error("回放响应已耗尽。");
      return structuredClone(frame);
    },
  };
}
