/**
 * 06.3 保存之前，检查文件有没有变化 | [CHANGED] ui/teaching-trace.ts
 *
 * 把 Agent Loop 的事件整理成简短的终端记录，方便观察一次工具调用走到了哪一步。
 * 文件正文在摘要里显示为字符数，其他文字会限长并隐藏常见凭据，完整 diff 则留给审批界面展示。
 * 这里只改用于显示的副本，事件中的原始参数和工具收到的正文都保持原样。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";

const MAX_TRACE_VALUE_CHARS = 60;

/**
 * 把不可信文字转换成可以放进单行终端记录的短文本。
 *
 * - 输入：用户问题、工具参数或路径，以及本次允许的最大字符数。
 * - 输出：移除控制字符、合并空白、隐藏常见凭据特征并按长度截断的字符串。
 * - 职责边界：只处理界面副本，不修改 Agent Event 中的原始值。
 */
function toTraceText(value: string, maxChars = MAX_TRACE_VALUE_CHARS): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/secret|api[\s_-]?key|token|password|authorization/i.test(oneLine)) return "[已隐藏]";
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

/**
 * 根据本地工具 Schema 生成名称和参数摘要。
 *
 * - 输入：事件中的原始 ToolCall。
 * - 输出：已注册工具只显示 Schema 声明的字段；未知工具使用固定名称且不展示参数。
 * - 安全边界：解析失败、超长参数、控制字符和敏感值都不会原样进入终端。
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
    // [KEEP 来自 06.1] 这里只投影终端摘要；原始 AgentEvent.call.arguments 仍保留完整参数。
    // 文件正文改为字符数，其他文字还会经过控制字符清理、限长和凭据隐藏。
    if (["content", "old_text", "new_text"].includes(key) && typeof value === "string") {
      return `${key}=<${value.length} 字符>`;
    }
    if (typeof value === "string") return `${key}=${JSON.stringify(toTraceText(value))}`;
    if (typeof value === "number" || typeof value === "boolean") return `${key}=${value}`;
    return `${key}=<无效>`;
  });
  return { name: definition.name, input: fields.join("，") };
}

/**
 * 把工具产生的结构化元数据转换成终端结果摘要。
 *
 * - 输入：工具在生成模型正文时同步产生的数量、位置或行号范围。
 * - 输出：只包含结果规模和少量路径示例的短文本。
 * - 关键原因：界面不读取 content，因此不会把匹配行或文件正文误当成展示字段。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  // [CHANGED 06.3] 只在工具成功事件中显示经过结构化元数据传来的备份路径；
  // 内容过期检测或备份失败走错误分支，不伪装成成功结果。
  if (metadata.kind === "edit_file") {
    return `已精确修改 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）；备份：${toTraceText(metadata.backupPath, 120)}`;
  }
  if (metadata.kind === "write_file") {
    return `已创建 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）`;
  }
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

  if (event.type === "permission_check") {
    const tool = describeToolCall(event.call);
    const decision = event.decision.action === "allow"
      ? "允许执行"
      : event.decision.action === "ask"
        ? "需要用户确认"
        : "拒绝执行";
    return [
      `权限 < 第 ${event.sequence} 步：${tool.name}`,
      `  判断：${decision}；原因：${toTraceText(event.decision.reason, 100)}。`,
      ...(event.decision.action === "ask"
        ? [`  请求：${toTraceText(event.decision.resource)}；可批准范围：${toTraceText(event.decision.scope)}。`]
        : []),
    ];
  }

  if (event.type === "tool_prepare") {
    const tool = describeToolCall(event.call);
    return event.outcome === "success"
      ? [
          `变更 < 第 ${event.sequence} 步：${tool.name} 已生成待审批修改`,
          `  结果：完整差异共 ${event.previewChars} 个字符；此时尚未写入文件。`,
        ]
      : [
          `变更 < 第 ${event.sequence} 步：${tool.name} 无法生成待审批修改`,
          `  原因：${toTraceText(event.error, 100)}；错误将交回模型重新决策。`,
        ];
  }

  if (event.type === "approval_start") {
    return [
      `审批 > 第 ${event.sequence} 步：等待用户决定`,
      event.hasPreview
        ? "  范围：只批准随后显示的这一份完整差异，不保存为会话权限。"
        : `  范围：${toTraceText(event.scope)}${event.allowSession ? "，可选择本次会话复用" : ""}。`,
    ];
  }

  if (event.type === "approval_finish") {
    const result = event.response.decision === "allow_once"
      ? "允许一次"
      // [KEEP 来自 05.3] 终端明确区分单次允许和会话允许。
      : event.response.decision === "allow_session"
        ? "允许本次会话"
        : "拒绝";
    return [
      `审批 < 第 ${event.sequence} 步：${result}`,
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
