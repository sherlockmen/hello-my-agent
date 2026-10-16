/**
 * 35.1 固定任务与离线回放 | [KEEP] permissions/policy.ts
 *
 * 学习目标：把本次启用的网页工具与 MCP 一并列为外部工具；Plan 硬拒绝，执行模式仍逐次询问，网页文字不产生批准。
 * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
 * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
 * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   本次外部工具集合包含网页？-- 是 -> 参数有效且非 Plan？-- 否 -> deny；是 -> ask，只批准本次
 *                              +-- 否 -> 继续原有本地工具规则
 *   已登记工具 + 参数对象？-- 否 -> deny
 *                         +-- 是 -> run_command？-- 是 -> ask，remember=false
 *                                                 +-- 否 -> 检查文件工具范围
 *   文件请求 -> 越界、.env 或禁止的元数据写入/搜索？-- 是 -> deny
 *                                                    +-- 否 -> 需要读取元数据？
 *              已有只读授权 -> allow / 尚无授权 -> ask
 *              普通写入 -> ask，remember=false / 普通只读 -> allow
 *
 * 命令不靠 cwd 推断副作用，也不会套用文件工具的 .env 检查冒充 shell 沙箱。
 * 它的完整参数和真实目录在准备阶段校验，之后展示给用户，只批准这一次操作。
 * 只读范围可以记住，命令和文件写入不可以；聊天里的“已经批准”不产生权限。
 * 观察：网页请求在 Plan 被拒绝，在执行模式每次审批；上次批准不会给下一 URL 或查询授权。
 */

// [KEEP 来自 28.1] 副作用集合由实际登记的工作区工具生成，不给会话记住权限。
// [KEEP 来自 29.1] 本地共享状态可在执行模式操作，Plan不得启动worker。
import { sharedTaskDefinitions, sharedTaskMutations } from "../tools/shared-task-tools.js";
import { worktreeMutations } from "../tools/worktree-tools.js";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import { findProjectRoot } from "../tools/workspace.js";
import type { ExecutionMode } from "../agent/run-options.js";

export type PermissionDecision =
  | { action: "allow"; reason: string }
  // [KEEP 来自 06.1] remember=false 表示批准只覆盖当前准备好的文件修改或命令。
  | { action: "ask"; reason: string; resource: string; scope: string; remember: boolean }
  | { action: "deny"; reason: string };

export type ApprovalRequest = {
  call: ToolCall;
  reason: string;
  resource: string;
  scope: string;
  allowSession: boolean;
  preview?: string;
};

export type ApprovalResponse =
  | { decision: "allow_once" }
  // [KEEP 来自 05.3] allow_session 表示把这次 ask 携带的批准记录保存到当前会话。
  | { decision: "allow_session" }
  | { decision: "deny"; reason: string };

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalResponse>;

// [KEEP 来自 18.1] 专用元数据目录不能从通用写入入口绕过记忆控制器。
const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex", ".hello-my-agent"]);

/**
 * 把未经信任的工具参数解析成顶层对象。
 *
 * - 输入：模型返回的 JSON 字符串。
 * - 输出：普通对象；JSON 无效、数组或非对象返回 `null`。
 * - 关键原因：权限判断发生在工具参数校验之前，不能直接相信 TypeScript 类型。
 * - 职责边界：这里只读取权限判断需要的顶层字段，完整 Schema 仍由具体工具校验。
 */
function parseArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(argumentsJson);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * 从不同文件工具的参数中取出决定访问范围的路径字段。
 *
 * - 输入：工具名称和已解析的顶层参数。
 * - 输出：文件工具的 `path`、`glob.pattern` 或 `grep.glob`；字段缺失或类型错误时返回 `null`。
 * - 关键原因：权限层只关心工具准备访问哪里，不重复实现 query、offset、limit 等业务校验。
 */
function getRequestedPath(call: ToolCall, input: Record<string, unknown>): string | null {
  // [KEEP 来自 06.2] 两个写入工具都用 path 决定访问范围。
  const value = ["read_file", "write_file", "edit_file", "code_intelligence"].includes(call.name)
    ? input.path
    : call.name === "glob"
      ? input.pattern
      : call.name === "grep"
        ? input.glob
        : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 判断路径文字是否明确要求离开当前项目。
 *
 * - 输入：相对路径或 glob 模式。
 * - 输出：绝对路径，或任一目录段为 `..` 时返回 `true`。
 * - 职责边界：这是执行前的快速拒绝；符号链接和真实路径仍由具体文件工具检查。
 */
function leavesProject(path: string): boolean {
  if (isAbsolute(path) || win32.isAbsolute(path)) return true;
  return path.replaceAll("\\", "/").split("/").some((segment) => segment === "..");
}

/**
 * 判断路径是否点名环境配置文件。
 *
 * - 输入：已经统一为 `/` 分隔的相对路径。
 * - 输出：任一目录段是 `.env`、`.env.*` 或 `.envrc` 时返回 `true`。
 * - 关键原因：命中 deny 后不提供审批入口，后续人工批准也不能覆盖它。
 */
function containsEnvironmentFile(path: string): boolean {
  return path.toLowerCase().split("/").some((segment) =>
    segment === ".env" || segment.startsWith(".env.") || segment === ".envrc");
}

/**
 * 找出需要人工确认的项目元数据目录。
 *
 * - 输入：已经统一为 `/` 分隔的相对路径。
 * - 输出：从项目根到第一个受保护目录的完整相对路径；普通源码路径返回 `null`。
 * - 示例：`.git/HEAD` 返回 `.git`，`packages/demo/.git/config` 返回 `packages/demo/.git`。
 * - 关键原因：两个位置不同但同名的 `.git` 目录不能共用同一条批准记录。
 */
function findApprovalDirectory(path: string): string | null {
  const segments = path.split("/");
  const index = segments.findIndex((segment) => APPROVAL_DIRECTORIES.has(segment.toLowerCase()));
  return index === -1 ? null : segments.slice(0, index + 1).join("/");
}

/**
 * 把现有文件的表面路径转换成项目内真实路径，防止符号链接隐藏受保护目标。
 *
 * - 输入：模型提供的相对路径和当前项目根目录。
 * - 输出：文件存在时返回相对于真实项目根的路径；目标不存在时保留原路径交给工具报错。
 * - 失败方式：真实目标位于项目外时返回 `null`，权限层据此 deny。
 * - 竞态边界：检查与工具打开文件仍是两步；本章不能把它描述成操作系统沙箱。
 */
async function resolvePermissionPath(path: string, projectRoot: string): Promise<string | null> {
  try {
    const rootPath = await realpath(projectRoot);
    const targetPath = await realpath(resolve(rootPath, path));
    const target = relative(rootPath, targetPath);
    if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) return null;
    return target.replaceAll("\\", "/");
  } catch {
    return path;
  }
}

/**
 * 由本地策略判断这次工具能否执行。
 * 先检查登记工具和 JSON 对象，再检查本轮模式；Plan 的写入、编辑和命令直接 deny。
 * 清单和澄清工具允许进入自身校验与执行，不需要文件审批；它们不能授予其他权限。
 * 执行模式的命令每次 ask；文件请求先检查硬拒绝，再查询只读会话授权，最后决定 allow 或 ask。
 * 返回 ask 时附本地生成的 scope 和 remember；只有可记住的只读范围才可进入授权集合。
 * 这里只返回决定，准备和执行仍要检查参数与路径，拒绝不会运行工具。
 */
export async function decideToolPermission(
  call: ToolCall,
  // [KEEP 来自 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
  sessionGrants: ReadonlySet<string> = new Set(),
  projectRoot = findProjectRoot(),
  // [KEEP 来自 12.1] 增加本轮模式参数，默认继续沿用执行模式。
  mode: ExecutionMode = "execute",
  // [KEEP 来自 21.1] 可信控制器传入本进程已发现的工具集合。
  externalTools: ReadonlySet<string> = new Set(),
): Promise<PermissionDecision> {
  // [KEEP 来自 21.1] MCP说明和readOnlyHint不能跳过逐次批准，Plan一律拒绝。
  if (externalTools.has(call.name)) {
    if (!parseArguments(call.arguments)) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };
    if (mode === "plan") return { action: "deny", reason: "Plan 模式不调用外部网络工具" };
    return { action: "ask", reason: "外部工具可能有文件或网络副作用，请核对本次完整参数", resource: call.name, scope: `${call.name}:once`, remember: false };
  }
  if (!toolDefinitions.some((tool) => tool.name === call.name)) {
    return { action: "deny", reason: `工具未登记：${call.name}` };
  }
  const input = parseArguments(call.arguments);
  if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };

  // [KEEP 来自 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
  if (mode === "plan" && (sharedTaskMutations.has(call.name) || worktreeMutations.has(call.name) || ["write_file", "edit_file", "run_command", "check_project", "propose_memory", "start_job", "stop_job"].includes(call.name))) {
    return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
  }
  // [KEEP 来自 28.1] 只读登记不会授予路径控制；创建/命令/后续副作用逐次审批。
  // [KEEP 来自 29.1] 这里只允许固定协调者动作，不给文件、命令或外部工具授权。
  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return { action: "allow", reason: "当前进程固定只读worker与有界共享登记" };
  if (call.name === "read_worktree") return { action: "allow", reason: "只读当前CLI自有Git工作区状态" };
  if (worktreeMutations.has(call.name)) return { action: "ask", reason: "工作区操作可能修改本地Git或文件，请核对本次身份、版本和命令", resource: typeof input.worktree_id === "string" ? input.worktree_id : "当前仓库的固定HEAD", scope: `${call.name}:once`, remember: false };
  // [KEEP 来自 19.3] 只读专用入口仍自行检查名字、路径和大小；不会授权其他工具。
  if (["load_skill", "read_skill_resource"].includes(call.name)) return { action: "allow", reason: "技能只读加载，范围与格式由专用工具再次检查" };
  // [KEEP 来自 18.2] 候选不能用会话授权，也不能靠项目文字跳过逐次审批。
  // [KEEP 来自 26.1] 模型启动/停止各批准一次；本地stdin不变成模型授权。
  if (call.name === "start_job" || call.name === "stop_job") return { action: "ask", reason: "后台进程有文件/网络副作用，停止也可能中断写入，请核对本次作业", resource: "本次后台作业", scope: `${call.name}:once`, remember: false };
  if (call.name === "read_job") return { action: "allow", reason: "只读本次会话作业状态和有界日志" };
  if (call.name === "propose_memory") return { action: "ask", reason: "长期记忆会跨会话保留，请核对正文、项目范围和来源", resource: "本项目长期记忆", scope: "propose_memory:once", remember: false };
  // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
  // [KEEP 来自 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
  if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
  if (call.name === "delegate_task") return { action: "allow", reason: "独立只读子任务，实际工具仍按原权限逐次检查" };
  if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
  // [KEEP 来自 12.3] 放行澄清等待；答案不产生文件或命令批准。
  if (call.name === "ask_user") return { action: "allow", reason: "澄清问题只等待用户回答，不授予工具执行权限" };
  // [KEEP 来自 07.1] 命令能做什么不能由 cwd 推断；每一次都交给用户确认。
  // [KEEP 来自 32.1] 脚本名不是执行权限；npm钩子与项目代码仍可能有副作用。
  if (call.name === "run_command" || call.name === "check_project") {
    return { action: "ask", reason: "命令可能修改文件或访问网络，请核对命令和执行目录",
      resource: "本次命令与工作目录", scope: "run_command:once", remember: false };
  }
  const path = getRequestedPath(call, input);
  if (!path) return { action: "deny", reason: "工具缺少用于判断访问范围的路径参数" };
  const normalized = path.replaceAll("\\", "/");
  if (leavesProject(normalized)) return { action: "deny", reason: "请求不能离开当前项目" };
  if (containsEnvironmentFile(normalized)) return { action: "deny", reason: "环境配置文件属于硬保护范围" };
  const protectedDirectory = findApprovalDirectory(normalized);
  // [KEEP 来自 06.2] 创建与编辑共用同样的禁止写入范围。
  const changesFile = call.name === "write_file" || call.name === "edit_file";
  if (changesFile && protectedDirectory) {
    return { action: "deny", reason: `${protectedDirectory} 属于不可写入的项目元数据目录` };
  }
  if (call.name !== "read_file" && !changesFile && protectedDirectory) {
    return {
      action: "deny",
      reason: `搜索工具不访问 ${protectedDirectory}；如需读取，请用 read_file 请求具体文件`,
    };
  }

  if (call.name === "read_file") {
    const actualPath = await resolvePermissionPath(normalized, projectRoot);
    if (actualPath === null) return { action: "deny", reason: "文件的真实路径位于当前项目外" };
    if (containsEnvironmentFile(actualPath)) {
      return { action: "deny", reason: "环境配置文件属于硬保护范围" };
    }
    const directory = findApprovalDirectory(actualPath);
    if (directory) {
      const scope = `read_file:${directory}/**`;
      if (sessionGrants.has(scope)) {
        return { action: "allow", reason: `本次会话已经允许 ${scope}` };
      }
      return {
        action: "ask",
        reason: `读取 ${directory} 项目元数据需要用户确认`,
        resource: actualPath === normalized ? normalized : `${normalized} -> ${actualPath}`,
        scope,
        remember: true,
      };
    }
  }

  // [KEEP 来自 06.2] 创建和编辑都必须批准当前 diff，不能靠旧的目录授权直接写入。
  if (changesFile) {
    return {
      action: "ask",
      reason: "修改文件会改变工作区，必须先审查本次差异",
      resource: normalized,
      scope: `${call.name}:${normalized}`,
      remember: false,
    };
  }

  return { action: "allow", reason: "项目内普通只读工具" };
}
