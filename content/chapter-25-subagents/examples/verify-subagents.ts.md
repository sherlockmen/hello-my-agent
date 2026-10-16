# verify-subagents.ts

`chapter-25-subagents/examples/verify-subagents.ts`

<a href="./content/chapter-25-subagents/examples/verify-subagents.ts" download>下载原始文件</a>

```typescript
/**
 * 第25章完整答案 | [NEW 练习] examples/verify-subagents.ts
 * 学习目标：观察独立历史、工具边界、原编号回传与本地终态。
 * 输入：已构建的本节dist与组号1/2/3/all；输出：真实循环、读取与会话文件的断言。
 * 练习流程：确定性模型 -> 真实父/子AgentLoop -> 本地工具 -> 子结果 -> 父下一次请求。
 * 模型替身只安排调用顺序，不访问在线模型；finally恢复工作目录并清理临时文件。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Message = { role: string; content: string; toolCallId?: string; isError?: boolean };
type Scope = { allowedTools?: string[]; rolePrompt?: string };
type StateEvent = { type: string; sessionId?: string; parentSessionId?: string; status?: string };
const budget = () => ({ inputEstimate: 32, systemEstimate: 8, toolsEstimate: 8, messagesEstimate: 16, windowTokens: 8192, outputReserve: 16, remainingEstimate: 8144, withinBudget: true });
const reply = (text: string) => ({ text, toolCalls: [], finishReason: "stop", inputTokens: 10, outputTokens: 2, cachedInputTokens: null, cacheWriteTokens: null });
const tool = (id: string, name: string, args: object) => ({ ...reply(""), finishReason: "tool_calls", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

async function main(): Promise<void> {
  const dist = resolve(process.env.HMA_SUBAGENTS_DIST ?? join(process.env.HMA_REPO ?? process.cwd(), "dist"));
  const load = (path: string) => import(pathToFileURL(join(dist, path)).href);
  const { runSubagent, parseChildTask } = await load("subagents/runner.js");
  const { agentLoop } = await load("agent/agent-loop.js");
  const group = process.argv[2] ?? "all";
  assert.ok(["1", "2", "3", "all"].includes(group), "组号必须是1、2、3或all");
  const directory = await mkdtemp(join(tmpdir(), "hma-subagent-exercise-"));
  const project = join(directory, "project"), sessions = join(directory, "sessions"), previousCwd = process.cwd();
  const signal = () => new AbortController().signal;
  try {
    await mkdir(project);
    await writeFile(join(project, "package.json"), '{"type":"module"}');
    await writeFile(join(project, "note.txt"), "CHILD_PRIVATE_MATERIAL\n会话通过检查点保存。\n");
    process.chdir(project);
    if (group === "1" || group === "all") {
      const parentId = randomUUID(); let parentCalls = 0, childCalls = 0, childId = "";
      const model = { inspectContext: budget,
        async generate(messages: Message[], _signal: AbortSignal, _onText: unknown, scope: Scope = {}) {
          if (scope.allowedTools) {
            assert.deepEqual(scope.allowedTools, ["read_file", "glob", "grep"]);
            assert.ok(!JSON.stringify(messages).includes("PARENT_ONLY_SECRET"));
            if (++childCalls === 1) return tool("read_1", "read_file", { path: "note.txt", offset: 1, limit: 10 });
            assert.ok(messages.some(message => message.role === "tool" && message.content.includes("CHILD_PRIVATE_MATERIAL")));
            return reply("note.txt 说明通过检查点保存会话。");
          }
          if (++parentCalls === 1) return tool("delegate_1", "delegate_task", { role: "explore", task: "读取note.txt，说明保存方式并给出路径" });
          const resultMessage = messages.find(message => message.role === "tool" && message.toolCallId === "delegate_1");
          assert.ok(resultMessage); const result = JSON.parse(resultMessage.content);
          assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.parentSessionId, parentId);
          assert.notEqual(result.sessionId, parentId); childId = result.sessionId;
          assert.match(result.summary, /检查点/);
          assert.ok(!JSON.stringify(messages).includes("CHILD_PRIVATE_MATERIAL"), "父历史没有复制子工具全文");
          return reply("子任务定位了note.txt，下面可以继续核对。");
        },
      };
      const history: Message[] = [{ role: "user", content: "PARENT_ONLY_SECRET" }];
      await agentLoop(model, history, "调查保存方式", signal(), undefined, undefined, new Set(), { sessionId: parentId, childSessionDirectory: sessions });
      assert.equal(parentCalls, 2); assert.equal(childCalls, 2);
      const stored = await readFile(join(sessions, `${childId}.jsonl`), "utf8");
      assert.ok(stored.includes("CHILD_PRIVATE_MATERIAL")); assert.ok(!stored.includes("PARENT_ONLY_SECRET"));
      assert.ok(!(await readdir(sessions)).some(name => name.endsWith(".lock")));
      console.log("通过一：子历史独立；真实读取进入子请求，结构化结果按原委派编号返回父请求。");
    }
    if (group === "2" || group === "all") {
      let calls = 0;
      const model = { inspectContext: budget,
        async generate(messages: Message[], _signal: AbortSignal, _onText: unknown, scope: Scope) {
          assert.deepEqual(scope.allowedTools, ["read_file", "glob", "grep"]);
          assert.match(scope.rolePrompt ?? "", /审查/);
          calls++;
          if (calls === 1) return tool("write_1", "write_file", { path: "forbidden.txt", content: "must not exist" });
          if (calls === 2) {
            assert.ok(messages.some(message => message.role === "tool" && message.toolCallId === "write_1" && message.isError && /不允许|拒绝/.test(message.content)));
            return tool("read_2", "read_file", { path: "note.txt", offset: 1, limit: 10 });
          }
          assert.ok(messages.some(message => message.role === "tool" && message.content.includes("CHILD_PRIVATE_MATERIAL")));
          return reply("已读取note.txt；文字随意声称也读了invented.txt。");
        },
      };
      assert.throws(() => parseChildTask(JSON.stringify({ role: "review", task: "检查", tools: ["write_file"] })), /权限字段/);
      const result = await runSubagent(model, JSON.stringify({ role: "review", task: "检查note.txt" }), signal(), { sessionDirectory: sessions });
      assert.equal(result.status, "completed");
      assert.ok(!(await readdir(project)).includes("forbidden.txt"));
      assert.ok(result.evidence.some((item: { kind: string; path: string }) => item.kind === "read" && item.path === "note.txt"));
      assert.ok(!result.evidence.some((item: { path: string }) => item.path === "invented.txt"));
      console.log("通过二：越界工具返回错误而不写文件；本地证据只来自真实工具元数据。");
    }
    if (group === "3" || group === "all") {
      const controller = new AbortController(), events: StateEvent[] = [];
      let start!: () => void, cleaned = 0, calls = 0;
      const started = new Promise<void>(done => { start = done; });
      const waitingModel = { inspectContext: budget,
        async generate(_messages: Message[], current: AbortSignal) {
          calls++; start();
          await new Promise<never>((_done, reject) => {
            const cancel = () => { cleaned++; reject(current.reason); };
            if (current.aborted) cancel(); else current.addEventListener("abort", cancel, { once: true });
          });
          return reply("unreachable");
        },
      };
      const pending = runSubagent(waitingModel, JSON.stringify({ role: "explore", task: "等待中的子任务" }), controller.signal, { sessionDirectory: sessions, observer: (event: StateEvent) => events.push(event) });
      await started; controller.abort(new Error("CANCEL_PARENT"));
      const cancelled = await pending;
      assert.equal(cancelled.status, "cancelled"); assert.equal(calls, 1); assert.equal(cleaned, 1);
      assert.equal(cancelled.usage.inputTokens, null, "未取得服务报告的用量不能显示为0");
      const states = events.filter(event => event.type === "child_state");
      assert.equal(states[0].status, "starting"); assert.equal(states.at(-1)?.status, "cancelled");
      assert.ok(states.every(event => event.sessionId === cancelled.sessionId));
      assert.ok(!(await readdir(sessions)).some(name => name.endsWith(".lock")));
      let generated = 0;
      const limited = await runSubagent({ inspectContext: budget, async generate() { generated++; return reply("不应发送"); } }, JSON.stringify({ role: "explore", task: "预算过小" }), signal(), { sessionDirectory: sessions, requestTokenBudget: 1 });
      assert.equal(limited.status, "budget_exhausted"); assert.equal(generated, 0);
      assert.equal(limited.modelCalls, 0);
      console.log("通过三：取消等待本地收尾并发出终态；预算耗尽在请求前停止。");
    }
  } finally { process.chdir(previousCwd); await rm(directory, { recursive: true, force: true }); }
}
await main();
```
