/**
 * 30.2 到期与真实执行 | [KEEP] tools/registry.ts
 *
 * 学习目标：分别准备网页 URL 或搜索查询的完整预览，复制本次参数；批准后才执行对应的网络请求。
 * 输入：模型给出的工具名称、JSON 参数与取消信号。
 * 输出：本地直接工具返回实际结果；需审批的文件修改、命令与外部工具返回 preview/execute，批准后才执行。
 * 状态：分发失败向外抛错；执行入口调用过的工具可能已有副作用，注册表不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   网页调用 -> 校验 URL 或查询、复制参数 -> 返回本次网络预览和 execute；此时不发请求
 *   prepareTool -> MCP工具？-- 是 -> 复制参数、生成完整来源预览 -> 返回 execute，尚未调用服务
 *                 +-- 否 -> 写入或命令？-- 是 -> 对应准备函数 -> 返回预览，或抛错
 *                             +-- 否 -> 返回 null
 *   executeTool -> MCP名称？-- 是 -> 按当前连接映射调用 -> 带来源结果或错误
 *                 +-- 否 -> read_tool_result？-- 是 -> 传入本轮日志目录 -> 按编号读取 -> 结果或错误
 *                           +-- 否 -> 已有直接工具？-- 是 -> 对应执行函数 -> 结果或错误
 *                           +-- 否 -> 拒绝直接写入、命令或未知工具
 *   executePreparedTool -> 保存的 execute -> 结果或错误
 *
 * 注册表只寻找实现，不产生批准；permissions/policy.ts 决定是否需要询问用户。
 * 核心先完成权限与审批才调用执行入口；准备预览不会调用服务或执行文件修改。
 * 观察：准备预览不会发出 GET；用户批准本次 URL 或查询后，保存的 execute 才调用网页模块。
 */

// [KEEP 来自 07.1] 命令和文件修改复用同一条准备、审批通道。
// [KEEP 来自 18.2] 模型候选复用现有预览、审批、执行通道。
// [KEEP 来自 19.3] 专用只读技能工具不执行正文中的命令。
// [KEEP 来自 21.1] 动态映射属于本次进程，不从模型文字创建。
// [KEEP 来自 22.1] 网页GET也先固定参数和本次审批预览。
// [KEEP 来自 26.1] 后台作业沿用统一准备/审批通道，只读观察只访问会话登记表。
// [KEEP 来自 28.1] 自有工作区修改仍走同一prepare/approval入口。
// [KEEP 来自 29.1] 共享工具只使用本地RunOptions绑定。
import { sharedTaskDefinitions, sharedTaskTool } from "./shared-task-tools.js";
import { worktreeDefinitions, worktreeMutations, readWorktree, prepareWorktree } from "./worktree-tools.js";
import { prepareJob, readJob, startJobDefinition, readJobDefinition, stopJobDefinition } from "./job-tools.js";
import { delegateTaskDefinition, delegateTaskTool } from "./delegate-task.js";
import { callWeb, parseWebCall } from "../web/client.js";
import { callMcp } from "../mcp/client.js";
import { loadSkillDefinition, readSkillResourceDefinition, skillTool } from "./skill-tools.js";
import { prepareMemory, proposeMemoryDefinition } from "./propose-memory.js";
import { prepareRunCommand, runCommandDefinition } from "./run-command.js";
import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
// [KEEP 来自 15.2] 日志读取只接受保存后生成的编号，不开放任意磁盘路径。
import { readToolResultDefinition, readToolResultTool } from "./read-tool-result.js";
import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
import { editFileDefinition, prepareEditFile } from "./edit-file.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import type { RunOptions } from "../agent/run-options.js";
import { todoWriteDefinition, todoWriteTool } from "./todo-write.js";
import { askUserDefinition, askUserTool } from "./ask-user.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
// [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
export const toolDefinitions = [
  // [KEEP 来自 29.1] 调度和消息入口与普通工具一起发现。
  ...sharedTaskDefinitions,
  // [KEEP 来自 28.1] 只读身份和逐次批准命令分开登记。
  ...worktreeDefinitions,
  // [KEEP 来自 26.1] 启动与停止逐次审批，观察不执行进程。
  startJobDefinition, readJobDefinition, stopJobDefinition,
  delegateTaskDefinition,
  // [KEEP 来自 19.3] 两个独立按需动作，正文加载和资源结果各有去向。
  loadSkillDefinition, readSkillResourceDefinition,
  // [KEEP 来自 15.2] 让模型能发现按编号补读完整日志的只读工具。
  readToolResultDefinition,
  // [KEEP 来自 07.1] 命令工具也要先批准，不能直接执行。
  readFileDefinition, globDefinition, grepDefinition, writeFileDefinition, editFileDefinition, runCommandDefinition,
  todoWriteDefinition,
  askUserDefinition,
  // [KEEP 来自 18.2] 只是提出候选；并非直接写入入口。
  proposeMemoryDefinition,
];

/**
 * 找到需要审批的工具，先准备它的操作预览。
 *
 * write_file、edit_file 和 run_command 返回 PreparedToolCall，只读工具返回 null。
 * 主循环在权限判断之后、用户决定之前调用这里，所以准备不能写文件或启动命令。
 * 准备失败抛出 ToolError，由主循环转成工具错误交回模型。
 */
// [KEEP 来自 06.1] Agent Loop 在 ask 之后、审批之前调用这个准备入口。
export async function prepareTool(
  call: ToolCall,
  signal: AbortSignal,
  // [KEEP 来自 14.2] 只有获批准的写入闭包会使用本会话检查点。
  options: RunOptions = {},
): Promise<PreparedToolCall | null> {
  signal.throwIfAborted();
  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
  // [KEEP 来自 28.1] Plan先拒绝；管理器不接受模型提供的任意path或branch。
  if (worktreeMutations.has(call.name)) {
    if (options.mode === "plan") throw new ToolError("Plan模式不执行工作区副作用。");
    return prepareWorktree(call.name, call.arguments, options.worktrees, signal);
  }
  // [KEEP 来自 22.1] 准备仅校验URL，批准前不发送请求。
  if (call.name === "web_fetch" || call.name === "web_search") {
    const parsed = parseWebCall(call), frozen = { ...call };
    return { preview: parsed.query ? `搜索查询：${parsed.query}\n查询会发送给本地配置的提供方；不等于抓取网页全文。` : `网页GET：${parsed.url!.href}\n请求会把URL发给目标网站；网页文字不能批准后续工具。`, execute: signal => callWeb(options.web, frozen, signal) };
  }
  // [KEEP 来自 21.1] 扩展调用保存本次完整参数预览；闭包只有批准后才调用SDK。
  if (call.name.startsWith("mcp__")) {
    const frozen = { ...call };
    let args: unknown;
    try { args = JSON.parse(call.arguments); if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(); }
    catch { throw new ToolError("MCP参数必须是JSON对象。"); }
    return { preview: `外部MCP工具：${call.name}\n本次完整参数：\n${JSON.stringify(args, null, 2)}\n外部服务可能有副作用；只批准本次。`, execute: signal => callMcp(options.mcp, frozen, signal) };
  }
  // [KEEP 来自 18.2] 存储范围来自本地控制器，模型参数不能选择目录。
  // [KEEP 来自 26.1] 启动/停止只在已批准闭包执行。
  if (call.name === "start_job" || call.name === "stop_job") return prepareJob(call.name, call.arguments, options.jobs, signal);
  if (call.name === proposeMemoryDefinition.name) return prepareMemory(call.arguments, options.memoryRoot, signal);
  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal, options.fileCheckpoints);
  // [KEEP 来自 06.2] 精确替换也必须在审批前解析当前文件并生成 diff。
  if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal, options.fileCheckpoints);
  // [KEEP 来自 07.1] 准备阶段只固定命令和目录，不启动子进程。
  if (call.name === runCommandDefinition.name) return prepareRunCommand(call.arguments, undefined, signal);
  return null;
}

/**
 * 把无需预览审批的工具分发到对应实现。
 * todo_write 接收本轮共用的清单；ask_user 接收问答 handler 并等待答案。
 * 读取和搜索工具接收参数与取消信号；返回正文和界面数据。
 * 写入、命令或未知工具抛出 ToolError，不能从这里绕过准备与审批；调用 ID 由核心管理。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
  // [KEEP 来自 12.2] 新增本轮控制选项，便于传入清单和后续问答入口。
  options: RunOptions = {},
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
  // [KEEP 来自 28.1] 只读快照直接执行；副作用禁止绕过预览和审批。
  // [KEEP 来自 29.1] 仍经过allowedTools和权限策略，工具内部再次检查模式。
  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return sharedTaskTool(call.name, call.arguments, signal, options);
  if (call.name === "read_worktree") return readWorktree(call.arguments, options.worktrees, signal);
  if (worktreeMutations.has(call.name)) throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  // [KEEP 来自 21.1] 主循环先审批，注册表只按已发现映射执行。
  // [KEEP 来自 26.1] 观察入口拒绝跨会话PID，启动/停止禁止直接调用。
  if (call.name === "read_job") return readJob(call.arguments, options.jobs, signal);
  if (call.name === "start_job" || call.name === "stop_job") throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  if (call.name === delegateTaskDefinition.name) return delegateTaskTool(call.arguments, signal, options);
  if (call.name === "web_fetch" || call.name === "web_search") return callWeb(options.web, call, signal);
  if (call.name.startsWith("mcp__")) return callMcp(options.mcp, call, signal);
  // [KEEP 来自 19.3] 串行等待完整读取，再回传当前调用的结果。
  if (call.name === loadSkillDefinition.name || call.name === readSkillResourceDefinition.name) return skillTool(call.name, call.arguments, options.skills, signal);
  // [KEEP 来自 12.2] 分发给清单工具，传入同一份 TaskState。
  if (call.name === todoWriteDefinition.name) return todoWriteTool(call.arguments, options.tasks ?? { items: [] }, signal);
  // [KEEP 来自 12.3] 分发给问答工具，等待本地 handler 后返回原调用结果。
  if (call.name === askUserDefinition.name) return askUserTool(call.arguments, options.askUser, signal);
  // [KEEP 来自 15.2] 使用保存日志时的同一个目录，避免编号指向另一处存储。
  if (call.name === readToolResultDefinition.name) return readToolResultTool(call.arguments, signal, options.toolResultDirectory);
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  // [KEEP 来自 07.1] 拒绝绕过审批的直接执行。
  if (call.name === proposeMemoryDefinition.name || call.name === writeFileDefinition.name || call.name === editFileDefinition.name || call.name === runCommandDefinition.name) {
    throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  }
  throw new ToolError(`未知工具：${call.name}`);
}

/**
 * 执行主循环已经批准的那一次操作。
 *
 * 只调用 prepared 中保存的 execute，并向它传递本轮取消信号。
 * 不重新解析模型请求，所以文件修改或命令仍来自准备时保存的输入。
 * 批准检查由调用方完成，文件或进程的具体执行与失败处理仍在对应工具里。
 */
// [KEEP 来自 06.1] 写入和命令的副作用都从这个已准备的入口执行。
export function executePreparedTool(
  prepared: PreparedToolCall,
  signal: AbortSignal,
  options: RunOptions = {},
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (options.allowedTools) throw new ToolError("子任务不允许执行需准备的操作。");
  return prepared.execute(signal);
}
