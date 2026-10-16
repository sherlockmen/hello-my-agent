# 第27章练习：怎样证明并发没有丢掉顺序、资源和结果

[第27章首页](README.md) · [27.1 有界只读并发](01-bounded-reads/README.md) · [27.2 超时与清理](02-cancel-and-cleanup/README.md) · [27.3 结果屏障](03-batch-results/README.md)

下面三题沿用27.3完整实现，验证脚本单独保存，不修改正式 `src/`。我们关心的是实际顺序、启动事实和模型收到的内容，不能只断言界面打印了“成功”。先独立回答，再展开完整答案。

## 练习1：先完成一项，队列里的谁可以开始

同一批依次是三次读取slow、fast、next，一次写入write，再一次读取after。容量为2，slow耗时60毫秒，其余耗时15毫秒。

1. fast先结束后，next可以开始吗？write可以开始吗？分别依据什么？
2. 给执行函数记录 `start:<ID>` 与 `end:<ID>`，同时记录活跃数量。怎样证明“同段补位”与“写入屏障”，避免只比较总耗时？
3. 若把load_skill或未知MCP工具加进来，应默认并发吗？

<details>
<summary>思路与预期事实</summary>

slow、fast、next是连续读取段，fast归还一个名额后，next可以在slow结束前开始。write属于下一段，必须等前三次读取都结束；after又必须等write结束。因此三个顺序断言分别是 `start:next < end:slow`、`start:write > end:slow`、`start:after > end:write`，再检查峰值活跃数量恰为2。

load_skill改变已加载技能集合，后续资源读取可能依赖它；未知工具没有已证明的并发约定，所以两者都作为屏障。白名单按明确工具名称选择，不靠名称里看起来有read就放行。此题执行函数是替身，目的是精确控制顺序；正式工具仍要经过原权限链。

</details>

## 练习2：超时发生后，名额什么时候归还

容量为1，有held与queued两次读取。held的底层等待需要70毫秒，即使收到取消也不能提前返回；执行期限10毫秒，排队期限25毫秒。

1. 10毫秒时执行信号已经取消，能否立刻启动queued？
2. queued会进入执行函数吗？结果应说明“执行超时”还是“排队超时”？
3. 再做一批：first收到停止请求后还需要30毫秒收尾，second只能在其收尾后开始。怎样写断言？

<details>
<summary>思路与预期事实</summary>

不能因执行计时器到期就归还名额。held仍在底层等待，提前发放会让旧操作与新操作同时占用资源，违反容量1。调度器继续等held真正返回，因此总等待至少接近70毫秒；held被标记execution_timeout。

queued从整批入队开始计时，25毫秒到期时还未领槽，形成queue_timeout，且执行函数的started列表只有held。第二个实验使用 `finishedCleanup` 标记：first在停止请求后再等30毫秒才置true；second进入执行函数的第一条断言必须看到true。它验证的是收尾与下一项启动的先后，而不是“最后两项都结束了”。

此题模拟不可强杀的底层等待。真实文件流响应取消时还要关闭并等待close，某些文件系统查询则只能等返回；调度器不能保证所有操作恰好在10毫秒内结束。

</details>

## 练习3：真实完成乱序后，模型到底收到什么

在临时项目创建一个16万行文件和一个小文件，再请求读取大文件第150000行、读取不存在的文件、读取小文件。保留原callID slow、missing、fast。

1. 用工具完成事件确认fast早于slow结束。下一次模型请求应收到几份观察，顺序和ID是什么？
2. missing返回普通工具错误后，是否还应保留其他两份成功内容？
3. 用本地模型替身发出这批固定调用，再检查第二次generate的输入。为什么这比只检查TUI行数更能证明结果屏障？

<details>
<summary>思路与预期事实</summary>

完成事件可以先出现fast，下一次模型输入仍应依次包含slow、missing、fast，分别保留原callID。slow带第150000行内容，missing带isError和缺失原因，fast带小文件内容。普通失败是一份可供模型判断的观察，不会抹去同伴成果。

事件轨迹还要满足： `model:2` 发生在 `barrier:3` 之后。模型替身直接检查下一次请求的真实messages，不依赖随机模型是否碰巧总结正确，也不把界面显示当成历史已经提交的证明。它只替代在线生成过程，文件读取与Agent循环使用正式实现。

</details>

## 完整TypeScript答案

下面一份脚本可以分别运行1、2、3或all。配套仓库已保存为 [examples/verify-tool-batches.ts](examples/verify-tool-batches.ts)；自己跟写时，在项目根建立 `examples/verify-tool-batches.ts` 并完整保存代码。先编译27.3，再独立编译练习脚本：

```bash
npm run lesson:27.3
npx tsc chapter-27-tool-concurrency/examples/verify-tool-batches.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --outDir .exercise-dist/ch27
HMA_TOOLS_DIST="$PWD/dist" node .exercise-dist/ch27/verify-tool-batches.js all
```

自己跟写的项目把上面第二条的源码路径换成 `examples/verify-tool-batches.ts`。第三条的dist必须来自27.3；最终脚本会在独立临时项目中运行，结束后恢复原cwd并清理测试文件。不需要配置模型密钥。

```ts
/**
 * 第27章独立练习答案：有限容量、真实收尾与整批观察。
 * 先编译27.3；HMA_TOOLS_DIST指向该节构建目录。本脚本不调用线上模型。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

type Call = { id: string; name: string; arguments: string };
type Item = { call: Call; sequence: number };
type Failure = { state: string; started: boolean; message: string };
type Message = { role: string; content: string; toolCallId?: string; isError?: boolean };
type Event = { type: string; call?: Call | number; results?: number };
const dist = process.env.HMA_TOOLS_DIST ?? path.join(process.cwd(), "dist");
const { runToolBatch, isParallelRead } = await import(pathToFileURL(path.join(dist, "agent/tool-batch.js")).href);
const { agentLoop } = await import(pathToFileURL(path.join(dist, "agent/agent-loop.js")).href);
const signal = (): AbortSignal => new AbortController().signal;
const call = (id: string, name = "read_file", args: object = { path: "small.ts", offset: 1, limit: 10 }): Call => ({ id, name, arguments: JSON.stringify(args) });
const item = (id: string, sequence: number, name = "read_file"): Item => ({ call: call(id, name), sequence });
const reply = (text: string, toolCalls: Call[] = []) => ({ text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", inputTokens: 3, outputTokens: 2, truncated: false });

/** 在同一读取段补位；跨写入和加载技能的屏障必须等前段收齐。 */
async function bounded(): Promise<void> {
  assert.ok(isParallelRead(call("r")));
  for (const name of ["write_file", "load_skill", "delegate_task", "mcp_unknown"]) assert.equal(isParallelRead(call("x", name)), false);
  const timeline: string[] = [];
  let active = 0, maximum = 0;
  await runToolBatch([item("slow", 1), item("fast", 2), item("next", 3), item("write", 4, "write_file"), item("after", 5)], signal(), async ({ call }: Item) => {
    active += 1; maximum = Math.max(maximum, active); timeline.push(`start:${call.id}`);
    await delay(call.id === "slow" ? 60 : 15);
    timeline.push(`end:${call.id}`); active -= 1; return true;
  }, () => {}, { concurrency: 2 });
  assert.equal(maximum, 2);
  assert.ok(timeline.indexOf("start:next") < timeline.indexOf("end:slow"));
  assert.ok(timeline.indexOf("start:write") > timeline.indexOf("end:slow"));
  assert.ok(timeline.indexOf("start:after") > timeline.indexOf("end:write"));
  console.log("练习1通过：白名单、容量2、同段补位和串行屏障。");
}

/** 模拟不能强杀的底层等待；超时后槽仍占用，排队项过期就不启动。 */
async function cleanup(): Promise<void> {
  const started: string[] = [], failures: string[] = [];
  const began = Date.now();
  await runToolBatch([item("held", 1), item("queued", 2)], signal(), async ({ call }: Item, inner: AbortSignal) => {
    started.push(call.id); await delay(70); assert.equal(inner.aborted, true); return true;
  }, () => {}, { concurrency: 1, queueTimeoutMs: 25, executionTimeoutMs: 10,
    onFailure: ({ call }: Item, failure: Failure) => failures.push(`${call.id}:${failure.state}`) });
  assert.ok(Date.now() - began >= 65);
  assert.deepEqual(started, ["held"]);
  assert.deepEqual(failures.sort(), ["held:execution_timeout", "queued:queue_timeout"]);
  let finishedCleanup = false;
  await runToolBatch([item("first", 1), item("second", 2)], signal(), async ({ call }: Item, inner: AbortSignal) => {
    if (call.id === "first") {
      await new Promise<void>(resolve => inner.addEventListener("abort", () => resolve(), { once: true }));
      await delay(30); finishedCleanup = true;
    } else assert.ok(finishedCleanup);
    return true;
  }, () => {}, { concurrency: 1, queueTimeoutMs: 500, executionTimeoutMs: 10 });
  console.log("练习2通过：排队/执行两只时钟、不能提前归还容量、收尾后再发下一项。");
}

/** 实际读取大文件较深位置，让小文件先完成；模型仍按原调用身份收到整批。 */
async function observations(cwd: string): Promise<void> {
  await writeFile(path.join(cwd, "package.json"), '{"type":"module"}');
  await writeFile(path.join(cwd, "small.ts"), "export const observed = 7;\n");
  await writeFile(path.join(cwd, "slow.ts"), ('const row = "' + "x".repeat(20) + '";\n').repeat(160000));
  const calls = [call("slow", "read_file", { path: "slow.ts", offset: 150000, limit: 3 }), call("missing", "read_file", { path: "absent.ts", offset: 1, limit: 1 }), call("fast")];
  const history: Message[] = [], timeline: string[] = [];
  let requests = 0;
  const model = { async generate(messages: Message[]) {
    requests += 1; timeline.push(`model:${requests}`);
    if (requests === 1) return reply("", calls);
    const results = messages.filter(message => message.role === "tool");
    assert.deepEqual(results.map(message => message.toolCallId), ["slow", "missing", "fast"]);
    assert.match(results[0].content, /150000:/); assert.equal(results[1].isError, true); assert.match(results[2].content, /observed = 7/);
    return reply("ALL_OBSERVED");
  } };
  await agentLoop(model, history, "读取三个互不依赖的文件", signal(), (event: Event) => {
    if (event.type === "tool_finish" && typeof event.call === "object") timeline.push(`finish:${event.call.id}`);
    if (event.type === "tool_batch_finish") timeline.push(`barrier:${event.results}`);
  });
  assert.ok(timeline.indexOf("finish:fast") < timeline.indexOf("finish:slow"));
  assert.ok(timeline.indexOf("model:2") > timeline.indexOf("barrier:3"));
  assert.equal(history.filter(message => message.role === "tool").length, 3);
  console.log("练习3通过：真实倒序完成、普通失败不丢同伴、完整批次按原callID交回下一次模型。");
}

/** 使用独立临时项目；恢复cwd后删除测试文件，不改正式src。 */
async function main(): Promise<void> {
  const group = process.argv[2] ?? "all";
  assert.ok(["1", "2", "3", "all"].includes(group), "题号只能是1、2、3或all");
  const cwd = await mkdtemp(path.join(tmpdir(), "hma-batches-exercises-")), previous = process.cwd();
  process.chdir(cwd);
  try {
    if (group === "1" || group === "all") await bounded();
    if (group === "2" || group === "all") await cleanup();
    if (group === "3" || group === "all") await observations(cwd);
  } finally { process.chdir(previous); await rm(cwd, { recursive: true, force: true }); }
}
await main();
```

全部通过时应分别看到“练习1通过”“练习2通过”“练习3通过”。若顺序断言失败，保留实际轨迹检查；不要删掉断言来接受一个没有证明的结果。

本章正文和独立练习共用正式API；练习没有增加模型工具或改变权限。它们证明指定输入下的容量、等待与结果归属，不证明外部文件在并发读取时构成同一原子快照。

本章练习状态：待用户确认。
