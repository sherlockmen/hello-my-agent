/**
 * 28.3 整合与清理 | [CHANGED] tools/worktree-tools.ts
 * 学习目标：让模型取得真实工作区身份，所有修改仍走统一逐次审批。
 * 输入：严格JSON对象和当前CLI持有的管理器；不接受任意path、branch或伪造ID。
 * 输出：只读快照，或固定预览/execute；失败回到Agent Loop形成工具错误，不自动清冲突。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   JSON/字段/ID有效？-- 否 -> ToolError；是 -> 当前会话manager -> 只读或prepare
 *   prepare -> 统一审批 -> execute；模型从content、界面从metadata取得同一身份。
 * 观察：Plan和只读child没有副作用入口；命令明确显示自有目录，修改后review失效。
 */
import { ToolError } from "../errors.js";
import { WorktreeManager, worktreeResult } from "../workspaces/worktrees.js";
import type { PreparedToolCall, ToolDefinition, ToolExecutionResult } from "./types.js";

// [KEEP 来自 28.1] 模型只能引用管理器返回的UUID，不能指定任意worktree目录。
const idProperty = { type: "string", description: "本次CLI创建的WorktreeID" };
/** 构造模型可见的严格工作区工具Schema。
 * 输入本地工具名、说明、附加字段和ID要求，输出ToolDefinition。
 * additionalProperties=false只是模型提示，执行前parse还要再次拒绝未知字段。
 */
function definition(name: string, description: string, extra: Record<string, unknown> = {}, idRequired = true): ToolDefinition {
  return { name, description, inputSchema: { type: "object", properties: { ...(name === "create_worktree" ? {} : { worktree_id: idProperty }), ...extra }, required: idRequired ? ["worktree_id", ...(name === "run_worktree_command" ? ["command"] : [])] : [], additionalProperties: false } };
}
export const worktreeDefinitions: ToolDefinition[] = [
  definition("create_worktree", "逐次批准后从当前HEAD创建自有独立Git worktree；原目录dirty不复制。返回WorktreeID、base/branch和真实目录；不是安全sandbox。", {}, false),
  definition("read_worktree", "只读当前CLI自有工作区状态；省略ID列出登记。返回base、当前/目标/被审SHA和评审是否失效，不导入旧会话路径。", {}, false),
  definition("run_worktree_command", "逐次批准后在自有工作区执行读/改/测/提交命令；命令仍可访问别处，不是安全sandbox。结果同时返回最新身份和状态。", { command: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 60_000 } }),
  // [KEEP 来自 28.2] 批准固定比较双方；不是模型自报review通过。
  definition("review_worktree", "预览完整diff并逐次批准目标SHA与任务SHA；两边clean且无未结束Git操作才可评审，修改后失效。批准不证明测试通过。"),
  // [NEW 28.3] 整合和清理均逐次批准，并在执行前重新检查。
  definition("integrate_worktree", "仅整合仍有效的已批准SHA；原目标branch/HEAD/clean复查成功才merge，冲突保留现场和任务分支。"),
  definition("remove_worktree", "仅移除本次CLI自有、clean且HEAD已进入原目标的worktree；有未跟踪/ignored成果拒绝，不force，提交保留在任务分支。"),
];
// [KEEP 来自 28.1] 工具定义与副作用gate共享同一集合。
export const worktreeMutations = new Set(worktreeDefinitions.filter(tool => tool.name !== "read_worktree").map(tool => tool.name));
/** 校验模型参数，不让路径或分支冒充当前CLI登记身份。
 * 输入工具名和JSON，输出已检查的普通对象；格式、未知字段或UUID不符抛ToolError。
 * UUID格式通过仍不代表拥有该工作区，后续管理器必须查询自己的Map。
 */
function parse(name: string, json: string): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new ToolError("工作区参数不是有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("工作区参数必须是对象。");
  const input = value as Record<string, unknown>;
  const keys = name === "create_worktree" ? [] : name === "run_worktree_command" ? ["worktree_id", "command", "timeout_ms"] : ["worktree_id"];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new ToolError("工作区参数含未知字段；不能传入任意path/branch。");
  if (name !== "create_worktree" && (input.worktree_id !== undefined || name !== "read_worktree")
      && (typeof input.worktree_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.worktree_id))) throw new ToolError("需要本次会话生成的WorktreeID。");
  return input;
}
/** 要求当前CLI确实持有工作区登记管理器。
 * 输入可信RunOptions注入的可选实例，输出实例；缺失时抛ToolError。
 * 不从模型参数、磁盘目录或旧会话自动接管工作区。
 */
function manager(value?: WorktreeManager): WorktreeManager { if (!value) throw new ToolError("当前会话没有工作区管理器。"); return value; }
/** 读取本次会话已有登记，省略ID时返回列表。
 * 输入严格JSON、当前管理器和取消信号；输出实际快照正文与结构化元数据。
 * ready身份检查失败向上抛错；failed/removed保留最后登记，帮助定位部分成功的现场。
 */
export async function readWorktree(json: string, worktrees: WorktreeManager | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted(); const input = parse("read_worktree", json), own = manager(worktrees);
  if (input.worktree_id) return worktreeResult(await own.get(input.worktree_id as string, signal), "当前真实工作区状态：");
  const items = await own.list(signal);
  return { content: JSON.stringify(items, null, 2), metadata: { kind: "worktree", worktree: null } };
}
/** 把已登记操作交给管理器生成固定预览。
 * 输入工具名、JSON、管理器和信号，输出PreparedToolCall；此时不执行副作用。
 * run_worktree_command固定cwd为自有根，完整命令仍沿用普通命令校验与逐次审批。
 * 未知操作抛ToolError；调用者必须先经过统一权限策略再调用执行闭包。
 */
export async function prepareWorktree(name: string, json: string, worktrees: WorktreeManager | undefined, signal: AbortSignal): Promise<PreparedToolCall> {
  signal.throwIfAborted(); const input = parse(name, json), own = manager(worktrees), id = input.worktree_id as string;
  if (name === "create_worktree") return own.prepareCreate(signal);
  if (name === "run_worktree_command") return own.prepareCommand(id, JSON.stringify({ command: input.command, cwd: ".", ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {}) }), signal);
  if (name === "review_worktree") return own.prepareReview(id, signal);
  if (name === "integrate_worktree") return own.prepareIntegrate(id, signal);
  if (name === "remove_worktree") return own.prepareRemove(id, signal);
  throw new ToolError(`未知工作区操作：${name}`);
}
