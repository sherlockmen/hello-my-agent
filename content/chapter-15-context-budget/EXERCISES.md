# 第 15 章练习与答案

[第 15 章首页](/content/chapter-15-context-budget/README.md) · [15.3 显示预算并在超限时停止](/content/chapter-15-context-budget/03-enforce-budget/README.md)

这些实验使用确定的消息、临时日志和内存模型，不调用真实模型服务，也不需要 API Key。先在仓库根目录编译本章最后一节；所有代码块也从仓库根目录运行。

```bash
npm run lesson:15.3
```

本章练习只有验证脚本，没有新的产品源码。后续章节从 15.3 的完整 `src/` 继续。

## 练习一：消息正文没变，工具参数变长会不会增加估算

两条 assistant 消息的 `content` 都为空，第二条工具参数中的路径更长。输入估算应该相同吗？服务没有返回输入用量时，能否用输入估算代替它，再乘单价显示费用？

<details>
<summary>答案与可执行验证</summary>

估算整个消息 JSON，所以工具 ID、名称和参数也占输入空间。费用计算只能使用服务实际报告的两侧用量与用户配置单价，不能用本地近似补缺。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { estimateTextTokens, estimateContext, estimateCostUsd } from './dist/context/budget.js';

const limits = { windowTokens: 8000, outputReserve: 2000,
  inputPricePerMillion: 2, outputPricePerMillion: 6 };
const message = path => ({ role: 'assistant', content: '', toolCalls: [{
  id: 'read-1', name: 'read_file', arguments: JSON.stringify({ path, offset: 1, limit: 5 }),
}] });
const first = estimateContext([message('a.ts')], '系统规则', [], limits);
const second = estimateContext([message('folder/'.repeat(50) + 'a.ts')], '系统规则', [], limits);
assert.equal(estimateTextTokens('add'), 1);
assert.equal(estimateTextTokens('相加'), 2);
assert.ok(second.messagesEstimate > first.messagesEstimate);
assert.equal(first.inputEstimate, first.systemEstimate + first.toolsEstimate + first.messagesEstimate);
assert.equal(first.remainingEstimate, 8000 - 2000 - first.inputEstimate);
assert.equal(estimateCostUsd(null, 5, limits), null);
assert.equal(estimateCostUsd(10, 5, { windowTokens: 8000, outputReserve: 2000 }), null);
assert.equal(estimateCostUsd(10, 5, limits), 0.00005);
console.log('通过：参数属于输入，缺用量或单价时不生成费用估计。');
JS
```

`相加` 的结果验证的是本地字节近似，不是某个模型的真实分词结果。窗口与价格也都是实验输入，不是服务商规格或最新报价。

</details>

## 练习二：中间被裁掉的错误，怎样再交回模型

一份日志的第 40 行有关键标记，但开头、结尾都没有它。模型该猜测中间内容，还是按日志 UUID 读取？如果整份日志只有一行、关键标记在第 6,500 列附近，又怎样读取？

<details>
<summary>答案与可执行验证</summary>

裁剪说明让模型知道中间缺失。`read_tool_result` 按已知编号、行与列取一小段；长行可续读，不能简单只保留每行开头。下面验证日志保存、边界、行列读取和拒绝任意路径。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundToolResult } from './dist/context/tool-results.js';
import { readToolResultTool } from './dist/tools/read-tool-result.js';

const temporary = await mkdtemp(join(tmpdir(), 'agent-log-exercise-'));
const signal = new AbortController().signal;
try {
  const short = '🙂'.repeat(8000);
  assert.equal((await boundToolResult(short, signal, temporary)).content, short);
  const full = Array.from({ length: 80 }, (_, i) =>
    `第${i + 1}行 ${'🙂'.repeat(400)} ${i === 39 ? '关键断言' : '过程记录'}`).join('\n');
  const bounded = await boundToolResult(full, signal, temporary);
  assert.equal(await readFile(bounded.logPath, 'utf8'), full);
  assert.ok(!bounded.content.includes('关键断言'));
  const middle = await readToolResultTool(JSON.stringify({ id: bounded.logId,
    offset: 40, limit: 1 }), signal, temporary);
  assert.match(middle.content, /40:1: 第40行/);
  assert.match(middle.content, /关键断言/);
  const giant = 'A'.repeat(6500) + '行内关键标记' + 'B'.repeat(6500);
  const oneLine = await boundToolResult(giant, signal, temporary);
  const part = await readToolResultTool(JSON.stringify({ id: oneLine.logId,
    offset: 1, limit: 1, column: 6400 }), signal, temporary);
  assert.match(part.content, /行内关键标记/);
  assert.match(part.content, /column=7400/);
  await assert.rejects(() => readToolResultTool(JSON.stringify({ id: '../secret',
    offset: 1, limit: 1 }), signal, temporary), /UUID/);
  console.log('通过：完整正文保留，头尾明确省略，中段与长行可以受控续读。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
JS
```

返回片段仍会进入历史、参与下一次预算。这个工具没有把完整日志一次性重发；用户删除日志以后，它会返回无法读取的错误，不能保证旧会话里的引用永久可用。

</details>

## 练习三：刚好装下、超出一点、工具后才超出

先预测三种请求次数：输入估算加预留刚好等于窗口；比窗口多 1；第一次装得下，但工具结果使下一次装不下。最后一种情况下，已经执行的工具结果还在历史里吗？

<details>
<summary>答案与可执行验证</summary>

刚好等于允许调用；多 1 就在本地停止。工具后才超出时，第一次模型调用和工具已经完成，只阻止第二次请求，调用与结果仍成对保留。

内存模型的 `generate()` 只计数并返回固定对象，不创建 HTTP。第一组直接返回最终文本，第二组先调用无外部副作用的 `todo_write`；都通过真正的核心循环检查预算。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { estimateContext } from './dist/context/budget.js';
import { runAgent } from './dist/agent/run.js';

const input = '核对加法测试';
const reserve = 100;
const size = estimateContext([{ role: 'user', content: input }], '规则', [],
  { windowTokens: 10000, outputReserve: reserve }).inputEstimate;
const answer = (text, toolCalls = []) => ({ text, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  inputTokens: 3, outputTokens: 2, truncated: false });
const signal = () => new AbortController().signal;
function fixture(windowTokens, withTool = false) {
  let calls = 0;
  return {
    get calls() { return calls; },
    inspectContext(messages) {
      return estimateContext(messages, '规则', [], { windowTokens, outputReserve: reserve });
    },
    async generate() {
      calls += 1;
      return withTool && calls === 1
        ? answer('', [{ id: 'todo-1', name: 'todo_write', arguments: '{"items":[]}' }])
        : answer('完成');
    },
  };
}
const exact = fixture(size + reserve);
await runAgent(exact, [], input, signal());
assert.equal(exact.calls, 1);
const tooSmall = fixture(size + reserve - 1);
await assert.rejects(() => runAgent(tooSmall, [], input, signal()), /预算不足/);
assert.equal(tooSmall.calls, 0);
const afterTool = fixture(size + reserve, true);
const history = [], events = [];
await assert.rejects(() => runAgent(afterTool, history, input, signal(),
  event => events.push(event)), /预算不足/);
assert.equal(afterTool.calls, 1);
assert.ok(history.some(message => message.role === 'tool' && message.toolCallId === 'todo-1'));
assert.equal(events.filter(event => event.type === 'context_budget').length, 2);
assert.equal(events.at(-1).type, 'run_finish');
assert.equal(events.at(-1).outcome, 'error');
console.log('通过：边界允许、超限零调用、工具后超限保留结果并收尾。');
JS
```

这个实验验证本地判断与历史提交，没有证明真实服务一定接受估算内的请求。服务的实际分词、窗口和输出规则仍以所接协议为准。

</details>
