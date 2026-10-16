# commands.ts

`chapter-31-extension-packages/01-install-local-package/src/extensions/commands.ts`

<a href="./content/chapter-31-extension-packages/01-install-local-package/src/extensions/commands.ts" download>下载原始文件</a>

```typescript
/**
 * 31.1 安装本地扩展包 | [NEW] extensions/commands.ts
 * 学习目标：把扩展管理限制为本地CLI/TUI入口，不注册成模型工具。
 * 输入：本地命令、当前模式和取消信号；输出：状态文本；失败交给界面显示。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   命令 -> 严格参数个数 -> 同一个管理器方法 -> 完成/失败/取消 -> 本地反馈
 * 边界：enable是显式本地授权，包说明、模型文字与恢复的历史都不能触发它。
 */
// [NEW 31.1] 本地命令参数校验与管理器分发。

import type { ExtensionManager } from "./manager.js";
import { ToolError } from "../errors.js";

/** CLI传参数数组保留空格路径；TUI只支持不带空格的包ID，不接受安装路径。 */
export async function extensionCommand(input: string[] | string, manager: ExtensionManager | undefined, mode: string, signal: AbortSignal): Promise<string> {
  if (!manager) throw new ToolError("当前模型未连接扩展管理器。");
  const args = typeof input === "string" ? input.trim().split(/\s+/).slice(1) : input;
  const [command = "list", argument] = args;
  if (command === "list" && args.length <= 1) return (await manager.list(signal)).join("\n");
  if (args.length !== 2 || !argument) throw new ToolError("用法：extension list | install <目录>。");
  if (command === "install" && Array.isArray(input)) return manager.install(argument, signal);
  throw new ToolError("未知扩展命令；install只在CLI中接收明确的本地目录。");
}
```
