/**
 * 09.3 让脚本读懂执行过程 | [NEW] ui/jsonl.ts
 *
 * 学习目标：把一次任务的事件输出约定固定下来，让脚本逐行读取 JSON。
 * 输入：已创建的模型和 --prompt；SIGINT 与 stdout 错误也会通知本轮停止。
 * 输出：stdout 每行一条 AgentRecord；取消说明与 CLI 错误使用 stderr。
 * 状态：本次使用空历史；ask 默认拒绝。失败或取消等待核心清理，但不回滚已发生的操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [NEW] 注册 SIGINT / stdout error -> streamAgentRun（ask 返回 deny）
 *   下一条记录 -> stdout 已出错？-- 是 -> 抛错并结束消费
 *                               +-- 否 -> JSON.stringify + 换行 -> write
 *   write -> 回调成功 -> 读取下一条；流读完 -> 清理监听 -> 返回
 *         +-> 回调失败 / stdout error -> 停止消费 -> 等生成器清理 -> 向 CLI 抛错
 *   SIGINT -> 尚未取消？-- 否 -> 保留原停止原因
 *                       +-- 是 -> abort -> 拒绝当前写入等待 -> 停止消费
 *   用户取消后 -> 等模型与工具清理 -> stderr 说明、exitCode=130 -> 清理监听
 *            -> 写入回调仍未结束？-- 是 -> process.exit(130)
 *                                 +-- 否 -> 正常返回
 *
 * JSONL 指每一行都是独立 JSON；字符串中的换行会编码成转义，不会拆成多条记录。
 * 写入回调完成后才消费下一条，避免在本消费者里无限积累待写行；慢输出仍可能让事件队列超限。
 * 下游保持管道打开却不读取时，write 回调可能一直不结束。取消会解除 Promise 等待，
 * 但系统写请求仍可能让 Node 进程无法退出，所以先等 Agent 清理，再在这个窄分支主动退出。
 * 主动退出可能留下半行或缺少 run_finish；脚本读取 JSONL 时必须同时检查进程退出状态。
 * JSON 编码不是脱敏，记录可能包含完整问题、工具参数、模型与工具正文，不应直接当作公开日志。
 * 运行观察：--output jsonl --prompt 的 stdout 可逐行 JSON.parse，审批输入不会阻塞脚本。
 */
import { streamAgentRun } from "../agent/run-stream.js";
import { UserFacingError } from "../errors.js";
import type { Model } from "../models/client.js";

// [NEW 09.3] 本文件以下实现均为本节新增。
/**
 * 运行一次提问，把每条执行记录写成独立的一行 JSON，供另一个程序读取。
 *
 * - 输入：已创建的模型和已校验的 prompt；本次使用空历史，不进入连续聊天。
 * - 输出：stdout 每行一个完整 AgentRecord，不加终端标签、颜色或教学摘要。
 * - 写入顺序：等待当前 write 回调结束再取下一条；回调完成只表示交给输出流，不代表下游已经处理。
 * - 审批规则：遇到 ask 直接返回 deny；不创建输入读取器，也不从管道文字推断用户批准。
 * - 取消处理：首次 SIGINT 取消同一轮，也拒绝正在等待的写入 Promise；结束消费时先等生成器清理模型与工具。
 * - 失败方式：stdout 出错会请求取消，退出消费时等待核心清理，再将可显示的错误交给 CLI。
 * - 退出方式：用户取消后设退出码 130 并清理监听；写入回调仍未完成时才主动 process.exit(130)。
 * - 取舍原因：拒绝 Promise 没有取消系统写请求，单设 exitCode 仍可能等管道；主动退出则可能丢掉半行或结束记录。
 * - 数据边界：JSON.stringify 只编码数据；原始问题、工具参数和正文仍可能包含敏感信息。
 * - 职责边界：消费端要结合退出状态判断结果是否完整；已经发生的工具副作用不会撤销。
 */
export async function runJsonlPrompt(model: Model, prompt: string): Promise<void> {
  const controller = new AbortController();
  let outputError: Error | undefined;
  let interrupted = false;
  // 只在 write 回调结束时清空；取消 Promise 等待，并不代表系统写入已经结束。
  let writing = false;
  // 只接受首次停止原因；如果输出故障已经触发取消，随后按 Ctrl+C 不把它改记为用户取消。
  const stop = () => {
    if (controller.signal.aborted) return;
    interrupted = true;
    controller.abort();
  };
  // 以可显示错误取消，让核心历史与 run_finish 都记录 error，而不是用户取消。
  const onOutputError = (error: Error) => { outputError = error; controller.abort(new UserFacingError("标准输出已关闭或写入失败。")); };
  process.on("SIGINT", stop);
  process.stdout.on("error", onOutputError);
  try {
    const records = streamAgentRun(model, [], prompt, controller.signal,
      async () => ({ decision: "deny", reason: "JSONL 模式不交互审批，本次操作未获批准" }));
    for await (const record of records) {
      if (outputError) throw outputError;
      // 等 write 回调后才继续拉取；这确认本行已交给输出流，并不确认下游已经处理。
      await new Promise<void>((resolve, reject) => {
        // 管道保持打开却没人读取时，write 回调可能不返回；abort 让消费者能先结束等待。
        const stopWriting = () => {
          reject(controller.signal.reason);
        };
        controller.signal.addEventListener("abort", stopWriting, { once: true });
        writing = true;
        process.stdout.write(`${JSON.stringify(record)}\n`, (error) => {
          // 只有真实回调才说明这次写入结束；正常完成时也要移除单次取消监听。
          writing = false;
          controller.signal.removeEventListener("abort", stopWriting);
          if (error) reject(error); else resolve();
        });
        // 信号可能在监听建立前已经取消，补查一次，避免留下无法解除的写入等待。
        if (controller.signal.aborted) stopWriting();
      });
    }
  } catch (error) {
    // 首次原因为用户取消时保持 130，不让随后出现的输出错误覆盖它。
    if (interrupted) {
      process.exitCode = 130;
      console.error("本次任务已取消。");
    } else {
      if (outputError) throw new UserFacingError("标准输出已关闭或写入失败，任务已停止。已执行的操作不会自动撤销。");
      throw error;
    }
  } finally {
    // for await 退出已等待生成器清理真实任务，再移除这个消费者的进程与输出监听。
    controller.abort();
    process.off("SIGINT", stop);
    process.stdout.off("error", onOutputError);
  }
  // Agent 已清理完，但未完成的系统写请求仍可能阻止 Node 退出，单设 exitCode 无法解除它。
  // 仅在用户取消且写入仍未完成时主动退出；这会放弃剩余输出，可能留下半行或缺少结束记录。
  if (interrupted && writing) process.exit(130);
}
