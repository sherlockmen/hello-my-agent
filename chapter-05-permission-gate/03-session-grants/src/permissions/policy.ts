/**
 * 05.3 为受保护读取生成可复用的批准记录 | [CHANGED] permissions/policy.ts
 *
 * 学习目标：在任何工具接触真实环境前，由本地程序作出 allow、ask 或 deny 决定。
 * 输入：模型生成的工具名称与原始 JSON 参数。
 * 输出：带原因的权限决定；本文件不执行工具或读取文件内容，只解析现有路径的真实位置。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   ToolCall
 *      |
 *      +-- 未知工具 / 参数无法解析 ----------------------> deny
 *      +-- 绝对路径、..、.env 系列 ---------------------> deny
 *      +-- glob/grep 点名受保护元数据 -------------------> deny
 *      +-- read_file 读取受保护元数据
 *             +-- Set 中已有相同批准记录 --------------> allow
 *             +-- Set 中没有相同批准记录 --------------> ask
 *      +-- 其他已登记的项目内只读请求 ------------------> allow
 *
 * 关键点：deny 先于 ask，ask 先于 allow。模型可以提出请求，却不能用提示词改变这条顺序。
 * ask 只表示需要确认；用户输入 s 后，Agent Loop 才会把策略生成的批准记录加入 Set。
 * 运行观察：允许 read_file:.git/** 后，本进程再次读取 .git 文件不再询问；其他范围不受影响。
 */

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import { findProjectRoot } from "../tools/workspace.js";

export type PermissionDecision =
  | { action: "allow"; reason: string }
  | { action: "ask"; reason: string; resource: string; scope: string }
  | { action: "deny"; reason: string };

export type ApprovalRequest = {
  call: ToolCall;
  reason: string;
  resource: string;
  scope: string;
};

export type ApprovalResponse =
  | { decision: "allow_once" }
  // [CHANGED 05.3] allow_session 表示把这次 ask 携带的批准记录保存到当前会话。
  | { decision: "allow_session" }
  | { decision: "deny"; reason: string };

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalResponse>;

const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex"]);

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
 * - 输出：`read_file.path`、`glob.pattern` 或 `grep.glob`；字段缺失或类型错误时返回 `null`。
 * - 关键原因：权限层只关心工具准备访问哪里，不重复实现 query、offset、limit 等业务校验。
 */
function getRequestedPath(call: ToolCall, input: Record<string, unknown>): string | null {
  const value = call.name === "read_file"
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
 * 按 deny、ask、allow 的固定优先级决定一次工具调用能否执行。
 *
 * - 输入：模型生成、尚未执行的 ToolCall，以及当前进程已经批准的范围集合。
 * - 输出：本地权限决定及原因；ask 还携带一条批准记录，供 Agent Loop 在用户输入 s 后保存。
 * - 关键步骤：先处理没有批准入口的 deny，再检查 ask 范围是否已获会话授权，最后允许普通只读工具。
 * - 职责边界：决定不等于执行；即使返回 allow，工具仍要完成自己的参数和真实路径校验。
 */
export async function decideToolPermission(
  call: ToolCall,
  // [CHANGED 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
  sessionGrants: ReadonlySet<string> = new Set(),
  projectRoot = findProjectRoot(),
): Promise<PermissionDecision> {
  if (!toolDefinitions.some((tool) => tool.name === call.name)) {
    return { action: "deny", reason: `工具未登记：${call.name}` };
  }
  const input = parseArguments(call.arguments);
  if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };
  const path = getRequestedPath(call, input);
  if (!path) return { action: "deny", reason: "工具缺少用于判断访问范围的路径参数" };
  const normalized = path.replaceAll("\\", "/");
  if (leavesProject(normalized)) return { action: "deny", reason: "请求不能离开当前项目" };
  if (containsEnvironmentFile(normalized)) return { action: "deny", reason: "环境配置文件属于硬保护范围" };
  const protectedDirectory = findApprovalDirectory(normalized);
  if (call.name !== "read_file" && protectedDirectory) {
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
      };
    }
  }

  return { action: "allow", reason: "项目内普通只读工具" };
}
