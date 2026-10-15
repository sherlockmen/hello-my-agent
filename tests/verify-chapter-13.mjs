/** 第十三章 13.1：临时目录、内存模型、真实文件句柄；不访问 API 或用户会话目录。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'hello-agent-check-13-'));
const previousCwd = process.cwd();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (text, toolCalls = []) => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', inputTokens: 1, outputTokens: 1, truncated: false });
const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
const state = (messages = []) => ({ messages, mode: 'execute', tasks: [], pendingInputs: [], run: 0, nextInputId: 1 });
const records = path => readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));

/** 工具调用必须逐一匹配结果，屏幕日志不能替代这种模型消息关系。 */
function assertToolPairs(messages) {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    const results = messages.slice(index + 1, index + 1 + message.toolCalls.length);
    assert.ok(results.every(result => result.role === 'tool'));
    assert.deepEqual(results.map(result => result.toolCallId), message.toolCalls.map(request => request.id));
  }
}

/** 用真实 writeFile/sync 的门闩验证调用时复制、串行写入、成功边界与关闭等待。 */
async function verifySerialStorage(api, prototype, directory) {
  const writer = await api.createSessionWriter(directory);
  const other = await api.createSessionWriter(directory);
  assert.notEqual(writer.id, other.id);
  assert.match(writer.id, /^[a-f0-9-]{36}$/);
  assert.equal(writer.path, join(directory, `${writer.id}.jsonl`));
  await other.close();
  const metadata = records(writer.path);
  assert.equal(metadata.length, 1);
  assert.deepEqual(Object.keys(metadata[0]), ['version', 'type', 'sessionId', 'createdAt', 'cwd']);
  assert.equal(metadata[0].type, 'session');
  assert.equal(metadata[0].version, 1);
  if (process.platform !== 'win32') {
    assert.equal(statSync(writer.path).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
  }
  const originals = { writeFile: prototype.writeFile, sync: prototype.sync };
  const writeGate = deferred(), syncGate = deferred(), started = deferred(), syncing = deferred();
  let checkpointHandle, writes = 0, closed = false;
  prototype.writeFile = async function(data, ...args) {
    const record = typeof data === 'string' ? JSON.parse(data) : undefined;
    if (record?.sessionId === writer.id && record.type === 'checkpoint') {
      checkpointHandle = this;
      if (++writes === 1) { started.resolve(); await writeGate.promise; }
    }
    return originals.writeFile.call(this, data, ...args);
  };
  prototype.sync = async function(...args) {
    if (this === checkpointHandle && writes === 1) { syncing.resolve(); await syncGate.promise; }
    return originals.sync.apply(this, args);
  };
  try {
    const first = {
      ...state([{ role: 'user', content: '第一行\n第二行', apiKey: 'CONFIG_SECRET' }, { role: 'assistant', content: '', toolCalls: [{ ...call('tool', 'todo_write', {}), extra: 'CONFIG_SECRET' }] }, { role: 'tool', toolCallId: 'tool', content: '工具正文', isError: false }]),
      tasks: [{ id: 'task', text: '检查', status: 'pending', extra: 'CONFIG_SECRET' }],
      pendingInputs: [{ id: 7, text: '尚未交付', run: 3, extra: 'CONFIG_SECRET' }], run: 3, nextInputId: 8,
      config: { apiKey: 'CONFIG_SECRET' }, grants: ['ACCESS_GRANT'], entries: ['SCREEN_EVENT'], draft: 'UNSENT_DRAFT',
    };
    let firstSaved = false, secondSaved = false;
    const a = writer.save(first, 'run_end').then(seq => { firstSaved = true; return seq; });
    first.messages[0].content = '之后改变';
    first.messages[1].toolCalls[0].arguments = '{"later":true}';
    first.tasks[0].status = 'completed';
    first.pendingInputs[0].text = '之后编辑';
    const b = writer.save(first, 'queue_change').then(seq => { secondSaved = true; return seq; });
    const closing = writer.close();
    closing.then(() => { closed = true; });
    await assert.rejects(writer.save(first, 'exit'), /关闭/);
    await started.promise;
    assert.equal(writes, 1, '第二次保存不能与第一条同文件写入并行');
    assert.equal(firstSaved, false);
    assert.equal(closed, false, 'close 必须等已排队保存');
    writeGate.resolve();
    await syncing.promise;
    assert.equal(firstSaved, false, 'writeFile 完成不能提前报告已保存，仍需等 sync');
    assert.equal(secondSaved, false);
    syncGate.resolve();
    assert.deepEqual(await Promise.all([a, b]), [1, 2]);
    await closing;
    assert.equal(closed, true);
    assert.equal(checkpointHandle.fd, -1, '真实句柄已经关闭');
    assert.equal(writer.close(), closing, '重复 close 共享同一 Promise');
  } finally { Object.assign(prototype, originals); writeGate.resolve(); syncGate.resolve(); await writer.close(); }
  const saved = records(writer.path);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.slice(1).map(row => row.seq), [1, 2]);
  assert.ok(saved.every(row => row.version === 1 && row.sessionId === writer.id));
  assert.equal(saved[1].state.messages[0].content, '第一行\n第二行');
  assert.equal(saved[2].state.messages[0].content, '之后改变');
  assert.equal(saved[1].state.messages[1].toolCalls[0].arguments, '{}');
  assert.equal(saved[1].state.tasks[0].status, 'pending');
  assert.equal(saved[1].state.pendingInputs[0].text, '尚未交付');
  assert.equal(saved[2].state.pendingInputs[0].text, '之后编辑');
  assert.equal(saved[1].state.nextInputId, 8);
  assert.ok(!saved[1].state.messages.some(message => message.content === '尚未交付'));
  const text = readFileSync(writer.path, 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.equal(text.split('\n').length, 4, '正文换行由 JSON 转义，不能拆成多条记录');
  for (const forbidden of ['CONFIG_SECRET', 'ACCESS_GRANT', 'SCREEN_EVENT', 'UNSENT_DRAFT']) assert.ok(!text.includes(forbidden));
}

/** 模拟半行 append 失败或完整行后的 sync 失败，确保停写且 close 不受失败 tail 阻挡。 */
async function verifyFailedStorage(api, prototype, directory, phase) {
  const writer = await api.createSessionWriter(directory);
  const originals = { writeFile: prototype.writeFile, sync: prototype.sync };
  let writes = 0, checkpointHandle;
  const failure = Object.assign(new Error('RAW_SECRET_SHOULD_NOT_APPEAR'), { code: phase === 'append' ? 'EACCES' : 'ENOSPC' });
  prototype.writeFile = async function(data, ...args) {
    if (typeof data === 'string' && data.includes('"type":"checkpoint"')) {
      checkpointHandle = this; writes++;
      if (phase === 'append') { await originals.writeFile.call(this, data.slice(0, 30), ...args); throw failure; }
    }
    return originals.writeFile.call(this, data, ...args);
  };
  prototype.sync = async function(...args) { if (this === checkpointHandle && phase === 'sync') throw failure; return originals.sync.apply(this, args); };
  try {
    const a = api.saveSessionCheckpoint(writer, state([{ role: 'user', content: '第一轮' }]), 'run_end');
    const b = api.saveSessionCheckpoint(writer, state([{ role: 'user', content: '第二轮' }]), 'run_end');
    const closing = writer.close();
    const results = await Promise.all([a, b]);
    assert.ok(results.every(result => !result.ok && result.message.includes('内存会话仍可继续') && result.message.includes('停止追加')));
    assert.ok(results.every(result => !result.message.includes('RAW_SECRET')));
    assert.equal(writes, 1, '失败后的队列不得继续追加');
    await closing;
    assert.equal(checkpointHandle.fd, -1, '失败后仍必须关闭真实句柄');
  } finally { Object.assign(prototype, originals); await writer.close(); }
  const text = readFileSync(writer.path, 'utf8');
  assert.ok(!text.includes('第二轮'));
  if (phase === 'append') assert.throws(() => records(writer.path), SyntaxError, '13.1 留下损坏尾行，不假装已经修复');
  else assert.equal(records(writer.path).length, 2, 'sync 失败即使有完整字节也不得承认已保存');
}

/** 真实核心完成和中断后保存真实 Message[]；工具 pairing 与清单不从屏幕推断。 */
async function verifyCommittedHistory(api, core, directory) {
  const writer = await api.createSessionWriter(directory);
  const history = [], tasks = { items: [] }, events = [];
  let calls = 0;
  const model = { async generate(messages, signal) {
    signal.throwIfAborted();
    if (calls++ === 0) return reply('', [call('todo', 'todo_write', { items: [{ id: 'a', text: '测试保存', status: 'completed' }] }), call('ask', 'ask_user', { question: '保存格式？', choices: ['JSONL'] })]);
    assertToolPairs(messages);
    return reply('已完成\n完整正文');
  } };
  for await (const record of core.streamAgentRun(model, history, '测试工具', new AbortController().signal, undefined, new Set(['PRIVATE_GRANT']), { mode: 'plan', tasks, askUser: async () => 'JSONL' })) events.push(record);
  assertToolPairs(history);
  const pendingInputs = [{ id: 9, text: '另一轮未交付', run: 4 }];
  await writer.save({ messages: history, mode: 'plan', tasks: tasks.items, pendingInputs, run: 4, nextInputId: 10 }, 'run_end');
  const controller = new AbortController();
  let cancelCalls = 0;
  await assert.rejects(core.agentLoop({ async generate() { cancelCalls++; return reply('', [call('wait', 'ask_user', { question: '继续？', choices: [] }), call('not-run', 'todo_write', { items: [] })]); } }, history, '取消问答', controller.signal, undefined, undefined, new Set(), {
    tasks, askUser: async (_request, signal) => { controller.abort(); signal.throwIfAborted(); },
  }), { name: 'AbortError' });
  assert.equal(cancelCalls, 1);
  assertToolPairs(history);
  await writer.save({ messages: history, mode: 'plan', tasks: tasks.items, pendingInputs, run: 5, nextInputId: 10 }, 'run_end');
  await assert.rejects(core.agentLoop({ async generate() { throw new Error('MODEL_FAILED'); } }, history, '模型失败', new AbortController().signal));
  await writer.save({ messages: history, mode: 'plan', tasks: tasks.items, pendingInputs, run: 6, nextInputId: 10 }, 'run_end');
  await writer.close();
  const saved = records(writer.path).slice(1);
  assert.equal(saved[0].state.messages.at(-1).content, '已完成\n完整正文');
  assert.equal(saved[0].state.tasks[0].status, 'completed');
  assert.ok(saved[1].state.messages.at(-1).content.includes('取消'));
  assert.ok(saved[2].state.messages.at(-1).content.includes('中断'));
  saved.forEach(record => assertToolPairs(record.state.messages));
  assert.ok(!readFileSync(writer.path, 'utf8').includes('PRIVATE_GRANT'));
  assert.ok(events.some(record => record.event.type === 'run_finish'));
  assert.ok(!readFileSync(writer.path, 'utf8').includes('"event"'), 'AgentRecord 不作为存储记录');
}

/** 文本消费者用本地模型逐次保存命令和任务；帮助与诊断不创建存储或请求模型。 */
function verifyTextAndCli(dist, directory) {
  const harness = join(temp, 'text.mjs');
  writeFileSync(harness, `import {startTerminal} from './dist/ui/terminal.js';\nimport {createSessionWriter} from './dist/sessions/save-session.js';\nconst writer=await createSessionWriter(process.argv[2]);\ntry{await startTerminal({async generate(){return ${JSON.stringify(reply('本地回答'))};}},{},writer);}finally{await writer.close();}\n`);
  const result = execFileSync(process.execPath, [harness, directory], { input: '/mode plan\n提问\n/reset\n/exit\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: temp });
  assert.ok(result.includes('本地回答'));
  const file = execFileSync(process.execPath, ['--input-type=module', '-e', "import {readdirSync} from 'node:fs';console.log(readdirSync(process.argv[1])[0]);", directory], { encoding: 'utf8' }).trim();
  const saved = records(join(directory, file));
  assert.deepEqual(saved.slice(1).map(row => row.reason), ['mode', 'run_end', 'reset', 'exit']);
  assert.equal(saved[1].state.mode, 'plan');
  assert.equal(saved[2].state.messages.at(-1).content, '本地回答');
  assert.deepEqual(saved[3].state.messages, []);
  assert.deepEqual(saved[4].state.messages, []);
  const cli = join(dist, 'cli.js');
  const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', cwd: temp });
  assert.ok(help.includes('--session-dir'));
  assert.ok(execFileSync(process.execPath, [cli, '--doctor'], { encoding: 'utf8', cwd: temp }).includes('Working directory:'));
  assert.throws(() => execFileSync(process.execPath, [cli, '--output', 'jsonl', '--prompt', 'test', '--session-dir', directory], { cwd: temp, stdio: 'pipe' }), error => error.status === 1 && error.stderr.toString().includes('JSONL 机器输出暂不保存会话'));
}

try {
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'module', version: '0.0.0' }));
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'));
  const source = join(root, 'chapter-13-session-persistence/01-save-session/src');
  const dist = join(temp, 'dist');
  const config = join(temp, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist, typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const load = file => import(pathToFileURL(join(dist, file)).href);
  const api = await load('sessions/save-session.js');
  const core = { ...(await load('agent/agent-loop.js')), ...(await load('agent/run-stream.js')) };
  const probe = await open(join(temp, 'probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const workspace = join(temp, 'workspace'); mkdirSync(workspace); writeFileSync(join(workspace, 'package.json'), '{}');
  process.chdir(workspace);
  await verifySerialStorage(api, prototype, join(temp, 'serial'));
  await verifyFailedStorage(api, prototype, join(temp, 'append-failure'), 'append');
  await verifyFailedStorage(api, prototype, join(temp, 'sync-failure'), 'sync');
  const badDirectory = join(temp, 'not-a-directory'); writeFileSync(badDirectory, 'file');
  await assert.rejects(api.createSessionWriter(badDirectory), /无法创建会话文件/);
  assert.ok(!api.explainSessionError(new Error('CONFIG_SECRET')).includes('CONFIG_SECRET'));
  await verifyCommittedHistory(api, core, join(temp, 'history'));
  verifyTextAndCli(dist, join(temp, 'text-sessions'));
  await tick();
  console.log('✓ 13.1：独立编译、白名单快照、串行 sync、失败停写、工具配对与文本入口通过');
} finally {
  process.chdir(previousCwd);
  rmSync(temp, { recursive: true, force: true });
}
