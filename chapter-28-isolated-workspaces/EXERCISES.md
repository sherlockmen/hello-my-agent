# 第28章练习：怎样证明成果属于正确的目录与版本

[第28章首页](README.md) · [28.1 独立工作区](01-worktree-base/README.md) · [28.2 固定版本评审](02-versioned-review/README.md) · [28.3 整合与清理](03-integrate-and-cleanup/README.md)

三题沿用28.3完整实现，在脚本自己创建的临时Git仓库验证，不修改正式 `src/`。先回答每一步应该留下什么事实，再展开思路，最后运行完整答案。我们要核对文件与Git状态，不能仅以工具输出里出现“成功”作为证明。

## 练习1：两项任务从哪里开始，用户原有修改去了哪里

原目标分支已提交 `shared.txt`，随后用户把原目录里的该文件改成USER_DIRTY，另建尚未跟踪的 `untracked.txt`。现在创建两份任务工作区，并在各自目录建立同名 `task.txt`，分别写入TASK_A与TASK_B。

1. 两份任务的base SHA应该是哪条提交？任务能否看见USER_DIRTY和未跟踪文件？
2. 用路径、分支和文件内容分别写断言，怎样确认两项任务互不覆盖，同时原目录的内容仍在？
3. 新建另一个WorktreeManager后，用旧ID读取，应接管旧目录还是拒绝？

<details>
<summary>思路与预期事实</summary>

两份工作区都从创建时已提交的HEAD开始，base SHA相同；它们有不同的路径和任务分支。原目录中的USER_DIRTY与未跟踪文件不属于这个提交，不会自动复制。任务 `shared.txt` 仍是base内容，任务A、B的 `task.txt` 各自保留本题写入的值，原目录两份用户内容原样保留。

ID只属于创建它的管理器登记，新管理器应拒绝旧ID。磁盘上仍存在一个Git工作区，并不意味着任意新会话可以凭旧字符串恢复控制权。这个拒绝不会自动删除那个目录。

</details>

## 练习2：批准之后改变什么，会让旧评审失效

先在任务工作区提交TASK，再批准一次评审。接着依次做下面实验，每次按需要重新提交或重新评审后再继续。

1. 任务目录改了文件但尚未提交，旧评审有效吗？提交成为新SHA以后呢？
2. 已生成一份评审预览，等待批准时任务又产生新提交；执行这份旧预览应发生什么？
3. 任务不变，但目标分支新增提交，或者原目录多了未跟踪文件，能否沿用旧批准？

<details>
<summary>思路与预期事实</summary>

批准同时绑定当时目标SHA与任务SHA，并要求两边clean且没有未结束Git操作。任务dirty即失效，新提交改变任务SHA也失效。旧预览在执行前必须复查，不能因为diff已经显示过就直接保存一条针对旧版本的批准。

目标SHA移动同样失效，因为比较左端变了。目标未跟踪文件也使clean条件不成立，新的评审准备应拒绝，先由用户处理这些文件。检查 `reviewValid` 以及真实准备或执行调用是否拒绝，比只检查过去的批准记录是否仍存在更有意义；旧记录可以保留，当前资格不能沿用。

</details>

## 练习3：什么时候可以清理，冲突后又留下什么

任务新增一个成果文件并提交。先不整合就请求清理，然后评审并整合。整合成功后，分别在任务目录制造被忽略产物和未跟踪文件，再请求清理。

最后另建一个临时项目，让任务与目标分别修改同一行并提交，评审后尝试整合。

1. 为什么未整合的提交、ignored产物和未跟踪文件都应阻止清理？
2. 清理成功后，目录、登记状态和任务分支分别应是什么？怎样证明成果已经进入目标？
3. 真正发生merge冲突后，应保留哪些文件与状态，是否自动abort或删除任务目录？

<details>
<summary>思路与预期事实</summary>

未整合提交尚没有目标保存位置；ignored与未跟踪文件可能是没有其他副本的内容。清理不能用过去一次成功状态替代当前检查。本题先用 `git merge-base --is-ancestor` 验证任务当前HEAD已进入目标历史，再处理脚本自己生成的可重复产物，才清理目录。

成功后快照state为removed，工作目录与Git worktree登记消失，任务分支仍能用 `git show-ref` 找到。真实冲突则应返回isError，目标保留MERGE_HEAD与冲突标记，任务目录中的TASK_SIDE仍在；清理再次拒绝。程序不自动abort或reset，让模型与用户可以依据留下的现场决定后续操作。

完整答案在finally中移除的都是脚本自己创建的临时实验数据，包括故意制造的冲突；这是实验收尾，不是正式工具自动丢弃成果的能力。真实任务应由用户决定怎样保存或处理这些内容。

</details>

## 完整TypeScript答案

配套仓库已保存为 [examples/verify-worktrees.ts](examples/verify-worktrees.ts)。自己跟写时，在项目根建立 `examples/verify-worktrees.ts` 并保存下面完整代码。先编译28.3，再独立编译练习脚本；不需要配置模型密钥，也不需要联网。

```bash
npm run lesson:28.3
npx tsc chapter-28-isolated-workspaces/examples/verify-worktrees.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --outDir .exercise-dist/ch28
HMA_REPO="$PWD" node .exercise-dist/ch28/verify-worktrees.js all
```

自己跟写的项目把第二条的源码路径换成 `examples/verify-worktrees.ts`。第三条读取当前项目的dist，必须来自28.3。脚本给临时仓库设置本地Git提交身份，所有Git写入只针对它自己创建的项目。固定练习输入直接执行准备对象，用来验证管理器机制；正式Agent工具仍通过统一gate逐次取得用户批准。

```ts
/**
 * 第28章独立练习答案 | [NEW 练习] examples/verify-worktrees.ts
 * 学习目标：用真实临时Git仓库验证隔离、固定评审与保守清理。
 * 输入：1、2、3或all题号，已编译28.3模块路径；不调用模型。
 * 输出：断言成功文字；失败抛错。Git写入只发生在脚本自己创建的临时仓库。
 * 练习验证流程：选择题号 -> 创建临时仓库 -> 调用正式API -> 断言真实Git状态
 *   成功/失败 -> finally只清理本脚本临时现场；不修改正式src或课程仓库。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// [NEW 练习] 本文件以下实现均为独立验证代码；不改变正式工具能力。
type Snapshot = { id: string; path: string; branch: string; baseSha: string; headSha: string; targetSha: string; dirty: boolean; targetDirty: boolean; hasIgnored: boolean; reviewValid: boolean; targetOperation: string | null; state: string };
type Result = { content: string; isError?: boolean; metadata: { worktree: Snapshot } };
type Prepared = { preview: string; execute(signal: AbortSignal): Promise<Result> };
type Manager = { prepareCreate(signal?: AbortSignal): Promise<Prepared>; get(id: string): Promise<Snapshot>; prepareReview(id: string, signal?: AbortSignal): Promise<Prepared>; prepareIntegrate(id: string, signal?: AbortSignal): Promise<Prepared>; prepareRemove(id: string, signal?: AbortSignal): Promise<Prepared> };
const repo = process.env.HMA_REPO ?? process.cwd();
const dist = process.env.HMA_WORKTREES_DIST ?? path.join(repo, "dist");
const WorktreeManager: new (cwd: string) => Manager = (await import(pathToFileURL(path.join(dist, "workspaces/worktrees.js")).href)).WorktreeManager;
const ownedRoots = new Set<string>();
const freshSignal = (): AbortSignal => new AbortController().signal;

/** 只给固定练习参数；Git argv不经过shell，不fetch，也不操作当前课程仓库。 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
/** 建立脚本自己的Git实验仓库，给每组验证一个固定base。
 * 输入脚本临时根和组名，输出新仓库目录；固定本地身份且不fetch。
 * 初始化或提交失败向上抛错，main的finally清理实验现场。
 */
async function fixture(root: string, name: string): Promise<string> {
  const cwd = path.join(root, name); await mkdir(cwd);
  git(cwd, "init", "-b", "main"); git(cwd, "config", "user.name", "Exercise"); git(cwd, "config", "user.email", "exercise@example.invalid");
  await writeFile(path.join(cwd, "shared.txt"), "base\n"); await writeFile(path.join(cwd, ".gitignore"), "ignored/\n");
  git(cwd, "add", "--", "shared.txt", ".gitignore"); git(cwd, "commit", "-m", "base"); return cwd;
}
/** 执行固定练习输入对应的创建预览，并记住脚本自有目录。
 * 输入正式管理器，输出真实快照；正式产品中的用户审批由此处固定测试代替。
 * 创建没有成功就断言失败，不声称操作回滚。
 */
async function create(manager: Manager): Promise<Snapshot> {
  const prepared = await manager.prepareCreate(freshSignal());
  assert.match(prepared.preview, /base SHA/);
  // 脚本的固定测试输入代替人工审批；正式Agent仍必须经统一gate取得用户批准。
  const result = await prepared.execute(freshSignal()); assert.ok(!result.isError, result.content);
  ownedRoots.add(path.dirname(result.metadata.worktree.path)); return result.metadata.worktree;
}
/** 将本题指定文件保存成真实提交，便于比较SHA与包含关系。
 * 输入脚本自建仓库、固定内容和文件名，无返回值；失败保留给finally收尾。
 * Git参数独立传递，不接受模型提供的命令或路径。
 */
async function commit(cwd: string, content: string, name = "shared.txt"): Promise<void> {
  await writeFile(path.join(cwd, name), content); git(cwd, "add", "--", name); git(cwd, "commit", "-m", `save ${name}`);
}
/** 批准当前固定版本，并检查管理器确实记录有效状态。
 * 输入管理器和本组生成的ID，无返回值；失效预览或Git读取失败会抛错。
 * 此断言只验证版本批准机制，不代表项目测试已经通过。
 */
async function approve(manager: Manager, id: string): Promise<void> {
  const prepared = await manager.prepareReview(id, freshSignal()); assert.match(prepared.preview, /比较左端/); assert.match(prepared.preview, /被审SHA/);
  assert.ok(!(await prepared.execute(freshSignal())).isError); assert.equal((await manager.get(id)).reviewValid, true);
}

/** 两个任务从同一base开始，用户已有文件和每个任务的内容各留在原处。 */
async function isolation(root: string): Promise<void> {
  const cwd = await fixture(root, "isolation"), manager = new WorktreeManager(cwd), base = git(cwd, "rev-parse", "HEAD");
  await writeFile(path.join(cwd, "shared.txt"), "USER_DIRTY\n"); await writeFile(path.join(cwd, "untracked.txt"), "USER_UNTRACKED\n");
  const first = await create(manager), second = await create(manager);
  assert.equal(first.baseSha, base); assert.equal(second.baseSha, base); assert.notEqual(first.path, second.path); assert.notEqual(first.branch, second.branch);
  await writeFile(path.join(first.path, "task.txt"), "TASK_A\n"); await writeFile(path.join(second.path, "task.txt"), "TASK_B\n");
  assert.equal(await readFile(path.join(cwd, "shared.txt"), "utf8"), "USER_DIRTY\n"); assert.equal(await readFile(path.join(cwd, "untracked.txt"), "utf8"), "USER_UNTRACKED\n");
  assert.equal(await readFile(path.join(first.path, "shared.txt"), "utf8"), "base\n"); assert.equal(await readFile(path.join(first.path, "task.txt"), "utf8"), "TASK_A\n");
  assert.equal(await readFile(path.join(second.path, "task.txt"), "utf8"), "TASK_B\n");
  await assert.rejects(new WorktreeManager(cwd).get(first.id), /未知WorktreeID/);
  console.log("练习1通过：两任务隔离、固定base、原dirty与未跟踪文件保留、跨管理器ID拒绝。");
}

/** 固定比较双方；任务或目标改版、出现dirty时都不能沿用旧批准。 */
async function versions(root: string): Promise<void> {
  const cwd = await fixture(root, "versions"), manager = new WorktreeManager(cwd), task = await create(manager);
  await commit(task.path, "TASK\n"); await approve(manager, task.id);
  await writeFile(path.join(task.path, "shared.txt"), "DIRTY\n"); assert.equal((await manager.get(task.id)).reviewValid, false);
  await commit(task.path, "TASK_V2\n"); await approve(manager, task.id);
  const pending = await manager.prepareReview(task.id, freshSignal()); await commit(task.path, "TASK_V3\n");
  await assert.rejects(pending.execute(freshSignal()), /失效/); assert.equal((await manager.get(task.id)).reviewValid, false);
  await approve(manager, task.id); await commit(cwd, "TARGET_MOVED\n", "target.txt"); assert.equal((await manager.get(task.id)).reviewValid, false);
  await approve(manager, task.id); await writeFile(path.join(cwd, "new-untracked.txt"), "USER\n"); assert.equal((await manager.get(task.id)).reviewValid, false);
  await assert.rejects(manager.prepareReview(task.id, freshSignal()), /clean/);
  console.log("练习2通过：任务SHA、目标SHA或dirty变化使旧评审失效，审批等待期间改版也被拒绝。");
}

/** 成功整合才可清理；冲突、未整合提交、dirty与ignored都保留。 */
async function integration(root: string): Promise<void> {
  const cwd = await fixture(root, "integration"), manager = new WorktreeManager(cwd), task = await create(manager);
  await commit(task.path, "NEW_RESULT\n", "result.txt"); await assert.rejects(manager.prepareRemove(task.id, freshSignal()), /尚未包含/);
  await approve(manager, task.id); const merged = await (await manager.prepareIntegrate(task.id, freshSignal())).execute(freshSignal()); assert.ok(!merged.isError, merged.content);
  git(cwd, "merge-base", "--is-ancestor", git(task.path, "rev-parse", "HEAD"), "HEAD");
  await mkdir(path.join(task.path, "ignored")); await writeFile(path.join(task.path, "ignored", "artifact.txt"), "KEEP\n");
  assert.equal((await manager.get(task.id)).hasIgnored, true); await assert.rejects(manager.prepareRemove(task.id, freshSignal()), /ignored/);
  // 这是脚本自己创建的可重复产物；真实任务应由用户决定如何保存，工具没有自动丢弃入口。
  await rm(path.join(task.path, "ignored"), { recursive: true }); await writeFile(path.join(task.path, "unsaved.txt"), "KEEP\n");
  await assert.rejects(manager.prepareRemove(task.id, freshSignal()), /未保存/); await rm(path.join(task.path, "unsaved.txt"));
  assert.ok(!(await (await manager.prepareRemove(task.id, freshSignal())).execute(freshSignal())).isError);
  assert.equal((await manager.get(task.id)).state, "removed"); git(cwd, "show-ref", "--verify", `refs/heads/${task.branch}`);
  const conflictCwd = await fixture(root, "conflict"), conflicts = new WorktreeManager(conflictCwd), candidate = await create(conflicts);
  await commit(candidate.path, "TASK_SIDE\n"); await commit(conflictCwd, "TARGET_SIDE\n"); await approve(conflicts, candidate.id);
  const conflict = await (await conflicts.prepareIntegrate(candidate.id, freshSignal())).execute(freshSignal());
  assert.equal(conflict.isError, true); assert.equal((await conflicts.get(candidate.id)).targetOperation, "MERGE_HEAD");
  assert.match(await readFile(path.join(conflictCwd, "shared.txt"), "utf8"), /<<<<<<</); assert.equal(await readFile(path.join(candidate.path, "shared.txt"), "utf8"), "TASK_SIDE\n");
  await assert.rejects(conflicts.prepareRemove(candidate.id, freshSignal()), /冲突/);
  console.log("练习3通过：成功整合再清理、未整合/dirty/ignored拒绝、任务分支与真实冲突现场保留。");
}

/** 只清理脚本自己创建的临时实验现场；生产管理器没有递归删除或自动abort入口。 */
async function main(): Promise<void> {
  const group = process.argv[2] ?? "all"; assert.ok(["1", "2", "3", "all"].includes(group), "题号只能是1、2、3或all");
  const root = await mkdtemp(path.join(tmpdir(), "hma-worktree-exercises-"));
  try {
    if (group === "1" || group === "all") await isolation(root);
    if (group === "2" || group === "all") await versions(root);
    if (group === "3" || group === "all") await integration(root);
  } finally {
    for (const directory of ownedRoots) { assert.match(directory, /hello-agent-worktrees-[^/]+$/); await rm(directory, { recursive: true, force: true }); }
    await rm(root, { recursive: true, force: true });
  }
}
await main();
```

也可以把all换成1、2、3，只运行对应一题。完整运行后应看到三组“通过”：

```text
练习1通过：两任务隔离、固定base、原dirty与未跟踪文件保留、跨管理器ID拒绝。
练习2通过：任务SHA、目标SHA或dirty变化使旧评审失效，审批等待期间改版也被拒绝。
练习3通过：成功整合再清理、未整合/dirty/ignored拒绝、任务分支与真实冲突现场保留。
```

这些断言证明了本题构造条件下的目录、版本和清理约束，没有替代任务项目的功能测试。真正交付时仍需把被审版本、整合结果、所运行测试和遗留目录分别说明。
