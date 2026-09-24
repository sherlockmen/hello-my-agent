# 11.2 找回输入，补全路径

[第 11 章首页](../README.md) · [上一节：11.1 编辑一份多行草稿](../01-editable-draft/README.md) · [下一节：11.3 停下来查看执行结果](../03-browse-results/README.md)

## 问题：已经写过的请求，为什么还要再输一遍

上一节，我们把读取 `README.md` 的请求写成了两行。看完回答以后，想沿用同样的要求，只把文件换成项目中的另一份说明。重新输入整段文字容易漏掉条件，从结果区手动寻找旧问题也不方便。

路径还有另一种麻烦：我们记得文件放在 `docs/`，却不确定完整文件名。界面已经运行在这个项目里，可以列出实际候选，让用户选择，而不是让模型猜一个路径再尝试读取。

本节给草稿加上两种来源：已经提交过的输入，以及本地命令和项目路径的补全结果。两者都先进入草稿，用户仍可以修改并决定是否发送。

## 解决方案：取回旧文字，补齐当前文字

输入历史按提交顺序保存用户的请求。查找时，从最近的一项向前搜索，把匹配项取回输入区。找不到合适内容时，用户应能退出搜索，继续编辑搜索前的草稿。

补全则从当前正在输入的片段出发：本地命令使用程序已支持的命令列表，路径使用项目中实际找到的文件。候选只帮助完成这段文字，不代替用户发送，也不提前读取文件正文。

## 工作原理

### 1. 输入历史与模型历史解决不同的问题

输入历史回答的是“刚才写过什么”。其中一项可以直接是一段多行文本：

```text
请读取 README.md，说明这个项目怎样启动。
把安装依赖、启动程序和运行检查分开说明。
```

模型历史回答的是“模型现在需要知道哪些已经发生的对话和工具结果”。一轮读取任务中，除了这份用户文本，还会有模型的工具请求、工具回复和最终回答。

所以取回输入不能靠把模型历史的所有消息塞进输入框。我们单独记录真正提交过的请求，搜索结果就能直接作为新草稿使用。恢复一条旧输入不会重放其中的工具调用；只有用户再次发送，才会启动一次新的任务。

本节保留当前进程最近 100 次已提交的普通问题。本地命令另有补全入口，不加入这份问题历史。退出再启动时，这些记录不会自动恢复；第十三章会把会话的保存、查找和恢复放到同一套持久化方案中。

### 2. 搜索期间，要保留正在写的东西

假设我们已经写了半句“请继续说明”，这时想找回上一条包含 `README` 的输入。进入搜索以后，屏幕上会出现查询词和匹配结果，但原来的半句还不能消失。

可以把搜索理解成暂时打开一个抽屉。程序先记住进入前的草稿，再让用户查看历史候选。确认某项时，候选文本成为草稿；取消搜索时，抽屉关上，原来的正文和光标一起回来。

搜索按最近优先有一个直接好处：我们通常刚完成一轮，就想修改其中的路径或要求。先找到最近一次输入，能减少继续翻找的次数。查询词改变后重新计算匹配，也避免把上一组结果的选中位置误用到另一组结果上。

### 3. 补全只回答“这里可以接什么”

命令补全的候选来自程序已经支持的命令。例如，本地权限查看与退出命令能被补全，但候选里不应出现尚未实现的会话恢复命令。

文件补全的候选来自当前项目中的真实路径。它应沿用已有的项目发现与忽略规则，这样依赖目录、受保护文件与项目外路径不会因为换了一个入口就突然出现在列表里。

本节用 `@` 标记要补全的路径。例如，草稿里的 `请读取 @README` 表示补齐 `README` 这一段，找到唯一文件后得到 `请读取 @README.md`。这个标记只帮助输入区识别路径；它不会把文件正文自动装进模型请求。

用户接受补全时，程序只替换当前要补齐的那一段。前面的请求要求和后面的文字继续保留；否则多行草稿里一个方便的快捷键，就可能覆盖掉已经写好的条件。

补全路径也不等于授权读取。发送以后，模型如果决定调用 `read_file`，仍由已有工具入口检查参数、项目边界与权限，然后返回读取结果。路径出现在候选列表里，只说明本地发现过程提供了这个名称。

候选超过 20 项时，程序要求继续输入前缀，不从被截断的一小部分候选推断“公共前缀”。例如，我们只看到了 `docs/a` 下的前 20 项，不能就断言项目里所有匹配路径都以 `docs/a` 开头。

### 4. 查询结果要对应当前这份草稿

命令列表就在内存中，文件发现却需要等待文件系统。用户按下补全以后，可能已经继续输入，甚至切换了焦点。如果旧查询结束时直接覆盖输入框，就会把更新后的文字换回旧版本。

因此，发起查询时要记住它对应的正文与光标。结果回来以后，先确认用户还在补全同一处；条件已经变化，就放弃这次旧结果。这个检查保护的是用户后写的文字，并不需要给输入框增加另一套任务队列。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/ui/tui/input-assist.ts](src/ui/tui/input-assist.ts) | 从历史与本地候选得到新文字 |
| CHANGED | [src/ui/tui/editor.tsx](src/ui/tui/editor.tsx) | 在编辑器里接上搜索和补全 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 只在普通问题提交后记录输入 |

## 动手构建

跟写起点是 11.1，本节目标目录是 `chapter-11-terminal-workbench/02-recall-and-complete/`。沿用上一节完整 `src/`，在草稿周围增加输入历史搜索和本地补全。

### 从历史与本地候选得到新文字

`searchPrompts()` 先反转输入记录，再去重并过滤，因此保留最近的匹配。`completeInput()` 只返回建议文字、光标与提示；文件候选复用已有项目发现，真正接受建议由编辑器完成。

创建 `src/ui/tui/input-assist.ts`，完整内容如下：

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
```


### 在编辑器里接上搜索和补全

历史浏览临时记住原草稿，搜索则另存查询词和候选下标。异步补全发起时记住原状态，结果回来后再次确认这还是当前草稿；输入或焦点已经变化时，就不再应用旧结果。

在 `src/ui/tui/editor.tsx` 中，先把文件开头的教学说明与导入替换为：

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
import { Text, useInput, usePaste, type Key } from "ink";
// [CHANGED 11.2] 引入异步补全的生命周期，以及历史搜索和补全函数。
import { useEffect, useRef, useState } from "react";
import { completeInput, searchPrompts } from "./input-assist.js";
import wrapAnsi from "wrap-ansi";
import stringWidth from "string-width";
import { screenText } from "./state.js";
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
  const shown = search ? `搜索历史：${screenText(search.query)}\n${screenText(candidates[search.index] ?? "没有匹配")}` : draftLines(value, width, height).join("\n");
  return <Text>{error ? `${shown}\n${screenText(error)}` : shown}</Text>;
}
```


本文件其余实现沿用上一节。

### 只在普通问题提交后记录输入

输入记录属于这次 TUI 会话，重新绘制不会清空它。本地命令处理完就返回，只有普通问题才加入最近 100 次记录；这份列表通过组件参数交给编辑器。

在 `src/ui/tui/app.tsx` 中，先把文件开头的教学说明与导入替换为：

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


替换同名类型 `Session`，连同其前面的教学注释一起更新：

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


替换同名函数 `startTui()`，连同其前面的教学注释一起更新：

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


本文件其余实现沿用上一节。

## 运行验证

### 构建并启动

完成本节代码后，在仓库根目录构建：

```bash
npm run lesson:11.2
```

再启动新的终端会话：

```bash
hello-my-agent
```

这是新进程，所以不会带入上一节退出前的输入历史。

### 先补全，再保存一条真实输入

输入 `/per`，按 `Tab`。输入区应补到 `/permissions`；再次补全时可以看到它与 `/permissions reset` 的候选。按 `Enter` 只查看本地授权，不发送模型请求。

然后在空草稿中输入：

```text
请读取 @README
```

按 `Tab`，在本仓库根目录应补成 `@README.md`。补全以后仍停留在草稿里。把请求继续写成下面两行，再按 `Enter`：

```text
请读取 @README.md，说明这个项目怎样启动。
把安装依赖、启动程序和运行检查分开说明。
```

这时才真正发送普通问题，完成后它也成为本进程的输入历史。模型需要通过原有工具读取文件，补全没有提前提供文件内容。

### 取回旧问题，也能放弃搜索

等本轮结束，先写下 `下一份草稿`，暂时不发送。按 `Ctrl+P` 取回最近输入，再按 `Ctrl+N` 回到历史末尾，应重新看到进入历史前的草稿。

按 `Ctrl+R` 进入搜索，输入 `README`。匹配结果按最近优先显示；如果有多条，继续按 `Ctrl+R` 切换。按 `Esc` 退出，原来的草稿应保留。

再次搜索 `README`，这次按 `Enter` 接受。搜索结果只放回输入区，模型还没有开始执行；我们可以修改文件名或第二行，再按一次 `Enter` 发送。

最后清空草稿，输入一个不存在的路径前缀后按 `Tab`，例如 `请读取 @no-such-course-file-`。界面应说明没有候选，原文字保留。退出再启动以后，刚才的普通问题不再能被搜索到，这对应本节只保留进程内历史的范围。

## 本节完成后的 Agent

现在，我们可以找回当前进程里已经提交的请求，修改后重新发送，也可以用已有命令和项目路径补齐草稿。查找和补全都发生在本地；用户发送以后，Agent 才继续走模型判断、工具执行与结果回传的路线。

输入越来越顺手，界面里积累的内容也越来越多。下一节把注意力转到结果区：当模型继续输出时，我们怎样停在刚才的工具摘要上阅读，并在需要时回到最新内容。
