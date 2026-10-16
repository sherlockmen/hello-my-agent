# 第26章练习与答案

[本章首页](README.md) · [26.3 作业生命周期](03-job-lifecycle/README.md)

这三题只使用本章公开的作业管理器，不改变正式 `src/`。我们把“看起来运行了”变成可以重复检查的进程事实：输出证据、终端归属和会话清理各用自己的结束条件。答案运行真实 pipe 与 PTY，不调用在线模型。

先完成26.3，并按[环境准备](../docs/SETUP.md#第二十六章需要的真实-pty-依赖)装好原生模块。答案保存为 `chapter-26-interactive-jobs/examples/verify-jobs.ts`，也可以在自己跟写的项目里保存为 `examples/verify-jobs.ts`。下一章仍从26.3的正式 `src/` 继续，不需要把练习脚本复制进 Agent。

## 练习1：日志已经没了，为什么还能说曾经就绪

启动一个 pipe 作业，让它把 `SERVER_READY` 分两次输出，再输出超过日志上限的大量字符。等它退出后，分别检查进程状态、输出状态、保留日志和就绪证据。再启动一个输出错误后以1退出、从未打印标记的作业。

请回答：第一份结果能否证明 HTTP 服务可访问？第二份结果为什么不能永远停在 `waiting`？什么时刻适合发布 `ended` 通知？

<details>
<summary>参考答案与检查依据</summary>

第一份结果应为 `exited + ready`，`evidence` 仍为 `SERVER_READY`，`readyAt` 有值，但尾日志已经淘汰该文本。它只证明过去出现过声明的输出；脚本甚至没有启动 HTTP 服务，因此不能得出访问成功的结论。尾日志是有界观察窗口，单独保存的证据是一次状态变化的依据。

第二个作业只有在 transport 真正收尾后，才变成 `exited + ended_before_ready`；退出码与日志说明初始化失败。此时发布 `ended`，调用者可以停止等待。代码见下方完整答案的 `evidence`。

</details>

## 练习2：用户离开终端后，谁还持有进程

创建真实 PTY，等待 `PTY_READY`，取得 owner 后输入 `Ada`。收到 `HELLO:Ada` 后分离，再次接管并在空行送出 EOF。

请用断言检查：第二个 owner 在第一次接管期间被拒绝，旧 owner 分离后不能继续写，分离后作业仍在运行，再次接管能让同一个进程正常退出。为什么 `detach` 不能顺手把作业停止？

<details>
<summary>参考答案与检查依据</summary>

`detach` 结束的是人对终端的独占归属，用户可能只想暂时返回聊天。若它自动停止进程，下一次接管就不再是同一个工作现场。作业归管理器所有，owner 只持有受检查的输入、尺寸与退出订阅句柄；旧闭包不能越过新的归属继续注入输入。

答案中的 `ownership` 先验证独占与旧句柄拒绝，再重新接管。EOF 交给内层 canonical 终端，`cat` 退出后打印 `EOF_OK`；`wait` 收到正常退出码后，这次实验才结束。

</details>

## 练习3：取消一轮，与退出会话，有什么不同

为 `start` 传入一个轮次的 AbortSignal。等作业启动并输出心跳后取消该轮，再检查心跳继续增长。随后关闭作业管理器，等待终态，并尝试再次启动。

同时注册一个故意抛异常的通知监听器。它能否阻止进程收尾？为什么 `close` 返回前不能先删除临时目录？

<details>
<summary>参考答案与检查依据</summary>

启动登记成功后，作业归当前 CLI 会话管理，启动窗口的信号监听已经解除；这一轮取消不再拥有该作业。`shutdown` 先观察取消后仍然增长的日志，再用 `close` 请求停止并等待终态，核对 `stopReason=shutdown`。关闭后的管理器拒绝新启动。

显示监听器没有决定进程生命的权限，异常会被隔离。目录可能仍被进程使用，先删目录会把资源清理和文件清理搅在一起；完整答案先等待 `close`，最后才删除临时目录。停止请求也不会撤销命令此前的外部副作用。

</details>

## 完整可运行答案

下面是一份完整文件；三个题号共用小型轮询与清理辅助函数。配套仓库中的[同名脚本](examples/verify-jobs.ts)与此代码一致。

<details>
<summary>完整 TypeScript 答案：examples/verify-jobs.ts</summary>

```ts
/**
 * 第26章独立练习答案：用真实进程核对状态、终端归属与会话清理。
 * 不修改正式src；不调用模型；所有作业只属于此脚本的临时会话。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Job = { id: string; pid: number | null; state: string; readiness: string; readyAt: string | null; evidence: string | null; log: string; droppedBytes: number; exitCode: number | null; stopReason?: string };
type Notice = { type: "ready" | "ended"; job: Job };
const repo = process.env.HMA_REPO ?? process.cwd();
const dist = process.env.HMA_JOBS_DIST ?? path.join(repo, "dist");
const { JobManager } = await import(pathToFileURL(path.join(dist, "processes/jobs.js")).href);

/** 把固定测试程序编码为shell安全的Node命令，不把用户输入拼进shell。 */
function nodeCommand(source: string): string {
  const encoded = Buffer.from(source).toString("base64");
  return `node -e 'eval(Buffer.from("${encoded}","base64").toString())'`;
}

/** 轮询真实快照直到观察成立；终态或期限到达时给出当前日志。 */
async function until(get: () => Job, check: (job: Job) => boolean): Promise<Job> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const job = get();
    if (check(job)) return job;
    if (["exited", "failed"].includes(job.state)) throw new Error(`过早结束：${job.log}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`等待观察超时：${get().log}`);
}

/** 验证启动、输出标记、退出三种依据，以及独立于尾日志的历史证据。 */
async function evidence(cwd: string): Promise<void> {
  const jobs = new JobManager({ active: 4, history: 8, logBytes: 32 });
  const notices: Notice[] = [];
  const off = jobs.subscribe((notice: Notice) => notices.push(notice));
  try {
    const first = await jobs.start({ cwd, timeoutMs: 3000, readyText: "SERVER_READY", command: nodeCommand(`process.stdout.write("SERVER_"); setTimeout(() => { process.stdout.write("READY\\n"); setTimeout(() => process.stdout.write("x".repeat(256)), 30); }, 30);`) });
    const ended: Job = await jobs.wait(first.id);
    assert.equal(ended.state, "exited");
    assert.equal(ended.exitCode, 0);
    assert.equal(ended.readiness, "ready");
    assert.equal(ended.evidence, "SERVER_READY");
    assert.ok(ended.readyAt);
    assert.ok(ended.droppedBytes > 0);
    assert.equal(ended.log.includes("SERVER_READY"), false);
    assert.deepEqual(notices.filter(n => n.job.id === first.id).map(n => n.type), ["ready", "ended"]);
    const second = await jobs.start({ cwd, timeoutMs: 3000, readyText: "SERVER_READY", command: nodeCommand(`process.stderr.write("initialization failed\\n"); process.exitCode = 1;`) });
    const missing: Job = await jobs.wait(second.id);
    assert.equal(missing.readiness, "ended_before_ready");
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.evidence, null);
    assert.equal(missing.readyAt, null);
    console.log("练习1通过：历史证据、尾日志淘汰、未就绪退出。");
  } finally { await jobs.close(); off(); }
}

/** 验证人工接管只改变终端归属，分离后同一作业仍可继续并再次接管。 */
async function ownership(cwd: string): Promise<void> {
  const jobs = new JobManager();
  try {
    const job = await jobs.start({ cwd, timeoutMs: 6000, transport: "pty", readyText: "PTY_READY", command: `stty -echo; printf 'PTY_READY\\n'; IFS= read -r name; printf 'HELLO:%s\\n' "$name"; cat; printf 'EOF_OK\\n'` });
    await until(() => jobs.get(job.id), current => current.readiness === "ready");
    const owner = jobs.attach(job.id, () => {});
    assert.throws(() => jobs.attach(job.id, () => {}), /所有者/);
    owner.write("Ada\n");
    await until(() => jobs.get(job.id), current => current.log.includes("HELLO:Ada"));
    owner.detach();
    assert.throws(() => owner.write("stale"), /接管已结束/);
    assert.equal(jobs.get(job.id).state, "running");
    const next = jobs.attach(job.id, () => {});
    try {
      next.eof();
      const ended: Job = await jobs.wait(job.id);
      assert.equal(ended.exitCode, 0);
      assert.match(ended.log, /EOF_OK/);
    } finally { next.detach(); }
    console.log("练习2通过：唯一owner、分离、旧句柄拒绝、重新接管和EOF。");
  } finally { await jobs.close(); }
}

/** 验证启动窗口后的轮次取消不拥有作业，关闭会话才等待全部自有作业。 */
async function shutdown(cwd: string): Promise<void> {
  const jobs = new JobManager();
  const notices: Notice[] = [];
  const off = jobs.subscribe((notice: Notice) => notices.push(notice));
  const offBroken = jobs.subscribe(() => { throw new Error("显示失败不能拥有生命周期"); });
  try {
    const round = new AbortController();
    const job = await jobs.start({ cwd, timeoutMs: 6000, readyText: "TICK", command: nodeCommand(`process.stdout.write("TICK\\n"); setInterval(() => process.stdout.write("TICK\\n"), 25);`) }, round.signal);
    await until(() => jobs.get(job.id), current => current.readiness === "ready");
    const length = jobs.get(job.id).log.length;
    round.abort();
    await until(() => jobs.get(job.id), current => current.state === "running" && current.log.length > length);
    await jobs.close();
    const ended: Job = await jobs.wait(job.id);
    assert.equal(ended.state, "exited");
    assert.equal(ended.stopReason, "shutdown");
    assert.equal(notices.filter(n => n.type === "ended" && n.job.id === job.id).length, 1);
    await jobs.close();
    await assert.rejects(jobs.start({ cwd, timeoutMs: 1000, command: "true" }), /已关闭/);
    console.log("练习3通过：轮次取消边界、会话等待清理、观察者异常隔离。");
  } finally { await jobs.close(); off(); offBroken(); }
}

/** 按题号运行；无论断言是否通过，都等待作业清理后删除临时目录。 */
async function main(): Promise<void> {
  const group = process.argv[2] ?? "all";
  assert.ok(["1", "2", "3", "all"].includes(group), "题号只能是1、2、3或all");
  const cwd = await mkdtemp(path.join(tmpdir(), "hma-jobs-exercises-"));
  try {
    if (group === "1" || group === "all") await evidence(cwd);
    if (group === "2" || group === "all") await ownership(cwd);
    if (group === "3" || group === "all") await shutdown(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
await main();
```

</details>

先编译正式26.3快照：

```bash
npm run lesson:26.3
```

再编译并运行练习；以下命令从仓库根执行。`HMA_REPO` 指向当前正式构建所在的项目，`all` 可以改成题号 `1`、`2`、`3`。

```bash
npx tsc chapter-26-interactive-jobs/examples/verify-jobs.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --outDir .exercise-dist/ch26
HMA_REPO="$PWD" node .exercise-dist/ch26/verify-jobs.js all
```

自己跟写时，把编译命令中的源文件路径改成 `examples/verify-jobs.ts` 即可。三题都通过后，应看到三条对应的“练习通过”信息；不能仅以脚本启动或某次通知出现作为全部验收。

本章练习状态：待用户确认。
