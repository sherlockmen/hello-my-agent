/**
 * 31.1 安装本地扩展包 | [KEEP] tools/read-tool-result.ts
 *
 * 学习目标：让模型能够继续读取被裁掉的原文，而不是只看到一条无法访问的磁盘路径。
 * 输入：已给出的日志 UUID、起始行、最多 5 行，以及可选的首行起始列。
 * 输出：带行列位置的有限片段；超长单行可用 column 继续读取，不会永久丢失行中间。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   严格校验编号与范围 -> 只打开日志目录内对应普通文件 -> 有界读取 -> 按行列返回片段
 *   文件 / 目录不合法、超过大小或取消 -> 关闭句柄 -> 明确错误 / 取消
 * 不接受任意路径；拒绝日志文件和目录末级符号链接。假设本机目录可信，不是文件系统沙箱。
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_TOOL_RESULT_DIRECTORY } from "../context/tool-results.js";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";

// [KEEP 来自 15.2] 每次最多 5 行、每行 1000 个码点，防止取回原文时再次塞入一整份大结果。
export const readToolResultDefinition = {
  name: "read_tool_result",
  description: "按已知 UUID 读取本机完整工具日志。offset 从 1 开始，limit 最多 5 行；长行用 column 从指定字符继续。只接受日志编号，不接受磁盘路径。",
  inputSchema: { type: "object" as const, properties: {
    id: { type: "string" as const, description: "大结果消息中给出的日志 UUID。" },
    offset: { type: "integer" as const, minimum: 1, description: "起始行号。" },
    limit: { type: "integer" as const, minimum: 1, maximum: 5, description: "最多读取的行数。" },
    column: { type: "integer" as const, minimum: 1, description: "首行从第几个字符开始，默认 1；其余行从第 1 个字符开始。" },
  }, required: ["id", "offset", "limit"], additionalProperties: false },
};

/**
 * 验证日志编号和读取范围，再从本机专用目录打开普通日志。
 * 单次读取至多 16 MiB 的原始文件，但只返回 5×1000 个原字符；每行标出续读位置。
 * 取消、缺失、符号链接、过大文件和其他读取失败都不会返回伪造的成功内容。
 */
export async function readToolResultTool(argumentsJson: string, signal?: AbortSignal,
  directory = DEFAULT_TOOL_RESULT_DIRECTORY): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch { throw new ToolError("read_tool_result 参数必须是 JSON 对象。"); }
  if (Object.keys(input).some((key) => !["id", "offset", "limit", "column"].includes(key))
    || typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id)
    || !Number.isSafeInteger(input.offset) || (input.offset as number) < 1
    || !Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 5
    || (input.column !== undefined && (!Number.isSafeInteger(input.column) || (input.column as number) < 1))) {
    throw new ToolError("read_tool_result 需要有效的 UUID、从 1 开始的 offset/column，以及 1-5 的 limit。");
  }
  const offset = input.offset as number, limit = input.limit as number, column = (input.column as number | undefined) ?? 1;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let content: string;
  try {
    const root = resolve(directory);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error();
    handle = await open(join(root, `${input.id}.log`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const information = await handle.stat();
    if (!information.isFile() || information.size > 16 * 1024 * 1024) throw new Error();
    signal?.throwIfAborted();
    // stat 后文件仍可能增长；只读上限再多 1 字节，超出就拒绝，不依赖旧尺寸。
    const maximum = 16 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximum) {
      signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); total += bytesRead;
    }
    if (total > maximum) throw new Error();
    content = Buffer.concat(chunks, total).toString("utf8");
    signal?.throwIfAborted();
  } catch {
    signal?.throwIfAborted();
    throw new ToolError("完整工具日志不存在、无法读取或超过 16 MiB；请检查本机日志文件。");
  } finally { await handle?.close(); }
  const lines = content.split(/\r?\n/);
  if (offset > lines.length) throw new ToolError("起始行超过日志范围。");
  const selected = lines.slice(offset - 1, offset - 1 + limit).map((line, index) => {
    const characters = Array.from(line), start = index === 0 ? column : 1;
    if (start > characters.length + 1) throw new ToolError("起始列超过日志行范围。");
    const excerpt = characters.slice(start - 1, start - 1 + 1000).join("");
    const continuation = characters.length > start - 1 + 1000
      ? ` [本行未完：offset=${offset + index}, column=${start + 1000}]` : "";
    return `${offset + index}:${start}: ${excerpt}${continuation}`;
  });
  const endLine = offset + selected.length - 1, hasMore = endLine < lines.length;
  return { content: `[完整工具日志 ${input.id}；第 ${offset}-${endLine} 行]\n${selected.join("\n")}\n`
    + (hasMore ? `[下一段 offset=${endLine + 1}；有行内续读提示时先读取该列]` : "[已到日志末行；仍需检查行内续读提示]"),
    metadata: { kind: "read_file", lineCount: selected.length, startLine: offset, endLine, hasMore } };
}
