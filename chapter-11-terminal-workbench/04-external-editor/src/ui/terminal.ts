/**
 * 11.4 把草稿交给外部编辑器 | [KEEP 来自 10.4] ui/terminal.ts
 *
 * 学习目标：让 text 模式把模型文字与本地过程信息送到不同输出通道。
 * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT。
 * 输出：stdout 显示模型正文；stderr 显示过程、审批、输入提示、本地状态与用量。
 * 状态：文本消费者沿用 09.3 的输出位置；失败或取消等待清理，不撤销已经发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件流 -> showRun -> renderer -> 模型文字？-- 是 -> stdout
 *                                            +-- 否 -> [KEEP] 步骤说明写 stderr
 *   completed -> Reply -> 正文已显示？-- 否 -> stdout 补正文
 *                                    +-- 是 -> 不重复正文
 *                         -> [KEEP] 用量与截断提示写 stderr
 *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
 *                                                             +-- 否 -> deny
 *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
 *
 * text 模式仍带终端标签，机器逐行解析使用另一个消费者 ui/jsonl.ts。
 * 两种输出模式使用相同的执行事件；本文件保持文本界面的交互审批，JSONL 不经过这里。
 * 颜色仍按 stdout.isTTY 决定；stdout 重定向时正文不含 ANSI 标签颜色。
 * 运行观察：重定向 stdout 能保存模型文字，步骤、用量和本地提示留在 stderr。
 */

import { createInterface } from "node:readline";
// [KEEP 来自 08.3] 输入等待可以独立取消，不关闭整个终端。
import { createLineReader } from "./input.js";
// [KEEP 来自 09.1] 整轮通知由 runAgent 包装，Agent Loop 的决策逻辑沿用。
// [KEEP 来自 09.2] 终端通过异步迭代接收同一轮的结构化事件。
import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError, UserFacingError } from "../errors.js";
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
 * 把模型、权限和工具步骤写到 stderr，让 stdout 保留模型文字。
 *
 * - 输入：执行过程中的 AgentEvent；teaching-trace 负责选择字段和整理短说明。
 * - 输出：每条过程说明写入 stderr，模型与工具标签沿用终端配色。
 * - 关键原因：脚本重定向 stdout 时，不会把步骤说明混入模型正文。
 * - 职责边界：本函数只显示过程，连续文字仍由 renderer 写 stdout，也不在这里批准工具。
 */
// [KEEP 来自 09.3] 过程记录写入 stderr，stdout 留给模型文字。
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.error(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.error(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.error(line);
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

// [KEEP 来自 09.2] 显示与执行分开推进，结果仍由同一条事件流给出。
/**
 * 顺序显示一轮记录，并从正常结束事件中取回完整回答。
 *
 * - 输入：streamAgentRun 返回的异步记录和本轮 renderer；记录外壳在这里拆出 event。
 * - 输出：每条事件交给 renderer.observe，读完整条流后返回 completed 事件中的 Reply。
 * - 关键原因：text_delta 只表示一段文字，只有 run_finish/completed 才能提供本轮成功结果。
 * - 失败方式：事件流抛错时继续向外传播；流正常结束却没有完整回答时抛出 UserFacingError。
 * - 提前退出：显示抛错会结束异步迭代，生成器随后取消任务并等待清理；这里不提交会话历史。
 */
async function showRun(records: AsyncIterable<AgentRecord>, renderer: ReturnType<typeof createTurnRenderer>): Promise<Reply> {
  let reply: Reply | undefined;
  for await (const { event } of records) {
    renderer.observe(event);
    if (event.type === "run_finish" && event.outcome === "completed") reply = event.reply;
  }
  if (!reply) throw new UserFacingError("任务没有返回完整结果。");
  return reply;
}

/**
 * 让审批和聊天共用同一个可取消的行读取器。
 *
 * - 输入：createLineReader 的返回对象与是否可交互；输出是供 Agent Loop 等待的审批函数。
 * - 关键步骤：先向 stderr 显示完整操作预览，再读取 y / s / n；文件写入和命令只接受本次批准。
 * - 取消处理：read(signal) 会移除本次等待者并拒绝 Promise，旧审批不会继续占用下一轮输入。
 * - 失败方式：非交互运行与 EOF 返回拒绝；取消原因向 Agent Loop 传播，不伪装成用户批准。
 * - 职责边界：这里只收集决定，不执行工具，也不自行保存会话授权。
 */
// [KEEP 来自 08.3] 行读取器接收本轮信号，取消审批无需关闭整个终端。
// [KEEP 来自 09.3] 审批提示写入 stderr，不混入模型正文。
export function createApprovalHandler(
  lines: ReturnType<typeof createLineReader> | undefined,
  interactive: boolean,
): ApprovalHandler {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!interactive || !lines) {
      return { decision: "deny", reason: "非交互运行不能请求批准" };
    }
    console.error(`审批请求：${request.call.name} 将访问 ${request.resource}`);
    console.error(`原因：${request.reason}`);
    // [KEEP 来自 06.1] 审批界面展示工具准备的完整操作，不用模型的承诺代替预览。
    // [KEEP 来自 07.1] 同一处审批既展示文件 diff，也展示命令和 cwd。
    if (request.preview) console.error(`操作预览：\n${request.preview}`);
    process.stderr.write(request.allowSession
      ? "请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝："
      : "请选择：[y] 执行这次操作，[N] 拒绝：");
    // [KEEP 来自 08.3] 取消会移除审批等待者，下一轮聊天不会再被它读取。
    const { value, done } = await lines.read(signal);
    signal.throwIfAborted();
    const choice = done ? "" : value.trim().toLowerCase();
    if (choice === "y") return { decision: "allow_once" };
    if (choice === "s" && request.allowSession) return { decision: "allow_session" };
    return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
  };
}

/**
 * 在 stderr 显示当前进程已经批准的只读范围。
 *
 * - 输入：Agent Loop 与终端共享的 sessionGrants Set。
 * - 输出：空集合显示“没有已批准范围”，否则逐项显示本地策略生成的记录。
 * - 职责边界：只读取并显示，不新增、扩大或撤销任何权限，也不把记录写入 stdout。
 */
// [KEEP 来自 09.3] 本地状态写入 stderr。
function printSessionGrants(sessionGrants: ReadonlySet<string>): void {
  if (sessionGrants.size === 0) {
    console.error("本次会话没有已批准的权限范围。");
    return;
  }
  console.error("本次会话已批准：");
  for (const scope of sessionGrants) console.error(`- ${scope}`);
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
 * 持续读取聊天输入，在本轮结束清理后再接收下一次任务。
 *
 * - 输入：已创建的 Model；聊天、本地命令和 Ctrl+C 来自同一个终端。
 * - 输出：每轮显示回答或中断原因；/exit、EOF 或空闲时 Ctrl+C 结束会话。
 * - 关键步骤：每次普通问题创建 controller 和 renderer，history 与 sessionGrants 在整个会话内复用。
 * - 本轮执行：消费 streamAgentRun，由 showRun 逐条显示并从 completed 事件取得 Reply。
 * - 取消处理：Ctrl+C 取消 active、清空排队行与未提交草稿；等任务清理后才清空 active。
 * - 状态处理：核心保存本轮历史，/reset 只清空历史，不撤销授权或工具副作用。
 * - 职责边界：本地命令不进入模型，失败也不自动重试已经执行的工具。
 * - 输出位置：输入提示、readline 回显、本地命令和中断说明写入 stderr，模型文字仍由 renderer 写 stdout。
 */
// [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
// [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  const sessionGrants = new Set<string>();
  let active: AbortController | undefined;
  let exiting = false;
  const stop = () => {
    if (active) {
      active.abort();
      lines.clear();
      // [KEEP 来自 08.3] 丢弃未按回车的审批草稿，避免 y 残留成下一轮的 ynext。
      if (terminal) {
        input.write(null, { ctrl: true, name: "u" });
        input.write(null, { ctrl: true, name: "k" });
        process.stderr.write("\n");
      }
      return;
    }
    exiting = true;
    input.close();
    process.exitCode = 130;
  };
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.error("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stderr.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        console.error("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      active = new AbortController();
      const renderer = createTurnRenderer();
      try {
        // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
        const reply = await showRun(streamAgentRun(model, history, text, active.signal,
          requestApproval, sessionGrants), renderer);
        renderer.reply(reply);
        process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.error("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
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
 * 处理一次 --prompt 提问，完成或中断后退出，不进入连续聊天。
 *
 * - 输入：已创建的模型与非空问题；输入输出都可交互时才能询问审批，其他情况默认拒绝 ask。
 * - 执行方式：消费 streamAgentRun，逐条显示事件，流结束后取得完整 Reply。
 * - 输出：生成期间显示文字和步骤，成功时补上用量，已经显示的正文不会重复打印。
 * - 取消处理：Ctrl+C 或 SIGINT 取消同一轮并设退出码 130，等待模型或工具完成清理后退出。
 * - 失败方式：非取消错误继续交给 CLI 说明；finally 结束显示行、关闭输入并移除本次监听。
 * - 职责边界：不保存跨进程历史，不自动重试，也不撤销已经发生的文件或命令操作。
 * - 输出位置：审批与 readline 回显使用 stderr，正文保留在 stdout。
 */
// [KEEP 来自 08.3] 单次模式也使用可取消读取，并在退出时释放输入监听。
// [KEEP 来自 09.3] readline 的回显与审批提示使用 stderr。
export async function runSinglePrompt(model: Model, prompt: string): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    : undefined;
  // [KEEP 来自 08.3] 单次模式的审批也复用可取消读取。
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
    // [KEEP 来自 09.2] 单次提问复用同一个事件消费者。
    const reply = await showRun(streamAgentRun(model, [], prompt, signal,
      createApprovalHandler(lines, interactive), new Set<string>()), renderer);
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
 * 补上尚未显示的模型正文，并把用量信息写到 stderr。
 *
 * - 输入：统一 Reply 与 showText；false 表示正文已逐段显示，不必再次打印。
 * - 输出：需要补出的正文写 stdout，用量与截断提示写 stderr。
 * - 关键原因：用量来自模型接口报告，未知值仍显示“未知”，不由文本长度推算 token 或费用。
 * - 职责边界：只显示结果，不提交历史，也不再次请求模型。
 */
// [KEEP 来自 08.1] 文字已经逐段显示时，只补用量，不重复整段回答。
// [KEEP 来自 09.3] 正文写入 stdout，用量与提示写入 stderr。
export function printReply(reply: Reply, showText = true): void {
  if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.error(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.error("提示：回答达到输出上限，可能尚未完整。");
}
