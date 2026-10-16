# 第29章练习：归属、依赖与消息分别证明什么

[第29章首页](/content/chapter-29-shared-tasks/README.md) · [29.1 认领与租约](/content/chapter-29-shared-tasks/01-claim-and-lease/README.md) · [29.2 依赖与失联回收](/content/chapter-29-shared-tasks/02-dependencies-reclaim/README.md) · [29.3 Agent消息与确认](/content/chapter-29-shared-tasks/03-agent-messages/README.md)

三题使用29.3正式协调者，在脚本自己的内存表上实验，不修改正式src或项目文件。先预测状态，再运行答案；固定ChildResult只是状态机输入，不能冒充真正的文件读取。真实子循环、保存关闭和父模型回传由`tests/verify-chapter-29.mjs`核对。

## 练习1：同名worker为什么还需要新token

登记entry和validation，让两个worker依次认领。把可控时钟推进到租约期限，尝试提交第一轮结果和续租；再请求停止、检查stopping，模拟旧子会话已收尾后开放重领，最后让旧结果与新结果分别提交。

1. 两个worker能否拿到同一任务？worker仍持有运行任务时能否再取一项？
2. 过期后先提交结果、或先发心跳，能否重新获得有效归属？
3. 为什么stopping不能立刻重领，新token出现后旧结果又会留下什么状态？

<details>
<summary>思路与预期事实</summary>

同步claim检查并写入归属，第二次看到的entry已经running，因此拿另一项；忙worker再次claim会拒绝。到期的finish和heartbeat都拒绝，不能靠迟到心跳复活。stopping保留原归属，直到runner真正await旧Promise、最终检查点与关闭才开放pending。本题手动调用settleStopped只是在状态机实验中模拟这个已完成的时点。

第二轮即使仍是worker-1，token也必须加1。旧结果应拒绝，条目保持第二轮running；新结果满足结构化完成条件后才成为completed。取消/回收不是擦掉所有历史，也不证明模型请求没有收费。

</details>

## 练习2：一个口头完成，能否解锁整条依赖链

先提交a依赖b、b又依赖a；再提交引用missing的a。两批都失败后，建立a→b→c的前置链。让a的子结果status为completed、summary为“我已全部完成”，但evidence为空。

1. 两次坏图之后登记表应是什么？为什么不能边验证边保存？
2. a还在运行时，第二个worker能否取b？
3. a只有口头结论时，a、b、c最后分别是什么状态？

<details>
<summary>思路与预期事实</summary>

两批都应整批拒绝，表保持空。否则第二项错误可能留下第一项任务，改变下一次输入的含义。a运行期间b的前置尚未completed，因此第二个worker没有可认领项。a没有成功只读工具的文件证据，即使摘要说完成也应failed，b与c依次blocked；没有运行的后续不能计入完成成果。

如果a第一轮只是租约过期且仍有一次重试机会，a收尾后回pending，后续继续等待；只有重试最终失败或取消才传播blocked。停止中的任务不能提前当作成功或最终失败。

</details>

## 练习3：同一条消息读两遍、确认两遍会怎样

worker-1为entry发送client_id=finding的消息给parent，原样重发，再以同一个client_id更换正文。parent读取两次，然后错误地让worker-1确认，最后由parent确认两次。

1. 原样重发产生几个message-ID？更换正文应覆盖还是拒绝？
2. 两次read之后，收件箱和任务状态分别是什么？
3. ack之后是否能称任务完成？什么输入才能把任务变成completed？

<details>
<summary>思路与预期事实</summary>

相同任务、token、发送者与client_id构成去重键；正文与收件人相同就返回同一条，变化则拒绝。read没有确认副作用，两次都读到一条，任务仍running。worker不是这条消息的收件人，ack应拒绝；parent重复ack幂等，之后未确认列表为空，任务仍running。

只有正式子会话收尾后返回的本地ChildResult满足状态与证据条件，协调者才完成任务。消息ack证明收件人提交过确认，不证明发现已落实、代码已修复或测试已通过。旧轮消息也不能用新token读取为当前观察。

</details>

## 完整TypeScript答案

配套源码：[examples/verify-shared-tasks.ts](/content/chapter-29-shared-tasks/examples/verify-shared-tasks.ts.md)。自己跟写时新建同名文件，保存下面完整代码。先编译29.3，再独立编译练习；不需要模型凭据或网络。

```bash
npm run lesson:29.3
npx tsc chapter-29-shared-tasks/examples/verify-shared-tasks.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --outDir .exercise-dist/ch29
```

再运行全部三题：

```bash
node .exercise-dist/ch29/verify-shared-tasks.js all
```

也可以把all换成1、2或3。自己跟写的项目将编译命令中的源码位置换为`examples/verify-shared-tasks.ts`；脚本默认加载当前项目dist，也可由本地HMA_SHARED_DIST指定已编译的本章目录。没有创建新协调者之外的持久状态，结束时没有项目成果需要删除。

<!-- solution: examples/verify-shared-tasks.ts -->
```ts
/**
 * 第29章独立练习答案 | [NEW 练习] examples/verify-shared-tasks.ts
 * 学习目标：用明确断言区分当前归属、依赖与消息确认，不靠模型口头结论。
 * 输入：1、2、3或all题号；本项目已编译的29.3 dist路径。
 * 输出：断言通过文字，失败抛错；只修改本脚本创建的内存协调者。
 * 练习流程：加载正式协调者 -> 固定时钟/任务 -> 调用公开方法 -> 核对快照。
 * 观察：本脚本模拟结构化ChildResult来验证状态机，不模拟成功文件读取；真实子循环由章自检验证。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// [NEW 练习] 以下是独立机制实验，不改变正式src或任务权限。
type Lease = { taskId: string; workerId: "worker-1" | "worker-2"; token: number };
type Input = { id: string; role: "explore"; task: string; dependsOn?: string[] };
type Child = { sessionId: string; parentSessionId: string; role: "explore"; status: "completed" | "failed"; summary: string; evidence: { kind: "read"; path: string; startLine: number; endLine: number }[]; usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteTokens: number }; modelCalls: number; requestTokensReserved: number };
type Message = { id: string; acknowledged: boolean };
type Snapshot = { id: string; state: string; token: number; owner?: string };
type Coordinator = {
  create(tasks: Input[]): Snapshot[]; list(): Snapshot[]; claim(worker: Lease["workerId"]): Lease | null;
  heartbeat(lease: Lease): void; finish(lease: Lease, result: Child): void;
  stop(lease: Lease, reason: "expired" | "cancelled"): void; settleStopped(lease: Lease): void;
  sendMessage(lease: Lease, from: "parent" | Lease["workerId"], to: "parent" | Lease["workerId"], clientId: string, body: string): Message;
  readMessages(lease: Lease, to: "parent" | Lease["workerId"]): Message[];
  acknowledgeMessage(lease: Lease, to: "parent" | Lease["workerId"], id: string): Message;
};
const dist = process.env.HMA_SHARED_DIST ?? path.join(process.cwd(), "dist");
const SharedCoordinator: new (options?: { clock?: () => number; leaseMs?: number }) => Coordinator = (await import(pathToFileURL(path.join(dist, "collaboration/coordinator.js")).href)).SharedCoordinator;
const input = (id: string, dependsOn: string[] = []): Input => ({ id, role: "explore", task: `调查${id}的文件证据`, dependsOn });
const observed: Child = { sessionId: "fixture-child", parentSessionId: "fixture-parent", role: "explore", status: "completed", summary: "本题固定的结构化观察", evidence: [{ kind: "read", path: "source.ts", startLine: 1, endLine: 1 }], usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 }, modelCalls: 2, requestTokensReserved: 10 };

/**
 * 练习1：核对两次同步认领和迟到提交。
 * 输入为本脚本任务与可控时钟；输出是独立断言，旧token不能改写第二轮状态。
 * 这里手动settle只模拟runner已经await收尾的时点，不能用它代替正式runner等待。
 */
function ownership(): void {
  let now = 0;
  const registry = new SharedCoordinator({ clock: () => now, leaseMs: 100 });
  registry.create([input("entry"), input("validation")]);
  const first = registry.claim("worker-1")!, other = registry.claim("worker-2")!;
  assert.notEqual(first.taskId, other.taskId);
  assert.throws(() => registry.claim("worker-1"));
  now = 100;
  assert.throws(() => registry.finish(first, observed));
  assert.throws(() => registry.heartbeat(first));
  registry.stop(first, "expired");
  assert.equal(registry.list()[0].state, "stopping");
  assert.throws(() => registry.claim("worker-1"));
  // 正式runner到这里之前必须await旧子会话及检查点关闭；本题只检验转换条件。
  registry.settleStopped(first);
  const second = registry.claim("worker-1")!;
  assert.equal(second.token, first.token + 1);
  assert.throws(() => registry.finish(first, observed));
  assert.equal(registry.list()[0].state, "running");
  registry.finish(second, observed);
  assert.equal(registry.list()[0].state, "completed");
  console.log("✓ 练习1：两个归属、stopping保留与旧token拒绝");
}

/**
 * 练习2：验证图的整批提交与失败传播。
 * 输入包括循环、缺失依赖和无证据的口头完成；输出应为拒绝、空表和blocked。
 * 子摘要不参与完成判断，因此失败不能放行后续调查。
 */
function dependencies(): void {
  const registry = new SharedCoordinator();
  assert.throws(() => registry.create([input("a", ["b"]), input("b", ["a"])]));
  assert.equal(registry.list().length, 0);
  assert.throws(() => registry.create([input("a", ["missing"])]));
  assert.equal(registry.list().length, 0);
  registry.create([input("a"), input("b", ["a"]), input("c", ["b"])]);
  const lease = registry.claim("worker-1")!;
  assert.equal(registry.claim("worker-2"), null);
  registry.finish(lease, { ...observed, summary: "我已全部完成", evidence: [] });
  assert.deepEqual(registry.list().map(item => item.state), ["failed", "blocked", "blocked"]);
  console.log("✓ 练习2：图校验无半批写入，无证据失败向后阻塞");
}

/**
 * 练习3：核对重复发送、重复读取、收件人确认与任务完成分别改变什么。
 * 输入为同一任务租约下的消息；输出是单一消息ID、显式ack和独立completed。
 * 消息正文与确认均不能替代正式子结果，错误收件人不能ack。
 */
function messages(): void {
  const registry = new SharedCoordinator();
  registry.create([input("entry")]);
  const lease = registry.claim("worker-1")!;
  const first = registry.sendMessage(lease, "worker-1", "parent", "finding", "需要复核空令牌分支");
  assert.equal(registry.sendMessage(lease, "worker-1", "parent", "finding", "需要复核空令牌分支").id, first.id);
  assert.throws(() => registry.sendMessage(lease, "worker-1", "parent", "finding", "换了正文"));
  assert.equal(registry.readMessages(lease, "parent").length, 1);
  assert.equal(registry.readMessages(lease, "parent").length, 1);
  assert.equal(registry.list()[0].state, "running");
  assert.throws(() => registry.acknowledgeMessage(lease, "worker-1", first.id));
  assert.equal(registry.acknowledgeMessage(lease, "parent", first.id).acknowledged, true);
  assert.equal(registry.acknowledgeMessage(lease, "parent", first.id).id, first.id);
  assert.equal(registry.readMessages(lease, "parent").length, 0);
  assert.equal(registry.list()[0].state, "running");
  registry.finish(lease, observed);
  assert.equal(registry.list()[0].state, "completed");
  console.log("✓ 练习3：消息去重、读取不确认、ack不完成任务");
}
const selected = process.argv[2] ?? "all";
if (!["1", "2", "3", "all"].includes(selected)) throw new Error("题号应为1、2、3或all。");
if (selected === "1" || selected === "all") ownership();
if (selected === "2" || selected === "all") dependencies();
if (selected === "3" || selected === "all") messages();
```

预期依次输出三条通过信息。断言失败时先看“哪一次状态转换与预测不同”，不要改成仅匹配摘要中的成功文字。需要核对真实worker取消和清理顺序时运行章自检，而不是把本题手动settle当作已经等待的证明。
