/** 13.3/13.4：真实 CLI + 本地 HTTP，验证恢复上下文、无重放与本地管理。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from './verify-chat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'hello-agent-resume-'));
const previous = process.cwd();
const directory = join(temp, 'sessions'), workspace = join(temp, 'workspace');
const state = { messages: [
  { role: 'user', content: '读取加法文件，记住青柠' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'read-old', name: 'read_file', arguments: '{"path":"src/add.ts"}' }] },
  { role: 'tool', toolCallId: 'read-old', content: 'export const add = (a: number, b: number) => a + b;', isError: false },
  { role: 'assistant', content: '已读取青柠项目' },
], mode: 'plan', tasks: [{ id: 'test', text: '检查负数', status: 'pending' }], pendingInputs: [{ id: 7, text: '旧任务未交付的要求', run: 3 }], run: 3, nextInputId: 8 };
let server;
try {
  mkdirSync(workspace);
  writeFileSync(join(temp, 'package.json'), '{"type":"module","version":"0.0.0"}');
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'));
  const source = join(root, 'chapter-13-session-persistence/04-manage-sessions/src'), dist = join(temp, 'dist');
  const config = join(temp, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist, typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const load = file => import(pathToFileURL(join(dist, file)).href);
  const storage = await load('sessions/save-session.js'), reader = await load('sessions/read-session.js');
  const management = await load('sessions/manage-sessions.js');
  process.chdir(workspace);
  const writer = await storage.createSessionWriter(directory), id = writer.id;
  await writer.save(state, 'run_end');
  const file = writer.path;
  await writer.close();
  process.chdir(previous);
  const cli = join(dist, 'cli.js');
  const invoke = (args, env = {}, input = '', cwd = workspace) => runCli(process.execPath, [cli, ...args, '--session-dir', directory], cwd, { HOME: temp, ...env }, input);
  const requests = [];
  let beganOnDisk = false;
  server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const current = await reader.readSession(id, directory);
    beganOnDisk = current.lastReason === 'run_start' && current.state.run === 4;
    response.setHeader('content-type', 'text/event-stream');
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model };
    for (const choice of [
      { index: 0, delta: { role: 'assistant', content: '记得青柠，等待检查负数' }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]) response.write(`data: ${JSON.stringify({ ...base, choices: [choice], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { OPENAI_API_KEY: 'local-fixture', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };

  const emptyResume = await invoke(['--resume', '', '--prompt', '不能另建会话'], env);
  assert.equal(emptyResume.status, 1); assert.match(emptyResume.stderr, /ID|编号|UUID/);
  assert.equal(requests.length, 0, '空恢复编号不能变成新任务');
  const emptyJson = await invoke(['--resume', '', '--output', 'jsonl', '--prompt', '不能恢复'], env);
  assert.equal(emptyJson.status, 1); assert.match(emptyJson.stderr, /text|tui/);
  const list = await invoke(['--sessions']);
  assert.equal(list.status, 0, list.stderr); assert.match(list.stdout, new RegExp(id));
  assert.match(list.stdout, /青柠/); assert.equal(requests.length, 0);
  const held = await storage.resumeSessionWriter(id, directory);
  try {
    const busy = await invoke(['--resume', id, '--prompt', '不要发送'], env);
    assert.equal(busy.status, 1); assert.match(busy.stderr, /锁|占用/); assert.equal(requests.length, 0);
    const busyRename = await invoke(['--rename', id, '--name', '忙碌时禁止改名']);
    assert.equal(busyRename.status, 1); assert.match(busyRename.stderr, /锁|占用/);
  } finally { await held.close(); }
  const other = join(temp, 'other'); mkdirSync(other);
  const mismatch = await invoke(['--resume', id, '--prompt', '不要发送'], env, '', other);
  assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /工作区不同/);
  assert.equal(requests.length, 0); assert.ok(!existsSync(join(directory, `${id}.lock`)));
  const idle = await invoke(['--resume', id, '--output', 'text'], env, '/exit\n');
  assert.equal(idle.status, 0, idle.stderr); assert.equal(requests.length, 0, '只恢复并退出不能调用模型');
  const resumed = await invoke(['--resume', id, '--prompt', '还记得什么？'], env);
  assert.equal(resumed.status, 0, resumed.stderr); assert.match(resumed.stdout, /青柠/);
  assert.equal(requests.length, 1, '只发送新任务，不重跑历史工具');
  assert.equal(beganOnDisk, true, '外部请求前 run_start 已保存');
  const messages = requests[0].messages.filter(message => message.role !== 'system');
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'user']);
  assert.equal(messages[2].tool_call_id, 'read-old');
  assert.ok(!JSON.stringify(messages).includes('旧任务未交付的要求'));
  const restored = await reader.readSession(id, directory);
  assert.equal(restored.state.mode, 'plan'); assert.equal(restored.state.run, 4);
  assert.equal(restored.state.nextInputId, 8); assert.deepEqual(restored.state.pendingInputs, state.pendingInputs);
  assert.deepEqual(restored.state.tasks, state.tasks); assert.equal(restored.interrupted, false);
  assert.ok(!existsSync(join(directory, `${id}.lock`)));

  const renamed = await invoke(['--rename', id, '--name', '青柠加法']);
  assert.equal(renamed.status, 0, renamed.stderr);
  const nameRecord = await reader.readSession(id, directory);
  assert.equal(nameRecord.name, '青柠加法'); assert.deepEqual(nameRecord.state, restored.state);
  assert.ok(nameRecord.seq > restored.seq);
  const selected = await invoke(['--sessions', '--search', '青柠加法']);
  assert.match(selected.stdout, /青柠加法/);
  const missing = await invoke(['--sessions', '--search', '查不到的词']); assert.ok(!missing.stdout.includes(id));
  assert.equal((await invoke(['--rename', id, '--name', 'bad\nname'])).status, 1);
  assert.equal((await invoke(['--sessions', '--resume', id], env)).status, 1);
  assert.equal((await invoke(['--search', '青柠'])).status, 1);
  assert.equal((await invoke(['--recover'])).status, 1);
  const output = join(temp, 'export.md');
  const exported = await invoke(['--export', id, '--export-to', output]); assert.equal(exported.status, 0, exported.stderr);
  const copy = readFileSync(output, 'utf8'); assert.match(copy, /read-old/); assert.match(copy, /旧任务未交付/); assert.match(copy, /任务 3/);
  assert.equal((await invoke(['--export', id, '--export-to', output])).status, 1);
  assert.equal(readFileSync(output, 'utf8'), copy, '重复导出不能覆盖已有笔记');
  assert.equal((await invoke(['--export', id])).stdout, copy);
  assert.equal(requests.length, 1, '管理操作没有模型请求');
  const before = readFileSync(file, 'utf8');
  await management.exportSession(id, directory);
  assert.equal(readFileSync(file, 'utf8'), before, '导出只读');
  writeFileSync(join(directory, 'bad.jsonl'), 'broken\n');
  const withBad = await invoke(['--sessions']); assert.equal(withBad.status, 0); assert.match(withBad.stdout, new RegExp(id)); assert.match(withBad.stderr, /bad.jsonl/);
  appendFileSync(file, '{"partial":');
  const fragment = await invoke(['--resume', id, '--prompt', '禁止无确认恢复'], env);
  assert.equal(fragment.status, 1); assert.equal(requests.length, 1);
  console.log('✓ 13.3/13.4：CLI恢复、开始前落盘、旧工具不重放、旧队列归属、工作区、独占命名、本地搜索与无覆盖导出通过');
} finally {
  process.chdir(previous);
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  rmSync(temp, { recursive: true, force: true });
}
