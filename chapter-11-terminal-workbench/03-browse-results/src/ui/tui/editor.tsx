/**
 * 11.3 浏览历史与工具结果 | [KEEP 来自 11.2] ui/tui/editor.tsx
 *
 * 学习目标：沿用 11.2 的草稿编辑、历史找回和补全；本节的焦点与布局由 app.tsx 控制。
 * 输入：父组件保存的 Draft、焦点、终端可用宽高和当前会话的问题列表。
 * 输出：新的草稿或一次提交回调；编辑中的文字尚未进入模型历史。
 * 状态：文字修改保留最近 100 个撤销快照；超限只显示错误，不替换原草稿。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   草稿 + 键盘 -> 当前组件有焦点？-- 否 -> 不消费编辑输入
 *                                 +-- 是 -> 历史 / 搜索 / Tab？-- 是 -> 找回或补入草稿
 *   修改文字 -> 超过上限？-- 是 -> 显示错误，保留原草稿
 *                          +-- 否 -> 保存撤销快照 -> onChange -> 重新绘制
 *   粘贴 -> 统一换行 -> 整段插入草稿；普通 Enter -> onSubmit -> app 判断能否发送
 *   异步补全返回 -> 原草稿仍是当前草稿且未取消？-- 否 -> 丢弃结果
 *                                                       +-- 是 -> 更新文字和光标
 *
 * 光标下标用于切字符串，字素用于移动和删除；这几种计数不能互换。
 * 运行观察：粘贴两行只增加一份草稿，撤销可一起移除；找回旧问题或补全路径后仍要再按 Enter 发送。
 */
import { Text, useInput, usePaste, type Key } from "ink";
import { useEffect, useRef, useState } from "react";
import { completeInput, searchPrompts } from "./input-assist.js";
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
import { screenText } from "./state.js";

// [KEEP 来自 11.1] 草稿是待提交文字，不是已经发送给模型的历史。
type Snapshot = { text: string; cursor: number };
export type Draft = Snapshot & { past: Snapshot[]; future: Snapshot[] };
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export const MAX_DRAFT = 32_000;
/**
 * 把文字拆成用户眼中的一个个完整字符，供光标移动和删除使用。
 *
 * - 输入：草稿中的一段字符串，可能含中文、组合字符或多个码点组成的 emoji。
 * - 输出：按字素分组的字符串数组；空文本返回空数组。
 * - 关键原因：JavaScript 下标按 UTF-16 单元计数，直接减一可能拆开 emoji；字素长度才能给出完整移动步长。
 * - 职责边界：这里分字符，不计算这些字符在终端占几列。
 */
export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((part) => part.segment);
}
/**
 * 建立一份可以继续编辑的草稿，并把光标放在末尾。
 *
 * - 输入：初始文本，省略时使用空字符串；调用方负责选择已经允许进入草稿的内容。
 * - 输出：文字、UTF-16 光标下标，以及相互独立的空撤销和重做数组。
 * - 关键原因：发送后创建新草稿，上一条问题的编辑步骤不会混入下一条。
 * - 职责边界：不提交模型历史，也不在这里检查长度；后续文字修改统一经过 changeDraft。
 */
export function newDraft(text = ""): Draft {
  return { text, cursor: text.length, past: [], future: [] };
}
/**
 * 把一次文字修改记录成一个可撤销的步骤。
 *
 * - 输入：原草稿、新文本和新光标位置；未指定光标时放到新文本末尾。
 * - 输出：新 Draft；文字未变时只移动光标，不增加撤销记录。
 * - 关键步骤：先检查 32000 个 UTF-16 单元的长度上限，再把旧文字和光标存入 past；只保留最近 100 步并清空 future。
 * - 失败方式：超过长度上限先抛错，原草稿仍可继续编辑；本函数不修改传入对象，也不发送内容。
 */
export function changeDraft(draft: Draft, text: string, cursor = text.length): Draft {
  if (text.length > MAX_DRAFT) throw new Error(`草稿最多 ${MAX_DRAFT} 个 UTF-16 单元，本次输入未加入。`);
  if (text === draft.text) return { ...draft, cursor };
  return { text, cursor, past: [...draft.past, { text: draft.text, cursor: draft.cursor }].slice(-100), future: [] };
}
/**
 * 把键入或粘贴的文字插入当前光标位置。
 *
 * - 输入：原草稿与一整段输入；光标位置由编辑器维护。
 * - 输出：经过 changeDraft 保存的新草稿，光标移到本次插入内容之后。
 * - 关键原因：先把 CRLF 和 CR 统一成换行，再一次插入；多行粘贴因此只形成一个撤销步骤。
 * - 失败方式：超出草稿上限由 changeDraft 抛错；换行只成为草稿内容，不代表按下发送键。
 */
export function insertText(draft: Draft, input: string): Draft {
  const text = input.replace(/\r\n?/g, "\n");
  return changeDraft(draft, draft.text.slice(0, draft.cursor) + text + draft.text.slice(draft.cursor), draft.cursor + text.length);
}
/**
 * 把光标移到上一行或下一行中相近的字符位置。
 *
 * - 输入：当前草稿与方向，按键调用方传 -1 或 1；这里只跨文字中的换行。
 * - 输出：目标行内的 UTF-16 下标；目标行不存在时返回原光标。
 * - 关键步骤：数出当前行光标前有几个字素，再取目标行相同数量的字素，最后换回字符串下标。
 * - 边界：目标行较短时停在末尾；本节按字素数量对齐，中文占列宽度的差异留到 11.5 处理。
 */
export function moveVertical(draft: Draft, direction: number): number {
  const before = draft.text.slice(0, draft.cursor);
  const row = before.split("\n").length - 1;
  const lines = draft.text.split("\n");
  const target = row + direction;
  if (target < 0 || target >= lines.length) return draft.cursor;
  const column = graphemes(before.split("\n").at(-1) ?? "").length;
  return lines.slice(0, target).reduce((size, line) => size + line.length + 1, 0)
    + graphemes(lines[target]).slice(0, column).join("").length;
}
/**
 * 把一个编辑按键转换成下一份草稿。
 *
 * - 输入：当前 Draft、Ink 给出的文字和按键信息；发送键已由组件单独处理。
 * - 输出：修改后的草稿；没有对应操作时返回原草稿。
 * - 关键步骤：先处理撤销、重做和清空，再按完整字素移动或删除；改变文字的操作统一经过 changeDraft。
 * - 状态：撤销在 past 与 future 之间搬运快照，光标移动不另存快照；到首尾时不越界。
 * - 职责边界：本函数不读输入历史，不做补全，也不启动 Agent；文字过长的错误交给组件显示。
 */
export function editKey(draft: Draft, input: string, key: Partial<Key>): Draft {
  if (key.ctrl && (input === "z" || input === "y")) {
    const undo = input === "z", source = undo ? draft.past : draft.future;
    const target = source.at(-1); if (!target) return draft;
    const now = { text: draft.text, cursor: draft.cursor };
    return { ...target, past: undo ? draft.past.slice(0, -1) : [...draft.past, now].slice(-100),
      future: undo ? [...draft.future, now].slice(-100) : draft.future.slice(0, -1) };
  }
  if (key.ctrl && input === "u") return changeDraft(draft, "");
  const before = graphemes(draft.text.slice(0, draft.cursor)).at(-1)?.length ?? 0;
  const after = graphemes(draft.text.slice(draft.cursor))[0]?.length ?? 0;
  if (key.leftArrow) return { ...draft, cursor: draft.cursor - before };
  if (key.rightArrow) return { ...draft, cursor: draft.cursor + after };
  if (key.upArrow || key.downArrow) return { ...draft, cursor: moveVertical(draft, key.upArrow ? -1 : 1) };
  if (key.home || (key.ctrl && input === "a")) return { ...draft, cursor: draft.cursor === 0 ? 0 : draft.text.lastIndexOf("\n", draft.cursor - 1) + 1 };
  if (key.end || (key.ctrl && input === "e")) { const end = draft.text.indexOf("\n", draft.cursor); return { ...draft, cursor: end < 0 ? draft.text.length : end }; }
  if (key.backspace) return changeDraft(draft, draft.text.slice(0, draft.cursor - before) + draft.text.slice(draft.cursor), draft.cursor - before);
  if (key.delete) return changeDraft(draft, draft.text.slice(0, draft.cursor) + draft.text.slice(draft.cursor + after), draft.cursor);
  if (key.return && (key.meta || key.shift)) return insertText(draft, "\n");
  if (key.ctrl || key.meta || key.escape || key.tab || key.return) return draft;
  return input ? insertText(draft, input) : draft;
}
/**
 * 按终端宽度折行，并截取包含光标的草稿片段。
 *
 * - 输入：当前草稿、可用列数与显示行数；列数至少按 2 计算。
 * - 输出：含可见光标标记的行数组，不修改原草稿。
 * - 关键步骤：先清理显示副本并插入光标，再折行；单独折叠光标前的文字，用它定位当前显示行。
 * - 边界：视口随光标向下移动，只截取附近行；本节折行复用 wrapAnsi，11.5 再统一字素和列宽计算。
 */
export function draftLines(draft: Draft, width: number, height: number): string[] {
  const columns = Math.max(2, width);
  const before = screenText(draft.text.slice(0, draft.cursor));
  const shown = `${before}▏${screenText(draft.text.slice(draft.cursor))}`;
  const options = { hard: true, trim: false, wordWrap: false };
  const lines = wrapAnsi(shown, columns, options).split("\n");
  const prefix = wrapAnsi(before, columns, options).split("\n");
  const cursorRow = prefix.length - 1 + (stringWidth(prefix.at(-1) ?? "") >= columns ? 1 : 0);
  return lines.slice(Math.max(0, cursorRow - height + 1), Math.max(height, cursorRow + 1));
}
/**
 * 接管当前草稿区的输入，让编辑与提交走各自的回调。
 *
 * - 输入：父组件持有的 Draft、更新与提交函数、焦点及显示尺寸，还有仅存在本次会话中的问题历史。
 * - 输出：草稿画面、搜索结果与补全提示；普通 Enter 调用 onSubmit，是否能发送仍由父组件判断。
 * - 输入处理：仅在 active 时收键盘和粘贴；粘贴通过专门事件整段加入，不把正文里的换行当成提交。
 * - 找回与补全：历史搜索选中后只填草稿；异步补全保存发起时的草稿引用，草稿变化、失焦或卸载后旧结果不能覆盖新文字。
 * - 失败方式：文字超限或补全失败显示本地提示，保留原草稿；没有任何模型或工具执行入口。
 */
export function DraftEditor({ value, onChange, onSubmit, active, width, height = 4, prompts = [] }: {
  value: Draft; onChange: (value: Draft) => void; onSubmit: (text: string) => void;
  active: boolean; width: number; height?: number; prompts?: string[];
}) {
  const [error, setError] = useState("");
  const [search, setSearch] = useState<{ query: string; index: number }>();
  const recall = useRef<{ index: number; saved: Draft } | undefined>(undefined);
  const completion = useRef<AbortController | undefined>(undefined);
  const latest = useRef(value); latest.current = value;
  useEffect(() => () => completion.current?.abort(), [value.text, value.cursor, active]);
  const update = (action: () => Draft) => { try { onChange(action()); setError(""); } catch (error) { setError((error as Error).message); } };
  const candidates = search ? searchPrompts(prompts, search.query) : [];
  useInput((input, key) => {
    if (key.ctrl && input === "r") { setSearch((old) => old ? { ...old, index: (old.index + 1) % Math.max(1, candidates.length) } : { query: "", index: 0 }); return; }
    if (search) {
      if (key.escape) { setSearch(undefined); return; }
      if (key.return) { const chosen = candidates[search.index]; if (chosen) update(() => changeDraft(value, chosen)); setSearch(undefined); return; }
      if (key.backspace || key.delete) setSearch({ query: graphemes(search.query).slice(0, -1).join(""), index: 0 });
      else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow) setSearch({ query: search.query + input, index: 0 });
      return;
    }
    if (key.ctrl && (input === "p" || input === "n")) {
      const state = recall.current ?? { index: prompts.length, saved: value };
      state.index = Math.max(0, Math.min(prompts.length, state.index + (input === "p" ? -1 : 1)));
      recall.current = state;
      update(() => state.index === prompts.length ? state.saved : changeDraft(value, prompts[state.index] ?? "")); return;
    }
    recall.current = undefined;
    if (key.tab) {
      completion.current?.abort(); const controller = new AbortController(); completion.current = controller;
      const source = value;
      void completeInput(source.text, source.cursor, controller.signal).then((result) => {
        if (!controller.signal.aborted && latest.current === source) {
          update(() => changeDraft(source, result.text, result.cursor)); setError(result.hint);
        }
      }).catch((error) => { if (!controller.signal.aborted) setError((error as Error).message); }); return;
    }
    if (key.return && !key.meta && !key.shift) { onSubmit(value.text); return; }
    update(() => editKey(value, input, key));
  }, { isActive: active });
  usePaste((text) => {
    if (search) setSearch({ query: search.query + text.replace(/[\r\n]/g, " "), index: 0 });
    else update(() => insertText(value, text));
  }, { isActive: active });
  const shown = search ? `搜索历史：${screenText(search.query)}\n${screenText(candidates[search.index] ?? "没有匹配")}` : draftLines(value, width, height).join("\n");
  return <Text>{error ? `${shown}\n${screenText(error)}` : shown}</Text>;
}
