# 第 13 章练习与答案

[第 13 章首页](README.md) · [13.1 保存](01-save-session/README.md) · [13.2 读取](02-read-records/README.md) · [13.3 恢复](03-resume-session/README.md) · [13.4 管理](04-manage-sessions/README.md)

本章练习验证已经完成的能力，不增加另一套产品功能。先预测行为，再执行完整答案。脚本使用临时会话、真实读取器和 writer；需要模型决策时传入内存模型，不访问 API，也不读写自己的会话目录。

以下脚本都在仓库根目录创建并运行，产物放在 `docs/.work/`；每题先用对应的 `lesson` 命令构建，不要求修改课程源码。

## 练习一：三份文字分别保存在哪里

任务 6 正在执行，TUI 出现下面三种状态：

1. “请测试负数”已经被核心收取，进入本轮局部消息，但任务还没结束。
2. `#18`“顺便说明零相加”仍在待处理队列，所属任务为 6。
3. 我们正在编辑 `#18`，编辑稿是“顺便说明两个零相加”，还没有按 Enter 保存。

先从保存对象判断：如果捕获这个时刻的白名单状态，三份文字分别会从哪个对象进入快照，哪份还不会保存？这里只预测数据范围，不增加新的界面保存入口。再预测任务 6 收尾后实际追加的快照有什么变化。

<details>
<summary>参考答案</summary>

第一份已经离开队列，但仍在核心本轮局部消息里，尚未提交到会话 `history`；此时不能仅因“核心已收取”，就认为它已经出现在快照的 `state.messages` 中。任务正常结束或完成中断收束后，核心提交本轮消息，收尾快照才保存这些已提交消息。

第二份从队列进入 `state.pendingInputs`，保留 `id: 18`、原文和 `run: 6`。这说明它仍待处理，没有被写成 user 消息。若任务后续没有收取它，收尾快照仍保留该队列项；它不会自动改属下一项任务。

第三份属于独立编辑稿，尚未明确提交，不在本节白名单中。因此保存的仍是队列原文“顺便说明零相加”。如果原项仍在且编辑保存成功，队列原文才更新，随后由 `queue_change` 检查点记录新文。

保存点捕获的是各字段当时已经持有的值。`messages` 是已提交的模型历史，不等于当前运行中所有局部数据；这也是为什么本节先写文件，还不能直接承诺恢复任何保存点并继续运行。

</details>

## 练习二：验证连续有效前缀与严格校验

同一份文件先写会话头和完整的 #1，再分别作下面的变化。预测哪些仍能取得 #1，哪些必须停止，并说明读取后文件是否会改变。

| 变化 | 要判断的关键点 |
| --- | --- |
| 末尾追加未换行的半段 JSON | 是否属于一条已经完成的记录 |
| 末尾追加能解析、但没换行的完整 JSON | JSON 合法与记录完成是否相同 |
| 中间出现带换行的坏 JSON，后面又有合法 #2 | 能否跳过坏行继续找最后快照 |
| 版本改成 2，或工具结果 ID 与调用 ID 不同 | 语法可解析是否足以恢复 |
| 队列 ID 重复、计数倒退，或多出 `grants` 字段 | TypeScript 类型能否代替磁盘校验 |

先构建 13.2：

```bash
npm run lesson:13.2
```

<details>
<summary>完整验证脚本与答案</summary>

将下面完整内容保存为 `docs/.work/verify-ch13-read.mjs`。每个用例都调用真实 `readSession()`；脚本会比较读取前后的字节，不用手写一个“预期恢复状态”代替读取分支。

<!-- exercise:13.2 -->
```js
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { readSession } = await import(pathToFileURL(resolve("dist/sessions/read-session.js")));
const directory = await mkdtemp(join(tmpdir(), "hello-agent-exercise-read-"));
const id = randomUUID(), path = join(directory, `${id}.jsonl`);
const time = "2026-10-15T00:00:00.000Z";
const header = { version: 1, type: "session", sessionId: id, createdAt: time, cwd: process.cwd() };
const state = {
  messages: [
    { role: "user", content: "请检查 src/add.ts 的负数相加" },
    { role: "assistant", content: "", toolCalls: [{ id: "read-1", name: "read_file", arguments: '{"path":"src/add.ts"}' }] },
    { role: "tool", toolCallId: "read-1", content: "export function add(a: number, b: number) { return a + b; }", isError: false },
    { role: "assistant", content: "读取完成，还需要测试依据。" },
  ],
  mode: "execute", tasks: [], pendingInputs: [{ id: 18, text: "顺便说明零相加", run: 6 }], run: 6, nextInputId: 19,
};
const checkpoint = (seq, value = state) => ({ version: 1, type: "checkpoint", sessionId: id, seq, savedAt: time, reason: "run_end", state: value });
const line = value => JSON.stringify(value) + "\n";
const prefix = line(header) + line(checkpoint(1));
async function load(contents) {
  await writeFile(path, contents);
  const before = await readFile(path);
  try { return await readSession(id, directory); }
  finally { assert.deepEqual(await readFile(path), before, "读取不得改动文件"); }
}
async function reject(contents, pattern = /不是支持的完整记录/) {
  await assert.rejects(load(contents), pattern);
}

try {
  const normal = await load(prefix);
  assert.deepEqual(normal.state, state);
  assert.equal(normal.seq, 1);
  assert.equal(normal.hasTrailingFragment, false);
  assert.equal(normal.validBytes, Buffer.byteLength(prefix));

  for (const tail of ['{"version":1', JSON.stringify(checkpoint(2))]) {
    const record = await load(prefix + tail);
    assert.equal(record.seq, 1);
    assert.deepEqual(record.state, state);
    assert.equal(record.hasTrailingFragment, true);
    assert.equal(record.validBytes, Buffer.byteLength(prefix));
    assert.equal(record.warnings.length, 1);
  }
  await reject(prefix + "坏 JSON\n" + line(checkpoint(2)), /第 3 行/);
  await reject(line({ ...header, version: 2 }) + line(checkpoint(1)));
  await reject(prefix + line(checkpoint(1)), /第 3 行/);
  const wrongTool = structuredClone(state);
  wrongTool.messages[2].toolCallId = "another-call";
  await reject(line(header) + line(checkpoint(1, wrongTool)));
  const missingTool = structuredClone(state);
  missingTool.messages.splice(2, 1);
  await reject(line(header) + line(checkpoint(1, missingTool)));
  await reject(line(header) + line(checkpoint(1, { ...state, mode: "unknown" })));
  await reject(line(header) + line(checkpoint(1, { ...state, grants: [".git"] })));
  await reject(line(header) + line(checkpoint(1, { ...state, pendingInputs: [state.pendingInputs[0], state.pendingInputs[0]] })));
  await reject(prefix + line(checkpoint(2, { ...state, run: 5, pendingInputs: [] })));
  const empty = await load(line(header));
  assert.equal(empty.seq, 0);
  assert.equal(empty.state, undefined);
  await reject(JSON.stringify(header), /会话头尚未完整/);
  await assert.rejects(readSession("../outside", directory), /完整的小写 UUID/);
  console.log("通过：有效尾片、坏中间行、版本、工具配对、状态与只读边界。");
} finally { await rm(directory, { recursive: true, force: true }); }
```

在仓库根目录运行：

```bash
node docs/.work/verify-ch13-read.mjs
```

只有未换行尾片可以被排除，前面的完整 #1 仍可读取。即使尾片已经是合法 JSON，也不能越过本章选定的换行完成边界。带换行的坏行、未知版本、错配工具结果及非法状态都停止读取；后面再有合法记录也不能把中间缺口补成连续历史。所有情况都保持源文件字节不变。

</details>

## 练习三：验证恢复只装数据并继续编号

先预测：取得 `writer.restored` 时会执行旧工具吗？新任务开始记录里有没有本轮 prompt？旧队列 #18 会不会自动变成新任务的补充？如果 `run_start` 后还有一条 `queue_change`，能否认为任务已经结束？

构建 13.3：

```bash
npm run lesson:13.3
```

<details>
<summary>完整验证脚本与答案</summary>

将下面完整内容保存为 `docs/.work/verify-ch13-resume.mjs`。脚本用真实 writer、文本消费者和 Agent 核心，只用内存模型替换远程模型；旧命令如果被重放，会在临时工作区留下文件。它还检查活锁、明确接管、截尾和中断标记。

<!-- exercise:13.3 -->
```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const api = await import(pathToFileURL(resolve("dist/sessions/save-session.js")));
const { readSession } = await import(pathToFileURL(resolve("dist/sessions/read-session.js")));
const { runSinglePrompt } = await import(pathToFileURL(resolve("dist/ui/terminal.js")));
const temp = await mkdtemp(join(tmpdir(), "hello-agent-exercise-resume-"));
const workspace = join(temp, "project"), directory = join(temp, "sessions");
const missing = async path => { try { await access(path); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; } };
const result = (text, toolCalls = []) => ({ text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", inputTokens: 1, outputTokens: 1, truncated: false });
let held;
try {
  await mkdir(workspace);
  await writeFile(join(workspace, "package.json"), '{"private":true}');
  await mkdir(join(workspace, ".git"));
  await writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");
  process.chdir(workspace);
  const original = {
    messages: [
      { role: "user", content: "请检查负数相加；我在旧进程中批准过读取 .git。" },
      { role: "assistant", content: "", toolCalls: [{ id: "old-command", name: "run_command", arguments: JSON.stringify({ command: 'node -e "require(\'node:fs\').writeFileSync(\'old-command-ran\',\'yes\')"', cwd: "." }) }] },
      { role: "tool", toolCallId: "old-command", content: "上次命令已经返回。", isError: false },
      { role: "assistant", content: "上次检查已经收尾。" },
    ],
    mode: "execute", tasks: [], pendingInputs: [{ id: 18, text: "旧队列：顺便说明零相加", run: 6 }], run: 6, nextInputId: 19,
  };
  held = await api.createSessionWriter(directory);
  const id = held.id, path = held.path, lockPath = join(directory, `${id}.lock`);
  assert.equal(await held.save(original, "run_end"), 1);
  await held.close(); held = undefined;
  const complete = await readFile(path);
  held = await api.resumeSessionWriter(id, directory);
  assert.deepEqual(held.restored.state, original);
  assert.equal(await missing(join(workspace, "old-command-ran")), true);
  await assert.rejects(api.resumeSessionWriter(id, directory, true), /活进程/);
  await held.close(); held = undefined;

  await appendFile(path, '{"version":1');
  const withTail = await readFile(path);
  await assert.rejects(api.resumeSessionWriter(id, directory), /--recover/);
  assert.deepEqual(await readFile(path), withTail);
  held = await api.resumeSessionWriter(id, directory, true);
  assert.deepEqual(await readFile(path), complete);
  assert.equal(held.restored.hasTrailingFragment, true);

  let requests = 0;
  const model = { async generate(messages, signal) {
    signal.throwIfAborted(); requests++;
    const started = await readSession(id, directory);
    assert.equal(started.interrupted, true, "新模型调用前 run_start 已保存");
    assert.equal(started.state.run, 7);
    assert.deepEqual(started.state.pendingInputs, original.pendingInputs);
    assert.equal(started.state.messages.some(message => message.content === "继续检查零相加"), false, "开始检查点尚不含本轮 prompt");
    assert.ok(messages.some(message => message.role === "tool" && message.toolCallId === "old-command"));
    assert.equal(messages.filter(message => message.content === "继续检查零相加").length, 1);
    assert.equal(messages.some(message => message.content === original.pendingInputs[0].text), false);
    return result("我会根据已保存的历史继续讨论。");
  } };
  assert.equal(requests, 0, "恢复没有请求模型");
  await runSinglePrompt(model, "继续检查零相加", {}, held, held.restored.state);
  assert.equal(requests, 1);
  await held.close(); held = undefined;
  const after = await readSession(id, directory);
  assert.equal(after.seq, 3);
  assert.equal(after.interrupted, false);
  assert.equal(after.state.run, 7);
  assert.deepEqual(after.state.pendingInputs, original.pendingInputs);
  assert.equal(await missing(join(workspace, "old-command-ran")), true);

  // 新请求仍需本进程批准；历史里“批准过”的文字没有授权效果。
  held = await api.resumeSessionWriter(id, directory);
  let approvalRequests = 0;
  const approvalModel = { async generate(messages) {
    if (++approvalRequests === 1) return result("", [{ id: "new-read", name: "read_file", arguments: '{"path":".git/HEAD"}' }]);
    const tool = messages.findLast(message => message.role === "tool" && message.toolCallId === "new-read");
    assert.equal(tool.isError, true, "没有交互审批的读取请求应被拒绝");
    assert.match(tool.content, /拒绝|审批|非交互/);
    return result("本次没有取得新的读取批准。");
  } };
  await runSinglePrompt(approvalModel, "现在读取 .git/HEAD", {}, held, held.restored.state);
  await held.close(); held = undefined;

  held = await api.resumeSessionWriter(id, directory);
  const unfinished = { ...held.restored.state, run: 9 };
  await held.save(unfinished, "run_start");
  await held.save(unfinished, "queue_change");
  await held.close(); held = undefined;
  assert.equal((await readSession(id, directory)).interrupted, true);
  await assert.rejects(api.resumeSessionWriter(id, directory), /--recover/);
  held = await api.resumeSessionWriter(id, directory, true);
  assert.equal(held.restored.interrupted, true);
  await held.save(held.restored.state, "exit");
  await held.close(); held = undefined;

  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH");
  await writeFile(lockPath, JSON.stringify({ pid: child.pid, token: randomUUID() }) + "\n");
  await assert.rejects(api.resumeSessionWriter(id, directory), /旧锁|--recover/);
  held = await api.resumeSessionWriter(id, directory, true);
  await held.close(); held = undefined;
  assert.equal(await missing(lockPath), true);
  console.log("通过：锁、截尾、续号、恢复等待、旧工具不重放、权限重置与中断检查。");
} finally {
  await held?.close();
  process.chdir(root);
  await rm(temp, { recursive: true, force: true });
}
```

使用管道关闭交互输入，使审批测试确定地走“无交互审批”分支：

```bash
printf '' | node docs/.work/verify-ch13-resume.mjs
```

恢复只装入白名单数据；直到调用新任务入口，内存模型的请求数都为 0。新请求能看见旧调用与结果，但不会重新执行它们；旧队列保留任务 6 的归属，不会混入任务 7。`run_start` 的同步先于新模型请求，快照尚不含本轮 prompt；它之后的 `queue_change` 也不能充当结束记录。

活 PID 的锁始终拒绝第二个 writer。死 PID、未换行尾片和未收尾任务需要显式 `--recover`；它允许接管和修剪尾片，不能证明工作区副作用完成。这份脚本不制造真实崩溃，不用强制结束自己的模型任务验证。

</details>

## 练习四：验证管理不改历史也不启动模型

给一份正常关闭的会话命名，预测 `seq`、消息和源文件字节怎样变化。再预测列表、搜索与导出会不会修改源文件，目标文件已经存在时会发生什么。最后尝试从另一个工作区恢复，判断程序应停在哪里。

构建 13.4：

```bash
npm run lesson:13.4
```

<details>
<summary>完整验证脚本与答案</summary>

将下面完整内容保存为 `docs/.work/verify-ch13-manage.mjs`。脚本在没有 `.env` 的临时项目中运行真实 CLI，子进程环境不提供模型密钥；列表、命名和导出仍应成功。恢复工作区检查单独传入虚构配置，只为越过配置校验，不发送模型请求。

<!-- exercise:13.4 -->
```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd(), cli = resolve("dist/cli.js");
const { createSessionWriter } = await import(pathToFileURL(resolve("dist/sessions/save-session.js")));
const { readSession } = await import(pathToFileURL(resolve("dist/sessions/read-session.js")));
const temp = await mkdtemp(join(tmpdir(), "hello-agent-exercise-manage-"));
const workspace = join(temp, "original"), other = join(temp, "other"), directory = join(temp, "sessions");
const environment = { PATH: process.env.PATH, LANG: "en_US.UTF-8", NO_COLOR: "1" };
function command(args, cwd = workspace, env = environment) {
  const child = spawnSync(process.execPath, [cli, "--session-dir", directory, ...args], { cwd, env, input: "/exit\n", encoding: "utf8", timeout: 10_000 });
  if (child.error) throw child.error;
  return child;
}
let writer;
try {
  for (const path of [workspace, other]) {
    await mkdir(path);
    await writeFile(join(path, "package.json"), '{"private":true}');
  }
  process.chdir(workspace);
  writer = await createSessionWriter(directory);
  const id = writer.id, path = writer.path;
  const state = {
    messages: [
      { role: "user", content: "检查 src/add.ts 的负数相加" },
      { role: "assistant", content: "", toolCalls: [{ id: "test-1", name: "run_command", arguments: '{"command":"npm test","cwd":"."}' }] },
      { role: "tool", toolCallId: "test-1", content: "两个负数相加：通过\n```\n工具原文包含反引号。", isError: false },
      { role: "assistant", content: "依据 test-1 的返回说明检查结果。" },
    ],
    mode: "execute", tasks: [{ id: "check", text: "检查负数", status: "completed" }], pendingInputs: [{ id: 18, text: "顺便说明零相加", run: 1 }], run: 1, nextInputId: 19,
  };
  await writer.save(state, "run_end");
  await writer.close(); writer = undefined;
  const before = await readFile(path, "utf8");
  const named = command(["--rename", id, "--name", "add.ts 负数与零相加"]);
  assert.equal(named.status, 0, named.stderr);
  const afterName = await readFile(path, "utf8");
  assert.ok(afterName.startsWith(before), "命名只能追加");
  const namedRecord = await readSession(id, directory);
  assert.equal(namedRecord.seq, 2);
  assert.equal(namedRecord.name, "add.ts 负数与零相加");
  assert.deepEqual(namedRecord.state, state);

  const brokenId = randomUUID();
  await writeFile(join(directory, `${brokenId}.jsonl`), "坏 JSON\n");
  const listed = command(["--sessions"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(id));
  assert.match(listed.stdout, /负数与零相加/);
  assert.match(listed.stderr, new RegExp(brokenId), "损坏会话单独警告");
  const found = command(["--sessions", "--search", "ADD.TS"]);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, new RegExp(id));
  const notFound = command(["--sessions", "--search", "不存在的关键词"]);
  assert.equal(notFound.status, 0, notFound.stderr);
  assert.ok(!notFound.stdout.includes(id));

  const exported = command(["--export", id]);
  assert.equal(exported.status, 0, exported.stderr);
  for (const value of [id, "test-1", "两个负数相加：通过", "#18 → 任务 1", "尚未交付"]) assert.ok(exported.stdout.includes(value));
  assert.ok(exported.stdout.includes("````text"), "工具原文的三个反引号不会关掉导出围栏");
  const destination = join(temp, "session.md");
  const saved = command(["--export", id, "--export-to", destination]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(await readFile(destination, "utf8"), exported.stdout);
  const overwrite = command(["--export", id, "--export-to", destination]);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /不会覆盖|无法导出/);
  assert.equal(await readFile(destination, "utf8"), exported.stdout);
  assert.equal(await readFile(path, "utf8"), afterName, "列表、搜索和导出不改源会话");

  const wrongWorkspace = command(["--resume", id, "--output", "text"], other,
    { ...environment, OPENAI_API_KEY: "offline-example", OPENAI_MODEL: "offline-example" });
  assert.notEqual(wrongWorkspace.status, 0);
  assert.match(wrongWorkspace.stderr, /工作区不同/);
  assert.equal(await readFile(path, "utf8"), afterName);
  console.log("通过：无模型配置管理、名称追加、搜索、损坏提示、只读导出与工作区核对。");
} finally {
  await writer?.close();
  process.chdir(root);
  await rm(temp, { recursive: true, force: true });
}
```

在仓库根目录运行：

```bash
node docs/.work/verify-ch13-manage.mjs
```

命名追加一条元数据，因此 `seq` 从 1 变成 2，消息、清单、队列不变。列表、搜索和导出只有读取；导出默认向标准输出写 Markdown，`--export-to` 只创建新文件。损坏记录警告并跳过，正常会话仍可找到。管理在模型配置之前返回；恢复在工作区不同处停止，还未进入用户输入或模型执行。

</details>

## 练习五：保存成功与任务完成分别依据什么

| 变化 | 需要判断的问题 |
| --- | --- |
| 保存 A 只记状态引用，等轮到写文件才复制；等待期间清单从 `in_progress` 变成 `completed` | A 能否证明发起保存时的状态 |
| 保留串行追加，却把 `sync()` 移到保存 Promise 之外 | `await save()` 返回后能确认哪一步 |
| 运行中 Enter 入队后，尚未到保存点就强制结束进程 | “入队成功”能否推出文字已在文件里 |
| 任务工具执行成功，但收尾检查点追加失败 | 是否应该自动重做工具 |

<details>
<summary>参考答案</summary>

A 不能证明调用时状态。同步复制负责固定内容，串行追加负责固定文件顺序，两者解决不同问题。若保存 Promise 不包含 `sync()`，它的成功也不能确认同步请求已经完成。

Enter 入队只保证文字进入当前进程的队列，还要等实际保存点才可能落盘；恢复不能补回从未保存的数据。

任务结果与会话保存结果分别报告。追加失败不改变已经执行的工具及其返回，也不自动触发重试；保存失败本身没有提供重做副作用的依据。`run_start` 无收尾能帮助发现不确定状态，不能把不确定性改成“已执行”或“未执行”。

</details>
