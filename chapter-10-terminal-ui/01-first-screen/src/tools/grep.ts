/**
 * 10.1 把对话放进一个界面 | [KEEP] tools/grep.ts
 *
 * 学习目标：用受控 rg 搜索内容，让复杂匹配不再占用 Agent 的 JavaScript 线程。
 * 输入：query 正则与 glob 文件范围；输出：path:line:column:text 和不含正文的位置元数据。
 * 状态：搜索失败向外抛错；没有匹配是正常空结果，本文件不修改项目文件。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError
 *             +-- 是 -> glob 找候选文件，保留前 500 个
 *                    -> 没候选？-- 是 -> 返回空结果
 *                               +-- 否 -> rg --json 搜索候选
 *   搜索成功？-- 否 -> ToolError
 *             +-- 是 -> 逐条读取 match 事件 -> 收到第 101 条后停止解析
 *   返回前 100 条，记录候选或匹配是否截断 -> 模型继续 read_file 或回答
 *
 * rg 使用默认正则引擎，语法由 rg 校验，不能再用 JavaScript RegExp 替它判断。
 * 先等进程收齐预算内输出再解析；超时或超量直接报错，不尝试解析半行 JSON。
 * 列号把 rg 的 UTF-8 字节偏移转成 JavaScript 字符位置；长行只保留前 300 个原字符再加省略号。
 * 观察：无匹配是空结果，无效正则是工具错误，两者都能交回模型继续判断。
 */

// [KEEP 来自 07.3] 正则在 rg 进程中运行，不再占用 Agent 的 JavaScript 线程。
import { runRipgrep } from "./ripgrep.js";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [KEEP 来自 07.3] 工具定义改用 rg 默认正则的语法说明。
export const grepDefinition = {
  name: "grep",
  description: "用正则表达式搜索项目文件内容，返回文件路径、行号、列号和匹配行。",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "ripgrep 默认正则（不支持回溯引用、环视），例如 export\\s+function\\s+createModel。",
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
 * 检查搜索参数的形状与范围，把正则语法留给实际搜索引擎。
 *
 * 输入是模型 JSON；只接受非空、500 字符以内且不含 NUL 的 query，以及有效 glob。
 * 返回这两个字符串，不在主进程创建或执行 RegExp，因为 rg 使用的是另一种正则引擎。
 * JSON、字段或范围不符合要求时抛出 ToolError；具体正则错误由稍后的 rg 输出说明。
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
  // [KEEP 来自 07.3] 正则语法由 rg 校验，不能再拿 JavaScript 正则预判。
  if (input.query.includes("\0")) throw new ToolError("grep query 不能包含 NUL 字符。");
  return { query: input.query, glob: filePattern };
}

/**
 * 限制一条命中行进入模型上下文的正文长度。
 *
 * 传入去掉结尾换行的原始行；返回前 300 个原字符，超出时再追加省略号。
 * 它不围绕命中位置截取，命中若在第 300 个字符以后，正文片段可能看不到查询文字。
 * 行号与列号仍保留，模型可以继续 read_file 查看对应位置。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;
}

/**
 * 把 rg 的结构化命中记录转换成已有的内容搜索结果。
 *
 * 先用 glob 取得最多 500 个已过滤候选，再启动第二次 rg 任务搜索这些路径。
 * rg 只检查 1 MiB 以内的文件，使用默认正则和 --json；每个文件最多输出 101 条匹配行。
 * 收齐结果后只解析前 101 条 match，返回前 100 条；候选或匹配确实更多时标记截断。
 * 非 UTF-8 路径或内容报错，避免把无法按本书文字规则处理的数据猜成路径和正文。
 * 正则、读取或进程失败抛出 ToolError，取消向外传播；这里不修改文件，也不执行 shell。
 */
export async function grepTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  // [KEEP 来自 07.3] 先拿到已过滤的候选路径，再把参数数组直接交给 rg。
  const candidates = await findMatchingFiles(input.glob, projectRoot, MAX_FILES, signal);
  const paths: string[] = [];
  // 显式传给 rg 的文件不会受 --max-filesize 过滤，因此先逐个检查大小与普通文件类型。
  for (const path of candidates.paths) {
    signal?.throwIfAborted();
    const file = await lstat(join(projectRoot, path)).catch(() => null);
    if (file?.isFile() && file.size <= MAX_FILE_BYTES) paths.push(path);
  }
  if (paths.length === 0) {
    return { content: "候选范围内没有可搜索的普通文件（文件须不超过 1 MiB）。",
      metadata: { kind: "grep", count: 0, truncated: candidates.truncated, locations: [] } };
  }
  const result = await runRipgrep([
    "--json", "--engine", "default", "--max-count", "101",
    "--regexp", input.query,
  ], projectRoot, signal, paths);
  const matches: GrepMatch[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type !== "match") continue;
    const data = event.data;
    // 非 UTF-8 的路径或匹配内容没有 text 字段；本章只处理 UTF-8 源码。
    if (typeof data.path?.text !== "string" || typeof data.lines?.text !== "string") {
      throw new ToolError("搜索结果包含非 UTF-8 路径或内容，请缩小到 UTF-8 源码范围。");
    }
    const text = data.lines.text.replace(/\r?\n$/, "");
    // rg 的偏移按 UTF-8 字节计；转换成与已有工具相同的 JavaScript 字符位置。
    const prefix = Buffer.from(text).subarray(0, data.submatches[0]?.start ?? 0).toString("utf8");
    matches.push({ path: data.path.text.replace(/^\.\//, ""), line: data.line_number,
      column: prefix.length + 1, text: shortenLine(text) });
    if (matches.length > MAX_MATCHES) break;
  }
  const selected = matches.slice(0, MAX_MATCHES);
  const truncated = candidates.truncated || matches.length > MAX_MATCHES;
  const suffix = truncated ? "\n[文件范围或匹配结果已截断，请缩小 glob 或 query]" : "";
  return {
    content: (selected.length ? selected.map(({ path, line, column, text }) =>
      `${path}:${line}:${column}: ${text}`).join("\n") : `候选文件中没有匹配：${input.query}`) + suffix,
    metadata: { kind: "grep", count: selected.length, truncated,
      locations: selected.map(({ path, line, column }) => ({ path, line, column })) },
  };
}
