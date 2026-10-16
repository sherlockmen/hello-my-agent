/**
 * 36.2 发布门禁 | [KEEP] sandbox/runtime.ts
 * 学习目标：应用只使用现成运行时，包装失败时不执行原命令。
 * 输入：原命令、真实项目根和取消信号；输出：带系统限制的启动字符串。
 * 状态：初始化 Promise 在本进程共享；每次包装单独传文件规则，不切换全局工作区。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：依赖检查 -> 初始化 -> 包装 -> 交回进程执行器。
 * 失败：缺依赖、初始化失败或包装无效均抛 ToolError，没有未隔离的降级分支。
 * 清理：CLI 先等待自有后台任务结束，再 reset 共享代理；不撤销已写入文件。
 */
import { realpath } from "node:fs/promises";
import { SandboxManager, getDefaultWritePaths } from "@anthropic-ai/sandbox-runtime";
import { ToolError } from "../errors.js";
import { sandboxPolicy } from "./policy.js";

// [KEEP 来自 33.1] 一次初始化服务多个命令；不在每条命令结束时关闭仍被后台任务使用的代理。
export const sandboxRuntimeVersion = "0.0.79";
let initialization: Promise<void> | undefined;

/**
 * 只检查准备条件，不声称已验证系统限制；不支持平台和依赖错误作为明确失败原因。
 * 当前应用仅接 POSIX 通道，即使 SDK 支持其他平台也不会自动改变应用的进程协议。
 */
export async function sandboxAvailability() {
  const supported = ["darwin", "linux"].includes(process.platform) && SandboxManager.isSupportedPlatform();
  const dependencies = supported ? await SandboxManager.checkDependenciesAsync()
    : { errors: ["本章沙箱执行需要 macOS 或 Linux 的受支持隔离环境。"], warnings: [] };
  return { supported, platform: process.platform, runtime: sandboxRuntimeVersion, ...dependencies,
    defaultWritePaths: getDefaultWritePaths(), initialized: Boolean(initialization) && SandboxManager.isSandboxingEnabled() };
}

/**
 * 首次调用建立 SDK 代理；失败清理后抛错，后续请求可以重新诊断但不会执行原命令。
 * 不绑定单次调用的取消信号，避免一个请求取消时关闭其他调用共享的初始化。
 */
async function ensureSandbox(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const status = await sandboxAvailability();
      if (status.errors.length) throw new ToolError(`隔离不可用：${status.errors.join("；")}。未启动命令。`);
      await SandboxManager.initialize({ network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true },
        filesystem: { denyRead: [], allowWrite: [], denyWrite: [] } });
      if (!SandboxManager.isSandboxingEnabled()) throw new ToolError("隔离运行时未启用，拒绝启动命令。");
    })().catch(async error => {
      try { await SandboxManager.reset(); } finally { initialization = undefined; }
      throw error;
    });
  }
  await initialization;
}

/**
 * 只返回真实包装结果，调用方继续使用原有最小环境、超时、输出和进程清理。
 * 包装前后都检查取消；SDK 返回原命令也视为失败，不能默许未隔离执行。
 */
export async function wrapSandboxCommand(command: string, projectRoot: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    const root = await realpath(projectRoot);
    await ensureSandbox();
    signal?.throwIfAborted();
    const wrapped = await SandboxManager.wrapWithSandbox(command, "/bin/sh", sandboxPolicy(root), signal);
    signal?.throwIfAborted();
    if (!SandboxManager.isSandboxingEnabled() || !wrapped.trim() || wrapped === command) {
      throw new ToolError("隔离包装未生效，拒绝启动原命令。");
    }
    return wrapped;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ToolError) throw error;
    throw new ToolError(`隔离启动准备失败：${error instanceof Error ? error.message : String(error)}。未降级执行。`);
  }
}

/**
 * 仅由已等完自有命令的宿主调用；等待初始化收尾再关闭 SDK 资源。
 */
export async function closeSandbox(): Promise<void> {
  if (!initialization) return;
  try { await initialization; } catch { /* 初始化失败已清理；仍统一结束本次生命周期。 */ }
  await SandboxManager.reset();
  initialization = undefined;
}
