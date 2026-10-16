# 第 30 章练习：给定时管理增加余额报告

[第 30 章首页](/content/chapter-30-scheduled-tasks/README.md) · [返回 30.3](/content/chapter-30-scheduled-tasks/03-stop-and-recover/README.md)

## 先做一遍状态推理

一项任务最多三次尝试、总共 65536 token 预留。第一次只用了 100 个本地请求预留，但启动时已经从总预算预留 32768。它还有几次名义次数和多少总余额？第二次启动又预留 32768 并失败，还能不能 resume？

答案是第一次后剩两次名义次数、32768 总预留余额；第二次后仍剩一次名义次数，但总余额为 0，不能 resume。总额度用的是启动前保守预留，不能把子任务实际用了多少、服务商报告了多少，与可再次使用的总预算混算。

## 动手：增加本地 budget 子命令

从 30.3 完整 src 继续，为管理端增加：

```bash
hello-my-agent schedule --state-dir .agent-schedules budget
```

每项报告 id、state、remainingRuns、remainingTokenReservation 和 lastStatus。没有运行记录显示 never。余额从定义累计计数计算，不能用最近 128 条运行记录重新求和；旧详情已经可能被截掉，但累计预算仍应保留。

这个命令和 list 一样，获取同一把锁，既不创建模型，也不改变定义。stopped 即使还有余额，也仍显示 stopped；“有余额”不能代替调度器的 enabled、到期与无 active 条件。serve 正在占用时，新终端的 budget 也应得到占用错误。

先尝试新增一个纯报告函数，再把它接到 commands 中。完整答案在下面；需要替换的是两个文件，不必改 runtime 和 CLI 入口。

## 完整答案

配套完整文件为 [report.ts](/content/chapter-30-scheduled-tasks/examples/budget-answer/report.ts.md) 和 [commands.ts](/content/chapter-30-scheduled-tasks/examples/budget-answer/commands.ts.md)，可在仓库内原地编译；其导入指向正式 30.3。跟写到自己的 src/schedules 时，使用下方对应路径的完整答案。

新增 `src/schedules/report.ts`：

<!-- exercise:report:start -->
<details>
<summary>NEW：src/schedules/report.ts 完整文件</summary>

```ts
/**
 * 30.3 练习答案 | [NEW] schedules/report.ts
 * 学习目标：从已校验快照生成剩余额度报告，显示额度与允许执行是不同判断。
 * 输入：store.snapshot()；输出：JSON可显示的报告，不改状态、不读取密钥。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：已提交定义/最近记录 -> 逐项计算 -> 报告
 * 观察：stopped即使有余额也仍显示stopped，不会因为报告重新启动。
 */
import type { ScheduleState } from "./store.js";

// [NEW 30.3 练习] 本文件只生成管理报告，不能成为绕过调度条件的启动入口。
/** 从累计计数计算余额，最新运行只作为观察；没有记录显示never。 */
export function scheduleBudgetReport(state: ScheduleState) {
  return state.schedules.map(task => ({
    id: task.id,
    state: task.state,
    remainingRuns: task.maxRuns - task.attempts,
    remainingTokenReservation: task.maxTokens - task.reservedTokens,
    lastStatus: [...state.runs].reverse().find(run => run.scheduleId === task.id)?.status ?? "never",
  }));
}
```

</details>
<!-- exercise:report:end -->

用下面内容完整替换 `src/schedules/commands.ts`，其余源文件保留 30.3 版本。新增 import 放在 store 附近；budget 动作和 list 一样进入 withStore，因此管理过程不会读取模型配置。

<!-- exercise:commands:start -->
<details>
<summary>CHANGED：src/schedules/commands.ts 完整替换文件</summary>

```ts
/**
 * 30.3 练习答案 | [CHANGED] schedules/commands.ts
 *
 * 学习目标：本地管理无需密钥；serve才建立模型连接并保持真正的轮询循环。
 * 输入：schedule子命令或serve标准输入；输出：定义、运行快照与持久终态。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   管理 -> 独占store -> 保存/显示 -> close；serve -> 配置 -> tick循环
 *   serve内list/pause/resume -> 同一store；SIGINT/SIGTERM -> abort并await -> close
 *   第二进程 -> busy，不冒充已经控制正在运行的任务；失败统一交给cli出口。
 */
import { Command, CommanderError } from "commander";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { createModel } from "../models/client.js";
import { readConfig, type Options } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { ScheduleStore } from "./store.js";
// [NEW 30.3 练习] 报告使用相同已锁定快照。
import { scheduleBudgetReport } from "./report.js";
import { Scheduler, changeScheduleState, createScheduleRunner, recoverInterrupted } from "./runtime.js";

// [CHANGED 30.3] 管理共用本地状态修改；模型只在serve动作中创建。
/** 显示当前已提交的本地快照；不会把控制命令写成模型消息。 */
function printSchedules(store: ScheduleStore): void { console.log(JSON.stringify(store.snapshot(), null, 2)); }

/**
 * serve持锁直到全部runner收尾；标准输入控制与tick使用同一store提交队列。
 * stdin结束只关闭控制输入，循环继续；进程信号结束循环并取消真实任务。
 */
async function serve(store: ScheduleStore, options: Options): Promise<void> {
  const model = createModel(readConfig(options));
  let scheduler: Scheduler | undefined;
  const shutdown = new AbortController();
  const onSignal = () => shutdown.abort();
  const input = createInterface({ input: process.stdin });
  let controls: Promise<void> = Promise.resolve();
  let controlFailure: unknown;
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try {
    scheduler = new Scheduler(store, createScheduleRunner(model, store.directory));
    const current = scheduler;
    input.on("line", line => {
      controls = controls.then(async () => {
        if (shutdown.signal.aborted) return;
        const [command, id, extra] = line.trim().split(/\s+/);
        if (command === "list" && !id) printSchedules(store);
        else if ((command === "pause" || command === "resume" || command === "stop") && id && !extra) {
          await current[command](id); console.log(`${command} ${id} 已完成`);
        } else throw new UserFacingError("serve内可输入list、pause <id>、resume <id>、stop <id>。");
      }).catch(error => {
        // 写盘失败已使store封写；即使没有enabled任务，也必须唤醒循环进入finally。
        if (store.hasWriteFailure) { controlFailure = error; shutdown.abort(); }
        else console.error(error instanceof UserFacingError ? error.message : "控制命令未完成。");
      });
    });
    console.log("定时执行器已启动；输入list、pause <id>、resume <id>、stop <id>；Ctrl+C关闭并等待收尾。");
    while (!shutdown.signal.aborted) {
      await current.tick();
      try { await delay(100, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    }
  } finally {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
    input.close(); await controls;
    try { await scheduler?.close(); } finally { await model.jobs?.close(); }
  }
  if (controlFailure !== undefined) throw controlFailure;
}

/** 独立解析schedule命令；本地管理动作在普通模型配置之前返回。 */
export async function runScheduleCommand(args: string[]): Promise<void> {
  const program = new Command("hello-my-agent schedule").exitOverride();
  program.option("--state-dir <path>", "定时任务存储目录")
    .option("--recover", "仅在确认旧进程结束后恢复遗留锁与中断记录");
  /** 每次动作持有一次锁；serve动作返回代表真实任务已经settle。 */
  const withStore = async (action: (store: ScheduleStore) => Promise<void>) => {
    const options = program.opts<{ stateDir?: string; recover?: boolean }>();
    const store = await ScheduleStore.open(options.stateDir, options.recover);
    try {
      // [NEW 30.3] 先得到真正独占权，再改变旧running记录，绝不接管活进程。
      if (options.recover) await recoverInterrupted(store);
      await action(store);
    } finally { await store.close(); }
  };
  program.command("list").description("显示定义与最近运行记录").action(() => withStore(async store => printSchedules(store)));
  program.command("budget").description("显示剩余次数、预留余额与最近状态")
    .action(() => withStore(async store => console.log(JSON.stringify(scheduleBudgetReport(store.snapshot()), null, 2))));
  program.command("create").description("保存间隔任务；不会立即执行")
    .requiredOption("--id <id>", "任务编号：字母、数字、下划线、连字符")
    .requiredOption("--prompt <text>", "只读调查任务，最多2000字符")
    .requiredOption("--every-ms <milliseconds>", "间隔：1000至86400000毫秒")
    .option("--max-runs <count>", "最多尝试次数，包含失败", "3")
    .option("--max-tokens <tokens>", "累计本地token预留预算", "98304")
    .action((options: { id: string; prompt: string; everyMs: string; maxRuns: string; maxTokens: string }) => withStore(async store => {
      await store.create({ id: options.id, prompt: options.prompt, workspace: process.cwd(),
        intervalMs: Number(options.everyMs), maxRuns: Number(options.maxRuns), maxTokens: Number(options.maxTokens) });
      console.log(`已保存定时任务 ${options.id}；只有serve运行期间才会触发。`);
    }));
  for (const action of ["pause", "resume", "stop"] as const) {
    program.command(`${action} <id>`).description(action === "pause" ? "暂停新的启动，现有运行继续" : action === "stop" ? "永久停止定义" : "重新计时，保留已用预算")
      .action((id: string) => withStore(store => changeScheduleState(store, action, id)));
  }
  program.command("serve").description("保持本进程运行，执行到期的只读任务")
    .option("--provider <name>", "模型协议")
    .option("--model <id>", "模型ID")
    .option("--base-url <url>", "模型基础地址")
    .action((options: Options) => withStore(store => serve(store, options)));
  try { await program.parseAsync(args, { from: "user" }); }
  catch (error) { if (!(error instanceof CommanderError && error.code === "commander.helpDisplayed")) throw error; }
}
```

</details>
<!-- exercise:commands:end -->

## 运行答案并解释结果

在自己的 30.3 跟写目录完成以上两处修改，再从项目根构建本节：

```bash
npm run lesson:30.3
```

创建一项新编号，随后查看报告：

```bash
hello-my-agent schedule --state-dir .agent-schedules create --id budget-demo --prompt "读取README.md" --every-ms 60000 --max-runs 3 --max-tokens 65536
```

```bash
hello-my-agent schedule --state-dir .agent-schedules budget
```

新建项应显示 remainingRuns=3、remainingTokenReservation=65536、lastStatus=never。完成一次启动后，remainingRuns 减一，总额度最多减去 32768，而不是只减服务商返回的 usage。输入 stop 后再查看，state 仍是 stopped，余额可能大于零，但不能恢复。

配套仓库的本章检查会把这两个答案文件放入独立的 30.3 临时副本，实际编译并执行 budget 分支。检查也会生成一项“累计次数多于最近记录数”的状态，确认报告取累计字段，最后通过 CLI 验证无密钥仍能查看报告。完整配套仓库可运行：

```bash
npm run check:30
```

这项报告不进入模型上下文，也没有启动权限。它把已经提交的状态解释给用户，调度是否开始仍由 runtime 原来的条件决定。
