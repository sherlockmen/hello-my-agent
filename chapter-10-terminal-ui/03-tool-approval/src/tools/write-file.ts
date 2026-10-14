/**
 * 10.3 在界面中批准工具调用 | [KEEP] tools/write-file.ts
 *
 * 学习目标：先让用户查看新文件的内容，批准后才创建。
 * 输入：项目内的相对路径、完整正文和取消信号。
 * 输出：准备时返回预览和 execute 函数；调用 execute 后才创建文件并返回结果。
 * 状态：准备失败不创建文件；创建时失败或取消仍可能留下新文件，不能把停止请求理解为回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   准备：参数有效？-- 否 --> ToolError
 *                  +-- 是 --> 父目录有效且文件不存在？-- 否 --> ToolError
 *                                                   +-- 是 --> 生成 diff -> 返回
 *   执行：父目录还是原来那个？-- 否 --> ToolError
 *                           +-- 是 --> wx 创建 -- 成功 --> 返回路径和字节数
 *                                             +-- 失败 --> ToolError
 *
 * Agent Loop 在准备和执行之间等待审批，本文件不读取用户的输入。
 * execute 会继续使用准备时的 target 和 content；带 + 号的预览只显示，不保存到文件。
 * wx 在创建那一刻检查文件是否存在，防止覆盖等待期间新出现的同名文件。
 * 父目录检查与创建仍有时间间隔，不能把这当作抵抗恶意并发替换的系统沙箱。
 * 运行观察：看到预览时文件还不存在；批准后才出现，遇到同名文件则创建失败。
 */

import { lstat, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { createUnifiedDiff } from "./change-preview.js";
import { findProjectRoot } from "./workspace.js";

// [KEEP 来自 06.1] 新文件创建继续使用同一套准备与执行规则。
export const writeFileDefinition = {
  name: "write_file",
  description: "创建一个尚不存在的项目文件。执行前会展示完整 diff 并等待用户批准；不会覆盖已有文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "相对于项目根目录的新文件路径。" },
      content: { type: "string" as const, description: "新文件的完整 UTF-8 文本内容。" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const MAX_CONTENT_BYTES = 256 * 1024;
const PROTECTED_DIRECTORIES = new Set([".git", ".agents", ".codex"]);

type WriteArguments = { path: string; content: string };

/**
 * 检查文件名是不是禁止写入的环境配置文件。
 * 传入已经整理好的路径；末段为 .env、.env.* 或 .envrc 时返回 true，让调用方拒绝写入。
 */
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 先检查模型参数能不能用，再交给文件操作。
 *
 * 输入是模型给出的 JSON 字符串，不能只因为有 TypeScript 类型就相信它。
 * 解析后检查对象字段、路径、受保护目录、控制字符和 256 KiB 正文上限，
 * 有问题就抛出 ToolError。通过后返回项目内相对路径和原样保留的正文。
 * 这里只检查参数，还没有读取父目录，更没有创建文件。
 */
function parseArguments(argumentsJson: string): WriteArguments {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch {
    throw new ToolError("write_file 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("write_file 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("path" in input) || !("content" in input)) {
    throw new ToolError("write_file 参数必须且只能包含 path 和 content。");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new ToolError("write_file path 必须是非空字符串。");
  }
  if (typeof input.content !== "string") throw new ToolError("write_file content 必须是字符串。");
  const path = input.path.trim().replaceAll("\\", "/");
  const segments = path.split("/");
  if (path.length > 500 || isAbsolute(path) || win32.isAbsolute(path)
    || /[\u0000-\u001f\u007f]/.test(path)
    || segments.some((segment) => segment === ".." || segment === "")) {
    throw new ToolError("write_file path 必须是项目内不含 .. 的相对文件路径。");
  }
  if (isEnvironmentFile(path)) throw new ToolError("环境配置文件属于硬保护范围，不能写入。");
  if (segments.some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw new ToolError("项目元数据目录属于硬保护范围，不能写入。");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.content)) {
    throw new ToolError("write_file 只创建文本文件，content 不能包含终端控制字符。");
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_CONTENT_BYTES) {
    throw new ToolError("write_file content 不能超过 256 KiB。");
  }
  return { path, content: input.content };
}

/**
 * 找到真正的父目录，确认新文件可以创建在那里。
 *
 * 路径参数已经检查过，这里继续解析父目录中的符号链接，再判断它是否在项目内，
 * 是否确实为目录、是否属于受保护目录。父目录不存在或无法访问时抛出 ToolError。
 * 成功时返回目标路径，以及父目录的真实路径、设备号和 inode，供执行前再次检查。
 * 这个函数不会创建目录，也还不检查最终文件名是否已经存在。
 */
async function resolveNewFile(
  path: string,
  projectRoot: string,
): Promise<{ target: string; parent: string; device: number; inode: number }> {
  try {
    const root = await realpath(projectRoot);
    const parent = await realpath(resolve(root, dirname(path)));
    const actualParent = relative(root, parent);
    if (actualParent === ".." || actualParent.startsWith(`..${sep}`) || isAbsolute(actualParent)) {
      throw new ToolError("新文件的父目录真实路径位于当前项目外。");
    }
    const parentInfo = await stat(parent);
    if (!parentInfo.isDirectory()) throw new ToolError("新文件的父路径不是目录。");
    const actualSegments = actualParent.replaceAll("\\", "/").split("/");
    if (actualSegments.some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase()))) {
      throw new ToolError("新文件的真实父目录属于硬保护范围。");
    }
    return { target: resolve(parent, basename(path)), parent, device: parentInfo.dev, inode: parentInfo.ino };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("新文件的父目录不存在或无法访问。");
  }
}

/**
 * 准备新文件的内容和预览，把真正的创建留到批准之后。
 *
 * - 输入是原始参数、项目根目录和可选取消信号。
 * - 准备时检查父目录，确认目标不存在，再用本次正文生成 preview。
 *   返回的 execute 函数仍引用这份正文，批准后调用它才创建文件。
 * - 执行时先复核父目录，再用 wx 创建，避免覆盖等待期间出现的同名文件。
 * - 准备或创建不满足条件时抛出 ToolError，由 Agent Loop 告诉模型原因。
 *
 * 仅调用准备函数不会写入文件，审批也不由这里完成。
 */
// [KEEP 来自 06.1] 先把正文和预览准备好，主循环批准后再调用下面保存的 execute。
export async function prepareWriteFile(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const parentSnapshot = await resolveNewFile(input.path, projectRoot);
  const { target } = parentSnapshot;
  try {
    await lstat(target);
    throw new ToolError(`目标已经存在，write_file 不会覆盖：${input.path}`);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ToolError(`无法检查目标文件：${input.path}`);
    }
  }
  const preview = createUnifiedDiff(input.path, null, input.content);
  return {
    preview,
    async execute(executionSignal): Promise<ToolExecutionResult> {
      executionSignal.throwIfAborted();
      try {
        // [KEEP 来自 06.1] 等待期间父目录可能被替换，保存前要确认它还是准备时的目录。
        const currentParent = await stat(parentSnapshot.parent);
        if (!currentParent.isDirectory() || currentParent.dev !== parentSnapshot.device
          || currentParent.ino !== parentSnapshot.inode) {
          throw new ToolError("新文件的父目录在差异预览后发生了变化，本次创建已取消。");
        }
        await writeFile(target, input.content, { encoding: "utf8", flag: "wx", signal: executionSignal });
      } catch (error) {
        executionSignal.throwIfAborted();
        if (error instanceof ToolError) throw error;
        throw new ToolError(`创建失败，目标可能已存在或无法写入：${input.path}`);
      }
      return {
        content: `已创建文件：${input.path}`,
        metadata: { kind: "write_file", path: input.path, bytes: Buffer.byteLength(input.content, "utf8") },
      };
    },
  };
}
