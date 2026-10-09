# 11.4 把长草稿交给外部编辑器

[第 11 章首页](../README.md) · [上一节：11.3 在输出继续时，停下来浏览结果](../03-browse-results/README.md) · [下一节：11.5 按终端列宽排版，保留阅读位置](../05-terminal-layout/README.md)

## 问题：用外部编辑器整理长草稿，再带回当前会话

上一节已经能边看结果边准备草稿。把读取要求、错误输出和限制条件放在一起以后，这份请求已经有好几段。

![使用场景示意：用熟悉的编辑器整理长草稿，写完回到当前会话继续确认](assets/problem-scenario-7292f24a13.gif)

我们想用 Vim、Nano 或已有图形编辑器整理整段文字，写完再回到当前会话。图中以 Vim 为例：空闲时按 `Ctrl+G`，把“说明启动和检查步骤”改成“把启动和检查步骤分开说明”，再依次用 `Esc`、`:wq`、`Enter` 保存退出。带回来的内容仍是草稿，可以继续修改，确认后再发送。

## 解决方案：用临时文件交换草稿，暂停 TUI 等编辑器退出

程序先暂停 TUI 的输入和绘制，把草稿写进临时文件，再启动外部编辑器。等编辑器正常退出，再读回文件并恢复 TUI；读回的正文作为一次可撤销的修改留在草稿里，确认后才发送。

## 工作原理

![外部编辑：写入临时文件，等待保存退出，再读回草稿并恢复TUI](assets/editor-handoff-1a651cc65f.gif)

临时文件连接两个程序：TUI 的草稿在自己的内存中，编辑器先修改自己的缓冲区，再保存到文件。图中 A 是修改前的整份草稿，B 是第二行要求改过的整份草稿。Vim 缓冲区改成 B 时，文件和 TUI 内存仍是 A；保存后文件才变成 B。只有编辑器正常结束并读回成功，才用 B 替换 TUI 草稿。因此，启动失败或编辑失败都不会先丢掉旧稿。

程序必须等编辑器关闭，不能刚启动就读文件。否则读到的可能还是 A，用户随后保存的 B 也还没机会交回来。暂停 TUI 要覆盖写文件、等待和读回的整个过程，期间键盘和画面才由编辑器接管。

回来后，B 是一次普通的草稿修改：可以继续改，也可以撤销回 A；没有自动发送。临时文件完成交换后删除，B 已经留在 TUI 内存里。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/ui/tui/system-actions.ts](src/ui/tui/system-actions.ts) | 用临时文件交换草稿，等待编辑器正常结束 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 暂停和恢复终端，接受一次可撤销修改 |

## 动手构建

从 11.3 的完整 `src/` 继续，目标目录为 `chapter-11-terminal-workbench/04-external-editor/`。复制结果的实现沿用，本节只增加外部编辑交接。

### 让编辑器通过临时文件取得草稿

在 `src/ui/tui/system-actions.ts` 中，替换文件开头的教学说明与导入：

<details>
<summary>system-actions.ts 文件说明与导入</summary>

<!-- source: src/ui/tui/system-actions.ts -->
```ts
/**
 * 11.4 把草稿交给外部编辑器 | [CHANGED] ui/tui/system-actions.ts
 *
 * 学习目标：由用户把草稿交给外部编辑器，完成后取回仍待发送的文字。
 * 输入：界面选择的显示文字或当前草稿与取消信号。
 * 输出：复制操作结束通知，或外部编辑后的草稿。失败抛错，由界面说明原因。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   复制 -> 超过 1000000 字节？-- 是 -> 抛错
 *                               +-- 否 -> 系统剪贴板进程 -> 从 stdin 交付文字
 *   启动失败 / 超过 5 秒 / 非零退出 -> 报错；退出码为 0 -> 完成
 *   外部编辑 -> 创建临时目录与草稿文件 -> 启动本地配置的编辑器
 *   编辑器正常结束？-- 否 -> 抛错，界面保留原草稿
 *                      +-- 是 -> 普通文件且长度允许？-- 否 -> 抛错
 *                                                    +-- 是 -> 读回文字并返回
 *   成功 / 失败 -> finally 删除临时目录
 *
 * VISUAL / EDITOR 来自本地用户配置，允许携带参数；它会交给本机 shell，不是模型可以设置的工具参数。
 * 编辑器运行期间的终端让出与恢复由 app.tsx 负责；这里只管理进程和临时草稿。
 * 运行观察：外部编辑器保存退出后草稿更新，仍要手动发送；编辑器失败时原草稿保留。
 */
import { spawn } from "node:child_process";
// [NEW 11.4] 临时目录和草稿长度限制只服务外部编辑，不改变复制路径。
import { mkdtemp, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DRAFT } from "./editor.js";
```

</details>

在现有 `copyText()` 之后新增 `editExternally()`，包含下面的教学注释；`copyText()` 不改。

实现提示：新建专用临时目录，以 `0600` 权限写入 `prompt.md`；启动子进程后等待 `close`，退出码为 0 才检查文件并读回。返回前统一换行、检查草稿上限，`finally` 删除临时目录。失败抛给界面，原草稿不替换。

编辑器配置优先取 `VISUAL`，其次 `EDITOR`，都没有则用 `vi`。这里执行用户自己的本地配置，临时文件路径作为独立参数传入；通过 `/bin/sh` 启动，适用于 macOS、Linux、WSL 等 POSIX 环境。

<details>
<summary>完整新增函数：editExternally()</summary>

<!-- source: src/ui/tui/system-actions.ts -->
```ts
// [NEW 11.4] 外部编辑器由本地用户选择；只交换草稿，返回后仍需手动发送。
/**
 * 把草稿暂存在文件中，等待本地编辑器结束后取回文字。
 *
 * - 输入：当前草稿与本次编辑专用的取消信号；调用方先暂停 Ink 对终端的占用。
 * - 输出：正常保存退出后的完整草稿，换行统一成 LF；这里不会调用发送函数。
 * - 关键步骤：创建私有临时草稿，依次选择 VISUAL、EDITOR 或 vi；文件路径作为单独参数交给 shell。
 * - 校验：编辑器成功退出后检查普通文件与字节大小，再读回并检查 MAX_DRAFT 个 UTF-16 单元的长度限制。
 * - 失败与清理：取消先请求 SIGTERM，再用 SIGKILL 兜底并等待 close；任何结果都清理临时目录，错误交给界面保留原草稿。
 * - 职责边界：本地编辑器配置是可信配置；路径检查和读取并非同一个原子操作，这不是隔离恶意编辑器的文件系统沙箱。
 */
export async function editExternally(text: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "hello-agent-draft-"));
  const file = join(directory, "prompt.md");
  try {
    await writeFile(file, text, { mode: 0o600 });
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      // 用户的编辑器配置可以带 --wait；文件名作为独立参数，不拼入 shell 命令正文。
      const child = spawn("/bin/sh", ["-c", `exec ${editor} "$1"`, "hello-agent-editor", file], { stdio: "inherit" });
      let failure: Error | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { child.kill("SIGTERM"); timer = setTimeout(() => child.kill("SIGKILL"), 1000); timer.unref(); };
      signal.addEventListener("abort", stop, { once: true });
      child.on("error", (error) => { failure = error; });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (signal.aborted) reject(signal.reason);
        else if (failure || code !== 0) reject(new Error("编辑器未正常结束，原草稿已保留。"));
        else resolve();
      });
      if (signal.aborted) stop();
    });
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > MAX_DRAFT * 4) throw new Error("编辑结果不是普通文件或过大，原草稿已保留。");
    const next = (await readFile(file, "utf8")).replace(/\r\n?/g, "\n");
    if (next.length > MAX_DRAFT) throw new Error("编辑结果超过草稿上限，原草稿已保留。");
    return next;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
```

</details>

图形编辑器可能把文件交给已有窗口后立即返回。需要按所用编辑器配置等待选项，让启动命令直到这份文件编辑结束才关闭；程序无法从一次成功启动判断用户是否已保存。

### 暂停终端，接受读回的文字

在 `src/ui/tui/app.tsx` 中，替换文件开头的教学说明与导入：

<details>
<summary>app.tsx 文件说明与导入</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 11.4 把草稿交给外部编辑器 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：把终端暂时交给本地编辑器，回来后继续检查并发送同一份草稿。
 * 输入：模型、键盘、终端尺寸与同一 Agent 事件流；界面只在用户提交后启动任务。
 * 输出：可浏览的历史区、草稿区和审批面板。
 * 状态：Session 保存模型历史、只读授权与已发送问题；React state 保存草稿和画面。
 * 失败：本轮异常保留已经收到的结果；清理完成前不能发送下一轮，已执行的工具操作不回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session、注册退出监听 -> 挂载 TuiApp
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
 * 运行观察：Ctrl+G 保存退出编辑器后回到原界面，草稿更新，模型尚未收到新问题。
 */
import { useState } from "react";
// [CHANGED 11.4] useApp 提供让出终端的能力，供本地编辑器独占输入。
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
// [CHANGED 11.4] 外部编辑结果通过同一个 changeDraft 成为可撤销修改。
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
// [NEW 11.4] 系统模块只返回草稿文本，是否发送仍由界面决定。
import { editExternally } from "./system-actions.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
```

</details>

替换 `Session` 及其教学注释。`external` 留下这次交接的取消控制器与完成 Promise，退出时才有对象可以取消并等待：

<details>
<summary>Session 类型</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
type Session = {
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
  // [NEW 11.4] 外部编辑有自己的取消信号与完成 Promise，退出时也必须等待。
  external?: { controller: AbortController; done: Promise<void> };
};
```

</details>

替换 `TuiApp()` 及其教学注释。`Ctrl+G` 调用 `openEditor()`，把整个 `editExternally()` 放进 Ink 的 `suspendTerminal()` 回调；回调结束，Ink 恢复终端。成功后通过 `changeDraft()` 接受新正文，旧稿自然进入撤销记录，没有调用提交入口。

任务或审批存在时先拒绝这次交接、保留草稿，空闲后再打开：

<details>
<summary>完整替换片段：TuiApp()</summary>

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
  // [NEW 11.4] 用 editing 暂停普通区域输入，由 Ink 临时让出终端。
  const [editing, setEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };

  // [NEW 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
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
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    // [NEW 11.4] 只有草稿焦点的快捷键能打开本地编辑器。
    if (key.ctrl && input === "g" && focus === "draft") openEditor();
    if (key.ctrl && input === "o" && !approval) setFocus((old) => old === "draft" ? "history" : "draft");
  });

  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    // [CHANGED 11.4] 编辑器占用终端期间不接收新提交。
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
  // [CHANGED 11.4] 外部编辑期间停用草稿和历史键盘监听，保留原组件状态。
  return <Box flexDirection="column">
    <Text bold>Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    <Box display={approval ? "none" : "flex"} flexDirection="column">
      <Transcript entries={display} active={focus === "history" && !approval && !editing} width={columns} height={Math.max(2, rows - 12)} />
      <Text>状态：{view.status}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text color="cyan">草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · 可编辑，完成本轮后再发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !editing} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 · Ctrl+J 换行 · Ctrl+G 外部编辑 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
  </Box>;
}
```

</details>

替换 `startTui()` 及其教学注释。退出先禁止新提交，再取消并等待模型任务与外部编辑，最后卸载界面。取消编辑会等待进程关闭，不把取消后的文件当作成功结果。本文件其余实现沿用：

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
 * - 中断选择：Ctrl+C / SIGINT 取消当前模型任务；空闲时退出，外部编辑占用期间不由此处理 SIGINT。
 * - 退出顺序：先标记 closing 阻止新提交，再取消并等待模型任务与外部编辑，最后卸载 Ink。
 * - 失败方式：挂载或等待失败仍进入 finally；清理后由调用方报告错误。
 * - 职责边界：Ink 负责恢复终端输入与显示模式，核心和系统操作模块负责各自任务清理；取消不是回滚。
 */
export async function startTui(model: Model): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  const session: Session = { history: [], prompts: [], run: 0, nextId: 0, grants: new Set(), closing: false };
  let instance: ReturnType<typeof render> | undefined;
  const quit = (code: number) => {
    if (session.closing) return;
    // 先封住新的提交和状态更新，再等待当前任务；否则退出期间仍可能继续绘制。
    session.closing = true;
    session.controller?.abort();
    // [CHANGED 11.4] 退出前取消并等待外部编辑，不能把编辑器留在终端上。
    session.external?.controller.abort();
    void Promise.all([session.done, session.external?.done]).then(() => { process.exitCode = code; instance?.unmount(); });
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  // [CHANGED 11.4] 编辑器占用期间让它处理 Ctrl+C，避免后台界面同时退出。
  const interrupt = () => { if (session.external) return; if (session.controller) session.controller.abort(); else quit(130); };
  const terminate = () => quit(143);
  const hangup = () => quit(129);
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // [KEEP 来自 10.4] 界面按键和进程 SIGINT 使用同一个 interrupt 选择取消或退出。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false, alternateScreen: true });
    await instance.waitUntilExit();
  } finally {
    session.closing = true;
    session.controller?.abort();
    // [CHANGED 11.4] 挂载失败或其他退出路径同样清理外部编辑。
    session.external?.controller.abort();
    await Promise.all([session.done, session.external?.done]);
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

### 构建并指定编辑器

完成本节代码后，在仓库根目录构建：

```bash
npm run lesson:11.4
```

以下操作适用于 macOS、Linux 或 WSL。启动时把 `VISUAL` 留空，避免已有配置优先于这里指定的 `EDITOR`：

```bash
VISUAL= EDITOR=vi hello-my-agent
```

本机没有 `vi` 时改为已经安装的终端编辑器。图形编辑器按自身要求配置等待选项。

### 从原稿到新稿，再撤销回来

写入本章两行读取要求，先不发送，按 `Ctrl+G`。在 `vi` 中按 `i` 进入插入模式，修改第二行；按 `Esc`，输入 `:wq` 并回车，保存退出。

TUI 应显示修改后的草稿，任务尚未开始。`Ctrl+Z` 回到原稿，`Ctrl+Y` 恢复新稿；最后明确按 `Enter` 才发送。回来后仍能切到历史区浏览，原会话继续使用。

任务尚未结束时按 `Ctrl+G`，应提示稍后编辑，草稿保留。

### 失败时旧稿仍在，终端也能继续输入

退出后指定一个不存在的命令：

```bash
VISUAL= EDITOR=hello-agent-editor-does-not-exist hello-my-agent
```

写下 `这份草稿需要保留`，按 `Ctrl+G`。命令失败后应恢复 TUI、显示原因，原文仍在。再改一个字，确认输入已恢复，然后正常退出；这次检查不向模型发送问题。

正常保存、非零退出、过大文件与临时目录清理另由固定检查中的编辑器替身验证；这里观察真实终端的交接。

## 本节完成后的 Agent

长草稿可以在熟悉的编辑器中整理，再作为一次可撤销修改带回同一会话。最后一节处理窗口变化：文字重新换行以后，光标和刚才读到的内容怎样找回来？
