/**
 * 35.2 故障与终端回归 | [KEEP] evaluation/checks.ts
 * 学习目标：用评测器持有的计算断言检查真实实现，不信任项目测试被改写后的结论
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：固定断言 -> 已有隔离命令执行器 -> 独立结果。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { prepareRunCommand } from "../tools/run-command.js";

export type CalculationCheck = { name: string; passed: boolean };
export const CALCULATION_VERSION = "integer-v1";
const CASES = [
  { name: "positive", a: 2, b: 3, expected: 5 },
  { name: "negative", a: -2, b: -3, expected: -5 },
  { name: "zero", a: 0, b: 0, expected: 0 },
];

/** shell单引号保护字面参数，路径或代码中的引号不能变成命令。 */
function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

/**
 * 每个断言在新的受既有隔离限制的Node进程中运行；不在评测宿主加载模型修改的代码。
 * 不执行模型给出的命令；超时、启动错误或非零退出均给该项明确失败，继续检查其余项。
 */
export async function checkCalculations(root: string): Promise<CalculationCheck[]> {
  const checks: CalculationCheck[] = [];
  for (const item of CASES) {
    try {
      const code = `import assert from "node:assert/strict";import { add } from "./src/add.mjs";assert.equal(add(${item.a},${item.b}),${item.expected});`;
      const prepared = await prepareRunCommand(JSON.stringify({ command: `${quote(process.execPath)} --input-type=module -e ${quote(code)}`, cwd: ".", timeout_ms: 3000 }), root);
      const result = await prepared.execute(new AbortController().signal);
      const metadata = result.metadata;
      checks.push({ name: item.name, passed: !result.isError && metadata?.kind === "run_command" && metadata.exitCode === 0 });
    } catch { checks.push({ name: item.name, passed: false }); }
  }
  return checks;
}
