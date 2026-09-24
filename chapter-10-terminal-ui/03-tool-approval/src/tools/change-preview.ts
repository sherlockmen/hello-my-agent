/**
 * 10.3 在界面中批准工具调用 | [KEEP] tools/change-preview.ts
 *
 * 学习目标：把实际准备保存的内容展示出来，让用户在写入之前看清改了什么。
 * 输入：文件路径、原文 before 和新文 after；创建新文件时没有原文，用 null 表示。
 * 输出：完整的 unified diff。这里只处理字符串，不读取或修改文件。
 * 状态：预览过长时抛出 ToolError；无论成功或失败，本文件都不修改磁盘内容。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   before / after -> 拆成显示行 -> 找相同的开头和结尾 -> 标记中间的变化
 *                                                           |
 *                                              预览超过上限？
 *                                              是 -> ToolError
 *                                              否 -> 返回完整 diff
 *
 * 前后各留最多三行上下文，方便看出改动在哪里；中间放在一个变更块里，不寻找最小 diff。
 * 制表符等字符会转成可见文字，但 before / after 本身不变；实际保存的是未经显示转义的新内容 after。
 * 如果预览太长就拒绝，因为只展示一部分后再保存全部内容，用户就没有看过完整修改。
 * 运行观察：创建文件显示所有新增行，编辑文件显示原来的行和替换后的行。
 */

import { ToolError } from "../errors.js";

// [KEEP 来自 06.1] 差异展示继续使用逐行比较与单个变更块。
const CONTEXT_LINES = 3;
const MAX_PREVIEW_CHARS = 20_000;

/**
 * 把正文变成终端里可以逐行查看的文字。
 *
 * 输入是原始字符串，返回值只用来显示，不拿它写文件。
 * 末尾换行不再多算一个空行；反斜杠、制表符和其他控制字符改为可见写法，
 * 这样用户能看见它们，也不会让正文中的控制字符直接改变终端显示。
 */
function splitDisplayLines(text: string): string[] {
  if (!text) return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").map((line) => line
    .replaceAll("\\", "\\\\")
    .replace(/[\u0000-\u001f\u007f]/g, (character) =>
      character === "\t"
        ? "\\t"
        : `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`));
}

/**
 * 根据完整原文和新文，生成这次修改的预览。
 *
 * before 为 null 表示新文件。先找两端相同的行，把中间变化显示成一个块，
 * 前后各保留最多三行上下文；若只改了末尾换行，也要让这项变化显示出来。
 * 返回完整的文件头和差异文字。超过 20000 字符就抛出 ToolError，要求拆小修改，
 * 不能截断后继续审批。这里只生成显示内容，不访问文件系统。
 */
// [KEEP 来自 06.1] 所有写入审批都使用同一份 diff 生成规则。
export function createUnifiedDiff(path: string, before: string | null, after: string): string {
  const oldLines = before === null ? [] : splitDisplayLines(before);
  const newLines = splitDisplayLines(after);
  const oldEndsWithNewline = before?.endsWith("\n") ?? true;
  const newEndsWithNewline = after.endsWith("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length
    && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;

  // 只有文件末尾换行发生变化时，文本行本身完全相同；把最后一行放回变更区才能显示差异。
  if (before !== null && oldEndsWithNewline !== newEndsWithNewline
    && prefix === oldLines.length && prefix === newLines.length && prefix > 0) {
    prefix -= 1;
    suffix = 0;
  }

  const contextStart = Math.max(0, prefix - CONTEXT_LINES);
  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const oldEnd = Math.min(oldLines.length, oldChangeEnd + CONTEXT_LINES);
  const newEnd = Math.min(newLines.length, newChangeEnd + CONTEXT_LINES);
  const oldStartLine = before === null ? 0 : contextStart + 1;
  const newStartLine = contextStart + 1;
  const removed = oldLines.slice(prefix, oldChangeEnd).map((line) => `-${line}`);
  if (before !== null && oldChangeEnd === oldLines.length && oldLines.length > 0 && !oldEndsWithNewline) {
    removed.push("\\ No newline at end of file");
  }
  const added = newLines.slice(prefix, newChangeEnd).map((line) => `+${line}`);
  if (newChangeEnd === newLines.length && newLines.length > 0 && !newEndsWithNewline) {
    added.push("\\ No newline at end of file");
  }
  const body = [
    ...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`),
    ...removed,
    ...added,
    ...newLines.slice(newChangeEnd, newEnd).map((line) => ` ${line}`),
  ];
  const preview = [
    `--- ${before === null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -${oldStartLine},${oldEnd - contextStart} +${newStartLine},${newEnd - contextStart} @@`,
    ...body,
  ].join("\n");
  if (preview.length > MAX_PREVIEW_CHARS) {
    throw new ToolError("变更预览超过 20000 个字符，请把修改拆成更小的步骤。");
  }
  return preview;
}
