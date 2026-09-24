/**
 * 08.3 中断当前任务，继续对话 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：运行中取消这一轮，等资源清理结束后，让同一终端继续接收下一次输入。
 * 输入：聊天与审批输入、结构化事件，以及 Ctrl+C / SIGINT。
 * 输出：文字、步骤和本轮结束状态；history 与只读授权在当前会话内保留。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [CHANGED] 读取一行 -> EOF / /exit？-- 是 -> 清理输入 -> 结束
 *                                     +-- 否 -> 本地命令？-- 是 -> 处理 -> 继续读取
 *                                                         +-- 否 -> 创建新 controller
 *   新 controller -> renderer 与 agentLoop -> 成功 / 失败 / 取消
 *                 -> 等待本轮结束 -> active 清空 -> 继续读取
 *   Ctrl+C -> 有 active？-- 是 -> abort 本轮，清空排队输入 -> 等本轮清理
 *                        +-- 否 -> 关闭输入 -> exit 130
 *   审批 -> 可交互？-- 否 -> 拒绝
 *                   +-- 是 -> 显示预览 -> read(signal)
 *                          -> 一行 / EOF -> 交回决定
 *                          -> 取消 -> 移除当前等待者，向 Agent Loop 抛出取消
 *
 * [CHANGED] 表示本节调整。controller 属于单轮，终端、history 和只读授权属于会话。
 * 取消是请求协作停止；要等模型或工具结束清理，程序才会接受下一轮执行。
 * 旧审批的读取会被解除，所以新输入不会交给已取消的审批；排队行和终端内未提交的草稿都会清空。
 * /reset 只清空历史，不回滚文件，也不撤销只读授权；--prompt 仍是单次模式，取消后退出。
 * 运行观察：等待模型、命令或审批时按 Ctrl+C，完成清理后再次出现输入提示。
 */

import { createInterface } from "node:readline";
// [CHANGED 08.3] 输入等待可以独立取消，不关闭整个终端。
import { createLineReader } from "./input.js";
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
 * 让审批和聊天共用同一个可取消的行读取器。
 *
 * - 输入：createLineReader 的返回对象与是否可交互；输出是供 Agent Loop 等待的审批函数。
 * - 关键步骤：先显示完整操作预览，再读取 y / s / n；文件写入和命令只接受本次批准。
 * - 取消处理：read(signal) 会移除本次等待者并拒绝 Promise，旧审批不会继续占用下一轮输入。
 * - 失败方式：非交互运行与 EOF 返回拒绝；取消原因向 Agent Loop 传播，不伪装成用户批准。
 * - 职责边界：这里只收集决定，不执行工具，也不自行保存会话授权。
 */
// [CHANGED 08.3] 行读取器接收本轮信号，取消审批无需关闭整个终端。
export function createApprovalHandler(
  lines: ReturnType<typeof createLineReader> | undefined,
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
    // [CHANGED 08.3] 取消会移除审批等待者，下一轮聊天不会再被它读取。
    const { value, done } = await lines.read(signal);
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
 * 持续读取聊天输入，并把一次任务的取消与整个会话的退出分开。
 *
 * - 输入：已创建的 Model；用户文字、本地命令和 Ctrl+C 来自同一个终端。
 * - 输出：每轮显示回答或中断原因，结束清理后继续读取；/exit、EOF 或空闲时 Ctrl+C 退出。
 * - 关键步骤：普通提问各自创建 AbortController，本轮尚未结束时只保留这个 active。
 * - 取消处理：运行中 Ctrl+C 取消 active，丢弃排队行和未提交草稿；等 agentLoop 清理后才清空 active。
 * - 状态处理：历史由 Agent Loop 保存，失败与取消轮次也保留本地状态；/reset 才主动清空历史。
 * - 职责边界：继续对话不等于撤销旧操作；这里也不自动重试刚才的模型请求或工具。
 */
// [CHANGED 08.3] controller 属于当前回合，终端与历史属于整个会话。
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  const sessionGrants = new Set<string>();
  let active: AbortController | undefined;
  let exiting = false;
  const stop = () => {
    if (active) {
      active.abort();
      lines.clear();
      // [NEW 08.3] 丢弃未按回车的审批草稿，避免 y 残留成下一轮的 ynext。
      if (terminal) {
        input.write(null, { ctrl: true, name: "u" });
        input.write(null, { ctrl: true, name: "k" });
        process.stdout.write("\n");
      }
      return;
    }
    exiting = true;
    input.close();
    process.exitCode = 130;
  };
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.log("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        console.log("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      active = new AbortController();
      const renderer = createTurnRenderer();
      try {
        const reply = await agentLoop(model, history, text, active.signal,
          renderer.observe, requestApproval, sessionGrants);
        renderer.reply(reply);
        process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.log("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
          process.exitCode = 0;
        } else {
          console.error(`错误：${explainError(error)} 已保留本轮状态，可以继续输入；程序不会自动重试。`);
          process.exitCode = 1;
        }
      } finally {
        // 必须先等请求或工具完成清理，再允许下一轮使用新信号。
        active = undefined;
      }
    }
  } finally {
    active?.abort();
    lines.dispose();
    input.off("SIGINT", stop);
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
// [CHANGED 08.3] 单次模式也使用可取消读取，并在退出时释放输入监听。
export async function runSinglePrompt(model: Model, prompt: string): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    : undefined;
  // [CHANGED 08.3] 单次模式的审批也复用可取消读取。
  const lines = input ? createLineReader(input) : undefined;
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
    lines?.dispose();
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
