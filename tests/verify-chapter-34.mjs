/** Chapter 34: isolated cumulative builds, actual SDK failures, cancellation and literal answers. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build, reply, root, sdkServer, sendReply, signal, workspace } from './runtime-fixtures.mjs';

const chapter = 'chapter-34-reliability', temporary = workspace('chapter34');
const oldCwd = process.cwd(), oldHome = process.env.HOME;
const lessons = ['01-correlated-logs', '02-safe-retries', '03-stop-and-diagnose'];
const directory = name => { const path = join(temporary.directory, name); mkdirSync(path, { recursive: true }); return realpathSync(path); };
const project = directory('project');
writeFileSync(join(project, 'package.json'), '{"type":"module"}');
writeFileSync(join(project, 'source.txt'), 'PRIVATE_TOOL_RESULT_SENTINEL');
const diagnosticDirectory = directory('diagnostics');
const options = { diagnosticDirectory, toolResultDirectory: directory('tool-results') };
const readLog = final => readFileSync(final.diagnostics.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const closeModel = async model => { await model.jobs?.close(); await model.languageService?.close(); };
const runChild = (file, args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
});
const keepAlive = setInterval(() => {}, 1000);
process.env.HOME = directory('home');
process.chdir(project);
try {
  for (const [index, lesson] of lessons.entries()) {
    const compiled = build(chapter, lesson, temporary);
    const { runAgent } = await compiled.load('agent/run.js');
    const { streamAgentRun } = await compiled.load('agent/run-stream.js');
    const { openRunLog } = await compiled.load('diagnostics/logger.js');
    const { updateRunView, emptyRunView, runTranscript } = await compiled.load('ui/tui/state.js');
    const history = [], events = []; let calls = 0;
    const model = { async generate(messages) {
      calls++;
      if (calls === 1) return reply('', [{ id: 'PRIVATE_CALL_ID', name: 'read_file', arguments: '{"path":"source.txt","offset":1,"limit":2}' }]);
      assert.ok(messages.some(message => message.role === 'tool' && message.content.includes('PRIVATE_TOOL_RESULT_SENTINEL')));
      return reply('PRIVATE_FINAL_ANSWER');
    } };
    await runAgent(model, history, 'PRIVATE_USER_PROMPT', signal(), event => events.push(event), undefined, new Set(), options);
    const final = events.at(-1), log = readLog(final);
    assert.equal(calls, 2); assert.equal(final.outcome, 'completed'); assert.equal(final.diagnostics.complete, true);
    assert.deepEqual(log.map(item => item.sequence), log.map((_, number) => number + 1));
    assert.equal(new Set(log.map(item => item.runId)).size, 1);
    assert.equal(log[0].event, 'run_start'); assert.equal(log.at(-1).event, 'run_finish');
    assert.deepEqual(log.filter(item => item.event === 'model_start').map(item => item.call), [1, 2]);
    assert.ok(log.some(item => item.event === 'model_finish' && typeof item.durationMs === 'number'));
    assert.ok(log.some(item => item.event === 'tool_finish' && typeof item.durationMs === 'number' && item.contentChars > 0));
    assert.ok(log.every(item => item.elapsedMs >= 0));
    assert.doesNotMatch(JSON.stringify(log), /PRIVATE_|source\.txt|read_file|arguments|trigger|headers|http/);
    if (process.platform !== 'win32') assert.equal(statSync(final.diagnostics.path).mode & 0o777, 0o600);
    const view = events.reduce(updateRunView, emptyRunView());
    assert.match(runTranscript(view), new RegExp(final.diagnostics.runId));
    const records = [];
    for await (const record of streamAgentRun({ generate: async () => reply('STREAM_OK') }, [], 'Q', signal(), undefined, new Set(), options)) records.push(record);
    assert.ok(records.every(record => record.runId === records.at(-1).event.diagnostics.runId));
    const blocker = temporary.file(`blocked-${index}`, 'not a directory'), noLog = [];
    assert.equal((await runAgent({ generate: async () => reply('SUCCESS_WITHOUT_LOG') }, [], 'Q', signal(), event => noLog.push(event), undefined, new Set(), { diagnosticDirectory: blocker })).text, 'SUCCESS_WITHOUT_LOG');
    assert.equal(noLog.at(-1).diagnostics.complete, false); assert.equal(noLog.at(-1).diagnostics.path, undefined);
    const bounded = openRunLog(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, diagnosticDirectory);
    for (let n = 0; n < 10_050; n++) bounded.record({ type: 'run_start' });
    const boundedFinal = bounded.finish({ type: 'run_finish', outcome: 'error', message: 'PRIVATE_ERROR' });
    const boundedLines = readFileSync(boundedFinal.path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(boundedLines.length, 10_001); assert.equal(boundedLines.at(-1).event, 'run_finish'); assert.equal(boundedFinal.complete, false);
    const sequence = [{ type: 'model_start', call: 1, contextMessages: 1, trigger: { kind: 'user', content: 'Q' } }];
    if (index) {
      const { withModelRetry } = await compiled.load('models/retry.js');
      const { UserFacingError } = await compiled.load('errors.js');
      let attempted = 0; const notices = [];
      const retried = await withModelRetry(async () => { if (++attempted < 3) throw { status: 429, message: 'PRIVATE_REMOTE_ERROR' }; return 'OK'; }, signal(), () => true, notice => notices.push(notice), { baseDelayMs: 2, random: () => 0 });
      assert.deepEqual(retried, { result: 'OK', attempts: 3 }); assert.deepEqual(notices.map(item => item.delayMs), [2, 4]);
      for (const error of [{ status: 401 }, { status: 400 }, { name: 'UnknownError' }, new UserFacingError('LOCAL')]) {
        let count = 0; await assert.rejects(withModelRetry(async () => { count++; throw error; }, signal(), () => true, undefined, { baseDelayMs: 1 })); assert.equal(count, 1);
      }
      let exhausted = 0;
      await assert.rejects(withModelRetry(async () => { exhausted++; throw { status: 503 }; }, signal(), () => true, undefined, { baseDelayMs: 1 })); assert.equal(exhausted, 3);
      const cancelled = new AbortController(), reason = new Error('STOP_DURING_BACKOFF'); let cancelCount = 0;
      const waiting = withModelRetry(async () => { cancelCount++; throw { status: 429 }; }, cancelled.signal, () => true, () => cancelled.abort(reason), { baseDelayMs: 1000 });
      await assert.rejects(waiting, error => error === reason); assert.equal(cancelCount, 1);
      sequence.push({ type: 'model_retry', call: 1, attempt: 2, delayMs: 1, kind: 'rate_limit' });
      assert.match(sequence.reduce(updateRunView, emptyRunView()).status, /第 2\/3 次尝试/);
      const { createModel } = await compiled.load('models/client.js');
      // Actual SDK request fails with 429, then succeeds; the SDK's own retries are disabled.
      for (const provider of ['openai', 'anthropic']) {
      let requests = 0;
      const service = await sdkServer((entry, response) => { if (++requests === 1) { response.writeHead(429); response.end('{"error":{"message":"PRIVATE_REMOTE_SECRET"}}'); } else sendReply(entry, response, reply('RETRY_OK'), { prompt_tokens: 3, completion_tokens: 2 }); });
      const sdk = createModel({ provider, apiKey: 'PRIVATE_API_KEY', model: 'fixture', baseURL: service.url });
      try {
        const notices = [], result = await sdk.generate([{ role: 'user', content: 'Q' }], signal(), undefined, { onRetry: item => notices.push(item) });
        assert.equal(result.text, 'RETRY_OK'); assert.equal(result.inputTokens, null); assert.equal(result.outputTokens, null);
        assert.equal(service.requests.length, 2); assert.equal(notices.length, 1); assert.equal(notices[0].kind, 'rate_limit');
        assert.ok(notices[0].delayMs >= 500 && notices[0].delayMs <= 1000);
      } finally { await closeModel(sdk); await service.close(); }
      }
      const auth = await sdkServer((_, response) => { response.writeHead(401); response.end('{"error":{"message":"PRIVATE_AUTH_SECRET"}}'); });
      const authModel = createModel({ provider: 'openai', apiKey: 'fixture', model: 'fixture', baseURL: auth.url });
      try { await assert.rejects(authModel.generate([{ role: 'user', content: 'Q' }], signal()), error => /认证/.test(error.message) && !/PRIVATE/.test(error.message)); assert.equal(auth.requests.length, 1); }
      finally { await closeModel(authModel); await auth.close(); }
      // A transport cut before text can retry. A cut after delivered text must not retry.
      for (const partial of [false, true]) {
        let count = 0, text = '';
        const cut = await sdkServer((entry, response) => {
          if (++count > 1) return sendReply(entry, response, reply('RECOVERED'));
          if (!partial) return response.destroy();
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'PARTIAL_TEXT' }, finish_reason: null }] })}\n\n`);
          setTimeout(() => response.destroy(), 60);
        });
        const cutModel = createModel({ provider: 'openai', apiKey: 'fixture', model: 'fixture', baseURL: cut.url });
        try {
          const operation = cutModel.generate([{ role: 'user', content: 'Q' }], signal(), part => { text += part; });
          if (partial) { await assert.rejects(operation, /连接|模型请求失败/); assert.equal(text, 'PARTIAL_TEXT'); assert.equal(count, 1); }
          else { assert.equal((await operation).text, 'RECOVERED'); assert.equal(count, 2); }
        } finally { await closeModel(cutModel); await cut.close(); }
      }
      // Commit an actual approved file tool before a later model transport failure.
      for (const fail of [false, true]) {
        let count = 0; const target = `kept-${index}-${fail}.txt`, events = [], history = [];
        const endpoint = await sdkServer((entry, response) => {
          count++;
          if (count === 1) return sendReply(entry, response, reply('', [{ id: 'write-once', name: 'write_file', arguments: JSON.stringify({ path: target, content: 'SIDE_EFFECT_KEPT' }) }]));
          assert.ok(entry.body.messages.some(message => message.role === 'tool'));
          if (count === 2 || fail) { response.writeHead(429); return response.end('{"error":{"message":"PRIVATE_LIMIT"}}'); }
          return sendReply(entry, response, reply('TOOL_RESULT_OBSERVED'));
        });
        const actual = createModel({ provider: 'openai', apiKey: 'fixture', model: 'fixture', baseURL: endpoint.url });
        try {
          const task = runAgent(actual, history, 'Create one file then summarize', signal(), event => events.push(event), async () => ({ decision: 'allow_once' }), new Set(), options);
          if (fail) await assert.rejects(task, /限流/); else assert.equal((await task).text, 'TOOL_RESULT_OBSERVED');
          assert.equal(count, fail ? 4 : 3); assert.equal(readFileSync(join(project, target), 'utf8'), 'SIDE_EFFECT_KEPT');
          assert.equal(events.filter(event => event.type === 'tool_start' && event.call.name === 'write_file').length, 1);
          assert.ok(history.some(message => message.role === 'tool' && message.toolCallId === 'write-once' && !message.isError));
          assert.equal(events.at(-1).outcome, fail ? 'error' : 'completed');
          const retryRecords = readLog(events.at(-1)).filter(item => item.event === 'model_retry');
          assert.ok(retryRecords.every(item => item.call === 2)); assert.equal(retryRecords.length, fail ? 2 : 1);
          assert.doesNotMatch(JSON.stringify(readLog(events.at(-1))), /SIDE_EFFECT|PRIVATE_|kept-/);
        } finally { await closeModel(actual); await endpoint.close(); }
      }
    }
    if (index === 2) {
      const { createProgressWatchdog } = await compiled.load('diagnostics/watchdog.js');
      const watchdog = createProgressWatchdog(35), call = { id: 'q', name: 'ask_user', arguments: '{}' };
      watchdog.observe({ type: 'approval_start', sequence: 1, call, scope: 'write', allowSession: false, hasPreview: true });
      watchdog.observe({ type: 'tool_start', sequence: 2, call });
      await delay(70); assert.equal(watchdog.signal.aborted, false);
      watchdog.observe({ type: 'approval_finish', sequence: 1, call, response: { decision: 'allow_once' } });
      await delay(70); assert.equal(watchdog.signal.aborted, false, 'Still waiting for a human answer');
      watchdog.observe({ type: 'tool_finish', sequence: 2, call, outcome: 'error', error: 'no answer' });
      await delay(55); assert.equal(watchdog.signal.aborted, true); assert.match(watchdog.signal.reason.message, /没有进展/); watchdog.dispose();
      const active = createProgressWatchdog(45);
      for (let n = 0; n < 4; n++) { await delay(20); active.observe({ type: 'text_delta', call: 1, text: '.' }); assert.equal(active.signal.aborted, false); }
      active.dispose(); await delay(55); assert.equal(active.signal.aborted, false);
      let settled = false, requested = false; const events = [], start = performance.now();
      const slow = { async generate(_, signal) {
        await new Promise(resolve => signal.addEventListener('abort', () => { requested = true; resolve(); }, { once: true }));
        await delay(55); settled = true; signal.throwIfAborted();
      } };
      await assert.rejects(runAgent(slow, [], 'Silent operation', signal(), event => { if (event.type === 'run_finish') assert.equal(settled, true); events.push(event); }, undefined, new Set(), { ...options, noProgressTimeoutMs: 30 }), /没有进展/);
      assert.equal(requested, true); assert.ok(performance.now() - start >= 75); assert.equal(events.at(-1).outcome, 'error');
      let consumerCleaned = false;
      const breakModel = { async generate(_, signal) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); await delay(40); consumerCleaned = true; signal.throwIfAborted(); } };
      for await (const _ of streamAgentRun(breakModel, [], 'Break consumer', signal(), undefined, new Set(), options)) break;
      assert.equal(consumerCleaned, true, 'Leaving the stream must await the original task cleanup');
      const controller = new AbortController(), cancelled = [];
      const cancelledTask = runAgent(slow, [], 'User cancels', controller.signal, event => cancelled.push(event), undefined, new Set(), options);
      setTimeout(() => controller.abort(new Error('USER_STOP')), 20); await assert.rejects(cancelledTask, /USER_STOP/); assert.equal(cancelled.at(-1).outcome, 'cancelled');
      // Actual runtime waits through an approval longer than the silence limit.
      let turn = 0;
      const waitingModel = { async generate() { return ++turn === 1 ? reply('', [{ id: 'approval-pause', name: 'write_file', arguments: '{"path":"approved-after-wait","content":"KEPT"}' }]) : reply('WAIT_FINISHED'); } };
      assert.equal((await runAgent(waitingModel, [], 'Wait for approval', signal(), undefined, async () => { await delay(80); return { decision: 'allow_once' }; }, new Set(), { ...options, noProgressTimeoutMs: 40 })).text, 'WAIT_FINISHED');
      // Child model events are intentionally filtered; real approval promises must still pause the parent.
      mkdirSync(join(project, '.agents'), { recursive: true }); writeFileSync(join(project, '.agents/info.txt'), 'PRIVATE_CHILD_INFO');
      for (const shared of [false, true]) {
        let calls = 0, approved = 0;
        const childModel = { async generate() {
          calls++;
          if (calls === 1) return reply('', [{ id: 'delegate', name: shared ? 'run_shared_tasks' : 'delegate_task', arguments: shared ? '{}' : JSON.stringify({ role: 'explore', task: 'Read private project info' }) }]);
          if (calls === 2) return reply('', [{ id: 'child-read', name: 'read_file', arguments: '{"path":".agents/info.txt","offset":1,"limit":10}' }]);
          return reply(calls === 3 ? 'CHILD_FINISHED' : 'PARENT_FINISHED');
        } };
        const { SharedCoordinator } = await compiled.load('collaboration/coordinator.js');
        const coordinator = new SharedCoordinator({ leaseMs: 2000 });
        if (shared) coordinator.create([{ id: 'inspect', role: 'explore', task: 'Read private project info', dependsOn: [] }]);
        const result = await runAgent(childModel, [], 'Delegate a read', signal(), undefined,
          async () => { await delay(100); approved++; return { decision: 'allow_once' }; }, new Set(),
          { ...options, noProgressTimeoutMs: 50, childSessionDirectory: directory(`child-sessions-${shared}`), ...(shared ? { sharedTasks: coordinator } : {}) });
        assert.equal(result.text, 'PARENT_FINISHED'); assert.equal(approved, 1); assert.equal(calls, 4);
        if (shared) assert.equal(coordinator.list()[0].state, 'completed');
      }
      const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1' };
      const doctor = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), '--doctor'], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 10000 });
      assert.equal(doctor.status, 0); assert.match(doctor.stdout, /Node:.*\nPlatform:.*\nWorking directory:/); assert.match(doctor.stdout, /缺少 OPENAI_API_KEY/); assert.match(doctor.stdout, /没有发送网络请求/);
      const sandbox = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), '--sandbox-info'], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 10000 });
      assert.match(sandbox.stdout, /Sandbox runtime:/); assert.doesNotMatch(sandbox.stderr, /分别单独使用|缺少 OPENAI/);
      const sandboxConflict = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), '--sandbox-info', '--idle-timeout', '90'], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 10000 });
      assert.equal(sandboxConflict.status, 1); assert.match(sandboxConflict.stderr, /分别单独使用/);
      for (const limit of ['0' , '3601', '1.1', '-2', 'NaN']) {
        const invalid = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), '--idle-timeout', limit, '--prompt', 'Q'], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 10000 });
        assert.equal(invalid.status, 1); assert.match(invalid.stderr, /1 至 3600/); assert.doesNotMatch(invalid.stderr, /缺少 OPENAI/);
      }
      const explicit = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), '--quiet', '--output', 'jsonl', '--prompt', 'Q'], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 10000 });
      assert.equal(explicit.status, 1); assert.match(explicit.stderr, /只支持 text/);
      const endpoint = await sdkServer();
      try {
        const env = { ...cleanEnv, OPENAI_API_KEY: 'CLI_PRIVATE_KEY', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: endpoint.url };
        const validDoctor = await runChild(join(compiled.dist, 'cli.js'), ['--doctor'], env);
        assert.match(validDoctor.stdout, /本地检查通过/); assert.doesNotMatch(validDoctor.stdout, /CLI_PRIVATE_KEY|fixture|127\.0\.0\.1/); assert.equal(endpoint.requests.length, 0);
        const quiet = await runChild(join(compiled.dist, 'cli.js'), ['--output', 'text', '--quiet', '--prompt', 'Q'], env);
        assert.equal(quiet.status, 0, quiet.stderr); assert.match(quiet.stdout, /SDK_COMPLETE/); assert.match(quiet.stderr, /诊断 .*\.jsonl/); assert.doesNotMatch(quiet.stderr, /当前模式|本地估算|模型 >|服务商报告/);
      } finally { await endpoint.close(); }

    }
    assert.equal(typeof (await compiled.load('language-service/client.js')).LanguageService, 'function');
    assert.equal(typeof (await compiled.load('sandbox/runtime.js')).closeSandbox, 'function');
    console.log(`✓ 34.${index + 1}: whitelist logs and correlation${index ? ', actual SDK retries, no duplicate tools and preserved side effects' : ''}${index === 2 ? ', watchdog, awaited cleanup, local doctor and quiet' : ''}`);
  }
  // Build published exercise files over the last complete snapshot, then execute the added branch.
  const answers = [...readFileSync(join(root, chapter, 'EXERCISES.md'), 'utf8').matchAll(/<!-- answer-file: ([^ ]+) -->\n```[^\n]+\n([\s\S]*?)\n```/g)];
  assert.equal(answers.length, 1);
  const exercise = directory('exercise'), source = join(exercise, 'src');
  cpSync(join(root, chapter, lessons.at(-1), 'src'), source, { recursive: true });
  for (const [, relative, content] of answers) { const path = join(exercise, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content + '\n'); }
  writeFileSync(join(exercise, 'package.json'), '{"type":"module"}'); symlinkSync(join(root, 'node_modules'), join(exercise, 'node_modules'));
  writeFileSync(join(exercise, 'tsconfig.json'), JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: join(exercise, 'dist'), typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, '**/*.ts'), join(source, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(exercise, 'tsconfig.json')], { stdio: 'inherit' });
  const { reviewRunLog } = await import(pathToFileURL(join(exercise, 'dist/diagnostics/review-log.js')));
  const file = temporary.file('review.jsonl', [
    { version: 1, runId: 'one', sequence: 1, event: 'run_start' },
    { version: 1, runId: 'one', sequence: 2, event: 'model_start', call: 1 },
    { version: 1, runId: 'one', sequence: 3, event: 'model_retry', call: 1, attempt: 2 },
    { version: 1, runId: 'one', sequence: 4, event: 'tool_start', toolSequence: 2 },
    { version: 1, runId: 'one', sequence: 5, event: 'run_finish', outcome: 'error', logComplete: true },
  ].map(JSON.stringify).join('\n') + '\n');
  assert.deepEqual(await reviewRunLog(file), { runId: 'one', outcome: 'error', complete: true, retries: 1, unfinishedModels: [1], unfinishedTools: [2] });
  const interrupted = temporary.file('interrupted.jsonl', readFileSync(file, 'utf8').split('\n').slice(0, 4).join('\n'));
  assert.deepEqual(await reviewRunLog(interrupted), { runId: 'one', outcome: 'unknown', complete: false, retries: 1, unfinishedModels: [1], unfinishedTools: [2] });
  for (const input of ['{PRIVATE_BROKEN', '{"version":1,"runId":"one","sequence":2,"event":"run_start"}\n', '{"version":2,"runId":"one","sequence":1,"event":"run_start"}\n']) {
    const broken = temporary.file('broken.jsonl', input); await assert.rejects(reviewRunLog(broken), error => !/PRIVATE_BROKEN/.test(error.message));
  }
  const logLines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const mixed = temporary.file('mixed.jsonl', logLines.map((line, index) => JSON.stringify({ ...line, ...(index === 3 ? { runId: 'other' } : {}) })).join('\n'));
  await assert.rejects(reviewRunLog(mixed), /格式无效/);
  const capped = temporary.file('capped.jsonl', logLines.map(line => JSON.stringify({ ...line, ...(line.event === 'run_finish' ? { logComplete: false } : {}) })).join('\n'));
  assert.equal((await reviewRunLog(capped)).complete, false); assert.equal((await reviewRunLog(capped)).outcome, 'error');
  const paired = temporary.file('paired.jsonl', [
    { version: 1, runId: 'paired', sequence: 1, event: 'model_start', call: 1 },
    { version: 1, runId: 'paired', sequence: 2, event: 'model_finish', call: 1 },
    { version: 1, runId: 'paired', sequence: 3, event: 'tool_start', toolSequence: 1 },
    { version: 1, runId: 'paired', sequence: 4, event: 'tool_finish', toolSequence: 1 },
    { version: 1, runId: 'paired', sequence: 5, event: 'run_finish', outcome: 'error', logComplete: true },
  ].map(JSON.stringify).join('\n'));
  assert.deepEqual(await reviewRunLog(paired), { runId: 'paired', outcome: 'error', complete: true, retries: 0, unfinishedModels: [], unfinishedTools: [] });
  const oversized = temporary.file('oversized.jsonl', 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(reviewRunLog(oversized), /不超过1MiB/);
  console.log('✓ 34 exercises: compiled literal answer, incomplete runs, unmatched operations and safe malformed-input errors');
} finally {
  clearInterval(keepAlive); process.chdir(oldCwd); if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; temporary.close();
}
