/**
 * 09.2 按顺序接收执行事件 | [KEEP] tools/edit-file.ts
 *
 * 学习目标：保存前再看看文件有没有变化，避免把已经发现的新修改覆盖掉。
 * 输入：编辑参数，以及准备时从同一文件句柄读出的身份和完整原文。
 * 输出：文件未变就先备份再保存，返回备份位置；检查失败则停止，不覆盖目标。
 * 状态：检查或备份失败时尚未覆盖目标；进入写入后再失败可能留下部分内容，不自动恢复备份。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   准备：找到真实目标 -> 只读打开 -> 记下 dev/ino 与 before -> 原文只出现一处？
 *                                                           否 -> ToolError
 *                                                           是 -> 算出 after 和 diff
 *   执行：打开保存的 target -> 身份、类型、大小、全文都符合准备时的记录？
 *                             否 -> ToolError，不备份也不覆盖
 *                             是 -> 保存 before 备份 -- 失败 --> ToolError
 *                                                    +-- 成功 --> 清空目标并从 0 写入
 *                                                                   成功 -> sync -> 返回结果
 *                                                                   失败 -> 报告可用备份
 *
 * 主循环在准备与执行之间等待审批。执行时检查和写入都用同一个 r+ 句柄，
 * dev/ino 检查文件有没有被替换，全文检查内容有没有变化，两项都通过才能继续。
 * 这没有锁住文件，检查后仍可能有并发写入，也不会在写入失败后自动恢复。
 * 备份位于系统临时目录，不保证长期保留。运行时可以在审批期间改文件，观察旧请求失败。
 */

// [KEEP 来自 06.3] 使用文件句柄复核，并在系统临时目录保存原文。
import { mkdtemp, open, realpath, stat, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import { createUnifiedDiff } from "./change-preview.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

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
 * 扫描完整字符串后，只找到一处就返回字符下标；零处或多处都抛出 ToolError，多处时报告实际次数。
 * 没有匹配可能是文件变了，也可能是模型给错文字或空格，不能直接断定原因。
 * 每次从刚找到的位置 + 1 继续：aaaa 中的 aa 有三个可能起点，重叠的位置也要计数。
 * 本函数只查字符串，不修改文件。
 */
// [KEEP 来自第 06 章练习] 统计全部匹配，包括重叠位置。
function findUniqueMatch(content: string, oldText: string): number {
  let first = -1;
  let count = 0;
  let searchFrom = 0;

  while (true) {
    const index = content.indexOf(oldText, searchFrom);
    if (index === -1) break;
    if (first === -1) first = index;
    count += 1;
    searchFrom = index + 1;
  }

  if (count === 0) {
    throw new ToolError("old_text 在当前文件中不存在，请重新读取文件后再修改。");
  }
  if (count > 1) {
    throw new ToolError(`old_text 在当前文件中出现 ${count} 次，请提供更多上下文，让它只匹配一次。`);
  }
  return first;
}

/**
 * 把准备时读到的文件记下来，批准后先比较，再备份和保存。
 *
 * - 输入是编辑参数、项目根目录和可选取消信号。准备时通过一个只读句柄取得
 *   设备号、inode 和 before，再按唯一匹配生成 after 与预览。
 * - 返回的 execute 会打开已保存的真实目标，通过同一个 r+ 句柄检查身份和全文。
 * - 文件已变就停止；没变才先保存 0600 临时备份，再清空目标、从字节 0 写入并 sync。
 * - 检查或备份失败时还没有覆盖目标；普通写入错误会报告已经留下的备份位置。
 *
 * 这里没有文件锁或自动回滚，内容比较之后仍可能有其他进程写入。
 */
// [KEEP 来自 06.3] 待执行修改同时保存 before 和 after，执行时用 before 检测审批后的外部变化。
export async function prepareEditFile(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const target = await resolveEditableFile(input.path, projectRoot);
  let before: string;
  let preparedDevice = 0;
  let preparedInode = 0;
  let preparationHandle: FileHandle | undefined;
  try {
    // [KEEP 来自 06.3] 身份和 before 必须来自同一已打开文件；两次按路径访问可能观察到不同对象。
    preparationHandle = await open(target, "r");
    const preparedInfo = await preparationHandle.stat();
    if (!preparedInfo.isFile() || preparedInfo.size > MAX_FILE_BYTES) {
      throw new ToolError("文件在准备修改时已不再是 1 MiB 以内的普通文件。");
    }
    preparedDevice = preparedInfo.dev;
    preparedInode = preparedInfo.ino;
    before = await preparationHandle.readFile({ encoding: "utf8" });
    signal?.throwIfAborted();
  } catch {
    signal?.throwIfAborted();
    throw new ToolError(`无法读取文件：${input.path}`);
  } finally {
    try { await preparationHandle?.close(); } catch { /* 读取失败已经转换成工具错误。 */ }
  }
  if (before.includes("\0")) throw new ToolError("edit_file 不修改二进制文件。");
  const index = findUniqueMatch(before, input.oldText);
  const after = before.slice(0, index) + input.newText + before.slice(index + input.oldText.length);
  const preview = createUnifiedDiff(input.path, before, after);
  return {
    preview,
    async execute(executionSignal): Promise<ToolExecutionResult> {
      executionSignal.throwIfAborted();
      let backupPath: string | null = null;
      let handle: FileHandle | undefined;
      try {
        // [KEEP 来自 06.3] 复核和后续写入共用这个 r+ 句柄；身份不同或 current !== before 时本次修改作废。
        handle = await open(target, "r+");
        const currentInfo = await handle.stat();
        if (currentInfo.dev !== preparedDevice || currentInfo.ino !== preparedInode) {
          throw new ToolError("文件在差异预览后被替换，本次修改已取消；请重新读取并生成新的修改。");
        }
        if (!currentInfo.isFile() || currentInfo.size > MAX_FILE_BYTES) {
          throw new ToolError("文件在差异预览后类型或大小发生了变化，本次修改已取消。");
        }
        const current = await handle.readFile({ encoding: "utf8" });
        executionSignal.throwIfAborted();
        if (current !== before) {
          throw new ToolError("文件在差异预览后发生了变化，本次修改已取消；请重新读取并生成新的修改。");
        }

        // [KEEP 来自 06.3] 先以 0600 和 wx 保存 before；这一步失败时还没有截断目标文件。
        const backupDirectory = await mkdtemp(join(tmpdir(), "hello-my-agent-backup-"));
        const backupCandidate = join(backupDirectory, `${basename(input.path)}.bak`);
        try {
          await writeFile(backupCandidate, before, { encoding: "utf8", flag: "wx", mode: 0o600 });
        } catch {
          throw new ToolError(`无法创建修改前备份，目标文件未修改：${input.path}`);
        }
        // 只有 writeFile 完整成功后，这个路径才代表真实可用的恢复副本。
        backupPath = backupCandidate;
        executionSignal.throwIfAborted();
        await handle.truncate(0);
        // [KEEP 来自 06.3] readFile 已把句柄位置推进到旧 EOF；显式 position=0 防止截断后写出 NUL 空洞。
        const { bytesWritten } = await handle.write(after, 0, "utf8");
        if (bytesWritten !== Buffer.byteLength(after, "utf8")) {
          throw new ToolError(`文件只写入了 ${bytesWritten} 字节，原内容备份位于：${backupPath}`);
        }
        await handle.sync();
        await handle.close();
        handle = undefined;
      } catch (error) {
        executionSignal.throwIfAborted();
        if (error instanceof ToolError) throw error;
        throw new ToolError(backupPath
          ? `写入失败；原内容备份位于：${backupPath}`
          : `无法安全写入文件：${input.path}`);
      } finally {
        // 已知写入错误优先返回带备份位置的 ToolError；清理失败不覆盖这个诊断。
        try { await handle?.close(); } catch { /* 文件句柄会随进程退出释放。 */ }
      }
      return {
        content: `已精确替换文件中的 1 处文本：${input.path}\n修改前备份：${backupPath}`,
        metadata: {
          kind: "edit_file",
          path: input.path,
          bytes: Buffer.byteLength(after, "utf8"),
          backupPath: backupPath as string,
        },
      };
    },
  };
}
