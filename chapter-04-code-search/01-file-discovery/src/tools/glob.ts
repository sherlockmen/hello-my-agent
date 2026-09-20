/**
 * 04.1 控制文件搜索范围 | [NEW] tools/glob.ts
 *
 * 学习目标：让模型用 glob 模式查找项目中的真实文件，而不是猜测文件名。
 * 输入：包含 pattern 的 JSON 参数，例如匹配 src 下所有 TypeScript 文件的模式。
 * 输出：按路径排序的相对文件名；最多返回 200 项，并明确标记结果是否被截断。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       参数有效？ -------- 否 ---> ToolError
 *            | 是
 *            v
 *   node:fs glob 匹配路径
 *            |
 *            v
 *   .gitignore / 内置规则过滤
 *            |
 *            v
 *   仅保留普通文件 --> 排序 --> 前 200 项 + 截断说明
 *
 * 关键点：glob 负责按路径找文件，不读取文件内容。模型输出仍是不可信输入，
 * 所以本地会拒绝绝对模式和包含 .. 的模式。忽略规则和结果上限让搜索范围保持可控。
 * 运行观察：匹配所有 TypeScript 文件时能找到源码，但不会返回 node_modules、dist、.env 或 .gitignore 忽略的文件。
 */

import { glob } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { ToolError } from "../errors.js";
import { createIgnoreMatcher, findProjectRoot } from "./workspace.js";

export const globDefinition = {
  name: "glob",
  description: "按 glob 模式查找当前项目中的文件。返回相对路径并遵守忽略规则，例如 src/**/*.ts。",
  inputSchema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string" as const,
        description: "相对于项目根目录的 glob 模式，例如 src/**/*.ts 或 **/package.json。",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

const MAX_RESULTS = 200;

type GlobResult = { paths: string[]; truncated: boolean };

/**
 * 校验一个准备交给文件匹配器的 glob 模式。
 *
 * - 输入：来自工具参数的未知值。
 * - 输出：值是非空字符串且通过边界检查时，返回去除首尾空格的模式。
 * - 失败方式：类型不符、模式过长、使用绝对路径或包含 `..` 时抛出 `ToolError`。
 * - 职责边界：不解析完整工具对象，也不访问文件系统。
 */
export function validateGlobPattern(value: unknown): string {
  if (typeof value !== "string") throw new ToolError("glob pattern 必须是字符串。");
  const pattern = value.trim();
  if (!pattern) throw new ToolError("glob pattern 不能为空。");
  if (pattern.length > 500) throw new ToolError("glob pattern 不能超过 500 个字符。");
  if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
    throw new ToolError("glob pattern 必须位于当前项目根目录内，不能使用绝对路径或 ..。");
  }
  return pattern;
}

/**
 * 从工具参数对象中取出唯一的 `pattern` 字段。
 *
 * - 输入：未经信任的 JSON 字符串。
 * - 输出：返回经过 `validateGlobPattern()` 边界检查的模式。
 * - 失败方式：JSON 无效、不是对象或包含多余字段时抛出 `ToolError`。
 */
function parsePattern(argumentsJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("glob 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("glob 参数必须是包含 pattern 的对象。");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "pattern") {
    throw new ToolError("glob 参数只能包含 pattern。");
  }
  return validateGlobPattern(entries[0][1]);
}

/**
 * 在项目根目录中匹配普通文件，并应用忽略规则和数量上限。
 *
 * - 输入：已校验的 glob 模式、项目根目录、最大文件数和可选取消信号。
 * - 输出：排序后的相对路径和截断标记；没有匹配时返回空数组。
 * - 关键步骤：Node.js 负责 glob 匹配，`ignore` 在遍历阶段剪枝目录，再只保留普通文件。
 * - 关键原因：额外读取一项用于判断是否截断，避免扫描完整个大型仓库后才停止。
 * - 失败方式：glob 遍历失败时转换成 `ToolError`；取消时抛出 `AbortError`，不会伪装成工具错误。
 */
export async function findMatchingFiles(
  pattern: string,
  projectRoot = findProjectRoot(),
  maxResults = MAX_RESULTS,
  signal?: AbortSignal,
): Promise<GlobResult> {
  signal?.throwIfAborted();
  const matcher = await createIgnoreMatcher(projectRoot);
  const paths: string[] = [];
  try {
    for await (const entry of glob(pattern, {
      cwd: projectRoot,
      withFileTypes: true,
      // 目录在遍历阶段就排除，避免先进入 node_modules、dist 等目录再逐项过滤。
      exclude: (entry) => {
        const path = relative(projectRoot, join(entry.parentPath, entry.name)).split(sep).join("/");
        return matcher.ignores(entry.isDirectory() ? `${path}/` : path);
      },
    })) {
      signal?.throwIfAborted();
      if (!entry.isFile()) continue;
      const path = relative(projectRoot, join(entry.parentPath, entry.name)).split(sep).join("/");
      if (matcher.ignores(path)) continue;
      paths.push(path);
      if (paths.length > maxResults) break;
    }
  } catch {
    signal?.throwIfAborted();
    throw new ToolError(`无法完成 glob 匹配：${pattern}`);
  }
  paths.sort();
  return { paths: paths.slice(0, maxResults), truncated: paths.length > maxResults };
}

/**
 * 执行 glob 工具，并把有界路径列表转换成模型可读的文本。
 *
 * - 输入：模型生成的参数字符串、项目根目录和可选取消信号。
 * - 输出：每行一个相对路径；超过 200 项时追加截断提示。
 * - 失败方式：参数或模式无效时抛出 `ToolError`；取消时立即停止，未匹配时返回明确说明。
 * - 职责边界：只返回路径，不读取匹配文件的内容。
 */
export async function globTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const pattern = parsePattern(argumentsJson);
  const result = await findMatchingFiles(pattern, projectRoot, MAX_RESULTS, signal);
  if (result.paths.length === 0) return `没有文件匹配：${pattern}`;
  const suffix = result.truncated ? `\n[结果已截断，只显示前 ${MAX_RESULTS} 项]` : "";
  return `${result.paths.join("\n")}${suffix}`;
}
