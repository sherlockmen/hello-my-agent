/**
 * 04.1 控制文件搜索范围 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：继续在项目边界内安全读取一个小型普通文件。
 * 输入：包含相对 path 的 JSON 参数，以及统一确定的项目根目录。
 * 输出：不超过 64 KiB 的 UTF-8 模型内容和实际行数元数据；参数无效时抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   arguments --> 校验 path --> realpath 边界 --> .env / 类型 / 大小检查 --> 文件内容
 *                    |              |                    |
 *                    +-- 失败 ------+--------------------+--> ToolError
 *
 * 关键点：04.1 把项目根目录查找移到 workspace.ts，使 read_file、glob 和后续 grep 使用同一边界。
 * realpath 会拒绝检查时已经指向项目外的符号链接；它不能阻止检查后的并发替换。
 * 本小节尚未改变一次读取完整小文件的方式。
 * 运行观察：原有 read_file 行为保持不变，glob 找到的相对路径可以直接交给它读取。
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [CHANGED 04.1] read_file 改用共享项目根，并同时返回正文与结构化元数据。
export const readFileDefinition = {
  name: "read_file",
  description: "读取当前项目根目录内一个普通文件并按 UTF-8 解码；不读取 .env 系列环境配置文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于当前项目根目录的文件路径，例如 package.json。",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const MAX_FILE_BYTES = 64 * 1024;

/**
 * 判断一个路径的最终文件名是否属于禁止读取的环境配置文件。
 *
 * - 输入：相对路径或已经解析后的真实路径。
 * - 输出：`.env`、`.env.*` 或 `.envrc` 返回 `true`，其他名称返回 `false`。
 * - 关键原因：只比较不区分大小写的文件名，路径层级不会影响凭据保护。
 */
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 把模型提供的 JSON 参数解析成唯一、非空的相对文件路径。
 *
 * - 输入：未经信任的 `argumentsJson` 字符串。
 * - 输出：参数恰好包含一个非空字符串 `path` 时返回去除首尾空格的路径。
 * - 失败方式：JSON 无效、不是对象、字段多余、路径为空或使用绝对路径时抛出 `ToolError`。
 * - 职责边界：这里只校验参数结构，不检查文件是否存在，也不读取磁盘内容。
 */
function parsePath(argumentsJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("参数必须是包含 path 的对象。");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "path" || typeof entries[0][1] !== "string") {
    throw new ToolError("参数只能包含非空字符串 path。");
  }
  const path = entries[0][1].trim();
  if (!path) throw new ToolError("path 不能为空。");
  if (isAbsolute(path)) throw new ToolError("path 必须是当前项目根目录内的相对路径。");
  return path;
}

/**
 * 在项目根目录边界内校验并读取一个不超过 64 KiB 的普通文件，再按 UTF-8 解码。
 *
 * - 输入：模型生成的参数字符串、项目根目录和可选取消信号。
 * - 输出：`content` 保存完整 UTF-8 文本，`metadata` 保存实际行数供界面观察。
 * - 关键步骤：解析参数、拒绝环境文件、解析真实路径、检查越界与文件类型、限制大小，最后读取。
 * - 失败方式：参数、越界、目标不存在、文件类型或大小不符合规则时抛出 `ToolError`。
 * - 系统异常：检查后的 `stat()` 或 `readFile()` 仍可能因竞态抛出文件系统异常；取消则抛出 `AbortError`，都由外层处理。
 * - 关键原因：`realpath()` 会解析符号链接，因此能拒绝检查时已经指向项目外的目标。
 * - 竞态边界：检查和 `readFile()` 不是同一个原子操作；当前实现假设本地工作区及其他进程可信，
 *   不能抵抗恶意进程在检查后替换路径，也不能作为文件系统沙箱。
 * - 内容边界：本章不识别二进制格式；任何普通文件都会尝试按 UTF-8 解码。
 */
export async function readFileTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const path = parsePath(argumentsJson);
  if (isEnvironmentFile(path)) throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  let projectRootPath: string;
  let filePath: string;
  try {
    projectRootPath = await realpath(projectRoot);
    filePath = await realpath(resolve(projectRootPath, path));
  } catch {
    throw new ToolError(`文件不存在或无法访问：${path}`);
  }
  const pathFromProjectRoot = relative(projectRootPath, filePath);
  if (pathFromProjectRoot === ".." || pathFromProjectRoot.startsWith(`..${sep}`) || isAbsolute(pathFromProjectRoot)) {
    throw new ToolError("path 不能离开当前项目根目录。");
  }
  // 检查此刻解析到的真实目标，拒绝已经通过符号链接指向同目录 .env 的路径。
  if (isEnvironmentFile(pathFromProjectRoot)) {
    throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ToolError(`目标不是普通文件：${path}`);
  if (fileStat.size > MAX_FILE_BYTES) throw new ToolError("文件超过 64 KiB，本章暂不读取。");
  const content = await readFile(filePath, { encoding: "utf8", signal });
  const lines = content === "" ? [] : content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return { content, metadata: { kind: "read_file", lineCount: lines.length } };
}
