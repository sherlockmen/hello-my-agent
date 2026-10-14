/**
 * 04.1 控制文件搜索范围 | [NEW] ui/teaching-trace.ts
 *
 * 学习目标：把模型和工具的来回显示出来，便于观察一次任务怎样完成。
 * 输入：主循环发送的 AgentEvent 副本，以及本地工具 Schema。
 * 输出：供终端逐行打印的文字；这里不调用模型、不执行工具，也不修改历史。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   AgentEvent -> 哪种事件？
 *                  | 模型开始/返回 -> 新增信息或返回类型
 *                  | 工具开始 ----> 已登记名称 + 允许显示的参数
 *                  | 工具成功 ----> 元数据中的数量与位置
 *                  | 工具失败 ----> 固定失败说明
 *
 * 本节首次把模型与工具事件写成中文过程记录。
 * 路径和参数先单行化、限长并隐藏常见凭据词特征；这不是对任意敏感信息的完整识别。
 * 运行观察：终端显示搜索到多少项、读取了哪些行，模型收到的完整正文仍走工具消息。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";

// [NEW 04.1] 本文件以下安全摘要与教学追踪实现均为本节新增。
const MAX_TRACE_VALUE_CHARS = 60;

/**
 * 把问题、参数或路径处理成一行简短的显示文字。
 *
 * 先移除控制字符并合并空白，命中常见凭据词特征时显示“已隐藏”。
 * 过长时保留前 maxChars 个处理后的字符，再追加省略号；这里只改显示副本。
 * 这种词特征检查不能识别所有秘密，原始事件也不能未经筛选直接当作公开日志。
 */
function toTraceText(value: string, maxChars = MAX_TRACE_VALUE_CHARS): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/secret|api[\s_-]?key|token|password|authorization/i.test(oneLine)) return "[已隐藏]";
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

/**
 * 只显示本地工具说明里允许出现的参数字段。
 *
 * 输入是事件中的 ToolCall。未知工具不显示参数；参数过长、不能解析为对象时显示固定提示。
 * 已知字段中的字符串再交给 toTraceText() 处理，避免把控制字符和明显凭据直接打到终端。
 * 这里生成显示摘要，不替代工具真正执行前的参数校验。
 */
function describeToolCall(call: ToolCall): { name: string; input: string } {
  const definition = toolDefinitions.find((tool) => tool.name === call.name);
  if (!definition) return { name: "未知工具", input: "参数不展示" };
  if (call.arguments.length > 1000) return { name: definition.name, input: "参数无法解析" };

  let input: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(call.arguments);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { name: definition.name, input: "参数无法解析" };
    }
    input = value as Record<string, unknown>;
  } catch {
    return { name: definition.name, input: "参数无法解析" };
  }

  const fields = Object.keys(definition.inputSchema.properties).map((key) => {
    const value = input[key];
    if (typeof value === "string") return `${key}=${JSON.stringify(toTraceText(value))}`;
    if (typeof value === "number" || typeof value === "boolean") return `${key}=${value}`;
    return `${key}=<无效>`;
  });
  return { name: definition.name, input: fields.join("，") };
}

/**
 * 根据工具自己提供的元数据，生成结果摘要。
 *
 * glob 显示路径数和最多两个示例，read_file 显示行数。
 * 路径示例还会经过显示筛选。这里不读取 content，所以无需从源码正文反推数量和位置。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  return `${metadata.lineCount} 行文件内容`;
}

/**
 * 把一次模型或工具事件写成几行可读的过程记录。
 *
 * 模型事件显示第几次请求、收到什么新增信息、返回回答还是工具请求。
 * 工具事件显示调用摘要和执行结果，失败时使用固定说明，不直接打印底层错误。
 * 返回字符串数组，由 terminal.ts 决定怎样输出；这里不执行工具，也不改变历史。
 */
export function formatTeachingTrace(event: AgentEvent): string[] {
  if (event.type === "model_start") {
    const received = event.trigger.kind === "user"
      ? `新增用户问题「${toTraceText(event.trigger.content, 100)}」`
      : `新增 ${event.trigger.count} 条工具结果`;
    return [
      `模型 > 第 ${event.call} 次决策`,
      `  收到：${received}；Agent Loop 消息链共 ${event.contextMessages} 条。`,
    ];
  }

  if (event.type === "model_finish") {
    const result = event.outcome === "tools"
      ? `${event.toolRequests} 个工具请求。`
      : event.outcome === "final"
        ? "最终回答，交给终端显示。"
        : "空结果，本轮将停止并报告错误。";
    return [`模型 < 第 ${event.call} 次决策`, `  返回：${result}`];
  }

  const tool = describeToolCall(event.call);
  if (event.type === "tool_start") {
    return [
      `工具 > 第 ${event.sequence} 步：${tool.name}`,
      `  执行：${tool.input}。`,
    ];
  }

  const failed = event.outcome === "error";
  return [
    `工具 < 第 ${event.sequence} 步：${tool.name}${failed ? " 失败" : " 完成"}`,
    `  返回：${failed ? "执行失败" : describeToolResult(event.result.metadata)}。`,
    `  去向：${failed ? "错误" : "结果"}已加入当前回合，下一次模型决策会收到。`,
  ];
}
