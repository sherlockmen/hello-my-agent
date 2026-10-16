/**
 * 33.3 诊断隔离状态并验证不同通道 | [KEEP] sandbox/policy.ts
 * 学习目标：把真实项目根转成独立的文件规则，网络默认全部拒绝。
 * 输入：已解析的项目绝对路径；输出：SDK 配置，不启动命令。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：项目根 -> 字面路径列表 -> 本次包装配置。
 * 边界：读取默认允许；列出的秘密路径被拒绝，不扫描任意文件内容或所有嵌套 .env。
 * 写入还有 SDK 自带的设备、临时目录和日志目录例外，诊断时原样列出。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { FilesystemPathEntry, SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

// [KEEP 来自 33.1] 项目名中的通配字符必须按字面解释，不能扩大允许范围。
/**
 * 将一个绝对路径标为字面值；规则不把路径里的星号或方括号展开。
 */
function literal(path: string): FilesystemPathEntry { return { path, literal: true }; }

/**
 * 为一条命令建立自己的工作区规则，不修改共享运行时的当前工作区。
 * allowWrite 只加入项目根；denyWrite 优先，阻止覆盖凭据和项目控制文件。
 * read 默认允许以启动系统工具；这些精确位置拒绝读写，不能替代秘密识别。
 */
export function sandboxPolicy(root: string): SandboxRuntimeConfig {
  const home = homedir();
  const protectedPaths = [
    ...[".env", ".env.local", ".env.production", ".envrc", "secrets", ".agents", ".codex", ".hello-my-agent"].map(name => join(root, name)),
    ...[".ssh", ".aws", ".gnupg", ".npmrc", ".config/gcloud"].map(name => join(home, name)),
  ].map(literal);
  return {
    network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true,
      allowUnixSockets: [], allowAllUnixSockets: false, allowLocalBinding: false },
    filesystem: { denyRead: protectedPaths, allowWrite: [literal(root)],
      denyWrite: [...protectedPaths, literal(join(root, ".git"))] },
  };
}
