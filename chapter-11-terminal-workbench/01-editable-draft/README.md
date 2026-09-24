# 11.1 编辑一份多行草稿

[第 11 章首页](../README.md) · [上一章：10.4 取消以后，继续留在对话里](../../chapter-10-terminal-ui/04-cancel-and-restore/README.md) · [下一节：11.2 找回输入，补全路径](../02-recall-and-complete/README.md)

## 问题：请求还没写完，怎样继续修改

第十章的单行输入已经能发送问题。现在，我们想把读取任务写得清楚一些：第一行说明要读哪个文件，第二行补充回答要求。

```text
请读取 README.md，说明这个项目怎样启动。
把安装依赖、启动程序和运行检查分开说明。
```

输入这段请求时，我们可能先写错文件名，再把光标移回去修改；也可能从别处粘贴两行，再撤销一次多余的插入。文字尚未发送，程序需要把它当作可以反复整理的草稿。

这里还有一个容易混淆的动作：粘贴的文字可以包含换行，但这些换行属于正文。它们不能被当成用户按下了多次发送键，否则一份请求可能在尚未完整进入输入区时就开始执行。

## 解决方案：先编辑草稿，再明确提交

我们把草稿的正文和光标位置一起保存。普通字符插到光标所在的位置，移动按键只改变光标，删除和换行改变正文；每次真正修改正文前，留下上一份状态，供撤销使用。

提交是另一件事。用户明确发送时，程序取出当时的完整正文，继续交给已有执行链。本节先保留第十章的忙闲安排：任务运行时暂停输入，结束后再编辑下一份草稿；11.3 加入焦点管理以后，再让草稿与结果浏览同时存在。

## 工作原理

### 1. 草稿不仅有文字，还有插入位置

把输入框看成一张短便笺会更容易理解。便笺上已经写了文字，光标指出下一个字符应插在哪里。只有一份字符串，程序只能方便地向末尾追加；记住光标以后，才可以在中间补字或删除。

例如，用竖线表示光标，下面两份草稿的正文相同，下次输入的结果却不同：

```text
请读取 |README.md
请读取 README.md|
```

前者输入 `项目中的 `，会改变文件名前面的说明；后者输入同样内容，则会把它追加到末尾。所以撤销也应把文字与光标一起恢复，否则正文退回了上一步，下一次输入却可能落在意外的位置。

移动光标时，我们还要遵守用户眼中的“一个字符”。`中`、`🙂` 和带组合音标的字母，并不都能用 JavaScript 字符串的一个下标表示。编辑时按可见字符的边界移动和删除，能避免留下半个 emoji 或把音标单独删掉；终端里实际占几列的问题，留到 11.5 再展开。

### 2. 粘贴一次，就插入一段正文

支持括号粘贴的终端，会在粘贴内容前后加上标记。Ink 的 [`usePaste`](https://github.com/vadimdemedes/ink#usepastehandler-options) 接收这段完整文字；它与处理普通按键的 `useInput` 使用不同通道。因此，粘贴中的换行不会经过发送键的处理分支。

这里依赖终端支持 bracketed paste。终端若把粘贴内容直接当作一串普通按键发送，程序就无法凭这些按键判断某个回车来自粘贴还是手动发送；本节的“整段粘贴不误提交”保证不覆盖这种环境。

回到我们的例子，用户一次粘贴两行读取要求，程序只做一次插入：把整段文字放到当前光标处，并把光标移到这段文字之后。这也自然确定了撤销的单位——撤销一次就移除本次粘贴，而不是要求用户逐字撤销。

粘贴进入草稿时统一换行形式，显示时再把会控制终端的字符转成可见文字，同时保留正文中的换行。模型或工具给出的文字也沿用原有的显示转义处理，普通文本不能直接获得控制终端的能力。

中文输入法也有自己的阶段：拼音和候选先由系统输入法与终端处理，确认以后才把字符交给程序。本节从这些已提交字符开始编辑，不绘制输入法候选，也不实现输入法的合成过程。

### 3. 撤销保存修改之前的草稿

最容易理解的撤销方法，是在正文变化前保存一份旧草稿。插入、删除、粘贴都沿同一条路线处理，撤销时取出最近的一份。

```text
初始草稿：读取 README.md|
插入一段：读取 README.md，说明启动方式。|
撤销一次：读取 README.md|
```

单纯向左或向右移动不需要产生新的撤销记录，因为正文没有变。再次修改时，保存的仍是修改之前的实际光标位置。这样，我们既能连续调整光标，也能让一次撤销对应一次文字修改。

本章的撤销只作用于尚未提交的草稿。已经交给 Agent 的问题，以及工具已经写入的文件，不属于输入框的撤销范围。

这里保留最近 100 次修改，草稿最多包含 32,000 个 UTF-16 代码单元。前者限制撤销记录的数量，后者限制一份草稿的文本长度；超过正文上限时拒绝这次修改并保留旧草稿，不静默截掉请求的后半段。

### 4. 提交的是当时的一份完整正文

编辑过程中，所有修改都只发生在草稿里。用户发送以后，程序把当时的完整正文交给一轮任务，并开始一份新的空草稿；已经提交的正文不会再随着输入框的修改变化。

程序仍先检查有没有活动任务，再决定能否提交。检查通过以后才取出草稿、清空输入并开始新一轮。即使键盘输入很快，也不能只依赖画面已经切成忙碌状态来阻止第二次发送。

任务中如果需要审批，仍显示第十章的审批输入。用户填写的答案只回应当前批准请求，不是另一个普通问题。工具执行完成以后，结果回到模型，界面继续接收回答；整轮结束后才恢复普通草稿编辑。

11.3 会让运行中的任务和正在编辑的草稿同时存在。至于把新要求交给活动任务，还是排在下一轮，第十二章再定义它们各自的生效时机。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/ui/tui/editor.tsx](src/ui/tui/editor.tsx) | 建立草稿编辑器 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 把多行草稿接回原有界面 |

## 动手构建

跟写起点是 10.4，本节目标目录是 `chapter-11-terminal-workbench/01-editable-draft/`。沿用上一节完整 `src/`，本节只替换 TUI 的草稿编辑与按键处理。

### 建立草稿编辑器

这里把一次文字修改集中到 `changeDraft()`。它负责保存撤销记录和检查长度，键盘编辑与整段粘贴都复用它。`cursor` 使用 UTF-16 下标以便切分字符串，移动距离则从完整可见字符得到；两者各自解决一个问题。

按 `Ctrl+J` 时，Ink 交给编辑器的是正文换行 `\n`，会走 `editKey()` 末尾的普通插入分支；普通 `Enter` 才命中 `key.return` 的发送分支。

创建 `src/ui/tui/editor.tsx`，完整内容如下：

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 11.1 多行草稿、粘贴与撤销 | [NEW] ui/tui/editor.tsx
 *
 * 学习目标：把一次输入改成可反复编辑的多行草稿，发送前先保留文字与光标。
 * 输入：父组件保存的 Draft、焦点、终端可用宽高。
 * 输出：新的草稿或一次提交回调；编辑中的文字尚未进入模型历史。
 * 状态：文字修改保留最近 100 个撤销快照；超限只显示错误，不替换原草稿。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   草稿 + 键盘 -> 当前组件有焦点？-- 否 -> 不消费编辑输入
 *                                 +-- 是 -> 编辑键？-- 是 -> 计算新草稿
 *   修改文字 -> 超过上限？-- 是 -> 显示错误，保留原草稿
 *                          +-- 否 -> 保存撤销快照 -> onChange -> 重新绘制
 *   粘贴 -> 统一换行 -> 整段插入草稿；普通 Enter -> onSubmit -> app 判断能否发送
 *
 * 光标下标用于切字符串，字素用于移动和删除；这几种计数不能互换。
 * 运行观察：粘贴两行只增加一份草稿，撤销可一起移除；普通 Enter 才提交，多行文字不会逐行发送。
 */
import { Text, useInput, usePaste, type Key } from "ink";
import { useState } from "react";
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
import { screenText } from "./state.js";

// [NEW 11.1] 本文件以下实现均为本节新增；草稿是待提交文字，不是已经发送给模型的历史。
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
 * - 输入：父组件持有的 Draft、更新与提交函数、焦点及显示尺寸。
 * - 输出：草稿画面或编辑错误；普通 Enter 调用 onSubmit，是否能发送仍由父组件判断。
 * - 输入处理：仅在 active 时收键盘和粘贴；粘贴通过专门事件整段加入，不把正文里的换行当成提交。
 * - 失败方式：文字超限或补全失败显示本地提示，保留原草稿；没有任何模型或工具执行入口。
 */
export function DraftEditor({ value, onChange, onSubmit, active, width, height = 4 }: {
  value: Draft; onChange: (value: Draft) => void; onSubmit: (text: string) => void;
  active: boolean; width: number; height?: number;
}) {
  const [error, setError] = useState("");
  const update = (action: () => Draft) => { try { onChange(action()); setError(""); } catch (error) { setError((error as Error).message); } };
  useInput((input, key) => {
    if (key.return && !key.meta && !key.shift) { onSubmit(value.text); return; }
    update(() => editKey(value, input, key));
  }, { isActive: active });
  // 粘贴独立交付，正文里的换行不能触发 onSubmit。
  usePaste((text) => update(() => insertText(value, text)), { isActive: active });
  return <Text>{error ? screenText(error) : draftLines(value, width, height).join("\n")}</Text>;
}
```


### 把多行草稿接回原有界面

界面把原来的字符串状态换成 `Draft`，再把正文交给原有 `submit()`。本节仍保留忙时暂停输入的安排，审批继续使用独立的单行答案；改变的是用户怎样准备请求，不是 Agent 怎样执行请求。

在 `src/ui/tui/app.tsx` 中，先把文件开头的教学说明与导入替换为：

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 11.1 多行草稿、粘贴与撤销 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：把多行草稿接入已有会话，只有普通 Enter 才提交本轮问题。
 * 输入：模型、键盘、终端尺寸与同一 Agent 事件流；界面只在用户提交后启动任务。
 * 输出：留存消息、多行草稿与当前执行状态。
 * 状态：Session 保存模型历史、只读授权；React state 保存草稿和画面。
 * 失败：本轮异常保留已经收到的结果；清理完成前不能发送下一轮，已执行的工具操作不回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session、注册退出监听 -> 挂载 TuiApp
 *   空闲 -> 显示 DraftEditor；运行中 -> 显示本轮进度
 *   普通 Enter -> 可以提交？-- 否 -> 保留现有状态
 *                          +-- 是 -> 空白？-- 是 -> 等待输入
 *                                         +-- 否 -> 本地命令？-- 是 -> 本地处理后返回或退出
 *                                                            +-- 否 -> 新建本轮信号 -> 消费事件
 *   ask -> waitForApproval -> 审批面板独占输入 -> y / n / 合法 s -> 原审批 Promise
 *   本轮结束 / 失败 -> 等事件流清理 -> 留下结果、解除忙碌 -> 等待下一次提交
 *   Ctrl+C -> 有本轮任务？-- 是 -> abort -> 等清理；否 -> quit
 *   quit -> closing=true -> 取消并等待本轮任务 -> 卸载 Ink、移除监听
 *
 * 草稿不是模型消息历史；重新绘制不会重复执行任务，发送回调才把完整问题交给执行链。
 * 模型判断、工具执行、权限范围与历史提交仍由原有执行链负责。
 * 运行观察：粘贴多行后先继续编辑，再按 Enter 发送；撤销只改变尚未发送的草稿。
 */
import { useState } from "react";
import { Box, Static, Text, render, useInput, useWindowSize } from "ink";
import wrapAnsi from "wrap-ansi";
import { emptyRunView, updateRunView, runTranscript, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
// [NEW 11.1] 草稿编辑与发送分开，由组件交回完整文字。
import { DraftEditor, newDraft } from "./editor.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
```


替换同名函数 `TuiApp()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 把草稿、执行事件和当前交互区域连接起来。
 *
 * - 输入：已创建的模型、整次会话的 Session，以及取消和退出函数。
 * - 输出：界面 JSX；按状态选择草稿、执行进度和审批面板，渲染本身不启动任务。
 * - 提交步骤：先检查本轮占用和空白，再处理本地命令；普通问题才创建控制器并开始消费事件。
 * - 事件处理：局部 current 顺序积累每条事件，React 合并绘制也不丢正文；finally 等清理后才解除占用。
 * - 职责边界：本组件不执行工具或提交模型历史，取消也不会撤销已经发生的文件操作。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  // [CHANGED 11.1] 保存文字、光标和撤销记录，不再只保存一个字符串。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingApproval>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  const append = (label: Entry["label"], text: string) => setEntries((old) => [...old, { label, text: screenText(text) }]);

  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [CHANGED 11.1] 取消时创建空 Draft，继续沿用先等清理再恢复输入的规则。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.done) { setDraft(newDraft()); setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
  });

  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.done || session.closing) return;
    const prompt = value.trim();
    if (!prompt) return;
    // [CHANGED 11.1] 已接受提交后才重建草稿，清空这条问题的编辑记录。
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    append("你", prompt);
    setBusy(true);
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();
    session.controller = controller;
    session.done = (async () => {
      let current = emptyRunView();
      try {
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
          if (!session.closing) setApproval(pending);
        }), session.grants)) {
          // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // for await 完成或抛错前会等待生成器的 finally；此时才解除本轮占用。
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          append("Agent", runTranscript(current));
          setView(current);
          setApproval(undefined);
          setBusy(false);
        }
      }
    })();
  };

  // [KEEP 来自 10.4] 运行时显示进度，取消清理结束后再恢复草稿输入。
  // [CHANGED 11.1] 聊天输入换成多行编辑器；审批仍使用独立的明确选择输入。
  return <Box flexDirection="column">
    <Static items={entries}>{(entry, index) => <Box key={index} flexDirection="column" marginBottom={1}>
      <Text color={entry.label === "你" ? "cyan" : entry.label === "Agent" ? "magenta" : "yellow"} bold>{entry.label}</Text>
      <Text>{entry.text}</Text>
    </Box>}</Static>
    {approval ? <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />
      : <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Text bold>Hello, My Agent</Text>
      <Text color={busy ? "yellow" : "green"}>状态：{view.status}{view.usage ? ` · ${view.usage}` : ""}</Text>
      {busy && <Box flexDirection="column">
        <Text color="magenta">Agent（当前文字末尾）</Text>
        <Text>{wrapAnsi(view.answers.at(-1)?.text || "等待模型…", Math.max(10, columns - 4), { hard: true, trim: false }).split("\n").slice(-Math.max(2, Math.min(8, rows - 12))).join("\n")}</Text>
        <Text dimColor>本轮工具：{view.tools.length} 次（显示最近 3 次）</Text>
        {view.tools.slice(-3).map((tool) => <Text key={tool.sequence}>#{tool.sequence} {tool.name} · {tool.status}</Text>)}
      </Box>}
      {busy ? <Text dimColor>正在处理本轮任务…</Text> : <Box><Text color="cyan">你 &gt; </Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={!busy} width={columns - 8} />
      </Box>}
      <Text dimColor>Enter 发送 · Ctrl+J / Alt+Enter 换行 · Ctrl+Z 撤销 · Ctrl+Y 重做 · /exit 退出</Text>
    </Box>}
  </Box>;
}
```


本文件其余实现沿用上一节。

## 运行验证

### 构建并启动

完成本节代码后，在仓库根目录构建。继续使用第十章已经配置好的模型：

```bash
npm run lesson:11.1
```

再单独启动界面：

```bash
hello-my-agent
```

### 整理两行请求

在支持 bracketed paste 的终端里，一次粘贴本节开头的两行请求。草稿中应保留换行，Agent 仍处于就绪状态；只有明确按 `Enter`，才开始发送。

在发送之前，依次做下面几项操作：

| 操作 | 应看到的变化 |
| --- | --- |
| 按左右键，再输入一个字 | 文字插入光标位置，原来后面的文字保留 |
| 按 `Ctrl+Z` | 撤销刚才的一次插入，光标也回到修改前 |
| 按 `Ctrl+Y` | 重做刚才撤销的修改 |
| 按 `Ctrl+J` 或 `Alt+Enter` | 插入正文换行，不发送 |
| 按上下键、`Home`、`End` | 在多行正文中移动；`Home`、`End` 到当前逻辑行的开头或末尾 |
| 按 `Ctrl+U`，再按 `Ctrl+Z` | 先清空草稿，再恢复清空前的文字 |

`Ctrl+J` 对应终端里的 LF 换行字节。终端能区分 `Shift+Enter` 时，它也可用于换行；不能区分时，用 `Ctrl+J` 或 `Alt+Enter`。

再输入 `中文🙂é`，把光标放到末尾，逐次按退格。`é` 中的字母与组合音标应一起删除，emoji 也不会留下半个字符。这里观察的是编辑单位；自动换行的列宽会在 11.5 进一步检查。

### 发送以后，再开始下一份草稿

把草稿恢复成开头的读取请求，再按 `Enter`。这是本节第一次真正向配置的模型发送问题；模型可以请求读取文件，工具结果回到模型后，界面继续显示回答。具体用词不必与示例一致。

本节运行时先暂停草稿编辑。等本轮结束以后，输入区重新出现，再写下一份请求。这样可以先单独确认多行编辑与发送正常；11.3 再加入运行中编辑，并检查“可编辑”与“可提交”的区别。

如需取消正在运行的任务，按 `Ctrl+C`，等清理完成后再输入下一份草稿。空闲时输入 `/exit` 并发送，或按 `Ctrl+D` 退出。

## 本节完成后的 Agent

现在，输入区可以保存一份多行草稿，支持在中间修改、整段粘贴和撤销。明确发送时，完整正文才进入原有 Agent Loop；模型请求工具、工具结果回传与模型继续回答的路线保持不变。

同一时刻仍只有一轮执行，任务结束后再编辑下一份草稿。接下来要减少重复输入：上一轮已经写过的请求应该能找回，项目里真实存在的文件名也应该能帮助我们把路径写完整。
