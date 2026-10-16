# 28.2 评审固定版本：批准的是哪两条提交之间的变化

[第 28 章首页](/content/chapter-28-isolated-workspaces/README.md) · [上一节：28.1 独立工作区](/content/chapter-28-isolated-workspaces/01-worktree-base/README.md) · [本章练习与答案](/content/chapter-28-isolated-workspaces/EXERCISES.md)

任务工作区已经提交了登录修复。用户刚看完差异，Agent又在任务分支补了一次修改；或者另一位同事让目标分支前进了一个提交。若整合时只记住“这个任务已经批准”，实际进入目标分支的内容就可能与用户看过的不同。

本节把一次批准绑定到两条确定的提交：评审当时的目标SHA，以及任务SHA。前者固定比较起点，后者固定候选成果。批准之后只要任意一端变化，原批准就失效；必须重新展示当前差异。

## 为什么最初base SHA还不够

28.1记录的base SHA说明任务从哪里开始。假设它是B，任务后来提交T，而目标分支已经从B前进到M。B仍然是任务的历史起点，却已经不能代表原目标目录的当前内容。

评审要回答“现在目标版本与候选任务版本的文件有什么差别”，因此本节比较M与T这两个端点，保留B用于解释来源。它使用两端提交的文件树差异，不把“从base以后有哪些任务提交”当作当前完整差异。目标分支后来增加的内容也可能体现在两端比较中，用户需要看清这些变化，再判断是否适合整合。

举一个具体例子：base B已有 `login.ts`，目标M后来新增 `release-note.md`，任务T只修改了 `login.ts`，没有目标M新增的文档。直接比较M与T的文件树，会同时显示登录修改，以及 `release-note.md` 在T里不存在，呈现为一项删除。它描述两个端点的差别，不表示任务在B之后主动删过这份文档。

Git真正合并时还会看共同祖先B：文档只在目标一侧新增，任务并未从B删除它，因此这个没有其他冲突的例子里，合并结果保留目标文档，同时带入任务的登录修改。预览M→T不是最终合并效果的预测；评审固定的是候选版本与比较依据，真实合并结果仍须在28.3检查。

## 为何两边都要先提交并保持干净

SHA只标识已经提交的文件树，不能代表目录里的未提交内容。如果任务目录已改了文件却没有提交，用户看着任务目录会以为那段代码也在候选版本里，实际T却没有它；如果目标目录有未提交修改，合并还可能碰到用户的本地工作。

因此评审前先要求两边clean，包含没有未跟踪文件，并且没有未结束的merge、rebase或cherry-pick等Git操作。仅看 `git status --porcelain` 是否为空还不够：某次合并已经解决冲突并暂存完，也可能仍在等待最终提交。未结束操作会改变下一条Git命令的含义，要先完成或人工处理，再评审。

任务当前提交还必须包含原base，目标当前分支也必须仍是创建时记录的目标分支。这些条件让任务来历与交付方向都能核对。原目录在28.1允许dirty地创建任务，不代表到评审时仍可以跳过提交整理。

## 一次批准怎样被保存，又怎样过期

`review_worktree`接收 `{ "worktree_id": "返回的UUID" }`。准备评审时先取得两端SHA与完整差异，生成含仓库、路径、分支、版本及diff的预览。Git查询有期限与输出上限；若差异因超时或输出过多未完整取得，就拒绝提供可批准预览，不能用被截断的差异代表完整候选。用户批准后，执行阶段再次检查两端版本、clean与Git操作状态。只有事实仍与预览一致，才保存本次批准记录；检查期间变化，就返回错误并要求重新评审。

记录包含目标SHA、任务SHA、差异的SHA-256摘要与批准时间。摘要用于标识这份差异内容，不能代替人工理解，也不能证明代码正确。当前快照里的 `reviewValid` 是拿当前事实重新比较得到的结果：任何一端SHA移动、目录出现未提交变化、目标切换分支或出现未结束Git操作，原记录都会失效。

所以“曾经批准过”与“现在仍能使用这份批准”是两件事。旧记录保留历史依据，最新有效性决定能否继续整合。模型每次读到快照后，应依据当前有效性决定重新评审或继续，而不是把曾经成功的文字当成永久许可。

## 评审结果怎样进入下一步

`review_worktree`同样经过逐次审批。成功结果把确定的两端版本、摘要、时间和当前快照交回原callID，模型才知道这次批准针对什么。拒绝、dirty、版本变化等情况形成错误观察，模型应先解释或整理状态，再申请新的评审。

评审批准不等于测试通过。测试需要在明确目录实际执行，查看退出码与输出；如果评审后又为修测试产生新提交，候选任务SHA变了，就要重新评审。这样测试报告、批准版本和最终整合都能各自找到依据，避免用一句“已检查”替代三种不同的事实。

<!-- media:lesson:start -->
下面把批准绑定在目标M和任务T两个确定提交上，再演示任务变成T2后旧评审失效。release-note.md用于区分端点比较与三方合并：端点diff显示删除，不代表最终merge会删除它；评审也不替代功能测试。

<img src="./content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-cover-f83129ebf9.png" data-gif-src="./content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-9f09250987.gif" data-cover="./content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-cover-f83129ebf9.png" data-no-zoom alt="批准了差异，怎样防止整合另一版代码？">

[静态流程图](/content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-flow-6aaaa71788.png.md) · [静态封面](/content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-cover-f83129ebf9.png.md) · [查看完整静态分镜](/content/chapter-28-isolated-workspaces/02-versioned-review/assets/worktree-versioned-review-storyboard-a1ea4ffa1a.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/workspaces/worktrees.ts](/content/chapter-28-isolated-workspaces/02-versioned-review/src/workspaces/worktrees.ts.md) | 检查双方提交与clean状态，固定完整差异和两端SHA，批准后再核对并计算当前有效性。 |
| CHANGED | [src/tools/worktree-tools.ts](/content/chapter-28-isolated-workspaces/02-versioned-review/src/tools/worktree-tools.ts.md) | 增加逐次审批的版本评审工具，并解释批准不代表测试通过。 |
| CHANGED | [src/ui/teaching-trace.ts](/content/chapter-28-isolated-workspaces/02-versioned-review/src/ui/teaching-trace.ts.md) | 显示被审任务SHA及当前评审有效性。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 28.1 的完整 `src/` 继续。本节目标目录是 `chapter-28-isolated-workspaces/02-versioned-review`。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/workspaces/worktrees.ts 的精确差异</summary>

<!-- source: src/workspaces/worktrees.ts -->
```diff
--- a/src/workspaces/worktrees.ts
+++ b/src/workspaces/worktrees.ts
@@ -1,29 +1,31 @@
 /**
- * 28.1 独立工作区 | [NEW] workspaces/worktrees.ts
- * 学习目标：从固定base创建会话自有Git worktree，让结果返回真实身份。
+ * 28.2 固定评审版本 | [CHANGED] workspaces/worktrees.ts
+ * 学习目标：把会话自有目录、起始提交、被审版本和真实整合结果连起来。
  * 输入：本地启动目录、本管理器生成的ID、取消信号；不接受任意目录或分支。
  * 输出：身份快照或固定预览/执行闭包；Git失败保留目录、分支与冲突，不自动回滚。
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
  *   创建 -> 固定目标branch/HEAD -> 审批 -> 复查 -> git worktree add -> 登记实际状态
- *   命令 -> 预览自有目录/完整命令 -> 审批 -> 复查身份 -> 执行 -> 最新状态回模型
- * 观察：dirty/untracked/ignored留在原处；自有工作区不等于安全沙箱。
+ *   评审 -> 两端clean？-- 否 -> 拒绝；是 -> 固定diff/SHA -> 审批 -> 复查 -> 记录版本
+ * 观察：固定比较双方SHA和完整diff；目标或任务改变后旧review失效，批准不证明测试通过。
  * shortcut: 登记只存当前CLI内存，重启后须按Git事实人工恢复；不把worktree当安全沙箱。
  */
 import { lstat, mkdtemp, realpath } from "node:fs/promises";
 import { join, resolve } from "node:path";
 import { tmpdir } from "node:os";
-import { randomUUID } from "node:crypto";
+import { createHash, randomUUID } from "node:crypto";
 import { ToolError } from "../errors.js";
 import { runProcess, type ProcessResult } from "../processes/run-process.js";
 import { prepareRunCommand } from "../tools/run-command.js";
 import type { PreparedToolCall, ToolExecutionResult } from "../tools/types.js";

-// [NEW 28.1] 本文件以下实现均为本节新增；ID和分支由本实例生成，路径只从本地登记表取得。
+// [KEEP 来自 28.1] ID和分支由本实例生成，路径只从本地登记表取得。
+// [NEW 28.2] 记录评审比较双方和预览摘要，不存可复用执行授权。
+export type WorktreeReview = { targetSha: string; reviewedSha: string; diffSha256: string; approvedAt: string };
 export type WorktreeSnapshot = {
   id: string; path: string; repository: string; commonDirectory: string; branch: string;
   baseSha: string; targetBranch: string; currentTargetBranch: string; headSha: string | null; targetSha: string | null;
   dirty: boolean; hasIgnored: boolean; targetDirty: boolean; operation: string | null; targetOperation: string | null; state: "creating" | "ready" | "failed" | "removed";
-  failure?: string;
+  review: WorktreeReview | null; reviewValid: boolean; failure?: string;
 };
 type Entry = { snapshot: WorktreeSnapshot };
 type Origin = { repository: string; commonDirectory: string; branch: string; sha: string; dirty: boolean; operation: string | null };
@@ -149,6 +151,9 @@
       value.dirty = await dirty(value.path, signal); value.targetDirty = target.dirty;
       value.hasIgnored = Boolean(await checked(value.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], signal));
       value.operation = await operation(value.path, signal); value.targetOperation = target.operation;
+      // [NEW 28.2] 任一端SHA、dirty或未结束Git操作变化后，旧评审不能用于整合。
+      value.reviewValid = Boolean(value.review && !value.dirty && !value.targetDirty && !value.operation && !value.targetOperation && target.branch === value.targetBranch
+        && value.review.reviewedSha === value.headSha && value.review.targetSha === value.targetSha);
     }
     return structuredClone(value);
   }
@@ -163,7 +168,7 @@
       this.directory ??= await realpath(await mkdtemp(join(tmpdir(), "hello-agent-worktrees-")));
       const value: WorktreeSnapshot = { id, path: join(this.directory, id), repository: before.repository, commonDirectory: before.commonDirectory,
         branch: taskBranch, baseSha: before.sha, targetBranch: before.branch, currentTargetBranch: current.branch, headSha: null, targetSha: before.sha, dirty: false, hasIgnored: false, operation: null, targetOperation: current.operation,
-        targetDirty: current.dirty, state: "creating" };
+        targetDirty: current.dirty, state: "creating", review: null, reviewValid: false };
       const entry: Entry = { snapshot: value }; this.entries.set(id, entry);
       try {
         await checked(value.repository, ["worktree", "add", "-b", taskBranch, "--", value.path, value.baseSha], executionSignal);
@@ -181,8 +186,26 @@
     const prepared = await prepareRunCommand(argumentsJson, entry.snapshot.path, signal);
     return once(`WorktreeID：${id}\n任务分支：${entry.snapshot.branch}\nbase SHA：${entry.snapshot.baseSha}\n${prepared.preview}\n命令仍可能访问工作区外的文件/网络；请核对完整命令。`, executionSignal => this.exclusive(async () => {
       await this.verify(entry, executionSignal);
+      entry.snapshot.reviewValid = false;
       const result = await prepared.execute(executionSignal);
       return worktreeResult(await this.inspect(entry, executionSignal), result.content, Boolean(result.isError));
     }));
   }
-}
+  // [NEW 28.2] 评审固定比较双方；完整diff无法取得就不提供可批准预览。
+  async prepareReview(id: string, signal?: AbortSignal): Promise<PreparedToolCall> {
+    const entry = this.entry(id), before = await this.get(id, signal);
+    if (before.dirty || before.targetDirty || before.operation || before.targetOperation || before.state !== "ready") throw new ToolError("评审需要任务与目标目录都clean（包括未跟踪文件）且没有未结束Git操作，先保存成果再请求。");
+    const target = await origin(before.repository, signal);
+    if (target.branch !== before.targetBranch) throw new ToolError("目标分支已切换，请回原目标分支后重新评审。");
+    const ancestry = await git(before.path, ["merge-base", "--is-ancestor", before.baseSha, before.headSha!], signal);
+    if (ancestry.exitCode !== 0 || ancestry.stopReason || ancestry.signal) throw new ToolError("任务HEAD已不包含固定base，拒绝评审。");
+    const diff = await checked(before.path, ["diff", "--no-ext-diff", "--no-textconv", "--binary", before.targetSha!, before.headSha!, "--"], signal);
+    const digest = createHash("sha256").update(diff).digest("hex");
+    return once(`批准固定版本评审\nWorktreeID：${id}\n目录：${before.path}\nbase：${before.baseSha}\n比较左端（目标${before.targetBranch}）：${before.targetSha}\n比较右端/被审SHA：${before.headSha}\ndiff SHA256：${digest}\n批准只记录本版可整合候选，不代表测试通过；整合还会再次审批。\n${diff || "（无差异）"}`, executionSignal => this.exclusive(async () => {
+      const now = await this.inspect(entry, executionSignal), currentTarget = await origin(before.repository, executionSignal);
+      if (now.headSha !== before.headSha || now.targetSha !== before.targetSha || now.dirty || now.targetDirty || now.operation || now.targetOperation || currentTarget.branch !== before.targetBranch) throw new ToolError("评审等待期间代码或目标状态变化，旧预览已失效，请重新评审。");
+      entry.snapshot.review = { targetSha: before.targetSha!, reviewedSha: before.headSha!, diffSha256: digest, approvedAt: new Date().toISOString() };
+      return worktreeResult(await this.inspect(entry, executionSignal), "已批准固定版本；后续代码或目标变化将使批准失效。");
+    }));
+  }
+}
```

</details>

<details>
<summary>CHANGED：src/tools/worktree-tools.ts 的精确差异</summary>

<!-- source: src/tools/worktree-tools.ts -->
```diff
--- a/src/tools/worktree-tools.ts
+++ b/src/tools/worktree-tools.ts
@@ -1,18 +1,18 @@
 /**
- * 28.1 独立工作区 | [NEW] tools/worktree-tools.ts
+ * 28.2 固定评审版本 | [CHANGED] tools/worktree-tools.ts
  * 学习目标：让模型取得真实工作区身份，所有修改仍走统一逐次审批。
  * 输入：严格JSON对象和当前CLI持有的管理器；不接受任意path、branch或伪造ID。
  * 输出：只读快照，或固定预览/execute；失败回到Agent Loop形成工具错误，不自动清冲突。
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
  *   JSON/字段/ID有效？-- 否 -> ToolError；是 -> 当前会话manager -> 只读或prepare
  *   prepare -> 统一审批 -> execute；模型从content、界面从metadata取得同一身份。
- * 观察：Plan和只读child没有副作用入口；命令明确显示自有目录，结果返回当前分支与dirty状态。
+ * 观察：Plan和只读child没有副作用入口；命令明确显示自有目录，修改后review失效。
  */
 import { ToolError } from "../errors.js";
 import { WorktreeManager, worktreeResult } from "../workspaces/worktrees.js";
 import type { PreparedToolCall, ToolDefinition, ToolExecutionResult } from "./types.js";

-// [NEW 28.1] 本文件以下实现均为本节新增； 模型只能引用管理器返回的UUID，不能指定任意worktree目录。
+// [KEEP 来自 28.1] 模型只能引用管理器返回的UUID，不能指定任意worktree目录。
 const idProperty = { type: "string", description: "本次CLI创建的WorktreeID" };
 /** 构造模型可见的严格工作区工具Schema。
  * 输入本地工具名、说明、附加字段和ID要求，输出ToolDefinition。
@@ -23,10 +23,12 @@
 }
 export const worktreeDefinitions: ToolDefinition[] = [
   definition("create_worktree", "逐次批准后从当前HEAD创建自有独立Git worktree；原目录dirty不复制。返回WorktreeID、base/branch和真实目录；不是安全sandbox。", {}, false),
-  definition("read_worktree", "只读当前CLI自有工作区状态；省略ID列出登记。返回base、当前/目标SHA和dirty状态，不导入旧会话路径。", {}, false),
+  definition("read_worktree", "只读当前CLI自有工作区状态；省略ID列出登记。返回base、当前/目标/被审SHA和评审是否失效，不导入旧会话路径。", {}, false),
   definition("run_worktree_command", "逐次批准后在自有工作区执行读/改/测/提交命令；命令仍可访问别处，不是安全sandbox。结果同时返回最新身份和状态。", { command: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 60_000 } }),
+  // [NEW 28.2] 批准固定比较双方；不是模型自报review通过。
+  definition("review_worktree", "预览完整diff并逐次批准目标SHA与任务SHA；两边clean且无未结束Git操作才可评审，修改后失效。批准不证明测试通过。"),
 ];
-// [NEW 28.1] 工具定义与副作用gate共享同一集合。
+// [KEEP 来自 28.1] 工具定义与副作用gate共享同一集合。
 export const worktreeMutations = new Set(worktreeDefinitions.filter(tool => tool.name !== "read_worktree").map(tool => tool.name));
 /** 校验模型参数，不让路径或分支冒充当前CLI登记身份。
  * 输入工具名和JSON，输出已检查的普通对象；格式、未知字段或UUID不符抛ToolError。
@@ -66,5 +68,6 @@
   signal.throwIfAborted(); const input = parse(name, json), own = manager(worktrees), id = input.worktree_id as string;
   if (name === "create_worktree") return own.prepareCreate(signal);
   if (name === "run_worktree_command") return own.prepareCommand(id, JSON.stringify({ command: input.command, cwd: ".", ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {}) }), signal);
+  if (name === "review_worktree") return own.prepareReview(id, signal);
   throw new ToolError(`未知工作区操作：${name}`);
 }
```

</details>

<details>
<summary>CHANGED：src/ui/teaching-trace.ts 的精确差异</summary>

<!-- source: src/ui/teaching-trace.ts -->
```diff
--- a/src/ui/teaching-trace.ts
+++ b/src/ui/teaching-trace.ts
@@ -1,7 +1,7 @@
 /**
- * 28.1 独立工作区 | [CHANGED] ui/teaching-trace.ts
- *
- * 学习目标：从工具元数据展示作业、调度与工作区事实，摘要不代替交给模型的完整观察。
+ * 28.2 固定评审版本 | [CHANGED] ui/teaching-trace.ts
+ *
+ * 学习目标：展示工作区比较双方的固定版本与当前评审有效性，使过期批准可见。
  * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
  * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
  *
@@ -93,10 +93,11 @@
   // [KEEP 来自 19.3] 来源与版本直接来自结构化结果；资源正文仍回原工具消息。
   // [KEEP 来自 21.1] 来源取真实映射，正文仍显示在工具详情。
   // [KEEP 来自 22.1] 界面来源来自结构化真实响应，不从网页正文猜测。
-  // [NEW 28.1] 直接显示结构化Git身份；控制字符仍只影响显示副本。
+  // [KEEP 来自 28.1] 直接显示结构化Git身份；控制字符仍只影响显示副本。
+  // [NEW 28.2] 比较目标、当前HEAD与被审SHA，明确旧批准是否仍有效。
   if (metadata.kind === "worktree") {
     const item = metadata.worktree;
-    return item ? `WorktreeID ${toTraceText(item.id, 36)}；${item.state}；目录 ${toTraceText(item.path, 200)}；分支 ${toTraceText(item.branch, 100)}；base ${item.baseSha}；HEAD ${item.headSha ?? "未知"}；目标 ${toTraceText(item.currentTargetBranch, 100)}@${item.targetSha ?? "未知"}；dirty ${item.dirty} / 目标dirty ${item.targetDirty}` : "当前CLI工作区登记列表";
+    return item ? `WorktreeID ${toTraceText(item.id, 36)}；${item.state}；目录 ${toTraceText(item.path, 200)}；分支 ${toTraceText(item.branch, 100)}；base ${item.baseSha}；HEAD ${item.headSha ?? "未知"}；目标 ${toTraceText(item.currentTargetBranch, 100)}@${item.targetSha ?? "未知"}；dirty ${item.dirty} / 目标dirty ${item.targetDirty}；被审SHA ${item.review?.reviewedSha ?? "无"}；批准有效 ${item.reviewValid}` : "当前CLI工作区登记列表";
   }
   if (metadata.kind === "subagent") return `子任务 ${metadata.result.role}：${metadata.result.status}；会话 ${metadata.result.sessionId}`;
   if (metadata.kind === "web") return `网页 ${metadata.sources.length} 个来源 · ${metadata.bytes} 字节${metadata.truncated ? " · 文本截断" : ""}`;
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:28.2
```

下面在临时仓库验证批准失效。先批准任务版本，再在另一个评审等待期间提交新版本；旧执行闭包必须拒绝。重新批准后移动目标SHA，当前有效性也必须变为false。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { WorktreeManager } from './dist/workspaces/worktrees.js';
const root = await mkdtemp(join(tmpdir(), 'worktree-review-')), owned = new Set();
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgSign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const signal = () => new AbortController().signal;
const save = async (cwd, content, file = 'shared.txt') => {
  await writeFile(join(cwd, file), content); git(cwd, 'add', '--', file);
  git(cwd, 'commit', '-m', 'save');
};
try {
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Probe');
  git(root, 'config', 'user.email', 'probe@example.invalid');
  await save(root, 'BASE\n'); const manager = new WorktreeManager(root);
  const created = await (await manager.prepareCreate(signal())).execute(signal());
  assert.ok(!created.isError, created.content);
  const task = created.metadata.worktree; owned.add(dirname(task.path));
  await save(task.path, 'TASK_V1\n');
  const approved = await (await manager.prepareReview(task.id, signal())).execute(signal());
  assert.ok(!approved.isError); assert.equal((await manager.get(task.id)).reviewValid, true);
  const waiting = await manager.prepareReview(task.id, signal());
  await save(task.path, 'TASK_V2\n');
  await assert.rejects(waiting.execute(signal()), /失效/);
  assert.equal((await manager.get(task.id)).reviewValid, false);
  await (await manager.prepareReview(task.id, signal())).execute(signal());
  await save(root, 'TARGET_ADVANCED\n', 'target.txt');
  assert.equal((await manager.get(task.id)).reviewValid, false);
  console.log('通过：批准绑定双方SHA，等待期间改版拒绝，目标前进使批准失效。');
} finally {
  for (const directory of owned) await rm(directory, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
NODE
```

这份探针直接检查实际提交与快照，没有靠模型自称“已评审”。测试清理只针对它自己创建的临时现场。正式操作中，用户看到的完整diff、两端SHA与当次批准才构成评审依据；修改后重新请求 `review_worktree`。

配套仓库另外检查两边dirty与未跟踪文件、目标分支变化、任务不再包含base、clean但仍在merge中的状态，以及diff不完整时拒绝评审。

```bash
LESSON_28=02-versioned-review node tests/verify-chapter-28.mjs
```

## 本节完成后的 Agent

批准现在明确绑定目标与任务的固定版本；状态变化使旧记录失效，模型需要重新取得当前观察与批准。下一节才尝试把仍有效的候选提交整合回原目标，并在确认成果保存后清理目录。

本节状态：待用户确认。
