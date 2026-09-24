# 11.3 停下来查看执行结果

[第 11 章首页](../README.md) · [上一节：11.2 找回输入，补全路径](../02-recall-and-complete/README.md) · [下一节：11.4 用熟悉的编辑器整理草稿](../04-external-editor/README.md)

## 问题：正在看上一段，新的输出却把画面推走了

读取请求发出去以后，Agent 先显示模型文字，再显示工具状态，最后继续组织回答。内容较短时，我们跟着最新一行看就够了；内容变长以后，常常需要停下来核对前面的说明。

如果画面每次收到文字都跳到最底部，用户刚找到的工具摘要就会被推走。另一方面，输入区也需要方向键移动光标；同一个按键到底是在编辑草稿，还是在浏览结果，不能靠用户猜。

本节把结果保存与结果浏览分开：执行继续积累内容，用户决定当前看哪一段。我们再加入工具结果的折叠和复制，让长记录中常用的操作有明确入口。

## 解决方案：按焦点解释按键，按浏览位置显示结果

焦点指当前接收普通按键的区域。焦点在输入区时，方向键编辑草稿；焦点在结果区时，同一组按键用于浏览。审批出现时，审批面板临时接管输入，防止浏览或编辑动作变成批准。

结果区另外保存“是否跟随最新内容”和“目前看哪里”。用户一直在最底部时，新文字自动出现；用户主动向上看以后，程序继续保存输出，但不强行移动阅读位置。回到最新内容后，再恢复跟随。

## 工作原理

### 1. 焦点让一个按键只有一种当前含义

桌面应用里，点击输入框以后，方向键就会移动输入光标；点击列表以后，方向键才移动列表选项。终端没有必须依赖鼠标的要求，也能通过快捷键切换同样的输入归属。

对我们的 Agent 来说，需要明确的是三个状态：编辑草稿、浏览结果、处理审批。它们可以显示在同一张画面上，但不能同时消费一个确认按键。

| 当前区域 | 普通文字与编辑键的去向 | 确认动作的意义 |
| --- | --- | --- |
| 草稿区 | 修改尚未发送的正文 | 空闲时提交完整草稿 |
| 结果区 | 按浏览快捷键查看记录 | 操作当前结果，不提交草稿 |
| 审批区 | 填写当前审批答案 | 回应当前待批准请求 |

取消当前任务和退出界面仍保留第十章的统一入口。焦点改变的是普通交互的对象，不能让同一轮执行出现几套互相独立的取消逻辑。

明确输入归属以后，我们也可以在任务运行时保留草稿区。活动任务持有提交时的请求，输入区保存之后新写的文字，两份数据不会互相覆盖。运行中按 `Enter` 只提示当前不能发送，并保留草稿；程序要先通过活动任务检查，才能清空输入并创建下一轮。

审批出现时，草稿与历史区都暂时停止接收按键，但不卸载它们保存的状态。审批结束以后，草稿正文、光标和浏览位置可以继续使用。第十二章再解决运行中真正提交要求与排队，本节只是让等待时间也能用于编辑。

### 2. 保存的内容与看见的窗口不是一回事

结果记录可以有很多行，终端却只能显示其中一部分。我们可以把屏幕上的这一部分理解成一本书打开的当前页：书还在增加内容，当前页却不必跟着翻动。

因此，结果区先保存消息和工具项，再按可用宽度把它们排成显示行，最后选出当前窗口能容纳的一段。输入区位于独立的固定区域；长结果不会靠不断挤高画面把输入框推走。

第十章的 `Static` 适合把完成内容留在终端的滚动记录中。现在我们要在界面里选择阅读位置，便需要由应用自己保存结果并决定显示哪一段。终端的备用屏幕为这张完整界面提供空间：退出以后，终端回到进入 TUI 之前的主屏幕。

### 3. 主动向上浏览，就暂时停止跟随

假设结果有 30 行，窗口能显示 10 行。跟随时，程序显示末尾的第 21—30 行；新增第 31 行后，窗口自然移到第 22—31 行。

如果用户向上翻到较早位置，意思已经变成“让我看这里”。程序要记住这个选择。随后新增内容继续进入记录，但窗口保持在用户选中的位置，直到用户明确回到最新内容。

这里不能只保存“离底部还有几行”。当底部继续增长时，相同的距离会对应新的内容，窗口还是会悄悄移动。浏览状态需要能表达一个固定阅读位置，而跟随状态才根据最新内容重新计算末尾。

窗口宽度改变、工具展开以后，同一段文字所占的显示行数也会改变。程序需要把当前位置限制在新的有效范围内；11.5 会进一步说明尺寸变化怎样影响排版。

### 4. 折叠改变展示，复制取出展示文字

工具项通常先显示名称与状态。我们想核对细节时，再展开这次工具返回的结果；读完后折叠，让其他内容重新得到空间。程序保存的是“这项是否展开”，原有工具事件和模型历史都不变。

工具完成时，程序把工具交回的完整结果正文保存在对应工具项中，控制字符仍按第十章的方法转成可见文字。折叠状态只显示名称和状态，展开以后再显示结果；尚未完成、尚无结果的工具，则显示当前已有的进展信息。

复制取出当前选中项的显示正文。选中工具时，同时取出该项保存的完整结果，即使它在界面上折叠着；控制字符也保留为可见转义。这里的“完整”是工具已经返回的结果；读取、搜索和命令工具本身的输出上限仍然存在，复制不会重新读取被工具截掉的内容，也不是导出整个执行日志。

剪贴板使用运行 Agent 那台机器上的系统命令。写入失败会在界面上说明；通过 SSH 使用时，远端系统剪贴板也不等于本机剪贴板。本节没有增加远程终端的剪贴板转发协议。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/ui/tui/state.ts](src/ui/tui/state.ts) | 留下工具已经返回的完整结果 |
| NEW | [src/ui/tui/system-actions.ts](src/ui/tui/system-actions.ts) | 在明确复制时调用系统剪贴板 |
| NEW | [src/ui/tui/transcript.tsx](src/ui/tui/transcript.tsx) | 从保存的记录中选出当前窗口 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 安排焦点，并让草稿在运行时继续存在 |

## 动手构建

跟写起点是 11.2，本节目标目录是 `chapter-11-terminal-workbench/03-browse-results/`。沿用上一节完整 `src/`，把完成消息与当前任务组织成可浏览的结果区。

### 留下工具已经返回的完整结果

工具完成时，界面同时保存简短状态与结果正文。执行核心所持有的模型历史继续不变，新增数据只是让折叠、展开和复制有一份稳定的显示来源。

在 `src/ui/tui/state.ts` 中，先把文件开头的教学说明与导入替换为：

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


替换同名函数 `updateRunView()`，连同其前面的教学注释一起更新：

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


本文件其余实现沿用上一节。

### 在明确复制时调用系统剪贴板

复制由历史区快捷键主动触发。函数选择当前操作系统的剪贴板命令，把正文写进子进程标准输入，并等待结束；找不到命令、超时或非零退出都返回可显示的错误。

创建 `src/ui/tui/system-actions.ts`，完整内容如下：

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


### 从保存的记录中选出当前窗口

每项记录都有稳定 ID，工具项还携带可展开的正文。没有浏览位置时显示末尾；用户向上移动以后，记住那条消息及行号。后面再追加记录，仍能找到同一位置。本节先处理内容增长，11.5 再让位置适应重新换行。

创建 `src/ui/tui/transcript.tsx`，完整内容如下：

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
    <Text wrap="truncate">{notice || "↑↓/PgUp/PgDn 滚动 · j/k 选消息 · Enter 展开 · Ctrl+Y 复制"}</Text>
  </Box>;
}
```


### 安排焦点，并让草稿在运行时继续存在

结果区接收完成记录与当前任务的显示项。草稿和结果组件保持挂载，用 `active` 控制谁接收按键；审批覆盖时两者都暂停输入。提交先检查活动任务，检查通过以后才清空草稿，这样运行中尝试发送不会丢字。

在 `src/ui/tui/app.tsx` 中，先把文件开头的教学说明与导入替换为：

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


删除本文件原来的 `Entry` 类型，本节已由上面的导入提供对应类型。

替换同名类型 `Session`，连同其前面的教学注释一起更新：

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


替换同名函数 `ApprovalPanel()`，连同其前面的教学注释一起更新：

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


本文件其余实现沿用上一节。

## 运行验证

### 构建并启动

完成本节代码后，在仓库根目录构建：

```bash
npm run lesson:11.3
```

再启动界面：

```bash
hello-my-agent
```

这次 TUI 使用终端的备用屏幕。进入以后，结果由界面自己浏览；退出以后，回到启动前的 shell 画面。

### 看旧结果时，让新内容继续到达

发送本章的读取请求。为了观察较长结果，也可以在第二行明确要求按“用途、安装、启动、验证、下一步”逐项说明。模型实际输出长度会变化；内容超过当前结果区高度时，再做下面的操作。

| 操作 | 应看到的变化 |
| --- | --- |
| 按 `Ctrl+O` | 焦点由草稿区切到历史区，焦点提示随之改变 |
| 按 `↑` 或 `PageUp` | 阅读位置向前移动，提示从跟随变成停留浏览 |
| 保持停留，等待新文字到达 | 执行继续进行，画面不会因新输出自动跳到底部 |
| 按 `End` | 返回最新内容，重新跟随输出 |
| 按 `Home` | 回到记录开头 |
| 再按 `Ctrl+O` | 焦点回到草稿区，方向键继续编辑草稿 |

手动请求不能保证服务持续输出多长时间。固定的“停留以后再追加文字”会由本章自动检查验证，实际操作用于体验按键与显示。

任务仍在运行时，切回草稿区写入 `下一轮再说明测试命令`，按 `Enter`。界面应提示本轮还在执行，文字继续留在草稿里。按 `Ctrl+C` 取消当前任务，等清理结束，草稿仍应保留；只有之后明确提交，才开始下一轮。

### 展开工具，再复制结果

任务完成以后切到历史区，用 `j`、`k` 选择工具项，按 `Enter` 展开读取结果，再按一次折叠。折叠只收起显示，工具没有重新执行。

选中这项后按 `Ctrl+Y`，再到系统文本编辑器中粘贴。内容应包含选中项正文和工具已返回的完整结果，折叠与否不会改变复制内容。草稿区的同一个 `Ctrl+Y` 仍表示重做，当前焦点决定它的意义。

macOS 使用 `pbcopy`，Windows 使用 `clip.exe`，Linux 根据会话使用 `wl-copy` 或 `xclip`。缺少对应命令时，界面应给出复制失败提示并继续可操作；本节不自动安装系统软件。

在历史区尝试粘贴一段文字，界面会提示先回到草稿区，草稿不应被改写。最后按 `Ctrl+D` 退出，确认回到原来的 shell。

## 本节完成后的 Agent

现在，Agent 可以继续接收模型和工具事件，同时让用户停在较早的结果上阅读，或准备下一份草稿。焦点决定按键操作草稿还是结果，工具返回的正文可以按需展开，选中项可以复制。运行中仍不能提交第二轮，显示变化也不影响模型所见的历史。

下一节继续整理输入体验：当草稿已经有许多行，我们可以暂时离开这张界面，把文字交给熟悉的编辑器，保存以后再回到原来的任务与结果区。
