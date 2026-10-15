# 第 20 章练习与答案

[第 20 章首页](/content/chapter-20-hooks/README.md) · [20.3 结束钩子](/content/chapter-20-hooks/03-stop-hooks/README.md)

这三题沿一次文件写入区分检查时机。先预测，再运行下面的完整 TypeScript 答案。实验使用真实加载器、真实工具与真实 Agent Loop；本地测试模型只固定“先请求一项工具、再回答”，不请求在线模型，不改产品源码。

## 练习一：批准以后，文件为什么仍然没有写入

把配置写坏，不启用 Hook 时会不会读取它？启用有效的 `before_tool` 后，用户已经批准写入，脚本却返回 `continue: false`：文件、当前调用的结果和下一次模型输入分别应该是什么？

答案：未启用时不会打开配置；显式启用时坏配置阻止加载。前置拒绝发生在审批之后、写入之前，所以文件不存在，原调用有错误结果，下一次模型请求能读到同一个调用的拒绝原因。批准不会跳过项目约束。

## 练习二：后置检查失败，能否把原写入记成失败

把相同的 `continue: false` 移到 `after_tool`。脚本给出格式反馈时，文件是否存在？检查脚本改为退出码 7，原工具成功标记会不会改变？

答案：文件已经写入。执行后事件不使用 `continue` 撤销或阻止工具；有效 `message` 追加到原结果。脚本退出失败也只追加检查失败信息，保留真实工具结果和原成功标记。下一次模型会同时看到写入事实与检查状态，仍需自行选择是否修正。

## 练习三：最后一条本地提醒会不会再次请求模型

没有工具调用的纯回答是否触发 `stop`？脚本返回 `continue: false`、输出损坏的 JSON、或任务在开始前已取消时，各会发生什么？

答案：纯回答正常结束也有一次收尾；`continue: false` 不启动新一轮模型请求。坏 JSON 显示收尾失败并保留原回答。任务预先取消时不再启动新收尾脚本；这与取消已经运行的脚本、等待它清理是两种时机。

## 完整可执行答案

仓库中的 [examples/verify-hooks.ts](/content/chapter-20-hooks/examples/verify-hooks.ts.md) 与下面一致。它也充当被启动的 Hook 进程：`worker` 分支只读取 stdin、写出约定结果。因此所有实验依赖都在这一份 TypeScript 中。

<details>
<summary>展开完整答案</summary>

```ts
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

</details>

从仓库根执行。先编译 20.3，再将练习答案单独编译到临时目录；这个步骤不改变 Agent 的实现。

```bash
npm run lesson:20.3
```

```bash
export HMA_REPO="$PWD"
HMA_EXERCISE="$(mktemp -d)"
cat > "$HMA_EXERCISE/package.json" <<'JSON'
{"private":true,"type":"module"}
JSON
"$HMA_REPO/node_modules/.bin/tsc" chapter-20-hooks/examples/verify-hooks.ts \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  --outDir "$HMA_EXERCISE"
node "$HMA_EXERCISE/verify-hooks.js"
rm -rf "$HMA_EXERCISE"
```

应依次看到三条“通过”。断言核对的分别是实际文件、原调用的结果、真正传入下一次 `generate` 的消息，以及生成请求次数；测试模型回答里的“完成”不作为证据。子进程超时与进程组清理沿用本章执行器，取消不能回滚脚本自行产生的副作用。
