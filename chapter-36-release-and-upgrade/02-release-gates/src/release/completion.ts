/**
 * 36.2 发布门禁 | [KEEP] release/completion.ts
 *
 * 学习目标：生成 shell 可注册的候选项，而不改写用户启动文件。
 * 输入：bash 或 zsh 与主 CLI 选项名；输出：脚本文本。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   shell 名 -> 选对应的注册协议 -> stdout / 拒绝未知 shell
 * 状态：不读模型配置、不联网、不执行输出的脚本。
 * 观察：用户 source 后 Tab 提供选项与子命令名；参数值仍由用户填写。
 */
import { UserFacingError } from "../errors.js";

// [KEEP 来自 36.1] 候选项来自真实 Commander 选项；子命令由本地入口明确列出。
/** 为 Bash/Zsh 输出适合各自补全协议的静态脚本；只接受安全的命令名称。 */
export function completionScript(shell: string | undefined, options: string[], commands: string[] = ["code", "schedule", "completion"]): string {
  const words = [...new Set([...commands, ...options])];
  if (words.some(word => !/^[a-zA-Z0-9_-]+$/.test(word))) throw new UserFacingError("补全候选包含不支持的字符。");
  const candidates = words.join(" ");
  if (shell === "bash") return `# hello-my-agent Bash completion\n_hello_my_agent() {\n  local current=\"\u0024{COMP_WORDS[COMP_CWORD]}\"\n  COMPREPLY=( $(compgen -W '${candidates}' -- \"$current\") )\n}\ncomplete -F _hello_my_agent hello-my-agent\n`;
  if (shell === "zsh") return `#compdef hello-my-agent\n# 先运行 autoload -Uz compinit; compinit，再 source 此文件。\n_hello_my_agent() {\n  local -a candidates\n  candidates=(${words.map(word => `'${word}'`).join(" ")})\n  compadd -- \u0024{candidates[@]}\n}\ncompdef _hello_my_agent hello-my-agent\n`;
  throw new UserFacingError("用法：hello-my-agent completion bash|zsh。");
}
