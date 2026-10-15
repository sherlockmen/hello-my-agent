# 第 18 章练习与答案

[第 18 章首页](/content/chapter-18-long-term-memory/README.md) · [18.3 检查与纠正记忆](/content/chapter-18-long-term-memory/03-manage-memory/README.md)

以下实验使用临时项目和固定的内存模型，不请求真实服务，也不修改课程工作区的记忆。先在仓库根编译最后一节，所有脚本也从仓库根运行。

```bash
npm run lesson:18.3
```

练习没有新增产品源码，下一章从 18.3 的完整 `src/` 继续。每个脚本独立创建并清理目录。

## 练习一：保存后，旧控制器为什么暂时看不到新条目

先创建记忆控制器 A，再保存测试命令。A 的参考应立即变化吗？创建控制器 B 与刷新 A，各会发生什么？如果刷新时文件损坏，A 能否把旧参考清成空串继续？

<details>
<summary>答案与可执行验证</summary>

保存只更新文件；A 保持原快照。B 的初读会取得新内容，A 成功刷新后才更新。刷新失败保留旧字符串并抛错，由任务准备停止处理，不能把错误伪装成空库。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryController, memoryCommand } from './dist/memory/commands.js';
import { readMemory } from './dist/memory/store.js';

const root = await mkdtemp(join(tmpdir(), 'agent-memory-snapshot-'));
const signal = () => new AbortController().signal;
try {
  const a = await createMemoryController(root);
  assert.equal(a.prompt, '');
  await memoryCommand(root, 'add 本项目测试命令是 npm run test:unit');
  assert.equal(a.prompt, '', '写文件不改变任务快照');
  const b = await createMemoryController(root);
  assert.match(b.prompt, /npm run test:unit/);
  await a.refresh(signal());
  assert.equal(a.prompt, b.prompt);
  const document = await readMemory(root);
  assert.equal(document.entries[0].source.kind, 'user');
  assert.equal(document.revision, 1);
  const file = join(root, '.hello-my-agent/memory.json');
  const valid = await readFile(file, 'utf8');
  const previous = a.prompt;
  await writeFile(file, '{broken');
  await assert.rejects(a.refresh(signal()), /JSON/);
  assert.equal(a.prompt, previous);
  await assert.rejects(memoryCommand(root, 'add 不应覆盖坏文件'), /JSON/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeFile(file, valid);
  console.log('通过：写盘与任务参考分开，成功刷新才替换，坏文件不会按空库覆盖。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

控制器 B 模拟重新创建本地运行状态。这个实验确认文件和参考的变化；模型是否采用文字，仍需要观察真实请求后的决策。

</details>

## 练习二：同一个候选，拒绝、批准和 Plan 会怎样回到模型

模型提出测试命令候选。用户拒绝时，下一次模型请求会不会得到工具结果？批准后当前任务的记忆快照是否立刻更新？Plan 中能否通过伪造工具调用写入？

<details>
<summary>答案与可执行验证</summary>

三种分支都由真实 Agent Loop 处理。拒绝回到原调用但不写盘；批准写盘，当前任务仍使用启动快照；Plan 在审批之前拒绝，连审批 handler 都不应调用。下面的内存模型只给出确定调用，权限、准备、审批和保存使用真实实现。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentLoop } from './dist/agent/agent-loop.js';
import { createMemoryController } from './dist/memory/commands.js';
import { readMemory } from './dist/memory/store.js';

const root = await mkdtemp(join(tmpdir(), 'agent-memory-approval-'));
const reply = (text, toolCalls = []) => ({ text, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  inputTokens: null, outputTokens: null, truncated: false });
try {
  const memory = await createMemoryController(root);
  async function run(decision, mode, id) {
    let calls = 0, approvals = 0, returned, before;
    const model = { memory, async generate(messages) {
      if (calls++ === 0) {
        before = memory.prompt; // agentLoop 已在任务开始处完成 refresh。
        return reply('', [{ id, name: 'propose_memory',
        arguments: JSON.stringify({ content: '本项目测试命令是 npm run test:unit',
          reason: '已核对 package.json 的单元测试入口' }) }]);
      }
      returned = messages.find(message => message.role === 'tool' && message.toolCallId === id);
      assert.ok(returned, '下一请求必须带回同一个调用的结果');
      assert.equal(memory.prompt, before, '任务中写盘不刷新参考');
      return reply('已根据真实工具结果说明保存情况。');
    } };
    await agentLoop(model, [], '提出记忆候选', new AbortController().signal,
      undefined, async request => {
        approvals++;
        assert.equal(request.allowSession, false);
        assert.match(request.preview, /npm run test:unit/);
        assert.match(request.preview, /package.json/);
        return decision === 'deny' ? { decision, reason: '暂不保存' } : { decision };
      }, new Set(), { mode });
    return { approvals, returned };
  }
  const denied = await run('deny', 'execute', 'memory-denied');
  assert.equal(denied.approvals, 1);
  assert.equal((await readMemory(root)).revision, 0);
  const approved = await run('allow_once', 'execute', 'memory-approved');
  assert.equal(approved.approvals, 1);
  assert.match(approved.returned.content, /记忆已保存/);
  const saved = await readMemory(root);
  assert.equal(saved.revision, 1);
  assert.equal(saved.entries[0].source.kind, 'model');
  assert.match(saved.entries[0].source.detail, /package.json/);
  const planned = await run('allow_once', 'plan', 'memory-plan');
  assert.equal(planned.approvals, 0);
  assert.match(planned.returned.content, /Plan/);
  assert.equal((await readMemory(root)).revision, 1);
  console.log('通过：拒绝、批准、Plan均有对应工具结果；只有逐次批准真实写入。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

这里没有伪造保存回执，也没有让脚本自己判断“批准后就调用存储器”。真实核心完成了整个往返。

</details>

## 练习三：失效和删除后，还能检查什么

用户先把旧测试命令编辑为新命令，再失效，最后删除。ID、有效参考和操作记录各怎样变化？不存在的 ID 能否增加修订号？

<details>
<summary>答案与可执行验证</summary>

编辑保留 ID、恢复有效并改变来源；失效保留条目与原正文来源，只在操作记录中保存用户理由；删除移除正文，操作记录仍能查看。两种停止使用都不会擦掉历史会话中的旧文字。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCommand } from './dist/memory/commands.js';
import { changeMemory, readMemory, memoryPrompt } from './dist/memory/store.js';

const root = await mkdtemp(join(tmpdir(), 'agent-memory-manage-'));
try {
  const entry = await changeMemory(root, { action: 'add', content: '本项目测试命令是 npm test',
    source: { kind: 'model', detail: '模型建议，用户逐次批准；依据：旧脚本' } });
  const id = entry.id;
  await memoryCommand(root, `edit ${id} 本项目测试命令是 npm run test:unit`);
  let data = await readMemory(root);
  assert.equal(data.entries[0].id, id);
  assert.equal(data.entries[0].source.kind, 'user');
  assert.match(memoryPrompt(data), /npm run test:unit/);
  await memoryCommand(root, `invalidate ${id} 尚未核对迁移后的脚本`);
  data = await readMemory(root);
  assert.equal(data.entries[0].status, 'invalid');
  assert.equal(memoryPrompt(data), '');
  assert.equal(data.audit.at(-1).source.detail, '尚未核对迁移后的脚本');
  await memoryCommand(root, `delete ${id}`);
  const shown = JSON.parse(await memoryCommand(root, `show ${id}`));
  assert.equal(shown.entry, null);
  assert.deepEqual(shown.audit.map(item => item.action), ['add', 'edit', 'invalidate', 'delete']);
  const revision = (await readMemory(root)).revision;
  await assert.rejects(memoryCommand(root, `edit ${id} 不存在的正文`), /找不到|不存在/);
  assert.equal((await readMemory(root)).revision, revision);
  console.log('通过：按ID修正、失效与删除；有效参考被排除，操作来源仍可追溯。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

</details>
