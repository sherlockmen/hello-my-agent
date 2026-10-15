# verify-hooks.ts

`chapter-20-hooks/examples/verify-hooks.ts`

<a href="./content/chapter-20-hooks/examples/verify-hooks.ts" download>下载原始文件</a>

```typescript
/**
 * 第20章完整验证答案 | [NEW 练习] verify-hooks.ts
 * 学习目标：用真实加载器、进程与 Agent Loop 验证执行前、执行后和整轮结束的差别。
 * 输入：当前章已编译的 dist，以及本脚本临时写出的配置和固定测试模型；不请求在线模型。
 * 输出：各组断言的通过提示，失败时抛错；finally 回到原目录并删除临时实验文件。
 * 练习验证流程（产品全局主流程见 agent/agent-loop.ts）：
 *   建临时项目 -> 装入本组 Hook -> 固定模型提出工具 -> 真正审批与执行 -> 核对文件/历史/输入
 *   同文件 worker 模式 -> 读取事件并留下记录 -> 按指定情形返回反馈、坏 JSON 或非零退出
 * 状态与观察：断言分别确认阻止、保留已知工具结果和不再请求模型；不把本地提示当测试通过。
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// [NEW 练习] 真实实现的本地验证，不是产品入口。

type Call = { id: string; name: string; arguments: string };
type Message = { role: string; content: string; toolCallId?: string; isError?: boolean };

/**
 * 把当前编译文件作为真实 Hook 子进程，先记录收到的完整事件。
 * 按启动参数选择正常、坏 JSON 或非零退出，供父进程确定性观察错误去向。
 */
async function worker(): Promise<void> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const input: unknown = JSON.parse(text);
  const mode = process.argv[3];
  await writeFile(process.argv[4], JSON.stringify(input));
  if (mode === "broken") { process.stdout.write("不是 JSON"); return; }
  if (mode === "failure") { process.exitCode = 7; return; }
  const output = mode === "before"
    ? { continue: false, message: "实验规则：此调用不执行。" }
    : mode === "after"
      ? { continue: false, message: "格式检查发现制表符，请修改后重查。" }
      : { continue: false, message: "本地实验收尾，不再请求模型。" };
  process.stdout.write(JSON.stringify(output));
}

/**
 * 在临时项目中依次装入各组配置，让真实核心执行工具及前后检查。
 * 用固定模型保存真正收到的消息，核对文件副作用、原调用结果和模型请求次数。
 * 无论断言是否通过，finally 都恢复当前目录并移除临时项目。
 */
async function main(): Promise<void> {
  const repo = resolve(process.env.HMA_REPO ?? process.cwd());
  const { loadHooks } = await import(pathToFileURL(join(repo, "dist/hooks/lifecycle.js")).href);
  const { runAgent } = await import(pathToFileURL(join(repo, "dist/agent/run.js")).href);
  const script = fileURLToPath(import.meta.url);
  const root = await mkdtemp(join(tmpdir(), "agent-hooks-exercises-"));
  const original = process.cwd();
  try {
    await mkdir(join(root, ".hello-my-agent"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    process.chdir(root);
    const config = join(root, ".hello-my-agent/hooks.json");

    /** 将确定的 worker 模式接到指定事件。 */
    async function state(event: string, mode: string, log: string): Promise<unknown> {
      await writeFile(config, JSON.stringify({ [event]: [{ command: process.execPath,
        args: [script, "worker", mode, join(root, log)], timeout_ms: 5000 }] }));
      return loadHooks(root, true);
    }

    /** 首次返回一条固定调用，下一次返回最终答案；保存真正传入的消息。 */
    async function task(hooks: unknown, call?: Call, signal = new AbortController().signal) {
      let requests = 0;
      let approvals = 0;
      const seen: Message[][] = [];
      const history: Message[] = [];
      const model = { hooks, async generate(messages: Message[]) {
        seen.push(messages.map(item => ({ ...item })));
        requests += 1;
        const toolCalls = requests === 1 && call ? [call] : [];
        return { text: toolCalls.length ? "" : "测试模型的最终回答。", toolCalls,
          finishReason: toolCalls.length ? "tool_calls" : "stop",
          inputTokens: 1, outputTokens: 1, truncated: false };
      } };
      const reply = await runAgent(model, history, "执行实验", signal, undefined,
        async () => { approvals += 1; return { decision: "allow_once" }; });
      return { reply, requests, approvals, seen, history };
    }

    /** 只创建尚不存在的文件，满足真实 write_file 的参数约束。 */
    function write(id: string, path: string): Call {
      return { id, name: "write_file", arguments: JSON.stringify({ path, content: "\treturn 1;\n" }) };
    }

    // 练习一：未启用不读取；启用后检查拒绝，原调用必须有错误结果。
    await writeFile(config, "坏的配置");
    assert.equal(await loadHooks(root, false), undefined);
    await assert.rejects(loadHooks(root, true), /配置/);
    const before = await state("before_tool", "before", "before-event.json");
    const first = await task(before, write("call-before", "src/blocked.ts"));
    assert.equal(first.approvals, 1);
    assert.equal(first.requests, 2);
    await assert.rejects(access(join(root, "src/blocked.ts")));
    const refused = first.history.find(item => item.toolCallId === "call-before");
    assert.equal(refused?.isError, true);
    assert.match(refused?.content ?? "", /执行前钩子阻止/);
    assert.ok(first.seen[1].some(item => item.toolCallId === "call-before" && item.isError));
    console.log("通过一：审批后检查拒绝，未写入文件，错误回到同一调用及下一次模型输入。");

    // 练习二：after 的 continue:false 不撤销写入；反馈追加到真实结果。
    const after = await state("after_tool", "after", "after-event.json");
    const second = await task(after, write("call-after", "src/written.ts"));
    assert.equal(await readFile(join(root, "src/written.ts"), "utf8"), "\treturn 1;\n");
    const checked = second.history.find(item => item.toolCallId === "call-after");
    assert.equal(checked?.isError, false);
    assert.match(checked?.content ?? "", /格式检查发现制表符/);
    assert.ok(second.seen[1].some(item => item.content.includes("格式检查发现制表符")));
    const event = JSON.parse(await readFile(join(root, "after-event.json"), "utf8"));
    assert.equal(event.outcome, "success");
    assert.equal(event.call.id, "call-after");
    assert.equal(typeof event.result, "string");
    const failing = await state("after_tool", "failure", "failed-event.json");
    const failed = await task(failing, write("call-failed", "src/still-written.ts"));
    await access(join(root, "src/still-written.ts"));
    const retained = failed.history.find(item => item.toolCallId === "call-failed");
    assert.equal(retained?.isError, false);
    assert.match(retained?.content ?? "", /执行后钩子失败/);
    console.log("通过二：文件与原成功结果保留，检查反馈进入下一请求；脚本失败不回滚。");

    // 练习三：没有工具也收尾一次；反馈不能触发额外模型请求。
    const stop = await state("stop", "stop", "stop-event.json");
    const third = await task(stop);
    assert.equal(third.requests, 1);
    assert.match(third.reply.text, /测试模型的最终回答/);
    assert.match(third.reply.text, /本地结束钩子反馈/);
    assert.equal(JSON.parse(await readFile(join(root, "stop-event.json"), "utf8")).outcome, "completed");
    const broken = await state("stop", "broken", "broken-event.json");
    const kept = await task(broken);
    assert.equal(kept.requests, 1);
    assert.match(kept.reply.text, /测试模型的最终回答/);
    assert.match(kept.reply.text, /结束钩子失败/);
    const cancelled = await state("stop", "stop", "cancelled-event.json");
    const controller = new AbortController();
    controller.abort(new Error("实验取消"));
    await assert.rejects(task(cancelled, undefined, controller.signal), /实验取消/);
    await assert.rejects(access(join(root, "cancelled-event.json")));
    console.log("通过三：结束反馈只追加本地结果，格式错误保留回答，预先取消不启动脚本。");
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
}

(process.argv[2] === "worker" ? worker() : main()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```
