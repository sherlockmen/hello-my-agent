/**
 * 06.2 找到原文，只替换这一处 | [NEW] tools/edit-file.ts
 *
 * 学习目标：让模型说出原文和新文，程序找到那一段后，只替换它。
 * 输入：已有文件路径、非空 old_text，以及替换后的 new_text。
 * 输出：找到唯一位置后返回 diff 与执行函数；找不到或有多处时抛错，不写文件。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数与文件检查 -> 读取 before -> 查找 old_text
 *                                       +-- 0 处 --> ToolError：没有这段原文
 *                                       +-- 多处 --> ToolError：不知道该改哪一处
 *                                       +-- 1 处 --> 拼出 after -> 生成 diff -> 返回
 *   批准后调用 execute -> 保存 after -- 成功 --> 返回编辑结果
 *                                   +-- 失败 --> ToolError
 *
 * 原文可以带变量名、空格、换行和相邻语句；程序按原样找，不猜模型要改哪里。
 * 新全文 = 匹配前的内容 + new_text + 匹配后的内容，两侧文字直接从原文件保留。
 * 本节保存时还不重新检查文件，06.3 会处理等待审批期间发生的改动。
 * 运行观察：位置不明确时没有审批；只找到一处时，先出现 diff，批准后才保存。
 */

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import { createUnifiedDiff } from "./change-preview.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [NEW 06.2] 本文件以下实现均为本节新增。
export const editFileDefinition = {
  name: "edit_file",
  description: "把已有文本文件中唯一出现的 old_text 替换成 new_text。执行前展示完整 diff 并等待批准。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "相对于项目根目录的已有文件路径。" },
      old_text: { type: "string" as const, description: "文件中必须恰好出现一次的完整原文。" },
      new_text: { type: "string" as const, description: "用于替换 old_text 的新文本。" },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  },
};

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_REPLACEMENT_BYTES = 256 * 1024;
const PROTECTED_DIRECTORIES = new Set([".git", ".agents", ".codex"]);

type EditArguments = { path: string; oldText: string; newText: string };

/**
 * 检查文件名是不是禁止修改的环境配置文件。
 * 传入已经整理好的路径；末段为 .env、.env.* 或 .envrc 时返回 true，让调用方拒绝编辑。
 */
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 检查模型有没有把这次替换说清楚。
 *
 * 输入是模型给出的 JSON 字符串，返回检查后的路径、oldText 和 newText。
 * 字段、路径、保护范围、控制字符或大小不符合要求时，抛出 ToolError。
 * oldText 不能空，新旧文字也不能相同；但 newText 可以为空，表示删除原文。
 * 不要 trim 原文和新文，因为空格与换行本身就是要匹配或保存的内容。
 */
function parseArguments(argumentsJson: string): EditArguments {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch {
    throw new ToolError("edit_file 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("edit_file 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 3 || !keys.every((key) => ["path", "old_text", "new_text"].includes(key))) {
    throw new ToolError("edit_file 参数必须且只能包含 path、old_text 和 new_text。");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new ToolError("edit_file path 必须是非空字符串。");
  }
  if (typeof input.old_text !== "string" || !input.old_text) {
    throw new ToolError("edit_file old_text 必须是非空字符串。");
  }
  if (typeof input.new_text !== "string") throw new ToolError("edit_file new_text 必须是字符串。");
  if (input.old_text === input.new_text) throw new ToolError("old_text 和 new_text 相同，没有需要执行的修改。");
  if (Buffer.byteLength(input.old_text, "utf8") > MAX_REPLACEMENT_BYTES
    || Buffer.byteLength(input.new_text, "utf8") > MAX_REPLACEMENT_BYTES) {
    throw new ToolError("old_text 和 new_text 分别不能超过 256 KiB。");
  }
  const path = input.path.trim().replaceAll("\\", "/");
  const segments = path.split("/");
  if (path.length > 500 || isAbsolute(path) || win32.isAbsolute(path)
    || /[\u0000-\u001f\u007f]/.test(path)
    || segments.some((segment) => segment === ".." || segment === "")) {
    throw new ToolError("edit_file path 必须是项目内不含 .. 的相对文件路径。");
  }
  if (isEnvironmentFile(path)) throw new ToolError("环境配置文件属于硬保护范围，不能修改。");
  if (segments.some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw new ToolError("项目元数据目录属于硬保护范围，不能修改。");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.old_text + input.new_text)) {
    throw new ToolError("edit_file 只修改文本文件，old_text 和 new_text 不能包含终端控制字符。");
  }
  return { path, oldText: input.old_text, newText: input.new_text };
}

/**
 * 找到真正要编辑的文件，并检查它是否在允许的范围内。
 *
 * 模型给的是项目相对路径，这里先解析符号链接，再检查实际目标是否仍在项目内，
 * 是否为受保护文件、是否为普通文件、检查时是否超过 1 MiB。
 * 成功返回真实绝对路径；文件不存在、无法访问或检查失败时抛出 ToolError。
 * 这些路径检查还没有锁住文件，不能保证其他程序之后不会修改或替换它。
 */
async function resolveEditableFile(path: string, projectRoot: string): Promise<string> {
  try {
    const root = await realpath(projectRoot);
    const target = await realpath(resolve(root, path));
    const actual = relative(root, target);
    if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) {
      throw new ToolError("文件的真实路径位于当前项目外。");
    }
    const normalized = actual.replaceAll("\\", "/");
    if (isEnvironmentFile(normalized)
      || normalized.split("/").some((segment) => PROTECTED_DIRECTORIES.has(segment.toLowerCase()))) {
      throw new ToolError("文件的真实路径属于硬保护范围，不能修改。");
    }
    const info = await stat(target);
    if (!info.isFile()) throw new ToolError("edit_file 只能修改普通文件。");
    if (info.size > MAX_FILE_BYTES) throw new ToolError("edit_file 不修改超过 1 MiB 的文件。");
    return target;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`文件不存在或无法访问：${path}`);
  }
}

/**
 * 找到唯一的原文位置，找不准时让模型补充信息。
 *
 * content 是准备时读到的全文，oldText 已经由调用方检查为非空。
 * 只找到一处就返回字符下标；没有匹配或找到第二处，都抛出 ToolError。
 * 没有匹配可能是文件变了，也可能是模型给错文字或空格，不能直接断定原因。
 * 第二次从 first + 1 继续：aaa 中的 aa 可以从 0 或 1 开始，两个位置都要检查到。
 * 本函数只查字符串，不修改文件。
 */
function findUniqueMatch(content: string, oldText: string): number {
  const first = content.indexOf(oldText);
  if (first === -1) throw new ToolError("old_text 在当前文件中不存在，请重新读取文件后再修改。");
  if (content.indexOf(oldText, first + 1) !== -1) {
    throw new ToolError("old_text 在当前文件中出现多次，请提供更多上下文，让它只匹配一次。");
  }
  return first;
}

/**
 * 根据唯一原文算出新内容，等批准后再保存。
 *
 * - 检查参数和路径，读出完整 before，再找到 oldText 唯一出现的位置。
 * - 用 slice 保留两侧文字，中间换成 newText，得到 after。
 * - 返回完整 diff，供用户查看；批准后调用 execute，把已经算好的 after 保存回文件。
 * - 文件、原文或预览不符合要求时抛出 ToolError，交给主循环告诉模型原因。
 *
 * 本节执行时直接保存 after；06.3 会在这一步前检查文件是不是又变了。
 */
// [NEW 06.2] 精确编辑在准备阶段同时证明“位置唯一”和“用户将看到什么”。
export async function prepareEditFile(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const target = await resolveEditableFile(input.path, projectRoot);
  let before: string;
  try { before = await readFile(target, { encoding: "utf8", signal }); } catch {
    signal?.throwIfAborted();
    throw new ToolError(`无法读取文件：${input.path}`);
  }
  if (before.includes("\0")) throw new ToolError("edit_file 不修改二进制文件。");
  const index = findUniqueMatch(before, input.oldText);
  const after = before.slice(0, index) + input.newText + before.slice(index + input.oldText.length);
  const preview = createUnifiedDiff(input.path, before, after);
  return {
    preview,
    async execute(executionSignal): Promise<ToolExecutionResult> {
      executionSignal.throwIfAborted();
      try { await writeFile(target, after, { encoding: "utf8", signal: executionSignal }); } catch {
        executionSignal.throwIfAborted();
        throw new ToolError(`无法写入文件：${input.path}`);
      }
      return {
        content: `已精确替换文件中的 1 处文本：${input.path}`,
        metadata: { kind: "edit_file", path: input.path, bytes: Buffer.byteLength(after, "utf8") },
      };
    },
  };
}
