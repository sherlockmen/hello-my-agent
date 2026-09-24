/**
 * 11.3 浏览历史与工具结果 | [KEEP 来自 11.2] ui/tui/input-assist.ts
 *
 * 学习目标：从已经发送过的问题找回草稿，并补上本地命令或项目路径。
 * 输入：本次会话的问题列表，或当前草稿、光标和取消信号。
 * 输出：搜索候选，或补全后的文字、光标和提示；失败向调用方抛错，不提交问题。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   历史查询 -> 倒序、去重、按子串筛选 -> 返回候选
 *   Tab -> 光标前是单行 / 命令？-- 是 -> 匹配本地命令表
 *                                +-- 否 -> 有 @路径？-- 否 -> 原草稿与用法提示
 *                                                     +-- 是 -> 搜索项目内路径
 *   候选超出 20 项？-- 是 -> 保留原草稿，提示继续缩小范围
 *                    +-- 否 -> 唯一候选或共同前缀 -> 接回光标右侧文字
 *
 * 补全只查文件名称；项目根和忽略规则复用已有 glob 工具，不读取文件正文。
 * 运行观察：Tab 补入 @ 后的路径，仍需按 Enter 发送；候选过多时先继续输入。
 */
import { findMatchingFiles, validateGlobPattern } from "../../tools/glob.js";
import { findProjectRoot } from "../../tools/workspace.js";

// [KEEP 来自 11.2] 输入历史和补全只修改草稿，不启动 Agent 或读取文件正文。
/**
 * 按关键词找出之前发送过的问题，优先显示最近一次。
 *
 * - 输入：当前进程保存的问题数组和查询字符串。
 * - 输出：倒序、去重后匹配查询的文字数组；空查询可浏览全部唯一记录。
 * - 关键原因：先倒序再去重，重复问题留下最近的位置；比较忽略大小写。
 * - 职责边界：不读取模型回答、不修改原数组，也不从磁盘恢复历史。
 */
export function searchPrompts(prompts: string[], query: string): string[] {
  return [...new Set([...prompts].reverse())].filter((text) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}
/**
 * 找出所有候选共有的开头，避免替用户随意选择一项。
 *
 * - 输入：已经筛选过的候选字符串数组。
 * - 输出：所有值共同的前缀；空数组或没有共同开头时返回空字符串。
 * - 关键步骤：从第一项开始缩短前缀，直到每一项都以它开头；每次按完整 Unicode 码点缩短。
 * - 职责边界：不重新排序或查询候选；这里不按终端列宽截取文字。
 */
export function commonPrefix(values: string[]): string {
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) while (!value.startsWith(prefix)) prefix = Array.from(prefix).slice(0, -1).join("");
  return prefix;
}
/**
 * 只补全光标前的命令或 @路径，并保留后面的草稿。
 *
 * - 输入：草稿、UTF-16 光标下标及可选取消信号；光标由编辑器维护。
 * - 输出：新文字、新光标和提示；无候选、无补全位置或候选过多时保留原草稿。
 * - 关键步骤：本地命令查固定表；路径把输入中的 glob 特殊符号转义，再复用项目根、忽略规则与最多 20 项的路径结果。
 * - 候选处理：唯一候选补全整项，多个候选只延长共同前缀；唯一且含空白的路径用 JSON 引号保留边界。
 * - 失败方式：路径检查、搜索或取消错误交给编辑器显示；返回前检查取消，但是否仍是原草稿由组件另行确认。
 * - 职责边界：读取的是路径名，不是文件正文；函数返回文字，不执行工具或提交模型请求。
 */
export async function completeInput(text: string, cursor: number, signal?: AbortSignal): Promise<{ text: string; cursor: number; hint: string }> {
  const left = text.slice(0, cursor), right = text.slice(cursor);
  let candidates: string[], start: number, prefix: string;
  if (left.startsWith("/") && !left.includes("\n")) {
    prefix = left; start = 0;
    candidates = ["/exit", "/reset", "/permissions", "/permissions reset"].filter((command) => command.startsWith(prefix));
  } else {
    const match = /(?:^|\s)@([^\s]*)$/.exec(left);
    if (!match) return { text, cursor, hint: "输入 / 补全本地命令，或 @ 后面的项目路径，再按 Tab。" };
    prefix = match[1]; start = left.length - prefix.length;
    const pattern = validateGlobPattern(prefix.replace(/[?*\[\]{}\\]/g, "\\$&") + "*");
    const result = await findMatchingFiles(pattern, findProjectRoot(), 20, signal);
    candidates = result.paths.filter((path) => path.startsWith(prefix));
    if (result.truncated) return { text, cursor, hint: "候选超过 20 项，请继续输入更完整的路径。" };
  }
  signal?.throwIfAborted();
  if (!candidates.length) return { text, cursor, hint: "没有匹配的候选。" };
  let replacement = candidates.length === 1 ? candidates[0] : commonPrefix(candidates);
  if (candidates.length === 1 && /\s/.test(replacement) && !left.startsWith("/")) replacement = JSON.stringify(replacement);
  const next = left.slice(0, start) + replacement;
  return { text: next + right, cursor: next.length, hint: candidates.length === 1 ? "已补入草稿，尚未发送。" : `候选：${candidates.join(" · ")}` };
}
