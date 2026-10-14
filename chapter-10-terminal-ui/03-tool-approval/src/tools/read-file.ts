/**
 * 10.3 在界面中批准工具调用 | [KEEP] tools/read-file.ts
 *
 * 学习目标：根据搜索得到的行号读取一段源码，并让模型知道怎样继续读取下一段。
 * 输入：path、从 1 开始的 offset 和 1 到 400 之间的 limit。
 * 输出：给模型的带行号片段，以及给界面的行号范围与续读状态。
 * 状态：失败或取消会结束读取；本文件不写文件，也不自行向会话历史提交内容。
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

const MAX_LIMIT = 400;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LINE_CHARS = 1000;

type ReadArguments = { path: string; offset: number; limit: number };

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
 * 把模型提供的 JSON 参数解析成受限的文件路径和行范围。
 *
 * - 输入：未经信任的 `argumentsJson` 字符串。
 * - 输出：参数恰好包含合法的 `path`、`offset` 和 `limit` 时返回结构化结果。
 * - 失败方式：JSON、字段、路径或整数范围无效时抛出 `ToolError`。
 * - 职责边界：这里只校验参数结构，不检查文件是否存在，也不读取磁盘内容。
 */
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
 * 缩短单个超长文本行，避免少数压缩内容绕过行数上限。
 *
 * - 输入：一整行文本。
 * - 输出：最多保留前 1000 个原字符；发生截断时另行追加可见标记。
 * - 关键原因：行数限制控制不了一行数万字符的文件，因此还需要单行字符上限。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}… [本行已截断]`;
}

/**
 * 在项目根目录边界内验证文件，并返回规范化后的真实路径。
 *
 * - 输入：模型给出的相对路径和项目根目录。
 * - 输出：文件存在、位于项目内且通过保护规则时返回真实路径。
 * - 失败方式：环境文件、已在真实路径阶段确认的不可访问目标、越界路径、目录或超过 10 MiB 时抛出 `ToolError`。
 * - 关键原因：`realpath()` 会解析符号链接，因此能拒绝检查时已经指向项目外的目标。
 * - 竞态边界：这里返回的是路径字符串；后续打开文件前，其他进程仍可能替换该路径。
 */
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
 * 按行流式读取文件片段，并为每行添加可引用的真实行号。
 *
 * - 输入：模型生成的路径与行范围、项目根目录和可选取消信号。
 * - 输出：`content` 是给模型的带行号片段，`metadata` 是给界面的范围与续读状态。
 * - 关键步骤：通过真实路径检查后逐行跳过前文，只保留目标片段和一个额外行用于判断是否还有内容。
 * - 失败方式：起始行超过文件范围时抛出 `ToolError`；`stat()`、流读取竞态和取消异常由外层统一处理。
 * - 职责边界：分段限制模型上下文；文件仍需小于 10 MiB，本章不检测具体文本编码。
 *   当前实现假设本地工作区及其他进程可信，不能抵抗恶意并发替换，也不能作为文件系统沙箱。
 */
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
