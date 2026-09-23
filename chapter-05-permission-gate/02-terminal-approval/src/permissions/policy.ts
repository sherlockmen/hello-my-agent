/**
 * 05.2 在终端中完成一次审批 | [CHANGED] permissions/policy.ts
 *
 * 学习目标：告诉主循环这次读取能直接继续，还是需要用户确认。
 * 输入：模型给出的工具名、JSON 参数和项目位置。
 * 输出：allow、ask 或 deny，并带上原因；这里只检查路径，不读取正文或执行工具。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   ToolCall
 *      |
 *      +-- 未知工具 / 参数无法解析 ----------------------> deny
 *      +-- 绝对路径、..、.env 系列 ---------------------> deny
 *      +-- glob/grep 点名受保护元数据 -------------------> deny
 *      +-- read_file 读取 .git/.agents/.codex ----------> ask
 *      +-- 其他已登记的项目内只读请求 ------------------> allow
 *
 * 先拒绝明确禁止的请求，再处理需要确认的读取，最后才允许普通读取。
 * ask 只说明需要确认，不表示用户已经同意；后续是否执行由 Agent Loop 等到回答后处理。
 * 运行观察：普通源码可以直接读取，.env 被拒绝，.git 文件先等待用户批准。
 */

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import { findProjectRoot } from "../tools/workspace.js";

export type PermissionDecision =
  | { action: "allow"; reason: string }
  | { action: "ask"; reason: string; resource: string; scope: string }
  | { action: "deny"; reason: string };

// [NEW 05.2] ask 决定通过独立审批契约交给界面处理。
export type ApprovalRequest = {
  call: ToolCall;
  reason: string;
  resource: string;
  scope: string;
};

export type ApprovalResponse =
  | { decision: "allow_once" }
  | { decision: "deny"; reason: string };

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalResponse>;

const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex"]);

/**
 * 把模型给出的 JSON 参数读成可检查的对象。
 *
 * - 传入原始参数字符串；能解析为非空对象时返回它，数组、其他值或无效 JSON 返回 null。
 * - 权限判断比具体工具校验更早，只取它需要的字段，不在这里重复校验行号等全部参数。
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
 * 从工具参数中取出这次准备访问的路径。
 *
 * read_file 使用 path，glob 使用 pattern，grep 使用 glob；缺失或不是非空字符串就返回 null。
 * 这里只确定要访问哪里，query、offset 和 limit 等参数仍交给具体工具检查。
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
 * 先从路径文字中找出明确离开项目的请求。
 * 绝对路径或任一目录段为 .. 时返回 true；符号链接的实际目标还需要后续解析。
 */
function leavesProject(path: string): boolean {
  if (isAbsolute(path) || win32.isAbsolute(path)) return true;
  return path.replaceAll("\\", "/").split("/").some((segment) => segment === "..");
}

/**
 * 检查路径中有没有禁止访问的环境配置文件名。
 * 传入已经统一为 / 分隔的路径；任一段是 .env、.env.* 或 .envrc 就返回 true，匹配不区分大小写。
 */
function containsEnvironmentFile(path: string): boolean {
  return path.toLowerCase().split("/").some((segment) =>
    segment === ".env" || segment.startsWith(".env.") || segment === ".envrc");
}

/**
 * 找出路径中第一个需要确认的目录名。
 *
 * .git、.agents 或 .codex 返回对应名称；没有则返回 null。
 * 本节用它说明为什么要询问，还不保存会话批准。05.3 会补上目录前的完整项目内路径，
 * 以便区分位置不同但同名的目录。
 */
function findApprovalDirectory(path: string): string | null {
  return path.toLowerCase().split("/").find((segment) => APPROVAL_DIRECTORIES.has(segment)) ?? null;
}

/**
 * 解析真实目标，避免普通文件名隐藏了受保护文件。
 *
 * - 传入模型路径和项目根目录；解析成功时返回相对于真实项目根的路径。
 * - 真实目标在项目外时返回 null，让策略拒绝；无法解析时保留原路径，后续由工具报告访问失败。
 * - 这次检查还没有打开文件读取正文。检查与后续打开之间仍可能发生替换，不能当成系统沙箱。
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
 * 检查一次工具请求应该直接执行、询问还是拒绝。
 *
 * - 接收尚未执行的 ToolCall 和项目根目录，返回决定及原因。
 * - 先拒绝未知工具、无效权限参数、越界和受保护文件，再识别需要确认的元数据读取。
 * - ask 还带上文件说明和批准记录；普通项目读取返回 allow。
 * - 这里只检查权限，即使允许，具体工具仍要检查全部参数和当前文件。
 */
export async function decideToolPermission(
  call: ToolCall,
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
      return {
        action: "ask",
        reason: `读取 ${directory} 项目元数据需要用户确认`,
        resource: actualPath === normalized ? normalized : `${normalized} -> ${actualPath}`,
        scope: `read_file:${directory}/**`,
      };
    }
  }

  return { action: "allow", reason: "项目内普通只读工具" };
}
