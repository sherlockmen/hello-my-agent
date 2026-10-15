# 第 14 章练习与答案

[第 14 章首页](/content/chapter-14-session-checkpoints/README.md) · [14.3 查看改动并按条件恢复](/content/chapter-14-session-checkpoints/03-review-and-restore/README.md)

这些练习核对会话和文件的变化，不调用模型。先在仓库根目录编译本章最后一节；下面的 Node.js 示例也都从仓库根目录运行，导入刚编译的 `dist/`。

```bash
npm run lesson:14.3
```

每段程序创建并清理自己的临时目录。不要把练习路径换成真实项目文件。本章练习没有另一份产品 `src/` 增量，下一章继续使用 14.3 的完整源码。

## 练习一：分支以后，哪份内容会变

先预测：来源会话有一条消息、一项任务和一条未交付补充。建立分支后，来源 JSONL 会增加来源标记吗？未交付补充会变成 user 消息吗？修改分支里的状态，会不会修改来源文件？

<details>
<summary>答案与可执行验证</summary>

来源字节保持原样；来源关系写在新会话头。队列仍是队列，不会在建立分支时交付。新 writer 保存到新文件，分支的后续消息不会追加到来源。

下面直接调用会话模块，把模型和 TUI 排除在实验之外。`process.chdir()` 只为让会话头记录临时工作区；它不运行历史工具。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionWriter } from './dist/sessions/save-session.js';
import { readSession } from './dist/sessions/read-session.js';
import { forkSessionWriter } from './dist/sessions/fork-session.js';

const previous = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'agent-fork-exercise-'));
let source, branch;
try {
  const workspace = join(temporary, 'project');
  await mkdir(workspace);
  process.chdir(workspace);
  const directory = join(temporary, 'sessions');
  source = await createSessionWriter(directory);
  const state = {
    messages: [{ role: 'user', content: '检查负数与零相加' }],
    mode: 'execute',
    tasks: [{ id: 'tests', text: '检查测试', status: 'completed' }],
    pendingInputs: [{ id: 1, text: '补测正负混合', run: 1 }],
    run: 1, nextInputId: 2,
  };
  await source.save(state, 'exit');
  await source.close();
  const original = await readFile(source.path);
  const last = await readSession(source.id, directory);
  branch = await forkSessionWriter(source.id, directory);
  assert.notEqual(branch.id, source.id);
  assert.deepEqual(branch.restored.header.parent, { sessionId: source.id, seq: last.seq });
  assert.deepEqual(branch.restored.state.pendingInputs, state.pendingInputs);
  assert.equal(branch.restored.state.messages.length, 1);
  await branch.save({ ...state, messages: [...state.messages,
    { role: 'user', content: '另试 NaN 校验方案' }] }, 'exit');
  assert.deepEqual(await readFile(source.path), original);
  console.log('通过：新身份、来源关系、队列未交付，来源字节未变。');
} finally {
  await branch?.close();
  await source?.close();
  process.chdir(previous);
  await rm(temporary, { recursive: true, force: true });
}
JS
```

这只能证明复制状态与文件身份的关系。分支是否隔离代码文件，可以直接从接口判断：函数没有复制工作区目录的操作，不能用新会话 ID 推断文件有了独立副本。

</details>

## 练习二：同一文件 A→B→C，先恢复哪一项

两次文件写入分别保存 cp1：A→B、cp2：B→C。当前文件是 C。先恢复 cp1 会怎样？看过 cp2 的预览后，人把文件改成 D，再确认会怎样？新增文件的 `before` 为什么不能写成空字符串？

<details>
<summary>答案与可执行验证</summary>

cp1 期待当前是 B，因此当前 C 会冲突。预览 cp2 后改成 D，确认时第二次全文比较也会冲突，D 保持原样。先把实验文件恢复为 C，再重新预览 cp2，才可以 C→B；之后 cp1 才满足条件。`before: null` 表示之前不存在，恢复要删除；空字符串表示之前有一个空文件，恢复应保留它。

下面手动执行“保存记录后写入”来固定 A、B、C，不依赖模型选择工具。实验只调用恢复模块，不代表正式文件工具可以绕过审批。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileCheckpointStore, prepareFileRestore } from './dist/sessions/file-checkpoints.js';

const temporary = await mkdtemp(join(tmpdir(), 'agent-restore-exercise-'));
try {
  const workspace = join(temporary, 'project');
  await mkdir(workspace);
  const target = join(workspace, 'add.ts');
  const store = createFileCheckpointStore(randomUUID(), join(temporary, 'sessions'));
  await writeFile(target, 'A');
  const cp1 = await store.record('add.ts', 'A', 'B', workspace);
  await writeFile(target, 'B');
  const cp2 = await store.record('add.ts', 'B', 'C', workspace);
  await writeFile(target, 'C');
  await assert.rejects(() => prepareFileRestore(store, cp1, workspace), /恢复冲突/);
  const stale = await prepareFileRestore(store, cp2, workspace);
  assert.equal(await readFile(target, 'utf8'), 'C');
  await writeFile(target, 'D');
  await assert.rejects(() => stale.execute(), /恢复冲突/);
  assert.equal(await readFile(target, 'utf8'), 'D');
  await writeFile(target, 'C');
  await (await prepareFileRestore(store, cp2, workspace)).execute();
  assert.equal(await readFile(target, 'utf8'), 'B');
  await (await prepareFileRestore(store, cp1, workspace)).execute();
  assert.equal(await readFile(target, 'utf8'), 'A');
  const added = await store.record('finite.test.ts', null, '新增测试', workspace);
  await writeFile(join(workspace, 'finite.test.ts'), '新增测试');
  await (await prepareFileRestore(store, added, workspace)).execute();
  await assert.rejects(() => access(join(workspace, 'finite.test.ts')), { code: 'ENOENT' });
  console.log('通过：预览不写入、冲突不覆盖、按当前内容恢复、新增恢复为删除。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
JS
```

如果同一毫秒创建多个检查点，列表会以 ID 固定次序；不能只认列表第一项就当作最后一次写入。应结合路径、记录内容和当前文件选择，并让恢复条件最终决定能否继续。

</details>

## 练习三：检查点存不下来，目标会先被覆盖吗

给 `edit_file` 准备好修改并获得 execute 函数，但让检查点目录不可用。执行会不会先改目标、再报告保存失败？反过来，只有检查点而没有执行目标写入，能否把它当成成功修改？

<details>
<summary>答案与可执行验证</summary>

检查点保存发生在目标写入前，所以保存失败时本次工具不覆盖目标。检查点已经存在却没有执行目标写入时，文件仍是 before；记录说明的是预期 after，不是完成标志。恢复预览会提示当前已经是原状态，无需恢复。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileCheckpointStore, prepareFileRestore } from './dist/sessions/file-checkpoints.js';
import { prepareEditFile } from './dist/tools/edit-file.js';

const temporary = await mkdtemp(join(tmpdir(), 'agent-checkpoint-exercise-'));
try {
  const workspace = join(temporary, 'project');
  await mkdir(workspace);
  const target = join(workspace, 'add.ts');
  const before = 'export const value = 1;\n';
  const after = 'export const value = 2;\n';
  await writeFile(target, before);
  const blocked = join(temporary, 'not-a-directory');
  await writeFile(blocked, '目录位置被普通文件占用');
  const unavailable = createFileCheckpointStore(randomUUID(), blocked);
  const prepared = await prepareEditFile(JSON.stringify({ path: 'add.ts',
    old_text: 'value = 1', new_text: 'value = 2' }), workspace, undefined, unavailable);
  await assert.rejects(() => prepared.execute(new AbortController().signal));
  assert.equal(await readFile(target, 'utf8'), before);
  const store = createFileCheckpointStore(randomUUID(), join(temporary, 'sessions'));
  const id = await store.record('add.ts', before, after, workspace);
  assert.equal(await readFile(target, 'utf8'), before);
  await assert.rejects(() => prepareFileRestore(store, id, workspace), /之前的状态/);
  console.log('通过：记录失败不写目标；记录存在也不证明目标写入成功。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
JS
```

这没有模拟“目标已经开始写入又失败”。那种情况可能留下空文件或部分内容，应该读取实际字节，保留检查点和备份后人工核对，不能从这项写前实验推出自动回滚保证。

</details>
