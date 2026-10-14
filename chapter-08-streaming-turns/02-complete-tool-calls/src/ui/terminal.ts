/**
 * 08.2 收齐工具参数，再执行 | [KEEP 来自 08.1] ui/terminal.ts
 *
 * 学习目标：沿用每轮显示器，让文字片段和模型、工具步骤共用同一套终端显示。
 * 输入：聊天与审批输入，以及 Agent Loop 的文字和步骤事件。
 * 输出：收到片段就追加文字；完整回应已经显示过时，结束只补用量。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 普通输入 -> 创建本轮 renderer -> 等待 Agent Loop
 *   事件 -> 文字片段？-- 是 -> 追加正文
 *                    +-- 否 -> 补换行 -> 显示结构化步骤
 *   本轮完成 -> 正文显示过？-- 是 -> 只补用量 / 否 -> 正文与用量
 *   本轮失败 -> 补换行 -> 显示错误，不提交本轮历史
 *   Ctrl+C -> 取消请求并关闭输入 -> 退出；审批仍共用聊天的行迭代器
 *
 * [KEEP] 表示本文件沿用 08.1。Anthropic 现在也通过同样的 text_delta 事件显示文字，
 * 协议改动发生在 models/client.ts，终端不用判断服务商。
 * “已经看到文字”不等于正常完成；完成状态来自 Agent Loop 的 model_finish 事件。
 * 本节仍在 Ctrl+C 后退出，08.3 再调整输入和取消的生命周期。
 * 运行观察：两种协议都能逐段显示，截断或拒绝的响应随后仍会显示未完成提示。
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
 * 把结构化步骤排成简短终端记录。
 *
 * - 输入：核心在请求模型、检查权限、准备或执行工具时产生的 AgentEvent。
 * - 输出：teaching-trace 选取和整理展示字段，再给模型与工具标签添加终端颜色。
 * - 关键原因：进度来自程序已经发生的事件，不从模型最终回答猜测执行情况。
 * - 职责边界：本函数不决定是否执行工具；text_delta 由本轮显示器单独处理。
 */
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.log(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.log(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.log(line);
  }
}

/**
 * 创建本轮专用的显示器，让连续文字和步骤记录按顺序出现。
 *
 * - 输入：本轮 AgentEvent；输出是 observe、finish 和 reply 三个显示入口。
 * - 显示片段：第一次 text_delta 写出 Agent 标签，后续片段直接追加；切到步骤或错误提示前补换行。
 * - 完整响应：某次模型决策没有发出片段时，model_finish 仍可显示完整文字。
 * - 避免重复：每次 model_start 重置是否显示过文字的记录，reply 根据最后一次决策决定是否再打印正文。
 * - 职责边界：这里只保存显示状态，不提交历史；已显示的片段也不能证明本轮已经成功。
 */
// [KEEP 来自 08.1] 每轮创建独立显示状态，结束时不会再重复打印已显示的回答。
export function createTurnRenderer() {
  let opened = false;
  let streamed = false;
  const finish = () => {
    if (opened) process.stdout.write("\n");
    opened = false;
  };
  const observe = (event: AgentEvent) => {
    if (event.type === "text_delta") {
      if (!opened) process.stdout.write(`${colorLabel("Agent", 35)} > `);
      opened = true;
      streamed = true;
      process.stdout.write(event.text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ""));
      return;
    }
    finish();
    if (event.type === "model_start") streamed = false;
    if (event.type === "model_finish" && !streamed && event.text) {
      console.log(`${colorLabel("Agent", 35)} > ${event.text}`);
      streamed = true;
    }
    printProgress(event);
  };
  return { observe, finish, reply: (reply: Reply) => { finish(); printReply(reply, !streamed); } };
}

/**
 * 让审批和聊天共用同一个输入来源，读取用户对本次请求的决定。
 *
 * - 传入行迭代器和是否可交互，返回一个供 Agent Loop 等待的审批函数。
 * - 有 preview 就先打印完整操作；读取可选 y / s / n，写入和命令只接受 y / n。
 * - 若两个地方各自读取 stdin，同一行可能被另一方取走，所以这里复用聊天的迭代器。
 * - 非交互运行或 EOF 返回拒绝；Ctrl+C 由外层取消并关闭 readline，解除输入等待。
 *
 * 这里不执行工具，收集到的决定交给主循环处理。
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
    // [KEEP 来自 06.1] 审批界面展示工具准备的完整操作，不用模型的承诺代替预览。
    // [KEEP 来自 07.1] 同一处审批既展示文件 diff，也展示命令和 cwd。
    if (request.preview) console.log(`操作预览：\n${request.preview}`);
    process.stdout.write(request.allowSession
      ? "请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝："
      : "请选择：[y] 执行这次操作，[N] 拒绝：");
    // AbortSignal 不会自动结束 lines.next()；startTerminal 的 Ctrl+C 处理会同时关闭 readline。
    const { value, done } = await lines.next();
    signal.throwIfAborted();
    const choice = done ? "" : value.trim().toLowerCase();
    if (choice === "y") return { decision: "allow_once" };
    if (choice === "s" && request.allowSession) return { decision: "allow_session" };
    return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
  };
}

/**
 * 显示当前进程已经批准的会话范围。
 *
 * - 输入：Agent Loop 与终端共享的 sessionGrants Set。
 * - 输出：没有记录时给出明确提示；否则逐项显示本地策略生成的批准记录。
 * - 职责边界：只读取并显示状态，不新增、扩大或删除任何权限。
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
 * - 输入：一行用户文字和当前进程共享的 sessionGrants。
 * - 输出：识别并处理 `/permissions` 时返回 `true`；普通文字返回 `false`。
 * - 关键原因：调用方根据布尔值 `continue`，本地命令不会进入模型消息。
 * - 职责边界：这里只查看批准范围，不修改授权集合；/reset 清历史也不会撤销它。
 */
// [KEEP 来自 05.3] 本地命令只查看会话授权，不进入模型消息。
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
// [KEEP 来自 08.1] 本轮的进度、回答和错误共用同一显示器。
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const controller = new AbortController();
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  // 提前建立异步迭代器，输入会按行排队；管道一次输入多行时也不会丢掉后面的行。
  const lines = input[Symbol.asyncIterator]();
  const requestApproval = createApprovalHandler(lines, terminal);
  // [KEEP 来自 05.3] 批准记录与 history 分开保存，但都持续到当前终端进程结束。
  const sessionGrants = new Set<string>();
  const stop = () => {
    controller.abort();
    input.close();
    process.exitCode = 130;
  };
  // Ctrl+C 和 SIGINT 在本节仍停止请求并退出；08.3 再让终端在取消后继续读取。
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
      // [KEEP 来自 08.1] 本轮所有显示共用同一个渲染器。
      const renderer = createTurnRenderer();
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        const reply = await agentLoop(
          model,
          history,
          text,
          controller.signal,
          renderer.observe,
          requestApproval,
          sessionGrants,
        );
        if (controller.signal.aborted) break;
        renderer.reply(reply);
        process.exitCode = 0;
      } catch (error) {
        renderer.finish();
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
 * 运行一次 --prompt 提问，并在需要时等待这次操作的批准。
 *
 * - 输入：已创建的模型和已校验的问题；交互终端可读取审批，非交互运行默认拒绝审批。
 * - 输出：生成期间显示文字和步骤，成功后补上用量；这个入口始终只处理一次提问。
 * - 取消：Ctrl+C 或 SIGINT 发出取消信号并设置退出码 130，外层等待模型或工具完成清理。
 * - 清理：finally 收好显示行、关闭输入并移除本次监听；取消不会重新请求模型。
 * - 职责边界：一次提问结束后不进入聊天循环，也不撤销已经发生的文件或命令副作用。
 */
// [KEEP 来自 08.1] 单次提问也使用本轮显示器，结束时只补尚未显示的部分。
export async function runSinglePrompt(model: Model, prompt: string): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    : undefined;
  const lines = input?.[Symbol.asyncIterator]();
  // [KEEP 来自 07.2] 单次模式也传播 Ctrl+C，先取消子进程再关闭输入。
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    input?.close();
    process.exitCode = 130;
  };
  input?.on("SIGINT", stop);
  process.on("SIGINT", stop);
  // [KEEP 来自 08.1] 单次提问使用相同的增量显示器。
  const renderer = createTurnRenderer();
  try {
    const signal = controller.signal;
    const reply = await agentLoop(
      model,
      [],
      prompt,
      signal,
      renderer.observe,
      createApprovalHandler(lines, interactive),
      new Set<string>(),
    );
    if (!controller.signal.aborted) renderer.reply(reply);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    renderer.finish();
    controller.abort();
    process.off("SIGINT", stop);
    input?.off("SIGINT", stop);
    input?.close();
  }
}

// [KEEP 来自 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
/**
 * 在本轮完成后显示尚未输出的回答，并补上用量信息。
 *
 * - 输入：统一 Reply，以及是否需要输出正文的 showText；默认显示正文。
 * - 输出：showText 为 false 时只打印用量与可选截断提示，避免重复已经逐段显示的回答。
 * - 关键原因：用量沿用接口报告值，未知值显示“未知”，不根据文本长度估算 token 或费用。
 * - 职责边界：只负责显示，不修改历史，也不再次调用模型。
 */
// [KEEP 来自 08.1] 文字已经逐段显示时，只补用量，不重复整段回答。
export function printReply(reply: Reply, showText = true): void {
  if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
