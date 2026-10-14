/**
 * 10.2 让界面跟着执行变化 | [KEEP] tools/glob.ts
 *
 * 学习目标：让文件发现在独立 rg 进程中完成，同时沿用模型熟悉的 glob 工具。
 * 输入：pattern 路径模式、项目根和取消信号；输出：相对路径与截断状态。
 * 状态：参数、进程或输出检查失败向外抛错，不返回半份列表，也不修改项目文件。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError
 *             +-- 是 -> 读取根 .gitignore -> rg --files --null --glob pattern
 *                                       -> 进程成功？-- 否 -> ToolError
 *                                                     +-- 是 -> 按 NUL 拆路径
 *   再应用根忽略规则 -> 对返回的全部路径排序 -> 取前 200 项 -> 结果回模型
 *
 * rg 的正向 --glob 可能重新包含 .gitignore 排除的路径，所以返回后再次过滤根规则。
 * 这里先收齐 rg 在预算内的输出再排序，不再是第四章的“多看一条就停止遍历”。
 * 只有过滤后确有更多路径时才标记截断；进程超时或超量则报错，不返回不完整路径列表。
 * 观察：名称与结果形状不变，但取消信号已经能进入搜索进程。
 */

// [KEEP 来自 07.3] 文件发现迁移到受控 rg，界面与模型的结果形状不变。
import { runRipgrep } from "./ripgrep.js";
import { isAbsolute, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
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
 * 检查模型提供的文件范围，返回整理后的正向 glob 模式。
 *
 * 输入是未知值；必须为非空字符串，去掉首尾空白后不超过 500 字符。
 * 拒绝绝对路径、..、NUL，以及以 ! 开始的排除模式，防止把工具的“搜索范围”改成另一种含义。
 * 失败抛出 ToolError。这里只检查模式边界，完整匹配语义仍由 rg 判断。
 */
export function validateGlobPattern(value: unknown): string {
  if (typeof value !== "string") throw new ToolError("glob pattern 必须是字符串。");
  const pattern = value.trim();
  if (!pattern) throw new ToolError("glob pattern 不能为空。");
  if (pattern.length > 500) throw new ToolError("glob pattern 不能超过 500 个字符。");
  // [KEEP 来自 07.3] rg 的 ! 表示排除模式，这个工具只接受正向的文件范围。
  if (isAbsolute(pattern) || win32.isAbsolute(pattern) || pattern.startsWith("!") || pattern.includes("\0") || pattern.split(/[\\/]/).includes("..")) {
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
 * 让 rg 查找文件，再把完整的路径输出整理为受限列表。
 *
 * pattern 已通过校验；maxResults 是返回条数，时间和输出字节限制由 runRipgrep 管理。
 * 先读取根 .gitignore，再用 --files 与 NUL 分隔输出；进程正常完成后拆分并再次过滤根规则。
 * 对这批过滤后的全部路径排序，然后取前 maxResults 项，确有额外路径才标记 truncated。
 * 超时、超量或 rg 执行失败时抛出 ToolError；取消继续向外传播，不把半份结果当成完整列表。
 * 这里不读取正文；结果数量上限并不限制 rg 已完成的目录遍历成本。
 */
export async function findMatchingFiles(
  pattern: string,
  projectRoot = findProjectRoot(),
  maxResults = MAX_RESULTS,
  signal?: AbortSignal,
): Promise<GlobResult> {
  signal?.throwIfAborted();
  const matcher = await createIgnoreMatcher(projectRoot);
  // [KEEP 来自 07.3] -0 用 NUL 分隔路径，文件名里有换行也不会拆成两条结果。
  const result = await runRipgrep(["--files", "--null", "--glob", pattern], projectRoot, signal);
  const paths = result.stdout.split("\0").filter(Boolean)
    .map((path) => path.replace(/^\.\//, ""))
    // rg 的正向 --glob 可能重新包含 .gitignore 里的文件，所以仍应用根目录忽略规则。
    .filter((path) => !matcher.ignores(path)).sort();
  return { paths: paths.slice(0, maxResults), truncated: paths.length > maxResults };
}

/**
 * 执行 glob 工具，并把有界路径列表转换成模型可读的文本。
 *
 * - 输入：模型生成的参数字符串、项目根目录和可选取消信号。
 * - 输出：`content` 是给模型的路径文本，`metadata` 是给界面的路径数量、截断状态和路径数组。
 * - 失败方式：参数或模式无效时抛出 `ToolError`；取消时立即停止，未匹配时返回明确说明。
 * - 职责边界：只返回路径，不读取匹配文件的内容。
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
