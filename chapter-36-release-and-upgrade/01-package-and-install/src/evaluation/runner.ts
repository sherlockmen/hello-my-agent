/**
 * 36.1 安装包与补全 | [KEEP] evaluation/runner.ts
 * 学习目标：在真实临时项目运行核心，独立核对计算、改动和测试事实
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：新建起点 -> runAgent -> 等待结束 -> 独立判分 -> 报告。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { release } from "node:os";
import { runAgent } from "../agent/run.js";
import type { AgentEvent } from "../agent/events.js";
import type { Model } from "../models/client.js";
import { ALLOWED_TOOLS, FIXTURE_FILES, TASK_INPUT, TASK_VERSION } from "./fixtures.js";
import { CALCULATION_VERSION, checkCalculations } from "./checks.js";
// [KEEP 来自 35.2] 终端机制在本机执行，不需要模型。
import { runTerminalProbes } from "./terminal.js";
import { SCENARIOS, createReplay, type Scenario } from "./replay.js";

export type CaseReport = {
  version: 1; taskVersion: string; calculationVersion: string; scenario: Scenario;
  mode: "offline" | "live"; model: { provider: string; name: string } | null;
  toolAllowlist: readonly string[]; maxModelCalls: number; workspace: string; reportPath: string;
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
export async function evaluateCase(outputDirectory: string, scenario: Scenario = "repair", model?: Model, signal?: AbortSignal): Promise<CaseReport> {
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
    // [KEEP 来自 35.3] 外部取消进入同一核心；判分在核心真实收尾后使用新的独立信号。
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    let outcome: CaseReport["outcome"] = "error";
    process.chdir(workspace);
    try {
      await runAgent(model ?? createReplay(scenario), [], TASK_INPUT, controller.signal, event => {
          events.push(event);
          // [KEEP 来自 35.2] 真实写入已经成功，随后取消不把已写文件恢复。
          if (scenario === "cancel-after-edit" && event.type === "tool_finish"
              && event.call.name === "edit_file" && event.outcome === "success" && !event.result.isError) controller.abort();
        },
        async request => {
          const input: unknown = JSON.parse(request.call.arguments);
          const args = input as Record<string, unknown>;
          const allowed = (request.call.name === "edit_file" && args.path === "src/add.mjs")
            || (request.call.name === "check_project" && args.script === "test" && Object.keys(args).length === 1);
          return allowed && scenario !== "denied" ? { decision: "allow_once" } : { decision: "deny", reason: "固定评测只允许修改实现并运行原测试。" };
        }, new Set(), { toolAllowlist: ALLOWED_TOOLS, maxModelCalls: 8,
          diagnosticDirectory: join(directory, "diagnostics"), toolResultDirectory: join(directory, "tool-results") });
      outcome = "completed";
    } catch { outcome = controller.signal.aborted ? "cancelled" : "error"; }
    finally { signal?.removeEventListener("abort", cancel); }
    const checks = await checkCalculations(workspace);
    const after = await inventory(workspace);
    const changedPaths = [...new Set([...Object.keys(startHashes), ...Object.keys(after)])]
      .filter(name => startHashes[name] !== after[name]).sort();
    const testSucceeded = events.some(event => event.type === "tool_finish" && event.call.name === "check_project"
      && event.outcome === "success" && !event.result.isError && event.result.metadata?.kind === "run_command"
      && event.result.metadata.exitCode === 0);
    const taskPassed = outcome === "completed" && checks.every(item => item.passed) && testSucceeded
      && changedPaths.every(name => name === "src/add.mjs");
    // [KEEP 来自 35.3] 核心事件已经累计过；取最后一份，不能把多个累计值再次相加。
    const usage = events.filter((event): event is Extract<AgentEvent, { type: "model_usage" }> => event.type === "model_usage").at(-1);
    const report: CaseReport = {
      version: 1, taskVersion: TASK_VERSION, calculationVersion: CALCULATION_VERSION, scenario,
      mode: model ? "live" : "offline", model: model?.profile ? { provider: model.profile.provider, name: model.profile.model } : null,
      toolAllowlist: [...ALLOWED_TOOLS], maxModelCalls: 8, workspace, reportPath: join(directory, "report.json"),
      platform: { os: process.platform, release: release(), arch: process.arch, node: process.version },
      startHashes, changedPaths, outcome, taskPassed, expectationPassed: taskPassed, testSucceeded, checks,
      modelCalls: events.filter(event => event.type === "model_start").length,
      toolResults: events.filter(event => event.type === "tool_finish").length,
      toolErrors: events.filter(event => (event.type === "tool_finish" || event.type === "tool_prepare") && event.outcome === "error").length,
      refusals: events.filter(event => event.type === "approval_finish" && event.response.decision === "deny").length,
      elapsedMs: Math.round(performance.now() - started), inputTokens: model ? usage?.inputTokens ?? null : null, outputTokens: model ? usage?.outputTokens ?? null : null,
      costEstimateUsd: model ? usage?.costEstimateUsd ?? null : null,
    };
    // [KEEP 来自 35.2] 回归通过指符合样本预期，修复任务成功仍由taskPassed表示。
    const unchanged = changedPaths.length === 0;
    if (scenario === "claim-only") report.expectationPassed = outcome === "completed" && unchanged && !taskPassed && report.toolResults === 0;
    if (scenario === "denied" || scenario === "protected-edit") report.expectationPassed = outcome === "completed" && unchanged && report.refusals > 0 && !taskPassed;
    if (scenario === "missing-file") report.expectationPassed = outcome === "completed" && unchanged && report.toolErrors > 0 && !taskPassed;
    if (scenario === "cancel-after-edit") report.expectationPassed = outcome === "cancelled" && changedPaths.length === 1
      && changedPaths[0] === "src/add.mjs" && checks.every(item => item.passed) && !testSucceeded && !taskPassed;
    await writeFile(report.reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return report;
  } finally { process.chdir(previous); evaluating = false; }
}

/** 串行执行不同起点；终端探针也必须完成才报告整组预期通过。 */
export async function runEvaluation(suite: "offline" | "regression" | "live", directory: string, model?: Model, signal?: AbortSignal) {
  if (suite === "live" && !model) throw new Error("真实评测必须由调用者显式提供模型。");
  if (suite !== "live" && model) throw new Error("离线评测不能接入真实模型。");
  const cases: CaseReport[] = [];
  for (const scenario of suite === "regression" ? SCENARIOS : ["repair"] as const) {
    cases.push(await evaluateCase(directory, scenario, suite === "live" ? model : undefined, signal));
  }
  const terminal = suite === "regression" ? await runTerminalProbes(resolve(directory)) : [];
  const report = { suite, passed: cases.every(item => item.expectationPassed) && terminal.every(item => item.passed), cases, terminal };
  // [KEEP 来自 35.3] 保存整组结果，终端探针也留下可比较的记录，不覆盖旧运行。
  const reportDirectory = await mkdtemp(join(resolve(directory), "suite-"));
  await writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return report;
}
