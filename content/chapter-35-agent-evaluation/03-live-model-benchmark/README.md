# 35.3 显式运行真实模型评测

[上一节：故障与终端回归](/content/chapter-35-agent-evaluation/02-failure-and-terminal/README.md) · [本章首页](/content/chapter-35-agent-evaluation/README.md) · [练习与答案](/content/chapter-35-agent-evaluation/EXERCISES.md)

## 问题：回放通过，真实模型会做同样的决定吗

离线回放提前规定了要读取什么、如何替换以及何时测试。它帮助我们找到核心回归，却没有考验模型能不能自行发现减法错误、选对工具并在真实结果之后继续。现在我们保持项目、要求和判分不变，只把回放对象换成已有的模型客户端。

这种比较才有清楚的含义：两次面对相同缺陷、相同允许改动和相同最终检查，差别在于工具决定由本地脚本给出，还是由所选模型给出。如果任务失败，我们再结合工具错误和改动清单判断原因，不以模型最后说了什么替代检查。

## 在线入口为什么必须明确选择

普通离线评测不读取模型密钥，也不会构造真实客户端。只有用户执行 `--evaluate live`，入口才按已有规则读取配置并创建模型。评测器不自动把离线失败交给远端重跑，也不扫描多个模型；每次选择只运行一个固定任务。

这不是新的模型协议。OpenAI 与 Anthropic 仍经过第 23 章统一客户端，超时、有限传输重试和工具结果回传沿用前面的实现。评测结束以后，无论成功、错误还是取消，都要关闭本次客户端持有的作业与语言服务；退出最后还要释放既有隔离资源。

在线测试会消耗服务额度。一次任务最多进行 8 轮核心模型决策。第 34 章的有限传输重试发生在同一轮内部，因此 8 轮不等于最多 8 次 HTTP 尝试。报告中的 `modelCalls` 也数核心的 `model_start`，不冒充实际网络尝试次数。单次逻辑请求继续使用已有总超时；这些限制不能换算成固定金额上限。输入长度、输出长度、缓存与服务商计费都有影响，未配置可靠单价时费用保留 `null`。本章不会承诺“最多花多少钱”。

## 模型可以尝试什么，评测器批准什么

真实模型看到样本项目的要求，可以读取实现和测试、请求编辑实现，再请求运行 `test`。它同样可能给错路径、改错内容，或直接作答。核心继续把工具结果交回模型，让它根据事实自行纠正，最多走到本任务的次数限制。

自动批准只针对评测器刚创建的这个样本：实现路径必须精确等于 `src/add.mjs`，测试请求必须精确选择固定的 `test` 脚本。读其他普通文件仍受原来的路径规则约束；通用命令、测试文件修改、外部工具不在这次工具范围内。批准器不把任务文字里的“可以运行”当作对任意命令的授权。

样本是评测器写出的已知内容，测试脚本也由评测器固定。它与陌生仓库自动批准有根本的前提差异：陌生项目的脚本可能做任意操作。这里的有限批准策略只属于固定实验入口，不能复制成普通 Agent 的默认权限。文件工具检查和现有操作系统隔离仍继续生效；报告中的文件对比负责核对结果，不代替执行时限制。

## 报告怎样避免比较错对象

报告首先记录任务版本、起始文件哈希、工具范围、最大请求次数和运行环境。版本或起点不同，就不能把两条记录的耗时和结果直接当作同一个实验。运行时不把密钥、基础地址里的凭据、完整请求和最终文字写入报告，只保留模型公开身份与已有事件中的结构化计数。

任务结果沿用 35.1 的三个条件：独立计算通过，受保护文件保留，Agent 获得真实测试成功结果。除此之外，报告记录总墙钟耗时、模型请求次数、工具完成次数以及服务商实际报告的输入、输出 Token。某次缺失用量，就把总量标为 `null`；不能用“当前已知部分”冒充完整总量。

费用也有相同规则。核心的用量事件已经是截至当时的累计值，评测器取最后一份累计值，避免再把多份累计值相加而重复计算。任一请求用量不完整，后面的累计值继续保留未知；没有可靠费用估计时也保留未知。它仍是客户端根据配置单价计算的估计，不是服务商账单。离线样本没有远端消耗，这些字段保持 `null`，避免把它们与真实在线数据混成一次成本比较。

耗时覆盖创建项目、模型请求、本地工具与最终检查。它能回答“这台机器完成这个固定任务用了多久”，不能单独回答模型首字速度，也不能当作跨平台基准。报告记录 macOS、CPU 架构与 Node 版本；只有实际执行过的平台才有通过记录。

| 我们要比较什么 | 至少同时核对哪些字段 | 不能推出什么 |
| --- | --- | --- |
| 修改前后核心是否退步 | 同版本离线任务、相同预期与终端探针 | 真实模型的判断能力提高了 |
| 两个模型在固定任务上的表现 | 同任务版本、相同起点与判分、各次真实结果 | 一个小任务足以代表全部能力 |
| 同一配置的耗时变化 | 相同平台与 Node、任务版本、多个独立运行 | 单次快一点就是稳定提速 |
| 一次在线任务的消耗 | 用量是否完整、估价是否完整、模型身份 | 客户端估价等于最终账单 |

<!-- media:lesson:start -->
只有显式 live 才创建真实客户端；同任务与判分保持一致。动画中的模型选择只是示意，缺失用量和费用保留未知。

<img src="./content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-cover-a2dc8d8d1c.png" data-gif-src="./content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-a2fe58fb28.gif" data-cover="./content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-cover-a2dc8d8d1c.png" data-no-zoom alt="换成真实模型，怎样仍在比较同一个任务？">

[静态流程图](/content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-flow-a0cf2dd95c.png.md) · [静态封面](/content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-cover-a2dc8d8d1c.png.md) · [查看完整静态分镜](/content/chapter-35-agent-evaluation/03-live-model-benchmark/assets/explicit-live-comparison-storyboard-c8279ea873.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- changes:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/evaluation/runner.ts](/content/chapter-35-agent-evaluation/03-live-model-benchmark/src/evaluation/runner.ts.md) | 串行创建项目、等待真实核心收尾，再独立判分并保存报告 |
| 修改 | [src/evaluation/command.ts](/content/chapter-35-agent-evaluation/03-live-model-benchmark/src/evaluation/command.ts.md) | 校验独占选项，运行所选实验，显示结果并等待资源收尾 |
| 修改 | [src/cli.ts](/content/chapter-35-agent-evaluation/03-live-model-benchmark/src/cli.ts.md) | 在普通聊天配置前接通独占评测入口，保留其他动作的原有路径 |
<!-- changes:end -->

## 动手构建

从 35.2 的完整源码继续，在本节目录 `src/` 按下面顺序新增或替换完整文件。其他文件保留上一节内容；配套仓库已经提供本节的独立完整快照。

<!-- source:start -->

<!-- build-file: src/evaluation/runner.ts -->
<details>
<summary>src/evaluation/runner.ts 完整文件</summary>

```typescript
/**
 * 35.3 显式真实模型评测 | [CHANGED] evaluation/runner.ts
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
    // [CHANGED 35.3] 外部取消进入同一核心；判分在核心真实收尾后使用新的独立信号。
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
    // [CHANGED 35.3] 核心事件已经累计过；取最后一份，不能把多个累计值再次相加。
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
  // [CHANGED 35.3] 保存整组结果，终端探针也留下可比较的记录，不覆盖旧运行。
  const reportDirectory = await mkdtemp(join(resolve(directory), "suite-"));
  await writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return report;
}
```
</details>

<!-- build-file: src/evaluation/command.ts -->
<details>
<summary>src/evaluation/command.ts 完整文件</summary>

```typescript
/**
 * 35.3 显式真实模型评测 | [CHANGED] evaluation/command.ts
 * 学习目标：在任何模型配置读取之前完成离线实验，拒绝混用其他动作
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：校验独占选项 -> 离线评测 -> 报告位置与退出状态。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { resolve } from "node:path";
import { runEvaluation } from "./runner.js";
import { UserFacingError } from "../errors.js";
// [CHANGED 35.3] 只有live分支读取已有模型配置，离线入口不触碰密钥。
import { readConfig } from "../config/load-config.js";
import { createModel } from "../models/client.js";

/** 校验整组选项后才创建样本；不存在的suite不能悄悄变成在线请求。 */
export async function runEvaluationCommand(options: Record<string, unknown>): Promise<void> {
  const live = options.evaluate === "live";
  const allowed = new Set(["evaluate", "evaluationDir", "output", ...(live ? ["provider", "model", "baseUrl"] : [])]);
  if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
    && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
    throw new UserFacingError("--evaluate 请单独使用，可配合 --evaluation-dir。");
  }
  // [KEEP 来自 35.2] 两种入口都不创建真实模型。
  if (options.evaluate !== "offline" && options.evaluate !== "regression" && !live) throw new UserFacingError("评测类型必须为 offline、regression 或 live。");
  const directory = resolve(typeof options.evaluationDir === "string" ? options.evaluationDir : "evaluation-results");
  const model = live ? createModel(readConfig({ provider: typeof options.provider === "string" ? options.provider : undefined,
    model: typeof options.model === "string" ? options.model : undefined, baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : undefined })) : undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("评测已取消。"));
  process.on("SIGINT", cancel);
  try {
  const report = await runEvaluation(live ? "live" : options.evaluate as "offline" | "regression", directory, model, controller.signal);
  for (const item of report.cases) console.log(`${item.expectationPassed ? "通过" : "失败"} ${item.scenario}；报告：${item.reportPath}`);
  for (const item of report.terminal) console.log(`${item.passed ? "通过" : "失败"} terminal/${item.name}`);
  if (!report.passed) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    try { await model?.jobs?.close(); } finally { await model?.languageService?.close(); }
  }
}
```
</details>

<!-- build-file: src/cli.ts -->
<details>
<summary>src/cli.ts 完整文件</summary>

```typescript
#!/usr/bin/env node
/**
 * 35.3 显式真实模型评测 | [CHANGED] cli.ts
 *
 * 学习目标：保留原有 CLI 装配与本地管理，所有自有任务结束后释放共享隔离资源。
 * 输入：模型选项与本地管理选项；--sandbox-info/check 在模型配置前独占处理。
 * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
 * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 30.1] argv[2]=schedule？-- 是 -> 独立定时管理 -> 结束；否 -> 普通聊天入口
 *   显式网页/搜索选项且非 Plan？-- 是 -> 完整校验本地配置 -> 创建 WebState；否 -> 不启用网页
 *   配置失败 -> 启动错误；配置成功只装配工具，不提前抓取或查询
 *   [KEEP 来自 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
 *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 只把名称/用途交给模型和启动信息
 *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
 *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
 *                            +-- 是 -> 继续检查运行方式
 *   [KEEP] auto？-- 是 -> 无 --prompt 且 stdin/stdout 为 TTY、TERM 非 dumb？
 *                     是 -> tui；否 -> text
 *                +-- 否 -> 保留显式选择
 *   tui？-- 是 -> stdin/stdout 为 TTY、TERM 非 dumb，且没有 --prompt？
 *                否 -> 抛错；是 -> 读取配置、创建模型 -> 动态载入 app -> startTui
 *        +-- 否 -> jsonl 但缺少 --prompt？-- 是 -> 抛错
 *                                          +-- 否 -> 读取配置、创建模型
 *   [KEEP 来自 13.1] text / tui -> 创建新会话文件、显示 ID 和路径 -> 消费者 -> finally close
 *   非 TUI 分支 -> 无 --prompt？-- 是 -> startTerminal
 *                              +-- 否 -> 内容为空？-- 是 -> 抛错
 *                                                  +-- 否 -> jsonl / text 单次消费者
 *   运行抛错 -> explainError -> stderr、exit 1；单次用户取消由消费者设 exit 130
 *
 * auto 在没有 --prompt、stdin/stdout 都是 TTY 且 TERM 不是 dumb 时选择 tui，其余选择 text。
 * TUI 只接受连续输入，单次任务继续用 text 或 jsonl；JSONL 必须同时给 --prompt。
 * 动态 import 只在 tui 分支载入 React / Ink，脚本模式不需要初始化终端界面。
 * --help、--version 不读取模型配置；--doctor 只做本地校验，不创建SDK或联网。
 *
 * [KEEP 来自 12.1] --mode plan|execute 在创建模型前校验，再传给每种消费者。
 * [KEEP 来自 12.2] 非 TUI 入口为当前会话准备共用清单；TUI 在 startTui 内创建自己的清单。
 * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
 */
// [KEEP 来自 31.3] 无需密钥的管理入口及显式启动、退出收尾。


// [KEEP 来自 18.1] 本地记忆动作在模型配置与会话创建前完成。
// [KEEP 来自 20.1] 项目脚本必须由本次启动显式启用。
// [KEEP 来自 21.1] 显式配置授权启动服务，退出始终关闭本次连接。
// [KEEP 来自 22.1] 网络开关不读取网页或会话里的指令。
import { closeSandbox } from "./sandbox/runtime.js";
import { sandboxInfo, runSandboxCheck, formatSandboxReport } from "./sandbox/diagnostics.js";
import { runCodeCommand } from "./code-command.js";
import { loadWeb } from "./web/client.js";
import { runScheduleCommand } from "./schedules/commands.js";
import { ExtensionManager } from "./extensions/manager.js";
import { extensionCommand } from "./extensions/commands.js";
import { connectMcp, mcpInfo } from "./mcp/client.js";
import { loadHooks } from "./hooks/lifecycle.js";
// [KEEP 来自 19.1] 固定项目目录发现元信息，不加载正文。
import { discoverSkills, skillInfo } from "./skills/catalog.js";
import { createMemoryController, memoryCommand } from "./memory/commands.js";
import { findProjectRoot } from "./project/instructions.js";
import { dirname } from "node:path";
// [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
import { readFileSync } from "node:fs";
// [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
import { forkSessionWriter } from "./sessions/fork-session.js";
import { realpath } from "node:fs/promises";
import { Command } from "commander";
// [KEEP 来自 35.1] 评测先于普通模型配置，只在自建样本中执行。
import { runEvaluationCommand } from "./evaluation/command.js";
// [KEEP 来自 34.3] doctor只复用本地校验，不创建SDK或任何执行资源。
import { diagnoseConfiguration } from "./diagnostics/config.js";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import type { ExecutionMode, RunOptions } from "./agent/run-options.js";
// [KEEP 来自 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";
// [KEEP 来自 13.1] 入口创建并最终关闭 writer，模型配置不进入存储模块。
import { createSessionWriter, resumeSessionWriter } from "./sessions/save-session.js";
// [KEEP 来自 13.4] 本地管理复用读取与写入协议，无需模型配置。
import { listSessions, renameSession, exportSession } from "./sessions/manage-sessions.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自 34.3] 保留环境三项检查，并追加本地配置校验。
/**
 * 显示运行环境并校验本地模型配置；不发网络请求。
 *
 * - 输入：本次启动的模型选项；版本、平台、架构和工作目录来自 Node.js 的 `process`。
 * - 输出：向终端打印环境与安全配置状态，不打印配置值。
 * - 关键原因：诊断捕获缺项，只给本地说明；缺少 API Key 时也能运行。
 * - 职责边界：读取并校验 `.env`；不创建模型客户端，也不发送网络请求。
 */
function printDoctor(options: Options): void {
  // [KEEP 来自 34.3] 只返回白名单结果，绝不打印配置对象。
  for (const line of diagnoseConfiguration(options)) console.log(line);
}
// [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
// [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
type CliOptions = Options & { evaluate?: string; evaluationDir?: string; quiet?: boolean; idleTimeout?: string; sandboxInfo?: boolean; sandboxCheck?: boolean; extension?: string[]; enableExtension?: string[]; enableProjectHooks?: boolean; mcpConfig?: string; mcpInfo?: boolean; enableWeb?: boolean; webSearchConfig?: string;  memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自 34.3] --doctor 捕获配置缺项后直接结束，没有 API Key 也能使用。
  // [KEEP 来自 20.1] 仅这次启动授权项目生命周期脚本；恢复会话不恢复启用状态。
  // [KEEP 来自 21.1] 不自动读取仓库中的MCP启动命令。
  // [KEEP 来自 22.1] 启用仅注册，真正GET仍逐次审批。
  // [KEEP 来自 22.2] 提供配置也明确启用网页工具；无提供方不注册web_search。
  .option("--web-search-config <path>", "配置JSON GET搜索提供方(endpoint/queryParam/tokenEnv)")
  .option("--enable-web", "明确启用逐次审批的网页抓取工具")
  .option("--extension <command...>", "本地扩展管理：list/install/diagnose/uninstall，无需模型密钥")
  .option("--enable-extension <id...>", "仅本进程明确启用列出的已安装扩展；可能启动脚本和服务")
  .option("--mcp-config <path>", "明确启用指定MCP配置（会启动或连接其中的服务）")
  .option("--mcp-info", "连接、发现并诊断指定MCP配置后退出，无需模型密钥")
  .option("--enable-project-hooks", "明确启用项目 .hello-my-agent/hooks.json 中的脚本")
  // [CHANGED 35.3] 评测入口先校验互斥动作，只有明确live才读取凭据。
  // [CHANGED 35.3] 帮助明确列出需显式选择的live评测。
  .option("--evaluate <suite>", "固定任务评测：offline、regression、live")
  .option("--evaluation-dir <path>", "固定任务与报告保存目录")
  .option("--sandbox-info", "显示隔离依赖、规则和实际通道范围，不执行边界实验")
  .option("--sandbox-check", "用临时样本主动验证真实文件与网络限制")
  // [KEEP 来自 34.3] 简洁只改变text呈现；沉默上限传给共同runtime。
  .option("--quiet", "text只显示正文、审批、失败与诊断位置")
  .option("--idle-timeout <seconds>", "无进展上限秒数（1—3600，默认90）")
  .option("--doctor", "显示环境并静态检查模型配置，不联网")
  // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
  .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
  // [KEEP 来自 18.1] 显式管理命令无需API Key。
  .option("--memory <command>", "本地项目记忆：list、show <id>、add <正文>、edit <id> <正文>、invalidate <id> <理由>、delete <id>")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 10.4] 默认值改为 auto；显式 text、tui、jsonl 仍由用户选择。
  .option("--output <format>", "输出格式：auto、tui、text 或 jsonl", "auto")
  // [KEEP 来自 12.1] 增加启动模式选项，默认 execute。
  .option("--mode <mode>", "模式：plan 或 execute（新会话默认 execute，恢复沿用已保存模式）")
  // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
  .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
  // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
  // [KEEP 来自 14.1] fork 创建新身份；resume 继续旧身份。
  .option("--fork <id>", "从指定会话的最后完整状态创建新分支，不重放工具")
  .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
  .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
  // [KEEP 来自 13.4] 显式管理动作在读取模型配置前完成。
  .option("--sessions", "列出本地会话，可配合 --search")
  .option("--search <text>", "在会话 ID、名称、工作区和已保存消息中搜索")
  .option("--rename <id>", "给指定会话追加名称，需要 --name")
  .option("--name <text>", "会话名称，1—80 个字符")
  .option("--export <id>", "将指定会话导出为 Markdown，默认输出到 stdout")
  .option("--export-to <path>", "导出到一个尚不存在的文件，需要 --export")
  // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    // [KEEP 来自 35.1] 独占分支在任何模型、扩展、服务创建之前结束。
    if (options.evaluate !== undefined) { await runEvaluationCommand(options); return; }
    if (options.evaluationDir !== undefined) throw new UserFacingError("--evaluation-dir 需要 --evaluate。");
    // [KEEP 来自 33.3] 独占管理分支在模型、扩展和服务连接之前结束；不需要模型凭据。
    if (options.sandboxInfo || options.sandboxCheck) {
      const allowed = new Set(["output", options.sandboxInfo ? "sandboxInfo" : "sandboxCheck"]);
      if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
          && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
        throw new UserFacingError("--sandbox-info 与 --sandbox-check 请分别单独使用。");
      }
      if (options.sandboxInfo) {
        const info = await sandboxInfo(findProjectRoot()); console.log(info.text);
        if (!info.available) process.exitCode = 1;
      } else {
        const report = await runSandboxCheck(); console.log(formatSandboxReport(report));
        if (!report.passed) process.exitCode = 1;
      }
      return;
    }
    // [KEEP 来自 18.1] 管理动作拒绝混用提问、会话和连接选项；Plan只可查询。
    if (options.memory !== undefined) {
      if (options.prompt !== undefined || options.projectInfo || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.output !== "auto" || options.sessionDir !== undefined || options.resume !== undefined || options.recover
        || options.fork !== undefined || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--memory请单独使用，可配合--mode plan查询。");
      if (!["execute", "plan"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode只能是plan或execute。");
      console.log(await memoryCommand(findProjectRoot(), options.memory, options.mode as ExecutionMode | undefined));
      return;
    }
    // [KEEP 来自 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
    if (options.projectInfo) {
      if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
        || options.sessionDir !== undefined || options.resume !== undefined || options.recover || options.fork !== undefined
        || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--project-info 请单独使用，不与提问、模型、模式、会话或输出选项混用。 ");
      const project = await loadProjectInstructions();
      for (const line of projectInstructionInfo(project)) console.log(line);
      return;
    }
    // [KEEP 来自 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
    const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
    if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
    if (options.search !== undefined && !options.sessions) throw new UserFacingError("--search 必须与 --sessions 一起使用。");
    if (options.name !== undefined && options.rename === undefined) throw new UserFacingError("--name 必须与 --rename <id> 一起使用。");
    if (options.exportTo !== undefined && options.export === undefined) throw new UserFacingError("--export-to 必须与 --export <id> 一起使用。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (management) {
      if (options.fork !== undefined || options.resume !== undefined || options.recover || options.prompt !== undefined || options.doctor
        || options.mode !== undefined || options.model !== undefined || options.provider !== undefined || options.baseUrl !== undefined || options.output !== "auto") {
        throw new UserFacingError("本地会话管理请单独使用，不与恢复、提问、模型或输出模式选项混用。");
      }
      if (options.sessions) {
        const result = await listSessions(options.sessionDir, options.search);
        for (const warning of result.warnings) console.error(`会话提示：${warning}`);
        if (!result.sessions.length) console.log("没有匹配的本地会话。");
        for (const session of result.sessions) console.log(`${session.id}  ${session.name}\n  ${session.updatedAt} · ${session.messages} 条消息 · ${session.pending} 条待交付${session.interrupted ? " · 上次中断" : ""}\n  ${session.cwd}`);
      } else if (options.rename !== undefined) {
        if (options.name === undefined) throw new UserFacingError("--rename <id> 需要 --name <text>。");
        const seq = await renameSession(options.rename, options.name, options.sessionDir);
        console.log(`名称已保存：${options.rename} · 第 ${seq} 条记录。`);
      } else {
        const markdown = await exportSession(options.export!, options.sessionDir, options.exportTo);
        if (options.exportTo === undefined) process.stdout.write(markdown);
        else console.log(`已导出：${options.exportTo}`);
      }
      return;
    }
    // [KEEP 来自 21.1] 本地诊断在readConfig前完成，不需要模型凭据。
    if (options.mcpInfo) {
      if (!options.mcpConfig) throw new UserFacingError("--mcp-info 需要 --mcp-config <path>。");
      const mcp = await connectConfiguredMcp(options.mcpConfig, findProjectRoot());
      try { for (const line of mcpInfo(mcp)) console.log(line); } finally { await mcp?.close(); }
      return;
    }
    // [KEEP 来自 31.1] 本地安装与诊断无需模型凭据，完成后一定关闭管理器。
    if (options.extension) {
      if (options.enableExtension || options.prompt || options.resume || options.fork || options.mcpConfig || options.enableProjectHooks) throw new UserFacingError("--extension 不与运行或其他能力启用参数混用。");
      if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
      if (options.extension[0] === "enable") throw new UserFacingError("独立管理命令不保留进程；请用 --enable-extension <id...> 启动，或在会话中 /extension enable <id>。");
      const root = findProjectRoot(), manager = new ExtensionManager(root, await discoverSkills(root));
      const controller = new AbortController(), cancel = () => controller.abort(new UserFacingError("扩展操作已取消。"));
      process.once("SIGINT", cancel);
      try { console.log(await extensionCommand(options.extension, manager, options.mode ?? "execute", controller.signal)); }
      finally { process.removeListener("SIGINT", cancel); await manager.close(); }
      return;
    }
    if (options.doctor) {
      printDoctor(options);
      return;
    }
    // [KEEP 来自 12.1] 创建模型前检查模式，非法值不会启动任务。
    if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
    let mode: ExecutionMode = options.mode === "plan" ? "plan" : "execute";
    // [KEEP 来自 12.1] 把启动模式传到 text、JSONL 和连续会话入口。
    // [KEEP 来自 12.2] 非 TUI 入口创建共用清单；TUI 在自己的会话内创建。
    // [KEEP 来自 34.3] 严格秒数校验发生在模型与会话创建前。
    const idleTimeout = options.idleTimeout ?? "90";
    if (!/^[1-9]\d*$/.test(idleTimeout) || Number(idleTimeout) > 3600) throw new UserFacingError("--idle-timeout 必须为 1 至 3600 的整数秒。");
    if (options.quiet && options.output !== "auto" && options.output !== "text") throw new UserFacingError("--quiet 只支持 text 输出。");
    if (options.quiet) options.output = "text";
    const runOptions: RunOptions = { mode, tasks: { items: [] }, quiet: options.quiet, noProgressTimeoutMs: Number(idleTimeout) * 1000 };
    // [KEEP 来自 10.4] 校验允许 auto，下一步再把它解析成具体消费者。
    if (!["auto", "tui", "text", "jsonl"].includes(options.output ?? "auto")) throw new UserFacingError("--output 只能是 auto、tui、text 或 jsonl。");
    // [KEEP 来自 10.4] 只在真实终端的连续会话中自动选择 TUI；--prompt 和管道默认仍用文本。
    if (options.output === "auto") options.output = options.prompt === undefined
      && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb" ? "tui" : "text";
    // [KEEP 来自 10.1] 只有真实终端才能把按键交给 Ink；单次问题继续使用已有输出模式。
    if (options.output === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === "dumb")) {
      throw new UserFacingError("TUI 需要交互终端，请使用 --output text 或 --output jsonl --prompt 提问。");
    }
    if (options.output === "tui" && options.prompt !== undefined) throw new UserFacingError("TUI 使用连续输入；单次提问请使用 --output text 或 jsonl。");
    if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
    // [KEEP 来自 13.1] 在创建模型和文件前拒绝不支持的组合与空问题。
    if (options.output === "jsonl" && options.sessionDir !== undefined) throw new UserFacingError("--session-dir 只支持 text 或 tui；JSONL 机器输出暂不保存会话。");
    if (options.recover && options.resume === undefined) throw new UserFacingError("--recover 必须与 --resume <id> 一起使用。");
    if (options.resume !== undefined && options.output === "jsonl") throw new UserFacingError("会话恢复只支持 text 或 tui。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
    if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
    // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
    if (options.enableExtension?.length && (mode === "plan" || options.resume || options.fork)) throw new UserFacingError("启动启用扩展仅支持新的execute会话；恢复后请在本地明确启用。");
    const project = await loadProjectInstructions();
    const config = readConfig(options);
    // [KEEP 来自 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
    const memory = await createMemoryController(project.root);
    const skills = await discoverSkills(project.root);
    // [KEEP 来自 20.1] Plan不读取/运行钩子；执行模式没有显式开关也不读取。
    const hooks = await loadHooks(project.root, Boolean(options.enableProjectHooks) && mode !== "plan");
    // [KEEP 来自 21.1] Plan不启动本地服务；恢复与新启动都必须再次显式选择。
    const mcp = mode === "plan" ? undefined : await connectConfiguredMcp(options.mcpConfig, project.root);
    const extensions = new ExtensionManager(project.root, skills, hooks, mcp);
    let model: ReturnType<typeof createModel> | undefined;
    try {
    // [KEEP 来自 31.2] 启动显式启用也接收Ctrl+C；只在资源收尾后离开初始化阶段。
    const extensionAbort = new AbortController(), cancelExtension = () => extensionAbort.abort(new UserFacingError("扩展初始化已取消。"));
    process.once("SIGINT", cancelExtension);
    try { for (const id of options.enableExtension ?? []) console.error(await extensions.enable(id, mode, extensionAbort.signal)); }
    finally { process.removeListener("SIGINT", cancelExtension); }
    const web = mode === "plan" ? undefined : await loadWeb(Boolean(options.enableWeb), options.webSearchConfig);
    model = createModel(config, project, memory, skills, extensions.hooks, extensions.mcp, web, extensions);
    for (const line of mcpInfo(model.mcp)) console.error(line);
    for (const line of skillInfo(skills)) console.error(line);
    for (const line of projectInstructionInfo(project)) console.error(line);
    // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
    if (options.output === "jsonl") {
      await runJsonlPrompt(model, options.prompt!, runOptions);
      return;
    }
    // [KEEP 来自 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
    const writer = options.fork !== undefined
      ? await forkSessionWriter(options.fork, options.sessionDir)
      : options.resume !== undefined
      ? await resumeSessionWriter(options.resume, options.sessionDir, options.recover)
      : await createSessionWriter(options.sessionDir);
    // [KEEP 来自 14.2] 文件恢复数据与会话同属一个身份，分支自动使用新的目录。
    runOptions.fileCheckpoints = createFileCheckpointStore(writer.id, dirname(writer.path));
    console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
    try {
      // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
      const restored = writer.restored;
      const initial = restored?.state;
      if (restored) {
        const workspace = restored.header.workspace ?? await realpath(restored.header.cwd);
        if (workspace !== await realpath(process.cwd())) throw new UserFacingError(`工作区不同：请先进入 ${restored.header.cwd} 再恢复，当前目录不会执行旧任务。`);
        for (const warning of restored.warnings) console.error(`恢复提示：${warning}`);
        console.error(`已恢复 ${initial?.messages.length ?? 0} 条消息；等待新要求，不重放旧工具；本进程权限需重新确认。`);
        if (initial?.pendingInputs.length) console.error(`保留 ${initial.pendingInputs.length} 条旧补充；不会自动交给新任务，请在 TUI 队列中明确选择发送。`);
      }
      mode = (options.mode ?? initial?.mode ?? "execute") as ExecutionMode;
      runOptions.mode = mode;
      if (options.prompt === undefined) {
        // [KEEP 来自 10.1] 选择 TUI 时才载入 React / Ink，不让脚本模式初始化界面。
        if (options.output === "tui") {
          const { startTui } = await import("./ui/tui/app.js");
          // [KEEP 来自 13.1] 会话 writer 与启动模式一起交给 TUI，授权仍由 TUI 保存在内存。
          // [KEEP 来自 34.3] TUI也接受同一个本地超时选项，不依赖默认值碰巧一致。
          await startTui(model, mode, writer, initial, runOptions.fileCheckpoints, runOptions.noProgressTimeoutMs);
        } else await startTerminal(model, runOptions, writer, initial);
      } else await runSinglePrompt(model, options.prompt, runOptions, writer, initial);
    } finally {
      // [KEEP 来自 13.1] 消费者先等任务和最后检查点；即使保存失败，这里仍关闭句柄。
      await writer.close();
    }
    // [KEEP 来自 26.1] 退出等待自有作业清理；即使close失败也关闭MCP。
    } finally { try { await model?.jobs?.close(); } finally { try { await model?.languageService?.close(); } finally { try { await extensions.close(); } finally { await mcp?.close(); } } } }
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  // [KEEP 来自 30.3] schedule动作结束后不再进入普通聊天入口。
  if (process.argv[2] === "code") await runCodeCommand(process.argv.slice(3));
  else if (process.argv[2] === "schedule") await runScheduleCommand(process.argv.slice(3));
  else await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
} finally {
  // [KEEP 来自 33.1] parseAsync 已等待各入口和自有作业收尾，最后释放共享隔离资源。
  try { await closeSandbox(); }
  catch (error) { console.error(`隔离清理失败：${explainError(error)}`); process.exitCode = 1; }
}

/**
 * [KEEP 来自 21.1] 让启动时的 Ctrl+C 也能停止正在建立的 MCP 连接。
 * 输入是本地配置路径与已确定的项目根；取消信号交给连接器，等待它关闭已启动的服务。
 * 无论连接成功、失败还是取消，最后都移除本次 SIGINT 监听，避免影响之后的任务。
 */
async function connectConfiguredMcp(path: string | undefined, root: string) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("MCP初始化已取消。"));
  process.once("SIGINT", cancel);
  try { return await connectMcp(path, root, controller.signal); }
  finally { process.removeListener("SIGINT", cancel); }
}
```
</details>

<!-- source:end -->

## 运行验证

先执行离线回归，再由我们自己明确选择是否运行在线评测：

```bash
npm run lesson:35.3
node dist/cli.js --evaluate regression --evaluation-dir ./evaluation-results
```

下面这条命令会调用已配置的真实模型并消耗额度。只在我们决定做在线实验时执行，不加入默认检查或提交前钩子：

```bash
node dist/cli.js --evaluate live --evaluation-dir ./evaluation-results
```

本章仓库验收只用本地 HTTP 服务检查真实 SDK、核心与判分器的连接，没有向远端付费服务发送请求。因此这里没有填写真实模型的成功率、费用或性能数据。我们自己的在线执行才会产生对应记录，不能把本地协议样本写成远端测量。

完成一次实验后，先确认 `mode` 与模型身份，再看任务判分、错误和改动路径。需要比较两个版本时，保留两份报告并核对任务版本；不要覆盖旧报告再凭记忆比较。下一章会把这份离线回归作为发布前的检查依据，仍把在线评测留给明确选择。
