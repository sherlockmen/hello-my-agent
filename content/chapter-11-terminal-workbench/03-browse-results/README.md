# 11.3 在输出继续时，停下来浏览结果

[第 11 章首页](/content/chapter-11-terminal-workbench/README.md) · [上一节：11.2 取回旧问题，补全当前文字](/content/chapter-11-terminal-workbench/02-recall-and-complete/README.md) · [下一节：11.4 把长草稿交给外部编辑器](/content/chapter-11-terminal-workbench/04-external-editor/README.md)

## 问题：滚动查看旧结果，还要继续接收新输出

上一节已经能搜索旧问题、补全文件与命令名称。现在发送读取请求，结果超过一屏，我们想向上翻，核对前面的启动步骤。

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/problem-scenario-7fabc1fe06.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/problem-scenario-7fabc1fe06.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/problem-scenario-7fabc1fe06.gif.cover.png" alt="使用场景示意：输出继续时回看启动步骤，看完当前内容后再回到最新结果">

模型还在输出，我们希望先看完当前这一段，新内容也能继续接收。等核对完，再回到最新结果接着看；工具返回很长时，还需要折叠它，或复制完整正文留作核对。[静态图](/content/chapter-11-terminal-workbench/03-browse-results/assets/problem-scenario-7fabc1fe06.jpg.md)

## 解决方案：按阅读位置取一屏，End 恢复跟随

程序保存全部消息，按终端宽度排成显示行，再按范围取一屏。滚动时记住阅读位置，新消息继续收下，画面仍从这个位置开始，新输出就不会推走正在读的内容；按 `End` 清除阅读位置，重新取末尾一屏，恢复跟随最新输出。

焦点决定按键作用于草稿还是结果，`Ctrl+O` 在两者间切换。工具长结果可以折叠，完整正文仍保存在消息里；复制时取完整正文，交给系统剪贴板。

## 工作原理

程序先保存收到的消息，再按终端宽度整理成显示行数组。图左的 `lines` 保存全部行，中间的 `slice()` 取出一段，图右的手绘 TUI 显示这 4 行。下面先看完整过程，再看四步分别怎样做。

下标从 0 开始。蓝框表示本次 `slice(start, end)` 取出的 4 行，包含 `start`，到 `end` 前停；橙色突出新内容或当前操作，灰色旧行仍保留。动画是教学示意，一屏简化为 4 行，实际长消息可能占多行。

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/scroll-window-57ac43a39a.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/scroll-window-57ac43a39a.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/scroll-window-57ac43a39a.gif.cover.png" alt="教学示意：左侧显示行数组增长，右侧窗口停留，按 End 后重新跟随">

动画无法播放时，打开 [JPEG 静态总览](/content/chapter-11-terminal-workbench/03-browse-results/assets/scroll-window-57ac43a39a.jpg.md)。

### 1. 跟随最新：显示范围一直贴在末尾

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/follow-tail-dc2e1d3995.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/follow-tail-dc2e1d3995.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/follow-tail-dc2e1d3995.gif.cover.png" alt="跟随最新：显示范围贴在数组末尾，离开画面的旧行仍保存在内存中">

收到「执行步骤」时，程序先把它存到下标 6，再用 `slice(3, 7)` 取末尾 4 行。右边从「启动命令」显示到「执行步骤」；离开画面的旧行仍在数组里，后面还可以向上翻看。[静态图](/content/chapter-11-terminal-workbench/03-browse-results/assets/follow-tail-dc2e1d3995.png.md)

### 2. 向上浏览：记住从哪里开始看

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/browse-window-8c04422ca5.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/browse-window-8c04422ca5.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/browse-window-8c04422ca5.gif.cover.png" alt="向上浏览：Ctrl+O切焦点，两次向上键分别改变起点并记住首行">

`Ctrl+O` 只把焦点切到历史区，`slice(3, 7)` 不变。每按一次 `↑`，程序记住更前面的首行，再取一屏：起点先从 3 到 2，再到 1。最后用 `slice(1, 5)` 显示「安装依赖」到「工具说明」，下次仍从记住的位置开始。[静态图](/content/chapter-11-terminal-workbench/03-browse-results/assets/browse-window-8c04422ca5.png.md)

11.5 会进一步处理窗口缩放后的换行变化，让程序仍能找到正在看的文字。

### 3. 新消息到达：先存下来，再显示

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/receive-message-7e9b90fecb.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/receive-message-7e9b90fecb.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/receive-message-7e9b90fecb.gif.cover.png" alt="Agent输出结果核对和输出总结，分别保存到下标7和8，画面继续停在原来的四行">

Agent 继续输出「结果核对」和「输出总结」，程序把它们整理为下标 7、8 的新行。程序还记着「安装依赖」的位置，所以仍用 `slice(1, 5)` 显示原来的 4 行，新内容已保存也不会推走当前画面。[静态图](/content/chapter-11-terminal-workbench/03-browse-results/assets/receive-message-7e9b90fecb.png.md)

同一回答续写时补上原来的文字，工具返回结果时更新原工具记录；它们不必另添一条消息。

### 4. 按 End：取消停留，继续显示末尾

<img src="./content/chapter-11-terminal-workbench/03-browse-results/assets/resume-follow-5e3e8bf312.gif.cover.png" data-gif-src="./content/chapter-11-terminal-workbench/03-browse-results/assets/resume-follow-5e3e8bf312.gif" data-cover="./content/chapter-11-terminal-workbench/03-browse-results/assets/resume-follow-5e3e8bf312.gif.cover.png" alt="End清除所选位置，改为一直取末尾一屏，后续新行自动进入画面">

`End` 清除刚才记住的首行，改用 `slice(5, 9)` 显示末尾。随后「下一步」存到下标 9，程序再用 `slice(6, 10)` 显示最新 4 行。结束的是停留浏览，程序继续运行。[静态图](/content/chapter-11-terminal-workbench/03-browse-results/assets/resume-follow-5e3e8bf312.png.md)

### 焦点、折叠与复制：先选中消息

折叠和复制还要先选中目标。假设一屏里有两条工具结果，按 `Ctrl+O` 切到历史区，再用 `j` / `k` 在全部消息里选到第二条；它前面的 `>` 表示已选中，程序记住这条消息的固定 ID，后续按键就作用于它。

若第二条结果已展开，按 `Enter` 会将它折叠；排显示行时保留概要和 `[结果已折叠]`，省略详情，所以占用的显示行变少。若原本已折叠，同一个键则展开它。消息里的原始详情一直保留，按 `Ctrl+Y` 会复制选中消息的文字与完整详情，不只复制屏幕可见的几行。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/ui/tui/state.ts](/content/chapter-11-terminal-workbench/03-browse-results/src/ui/tui/state.ts.md) | 留下工具已返回的结果正文 |
| NEW | [src/ui/tui/system-actions.ts](/content/chapter-11-terminal-workbench/03-browse-results/src/ui/tui/system-actions.ts.md) | 把选中内容交给系统剪贴板 |
| NEW | [src/ui/tui/transcript.tsx](/content/chapter-11-terminal-workbench/03-browse-results/src/ui/tui/transcript.tsx.md) | 排版消息，保存浏览位置和展开状态 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-11-terminal-workbench/03-browse-results/src/ui/tui/app.tsx.md) | 连接焦点、记录与运行中草稿 |

## 动手构建

从 11.2 的完整 `src/` 继续，目标目录为 `chapter-11-terminal-workbench/03-browse-results/`。按结果数据、系统复制、浏览组件、界面连接的顺序跟写。

### 给浏览组件留下工具正文

第十章的显示状态已保存工具进度。现在在工具完成时，把返回正文放进对应项的 `detail`；展开与复制才有稳定来源。只在显示状态增加这项数据，模型历史的写入方式沿用。

在 `src/ui/tui/state.ts` 中，替换文件开头的教学说明与导入：

<details>
<summary>state.ts 文件说明与导入</summary>

<!-- source: src/ui/tui/state.ts -->
```ts
/**
 * 11.3 浏览历史与工具结果 | [CHANGED] ui/tui/state.ts
 *
 * 学习目标：把已经发生的执行事件积累成画面数据，界面不用从输出文字反推工具状态。
 * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
 * 输出：新的显示状态，或本轮结束后留在终端的文字记录；本文件没有终端写入和执行副作用。
 * 状态：更新时返回新对象，不修改传入状态或模型历史；失败与取消只改变显示中的结束状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件 -> run_start？-- 是 -> 空白本轮状态
 *                      +-- 否 -> 模型事件？-- 是 -> 按 call 更新文字与阶段
 *                                         +-- 否 -> run_finish？-- 是 -> 写结束状态与用量
 *                                                              |       非 completed 时标记未结束工具为已中断
 *                                                              +-- 否 -> 按 sequence 新建或替换工具行
 *   工具完成 -> 保存完整结果的显示副本 -> 历史区折叠或展开；本轮结束 -> 留存记录
 *
 * 模型的 call 和工具的 sequence 各有用途；都不能替代事件外壳中的送达序号。
 * answers 保存本轮已经收到的文字，画面只显示末尾是 app.tsx 的选择，不在这里丢弃文字。
 * 工具完成前 detail 保存过程摘要，完成后保存完整结果的显示副本，供历史区按需展开。
 * 显示副本经过控制字符处理；模型历史仍由核心保存，不能用 RunView 替代。
 * 运行观察：工具批准、执行、完成各有状态；取消后尚未结束的工具不再显示为执行中。
 */
import type { AgentEvent } from "../../agent/events.js";
import { formatTeachingTrace } from "../teaching-trace.js";
```

</details>

替换 `updateRunView()` 及其教学注释。新增变化位于 `tool_finish` 分支；其他事件处理一并保留：

<details>
<summary>完整替换片段：updateRunView()</summary>

<!-- source: src/ui/tui/state.ts -->
```ts
/**
 * 根据一条已发生的事件，返回下一份画面数据。
 *
 * - 输入：上一份 RunView 和有序送达的事件；model_start 必须先于该次文字增量。
 * - 输出：保留旧内容并更新相关字段的新对象，调用方再把它交给 React 显示。
 * - 文字处理：按模型 call 追加片段；没有收到片段时，用 model_finish 的完整文字补齐。
 * - 工具处理：按工具 sequence 更新状态；完成前显示摘要，tool_finish 后保存完整结果的显示副本，不从正文猜测成功或失败。
 * - 结束处理：只有 completed 记录用量；错误或取消把尚未结束的工具标为“已中断”。
 * - 职责边界：这里只处理显示副本，不发起网络请求、不执行工具，也不替用户作出审批决定。
 */
export function updateRunView(view: RunView, event: AgentEvent): RunView {
  if (event.type === "run_start") return emptyRunView();
  if (event.type === "model_start") return { ...view, status: `模型第 ${event.call} 次决策`, answers: [...view.answers, { call: event.call, text: "" }] };
  if (event.type === "text_delta") return { ...view, answers: view.answers.map((answer) => answer.call === event.call ? { ...answer, text: answer.text + screenText(event.text) } : answer) };
  // 有的 Model 实现不发送文字回调；只在尚无片段时补完整文字，避免重复一遍回答。
  if (event.type === "model_finish") return { ...view,
    status: event.outcome === "tools" ? `收到 ${event.toolRequests} 个工具请求` : "模型已返回，等待本轮结束",
    answers: view.answers.map((answer) => answer.call === event.call && !answer.text ? { ...answer, text: screenText(event.text) } : answer),
  };
  // run_finish 才结束整轮；异常结束后保留已完成的结果，只收束仍在等待或执行的状态。
  if (event.type === "run_finish") return { ...view,
    tools: event.outcome === "completed" ? view.tools : view.tools.map((tool) =>
      ["完成", "失败", "准备失败", "已拒绝"].includes(tool.status) ? tool : { ...tool, status: "已中断" }),
    status: event.outcome === "completed" ? "已完成" : event.outcome === "cancelled" ? "已取消本轮" : `运行失败：${screenText(event.message)}`,
    usage: event.outcome === "completed" ? `输入 ${event.reply.inputTokens ?? "未知"} / 输出 ${event.reply.outputTokens ?? "未知"} token` : "",
  };
  // 前面的分支已经处理整轮与模型事件；剩下的事件都有工具 sequence，可更新同一行。
  const old = view.tools.find((tool) => tool.sequence === event.sequence);
  const status = event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
    : event.type === "tool_prepare" ? event.outcome === "success" ? "预览已准备" : "准备失败"
    : event.type === "approval_start" ? "等待批准"
    : event.type === "approval_finish" ? event.response.decision === "deny" ? "已拒绝" : "已批准"
    : event.type === "tool_start" ? "执行中"
    : event.outcome === "error" || event.result.isError ? "失败" : "完成";
  // [CHANGED 11.3] 完成时保留完整工具正文的显示副本，折叠由历史区决定，不能在这里截成摘要。
  const tool = { sequence: event.sequence, name: screenText(event.call.name), status,
    detail: event.type === "tool_finish" ? screenText(event.outcome === "success" ? event.result.content : event.error) : old?.detail ?? formatTeachingTrace(event).join("\n") };
  return { ...view, status: `${tool.name}：${status}`, tools: old
    ? view.tools.map((item) => item.sequence === event.sequence ? tool : item)
    : [...view.tools, tool] };
}
```

</details>

### 建立系统复制入口

创建 `src/ui/tui/system-actions.ts`。函数把选中项的正文和详情交给系统剪贴板。这里的完整正文是工具已返回的结果，工具自己的输出上限仍在；剪贴板属于运行 Agent 的机器，SSH 不会自动转发到本机。超过 1 MB、启动失败、5 秒超时或非零退出都显示错误：

<details>
<summary>完整新增文件：system-actions.ts</summary>

<!-- source: src/ui/tui/system-actions.ts -->
```ts
/**
 * 11.3 浏览历史与工具结果 | [NEW] ui/tui/system-actions.ts
 *
 * 学习目标：按用户的复制快捷键，把当前选中内容交给系统剪贴板。
 * 输入：界面选择的显示文字与取消信号。
 * 输出：复制操作结束通知。失败抛错，由界面说明原因。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   复制 -> 超过 1000000 字节？-- 是 -> 抛错
 *                               +-- 否 -> 系统剪贴板进程 -> 从 stdin 交付文字
 *   启动失败 / 超过 5 秒 / 非零退出 -> 报错；退出码为 0 -> 完成
 *
 * 剪贴板程序只在界面快捷键触发后启动；文本通过 stdin 传入，不作为命令拼接。
 * 运行观察：复制成功后界面显示通知；系统缺少剪贴板命令时显示错误而不改变消息。
 */
import { spawn } from "node:child_process";

// [NEW 11.3] 本文件以下实现均为本节新增；只有用户的复制动作才调用此处。
/**
 * 把用户选中的内容交给本机剪贴板程序。
 *
 * - 输入：要复制的文字与可选取消信号；当前界面传入的是选中消息及其详情。
 * - 输出：进程退出码为 0 时 Promise 完成；不读取或验证粘贴板里的后续内容。
 * - 关键步骤：按系统选择 pbcopy、clip.exe、wl-copy 或 xclip，限制输入在 1000000 字节内，再从 stdin 传入文字。
 * - 失败方式：启动失败、取消或非零退出会拒绝 Promise；5 秒后请求强制终止，仍由进程关闭事件完成收尾。
 * - 职责边界：没有通过 shell 解释复制内容，也不改消息或草稿；模型输出本身不能触发复制。
 */
export async function copyText(text: string, signal?: AbortSignal): Promise<void> {
  const [command, ...args] = process.platform === "darwin" ? ["pbcopy"]
    : process.platform === "win32" ? ["clip.exe"] : process.env.WAYLAND_DISPLAY ? ["wl-copy"] : ["xclip", "-selection", "clipboard"];
  if (Buffer.byteLength(text) > 1_000_000) throw new Error("复制内容超过 1 MB，请缩小范围。");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], signal });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.on("error", () => { clearTimeout(timer); reject(new Error(`无法运行 ${command}，请检查系统剪贴板命令。`)); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("复制未完成。")); });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}
```

</details>

### 把消息排成一个可以停留的窗口

创建 `src/ui/tui/transcript.tsx`。`Entry` 保存消息，`transcriptLines()` 用 `wrap-ansi` 折成显示行，`visibleStart()` 找到本次首行。

实现提示：用 `lines.slice(start, start + height)` 取一屏，起点包含、结束下标不包含；例如 `slice(2, 6)` 取下标 2—5 的 4 行。跟随时按 `lines.length - height` 找末尾一屏，最小取 0；浏览时保存消息 `id` 与消息内显示行号 `row`，再从新行数组中找回下标，而不是固定保存旧下标。

React 的 `useState` 保留阅读位置，Ink 的 `useInput` 按当前焦点接收按键，`Text` 画出选取的行。按 `End` 时清空保存的位置，后续每次绘制重新取末尾。本节仍按显示行号定位，11.5 再换成文字位置应对缩放。

完整文件包含这些显示与输入连接，展开后即可跟写：

<details>
<summary>完整新增文件：transcript.tsx</summary>

<!-- source: src/ui/tui/transcript.tsx -->
```tsx
/**
 * 11.3 浏览历史与工具结果 | [NEW] ui/tui/transcript.tsx
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

// [NEW 11.3] 本文件以下实现均为本节新增；浏览位置独立于执行进度。
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
    <Text wrap="truncate">{!active ? "Ctrl+O 进入历史区后，↑↓/PgUp/PgDn 才用于滚动" : notice || "↑↓/PgUp/PgDn 滚动 · j/k 选消息 · Enter 展开 · Ctrl+Y 复制"}</Text>
  </Box>;
}
```

</details>

### 连接草稿、历史与审批

父组件保存 `focus`，草稿和历史按 `active` 接收输入。事件循环持续调用 `updateRunView()` 保存新文字与工具结果，再用 `setView()` 通知界面刷新；旧记录与当前任务一起交给历史区，一轮结束后以相同 ID 留存。

运行中的请求已提交，新草稿是另一份文字；提交入口先检查活动任务，再决定能否清空草稿并开始下一轮。审批出现时独占输入，隐藏草稿与历史但不卸载，结束后恢复原状态。

在 `src/ui/tui/app.tsx` 中替换文件开头的教学说明与导入：

<details>
<summary>app.tsx 文件说明与导入</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 11.3 浏览历史与工具结果 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：把会话显示成可浏览的历史区，并让任务运行时仍能准备下一份草稿。
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
 * 草稿、问题历史、显示条目和模型消息各有用途；浏览或编辑不会自动改变模型上下文。
 * 模型判断、工具执行、权限范围与历史提交仍由原有执行链负责。
 * 运行观察：向上浏览时新输出继续累积；回草稿区可准备下一问，但忙碌时发送会保留草稿。
 */
import { useState } from "react";
// [CHANGED 11.3] 移除 Static 留存区，改由可重绘的历史视口显示消息。
import { Box, Text, render, useInput, usePaste, useWindowSize } from "ink";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { DraftEditor, newDraft } from "./editor.js";
// [NEW 11.3] 条目身份与浏览操作交给历史组件。
import { Transcript, runEntries, type Entry } from "./transcript.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
```

</details>

删除本文件原来的 `Entry` 类型，改由上面的导入取得。随后替换 `Session` 及其教学注释，增加轮次与消息编号：

<details>
<summary>Session 类型</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
// [CHANGED 11.3] 轮次与本地序号生成稳定消息 ID，重绘时不重新分配。
type Session = {
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
};
```

</details>

替换 `ApprovalPanel()` 及其教学注释，审批输入沿用专用面板：

<details>
<summary>完整替换片段：ApprovalPanel()</summary>

<!-- source: src/ui/tui/app.tsx -->
```tsx
/**
 * 让用户逐页查看完整请求，再明确提交这一次审批决定。
 *
 * - 输入：当前 PendingApproval 与终端尺寸；request 和 respond 属于同一次核心审批等待。
 * - 输出：当前页、提示和一个审批输入框；next / prev 只翻页，y / n / s 还要按 Enter 才提交。
 * - 状态：page、answer、hint 属于这次面板；请求 key 或窗口尺寸改变时由父组件重新挂载并清空。
 * - 批准条件：窗口至少 40 列、16 行且已经到最后一页；任何页都可以输入 n 拒绝。
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
  // [NEW 11.3] 审批独占输入时，粘贴只给出提示，不能形成批准。
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
  return <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
    <Text bold color="yellow">等待批准 · 第 {page + 1}/{pages.length} 页</Text>
    {tooSmall ? <Text>窗口过小，请放大至至少 40 列、16 行，或输入 n 拒绝。</Text> : <Text>{pages[page]}</Text>}
    <Text dimColor>next 下一页 · prev 上一页 · n 拒绝</Text>
    <Text>{!tooSmall && page === pages.length - 1 ? `y 批准本次${pending.request.allowSession && !pending.request.preview ? " · s 本次会话允许" : ""}；输入后按 Enter` : "查看到最后一页后才能批准"}</Text>
    {hint && <Text color="yellow">{hint}</Text>}
    <Box><Text color="yellow">审批 &gt; </Text><TextInput value={answer}
      onChange={(value) => setAnswer(screenText(value).replace(/[\r\n\t]/g, " "))} onSubmit={submit} /></Box>
  </Box>;
}
```

</details>

替换 `TuiApp()` 及其教学注释。重点是焦点切换、运行中提交保护、`display` 组合和两个组件的 `active` 条件；已有 Agent 事件消费保留在完整函数中：

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
 * - 职责边界：本组件不执行工具或提交模型历史，取消也不会撤销已经发生的文件操作。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  // [NEW 11.3] 当前焦点独立于 busy：运行中仍可浏览旧内容或编辑下一份草稿。
  const [focus, setFocus] = useState<"draft" | "history">("draft");
  const [notice, setNotice] = useState("");
  const [approval, setApproval] = useState<PendingApproval>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  // [CHANGED 11.3] 本地消息入列时分配稳定 ID，避免选中项随重绘变化。
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };

  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [CHANGED 11.3] 增加焦点切换；取消本轮时保留正在准备的下一份草稿。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    if (key.ctrl && input === "o" && !approval) setFocus((old) => old === "draft" ? "history" : "draft");
  });

  // [CHANGED 11.3] 运行中允许编辑但不并发发送，未发送的文字继续留在草稿里。
  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing) return;
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
    // [NEW 11.3] 本轮的工具和回答共用轮次前缀，与前几轮的序号区分。
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
          // [CHANGED 11.3] 结束后沿用运行中的消息 ID，分条留存正文和工具详情。
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          setBusy(false);
        }
      }
    })();
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。
  // [CHANGED 11.3] 历史区与草稿区常驻，审批只暂时隐藏并停用它们。
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  return <Box flexDirection="column">
    <Text bold>Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    <Box display={approval ? "none" : "flex"} flexDirection="column">
      <Transcript entries={display} active={focus === "history" && !approval} width={columns} height={Math.max(2, rows - 12)} />
      <Text>状态：{view.status}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text color="cyan">草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · 可编辑，完成本轮后再发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 · Ctrl+J 换行 · Ctrl+R 搜索 · Tab 补全 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
  </Box>;
}
```

</details>

替换 `startTui()` 及其教学注释，初始化新增编号，并用备用屏幕承载界面。其他文件和本文件其余函数沿用：

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
  // [CHANGED 11.3] 显示身份计数器属于这次界面会话。
  const session: Session = { history: [], prompts: [], run: 0, nextId: 0, grants: new Set(), closing: false };
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
    // [CHANGED 11.3] 使用备用屏幕重绘历史视口，卸载后由 Ink 恢复原终端画面。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false, alternateScreen: true });
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

完成代码后，在仓库根目录构建：

```bash
npm run lesson:11.3
```

再启动：

```bash
hello-my-agent
```

### 在输出继续时回看，也准备下一份草稿

发送本章的两行读取请求；为了更容易得到超过一屏的结果，可以补充要求按“用途、安装、启动、验证、下一步”逐项说明。结果超过一屏后按 `Ctrl+O`，看到历史区的焦点提示，再按 `↑` 或 `PageUp`。

此时提示应变成“停留浏览”。有新文字到达时，执行继续，阅读窗口保留；按 `End` 才重新跟随。`Home` 回到记录开头，`j`、`k` 选择消息并移动到它的开头。模型输出长短和速度不固定，自动检查会用固定的追加内容验证停留行为，手动操作用来体验交互。

切回草稿区，在运行中写下 `下一轮说明测试命令` 并按 `Enter`。界面应提示等待本轮结束，草稿还在。取消当前任务并等待清理，草稿也应保留；之后再次提交才开始新任务。

若出现审批，批准或拒绝以后检查草稿仍在，回历史区也仍能浏览原位置。

### 折叠后仍能复制完整返回正文

用 `j`、`k` 选中工具项，按 `Enter` 展开，再按一次折叠。折叠只改变显示行，工具结果仍保留，也不应重复执行。按 `Ctrl+Y`，到系统文本编辑器里粘贴；复制从保存的选中项取摘要与完整返回正文，不是从屏幕上的几行拼接，所以折叠状态不影响结果。

切回草稿区，同一个 `Ctrl+Y` 表示重做，这验证的是焦点对输入归属的控制。历史区粘贴只提示回到草稿，不会改写草稿。

缺少系统剪贴板命令时，检查失败提示与界面仍可操作，本节不安装系统软件。最后按 `Ctrl+D` 退出，回到启动前的 shell 画面。

## 本节完成后的 Agent

现在，收到的结果全部保留，屏幕只画当前取出的这一段；滚动后，新消息到来仍能继续看原来的内容。切换焦点后可以继续写草稿，也能展开、复制已有结果。

下一节把长草稿交给熟悉的外部编辑器，利用它的搜索和批量修改能力。
