/**
 * 04.2 把文本目标变成代码位置 | [NEW] tools/grep.ts
 *
 * 学习目标：让模型用正则表达式搜索文件内容，并获得带文件名和行号的真实位置。
 * 输入：query 正则表达式和 glob 文件范围。
 * 输出：给模型的 path:line:column:text 文本，以及不含源码正文的位置元数据。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *   参数与正则有效？ ------ 否 ---> ToolError
 *            | 是
 *            v
 *   glob 找候选文件（最多 500 个）
 *            |
 *            v
 *   跳过 > 1 MiB / 二进制文件
 *            |
 *            v
 *   逐行匹配 --> path:line:column --> 前 100 项 + 截断说明
 *
 * 关键点：glob 缩小文件范围，grep 再检查内容。结果包含真实文件位置，模型才能继续调用 read_file。
 * 文件数、文件大小、匹配数和单行长度分别受限，避免一个宽泛查询占满内存和模型上下文。
 * 运行观察：搜索函数名时返回文件、行号和文本；无效正则作为工具错误反馈给模型。
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [NEW 04.2] 本文件以下 grep 契约、参数校验和内容搜索均为本节新增。
export const grepDefinition = {
  name: "grep",
  description: "用正则表达式搜索项目文件内容，返回文件路径、行号、列号和匹配行。",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "JavaScript 正则表达式，例如 export\\s+function\\s+createModel。",
      },
      glob: {
        type: "string" as const,
        description: "文件范围，例如 src/**/*.ts；搜索全部文件时传入 **/*。",
      },
    },
    required: ["query", "glob"],
    additionalProperties: false,
  },
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

type GrepArguments = { query: string; glob: string };
type GrepMatch = { path: string; line: number; column: number; text: string };

/**
 * 在扫描文件前确认搜索条件可用。
 *
 * 输入是模型的 JSON 参数；只接受非空且不超过 500 字符的 query，以及通过检查的 glob。
 * 正则会先编译一次，语法错误可立即作为 ToolError 返回，不必等到读取文件后才发现。
 * 成功返回查询和路径模式。编译成功只说明语法合法，不保证正则执行一定很快。
 */
function parseArguments(argumentsJson: string): GrepArguments {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("grep 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("grep 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["query", "glob"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ToolError("grep 参数只能包含 query 和 glob。");
  }
  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new ToolError("grep query 必须是非空字符串。");
  }
  if (input.query.length > 500) throw new ToolError("grep query 不能超过 500 个字符。");
  const filePattern = validateGlobPattern(input.glob);
  try {
    new RegExp(input.query, "u");
  } catch {
    throw new ToolError(`grep query 不是有效的正则表达式：${input.query}`);
  }
  return { query: input.query, glob: filePattern };
}

/**
 * 只保留匹配行的开头，避免超长正文占满模型上下文。
 *
 * 输入是一整行，超过 300 个原字符时保留前 300 个，再追加省略号。
 * 这不是围绕匹配处截取；匹配发生在第 300 个字符之后时，返回的正文可能不含目标词，
 * 但 grepTool() 仍会单独返回它的行号和列号。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;
}

/**
 * 在候选文件中逐行查找，把位置和匹配行一起返回给模型。
 *
 * 输入是模型参数、项目根和可选取消信号；先用 glob 选出最多 500 个候选文件。
 * 跳过检查时超过 1 MiB、含 NUL 或无法读取的文件；每行只保留第一处匹配。
 * 观察到第 101 个匹配后，返回前 100 个并标记截断。content 含匹配行，metadata 只含位置与数量。
 * 参数或正则无效会抛出 ToolError；读取单个文件失败会跳过，取消则继续向外传播。
 * 空结果只说明实际检查的文本没有命中。同步正则没有时间上限，执行期间无法响应取消；第 07 章再迁移到受控 rg。
 */
export async function grepTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const expression = new RegExp(input.query, "u");
  const candidates = await findMatchingFiles(input.glob, projectRoot, MAX_FILES, signal);
  const matches: GrepMatch[] = [];

  for (const path of candidates.paths) {
    signal?.throwIfAborted();
    let content: string;
    try {
      const filePath = join(projectRoot, path);
      if ((await stat(filePath)).size > MAX_FILE_BYTES) continue;
      content = await readFile(filePath, { encoding: "utf8", signal });
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    if (content.includes("\0")) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      signal?.throwIfAborted();
      const line = lines[index] ?? "";
      const match = expression.exec(line);
      if (!match) continue;
      matches.push({
        path,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        text: shortenLine(line),
      });
      if (matches.length > MAX_MATCHES) {
        const selected = matches.slice(0, MAX_MATCHES);
        return {
          content: `${selected.map(({ path, line, column, text }) => `${path}:${line}:${column}: ${text}`).join("\n")}\n[结果已截断，只显示前 ${MAX_MATCHES} 项]`,
          metadata: {
            kind: "grep",
            count: selected.length,
            truncated: true,
            locations: selected.map(({ path, line, column }) => ({ path, line, column })),
          },
        };
      }
    }
  }

  if (matches.length === 0) {
    const scope = candidates.truncated ? `前 ${MAX_FILES} 个候选文件` : "候选文件";
    return {
      content: `${scope}中没有匹配：${input.query}`,
      metadata: { kind: "grep", count: 0, truncated: candidates.truncated, locations: [] },
    };
  }
  const suffix = candidates.truncated ? `\n[文件范围已截断，只扫描前 ${MAX_FILES} 个候选文件]` : "";
  return {
    content: `${matches.map(({ path, line, column, text }) => `${path}:${line}:${column}: ${text}`).join("\n")}${suffix}`,
    metadata: {
      kind: "grep",
      count: matches.length,
      truncated: candidates.truncated,
      locations: matches.map(({ path, line, column }) => ({ path, line, column })),
    },
  };
}
