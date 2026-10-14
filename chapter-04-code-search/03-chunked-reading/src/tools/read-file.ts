/**
 * 04.3 把代码位置变成上下文 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：根据搜索得到的行号读取一段源码，并让模型知道怎样继续读取下一段。
 * 输入：path、从 1 开始的 offset 和 1 到 400 之间的 limit。
 * 输出：给模型的带行号片段，以及给界面的行号范围与续读状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       参数有效？ -------- 否 ---> ToolError
 *            | 是
 *            v
 *   检查时 realpath 在项目内？-- 否 ---> ToolError
 *            | 是
 *            v
 *   非 .env 且为普通文件？-- 否 ---> ToolError
 *            | 是
 *            v
 *   逐行跳过 offset 前内容 --> 收集 limit 行 --> 带行号片段
 *                                      |
 *                                      +--> 还有内容：提示下一次 offset
 *                                      +--> 已结束：标记到达文件末尾
 *
 * 关键点：grep 返回位置，read_file 读取位置附近的上下文。分段读取限制返回给模型的文本量，
 * 不必因为一个大文件把整份内容放入消息历史。真实路径检查会拒绝检查时已经越界的目标，
 * 但不会把路径读取变成抵抗并发替换的文件系统沙箱。
 * 运行观察：offset=20、limit=40 只返回第 20 行开始的最多 40 行，并提示是否继续。
 */

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [CHANGED 04.3] read_file 契约新增 offset/limit，执行改为按行读取有限片段。
export const readFileDefinition = {
  name: "read_file",
  description: "按行读取项目内文件的一段内容。offset 从 1 开始，limit 最大为 400；不读取 .env 系列文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于项目根目录的文件路径。",
      },
      offset: {
        type: "integer" as const,
        minimum: 1,
        description: "开始读取的行号，从 1 开始。",
      },
      limit: {
        type: "integer" as const,
        minimum: 1,
        maximum: 400,
        description: "最多返回多少行。",
      },
    },
    required: ["path", "offset", "limit"],
    additionalProperties: false,
  },
};

// [CHANGED 04.3] 新增行数与单行长度限制，并允许检查时不超过 10 MiB 的文件。
const MAX_LIMIT = 400;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LINE_CHARS = 1000;

// [CHANGED 04.3] 校验后的读取参数同时保存路径与行范围。
type ReadArguments = { path: string; offset: number; limit: number };

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
 * 确认模型同时给出了相对路径、起始行和读取行数。
 *
 * JSON 对象必须恰好包含 path、offset、limit；path 非空且不能是绝对路径，
 * offset 是至少为 1 的整数，limit 是 1 到 400 的整数。任何一项不满足就抛出 ToolError。
 * 成功只返回整理后的参数，不读取文件；文件位置和大小接下来才检查。
 */
// [CHANGED 04.3] 从只接收 path 改为同时检查 offset 和 limit。
function parseArguments(argumentsJson: string): ReadArguments {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("read_file 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("read_file 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 3 || !keys.every((key) => ["path", "offset", "limit"].includes(key))) {
    throw new ToolError("read_file 参数必须且只能包含 path、offset 和 limit。");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new ToolError("read_file path 必须是非空字符串。");
  }
  const path = input.path.trim();
  if (isAbsolute(path)) throw new ToolError("path 必须是当前项目根目录内的相对路径。");
  if (!Number.isInteger(input.offset) || (input.offset as number) < 1) {
    throw new ToolError("read_file offset 必须是从 1 开始的整数。");
  }
  if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > MAX_LIMIT) {
    throw new ToolError(`read_file limit 必须是 1 到 ${MAX_LIMIT} 之间的整数。`);
  }
  return { path, offset: input.offset as number, limit: input.limit as number };
}

/**
 * 缩短单个超长行，补上只限制行数还不够的地方。
 *
 * 超过 1000 个原字符时，保留开头 1000 个，再追加省略号和“本行已截断”提示。
 * 输入已经是读取出来的一整行，所以这个限制只减少返回正文，不限制读入整行时的内存。
 */
// [NEW 04.3] 行数少也可能包含超长行，因此再限制返回的行正文。
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}… [本行已截断]`;
}

/**
 * 在打开文件前检查相对路径，并取得此刻解析到的真实位置。
 *
 * 输入是模型路径和项目根。先拒绝 .env 系列名称，再用 realpath 解析符号链接，
 * 检查真实目标仍在项目内、不是环境文件、是普通文件且此刻不超过 10 MiB。
 * 这些检查失败时抛出 ToolError；realpath 之后的 stat() 系统异常继续向外传播。
 * 返回的是路径字符串，不是已经锁定的文件；其他进程仍可能在检查后替换它。
 */
// [NEW 04.3] 先完成路径和文件检查，再建立按行读取的文件流。
async function resolveReadableFile(path: string, projectRoot: string): Promise<string> {
  if (isEnvironmentFile(path)) throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  let rootPath: string;
  let filePath: string;
  try {
    rootPath = await realpath(projectRoot);
    filePath = await realpath(resolve(rootPath, path));
  } catch {
    throw new ToolError(`文件不存在或无法访问：${path}`);
  }
  const relativePath = relative(rootPath, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new ToolError("path 不能离开当前项目根目录。");
  }
  if (isEnvironmentFile(relativePath)) {
    throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ToolError(`目标不是普通文件：${path}`);
  if (fileStat.size > MAX_FILE_BYTES) throw new ToolError("文件超过 10 MiB，本章暂不读取。");
  return filePath;
}

/**
 * 返回模型指定的一段源码，并说明下一段该从哪行开始。
 *
 * 参数和真实路径检查通过后，从文件开头逐行经过，跳过 offset 之前的行，再收集最多 limit 行。
 * 多看到一行才设置 hasMore；content 带源码与续读提示，metadata 带真实行号范围供终端显示。
 * 空文件且 offset=1 时正常返回空文件说明；其他越过文件末尾的起点抛出 ToolError。
 * 流读取、stat() 或取消异常继续向外传播；finally 无论成功失败都关闭行读取器并销毁文件流。
 * 这里只减少返回内容，读取靠后行仍要经过前文；多次调用也没有固定文件快照。
 * 检查与打开之间仍可发生路径变化，当前实现适用于可信本地工作区，不是文件系统沙箱。
 */
// [CHANGED 04.3] 逐行选出片段，多看一行后返回续读提示。
export async function readFileTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const filePath = await resolveReadableFile(input.path, projectRoot);
  const stream = createReadStream(filePath, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const selected: string[] = [];
  let lineNumber = 0;
  let hasMore = false;

  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      lineNumber += 1;
      if (lineNumber < input.offset) continue;
      if (selected.length === input.limit) {
        hasMore = true;
        break;
      }
      selected.push(`${lineNumber}: ${shortenLine(line)}`);
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  if (lineNumber === 0 && input.offset === 1) {
    return {
      content: `文件为空：${input.path}`,
      metadata: { kind: "read_file", lineCount: 0 },
    };
  }
  if (selected.length === 0) throw new ToolError(`起始行 ${input.offset} 超过文件范围。`);
  const lastLine = input.offset + selected.length - 1;
  const status = hasMore
    ? `[显示第 ${input.offset}-${lastLine} 行；后面还有内容，请把 offset 设为 ${lastLine + 1} 继续]`
    : `[显示第 ${input.offset}-${lastLine} 行；已到文件末尾]`;
  return {
    content: `${selected.join("\n")}\n${status}`,
    metadata: {
      kind: "read_file",
      lineCount: selected.length,
      startLine: input.offset,
      endLine: lastLine,
      hasMore,
    },
  };
}
