/**
 * 27.3 整批结果屏障 | [KEEP] ui/tui/app.tsx
 *
 * 学习目标：显示模型的加载与资源结果；本地命令、审批、任务取消保持各自入口。
 * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
 * 输出：草稿、历史、模式、本地预算、服务商用量、保存状态和审批面板。
 * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
 * 失败：保留已收到的结果，等事件流清理后解除忙碌；取消不会撤销工具操作。
 *
 * 本文件局部流程（界面操作；全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
 *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
 *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
 *   [KEEP 来自 18.1] 空闲 /memory -> 本地命令槽 -> 等待结束 -> 历史显示回执；不发模型
 *   [KEEP 来自 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
 *   [KEEP 来自 12.4] 普通 Enter -> 忙碌？-- 是 -> 本地命令？-- 是 -> 保留草稿、提示等待
 *                                         +-- 否 -> 校验补充、加入当前轮队列、清草稿
 *                              +-- 否 -> 本地命令或 startRun
 *   [KEEP 来自 12.4] Ctrl+S -> 校验并记住新要求 -> clearing 锁住提交 -> abort 旧任务
 *                   -> [KEEP 来自 13.1] await 旧 done（流清理和检查点保存）-> closing？-- 是 -> 结束；否 -> startRun
 *   [KEEP 来自 12.2] 任务清单工具结果 -> 会话内清单 -> 摘要和至多三项进度
 *   [KEEP 来自 12.3] ask_user -> waitForAnswer -> 问答面板独占输入 -> 原问答 Promise
 *                   -> 回答 / Esc / 取消 -> 关闭面板，普通草稿继续保留
 *   [KEEP 来自 12.4] startRun -> 用当前 run 绑定收取回调 -> 事件流 -> input_applied 才显示生效
 *                   -> [KEEP 来自 13.1] finally 等清理 -> 保存检查点 -> 解除占用，未收取队列留存
 *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；正在编辑队列时暂不切换
 *   [KEEP 来自 12.5] 队列 -> e 编辑 / x 撤回 -> 固定 ID 查找；已收取 -> 编辑稿留存
 *                    空闲 Enter -> 再查 ID -> 移出队列 -> 作为新任务发送
 *   [KEEP 来自 15.1] context_budget -> 独立预算行；model_usage -> 历史状态，缺失用量显示未知
 *   [KEEP 来自 15.1] 预算多占一行 -> 历史 / 队列视口减一行；16 行时隐藏任务摘要保住草稿
 *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
 *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
 *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑
 *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑、撤回 -> 调用时复制白名单 -> 保存反馈
 *   [KEEP 来自 13.1] 正常退出 -> 最后检查点 -> close（失败仍恢复终端）-> 卸载、反馈
 *
 * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
 * 清单进度是模型通过工具报告的状态；实际测试是否成功要看命令的结果。
 * 输入队列最多 20 项，每项最多 32000 个 UTF-16 单元；拒绝入队时保留草稿。
 * 运行观察：队列编辑稿与普通草稿分开，失效条目不会把编辑内容写到邻项。
 */
// [KEEP 来自 19.1] 来源作为本地显示条目，不进入模型历史。
import { skillInfo, skillCommand } from "../../skills/catalog.js";
// [KEEP 来自 26.3] 订阅随组件装卸，通知不创建模型回合。
import { useEffect, useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [KEEP 来自 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { QuestionPanel, waitForAnswer, type PendingQuestion } from "./questions.js";
// [KEEP 来自 12.5] 引入 input-queue 的本节类型或实现。
import { newInputQueue, enqueueInput, takePendingInputs, hasPendingInputs, validateQueuedText, type InputQueue, removeQueuedInput, type QueueEntry } from "./input-queue.js";
// [KEEP 来自 12.5] 引入 queue-panel 的本节类型或实现。
import { QueuePanel } from "./queue-panel.js";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import { createFileCheckpointCommands, type FileCheckpointStore } from "../../sessions/file-checkpoints.js";
// [KEEP 来自 26.1] 本地作业命令不作为模型消息或权限记录。
// [KEEP 来自 26.2] Ink暂停期间，独占的人类输入通道才会监听stdin。
import { takeoverJob } from "../../processes/takeover.js";
import { jobCommand } from "../../processes/jobs.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
import { emptyCompaction, type CompactionState } from "../../context/compaction.js";
import type { ExecutionMode, TaskState } from "../../agent/run-options.js";
// [KEEP 来自 13.1] 模型消息与未交付补充分开投影，授权和显示状态不进入文件。
import { saveSessionCheckpoint, type SessionWriter, type CheckpointReason, type SaveFeedback, type SessionState } from "../../sessions/save-session.js";

// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
/**
 * 当前 TUI 会话的控制与长期状态。
 * 模式供新一轮取快照；历史和只读授权在各轮之间复用。
 * 清单由会话持有，不因切换模式或取消一轮而重建。
 * 队列跨轮保留，所属轮由条目的 run 与收取回调限定；clearing 保护打断清理期间的提交。
 * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
 */
type Session = {
  // [KEEP 来自 16.1] 摘要视图独立于完整历史，组件重绘不会重建。
  context: CompactionState;
  // [KEEP 来自 12.1] 会话模式供下一轮启动取快照。
  mode: ExecutionMode;
  // [KEEP 来自 12.2] 会话清单独立于单轮控制器。
  tasks: TaskState;
  // [KEEP 来自 12.4] 补充队列跨轮保留，条目各自记所属轮。
  queue: InputQueue;
  // [KEEP 来自 12.4] 打断清理期间锁住提交，防止并发开新轮。
  clearing: boolean;
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
  external?: { controller: AbortController; done: Promise<void> };
  // [KEEP 来自 13.1] writer 跨轮复用；保存反馈单独显示，不混入模型执行状态。
  // [KEEP 来自 14.2] 会话长期持有检查点入口，组件重绘不重建。
  fileCheckpoints?: FileCheckpointStore;
  // [KEEP 来自 14.3] 预览计划属于会话，不随 React 重绘丢失。
  fileCommand: ReturnType<typeof createFileCheckpointCommands>;
  writer?: SessionWriter;
  saveRequest: number;
  saveMessage: string;
};

// [KEEP 来自 13.1] 界面动作和退出共用一次白名单检查点，不依赖 React effect。
/**
 * 保存当前 TUI 会话，并保留最新一次请求的反馈。
 * 调用立即将白名单传给 writer，同步复制之后才 await；权限、显示条目和草稿没有入口。
 * 较早保存完成不覆盖较新请求的状态；失败仅报告存储结果，内存会话仍可继续。
 */
async function checkpointTui(session: Session, reason: CheckpointReason): Promise<SaveFeedback | undefined> {
  const request = ++session.saveRequest;
  const feedback = await saveSessionCheckpoint(session.writer, {
    messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items,
    pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId,
  }, reason);
  if (feedback && request === session.saveRequest) session.saveMessage = feedback.message;
  if (feedback && !feedback.ok) process.exitCode = 1;
  return feedback;
}


/**
 * 让用户逐页查看完整请求，再明确提交这一次审批决定。
 *
 * - 输入：当前 PendingApproval 与终端尺寸；request 和 respond 属于同一次核心审批等待。
 * - 输出：当前页、提示和一个审批输入框；next / prev 只翻页，y / n / s 还要按 Enter 才提交。
 * - 状态：page、answer、hint 属于这次面板；请求 key 或窗口尺寸改变时由父组件重新挂载并清空。
 * - 批准条件：窗口至少 40 列、16 行且已经到最后一页；窗口足够大时任意页都可输入 n 拒绝。
 * - 小窗口：工作区暂停输入；放大后继续审批，或用 Ctrl+C 取消本轮任务、Ctrl+D 退出。
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
  // 翻页只更新画面；窗口足够大时任意页可拒绝，批准还要到最后一页。
  /**
   * 检查本次审批输入，翻页或交回明确决定。
   * next / prev 只切换页；批准前必须在足够大的窗口查看到最后一页，拒绝可在任意完整页提交。
   * respond 继续检查本次决定和可记住范围，本函数不能把粘贴文字变成批准。
   */
  const submit = (value: string) => {
    const choice = value.trim().toLowerCase();
    setAnswer("");
    if (choice === "next" && page < pages.length - 1) { setPage(page + 1); setHint(""); return; }
    if (choice === "prev" && page > 0) { setPage(page - 1); setHint(""); return; }
    if (choice !== "n" && (tooSmall || page !== pages.length - 1)) { setHint("请先逐页查看完整内容，或输入 n 拒绝。"); return; }
    if (!pending.respond(choice)) setHint("请输入 y、n，或当前请求允许的 s，再按 Enter。");
  };
  // [KEEP 来自 11.5] 审批的颜色和光标装饰尊重 NO_COLOR，判断规则不靠颜色表达。
  return <Box borderStyle="round" borderColor={useColor ? "yellow" : undefined} paddingX={1} flexDirection="column">
    <Text bold={useColor} color={useColor ? "yellow" : undefined}>等待批准 · 第 {page + 1}/{pages.length} 页</Text>
    {tooSmall ? <Text>窗口过小，请放大至至少 40 列、16 行后继续审批；Ctrl+C 取消本轮任务，Ctrl+D 退出。</Text> : <Text>{pages[page]}</Text>}
    <Text dimColor={useColor}>next 下一页 · prev 上一页 · n 拒绝</Text>
    <Text>{!tooSmall && page === pages.length - 1 ? `y 批准本次${pending.request.allowSession && !pending.request.preview ? " · s 本次会话允许" : ""}；输入后按 Enter` : "查看到最后一页后才能批准"}</Text>
    {hint && <Text color={useColor ? "yellow" : undefined}>{hint}</Text>}
    <Box><Text color={useColor ? "yellow" : undefined}>审批 &gt; </Text><TextInput focus={!tooSmall} showCursor={useColor} value={answer}
      onChange={(value) => setAnswer(screenText(value).replace(/[\r\n\t]/g, " "))} onSubmit={submit} /></Box>
  </Box>;
}

/**
 * 把草稿、会话控制和执行事件连成可操作的终端工作区。
 * 普通任务只由提交 handler 启动；组件重绘不创建模型请求。
 * 焦点决定普通按键由哪一区处理，审批或澄清占用时暂停工作区输入。
 * 忙碌 Enter 入当前轮补充队列；Ctrl+S 先保存要求、取消旧轮并等清理，再开新轮。
 * 队列焦点使用独立编辑稿，保存和单独发送都重新查固定 ID。
 * 局部 current 顺序累积事件；finally 等事件流清理后才解除占用。
 * 显示条目与模型历史分别保存；本组件不直接执行工具、提交历史或撤销副作用。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
// [KEEP 来自 12.5] 界面接入本节操作；具体状态和按键变化在对应分支标明。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  // [KEEP 来自 13.3] 从模型消息重建阅读条目；不恢复旧流、审批等待或工具执行器。
  const [entries, setEntries] = useState<Entry[]>(() => [
    // [KEEP 来自 17.1] 进入 TUI 后仍可在历史区查看本次实际加载来源。
    ...(model.projectInfo ? [{ id: "project-instructions", label: "本地" as const, text: screenText(model.projectInfo.join("\n")) }] : []),
    ...(model.skills ? [{ id: "skill-catalog", label: "本地" as const, text: screenText(skillInfo(model.skills).join("\n")) }] : []),
    ...session.history.map((message, index): Entry => ({
      id: `restored-${index}`,
      label: message.role === "user" ? "你" : message.role === "assistant" ? "Agent" : "工具",
      text: screenText(message.role === "tool" ? `${message.toolCallId} · ${message.isError ? "失败" : "已返回"}` : message.content),
      ...(message.role === "tool" ? { details: screenText(message.content) } : {}),
    })),
    ...(session.writer?.restored ? [{ id: "restored-notice", label: "本地" as const, text: "会话已恢复；等待新要求，不重放旧工具。权限需重新确认，旧补充保留原任务归属。" }] : []),
  ]);
  const [busy, setBusy] = useState(false);
  // [KEEP 来自 12.5] 焦点增加队列；草稿、历史、队列只由当前焦点处理普通键。
  const [focus, setFocus] = useState<"draft" | "history" | "queue">("draft");
  const [notice, setNotice] = useState("");
  // [KEEP 来自 13.1] 保存状态有独立一行，模型完成或取消不等于保存成功。
  const [saveMessage, setSaveMessage] = useState(session.saveMessage);
  const [, refreshQueue] = useState(0);
  const [editing, setEditing] = useState(false);
  // [KEEP 来自 12.5] 编辑队列时暂停全局焦点切换，独立编辑稿继续保留。
  const [queueEditing, setQueueEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  // [KEEP 来自 12.3] 澄清面板保存当前请求，与审批和普通草稿分开。
  const [question, setQuestion] = useState<PendingQuestion>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // [KEEP 来自 11.5] 先判断窗口是否容得下工作区，再决定普通输入是否激活。
  const tooSmall = columns < 40 || rows < 16;
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  /**
   * 把本地提示或已提交问题加入显示记录。
   * 分配稳定显示 ID，并以函数式更新追加到旧条目后；这里不提交模型历史。
   */
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };
  // [KEEP 来自 26.3] 输出就绪和终态单独进入本地记录，正文来自同一个登记表快照。
  useEffect(() => model.jobs?.subscribe(({ type, job }) => {
    if (!session.closing) append("本地", `[作业${type === "ready" ? "输出就绪" : "已结束"}] ${job.id} ${job.state} readiness=${job.readiness}${job.evidence ? ` evidence=${JSON.stringify(job.evidence)}` : ""}`);
  }), [model, session]);
  // [KEEP 来自 13.1] 只由明确操作调用；编辑草稿与 Enter 入队不自动刷盘。
  /**
   * 启动一次检查点并刷新独立保存状态，不改变模型任务的成功、失败或取消结果。
   * 保存失败由 checkpointTui 转为反馈，fire-and-forget 本地操作不会产生未处理拒绝。
   */
  const checkpoint = async (reason: CheckpointReason) => {
    if (session.writer) { session.saveMessage = "正在保存会话…"; setSaveMessage(session.saveMessage); }
    await checkpointTui(session, reason);
    if (!session.closing) setSaveMessage(session.saveMessage);
  };

  // [KEEP 来自 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
  /**
   * 在空闲时把终端交给外部编辑器，再取回仍未发送的草稿。
   * 任务、审批、问答或退出正在占用时只提示等待。
   * 编辑成功形成一次草稿修改；失败保留原文，结束后解除外部占用。
   */
  const openEditor = () => {
    if (session.done || session.external || session.closing || session.clearing || approval || question) { setNotice("请在当前任务结束后编辑草稿。"); return; }
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
  // [KEEP 来自 11.5] 小窗口保留取消与退出，暂停焦点切换和外部编辑入口。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // [KEEP 来自 12.4] 忙碌 Enter 进入当前轮补充队列，本地命令仍需空闲处理。
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    // [KEEP 来自 12.4] Ctrl+S 只从草稿入口打断并发送，不抢审批或问答输入。
    if (!tooSmall && key.ctrl && input === "s" && focus === "draft" && !approval && !question && !editing) void interruptAndSend(draft.text);
    if (!tooSmall && key.ctrl && input === "g" && focus === "draft") openEditor();
    // [KEEP 来自 12.5] 三处焦点循环，队列编辑和清理期间不切换。
    if (!tooSmall && key.ctrl && input === "o" && !approval && !question && !queueEditing && !session.clearing) setFocus((old) => old === "draft" ? "history" : old === "history" ? "queue" : "draft");
  });

  /**
   * 处理普通草稿 Enter，决定本地命令、排队补充或新任务。
   * 忙碌时普通文字校验后入当前 run 队列，成功才清草稿；本地命令保留到空闲处理。
   * 新任务记录已发送问题，并使用启动时的模式快照；失败提示不会自动重发。
   */
  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing || session.external || session.clearing) return;
    if (session.done) {
      if (isLocalCommand(value.trim())) { setNotice("本地命令需等待本轮结束；草稿已保留。"); return; }
      try {
        // [KEEP 来自 12.4] 校验和入队成功才清草稿；入队不表示已加入上下文。
        const entry = enqueueInput(session.queue, value, session.run);
        setDraft(newDraft());
        refreshQueue((old) => old + 1);
        setNotice(`补充 #${entry.id} 已排队，尚未送到模型；Ctrl+S 可打断并发送草稿。`);
      } catch (error) { setNotice((error as Error).message); }
      return;
    }
    setNotice("");
    const prompt = value.trim();
    if (!prompt) return;
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    // [KEEP 来自 26.2] suspendTerminal暂停Ink唯一底层读者；保留React输入订阅，避免resume早于active效果。
    if (/^\/fg(?:\s|$)/.test(prompt)) {
      const match = /^\/fg ([0-9a-f-]{36})$/.exec(prompt);
      if (!match || !model.jobs) { append("本地", "用法：/fg <本次会话PTY的JobID>。"); return; }
      const controller = new AbortController();
      session.external = { controller, done: (async () => {
        try { await suspendTerminal(async () => { await takeoverJob(model.jobs!, match[1]!, controller.signal); }); }
        catch (error) { if (!session.closing) append("本地", explainError(error)); }
        finally { session.external = undefined; if (!session.closing) setNotice("已收回终端；/job核对状态，/stop显式停止。"); }
      })() }; return;
    }
    // [KEEP 来自 26.2] 停止等对应transport收尾后才恢复输入；日志由现有显示层转义。
    if (/^\/(jobs|job|stop)(?:\s|$)/.test(prompt)) {
      session.clearing = true;
      session.done = (async () => {
        try { append("本地", await jobCommand(prompt, model.jobs)); }
        catch (error) { append("本地", explainError(error)); }
        finally { session.done = undefined; session.clearing = false; }
      })(); return;
    }
    if (/^\/model(?:\s|$)/.test(prompt)) { const result = model.command?.(prompt); append("本地", result?.message ?? "当前模型不支持本地切换。"); if (!result?.ok) setDraft(draft); return; }
    if (/^\/(attach|attachments|detach)(?:\s|$)/.test(prompt)) {
      const controller = new AbortController();
      session.controller = controller; session.clearing = true; setNotice("正在检查附件，Ctrl+C 可取消…");
      setDraft(draft);
      session.done = (async () => {
        try {
          const result = await model.attachments?.command(prompt, controller.signal);
          if (!session.closing) { append("本地", result?.message ?? "当前模型未连接附件状态。"); if (result?.ok) setDraft(newDraft()); }
        } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件读取已取消，原稿与待发送引用保留。" : explainError(error)); }
        finally { session.controller = undefined; session.done = undefined; session.clearing = false; if (!session.closing) setNotice("附件操作已结束；/attachments 可核对待发送列表。"); }
      })();
      return;
    }
    // [KEEP 来自 19.2] 本地加载拥有独立取消控制器；退出等待读取句柄关闭，不产生用户消息。
    if (/^\/(skills|skill)(?:\s|$)/.test(prompt)) {
      const controller = new AbortController();
      session.controller = controller; session.clearing = true; setNotice("正在读取技能，Ctrl+C 可取消…");
      session.done = (async () => {
        try {
          const result = model.skills ? await skillCommand(prompt, model.skills, controller.signal) : "当前运行未连接技能目录。";
          if (!session.closing && result) append("本地", result);
        } catch (error) {
          if (!session.closing) append("本地", controller.signal.aborted ? "技能加载已取消；完整读取结束前不会加入正文。" : explainError(error));
        } finally {
          session.controller = undefined; session.done = undefined; session.clearing = false;
          if (!session.closing) { setView((current) => ({ ...current, status: "就绪" })); setNotice("技能读取已结束；/skills 可核对来源和加载状态。"); }
        }
      })();
      return;
    }
    // [KEEP 来自 18.1] 异步记忆管理占用本地命令槽，结束前不启动模型任务。
    if (/^\/memory(?:\s|$)/.test(prompt)) {
      session.clearing = true; setNotice("正在处理项目记忆…");
      session.done = (async () => {
        try {
          const result = model.memory ? await model.memory.command(prompt, session.mode) : "当前运行未连接项目记忆。";
          if (!session.closing) append("本地", result);
        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("记忆操作已结束；新任务开始时刷新有效记忆。"); }
      })();
      return;
    }
    // [KEEP 来自 14.3] 立即占用，直到恢复和通知保存完成才开放下一任务。
    if (/^\/(changes|restore)(?:\s|$)/.test(prompt)) {
      session.clearing = true; setNotice("正在核对文件检查点…");
      session.done = (async () => {
        try {
          const result = await session.fileCommand(prompt);
          if (!session.closing) append("本地", result.message);
          if (result.restored) { session.history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
        } catch (error) {
          if (!session.closing) append("本地", error instanceof Error ? error.message : "文件操作未完成，请核对目标。");
        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("文件操作已结束；Ctrl+O 可在历史区查看完整预览。"); }
      })();
      return;
    }
    // [KEEP 来自 13.1] 清空后的模型历史进入检查点；授权不写入文件。
    if (prompt === "/reset") { session.history.length = 0;
      Object.assign(session.context, emptyCompaction()); append("本地", "对话历史已清空；会话授权保留。"); void checkpoint("reset"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    // [KEEP 来自 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
    if (prompt === "/mode" || prompt.startsWith("/mode ")) {
      const mode = prompt.slice(6).trim();
      if (mode === "plan" || mode === "execute") session.mode = mode;
      append("本地", `当前模式：${session.mode}${mode && mode !== "plan" && mode !== "execute" ? "；用法：/mode plan|execute" : ""}`);
      // [KEEP 来自 13.1] 查询或非法 mode 不保存，有效本地模式操作才建立检查点。
      if (mode === "plan" || mode === "execute") void checkpoint("mode");
      return;
    }
    setDraft(draft);
    startRun(prompt);
  };

  /**
   * 识别必须在空闲时本地处理的命令。
   * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
   */
  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|jobs|job|stop|fg|attach|attachments|detach|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
  /**
   * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
   * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
   * 等待后若已退出就停止；否则解锁、清草稿并 startRun。旧轮未收取队列仍留存。
   */
  const interruptAndSend = async (value: string) => {
    if (session.closing || session.external || session.clearing || approval || question || editing || tooSmall) return;
    let prompt: string;
    try { prompt = validateQueuedText(value); } catch (error) { setNotice((error as Error).message); return; }
    if (isLocalCommand(prompt)) { setNotice("Ctrl+S 需要新的任务要求，本地命令请在空闲时使用。"); return; }
    // [KEEP 来自 12.4] 先保存 prompt，再锁住提交入口，旧轮清理过程中禁止重入。
    session.clearing = true;
    setNotice("正在打断当前任务，清理完毕后发送草稿…");
    // [KEEP 来自 12.4] 先记住旧 done；abort 只是请求停止，必须继续等待清理。
    const previous = session.done;
    session.controller?.abort();
    // [KEEP 来自 13.1] done 延伸到历史检查点保存结束；旧任务清理与保存都结束才开新轮。
    await previous;
    // [KEEP 来自 12.4] 等待期间若已退出，停止发送已保存的新要求。
    if (session.closing) return;
    session.clearing = false;
    startRun(prompt);
  };

  /**
   * 为空闲提交建立一次任务，并顺序消费它的事件。
   * 立即占住 session.done，创建新控制器、run 编号和模式快照；会话清单与历史继续复用。
   * 队列回调闭包固定当前 run，只能收取这一轮条目；askUser 只展示当前问答。
   * finally 等流清理后解除忙碌、保存显示结果，并提示未收取补充仍保留。
   */
  const startRun = (prompt: string, queuedId?: number) => {
    if (session.closing || session.external || session.clearing || session.done) return;
    if (!model.attachments?.pending.length) {
      if (queuedId === undefined) setDraft(newDraft());
      startPreparedRun(prompt, queuedId); return;
    }
    const controller = new AbortController();
    session.controller = controller; session.clearing = true; setNotice("正在预检待发送附件，Ctrl+C 可取消…");
    session.done = (async () => {
      let accepted = false;
      try {
        await model.attachments?.preflight(controller.signal, model.profile?.capabilities.images === true);
        controller.signal.throwIfAborted(); accepted = true;
      } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件预检已取消；原稿与待发送引用保留。" : explainError(error)); }
      finally { session.controller = undefined; session.done = undefined; session.clearing = false; }
      if (!accepted || session.closing) return;
      if (queuedId === undefined) setDraft(newDraft());
      setNotice(""); startPreparedRun(prompt, queuedId);
    })();
  };

  /**
   * 预检已经通过才提交问题；SDK 请求仍会重新读取和核对实际发送字节。
   * 这里继续复用原队列、取消、会话保存与审批流程，不在失败回调覆盖用户新输入。
   */
  const startPreparedRun = (prompt: string, queuedId?: number) => {
    if (session.closing || session.external || session.clearing || session.done) return;
    session.prompts = [...session.prompts, prompt].slice(-100);
    append("你", prompt);
    const run = ++session.run;
    const historyLength = session.history.length;
    setBusy(true);
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();

    // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
    // [KEEP 来自 14.2] 本轮获批准的写入使用当前会话文件检查点。
    const options = { sessionId: session.writer?.id, context: session.context, fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
      // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
      askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
        if (!session.closing) setQuestion(pending);
      }),
      // [KEEP 来自 12.4] 收取闭包绑定 startRun 的 run，旧队列不注入新轮。
      takePendingInputs: () => { const inputs = takePendingInputs(session.queue, run); if (inputs.length && !session.closing) refreshQueue((old) => old + 1); return inputs; },
      // [KEEP 来自 12.4] 终轮回答后可检查剩余补充，尚不移出条目。
      hasPendingInputs: () => hasPendingInputs(session.queue, run),
    };
    session.controller = controller;
    session.done = (async () => {
      let current = emptyRunView();
      try {
        // [KEEP 来自 13.3] 先记下本轮开始前的状态；失败则停止，不调用模型。
        await session.writer?.save({ messages: session.history, context: session.context, mode: session.mode, tasks: session.tasks.items, pendingInputs: session.queue.items, run: session.run, nextInputId: session.queue.nextId }, "run_start");
        controller.signal.throwIfAborted();
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
          if (!session.closing) setApproval(pending);
        }), session.grants, options)) {
          // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          // [KEEP 来自 12.4] 只在核心确认收取并加入本次上下文后显示确认。
          if (event.type === "input_applied" && !session.closing) append("本地", `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${event.text}`);
          // [KEEP 来自 16.3] 已采用或未采用的结论留在本地阅读记录，不写成模型消息。
          if (event.type === "compaction_finish" && !session.closing) append("本地", event.outcome === "applied"
            ? `压缩已采用：前 ${event.through} 条旧记录改用摘要发送，完整记录仍保存。`
            : `压缩未采用：${event.message}`);
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // [KEEP 来自 13.3] 重发文字进入历史后才移出旧队列；开始前失败则保留，避免丢失已保存文字。
        const committed = session.history[historyLength];
        // [KEEP 来自 24.1] 提交前失败时取回清掉的原稿；用户已写的新草稿不能被覆盖。
        if (queuedId === undefined && !session.closing && !(committed?.role === "user" && committed.content === prompt)) {
          setDraft((currentDraft) => currentDraft.text ? currentDraft : newDraft(prompt));
        }
        if (queuedId !== undefined && committed?.role === "user" && committed.content === prompt
          && session.queue.items.find((item) => item.id === queuedId)?.text === prompt) {
          removeQueuedInput(session.queue, queuedId);
          if (!session.closing) refreshQueue((old) => old + 1);
        }
        // [KEEP 来自 13.1] 生成器已完成清理、提交 history；保存结果另行显示，done 继续占用。
        await checkpoint("run_end");
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          // [KEEP 来自 12.3] 任务结束清掉当前面板，普通草稿未被改写。
          setQuestion(undefined);
          setBusy(false);
          // [KEEP 来自 12.4] 本轮剩余补充继续留存，下一轮不会自动使用。
          if (hasPendingInputs(session.queue, run)) setNotice("本轮已结束；未生效的补充仍保留在队列，不会自动进入下一轮。");
        }
      }
    })();
  };

  /**
   * 把空闲时选中的待发送补充作为新任务提交。
   * 先检查任务和交互占用，再按原 ID 找到条目；已经失效时提示且不重复发送。
   * 保留旧条目直到新任务提交历史，随后与结果一起保存；不改原普通草稿。
   */
  const sendQueued = (entry: QueueEntry) => {
    if (session.done || session.closing || session.external || session.clearing || approval || question) return;
    // [KEEP 来自 13.3] 重发前查原 ID；旧条目仍保留在开始检查点中。
    const pending = session.queue.items.find((item) => item.id === entry.id);
    if (!pending) { setNotice("该补充已被收取，不能重复发送。"); return; }
    setNotice(`已将补充 #${pending.id} 作为新的任务发送。`);
    startRun(pending.text, pending.id);
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。

  // [KEEP 来自 12.2] 按窗口显示摘要和至多三项，不丢弃真实清单。
  // [KEEP 来自 15.1] 最小 16 行已占满；暂隐清单摘要，实际任务数据仍留在会话中。
  const taskLines = session.tasks.items.length === 0 || rows < 17 ? 0 : 1 + (rows >= 20 ? Math.min(3, session.tasks.items.length, rows - 18) : 0);
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  // [KEEP 来自 12.2] 下方清单区域从会话读取进度，显示报告不等于测试通过。
  // [KEEP 来自 12.3] 下方澄清面板用独立 key 挂载，占用时隐藏普通区但保留草稿。
  // [KEEP 来自 12.5] 下方队列焦点连接专用面板，编辑稿与普通草稿分别保存。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史 / 队列</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消任务 · Ctrl+D 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    {question && <QuestionPanel key={question.key} pending={question} columns={columns} rows={rows} />}
    <Box display={approval || question ? "none" : "flex"} flexDirection="column">
      {taskLines > 0 && <Box flexDirection="column">
        <Text wrap="truncate">任务：{session.tasks.items.filter((item) => item.status === "completed").length}/{session.tasks.items.length} 已完成 · {session.tasks.items.filter((item) => item.status === "in_progress").length} 进行中 · {session.tasks.items.filter((item) => item.status === "pending").length} 待办</Text>
        {session.tasks.items.slice(0, taskLines - 1).map((item) => <Text key={item.id} wrap="truncate">{item.status === "completed" ? "[完成]" : item.status === "in_progress" ? "[进行]" : "[待办]"} {screenText(item.text).replace(/\n/g, " ")}</Text>)}
      </Box>}
      <Box display={focus === "queue" ? "none" : "flex"} flexDirection="column">
        {/* [KEEP 来自 13.1] 保存状态占一行，历史视口相应减少高度。 */}
        <Transcript entries={display} active={focus === "history" && !approval && !question && !editing && !session.clearing && !tooSmall} width={columns} height={Math.max(2, rows - 14 - taskLines)} />
      </Box>
      <Box display={focus === "queue" ? "flex" : "none"} flexDirection="column">
        {/* [KEEP 来自 13.1] onChange 只在队列成功编辑或撤回时调用，不保存独立编辑草稿。 */}
        <QueuePanel queue={session.queue} active={focus === "queue" && !approval && !question && !editing && !session.clearing && !tooSmall} busy={Boolean(session.done || session.clearing)} width={columns} height={Math.max(2, rows - 14 - taskLines)} onChange={() => { refreshQueue((old) => old + 1); void checkpoint("queue_change"); }} onSend={sendQueued} onEditingChange={setQueueEditing} />
      </Box>
      <Text wrap="truncate">模式：{session.mode} · 状态：{view.status} · 待发送补充：{session.queue.items.length}</Text>
      {/* [KEEP 来自 13.1] 存储反馈不是 run_finish，不改模型任务状态。 */}
      {/* [KEEP 来自 15.1] 预算独占一行，历史和队列视口相应减少一行。 */}
      <Text wrap="truncate">{view.budget || "本地预算：等待请求估算；不是服务商实际用量"}</Text>
      <Text wrap="truncate">保存：{saveMessage}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · Enter 排队补充，Ctrl+S 打断并发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !question && !editing && !session.clearing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 / 排队 · Ctrl+S 打断发送 · Ctrl+J 换行 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}

/**
 * 创建整次 TUI 会话，并在退出前等占用全部清理。
 * 输入是模型和启动模式；会话对象只创建一次，重绘或单轮取消不重建历史和授权。
 * 会话还保存清单与补充队列；它们不会随开始下一轮而重置。
 * Ctrl+C 忙碌时取消本轮，空闲时退出；外部编辑占用期间交给编辑器。
 * 退出先设置 closing 阻止新提交，再取消并等待任务和外部编辑，保存并关闭后才卸载。
 */
// [KEEP 来自 13.1] CLI 注入 writer；TUI 退出前保存和关闭，CLI finally 可幂等重复关闭。
export async function startTui(model: Model, initialMode: ExecutionMode = "execute", writer?: SessionWriter, initial?: SessionState, fileCheckpoints?: FileCheckpointStore): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  // [KEEP 来自 13.1] 会话 ID 已在 writer 创建时固定，任务和组件重绘都不会重建文件。
  // [KEEP 来自 13.3] 深拷贝可信快照，编号接着走；新一轮不能收取旧 run 的补充。
  const history = structuredClone([...(initial?.messages ?? [])]);
  const queue = initial ? { items: structuredClone([...initial.pendingInputs]), nextId: initial.nextInputId } : newInputQueue();
  const session: Session = { context: structuredClone(initial?.context ?? emptyCompaction()), mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, fileCommand: createFileCheckpointCommands(fileCheckpoints), saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
  let instance: ReturnType<typeof render> | undefined;
  // [KEEP 来自 13.1] 退出 Promise 只创建一次；保存和关闭都结束才恢复终端。
  let shutdown: Promise<void> | undefined;
  /**
   * 完成一次整会话退出，顺序等待任务、最终检查点与文件关闭。
   * 保存或关闭失败设退出码 1 并报告，仍卸载恢复终端；重复入口共享 shutdown。
   */
  const finishSession = (code: number): Promise<void> => {
    shutdown ??= (async () => {
      session.closing = true;
      session.controller?.abort();
      session.external?.controller.abort();
      await Promise.all([session.done, session.external?.done]);
      // [KEEP 来自 26.1] 所有自有作业清理后才卸载终端；普通run结束不执行这里。
      await model.jobs?.close();
      const feedback = await checkpointTui(session, "exit");
      let closeError: unknown;
      try { await writer?.close(); } catch (error) { closeError = error; }
      process.exitCode = (feedback && !feedback.ok) || closeError ? 1 : code;
      instance?.unmount();
      if (feedback) console.error(`${feedback.message}\n保存文件：${writer!.path}`);
      if (closeError) console.error(`会话文件关闭失败：${explainError(closeError)}`);
    })();
    return shutdown;
  };
  /**
   * 开始退出，封住新提交后等待当前任务与外部编辑结束。
   * 取消对应控制器，清理完成才设置退出码并卸载界面；重复退出直接返回。
   */
  const quit = (code: number) => {
    if (session.closing) return;
    // [KEEP 来自 13.1] finishSession 同步封住新提交，直到保存并关闭后才卸载。
    void finishSession(code);
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  /**
   * 让 Ctrl+C 根据当前占用选择取消本轮或退出。
   * 外部编辑占用时留给编辑器；有任务控制器时只取消它，空闲时以 130 退出。
   */
  const interrupt = () => { if (session.external) return; if (session.controller) session.controller.abort(); else quit(130); };
  /**
   * 将 SIGTERM 交给同一退出清理入口，保留退出码 143。
   */
  const terminate = () => quit(143);
  /**
   * 将 SIGHUP 交给同一退出清理入口，保留退出码 129。
   */
  const hangup = () => quit(129);
  /**
   * 输入结束时正常退出，仍等待现有占用清理。
   */
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
    // [KEEP 来自 13.1] 挂载失败或其他退出也执行同一保存与关闭顺序。
    await finishSession(process.exitCode === undefined ? 0 : Number(process.exitCode));
    // 无论正常退出还是挂载失败，只移除本次添加的监听，避免下次进入界面收到重复通知。
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    process.stdin.off("end", endInput);
  }
}
