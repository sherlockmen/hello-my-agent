/**
 * 20.1 执行前钩子与显式启用 | [KEEP] ui/tui/input-queue.ts
 *
 * 学习目标：保存尚未交付的补充及其 ID；本文件沿用按固定 ID 管理队列的职责。
 * 输入：补充文字、所属 run、会话队列与要编辑或撤回的 ID。
 * 输出：入队条目带 ID；收取返回当前轮文字，编辑返回是否找到原条目，撤回返回移出的条目。
 * 状态：最多 20 项，每项原文最多 32000 个 UTF-16 单元；校验失败不提交修改。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   enqueue -> 文字有效且未满？-- 否 -> 抛错；是 -> 分配递增 ID、追加末尾
 *   take(run) -> 按原顺序选当前轮 -> 从队列移出 -> 返回 ID、文字；其他轮保留
 *   update / remove(id) -> 原 ID 仍存在？-- 否 -> false / undefined，队列不变
 *                                       +-- 是 -> 校验后更新，或移出这一项
 * 收取与模型请求由核心控制；入队不等于生效，旧轮剩余项不会自动进入新轮。
 * 运行观察：连续补充按原顺序收取，已移出的条目不再出现在待发送队列。
 */
// [KEEP 来自 12.4] 队列由会话持有；run 限定补充只能交给所属轮。
// [KEEP 来自 12.4] ID 在会话内递增，run 记录补充所属任务，文字只在未收取时保存在这里。
export type QueueEntry = { id: number; text: string; run: number };
export type InputQueue = { items: QueueEntry[]; nextId: number };
export const MAX_QUEUE_ITEMS = 20;
export const MAX_QUEUE_TEXT = 32_000;

/**
 * 为这次会话创建空的补充队列。
 * 条目按入队顺序保存，ID 从 1 开始递增；新一轮不重新创建这份队列。
 */
export function newInputQueue(): InputQueue { return { items: [], nextId: 1 }; }
/**
 * 检查一份补充或队列编辑稿，返回去掉首尾空白后的文字。
 * 空白和原文超过 32000 个 UTF-16 单元时抛错；长度检查使用原文，队列尚未改变。
 */
export function validateQueuedText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error("补充内容不能为空。");
  if (text.length > MAX_QUEUE_TEXT) throw new Error(`补充内容最多 ${MAX_QUEUE_TEXT} 个 UTF-16 单元。`);
  return value;
}
/**
 * 把有效补充追加到所属轮的队列末尾。
 * 先检查文字和最多 20 项的容量，再分配递增 ID；run 由当前任务入口提供。
 * 返回新条目，入队只表示等待核心收取；失败不占用 ID，也不清调用方草稿。
 */
export function enqueueInput(queue: InputQueue, text: string, run: number): QueueEntry {
  const value = validateQueuedText(text);
  if (queue.items.length >= MAX_QUEUE_ITEMS) throw new Error(`最多保留 ${MAX_QUEUE_ITEMS} 条待发送补充，请先处理队列。`);
  const entry = { id: queue.nextId++, text: value, run };
  queue.items.push(entry);
  return entry;
}
/**
 * 检查指定轮是否仍有未收取的补充。
 * 只返回布尔值，不移出条目；用于最终回答之后决定是否还有一次继续决策的机会。
 */
export function hasPendingInputs(queue: InputQueue, run: number): boolean {
  return queue.items.some((entry) => entry.run === run);
}
/**
 * 一次取走当前轮的全部补充，保持它们原来的入队顺序。
 * 输入是会话队列和绑定的 run；先选出这一轮，再保留其他轮的条目。
 * 返回 ID 与文字；空数组表示本轮没有补充。核心把它们加入请求上下文后才发收取事件。
 * 旧轮条目仍保留，调用方不能换成新轮编号去自动收取。
 */
export function takePendingInputs(queue: InputQueue, run: number): { id: number; text: string }[] {
  // [KEEP 来自 12.4] 过滤保留原数组顺序，当前轮按 FIFO 收取，其他轮仍留存。
  const selected = queue.items.filter((entry) => entry.run === run);
  queue.items = queue.items.filter((entry) => entry.run !== run);
  return selected.map(({ id, text }) => ({ id, text }));
}

// [KEEP 来自 12.5] 新增按固定 ID 查找待发送条目。
/**
 * 按固定 ID 查找尚未被收取的条目。
 * 找到时返回原条目，失效 ID 返回 undefined；查找不移动或修改队列。
 */
export function findQueuedInput(queue: InputQueue, id: number): QueueEntry | undefined {
  return queue.items.find((entry) => entry.id === id);
}
// [KEEP 来自 12.5] 新增按固定 ID 校验并修改原条目。
/**
 * 只修改仍在队列中的原条目，避免覆盖邻项。
 * 先重新查固定 ID；已被收取就返回 false，调用方据此保留编辑稿。
 * 找到后先校验新文字再赋值，成功返回 true；无效文字抛错，原文保持不变。
 */
export function updateQueuedInput(queue: InputQueue, id: number, text: string): boolean {
  const entry = findQueuedInput(queue, id);
  // [KEEP 来自 12.5] 原 ID 已失效就告知界面保留编辑稿，不改队列。
  if (!entry) return false;
  entry.text = validateQueuedText(text);
  return true;
}
// [KEEP 来自 12.5] 新增按固定 ID 撤回待发送条目。
/**
 * 只移出固定 ID 对应的待发送补充。
 * 找到时返回移出的条目；ID 已失效返回 undefined，不能撤回已加入请求上下文的内容。
 */
export function removeQueuedInput(queue: InputQueue, id: number): QueueEntry | undefined {
  const index = queue.items.findIndex((entry) => entry.id === id);
  // [KEEP 来自 12.5] 已被收取的内容不能撤回，返回未找到。
  if (index < 0) return undefined;
  return queue.items.splice(index, 1)[0];
}
