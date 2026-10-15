# 14.3 查看改动并按条件恢复

[第 14 章首页](/content/chapter-14-session-checkpoints/README.md) · [上一节：14.2 为工具写入保存文件检查点](/content/chapter-14-session-checkpoints/02-file-checkpoints/README.md) · [下一章：计算与控制上下文预算](/content/chapter-15-context-budget/README.md) · [本章练习与答案](/content/chapter-14-session-checkpoints/EXERCISES.md)

## 问题：决定撤回校验时，不能盖掉后来写的内容

我们已经试着给 `add()` 增加“非有限数值就抛错”的校验，也保存了旧内容 A 和预期新内容 B。现在决定保持原来的函数约定，想撤回这项修改。

直接把检查点中的 A 写回去，看似就完成了恢复。但在这期间，人可能已经增加了另一条注释，或者另一次工具把 B 改成了 C。此时覆盖为 A，会把后来的修改一起丢掉。恢复前必须知道：当前文件是否仍然是这项记录预期留下的 B。

本节加入 `/changes` 和两步恢复：先列出记录、查看单项恢复差异，再明确确认。执行时再次核对预览对应的当前文件，符合条件才写回旧内容；不符合时报告冲突并停止。

## 解决方案：把恢复当成一项需要复核的新文件操作

`/changes` 列出当前会话拥有的文件检查点，供我们选择具体 ID。`/restore <ID>` 读取记录与真实文件，只有当前内容等于该记录的 `after`，才生成从 `after` 回到 `before` 的差异。

预览不是执行。程序暂存这份恢复计划，等待 `/restore <ID> confirm`。确认时核对的仍是刚才预览的对象：文件身份、类型与完整内容都没有变化，才执行恢复。没有预览、ID 不同，或预览后又发生修改，都不能借一条确认命令直接覆盖文件。

恢复成功只改变该文件。对话历史保留，并追加一条本地恢复通知，让下一轮模型知道旧文件观察可能已经过时，需要重新读取。

## 工作原理

### 先找记录，再看当前内容

`/changes` 展示检查点 ID、路径、创建时间和“新增/修改”，按时间从近到远排列，同一时间再以 ID 固定顺序。这是本会话保存过的记录列表，不是实时扫描工作区得到的 Git 状态，也不是“所有修改都已成功”的证明。

选中 `src/add.ts` 的记录后，程序验证它属于当前会话，记录中的真实工作区等于当前工作区，再检查目标路径和当前文件。真正决定能否正常恢复的是全文比较：

| 检查点 | 当前文件 | 处理结果 |
| --- | --- | --- |
| A→B | 完整等于 B | 生成 B→A 的恢复预览 |
| A→B | 人后来写成 D | 报告冲突，不生成可执行恢复 |
| A→B | 已经等于 A | 提示无需恢复，不重复写入 |
| A→B | 只有部分 B | 不等于预期 after，先人工核对 |
| 不存在→B | 完整等于 B | 预览删除这次新建的文件 |

旧内容 A 仍然可读，并不意味着当前 D 可以安全覆盖。本节选择完整相等才继续，避免程序替人猜测哪几行属于后续修改。它不做三方合并，也不会把“看起来差不多”作为恢复依据。

### 预览和确认之间，再核对一次同一个文件

`/restore <ID>` 通过比较后，生成逆向差异并保留本次文件的身份和内容。我们看到的 `-` 行是准备移除的 B，`+` 行是准备恢复的 A。对新增文件，预览还会明确显示“删除这次创建的文件”，避免把空字符串误当成需要留下的空文件。

随后输入相同 ID 的 `confirm`，程序重新打开目标。它核对文件设备号、inode、类型与大小，再读全文与 B 比较，并检查路径没有在预览后被换成别的对象。通过后，修改文件会写回完整 A 并同步；新增文件会被删除。

这第二次检查解决的是“看完预览后文件又变了”。只有第一次比较，审批期间的修改仍可能被覆盖。确认开始时，暂存的恢复计划就被取出并清空；无论这次成功还是失败，都不能用同一条旧确认反复执行。要再试，先重新预览当前状态。

这些比较仍没有取得系统文件锁，比较结束后也存在并发修改的间隙。本节面向由我们控制、暂停并发编辑的工作区；发现冲突就停下来核对，不能据此声称抵抗恶意进程替换文件。

### 同一文件多次修改，要从当前对应的记录往回走

假设两次工具分别留下 A→B 的 cp1、B→C 的 cp2，而文件当前是 C。直接恢复 cp1 会失败：cp1 期待 B，当前却是 C。先预览并恢复 cp2，C 变回 B，cp1 的条件才重新满足；再恢复 cp1，B 才能变回 A。

这不是靠列表顺序偷偷撤销多项操作。每次命令只针对一个明确 ID，每次都要预览、确认和读取当前文件。恢复记录本身保留，因此以后仍能查到旧内容，但第二次预览同一个已经完成的检查点会提示无需恢复：当前已经是 A，不再需要写回。

如果后来的人改成 D，cp1、cp2 都不满足条件。程序保留文件和检查点，把冲突交给人处理，不自动跳过 D。新建文件恢复为删除后也一样：路径已经不存在，不能把旧确认当作再次删除任意同名文件的授权。

### 恢复完成以后，讨论与文件重新对齐

本地恢复命令在空闲时处理，绕过模型和工具审批循环；任务仍在执行时，不让它与工具写入同时修改文件。用户先等任务结束，或请求停止并等待停止完成，再查看与恢复。

成功以后，text/TUI 显示恢复结果，并向会话历史追加一条本地通知，说明哪个文件恢复了、下一轮需要重新读取。再保存会话状态，这样正常退出后恢复讨论也能看到通知。程序没有把旧工具结果改写成新内容，更没有删除导致这次修改的那段对话。

若确认时发生普通写入错误，程序报告“恢复未完成”，保留检查点原文，不自动重试。因为恢复本身也可能在清空目标或写入部分旧内容后失败，此时要读取实际文件，再决定如何处理；错误提示不能等同于目标完全未变。路径、记录或预览阶段的检查失败则发生在恢复写入之前，不覆盖目标。

恢复范围也要始终清楚：它不撤销测试命令、依赖安装、网络请求或其他文件，也不回退任务清单。恢复 `src/add.ts` 后，仍应运行测试，判断当前代码与测试是否一致。

<!-- generated:media:start -->
下面用同一文件的 A → B → C 说明恢复条件。先恢复符合当前 C 的 cp2；再次预览 cp1 后，若外部把文件改成 D，确认也必须拒绝覆盖。

<img src="./content/chapter-14-session-checkpoints/03-review-and-restore/assets/conditional-restore-cover-387db7b035.png" data-gif-src="./content/chapter-14-session-checkpoints/03-review-and-restore/assets/conditional-restore-b88422b1dd.gif" data-cover="./content/chapter-14-session-checkpoints/03-review-and-restore/assets/conditional-restore-cover-387db7b035.png" data-no-zoom alt="先预览再确认，当前内容必须符合对应after；恢复cp2后才可预览cp1，外部改动D导致确认冲突">

[静态封面](/content/chapter-14-session-checkpoints/03-review-and-restore/assets/conditional-restore-cover-387db7b035.png.md) · [查看完整静态分镜](/content/chapter-14-session-checkpoints/03-review-and-restore/assets/conditional-restore-storyboard-95e0b14c13.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/sessions/file-checkpoints.ts](/content/chapter-14-session-checkpoints/03-review-and-restore/src/sessions/file-checkpoints.ts.md) | 列出记录、准备恢复并再次核对文件；共用预览与确认命令 |
| CHANGED | [src/sessions/read-session.ts](/content/chapter-14-session-checkpoints/03-review-and-restore/src/sessions/read-session.ts.md) | 接受 file_restore 保存原因 |
| CHANGED | [src/sessions/save-session.ts](/content/chapter-14-session-checkpoints/03-review-and-restore/src/sessions/save-session.ts.md) | 为恢复成功后的通知保存声明原因 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-14-session-checkpoints/03-review-and-restore/src/ui/terminal.ts.md) | 处理本地查看与恢复命令，成功后把通知加入历史并保存 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-14-session-checkpoints/03-review-and-restore/src/ui/tui/app.tsx.md) | 在空闲时处理命令，等待文件恢复与通知保存结束后再接新任务 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 14.2 的完整 `src/` 继续，目标目录为 `chapter-14-session-checkpoints/03-review-and-restore/`。在检查点模块里新增恢复预览和命令处理器，再由 text/TUI 接入。两个界面共用同一项复核逻辑，避免一个入口要求预览、另一个入口却能直接覆盖。

<!-- generated:build:start -->
### 1. 列出记录、准备恢复并再次核对文件；共用预览与确认命令

在上一节的 `src/sessions/file-checkpoints.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/sessions/file-checkpoints.ts（CHANGED）</summary>

<!-- source: src/sessions/file-checkpoints.ts -->
```diff
--- a/src/sessions/file-checkpoints.ts
+++ b/src/sessions/file-checkpoints.ts
@@ -1,18 +1,22 @@
 /**
- * 14.2 文件检查点 | [NEW] sessions/file-checkpoints.ts
- * 学习目标：批准写入后、真正改文件前，先留下可核对的原文与预期结果。
- * 输入：会话身份、真实工作区、单个工具的 before/after；输出：独立检查点 UUID。
+ * 14.3 查看与恢复文件 | [CHANGED] sessions/file-checkpoints.ts
+ * 学习目标：先保存可核对的文件检查点，再用预览与二次核对控制单文件恢复。
+ * 输入：会话身份、真实工作区、单个工具的 before/after 或检查点 ID。
+ * 输出：检查点 UUID、改动列表、恢复预览；明确确认且目标未变才恢复。
  * 状态：每次 write_file/edit_file 一份记录，位于会话目录的 <会话ID>.files 中。
- * 失败：任何检查或保存失败都不放行工具写入；命令和外部程序不在捕获范围。
+ * 失败：检查点保存失败不放行工具写入；恢复前冲突不覆盖，恢复写入失败可能留下部分内容。
+ * 边界：命令与外部程序不在捕获范围；文件恢复不倒退对话，调用方追加重新读取通知。
  */
 import { randomUUID } from "node:crypto";
 import { constants } from "node:fs";
-import { lstat, mkdir, open, realpath, readdir, type FileHandle } from "node:fs/promises";
+import { lstat, mkdir, open, realpath, readdir, unlink, type FileHandle } from "node:fs/promises";
 import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
+import { createUnifiedDiff } from "../tools/change-preview.js";
+import { findProjectRoot } from "../tools/workspace.js";
 import { UserFacingError } from "../errors.js";
 import { DEFAULT_SESSION_DIRECTORY, sessionPath } from "./read-session.js";

-// [NEW 14.2] 本文件以下实现均为本节新增。
+// [KEEP 来自 14.2] 本文件以下实现均为本节新增。
 const MAX_FILE_BYTES = 1024 * 1024;
 const MAX_RECORD_BYTES = 14 * MAX_FILE_BYTES; // JSON 的控制字符转义会放大正文，读取仍必须有界。
 export type FileCheckpoint = { version: 1; id: string; sessionId: string; workspace: string; path: string; createdAt: string; before: string | null; after: string };
@@ -118,3 +122,73 @@
     },
   };
 }
+
+// [CHANGED 14.3] 预览保留当时的文件身份，确认时重新比较，不能只相信“之前看过”。
+/**
+ * 准备单个文件的恢复预览，不修改目标。
+ * 先核对真实工作区和当前全文，再把文件身份记入 execute；确认时重新核对身份与字节。
+ * 恢复只涉及本文件，写入途中失败可能留下部分内容，检查点原文仍保留。
+ */
+export async function prepareFileRestore(store: FileCheckpointStore, id: string, workspace = findProjectRoot()) {
+  const item = await store.read(id), root = await realpath(workspace);
+  if (item.workspace !== root) throw new UserFacingError("检查点属于另一个真实工作区，不会恢复。");
+  const target = await safeTarget(item.path, root), current = await readText(target, true);
+  if (!current || current.text !== item.after) {
+    if ((current?.text ?? null) === item.before) throw new UserFacingError("文件已是检查点之前的状态；没有需要恢复的内容。");
+    throw new UserFacingError("恢复冲突：当前文件不等于本次工具预期的修改后内容；未覆盖，请先人工核对或先恢复较新的检查点。");
+  }
+  const preview = createUnifiedDiff(item.path, item.after, item.before ?? "")
+    + (item.before === null ? "\n恢复动作：删除这次创建的文件。" : "\n恢复动作：写回修改前的完整原文。")
+    + "\n只恢复这个文件；对话、命令、网络请求和其他外部副作用不会撤销。";
+  return { item, preview, async execute(): Promise<void> {
+    await safeTarget(item.path, root);
+    let file: FileHandle | undefined;
+    try {
+      file = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
+      const info = await file.stat();
+      if (!info.isFile() || info.nlink !== 1 || info.dev !== current.info.dev || info.ino !== current.info.ino || info.size > MAX_FILE_BYTES) throw new UserFacingError("恢复冲突：预览后的文件身份或类型已变化，未覆盖。");
+      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1); let length = 0;
+      while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
+      if (!bytes.subarray(0, length).equals(Buffer.from(item.after))) throw new UserFacingError("恢复冲突：预览后内容已变化，未覆盖。");
+      // shortcut: 这里不是系统文件锁；比较之后其他进程仍可能写入，协作项目需先停止并发编辑。
+      const latest = await lstat(target);
+      if (latest.isSymbolicLink() || latest.dev !== info.dev || latest.ino !== info.ino) throw new UserFacingError("恢复冲突：路径已替换，未覆盖。");
+      if (item.before === null) { await file.close(); file = undefined; await unlink(target); }
+      else {
+        await file.truncate(0);
+        const content = Buffer.from(item.before); let written = 0;
+        while (written < content.length) { const result = await file.write(content, written, content.length - written, written); if (!result.bytesWritten) throw new UserFacingError("恢复写入未完成；检查点原文仍在，请人工核对目标。"); written += result.bytesWritten; }
+        await file.sync();
+      }
+    } catch (error) {
+      if (error instanceof UserFacingError) throw error;
+      throw new UserFacingError("恢复未完成；检查点原文仍在，请核对文件状态，程序不会自动重试。");
+    } finally { await file?.close(); }
+  } };
+}
+
+// [CHANGED 14.3] 本地命令共用一个已预览计划，文字入口与 TUI 都要求再次明确确认。
+/**
+ * 为一个终端会话保存最近一次恢复预览，供文字入口和 TUI 共用。
+ * 只有同一 ID 已预览才接受 confirm；执行前消费计划，执行或准备失败后清除计划。
+ * 返回恢复结果给调用方，由调用方追加通知并保存会话历史。
+ */
+export function createFileCheckpointCommands(store?: FileCheckpointStore) {
+  let prepared: Awaited<ReturnType<typeof prepareFileRestore>> | undefined;
+  return async (command: string): Promise<{ message: string; restored?: FileCheckpoint }> => {
+    if (!store) return { message: "本入口未启用文件检查点。" };
+    try {
+      if (command === "/changes") {
+        const items = await store.list();
+        return { message: items.length ? items.map(item => `${item.id}  ${item.before === null ? "新增" : "修改"} ${item.path}  ${item.createdAt}`).join("\n") + "\n/restore <ID> 预览单个文件；同一路径从最新改动开始核对。" : "本会话没有文件检查点；命令和外部修改不在记录范围。" };
+      }
+      const match = /^\/restore ([0-9a-f-]{36})( confirm)?$/.exec(command);
+      if (!match) return { message: "用法：/changes；/restore <完整ID> 先预览，再 /restore <完整ID> confirm。" };
+      if (!match[2]) { prepared = await prepareFileRestore(store, match[1]); return { message: prepared.preview + `\n确认执行：/restore ${match[1]} confirm` }; }
+      if (!prepared || prepared.item.id !== match[1]) return { message: "请先执行 /restore <ID> 查看本次恢复预览，再确认。" };
+      const plan = prepared; prepared = undefined;
+      await plan.execute();
+      return { message: `已恢复文件：${plan.item.path}；对话历史保留，下一轮需重新读取文件。`, restored: plan.item };
+    } catch (error) { prepared = undefined; return { message: error instanceof UserFacingError ? error.message : "检查点无法读取或路径不可访问；未执行恢复，请核对记录。" }; }
+  };
+}
```

</details>

### 2. 接受 file_restore 保存原因

在上一节的 `src/sessions/read-session.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/sessions/read-session.ts（CHANGED）</summary>

<!-- source: src/sessions/read-session.ts -->
```diff
--- a/src/sessions/read-session.ts
+++ b/src/sessions/read-session.ts
@@ -1,5 +1,5 @@
 /**
- * 14.1 会话分支 | [CHANGED] sessions/read-session.ts
+ * 14.3 查看与恢复文件 | [CHANGED] sessions/read-session.ts
  *
  * 学习目标：先检查文件内容，再把最后一个完整、可信的状态交给恢复入口。
  * 输入：会话 UUID 与保存目录；磁盘里的 JSON 仍是未知数据，不能直接当作 SessionState。
@@ -18,7 +18,7 @@
 // [KEEP 来自 13.2] 大小限制约束一次读取的内存；本章还没有增量索引或历史压缩。
 export const MAX_SESSION_BYTES = 64 * 1024 * 1024;
 export const DEFAULT_SESSION_DIRECTORY = join(homedir(), ".hello-my-agent", "sessions");
-// [CHANGED 14.1] 可选来源让旧记录继续可读。
+// [KEEP 来自 14.1] 可选来源让旧记录继续可读。
 export type SessionHeader = { version: 1; type: "session"; sessionId: string; createdAt: string; cwd: string; workspace?: string; parent?: { sessionId: string; seq: number } };
 export type ReadSessionResult = {
   header: SessionHeader;
@@ -183,7 +183,7 @@
         objectWithKeys(record, ["version", "type", "sessionId", "createdAt", "cwd"], ["workspace", "parent"]);
         if (record.type !== "session" || !Number.isFinite(Date.parse(text(record.createdAt))) || !isAbsolute(text(record.cwd))) throw new Error("会话头无效");
         if (record.workspace !== undefined && !isAbsolute(text(record.workspace))) throw new Error("工作区路径无效");
-        // [CHANGED 14.1] 来源只描述分支起点，不赋予新文件改写源会话的权限。
+        // [KEEP 来自 14.1] 来源只描述分支起点，不赋予新文件改写源会话的权限。
         if (record.parent !== undefined) {
           const parent = objectWithKeys(record.parent, ["sessionId", "seq"]);
           sessionPath(text(parent.sessionId)); integer(parent.seq, 0);
@@ -201,7 +201,8 @@
         name = validateSessionName(record.name);
       } else {
         objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "reason", "state"]);
-        if (record.type !== "checkpoint" || !["run_start", "run_end", "reset", "mode", "queue_change", "exit"].includes(record.reason as string)) throw new Error("未知检查点类型");
+        // [CHANGED 14.3] 文件恢复通知不倒退消息历史，也不标记新的模型任务。
+        if (record.type !== "checkpoint" || !["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(record.reason as string)) throw new Error("未知检查点类型");
         const nextState = validateSessionState(record.state);
         if (state && (nextState.run < state.run || nextState.nextInputId < state.nextInputId)) throw new Error("会话计数不能倒退");
         state = nextState;
```

</details>

### 3. 为恢复成功后的通知保存声明原因

在上一节的 `src/sessions/save-session.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/sessions/save-session.ts（CHANGED）</summary>

<!-- source: src/sessions/save-session.ts -->
```diff
--- a/src/sessions/save-session.ts
+++ b/src/sessions/save-session.ts
@@ -1,5 +1,5 @@
 /**
- * 14.1 会话分支 | [CHANGED] sessions/save-session.ts
+ * 14.3 查看与恢复文件 | [CHANGED] sessions/save-session.ts
  *
  * 学习目标：把内存会话保存成版本明确、可逐行查看的 JSONL 检查点。
  * 输入：会话目录、模型消息、模式、清单和未交付补充；不接收模型连接配置或授权。
@@ -28,7 +28,8 @@
 import { DEFAULT_SESSION_DIRECTORY, MAX_SESSION_BYTES, readSession, sessionPath, validateSessionName, validateSessionState, type ReadSessionResult } from "./read-session.js";

 // [KEEP 来自 13.1] 本文件以下实现均为本节新增。
-export type CheckpointReason = "run_start" | "run_end" | "reset" | "mode" | "queue_change" | "exit";
+// [CHANGED 14.3] 文件恢复后的通知也以明确原因保存。
+export type CheckpointReason = "run_start" | "run_end" | "reset" | "mode" | "queue_change" | "exit" | "file_restore";
 export type SessionState = {
   messages: readonly Message[];
   mode: ExecutionMode;
@@ -231,9 +232,10 @@
      * state 是当前会话白名单，reason 说明本次保存触发点；成功返回递增 seq。
      * 同一文件上不并发写入；任一写盘失败后，后续调用继续拒绝而不拼接潜在坏尾。
      */
+    // [CHANGED 14.3] 同一序列保存文件恢复后的对话通知。
     save(state, reason) {
       try {
-        if (!["run_start", "run_end", "reset", "mode", "queue_change", "exit"].includes(reason)) throw new UserFacingError("不支持这个保存原因。");
+        if (!["run_start", "run_end", "reset", "mode", "queue_change", "exit", "file_restore"].includes(reason)) throw new UserFacingError("不支持这个保存原因。");
         return append("checkpoint", { reason, state: validateSessionState(copySessionState(state)) });
       } catch (error) { return Promise.reject(error); }
     },
@@ -267,7 +269,7 @@
  * 创建新会话并持锁，元数据 sync 完成后才交出保存入口。
  * 新头记录额外保存工作区真实路径，旧版只有 cwd 的文件仍由读取器兼容。
  */
-// [CHANGED 14.1] 来源元数据与新 UUID 同时落盘，原会话不被打开写入。
+// [KEEP 来自 14.1] 来源元数据与新 UUID 同时落盘，原会话不被打开写入。
 export async function createSessionWriter(directory = DEFAULT_SESSION_DIRECTORY, parent?: { sessionId: string; seq: number }): Promise<SessionWriter> {
   if (parent) { sessionPath(parent.sessionId); if (!Number.isSafeInteger(parent.seq) || parent.seq < 0) throw new UserFacingError("分支来源序号无效。"); }
   const sessionDirectory = resolve(directory), id = randomUUID(), path = sessionPath(id, sessionDirectory);
```

</details>

### 4. 处理本地查看与恢复命令，成功后把通知加入历史并保存

在上一节的 `src/ui/terminal.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/terminal.ts（CHANGED）</summary>

<!-- source: src/ui/terminal.ts -->
```diff
--- a/src/ui/terminal.ts
+++ b/src/ui/terminal.ts
@@ -1,5 +1,5 @@
 /**
- * 13.1 保存会话 | [KEEP] ui/terminal.ts
+ * 14.3 查看与恢复文件 | [CHANGED] ui/terminal.ts
  *
  * 学习目标：等本轮历史提交后保存会话；模型结果与磁盘保存结果分别报告。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -15,8 +15,8 @@
  *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
  *                                                             +-- 否 -> deny
  *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
- *   [CHANGED 13.1] 本轮 finally / reset / 有效 mode -> 白名单检查点 -> 等保存 -> stderr 反馈
- *   [CHANGED 13.1] 连续会话退出 -> 最后检查点；CLI 随后关闭 writer
+ *   [KEEP 来自 13.1] 本轮 finally / reset / 有效 mode -> 白名单检查点 -> 等保存 -> stderr 反馈
+ *   [KEEP 来自 13.1] 连续会话退出 -> 最后检查点；CLI 随后关闭 writer
  *
  * text 模式仍带终端标签，机器逐行解析使用另一个消费者 ui/jsonl.ts。
  * 两种输出模式使用相同的执行事件；本文件保持文本界面的交互审批，JSONL 不经过这里。
@@ -37,6 +37,7 @@
 import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
 import type { AgentEvent } from "../agent/events.js";
 import { explainError, UserFacingError } from "../errors.js";
+import { createFileCheckpointCommands } from "../sessions/file-checkpoints.js";
 import type { Message, Model, Reply } from "../models/client.js";
 import type { ApprovalHandler } from "../permissions/policy.js";
 import { formatTeachingTrace } from "./teaching-trace.js";
@@ -261,6 +262,8 @@
     const feedback = await saveSessionCheckpoint(writer, snapshot(), reason);
     if (feedback) { console.error(feedback.message); if (!feedback.ok) process.exitCode = 1; }
   };
+  // [CHANGED 14.3] 本地恢复命令串行执行，确认前不改文件。
+  const fileCommand = createFileCheckpointCommands(options.fileCheckpoints);
   const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
   const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
   const lines = createLineReader(input);
@@ -307,6 +310,12 @@
       const text = value.trim();
       if (!text) continue;
       if (text === "/exit") break;
+      // [CHANGED 14.3] 只在任务循环外处理文件恢复，不会与工具并发。
+      if (/^\/(changes|restore)(?:\s|$)/.test(text)) {
+        const result = await fileCommand(text); console.error(result.message);
+        if (result.restored) { history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
+        continue;
+      }
       if (handlePermissionCommand(text, sessionGrants)) continue;
       if (text === "/reset") {
         history.length = 0;
```

</details>

### 5. 在空闲时处理命令，等待文件恢复与通知保存结束后再接新任务

在上一节的 `src/ui/tui/app.tsx` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/ui/tui/app.tsx（CHANGED）</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 14.2 文件检查点 | [CHANGED] ui/tui/app.tsx
+ * 14.3 查看与恢复文件 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：在明确动作后保存会话白名单，并把任务状态与保存状态分别显示。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -51,7 +51,7 @@
 import { DraftEditor, newDraft, changeDraft } from "./editor.js";
 import { Transcript, runEntries, type Entry } from "./transcript.js";
 import { editExternally } from "./system-actions.js";
-import type { FileCheckpointStore } from "../../sessions/file-checkpoints.js";
+import { createFileCheckpointCommands, type FileCheckpointStore } from "../../sessions/file-checkpoints.js";
 import type { Message, Model } from "../../models/client.js";
 import { streamAgentRun } from "../../agent/run-stream.js";
 import { explainError } from "../../errors.js";
@@ -86,8 +86,10 @@
   closing: boolean;
   external?: { controller: AbortController; done: Promise<void> };
   // [KEEP 来自 13.1] writer 跨轮复用；保存反馈单独显示，不混入模型执行状态。
-  // [CHANGED 14.2] 会话长期持有检查点入口，组件重绘不重建。
+  // [KEEP 来自 14.2] 会话长期持有检查点入口，组件重绘不重建。
   fileCheckpoints?: FileCheckpointStore;
+  // [CHANGED 14.3] 预览计划属于会话，不随 React 重绘丢失。
+  fileCommand: ReturnType<typeof createFileCheckpointCommands>;
   writer?: SessionWriter;
   saveRequest: number;
   saveMessage: string;
@@ -279,6 +281,20 @@
     setDraft(newDraft());
     // 本地命令只改本地会话；它们不作为 user 消息送给模型。
     if (prompt === "/exit") { quit(0); return; }
+    // [CHANGED 14.3] 立即占用，直到恢复和通知保存完成才开放下一任务。
+    if (/^\/(changes|restore)(?:\s|$)/.test(prompt)) {
+      session.clearing = true; setNotice("正在核对文件检查点…");
+      session.done = (async () => {
+        try {
+          const result = await session.fileCommand(prompt);
+          if (!session.closing) append("本地", result.message);
+          if (result.restored) { session.history.push({ role: "user", content: `[本地文件恢复通知] ${result.message}` }); await checkpoint("file_restore"); }
+        } catch (error) {
+          if (!session.closing) append("本地", error instanceof Error ? error.message : "文件操作未完成，请核对目标。");
+        } finally { session.done = undefined; session.clearing = false; if (!session.closing) setNotice("文件操作已结束；Ctrl+O 可在历史区查看完整预览。"); }
+      })();
+      return;
+    }
     // [KEEP 来自 13.1] 清空后的模型历史进入检查点；授权不写入文件。
     if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); void checkpoint("reset"); return; }
     if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
@@ -299,7 +315,7 @@
    * 识别必须在空闲时本地处理的命令。
    * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
    */
-  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode)(?:\s|$)/.test(text);
+  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|changes|restore)(?:\s|$)/.test(text);
   /**
    * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
    * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
@@ -343,7 +359,7 @@
     const controller = new AbortController();

     // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
-    // [CHANGED 14.2] 本轮获批准的写入使用当前会话文件检查点。
+    // [KEEP 来自 14.2] 本轮获批准的写入使用当前会话文件检查点。
     const options = { fileCheckpoints: session.fileCheckpoints, mode: session.mode, tasks: session.tasks,
       // [KEEP 来自 12.3] 问答工具等待这次 Promise；key 重建面板，settled 与取消检查拒绝旧回调。
       askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
@@ -467,7 +483,7 @@
   // [KEEP 来自 13.3] 深拷贝可信快照，编号接着走；新一轮不能收取旧 run 的补充。
   const history = structuredClone([...(initial?.messages ?? [])]);
   const queue = initial ? { items: structuredClone([...initial.pendingInputs]), nextId: initial.nextInputId } : newInputQueue();
-  const session: Session = { mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
+  const session: Session = { mode: initialMode, tasks: { items: structuredClone([...(initial?.tasks ?? [])]) }, queue, clearing: false, history, prompts: history.filter((message) => message.role === "user").map((message) => message.content).slice(-100), run: initial?.run ?? 0, nextId: 0, grants: new Set(), closing: false, writer, fileCheckpoints, fileCommand: createFileCheckpointCommands(fileCheckpoints), saveRequest: 0, saveMessage: writer ? `会话 ${writer.id}${initial ? "，已恢复检查点" : "，尚无检查点"}` : "未启用会话保存" };
   let instance: ReturnType<typeof render> | undefined;
   // [KEEP 来自 13.1] 退出 Promise 只创建一次；保存和关闭都结束才恢复终端。
   let shutdown: Promise<void> | undefined;
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根目录编译并链接本节：

```bash
npm run lesson:14.3
```

进入加法演示工作区，恢复上一节保存了文件检查点的同一个会话。分支不会继承来源会话的文件检查点，因此这里不能改成另一个 ID。

```bash
cd docs/.work/ch13-typescript-demo
hello-my-agent --resume <保存文件检查点的完整会话UUID>
```

等待空闲后输入：

```text
/changes
```

选择 `src/add.ts` 的完整检查点 ID，先输入下面第一条命令查看差异，确认是撤回输入校验，再输入第二条。两条分两次提交。

```text
/restore <完整检查点UUID>
/restore <完整检查点UUID> confirm
```

第一条不应改文件。第二条成功后，`src/add.ts` 回到修改前内容，界面显示“已恢复文件”，历史增加本地恢复通知。随后输入：

```text
重新读取当前 src/add.ts，确认现在的函数约定，再运行 npm test，不要修改代码。
```

模型应依据重新读取的文件和这次测试结果回答，不能只重复恢复前“已有输入校验”的旧结论。再执行同一个恢复预览，应提示当前已经是修改前内容，无需恢复。

冲突、新增文件删除、预览后修改与同路径连续恢复都在[本章练习](/content/chapter-14-session-checkpoints/EXERCISES.md)中使用临时目录验证，不必为了实验反复修改演示项目。

## 本节完成后的 Agent

Agent 现在能列出受支持工具留下的文件检查点，预览一项恢复，并在当前文件仍符合条件时执行。新讨论、会话状态和工作区文件各有自己的变化范围；恢复成功通过本地通知进入后续上下文。任务继续变长后，这些历史和工具结果会一起占用模型请求，下一章开始计算并控制它们的上下文预算。
