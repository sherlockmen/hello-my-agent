/**
 * 22.3 来源台账与引用核验 | [KEEP] ui/terminal.ts
 *
 * 学习目标：消费同一任务事件，显示模型正文，并在结束后补打新增的本地反馈。
 * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
 * 输出：stdout 显示模型正文；stderr 显示过程、审批、输入提示、本地状态与用量。
 * 状态：文本消费者沿用 09.3 的输出位置；失败或取消等待清理，不撤销已经发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 19.2] 空闲 /skills -> 本地目录；/skill review -> 完整校验 -> loaded Map -> 下一请求system
 *                    失败/取消只显示诊断，旧集合保留；退出不持久化loaded
 *   事件流 -> showRun -> renderer -> 模型文字？-- 是 -> stdout
 *                                            +-- 否 -> [KEEP] 步骤说明写 stderr
 *   completed -> Reply -> 正文已显示？-- 否 -> stdout 补正文
 *                                    +-- 是 -> 只补最终Reply新增尾部（收尾/引用反馈）
 *                         -> [KEEP] 用量与截断提示写 stderr
 *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
 *                                                             +-- 否 -> deny
 *   [KEEP 来自 18.1] /memory -> 等本地命令完成 -> 显示回执；不新增user消息
 *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
 *   [KEEP 来自 13.1] 本轮 finally / reset / 有效 mode -> 白名单检查点 -> 等保存 -> stderr 反馈
 *   [KEEP 来自 13.1] 连续会话退出 -> 最后检查点；CLI 随后关闭 writer
 *
 * text 模式仍带终端标签，机器逐行解析使用另一个消费者 ui/jsonl.ts。
 * 两种输出模式使用相同的执行事件；本文件保持文本界面的交互审批，JSONL 不经过这里。
 * 颜色仍按 stdout.isTTY 决定；stdout 重定向时正文不含 ANSI 标签颜色。
 *
 * [KEEP 来自 12.1] /mode 是空闲本地命令；提交普通问题时把模式快照传入本轮。
 * [KEEP 来自 12.2] 清单在连续会话内复用，不因开始下一轮或切换模式重建。
 * [KEEP 来自 12.3] 澄清和审批共用 lines.read(signal)；/skip 或 EOF 表示没有回答。
 * 文本界面串行等待本轮结束；运行中的补充队列属于 TUI。
 * 运行观察：重定向 stdout 能保存模型文字，步骤、用量和本地提示留在 stderr。
 */

// [KEEP 来自 19.2] 本地读取等待完成，结果只写本地显示。
import { skillCommand } from "../skills/catalog.js";
import { screenText } from "./tui/state.js";
import { createInterface } from "node:readline";
// [KEEP 来自 08.3] 输入等待可以独立取消，不关闭整个终端。
import { createLineReader } from "./input.js";
// [KEEP 来自 09.1] 整轮通知由 runAgent 包装，Agent Loop 的决策逻辑沿用。
// [KEEP 来自 09.2] 终端通过异步迭代接收同一轮的结构化事件。
import { emptyCompaction } from "../context/compaction.js";
import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError, UserFacingError } from "../errors.js";
import { createFileCheckpointCommands } from "../sessions/file-checkpoints.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { formatTeachingTrace } from "./teaching-trace.js";
import type { RunOptions, QuestionHandler } from "../agent/run-options.js";
// [KEEP 来自 13.1] 存储只接收模型历史与本地会话白名单，不接收显示器或授权。
import { saveSessionCheckpoint, type SessionWriter, type CheckpointReason, type SessionState } from "../sessions/save-session.js";

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
 * - 避免重复：每次 model_start 重置是否显示过文字的记录，reply 对照最后一次决策已显示原文，只补最终结果新增的尾部。
 * - 职责边界：这里只保存显示状态，不提交历史；已显示的片段也不能证明本轮已经成功。
 */
// [KEEP 来自 20.3] 本轮保留最后一次模型已显示正文，最终回复只补本地收尾新增尾部。
export function createTurnRenderer() {
  let opened = false;
  let streamed = false;
  // [KEEP 来自 20.3] 最终Reply可追加本地收尾；保留已显示原文，只补尚未显示的尾部。
  let displayedText = "";
  const finish = () => {
    if (opened) process.stdout.write("\n");
    opened = false;
  };
  const observe = (event: AgentEvent) => {
    if (event.type === "text_delta") {
      if (!opened) process.stdout.write(`${colorLabel("Agent", 35)} > `);
      opened = true;
      streamed = true;
      displayedText += event.text;
      process.stdout.write(event.text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ""));
      return;
    }
    finish();
    if (event.type === "model_start") { streamed = false; displayedText = ""; }
    if (event.type === "model_finish" && !streamed && event.text) {
      console.log(`${colorLabel("Agent", 35)} > ${event.text}`);
      streamed = true;
      displayedText = event.text;
    }
    printProgress(event);
  };
  return { observe, finish, reply: (reply: Reply) => {
    finish();
    const remaining = streamed && reply.text.startsWith(displayedText)
      ? reply.text.slice(displayedText.length).replace(/^\n+/, "") : reply.text;
    printReply({ ...reply, text: remaining }, Boolean(remaining));
  } };
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
 * 让澄清和聊天、审批串行使用同一个行读取器。
 * 只有可交互终端且存在 lines 时返回 handler，否则返回 undefined。
 * handler 显示问题和选项，循环等待非空编号或文字；/skip 或 EOF 返回 null。
 * 每次读取使用本轮信号，取消向工具传播；答案只交回原问答等待，不进入下一轮普通聊天。
 */
// [KEEP 来自 09.3] 本地状态写入 stderr。
// [KEEP 来自 12.3] 审批、澄清与普通问题串行使用同一读取器。
export function createQuestionHandler(lines: ReturnType<typeof createLineReader> | undefined, interactive: boolean): QuestionHandler | undefined {
  if (!interactive || !lines) return undefined;
  return async (request, signal) => {
    signal.throwIfAborted();
    console.error(`澄清问题：${request.question}`);
    request.choices.forEach((choice, index) => console.error(`${index + 1}. ${choice}`));
    while (true) {
      process.stderr.write("回答（编号或文字；/skip 跳过）：");
      const { value, done } = await lines.read(signal);
      signal.throwIfAborted();
      if (done || value.trim() === "/skip") return null;
      const answer = value.trim();
      if (!answer) { console.error("回答不能为空，请重输或 /skip。"); continue; }
      const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      return request.choices[index] ?? answer;
    }
  };
}

/**
 * 显示本进程已经批准的只读访问范围。
 * 空集合显示没有范围，否则逐项打印到 stderr；只读显示不扩大或撤销授权。
 */
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
 * - 输入：已创建的 Model、运行选项和可选 writer；聊天、本地命令和 Ctrl+C 来自同一个终端。
 * - 输出：每轮显示回答或中断原因；/exit、EOF 或空闲时 Ctrl+C 结束会话。
 * - 关键步骤：每次普通问题创建 controller 和 renderer，history 与 sessionGrants 在整个会话内复用。
 * - 本轮执行：消费 streamAgentRun，由 showRun 逐条显示并从 completed 事件取得 Reply。
 * - 取消处理：Ctrl+C 取消 active、清空排队行与未提交草稿；等任务清理后才清空 active。
 * - 会话终止：SIGTERM / SIGHUP 取消本轮、保存最后状态，并保留对应退出码 143 / 129。
 * - 状态处理：核心保存本轮历史，/reset 只清空历史，不撤销授权或工具副作用。
 * - 职责边界：本地命令不进入模型，失败也不自动重试已经执行的工具。
 * - 输出位置：输入提示、readline 回显、本地命令和中断说明写入 stderr，模型文字仍由 renderer 写 stdout。
 */
// [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
// [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
// [KEEP 来自 13.1] writer 由 CLI 管理；可选参数方便离线调用，不改变模型接口。
export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
  // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
  const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
  let mode = options.mode ?? initial?.mode ?? "execute";
  // [KEEP 来自 12.2] 持续会话复用清单，下一轮与模式切换不重建。
  const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
  // [KEEP 来自 13.1] 文本会话没有补充队列，但保留统一状态结构和任务计数。
  let run = initial?.run ?? 0;
  const pendingInputs = structuredClone([...(initial?.pendingInputs ?? [])]);
  const nextInputId = initial?.nextInputId ?? 1;
  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs, run, nextInputId });
  /**
   * 在明确触发点保存当前文本会话，并单独报告存储结果。
   * 失败设 exitCode=1 并保留 history 与 tasks；下一轮必须先成功保存 run_start 才能请求模型。
   */
  const checkpoint = async (reason: CheckpointReason) => {
    const feedback = await saveSessionCheckpoint(writer, snapshot(), reason);
    if (feedback) { console.error(feedback.message); if (!feedback.ok) process.exitCode = 1; }
  };
  // [KEEP 来自 14.3] 本地恢复命令串行执行，确认前不改文件。
  const fileCommand = createFileCheckpointCommands(options.fileCheckpoints);
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  // [KEEP 来自 12.3] 交互问答复用同一行读取器，不能与聊天竞争输入。
  const askUser = options.askUser ?? createQuestionHandler(lines, terminal);
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
  // [KEEP 来自 13.1] 终止和挂断关闭整个会话，当前任务仍先完成取消清理与保存。
  /** 以指定退出码结束文本会话，取消本轮并关闭输入；循环 finally 负责最后保存。 */
  const exit = (code: number) => { exiting = true; active?.abort(); input.close(); process.exitCode = code; };
  /** 将 SIGTERM 交给正常会话清理入口。 */
  const terminate = () => exit(143);
  /** 将 SIGHUP 交给正常会话清理入口。 */
  const hangup = () => exit(129);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  console.error(`当前模式：${mode}；/mode plan|execute 切换模式。`);
  console.error("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stderr.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      // [KEEP 来自 19.2] 加载时 Ctrl+C 只取消本地读取，finally 后才接下一行。
      if (/^\/(skills|skill)(?:\s|$)/.test(text)) {
        active = new AbortController();
        try { console.error(screenText(model.skills ? (await skillCommand(text, model.skills, active.signal) ?? "") : "当前运行未连接技能目录。")); }
        catch (error) { console.error(active.signal.aborted ? "技能加载已取消，未接纳半份正文。" : screenText(explainError(error))); }
        finally { active = undefined; }
        continue;
      }
      // [KEEP 来自 18.1] 空闲本地管理不进入历史，也不触发模型。
      if (/^\/memory(?:\s|$)/.test(text)) {
        console.error(model.memory ? await model.memory.command(text, mode) : "当前运行未连接项目记忆。");
        continue;
      }
      // [KEEP 来自 14.3] 只在任务循环外处理文件恢复，不会与工具并发。
      if (/^\/(changes|restore)(?:\s|$)/.test(text)) {
        const result = await fileCommand(text); console.error(result.message);
        if (result.restored) { history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
        continue;
      }
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        Object.assign(context, emptyCompaction());
        console.error("已清空当前对话，下次提问将开始新的上下文。");
        // [KEEP 来自 13.1] reset 只清模型历史，保存后的清单与授权规则各自不变。
        await checkpoint("reset");
        continue;
      }
      // [KEEP 来自 12.1] 空闲本地切换模式，不把命令发送给模型。
      if (text === "/mode" || text.startsWith("/mode ")) {
        const requested = text.slice(6).trim();
        if (requested === "plan" || requested === "execute") mode = requested;
        console.error(`当前模式：${mode}${requested && requested !== "plan" && requested !== "execute" ? "；用法：/mode plan|execute" : ""}`);
        // [KEEP 来自 13.1] 查询和无效 mode 不写文件；有效本地模式操作才保存。
        if (requested === "plan" || requested === "execute") await checkpoint("mode");
        continue;
      }
      active = new AbortController();
      // [KEEP 来自 13.1] 新任务计数也属于会话检查点。
      run++;
      const renderer = createTurnRenderer();
      try {
        // [KEEP 来自 13.3] 开始标记落盘后才能调用模型；写入失败时不启动外部操作。
        await writer?.save(snapshot(), "run_start");
        active.signal.throwIfAborted();
        // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
        const reply = await showRun(streamAgentRun(model, history, text, active.signal,
          // [KEEP 来自 12.2] 每轮固定模式，并把共用清单传到核心。
          requestApproval, sessionGrants, { ...options, context, mode, tasks, askUser }), renderer);
        renderer.reply(reply);
        // [KEEP 来自 13.1] 整个会话退出已设置 SIGTERM/SIGHUP 退出码时，不由本轮覆写。
        if (!exiting) process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.error("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
          // [KEEP 来自 13.1] 会话正在退出时保留对应信号码，取消本轮不把它改成成功。
          if (!exiting) process.exitCode = 0;
        } else {
          console.error(`错误：${explainError(error)} 已保留本轮状态，可以继续输入；程序不会自动重试。`);
          // [KEEP 来自 13.1] 普通任务错误仍设 1，整会话终止则保留信号退出码。
          if (!exiting) process.exitCode = 1;
        }
      } finally {
        // [KEEP 来自 13.1] 流已清理并提交成功或中断历史；保存完成后才接收下一轮。
        await checkpoint("run_end");
        active = undefined;
      }
    }
  } finally {
    active?.abort();
    // [KEEP 来自 13.1] EOF、本地退出或终止都保存最后状态；CLI 在返回后 close。
    await checkpoint("exit");
    lines.dispose();
    input.off("SIGINT", stop);
    input.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
  }
}

/**
 * 处理一次 --prompt 提问，完成或中断后退出，不进入连续聊天。
 *
 * - 输入：已创建的模型、非空问题、运行选项和可选 writer；可交互时询问审批，其他情况默认拒绝 ask。
 * - 执行方式：消费 streamAgentRun，逐条显示事件，流结束后取得完整 Reply。
 * - 输出：生成期间显示文字和步骤，成功时补上用量，已经显示的正文不会重复打印。
 * - 取消处理：Ctrl+C / SIGINT、SIGTERM、SIGHUP 分别设退出码 130、143、129，等模型或工具清理后保存。
 * - 失败方式：非取消错误继续交给 CLI 说明；finally 结束显示行、关闭输入并移除本次监听。
 * - 存储边界：finally 保存已提交历史并显示结果；本节只保存，不读取旧会话或自动重试。
 * - 输出位置：审批与 readline 回显使用 stderr，正文保留在 stdout。
 */
// [KEEP 来自 08.3] 单次模式也使用可取消读取，并在退出时释放输入监听。
// [KEEP 来自 09.3] readline 的回显与审批提示使用 stderr。
// [KEEP 来自 13.1] 单次文本提问也有完整历史，writer 的关闭仍归 CLI。
export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
  // [KEEP 来自 13.3] 历史只成为新请求的上下文，旧工具不会从这里再次调度。
  const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
  const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
  const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
  const mode = options.mode ?? initial?.mode ?? "execute";
  const snapshot = (): SessionState => ({ messages: history, context, mode, tasks: tasks.items, pendingInputs: initial?.pendingInputs ?? [], run: (initial?.run ?? 0) + 1, nextInputId: initial?.nextInputId ?? 1 });
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
  // [KEEP 来自 13.1] 终止信号也等待流清理和最后检查点，避免直接退出丢掉取消历史。
  /** 取消单次任务并保留 SIGTERM 退出码，finally 随后保存。 */
  const terminate = () => { controller.abort(); input?.close(); process.exitCode = 143; };
  /** 取消单次任务并保留 SIGHUP 退出码，finally 随后保存。 */
  const hangup = () => { controller.abort(); input?.close(); process.exitCode = 129; };
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  // [KEEP 来自 08.1] 单次提问使用相同的增量显示器。
  const renderer = createTurnRenderer();
  try {
    const signal = controller.signal;
    await writer?.save(snapshot(), "run_start");
    signal.throwIfAborted();
    console.error(`当前模式：${mode}`);
    // [KEEP 来自 09.2] 单次提问复用同一个事件消费者。
    // [KEEP 来自 13.1] 保留真实 Message[]，不从 stdout 或 AgentRecord 重建上下文。
    const reply = await showRun(streamAgentRun(model, history, prompt, signal,
      // [KEEP 来自 12.3] 单次文本任务也可等待澄清；非交互环境没有问答入口。
      createApprovalHandler(lines, interactive), new Set<string>(), { ...options, context, mode, tasks, askUser: options.askUser ?? createQuestionHandler(lines, interactive) }), renderer);
    if (!controller.signal.aborted) renderer.reply(reply);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    renderer.finish();
    controller.abort();
    // [KEEP 来自 13.1] 单次任务收尾就是最后检查点；成功、失败和取消都保存已提交状态。
    const feedback = await saveSessionCheckpoint(writer, snapshot(), "run_end");
    if (feedback) { console.error(feedback.message); if (!feedback.ok) process.exitCode = 1; }
    process.off("SIGINT", stop);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
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
  // [KEEP 来自 15.1] 显示服务商报告的本轮累计；缺失仍写未知，不用本地估算填补。
  console.error(`服务商报告本轮累计：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.error("提示：回答达到输出上限，可能尚未完整。");
}
