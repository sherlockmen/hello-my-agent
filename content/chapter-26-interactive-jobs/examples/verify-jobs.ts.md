# verify-jobs.ts

`chapter-26-interactive-jobs/examples/verify-jobs.ts`

<a href="./content/chapter-26-interactive-jobs/examples/verify-jobs.ts" download>下载原始文件</a>

```typescript
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
