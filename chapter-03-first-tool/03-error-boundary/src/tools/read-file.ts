/**
 * 03.3 把工具失败反馈给模型 | [KEEP 来自 03.2] tools/read-file.ts
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
 *   realpath 后仍在项目根目录内？-- 否 ---> ToolError
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
 * realpath 会解析符号链接，防止表面位于项目内的链接实际指向项目外。
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

function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

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

/** 从启动目录向上查找最近的 package.json；找不到时保留原启动目录。 */
function findProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

/** 校验模型参数和真实路径后，读取一个不超过 64 KiB 的普通文件并按 UTF-8 解码。 */
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
  // 再检查真实目标，防止项目根目录内的普通文件名通过符号链接指向同目录下的 .env。
  if (isEnvironmentFile(pathFromProjectRoot)) {
    throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ToolError(`目标不是普通文件：${path}`);
  if (fileStat.size > MAX_FILE_BYTES) throw new ToolError("文件超过 64 KiB，本章暂不读取。");
  return readFile(filePath, "utf8");
}
