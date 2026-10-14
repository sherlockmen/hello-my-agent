/**
 * 05.3 让 Agent 记住本次运行的批准 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：在当前运行中保存批准记录，让后续读取能够复用。
 * 输入：聊天文字、y/s/n、/permissions、/reset、/exit、EOF 和 Ctrl+C。
 * 输出：聊天交给 agentLoop，审批返回用户选择，/permissions 显示记录。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   read line
 *      +-- EOF / /exit --> 关闭输入
 *      +-- /reset ------> 只清空 history --> 读取下一行
 *      +-- /permissions -> 显示 sessionGrants --> 读取下一行
 *      +-- 空行 --------> 读取下一行
 *      +-- 普通文本 ----> agentLoop --> ask? -- 是 --> 读取 y / s / n
 *                                      |  否             |
 *                                      +<-- once / session / deny
 *                                      v
 *                                显示回答或错误 --> 读取下一行
 *   Ctrl+C --> 取消请求 --> 关闭输入 --> exit 130
 *
 * 关键点：history 和 sessionGrants 都在循环外；/reset 只清空 history，不会修改已批准记录。
 * 运行观察：选择 s 后 /permissions 显示范围，同范围不再询问，进程重启后范围消失。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
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

// [CHANGED 05.3] 审批输入新增 s，表示把当前批准记录保存到进程结束。
/**
 * 创建一个等待当前审批回答的函数。
 *
 * - 接收与聊天共用的行迭代器，以及是否为交互终端。
 * - 显示请求与原因后读取一行，y 允许一次，s 允许本次会话，其他输入拒绝。
 * - 非交互运行或 EOF 返回拒绝。连续会话中的 Ctrl+C 会由外层关闭 readline，解除等待。
 *
 * 这里只取得选择，不执行工具，也不把聊天输入另开一个读取者。
 */
export function createApprovalHandler(
  lines: AsyncIterator<string> | undefined,
  interactive: boolean,
): ApprovalHandler {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!interactive || !lines) {
      return { decision: "deny", reason: "非交互运行不能请求批准" };
    }
    console.log(`审批请求：${request.call.name} 将访问 ${request.resource}`);
    console.log(`原因：${request.reason}`);
    process.stdout.write("请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝：");
    // AbortSignal 不会自动结束 lines.next()；startTerminal 的 Ctrl+C 处理会同时关闭 readline。
    const { value, done } = await lines.next();
    signal.throwIfAborted();
    const choice = done ? "" : value.trim().toLowerCase();
    if (choice === "y") return { decision: "allow_once" };
    if (choice === "s") return { decision: "allow_session" };
    return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
  };
}

/**
 * 显示本次运行已经保存的批准记录。
 *
 * 读取终端与 Agent Loop 共用的 Set；为空时显示提示，否则逐项打印。
 * 这里只查看，不新增或删除记录。
 */
function printSessionGrants(sessionGrants: ReadonlySet<string>): void {
  if (sessionGrants.size === 0) {
    console.log("本次会话没有已批准的权限范围。");
    return;
  }
  console.log("本次会话已批准：");
  for (const scope of sessionGrants) console.log(`- ${scope}`);
}

/**
 * 处理只属于本地终端的权限命令。
 *
 * - 接收一行用户文字和当前运行共用的 sessionGrants。
 * - /permissions 显示记录后返回 true，其他文字返回 false。
 * - 终端据此 continue，已处理的命令不会再进入模型消息。
 *
 * 本节只支持查看；章末练习再增加主动清空。
 */
// [NEW 05.3] 本地命令只查看会话授权，不进入模型消息。
export function handlePermissionCommand(
  text: string,
  sessionGrants: ReadonlySet<string>,
): boolean {
  if (text !== "/permissions") return false;
  printSessionGrants(sessionGrants);
  return true;
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
  const requestApproval = createApprovalHandler(lines, terminal);
  // [NEW 05.3] 批准记录与 history 分开保存，但都持续到当前终端进程结束。
  const sessionGrants = new Set<string>();
  const stop = () => {
    controller.abort();
    input.close();
    process.exitCode = 130;
  };
  // 终端内的 Ctrl+C 和进程收到的 SIGINT 都停止请求并退出；本章还没有“取消后续聊”。
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.log("Hello，My Agent！输入消息开始对话，输入 /permissions 查看会话权限，输入 /reset 清空历史，输入 /exit 退出。");
  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.next();
      if (done) break; // EOF：输入结束，正常退出。
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (handlePermissionCommand(text, sessionGrants)) continue;
      // [KEEP 来自第 02 章练习] 本地命令在调用 Agent 前处理，不会作为用户消息发送给模型。
      if (text === "/reset") {
        history.length = 0;
        console.log("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        const reply = await agentLoop(
          model,
          history,
          text,
          controller.signal,
          printProgress,
          requestApproval,
          sessionGrants,
        );
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

/**
 * 执行一次 --prompt 提问，并为可能出现的审批准备输入。
 *
 * - 接收模型和非空问题；交互终端中创建 readline，并把审批函数传给 Agent Loop。
 * - 没有交互终端时，审批函数会拒绝需要确认的请求，普通 allow 工具仍能运行。
 * - 显示回答后结束；无论成功还是抛错，finally 都会关闭本函数创建的输入。
 */
export async function runSinglePrompt(model: Model, prompt: string): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    : undefined;
  const lines = input?.[Symbol.asyncIterator]();
  try {
    const signal = new AbortController().signal;
    const reply = await agentLoop(
      model,
      [],
      prompt,
      signal,
      printProgress,
      createApprovalHandler(lines, interactive),
      new Set<string>(),
    );
    printReply(reply);
  } finally {
    input?.close();
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
