/**
 * 05.3 让 Agent 记住本次运行的批准 | [CHANGED] permissions/policy.ts
 *
 * 学习目标：先检查禁止规则，再看看这次读取是否已经取得会话批准。
 * 输入：模型给出的工具名、JSON 参数和项目位置。05.3 还会收到本次运行已保存的批准记录。
 * 输出：allow、ask 或 deny，并带上原因；这里只检查路径，不读取正文或执行工具。
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
 * 先拒绝明确禁止的请求，再处理需要确认的读取，最后才允许普通读取。
 * 策略只查询 Set。用户输入 s 后，Agent Loop 才把策略生成的那条记录加入 Set。
 * 运行观察：普通源码可以直接读取，.env 被拒绝，.git 文件已有相同批准记录时不再询问。
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
 * 找出需要确认的目录，并保留它在项目中的位置。
 *
 * - .git/HEAD 返回 .git，packages/demo/.git/config 返回 packages/demo/.git。
 * - 找不到受保护目录时返回 null；有多个时取路径中第一个。
 * - 两个目录都叫 .git，也不能共用批准，所以返回完整相对目录，而不只是最后的名称。
 */
function findApprovalDirectory(path: string): string | null {
  const segments = path.split("/");
  const index = segments.findIndex((segment) => APPROVAL_DIRECTORIES.has(segment.toLowerCase()));
  return index === -1 ? null : segments.slice(0, index + 1).join("/");
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
 * 先检查禁止规则，再判断这次读取是否已经获准。
 *
 * - 接收尚未执行的 ToolCall、当前批准记录和项目根目录，返回决定及原因。
 * - 需要确认的读取会生成工具与目录记录；Set 中存在同一字符串就允许，否则返回 ask。
 * - 策略只查询 Set，不新增批准。用户选择 s 后，保存工作由 Agent Loop 完成。
 * - 即使已有许可，具体工具仍要检查全部参数和当前文件。
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
