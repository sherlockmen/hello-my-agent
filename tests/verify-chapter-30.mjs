/** Chapter 30: isolated snapshots, durable definitions, real readonly dispatch and settling cancellation. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, cpSync, realpathSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build, workspace, sdkServer, sendReply, reply, root as repositoryRoot } from './runtime-fixtures.mjs';

const temp = workspace('chapter30'), project = workspace('schedule-project');
project.directory = realpathSync(project.directory);
const chapter = 'chapter-30-scheduled-tasks';
const lessons = ['01-persistent-schedules', '02-runtime-dispatch', '03-stop-and-recover'];
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const result = () => ({ sessionId: randomUUID(), status: 'completed', summary: '已读取', modelCalls: 1, requestTokensReserved: 100 });
async function until(check, message) {
  const deadline = Date.now() + 12_000;
  while (!check()) { if (Date.now() > deadline) throw new Error(message); await delay(20); }
}
function child(cli, args, options = {}) {
  const process = spawn(globalThis.process.execPath, [cli, 'schedule', ...args], { cwd: project.directory, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  let output = ''; process.stdout.on('data', bytes => output += bytes); process.stderr.on('data', bytes => output += bytes);
  const done = new Promise((resolve, reject) => { process.on('error', reject); process.on('exit', (code, signal) => resolve({ code, signal, output })); });
  return { process, done, output: () => output };
}
/** Force an actual rename failure while every definition is paused: the CLI must release its lock. */
async function verifyControlWriteFailure(cli, directory, env) {
  execFileSync(process.execPath, [cli, 'schedule', '--state-dir', directory, 'create', '--id', 'paused', '--prompt', '调查', '--every-ms', '60000'], { cwd: project.directory, env, stdio: 'pipe' });
  execFileSync(process.execPath, [cli, 'schedule', '--state-dir', directory, 'pause', 'paused'], { cwd: project.directory, env, stdio: 'pipe' });
  const serving = child(cli, ['--state-dir', directory, 'serve'], { env });
  try {
    await until(() => serving.output().includes('已启动'), 'paused serve did not start');
    serving.process.stdin.write('resume absent\n');
    await until(() => serving.output().includes('未知定时任务编号'), 'invalid input was not reported');
    assert.equal(serving.process.exitCode, null, serving.output());
    serving.process.stdin.write('list\n');
    await until(() => serving.output().includes('"state": "paused"'), 'input error killed the control queue');
    const previous = join(directory, 'store.before.json');
    renameSync(join(directory, 'store.json'), previous); mkdirSync(join(directory, 'store.json'));
    serving.process.stdin.write('resume paused\n');
    await until(() => serving.process.exitCode !== null, 'failed control write left serve polling with its lock');
    const closed = await serving.done;
    assert.notEqual(closed.code, 0, closed.output);
    assert.match(closed.output, /错误：/);
    assert.doesNotMatch(closed.output, /resume paused 已完成|已恢复 paused/);
    assert.equal(existsSync(join(directory, 'store.lock')), false);
    const saved = JSON.parse(readFileSync(previous, 'utf8'));
    assert.equal(saved.schedules[0].state, 'paused'); assert.equal(saved.runs.length, 0);
  } finally { if (serving.process.exitCode === null) { serving.process.kill('SIGKILL'); await serving.done; } }
}
try {
  const builds = lessons.map(lesson => build(chapter, lesson, temp));
  for (let index = 0; index < builds.length; index++) {
    const { ScheduleStore, validateScheduleState, MAX_SCHEDULE_BYTES } = await builds[index].load('schedules/store.js');
    const directory = join(temp.directory, `store-${index}`), store = await ScheduleStore.open(directory);
    await store.create({ id: 'audit', prompt: '读取 README.md', workspace: project.directory, intervalMs: 1000, maxRuns: 3, maxTokens: 98_304 }, 0);
    const before = readFileSync(join(directory, 'store.json'), 'utf8');
    await assert.rejects(ScheduleStore.open(directory), /占用|使用|进程/);
    await assert.rejects(store.update(state => { state.schedules[0].maxRuns = 0; }));
    assert.equal(readFileSync(join(directory, 'store.json'), 'utf8'), before);
    if (index > 0) assert.equal(store.hasWriteFailure, false, 'validation must not poison the store');
    assert.throws(() => validateScheduleState({ ...store.snapshot(), apiKey: 'no' }));
    assert.throws(() => validateScheduleState({ ...store.snapshot(), runs: [{ id: randomUUID() }] }));
    assert.throws(() => validateScheduleState({ ...store.snapshot(), schedules: [{ ...store.snapshot().schedules[0], intervalMs: Infinity }] }));
    await store.close();
    const reopened = await ScheduleStore.open(directory); assert.equal(reopened.snapshot().schedules[0].nextRunAt, 1000); await reopened.close();
    writeFileSync(join(directory, 'store.json'), 'x'.repeat(MAX_SCHEDULE_BYTES + 1));
    await assert.rejects(ScheduleStore.open(directory), /大小|上限|有界/);
    assert.equal(existsSync(join(directory, 'store.lock')), false);
    writeFileSync(join(directory, 'store.json'), '{bad'); await assert.rejects(ScheduleStore.open(directory), /JSON|读取|损坏|解析/);
    // The real schedule branch bypasses model configuration, even when no API key is available.
    const cli = join(builds[index].dist, 'cli.js'), cliDir = join(temp.directory, `cli-${index}`);
    const env = { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '' };
    const created = execFileSync(process.execPath, [cli, 'schedule', '--state-dir', cliDir, 'create', '--id', 'docs', '--prompt', '读取 README.md', '--every-ms', '1000'], { cwd: project.directory, env, encoding: 'utf8' });
    assert.match(created, /已保存/);
    const listed = JSON.parse(execFileSync(process.execPath, [cli, 'schedule', '--state-dir', cliDir, 'list'], { cwd: project.directory, env, encoding: 'utf8' }));
    assert.equal(listed.schedules[0].id, 'docs'); assert.equal(listed.runs.length, 0);
  }
  console.log('30.1–30.3: isolated builds, bounded schema, lock, atomic validation and model-free CLI management passed');

  for (let index = 1; index <= 2; index++) {
    const { ScheduleStore } = await builds[index].load('schedules/store.js');
    const { Scheduler, createScheduleRunner } = await builds[index].load('schedules/runtime.js');
    const directory = join(temp.directory, `runtime-${index}`), store = await ScheduleStore.open(directory);
    await store.create({ id: 'audit', prompt: '读取 README.md', workspace: project.directory, intervalMs: 1000, maxRuns: 3, maxTokens: 65_536 }, 0);
    let now = 999, calls = 0, current = deferred();
    const scheduler = new Scheduler(store, async () => { calls++; await current.promise; return result(); }, () => now);
    await scheduler.tick(); assert.equal(calls, 0);
    now = 5000; await Promise.all([scheduler.tick(), scheduler.tick()]); await delay(0);
    assert.equal(calls, 1); assert.equal(scheduler.activeCount, 1);
    assert.equal(store.snapshot().schedules[0].nextRunAt, 6000); assert.equal(store.snapshot().schedules[0].reservedTokens, 32_768);
    now = 20_000; await scheduler.tick(); assert.equal(calls, 1);
    await scheduler.pause('audit'); current.resolve(); await until(() => scheduler.activeCount === 0, 'first run did not settle');
    assert.equal(store.snapshot().runs[0].status, 'completed');
    await scheduler.tick(); assert.equal(calls, 1);
    await scheduler.resume('audit'); assert.equal(store.snapshot().schedules[0].nextRunAt, 21_000);
    current = deferred(); now = 22_000; await scheduler.tick(); await delay(0); assert.equal(calls, 2);
    current.resolve(); await until(() => scheduler.activeCount === 0, 'second run did not settle');
    assert.equal(store.snapshot().schedules[0].state, 'paused'); assert.equal(store.snapshot().schedules[0].reservedTokens, 65_536);
    await assert.rejects(scheduler.resume('audit'), /预算/);
    now = 90_000; await scheduler.tick(); assert.equal(calls, 2);
    await scheduler.close(); await store.close();

    // Exercise the actual runSubagent wrapper: only readonly definitions, forbidden tool returns to the model.
    const work = process.cwd(); process.chdir(project.directory); project.file('README.md', 'schedule evidence\n');
    try {
      let count = 0;
      const model = { async generate(messages, signal, onText, options) {
        assert.deepEqual(options.allowedTools, ['read_file', 'glob', 'grep']);
        assert.equal(options.mode, 'plan');
        count++;
        if (count === 1) return reply('', [{ id: 'read', name: 'read_file', arguments: JSON.stringify({ path: 'README.md', offset: 1, limit: 20 }) }]);
        if (count === 2) { assert.match(messages.at(-1).content, /schedule evidence/); return reply('', [{ id: 'write', name: 'write_file', arguments: JSON.stringify({ path: 'bad.txt', content: 'bad' }) }]); }
        assert.equal(messages.at(-1).isError, true); return reply('已读取；写入被拒绝');
      } };
      const runner = createScheduleRunner(model, directory);
      const observed = await runner({ workspace: project.directory, prompt: '调查' }, randomUUID(), new AbortController().signal, 32_768);
      assert.equal(observed.status, 'completed'); assert.equal(count, 3); assert.equal(existsSync(join(project.directory, 'bad.txt')), false);
      const tiny = await runner({ workspace: project.directory, prompt: '调查' }, randomUUID(), new AbortController().signal, 1);
      assert.equal(tiny.status, 'budget_exhausted'); assert.equal(count, 3);
      await assert.rejects(runner({ workspace: temp.directory, prompt: '调查' }, randomUUID(), new AbortController().signal, 32_768), /工作区/);
    } finally { process.chdir(work); }
  }
  console.log('30.2–30.3: coalescing, non-overlap, pause/resume, durable hard reservations and real readonly runSubagent passed');

  const final = builds[2];
  const { ScheduleStore } = await final.load('schedules/store.js');
  const { Scheduler, recoverInterrupted } = await final.load('schedules/runtime.js');
  const directory = join(temp.directory, 'stop'), store = await ScheduleStore.open(directory);
  await store.create({ id: 'audit', prompt: '调查', workspace: project.directory, intervalMs: 1000, maxRuns: 3, maxTokens: 98_304 }, 0);
  const release = deferred(), aborted = deferred(); let settled = false;
  const scheduler = new Scheduler(store, async (_task, _id, signal) => { signal.addEventListener('abort', () => aborted.resolve(), { once: true }); await release.promise; settled = true; return result(); }, () => 1000);
  await scheduler.tick(); await delay(0);
  let stopped = false; const stop = scheduler.stop('audit').then(() => stopped = true);
  await aborted.promise; await delay(0);
  assert.equal(stopped, false); assert.equal(settled, false); assert.equal(scheduler.activeCount, 1); assert.equal(store.snapshot().runs[0].status, 'running');
  release.resolve(); await stop;
  assert.equal(scheduler.activeCount, 0); assert.equal(store.snapshot().runs[0].status, 'cancelled'); assert.equal(store.snapshot().schedules[0].state, 'stopped');
  await assert.rejects(scheduler.resume('audit'), /stopped/); await scheduler.close(); await store.close();

  // A real killed writer leaves a lock and running record. --recover never replaces a live writer.
  const crashDir = join(temp.directory, 'crash'); const mod = new URL(`file://${join(final.dist, 'schedules/store.js')}`).href;
  const code = `import {ScheduleStore} from ${JSON.stringify(mod)}; import {randomUUID} from 'node:crypto'; const s=await ScheduleStore.open(${JSON.stringify(crashDir)}); await s.create({id:'lost',prompt:'调查',workspace:${JSON.stringify(project.directory)},intervalMs:1000,maxRuns:3,maxTokens:98304},0); await s.update(v=>{v.schedules[0].attempts=1;v.schedules[0].reservedTokens=32768;v.runs.push({id:randomUUID(),scheduleId:'lost',scheduledAt:1000,startedAt:1000,finishedAt:null,status:'running',reservation:32768,summary:'',childSessionId:null,modelCalls:0,requestTokensReserved:0});}); console.log('ready'); setInterval(()=>{},1000);`;
  const crashed = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] }); let ready = '';
  crashed.stdout.on('data', bytes => ready += bytes); await until(() => ready.includes('ready'), 'crash fixture not ready');
  await assert.rejects(ScheduleStore.open(crashDir, true), /占用|进程|使用/);
  const exited = new Promise(resolve => crashed.once('exit', resolve)); crashed.kill('SIGKILL'); await exited;
  await assert.rejects(ScheduleStore.open(crashDir), /recover/);
  const recovered = await ScheduleStore.open(crashDir, true); await recoverInterrupted(recovered, 8000);
  assert.equal(recovered.snapshot().runs[0].status, 'interrupted'); assert.equal(recovered.snapshot().schedules[0].state, 'paused');
  assert.equal(recovered.snapshot().schedules[0].attempts, 1); assert.equal(recovered.snapshot().schedules[0].reservedTokens, 32_768);
  let replays = 0; const restarted = new Scheduler(recovered, async () => { replays++; return result(); }, () => 99_000);
  await restarted.tick(); assert.equal(replays, 0); await restarted.close(); await recovered.close();
  console.log('30.3: stop waits actual settle; dead-writer recovery interrupts without replay or budget refund passed');

  // Real SDK + real CLI loop, stdout controls, competing management and graceful signal shutdown.
  const server = await sdkServer((entry, response) => sendReply(entry, response));
  let serving;
  try {
    const cli = join(final.dist, 'cli.js'), cliDir = join(temp.directory, 'serve');
    const env = { ...process.env, OPENAI_API_KEY: 'fixture-key', OPENAI_MODEL: 'fixture-model', OPENAI_BASE_URL: `${server.url}/v1`, AGENT_PROVIDER: 'openai' };
    execFileSync(process.execPath, [cli, 'schedule', '--state-dir', cliDir, 'create', '--id', 'docs', '--prompt', '调查', '--every-ms', '1000', '--max-runs', '3'], { cwd: project.directory, env, stdio: 'pipe' });
    serving = child(cli, ['--state-dir', cliDir, 'serve'], { env });
    await until(() => serving.output().includes('已启动'), 'serve did not start');
    await until(() => server.requests.length > 0, 'serve never reached real SDK');
    const busy = child(cli, ['--state-dir', cliDir, 'list'], { env }); const busyExit = await busy.done;
    assert.notEqual(busyExit.code, 0); assert.match(busyExit.output, /占用|使用|进程/);
    serving.process.stdin.write('pause docs\n'); await until(() => serving.output().includes('pause docs 已完成'), 'stdin pause not wired');
    serving.process.stdin.write('stop docs\n'); await until(() => serving.output().includes('stop docs 已完成'), 'stdin stop not wired');
    serving.process.kill('SIGTERM'); const closed = await serving.done; assert.equal(closed.code, 0, closed.output);
    const finalState = JSON.parse(readFileSync(join(cliDir, 'store.json'), 'utf8'));
    assert.equal(finalState.schedules[0].state, 'stopped'); assert.equal(finalState.runs.some(run => run.status === 'running'), false);
    assert.equal(existsSync(join(cliDir, 'store.lock')), false);
    const requests = server.requests.length;
    for (const index of [1, 2]) await verifyControlWriteFailure(join(builds[index].dist, 'cli.js'), join(temp.directory, `control-failure-${index}`), env);
    assert.equal(server.requests.length, requests, 'paused control failure must not request the model');
  } finally { if (serving?.process.exitCode === null) { serving.process.kill('SIGKILL'); await serving.done; } await server.close(); }
  console.log('30.2–30.3: real CLI controls, invalid-input recovery, fatal rename failure, lock release and SIGTERM cleanup passed');

  // Execute the published exercise as copied code, inside an independent final-lesson source tree.
  const exercise = join(temp.directory, 'exercise'), exerciseSource = join(exercise, 'src');
  mkdirSync(exercise, { recursive: true });
  cpSync(join(repositoryRoot, chapter, lessons[2], 'src'), exerciseSource, { recursive: true });
  const published = readFileSync(join(repositoryRoot, chapter, 'EXERCISES.md'), 'utf8');
  for (const [marker, name] of [['report', 'report.ts'], ['commands', 'commands.ts']]) {
    const section = published.split(`<!-- exercise:${marker}:start -->`)[1].split(`<!-- exercise:${marker}:end -->`)[0];
    const code = section.match(/```ts\n([\s\S]*?)```/)[1];
    let paired = readFileSync(join(repositoryRoot, chapter, 'examples/budget-answer', name), 'utf8');
    for (const file of ['models/client', 'config/load-config', 'errors']) paired = paired.replace(`"../../03-stop-and-recover/src/${file}.js"`, `"../${file}.js"`);
    for (const file of ['store', 'runtime']) paired = paired.replace(`"../../03-stop-and-recover/src/schedules/${file}.js"`, `"./${file}.js"`);
    assert.equal(paired, code, `public ${name} must match the copied answer except for import paths`);
    writeFileSync(join(exerciseSource, 'schedules', name), code);
  }
  symlinkSync(join(repositoryRoot, 'node_modules'), join(exercise, 'node_modules'));
  writeFileSync(join(exercise, 'package.json'), '{"name":"exercise-fixture","version":"0.0.0","type":"module"}');
  writeFileSync(join(exercise, 'tsconfig.json'), JSON.stringify({ extends: join(repositoryRoot, 'tsconfig.json'), compilerOptions: {
    noEmit: false, noEmitOnError: true, rootDir: exerciseSource, outDir: join(exercise, 'dist'), typeRoots: [join(repositoryRoot, 'node_modules/@types')],
  }, include: [join(exerciseSource, '**/*.ts'), join(exerciseSource, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-p', join(exercise, 'tsconfig.json')], { stdio: 'inherit' });
  const exerciseDirectory = join(temp.directory, 'exercise-store'), exerciseStore = await ScheduleStore.open(exerciseDirectory);
  await exerciseStore.create({ id: 'spent', prompt: '调查', workspace: project.directory, intervalMs: 1000, maxRuns: 3, maxTokens: 65536 }, 0);
  await exerciseStore.create({ id: 'removed', prompt: '调查', workspace: project.directory, intervalMs: 1000, maxRuns: 3, maxTokens: 65536 }, 0);
  await exerciseStore.update(state => {
    Object.assign(state.schedules[0], { attempts: 2, reservedTokens: 65536, state: 'paused' });
    state.schedules[1].state = 'stopped';
    state.runs.push({ id: randomUUID(), scheduleId: 'spent', scheduledAt: 2000, startedAt: 2000, finishedAt: 2001,
      status: 'failed', reservation: 32768, summary: 'failed', childSessionId: null, modelCalls: 1, requestTokensReserved: 100 });
  });
  await exerciseStore.close();
  const reports = JSON.parse(execFileSync(process.execPath, [join(exercise, 'dist/cli.js'), 'schedule', '--state-dir', exerciseDirectory, 'budget'], {
    cwd: project.directory, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '' },
  }));
  assert.deepEqual(reports[0], { id: 'spent', state: 'paused', remainingRuns: 1, remainingTokenReservation: 0, lastStatus: 'failed' });
  assert.deepEqual(reports[1], { id: 'removed', state: 'stopped', remainingRuns: 3, remainingTokenReservation: 65536, lastStatus: 'never' });
  const exerciseServer = await sdkServer((entry, response) => sendReply(entry, response));
  try {
    await verifyControlWriteFailure(join(exercise, 'dist/cli.js'), join(temp.directory, 'exercise-control-failure'), {
      ...process.env, OPENAI_API_KEY: 'fixture-key', OPENAI_MODEL: 'fixture-model', OPENAI_BASE_URL: `${exerciseServer.url}/v1`, AGENT_PROVIDER: 'openai',
    });
    assert.equal(exerciseServer.requests.length, 0);
  } finally { await exerciseServer.close(); }
  console.log('30 exercise: paired answer, copied compilation, real budget command and fatal control-write cleanup passed');

} finally { project.close(); temp.close(); }
