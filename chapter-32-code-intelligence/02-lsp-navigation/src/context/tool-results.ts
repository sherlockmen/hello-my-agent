/**
 * 32.2 用语言服务定位符号 | [KEEP] context/tool-results.ts
 *
 * 学习目标：把模型需要的短结果与本机可定位的完整工具结果分开保存。
 * 输入：工具已经收集并返回的正文，不是无限长的进程原始输出。
 * 输出：短正文原样返回；长正文先写私有日志、sync，再返回开头、结尾与文件引用。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整工具正文 -> 超过 8000 字符？-- 否 -> 原样返回
 *                             +-- 是 -> 写完整日志、sync、关闭 -> 头尾 + 省略提示 + 可续读编号
 *   写入失败 / 取消 -> 等关闭、尽量删除不完整日志 -> 核心保留工具状态并停止本轮
 * 这里不绕过原工具的输出限制，也不保证磁盘上无限期保留日志。
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 15.2] 长度按 Unicode 码点计数，头尾不会从代理对中间切开。
export const MAX_TOOL_RESULT_CHARS = 8_000;
export const TOOL_RESULT_HEAD_CHARS = 6_000;
export const TOOL_RESULT_TAIL_CHARS = 2_000;
export const DEFAULT_TOOL_RESULT_DIRECTORY = join(homedir(), ".hello-my-agent", "tool-results");
export type BoundedToolResult = { content: string; originalChars: number; logPath?: string; logId?: string };

/**
 * 为结果保留前 6000 和后 2000 个原字符，中间明确写出省略数量。
 * 附加说明不计入 8000 个原字符，所以最终正文会比 8000 更长。
 */
export function clippedToolText(content: string): string {
  const characters = Array.from(content);
  if (characters.length <= MAX_TOOL_RESULT_CHARS) return content;
  return characters.slice(0, TOOL_RESULT_HEAD_CHARS).join("")
    + `\n\n[中间省略 ${characters.length - MAX_TOOL_RESULT_CHARS} 个字符；裁剪可能省略重要信息]\n\n`
    + characters.slice(-TOOL_RESULT_TAIL_CHARS).join("");
}

/**
 * 成功保存完整正文后才给出日志引用；日志文件使用独占创建与 0600 权限。
 * signal 在开始和写完后检查；写入中的系统调用仍会等关闭，取消不留下已宣称成功的半份日志。
 * 失败或取消会关闭并尽量删除未完成文件；失败抛出安全说明，由核心保留调用结果摘要并停止本轮。
 * 目录只拒绝最后一级已存在的符号链接；这不是抵抗恶意并发替换的文件系统沙箱。
 */
export async function boundToolResult(content: string, signal: AbortSignal, directory = DEFAULT_TOOL_RESULT_DIRECTORY): Promise<BoundedToolResult> {
  signal.throwIfAborted();
  const originalChars = Array.from(content).length;
  if (originalChars <= MAX_TOOL_RESULT_CHARS) return { content, originalChars };
  const targetDirectory = resolve(directory);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let path: string | undefined;
  let complete = false;
  try {
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    const information = await lstat(targetDirectory);
    if (!information.isDirectory() || information.isSymbolicLink()) throw new Error("invalid log directory");
    signal.throwIfAborted();
    const id = randomUUID();
    path = join(targetDirectory, `${id}.log`);
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    signal.throwIfAborted();
    complete = true;
    return { content: `[工具结果已裁剪；以下仅为头尾，完整工具返回保存在本机：${path}；日志编号 ${id}。\n需要中间内容时调用 read_tool_result，id 使用该编号，offset 从 1 开始，limit 最多 5；超长行可用 column 续读。]\n`
      + clippedToolText(content), originalChars, logPath: path, logId: id };
  } catch {
    signal.throwIfAborted();
    throw new UserFacingError("完整工具结果日志无法保存，本轮已停止；没有生成可用的完整日志引用。请检查本机磁盘与目录权限。");
  } finally {
    await handle?.close().catch(() => {});
    if (!complete && path) await unlink(path).catch(() => {});
  }
}
