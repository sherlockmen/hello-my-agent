/** 第十三章 13.2/13.3：临时文件里的读取、恢复和独占写入；不接入模型服务。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'hello-agent-records-'));
const directory = join(temp, 'sessions');
mkdirSync(directory);
const stamp = '2026-10-15T00:00:00.000Z';
const later = '2026-10-15T01:00:00.000Z';
const state = (overrides = {}) => ({ messages: [], mode: 'execute', tasks: [], pendingInputs: [], run: 0, nextInputId: 1, ...overrides });
const checkpoint = (value = state(), reason = 'run_end') => ({ type: 'checkpoint', reason, state: value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const lockPath = id => join(directory, `${id}.lock`);
let checks = 0;

/** 每份夹具有独立 UUID；完整行与最后残片分开构造，避免测试替程序补上换行。 */
function fixture(body = [], tail = '', header = {}) {
  const id = randomUUID();
  const rows = [{ version: 1, type: 'session', sessionId: id, createdAt: stamp, cwd: root, ...header },
    ...body.map((record, index) => ({ version: 1, sessionId: id, seq: index + 1, savedAt: stamp, ...record }))];
  const path = join(directory, `${id}.jsonl`);
  writeFileSync(path, Buffer.concat([Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'), Buffer.from(tail)]));
  return { id, path, rows };
}

/** 单独编译存储入口，确保本测试不依赖已生成的 dist 或根 CLI 注册。 */
async function compile(section, label) {
  const source = join(root, `chapter-13-session-persistence/${section}/src`);
  const output = join(temp, label);
  const config = join(temp, `${label}.json`);
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: {
    noEmit: false, rootDir: source, outDir: output, typeRoots: [join(root, 'node_modules/@types')],
  }, include: [join(source, 'sessions/*.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { cwd: root, stdio: 'pipe' });
  const reader = await import(pathToFileURL(join(output, 'sessions/read-session.js')));
  const writer = await import(pathToFileURL(join(output, 'sessions/save-session.js')));
  return { ...reader, ...writer };
}

/** 错误必须停止读取且保留原字节，不能跳过一条完整坏行后继续采用后面的状态。 */
async function rejectsUnchanged(api, sample, pattern = /完整记录|UTF-8|会话头|超过|普通文件/) {
  const original = readFileSync(sample.path);
  await assert.rejects(api.readSession(sample.id, directory), pattern);
  assert.deepEqual(readFileSync(sample.path), original);
  checks++;
}

/** 读取器在两节都运行同一组真实 JSONL 夹具，覆盖旧头、新头和严格状态关系。 */
async function verifyReader(api) {
  for (const id of ['../escape', '/tmp/file', 'abc.jsonl', 'A'.repeat(36), '']) {
    await assert.rejects(api.readSession(id, directory), /完整的小写 UUID/);
    checks++;
  }
  const empty = fixture();
  const headerOnly = await api.readSession(empty.id, directory);
  assert.equal(headerOnly.seq, 0);
  assert.equal(headerOnly.state, undefined);
  assert.equal(headerOnly.updatedAt, stamp);
  assert.equal(headerOnly.interrupted, false);
  checks++;
  const messages = [
    { role: 'user', content: '读取两个文件' },
    { role: 'assistant', content: '', toolCalls: [
      { id: 'a', name: 'read_file', arguments: '{"path":"src/add.ts"}' },
      { id: 'b', name: 'read_file', arguments: '{"path":"tests/add.test.ts"}' },
    ] },
    { role: 'tool', toolCallId: 'a', content: 'export const add = (a,b) => a+b;', isError: false },
    { role: 'tool', toolCallId: 'b', content: '文件不存在', isError: true },
  ];
  const complete = state({ messages, mode: 'plan', tasks: [{ id: 'test', text: '补充负数测试', status: 'pending' }],
    pendingInputs: [{ id: 4, text: '测试 -2 + -3', run: 2 }, { id: 5, text: '测试 0 + 0', run: 2 }], run: 3, nextInputId: 6 });
  const good = fixture([checkpoint(complete)], '', { workspace: root });
  const result = await api.readSession(good.id, directory);
  assert.deepEqual(result.state, complete);
  assert.equal(result.header.workspace, root);
  assert.equal(result.seq, 1);
  assert.equal(result.validBytes, statSync(good.path).size);
  assert.equal(result.hasTrailingFragment, false);
  checks++;
  const fragment = fixture([checkpoint(complete)], '{"version":1,"type":"checkpoint"');
  const original = readFileSync(fragment.path);
  const prefix = await api.readSession(fragment.id, directory);
  assert.equal(prefix.seq, 1);
  assert.deepEqual(prefix.state, complete);
  assert.equal(prefix.hasTrailingFragment, true);
  assert.equal(prefix.warnings.length, 1);
  assert.deepEqual(readFileSync(fragment.path), original);
  checks++;
  const completeWithoutNewline = fixture([], JSON.stringify({ type: 'unsupported', version: 999 }));
  assert.equal((await api.readSession(completeWithoutNewline.id, directory)).seq, 0);
  checks++;
  const utf8Tail = fixture([checkpoint()], Buffer.from([0xe4, 0xb8]));
  assert.equal((await api.readSession(utf8Tail.id, directory)).hasTrailingFragment, true);
  checks++;
  const interrupted = fixture([checkpoint(state({ run: 1 }), 'run_start'),
    { type: 'name', name: '待核对的加法任务', savedAt: later }, checkpoint(state({ run: 1 }), 'queue_change')]);
  const running = await api.readSession(interrupted.id, directory);
  assert.equal(running.interrupted, true, '队列变化和改名不能掩盖未结束任务');
  assert.equal(running.lastReason, 'queue_change');
  assert.equal(running.name, '待核对的加法任务');
  assert.equal(running.seq, 3);
  assert.equal(running.warnings.length, 1);
  checks++;
  const named = fixture([checkpoint(complete), { type: 'name', name: '加法修复', savedAt: later }]);
  const renamed = await api.readSession(named.id, directory);
  assert.deepEqual(renamed.state, complete);
  assert.equal(renamed.lastReason, 'run_end');
  assert.equal(renamed.updatedAt, later);
  checks++;
  await rejectsUnchanged(api, fixture([], '', { version: 2 }));
  await rejectsUnchanged(api, fixture([checkpoint(), { ...checkpoint(), version: 2 }]));
  await rejectsUnchanged(api, fixture([{ ...checkpoint(), unknown: '不能带入' }]));
  await rejectsUnchanged(api, fixture([{ ...checkpoint(), seq: 2 }]));
  await rejectsUnchanged(api, fixture([{ ...checkpoint(), sessionId: randomUUID() }]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ mode: 'admin' }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ config: { apiKey: '不应恢复' } }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ run: 2 })), checkpoint(state({ run: 1 }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ nextInputId: 5 })), checkpoint(state({ nextInputId: 4 }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ run: 1, nextInputId: 2, pendingInputs: [{ id: 2, text: '碰撞', run: 1 }] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ run: 1, nextInputId: 3, pendingInputs: [{ id: 1, text: '错任务', run: 2 }] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ tasks: [{ id: 'a', text: '一', status: 'in_progress' }, { id: 'b', text: '二', status: 'in_progress' }] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ messages: [messages[1], messages[3], messages[2]] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ messages: [messages[1], messages[2]] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ messages: [messages[2]] }))]));
  await rejectsUnchanged(api, fixture([checkpoint(state({ messages: [{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: '[]' }] }, messages[2]] }))]));
  const middle = fixture([checkpoint(), checkpoint()]);
  const lines = readFileSync(middle.path, 'utf8').split('\n');
  lines.splice(2, 0, '{broken');
  writeFileSync(middle.path, lines.join('\n'));
  await rejectsUnchanged(api, middle);
  const invalidUtf8 = fixture();
  writeFileSync(invalidUtf8.path, Buffer.concat([readFileSync(invalidUtf8.path), Buffer.from([0xff, 10])]));
  await rejectsUnchanged(api, invalidUtf8);
  const huge = fixture();
  truncateSync(huge.path, api.MAX_SESSION_BYTES + 1);
  await assert.rejects(api.readSession(huge.id, directory), /超过 64 MiB/);
  checks++;
  const linked = fixture();
  const target = join(directory, `${randomUUID()}.jsonl`);
  writeFileSync(target, readFileSync(linked.path));
  unlinkSync(linked.path);
  symlinkSync(target, linked.path);
  await rejectsUnchanged(api, linked, /普通文件/);
}

/** 保存和改名共享 tail；sync 未完成时，不能提前说成功，也不能关闭或释放锁。 */
async function verifySerialWriter(api, prototype) {
  const writer = await api.createSessionWriter(directory);
  assert.equal(writer.restored, undefined);
  const head = JSON.parse(readFileSync(writer.path, 'utf8').trim());
  assert.equal(head.workspace, realpathSync(process.cwd()));
  assert.ok(existsSync(lockPath(writer.id)));
  if (process.platform !== 'win32') assert.equal(statSync(lockPath(writer.id)).mode & 0o777, 0o600);
  await assert.rejects(api.resumeSessionWriter(writer.id, directory), /活进程/);
  await assert.rejects(api.resumeSessionWriter(writer.id, directory, true), /活进程/);
  const originals = { writeFile: prototype.writeFile, sync: prototype.sync };
  const writeGate = deferred(), syncGate = deferred(), started = deferred(), syncing = deferred();
  let handle, closed = false, saved = false, writes = 0;
  prototype.writeFile = async function(data, ...args) {
    const record = typeof data === 'string' ? JSON.parse(data) : undefined;
    if (record?.sessionId === writer.id && record.type === 'checkpoint') {
      handle = this;
      if (++writes === 1) { started.resolve(); await writeGate.promise; }
    }
    return originals.writeFile.call(this, data, ...args);
  };
  prototype.sync = async function(...args) {
    if (this === handle && writes === 1) { syncing.resolve(); await syncGate.promise; }
    return originals.sync.apply(this, args);
  };
  try {
    const input = state({ messages: [{ role: 'user', content: '保存时的原文', config: '不能保存' }], run: 1 });
    const first = writer.save(input, 'run_start').then(seq => { saved = true; return seq; });
    input.messages[0].content = '保存调用后的变动';
    const naming = writer.rename('  加法回归  ');
    const finish = writer.save(input, 'run_end');
    const closing = writer.close();
    closing.then(() => { closed = true; });
    await started.promise;
    assert.equal(saved, false);
    assert.equal(closed, false);
    assert.ok(existsSync(lockPath(writer.id)));
    writeGate.resolve();
    await syncing.promise;
    assert.equal(saved, false);
    assert.equal(closed, false);
    syncGate.resolve();
    assert.deepEqual(await Promise.all([first, naming, finish]), [1, 2, 3]);
    await closing;
    assert.equal(writer.close(), closing);
    assert.equal(existsSync(lockPath(writer.id)), false);
    await assert.rejects(writer.rename('关闭后'), /关闭/);
    await assert.rejects(writer.save(input, 'exit'), /关闭/);
  } finally { Object.assign(prototype, originals); writeGate.resolve(); syncGate.resolve(); await writer.close(); }
  const rows = readFileSync(writer.path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.slice(1).map(row => row.seq), [1, 2, 3]);
  assert.equal(rows[1].state.messages[0].content, '保存时的原文');
  assert.equal(rows[1].state.messages[0].config, undefined);
  const read = await api.readSession(writer.id, directory);
  assert.equal(read.name, '加法回归');
  assert.equal(read.interrupted, false);
  const resumed = await api.resumeSessionWriter(writer.id, directory);
  assert.equal(resumed.restored.seq, 3);
  assert.equal(resumed.restored.name, '加法回归');
  assert.equal(await resumed.rename('下一次工作'), 4);
  assert.equal(await resumed.save(read.state, 'exit'), 5);
  await resumed.close();
  assert.equal((await api.readSession(writer.id, directory)).seq, 5);
  checks += 8;
}

/** 恢复只改明确授权的尾片；完整坏行、活锁、符号链接和不明保护都不猜测处理。 */
async function verifyRecovery(api) {
  const partial = fixture([checkpoint(state({ run: 1 }), 'run_start')], '{"half":');
  const original = readFileSync(partial.path);
  await assert.rejects(api.resumeSessionWriter(partial.id, directory), /--recover/);
  assert.deepEqual(readFileSync(partial.path), original);
  assert.equal(existsSync(lockPath(partial.id)), false, '拒绝后不能留下自己的锁');
  const recovered = await api.resumeSessionWriter(partial.id, directory, true);
  assert.equal(recovered.restored.interrupted, true);
  assert.equal(recovered.restored.hasTrailingFragment, true);
  assert.equal(statSync(partial.path).size, recovered.restored.validBytes);
  assert.equal(await recovered.save(state({ run: 1 }), 'run_end'), 2);
  await recovered.close();
  assert.equal((await api.readSession(partial.id, directory)).interrupted, false);
  checks++;
  const deadPid = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
  const stale = fixture([checkpoint()]);
  writeFileSync(lockPath(stale.id), JSON.stringify({ pid: deadPid, token: randomUUID() }));
  await assert.rejects(api.resumeSessionWriter(stale.id, directory), /--recover/);
  const takeover = await api.resumeSessionWriter(stale.id, directory, true);
  assert.equal(JSON.parse(readFileSync(lockPath(stale.id), 'utf8')).pid, process.pid);
  assert.equal(existsSync(`${lockPath(stale.id)}.recover`), false);
  await takeover.close();
  checks++;
  const race = fixture([checkpoint()]);
  const attempts = await Promise.allSettled([api.resumeSessionWriter(race.id, directory), api.resumeSessionWriter(race.id, directory)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  await attempts.find(item => item.status === 'fulfilled').value.close();
  checks++;
  const staleRace = fixture([checkpoint()]);
  writeFileSync(lockPath(staleRace.id), JSON.stringify({ pid: deadPid, token: randomUUID() }));
  const recoveries = await Promise.allSettled([api.resumeSessionWriter(staleRace.id, directory, true), api.resumeSessionWriter(staleRace.id, directory, true)]);
  assert.equal(recoveries.filter(item => item.status === 'fulfilled').length, 1);
  await recoveries.find(item => item.status === 'fulfilled').value.close();
  checks++;
  const guarded = fixture();
  writeFileSync(lockPath(guarded.id), JSON.stringify({ pid: deadPid, token: randomUUID() }));
  writeFileSync(`${lockPath(guarded.id)}.recover`, JSON.stringify({ pid: deadPid, token: randomUUID() }));
  const guardedBytes = readFileSync(lockPath(guarded.id));
  await assert.rejects(api.resumeSessionWriter(guarded.id, directory, true), /恢复保护文件/);
  assert.deepEqual(readFileSync(lockPath(guarded.id)), guardedBytes);
  checks++;
  for (const type of ['symlink', 'directory', 'malformed']) {
    const sample = fixture();
    const target = join(temp, `lock-target-${randomUUID()}`);
    writeFileSync(target, '不能改变');
    if (type === 'symlink') symlinkSync(target, lockPath(sample.id));
    if (type === 'directory') mkdirSync(lockPath(sample.id));
    if (type === 'malformed') writeFileSync(lockPath(sample.id), 'not-json');
    await assert.rejects(api.resumeSessionWriter(sample.id, directory, true), /锁文件/);
    assert.equal(readFileSync(target, 'utf8'), '不能改变');
    checks++;
  }
  const bad = fixture([{ ...checkpoint(), version: 2 }]);
  const badBytes = readFileSync(bad.path);
  await assert.rejects(api.resumeSessionWriter(bad.id, directory, true), /完整记录/);
  assert.deepEqual(readFileSync(bad.path), badBytes);
  assert.equal(existsSync(lockPath(bad.id)), false);
  checks++;
  const changed = await api.createSessionWriter(directory);
  const otherToken = randomUUID();
  writeFileSync(lockPath(changed.id), JSON.stringify({ pid: deadPid, token: otherToken }));
  await assert.rejects(changed.close(), /拥有者已经变化/);
  assert.equal(JSON.parse(readFileSync(lockPath(changed.id), 'utf8')).token, otherToken);
  checks++;
  const names = await api.createSessionWriter(directory);
  for (const name of ['', 'x'.repeat(81), '危险\u001b[31m', '\n名字', '隐藏\u202e次序']) await assert.rejects(names.rename(name), /名称/);
  assert.equal(await names.rename('允许的名称'), 1, '拒绝的名称不占记录编号');
  await names.close();
  checks++;
}

/** append 与 sync 失败都停止后续写入，close 仍释放锁；sync 失败不能报告成功。 */
async function verifyWriteFailure(api, prototype) {
  for (const operation of ['writeFile', 'sync']) {
    const writer = await api.createSessionWriter(directory);
    const originals = { writeFile: prototype.writeFile, sync: prototype.sync };
    let handle, writes = 0;
    prototype.writeFile = async function(data, ...args) {
      const record = typeof data === 'string' ? JSON.parse(data) : undefined;
      if (record?.sessionId === writer.id && record.type === 'checkpoint') {
        handle = this;
        writes++;
        if (operation === 'writeFile') throw Object.assign(new Error('不应泄露的原文'), { code: 'ENOSPC' });
      }
      return originals.writeFile.call(this, data, ...args);
    };
    prototype.sync = async function(...args) {
      if (this === handle && operation === 'sync') throw Object.assign(new Error('不应泄露的原文'), { code: 'ENOSPC' });
      return originals.sync.apply(this, args);
    };
    try {
      const first = writer.save(state(), 'run_end');
      const next = writer.rename('不会继续追加');
      const feedback = await api.saveSessionCheckpoint(writer, state(), 'exit');
      await assert.rejects(first, /不应泄露的原文/);
      await assert.rejects(next, /不应泄露的原文/);
      assert.equal(feedback.ok, false);
      assert.match(feedback.message, /磁盘空间或配额不足/);
      assert.doesNotMatch(feedback.message, /不应泄露的原文/);
      await writer.close();
      assert.equal(writes, 1);
      assert.equal(existsSync(lockPath(writer.id)), false);
    } finally { Object.assign(prototype, originals); await writer.close(); }
    checks++;
  }
}

try {
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  const readOnly = await compile('02-read-records', 'read-only');
  const resumable = await compile('03-resume-session', 'resumable');
  await verifyReader(readOnly);
  await verifyReader(resumable);
  const probe = await open(join(temp, 'probe'), 'w');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  await verifySerialWriter(resumable, prototype);
  await verifyRecovery(resumable);
  await verifyWriteFailure(resumable, prototype);
  await tick();
  console.log(`session records checks passed (${checks} cases; read-only validation, recovery, locks, serial writes, failures)`);
} finally { rmSync(temp, { recursive: true, force: true }); }
