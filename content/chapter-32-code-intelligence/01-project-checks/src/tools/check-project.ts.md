# check-project.ts

`chapter-32-code-intelligence/01-project-checks/src/tools/check-project.ts`

<a href="./content/chapter-32-code-intelligence/01-project-checks/src/tools/check-project.ts" download>下载原始文件</a>

```typescript
/**
 * 32.1 把检查结果交回模型 | [NEW] tools/check-project.ts
 * 输入：固定的test/typecheck与取消信号；输出：脚本预览和获批执行闭包。
 * 状态：准备只读；批准后包文件变化即失败；执行后的副作用不回滚。
 * JSON -> 声明存在？-- 否 -> ToolError -> 模型可继续调查
 *                  +-- 是 -> 预览 -> 批准 -> 包文件相同？-- 否 -> 错误
 *                                                     +-- 是 -> 原命令执行器 -> 真实结果
 */
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { prepareRunCommand } from "./run-command.js";
import { findProjectRoot } from "./workspace.js";
import type { PreparedToolCall } from "./types.js";

// [NEW 32.1] 模型只能选择检查意图，不能提供shell片段。
export const checkProjectDefinition = {
  name: "check_project",
  description: "逐次批准后运行项目package.json里的test或typecheck脚本；失败结果用于继续修复。",
  inputSchema: { type: "object" as const, properties: {
    script: { type: "string" as const, enum: ["test", "typecheck"] },
  }, required: ["script"], additionalProperties: false },
};

/** 只准备项目检查；批准后复核展示的package.json，再调用原有命令执行器。 */
export async function prepareCheckProject(json: string, projectRoot = findProjectRoot(), signal?: AbortSignal): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  let input: { script: "test" | "typecheck" };
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !["test", "typecheck"].includes(value.script)) throw new Error();
    input = value;
  } catch { throw new ToolError("check_project只接受script:test或typecheck。"); }
  const root = await realpath(projectRoot), manifest = join(root, "package.json");
  const original = await readFile(manifest, "utf8").catch(() => { throw new ToolError("项目根目录缺少可读的package.json。"); });
  let scripts: Record<string, unknown>;
  try { scripts = JSON.parse(original).scripts; }
  catch { throw new ToolError("package.json不是有效JSON。"); }
  if (!scripts || typeof scripts[input.script] !== "string" || !(scripts[input.script] as string).trim()) throw new ToolError(`项目未声明${input.script}脚本；请先读package.json确认检查方式。`);
  const prepared = await prepareRunCommand(JSON.stringify({ command: `npm run ${input.script}`, cwd: ".", timeout_ms: 30_000 }), root, signal);
  const hooks = [`pre${input.script}`, input.script, `post${input.script}`].filter(name => typeof scripts[name] === "string").map(name => `${name}: ${scripts[name]}`).join("\n");
  return { preview: `项目检查（会执行项目代码）：\n${hooks}\n\n${prepared.preview}`, async execute(signal) {
    signal.throwIfAborted();
    if (await readFile(manifest, "utf8") !== original) throw new ToolError("package.json在预览后变化，请重新提出检查并批准。");
    return prepared.execute(signal);
  } };
}
```
