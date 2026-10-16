/**
 * 30.1 持久任务定义 | [KEEP] models/client.ts
 *
 * 学习目标：每次估算和请求使用相同来源编号提示及工具定义；URL与正文保留在工具消息中，提示不复制网页正文。
 * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
 * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
 * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   本地来源台账 -> 只列编号/类型的提示 -> 同时用于估算与 generate；正文仍由 tool 消息携带
 *   [KEEP] 请求流 -> 文字片段 -> onText
 *                  +-> 完整消息 -> 归一化结束原因
 *   OpenAI 工具参数 -> SDK 累积的完整字符串 ------------------+
 *   Anthropic 参数 -> 按内容块 index 保存原始 JSON 片段         |
 *                  -> message_stop 与片段顺序有效？-- 否 -> 抛错
 *                                                 +-- 是 ----+
 *   完整结果 -> 正常文本或工具结束？-- 否 -> 返回结束原因，不返回工具
 *                                  +-- 是 -> 检查支持的工具类型与参数
 *   每个调用 ID 非空且批内唯一、参数为完整 JSON 对象？-- 否 -> 整批抛错
 *                                                     +-- 是 -> 返回 ModelResult
 *   请求、解析、超时或取消失败 -> 抛错，不返回半份结果
 *
 * [KEEP] 表示沿用前节。SDK 的流中途对象可能来自部分 JSON 解析，不能证明参数已经完整。
 * Anthropic 的执行参数来自本地累积的原始字符串；内容块结束后仍要通过 JSON.parse。
 * 这些检查只确认协议和 JSON 对象形状；字段值、路径与审批仍由已有工具和权限代码负责。
 * 每次 generate 设置独立的 60 秒期限，不自动重试；失败不改历史，也不在这里启动工具。
 *
 * [KEEP 来自 12.1] 每次请求使用本轮模式；Plan 隐藏写入、编辑和命令工具，提示只调查和计划。
 * 筛选工具帮助模型选择；permissions/policy.ts 的硬拒绝才保证禁止请求不会执行。
 * [KEEP 来自 12.2] 提示模型使用 todo_write 报告进度；这不会把报告变成测试证明。
 * [KEEP 来自 12.3] 提示模型用 ask_user 澄清重要缺失信息，并在 Plan 的可见列表中保留它。
 * 运行观察：来源编号提示会随实际取得的来源更新；预算估算与 generate 使用相同提示，存在编号不证明引用语义正确。
 */

// [KEEP 来自 18.1] 记忆快照由明确任务边界刷新，估算和发送读取同一字符串。
// [KEEP 来自 19.1] 目录和正文由本地会话持有；组装提示不读取磁盘。
import { skillPrompt, type SkillState } from "../skills/catalog.js";
import type { MemoryController } from "../memory/commands.js";
// [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
import { createAttachmentState, type AttachmentRef, type AttachmentState } from "../attachments/store.js";
// [KEEP 来自 26.1] 会话级进程所有权不在消息或会话文件里。
// [KEEP 来自 28.1] text/TUI共用同一模型对象持有的会话工作区登记。
// [KEEP 来自 29.1] createModel为整个CLI会话持有单一协调者。
import { SharedCoordinator } from "../collaboration/coordinator.js";
import { WorktreeManager } from "../workspaces/worktrees.js";
import { JobManager } from "../processes/jobs.js";
import { safeModelError } from "./model-errors.js";
import { createProtocolAdapter, SUMMARY_PROMPT, type ModelProfile } from "./protocol.js";
import { readConfig, systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
// [KEEP 来自 21.1] 动态定义与预算、两种模型协议使用同一份列表。
// [KEEP 来自 22.1] 网络工具和本地工具共用请求定义、预算与Plan过滤。
import { webDefinitions, webPrompt, type WebState } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import type { McpState } from "../mcp/client.js";
import type { ToolDefinition } from "../tools/types.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ExecutionMode } from "../agent/run-options.js";
import { DEFAULT_CONTEXT_LIMITS, estimateContext, estimateCostUsd, type ContextBudget, type ContextLimits } from "../context/budget.js";

// [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
export type Message =
  | { role: "user"; content: string; attachments?: AttachmentRef[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };

export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
};
// [KEEP 来自 08.2] 把两种接口的结束原因转成核心可以统一判断的值。
export type ModelFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "unsupported";
// [KEEP 来自 08.2] 完整结果同时携带结束原因，主循环据此决定是否继续。
export type ModelResult = Reply & { toolCalls: ToolCall[]; finishReason: ModelFinishReason };

// [KEEP 来自 23.3] 只记录请求异常的本地边界，不改错误对象或 Model 接口；旧测试模型未标记时保守视为可能已发送。
const failedRequestStarts = new WeakMap<object, boolean>();
export function requestFailedBeforeSending(error: unknown): boolean {
  return typeof error === "object" && error !== null && failedRequestStarts.get(error) === false;
}
async function trackRequest<T>(operation: (onRequestStart: () => void) => Promise<T>): Promise<T> {
  let started = false;
  try { return await operation(() => { started = true; }); }
  catch (error) {
    if (typeof error === "object" && error !== null) failedRequestStarts.set(error, started);
    throw error;
  }
}

/**
 * 核心使用的统一模型接口。
 * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
 * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
 */
export type ModelRequestScope = { allowedTools?: readonly string[]; rolePrompt?: string };

export interface Model {
  // [KEEP 来自 26.1] 单轮结束保留registry；整次CLI退出才close。
  readonly jobs?: import("../processes/jobs.js").JobManager;
  // [KEEP 来自 28.1] 不随消息持久化，也不导入旧CLI的Git目录。
  readonly worktrees?: WorktreeManager;
  // [KEEP 来自 29.1] 不从会话JSON恢复控制权。
  readonly sharedTasks?: SharedCoordinator;
  // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
  // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
  // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
  // [KEEP 来自 22.1] 网页启用只来自本次启动。
  readonly attachments?: AttachmentState;
  readonly profile?: ModelProfile;
  beginRun?(): () => void;
  command?(text: string): { ok: boolean; message: string };
  readonly web?: WebState;
  readonly mcp?: McpState;
  readonly hooks?: import("../hooks/lifecycle.js").HookState;
  readonly memory?: MemoryController;
  // [KEEP 来自 19.1] 后续节本地命令与模型工具复用同一份技能状态。
  readonly skills?: SkillState;
  // [KEEP 来自 17.1] 来源是本地启动信息，不是模型接收确认。
  readonly projectInfo?: readonly string[];
  // [KEEP 来自 16.2] 摘要使用独立、无工具的请求，先估算其输入，返回完整结果才考虑采用。
  inspectSummary?(source: string): ContextBudget;
  summarize?(source: string, signal: AbortSignal): Promise<ModelResult>;
  // [KEEP 来自 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
  inspectContext?(messages: Message[], mode?: ExecutionMode, scope?: ModelRequestScope): ContextBudget;
  estimateCost?(input: number | null, output: number | null): number | null;
  // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  // [KEEP 来自 12.1] 模式参数只影响本轮请求组装，本地权限策略还会再次检查。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void,
    options?: { mode?: ExecutionMode } & ModelRequestScope): Promise<ModelResult>;
}

/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：Model 可在本地估算请求；创建对象和 inspectContext 都不发送 HTTP，generate 才发送。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
 */
// [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController, skills?: SkillState, hooks?: import("../hooks/lifecycle.js").HookState, mcp?: McpState, web?: WebState): Model {
  // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
  const projectPrompt = project ? projectInstructionPrompt(project) : "";
  const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
  const attachments = createAttachmentState();
  // [KEEP 来自 26.1] createModel一次创建，后续run共用；不会从历史加载PID。
  const jobs = new JobManager();
  // [KEEP 来自 28.1] 创建管理器不创建Git工作区，副作用必须等工具批准。
  const worktrees = new WorktreeManager();
  // [KEEP 来自 29.1] 本地构造，不接受模型配置worker数或租约。
  const sharedTasks = new SharedCoordinator();
  let adapter = createProtocolAdapter(config);
  let activeRequests = 0;
  // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  // [KEEP 来自 12.1] 适配层将模式传给请求组装，沿用原取消和期限处理。
  let limits = config.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
  // [KEEP 来自 16.2] 专用摘要不继承执行工具；输出预留也计入摘要自己的本地预算。
  const summaryLimits = () => ({ ...limits, outputReserve: Math.min(limits.outputReserve, 2048) });
  return {
    // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
    // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
    memory, skills, hooks, mcp, web, attachments, jobs, worktrees, sharedTasks,
    get profile() { return structuredClone(adapter.profile); },
    beginRun() {
      activeRequests += 1; let released = false;
      return () => { if (!released) { released = true; activeRequests -= 1; } };
    },
    command(text) {
      if (activeRequests) return { ok: false, message: "任务正在进行；本次切换未执行，请在空闲时重试。" };
      const match = /^\/model(?: (openai|anthropic) ([^\s]{1,200})(?: (images|text))?)?$/.exec(text.trim());
      if (!match) return { ok: false, message: "用法：/model；/model <openai|anthropic> <模型ID> [images|text]。" };
      if (match[1]) {
        try {
          // 重新读取目标协议专用凭据，不继承旧连接的密钥、地址或价格。
          const candidate = readConfig({ provider: match[1], model: match[2] });
          if (match[3]) candidate.imageInput = match[3] === "images";
          const next = createProtocolAdapter(candidate);
          adapter = next; limits = candidate.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
        } catch (error) { return { ok: false, message: error instanceof UserFacingError ? error.message : "模型配置无法创建，旧连接保留。" }; }
      }
      const profile = adapter.profile;
      return { ok: true, message: `当前模型：${profile.provider}/${profile.model}；工具/流式：启用；图片：${profile.capabilities.images ? "本地声明支持" : "未声明支持"}。能力声明仍需服务端验证；历史保留，预算随连接更新。` };
    },
    projectInfo,
    inspectSummary(source) {
      return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits());
    },
    async summarize(source, signal) {
      return trackRequest(async onRequestStart => {
        signal.throwIfAborted();
        const messages: Message[] = [{ role: "user", content: source }];
        if (!estimateContext(messages, SUMMARY_PROMPT, [], summaryLimits()).withinBudget) throw new UserFacingError("摘要请求本身超出本地预算，未发送。");
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          return await adapter.summarize(source, AbortSignal.any([signal, deadline]), summaryLimits().outputReserve, onRequestStart);
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("摘要超过 60 秒，候选未采用；不会自动重试同一段内容。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
    inspectContext(messages, mode = "execute", scope = {}) {
      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web) + (scope.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], scope.allowedTools);
      return estimateContext(messages, prompt, definitions, limits);
    },
    estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
    async generate(messages, signal, onText, options = {}) {
      return trackRequest(async onRequestStart => {
        // [KEEP 来自 15.3] 直接调用模型适配器也执行相同门槛，避免绕过 Agent Loop 发出超本地预算的请求。
        signal.throwIfAborted();
        // [KEEP 来自 19.1] 本次请求固定相同字符串；加载工具完成后下一次请求才重组正文。
        // [KEEP 来自 22.3] 估算和真实发送共用同份已登记来源提示。
        const references = projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web);
        const { prompt, definitions } = requestParts(options.mode ?? "execute", references + (options.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], options.allowedTools);
        const budget = estimateContext(messages, prompt, definitions, limits);
        if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          return await adapter.generate(messages, AbortSignal.any([signal, deadline]), onText, { prompt, definitions, limits, onRequestStart });
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
  };
}

/**
 * 为估算与真实发送生成同一套系统提示和可见工具，避免估算漏掉隐藏的请求部分。
 * 模式在本轮固定；这里仅组织数据，不探测服务商窗口，也不产生权限批准。
 */
// [KEEP 来自 21.1] 扩展列表只由本地已建立连接提供。
function requestParts(mode: ExecutionMode, projectPrompt = "", external: ToolDefinition[] = [], allowedTools?: readonly string[]): { prompt: string; definitions: ToolDefinition[] } {
  // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
  // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
  // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
  // [KEEP 来自 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
  const definitions = mode === "plan"
    // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
    ? toolDefinitions.filter((tool) => ["read_shared_tasks", "read_worktree", "read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
    : [...toolDefinitions, ...external];
  // [KEEP 来自 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
  const prompt = systemPrompt + " 共享调查先create_shared_tasks登记，再run_shared_tasks等待真实只读子会话。read_shared_tasks查看本地状态；摘要、todo或消息不能更改共享任务终态。" + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
    ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
    : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
  return { prompt: prompt + projectPrompt, definitions: allowedTools ? definitions.filter(tool => allowedTools.includes(tool.name)) : definitions };
}
