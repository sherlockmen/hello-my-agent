# 第 25 章练习与答案

[第 25 章首页](README.md) · [25.3 子任务观察与取消](03-child-observation/README.md)

先预测下面三种情况，再运行完整 TypeScript 答案。答案使用真实 Agent Loop、真实读取工具与真实子会话 JSONL；确定性模型只控制调用顺序。我们检查的是历史隔离、权限、结果回传和本地收尾，不把替身回答当成真实模型结论。

## 练习一：父历史怎样收到独立子循环的结果

父模型委派读取一个文件。子模型第二次请求需要看到读取正文，但父模型是否也应收到整份子历史？父模型下一次请求应通过哪个调用编号取得结果？

答案：子循环保留自己的中间历史，父历史只取得一次结构化委派结果。完整答案运行真实父循环，断言子模型未收到父私有历史，实际工具正文进入子模型后，再以原 `delegate_task` 编号返回父模型；子会话另有自己的文件。

## 练习二：模型仍然要求写文件

模型请求里只列出三个只读工具，却返回 `write_file`。程序能否因为它来自 review 角色就执行？最终文字自称检查了一个从未读取的路径，能否作为本地证据？

答案：执行层再次检查白名单，越界调用成为错误结果送回子模型，文件不发生写入。本地证据只取成功工具的 metadata，按实际读取、搜索命中和枚举发现区分；模型文字不能新增证据。完整答案同时检查工具错误被子模型看到、真实读取路径被保留、编造路径没有混入证据。

## 练习三：取消和预算耗尽怎样收尾

子模型正在等待，父任务取消；另一子任务在发请求前已超过本地 token 预留。它们是否都能标为 completed？“cancelled”能否证明远端算力已经停止？

答案：取消、预算耗尽与正常完成分别返回终态。完整答案让本地等待在信号中止后退出，检查终态事件、会话锁释放和没有额外请求，再检查预算在发送前拒绝。实验只证明本地链路已收尾，不能证明远端服务的计算状态。

## 完整可执行答案

将下面完整保存为 [examples/verify-subagents.ts](examples/verify-subagents.ts)。这是独立练习，不修改下一章沿用的 `src/`；脚本的断言失败会以非零状态退出，结束后清理自己创建的资源。

<details>
<summary>展开完整 TypeScript 答案</summary>

```ts
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

</details>

## 构建与运行

完成 25.1 时先编译 25.1，再运行组号 `1`；完成 25.2 时编译 25.2，再运行 `2`。学完 25.3 后按下面步骤运行全部三组。先从仓库根构建本章最终快照：

```bash
npm run lesson:25.3
```

再单独编译练习。临时目录中的 package.json 让 Node 按 ES module 解释编译结果；`HMA_REPO` 使脚本能找到刚构建的本章 dist。

```bash
export HMA_REPO="$PWD"
SUBAGENT_EXERCISE="$(mktemp -d)"
printf '%s\n' '{"private":true,"type":"module"}' > "$SUBAGENT_EXERCISE/package.json"
"$HMA_REPO/node_modules/.bin/tsc" chapter-25-subagents/examples/verify-subagents.ts \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  --outDir "$SUBAGENT_EXERCISE"
```

最后运行，编译命令本身不会触发断言：

```bash
node "$SUBAGENT_EXERCISE/verify-subagents.js" all
```

将最后的 `all` 换成 `1`、`2` 或 `3`，可以只检查一组。输出对应的“通过”才表示断言成立；程序抛错时先核对当前构建的小节，不要把输出改为固定成功文字。临时编译目录可在查看结果后自行删除。

本章状态：待用户确认。
