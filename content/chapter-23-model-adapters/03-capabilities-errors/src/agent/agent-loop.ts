/**
 * 23.3 能力与错误 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
 * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
 * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
 * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
 *
 * 全局主流程（从这里进入各模块）：
 *   [KEEP 来自 19.1] 启动discoverSkills -> 名称/用途目录常驻参考，不读正文
 *   [KEEP 来自 19.2] 空闲 /skill review -> 完整读取接纳 -> loaded Map -> 后续system正文
 *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
 *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
 *                                                         +-- 有效 -> 配置、模型、消费者
 *   [KEEP 来自 13.3] text / TUI -> 新建 ID 或锁定、校验并恢复指定会话；jsonl 仍只输出事件
 *   [KEEP 来自 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
 *   [KEEP 来自 13.4] --sessions / --search / --rename / --export -> 本地管理记录，不请求模型
 *   [KEEP 来自 14.1] --fork ID -> 复制可信状态到新 ID；保留来源记录，不继承旧轮占用或授权
 *   [KEEP 来自 14.3] 空闲 /changes、/restore ID -> 查看差异或按当前内容核验后恢复；不执行旧工具
 *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
 *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
 *   [KEEP 来自 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
 *   [KEEP 来自 12.4] TUI Enter -> 正在运行？-- 是 -> 校验补充 -> 记入当前轮 FIFO 队列
 *                                           +-- 否 -> 本地命令或新一轮问题
 *   [KEEP 来自 12.4] Ctrl+S -> 先保存新要求、锁住提交 -> abort 旧轮 -> 等旧 done
 *                   -> 已退出？-- 是 -> 结束；否 -> 新控制器、新一轮（旧队列留存）
 *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；队列 e 编辑、x 撤回、空闲 Enter 发送
 *                  -> 每次按固定 ID 查找；已收取？-- 是 -> 保留编辑稿、可 Ctrl+B 复制
 *                                                   +-- 否 -> 校验后保存原条目
 *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
 *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
 *                                                                   +-- 否 -> 建立本轮消息
 *   [KEEP 来自 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
 *   [KEEP 来自 12.1] 固定本轮模式 -> A
 *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
 *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
 *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
 *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
 *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
 *      [KEEP 来自 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
 *           -> 候选仍超限 / 失败 / 取消？-- 是 -> X（原视图与完整记录保留）
 *                                       +-- 否 -> 提交摘要游标，再请求模型
 *                                                      +-- 是 -> 请求模型
 *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
 *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
 *                                                                        +-- 是 -> B
 *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
 *                  |                         +-- 是 -> 保存 assistant 回答
 *                  |  [KEEP 来自 12.4] 仍有补充且未到第 8 次？-- 是 -> A（继续决策）
 *                  |                                              +-- 否 -> 提交历史、返回回答
 *                  |  次数已用完时不取走剩余补充，界面队列仍保留
 *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
 *                                       +-- 否 -> 保存 assistant 调用 -> C
 *   [KEEP 来自 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
 *   [KEEP 来自 22.2] 固定搜索endpoint -> 本次查询审批 -> 有界JSON响应 -> 真正返回的URL/摘要 -> 模型
 *   [KEEP 来自 22.1] 明确启用 -> URL/本次审批 -> 单一期限/逐块限额/逐跳校验 -> 真实来源与正文 -> 模型
 *   [KEEP 来自 21.3] close/断线/定义变化 -> 撤下可调用定义；取消先关闭本地传输，远端副作用仍需核实
 *   [KEEP 来自 21.2] HTTP配置 -> HTTPS/loopback校验 -> 固定Bearer环境变量 -> 官方StreamableHTTP
 *   [KEEP 来自 21.1] 显式MCP配置 -> SDK握手 -> 分页发现/命名 -> 模型定义 -> 逐次审批 -> SDK调用/原调用结果
 *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
 *   C: [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
 *                                                             +-- 否 -> 原有 deny / ask / allow
 *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
 *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
 *                                                             +-- 批准 -> 执行 -> D
 *      [KEEP 来自 18.2] propose_memory -> 完整正文/依据预览 -> allow_once -> 锁内保存
 *                     拒绝/取消不执行闭包；已保存结果回原调用，下一任务才刷新记忆
 *      [KEEP 来自 19.3] load_skill -> 完整接纳Map -> 成功摘要回D -> 下一请求system加入正文
 *      [KEEP 来自 19.3] read_skill_resource -> 已加载技能内有界读取 -> 文字/来源回D
 *                     资源随原toolCallId结果进下一请求；失败同样有结果，取消走X
 *      allow -> 注册表找到工具 -> 执行 -> D
 *        [KEEP 来自 14.2] write_file / edit_file -> 先保存前后内容检查点，成功才实际写入
 *        [KEEP 来自 12.2] todo_write -> 全部条目校验成功？-- 否 -> ToolError、旧清单不变
 *                                                     +-- 是 -> 一次替换内存清单 -> D
 *        [KEEP 来自 12.3] ask_user -> 校验问题 -> 专用 handler 等回答
 *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
 *                                                +-- 否 -> ToolError 或取消 -> D / X
 *                            TUI 面板独占输入；旧请求结束后旧回调失效
 *   [KEEP 来自 20.2] 工具真实结果 -> after_tool -> 追加反馈或失败说明 -> D；取消保留已知结果
 *   D: 工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
 *                                                        +-- 是 -> 写完整本地日志、sync、关闭
 *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
 *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
 *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
 *      保存正文 / 裁剪正文与原调用 ID、错误标记 -> 过程事件 -> 本批还有调用？-- 是 -> C
 *                                                                             +-- 否 -> A
 *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
 *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
 *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
 *   [KEEP 来自 20.3] runAgent -> 非取消的完成/错误 -> stop一次 -> 本地反馈；取消不启动stop
 *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
 *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
 *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
 *   [KEEP 来自 13.1] text / TUI 流清理完 -> Message[] 已提交 -> 白名单检查点 -> 串行 append、sync
 *                  -> 成功 / 保存失败反馈（模型结果另行显示）；TUI done 此后才解除占用
 *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑撤回 -> 白名单检查点；Enter 入队仍只改内存
 *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
 *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
 *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
 *   [KEEP 来自 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
 *
 * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
 * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
 * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
 * 运行观察：真实网页结果进入下一次模型输入；未知或缺少编号会附本地反馈，真实编号配错结论仍需人工核实。
 */

// [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
// [KEEP 来自 21.1] 每次调用重新检查当前定义是否可用。
// [KEEP 来自 22.1] 网页也使用同一条审批与原调用结果通道。
import { webDefinitions, citationFeedback } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import { runHooks } from "../hooks/lifecycle.js";
import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
import { explainError, ToolError, UserFacingError } from "../errors.js";
import { boundToolResult, clippedToolText } from "../context/tool-results.js";
import { requestFailedBeforeSending, type Message, type Model, type ModelResult, type Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import type { RunOptions } from "./run-options.js";

const MAX_MODEL_CALLS = 8;

/**
 * 把新一次模型调用的 token 数累加到本轮总量。
 *
 * - 输入：当前累计值和本次调用值；任一值都可能是表示未知的 `null`。
 * - 输出：两项都已知时返回和；任一项未知时返回 `null`。
 * - 关键原因：部分缺失的数据不能计算出真实总量，继续显示数字会造成误导。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 让模型读到问题和真实工具结果，继续决策直到本轮完成或中断。
 * 进入前先检查取消；本轮模式在入口固定，模型提示与权限策略都使用它。
 * 清单容器在这轮工具之间共用；工具完整校验后更新内存，核心不从回答文字推断进度。
 * 每次模型请求前取出当前轮 FIFO 补充，加入本轮消息；上一批工具先全部产生结果。
 * 最终回答后还有补充且未用尽 8 次请求时继续；用尽次数不收取剩余补充。
 * 每个工具先过权限，写入与命令先准备再审批；拒绝和 ToolError 也回给原调用。
 * ask_user 通过注册表等待专用 handler，答案仍是该次工具结果。
 * 成功提交完整本轮消息并返回回答；开始后中断则补齐工具结果、保存说明，再抛出原因。
 * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
 */
// [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
// [CHANGED 23.3] 摘要与常规请求一同累计用量，任一未知保持未知。
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 增加本轮控制选项；调用方把模式快照传到核心。
  options: RunOptions = {},
): Promise<Reply> {
  signal.throwIfAborted();
  const releaseRun = model.beginRun?.();
  // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
  const mode = options.mode ?? "execute";
  // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
  const context = options.context ?? emptyCompaction();
  // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
  // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
  // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
  const toolOptions: RunOptions = { ...options, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let cachedInputTokens: number | null = 0, cacheWriteTokens: number | null = 0;
  // [CHANGED 23.3] 已发送但未收齐结果时，累计值不能继续冒充整轮总量；未发送的预检拒绝保留旧值。
  const incompleteUsage = (call: number, error: unknown) => {
    if (requestFailedBeforeSending(error)) return;
    inputTokens = outputTokens = cachedInputTokens = cacheWriteTokens = null;
    emitAgentEvent(observer, { type: "model_usage", call, inputTokens, outputTokens,
      costEstimateUsd: null, cachedInputTokens, cacheWriteTokens });
  };
  let toolSequence = 0;
  let pendingToolResults = 0;
  // [KEEP 来自 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
  let compactionAttempts = 0;

  // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
  let executingCallId: string | undefined;
  try {
    // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
    await model.memory?.refresh(signal);
    for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
      // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
      signal.throwIfAborted();

      // [KEEP 来自 12.4] 每次请求前收取当前轮 FIFO 补充；上一批调用已有完整工具结果。
      for (const queued of options.takePendingInputs?.() ?? []) {
        turn.push({ role: "user", content: queued.text });
        // [KEEP 来自 12.4] 此事件只确认核心已收取并加入本次上下文，不保证远端收到。
        emitAgentEvent(observer, { type: "input_applied", ...queued, call: modelCall });
      }
      signal.throwIfAborted();
      // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
      let messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
      let budget = model.inspectContext?.(messages, mode);
      if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
      // [KEEP 来自 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
      if (budget && !budget.withinBudget) {
        const candidate = { ...context };
        try {
          while (!budget.withinBudget && compactionAttempts < 2) {
            compactionAttempts += 1;
            emitAgentEvent(observer, { type: "compaction_start", attempt: compactionAttempts });
            const prepared = await prepareCompaction(model, [...history, ...turn], candidate, signal, mode,
              toolOptions.tasks?.items, result => {
                inputTokens = addUsage(inputTokens, result.inputTokens);
                outputTokens = addUsage(outputTokens, result.outputTokens);
                cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
                cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
                emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
                  costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
              }, error => incompleteUsage(modelCall, error));
            Object.assign(candidate, prepared.state);
            messages = requestMessages([...history, ...turn], candidate, toolOptions.tasks?.items);
            budget = model.inspectContext!(messages, mode);
            emitAgentEvent(observer, { type: "compaction_candidate", attempt: compactionAttempts,
              before: prepared.before, after: prepared.after, through: candidate.through });
          }
          signal.throwIfAborted();
          if (!budget.withinBudget) throw new UserFacingError("本项任务的摘要次数已用尽，请求仍超出本地预算；候选未采用，完整记录保留。");
          Object.assign(context, candidate);
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "applied", through: context.through });
          emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
        } catch (error) {
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "retained",
            message: signal.aborted ? "压缩已取消，旧请求视图和完整记录保留。" : explainError(error) });
          throw error;
        }
      }
      emitAgentEvent(observer, {
        type: "model_start",
        call: modelCall,
        contextMessages: messages.length,
        trigger: modelCall === 1
          ? { kind: "user", content: input }
          : { kind: "tool_results", count: pendingToolResults },
      });
      pendingToolResults = 0;
      // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
      // [KEEP 来自 12.1] 模型请求也接收本轮模式；工具隐藏只是辅助。
      let result: ModelResult;
      try {
        result = await model.generate(messages, signal, (text) => {
          if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });
        }, { mode });
      } catch (error) { incompleteUsage(modelCall, error); throw error; }
      inputTokens = addUsage(inputTokens, result.inputTokens);
      outputTokens = addUsage(outputTokens, result.outputTokens);
      truncated ||= result.truncated;
      cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
      cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
      // [KEEP 来自 15.1] 任一次 usage 缺失后累计值保持未知，不以估算补充；费用只按用户配置计算。
      emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
        costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
      emitAgentEvent(observer, {
        type: "model_finish",
        call: modelCall,
        // [KEEP 来自 08.2] 长度上限和拒绝不会伪装成成功回答。
        finishReason: result.finishReason,
        outcome: !["stop", "tool_calls"].includes(result.finishReason) ? "incomplete"
          : result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
        toolRequests: result.toolCalls.length,
        text: result.text,
      });

      // [KEEP 来自 08.2] 正常结束与工具数量必须一致，完整响应才允许进入权限判断。
      if (result.finishReason === "length") throw new UserFacingError("回答达到输出上限，本次响应未完成；其中的工具请求不会执行。");
      if (result.finishReason === "refusal") throw new UserFacingError("模型拒绝了本次请求，本次响应中的工具请求不会执行。");
      if (result.finishReason !== (result.toolCalls.length ? "tool_calls" : "stop")) {
        throw new UserFacingError("模型结束原因与内容不一致，或当前接口返回了不支持的结束原因。");
      }
      if (result.toolCalls.length === 0) {
        if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
        signal.throwIfAborted();
        // [KEEP 来自 22.3] 不编造修复后的引用；本地核验反馈随最终结果显示并保存。
        const feedback = citationFeedback(model.web, result.text);
        const finalText = result.text + (feedback ? `\n\n${feedback}` : "");
        turn.push({ role: "assistant", content: finalText });

        // [KEEP 来自 12.4] 最终回答后仍有补充且有请求预算就继续；第 8 次后的剩余条目保留。
        if (modelCall < MAX_MODEL_CALLS && options.takePendingInputs && options.hasPendingInputs?.()) continue;
        history.push(...turn);
        return { text: finalText, inputTokens, outputTokens, truncated, cachedInputTokens, cacheWriteTokens };
      }

      // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
      if (modelCall === MAX_MODEL_CALLS) break;

      turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        signal.throwIfAborted();
        toolSequence += 1;
        // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
        const permission = await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
        emitAgentEvent(observer, {
          type: "permission_check",
          sequence: toolSequence,
          call,
          decision: permission,
        });
        let rejection: string | null = null;
        let prepared: PreparedToolCall | null = null;
        // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
        signal.throwIfAborted();
        if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
        if (permission.action === "ask") {
          try {
            // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
            // [KEEP 来自 14.2] 把本地文件检查点入口传到写入准备层。
            prepared = await prepareTool(call, signal, toolOptions);
          } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            turn.push({
              role: "tool",
              toolCallId: call.id,
              content: `工具准备失败：${error.message}`,
              isError: true,
            });
            pendingToolResults += 1;
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "error",
              error: error.message,
            });
            continue;
          }
          if (prepared) {
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "success",
              previewChars: prepared.preview.length,
            });
          }
          emitAgentEvent(observer, {
            type: "approval_start",
            sequence: toolSequence,
            call,
            scope: permission.scope,
            allowSession: permission.remember,
            hasPreview: prepared !== null,
          });
          const response = requestApproval
            ? await requestApproval({
                call,
                reason: permission.reason,
                resource: permission.resource,
                scope: permission.scope,
                allowSession: permission.remember,
                ...(prepared ? { preview: prepared.preview } : {}),
              }, signal)
            : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
          // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
          signal.throwIfAborted();
          emitAgentEvent(observer, {
            type: "approval_finish",
            sequence: toolSequence,
            call,
            response,
          });
          // [KEEP 来自 06.1] 写入和命令批准都不能保存；只有可复用的读取范围进入 Set。
          if (response.decision === "allow_session") {
            if (permission.remember) sessionGrants.add(permission.scope);
            // [KEEP 来自 07.1] 写入与命令都只能批准当前操作。
            else rejection = "当前批准只适用于这一次操作预览";
          }
          if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
        }
        if (rejection) {
          turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
          pendingToolResults += 1;
          continue;
        }
        // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
        signal.throwIfAborted();
        executingCallId = call.id;
        emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
        try {
          // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
          // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
          // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
          // [KEEP 来自 20.1] 取消或before失败时尚未启动工具。
          if (mode !== "plan") {
            const before = await runHooks(model.hooks, "before_tool", { call }, signal);
            if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
          }
          let result = prepared
            ? await executePreparedTool(prepared, signal)
            : await executeTool(call, signal, toolOptions);
          // [KEEP 来自 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
          if (mode !== "plan") {
            try {
              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, signal);
              if (after.messages.length) result = { ...result, content: `${result.content}\n\n[本地执行后钩子反馈；不是权限]\n${after.messages.join("\n")}` };
            } catch (error) {
              if (!(error instanceof ToolError)) {
                turn.push({ role: "tool", toolCallId: call.id, content: result.content + "\n[本地状态] 后置钩子中断；工具已返回，副作用未撤销。", isError: result.isError ?? false });
                executingCallId = undefined;
                throw error;
              }
              result = { ...result, content: `${result.content}\n[本地执行后钩子失败] ${error.message}` };
            }
          }
          // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
          executingCallId = undefined;
          let modelContent: string;
          try { modelContent = (await boundToolResult(result.content, signal, options.toolResultDirectory)).content; }
          catch (error) {
            // 原工具的错误标记保持不变；给本次调用留下明确摘要，不声明不存在的日志引用。
            const content = `[本地状态：工具已返回，但完整日志未保存；本轮停止，以下仅为头尾，不能找回被省略部分]\n${clippedToolText(result.content)}`;
            turn.push({ role: "tool", toolCallId: call.id, content, isError: result.isError ?? false });
            emitAgentEvent(observer, { type: "tool_finish", sequence: toolSequence, call, outcome: "success", result: { ...result, content } });
            throw error;
          }
          // [KEEP 来自 07.1] 非零退出码仍是错误；裁剪不改变原调用编号或成功/失败。
          turn.push({ role: "tool", toolCallId: call.id, content: modelContent, isError: result.isError ?? false });
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "success",
            result: { ...result, content: modelContent },
          });
        } catch (error) {
          // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
          if (!(error instanceof ToolError)) throw error;
          turn.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具执行失败：${error.message}`,
            isError: true,
          });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallId = undefined;
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "error",
            error: error.message,
          });
        }
      }
    }

    throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
  } catch (error) {
    // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
    // 每个批次单独配对：后续模型请求即使复用同一个 ID，也不能借用前一批的完成记录。
    const lastBatch = turn.map((message) => message.role === "assistant" && Boolean(message.toolCalls?.length)).lastIndexOf(true);
    const completed = new Set(turn.slice(lastBatch + 1).filter((message) => message.role === "tool").map((message) => message.toolCallId));
    for (const message of lastBatch < 0 ? [] : [turn[lastBatch]]) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        if (completed.has(call.id)) continue;
        turn.push({ role: "tool", toolCallId: call.id, isError: true,
          content: call.id === executingCallId
            ? "操作已开始，但本轮中断前没有取得完整结果。可能已发生部分修改，请先核实当前文件或进程状态，不要直接重试。"
            : "本轮在该工具启动前中断，这个调用未执行。" });
        completed.add(call.id);
      }
    }
    // 这条状态由本地程序生成，明确标注来源，不把它冒充模型完成的回答。
    // [KEEP 来自 09.2] 按取消原因写入本地状态；队列或输出故障是错误，普通取消才记为取消。
    const cancelled = signal.aborted && !(signal.reason instanceof UserFacingError);
    turn.push({ role: "assistant", content: cancelled
      ? "[本地状态] 本轮已取消。已执行的操作不会自动撤销；继续前先核实工具结果。"
      : "[本地状态] 本轮因错误中断。已执行的操作不会自动撤销；继续前先核实工具结果。" });
    history.push(...turn);
    throw error;
  } finally { releaseRun?.(); }
}
