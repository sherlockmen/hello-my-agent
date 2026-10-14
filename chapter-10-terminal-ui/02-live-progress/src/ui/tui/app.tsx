/**
 * 10.2 让界面跟着执行变化 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：让同一界面逐条消费执行事件，显示当前文字、工具状态和本轮用量。
 * 输入：已创建的模型、键盘输入和同一 Agent 事件流；界面使用 .tsx 中的 JSX 描述布局。
 * 输出：终端里的留存消息与当前交互区域；普通问题交给 streamAgentRun 执行。
 * 状态：Session 持有模型历史、只读授权和本轮任务；React state 只保存需要重新绘制的画面数据。
 * 失败：本轮异常显示本地状态，事件生成器清理结束后才恢复输入；已经发生的工具操作不回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session、注册退出监听 -> 挂载 TuiApp
 *   Enter -> 正在执行或关闭？-- 是 -> 忽略提交
 *                            +-- 否 -> 空白？-- 是 -> 等待输入
 *                                           +-- 否 -> 本地命令？-- 是 -> 处理后返回或退出
 *                                                              +-- 否 -> 新建本轮信号、设为忙碌
 *   本轮事件 -> current 逐条更新 RunView -> 通知 React 绘制最新状态
 *   ask -> 尚未传入审批回调 -> 核心返回拒绝结果；本节没有审批输入框
 *   本轮结束 / 抛错 -> finally -> 清理本轮引用 -> 仍在界面？-- 是 -> 留下结果、恢复输入
 *                                                        +-- 否 -> 不再更新画面
 *   Ctrl+C / Ctrl+D / 退出信号 -> quit
 *   quit -> closing=true -> abort -> 等 session.done -> 卸载 Ink
 *   startTui finally -> 再确认任务结束 -> 移除信号与输入监听 -> 返回
 *
 * React 更新状态时会重新调用组件，描述应该出现的画面；实际任务只能由提交回调启动。
 * history 在组件外，所以重新绘制不会清空上下文；Static 的显示记录也不能替代这份模型历史。
 * 本文件只组织输入和显示，模型判断、工具执行、权限范围与历史提交仍由已有执行链负责。
 * 运行观察：文字持续增长，最近工具状态随事件更新；结束后完整已收文字留在上方。
 */
import { useState } from "react";
// [CHANGED 10.2] 显示状态移到 state.ts；窗口尺寸用于决定当前区域能显示多少文字。
import { Box, Static, Text, render, useInput, useWindowSize } from "ink";
import wrapAnsi from "wrap-ansi";
import { emptyRunView, updateRunView, runTranscript, screenText, type RunView } from "./state.js";
import TextInput from "ink-text-input";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";

// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
type Session = {
  history: Message[];
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
};
type Entry = { label: "你" | "Agent" | "本地"; text: string };

/**
 * 保存界面输入，并把逐条收到的执行事件变成当前画面。
 *
 * - 输入：入口创建的模型、整次会话共用的 Session，以及等待清理后退出的 quit 函数。
 * - 输出：描述终端布局的 JSX；Ink 将 Box 和 Text 绘制到终端，不会创建网页元素。
 * - 状态：useState 保存草稿、留存消息、忙闲与 RunView；状态更新触发重新绘制，不会重建 Session。
 * - 事件处理：本轮局部变量 current 按到达顺序处理每条事件，再把最新副本交给 React 显示。
 * - 关键原因：React 可以合并多次绘制，事件累积不能依赖某次画面是否已经出现。
 * - 失败方式：异常更新本轮状态；finally 等事件生成器清理后留下文字记录，再解除忙碌。
 * - 职责边界：运行中的区域只显示回答末尾与最近三个工具；完整已收文字保留在本轮状态中。
 */
function TuiApp({ model, session, quit }: { model: Model; session: Session; quit: (code: number) => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  // [CHANGED 10.2] RunView 替换单一状态文字；完整数据在本轮累积，画面可以只选末尾显示。
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  const append = (label: Entry["label"], text: string) => setEntries((old) => [...old, { label, text: screenText(text) }]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") quit(130);
    if (key.ctrl && input === "d") quit(0);
  });

  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.done || session.closing) return;
    const prompt = value.trim();
    if (!prompt) return;
    setDraft("");
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    append("你", prompt);
    setBusy(true);
    // [CHANGED 10.2] 新一轮清空显示编号与正文；模型 history 仍保留前几轮上下文。
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();
    session.controller = controller;
    session.done = (async () => {
      // [NEW 10.2] current 属于这次异步运行，顺序保存每条事件处理后的完整显示数据。
      let current = emptyRunView();
      try {
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, undefined, session.grants)) {
          // [NEW 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        // [CHANGED 10.2] 保留已收到的文字与工具记录，只把本轮结束状态改成失败或取消。
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // for await 完成或抛错前会等待生成器的 finally；此时才解除本轮占用。
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          // [CHANGED 10.2] 清理结束后把本轮已收文字与工具摘要放进 Static 留存区域。
          append("Agent", runTranscript(current));
          setView(current);
          setBusy(false);
        }
      }
    })();
  };

  // [CHANGED 10.2] 当前区域按窗口折行，只取文字末尾和最近三个工具；完整已收数据仍在 view 中。
  return <Box flexDirection="column">
    <Static items={entries}>{(entry, index) => <Box key={index} flexDirection="column" marginBottom={1}>
      <Text color={entry.label === "你" ? "cyan" : entry.label === "Agent" ? "magenta" : "yellow"} bold>{entry.label}</Text>
      <Text>{entry.text}</Text>
    </Box>}</Static>
    <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Text bold>Hello, My Agent</Text>
      <Text color={busy ? "yellow" : "green"}>状态：{view.status}{view.usage ? ` · ${view.usage}` : ""}</Text>
      {busy && <Box flexDirection="column">
        <Text color="magenta">Agent（当前文字末尾）</Text>
        <Text>{wrapAnsi(view.answers.at(-1)?.text || "等待模型…", Math.max(10, columns - 4), { hard: true, trim: false }).split("\n").slice(-Math.max(2, Math.min(8, rows - 12))).join("\n")}</Text>
        <Text dimColor>本轮工具：{view.tools.length} 次（显示最近 3 次）</Text>
        {view.tools.slice(-3).map((tool) => <Text key={tool.sequence}>#{tool.sequence} {tool.name} · {tool.status}</Text>)}
      </Box>}
      {busy ? <Text dimColor>正在处理本轮任务…</Text> : <Box><Text color="cyan">你 &gt; </Text>
        <TextInput value={draft} onChange={(value) => setDraft(screenText(value).replace(/[\r\n\t]/g, " "))} onSubmit={submit} placeholder="输入问题，Enter 发送" />
      </Box>}
      <Text dimColor>/reset 清空对话 · /permissions 查看授权 · /exit 退出 · Ctrl+C 停止并退出</Text>
    </Box>
  </Box>;
}

/**
 * 持有整次 TUI 会话，并在退出前等待当前任务和终端监听完成清理。
 *
 * - 输入：CLI 已创建的 Model；终端是否可交互由 CLI 在调用前检查。
 * - 输出：界面卸载且清理完成后返回；进程退出码由相应的退出入口设置。
 * - 生命周期：Session 在组件外只创建一次，React 重新绘制时仍使用同一份 history 和只读授权。
 * - 退出顺序：先标记 closing 防止新任务和界面更新，再取消并等待 session.done，最后卸载 Ink。
 * - 按键与信号：本节 Ctrl+C / SIGINT 结束界面；Ctrl+D、输入结束、SIGTERM 与 SIGHUP 也统一清理。
 * - 失败方式：挂载或等待抛错仍进入 finally；移除本函数的监听后由调用方报告错误。
 * - 职责边界：Ink 卸载负责恢复终端输入模式；本函数不持久化会话，也不撤销已发生的工具操作。
 */
export async function startTui(model: Model): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  const session: Session = { history: [], grants: new Set(), closing: false };
  let instance: ReturnType<typeof render> | undefined;
  const quit = (code: number) => {
    if (session.closing) return;
    // 先封住新的提交和状态更新，再等待当前任务；否则退出期间仍可能继续绘制。
    session.closing = true;
    session.controller?.abort();
    void Promise.resolve(session.done).then(() => { process.exitCode = code; instance?.unmount(); });
  };
  const interrupt = () => quit(130);
  const terminate = () => quit(143);
  const hangup = () => quit(129);
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // 关闭 Ink 默认的 Ctrl+C 退出，由 quit 先等任务清理；界面内的输出统一由组件负责。
    instance = render(<TuiApp model={model} session={session} quit={quit} />, { exitOnCtrlC: false, patchConsole: false });
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
