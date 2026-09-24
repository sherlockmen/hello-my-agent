# 11.5 让界面适应终端

[第 11 章首页](../README.md) · [上一节：11.4 用熟悉的编辑器整理草稿](../04-external-editor/README.md) · [下一步：练习与答案](../EXERCISES.md)

## 问题：同样的文字，为什么换个窗口就挤乱了

我们已经能写多行请求，也能在执行过程中停下来阅读结果。接着把终端窗口缩小，正文、边框、输入区和快捷键提示都要争用有限的行列；再在草稿里写入 `中文🙂`，就会发现 JavaScript 的字符串长度不能直接当成终端宽度。

这不是模型输出的问题。终端按一格格字符单元摆放内容，而字符串保存的是编码后的文本。要把一份内容画好，程序需要先知道文本实际占多少列，再决定哪里换行，以及屏幕上的空间怎样分配。

本节同时检查没有颜色和离开界面时的表现。颜色可以帮助区分角色，却不能成为理解状态的唯一办法；程序结束以后，还需要把原来的终端完整交回来。

## 解决方案：按字符显示宽度排版，按窗口尺寸分配空间

编辑阶段继续把用户眼中的一个字符作为移动与删除单位；显示阶段则按终端列宽测量文字。正文超过可用宽度时换行，整个界面再根据当前行数给结果区、草稿区和状态提示分配空间。

窗口变化以后，我们重新计算显示，而不改写原文。窗口过小、已经放不下正常交互时，先给出明确的尺寸提示；审批继续沿用其最小窗口条件，不能在内容没有展示完整时批准。

## 工作原理

### 1. 字符串长度、可见字符数和终端列数不同

`A` 在 JavaScript 字符串中占一个 UTF-16 代码单元，在常见终端中也占一列，所以英文短句很容易掩盖问题。换成中文或 emoji，三种计数就会分开。

| 文本 | JavaScript 的 `length` | 用户通常看到几个字符 | 常见终端列宽 |
| --- | --- | --- | --- |
| `A` | 1 | 1 | 1 |
| `中` | 1 | 1 | 2 |
| `🙂` | 2 | 1 | 2 |
| `é`，即 `e` 加组合音标 | 2 | 1 | 1 |

因此，`slice(0, width)` 并不是可靠的屏幕裁剪：它按字符串下标切割，既可能切开一个可见字符，也没有把中文多占的一列算进去。

我们采用已有的 Unicode 分段与终端宽度处理能力。分段告诉编辑器哪里可以移动、删除；列宽告诉显示组件一行还能放下多少文字。终端和字体对某些字符的宽度仍可能有差异，因此本章验证常见中文、组合字符与 emoji，不把有限样例说成所有终端都完全一致。

### 2. 换行是一种显示，不是修改正文

用户在草稿中按换行键，会真的插入 `\n`，下一次发送也保留它。窗口变窄以后出现的自动换行则不同：它只是这一帧的排版结果，不该被写回草稿。

例如，一行请求在 80 列终端里能完整显示，在 40 列终端里可能分成两行。把窗口重新放大以后，它应恢复成一行；撤销记录和模型将收到的文字都不需要变化。

结果区也采用相同思路。先保留原来的消息与工具摘要，再根据当前可用列宽形成显示行，最后选出浏览窗口能容纳的部分。不能提前按某次窗口宽度永久切断保存的文本。

前两节的浏览位置记住的是“哪条消息的第几条显示行”。这个办法可以抵抗后面不断追加的新内容，但不能精确应对换行变化：原来的第二行，放大窗口以后可能已经并入第一行。

本节让每条显示行再记住自己从正文的哪个字符串位置开始。省略角色前缀，只看 `甲乙丙丁`，宽度从 4 列变成 6 列时，会出现下面的变化：

| 可用列宽 | 第一条显示行 | 第二条显示行 |
| --- | --- | --- |
| 4 列 | `甲乙`，起点 0 | `丙丁`，起点 2 |
| 6 列 | `甲乙丙`，起点 0 | `丁`，起点 3 |

如果用户原来在看起点 2 的 `丙`，重新排版后就应该寻找包含位置 2 的那一行，而不是机械地停在第二行。我们保存消息 ID 与这个正文位置，再寻找“不超过该位置的最后一个行起点”，就能找到新的对应行。

这也是本节增加一个短排版函数的原因：已有宽度库继续计算每个可见字符占几列，我们在换行时额外留下正文起点，供草稿光标和结果浏览定位使用。它只处理终端中要显示的文本，不承担 Markdown 排版或语言语法分析。

### 3. 先给操作留出位置，再安排结果

屏幕高度是有限的。假设一段结果已经有上百行，我们仍然需要看到当前焦点、任务状态和几行草稿，才能继续操作。所以界面先为这些交互区域留出空间，再把剩余行数交给结果区。

草稿很长时，也只显示光标附近能够容纳的几行。完整正文继续留在编辑状态中，移动光标以后，显示窗口随之调整。这个方法让长草稿和长结果都不会无限增加整张画面的高度。

上下移动光标也改用显示列宽。上一行光标前有一个中文字符，占了两列；下一行若是英文，程序就尽量落在两个英文字母之后，而不是按“一个字符”落在第一个字母后。真正的行仍由正文里的换行符确定，自动折行只负责显示。

Ink 的 [`useWindowSize`](https://github.com/vadimdemedes/ink#usewindowsize) 提供当前列数与行数，并在窗口变化时触发重新绘制。程序按新的尺寸重新计算各区域；正在审批时也沿用第十章的重新分页规则，避免用户以旧窗口下看过一部分内容为由批准新分页中尚未看过的部分。

当窗口少于 40 列，或少于 16 行时，本节暂时隐藏正常交互，只显示放大提示并保留取消与退出。草稿、待审批请求和浏览位置都留在内存中；窗口恢复到可用尺寸以后再继续操作。审批面板按新尺寸从头分页查看，不能把之前的页码或未提交答案直接套到新页面上。

### 4. 没有颜色，也能知道发生了什么

颜色适合帮助快速识别：用户文字用青色，Agent 文字用紫色，等待提示可以使用另一种颜色。但“谁说的话”“任务完成还是失败”“当前焦点在哪里”仍需要可见文字。

所以关闭颜色以后，角色名称、状态词和焦点提示都保留。终端重绘所需的控制序列与颜色序列也要区分：无颜色的交互 TUI 仍需要移动光标和刷新画面；重定向到文件时，则继续采用第十章的文本或 JSONL 消费者，不把交互画面写进日志。

### 5. 重新绘制与退出都不重建执行历史

尺寸变化只改变屏幕安排，不会重新开始模型请求。外部编辑器结束只恢复终端，不会清空结果区。真正退出时，程序仍先取消并等待当前任务清理，再卸载 Ink，移除自己注册的监听。

备用屏幕退出以后，用户回到进入 TUI 之前的主屏幕；原始输入模式和光标显示由 Ink 的恢复过程交还。我们用终端检查观察正常退出、取消后退出和尺寸变化，但不声称程序能在被操作系统强制终止时执行无法运行的清理代码。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/ui/tui/layout.ts](src/ui/tui/layout.ts) | 换行时保留正文位置 |
| CHANGED | [src/ui/tui/editor.tsx](src/ui/tui/editor.tsx) | 按屏幕列对齐光标，显示光标附近的正文 |
| CHANGED | [src/ui/tui/transcript.tsx](src/ui/tui/transcript.tsx) | 用正文位置找回重排后的阅读位置 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 让区域高度、焦点与颜色服从当前终端 |

## 动手构建

跟写起点是 11.4，本节目标目录是 `chapter-11-terminal-workbench/05-terminal-layout/`。沿用上一节完整 `src/`，把终端尺寸与显示宽度落实到草稿、结果和提示区域。

### 换行时保留正文位置

`wrapLines()` 按完整可见字符前进，用 `string-width` 累计列宽，每次换行都留下该行的正文起点。它给草稿和结果区提供相同的排版依据；`fitLine()` 则用于只容纳一行的提示。

创建 `src/ui/tui/layout.ts`，完整内容如下：

<!-- source: src/ui/tui/layout.ts -->
```ts
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
```


### 按屏幕列对齐光标，显示光标附近的正文

上下移动时先计算光标前面的显示列宽，再到目标逻辑行寻找不超过该列的可见字符边界。显示草稿时，根据行起点定位光标所在行，只取能放进输入区的窗口；原正文与撤销记录不变。

在 `src/ui/tui/editor.tsx` 中，先把文件开头的教学说明与导入替换为：

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 11.5 按终端列宽排版 | [CHANGED] ui/tui/editor.tsx
 *
 * 学习目标：用终端列宽计算光标与换行，让中文和 emoji 在窄屏下仍有完整边界。
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
 * 光标下标用于切字符串，字素用于移动和删除，显示列宽用于对齐和换行；这几种计数不能互换。
 * 运行观察：粘贴两行只增加一份草稿，撤销可一起移除；找回旧问题或补全路径后仍要再按 Enter 发送。
 */
// [CHANGED 11.5] 用固定高度容器与共同的列宽排版函数绘制草稿。
import { Box, Text, useInput, usePaste, type Key } from "ink";
import { useEffect, useRef, useState } from "react";
import { completeInput, searchPrompts } from "./input-assist.js";
// [NEW 11.5] 草稿与历史共用相同的字素折行规则。
import { wrapLines, fitLine } from "./layout.js";
import stringWidth from "string-width";
import { screenText } from "./state.js";
```


替换同名函数 `moveVertical()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 把光标移到上一行或下一行中相近的终端列。
 *
 * - 输入：当前草稿与方向，按键调用方传 -1 或 1；这里只跨文字中的换行，不跨自动折出的显示行。
 * - 输出：目标行内的 UTF-16 下标；目标行不存在时返回原光标。
 * - 关键步骤：先计算当前行光标前的终端列宽，再逐个字素累计目标行宽度，停在不超过原列的位置。
 * - 边界：目标行较短时停在末尾；宽字符放不进剩余列时停在字符前，不拆开字符。
 */
// [CHANGED 11.5] 上下移动按显示列宽对齐，替换原来的字素数量对齐。
export function moveVertical(draft: Draft, direction: number): number {
  const before = draft.text.slice(0, draft.cursor);
  const row = before.split("\n").length - 1;
  const lines = draft.text.split("\n");
  const target = row + direction;
  if (target < 0 || target >= lines.length) return draft.cursor;
  const column = stringWidth(before.split("\n").at(-1) ?? "");
  let cells = 0, length = 0;
  for (const part of graphemes(lines[target])) {
    const size = stringWidth(part); if (cells + size > column) break;
    cells += size; length += part.length;
  }
  return lines.slice(0, target).reduce((size, line) => size + line.length + 1, 0) + length;
}
```


替换同名函数 `draftLines()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 按可用列宽折行，并只显示包含光标的一段草稿。
 *
 * - 输入：当前草稿、可用列数与显示行数；列数至少按 2 计算。
 * - 输出：包含可见光标标记的行数组，不修改原文字或光标下标。
 * - 关键步骤：先对显示副本清理控制字符，再插入光标标记；用 wrapLines 的正文偏移找到光标所在行。
 * - 边界：视口随光标向下移动，保留末尾最多 height 行；折行以完整字素和终端列宽计算。
 */
// [CHANGED 11.5] 通过折行返回的正文偏移定位光标，避免宽字符造成显示行误判。
export function draftLines(draft: Draft, width: number, height: number): string[] {
  const columns = Math.max(2, width);
  const before = screenText(draft.text.slice(0, draft.cursor));
  const shown = `${before}▏${screenText(draft.text.slice(draft.cursor))}`;
  const lines = wrapLines(shown, columns);
  const cursorRow = lines.reduce((found, line, index) => line.offset <= before.length ? index : found, 0);
  return lines.slice(Math.max(0, cursorRow - height + 1), Math.max(height, cursorRow + 1)).map((line) => line.text);
}
```


替换同名函数 `DraftEditor()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 接管当前草稿区的输入，让编辑与提交走各自的回调。
 *
 * - 输入：父组件持有的 Draft、更新与提交函数、焦点及显示尺寸，还有仅存在本次会话中的问题历史。
 * - 输出：草稿画面、搜索结果与补全提示；普通 Enter 调用 onSubmit，是否能发送仍由父组件判断。
 * - 输入处理：仅在 active 时收键盘和粘贴；粘贴通过专门事件整段加入，不把正文里的换行当成提交。
 * - 找回与补全：历史搜索选中后只填草稿；异步补全保存发起时的草稿引用，草稿变化、失焦或卸载后旧结果不能覆盖新文字。
 * - 失败方式：文字超限或补全失败显示本地提示，保留原草稿；没有任何模型或工具执行入口。
 * - 布局：错误提示占一行，剩余高度留给草稿；超出宽高的显示内容留在数据里。
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
  // [CHANGED 11.5] 为提示预留一行，并限制本组件的总显示高度。
  const contentHeight = Math.max(1, height - (error ? 1 : 0));
  const lines = search
    ? wrapLines(`搜索历史：${screenText(search.query)}\n${screenText(candidates[search.index] ?? "没有匹配")}`, width).slice(0, contentHeight).map((line) => line.text)
    : draftLines(value, width, contentHeight);
  return <Box flexDirection="column" height={height} overflow="hidden">
    {lines.map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
    {error && <Text wrap="truncate">{fitLine(screenText(error), width)}</Text>}
  </Box>;
}
```


本文件其余实现沿用上一节。

### 用正文位置找回重排后的阅读位置

把浏览位置中的 `row` 换成 `offset`。重新排版后，找到同一消息里包含该位置的显示行；窄窗口改变行数时，仍能继续读原来附近的文字。

在 `src/ui/tui/transcript.tsx` 中，先把文件开头的教学说明与导入替换为：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
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
```


替换同名类型 `ViewLine`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
// [CHANGED 11.5] 用正文偏移替代折行行号，避免窗口变宽或变窄后锚点漂移。
export type ViewLine = { id: string; offset: number; text: string };
```


替换同名类型 `Anchor`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
export type Anchor = { id: string; offset: number } | undefined;
```


替换同名函数 `transcriptLines()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
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
```


替换同名函数 `visibleStart()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
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
```


替换同名函数 `Transcript()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
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
    <Text wrap="truncate">{!active ? "Ctrl+O 进入历史区后，↑↓/PgUp/PgDn 才用于滚动" : notice || "↑↓/PgUp/PgDn 滚动 · j/k 选消息 · Enter 展开 · Ctrl+Y 复制"}</Text>
  </Box>;
}
```


本文件其余实现沿用上一节。

### 让区域高度、焦点与颜色服从当前终端

界面先为输入和提示预留行数，剩下的空间交给结果区。窗口不足 40 列或 16 行时，正常交互暂时隐藏，状态仍留在组件中。非空 `NO_COLOR` 关闭配色，角色和状态文字继续保留。

在 `src/ui/tui/app.tsx` 中，先把文件开头的教学说明与导入替换为：

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 11.5 按终端列宽排版 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：按终端尺寸分配显示区域，窗口过小时暂停普通操作并保留所有数据。
 * 输入：模型、键盘、终端尺寸与同一 Agent 事件流；界面只在用户提交后启动任务。
 * 输出：可浏览的历史区、草稿区和审批面板。
 * 状态：Session 保存模型历史、只读授权与已发送问题；React state 保存草稿和画面。
 * 失败：本轮异常保留已经收到的结果；清理完成前不能发送下一轮，已执行的工具操作不回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session、注册退出监听 -> 挂载 TuiApp
 *   终端至少 40 列、16 行？-- 否 -> 显示放大提示，只保留取消 / 退出
 *                           +-- 是 -> 显示完整工作区
 *   Ctrl+O -> 切换草稿 / 历史焦点；审批中不切换
 *   任务运行中 -> 继续编辑草稿；按 Enter -> 提示保留草稿，等待本轮结束
 *   找回 / 搜索 / 补全 -> 更新草稿，尚未发送
 *   Ctrl+G -> 空闲且没有审批？-- 否 -> 提示稍后编辑
 *                             +-- 是 -> suspendTerminal -> 外部编辑器
 *   外部编辑成功？-- 否 -> 保留原草稿，显示原因
 *                   +-- 是 -> changeDraft -> 恢复界面，仍待发送
 *   普通 Enter -> 可以提交？-- 否 -> 保留现有状态
 *                          +-- 是 -> 空白？-- 是 -> 等待输入
 *                                         +-- 否 -> 本地命令？-- 是 -> 本地处理后返回或退出
 *                                                            +-- 否 -> 新建本轮信号 -> 消费事件
 *   普通问题提交时 -> 保存最近 100 条用户问题；模型历史仍由 Agent 核心提交
 *   ask -> waitForApproval -> 审批面板独占输入 -> y / n / 合法 s -> 原审批 Promise
 *   本轮结束 / 失败 -> 等事件流清理 -> 留下结果、解除忙碌 -> 等待下一次提交
 *   Ctrl+C -> 有本轮任务？-- 是 -> abort -> 等清理；否 -> quit
 *   quit -> closing=true -> 取消并等待模型任务与外部编辑 -> 卸载 Ink、移除监听
 *
 * 草稿、问题历史、显示条目和模型消息各有用途；浏览或编辑不会自动改变模型上下文。
 * 外部编辑占用终端期间不能同时发送；编辑器返回的文字先成为一次可撤销修改。
 * 运行观察：缩小窗口后显示放大提示，重新放大可继续；NO_COLOR 下依然能从文字区分状态。
 */
import { useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [NEW 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
```


替换同名函数 `ApprovalPanel()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 让用户逐页查看完整请求，再明确提交这一次审批决定。
 *
 * - 输入：当前 PendingApproval 与终端尺寸；request 和 respond 属于同一次核心审批等待。
 * - 输出：当前页、提示和一个审批输入框；next / prev 只翻页，y / n / s 还要按 Enter 才提交。
 * - 状态：page、answer、hint 属于这次面板；请求 key 或窗口尺寸改变时由父组件重新挂载并清空。
 * - 批准条件：窗口至少 40 列、16 行且已经到最后一页；窗口足够大时任意页都可输入 n 拒绝。
 * - 粘贴处理：审批输入不接收粘贴，复制来的正文不能变成审批按键。
 * - 关键原因：不能在只显示了部分修改时批准全部内容；尺寸变化后需按新分页重新查看。
 * - 职责边界：本函数只检查显示条件，s 是否属于可记住的只读范围仍由 pending.respond 检查。
 */
// [KEEP 来自 10.3] 审批面板继续只处理本次请求。
function ApprovalPanel({ pending, columns, rows }: { pending: PendingApproval; columns: number; rows: number }) {
  const pages = approvalPages(pending.request, columns, rows);
  const [page, setPage] = useState(0);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const tooSmall = columns < 40 || rows < 16;
  usePaste(() => setHint("审批不接受粘贴，请手动输入 y、n 或 s 后回车。"));
  // 翻页只更新画面；批准还要满足末页和窗口尺寸条件，拒绝则随时可提交。
  const submit = (value: string) => {
    const choice = value.trim().toLowerCase();
    setAnswer("");
    if (choice === "next" && page < pages.length - 1) { setPage(page + 1); setHint(""); return; }
    if (choice === "prev" && page > 0) { setPage(page - 1); setHint(""); return; }
    if (choice !== "n" && (tooSmall || page !== pages.length - 1)) { setHint("请先逐页查看完整内容，或输入 n 拒绝。"); return; }
    if (!pending.respond(choice)) setHint("请输入 y、n，或当前请求允许的 s，再按 Enter。");
  };
  // [CHANGED 11.5] 审批的颜色和光标装饰尊重 NO_COLOR，判断规则不靠颜色表达。
  return <Box borderStyle="round" borderColor={useColor ? "yellow" : undefined} paddingX={1} flexDirection="column">
    <Text bold={useColor} color={useColor ? "yellow" : undefined}>等待批准 · 第 {page + 1}/{pages.length} 页</Text>
    {tooSmall ? <Text>窗口过小，请放大至至少 40 列、16 行，或输入 n 拒绝。</Text> : <Text>{pages[page]}</Text>}
    <Text dimColor={useColor}>next 下一页 · prev 上一页 · n 拒绝</Text>
    <Text>{!tooSmall && page === pages.length - 1 ? `y 批准本次${pending.request.allowSession && !pending.request.preview ? " · s 本次会话允许" : ""}；输入后按 Enter` : "查看到最后一页后才能批准"}</Text>
    {hint && <Text color={useColor ? "yellow" : undefined}>{hint}</Text>}
    <Box><Text color={useColor ? "yellow" : undefined}>审批 &gt; </Text><TextInput focus={!tooSmall} showCursor={useColor} value={answer}
      onChange={(value) => setAnswer(screenText(value).replace(/[\r\n\t]/g, " "))} onSubmit={submit} /></Box>
  </Box>;
}
```


替换同名函数 `TuiApp()`，连同其前面的教学注释一起更新：

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 把草稿、执行事件和当前交互区域连接起来。
 *
 * - 输入：已创建的模型、整次会话的 Session，以及取消和退出函数。
 * - 输出：界面 JSX；按状态选择草稿区、历史区和审批面板，渲染本身不启动任务。
 * - 提交步骤：先检查本轮占用和空白，再处理本地命令；普通问题才创建控制器并开始消费事件。
 * - 事件处理：局部 current 顺序积累每条事件，React 合并绘制也不丢正文；finally 等清理后才解除占用。
 * - 历史区分：prompts 只记最近 100 条已发送问题，供编辑器找回；history 才是模型实际使用的消息。
 * - 焦点：草稿与历史只有一处消费普通按键；审批出现时暂停两处输入，正在编辑的草稿仍保留。
 * - 外部编辑：仅空闲时让出终端，完成后先更新草稿；失败显示原因，不自动发送或清空原文。
 * - 尺寸：小于 40 列或 16 行时保留组件状态并停用普通输入，放大后再恢复完整界面。
 * - 职责边界：本组件不执行工具或提交模型历史，取消也不会撤销已经发生的文件操作。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<"draft" | "history">("draft");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // [NEW 11.5] 先判断窗口是否容得下工作区，再决定普通输入是否激活。
  const tooSmall = columns < 40 || rows < 16;
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };

  // [KEEP 来自 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
  const openEditor = () => {
    if (session.done || session.external || session.closing || approval) { setNotice("请在当前任务结束后编辑草稿。"); return; }
    const controller = new AbortController();
    setEditing(true);
    session.external = { controller, done: (async () => {
      try {
        let text = draft.text;
        await suspendTerminal(async () => { text = await editExternally(draft.text, controller.signal); });
        if (!session.closing) { setDraft(changeDraft(draft, text)); setNotice("已取回编辑内容，按 Enter 才会发送。"); }
      } catch (error) { if (!session.closing) setNotice(screenText((error as Error).message)); }
      finally { session.external = undefined; if (!session.closing) setEditing(false); }
    })() };
  };
  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [CHANGED 11.5] 小窗口保留取消与退出，暂停焦点切换和外部编辑入口。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    if (!tooSmall && key.ctrl && input === "g" && focus === "draft") openEditor();
    if (!tooSmall && key.ctrl && input === "o" && !approval) setFocus((old) => old === "draft" ? "history" : "draft");
  });

  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing || session.external) return;
    if (session.done) { setNotice("本轮仍在运行，草稿已保留；完成后再按 Enter 发送。"); return; }
    setNotice("");
    const prompt = value.trim();
    if (!prompt) return;
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    session.prompts = [...session.prompts, prompt].slice(-100);
    append("你", prompt);
    const run = ++session.run;
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
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          setBusy(false);
        }
      }
    })();
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [CHANGED 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消 / 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    <Box display={approval ? "none" : "flex"} flexDirection="column">
      <Transcript entries={display} active={focus === "history" && !approval && !editing && !tooSmall} width={columns} height={Math.max(2, rows - 12)} />
      <Text wrap="truncate">状态：{view.status}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · 可编辑，完成本轮后再发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !editing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 · Ctrl+J 换行 · Ctrl+G 外部编辑 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}
```


本文件其余实现沿用上一节。

## 运行验证

### 构建并启动

完成本节代码后，在仓库根目录构建：

```bash
npm run lesson:11.5
```

再启动界面：

```bash
hello-my-agent
```

### 改变窗口，只改变画面

粘贴下面的草稿，先不发送：

```text
请读取 README.md，说明项目怎样启动。
中文、🙂 和 é 应完整显示，窗口变窄时自动换行。
保留这段文字，等我们检查布局以后再发送。
```

把终端从较宽的窗口逐步缩窄，再放大。正文应按当前列宽换行，输入区域仍显示光标附近的内容；窗口放大后，自动换行重新排布。上下移动光标，检查屏幕之外的草稿仍可找到。

窗口少于 40 列或少于 16 行以后，界面会给出尺寸提示，普通编辑暂时停用。重新放大，再检查三行正文仍完整：程序改变的是显示位置，没有把窄窗口下的自动换行写进草稿。

发送读取请求，等结果超过一屏后切到历史区，再重复缩窄和放大。结果重新排版，方向键仍能浏览。已经存在的工具项不会因为 resize 又执行一次。

### 不用颜色，也能继续操作

退出后，以无颜色模式重新启动：

```bash
NO_COLOR=1 hello-my-agent
```

界面仍应显示“你”“Agent”、任务状态和当前焦点。关闭的是颜色，交互界面仍需要控制光标和重新绘制；不要用“输出中完全没有转义序列”判断无颜色 TUI 是否正确。

真正需要纯文本时，使用第十章已有的文本方式。下面这条命令会向配置的模型发送一次问题，并把回答保存到文件：

```bash
hello-my-agent --output text --prompt "只回复一句：文本输出正常。" > /tmp/hello-my-agent-ch11-text.txt
```

再单独查看文件：

```bash
cat /tmp/hello-my-agent-ch11-text.txt
```

文件里不应出现 TUI 边框或光标重绘内容。最后重新启动一次界面并正常退出，在 shell 输入一条普通命令，确认键盘回显和光标恢复。

### 完成本章固定检查

使用完整配套仓库并完成本节后，在仓库根目录运行：

```bash
npm run check:11
```

检查覆盖五个小节的真实按键与粘贴通道、历史搜索、运行中草稿保留、审批输入、结果展开与复制、外部编辑和退出恢复。它还用固定文本检查 Unicode 编辑、换行宽度及重新排版后的浏览位置。

模型、剪贴板和编辑器使用本地替身。终端检查需要 macOS、Linux 或 WSL 中的 `python3`，不需要额外的 Python 包；通过这些样例不能替代对每一种真实终端与字体的观察。

## 本节完成后的 Agent

第十一章把一次使用过程接完整了：先整理多行草稿，用历史和补全减少重复输入；发送后边观察执行边准备下一份文字；需要回看时切换焦点，停留在旧结果上；长草稿可以交给外部编辑器，返回后继续检查。

这些交互始终围绕原来的执行核心。明确提交以后，模型判断是否需要工具，程序检查权限并执行，工具结果回到模型，模型给出下一步或最终回答。界面接收事件并更新画面，编辑、滚动和折叠都不替核心修改消息历史。

先完成[章末练习](../EXERCISES.md)，用确定的输入检查这些状态如何变化。第十二章将回答接下来的问题：任务还没结束时，用户补充的新要求该立即生效，还是排到下一轮；用户又怎样编辑和撤回已经排队的请求。
