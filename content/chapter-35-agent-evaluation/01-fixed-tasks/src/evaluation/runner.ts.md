# runner.ts

`chapter-35-agent-evaluation/01-fixed-tasks/src/evaluation/runner.ts`

<a href="./content/chapter-35-agent-evaluation/01-fixed-tasks/src/evaluation/runner.ts" download>下载原始文件</a>

```typescript
/**
 * 35.1 固定任务与离线回放 | [NEW] evaluation/runner.ts
 * 学习目标：在真实临时项目运行核心，独立核对计算、改动和测试事实
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：新建起点 -> runAgent -> 等待结束 -> 独立判分 -> 报告。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [NEW 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { release } from "node:os";
import { runAgent } from "../agent/run.js";
import type { AgentEvent } from "../agent/events.js";
import type { Model } from "../models/client.js";
import { ALLOWED_TOOLS, FIXTURE_FILES, TASK_INPUT, TASK_VERSION } from "./fixtures.js";
import { CALCULATION_VERSION, checkCalculations } from "./checks.js";
import { createReplay, type Scenario } from "./replay.js";

export type CaseReport = {
  version: 1; taskVersion: string; calculationVersion: string; scenario: Scenario;
  mode: "offline"; workspace: string; reportPath: string;
  platform: { os: string; release: string; arch: string; node: string };
  startHashes: Record<string, string>; changedPaths: string[];
  outcome: "completed" | "cancelled" | "error";
  taskPassed: boolean; expectationPassed: boolean; testSucceeded: boolean;
  checks: { name: string; passed: boolean }[];
  modelCalls: number; toolResults: number; toolErrors: number; refusals: number;
  elapsedMs: number; inputTokens: number | null; outputTokens: number | null; costEstimateUsd: number | null;
};
// process.chdir是进程全局状态；同进程的两个评测不允许交错进入不同项目。
let evaluating = false;

/** 不跟随符号链接；记录类型和字节哈希，新增、删除与普通文件改动都能被发现。 */
async function inventory(root: string, prefix = ""): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(output, await inventory(root, name));
    else output[name] = entry.isFile() ? createHash("sha256").update(await readFile(join(root, name))).digest("hex") : "not-regular-file";
  }
  return output;
}

/**
 * 运行一个样本，不接触当前项目；只批准固定实现的精确编辑与已知test脚本。
 * 先等核心结束再核对磁盘；文件保留，报告写在样本外面，异常不自动回滚。
 */
export async function evaluateCase(outputDirectory: string, scenario: Scenario = "repair"): Promise<CaseReport> {
  if (evaluating) throw new Error("同一进程中的评测必须串行执行。");
  evaluating = true;
  const previous = process.cwd();
  const started = performance.now();
  try {
    const parent = resolve(outputDirectory);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(parent, `${scenario}-`));
    const workspace = join(directory, "workspace");
    for (const [name, content] of Object.entries(FIXTURE_FILES)) {
      await mkdir(dirname(join(workspace, name)), { recursive: true });
      await writeFile(join(workspace, name), content, { flag: "wx" });
    }
    const startHashes = await inventory(workspace);
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    let outcome: CaseReport["outcome"] = "error";
    process.chdir(workspace);
    try {
      await runAgent(createReplay(scenario), [], TASK_INPUT, controller.signal, event => { events.push(event); },
        async request => {
          const input: unknown = JSON.parse(request.call.arguments);
          const args = input as Record<string, unknown>;
          const allowed = (request.call.name === "edit_file" && args.path === "src/add.mjs")
            || (request.call.name === "check_project" && args.script === "test" && Object.keys(args).length === 1);
          return allowed ? { decision: "allow_once" } : { decision: "deny", reason: "固定评测只允许修改实现并运行原测试。" };
        }, new Set(), { toolAllowlist: ALLOWED_TOOLS, maxModelCalls: 8,
          diagnosticDirectory: join(directory, "diagnostics"), toolResultDirectory: join(directory, "tool-results") });
      outcome = "completed";
    } catch { outcome = controller.signal.aborted ? "cancelled" : "error"; }
    const checks = await checkCalculations(workspace);
    const after = await inventory(workspace);
    const changedPaths = [...new Set([...Object.keys(startHashes), ...Object.keys(after)])]
      .filter(name => startHashes[name] !== after[name]).sort();
    const testSucceeded = events.some(event => event.type === "tool_finish" && event.call.name === "check_project"
      && event.outcome === "success" && !event.result.isError && event.result.metadata?.kind === "run_command"
      && event.result.metadata.exitCode === 0);
    const taskPassed = outcome === "completed" && checks.every(item => item.passed) && testSucceeded
      && changedPaths.every(name => name === "src/add.mjs");
    const report: CaseReport = {
      version: 1, taskVersion: TASK_VERSION, calculationVersion: CALCULATION_VERSION, scenario,
      mode: "offline", workspace, reportPath: join(directory, "report.json"),
      platform: { os: process.platform, release: release(), arch: process.arch, node: process.version },
      startHashes, changedPaths, outcome, taskPassed, expectationPassed: taskPassed, testSucceeded, checks,
      modelCalls: events.filter(event => event.type === "model_start").length,
      toolResults: events.filter(event => event.type === "tool_finish").length,
      toolErrors: events.filter(event => (event.type === "tool_finish" || event.type === "tool_prepare") && event.outcome === "error").length,
      refusals: events.filter(event => event.type === "approval_finish" && event.response.decision === "deny").length,
      elapsedMs: Math.round(performance.now() - started), inputTokens: null, outputTokens: null, costEstimateUsd: null,
    };
    await writeFile(report.reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return report;
  } finally { process.chdir(previous); evaluating = false; }
}

/** 串行入口在35.2扩展故障样本；每次返回与磁盘报告相同的事实。 */
export async function runEvaluation(suite: "offline", directory: string) {
  const cases = [await evaluateCase(directory)];
  return { suite, passed: cases.every(item => item.expectationPassed), cases };
}
```
