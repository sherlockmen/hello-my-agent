/** 第十五章：临时编译、本地 SSE、真实工具与日志；不读项目 .env，不改当前 dist，不调用在线模型。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hello-my-agent-15-'));
const previousCwd = process.cwd();
const workspace = join(temporary, 'project');
mkdirSync(workspace); writeFileSync(join(workspace, 'package.json'), '{}');
const signal = () => new AbortController().signal;
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
const result = (text, toolCalls = [], inputTokens = 3, outputTokens = 2) => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', inputTokens, outputTokens, truncated: false });
const limits = { windowTokens: 32_768, outputReserve: 777, inputPricePerMillion: 2, outputPricePerMillion: 6 };
const frames = [];
let handler;
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); frames.push(body);
  try { await handler(body, response); } catch (error) { response.destroy(error); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const fixture = provider => ({ provider, apiKey: 'fixture-only', model: 'fixture', baseURL, contextLimits: limits });
const send = (response, event, anthropic = false) => response.write(`${anthropic ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
const openFrame = (delta, finish_reason = null, usage) => ({ id: 'response_1', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) });

/** 用 SDK 的真实 SSE 输入核对两种协议的输出上限和服务商 usage 读取。 */
function answerStream(provider, response) {
  response.setHeader('content-type', 'text/event-stream');
  if (provider === 'openai') {
    send(response, openFrame({ role: 'assistant', content: '本地模型回答' }));
    send(response, openFrame({}, 'stop', { prompt_tokens: 17, completion_tokens: 4, total_tokens: 21 }));
    response.end('data: [DONE]\n\n');
  } else {
    send(response, { type: 'message_start', message: { id: 'message_1', type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 17, output_tokens: 0 } } }, true);
    send(response, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, true);
    send(response, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '本地模型回答' } }, true);
    send(response, { type: 'content_block_stop', index: 0 }, true);
    send(response, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }, true);
    send(response, { type: 'message_stop' }, true); response.end();
  }
}

/** 每小节独立编译到临时目录，顺便强制所有新模块进入依赖闭包。 */
function compile(lesson) {
  const source = join(root, 'chapter-15-context-budget', lesson, 'src');
  const project = join(temporary, lesson); mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module', version: 'fixture' }));
  symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'));
  const dist = join(project, 'dist'), config = join(project, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist, typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, '**/*.ts'), join(source, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  return dist;
}

/** 一批工具结果必须按原顺序逐一配对，错误或取消也不能遗留悬空调用。 */
function assertPairs(messages) {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    const outcomes = messages.slice(i + 1, i + 1 + message.toolCalls.length);
    assert.ok(outcomes.every(item => item.role === 'tool'));
    assert.deepEqual(outcomes.map(item => item.toolCallId), message.toolCalls.map(item => item.id));
  }
}

/** 估算包含三部分；输入变化只改变相关部分，费用不能从本地估算伪造。 */
function verifyEstimate(api, createModel) {
  assert.equal(api.estimateTextTokens('汉'), 1);
  assert.equal(api.estimateTextTokens('abcdef'), 2);
  const messages = [{ role: 'assistant', content: '', toolCalls: [call('id', 'read_file', { path: 'file.ts', offset: 1, limit: 5 })] }];
  const budget = api.estimateContext(messages, 'system', [{ name: 'tool', inputSchema: { path: 'string' } }], limits);
  assert.equal(budget.systemEstimate, api.estimateTextTokens('system') + 8);
  assert.equal(budget.messagesEstimate, api.estimateTextTokens(JSON.stringify(messages[0])) + 8 + 32);
  assert.equal(budget.inputEstimate, budget.systemEstimate + budget.toolsEstimate + budget.messagesEstimate);
  assert.equal(budget.remainingEstimate, limits.windowTokens - limits.outputReserve - budget.inputEstimate);
  assert.equal(api.estimateCostUsd(null, 1, limits), null);
  assert.equal(api.estimateCostUsd(1, 2, { ...limits, outputPricePerMillion: undefined }), null);
  assert.equal(api.estimateCostUsd(10, 5, limits), 0.00005);
  assert.equal(api.estimateCostUsd(1e300, 2, { ...limits, inputPricePerMillion: 1e300 }), null);
  const model = createModel(fixture('openai'));
  const empty = model.inspectContext([], 'execute'), plan = model.inspectContext([], 'plan');
  assert.ok(empty.systemEstimate > 0 && empty.toolsEstimate > 0 && empty.messagesEstimate > 0);
  assert.ok(empty.toolsEstimate > plan.toolsEstimate, 'Plan 估算必须使用实际筛过的工具列表');
  const withTool = model.inspectContext([...messages, { role: 'tool', toolCallId: 'id', content: 'x'.repeat(5000), isError: true }]);
  assert.ok(withTool.messagesEstimate > empty.messagesEstimate + 1500);
}

/** 在没有 .env 的临时项目中读取配置，不触碰用户真实连接信息。 */
function verifyConfig(readConfig) {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (/^(AGENT_|OPENAI_|ANTHROPIC_)/.test(key)) delete process.env[key];
    Object.assign(process.env, { OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture' });
    assert.deepEqual(readConfig({}).contextLimits, { windowTokens: 32768, outputReserve: 2048, inputPricePerMillion: undefined, outputPricePerMillion: undefined });
    Object.assign(process.env, { AGENT_CONTEXT_WINDOW: '9000', AGENT_OUTPUT_RESERVE: '1000', AGENT_INPUT_PRICE_PER_MILLION: '0.5', AGENT_OUTPUT_PRICE_PER_MILLION: '1.25' });
    assert.equal(readConfig({}).contextLimits.inputPricePerMillion, 0.5);
    for (const value of ['-1', '0', '1.5', '1e4', 'Infinity', '9007199254740992', 'abc']) {
      process.env.AGENT_CONTEXT_WINDOW = value; assert.throws(() => readConfig({}), /正整数/);
    }
    process.env.AGENT_CONTEXT_WINDOW = '9000'; process.env.AGENT_OUTPUT_RESERVE = '9000'; assert.throws(() => readConfig({}), /小于/);
    process.env.AGENT_OUTPUT_RESERVE = '1000'; process.env.AGENT_INPUT_PRICE_PER_MILLION = '-1'; assert.throws(() => readConfig({}), /单价/);
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}

/** 服务商累计用量与估算分开；一次缺失后不再把后面部分用量称作完整总量。 */
async function verifyUsage(core, ui, trace, api) {
  let count = 0; const events = [], history = [];
  const model = {
    inspectContext: messages => api.estimateContext(messages, 'system', [], limits),
    estimateCost: (input, output) => api.estimateCostUsd(input, output, limits),
    async generate() { return ++count === 1 ? result('', [call('todo', 'todo_write', { items: [] })], null, 2) : result('完成', [], 10, 4); },
  };
  const answer = await core.agentLoop(model, history, '计量', signal(), event => events.push(event));
  assert.equal(answer.inputTokens, null); assert.equal(answer.outputTokens, 6);
  const estimates = events.filter(event => event.type === 'context_budget');
  assert.equal(estimates.length, 2);
  for (const estimate of estimates) assert.ok(events.indexOf(estimate) < events.findIndex(event => event.type === 'model_start' && event.call === estimate.call));
  const usages = events.filter(event => event.type === 'model_usage');
  assert.equal(usages.at(-1).inputTokens, null); assert.equal(usages.at(-1).costEstimateUsd, null);
  let view = ui.emptyRunView(); for (const event of events) view = ui.updateRunView(view, event);
  assert.match(view.budget, /本地估算/); assert.match(view.usage, /输入 未知/);
  view = ui.updateRunView(view, { type: 'run_finish', outcome: 'error', message: '后续失败' });
  assert.match(view.usage, /输出 6/);
  assert.match(trace.formatTeachingTrace({ type: 'model_usage', call: 1, inputTokens: 10, outputTokens: 5, costEstimateUsd: 0.00005 }).join(''), /费用估计.*非账单/);
}

/** 头尾裁剪保留完整原文；受控读取可定位中间行与巨行中间列。 */
async function verifyLogs(api, reader, core, sessions, readSession, directory) {
  const original = Array.from({ length: 80 }, (_, i) => `第${i + 1}行-${'🙂'.repeat(400)}`).join('\n');
  const bounded = await api.boundToolResult(original, signal(), directory);
  assert.equal(readFileSync(bounded.logPath, 'utf8'), original);
  assert.match(bounded.content, /工具结果已裁剪/); assert.ok(bounded.content.includes('read_tool_result'));
  assert.ok(!bounded.content.includes('第40行-')); assert.ok(!bounded.content.includes('\ufffd'));
  assert.equal(statSync(bounded.logPath).mode & 0o777, 0o600);
  const middle = await reader.readToolResultTool(JSON.stringify({ id: bounded.logId, offset: 40, limit: 1 }), signal(), directory);
  assert.ok(middle.content.includes('40:1: 第40行-'));
  const giant = 'A'.repeat(6500) + 'FIND_COLUMN_MARKER' + 'B'.repeat(6500);
  const single = await api.boundToolResult(giant, signal(), directory);
  const column = await reader.readToolResultTool(JSON.stringify({ id: single.logId, offset: 1, limit: 1, column: 6400 }), signal(), directory);
  assert.match(column.content, /FIND_COLUMN_MARKER/); assert.match(column.content, /column=7400/);
  for (const args of [{ id: '../secret', offset: 1, limit: 1 }, { id: bounded.logId, offset: 0, limit: 1 }, { id: bounded.logId, offset: 1, limit: 6 }, { id: bounded.logId, offset: 1, limit: 1, path: '/etc/passwd' }]) {
    await assert.rejects(reader.readToolResultTool(JSON.stringify(args), signal(), directory), /需要有效/);
  }
  const linkId = '00000000-0000-4000-8000-000000000001';
  symlinkSync(bounded.logPath, join(directory, `${linkId}.log`));
  await assert.rejects(reader.readToolResultTool(JSON.stringify({ id: linkId, offset: 1, limit: 1 }), signal(), directory), /无法读取/);
  const fifoId = '00000000-0000-4000-8000-000000000002';
  if (process.platform !== 'win32') {
    execFileSync('mkfifo', [join(directory, `${fifoId}.log`)]);
    await assert.rejects(reader.readToolResultTool(JSON.stringify({ id: fifoId, offset: 1, limit: 1 }), signal(), directory), /无法读取/);
  }
  const short = await api.boundToolResult('短输出', signal(), directory); assert.equal(short.logPath, undefined);
  writeFileSync(join(workspace, 'long.txt'), 'context-row\n'.repeat(1800));
  const history = [], observed = []; let count = 0, originalLog;
  const model = { async generate(messages) {
    if (++count === 1) return result('', [call('long', 'read_file', { path: 'long.txt', offset: 1, limit: 400 }), call('missing', 'read_file', { path: 'missing.ts', offset: 1, limit: 2 })]);
    assertPairs(messages);
    const tool = messages.find(message => message.toolCallId === 'long');
    // File reader adds prefixes, so this input exceeds the 8000 original-character clip threshold.
    assert.match(tool.content, /工具结果已裁剪/);
    const id = tool.content.match(/日志编号 ([a-f0-9-]{36})/)[1]; originalLog = readFileSync(join(directory, `${id}.log`), 'utf8');
    assert.ok(originalLog.includes('400: context-row')); assert.ok(!tool.content.includes('200: context-row'));
    assert.equal(messages.find(message => message.toolCallId === 'missing').isError, true);
    return result('已按真实读取结果回答');
  } };
  // Make lines larger while remaining below the inherited 1000-char per-line source limit.
  writeFileSync(join(workspace, 'long.txt'), `${'context-row'.repeat(20)}\n`.repeat(400));
  await core.agentLoop(model, history, '大读取', signal(), event => observed.push(event), undefined, new Set(), { toolResultDirectory: directory });
  assertPairs(history); assert.ok(originalLog);
  assert.ok(observed.filter(event => event.type === 'tool_finish' && event.outcome === 'success').every(event => event.result.content.length < 9000));
  const writer = await sessions.createSessionWriter(join(temporary, 'saved-logs'));
  await writer.save({ messages: history, mode: 'execute', tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, 'run_end'); await writer.close();
  const recovered = await readSession.readSession(writer.id, join(temporary, 'saved-logs'));
  assert.deepEqual(recovered.state.messages, history); assertPairs(recovered.state.messages);

  // A real failed command keeps its nonzero-exit error flag after its long output is clipped.
  let commandCount = 0; const commandHistory = [];
  await core.agentLoop({ async generate() { return ++commandCount === 1 ? result('', [call('cmd', 'run_command', { command: "node -e \"process.stdout.write('x'.repeat(11000));process.exitCode=2\"", cwd: '.' })]) : result('测试失败，已看到退出码'); } }, commandHistory, '测试', signal(), undefined, async () => ({ decision: 'allow_once' }), new Set(), { toolResultDirectory: directory });
  const failed = commandHistory.find(message => message.toolCallId === 'cmd'); assert.equal(failed.isError, true); assert.match(failed.content, /工具结果已裁剪/);
}

/** 保存失败不丢掉已经返回的工具事实，其余调用补成未执行，且不能发下一次请求。 */
async function verifyLogFailure(core, api, directory) {
  const invalid = join(temporary, 'not-directory'); writeFileSync(invalid, 'file');
  let count = 0; const history = [];
  const model = { async generate() { count++; return result('', [call('first', 'read_file', { path: 'long.txt', offset: 1, limit: 400 }), call('never', 'todo_write', { items: [] })]); } };
  await assert.rejects(core.agentLoop(model, history, '保存失败', signal(), undefined, undefined, new Set(), { toolResultDirectory: invalid }), /日志无法保存/);
  assert.equal(count, 1); assertPairs(history);
  const first = history.find(message => message.toolCallId === 'first'), second = history.find(message => message.toolCallId === 'never');
  assert.equal(first.isError, false); assert.match(first.content, /工具已返回.*日志未保存/); assert.ok(!first.content.includes('日志编号'));
  assert.match(second.content, /启动前中断.*未执行/);

  // Block a real write, cancel while it is in flight, then prove cleanup waits and leaves no half-log reference.
  const probe = await open(join(directory, 'prototype-probe'), 'wx'), prototype = Object.getPrototypeOf(probe); await probe.close(); rmSync(join(directory, 'prototype-probe'));
  const previous = prototype.writeFile, entered = gate(), release = gate();
  let settled = false;
  prototype.writeFile = async function(data, ...args) { if (typeof data === 'string' && data.startsWith('1: context-row')) { entered.resolve(); await release.promise; } return previous.call(this, data, ...args); };
  const controller = new AbortController(), cancelledHistory = [];
  const pending = core.agentLoop(model, cancelledHistory, '取消保存', controller.signal, undefined, undefined, new Set(), { toolResultDirectory: directory }).finally(() => { settled = true; });
  try {
    await entered.promise; controller.abort(); await tick(); assert.equal(settled, false, '取消不等于在途写入已清理');
    release.resolve(); await assert.rejects(pending, { name: 'AbortError' });
    assertPairs(cancelledHistory);
    assert.match(cancelledHistory.find(message => message.toolCallId === 'first').content, /工具已返回/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { release.resolve(); prototype.writeFile = previous; }
}

/** 一批结果全部完成后，下一次才检查预算；超限历史保留且不启动下一请求。 */
async function verifyEnforcement(core, api) {
  let requests = 0, inspections = 0; const events = [], history = [{ role: 'user', content: '已有上下文' }, { role: 'assistant', content: '已有回答' }];
  const model = {
    inspectContext(messages) {
      const budget = api.estimateContext(messages, 'system', [], limits);
      if (++inspections === 2) {
        assertPairs(messages); assert.equal(messages.filter(message => message.role === 'tool').length, 2);
        return { ...budget, withinBudget: false, inputEstimate: limits.windowTokens, remainingEstimate: -limits.outputReserve };
      }
      return budget;
    },
    async generate() { requests++; return result('', [call('a', 'read_file', { path: 'a.ts', offset: 1, limit: 1 }), call('b', 'read_file', { path: 'missing.ts', offset: 1, limit: 1 })]); },
  };
  writeFileSync(join(workspace, 'a.ts'), 'export const a = 1;');
  await assert.rejects(core.agentLoop(model, history, '工具后超限', signal(), event => events.push(event)), /本次请求未发送.*历史已保留/);
  assert.equal(requests, 1); assert.equal(inspections, 2); assert.equal(events.filter(event => event.type === 'model_start').length, 1);
  assert.equal(events.filter(event => event.type === 'tool_finish').length, 2);
  assert.equal(history[0].content, '已有上下文'); assert.ok(history.find(message => message.toolCallId === 'b').isError); assertPairs(history);
  const before = frames.length;
  const real = (await import(pathToFileURL(join(temporary, '03-enforce-budget/dist/models/client.js')).href)).createModel(fixture('openai'));
  await assert.rejects(core.agentLoop(real, history, '汉'.repeat(100000), signal()), /预算不足/);
  await assert.rejects(real.generate([{ role: 'user', content: 'x'.repeat(300000) }], signal()), /本次请求未发送/);
  assert.equal(frames.length, before, '本地超限必须在任何 HTTP 之前停止'); assertPairs(history);
}

/** JSONL 机器入口新增事件仍逐条合法 JSON，过程不混进 stdout 自然语言。 */
async function verifyJsonl(dist) {
  handler = (_body, response) => answerStream('openai', response);
  const env = { ...process.env, AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: baseURL, AGENT_CONTEXT_WINDOW: '32768', AGENT_OUTPUT_RESERVE: '777', AGENT_INPUT_PRICE_PER_MILLION: '2', AGENT_OUTPUT_PRICE_PER_MILLION: '6' };
  const child = spawn(process.execPath, [join(dist, 'cli.js'), '--prompt', 'JSONL校验', '--output', 'jsonl'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, stderr);
  const records = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(records.every((record, i) => record.version === 1 && record.sequence === i + 1));
  assert.ok(records.some(record => record.event.type === 'context_budget'));
  assert.equal(records.find(record => record.event.type === 'model_usage').event.inputTokens, 17);
  assert.equal(records.at(-1).event.outcome, 'completed');
  assert.equal(frames.at(-1).max_completion_tokens, 777);
}

try {
  process.chdir(workspace);
  let last;
  for (const [index, lesson] of ['01-estimate-tokens', '02-bound-tool-results', '03-enforce-budget'].entries()) {
    const dist = compile(lesson), load = path => import(pathToFileURL(join(dist, path)).href);
    const modelApi = await load('models/client.js'), api = await load('context/budget.js');
    const core = await load('agent/agent-loop.js'), ui = await load('ui/tui/state.js'), trace = await load('ui/teaching-trace.js');
    verifyEstimate(api, modelApi.createModel); verifyConfig((await load('config/load-config.js')).readConfig);
    await verifyUsage(core, ui, trace, api);
    for (const provider of ['openai', 'anthropic']) {
      handler = (_body, response) => answerStream(provider, response);
      const model = modelApi.createModel(fixture(provider)), events = [];
      const answer = await core.agentLoop(model, [], '估算与usage', signal(), event => events.push(event));
      assert.equal(answer.inputTokens, 17); assert.equal(answer.outputTokens, 4);
      assert.equal(frames.at(-1)[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'], 777);
      assert.equal(events.find(event => event.type === 'model_usage').costEstimateUsd, (17 * 2 + 4 * 6) / 1e6);
      if (index < 2) {
        const observeOnly = modelApi.createModel({ ...fixture(provider), contextLimits: { windowTokens: 2, outputReserve: 1 } });
        await observeOnly.generate([{ role: 'user', content: '阶段1/2仅观察，尚无发送门' }], signal());
      }
    }
    if (index >= 1) {
      const logs = await load('context/tool-results.js'), reader = await load('tools/read-tool-result.js');
      const directory = join(temporary, `logs-${index}`), cancelled = join(temporary, `cancelled-${index}`); mkdirSync(cancelled);
      await verifyLogs(logs, reader, core, await load('sessions/save-session.js'), await load('sessions/read-session.js'), directory);
      await verifyLogFailure(core, logs, cancelled);
      // Oversized files must fail even if lstat is bypassed by a later growth; fixed buffers cap the read itself.
      const largeId = '00000000-0000-4000-8000-000000000003';
      writeFileSync(join(directory, `${largeId}.log`), Buffer.alloc(16 * 1024 * 1024 + 1, 65));
      await assert.rejects(reader.readToolResultTool(JSON.stringify({ id: largeId, offset: 1, limit: 1 }), signal(), directory), /超过 16 MiB/);
      const handle = await open(join(directory, `${largeId}.log`)), prototype = Object.getPrototypeOf(handle); await handle.close();
      const previousStat = prototype.stat;
      prototype.stat = async function(...args) { const actual = await previousStat.apply(this, args); return Object.assign(actual, { size: 16 * 1024 * 1024 }); };
      try {
        await assert.rejects(reader.readToolResultTool(JSON.stringify({ id: largeId, offset: 1, limit: 1 }), signal(), directory), /超过 16 MiB/, '即使 stat 后文件增长，读取本身也有硬上限');
      } finally { prototype.stat = previousStat; }
      const decision = await (await load('permissions/policy.js')).decideToolPermission(call('log', 'read_tool_result', { id: largeId, offset: 1, limit: 1 }), new Set(), workspace, 'plan');
      assert.equal(decision.action, 'allow');
    }
    if (index === 2) { await verifyEnforcement(core, api); await verifyJsonl(dist); }
    console.log(`✓ 15.${index + 1}：独立编译、完整输入估算、协议输出上限、usage/费用区分${index >= 1 ? '、完整日志定位/裁剪/失败清理' : ''}${index === 2 ? '、发送前预算与 JSONL' : ''}通过`);
    last = dist;
  }
  assert.ok(existsSync(join(last, 'sessions/file-checkpoints.js')), '15章完整继承14章文件检查点');
} finally {
  process.chdir(previousCwd); server.closeAllConnections(); await new Promise(done => server.close(done));
  rmSync(temporary, { recursive: true, force: true });
}
