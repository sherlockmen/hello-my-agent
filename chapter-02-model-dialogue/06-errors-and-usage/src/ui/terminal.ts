/**
 * 02.6 说明错误与显示用量 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：持续读取终端输入，并让整个进程中的多轮对话共享同一个 history。
 * 输入：逐行用户文本、/exit、EOF 或 Ctrl+C。
 * 输出：普通文本交给 agentLoop()；本地退出信号直接关闭输入和请求。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
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
 * 交互终端中“你”为青色、“Agent”为紫色；管道和文件输出不包含 ANSI 控制字符。
 * 这个 while 等待不同的用户输入，不是 Agent 内部处理工具调用的循环。
 * 运行观察：连续提问时保留上下文；退出再启动后历史重新为空。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

// ANSI 颜色只用于交互终端：用户标签为青色，Agent 标签为紫色。
// 输出被管道或文件接收时不加控制字符，便于日志和脚本读取。
/**
 * 根据输出目标决定是否给终端标签添加 ANSI 颜色。
 *
 * - 输入：要显示的文字和 ANSI 颜色编号。
 * - 输出：交互终端得到带颜色的字符串；管道或文件得到原始纯文本。
 * - 关键原因：转义字符适合人眼终端，不应混入日志、重定向文件或测试结果。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续读取终端输入，并让每轮对话按顺序共享同一份进程内历史。
 *
 * - 输入：已经创建的统一 `Model`；用户文字来自标准输入。
 * - 输出：逐轮显示回答，遇到 `/exit`、EOF 或 Ctrl+C 时结束并返回 `Promise<void>`。
 * - 关键步骤：在循环外创建历史和取消控制器，每次等待 `agentLoop()` 完成后再读取下一轮。
 * - 失败方式：单轮失败会显示安全提示并保留已完成历史；Ctrl+C 会取消请求并设置退出码 130。
 * - 职责边界：历史只保存在当前进程，退出后不会写入磁盘。
 */
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
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
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
/**
 * 显示模型回答、本轮 token 用量和可能的截断提示。
 *
 * - 输入：包含文本、用量和截断状态的统一 `Reply`。
 * - 输出：先打印回答，再打印用量；未知值显示“未知”，截断时追加提示。
 * - 关键原因：只展示接口报告的数据，不根据文本长度估算 token 或费用。
 * - 职责边界：只负责显示，不修改历史，也不再次调用模型。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
