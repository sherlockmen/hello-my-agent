# 18.1 显式保存项目记忆

[第 18 章首页](../README.md) · [上一节：17.3 检查实际加载了哪些规则](../../chapter-17-project-instructions/03-inspect-loading/README.md) · [下一节：18.2 让模型提出记忆候选](../02-propose-memory/README.md) · [练习与答案](../EXERCISES.md)

## 问题：有用的项目事实不一定属于某一段旧对话

我们告诉 Agent：“本项目测试命令是 `npm run test:unit`。”这个事实可能服务于下周的另一个任务。只把它留在聊天里，新会话读不到；每次恢复完整旧会话，又会带入大量已经结束的修复过程。若把所有聊天都自动摘抄进一个文件，还容易把模型猜测、一次性的决定与过期信息混在一起。

这一节先做最明确的一步：由用户决定保存哪一句话，并能在不请求模型的情况下检查它。适合保存的是短小、可核对、跨任务仍有价值的项目事实；一次运行的完整日志和工具输出继续留在会话里。

## 解决方案：给少量事实独立的文件与身份

本地命令 `--memory 'add <正文>'`，以及文本/TUI 中的 `/memory add <正文>`，把用户明确给出的文字保存到项目根的 `.hello-my-agent/memory.json`。`list` 列出条目，`show <id>` 查看一条的详细来源。命令本身不成为发给模型的聊天消息。

每项用户任务开始时，程序重新读取有效记忆，固定为本任务使用的一份参考。之后模型读文件、申请运行测试等多轮请求，都使用这份固定内容。保存发生在任务中时，新内容从下一项用户任务开始使用。这是本教程实现的生命周期约定。

## 工作原理

### 保存的是可追溯条目，不是那句“我记住了”

原先只有输入框中的一句话；保存后多了一个带 ID 的条目：正文是测试命令，`source.kind` 为 `user`，来源说明标明用户通过本地命令保存，`status` 为 `active`，并记录创建和更新时间。外层文档还包含格式版本、真实项目根、修订号与操作记录。

ID 用来稳定地指向这一条事实。正文以后可以改，ID 不必跟着改；来源让读者区分用户明确输入与后面模型提出的候选。真实项目根把文件绑定到当前项目，不能把另一个项目复制来的 JSON 默默当成本项目记忆。`list` 和 `show` 都读取真实文件；它们比模型的一句“已经记住”更适合作为保存证据。

会话历史保存“当时发生了什么”，`AGENTS.md` 表达项目维护者写下的约定，记忆文件保存用户选择保留的短事实。三种材料在请求中有各自的参考块。记忆可能过时，不能覆盖用户当前要求，也不能授予执行权限。

### 先完整读懂旧文件，再提交新的完整文件

保存器不是直接向文件末尾追加一行。它先取得专用写入锁，在锁内重新读取并校验旧文档，加入条目和操作记录，修订号加一，再把完整 JSON 写到临时文件，最后用 `rename` 替换正式文件。

锁内重读可以避免两个 Agent 都基于旧版本写回、把对方新条目冲掉。临时文件完整写好再替换，可以避免正常失败把正式文件截断成半份 JSON。这里的提交点是替换完成：此前失败或取消保留旧文件；替换完成后，不能因为随后收到取消就声称没有保存。

命令行和空闲界面的本地写入会等待操作完成，本节没有提供其中途取消入口；后面模型发起的写入才使用任务取消信号。若出现“已保存，但临时文件或锁清理失败”，提交已经发生，应检查正式文件和锁；“未提交，清理失败”则保留旧文件，同时要求检查残留锁。成功与清理异常不能合并成一句“保存失败”。

文件不存在时才得到空库。JSON 损坏、项目根不符、链接、非法编码或超限都要报错，不能当作空库重建。写入锁冲突也会明确拒绝；若异常退出留下 `memory.lock`，先确认没有写入进程，再人工检查锁文件。程序不会猜测锁已无用而强行覆盖。

### 下一项任务先刷新，任务内估算和发送共用快照

假设任务 A 开始时只有“测试命令是 `npm run test:unit`”。任务 A 的第一次请求和后续工具回合都使用它。另一个进程后来改了磁盘，任务 A 不会在某一轮突然换依据。任务 B 开始时才重新读取并接纳新版本。

预算估算和真正发送都从同一份已固定的参考组装请求，不会一边按旧内容估算，一边重新读盘发送新内容。刷新失败则停止本次任务准备，向用户报告错误；不能悄悄沿用旧数据并声称已刷新。

这个设计没有让模型“永久理解”事实。程序只是每次在合适边界把文字交给它。是否采用该建议由模型决定；运行测试仍需要原来的工具调用、权限检查与进程结果。

<!-- generated:media:start -->
下面是机制示意，不是终端录屏。先看用户怎样把测试入口明确保存，再跟随下一项任务刷新、组装和发送。橙卡表示正在交接的输入、文件或请求；接收方在卡片抵达后才更新。保存动作不请求模型，最后的回答也没有运行测试。

![用户本地保存测试入口，原子提交后收到条目回执，新任务刷新固定记忆并随请求交给模型](assets/memory-explicit-save-59b436dd6b.gif)

[静态流程图](assets/memory-explicit-save-flow-a4f2a403f1.png) · [静态封面](assets/memory-explicit-save-cover-0dc9ef1ad6.png) · [查看完整静态分镜](assets/memory-explicit-save-storyboard-1a0e667185.jpg)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/memory/store.ts](src/memory/store.ts) | 校验项目记忆并在锁内提交完整文件 |
| NEW | [src/memory/commands.ts](src/memory/commands.ts) | 把明确的本地命令接到项目记忆操作 |
| CHANGED | [src/permissions/policy.ts](src/permissions/policy.ts) | 在本地策略中保留模式与专用入口边界 |
| CHANGED | [src/tools/workspace.ts](src/tools/workspace.ts) | 让工具和项目元数据共用可信项目根规则 |
| CHANGED | [src/models/client.ts](src/models/client.ts) | 让参考块共用同一预算估算与请求组装路径 |
| CHANGED | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 让任务快照、审批工具和真实结果接回决策循环 |
| CHANGED | [src/ui/terminal.ts](src/ui/terminal.ts) | 在文本入口串行处理本地命令并显示回执 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 在TUI管理本地异步槽、草稿和真实结果 |
| CHANGED | [src/cli.ts](src/cli.ts) | 在入口装配本节能力与本地命令 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 17.3 的完整 `src/` 继续，目标目录为 `chapter-18-long-term-memory/01-save-memory/`。先实现独立存储与本地命令，再将任务开始时固定的记忆参考接到请求组装。未列文件继续保留；不要用后续小节的快照代替这一步。

<!-- generated:build:start -->
### 1. 校验项目记忆并在锁内提交完整文件

新建 `src/memory/store.ts`，完整内容如下。

<details>
<summary>完整文件：src/memory/store.ts（NEW）</summary>

<!-- source: src/memory/store.ts -->
```ts
/**
 * 18.1 显式保存项目记忆 | [NEW] memory/store.ts
 * 输入：真实项目根、用户明确提供的正文；输出：经过校验的记忆文档和可追溯的保存结果。
 * 状态：文件锁内重读，临时文件完整写入后原子替换；失败保留旧文件，取消不提交候选。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：校验路径 -> 有界读取 -> 校验JSON -> 独占锁 -> 重读 -> 修改 -> rename。
 * 观察：新进程读到同一项目的有效记忆，损坏或跨项目JSON不能被默默当作空库覆盖。
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";

// [NEW 18.1] 本文件以下实现均为本节新增。
export const MEMORY_LIMITS = { entries: 64, content: 1000, source: 300, audit: 500, fileBytes: 524_288 } as const;
export type MemorySource = { kind: "user" | "model"; detail: string };
export type MemoryEntry = { id: string; content: string; source: MemorySource; status: "active" | "invalid"; createdAt: string; updatedAt: string };
export type MemoryAudit = { id: string; action: "add" | "edit" | "invalidate" | "delete"; at: string; source: MemorySource };
export type MemoryDocument = { version: 1; projectRoot: string; revision: number; entries: MemoryEntry[]; audit: MemoryAudit[] };
export type MemoryChange = { action: "add"; content: string; source: MemorySource };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 识别系统调用的错误码；不把其他读取失败当作文件不存在。
 */
function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/**
 * 检查一层对象的字段集合；磁盘JSON和模型参数都不能靠TypeScript保证形状。
 */
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => key in value));
}

/**
 * 校验可保存的短文字；拒绝空白、NUL和会改变终端显示的控制字符。
 */
export function memoryText(value: unknown, maximum: number = MEMORY_LIMITS.content): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) {
    throw new UserFacingError(`记忆文字必须为 1—${maximum} 字符，不能含终端控制字符。`);
  }
  return value.trim();
}

/**
 * 校验来源；来源说明用于追溯，不能产生工具授权。
 */
function validSource(value: unknown): value is MemorySource {
  if (!object(value, ["kind", "detail"]) || !["user", "model"].includes(String(value.kind))) return false;
  try { return memoryText(value.detail, MEMORY_LIMITS.source) === value.detail; } catch { return false; }
}

/**
 * 只接受标准ISO时间，避免把任意字符串当作有效的创建或修改时间。
 */
function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/**
 * 完整校验磁盘文档后才返回；项目绑定、版本、条目、来源与审计任一损坏都拒绝覆盖。
 */
function parseDocument(raw: string, root: string): MemoryDocument {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new UserFacingError("记忆文件不是有效JSON；请先检查文件，旧内容未覆盖。"); }
  if (!object(value, ["version", "projectRoot", "revision", "entries", "audit"]) || value.version !== 1 || value.projectRoot !== root
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.entries)
    || value.entries.length > MEMORY_LIMITS.entries || !Array.isArray(value.audit) || value.audit.length > MEMORY_LIMITS.audit) {
    throw new UserFacingError("记忆文件版本、项目范围或结构无效；旧内容未覆盖。");
  }
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!object(entry, ["id", "content", "source", "status", "createdAt", "updatedAt"]) || typeof entry.id !== "string" || !UUID.test(entry.id)
      || ids.has(entry.id) || !["active", "invalid"].includes(String(entry.status)) || !validSource(entry.source)
      || !validTime(entry.createdAt) || !validTime(entry.updatedAt) || entry.createdAt > entry.updatedAt) throw new UserFacingError("记忆条目无效；旧内容未覆盖。");
    if (memoryText(entry.content) !== entry.content) throw new UserFacingError("记忆正文含多余首尾空白；旧内容未覆盖。");
    ids.add(entry.id);
  }
  for (const audit of value.audit) {
    if (!object(audit, ["id", "action", "at", "source"]) || typeof audit.id !== "string" || !UUID.test(audit.id)
      || !["add", "edit", "invalidate", "delete"].includes(String(audit.action)) || !validTime(audit.at) || !validSource(audit.source)) throw new UserFacingError("记忆来源记录无效；旧内容未覆盖。");
  }
  if (value.revision !== value.audit.length) throw new UserFacingError("记忆修订号与来源记录不一致；旧内容未覆盖。");
  return value as MemoryDocument;
}

/**
 * 将项目根转换为真实目录，固定专用文件名；既有存储目录不能是链接或其他文件。
 */
async function paths(projectRoot: string): Promise<{ root: string; directory: string; file: string }> {
  const root = await realpath(resolve(projectRoot));
  if (!(await lstat(root)).isDirectory()) throw new UserFacingError("记忆范围必须是项目目录。");
  const directory = join(root, ".hello-my-agent");
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new UserFacingError("记忆目录必须是项目内的真实目录，不能是符号链接。");
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  return { root, directory, file: join(directory, "memory.json") };
}

/**
 * 有界读取普通UTF-8文件并复查身份；不存在才返回空库，损坏、链接或读取失败均抛错。
 */
export async function readMemory(projectRoot: string, signal: AbortSignal = new AbortController().signal): Promise<MemoryDocument> {
  signal.throwIfAborted();
  const location = await paths(projectRoot);
  let before;
  try { before = await lstat(location.file); }
  catch (error) {
    if (hasCode(error, "ENOENT")) return { version: 1, projectRoot: location.root, revision: 0, entries: [], audit: [] };
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > MEMORY_LIMITS.fileBytes) throw new UserFacingError("记忆文件必须是有界普通文件，不能是链接或目录。");
  const file = await open(location.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || before.ino !== info.ino || before.dev !== info.dev) throw new UserFacingError("记忆文件在打开前发生变化，请重试。");
    const buffer = Buffer.alloc(MEMORY_LIMITS.fileBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      signal.throwIfAborted();
      const part = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!part.bytesRead) break;
      bytes += part.bytesRead;
    }
    signal.throwIfAborted();
    const after = await file.stat(), current = await lstat(location.file);
    if (bytes > MEMORY_LIMITS.fileBytes || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs
      || current.ino !== info.ino || current.dev !== info.dev || await realpath(location.directory) !== location.directory) throw new UserFacingError("记忆文件读取期间发生变化或超限，请重试。");
    let raw: string;
    try { raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)); }
    catch { throw new UserFacingError("记忆文件不是有效UTF-8。"); }
    return parseDocument(raw, location.root);
  } finally { await file.close(); }
}

/**
 * 在独占锁内重读并原子保存一次明确修改；锁冲突报错，不排队覆盖另一个进程的结果。
 * rename是提交点；它之前失败保留旧文件，之后即使收到取消也不能称为未保存。
 */
export async function changeMemory(projectRoot: string, change: MemoryChange, signal: AbortSignal = new AbortController().signal): Promise<MemoryEntry | undefined> {
  signal.throwIfAborted();
  const location = await paths(projectRoot);
  await mkdir(location.directory, { mode: 0o700, recursive: true });
  await paths(location.root);
  const lockPath = join(location.directory, "memory.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) { if (hasCode(error, "EEXIST")) throw new UserFacingError("记忆正在写入，或上次进程留下 memory.lock。请先确认没有写入进程，再检查锁文件；本次未覆盖。"); throw error; }
  const temporary = join(location.directory, `memory-${randomUUID()}.tmp`);
  let committed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    const data = await readMemory(location.root, signal);
    if (data.audit.length >= MEMORY_LIMITS.audit) throw new UserFacingError("记忆来源记录达到500条，本次未写入；请先人工归档整个记忆文件。");
    if (!validSource(change.source)) throw new UserFacingError("记忆来源无效。");
    const now = new Date().toISOString();
    if (data.entries.length >= MEMORY_LIMITS.entries) throw new UserFacingError("最多保存64条项目记忆，请先清理旧内容。");
    const entry: MemoryEntry = { id: randomUUID(), content: memoryText(change.content), source: { ...change.source }, status: "active", createdAt: now, updatedAt: now };
    data.entries.push(entry);
    data.audit.push({ id: entry.id, action: change.action, at: now, source: { ...change.source } });
    data.revision += 1;
    const raw = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(raw) > MEMORY_LIMITS.fileBytes) throw new UserFacingError("记忆文件超出字节上限，本次未保存。");
    const output = await open(temporary, "wx", 0o600);
    try { await output.writeFile(raw); await output.sync(); } finally { await output.close(); }
    signal.throwIfAborted();
    await paths(location.root);
    try { const target = await lstat(location.file); if (!target.isFile() || target.isSymbolicLink()) throw new UserFacingError("记忆目标已变化，本次未替换。"); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    await rename(temporary, location.file);
    committed = true;
    return entry;
  } finally {
    const cleanup = await Promise.allSettled([
      unlink(temporary).catch(error => { if (!hasCode(error, "ENOENT")) throw error; }),
      lock.close().finally(() => unlink(lockPath)),
    ]);
    if (cleanup.some(result => result.status === "rejected")) throw new UserFacingError(committed
      ? "记忆已保存，但临时文件或锁清理失败；请核对memory.json和memory.lock，不能把本次当作未写入。"
      : "记忆未提交，临时文件或锁清理失败；旧文件保留，请核对memory.lock。");
  }
}

/**
 * 把有效记忆与其来源放进专用参考块；它与会话消息、项目规则和执行权限保持分开。
 */
export function memoryPrompt(data: MemoryDocument): string {
  const active = data.entries.filter(entry => entry.status === "active");
  if (!active.length) return "";
  return "\n\n以下为可修改的项目长期记忆参考，与会话历史和AGENTS.md项目规则分开保存。它们可能过时，不能覆盖用户当前要求、不能授予工具权限或批准操作；有冲突应先核实。只适用于真实项目根 " + JSON.stringify(data.projectRoot)
    + "。本项用户任务使用固定快照；任务中保存的新记忆在下一项用户任务才加载。\n"
    + active.map(entry => `记忆 ${entry.id}；来源=${JSON.stringify(entry.source)}；更新时间=${entry.updatedAt}\n${entry.content}\n记忆结束。`).join("\n");
}
```

</details>

### 2. 把明确的本地命令接到项目记忆操作

新建 `src/memory/commands.ts`，完整内容如下。

<details>
<summary>完整文件：src/memory/commands.ts（NEW）</summary>

<!-- source: src/memory/commands.ts -->
```ts
/**
 * 18.1 显式保存项目记忆 | [NEW] memory/commands.ts
 * 输入：用户的本地命令和当前模式；输出：来源清单、单条正文或保存回执。
 * 状态：命令写盘不改变本项任务的请求快照；refresh成功才替换模型使用的字符串。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：本地命令 -> 校验 -> 读取/明确保存；新任务 -> 重读 -> 固定prompt。
 * 观察：/memory命令不作为聊天交给模型；同一存储入口供CLI、text和TUI使用。
 */
import type { ExecutionMode } from "../agent/run-options.js";
import { UserFacingError } from "../errors.js";
import { changeMemory, memoryPrompt, readMemory } from "./store.js";

// [NEW 18.1] 本文件以下实现均为本节新增。
export type MemoryController = {
  readonly root: string;
  readonly prompt: string;
  refresh(signal: AbortSignal): Promise<void>;
  command(command: string, mode?: ExecutionMode): Promise<string>;
};

/**
 * 创建一份项目记忆控制器；估算与发送只读prompt，重读只能发生在明确任务边界。
 */
export async function createMemoryController(projectRoot: string): Promise<MemoryController> {
  const initial = await readMemory(projectRoot);
  let prompt = memoryPrompt(initial);
  return {
    root: initial.projectRoot,
    get prompt() { return prompt; },
    async refresh(signal) {
      const next = await readMemory(initial.projectRoot, signal);
      signal.throwIfAborted();
      prompt = memoryPrompt(next);
    },
    async command(command, mode = "execute") {
      try { return await memoryCommand(initial.projectRoot, command, mode); }
      catch (error) { return `记忆操作失败：${error instanceof Error ? error.message : "未知错误"}`; }
    },
  };
}

/**
 * 执行用户显式发起的记忆命令；查询不写入，Plan下拒绝所有记忆变更。
 */
export async function memoryCommand(projectRoot: string, command: string, mode: ExecutionMode = "execute"): Promise<string> {
  const text = command.trim().replace(/^\/memory(?:\s|$)/, "").trim();
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text || "list")!;
  const action = match[1], argument = match[2] ?? "";
  if (action === "list" && !argument) {
    const data = await readMemory(projectRoot);
    return `项目记忆：${JSON.stringify(data.projectRoot)}\n存储：.hello-my-agent/memory.json · 修订 ${data.revision}；每项新任务开始时加载有效条目。\n`
      + (data.entries.map(entry => `${entry.id} · ${entry.status} · ${entry.content}\n来源：${entry.source.kind} · ${entry.source.detail} · 更新 ${entry.updatedAt}`).join("\n") || "没有项目记忆。");
  }
  if (action === "show" && argument) {
    const data = await readMemory(projectRoot), entry = data.entries.find(item => item.id === argument);
    const audit = data.audit.filter(item => item.id === argument);
    if (!entry && !audit.length) throw new UserFacingError("找不到该记忆ID。");
    return JSON.stringify({ projectRoot: data.projectRoot, entry: entry ?? null, audit }, null, 2);
  }
  if (action === "add" && argument) {
    if (mode === "plan") throw new UserFacingError("Plan模式不能保存记忆；请先切换execute。");
    const entry = await changeMemory(projectRoot, { action: "add", content: argument, source: { kind: "user", detail: "用户通过本地记忆命令明确保存" } });
    return `记忆已保存：${entry!.id}。下一项用户任务加载；当前任务的模型请求快照未改变。`;
  }
  throw new UserFacingError("用法：/memory list | show <id> | add <正文>");
}
```

</details>

### 3. 在本地策略中保留模式与专用入口边界

在上一节的 `src/permissions/policy.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/permissions/policy.ts（CHANGED）</summary>

<!-- source: src/permissions/policy.ts -->
```diff
--- a/src/permissions/policy.ts
+++ b/src/permissions/policy.ts
@@ -1,7 +1,7 @@
 /**
- * 15.2 限制大工具结果 | [CHANGED] permissions/policy.ts
- *
- * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责在每个工具执行前判断模式、路径和本次批准。
+ * 18.1 显式保存项目记忆 | [CHANGED] permissions/policy.ts
+ *
+ * 学习目标：专用记忆与通用文件权限分别处理；通用工具不能改写专用元数据，读取仍需审批。
  * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
  * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
  * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
@@ -53,7 +53,8 @@
   signal: AbortSignal,
 ) => Promise<ApprovalResponse>;
 
-const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex"]);
+// [CHANGED 18.1] 专用元数据目录不能从通用写入入口绕过记忆控制器。
+const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex", ".hello-my-agent"]);
 
 /**
  * 把未经信任的工具参数解析成顶层对象。
@@ -178,7 +179,7 @@
     return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
   }
   // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
-  // [NEW 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
+  // [KEEP 来自 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
   if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
   if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
   // [KEEP 来自 12.3] 放行澄清等待；答案不产生文件或命令批准。
```

</details>

### 4. 让工具和项目元数据共用可信项目根规则

在上一节的 `src/tools/workspace.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/workspace.ts（CHANGED）</summary>

<!-- source: src/tools/workspace.ts -->
```diff
--- a/src/tools/workspace.ts
+++ b/src/tools/workspace.ts
@@ -1,8 +1,7 @@
 /**
- * 17.1 从子目录找到项目根并加载说明 | [CHANGED] tools/workspace.ts
+ * 18.1 显式保存项目记忆 | [CHANGED] tools/workspace.ts
  *
- * 学习目标：让说明扫描和工具共用项目根算法；找到根不等于获得某个文件或命令的权限。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 学习目标：继续复用项目根；搜索跳过专用元数据，不能靠项目忽略规则重新包含。
  * 输入：启动目录，以及项目根目录中的 .gitignore。
  * 输出：项目根目录和一个可以判断相对路径是否应被忽略的匹配器。
  * 状态：找不到项目标记时使用真实启动目录；忽略文件读取失败抛出 ToolError，不修改项目文件。
@@ -25,7 +24,7 @@
 import { existsSync } from "node:fs";
 import { readFile } from "node:fs/promises";
 import { join } from "node:path";
-// [CHANGED 17.1] 工具边界与说明扫描共用同一项目根算法，项目正文不能改它。
+// [KEEP 来自 17.1] 工具边界与说明扫描共用同一项目根算法，项目正文不能改它。
 import { findProjectRoot } from "../project/instructions.js";
 export { findProjectRoot };
 import ignore, { type Ignore } from "ignore";
@@ -35,6 +34,8 @@
   ".git/",
   ".agents/",
   ".codex/",
+  // [CHANGED 18.1] 专用记忆不能经通用搜索暴露，也不能被项目否定规则重新包含。
+  ".hello-my-agent/",
   "node_modules/",
   "dist/",
   ".env",
```

</details>

### 5. 让参考块共用同一预算估算与请求组装路径

在上一节的 `src/models/client.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/models/client.ts（CHANGED）</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,7 +1,7 @@
 /**
- * 17.1 从子目录找到项目根并加载说明 | [CHANGED] models/client.ts
- *
- * 学习目标：让项目参考同时进入请求估算与实际发送；摘要仍使用独立提示，完整响应才交回核心。
+ * 18.1 显式保存项目记忆 | [CHANGED] models/client.ts
+ *
+ * 学习目标：把任务固定记忆同时用于估算与发送；摘要请求仍独立，不混入记忆。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
  * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
  * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
@@ -31,8 +31,10 @@
  * 运行观察：一批调用中只要有一份参数损坏，整批都不会进入权限与执行阶段。
  */
 
+// [CHANGED 18.1] 记忆快照由明确任务边界刷新，估算和发送读取同一字符串。
+import type { MemoryController } from "../memory/commands.js";
 import OpenAI from "openai";
-// [NEW 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
+// [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
 import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
 import Anthropic from "@anthropic-ai/sdk";
 import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
@@ -66,7 +68,9 @@
  * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
  */
 export interface Model {
-  // [NEW 17.1] 来源是本地启动信息，不是模型接收确认。
+  // [CHANGED 18.1] 本地管理入口不属于会话消息或模型授权。
+  readonly memory?: MemoryController;
+  // [KEEP 来自 17.1] 来源是本地启动信息，不是模型接收确认。
   readonly projectInfo?: readonly string[];
   // [KEEP 来自 16.2] 摘要使用独立、无工具的请求，先估算其输入，返回完整结果才考虑采用。
   inspectSummary?(source: string): ContextBudget;
@@ -91,8 +95,8 @@
  * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
  */
 // [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
-export function createModel(config: Config, project?: ProjectInstructions): Model {
-  // [NEW 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
+export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController): Model {
+  // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
   const projectPrompt = project ? projectInstructionPrompt(project) : "";
   const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
   const options = {
@@ -108,6 +112,8 @@
   // [KEEP 来自 16.2] 专用摘要不继承执行工具；输出预留也计入摘要自己的本地预算。
   const summaryLimits = { ...limits, outputReserve: Math.min(limits.outputReserve, 2048) };
   return {
+    // [CHANGED 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
+    memory,
     projectInfo,
     inspectSummary(source) {
       return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits);
@@ -126,19 +132,19 @@
       }
     },
     inspectContext(messages, mode = "execute") {
-      const { prompt, definitions } = requestParts(mode, projectPrompt);
+      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? ""));
       return estimateContext(messages, prompt, definitions, limits);
     },
     estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
     async generate(messages, signal, onText, options = {}) {
     // [KEEP 来自 15.3] 直接调用模型适配器也执行相同门槛，避免绕过 Agent Loop 发出超本地预算的请求。
     signal.throwIfAborted();
-    const { prompt, definitions } = requestParts(options.mode ?? "execute", projectPrompt);
+    const { prompt, definitions } = requestParts(options.mode ?? "execute", projectPrompt + (memory?.prompt ?? ""));
     const budget = estimateContext(messages, prompt, definitions, limits);
     if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
     const deadline = AbortSignal.timeout(60_000);
     try {
-      return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText, options.mode ?? "execute", limits, projectPrompt);
+      return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText, options.mode ?? "execute", limits, projectPrompt + (memory?.prompt ?? ""));
     } catch (error) {
       signal.throwIfAborted();
       if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
```

</details>

### 6. 让任务快照、审批工具和真实结果接回决策循环

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,7 @@
 /**
- * 16.3 自动压缩后继续任务 | [CHANGED] agent/agent-loop.ts
+ * 18.1 显式保存项目记忆 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：预算不足时有界生成摘要，确认完整请求适配后继续，失败保留原记录。
+ * 学习目标：在新任务首次估算前刷新并固定记忆；后续工具回合仍共用同一份参考。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -11,6 +11,7 @@
  *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
  *                                                         +-- 有效 -> 配置、模型、消费者
  *   [KEEP 来自 13.3] text / TUI -> 新建 ID 或锁定、校验并恢复指定会话；jsonl 仍只输出事件
+ *   [CHANGED 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
  *   [KEEP 来自 13.4] --sessions / --search / --rename / --export -> 本地管理记录，不请求模型
  *   [KEEP 来自 14.1] --fork ID -> 复制可信状态到新 ID；保留来源记录，不继承旧轮占用或授权
  *   [KEEP 来自 14.3] 空闲 /changes、/restore ID -> 查看差异或按当前内容核验后恢复；不执行旧工具
@@ -27,13 +28,14 @@
  *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
  *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
  *                                                                   +-- 否 -> 建立本轮消息
+ *   [CHANGED 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
  *   [KEEP 来自 12.1] 固定本轮模式 -> A
  *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
  *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
  *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
  *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
  *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
- *      [CHANGED 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
+ *      [KEEP 来自 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
  *           -> 候选仍超限 / 失败 / 取消？-- 是 -> X（原视图与完整记录保留）
  *                                       +-- 否 -> 提交摘要游标，再请求模型
  *                                                      +-- 是 -> 请求模型
@@ -148,12 +150,14 @@
   let truncated = false;
   let toolSequence = 0;
   let pendingToolResults = 0;
-  // [NEW 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
+  // [KEEP 来自 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
   let compactionAttempts = 0;
 
   // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
   let executingCallId: string | undefined;
   try {
+    // [CHANGED 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
+    await model.memory?.refresh(signal);
     for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
       // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
       signal.throwIfAborted();
@@ -169,7 +173,7 @@
       let messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
       let budget = model.inspectContext?.(messages, mode);
       if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
-      // [NEW 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
+      // [KEEP 来自 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
       if (budget && !budget.withinBudget) {
         const candidate = { ...context };
         try {
```

</details>

### 7. 在文本入口串行处理本地命令并显示回执

在上一节的 `src/ui/terminal.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/terminal.ts（CHANGED）</summary>

<!-- source: src/ui/terminal.ts -->
```diff
--- a/src/ui/terminal.ts
+++ b/src/ui/terminal.ts
@@ -1,7 +1,7 @@
 /**
- * 16.1 区分完整记录与请求视图 | [CHANGED] ui/terminal.ts
- *
- * 学习目标：分别显示请求前的本地预算、响应后的服务用量和会话保存结果，不把估算当成实际计费。
+ * 18.1 显式保存项目记忆 | [CHANGED] ui/terminal.ts
+ *
+ * 学习目标：把记忆命令留在本地串行完成；保存回执与模型回答、会话保存结果分别显示。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
  * 输出：stdout 显示模型正文；stderr 显示过程、审批、输入提示、本地状态与用量。
  * 状态：文本消费者沿用 09.3 的输出位置；失败或取消等待清理，不撤销已经发生的工具操作。
@@ -14,6 +14,7 @@
  *                         -> [KEEP] 用量与截断提示写 stderr
  *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
  *                                                             +-- 否 -> deny
+ *   [CHANGED 18.1] /memory -> 等本地命令完成 -> 显示回执；不新增user消息
  *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
  *   [KEEP 来自 13.1] 本轮 finally / reset / 有效 mode -> 白名单检查点 -> 等保存 -> stderr 反馈
  *   [KEEP 来自 13.1] 连续会话退出 -> 最后检查点；CLI 随后关闭 writer
@@ -247,7 +248,7 @@
 export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
-  // [NEW 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
+  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
   const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
   let mode = options.mode ?? initial?.mode ?? "execute";
   // [KEEP 来自 12.2] 持续会话复用清单，下一轮与模式切换不重建。
@@ -313,6 +314,11 @@
       const text = value.trim();
       if (!text) continue;
       if (text === "/exit") break;
+      // [CHANGED 18.1] 空闲本地管理不进入历史，也不触发模型。
+      if (/^\/memory(?:\s|$)/.test(text)) {
+        console.error(model.memory ? await model.memory.command(text, mode) : "当前运行未连接项目记忆。");
+        continue;
+      }
       // [KEEP 来自 14.3] 只在任务循环外处理文件恢复，不会与工具并发。
       if (/^\/(changes|restore)(?:\s|$)/.test(text)) {
         const result = await fileCommand(text); console.error(result.message);
@@ -399,7 +405,7 @@
 export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 历史只成为新请求的上下文，旧工具不会从这里再次调度。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
-  // [NEW 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
+  // [KEEP 来自 16.1] 恢复数据与本地摘要容器共用，保存完整消息和游标。
   const context = structuredClone(initial?.context ?? options.context ?? emptyCompaction());
   const tasks = initial ? { items: structuredClone([...initial.tasks]) } : options.tasks ?? { items: [] };
   const mode = options.mode ?? initial?.mode ?? "execute";
```

</details>

### 8. 在TUI管理本地异步槽、草稿和真实结果

在上一节的 `src/ui/tui/app.tsx` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/app.tsx（CHANGED）</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,7 +1,7 @@
 /**
- * 17.1 从子目录找到项目根并加载说明 | [CHANGED] ui/tui/app.tsx
+ * 18.1 显式保存项目记忆 | [CHANGED] ui/tui/app.tsx
  *
- * 学习目标：把本次加载来源放进可浏览的本地历史；输入、审批、预算与保存状态仍由原工作区管理。
+ * 学习目标：本地记忆管理占用独立异步槽，完成前锁住任务提交，避免请求与磁盘操作交错。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
  * 输出：草稿、历史、模式、本地预算、服务商用量、保存状态和审批面板。
  * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
@@ -11,6 +11,7 @@
  *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
  *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
  *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
+ *   [CHANGED 18.1] 空闲 /memory -> 本地命令槽 -> 等待结束 -> 历史显示回执；不发模型
  *   [KEEP 来自 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
  *   [KEEP 来自 12.4] 普通 Enter -> 忙碌？-- 是 -> 本地命令？-- 是 -> 保留草稿、提示等待
  *                                         +-- 否 -> 校验补充、加入当前轮队列、清草稿
@@ -180,7 +181,7 @@
   const [draft, setDraft] = useState(newDraft());
   // [KEEP 来自 13.3] 从模型消息重建阅读条目；不恢复旧流、审批等待或工具执行器。
   const [entries, setEntries] = useState<Entry[]>(() => [
-    // [NEW 17.1] 进入 TUI 后仍可在历史区查看本次实际加载来源。
+    // [KEEP 来自 17.1] 进入 TUI 后仍可在历史区查看本次实际加载来源。
     ...(model.projectInfo ? [{ id: "project-instructions", label: "本地" as const, text: screenText(model.projectInfo.join("\n")) }] : []),
     ...session.history.map((message, index): Entry => ({
       id: `restored-${index}`,
@@ -288,6 +289,17 @@
     setDraft(newDraft());
     // 本地命令只改本地会话；它们不作为 user 消息送给模型。
     if (prompt === "/exit") { quit(0); return; }
+    // [CHANGED 18.1] 异步记忆管理占用本地命令槽，结束前不启动模型任务。
+    if (/^\/memory(?:\s|$)/.test(prompt)) {
+      session.clearing = true; setNotice("正在处理项目记忆…");
+      session.done = (async () => {
+        try {
+          const result = model.memory ? await model.memory.command(prompt, session.mode) : "当前运行未连接项目记忆。";
+          if (!session.closing) append("本地", result);
+        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("记忆操作已结束；新任务开始时刷新有效记忆。"); }
+      })();
+      return;
+    }
     // [KEEP 来自 14.3] 立即占用，直到恢复和通知保存完成才开放下一任务。
     if (/^\/(changes|restore)(?:\s|$)/.test(prompt)) {
       session.clearing = true; setNotice("正在核对文件检查点…");
@@ -323,7 +335,7 @@
    * 识别必须在空闲时本地处理的命令。
    * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
    */
-  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|changes|restore)(?:\s|$)/.test(text);
+  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|changes|restore|memory)(?:\s|$)/.test(text);
   /**
    * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
    * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
```

</details>

### 9. 在入口装配本节能力与本地命令

在上一节的 `src/cli.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/cli.ts（CHANGED）</summary>

<!-- source: src/cli.ts -->
```diff
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,13 +1,14 @@
 #!/usr/bin/env node
 /**
- * 17.3 查看加载来源与预算 | [CHANGED] cli.ts
- *
- * 学习目标：在选择消费者前加载本次项目说明，再把固定快照交给模型；会话仍由原入口管理。
+ * 18.1 显式保存项目记忆 | [CHANGED] cli.ts
+ *
+ * 学习目标：在密钥与会话之前处理本地记忆命令；正常任务装配项目根绑定的记忆控制器。
  * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
  * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
  * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
  *
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
+ *   [CHANGED 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
  *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
  *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
  *                            +-- 是 -> 继续检查运行方式
@@ -34,6 +35,9 @@
  * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
  */
 
+// [CHANGED 18.1] 本地记忆动作在模型配置与会话创建前完成。
+import { createMemoryController, memoryCommand } from "./memory/commands.js";
+import { findProjectRoot } from "./project/instructions.js";
 import { dirname } from "node:path";
 // [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
 import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
@@ -74,7 +78,7 @@
 }
 // [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
 // [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
-type CliOptions = Options & { projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
+type CliOptions = Options & { memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
 const program = new Command();
 program
   // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
@@ -84,8 +88,10 @@
   .helpOption("-h, --help", "显示帮助")
   // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
   .option("--doctor", "显示当前运行环境")
-  // [NEW 17.3] 本地检查在读取模型配置和创建会话之前完成。
+  // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
   .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
+  // [CHANGED 18.1] 显式管理命令无需API Key。
+  .option("--memory <command>", "本地项目记忆：list、show <id>、add <正文>")
   // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
   .option("--model <id>", "本次使用的模型 ID")
   .option("--base-url <url>", "本次使用的接口基础地址")
@@ -114,7 +120,17 @@
   // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
   .action(async () => {
     const options = program.opts<CliOptions>();
-    // [NEW 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
+    // [CHANGED 18.1] 管理动作拒绝混用提问、会话和连接选项；Plan只可查询。
+    if (options.memory !== undefined) {
+      if (options.prompt !== undefined || options.projectInfo || options.doctor || options.model !== undefined || options.baseUrl !== undefined
+        || options.provider !== undefined || options.output !== "auto" || options.sessionDir !== undefined || options.resume !== undefined || options.recover
+        || options.fork !== undefined || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
+        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--memory请单独使用，可配合--mode plan查询。");
+      if (!["execute", "plan"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode只能是plan或execute。");
+      console.log(await memoryCommand(findProjectRoot(), options.memory, options.mode as ExecutionMode | undefined));
+      return;
+    }
+    // [KEEP 来自 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
     if (options.projectInfo) {
       if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
         || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
@@ -185,7 +201,9 @@
     // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
     const project = await loadProjectInstructions();
     const config = readConfig(options);
-    const model = createModel(config, project);
+    // [CHANGED 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
+    const memory = await createMemoryController(project.root);
+    const model = createModel(config, project, memory);
     for (const line of projectInstructionInfo(project)) console.error(line);
     // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
     if (options.output === "jsonl") {
```

</details>
<!-- generated:build:end -->

## 运行验证

先在仓库根目录编译并注册本节。

```bash
npm run lesson:18.1
```

创建一个独立演示项目。这里用 `package.json` 明确项目根，也提供一条可以真实执行的测试命令。

```bash
MEMORY_DEMO="$(mktemp -d)"
cd "$MEMORY_DEMO"
mkdir test
cat > package.json <<'JSON'
{"private":true,"scripts":{"test:unit":"node --test"}}
JSON
cat > test/sum.test.mjs <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
test('sum', () => assert.equal(1 + 2, 3));
JS
hello-my-agent --memory 'add 本项目测试命令是 npm run test:unit'
hello-my-agent --memory list
```

保存回执给出 ID；清单应显示相同正文、`active` 和 `user` 来源。复制真实 ID 执行 `hello-my-agent --memory 'show <id>'`，同时查看 `.hello-my-agent/memory.json`，核对条目、修订号与 `add` 操作。把示例中的 `<id>` 换成真实值。以上管理操作无需 API Key，不创建对话会话。

接着在已配置模型的终端里，从同一演示目录发起新任务。

```bash
hello-my-agent --prompt '本项目应该用哪条命令跑单元测试？先说明依据，不要执行。'
```

新进程读取同一个项目文件；若模型回答 `npm run test:unit`，再核对依据与来源。回答本身只能说明这次模型的表现。章末确定性实验还会直接比较两个控制器的参考，证明跨进程式重建和下一任务刷新，不依赖模型碰巧回答正确。

## 本节完成后的 Agent

Agent 已能把用户选定的事实保存成有来源的项目条目，并在下一项任务重新交给模型。下一节保留同一个存储器，让模型提出候选，但由用户决定候选是否真正写入。
