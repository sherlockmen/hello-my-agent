# commands.ts

`chapter-30-scheduled-tasks/02-runtime-dispatch/src/schedules/commands.ts`

<a href="./content/chapter-30-scheduled-tasks/02-runtime-dispatch/src/schedules/commands.ts" download>下载原始文件</a>

```typescript
/**
 * 30.2 到期与真实执行 | [CHANGED] schedules/commands.ts
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
import { Scheduler, changeScheduleState, createScheduleRunner } from "./runtime.js";

// [CHANGED 30.2] 管理共用本地状态修改；模型只在serve动作中创建。
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
        else if ((command === "pause" || command === "resume") && id && !extra) {
          await current[command](id); console.log(`已${command === "pause" ? "暂停" : "恢复"} ${id}`);
        } else throw new UserFacingError("serve内可输入list、pause <id>、resume <id>。");
      }).catch(error => {
        // 写盘失败已使store封写；即使没有enabled任务，也必须唤醒循环进入finally。
        if (store.hasWriteFailure) { controlFailure = error; shutdown.abort(); }
        else console.error(error instanceof UserFacingError ? error.message : "控制命令未完成。");
      });
    });
    console.log("定时执行器已启动；输入list、pause <id>、resume <id>；Ctrl+C关闭并等待收尾。");
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
  program.option("--state-dir <path>", "定时任务存储目录");
  /** 每次动作持有一次锁；serve动作返回代表真实任务已经settle。 */
  const withStore = async (action: (store: ScheduleStore) => Promise<void>) => {
    const store = await ScheduleStore.open(program.opts<{ stateDir?: string }>().stateDir);
    try { await action(store); } finally { await store.close(); }
  };
  program.command("list").description("显示定义与最近运行记录").action(() => withStore(async store => printSchedules(store)));
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
  for (const action of ["pause", "resume"] as const) {
    program.command(`${action} <id>`).description(action === "pause" ? "暂停新的启动，现有运行继续" : "重新计时，保留已用预算")
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
