/** 第十二章：五节完整编译、模式权限、任务清单、澄清与补充输入。只用内存模型和临时文件。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'hello-agent-check-12-'));
const previousCwd = process.cwd();
const stages = ['01-plan-mode', '02-task-list', '03-clarify-questions', '04-live-input', '05-manage-queue'];
const signal = () => new AbortController().signal;
const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
const reply = (text, toolCalls = []) => ({
  text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  inputTokens: 1, outputTokens: 1, truncated: false,
});

// 每个 assistant 工具批次后都必须先收齐同 ID 的结果，才允许下一条普通消息。
function assertToolPairs(messages) {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    const results = messages.slice(index + 1, index + 1 + message.toolCalls.length);
    assert.ok(results.every(result => result.role === 'tool'), '工具结果不能被补充输入拆开');
    assert.deepEqual(results.map(result => result.toolCallId), message.toolCalls.map(request => request.id));
  }
}

async function verifyPlan({ agentLoop, decideToolPermission, streamAgentRun }, workspace) {
  const original = 'ORIGINAL\n';
  writeFileSync(join(workspace, 'existing.txt'), original);
  const operations = [
    call('create', 'write_file', { path: 'created.txt', content: 'changed' }),
    call('edit', 'edit_file', { path: 'existing.txt', old_text: 'ORIGINAL', new_text: 'CHANGED' }),
    call('command', 'run_command', {
      command: 'node -e "require(\'node:fs\').writeFileSync(\'command-created.txt\',\'changed\')"', cwd: '.',
    }),
  ];
  const grants = new Set(['write_file:created.txt', 'edit_file:existing.txt', 'run_command:once']);
  for (const operation of operations) {
    assert.equal((await decideToolPermission(operation, grants, workspace, 'plan')).action, 'deny');
    assert.equal((await decideToolPermission(operation, grants, workspace, 'execute')).action, 'ask');
  }
  let modelCalls = 0, approvals = 0;
  const history = [], events = [];
  const options = { mode: 'plan' };
  const model = { async generate(messages, _signal, _onText, requestOptions) {
    assert.equal(requestOptions.mode, 'plan');
    if (modelCalls++ === 0) {
      // 模式是整轮快照，调用方修改下一轮选项不能给当前批次扩权。
      options.mode = 'execute';
      return reply('', operations);
    }
    assertToolPairs(messages);
    const results = messages.filter(message => message.role === 'tool');
    assert.equal(results.length, operations.length);
    assert.ok(results.every(result => result.isError && result.content.includes('Plan')));
    return reply('仅给出调查后的计划');
  } };
  for await (const record of streamAgentRun(model, history, '先计划', signal(), async () => {
    approvals++;
    return { decision: 'allow_once' };
  }, grants, options)) events.push(record.event);
  assert.equal(modelCalls, 2);
  assert.equal(approvals, 0, 'Plan 不应出现可放行修改的审批');
  assert.ok(!events.some(event => event.type === 'tool_prepare' || event.type === 'tool_start'));
  assert.equal(events.at(-1).outcome, 'completed');
  assert.equal(readFileSync(join(workspace, 'existing.txt'), 'utf8'), original);
  assert.equal(existsSync(join(workspace, 'created.txt')), false);
  assert.equal(existsSync(join(workspace, 'command-created.txt')), false);
  assertToolPairs(history);

  const cancelled = new AbortController();
  cancelled.abort();
  const untouched = [], forbidden = { async generate() { throw new Error('已取消时不能请求模型'); } };
  await assert.rejects(agentLoop(forbidden, untouched, '已取消', cancelled.signal), { name: 'AbortError' });
  assert.deepEqual(untouched, []);
}

async function verifyTasks({ agentLoop, decideToolPermission }, load) {
  const { todoWriteTool } = await load('tools/todo-write.js');
  const tasks = { items: [{ id: 'old', text: '原清单', status: 'pending' }] };
  const before = structuredClone(tasks.items);
  const invalidLists = [
    [{ id: 'a', text: '第一项有效', status: 'pending' }, { id: 'a', text: '重复 ID', status: 'pending' }],
    [{ id: 'a', text: '调查', status: 'in_progress' }, { id: 'b', text: '实施', status: 'in_progress' }],
    [{ id: 'a', text: '', status: 'completed' }],
    Array.from({ length: 9 }, (_, index) => ({ id: String(index), text: '过量', status: 'pending' })),
  ];
  for (const items of invalidLists) {
    await assert.rejects(todoWriteTool(JSON.stringify({ items }), tasks, signal()));
    assert.deepEqual(tasks.items, before, '后续项无效时不能提交前面的有效项');
  }
  const updated = [
    { id: 'a', text: '调查', status: 'in_progress' },
    { id: 'b', text: '实施', status: 'pending' },
  ];
  const request = call('todo', 'todo_write', { items: updated });
  assert.equal((await decideToolPermission(request, new Set(), undefined, 'plan')).action, 'allow');
  let modelCalls = 0;
  await agentLoop({ async generate(messages) {
    if (modelCalls++ === 0) return reply('', [request]);
    assertToolPairs(messages);
    assert.deepEqual(tasks.items, updated);
    assert.deepEqual(JSON.parse(messages.at(-1).content).items, updated);
    return reply('清单已保存，实施仍待完成');
  } }, [], '列任务', signal(), undefined, undefined, new Set(), { mode: 'plan', tasks });
  assert.equal(tasks.items[1].status, 'pending', '模型最终回答不能自动完成未执行的任务');
  const result = await todoWriteTool(JSON.stringify({ items: updated }), tasks, signal());
  result.metadata.items[0].text = '显示副本';
  assert.equal(tasks.items[0].text, '调查');

  // 未提供会话容器也应接受本轮工具请求，不因新增可选参数破坏旧调用方。
  let fallbackCalls = 0;
  await agentLoop({ async generate(messages) {
    if (fallbackCalls++ === 0) return reply('', [request]);
    assert.equal(messages.at(-1).isError, false);
    assert.deepEqual(JSON.parse(messages.at(-1).content).items, updated);
    return reply('本轮清单已保存');
  } }, [], '兼容调用', signal());
}

async function verifyQuestions({ agentLoop }, load, workspace) {
  const { askUserTool } = await load('tools/ask-user.js');
  const args = { question: '需要哪种输出？', choices: ['文本', 'JSON'] };
  for (const [handler, expected] of [[undefined, /无法等待用户回答/], [async () => null, /没有回答/]]) {
    let modelCalls = 0;
    const history = [];
    await agentLoop({ async generate(messages) {
      if (modelCalls++ === 0) return reply('', [call('ask', 'ask_user', args)]);
      const result = messages.at(-1);
      assert.equal(result.role, 'tool');
      assert.equal(result.toolCallId, 'ask');
      assert.equal(result.isError, true);
      assert.match(result.content, expected);
      return reply('需要用户补充信息');
    } }, history, '确认输出', signal(), undefined, undefined, new Set(), { askUser: handler });
    assert.equal(history.filter(message => message.role === 'user').length, 1);
    assertToolPairs(history);
  }
  await assert.rejects(askUserTool(JSON.stringify({ question: '选择？', choices: ['重复', '重复'] }), async () => '重复', signal()), /重复/);
  const result = await askUserTool(JSON.stringify(args), async request => {
    assert.deepEqual(request, args);
    return 'JSON';
  }, signal());
  assert.equal(JSON.parse(result.content).answer, 'JSON');

  // 取消与回答同时到达：答案不保存，后面的真实写入也不能启动，历史仍完整配对。
  const controller = new AbortController();
  const history = [];
  let modelCalls = 0;
  await assert.rejects(agentLoop({ async generate(_messages, sharedSignal) {
    assert.equal(sharedSignal, controller.signal);
    assert.equal(++modelCalls, 1, '取消后不能再请求一次模型');
    return reply('', [call('ask', 'ask_user', args), call('later', 'write_file', { path: 'after-question.txt', content: '不应写入' })]);
  } }, history, '等待澄清', controller.signal, undefined, async () => ({ decision: 'allow_once' }), new Set(), {
    askUser: async (_request, sharedSignal) => {
      assert.equal(sharedSignal, controller.signal);
      controller.abort();
      return 'STALE_ANSWER';
    },
  }), { name: 'AbortError' });
  assertToolPairs(history);
  assert.ok(!history.some(message => message.content.includes('STALE_ANSWER')));
  const tools = history.filter(message => message.role === 'tool');
  assert.equal(tools.length, 2);
  assert.match(tools[0].content, /操作已开始/);
  assert.match(tools[1].content, /未执行/);
  assert.equal(existsSync(join(workspace, 'after-question.txt')), false);

  const cancelledHistory = structuredClone(history);
  const next = new AbortController();
  await agentLoop({ async generate(messages, freshSignal) {
    assert.equal(freshSignal, next.signal);
    assert.equal(freshSignal.aborted, false);
    assert.deepEqual(messages.slice(0, -1), cancelledHistory);
    return reply('读取取消后的状态再继续');
  } }, history, '现在继续', next.signal);
  assertToolPairs(history);
}

async function verifyLiveInput({ agentLoop }) {
  let pending = [], modelCalls = 0;
  const history = [], events = [], tasks = { items: [] };
  await agentLoop({ async generate(messages) {
    if (modelCalls++ === 0) return reply('', [
      call('ask', 'ask_user', { question: '继续吗？', choices: [] }),
      call('todo', 'todo_write', { items: [{ id: 'a', text: '调查', status: 'pending' }] }),
    ]);
    assert.deepEqual(messages.slice(-3).map(message => message.role), ['tool', 'tool', 'user']);
    assert.equal(messages.at(-1).content, '请先检查类型');
    assertToolPairs(messages);
    return reply('已结合补充完成调查');
  } }, history, '调查项目', signal(), event => events.push(event), undefined, new Set(), {
    tasks,
    askUser: async () => {
      assert.equal(history.length, 0, '界面不能提前向共享历史插入补充');
      pending.push({ id: 1, text: '请先检查类型' });
      return '继续';
    },
    takePendingInputs: () => {
      if (pending.length) assert.equal(tasks.items.length, 1, '必须先执行同批后续工具');
      return pending.splice(0);
    },
    hasPendingInputs: () => pending.length > 0,
  });
  const applied = events.filter(event => event.type === 'input_applied');
  assert.deepEqual(applied, [{ type: 'input_applied', id: 1, text: '请先检查类型', call: 2 }]);
  assert.ok(events.findLastIndex(event => event.type === 'tool_finish') < events.findIndex(event => event.type === 'input_applied'));
  assertToolPairs(history);

  // 模型刚给出最终文字时到达的补充仍须处理，不能留下一条永远不消费的队列项。
  pending = []; modelCalls = 0;
  const finalHistory = [];
  await agentLoop({ async generate(messages) {
    if (modelCalls++ === 0) {
      pending.push({ id: 2, text: '还需要一个示例' });
      return reply('第一份回答');
    }
    assert.equal(messages.at(-2).content, '第一份回答');
    assert.equal(messages.at(-1).content, '还需要一个示例');
    return reply('包含示例的回答');
  } }, finalHistory, '说明方案', signal(), undefined, undefined, new Set(), {
    takePendingInputs: () => pending.splice(0), hasPendingInputs: () => pending.length > 0,
  });
  assert.equal(modelCalls, 2);
  assert.equal(pending.length, 0);
  assert.equal(finalHistory.at(-1).content, '包含示例的回答');

  // 最后一次请求之后不能再收取补充，否则会显示为已应用却从未发给模型。
  pending = []; modelCalls = 0;
  const limitHistory = [];
  const lastReply = await agentLoop({ async generate() {
    modelCalls++;
    pending.push({ id: modelCalls, text: `追加${modelCalls}` });
    return reply(`回答${modelCalls}`);
  } }, limitHistory, '持续补充', signal(), undefined, undefined, new Set(), {
    takePendingInputs: () => pending.splice(0), hasPendingInputs: () => pending.length > 0,
  });
  assert.equal(modelCalls, 8);
  assert.equal(lastReply.text, '回答8');
  assert.deepEqual(pending, [{ id: 8, text: '追加8' }]);
  assert.ok(!limitHistory.some(message => message.content === '追加8'));

  const cancelled = new AbortController(); cancelled.abort();
  let taken = false;
  await assert.rejects(agentLoop({ async generate() { throw new Error('已取消时不能请求模型'); } }, [], '停止', cancelled.signal, undefined, undefined, new Set(), {
    takePendingInputs: () => { taken = true; return [{ id: 9, text: '仍待发送' }]; },
  }), { name: 'AbortError' });
  assert.equal(taken, false, '请求前已取消不能收走待发送补充');
}

async function verifyQueueManagement(load) {
  const queueApi = await load('ui/tui/input-queue.js');
  const queue = queueApi.newInputQueue();
  const original = queueApi.enqueueInput(queue, '原补充', 41);
  const withdrawn = queueApi.enqueueInput(queue, '需要撤回', 41);
  const otherRun = queueApi.enqueueInput(queue, '另一轮的补充', 42);
  assert.equal(queueApi.updateQueuedInput(queue, original.id, ' 编辑后的补充 '), true);
  assert.equal(queueApi.findQueuedInput(queue, original.id).id, original.id);
  assert.equal(queueApi.findQueuedInput(queue, original.id).text, '编辑后的补充');
  assert.equal(queueApi.findQueuedInput(queue, original.id).run, 41);
  assert.throws(() => queueApi.updateQueuedInput(queue, original.id, '   '), /不能为空/);
  assert.equal(queueApi.findQueuedInput(queue, original.id).text, '编辑后的补充', '编辑失败必须保留旧内容');
  assert.equal(queueApi.removeQueuedInput(queue, withdrawn.id).id, withdrawn.id);
  assert.equal(queueApi.findQueuedInput(queue, withdrawn.id), undefined);
  assert.deepEqual(queueApi.takePendingInputs(queue, 99), []);
  assert.equal(queueApi.hasPendingInputs(queue, 41), true);
  assert.deepEqual(queueApi.takePendingInputs(queue, 41), [{ id: original.id, text: '编辑后的补充' }]);
  assert.equal(queueApi.hasPendingInputs(queue, 41), false);
  assert.equal(queueApi.updateQueuedInput(queue, original.id, '迟到的编辑'), false, '已收取条目不能再编辑');
  assert.equal(queueApi.removeQueuedInput(queue, original.id), undefined);
  assert.equal(queueApi.hasPendingInputs(queue, 42), true, '当前轮不能偷发另一轮的补充');
  assert.equal(queueApi.findQueuedInput(queue, otherRun.id).text, '另一轮的补充');
  assert.deepEqual(queueApi.takePendingInputs(queue, 42), [{ id: otherRun.id, text: '另一轮的补充' }]);
  const later = queueApi.enqueueInput(queue, '之后的补充', 43);
  assert.ok(later.id > otherRun.id, '撤回或收取后不能复用稳定 ID');
}

async function verifyQuestionWait(load) {
  const { waitForAnswer } = await load('ui/tui/questions.js');
  const request = { question: '保留哪一种输出？', choices: ['文本', 'JSON'] };
  let pending;
  const controller = new AbortController();
  const waiting = waitForAnswer(request, controller.signal, value => { pending = value; });
  const stale = pending;
  assert.equal(stale.respond('  '), false);
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(pending, undefined);
  assert.equal(stale.respond('旧答案'), false);
  const next = waitForAnswer(request, signal(), value => { pending = value; });
  assert.notEqual(pending.key, stale.key);
  assert.equal(stale.respond('窃取新请求'), false);
  assert.equal(pending.respond(' JSON '), true);
  assert.equal(await next, 'JSON');
  assert.equal(pending, undefined);
}

try {
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'));
  for (const [index, stage] of stages.entries()) {
    const source = join(root, 'chapter-12-task-control', stage, 'src');
    const stageDir = join(temp, stage); mkdirSync(stageDir);
    const dist = join(stageDir, 'dist');
    const config = join(stageDir, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: {
      noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist,
      typeRoots: [join(root, 'node_modules/@types')],
    }, include: [join(source, 'cli.ts')] }));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
    const load = file => import(pathToFileURL(join(dist, file)).href);
    const core = {
      ...(await load('agent/agent-loop.js')),
      ...(await load('agent/run-stream.js')),
      ...(await load('permissions/policy.js')),
    };
    const { toolDefinitions } = await load('tools/registry.js');
    const names = toolDefinitions.map(tool => tool.name);
    assert.equal(names.includes('todo_write'), index >= 1, '早期快照不能提前引入后续工具');
    assert.equal(names.includes('ask_user'), index >= 2, '澄清工具只从 12.3 开始提供');
    assert.equal(existsSync(join(dist, 'tools/todo-write.js')), index >= 1);
    assert.equal(existsSync(join(dist, 'tools/ask-user.js')), index >= 2);
    const workspace = join(stageDir, 'workspace'); mkdirSync(workspace);
    writeFileSync(join(workspace, 'package.json'), '{}');
    process.chdir(workspace);
    await verifyPlan(core, workspace);
    if (index >= 1) await verifyTasks(core, load);
    if (index >= 2) await verifyQuestions(core, load, workspace);
    if (index >= 3) await verifyLiveInput(core);
    if (index === 4) {
      await verifyQueueManagement(load);
      await verifyQuestionWait(load);
    }
    console.log(`✓ 12.${index + 1}：完整编译、模式权限和本节核心边界通过`);
  }
} finally {
  process.chdir(previousCwd);
  rmSync(temp, { recursive: true, force: true });
}
