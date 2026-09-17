/**
 * 02.6 说明错误与显示用量 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：持续读取终端输入，并让整个进程中的多轮对话共享同一个 history。
 * 输入：逐行用户文本、/exit、EOF 或 Ctrl+C。
 * 输出：普通文本交给 agentLoop()；本地退出信号直接关闭输入和请求。
 *
 * 执行流程：
 *   +-----------+
 *   | read line |
 *   +-----+-----+
 *         +-- EOF / /exit --> 关闭输入 --> 结束
 *         +-- 空行 ----------> 读取下一行
 *         +-- 普通文本 ------> +-----------+
 *                             | agentLoop |
 *                             +-----+-----+
 *                                   | 成功 --> 显示回答 --> 读取下一行
 *                                   | 失败 --> 显示错误 --> 读取下一行
 *   Ctrl+C --> 取消请求 --> 关闭输入 --> exit 130
 *
 * 关键点：history 在 while 外创建，所以第二轮能带上第一轮问答。成功时显示 token 用量与截断提示；失败时通过 explainError() 给出分类建议。
 * 这个 while 等待不同的用户输入，不是 Agent 内部处理工具调用的循环。
 * 运行观察：连续提问时保留上下文；退出再启动后历史重新为空。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/** 等待输入 -> 调用 agentLoop -> 显示回答；会话内的各轮请求顺序执行。 */
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const controller = new AbortController();
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  // 提前建立异步迭代器，输入会按行排队；管道一次输入多行时也不会丢掉后面的行。
  const lines = input[Symbol.asyncIterator]();
  const stop = () => {
    controller.abort();
    input.close();
    process.exitCode = 130;
  };
  // 终端内的 Ctrl+C 和进程收到的 SIGINT 都停止请求并退出；本章还没有“取消后续聊”。
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.log("Hello，My Agent！输入消息开始对话，输入 /exit 退出。");
  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write("你 > ");
      const { value, done } = await lines.next();
      if (done) break; // EOF：输入结束，正常退出。
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        const reply = await agentLoop(model, history, text, controller.signal);
        if (controller.signal.aborted) break;
        printReply(reply);
        process.exitCode = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`错误：${explainError(error)} 本轮未加入历史，可重新输入。`);
        process.exitCode = 1;
      }
    }
  } finally {
    // 正常退出和异常退出都关闭输入、移除监听，避免终端或请求一直占用进程。
    controller.abort();
    input.close();
    process.off("SIGINT", stop);
  }
}

// [CHANGED 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
export function printReply(reply: Reply): void {
  console.log(`Agent > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
