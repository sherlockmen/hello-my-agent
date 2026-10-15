# 第 16 章练习与答案

[第 16 章首页](README.md) · [16.3 超限时压缩，再继续原任务](03-compact-and-continue/README.md)

这些实验使用固定消息和内存模型，不调用真实服务，也不需要密钥。产品仍由 TypeScript 实现；下面用 Node 导入编译产物，检查数据与流程。先在仓库根目录编译本章最后一节，所有脚本也从仓库根目录运行。

```bash
npm run lesson:16.3
```

本章练习没有新增产品源码，下一章从 16.3 的完整 `src/` 继续。

## 练习一：两次读取能不能只留下第二份结果

一条模型消息同时提出读取源码和测试文件。前面还有用户约束，后面有五条近期消息。选择旧内容时，能不能把边界停在第一份读取结果之后？摘要覆盖这些消息后，用户原文会不会一起消失？

<details>
<summary>答案与可执行验证</summary>

调用和本批全部结果是一组。覆盖位置不能切入组内；被覆盖的用户原文仍从完整历史重新带入请求。下面特意让摘要输入只容纳前四条原消息，验证边界恰好落在完整双调用之后。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { emptyCompaction, messageGroupEnds, selectCompaction,
  validateCompaction, requestMessages } from './dist/context/compaction.js';

const history = [
  { role: 'user', content: '保留 add 的公开 API，并测试两个负数相加' },
  { role: 'assistant', content: '', toolCalls: [
    { id: 'read-source', name: 'read_file', arguments: '{"path":"src/add.ts"}' },
    { id: 'read-test', name: 'read_file', arguments: '{"path":"test/add.test.ts"}' },
  ] },
  { role: 'tool', toolCallId: 'read-source', content: '源码内容', isError: false },
  { role: 'tool', toolCallId: 'read-test', content: '文件不存在', isError: true },
  ...Array.from({ length: 5 }, (_, i) => ({ role: 'assistant', content: `近期记录${i + 1}` })),
];
const original = structuredClone(history);
assert.deepEqual(messageGroupEnds(history), [1, 4, 5, 6, 7, 8, 9]);
const selected = selectCompaction(history, emptyCompaction(),
  source => JSON.parse(source).messages.length <= 4);
assert.equal(selected.through, 4);
assert.throws(() => validateCompaction({ summary: '旧过程', through: 3 }, history), /工具组/);
assert.throws(() => messageGroupEnds(history.filter((_, i) => i !== 3)), /配对/);
const view = requestMessages(history, { summary: '读取源码成功，测试文件读取失败', through: 4 });
assert.ok(view.some(message => message.role === 'user' && message.content === history[0].content));
assert.equal(view.filter(message => message.content?.startsWith('近期记录')).length, 5);
assert.deepEqual(history, original);
console.log('通过：双调用完整选择，错误结果也算交代，用户原文与完整历史保留。');
JS
```

这里的“读取失败”仍是一份明确结果，所以这一组完整。若缺少第二份结果，选择器拒绝，而不是替模型猜测它没有执行。

</details>

## 练习二：摘要更短，就可以立即覆盖状态吗

分别让摘要模型返回有效短文、空文和被截断的短文。有效候选返回后，传入的摘要对象是否已经改变？如果收到结果后恰好取消，还能采用吗？

<details>
<summary>答案与可执行验证</summary>

准备函数只返回候选，校验通过也不直接提交。主流程还要检查完整普通请求能否过预算。取消发生在候选交回之前，同样拒绝这次候选；完整返回的用量仍应记录。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { estimateContext } from './dist/context/budget.js';
import { emptyCompaction, prepareCompaction } from './dist/context/compaction.js';

const history = [
  { role: 'user', content: '保留公开 API' },
  { role: 'assistant', content: '旧过程'.repeat(3000) },
  ...Array.from({ length: 5 }, (_, i) => ({ role: 'assistant', content: `近期${i}` })),
];
const state = emptyCompaction();
const complete = { text: '旧调查已完成，负数测试仍需核对', toolCalls: [],
  finishReason: 'stop', inputTokens: 50, outputTokens: 10, truncated: false };
function model(result, controller) {
  return {
    inspectContext(messages) {
      return estimateContext(messages, '规则', [], { windowTokens: 100000, outputReserve: 100 });
    },
    inspectSummary() { return { withinBudget: true }; },
    async summarize() { if (controller) controller.abort(); return result; },
  };
}
let accounted = 0;
const candidate = await prepareCompaction(model(complete), history, state,
  new AbortController().signal, 'execute', [], () => accounted++);
assert.ok(candidate.after < candidate.before);
assert.ok(candidate.state.through > 0);
assert.deepEqual(state, emptyCompaction());
for (const invalid of [{ ...complete, text: '' }, { ...complete, truncated: true }]) {
  await assert.rejects(() => prepareCompaction(model(invalid), history, state,
    new AbortController().signal, 'execute', [], () => accounted++), /摘要/);
}
const cancellation = new AbortController();
await assert.rejects(() => prepareCompaction(model(complete, cancellation), history, state,
  cancellation.signal, 'execute', [], () => accounted++));
assert.equal(accounted, 4);
assert.deepEqual(state, emptyCompaction());
console.log('通过：有效响应只是候选，空文/截断/取消均不修改已采用状态。');
JS
```

实验没有验证摘要语义正确。把有效短文换成一段事实错误但格式合格的文字，它仍可能通过这些机械检查；这正是继续保留原要求、近期证据和完整历史的原因。

</details>

## 练习三：第一次不够，第二次失败，会不会留下半次压缩

固定输入估算为 6,300，可用输入为 6,000。第一份候选降到 6,100，第二份降到 5,700。预测普通模型会调用几次。再让第二份失败：第一份是否会悄悄留下？如果已经用完两次摘要额度，工具以后又使请求过大，会不会再获得两次？

<details>
<summary>答案与可执行验证</summary>

两份候选最终装得下时才一次采用，然后发普通请求；第二份失败则都不采用。两次摘要是整项用户任务的总额度，八次普通决策期间共享，不在每个预算检查点重置。

下面的数字只是本地流程实验，内存模型不会发送 HTTP。摘要输入每次只接纳两条原消息，让第二次确实沿新覆盖位置前进。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { estimateContext } from './dist/context/budget.js';
import { emptyCompaction } from './dist/context/compaction.js';
import { runAgent } from './dist/agent/run.js';

const answer = (text, toolCalls = []) => ({ text, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  inputTokens: 3, outputTokens: 2, truncated: false });
const history = () => [
  { role: 'user', content: '保留 API，并完成负数测试' },
  ...Array.from({ length: 10 }, (_, i) => ({ role: 'assistant', content: `旧过程${i}` })),
];
function fixture(failSecond = false, growAfterTool = false) {
  let summaries = 0, decisions = 0;
  return {
    get summaries() { return summaries; }, get decisions() { return decisions; },
    inspectSummary(source) { return { withinBudget: JSON.parse(source).messages.length <= 2 }; },
    inspectContext(messages) {
      const prefix = messages[0].content;
      const size = growAfterTool && decisions ? 6300 : prefix.includes('候选B') ? 5700
        : prefix.includes('候选A') ? 6100 : 6300;
      return { ...estimateContext(messages, '', [], { windowTokens: 8000, outputReserve: 2000 }),
        inputEstimate: size, remainingEstimate: 6000 - size, withinBudget: size <= 6000 };
    },
    async summarize() {
      summaries++;
      if (failSecond && summaries === 2) throw new Error('第二次摘要失败');
      return answer(summaries === 1 ? '候选A' : '候选B');
    },
    async generate() {
      decisions++;
      return growAfterTool ? answer('', [{ id: 'todo-1', name: 'todo_write', arguments: '{"items":[]}' }])
        : answer('现在才是原任务的回答');
    },
  };
}
const success = fixture(), adopted = emptyCompaction();
await runAgent(success, history(), '继续完成负数测试', new AbortController().signal, undefined, undefined, new Set(),
  { context: adopted });
assert.equal(success.summaries, 2);
assert.equal(success.decisions, 1);
assert.equal(adopted.summary, '候选B');
const failure = fixture(true), retained = emptyCompaction(), records = history();
await assert.rejects(() => runAgent(failure, records, '继续完成负数测试',
  new AbortController().signal, undefined, undefined, new Set(), { context: retained }), /第二次摘要失败/);
assert.equal(failure.decisions, 0);
assert.deepEqual(retained, emptyCompaction());
assert.ok(records.some(message => message.content === '继续完成负数测试'));
const exhausted = fixture(false, true), previous = emptyCompaction();
await assert.rejects(() => runAgent(exhausted, history(), '继续完成负数测试',
  new AbortController().signal, undefined, undefined, new Set(), { context: previous }), /摘要次数/);
assert.equal(exhausted.summaries, 2);
assert.equal(exhausted.decisions, 1);
assert.equal(previous.summary, '候选B');
console.log('通过：最终可用才一次采用，失败不留半次候选，整项任务最多两次摘要。');
JS
```

最后一种情况保留的是先前已经采用的 B，而不是撤销整项任务的所有压缩。停止保护当前已有状态，也不会撤回此前工具已经产生的文件副作用。

</details>
