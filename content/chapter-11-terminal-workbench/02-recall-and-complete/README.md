# 11.2 取回旧问题，补全当前文字

[第 11 章首页](/content/chapter-11-terminal-workbench/README.md) · [上一节：11.1 让多行输入成为可编辑的草稿](/content/chapter-11-terminal-workbench/01-editable-draft/README.md) · [下一节：11.3 在输出继续时，停下来浏览结果](/content/chapter-11-terminal-workbench/03-browse-results/README.md)

## 问题：草稿能编辑，还需要历史搜索、文件与命令补全

上一节已经能把请求写成多行草稿。接下来检查 `package.json` 时，我们想沿用上次读取 `README.md` 的要求，只换一个文件名。

<img src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/problem-scenario-0c541d2c35.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/problem-scenario-0c541d2c35.gif" data-cover="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/problem-scenario-0c541d2c35.gif.cover.png" alt="使用场景示意：取回旧读取要求，换上新的文件名，留在草稿中继续修改">

逐字重写旧问题，或手写完整的文件路径和本地命令名称，都会重复输入已有文字。我们需要搜索并取回旧问题，也需要在名称写到一半时按 `Tab` 补全；这些文字取回后还要能继续修改。

## 解决方案：搜索已提交问题，按实际名称补全草稿

输入历史与名称补全各有自己的来源，结果都先放进草稿：

| 功能 | 做法 |
| --- | --- |
| 输入历史与搜索 | 保存当前进程已提交的普通问题，按关键词查找；选中一条后把原文取回草稿。 |
| 文件与命令补全 | 按 `Tab` 时，从实际项目路径或本地命令名称中匹配光标前的文字；只有一个匹配就补完整，多个匹配只补共同前缀。 |

取回或补全后仍可编辑；普通草稿中的 `Enter` 才请求发送，搜索中的 `Enter` 只确认候选。

## 工作原理

### 历史搜索：确认候选后才替换草稿

<img src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/recall-prompt-5c2b03ec2c.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/recall-prompt-5c2b03ec2c.gif" data-cover="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/recall-prompt-5c2b03ec2c.gif.cover.png" alt="取回旧问题：搜索时保留原草稿，确认候选后只取回文字">

搜索只查当前进程已经提交的问题，从最近的记录开始找包含关键词的文字，相同问题只留最近一次。模型回答和工具结果不在这份输入列表中，取回问题也不会重放旧工具调用。

图中输入“检查”后，程序展示匹配项，原来的“请继续说明…”仍保留。按 `Enter` 才用候选替换草稿，这次按键用于取回，不用于发送；按 `Esc` 则关掉搜索，继续原草稿。

### 文件与命令补全：多个候选只补共同前缀

<img src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/complete-path-6a85655326.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/complete-path-6a85655326.gif" data-cover="./content/chapter-11-terminal-workbench/02-recall-and-complete/assets/complete-path-6a85655326.gif.cover.png" alt="路径补全：多个候选只补共同前缀，继续写后补全唯一路径并保留右侧要求">

`@pack` 同时匹配 `package-lock.json` 和 `package.json`，所以程序只补两者共有的 `@package`。继续写 `.j` 后，只剩 `package.json`，才能补完整。

补全只替换光标前正在写的路径，逗号和右侧要求原样接回。`@` 前不用加空格，它只是识别路径片段的标记；查询取得的是名称，文件正文仍要等发送后通过工具读取。

本地命令也按同样的方法匹配已支持的名称，例如 `/per` 可以补到 `/permissions`。补进草稿不执行命令；再次明确发送才由本地入口处理。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/ui/tui/input-assist.ts](/content/chapter-11-terminal-workbench/02-recall-and-complete/src/ui/tui/input-assist.ts.md) | 搜索普通问题，生成命令和路径补全建议 |
| CHANGED | [src/ui/tui/editor.tsx](/content/chapter-11-terminal-workbench/02-recall-and-complete/src/ui/tui/editor.tsx.md) | 连接历史位置、临时搜索和异步补全 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-11-terminal-workbench/02-recall-and-complete/src/ui/tui/app.tsx.md) | 在普通问题提交时记录最近 100 条输入 |

## 动手构建

以 11.1 的完整 `src/` 为起点，目标目录为 `chapter-11-terminal-workbench/02-recall-and-complete/`。沿用草稿编辑函数，本节增加输入记录、搜索和补全。

### 新增查找与补全函数

创建 `src/ui/tui/input-assist.ts`。`searchPrompts()` 倒序、去重，再做忽略大小写的子串匹配；`completeInput()` 查候选并返回新文字、光标和提示，不提交问题。

路径查询复用项目根与忽略规则。先找名称匹配，再筛完整相对路径前缀，最后判断候选数；超过 20 项就保留草稿、提示继续输入。20 是补全候选上限，不是只检查 20 个文件，发现进程仍有原来的超时和输出字节限制。唯一候选带空白时用引号保留边界。

`@路径` 只帮助写名字，不自动把附件装进模型请求；第 24 章再实现附件引用。完整新增文件如下：

<details>
<summary>完整新增文件：input-assist.ts</summary>

<!-- source: src/ui/tui/input-assist.ts -->
```ts
/**
 * 11.2 找回旧问题，补全当前输入 | [NEW] ui/tui/input-assist.ts
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

// [NEW 11.2] 本文件以下实现均为本节新增；历史和补全只修改草稿。
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
 * - 关键步骤：本地命令查固定表；路径识别不要求 @ 前有空格；转义 glob 特殊符号后复用项目根和忽略规则，先筛选完整路径前缀，再检查 20 项上限。
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
    const match = /@([^\s]*)$/.exec(left);
    if (!match) return { text, cursor, hint: "输入 / 补全本地命令，或 @ 后面的项目路径，再按 Tab。" };
    prefix = match[1]; start = left.length - prefix.length;
    const pattern = validateGlobPattern(prefix.replace(/[?*\[\]{}\\]/g, "\\$&") + "*");
    // [NEW 11.2] 名称匹配可能包含各目录同名文件，先筛选真正的路径候选，再限制数量。
    const result = await findMatchingFiles(pattern, findProjectRoot(), Infinity, signal);
    candidates = result.paths.filter((path) => path.startsWith(prefix));
    if (candidates.length > 20) return { text, cursor, hint: "候选超过 20 项，请继续输入更完整的路径。" };
  }
  signal?.throwIfAborted();
  if (!candidates.length) return { text, cursor, hint: "没有匹配的候选。" };
  let replacement = candidates.length === 1 ? candidates[0] : commonPrefix(candidates);
  if (candidates.length === 1 && /\s/.test(replacement) && !left.startsWith("/")) replacement = JSON.stringify(replacement);
  const next = left.slice(0, start) + replacement;
  return { text: next + right, cursor: next.length, hint: candidates.length === 1 ? "已补入草稿，尚未发送。" : `候选：${candidates.join(" · ")}` };
}
```

</details>

### 在编辑器中取回或补入文字

在 `src/ui/tui/editor.tsx` 中，替换文件开头的教学说明与导入：

<details>
<summary>editor.tsx 文件说明与导入</summary>

<!-- source: src/ui/tui/editor.tsx -->
```tsx
/**
 * 11.2 找回旧问题，补全当前输入 | [CHANGED] ui/tui/editor.tsx
 *
 * 学习目标：让历史找回、搜索与补全先修改草稿，仍由用户决定何时发送。
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
import { Box, Text, useInput, usePaste, type Key } from "ink";
// [CHANGED 11.2] 引入异步补全的生命周期，以及历史搜索和补全函数。
import { useEffect, useRef, useState } from "react";
import { completeInput, searchPrompts } from "./input-assist.js";
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
import { screenText } from "./state.js";
```

</details>

替换 `DraftEditor()` 及其教学注释。搜索分支先处理确认并返回；顺序翻历史用 `Ctrl+P`、`Ctrl+N`，第一次翻时保存当前 `Draft`，向后回到末尾再恢复。搜索期间只改变查询与候选位置，确认前不替换草稿。

文件查询需要等待。发起补全时记住当时的草稿，返回后再次确认没有被用户改过；输入、光标或焦点已变，就取消或丢弃旧建议。这样晚到的结果不会覆盖后来写的文字。

完整替换片段如下；其他草稿变换函数沿用 11.1：

<details>
<summary>完整替换片段：DraftEditor()</summary>

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
 */
// [CHANGED 11.2] 新增历史、搜索与异步补全；这些分支最终只更新草稿。
export function DraftEditor({ value, onChange, onSubmit, active, width, height = 4, prompts = [] }: {
  value: Draft; onChange: (value: Draft) => void; onSubmit: (text: string) => void;
  active: boolean; width: number; height?: number; prompts?: string[];
}) {
  const [error, setError] = useState("");
  // [NEW 11.2] 搜索条件、历史游标和补全任务各自保存，不能混入模型消息历史。
  const [search, setSearch] = useState<{ query: string; index: number }>();
  const recall = useRef<{ index: number; saved: Draft } | undefined>(undefined);
  const completion = useRef<AbortController | undefined>(undefined);
  const latest = useRef(value); latest.current = value;
  useEffect(() => () => completion.current?.abort(), [value.text, value.cursor, active]);
  const update = (action: () => Draft) => { try { onChange(action()); setError(""); } catch (error) { setError((error as Error).message); } };
  const candidates = search ? searchPrompts(prompts, search.query) : [];
  useInput((input, key) => {
    // [NEW 11.2] 搜索状态优先消费 Enter，所以选择候选不会直接发送问题。
    if (key.ctrl && input === "r") { setSearch((old) => old ? { ...old, index: (old.index + 1) % Math.max(1, candidates.length) } : { query: "", index: 0 }); return; }
    if (search) {
      if (key.escape) { setSearch(undefined); return; }
      if (key.return) { const chosen = candidates[search.index]; if (chosen) update(() => changeDraft(value, chosen)); setSearch(undefined); return; }
      if (key.backspace || key.delete) setSearch({ query: graphemes(search.query).slice(0, -1).join(""), index: 0 });
      else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow) setSearch({ query: search.query + input, index: 0 });
      return;
    }
    // [NEW 11.2] 第一次翻历史时保存当前草稿，向后翻回末尾即可恢复它。
    if (key.ctrl && (input === "p" || input === "n")) {
      const state = recall.current ?? { index: prompts.length, saved: value };
      state.index = Math.max(0, Math.min(prompts.length, state.index + (input === "p" ? -1 : 1)));
      recall.current = state;
      update(() => state.index === prompts.length ? state.saved : changeDraft(value, prompts[state.index] ?? "")); return;
    }
    recall.current = undefined;
    // [NEW 11.2] 路径搜索可能晚于下一次键入结束；只应用仍属于当前草稿的结果。
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
  // [CHANGED 11.2] 搜索中的粘贴只扩展查询；普通状态才插入草稿。
  usePaste((text) => {
    if (search) setSearch({ query: search.query + text.replace(/[\r\n]/g, " "), index: 0 });
    else update(() => insertText(value, text));
  }, { isActive: active });
  // [CHANGED 11.2] 搜索结果和补全提示占显示区，不写入草稿正文。
  const lines: DisplayLine[] = search
    ? `搜索历史：${screenText(search.query)}\n${screenText(candidates[search.index] ?? "没有匹配")}`.split("\n").map((text) => ({ text }))
    : draftLines(value, width, height);
  return <Box flexDirection="column">
    {lines.map((line, index) => <DraftLine key={index} line={line} active={active} />)}
    {error && <Text>{screenText(error)}</Text>}
  </Box>;
}
```

</details>

### 在普通问题提交时留下输入记录

问题列表随一次 TUI 会话存在，重绘不重建。它只保留最近 100 条已提交的普通问题，本地命令不加入；退出后记录消失，第十三章再处理持久化。

在 `src/ui/tui/app.tsx` 中，替换文件开头的教学说明与导入：

<details>
<summary>app.tsx 文件说明与导入</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 11.2 找回旧问题，补全当前输入 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：保留最近发送的问题，让编辑器找回或补全后再由用户发送。
 * 输入：模型、键盘、终端尺寸与同一 Agent 事件流；界面只在用户提交后启动任务。
 * 输出：留存消息、多行草稿与当前执行状态。
 * 状态：Session 保存模型历史、只读授权与已发送问题；React state 保存草稿和画面。
 * 失败：本轮异常保留已经收到的结果；清理完成前不能发送下一轮，已执行的工具操作不回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session、注册退出监听 -> 挂载 TuiApp
 *   空闲 -> 显示 DraftEditor；运行中 -> 显示本轮进度
 *   找回 / 搜索 / 补全 -> 更新草稿，尚未发送
 *   普通 Enter -> 可以提交？-- 否 -> 保留现有状态
 *                          +-- 是 -> 空白？-- 是 -> 等待输入
 *                                         +-- 否 -> 本地命令？-- 是 -> 本地处理后返回或退出
 *                                                            +-- 否 -> 新建本轮信号 -> 消费事件
 *   普通问题提交时 -> 保存最近 100 条用户问题；模型历史仍由 Agent 核心提交
 *   ask -> waitForApproval -> 审批面板独占输入 -> y / n / 合法 s -> 原审批 Promise
 *   本轮结束 / 失败 -> 等事件流清理 -> 留下结果、解除忙碌 -> 等待下一次提交
 *   Ctrl+C -> 有本轮任务？-- 是 -> abort -> 等清理；否 -> quit
 *   quit -> closing=true -> 取消并等待本轮任务 -> 卸载 Ink、移除监听
 *
 * 草稿不是模型消息历史；重新绘制不会重复执行任务，发送回调才把完整问题交给执行链。
 * 模型判断、工具执行、权限范围与历史提交仍由原有执行链负责。
 * 运行观察：Ctrl+P 找回问题，Ctrl+R 搜索或 Tab 补全后，仍需按 Enter 发送。
 */
import { useState } from "react";
import { Box, Static, Text, render, useInput, useWindowSize } from "ink";
import wrapAnsi from "wrap-ansi";
import { emptyRunView, updateRunView, runTranscript, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { DraftEditor, newDraft } from "./editor.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
```

</details>

替换 `Session` 及其教学注释，加入 `prompts`：

<details>
<summary>Session 类型</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
// [CHANGED 11.2] 会话增加 prompts，仅供找回用户问题，不与模型 history 混用。
type Session = {
  history: Message[];
  prompts: string[];
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
};
```

</details>

替换 `TuiApp()` 及其教学注释。本地命令处理后，普通问题才加入记录，并把列表交给草稿组件：

<details>
<summary>完整替换片段：TuiApp()</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 把草稿、执行事件和当前交互区域连接起来。
 *
 * - 输入：已创建的模型、整次会话的 Session，以及取消和退出函数。
 * - 输出：界面 JSX；按状态选择草稿、执行进度和审批面板，渲染本身不启动任务。
 * - 提交步骤：先检查本轮占用和空白，再处理本地命令；普通问题才创建控制器并开始消费事件。
 * - 事件处理：局部 current 顺序积累每条事件，React 合并绘制也不丢正文；finally 等清理后才解除占用。
 * - 历史区分：prompts 只记最近 100 条已发送问题，供编辑器找回；history 才是模型实际使用的消息。
 * - 职责边界：本组件不执行工具或提交模型历史，取消也不会撤销已经发生的文件操作。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingApproval>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  const append = (label: Entry["label"], text: string) => setEntries((old) => [...old, { label, text: screenText(text) }]);

  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
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
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    // [NEW 11.2] 只收录实际提交的普通问题，并保留最近 100 条。
    session.prompts = [...session.prompts, prompt].slice(-100);
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
  // [CHANGED 11.2] 把问题历史传给编辑器，并显示找回、搜索和补全入口。
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
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={!busy} prompts={session.prompts} width={columns - 8} />
      </Box>}
      <Text dimColor>Enter 发送 · Ctrl+J 换行 · Ctrl+P/N 历史 · Ctrl+R 搜索 · Tab 补全 · /exit 退出</Text>
    </Box>}
  </Box>;
}
```

</details>

替换 `startTui()` 及其教学注释，创建会话时初始化 `prompts: []`。本文件其他函数沿用：

<details>
<summary>完整替换片段：startTui()</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 持有整次 TUI 会话，并在退出前等所有占用结束。
 *
 * - 输入：CLI 已创建的 Model；终端是否可交互已在入口检查。
 * - 输出：界面卸载并清理本函数监听后返回，退出入口设置进程退出码。
 * - 生命周期：Session 只创建一次，重绘和单轮取消都不重建模型历史、授权或问题历史。
 * - 中断选择：Ctrl+C / SIGINT 取消当前模型任务；空闲时退出。
 * - 退出顺序：先标记 closing 阻止新提交，再取消并等待当前任务，最后卸载 Ink。
 * - 失败方式：挂载或等待失败仍进入 finally；清理后由调用方报告错误。
 * - 职责边界：Ink 负责恢复终端输入与显示模式，核心和系统操作模块负责各自任务清理；取消不是回滚。
 */
export async function startTui(model: Model): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  // [CHANGED 11.2] 输入历史随本次界面启动创建，退出进程后不保留。
  const session: Session = { history: [], prompts: [], grants: new Set(), closing: false };
  let instance: ReturnType<typeof render> | undefined;
  const quit = (code: number) => {
    if (session.closing) return;
    // 先封住新的提交和状态更新，再等待当前任务；否则退出期间仍可能继续绘制。
    session.closing = true;
    session.controller?.abort();
    void Promise.resolve(session.done).then(() => { process.exitCode = code; instance?.unmount(); });
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  const interrupt = () => { if (session.controller) session.controller.abort(); else quit(130); };
  const terminate = () => quit(143);
  const hangup = () => quit(129);
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // [KEEP 来自 10.4] 界面按键和进程 SIGINT 使用同一个 interrupt 选择取消或退出。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false });
    await instance.waitUntilExit();
  } finally {
    session.closing = true;
    session.controller?.abort();
    await session.done;
    instance?.unmount();
    // 无论正常退出还是挂载失败，只移除本次添加的监听，避免下次进入界面收到重复通知。
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    process.stdin.off("end", endInput);
  }
}
```

</details>

## 运行验证

### 构建并启动

完成本节文件后，在仓库根目录构建：

```bash
npm run lesson:11.2
```

再启动：

```bash
hello-my-agent
```

这是新进程，输入记录从空列表开始。

### 检查共同前缀和后文保留

输入 `请看@pack，并解释配置`，把光标放在 `pack` 后、逗号前，按 `Tab`。应只补到 `@package`，右侧文字不变。继续输入 `.j`，再按 `Tab`，应补成 `@package.json`。

这一过程没有发送问题，也没有读取正文。清空实验草稿，再输入 `请读取@README` 并补全，写成：

```text
请读取@README.md
说明启动和检查方法
```

按 `Enter` 提交，等回答结束。模型通过已有工具读取文件，这份普通问题也进入输入记录。

输入 `/per` 并补全，应得到 `/permissions`；明确发送只查看本地授权，不调用模型。

### 检查取回和取消

1. 写下 `请继续说明…`，先不发送。`Ctrl+P` 取回最近问题，`Ctrl+N` 回到末尾后恢复这份草稿。
2. `Ctrl+R` 搜索“检查”，按 `Enter` 取回匹配问题。界面仍空闲，再次发送才开始任务。
3. 另一次搜索用 `Esc` 退出，原草稿和光标应保持。相同问题重复提交后，顺序浏览保留提交次数，关键词搜索只显示最近一份相同文字。

## 本节完成后的 Agent

以前的问题和真实项目路径都能成为新草稿的一部分，取回与补全以后仍可修改。接下来，问题发出后也要能回看结果，程序需要记住我们正在看的位置。
