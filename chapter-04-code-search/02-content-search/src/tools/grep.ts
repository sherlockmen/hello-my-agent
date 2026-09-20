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
 * 校验 grep 的 JSON 参数，并在本地编译正则表达式。
 *
 * - 输入：未经信任的工具参数字符串。
 * - 输出：返回正则查询和经过边界检查的 glob 模式。
 * - 关键步骤：拒绝多余字段，再用 `RegExp` 验证查询语法，避免执行阶段才发现格式错误。
 * - 失败方式：JSON、字段类型、glob 边界或正则语法无效时抛出 `ToolError`。
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
 * 缩短过长的匹配行，同时保留匹配位置附近的可读文本。
 *
 * - 输入：一整行文本。
 * - 输出：保留前 300 个原字符；超出时再追加省略标记。
 * - 关键原因：结果数量有限仍可能遇到超长压缩行，单行上限可继续保护模型上下文。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;
}

/**
 * 执行有界内容搜索，并返回可以直接定位源码的文本结果。
 *
 * - 输入：模型生成的参数字符串、项目根目录和可选取消信号。
 * - 输出：`content` 给模型提供位置与匹配行；`metadata` 给界面提供不含源码正文的位置事实。
 * - 关键步骤：先用 glob 选择候选文件，再跳过大文件和含 NUL 字节的二进制内容，最后逐行匹配。
 * - 失败方式：参数、模式或正则无效时抛出 `ToolError`；读取期间消失或无权限的单个文件会跳过；取消会立即向外传播。
 * - 职责边界：本节按顺序扫描文件，不修改文件；JavaScript 正则的单次执行目前没有时间上限。
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
