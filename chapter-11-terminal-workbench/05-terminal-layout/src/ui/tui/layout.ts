/**
 * 11.5 按终端列宽排版 | [NEW] ui/tui/layout.ts
 *
 * 学习目标：把字符串下标与终端列宽分开计算，完整显示中文和 emoji。
 * 输入：已准备好显示的文字与可用列数；调用方先清理控制字符。
 * 输出：带正文偏移的显示行，或第一行可容纳的文字；不修改原字符串。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   文字 -> 按字素遍历 -> 换行字符？-- 是 -> 收下当前行，开始新行
 *                                   +-- 否 -> 加上字素会超宽且当前行非空？
 *                                              是 -> 先收下当前行，再放入字素
 *                                              否 -> 放入当前行
 *   遍历结束 -> 收下末行 -> 返回每行文字与原文偏移
 *
 * UTF-16 偏移用来找回正文位置，stringWidth 用来计算终端占列，字素保证不把组合字符拆开。
 * 颜色开关读取 NO_COLOR；它只改变装饰，状态仍有文字说明。
 * 运行观察：中文和 emoji 在窄屏下整字换行；改变宽度后可用 offset 找到原先浏览的内容。
 */
import stringWidth from "string-width";
// [NEW 11.5] 本文件以下实现均为本节新增；草稿与历史共用相同的显示计数。
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export const useColor = !process.env.NO_COLOR;
export type WrappedLine = { offset: number; text: string };
/**
 * 在完整字符之间换行，并记住每一行来自正文的哪个位置。
 *
 * - 输入：显示文字与终端列宽；至少使用 2 列，控制字符清理由调用方负责。
 * - 输出：WrappedLine 数组，offset 是原字符串中的 UTF-16 下标；空文本也保留一行。
 * - 关键步骤：按字素取得完整字符，用 stringWidth 累计占列；遇到显式换行立即结束当前行，超宽则先换行再追加。
 * - 边界：保留空行和末尾换行；单个字素即使超过可用宽度也整体保留，不把它拆开。
 * - 职责边界：只给出排版结果，不限制消息存储量，也不做凭据隐藏。
 */
export function wrapLines(text: string, width: number): WrappedLine[] {
  const columns = Math.max(2, width);
  const lines: WrappedLine[] = [];
  let offset = 0, cells = 0, line = "";
  for (const part of segmenter.segment(text)) {
    if (part.segment === "\n") {
      lines.push({ offset, text: line }); offset = part.index + 1; line = ""; cells = 0; continue;
    }
    const size = stringWidth(part.segment);
    if (cells + size > columns && line) {
      lines.push({ offset, text: line }); offset = part.index; line = ""; cells = 0;
    }
    line += part.segment; cells += size;
  }
  lines.push({ offset, text: line });
  return lines;
}
/**
 * 取出一行能够显示的文字，供提示与标题使用。
 *
 * - 输入：显示文字和可用终端列数。
 * - 输出：wrapLines 得到的第一行，不添加省略号；空输入返回空字符串。
 * - 关键原因：沿用相同字素和列宽规则，提示不会用 UTF-16 截取把 emoji 切成半个。
 * - 职责边界：只截取显示副本，原提示或正文仍保存在调用方。
 */
export function fitLine(text: string, width: number): string {
  return wrapLines(text, width)[0].text;
}
