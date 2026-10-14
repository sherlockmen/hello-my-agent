/**
 * 04.2 把文本目标变成代码位置 | [KEEP 来自 04.1] tools/read-file.ts
 *
 * 学习目标：继续在项目边界内安全读取一个小型普通文件。
 * 输入：包含相对 path 的 JSON 参数，以及统一确定的项目根目录。
 * 输出：按 UTF-8 解码的正文和实际行数；先拒绝检查时超过 64 KiB 的文件，参数无效时抛出 ToolError。
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
 * 识别不允许工具读取的 .env 系列文件名。
 *
 * 输入可以是模型路径，也可以是 realpath 得到的真实路径。
 * 只取最后一段名称并忽略大小写，命中 .env、.env.* 或 .envrc 时返回 true。
 * 这样同一类文件放在不同目录里，仍会被名称规则识别。
 */
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 先确认读取请求只包含一个可用的相对路径。
 *
 * 参数来自模型，先解析 JSON，再检查对象是否只有非空字符串 path，并去掉首尾空格。
 * JSON、字段或相对路径要求不满足时抛出 ToolError；通过后返回路径字符串。
 * 这里只检查参数，文件是否存在、真实位置在哪里，要在读取前继续确认。
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
 * 检查模型要读的文件，再把完整正文返回给主循环。
 *
 * 输入是模型的 JSON 参数和项目根。先检查相对路径与 .env 名称，再解析符号链接，
 * 确认检查时的真实目标位于项目内、是普通文件且不超过 64 KiB，最后才读取正文。
 * content 保存 UTF-8 正文，metadata 保存实际行数，给模型和终端分别使用。
 * 参数和预期文件检查失败时抛出 ToolError；取消信号会传给 readFile()；后续 stat() 或读取异常交给外层处理。
 * 检查与打开是两个操作，不能阻止其他进程在中间替换或增大文件；这里不是文件系统沙箱。
 * 内容按 UTF-8 解码，但没有验证具体编码或二进制格式。
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
