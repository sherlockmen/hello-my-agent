/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：把模型给出的 JSON 参数变成一次受边界限制的真实文件读取。
 * 输入：arguments JSON 字符串，以及从启动位置向上找到的最近项目根目录。
 * 输出：成功时返回按 UTF-8 解码的文本；参数、路径或文件不合法时抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       JSON 可解析？ ---- 否 ---> ToolError
 *            | 是
 *            v
 *       path 是非空字符串？-- 否 ---> ToolError
 *            | 是
 *            v
 *   检查时 realpath 在项目根目录内？-- 否 ---> ToolError
 *            | 是
 *            v
 *       非 .env 且为普通文件？-- 否 ---> ToolError
 *            | 是
 *            v
 *       文件 <= 64 KiB？ ------ 否 ---> ToolError
 *            | 是
 *            v
 *       readFile(utf8) ----------> 文件内容
 *
 * 关键点：模型输出属于不可信输入，即使参数声明了 JSON Schema，本地仍必须重新校验。
 * realpath 会解析符号链接，因此能拒绝检查时已经指向项目外的目标。
 * 检查与读取不是同一个操作；当前实现假设本地工作区及其他进程可信，不是文件系统沙箱。
 * .env 系列文件可能保存模型密钥，因此在第 05 章权限系统完成前直接拒绝。
 * 64 KiB（65,536 字节）是固定保护上限；第 04 章会增加分段读取和结果控制。
 * 运行观察：从仓库内的小节目录启动也能读取根目录文件；越界路径仍会停止。
 */

import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError } from "../errors.js";

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
 * 从启动目录向上寻找最近的 `package.json`，确定工具访问的项目根目录。
 *
 * - 输入：可选起点；默认使用当前工作目录。
 * - 输出：找到时返回最近项目目录；找不到时返回规范化后的原起点。
 * - 关键步骤：逐级检查当前目录，再移动到父目录，直到找到标记或到达文件系统根。
 * - 失败方式：本函数只检查路径是否存在，不读取文件内容，因此没有主动抛出的业务错误。
 */
function findProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

/**
 * 在项目根目录边界内校验并读取一个不超过 64 KiB 的普通文件，再按 UTF-8 解码。
 *
 * - 输入：模型生成的参数字符串，以及默认由 `findProjectRoot()` 得到的项目根目录。
 * - 输出：所有检查通过后，按 UTF-8 返回完整文件内容。
 * - 关键步骤：解析参数、拒绝环境文件、解析真实路径、检查越界与文件类型、限制大小，最后读取。
 * - 失败方式：参数、越界、目标不存在、文件类型或大小不符合规则时抛出 `ToolError`。
 * - 系统异常：真实路径检查后的 `stat()` 或 `readFile()` 仍可能因权限变化等竞态抛出文件系统异常，由外层统一处理。
 * - 关键原因：`realpath()` 会解析符号链接，因此能拒绝检查时已经指向项目外的目标。
 * - 竞态边界：检查和 `readFile()` 不是原子操作；当前实现假设本地工作区及其他进程可信，
 *   不能抵抗恶意进程在检查后替换路径，也不能作为文件系统沙箱。
 * - 内容边界：本章不识别二进制格式；任何普通文件都会尝试按 UTF-8 解码。
 */
export async function readFileTool(argumentsJson: string, projectRoot = findProjectRoot()): Promise<string> {
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
  return readFile(filePath, "utf8");
}
