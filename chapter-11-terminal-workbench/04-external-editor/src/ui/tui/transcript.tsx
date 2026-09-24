/**
 * 11.4 把草稿交给外部编辑器 | [KEEP 来自 11.3] ui/tui/transcript.tsx
 *
 * 学习目标：让用户停下来查看旧消息、展开工具详情，并复制当前结果。
 * 输入：带稳定 ID 的显示消息、焦点、可用宽高；工具详情来自 RunView。
 * 输出：当前历史视口；滚动与折叠只改变浏览状态，不改变模型历史。
 * 状态：没有锚点时跟随末尾，手动浏览后保存消息 ID 与折行行号；End 清除锚点并回到最新。
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
 * 这里用折行行号保存位置；窗口缩放后的精确位置保留在 11.5 改成正文偏移。
 * 运行观察：向上浏览后新输出不会把视口拉回底部；按 End 才恢复跟随。
 */
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
import wrapAnsi from "wrap-ansi";
import { copyText } from "./system-actions.js";
import { screenText, type RunView } from "./state.js";

// [KEEP 来自 11.3] 浏览位置独立于执行进度；消息 ID 不因屏幕重绘而改变。
export type Entry = { id: string; label: "你" | "Agent" | "工具" | "本地"; text: string; details?: string };
export type ViewLine = { id: string; row: number; text: string };
export type Anchor = { id: string; row: number } | undefined;
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
 * - 输出：每行带消息 ID、该消息中的折行行号和显示文字，供视口重新定位。
 * - 关键步骤：先选择摘要或完整详情，清理控制字符，再交给 wrapAnsi 折行。
 * - 职责边界：折叠只影响本次排版，Entry 的详情仍保留，复制时仍能取得它。
 */
export function transcriptLines(entries: Entry[], width: number, expanded: Set<string>): ViewLine[] {
  return entries.flatMap((entry) => {
    const body = `${entry.label} > ${entry.text}${entry.details !== undefined ? expanded.has(entry.id) ? `\n${entry.details}` : " [结果已折叠]" : ""}`;
    return wrapAnsi(screenText(body), Math.max(2, width), { hard: true, trim: false, wordWrap: false }).split("\n")
      .map((text, row) => ({ id: entry.id, row, text }));
  });
}
/**
 * 把用户保存的浏览位置换算成视口起点。
 *
 * - 输入：折行后的消息列表、视口高度和可选的消息 ID / 行号锚点。
 * - 输出：首行下标；没有锚点时取列表末尾，有锚点却找不到对应行时回到第 0 行。
 * - 关键步骤：先找同一消息内不早于保存行号的位置，保持手动浏览时不自动跳向新输出。
 * - 边界：锚点保存的是折行行号，缩放会改变它与正文的对应关系；11.5 再使用正文偏移。
 */
export function visibleStart(lines: ViewLine[], height: number, anchor: Anchor): number {
  const found = anchor ? lines.findIndex((line) => line.id === anchor.id && line.row >= anchor.row) : -1;
  return anchor ? Math.max(0, found) : Math.max(0, lines.length - height);
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
    if (input === "j" || input === "k") {
      const index = entries.findIndex((entry) => entry.id === chosen);
      const target = entries[Math.max(0, Math.min(entries.length - 1, index + (input === "j" ? 1 : -1)))];
      if (target) { setSelected(target.id); setAnchor({ id: target.id, row: 0 }); } return;
    }
    if (key.return && chosen) {
      setExpanded((old) => { const next = new Set(old); if (next.has(chosen)) next.delete(chosen); else next.add(chosen); return next; });
      setAnchor({ id: chosen, row: 0 }); return;
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
  return <Box flexDirection="column">
    <Text>{active ? "历史区 [焦点]" : "历史区"} · {anchor ? "停留浏览；End 回到最新" : "跟随最新输出"}</Text>
    <Box flexDirection="column" height={height} overflow="hidden">
      {lines.slice(start, start + height).map((line, index) => <Text key={index} wrap="truncate" color={!process.env.NO_COLOR ? entries.find((entry) => entry.id === line.id)?.label === "你" ? "cyan" : entries.find((entry) => entry.id === line.id)?.label === "Agent" ? "magenta" : undefined : undefined}>{line.id === chosen ? "> " : "  "}{line.text}</Text>)}
    </Box>
    <Text wrap="truncate">{notice || "↑↓/PgUp/PgDn 滚动 · j/k 选消息 · Enter 展开 · Ctrl+Y 复制"}</Text>
  </Box>;
}
