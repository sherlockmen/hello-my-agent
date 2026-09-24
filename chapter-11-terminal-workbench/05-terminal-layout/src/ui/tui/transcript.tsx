/**
 * 11.5 按终端列宽排版 | [CHANGED] ui/tui/transcript.tsx
 *
 * 学习目标：窗口宽度变化后，仍能找到正在浏览的正文位置。
 * 输入：带稳定 ID 的显示消息、焦点、可用宽高；工具详情来自 RunView。
 * 输出：当前历史视口；滚动与折叠只改变浏览状态，不改变模型历史。
 * 状态：没有锚点时跟随末尾，手动浏览后保存消息 ID 与正文偏移；End 清除锚点并回到最新。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   消息 -> 展开集合决定是否显示详情 -> 折行 -> 有锚点？-- 否 -> 取末尾视口
 *                                                        +-- 是 -> 找到保存位置
 *   历史区有焦点？-- 否 -> 只显示最新数据
 *                  +-- 是 -> 滚动 / 选消息 / 展开 -> 更新浏览状态
 *   Ctrl+Y -> 有选中消息？-- 否 -> 返回
 *                         +-- 是 -> 复制正文和详情 -> 成功 / 失败提示
 *
 * 本轮进行中与结束后的条目使用同一组 ID，所以重绘和任务完成不会改变消息身份。
 * 折行行号会随列宽变化；保存正文偏移后，可以在新行列表里重新找到包含它的行。
 * 运行观察：向上浏览后新输出不会把视口拉回底部；按 End 才恢复跟随。
 */
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
// [CHANGED 11.5] 使用统一折行函数，取得每行对应的正文偏移。
import { wrapLines, useColor } from "./layout.js";
import { copyText } from "./system-actions.js";
import { screenText, type RunView } from "./state.js";

// [KEEP 来自 11.3] 浏览位置独立于执行进度；消息 ID 不因屏幕重绘而改变。
export type Entry = { id: string; label: "你" | "Agent" | "工具" | "本地"; text: string; details?: string };
// [CHANGED 11.5] 用正文偏移替代折行行号，避免窗口变宽或变窄后锚点漂移。
export type ViewLine = { id: string; offset: number; text: string };
export type Anchor = { id: string; offset: number } | undefined;
/**
 * 把一轮显示状态拆成可以单独选择的消息。
 *
 * - 输入：最新 RunView 和会话内递增的轮次编号。
 * - 输出：工具、非空模型回答、结束状态三组 Entry；工具详情单独放在 details。
 * - 关键原因：ID 由轮次加工具序号或模型调用号组成，运行中重绘和结束后留存可以指向同一消息。
 * - 职责边界：这是显示分组，不重建原始事件发生顺序，也不写模型消息历史。
 */
export function runEntries(view: RunView, run: number): Entry[] {
  return [
    ...view.tools.map((tool): Entry => ({ id: `${run}:tool:${tool.sequence}`, label: "工具", text: `${tool.name}：${tool.status}`, details: tool.detail })),
    ...view.answers.filter((answer) => answer.text).map((answer): Entry => ({ id: `${run}:answer:${answer.call}`, label: "Agent", text: answer.text })),
    { id: `${run}:status`, label: "本地", text: `${view.status}${view.usage ? ` · ${view.usage}` : ""}` },
  ];
}
/**
 * 按当前展开状态，把消息排成可滚动的显示行。
 *
 * - 输入：显示消息、可用宽度和已展开的消息 ID 集合。
 * - 输出：每行带消息 ID、正文偏移和显示文字，供视口重新定位。
 * - 关键步骤：先选择摘要或完整详情，清理控制字符，再按共同的字素与列宽规则折行。
 * - 职责边界：折叠只影响本次排版，Entry 的详情仍保留，复制时仍能取得它。
 */
// [CHANGED 11.5] 折行结果直接带上正文偏移，不再额外生成行号。
export function transcriptLines(entries: Entry[], width: number, expanded: Set<string>): ViewLine[] {
  return entries.flatMap((entry) => {
    const body = `${entry.label} > ${entry.text}${entry.details !== undefined ? expanded.has(entry.id) ? `\n${entry.details}` : " [结果已折叠]" : ""}`;
    return wrapLines(screenText(body), width).map((line) => ({ id: entry.id, ...line }));
  });
}
/**
 * 把保存的正文位置换算成当前行列表中的视口起点。
 *
 * - 输入：重新排版后的行列表、视口高度和可选锚点。
 * - 输出：视口首行下标；没有锚点时取末尾，有锚点但消息已不存在时回到第 0 行。
 * - 关键原因：终端缩放会改变折行数量；在同一消息里找最后一个不超过锚点偏移的行，就能重新定位正文。
 * - 职责边界：只计算显示位置，不修改锚点，也不会触发新的执行事件。
 */
// [CHANGED 11.5] 重新排版后，按同一消息的正文偏移寻找当前行。
export function visibleStart(lines: ViewLine[], height: number, anchor: Anchor): number {
  if (!anchor) return Math.max(0, lines.length - height);
  const found = lines.reduce((found, line, index) => line.id === anchor.id && line.offset <= anchor.offset ? index : found, -1);
  return Math.max(0, found);
}
/**
 * 在固定视口中浏览消息，让滚动和新输出互不抢位置。
 *
 * - 输入：显示消息、历史区是否有焦点，以及可用宽高。
 * - 输出：当前视口、选中标记和操作提示；不向 Agent 发出问题。
 * - 浏览步骤：方向键或翻页键保存视口锚点，j / k 选择消息，Enter 切换详情；End 清除锚点恢复跟随。
 * - 复制步骤：Ctrl+Y 复制选中条目的文字与详情；重复复制先取消旧任务，组件卸载也取消尚未结束的复制。
 * - 失败方式：复制错误只更新提示，不改变消息；粘贴在历史区只提示返回草稿，不修改草稿或触发审批。
 * - 职责边界：焦点由父组件分配；没有焦点时继续显示数据，但不消费历史操作按键。
 */
export function Transcript({ entries, active, width, height }: { entries: Entry[]; active: boolean; width: number; height: number }) {
  const [anchor, setAnchor] = useState<Anchor>();
  const [selected, setSelected] = useState<string>();
  const [expanded, setExpanded] = useState(new Set<string>());
  const [notice, setNotice] = useState("");
  const copying = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => copying.current?.abort(), []);
  const lines = transcriptLines(entries, width - 2, expanded);
  const start = visibleStart(lines, height, anchor);
  const chosen = selected ?? entries.at(-1)?.id;
  useInput((input, key) => {
    if (key.pageUp || key.pageDown || key.upArrow || key.downArrow) {
      const distance = key.pageUp || key.pageDown ? Math.max(1, height - 1) : 1;
      const next = Math.max(0, Math.min(Math.max(0, lines.length - height), start + (key.pageUp || key.upArrow ? -distance : distance)));
      setAnchor(lines[next]); setSelected(lines[next]?.id); return;
    }
    if (key.end) { setAnchor(undefined); setSelected(undefined); return; }
    if (key.home) { setAnchor(lines[0]); setSelected(lines[0]?.id); return; }
    // [CHANGED 11.5] 选择消息和展开详情都把锚点放回该消息的正文起点。
    if (input === "j" || input === "k") {
      const index = entries.findIndex((entry) => entry.id === chosen);
      const target = entries[Math.max(0, Math.min(entries.length - 1, index + (input === "j" ? 1 : -1)))];
      if (target) { setSelected(target.id); setAnchor({ id: target.id, offset: 0 }); } return;
    }
    // [CHANGED 11.5] 展开会重新折行；正文起点始终是 offset=0。
    if (key.return && chosen) {
      setExpanded((old) => { const next = new Set(old); if (next.has(chosen)) next.delete(chosen); else next.add(chosen); return next; });
      setAnchor({ id: chosen, offset: 0 }); return;
    }
    if (key.ctrl && input === "y") {
      const entry = entries.find((entry) => entry.id === chosen); if (!entry) return;
      copying.current?.abort(); const controller = new AbortController(); copying.current = controller;
      void copyText(`${entry.text}${entry.details !== undefined ? `\n${entry.details}` : ""}`, controller.signal)
        .then(() => { if (!controller.signal.aborted) setNotice("已复制选中内容。"); })
        .catch((error) => { if (!controller.signal.aborted) setNotice((error as Error).message); });
    }
  }, { isActive: active });
  usePaste(() => setNotice("当前焦点在历史区；Ctrl+O 返回草稿后再粘贴。"), { isActive: active });
  // [CHANGED 11.5] 标题过长时只截取显示内容，避免额外折行挤占视口。
  return <Box flexDirection="column">
    <Text wrap="truncate">{active ? "历史区 [焦点]" : "历史区"} · {anchor ? "停留浏览；End 回到最新" : "跟随最新输出"}</Text>
    <Box flexDirection="column" height={height} overflow="hidden">
      {lines.slice(start, start + height).map((line, index) => <Text key={index} wrap="truncate" color={useColor ? entries.find((entry) => entry.id === line.id)?.label === "你" ? "cyan" : entries.find((entry) => entry.id === line.id)?.label === "Agent" ? "magenta" : undefined : undefined}>{line.id === chosen ? "> " : "  "}{line.text}</Text>)}
    </Box>
    <Text wrap="truncate">{notice || "↑↓/PgUp/PgDn 滚动 · j/k 选消息 · Enter 展开 · Ctrl+Y 复制"}</Text>
  </Box>;
}
