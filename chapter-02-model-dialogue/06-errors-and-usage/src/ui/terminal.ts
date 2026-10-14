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
// [CHANGED 02.6] 错误文字由共用函数解释，终端只负责显示。
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

// ANSI 颜色只用于交互终端：用户标签为青色，Agent 标签为紫色。
// 输出被管道或文件接收时不加控制字符，便于日志和脚本读取。
/**
 * 只在交互终端中给标签加上颜色。
 *
 * text 是要显示的标签，color 是 ANSI 颜色编号。
 * stdout 连接终端时返回带颜色的字符串；输出到文件或管道时返回原文，
 * 这样日志和后续程序读到的内容就不会混入颜色控制字符。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续接收用户输入，让每轮问答按顺序使用同一份历史。
 *
 * model 已由入口创建，用户文字从标准输入逐行取得。
 * 历史在循环外创建；每次等 agentLoop() 完成，再显示回答或错误、处理下一行。
 * 单轮失败保留已有成功历史，用户可以继续输入。
 * /exit 或 EOF 结束会话；Ctrl+C 还会取消当前请求，并设置退出码 130。
 * 历史只在本进程中保留，函数结束时清理输入和监听，不会把聊天写入磁盘。
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
        // [CHANGED 02.6] 保留本轮失败的处理方式，换成具体的排查提示。
        console.error(`错误：${explainError(error)} 本轮未加入历史，可重新输入。`);
        process.exitCode = 1;
      }
    }
  } finally {
    // 离开会话时都要关闭输入并移除监听，避免仍有资源让进程无法结束。
    controller.abort();
    input.close();
    process.off("SIGINT", stop);
  }
}

// [CHANGED 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
/**
 * 显示回答，并补上服务商报告的用量与输出上限提示。
 *
 * reply 来自模型模块，字段已经转换成统一名称。
 * 先显示文本，再显示输入和输出用量；缺失值写“未知”，合法的 0 保持为 0。
 * truncated 为真时提醒回答可能不完整，不根据文本长度猜测 token 或费用。
 * 单次提问和连续会话共用这里；历史已经由核心保存，本函数只负责显示。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
