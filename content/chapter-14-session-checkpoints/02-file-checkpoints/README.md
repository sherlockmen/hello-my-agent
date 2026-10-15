# 14.2 为工具写入保存文件检查点

[第 14 章首页](/content/chapter-14-session-checkpoints/README.md) · [上一节：14.1 从已有会话创建分支](/content/chapter-14-session-checkpoints/01-fork-session/README.md) · [下一节：14.3 查看改动并按条件恢复](/content/chapter-14-session-checkpoints/03-review-and-restore/README.md)

## 问题：讨论能分开，试改的文件怎样留下恢复依据

上一节为“`add()` 是否拒绝 `NaN`”创建了新讨论。现在决定试着加入输入校验，模型通过 `edit_file` 把 `src/add.ts` 改成遇到非有限数值就抛错。

会话里能看到工具参数和成功消息，但它们不足以恢复文件。精确替换参数只含一段旧文字，不一定含完整旧文件；执行命令也可能影响多个路径。稍后我们需要明确知道：这一次受支持的文件写入，针对哪个工作区、哪个文件，写前完整内容是什么，原本准备写成什么。

本节为批准后的 `write_file`、`edit_file` 保存单文件检查点。它不是整个目录的快照，也不是每一轮模型任务的快照。

## 解决方案：先保存旧内容和预期结果，再真正写文件

文件工具已经有“准备 → 展示差异 → 用户批准 → 执行”的过程。程序在执行阶段加入一步：复核目标后，把旧内容 `before`、预期新内容 `after` 和所属会话、工作区、路径写入本机检查点文件，等待写入并同步成功，然后才允许创建或覆盖目标。

这条先后关系很关键。检查点无法保存时，目标还没有被本次工具修改；如果先改文件、再尝试保存旧内容，保存失败时就可能已经丢掉恢复依据。

新增文件原本不存在，所以用 `before: null` 表示。空文件则是 `before: ""`，两者不能混用：恢复前者要删除新文件，恢复后者要保留一个空文件。具体恢复操作下一节完成，本节先把依据保留下来。

## 工作原理

### 检查点记住一次工具写入，不把消息当成文件

给 `src/add.ts` 增加校验时，工具准备阶段读到完整旧内容 A，计算出完整预期内容 B，并用 A、B 生成审批差异。用户批准的是这次差异，执行阶段再次核对文件没有偏离 A，然后保存下面这些信息。示例省略了完整内容和部分字段，表示的是文件检查点，不是模型协议消息。

```json
{
  "sessionId": "当前会话的完整 UUID",
  "workspace": "工作区的真实绝对路径",
  "path": "src/add.ts",
  "before": "完整内容 A",
  "after": "预期内容 B"
}
```

检查点文件还有自己的 UUID、版本和创建时间。它属于当前会话，保存在 `<会话目录>/<会话ID>.files/<检查点ID>.json`；它没有塞进会话的 `messages`，也不会把两份完整文件自动发送给模型。工具成功结果会带回检查点 ID，方便把一次工具执行与本机记录对应起来。

同一路径改两次，会得到两份记录：A→B、B→C。每份保存自己的起点与预期终点，不能把第二次操作的 B 当成最初的 A。这也为下一节按次恢复提供了依据。

### 保存成功是写入目标之前必须满足的条件

先只看一次正常编辑的顺序：

1. 工具准备 A、B 和差异，程序等待用户批准。拒绝或在这里取消时，不执行文件修改，也不建立文件检查点。
2. 用户批准后，工具重新核对目标身份与当前内容。当前内容不再等于 A，就让这次修改失效，返回工具错误，请模型重新读取。
3. 检查点模块再次核对记录对应的工作区、路径与当前旧内容，独占创建一份新记录，写完并 `sync`，关闭文件后返回 ID。
4. 文件工具才继续原来的创建或覆盖流程。`edit_file` 仍保留第 6 章的临时备份，并在写完后同步目标；成功结果带上检查点 ID，随后才交回模型。

检查点独占创建，避免把同名记录当作可覆盖文件。目录和文件以私有权限创建，因为里面可能包含项目源码。程序也验证读取到的检查点字段、版本、大小和所属会话，不能只因扩展名是 `.json` 就把它当作可信恢复输入。

### 有记录不代表目标已经写完

检查点在目标写入之前保存，所以字段 `after` 的含义是“预期新内容”。即使机器在第 3 步后停止，记录仍可能存在，而目标还保持 A；目标写入中途失败，也可能只留下 B 的一部分。

这时不能看到检查点就显示“修改完成”，更不能直接把记录当成一次成功的写入。工具完成仍以自己的写入结果为准。下一节恢复时还会读取真实文件，只有当前内容完整等于 B 才提供正常恢复；内容已经是 A 时提示无需恢复；内容是部分 B 或其他文字时，先报告不符合条件，由人核对。

取消也遵守这个区分。执行前取消可以不写目标；进入系统写入以后，请求停止不等于撤销已经落盘的字节。已经保存的检查点继续保留，旧的临时备份也按原工具规则保留，但程序不会自动选择一份内容覆盖当前文件。

### 哪些变化会被记录，哪些需要另行核对

本节只记录正式 text/TUI 入口注入的 `write_file` 和 `edit_file`。一个工具调用对应一个文件检查点，获批也不意味着一定有记录：参数、路径或执行前复核失败时，流程会更早停止。

`run_command` 仍然可能通过测试、安装或脚本改动很多文件。程序没有在命令执行前后扫描整个项目，因此不能声称 `/changes` 会列出这些变化，也不能依靠本章机制撤销安装、网络请求或数据库写入。

检查点支持项目内的普通 UTF-8 文本文件；拒绝符号链接、硬链接、二进制内容、过大的文件和受保护路径，避免恢复时指向未经预期的对象。父目录必须已经存在。这里会拒绝检查时发现的不符合条件，但没有锁住整个工作区；操作期间应停止对同一文件的并发编辑，不能把路径检查当成操作系统沙箱。

本节检查点保存的完整 before、after 各不超过 1 MiB；创建与精确替换还保留原文件工具更具体的参数上限。限制触发时会返回错误，目标不会因为“检查点太大”而绕过记录继续写入。

<!-- generated:media:start -->
下面先看一次成功写入的顺序，再分别看两种独立的失败结果。A、B 代表完整文件原文；检查点已经保存，只能证明恢复依据在，不能证明目标已经写成 B。

<img src="./content/chapter-14-session-checkpoints/02-file-checkpoints/assets/file-checkpoint-cover-cbc755ad21.png" data-gif-src="./content/chapter-14-session-checkpoints/02-file-checkpoints/assets/file-checkpoint-b17db3de48.gif" data-cover="./content/chapter-14-session-checkpoints/02-file-checkpoints/assets/file-checkpoint-cover-cbc755ad21.png" data-no-zoom alt="批准后先保存并同步旧文与预期新文，再改目标；写前保存失败和目标写入失败是两种独立结果">

[静态封面](/content/chapter-14-session-checkpoints/02-file-checkpoints/assets/file-checkpoint-cover-cbc755ad21.png.md) · [查看完整静态分镜](/content/chapter-14-session-checkpoints/02-file-checkpoints/assets/file-checkpoint-storyboard-425d874936.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/sessions/file-checkpoints.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/sessions/file-checkpoints.ts.md) | 验证路径与内容，把单文件 before 和预期 after 同步保存 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/agent/run-options.ts.md) | 传递本次会话的文件检查点存储 |
| CHANGED | [src/tools/write-file.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/tools/write-file.ts.md) | 重新核对准备结果后，先保存恢复依据再真正写入 |
| CHANGED | [src/tools/edit-file.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/tools/edit-file.ts.md) | 保留完整旧文与预期新文，检查点成功后才执行替换 |
| CHANGED | [src/tools/registry.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/tools/registry.ts.md) | 把当前会话的存储注入两个写工具 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/agent/agent-loop.ts.md) | 沿原审批执行路径传递存储，不在预览时创建记录 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/ui/tui/app.tsx.md) | 让 TUI 每轮任务使用当前会话的存储 |
| CHANGED | [src/cli.ts](/content/chapter-14-session-checkpoints/02-file-checkpoints/src/cli.ts.md) | 按 writer 的新身份和会话目录创建存储 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 14.1 的完整 `src/` 继续，目标目录为 `chapter-14-session-checkpoints/02-file-checkpoints/`。先实现检查点存储，再通过运行选项传入两个文件工具，最后由 text/TUI 使用当前会话 ID 创建存储。存储模块不启动工具，工具仍然只在审批通过后调用它。

<!-- generated:build:start -->
### 1. 验证路径与内容，把单文件 before 和预期 after 同步保存

新建 `src/sessions/file-checkpoints.ts`，完整内容如下。

<details>
<summary>完整文件：src/sessions/file-checkpoints.ts（NEW）</summary>

<!-- source: src/sessions/file-checkpoints.ts -->
```ts
/**
 * 14.2 文件检查点 | [NEW] sessions/file-checkpoints.ts
 * 学习目标：批准写入后、真正改文件前，先留下可核对的原文与预期结果。
 * 输入：会话身份、真实工作区、单个工具的 before/after；输出：独立检查点 UUID。
 * 状态：每次 write_file/edit_file 一份记录，位于会话目录的 <会话ID>.files 中。
 * 失败：任何检查或保存失败都不放行工具写入；命令和外部程序不在捕获范围。
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, sessionPath } from "./read-session.js";

// [NEW 14.2] 本文件以下实现均为本节新增。
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 14 * MAX_FILE_BYTES; // JSON 的控制字符转义会放大正文，读取仍必须有界。
export type FileCheckpoint = { version: 1; id: string; sessionId: string; workspace: string; path: string; createdAt: string; before: string | null; after: string };
export type FileCheckpointStore = {
  record(path: string, before: string | null, after: string, workspace: string): Promise<string>;
  list(): Promise<FileCheckpoint[]>;
  read(id: string): Promise<FileCheckpoint>;
};

/** 每一段都拒绝链接和硬保护路径，不把链接别名当作可恢复文件。 */
async function safeTarget(path: string, workspace: string): Promise<string> {
  const parts = path.replaceAll("\\", "/").split("/");
  const name = basename(path).toLowerCase();
  if (!path || path.length > 500 || isAbsolute(path) || win32.isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)
    || parts.some(part => !part || part === "." || part === ".." || [".git", ".agents", ".codex", ".hello-my-agent"].includes(part.toLowerCase()))
    || name === ".env" || name.startsWith(".env.") || name === ".envrc") throw new UserFacingError("检查点只允许项目内非保护的相对文件路径。");
  const root = await realpath(workspace);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new UserFacingError("检查点不接受符号链接或非目录父路径。");
    } catch (error) { if (i !== parts.length - 1 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const actual = relative(root, current);
  if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) throw new UserFacingError("检查点路径越界。");
  return current;
}

/** 有界读取普通文件，身份与字节来自同一句柄；UTF-8 无损才接受。 */
async function readText(path: string, allowMissing = false) {
  let file: FileHandle;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) throw new UserFacingError("文件检查点只支持单链接、1 MiB 以内的普通 UTF-8 文本文件。");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
    if (length > MAX_FILE_BYTES) throw new UserFacingError("文件超过 1 MiB。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new UserFacingError("文件不是有效 UTF-8，未创建检查点。"); }
    if (text.includes("\0")) throw new UserFacingError("二进制文件不在检查点范围。");
    return { text, info };
  } finally { await file.close(); }
}

/** 会话目录只保存本会话检查点；新分支不继承旧分支的文件恢复权。 */
export function createFileCheckpointStore(sessionId: string, directory = DEFAULT_SESSION_DIRECTORY): FileCheckpointStore {
  const folder = sessionPath(sessionId, directory).slice(0, -6) + ".files";
  async function ensureFolder() {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new UserFacingError("文件检查点目录必须是真实目录。");
  }
  async function read(id: string): Promise<FileCheckpoint> {
    sessionPath(id);
    const folderInfo = await lstat(folder);
    if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink()) throw new UserFacingError("文件检查点目录无效。");
    const file = await open(join(folder, `${id}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_RECORD_BYTES) throw new UserFacingError("文件检查点记录类型或大小无效。");
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let length = 0;
      while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
      if (length > MAX_RECORD_BYTES) throw new UserFacingError("文件检查点记录过大。");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new UserFacingError("文件检查点格式无效。");
      const item = value as FileCheckpoint;
      if (Object.keys(item).sort().join() !== "after,before,createdAt,id,path,sessionId,version,workspace" || item.version !== 1 || item.id !== id || item.sessionId !== sessionId
        || typeof item.workspace !== "string" || !isAbsolute(item.workspace) || typeof item.path !== "string" || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
        || (item.before !== null && typeof item.before !== "string") || typeof item.after !== "string"
        || Buffer.byteLength(item.before ?? "") > MAX_FILE_BYTES || Buffer.byteLength(item.after) > MAX_FILE_BYTES || (item.before ?? "").includes("\0") || item.after.includes("\0")) throw new UserFacingError("文件检查点字段无效。");
      return item;
    } finally { await file.close(); }
  }
  return {
    async record(path, before, after, workspace) {
      if (Buffer.byteLength(before ?? "") > MAX_FILE_BYTES || Buffer.byteLength(after) > MAX_FILE_BYTES || after.includes("\0")) throw new UserFacingError("文件检查点正文超过限制或不是文本。");
      const root = await realpath(workspace), target = await safeTarget(path, root);
      const current = await readText(target, true);
      if ((current?.text ?? null) !== before) throw new UserFacingError("文件在准备检查点时已变化，工具写入已停止。");
      await ensureFolder();
      const id = randomUUID();
      const item: FileCheckpoint = { version: 1, id, sessionId, workspace: root, path, createdAt: new Date().toISOString(), before, after };
      const file = await open(join(folder, `${id}.json`), "wx", 0o600);
      try { await file.writeFile(`${JSON.stringify(item)}\n`, "utf8"); await file.sync(); }
      finally { await file.close(); }
      return id;
    },
    read,
    async list() {
      let names: string[];
      try { names = await readdir(folder); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      const items: FileCheckpoint[] = [];
      for (const name of names) if (/^[0-9a-f-]{36}\.json$/.test(name)) items.push(await read(name.slice(0, -5)));
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },
  };
}
```

</details>

### 2. 传递本次会话的文件检查点存储

在上一节的 `src/agent/run-options.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/run-options.ts（CHANGED）</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,5 +1,5 @@
 /**
- * 13.1 保存会话 | [KEEP] agent/run-options.ts
+ * 14.2 文件检查点 | [CHANGED] agent/run-options.ts
  *
  * 学习目标：保存会话时辨明运行选项与持久状态；本文件沿用整轮控制数据约定。
  * 输入：本地入口选定的模式、会话清单、问答 handler 与本轮队列回调。
@@ -10,6 +10,8 @@
  * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
  * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
  */
+import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";
+
 // [KEEP 来自 12.1] 模式由本地运行入口选择，默认继续执行。
 /**
  * 本地入口可选的两种运行模式。
@@ -56,7 +58,9 @@
  * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
  * 省略可选项时使用默认模式或缺省交互；回调仅负责本轮，不能把旧轮补充带进新轮。
  */
+// [CHANGED 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 export type RunOptions = {
+  fileCheckpoints?: FileCheckpointStore;
   // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
   mode?: ExecutionMode;
   // [KEEP 来自 12.2] 清单容器跨模型请求和工具调用共用。
```

</details>

### 3. 重新核对准备结果后，先保存恢复依据再真正写入

在上一节的 `src/tools/write-file.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/write-file.ts（CHANGED）</summary>

<!-- source: src/tools/write-file.ts -->
```diff
--- a/src/tools/write-file.ts
+++ b/src/tools/write-file.ts
@@ -1,8 +1,8 @@
 /**
- * 13.1 保存会话 | [KEEP] tools/write-file.ts
- *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责先准备新文件预览，批准后才创建文件。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 14.2 文件检查点 | [CHANGED] tools/write-file.ts
+ *
+ * 学习目标：把文件检查点接到已批准的写入之前；本文件负责先准备新文件预览，批准后才创建文件。
+ * 阅读说明：检查点先保存修改前原文和预期修改后内容，sync 成功才继续改目标。记录存在并不证明随后写入成功。
  * 输入：项目内的相对路径、完整正文和取消信号。
  * 输出：准备时返回预览和 execute 函数；调用 execute 后才创建文件并返回结果。
  * 状态：准备失败不创建文件；创建时失败或取消仍可能留下新文件，不能把停止请求理解为回滚。
@@ -12,7 +12,8 @@
  *                  +-- 是 --> 父目录有效且文件不存在？-- 否 --> ToolError
  *                                                   +-- 是 --> 生成 diff -> 返回
  *   执行：父目录还是原来那个？-- 否 --> ToolError
- *                           +-- 是 --> wx 创建 -- 成功 --> 返回路径和字节数
+ *                           +-- 是 --> 文件检查点 sync -- 失败 --> ToolError，不创建目标
+ *                                             +-- 成功 --> wx 创建 --> 返回路径和字节数
  *                                             +-- 失败 --> ToolError
  *
  * Agent Loop 在准备和执行之间等待审批，本文件不读取用户的输入。
@@ -24,7 +25,8 @@

 import { lstat, realpath, stat, writeFile } from "node:fs/promises";
 import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
-import { ToolError } from "../errors.js";
+import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";
+import { ToolError, UserFacingError } from "../errors.js";
 import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
 import { createUnifiedDiff } from "./change-preview.js";
 import { findProjectRoot } from "./workspace.js";
@@ -150,6 +152,8 @@
   argumentsJson: string,
   projectRoot = findProjectRoot(),
   signal?: AbortSignal,
+  // [CHANGED 14.2] 可选句柄让旧调用保留原行为，正式 text/TUI 入口始终注入。
+  checkpoints?: FileCheckpointStore,
 ): Promise<PreparedToolCall> {
   signal?.throwIfAborted();
   const input = parseArguments(argumentsJson);
@@ -168,6 +172,7 @@
   return {
     preview,
     async execute(executionSignal): Promise<ToolExecutionResult> {
+      let checkpointId: string | undefined;
       executionSignal.throwIfAborted();
       try {
         // [KEEP 来自 06.1] 等待期间父目录可能被替换，保存前要确认它还是准备时的目录。
@@ -176,14 +181,18 @@
           || currentParent.ino !== parentSnapshot.inode) {
           throw new ToolError("新文件的父目录在差异预览后发生了变化，本次创建已取消。");
         }
+        // [CHANGED 14.2] 检查点 sync 成功才允许创建文件；null 表示此前不存在。
+        checkpointId = await checkpoints?.record(input.path, null, input.content, projectRoot);
+        executionSignal.throwIfAborted();
         await writeFile(target, input.content, { encoding: "utf8", flag: "wx", signal: executionSignal });
       } catch (error) {
         executionSignal.throwIfAborted();
         if (error instanceof ToolError) throw error;
+        if (error instanceof UserFacingError) throw new ToolError(error.message);
         throw new ToolError(`创建失败，目标可能已存在或无法写入：${input.path}`);
       }
       return {
-        content: `已创建文件：${input.path}`,
+        content: `已创建文件：${input.path}${checkpointId ? `\n文件检查点：${checkpointId}` : ""}`,
         metadata: { kind: "write_file", path: input.path, bytes: Buffer.byteLength(input.content, "utf8") },
       };
     },
```

</details>

### 4. 保留完整旧文与预期新文，检查点成功后才执行替换

在上一节的 `src/tools/edit-file.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/edit-file.ts（CHANGED）</summary>

<!-- source: src/tools/edit-file.ts -->
```diff
--- a/src/tools/edit-file.ts
+++ b/src/tools/edit-file.ts
@@ -1,8 +1,8 @@
 /**
- * 13.1 保存会话 | [KEEP] tools/edit-file.ts
- *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责准备精确替换，批准后复查文件并保存备份和修改。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 14.2 文件检查点 | [CHANGED] tools/edit-file.ts
+ *
+ * 学习目标：把文件检查点接到已批准的写入之前；本文件负责准备精确替换，批准后复查文件并保存备份和修改。
+ * 阅读说明：检查点先保存修改前原文和预期修改后内容，sync 成功才继续改目标。记录存在并不证明随后写入成功。
  * 输入：编辑参数，以及准备时从同一文件句柄读出的身份和完整原文。
  * 输出：文件未变就先备份再保存，返回备份位置；检查失败则停止，不覆盖目标。
  * 状态：检查或备份失败时尚未覆盖目标；进入写入后再失败可能留下部分内容，不自动恢复备份。
@@ -13,7 +13,8 @@
  *                                                           是 -> 算出 after 和 diff
  *   执行：打开保存的 target -> 身份、类型、大小、全文都符合准备时的记录？
  *                             否 -> ToolError，不备份也不覆盖
- *                             是 -> 保存 before 备份 -- 失败 --> ToolError
+ *                             是 -> 文件检查点 sync -- 失败 --> ToolError，不写目标
+ *                                  成功 -> 保存 before 备份 -- 失败 --> ToolError
  *                                                    +-- 成功 --> 清空目标并从 0 写入
  *                                                                   成功 -> sync -> 返回结果
  *                                                                   失败 -> 报告可用备份
@@ -28,7 +29,8 @@
 import { mkdtemp, open, realpath, stat, writeFile, type FileHandle } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { basename, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
-import { ToolError } from "../errors.js";
+import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";
+import { ToolError, UserFacingError } from "../errors.js";
 import { createUnifiedDiff } from "./change-preview.js";
 import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
 import { findProjectRoot } from "./workspace.js";
@@ -192,6 +194,8 @@
   argumentsJson: string,
   projectRoot = findProjectRoot(),
   signal?: AbortSignal,
+  // [CHANGED 14.2] 可选句柄让旧调用保留原行为，正式 text/TUI 入口始终注入。
+  checkpoints?: FileCheckpointStore,
 ): Promise<PreparedToolCall> {
   signal?.throwIfAborted();
   const input = parseArguments(argumentsJson);
@@ -224,6 +228,7 @@
   return {
     preview,
     async execute(executionSignal): Promise<ToolExecutionResult> {
+      let checkpointId: string | undefined;
       executionSignal.throwIfAborted();
       let backupPath: string | null = null;
       let handle: FileHandle | undefined;
@@ -243,6 +248,9 @@
           throw new ToolError("文件在差异预览后发生了变化，本次修改已取消；请重新读取并生成新的修改。");
         }

+        // [CHANGED 14.2] 原字节和预期结果落盘后，才允许备份与覆盖。
+        checkpointId = await checkpoints?.record(input.path, before, after, projectRoot);
+        executionSignal.throwIfAborted();
         // [KEEP 来自 06.3] 先以 0600 和 wx 保存 before；这一步失败时还没有截断目标文件。
         const backupDirectory = await mkdtemp(join(tmpdir(), "hello-my-agent-backup-"));
         const backupCandidate = join(backupDirectory, `${basename(input.path)}.bak`);
@@ -266,6 +274,7 @@
       } catch (error) {
         executionSignal.throwIfAborted();
         if (error instanceof ToolError) throw error;
+        if (error instanceof UserFacingError) throw new ToolError(error.message);
         throw new ToolError(backupPath
           ? `写入失败；原内容备份位于：${backupPath}`
           : `无法安全写入文件：${input.path}`);
@@ -274,7 +283,7 @@
         try { await handle?.close(); } catch { /* 文件句柄会随进程退出释放。 */ }
       }
       return {
-        content: `已精确替换文件中的 1 处文本：${input.path}\n修改前备份：${backupPath}`,
+        content: `已精确替换文件中的 1 处文本：${input.path}\n修改前备份：${backupPath}${checkpointId ? `\n文件检查点：${checkpointId}` : ""}`,
         metadata: {
           kind: "edit_file",
           path: input.path,
```

</details>

### 5. 把当前会话的存储注入两个写工具

在上一节的 `src/tools/registry.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/registry.ts（CHANGED）</summary>

<!-- source: src/tools/registry.ts -->
```diff
--- a/src/tools/registry.ts
+++ b/src/tools/registry.ts
@@ -1,5 +1,5 @@
 /**
- * 13.1 保存会话 | [KEEP] tools/registry.ts
+ * 14.2 文件检查点 | [CHANGED] tools/registry.ts
  *
  * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责根据工具名称找到实现，并传入本轮清单与问答入口。
  * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
@@ -58,11 +58,13 @@
 export async function prepareTool(
   call: ToolCall,
   signal: AbortSignal,
+  // [CHANGED 14.2] 只有获批准的写入闭包会使用本会话检查点。
+  options: RunOptions = {},
 ): Promise<PreparedToolCall | null> {
   signal.throwIfAborted();
-  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal);
+  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal, options.fileCheckpoints);
   // [KEEP 来自 06.2] 精确替换也必须在审批前解析当前文件并生成 diff。
-  if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal);
+  if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal, options.fileCheckpoints);
   // [KEEP 来自 07.1] 准备阶段只固定命令和目录，不启动子进程。
   if (call.name === runCommandDefinition.name) return prepareRunCommand(call.arguments, undefined, signal);
   return null;
```

</details>

### 6. 沿原审批执行路径传递存储，不在预览时创建记录

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,5 +1,5 @@
 /**
- * 13.1 保存会话 | [KEEP] agent/agent-loop.ts
+ * 14.2 文件检查点 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：区分核心提交模型历史与界面保存磁盘检查点，看清存储接在循环收尾的位置。
  * 输入：问题、已有模型历史、取消信号、观察者、审批入口，以及本轮模式和本地控制选项。
@@ -10,7 +10,7 @@
  *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
  *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
  *                                                         +-- 有效 -> 配置、模型、消费者
- *   [CHANGED 13.1] text / tui -> sessions/save-session 创建新 ID、wx 文件；jsonl 仍只输出事件
+ *   [KEEP 来自 13.1] text / tui -> sessions/save-session 创建新 ID、wx 文件；jsonl 仍只输出事件
  *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
  *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
  *   [KEEP 来自 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
@@ -58,13 +58,13 @@
  *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
  *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
  *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
- *   [CHANGED 13.1] text / TUI 流清理完 -> Message[] 已提交 -> 白名单检查点 -> 串行 append、sync
+ *   [KEEP 来自 13.1] text / TUI 流清理完 -> Message[] 已提交 -> 白名单检查点 -> 串行 append、sync
  *                  -> 成功 / 保存失败反馈（模型结果另行显示）；TUI done 此后才解除占用
- *   [CHANGED 13.1] reset / 有效 mode / 队列编辑撤回 -> 白名单检查点；Enter 入队仍只改内存
+ *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑撤回 -> 白名单检查点；Enter 入队仍只改内存
  *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
  *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
  *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
- *   [CHANGED 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
+ *   [KEEP 来自 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
  *
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
@@ -213,7 +213,8 @@
         if (permission.action === "ask") {
           try {
             // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
-            prepared = await prepareTool(call, signal);
+            // [CHANGED 14.2] 把本地文件检查点入口传到写入准备层。
+            prepared = await prepareTool(call, signal, options);
           } catch (error) {
             if (!(error instanceof ToolError)) throw error;
             turn.push({
```

</details>

### 7. 让 TUI 每轮任务使用当前会话的存储

在上一节的 `src/ui/tui/app.tsx` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/app.tsx（CHANGED）</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 13.3 恢复会话 | [KEEP] ui/tui/app.tsx
+ * 14.2 文件检查点 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：在明确动作后保存会话白名单，并把任务状态与保存状态分别显示。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -16,20 +16,20 @@
  *                                         +-- 否 -> 校验补充、加入当前轮队列、清草稿
  *                              +-- 否 -> 本地命令或 startRun
  *   [KEEP 来自 12.4] Ctrl+S -> 校验并记住新要求 -> clearing 锁住提交 -> abort 旧任务
- *                   -> [CHANGED 13.1] await 旧 done（流清理和检查点保存）-> closing？-- 是 -> 结束；否 -> startRun
+ *                   -> [KEEP 来自 13.1] await 旧 done（流清理和检查点保存）-> closing？-- 是 -> 结束；否 -> startRun
  *   [KEEP 来自 12.2] 任务清单工具结果 -> 会话内清单 -> 摘要和至多三项进度
  *   [KEEP 来自 12.3] ask_user -> waitForAnswer -> 问答面板独占输入 -> 原问答 Promise
  *                   -> 回答 / Esc / 取消 -> 关闭面板，普通草稿继续保留
  *   [KEEP 来自 12.4] startRun -> 用当前 run 绑定收取回调 -> 事件流 -> input_applied 才显示生效
- *                   -> [CHANGED 13.1] finally 等清理 -> 保存检查点 -> 解除占用，未收取队列留存
+ *                   -> [KEEP 来自 13.1] finally 等清理 -> 保存检查点 -> 解除占用，未收取队列留存
  *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；正在编辑队列时暂不切换
  *   [KEEP 来自 12.5] 队列 -> e 编辑 / x 撤回 -> 固定 ID 查找；已收取 -> 编辑稿留存
  *                    空闲 Enter -> 再查 ID -> 移出队列 -> 作为新任务发送
  *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
  *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
  *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑
- *   [CHANGED 13.1] reset / 有效 mode / 队列编辑、撤回 -> 调用时复制白名单 -> 保存反馈
- *   [CHANGED 13.1] 正常退出 -> 最后检查点 -> close（失败仍恢复终端）-> 卸载、反馈
+ *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑、撤回 -> 调用时复制白名单 -> 保存反馈
+ *   [KEEP 来自 13.1] 正常退出 -> 最后检查点 -> close（失败仍恢复终端）-> 卸载、反馈
  *
  * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
  * 清单进度是模型通过工具报告的状态；实际测试是否成功要看命令的结果。
@@ -51,6 +51,7 @@
 import { DraftEditor, newDraft, changeDraft } from "./editor.js";
 import { Transcript, runEntries, type Entry } from "./transcript.js";
 import { editExternally } from "./system-actions.js";
+import type { FileCheckpointStore } from "../../sessions/file-checkpoints.js";
 import type { Message, Model } from "../../models/client.js";
 import { streamAgentRun } from "../../agent/run-stream.js";
 import { explainError } from "../../errors.js";
@@ -85,6 +86,8 @@
   closing: boolean;
   external?: { controller: AbortController; done: Promise<void> };
   // [KEEP 来自 13.1] writer 跨轮复用；保存反馈单独显示，不混入模型执行状态。
+  // [CHANGED 14.2] 会话长期持有检查点入口，组件重绘不重建。
+  fileCheckpoints?: FileCheckpointStore;
   writer?: SessionWriter;
   saveRequest: number;
   saveMessage: string;
@@ -340,7 +343,8 @@
     const controller = new AbortController();

     // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
-    const options = { mode: session.mode, tasks: session.tasks,
+    // [CHANGED 14.2] 本轮获批准的写入使用当前会话文件检查点。
+    const options = { fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
       // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
       askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
         if (!session.closing) setQuestion(pending);
@@ -457,13 +461,13 @@
  * 退出先设置 closing 阻止新提交，再取消并等待任务和外部编辑，保存并关闭后才卸载。
  */
 // [KEEP 来自 13.1] CLI 注入 writer；TUI 退出前保存和关闭，CLI finally 可幂等重复关闭。
-export async function startTui(model: Model, initialMode: ExecutionMode = "execute", writer?: SessionWriter, initial?: SessionState): Promise<void> {
+export async function startTui(model: Model, initialMode: ExecutionMode = "execute", writer?: SessionWriter, initial?: SessionState, fileCheckpoints?: FileCheckpointStore): Promise<void> {
   // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
   // [KEEP 来自 13.1] 会话 ID 已在 writer 创建时固定，任务和组件重绘都不会重建文件。
   // [KEEP 来自 13.3] 深拷贝可信快照，编号接着走；新一轮不能收取旧 run 的补充。
   const history = structuredClone([...(initial?.messages ?? [])]);
   const queue = initial ? { items: structuredClone([...initial.pendingInputs]), nextId: initial.nextInputId } : newInputQueue();
-  const session: Session = { mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
+  const session: Session = { mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
   let instance: ReturnType<typeof render> | undefined;
   // [KEEP 来自 13.1] 退出 Promise 只创建一次；保存和关闭都结束才恢复终端。
   let shutdown: Promise<void> | undefined;
```

</details>

### 8. 按 writer 的新身份和会话目录创建存储

在上一节的 `src/cli.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/cli.ts（CHANGED）</summary>

<!-- source: src/cli.ts -->
```diff
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,6 +1,6 @@
 #!/usr/bin/env node
 /**
- * 14.1 会话分支 | [CHANGED] cli.ts
+ * 14.2 文件检查点 | [CHANGED] cli.ts
  *
  * 学习目标：为人类交互入口创建会话文件，把存储句柄交给消费者，并在正常退出时关闭它。
  * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
@@ -34,6 +34,8 @@
  * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
  */

+import { dirname } from "node:path";
+import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
 import { readFileSync } from "node:fs";
 // [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
 import { forkSessionWriter } from "./sessions/fork-session.js";
@@ -94,7 +96,7 @@
   // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
   .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
   // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
-  // [CHANGED 14.1] fork 创建新身份；resume 继续旧身份。
+  // [KEEP 来自 14.1] fork 创建新身份；resume 继续旧身份。
   .option("--fork <id>", "从指定会话的最后完整状态创建新分支，不重放工具")
   .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
   .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
@@ -163,7 +165,7 @@
     if (options.resume !== undefined && options.output === "jsonl") throw new UserFacingError("会话恢复只支持 text 或 tui。");
     if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
     if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
-    // [CHANGED 14.1] 含糊组合在创建模型或新文件之前拒绝。
+    // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
     if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
     const config = readConfig(options);
     const model = createModel(config);
@@ -172,12 +174,14 @@
       await runJsonlPrompt(model, options.prompt!, runOptions);
       return;
     }
-    // [CHANGED 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
+    // [KEEP 来自 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
     const writer = options.fork !== undefined
       ? await forkSessionWriter(options.fork, options.sessionDir)
       : options.resume !== undefined
       ? await resumeSessionWriter(options.resume, options.sessionDir, options.recover)
       : await createSessionWriter(options.sessionDir);
+    // [CHANGED 14.2] 文件恢复数据与会话同属一个身份，分支自动使用新的目录。
+    runOptions.fileCheckpoints = createFileCheckpointStore(writer.id, dirname(writer.path));
     console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
     try {
       // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
@@ -197,7 +201,7 @@
         if (options.output === "tui") {
           const { startTui } = await import("./ui/tui/app.js");
           // [KEEP 来自 13.1] 会话 writer 与启动模式一起交给 TUI，授权仍由 TUI 保存在内存。
-          await startTui(model, mode, writer, initial);
+          await startTui(model, mode, writer, initial, runOptions.fileCheckpoints);
         } else await startTerminal(model, runOptions, writer, initial);
       } else await runSinglePrompt(model, options.prompt, runOptions, writer, initial);
     } finally {
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根目录编译并链接本节：

```bash
npm run lesson:14.2
```

进入加法演示项目，继续上一节的新会话。下面的 ID 使用新分支的完整 UUID。

```bash
cd docs/.work/ch13-typescript-demo
hello-my-agent --resume <新分支的完整UUID>
```

输入下面的要求。模型给出的具体文案可以不同，批准前要核对新增条件确实只处理这次约定。

```text
先读取 src/add.ts。试着让 add 在任一参数不是有限数值时抛出 RangeError，其他数值仍返回两数之和。先只改这个文件，不要运行命令。
```

差异审批时，旧文件应还保持原样；批准后，工具成功结果应带有“文件检查点”及完整 ID，文件才出现新校验。正常退出，查看默认会话目录中的对应记录：

```bash
ls "$HOME/.hello-my-agent/sessions/<当前会话的完整UUID>.files"
```

打开这份 JSON，核对 `before` 是原完整文件、`after` 是带校验的预期文件、`path` 为 `src/add.ts`，且 `sessionId`、工作区都对应本次运行。记录里的换行会以 JSON 转义保存，解析后才是完整文本。

重新发起一项小修改，在审批时拒绝。这次不应产生新的文件写入，也不应多出一个检查点。章末临时目录练习核对“检查点保存失败不改目标”和“只有预期记录不代表写入成功”。使用完整配套仓库时，还可在根目录运行 `npm run check:14`，核对执行前取消不创建目标。练习没有模拟目标写入中途失败；发生这类错误时，按前面说明读取实际内容并保留恢复依据，不在真实项目里制造磁盘故障。

## 本节完成后的 Agent

Agent 的受支持文件写入现在有了持久恢复依据：批准并复核以后，先保存完整旧内容与预期新内容，再真正写文件。记录与实际完成状态分开，失败后不会凭记录宣称成功。下一节读取这些记录，先展示恢复差异，再核对当前文件，执行符合条件的单文件恢复。
