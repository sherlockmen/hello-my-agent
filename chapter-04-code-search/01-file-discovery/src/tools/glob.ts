/**
 * 04.1 控制文件搜索范围 | [NEW] tools/glob.ts
 *
 * 学习目标：让模型用 glob 模式查找项目中的真实文件，而不是猜测文件名。
 * 输入：包含 pattern 的 JSON 参数，例如匹配 src 下所有 TypeScript 文件的模式。
 * 输出：给模型的最多 200 条路径组成的文本，以及供界面使用的路径数量、截断状态和路径元数据。
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
 * 所以本地会拒绝绝对模式和包含 .. 的模式。忽略规则减少目录访问，数量上限减少返回路径；二者都不是执行超时。
 * 运行观察：匹配所有 TypeScript 文件时能找到源码，但不会返回 node_modules、dist、.env 或 .gitignore 忽略的文件。
 */

import { glob } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { createIgnoreMatcher, findProjectRoot } from "./workspace.js";

// [NEW 04.1] 本文件以下 glob 契约、参数校验和遍历实现均为本节新增。
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
 * 检查模型给出的路径模式能否用于本项目的搜索。
 *
 * 只接受非空字符串，去掉首尾空格后返回；超过 500 字符、绝对路径或包含 .. 路径段时抛出 ToolError。
 * 这里只检查模式文本，不访问磁盘，也不检查完整工具参数对象。
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
 * 从工具请求中取出唯一的 pattern，再检查它的值。
 *
 * 输入是模型生成的 JSON 字符串；无效 JSON、非对象或多余字段都会抛出 ToolError。
 * 返回值已经通过 validateGlobPattern()，接下来才用于真实文件匹配。
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
 * 找出一批符合模式的普通文件，供 glob 返回或 grep 继续读取。
 *
 * 输入是已校验的模式、项目根、返回数量上限和可选取消信号。
 * 遍历时就跳过忽略目录；收集到 maxResults + 1 项便停止，这时才知道确实需要截断。
 * 随后只对这批已收集路径排序，再返回前 maxResults 项，不是全项目排序后的前若干项。
 * 没有匹配时返回空数组；遍历失败抛出 ToolError，取消则向外抛出取消异常。
 * 数量上限不限制遍历耗时，程序只能在遍历交出下一项时检查取消。
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
 * 把路径匹配结果整理成模型结果和终端所需的数量信息。
 *
 * 输入是模型参数、项目根和可选取消信号。参数通过检查后，最多返回 200 条路径。
 * content 保存完整的本次路径列表与截断说明，metadata 保存数量、路径和截断状态供终端使用。
 * 没有匹配时返回明确说明；参数或遍历失败抛出 ToolError，取消继续向外传播。
 * 这里只找路径，不读取匹配文件的正文。
 */
export async function globTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const pattern = parsePattern(argumentsJson);
  const result = await findMatchingFiles(pattern, projectRoot, MAX_RESULTS, signal);
  if (result.paths.length === 0) {
    return {
      content: `没有文件匹配：${pattern}`,
      metadata: { kind: "glob", count: 0, truncated: result.truncated, paths: [] },
    };
  }
  const suffix = result.truncated ? `\n[结果已截断，只显示前 ${MAX_RESULTS} 项]` : "";
  return {
    content: `${result.paths.join("\n")}${suffix}`,
    metadata: {
      kind: "glob", count: result.paths.length, truncated: result.truncated, paths: result.paths,
    },
  };
}
