/**
 * 05.1 让工具调用先经过权限策略 | [CHANGED] ui/teaching-trace.ts
 *
 * 学习目标：把主循环的事件写成终端中可以跟着阅读的过程记录。
 * 输入：模型、权限、工具的原始事件。
 * 输出：选取必要字段、缩短过长文字并隐藏常见凭据后的文本行，不修改原事件。
 * 本节增加权限判断和原因，遇到 ask 会说明当前尚未接入审批。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";

const MAX_TRACE_VALUE_CHARS = 60;

/**
 * 把文字整理成可以放进一行过程记录的短文本。
 *
 * 清理控制字符、合并空白、隐藏常见凭据特征，再按指定长度截断。
 * 返回值只用于显示，不修改原始事件。
 */
function toTraceText(value: string, maxChars = MAX_TRACE_VALUE_CHARS): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/secret|api[\s_-]?key|token|password|authorization/i.test(oneLine)) return "[已隐藏]";
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

/**
 * 从工具请求中取出名称和需要显示的参数。
 *
 * 只显示已登记工具 Schema 中声明的字段；未知工具、无效或过长参数会显示固定提示。
 * 参数值继续经过 toTraceText，避免把原始请求直接打印到终端。
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
 * 从工具的元数据生成结果摘要。
 *
 * 根据工具类型显示数量、行号或少量位置示例，不读取给模型的 content。
 * 这样终端不用解析源码正文，也能说明这次工具返回了什么规模的结果。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }
  if (metadata.kind === "grep") {
    const examples = metadata.locations.slice(0, 2)
      .map(({ path, line, column }) => `${toTraceText(path)}:${line}:${column}`)
      .join("，");
    return `${metadata.count} 个匹配位置${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  if (metadata.lineCount === 0 || !("startLine" in metadata)) return "0 行文件内容";
  return `${metadata.lineCount} 行源码（第 ${metadata.startLine}—${metadata.endLine} 行）`;
}

/**
 * 把一个结构化生命周期事件排版成终端行。
 *
 * 返回纯文本而不是直接调用 console，便于普通终端、测试和后续其他界面复用事件源。
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

  // [CHANGED 05.1] 终端开始显示 allow、ask、deny 及其本地原因。
  if (event.type === "permission_check") {
    const tool = describeToolCall(event.call);
    const decision = event.decision.action === "allow"
      ? "允许执行"
      : event.decision.action === "ask"
        ? "需要用户确认，本节先阻止执行"
        : "拒绝执行";
    return [
      `权限 < 第 ${event.sequence} 步：${tool.name}`,
      `  判断：${decision}；原因：${toTraceText(event.decision.reason, 100)}。`,
      ...(event.decision.action === "ask"
        ? [`  请求：${toTraceText(event.decision.resource)}；可批准范围：${toTraceText(event.decision.scope)}。`]
        : []),
    ];
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
