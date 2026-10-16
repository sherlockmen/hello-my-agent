# code-intelligence.ts

`chapter-32-code-intelligence/02-lsp-navigation/src/tools/code-intelligence.ts`

<a href="./content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/code-intelligence.ts" download>下载原始文件</a>

```typescript
/**
 * 32.2 用语言服务定位符号 | [NEW] tools/code-intelligence.ts
 * 输入：模型JSON与本地客户端；输出：带源码摘要的结构化符号位置。
 * JSON -> 固定action/位置校验 -> 本地LanguageService -> 工具消息 -> 模型读取目标
 * 参数错误/服务失败 -> ToolError；用户取消 -> 原信号向任务外传播。
 * 只读意图不允许模型选择服务命令或执行任意workspace/executeCommand。
 */
import { ToolError } from "../errors.js";
import type { CodeAction, LanguageService } from "../language-service/client.js";
import type { ToolExecutionResult } from "./types.js";

// [NEW 32.2] 工具位置从1开始，适合与read_file输出对照。
export const codeIntelligenceDefinition = {
  name: "code_intelligence", description: "读取当前JS/TS源码的定义或引用；行列从1开始，列按UTF-16计数。失败可退回grep/read_file或批准check_project。",
  inputSchema: { type: "object" as const, properties: {
    action: { type: "string" as const, enum: ["definition", "references"] },
    path: { type: "string" as const }, line: { type: "integer" as const, minimum: 1 }, column: { type: "integer" as const, minimum: 1 },
  }, required: ["action", "path", "line", "column"], additionalProperties: false },
};

/** 完整校验工具输入；只有本地引用能够选择实际语言服务。 */
export async function codeIntelligenceTool(json: string, service: LanguageService | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  let input: { action: CodeAction; path: string; line?: number; column?: number };
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["action", "path", "line", "column"].includes(key)) || !["definition", "references"].includes(value.action) || typeof value.path !== "string" || !value.path.trim() || !Number.isInteger(value.line) || value.line < 1 || !Number.isInteger(value.column) || value.column < 1) throw new Error();
    input = value;
  } catch { throw new ToolError("code_intelligence需要definition/references、path和从1开始的line/column。"); }
  if (!service) throw new ToolError("本地语言服务未绑定；可改用grep/read_file或批准check_project。");
  const result = await service.query(input.action, input.path, input.line, input.column, signal);
  return { content: JSON.stringify(result, null, 2), metadata: { kind: "code_intelligence", result } };
}
```
