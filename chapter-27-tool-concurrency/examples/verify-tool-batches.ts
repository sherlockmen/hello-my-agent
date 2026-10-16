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
