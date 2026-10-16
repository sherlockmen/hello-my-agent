/**
 * 28.3 整合与清理 | [KEEP] ui/tui/queue-panel.tsx
 *
 * 学习目标：区分待交付补充与未保存编辑稿；本文件沿用队列查看、编辑和撤回职责。
 * 输入：会话队列、焦点、忙碌状态、尺寸以及刷新和发送回调。
 * 输出：队列列表或独立编辑器；只有空闲 Enter 才请求发送选中项。
 * 状态：选择和编辑都保存固定 ID，编辑稿与普通草稿分开；异步复制在卸载时取消。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   ↑↓ / j/k -> 选择 ID；e -> 复制条目文字到独立编辑稿；x -> 按 ID 撤回
 *   编辑 Enter -> 按原 ID 更新 -- 成功 -> 结束编辑，条目仍未生效
 *                              +-- 失效 / 文字无效 -> 留住编辑稿、显示原因
 *   Ctrl+B -> 复制编辑稿；Esc -> 取消本次编辑；Ctrl+Y 仍由草稿编辑器处理重做
 *   列表 Enter -> 忙碌？-- 是 -> 提示等待；否 -> onSend，父组件再次查 ID 后发送
 * 核心可能在编辑期间收取条目，所以保存必须重新查 ID，不能按数组位置写入邻项。
 * 运行观察：原条目消失后编辑文字仍在，可复制回普通草稿重新提交。
 */
// [KEEP 来自 12.5] 队列焦点占用原结果区；编辑文字与普通草稿分别保存。
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { DraftEditor, newDraft, type Draft } from "./editor.js";
import { findQueuedInput, updateQueuedInput, removeQueuedInput, type InputQueue, type QueueEntry } from "./input-queue.js";
import { screenText } from "./state.js";
import { copyText } from "./system-actions.js";

// [KEEP 来自 12.5] 本文件以下类型、函数和界面沿用队列管理实现。

/**
 * 让用户管理尚未被核心收取的补充。
 * 选择和编辑都保存固定 ID；编辑稿单独保存，核心移走原条目也不清除编辑文字。
 * e 开始编辑，x 撤回；列表 Enter 只在空闲时调用 onSend，父组件还会再次查 ID。
 * 编辑 Enter 保存，Ctrl+B 复制编辑稿，Esc 取消编辑；复制失败只显示原因，不改队列。
 */
export function QueuePanel({ queue, active, busy, width, height, onChange, onSend, onEditingChange }: {
  queue: InputQueue; active: boolean; busy: boolean; width: number; height: number;
  onChange: () => void; onSend: (entry: QueueEntry) => void; onEditingChange: (editing: boolean) => void;
}) {
  const [selected, setSelected] = useState<number>();
  // [KEEP 来自 12.5] 保存原条目 ID 和独立 Draft，队列重排不会改变编辑目标。
  const [editing, setEditing] = useState<{ id: number; draft: Draft }>();
  const [notice, setNotice] = useState("");
  const copying = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => copying.current?.abort(), []);
  const chosen = findQueuedInput(queue, selected ?? -1) ?? queue.items[0];
  useInput((input, key) => {
    if (editing) {
      if (key.escape) { setEditing(undefined); onEditingChange(false); setNotice(""); }
      // [KEEP 来自 12.5] 用 Ctrl+B 复制编辑稿，Ctrl+Y 继续留给编辑器重做。
      if (key.ctrl && input === "b") {
        copying.current?.abort(); const controller = new AbortController(); copying.current = controller;
        void copyText(editing.draft.text, controller.signal).then(() => { if (!controller.signal.aborted) setNotice("编辑文字已复制；Esc 返回后可粘贴到普通草稿。"); })
          .catch((error) => { if (!controller.signal.aborted) setNotice((error as Error).message); });
      }
      return;
    }
    if (key.upArrow || key.downArrow || input === "j" || input === "k") {
      const index = chosen ? queue.items.findIndex((entry) => entry.id === chosen.id) : 0;
      const next = Math.max(0, Math.min(queue.items.length - 1, index + (key.upArrow || input === "k" ? -1 : 1)));
      setSelected(queue.items[next]?.id); return;
    }
    if (!chosen) return;
    if (input === "e") { setEditing({ id: chosen.id, draft: newDraft(chosen.text) }); onEditingChange(true); setNotice(""); return; }
    // [KEEP 来自 12.5] 撤回按固定 ID 操作，只影响尚未被收取的原条目。
    if (input === "x") { removeQueuedInput(queue, chosen.id); onChange(); setNotice(`补充 #${chosen.id} 已撤回。`); return; }
    // [KEEP 来自 12.5] 列表 Enter 只在空闲时交给父组件发送，忙碌时不创建新轮。
    if (key.return) {
      if (busy) { setNotice("任务运行中；此处 Enter 只在空闲时发送选中项。"); return; }
      onSend(chosen);
    }
  }, { isActive: active });
  /**
   * 把编辑稿保存回同一个待发送条目。
   * 每次提交重新按 editing.id 查找；成功才清编辑状态，条目仍等待核心收取。
   * 原条目已失效或文字校验失败时只显示提示并保留编辑稿，不写入别的条目。
   */
  const save = (text: string) => {
    if (!editing) return;
    try {
      // [KEEP 来自 12.5] 保存时重查原 ID；失效就留住 editing，不清稿也不改邻项。
      if (!updateQueuedInput(queue, editing.id, text)) {
        setNotice("原条目已被核心收取；编辑文字仍保留，Ctrl+B 复制到普通草稿后重新发送。");
        return;
      }
      const id = editing.id;
      onChange(); setEditing(undefined); onEditingChange(false); setSelected(id); setNotice(`补充 #${id} 已保存，仍未生效。`);
    } catch (error) { setNotice((error as Error).message); }
  };
  const index = chosen ? queue.items.findIndex((entry) => entry.id === chosen.id) : 0;
  const start = Math.max(0, index - Math.max(0, height - 1));
  return <Box flexDirection="column" height={height + 2} overflow="hidden">
    <Text wrap="truncate">待发送队列 {active ? "[焦点]" : ""} · {queue.items.length} 条</Text>
    {editing ? <>
      <Text wrap="truncate">编辑 #{editing.id} · {findQueuedInput(queue, editing.id) ? "Enter 保存原条目" : "原条目已被收取，编辑文字仍保留"}</Text>
      <DraftEditor value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onSubmit={save} active={active} width={width} height={Math.max(1, height - 1)} />
      <Text wrap="truncate">{notice || "Esc 取消编辑 · Ctrl+B 复制编辑文字；普通草稿未改动。"}</Text>
    </> : <>
      <Box flexDirection="column" height={height} overflow="hidden">
        {queue.items.length ? queue.items.slice(start, start + height).map((entry) => <Text key={entry.id} wrap="truncate">{entry.id === chosen?.id ? ">" : " "} #{entry.id} [第{entry.run}轮] {screenText(entry.text).replace(/\n/g, " ")}</Text>) : <Text>没有待发送补充。</Text>}
      </Box>
      <Text wrap="truncate">{notice || "↑↓ / j/k 选择 · e 编辑 · x 撤回 · 空闲 Enter 发送选中项"}</Text>
    </>}
  </Box>;
}
