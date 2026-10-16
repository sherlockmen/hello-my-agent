# 30.3 停止与恢复：等到真正结束，未知结局也要留下记录

[第 30 章首页](/content/chapter-30-scheduled-tasks/README.md) · [上一节：30.2 到期与真实执行](/content/chapter-30-scheduled-tasks/02-runtime-dispatch/README.md) · [本章练习与答案](/content/chapter-30-scheduled-tasks/EXERCISES.md) · [下一章：扩展包](/content/chapter-31-extension-packages/README.md)

## 问题：暂停不等于停止，旧 running 也不等于仍在执行

上一节的 pause 允许当前只读调查正常完成。现在用户决定彻底撤掉 docs，既不想再启动，也希望正在等待模型的那一次结束后才看到“停止完成”。另一个情况是电脑重启：磁盘里仍有 running，旧进程却已不存在。两者不能用同一种“把状态改成完成”来处理。

## 解决方案：有进程时等待真实结果，没有进程时记录结局未知

stop 先把定义永久改成 stopped，再对当前实例发 abort，并等待真实 runner 结束、cancelled 终态提交成功后才返回。stopped 不提供 resume，重新安排要创建新编号。

重启则先确认旧锁持有者已经不可能运行，再由用户显式 `--recover`。恢复把旧 running 标为 interrupted，并暂停相应定义；它只记录“旧进程没有留下可用终态”，不会重放旧请求，也不声称已经撤销了任何操作。用户查看记录后，仍有预算才能 resume，开始一项新的尝试。

## 工作原理：两种结束必须依据不同的事实

### stop 必须等到终态写盘以后才报告完成

沿 docs 调查正在等待模型的例子，stop 先保存 stopped。这一步决定未来：即使后续取消或写盘失败，下一次调度也不能自动再启动这个定义。如果某个 tick 已经在提交启动，stop 还会等它登记 active，避免漏掉刚刚开始的一项。

接下来发 abort 只是通知底层停止。控制器的 signal 变成 aborted，不能证明 SDK、工具和子会话句柄已经结束；所以 active 继续保留。runner 处理取消后仍要完成已有子循环的收尾、保存结束检查点、关闭子会话，才返回。调度器随后保存 finishedAt 和 cancelled，保存成功才删除 active，stop 才打印完成。

假设取消发出后还要 300 毫秒才关闭连接，这 300 毫秒内，状态仍然是“定义 stopped，运行 running，active 存在”。这不是矛盾：前者决定以后能否再启动，后两者描述当前尝试是否确实收尾。若取消恰好与正常响应交错，终态按本地停止请求记录 cancelled，摘要仍可能保留已经得到的回答；不能据此推断远端从未收到请求。

沿用上一节的控制失败路径：参数错误允许重输，真正写盘失败会唤醒并关闭整个 serve，即使当时没有 active。若终态保存失败，active 不释放，stop 不能报告成功，服务退出时继续等待其他实例收尾并显示失败。磁盘可能仍留 running，之后走显式恢复。这里调度的是只读任务，取消不涉及撤销文件修改，但已经发送的模型请求可能产生费用；计数和预留都不退还。

| 操作 | 是否允许以后再启动 | 当前实例怎样结束 | 返回的依据 |
| --- | --- | --- | --- |
| pause | 暂不允许，可在有预算时 resume | 继续运行 | paused 已保存 |
| stop | 永久不允许 | abort 后等待 | 真实 runner 返回且终态已保存 |
| 关闭 serve | 定义可仍为 enabled | 全部 abort 后等待 | 全部收尾后释放锁；下次启动再按定义判断 |

### 取得独占权以后，才能改变旧记录

SIGINT/SIGTERM 正常关闭会收尾并释放锁；SIGKILL、崩溃或断电不会执行 finally。新进程先读到遗留锁：若 PID 仍可能存在，包括权限不足或 PID 已被别的进程复用，都拒绝接管。用户传 --recover 也不能越过这一判断。

确认 PID 已不存在后，普通启动仍要求显式恢复。`--recover` 用额外恢复锁防止两个新进程同时接管，再核对原锁的身份和持有者，更新锁内容。只有真正持有独占锁以后，程序才读取并改变旧 running。无法识别的锁需要人工核对，程序不会猜测内容然后删除。

这里无法知道崩溃前走到了哪一步：可能刚保存 running、尚未发模型请求；也可能模型已经回答，只差终态尚未写盘。两个情况在磁盘上都可能相同。自动重试会把第二种情况再执行一次，直接标 completed 又会把第一种情况冒充成功。因此恢复统一写 interrupted，finishedAt 是发现中断并记录的时间，不是证明远端当时结束的时间；摘要明确写结局未知。

对应定义被暂停，attempts、reservedTokens 和原运行编号保留。恢复不会启动 runner，也不会复制旧历史到新任务。用户核对这份记录后执行 resume，从当前时刻加一个间隔重新计时；新的运行编号表示新的尝试。已经处于 stopped 的定义继续 stopped。没有旧 running 的其他 enabled 定义仍按上一节的到期合并规则处理。

### 恢复定义不等于恢复控制权或授权

store 的字段白名单没有密钥、权限集合和工具列表。serve 重启重新读取连接配置，runSubagent 仍创建空历史与空授权，只提供固定只读工具；磁盘里即使有旧子会话，调度器也不会把它当成一个可以恢复授权并继续执行的进程。

这套约定提供单进程持锁、同编号不重叠和明确的未知状态，不提供 exactly-once。尤其是“预留已写盘，真实请求刚好完成，终态还没写盘”的窗口，程序宁可保留 interrupted 与已用预算，也不替用户猜测。下一章接入扩展包时，也要明确安装、启停与资源归属，不能把配置存在当作连接已经清理完成。

<!-- media:lesson:start -->
先播放同一运行的 pause 与 stop，再切换到另一个独立的 crash 样例。注意蓝色 active：收到 abort 后仍保留；恢复时旧 running 只被记为 interrupted，模型请求不会重放。

<img src="./content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-cover-a5709eab1b.png" data-gif-src="./content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-fdf952c2f1.gif" data-cover="./content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-cover-a5709eab1b.png" data-no-zoom alt="30.3  停止要等真实收尾，中断只能记未知">

[静态流程图](/content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-flow-e1d77bcf86.png.md) · [静态封面](/content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-cover-a5709eab1b.png.md) · [查看完整静态分镜](/content/chapter-30-scheduled-tasks/03-stop-and-recover/assets/schedule-stop-recover-storyboard-e92dce1cf3.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/schedules/runtime.ts](/content/chapter-30-scheduled-tasks/03-stop-and-recover/src/schedules/runtime.ts.md) | stop等待真实终态；恢复旧running为interrupted并暂停。 |
| CHANGED | [src/schedules/commands.ts](/content/chapter-30-scheduled-tasks/03-stop-and-recover/src/schedules/commands.ts.md) | stop管理与--recover显式恢复入口。 |

<!-- generated:files:end -->

## 动手构建

从 30.2 的完整 `src/` 继续，目标目录为 `chapter-30-scheduled-tasks/03-stop-and-recover`。store 已有 PID/token 锁和显式接管参数；本节把 --recover 接到管理命令，并在取得锁之后执行 recoverInterrupted。接着增加 stopped 状态修改和 Scheduler.stop 的等待路径。

stop 与 close 都等待真实 settled；前者永久停止一项定义，后者关闭整个服务。不要把 recoverInterrupted 放在 open 之前，也不要为恢复路径调用 launch。下面差异按上一节正式代码应用，沿用文件只更新教学头部。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/schedules/runtime.ts 的精确差异</summary>

<!-- source: src/schedules/runtime.ts -->
```diff
--- a/src/schedules/runtime.ts
+++ b/src/schedules/runtime.ts
@@ -1,5 +1,5 @@
 /**
- * 30.2 到期与真实执行 | [NEW] schedules/runtime.ts
+ * 30.3 停止与恢复 | [CHANGED] schedules/runtime.ts
  *
  * 学习目标：把持久定义交给同一个只读子Agent，每次启动先保存次数和token预留。
  * 输入：clock、真实runner与store；输出：持久运行记录，active只存在本进程。
@@ -18,7 +18,7 @@
 import { UserFacingError } from "../errors.js";
 import { RUN_TOKEN_RESERVATION, ScheduleStore, type Schedule, type ScheduleRun, type ScheduleState } from "./store.js";

-// [NEW 30.2] 本文件以下实现均为本节新增。
+// [KEEP 来自 30.2] 继续使用真实runner和同一预算。
 export type ScheduleResult = Pick<ChildResult, "sessionId" | "status" | "summary" | "modelCalls" | "requestTokensReserved" | "error">;
 export type ScheduleRunner = (schedule: Schedule, runId: string, signal: AbortSignal, reservation: number) => Promise<ScheduleResult>;
 type Active = { controller: AbortController; settled: Promise<void> };
@@ -46,14 +46,33 @@
  * 离线CLI和serve内控制共用同一个状态修改；管理不需要模型连接。
  * stopped与用尽预算不能恢复；恢复重新计时，不补暂停期间错过的间隔。
  */
-export async function changeScheduleState(store: ScheduleStore, action: "pause" | "resume", id: string, now = Date.now()): Promise<void> {
+export async function changeScheduleState(store: ScheduleStore, action: "pause" | "resume" | "stop", id: string, now = Date.now()): Promise<void> {
   await store.update(state => {
     const task = scheduleById(state, id);
+    if (action === "stop") { task.state = "stopped"; return; }
     if (task.state === "stopped") throw new UserFacingError("stopped任务不能恢复，请创建新编号。");
     if (action === "pause") task.state = "paused";
     else {
       if (task.attempts >= task.maxRuns || task.reservedTokens >= task.maxTokens) throw new UserFacingError("预算用尽的任务不能恢复，请创建新编号。");
       task.state = "enabled"; task.nextRunAt = now + task.intervalMs;
+    }
+  });
+}
+
+// [NEW 30.3] 磁盘running不是进程还活着的证明；显式恢复只记录未知结局。
+/**
+ * store已取得独占锁后，将旧running标记interrupted并暂停相应定义。
+ * 不重放、不中退次数或token；用户核对后resume才重新计时。
+ */
+export async function recoverInterrupted(store: ScheduleStore, now = Date.now()): Promise<void> {
+  if (!store.snapshot().runs.some(run => run.status === "running")) return;
+  await store.update(state => {
+    for (const run of state.runs) {
+      if (run.status !== "running") continue;
+      run.status = "interrupted"; run.finishedAt = Math.max(run.startedAt, now);
+      run.summary = "旧进程未留下终态，完成情况未知；本次恢复没有重新执行。";
+      const task = scheduleById(state, run.scheduleId);
+      if (task.state !== "stopped") task.state = "paused";
     }
   });
 }
@@ -68,7 +87,7 @@
   private closing = false;
   private failure: unknown;
   constructor(readonly store: ScheduleStore, private runner: ScheduleRunner, private clock: () => number = Date.now) {
-    if (store.snapshot().runs.some(run => run.status === "running")) throw new UserFacingError("存在未收尾的running记录；本节不猜测是否需要重做，请使用30.3的显式恢复流程。");
+    if (store.snapshot().runs.some(run => run.status === "running")) throw new UserFacingError("存在未收尾的running记录，请核对旧进程后使用--recover显式恢复。");
   }

   /** 返回本进程真实持有的任务数量；取消请求尚未settle时仍占据active。 */
@@ -138,6 +157,18 @@
   /** 恢复从当前时刻重新计时，不补暂停期间的次数；预算没有充值入口。 */
   async resume(id: string): Promise<void> { await changeScheduleState(this.store, "resume", id, this.clock()); }

+  // [NEW 30.3] stopped先落盘，再abort；等待终态提交成功才向控制入口报告停止完成。
+  /**
+   * 永久禁止新的启动；若同任务正在tick中提交，先等该tick登记active。
+   * 取消只是请求，真实settle和终态写盘完成之前，active仍存在。
+   */
+  async stop(id: string): Promise<void> {
+    await changeScheduleState(this.store, "stop", id, this.clock());
+    await this.dispatch;
+    const item = this.active.get(id);
+    if (item) { item.controller.abort(new UserFacingError("定时任务已停止。")); await item.settled; }
+  }
+
   /**
    * 关闭先禁新调度，等待正在提交的tick，再取消并等待每个真实runner。
    * 下层若不理会取消，close也会继续等待；没有超时后假装释放active的分支。
```

</details>

<details>
<summary>CHANGED：src/schedules/commands.ts 的精确差异</summary>

<!-- source: src/schedules/commands.ts -->
```diff
--- a/src/schedules/commands.ts
+++ b/src/schedules/commands.ts
@@ -1,5 +1,5 @@
 /**
- * 30.2 到期与真实执行 | [CHANGED] schedules/commands.ts
+ * 30.3 停止与恢复 | [CHANGED] schedules/commands.ts
  *
  * 学习目标：本地管理无需密钥；serve才建立模型连接并保持真正的轮询循环。
  * 输入：schedule子命令或serve标准输入；输出：定义、运行快照与持久终态。
@@ -15,9 +15,9 @@
 import { readConfig, type Options } from "../config/load-config.js";
 import { UserFacingError } from "../errors.js";
 import { ScheduleStore } from "./store.js";
-import { Scheduler, changeScheduleState, createScheduleRunner } from "./runtime.js";
+import { Scheduler, changeScheduleState, createScheduleRunner, recoverInterrupted } from "./runtime.js";

-// [CHANGED 30.2] 管理共用本地状态修改；模型只在serve动作中创建。
+// [CHANGED 30.3] 管理共用本地状态修改；模型只在serve动作中创建。
 /** 显示当前已提交的本地快照；不会把控制命令写成模型消息。 */
 function printSchedules(store: ScheduleStore): void { console.log(JSON.stringify(store.snapshot(), null, 2)); }

@@ -42,16 +42,16 @@
         if (shutdown.signal.aborted) return;
         const [command, id, extra] = line.trim().split(/\s+/);
         if (command === "list" && !id) printSchedules(store);
-        else if ((command === "pause" || command === "resume") && id && !extra) {
-          await current[command](id); console.log(`已${command === "pause" ? "暂停" : "恢复"} ${id}`);
-        } else throw new UserFacingError("serve内可输入list、pause <id>、resume <id>。");
+        else if ((command === "pause" || command === "resume" || command === "stop") && id && !extra) {
+          await current[command](id); console.log(`${command} ${id} 已完成`);
+        } else throw new UserFacingError("serve内可输入list、pause <id>、resume <id>、stop <id>。");
       }).catch(error => {
         // 写盘失败已使store封写；即使没有enabled任务，也必须唤醒循环进入finally。
         if (store.hasWriteFailure) { controlFailure = error; shutdown.abort(); }
         else console.error(error instanceof UserFacingError ? error.message : "控制命令未完成。");
       });
     });
-    console.log("定时执行器已启动；输入list、pause <id>、resume <id>；Ctrl+C关闭并等待收尾。");
+    console.log("定时执行器已启动；输入list、pause <id>、resume <id>、stop <id>；Ctrl+C关闭并等待收尾。");
     while (!shutdown.signal.aborted) {
       await current.tick();
       try { await delay(100, undefined, { signal: shutdown.signal }); }
@@ -68,11 +68,17 @@
 /** 独立解析schedule命令；本地管理动作在普通模型配置之前返回。 */
 export async function runScheduleCommand(args: string[]): Promise<void> {
   const program = new Command("hello-my-agent schedule").exitOverride();
-  program.option("--state-dir <path>", "定时任务存储目录");
+  program.option("--state-dir <path>", "定时任务存储目录")
+    .option("--recover", "仅在确认旧进程结束后恢复遗留锁与中断记录");
   /** 每次动作持有一次锁；serve动作返回代表真实任务已经settle。 */
   const withStore = async (action: (store: ScheduleStore) => Promise<void>) => {
-    const store = await ScheduleStore.open(program.opts<{ stateDir?: string }>().stateDir);
-    try { await action(store); } finally { await store.close(); }
+    const options = program.opts<{ stateDir?: string; recover?: boolean }>();
+    const store = await ScheduleStore.open(options.stateDir, options.recover);
+    try {
+      // [NEW 30.3] 先得到真正独占权，再改变旧running记录，绝不接管活进程。
+      if (options.recover) await recoverInterrupted(store);
+      await action(store);
+    } finally { await store.close(); }
   };
   program.command("list").description("显示定义与最近运行记录").action(() => withStore(async store => printSchedules(store)));
   program.command("create").description("保存间隔任务；不会立即执行")
@@ -86,8 +92,8 @@
         intervalMs: Number(options.everyMs), maxRuns: Number(options.maxRuns), maxTokens: Number(options.maxTokens) });
       console.log(`已保存定时任务 ${options.id}；只有serve运行期间才会触发。`);
     }));
-  for (const action of ["pause", "resume"] as const) {
-    program.command(`${action} <id>`).description(action === "pause" ? "暂停新的启动，现有运行继续" : "重新计时，保留已用预算")
+  for (const action of ["pause", "resume", "stop"] as const) {
+    program.command(`${action} <id>`).description(action === "pause" ? "暂停新的启动，现有运行继续" : action === "stop" ? "永久停止定义" : "重新计时，保留已用预算")
       .action((id: string) => withStore(store => changeScheduleState(store, action, id)));
   }
   program.command("serve").description("保持本进程运行，执行到期的只读任务")
```

</details>

<!-- generated:build:end -->

## 运行验证

在项目根构建：

```bash
npm run lesson:30.3
```

在创建定义的同一工作区启动服务：

```bash
hello-my-agent schedule --state-dir .agent-schedules serve
```

在服务标准输入中提交：

```text
stop docs
list
```

若当时有实例，stop 的完成输出要等待真实收尾。list 应显示定义 stopped，当前运行已是 cancelled 或之前就完成的终态。对同一编号输入 resume 应被拒绝。离线也有 `schedule stop docs`，但仍须先退出占用存储的 serve；它不能跨进程取消服务中的实例。

恢复实验先创建独立编号，保留足够的尝试预算：

```bash
hello-my-agent schedule --state-dir .agent-schedules create --id recovery-demo --prompt "读取 README.md，汇总待办" --every-ms 60000 --max-runs 3 --max-tokens 98304
```

```bash
hello-my-agent schedule --state-dir .agent-schedules serve
```

运行期间在另一个终端确认该实验服务的 PID 后，用系统工具强制结束那个实验进程。强杀不会经过收尾，普通 list 会拒绝遗留锁。确认旧进程已结束，再显式执行：

```bash
hello-my-agent schedule --state-dir .agent-schedules --recover list
```

如果强杀时已有 running，预期它变为 interrupted，对应定义 paused，次数和预留未退还。如果强杀发生在启动前或终态提交后，则没有旧 running 可转换；仅出现遗留锁不能证明曾经执行。用已有确定性检查可稳定验证这一窗口：

```bash
npm run check:30
```

看完记录并决定开始新尝试，再恢复有余额的任务：

```bash
hello-my-agent schedule --state-dir .agent-schedules resume recovery-demo
```

```bash
hello-my-agent schedule --state-dir .agent-schedules serve
```

恢复实验使用独立的 recovery-demo；前面 stopped 的 docs 仍不能 resume。`--recover` 仍拒绝活 PID，也不会修好不合法 JSON。遇到存储校验错误，先核对文件与备份，不能把“恢复”理解为忽略所有输入错误。

## 本节完成后的 Agent

定时能力现在有了完整的生命周期：保存规则，运行中按时启动，先预留预算，不重叠，暂停，取消并等待，以及把崩溃后的未知结果明确保留。程序没有把时间到、消息确认、取消请求和任务完成混为同一件事。下一章把 Skill 与 MCP 资源组织为扩展包，沿用这些明确的生命周期约定：安装保存声明，启用接入资源，停用和退出等待资源真正关闭。
