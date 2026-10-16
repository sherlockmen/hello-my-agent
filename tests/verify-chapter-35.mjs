/** Chapter 35: real temporary projects, objective grading, terminal probes and local SDK transport. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, reply, root, sdkServer, sendReply, workspace } from './runtime-fixtures.mjs';

const temporary = workspace('chapter-35');
const chapter = 'chapter-35-agent-evaluation';
const lessons = ['01-fixed-tasks', '02-failure-and-terminal', '03-live-model-benchmark'];
const closeModel = async model => { try { await model.jobs?.close(); } finally { await model.languageService?.close(); } };
const tool = (id, name, input) => ({ id, name, arguments: JSON.stringify(input) });
try {
  const compiled = lessons.map(lesson => build(chapter, lesson, temporary));
  for (let index = 0; index < compiled.length; index++) {
    const { runEvaluation } = await compiled[index].load('evaluation/runner.js');
    const report = await runEvaluation(index ? 'regression' : 'offline', join(temporary.directory, `cases-${index}`));
    assert.equal(report.passed, true);
    assert.equal(report.cases[0].taskPassed, true);
    assert.equal(report.cases[0].testSucceeded, true);
    assert.deepEqual(report.cases[0].changedPaths, ['src/add.mjs']);
    assert.equal(report.cases[0].modelCalls, 4);
    assert.equal(report.cases[0].toolResults, 4);
    assert.equal(report.cases[0].inputTokens, null);
    assert.equal(report.cases[0].costEstimateUsd, null);
    assert.match(readFileSync(join(report.cases[0].workspace, 'src/add.mjs'), 'utf8'), /return a \+ b/);
    for (const item of report.cases) assert.deepEqual(JSON.parse(readFileSync(item.reportPath, 'utf8')), item);
    if (index) {
      assert.equal(report.cases.length, 6);
      assert.deepEqual(report.cases.filter(item => item.taskPassed).map(item => item.scenario), ['repair']);
      const cancelled = report.cases.find(item => item.scenario === 'cancel-after-edit');
      assert.equal(cancelled.outcome, 'cancelled');
      assert.equal(cancelled.testSucceeded, false);
      assert.deepEqual(cancelled.changedPaths, ['src/add.mjs']);
      assert.equal(cancelled.checks.every(item => item.passed), true);
      assert.equal(report.cases.find(item => item.scenario === 'denied').refusals, 1);
      assert.deepEqual(report.cases.find(item => item.scenario === 'protected-edit').changedPaths, []);
      assert.ok(report.cases.find(item => item.scenario === 'missing-file').toolErrors > 0);
      assert.equal(report.terminal.length, 6);
      assert.ok(report.terminal.every(item => item.passed), JSON.stringify(report.terminal));
    }
    // Missing a call ID is rejected by the replay before it can mask an incomplete batch.
    const { createReplay } = await compiled[index].load('evaluation/replay.js');
    const replay = createReplay();
    await replay.generate([], new AbortController().signal);
    await assert.rejects(replay.generate([{ role: 'tool', content: 'only one', toolCallId: 'read-source' }], new AbortController().signal), /全部工具结果/);
  }

  const final = compiled[2];
  const { evaluateCase, runEvaluation } = await final.load('evaluation/runner.js');
  // A hidden but explicitly requested tool is also refused locally; no shell marker is created.
  let index = 0;
  const forbidden = await evaluateCase(join(temporary.directory, 'forbidden'), 'repair', {
    async generate() { return ++index === 1 ? reply('', [tool('forbidden-command', 'run_command', { command: 'touch forbidden-marker', cwd: '.', timeout_ms: 1000 })]) : reply('done'); },
  });
  assert.equal(forbidden.taskPassed, false);
  assert.equal(existsSync(join(forbidden.workspace, 'forbidden-marker')), false);
  assert.ok(forbidden.changedPaths.length === 0);
  // Core round limit does not execute the eighth response's new tool batch.
  let round = 0;
  const limited = await evaluateCase(join(temporary.directory, 'limit'), 'repair', {
    async generate() { return reply('', [tool(`read-${++round}`, 'read_file', { path: 'src/add.mjs', offset: 1, limit: 20 })]); },
  });
  assert.equal(limited.modelCalls, 8); assert.equal(limited.toolResults, 7); assert.equal(limited.outcome, 'error');
  await assert.rejects(runEvaluation('live', join(temporary.directory, 'no-implicit-model')), /显式提供/);

  const steps = [
    reply('', [tool('read-source', 'read_file', { path: 'src/add.mjs', offset: 1, limit: 40 }), tool('read-tests', 'read_file', { path: 'test/add.test.mjs', offset: 1, limit: 40 })]),
    reply('', [tool('fix-add', 'edit_file', { path: 'src/add.mjs', old_text: 'return a - b;', new_text: 'return a + b;' })]),
    reply('', [tool('test-add', 'check_project', { script: 'test' })]), reply('修复且测试完成。'),
  ];
  const { createModel } = await final.load('models/client.js');
  for (const provider of ['openai', 'anthropic']) {
    let next = 0;
    const server = await sdkServer((entry, response) => {
      const previous = steps[next - 1]?.toolCalls ?? [];
      const serialized = JSON.stringify(entry.body.messages);
      for (const call of previous) assert.ok(serialized.includes(call.id));
      assert.deepEqual(entry.body.tools.map(item => item.function?.name ?? item.name).sort(), ['check_project', 'edit_file', 'read_file']);
      sendReply(entry, response, steps[next++], provider === 'anthropic'
        ? { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
        : { prompt_tokens: 3, completion_tokens: 2 });
    });
    const model = createModel({ provider, apiKey: 'PRIVATE_FIXTURE_KEY', model: 'local-fixture', baseURL: server.url });
    try {
      const report = await runEvaluation('live', join(temporary.directory, `sdk-${provider}`), model);
      assert.equal(report.passed, true); assert.equal(server.requests.length, 4);
      const item = report.cases[0];
      assert.equal(item.mode, 'live'); assert.deepEqual(item.model, { provider, name: 'local-fixture' });
      assert.equal(item.inputTokens, 12, provider); assert.equal(item.outputTokens, 8, provider);
      assert.equal(item.costEstimateUsd, null);
      assert.equal(JSON.stringify(item).includes('PRIVATE_FIXTURE_KEY'), false);
      assert.equal(JSON.stringify(item).includes(server.url), false);
    } finally { await closeModel(model); await server.close(); }
  }
  // Missing usage stays unknown rather than becoming a partial or fabricated total.
  const unknown = await sdkServer((entry, response) => sendReply(entry, response, reply('未修改。')));
  const unknownModel = createModel({ provider: 'openai', apiKey: 'fixture', model: 'local-fixture', baseURL: unknown.url });
  try {
    const report = await evaluateCase(join(temporary.directory, 'unknown'), 'repair', unknownModel);
    assert.equal(report.inputTokens, null); assert.equal(report.outputTokens, null); assert.equal(report.taskPassed, false);
  } finally { await closeModel(unknownModel); await unknown.close(); }

  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENAI_') && !key.startsWith('ANTHROPIC_') && !key.startsWith('AGENT_')));
  const cli = spawnSync(process.execPath, [join(final.dist, 'cli.js'), '--evaluate', 'offline', '--evaluation-dir', join(temporary.directory, 'cli')], { cwd: temporary.directory, env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /通过 repair/);
  for (const args of [['--evaluate', 'live', '--prompt', 'do not send'], ['--evaluate', 'unknown'], ['--evaluation-dir', 'stray']]) {
    const result = spawnSync(process.execPath, [join(final.dist, 'cli.js'), ...args], { cwd: temporary.directory, env: cleanEnv, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /缺少 .*API_KEY/);
  }

  // Literal published answer is compiled as an independent complete snapshot.
  const page = readFileSync(join(root, chapter, 'EXERCISES.md'), 'utf8');
  const answer = /<!-- answer-file: src\/evaluation\/checks.ts -->\s*```typescript\n([\s\S]*?)\n```/.exec(page);
  assert.ok(answer, 'exercise publishes the complete answer');
  const source = join(temporary.directory, 'exercise-source'), dist = join(temporary.directory, 'exercise-dist');
  cpSync(join(root, chapter, lessons[2], 'src'), source, { recursive: true });
  writeFileSync(join(source, 'evaluation/checks.ts'), answer[1] + '\n');
  writeFileSync(join(temporary.directory, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(temporary.directory, 'node_modules'));
  const config = join(temporary.directory, 'exercise-tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist, typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, '**/*.ts'), join(source, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const { checkCalculations, CALCULATION_VERSION } = await import(pathToFileURL(join(dist, 'evaluation/checks.js')));
  assert.equal(CALCULATION_VERSION, 'decimal-v2');
  const project = join(temporary.directory, 'exercise-project'); mkdirSync(join(project, 'src'), { recursive: true });
  for (const [implementation, expected] of [
    ['return a + b;', [true, true, true, true]],
    ['if(a===2&&b===3)return 5;if(a===-2&&b===-3)return -5;if(a===0&&b===0)return 0;return a-b;', [true, true, true, false]],
    ['throw new Error("broken");', [false, false, false, false]],
  ]) {
    writeFileSync(join(project, 'src/add.mjs'), `export function add(a,b){${implementation}}\n`);
    assert.deepEqual((await checkCalculations(project)).map(item => item.passed), expected);
  }
  for (const lesson of lessons) {
    const markdown = readFileSync(join(root, chapter, lesson, 'README.md'), 'utf8');
    for (const match of markdown.matchAll(/<!-- build-file: ([^ ]+) -->[\s\S]*?```typescript\n([\s\S]*?)\n```/g)) {
      assert.equal(match[2] + '\n', readFileSync(join(root, chapter, lesson, match[1]), 'utf8'), `${lesson}/${match[1]} matches published source`);
    }
  }
  console.log('Chapter 35 passed: 3 full snapshots, real read/edit/test, 6 scenarios, 6 terminal probes, 2 local SDKs, limits, CLI isolation and literal exercise.');
} finally { temporary.close(); }
