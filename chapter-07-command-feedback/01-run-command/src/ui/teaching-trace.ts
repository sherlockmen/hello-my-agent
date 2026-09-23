/**
 * 07.1 执行测试并读懂结果 | [CHANGED] ui/teaching-trace.ts
 *
 * 学习目标：让用户分清“命令已经返回结果”和“测试报告失败”。
 * 输入：Agent Loop 的结构化事件；输出：准备、审批、执行与结果的简短终端记录。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件 -> 选取对应字段 -> 清理显示文字并限长 -> 输出记录；不改变原始参数和执行结果。
 * 文件正文只显示字符数，完整操作预览交给审批界面；命令结果分别展示 stdout/stderr 摘要。
 * 两条输出各保留前 240 个清理后的字符，超出再加省略号；模型仍收到工具保留的结果正文。
 * 常见凭据特征会隐藏，但这里不是完整脱敏器，不能把原始事件直接当作可公开日志。
 * 观察：非零退出码显示“失败”，其输出仍会交给模型；stderr 有文字不等于失败。
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
  // [CHANGED 07.1] 只整理显示副本，不改变原始命令或工具结果。
  const oneLine = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
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
 * 把工具自己的元数据变成终端摘要，不从模型回答反推执行情况。
 *
 * 文件工具提供路径、位置和数量；命令还提供退出码、信号、停止原因及两条输出。
 * 返回值只给终端显示，输出会清理、限长并隐藏常见凭据特征；不改工具 content。
 * 命令是否失败由结果的 isError 交给外层决定，这里不会因为 stderr 有文字就改判结果。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  // [KEEP 来自 06.3] 只在工具成功事件中显示经过结构化元数据传来的备份路径；
  // 内容过期检测或备份失败走错误分支，不伪装成成功结果。
  // [CHANGED 07.1] 用退出码判断命令状态，stdout/stderr 分开显示。
  if (metadata.kind === "run_command") {
    return `退出码 ${metadata.exitCode ?? "无"}${metadata.signal ? `；信号 ${metadata.signal}` : ""}`
      + `${metadata.stopReason ? `；${metadata.stopReason === "timeout" ? "运行超时" : "输出超过上限"}` : ""}`
      + `\n  stdout：${metadata.stdout ? toTraceText(metadata.stdout, 240) : "（空）"}`
      + `\n  stderr：${metadata.stderr ? toTraceText(metadata.stderr, 240) : "（空）"}`;
  }
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

  // [CHANGED 07.1] 预览不再只代表文件修改，命令也走这个事件。
  if (event.type === "tool_prepare") {
    const tool = describeToolCall(event.call);
    return event.outcome === "success"
      ? [
          `准备 < 第 ${event.sequence} 步：${tool.name} 已生成操作预览`,
          `  结果：完整预览共 ${event.previewChars} 个字符；此时尚未执行。`,
        ]
      : [
          `准备 < 第 ${event.sequence} 步：${tool.name} 无法生成操作预览`,
          `  原因：${toTraceText(event.error, 100)}；错误将交回模型重新决策。`,
        ];
  }

  // [CHANGED 07.1] 当前预览可能是命令，也可能是文件 diff。
  if (event.type === "approval_start") {
    return [
      `审批 > 第 ${event.sequence} 步：等待用户决定`,
      event.hasPreview
        ? "  范围：只批准随后显示的这一次完整操作，不保存为会话权限。"
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

  // [CHANGED 07.1] 测试失败有完整结果，不等于执行器自身抛出异常。
  const failed = event.outcome === "error";
  const commandFailed = !failed && event.result.isError;
  return [
    `工具 < 第 ${event.sequence} 步：${tool.name}${failed || commandFailed ? " 失败" : " 完成"}`,
    `  返回：${failed ? "执行失败" : describeToolResult(event.result.metadata)}。`,
    `  去向：${failed || commandFailed ? "错误与输出" : "结果"}已加入当前回合，下一次模型决策会收到。`,
  ];
}
