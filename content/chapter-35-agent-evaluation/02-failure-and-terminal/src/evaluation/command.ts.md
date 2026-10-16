# command.ts

`chapter-35-agent-evaluation/02-failure-and-terminal/src/evaluation/command.ts`

<a href="./content/chapter-35-agent-evaluation/02-failure-and-terminal/src/evaluation/command.ts" download>下载原始文件</a>

```typescript
/**
 * 35.2 故障与终端回归 | [CHANGED] evaluation/command.ts
 * 学习目标：在任何模型配置读取之前完成离线实验，拒绝混用其他动作
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：校验独占选项 -> 离线评测 -> 报告位置与退出状态。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { resolve } from "node:path";
import { runEvaluation } from "./runner.js";
import { UserFacingError } from "../errors.js";

/** 校验整组选项后才创建样本；不存在的suite不能悄悄变成在线请求。 */
export async function runEvaluationCommand(options: Record<string, unknown>): Promise<void> {
  const allowed = new Set(["evaluate", "evaluationDir", "output"]);
  if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
    && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
    throw new UserFacingError("--evaluate 请单独使用，可配合 --evaluation-dir。");
  }
  // [CHANGED 35.2] 两种入口都不创建真实模型。
  if (options.evaluate !== "offline" && options.evaluate !== "regression") throw new UserFacingError("评测类型必须为 offline 或 regression。");
  const directory = resolve(typeof options.evaluationDir === "string" ? options.evaluationDir : "evaluation-results");
  const report = await runEvaluation(options.evaluate, directory);
  for (const item of report.cases) console.log(`${item.expectationPassed ? "通过" : "失败"} ${item.scenario}；报告：${item.reportPath}`);
  for (const item of report.terminal) console.log(`${item.passed ? "通过" : "失败"} terminal/${item.name}`);
  if (!report.passed) process.exitCode = 1;
}
```
