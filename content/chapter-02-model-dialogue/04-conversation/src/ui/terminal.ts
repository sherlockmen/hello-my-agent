/**
 * 02.4 连续输入与会话历史 | [NEW] ui/terminal.ts
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
 * 关键点：history 在 while 外创建，所以第二轮能带上第一轮问答。失败时显示提示并继续等待，成功时打印回答。
 * 交互终端中“你”为青色、“Agent”为紫色；管道和文件输出不包含 ANSI 控制字符。
 * 这个 while 等待不同的用户输入，不是 Agent 内部处理工具调用的循环。
 * 运行观察：连续提问时保留上下文；退出再启动后历史重新为空。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { UserFacingError } from "../config/load-config.js";
import type { Message, Model, Reply } from "../models/client.js";

// [NEW 02.4] 本文件以下实现均为本节新增。
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

// [NEW 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
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
        console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"} 本轮未加入历史，可重新输入。`);
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

// [NEW 02.4] 将显示集中在终端层，单次提问和连续对话都调用它。
/**
 * 把模型返回的文本显示给用户。
 *
 * 输入是统一的 Reply，输出加上 Agent 标签，颜色只在交互终端出现。
 * 单次提问与连续会话共用这里，因此显示方式一致。
 * 这个函数不修改历史，也不会再次请求模型。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
}
