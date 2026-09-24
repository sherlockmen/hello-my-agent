/**
 * 11.3 浏览历史与工具结果 | [KEEP 来自 10.4] agent/run-stream.ts
 *
 * 学习目标：用原生 Readable 暂存事件，让消费者按自己的读取进度接收记录。
 * 输入：模型、历史、问题、外部取消信号、审批函数与会话只读授权。
 * 输出：带 version、runId、sequence、event 的异步记录流；任务失败会在已入队记录之后抛出。
 * 状态：队列与序号属于一轮；历史由核心更新，停止消费不撤销已发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 首次拉取 -> 创建队列、runId 和合并信号 -> 启动 runAgent
 *   收到事件 -> run_finish？-- 是 -> 使用预留位置入队
 *                           +-- 否 -> 已发生送达错误？-- 是 -> 不再入队
 *                                                      +-- 否 -> 已有 128 条？-- 是 -> abort(UserFacingError)
 *                                                                           +-- 否 -> 加序号入队
 *   for await -> yield 下一条；runAgent 结束 -> queue.push(null)
 *   队列读完 -> 等 done -> 任务失败？-- 是 -> 抛出原因
 *                                  +-- 否 -> 结束迭代
 *   正常结束 / 消费者提前退出 -> finally -> 请求取消 -> 等 done 清理 -> 销毁队列
 *
 * MAX_BUFFERED_EVENTS 控制普通事件条数，run_finish 可占额外一个位置；这里没有限制单条事件字节数。
 * Readable 的 highWaterMark 不是这里的硬上限；本文件通过 readableLength 主动检查并停止过慢的任务。
 * 失败原因先保存，避免生产者 Promise 无人接收；消费者读到结束记录后仍会得到失败异常。
 * 运行观察：同一轮 runId 相同、sequence 递增；提前 break 要等待本轮清理后才完成退出。
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runAgent } from "./run.js";
import type { AgentEvent } from "./events.js";
import { UserFacingError } from "../errors.js";
import type { Message, Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";

// [KEEP 来自 09.2] 本文件以下实现沿用 09.2。
// 外壳描述交付记录；event 仍是原有 AgentEvent，不把模型调用编号或工具步骤号改成全局序号。
export type AgentRecord = { version: 1; runId: string; sequence: number; event: AgentEvent };
// ponytail: 128 条普通事件后取消，不暂停上游网络；这是条数上限，不是总字节内存上限。
// 若需持续支持慢消费者，再增加可等待的生产端，或合并允许合并的文字增量。
const MAX_BUFFERED_EVENTS = 128;

/**
 * 把同步产生的事件暂存起来，让界面用 for await 按顺序接收一次任务。
 *
 * - 输入：模型、会话历史、问题和外部取消信号；审批仍由单独的 requestApproval 处理。
 * - 启动时机：异步生成器首次被拉取时才创建本轮 runId、队列和内部取消信号，并启动 runAgent。
 * - 输出：每次 yield 一条 AgentRecord，version 固定为 1，runId 本轮不变，sequence 从 1 递增。
 * - 容量规则：最多暂存 128 条普通事件，另外给 run_finish 留 1 个位置；限制的是条数，不是总字节数。
 * - 失败方式：队列装满后用 UserFacingError 请求停止，后续普通事件不再入队；结束事件说明 error。
 * - 交付顺序：先送完已入队事件，再抛出任务失败原因；序号只统计入队记录，不是工具步骤号。
 * - 提前退出：消费者 break 或抛错会进入 finally，取消本轮并等待 done，确认模型或工具结束清理。
 * - 职责边界：提前退出的消费者未必能读到结束事件；已经发生的工具操作不会因停止消费而撤销。
 */
export async function* streamAgentRun(
  model: Model, history: Message[], input: string, signal: AbortSignal,
  requestApproval?: ApprovalHandler, sessionGrants: Set<string> = new Set(),
): AsyncGenerator<AgentRecord> {
  const controller = new AbortController();
  // 用户取消和队列自己的停止请求都要传给同一次核心执行。
  const combined = AbortSignal.any([signal, controller.signal]);
  const queue = new Readable({ objectMode: true, read() {} });
  const runId = randomUUID();
  let sequence = 0;
  let deliveryError: UserFacingError | undefined;
  let failed = false;
  let failure: unknown;
  const done = runAgent(model, history, input, combined, (event) => {
    if (queue.destroyed) return;
    if (event.type !== "run_finish") {
      if (deliveryError) return;
      if (queue.readableLength >= MAX_BUFFERED_EVENTS) {
        // 超限事件不入队，随后也不再积累普通事件；预留位置仍允许送出结束状态。
        deliveryError = new UserFacingError("事件接收速度跟不上执行速度，已停止本轮。已发生的操作不会撤销。");
        controller.abort(deliveryError);
        return;
      }
    }
    // 结束事件绕过普通事件容量检查，最多成为队列里的第 129 条记录。
    queue.push({ version: 1, runId, sequence: ++sequence, event } satisfies AgentRecord);
  }, requestApproval, sessionGrants).catch((error: unknown) => {
    // 立刻接住生产者错误，等消费者取完队列后再向它抛出。
    failed = true;
    failure = error;
  }).finally(() => { if (!queue.destroyed) queue.push(null); });
  try {
    for await (const record of queue) yield record as AgentRecord;
    await done;
    if (failed) throw failure;
  } finally {
    // break 也会执行 finally；先等真实任务结束，不能只把队列销毁后留下后台工具。
    controller.abort();
    await done;
    queue.destroy();
  }
}
