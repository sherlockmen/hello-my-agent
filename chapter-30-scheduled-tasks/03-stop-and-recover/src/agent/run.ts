/**
 * 30.3 停止与恢复 | [KEEP] agent/run.ts
 *
 * 学习目标：等待核心任务与本地 stop 收尾，再统一发出整轮结束事件；本层不再请求模型，也不负责保存会话文件。
 * 职责说明：历史由核心提交，会话文件由消费者保存；本文件只组织整轮调用、结束脚本与通知。
 * 输入：模型、历史、用户问题、取消信号、可选观察者、审批函数和会话只读授权。
 * 输出：run_start 与一次 run_finish 通知；成功返回 Reply，失败继续抛出原因。
 * 状态：核心仍负责成功或中断后的历史提交；外层通知不新增工具副作用，也不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] run_start -> 调用 agentLoop -> 成功？-- 是 -> 等 stop 或失败说明 -> run_finish/completed -> 返回 Reply
 *                                                   +-- 否 -> 选择取消原因或原错误
 *   信号已取消且原因不是 UserFacingError？-- 是 -> run_finish/cancelled -> 抛出原因
 *                                        +-- 否 -> run_finish/error -> 抛出原因
 *
 * 整轮可能包含多次模型请求；model_finish 只说明一次模型返回，run_finish 才说明整轮结束。
 * 事件发送复用 emitAgentEvent，观察者直接抛错不会成为任务失败；同步观察仍会占用当前线程。
 *
 * [KEEP 来自 12.1] RunOptions 随同一轮传入核心；本层不重新选择模式或处理工具业务。
 * 运行观察：模型最终回答先返回，stop 反馈随后补入本地回答；run_finish 在收尾之后发出，取消不启动新脚本。
 */
// [KEEP 来自 20.3] 结束钩子复用同一个有界进程执行器。
import { runHooks } from "../hooks/lifecycle.js";
import { agentLoop } from "./agent-loop.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import { explainError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import type { RunOptions } from "./run-options.js";

// [KEEP 来自 09.1] 本文件以下实现沿用 09.1。
/**
 * 为一次完整任务通知开始和结束，让消费者不用猜最后一次模型响应是否已经结束任务。
 *
 * - 输入：沿用核心所需的模型、历史、问题、取消信号，以及观察者、审批函数和会话只读授权。
 * - 输出：先发 run_start；核心返回后发 completed 结束事件，再原样返回 Reply。
 * - 失败方式：核心抛错时优先采用已取消信号的 reason，发结束事件后继续抛出同一原因。
 * - 状态区分：信号已取消且原因不是 UserFacingError 时记为 cancelled；其余失败记为 error。
 * - 职责边界：本函数不重新实现模型与工具循环；历史提交、审批和资源清理由原有核心及工具负责。
 * - 观察限制：观察者抛错会被事件函数捕获；同步回调仍占用当前线程，并不代表显示可以无限耗时。
 */
export async function runAgent(
  model: Model, history: Message[], input: string, signal: AbortSignal,
  observer?: AgentObserver, requestApproval?: ApprovalHandler,
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 新增可选运行选项，沿同一轮向核心传递。
  options: RunOptions = {},
): Promise<Reply> {
  // 先通知开始，即使传入的信号已经取消，外层仍能说明这次任务的结束状态。
  emitAgentEvent(observer, { type: "run_start" });
  try {
    let reply = await agentLoop(model, history, input, signal, observer, requestApproval, sessionGrants, options);
    // [KEEP 来自 20.3] 完成后只收尾一次，反馈明确来自本地，不再调用模型。
    if (options.mode !== "plan" && model.hooks?.hooks.stop?.length) {
      let feedback: string;
      try { feedback = (await runHooks(model.hooks, "stop", { outcome: "completed" }, signal)).messages.join("\n"); }
      catch (error) { signal.throwIfAborted(); feedback = `结束钩子失败：${explainError(error)}`; }
      if (feedback) {
        const content = `[本地结束钩子反馈；不是模型回答或权限]\n${feedback}`;
        history.push({ role: "assistant", content });
        reply = { ...reply, text: `${reply.text}\n\n${content}` };
      }
    }
    emitAgentEvent(observer, { type: "run_finish", outcome: "completed", reply });
    return reply;
  } catch (error) {
    // 内部停止也可能使用取消信号；UserFacingError 表示需要报告的失败，不能全算用户取消。
    // [KEEP 来自 20.3] 错误也可收尾；取消不再启动新脚本。收尾失败保持原错误。
    if (!signal.aborted && options.mode !== "plan" && model.hooks?.hooks.stop?.length) {
      try {
        const stop = await runHooks(model.hooks, "stop", { outcome: "error" }, signal);
        if (stop.messages.length) history.push({ role: "assistant", content: `[本地结束钩子反馈] ${stop.messages.join("\n")}` });
      } catch (stopError) {
        history.push({ role: "assistant", content: `[本地结束钩子失败] ${explainError(stopError)}` });
      }
    }
    const reason = signal.aborted ? signal.reason : error;
    const cancelled = signal.aborted && !(reason instanceof UserFacingError);
    emitAgentEvent(observer, { type: "run_finish", outcome: cancelled ? "cancelled" : "error",
      message: cancelled ? "本轮任务已取消。" : explainError(reason) });
    throw reason;
  }
}
