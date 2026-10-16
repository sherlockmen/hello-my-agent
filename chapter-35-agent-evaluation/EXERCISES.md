# 第 35 章练习：增加一个独立判分点

从 35.3 的完整源码继续。我们把最终计算检查放在独立的 TypeScript 模块中，练习只增加这一层的覆盖，不修改模型回放，也不放宽文件与真实测试要求。

## 练习一：增加小数检查

为固定的加法任务再检查 `1.5 + 2.25 = 3.75`。它应当与正数、负数、零三个检查一起运行；任一失败就使独立计算检查失败。判分版本随之升级，避免新旧报告被误当同一实验。

## 练习二：防止检查点提前终止

让每个检查独立捕获异常。前一个断言失败时，后面的检查仍要留下自己的名称与结果，否则一份报告只能告诉我们第一个错误，不能说明其他样本是否检查过。

## 练习三：验证“看起来正确”的错误实现

临时写一个只对前三个样本返回正确值、对小数仍返回减法的实现。先预测报告：前三项通过，小数失败；完成后再次运行真实加法实现，要求四项都通过。这个练习说明固定样本的覆盖范围由我们写出的检查决定，不能把三项通过理解成所有数字都正确。

## 完整答案

替换 `src/evaluation/checks.ts` 的完整内容；`runner.ts` 继续调用同一个检查入口，自动把四项结果与 `decimal-v2` 写进报告。项目起点没有改变，因此任务版本仍为 `add-v1`；变化的是判分版本。

<!-- answer-file: src/evaluation/checks.ts -->
```typescript
/**
 * 35.3 练习：增加小数判分 | [CHANGED] evaluation/checks.ts
 * 学习目标：用评测器持有的计算断言检查真实实现，不信任项目测试被改写后的结论
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：固定断言 -> 已有隔离命令执行器 -> 独立结果。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [CHANGED 35.3] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { prepareRunCommand } from "../tools/run-command.js";

export type CalculationCheck = { name: string; passed: boolean };
export const CALCULATION_VERSION = "decimal-v2";
const CASES = [
  { name: "positive", a: 2, b: 3, expected: 5 },
  { name: "negative", a: -2, b: -3, expected: -5 },
  { name: "zero", a: 0, b: 0, expected: 0 },
  { name: "decimal", a: 1.5, b: 2.25, expected: 3.75 },
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
```

## 运行验证

```bash
node tests/verify-chapter-35.mjs
```

验收脚本把本页答案装入临时源码，独立编译后分别加载真实加法实现与刻意投机的实现，核对四个检查的结果。正式源码不自动包含练习答案。

[返回本章](README.md)
