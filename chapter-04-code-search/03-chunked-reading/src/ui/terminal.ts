/**
 * 04.3 把代码位置变成上下文 | [KEEP 来自 04.1] ui/terminal.ts
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
 * 关键点：终端只格式化核心报告的结构化摘要，不参与 Agent 的模型或工具决策。
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
 * 根据输出目标决定是否给终端标签添加 ANSI 颜色。
 *
 * - 输入：要显示的文字和 ANSI 颜色编号。
 * - 输出：交互终端得到带颜色的字符串；管道或文件得到原始纯文本。
 * - 关键原因：转义字符适合人眼终端，不应混入日志、重定向文件或测试结果。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

/**
 * 把 Agent Loop 的结构化步骤转换成简短终端记录。
 *
 * - 输入：核心在请求模型、开始工具或结束工具时发出的结构化 AgentEvent。
 * - 输出：先由 teaching-trace.ts 生成安全文本，再给模型与工具标签添加颜色。
 * - 关键原因：终端只渲染事件，不解析 Agent 最终回答，也不参与任何执行决策。
 */
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.log(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.log(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.log(line);
  }
}

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续读取终端输入，并让每轮对话按顺序共享同一份可重置历史。
 *
 * - 输入：已经创建的统一 `Model`；用户文字和本地命令来自标准输入。
 * - 输出：逐轮显示模型与工具进度和最终回答；`/reset` 清空历史，`/exit`、EOF 或 Ctrl+C 结束会话。
 * - 关键步骤：在调用 Agent 前识别本地命令，普通文字才进入 `agentLoop()`。
 * - 失败方式：单轮失败会显示安全提示且不提交失败轮次；Ctrl+C 会取消请求并设置退出码 130。
 * - 职责边界：`/reset` 和 `/exit` 不会发送给模型，历史也不会写入磁盘。
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
