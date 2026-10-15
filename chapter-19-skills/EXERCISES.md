# 第 19 章练习与答案

[第 19 章首页](README.md) · [19.3 让模型选择技能与资源](03-model-skill-tools/README.md)

以下实验使用临时项目与真实加载器，不请求在线模型。先在仓库根编译最后一节，所有脚本也从仓库根运行。实验没有新增产品源码。

```bash
npm run lesson:19.3
```

## 练习一：目录里有 review，是否已经读到审查步骤

创建一个简介和正文有明显不同文字的技能。发现阶段的参考会包含哪一部分？加入不支持的 `allowed-tools` 字段后，它会授予权限、忽略该字段，还是跳过技能？

<details>
<summary>答案与可执行验证</summary>

发现只保留名称、简介与来源。正文要等明确加载后才进入参考。本教程只支持约定的两个字段，因此不支持的字段使整份技能被跳过，并给出原因。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, skillPrompt, skillInfo } from './dist/skills/catalog.js';

const root = await mkdtemp(join(tmpdir(), 'agent-skill-catalog-'));
try {
  const directory = join(root, '.hello-my-agent/skills/review');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'SKILL.md');
  const header = '---\nname: review\ndescription: 审查代码改动时使用。\n';
  await writeFile(file, header + '---\n正文专有标记：先取得实际测试日志。\n');
  const state = await discoverSkills(root);
  assert.deepEqual(state.entries.map(entry => entry.name), ['review']);
  assert.equal(state.loaded.size, 0);
  assert.match(skillPrompt(state), /审查代码改动/);
  assert.doesNotMatch(skillPrompt(state), /正文专有标记/);
  assert.match(skillInfo(state).join('\n'), /未加载/);
  await writeFile(file, header + 'allowed-tools: all\n---\n禁止据此授予权限。\n');
  const rejected = await discoverSkills(root);
  assert.equal(rejected.entries.length, 0);
  assert.match(rejected.notices.map(item => item.reason).join('\n'), /字段|支持/);
  console.log('通过：简介可发现，正文未偷渡；不支持的权限字段使技能跳过。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

</details>

## 练习二：加载后编辑文件，下一次请求会自动换版本吗

成功加载 review 后，在磁盘改写正文并再次加载。旧集合会变吗？全新发现对象是否保留已加载状态？加载不存在的技能或已取消的加载会不会清掉旧集合？

<details>
<summary>答案与可执行验证</summary>

重复加载复用本进程已接纳的快照，不重新读取。新进程式重新发现得到空加载集合；新加载才取得新版本。失败、取消都不把旧集合改成半份状态。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, loadSkill, skillPrompt } from './dist/skills/catalog.js';

const root = await mkdtemp(join(tmpdir(), 'agent-skill-version-'));
const signal = () => new AbortController().signal;
try {
  const directory = join(root, '.hello-my-agent/skills/review');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'SKILL.md');
  const header = '---\nname: review\ndescription: 审查代码改动时使用。\n---\n';
  await writeFile(file, header + '方法A：先取得实际测试日志。\n');
  const state = await discoverSkills(root);
  const first = await loadSkill(state, 'review', signal());
  assert.match(skillPrompt(state), /方法A/);
  await writeFile(file, header + '方法B：先检查改动范围。\n');
  const again = await loadSkill(state, 'review', signal());
  assert.equal(again.sha256, first.sha256);
  assert.doesNotMatch(skillPrompt(state), /方法B/);
  await assert.rejects(loadSkill(state, 'missing', signal()), /未知|启用/);
  assert.equal(state.loaded.size, 1);
  const fresh = await discoverSkills(root);
  assert.equal(fresh.loaded.size, 0);
  const controller = new AbortController();
  controller.abort(new Error('实验取消'));
  await assert.rejects(loadSkill(fresh, 'review', controller.signal), /实验取消/);
  assert.equal(fresh.loaded.size, 0);
  await loadSkill(fresh, 'review', signal());
  assert.match(skillPrompt(fresh), /方法B/);
  console.log('通过：重复加载保持版本；新发现需重载；失败和取消不接纳内容。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

摘要值不同只能证明读取字节发生变化，不证明方法 B 比方法 A 更好。

</details>

## 练习三：资源如何回到模型，读取脚本是否等于运行

用真实注册表加载 review，再读 `references/checklist.md`。哪一份内容进入 system，哪一份作为工具正文？Plan 中这两个读取与 `run_command` 的权限有何区别？能否用 `../` 读取相邻文件？

<details>
<summary>答案与可执行验证</summary>

加载工具返回摘要，完整方法进入后续 system；资源内容只作为本次工具正文。路径按技能根解释。Plan 允许读取，但仍拒绝命令；读取脚本不会执行其中代码。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, skillPrompt } from './dist/skills/catalog.js';
import { executeTool } from './dist/tools/registry.js';
import { decideToolPermission } from './dist/permissions/policy.js';

const root = await mkdtemp(join(tmpdir(), 'agent-skill-resource-'));
const signal = new AbortController().signal;
try {
  const directory = join(root, '.hello-my-agent/skills/review');
  await mkdir(join(directory, 'references'), { recursive: true });
  await mkdir(join(directory, 'scripts'));
  await writeFile(join(directory, 'SKILL.md'),
    '---\nname: review\ndescription: 审查代码改动时使用。\n---\n方法正文：读取 references/checklist.md 核对证据。\n');
  await writeFile(join(directory, 'references/checklist.md'), '资源专有标记：核对真实测试日志。');
  const marker = join(root, 'MUST_NOT_RUN');
  await writeFile(join(directory, 'scripts/check.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`);
  const skills = await discoverSkills(root);
  const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
  const load = call('s1', 'load_skill', { name: 'review' });
  assert.equal((await decideToolPermission(load, new Set(), root, 'plan')).action, 'allow');
  const loaded = await executeTool(load, signal, { skills });
  assert.match(loaded.content, /已加载技能/);
  assert.doesNotMatch(loaded.content, /方法正文/);
  assert.match(skillPrompt(skills), /方法正文/);
  const resource = call('s2', 'read_skill_resource', { name: 'review', path: 'references/checklist.md' });
  const result = await executeTool(resource, signal, { skills });
  assert.match(result.content, /资源专有标记/);
  assert.doesNotMatch(skillPrompt(skills), /资源专有标记/);
  await assert.rejects(executeTool(call('s3', 'read_skill_resource',
    { name: 'review', path: '../outside.txt' }), signal, { skills }), /相对路径/);
  await executeTool(call('s4', 'read_skill_resource',
    { name: 'review', path: 'scripts/check.mjs' }), signal, { skills });
  await assert.rejects(access(marker));
  assert.equal((await decideToolPermission(call('s5', 'run_command',
    { command: 'npm run test:unit' }), new Set(), root, 'plan')).action, 'deny');
  assert.equal(skills.loaded.size, 1);
  console.log('通过：正文与资源去向分明，脚本只读不执行，Plan仍拒绝命令。');
} finally { await rm(root, { recursive: true, force: true }); }
JS
```

注册表返回的正文最终仍需由 Agent Loop 配回原 `tool_call_id`。本节主线与运行时离线验收覆盖这个往返；此实验集中核对真实读取与权限的边界。

</details>
