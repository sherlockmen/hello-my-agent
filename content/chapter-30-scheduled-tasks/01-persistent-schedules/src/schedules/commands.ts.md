# commands.ts

`chapter-30-scheduled-tasks/01-persistent-schedules/src/schedules/commands.ts`

<a href="./content/chapter-30-scheduled-tasks/01-persistent-schedules/src/schedules/commands.ts" download>下载原始文件</a>

```typescript
/**
 * 30.1 持久任务定义 | [NEW] schedules/commands.ts
 *
 * 学习目标：把本地定义管理接到真实CLI，管理不需要模型密钥。
 * 输入：schedule子命令；输出：已保存定义或schema=1快照。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   create/list -> 获取store锁 -> 校验/保存/显示 -> finally close
 *   未知参数或存储失败 -> 抛给cli错误出口；不进入普通聊天。
 */
import { Command, CommanderError } from "commander";
import { ScheduleStore } from "./store.js";

// [NEW 30.1] 本文件以下实现均为本节新增。
/** 独立解析schedule命令；返回后CLI结束本次管理动作，不读取模型配置。 */
export async function runScheduleCommand(args: string[]): Promise<void> {
  const program = new Command("hello-my-agent schedule").exitOverride();
  program.option("--state-dir <path>", "定时任务存储目录");
  program.command("list").description("显示定义与最近运行记录").action(async () => {
    const store = await ScheduleStore.open(program.opts<{ stateDir?: string }>().stateDir);
    try { console.log(JSON.stringify(store.snapshot(), null, 2)); } finally { await store.close(); }
  });
  program.command("create").description("保存间隔任务；不会立即执行")
    .requiredOption("--id <id>", "任务编号：字母、数字、下划线、连字符")
    .requiredOption("--prompt <text>", "只读调查任务，最多2000字符")
    .requiredOption("--every-ms <milliseconds>", "间隔：1000至86400000毫秒")
    .option("--max-runs <count>", "最多尝试次数，包含失败", "3")
    .option("--max-tokens <tokens>", "累计本地token预留预算", "98304")
    .action(async (options: { id: string; prompt: string; everyMs: string; maxRuns: string; maxTokens: string }) => {
      const store = await ScheduleStore.open(program.opts<{ stateDir?: string }>().stateDir);
      try {
        await store.create({ id: options.id, prompt: options.prompt, workspace: process.cwd(),
          intervalMs: Number(options.everyMs), maxRuns: Number(options.maxRuns), maxTokens: Number(options.maxTokens) });
        console.log(`已保存定时任务 ${options.id}；只有serve运行期间才会触发。`);
      } finally { await store.close(); }
    });
  try { await program.parseAsync(args, { from: "user" }); }
  catch (error) { if (!(error instanceof CommanderError && error.code === "commander.helpDisplayed")) throw error; }
}
```
