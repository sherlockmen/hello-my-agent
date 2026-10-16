/**
 * 24.1 附件引用 | [KEEP] ui/tui/questions.tsx
 *
 * 学习目标：区分已提交问答结果与面板状态；本文件沿用独占收集一次澄清答案的职责。
 * 输入：本次问题、选项、取消信号，以及面板尺寸和键盘输入。
 * 输出：waitForAnswer 的 Promise 返回答案或 null；问答结束就关闭面板。
 * 状态：每次请求有独立 key 和 settled 标记；取消后旧回调不能回答新问题。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   waitForAnswer -> 已取消？-- 是 -> 抛错；否 -> 显示新面板、监听 abort
 *   编号 / 自由文字 -> trim 后非空？-- 否 -> 提示重输；是 -> resolve 答案、关闭面板
 *   Esc -> resolve null；abort / 显示失败 -> reject；结束后旧 respond 返回 false
 *   QuestionPanel -> 问题换行分页 -> 独立 DraftEditor -> submit -> 原 respond
 * 先将等待标为结束，再移除监听和清面板，防止重复提交或旧答案落进下一次请求。
 * 运行观察：普通草稿仍保留；翻页不提交，Esc 表示本次未回答。
 */
// [KEEP 来自 12.3] 澄清独占自己的 Promise；旧面板回调不能回答新请求。
import { randomUUID } from "node:crypto";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import wrapAnsi from "wrap-ansi";
import type { UserQuestion } from "../../agent/run-options.js";
import { DraftEditor, newDraft } from "./editor.js";
import { screenText } from "./state.js";
import { useColor } from "./layout.js";

/**
 * 问答面板与正在等待的工具之间的一次性连接。
 * key 辨认当前请求；respond 返回是否接受答案，旧请求结束后只能返回 false。
 */
export type PendingQuestion = { key: string; request: UserQuestion; respond: (answer: string | null) => boolean };

/**
 * 把一次问答面板连接到核心正在等待的 Promise。
 * 先检查取消，再显示带独立 key 的请求；回答返回文字，Esc 返回 null。
 * 结束时只处理一次：标记 settled、移除监听、关闭面板，然后 resolve 或 reject。
 * 旧 respond 遇到已结束、已取消或空回答就返回 false；显示失败和取消向工具等待传播。
 */
export function waitForAnswer(request: UserQuestion, signal: AbortSignal,
  show: (pending: PendingQuestion | undefined) => void): Promise<string | null> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // [KEEP 来自 12.3] 每次等待独立保存结束标记，答案和取消只完成一次。
    let settled = false;
    /**
     * 收束这一次问答等待，避免答案和取消各自完成一次。
     * 先锁住 settled 并移除取消监听，再清面板；清面板失败时拒绝 Promise。
     * 有效答案 resolve，取消或显示错误 reject；后来的回调不再修改状态。
     */
    const finish = (outcome: { answer: string | null } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      try { show(undefined); } catch (error) { reject(error); return; }
      if ("answer" in outcome) resolve(outcome.answer); else reject(outcome.error);
    };
    /**
     * 把本轮信号的取消原因交给同一次问答等待。
     * 复用 finish 的单次结束保护，取消不会伪装成用户没有回答。
     */
    const abort = () => finish({ error: signal.reason });
    signal.addEventListener("abort", abort, { once: true });
    const pending: PendingQuestion = { key: randomUUID(), request,
    /**
     * 只接受这次尚未结束的问答答案。
     * 已结束、已取消或空回答返回 false；成功交给 finish 并返回 true。
     */
    respond(answer) {
      // [KEEP 来自 12.3] 旧回调失效或已取消时拒绝答案，不让它进入下一次问答。
      if (settled || signal.aborted || (answer !== null && !answer.trim())) return false;
      finish({ answer: answer === null ? null : answer.trim() });
      return true;
    } };
    try { show(pending); } catch (error) { finish({ error }); }
    if (signal.aborted) abort();
  });
}

/**
 * 显示并收集当前澄清问题，普通草稿由父组件继续保存。
 * 长问题按列宽换行分页；窗口不足 40 列、16 行时暂停普通面板输入。
 * 编号可以选择选项，也能输入自由文字；Enter 提交，Esc 表示本次未回答。
 * 面板只调用当前 pending.respond，不写模型历史，也不作出工具批准。
 */
export function QuestionPanel({ pending, columns, rows }: { pending: PendingQuestion; columns: number; rows: number }) {
  // [KEEP 来自 12.3] 问答使用独立草稿，不覆盖普通任务草稿。
  const [draft, setDraft] = useState(newDraft());
  const [page, setPage] = useState(0);
  const [hint, setHint] = useState("");
  const tooSmall = columns < 40 || rows < 16;
  const content = [pending.request.question, ...pending.request.choices.map((choice, index) => `${index + 1}. ${choice}`)].join("\n");
  const lines = wrapAnsi(screenText(content), Math.max(10, columns - 4), { hard: true, trim: false }).split("\n");
  const size = Math.max(1, rows - 11);
  const pages = Math.max(1, Math.ceil(lines.length / size));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage((old) => Math.min(old, pages - 1)), [pages]);
  useInput((input, key) => {
    if (key.escape) pending.respond(null);
    if (key.pageDown) setPage((old) => Math.min(pages - 1, old + 1));
    if (key.pageUp) setPage((old) => Math.max(0, old - 1));
  }, { isActive: !tooSmall });
  /**
   * 把问答草稿转换成选项内容或自由回答。
   * 空白只提示重输；有效编号取对应选项，其他文字去掉首尾空白后作为回答交回本次 respond。
   * 旧请求已结束时显示提示，不能把这份答案交给下一次问题。
   */
  const submit = (value: string) => {
    const answer = value.trim();
    if (!answer) { setHint("请输入回答，或按 Esc 跳过这次澄清。"); return; }
    const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    if (!pending.respond(pending.request.choices[index] ?? answer)) setHint("这次澄清已结束。");
  };
  return <Box borderStyle="round" borderColor={useColor ? "yellow" : undefined} paddingX={1} flexDirection="column">
    <Text wrap="truncate">等待澄清 · 第 {currentPage + 1}/{pages} 页</Text>
    <Text>{lines.slice(currentPage * size, (currentPage + 1) * size).join("\n")}</Text>
    <Text wrap="truncate">可输入选项编号，或直接写自己的回答。</Text>
    <Text wrap="truncate">PgUp/PgDn 查看问题 · Enter 回答 · Esc 未回答</Text>
    <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={!tooSmall} width={columns - 4} height={3} />
    <Text wrap="truncate">{hint || "回答只交回当前 ask_user；原普通草稿仍保留。"}</Text>
  </Box>;
}
