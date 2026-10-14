/**
 * 03.3 把工具失败反馈给模型 | [KEEP 来自 03.2] tools/read-file.ts
 *
 * 学习目标：把模型给出的 JSON 参数变成一次经过参数和路径检查的文件读取。
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
 * .env 系列文件可能保存模型密钥，因此直接拒绝读取；第 05 章也会保留这条规则。
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
 * 找到最近的 package.json，让文件工具共用同一个相对路径起点。
 *
 * 从 start 开始逐级向上查找；默认起点是 process.cwd()。
 * 找到时返回该目录，找不到时返回规范化后的原起点。
 * 这里只确定项目根，不检查某个文件是否允许读取，也不提供文件系统隔离。
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
 * 检查模型要读的文件，再把完整正文返回给主循环。
 *
 * 输入是模型的 JSON 参数和项目根。先检查相对路径与 .env 名称，再解析符号链接，
 * 确认检查时的真实目标位于项目内、是普通文件且不超过 64 KiB，最后才读取正文。
 * 成功返回 UTF-8 正文，由主循环配上调用 ID，再发送给模型。
 * 参数和预期文件检查失败时抛出 ToolError；后续 stat() 或读取异常交给外层处理。
 * 检查与打开是两个操作，不能阻止其他进程在中间替换或增大文件；这里不是文件系统沙箱。
 * 内容按 UTF-8 解码，但没有验证具体编码或二进制格式。
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
