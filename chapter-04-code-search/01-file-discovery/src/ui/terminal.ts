/**
 * 04.1 控制文件搜索范围 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：持续读取终端输入，并让多轮对话共享同一份 history。
 * 输入：逐行用户文本、/reset、/exit、EOF 或 Ctrl+C。
 * 输出：普通文本交给 agentLoop()；执行期间显示教学追踪，最后显示回答。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   read line
 *      +-- EOF / /exit --> 关闭输入
 *      +-- /reset ------> 清空 history --> 读取下一行
 *      +-- 空行 --------> 读取下一行
 *      +-- 普通文本 ----> agentLoop --> 显示教学追踪 --> 显示回答或错误 --> 读取下一行
 *   Ctrl+C --> 取消请求 --> 关闭输入 --> exit 130
 *
 * 关键点：终端显示主循环报告的步骤，模型仍根据工具结果决定下一步。
 * 运行观察：模型收到/返回、工具执行/返回依次显示，最终回答仍使用 Agent 标签。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { formatTeachingTrace } from "./teaching-trace.js";

// ANSI 颜色只用于交互终端：用户标签为青色，Agent 标签为紫色。
// 输出被管道或文件接收时不加控制字符，便于日志和脚本读取。
/**
 * 只在交互终端给标签加颜色。
 *
 * text 是待显示文字，color 是 ANSI 颜色编号。输出到终端时返回带颜色的文字，
 * 输出到管道或文件时返回原文，避免颜色转义字符混进后续脚本处理的数据。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

/**
 * 把主循环报告的步骤显示出来，让终端能看见模型和工具的来回。
 *
 * 输入是 AgentEvent；先交给 formatTeachingTrace() 生成文字，再给模型、工具标签加颜色。
 * 这里只显示已经收到的事件，不从最终回答猜执行过程，也不决定下一个工具。
 */
// [NEW 04.1] 终端开始消费 Agent Loop 的结构化事件。
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.log(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.log(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.log(line);
  }
}

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 让连续输入共用一份历史，并在请求模型前处理本地命令。
 *
 * 输入来自终端；传入的 model 用于处理普通问题。history 放在循环外，因此后一次输入可以带上之前的问答。
 * /reset 清空历史，/exit、EOF 或 Ctrl+C 结束会话；这些本地命令不发给模型，也不写入磁盘。
 * 执行期间还会通过 printProgress 显示过程事件。
 * 单轮失败后显示提示并等待下一次输入；Ctrl+C 取消请求、关闭输入并设置退出码 130。
 * 最终无论怎样退出，都关闭输入并移除进程监听，避免残留的资源继续占用进程。
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
  console.log("Hello，My Agent！输入消息开始对话，输入 /reset 清空历史，输入 /exit 退出。");
  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.next();
      if (done) break; // EOF：输入结束，正常退出。
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      // [KEEP 来自第 02 章练习] 本地命令在调用 Agent 前处理，不会作为用户消息发送给模型。
      if (text === "/reset") {
        history.length = 0;
        console.log("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        // [CHANGED 04.1] 连续会话把同一个教学观察者交给 Agent Loop。
        const reply = await agentLoop(model, history, text, controller.signal, printProgress);
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

// [KEEP 来自 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
/**
 * 把最终回答、累计用量和输出截断提示显示到终端。
 *
 * reply 来自主循环；用量为 null 时显示“未知”，不拿文本长度估算 token。
 * 这里只显示结果，不修改历史，也不再次请求模型。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
