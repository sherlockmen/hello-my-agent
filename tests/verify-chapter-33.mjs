/** Chapter 33: isolated builds, real OS restrictions, and the literal exercise answer. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { build, root, signal, workspace } from './runtime-fixtures.mjs';

const chapter = 'chapter-33-execution-sandbox';
const temporary = workspace('chapter33');
const previousCwd = process.cwd();
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const node = script => `${quote(process.execPath)} -e ${quote(script)}`;
const lessons = ['01-sandbox-runtime', '02-connect-execution', '03-diagnose-boundaries'];
const directory = name => { const path = join(temporary.directory, name); mkdirSync(path, { recursive: true }); return realpathSync(path); };
let latest;
try {
  for (const [index, lesson] of lessons.entries()) {
    const compiled = build(chapter, lesson, temporary);
    const runtime = await compiled.load('sandbox/runtime.js');
    const { prepareRunCommand } = await compiled.load('tools/run-command.js');
    const { prepareCheckProject } = await compiled.load('tools/check-project.js');
    const { JobManager } = await compiled.load('processes/jobs.js');
    const project = directory(`${lesson}-project`), outside = directory(`${lesson}-outside`);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module', scripts: {
      test: node(`require('node:fs').writeFileSync(${JSON.stringify(join(outside, 'check-escape'))},'ESCAPE')`),
      typecheck: node("console.log('TYPECHECK_OK')"),
    } }));
    writeFileSync(join(project, '.env'), 'FAKE_SECRET=teaching-only');
    writeFileSync(join(project, 'ordinary.txt'), 'PUBLIC_SOURCE');
    mkdirSync(join(project, 'nested'));
    process.chdir(project);
    const jobs = new JobManager();
    try {
      const status = await runtime.sandboxAvailability();
      assert.deepEqual(status.errors, [], `A real supported sandbox is required: ${status.errors.join('; ')}`);
      assert.equal(status.runtime, '0.0.79');
      assert.ok(status.defaultWritePaths.includes('/tmp/claude'));
      // Host controls prove these temporary targets are writable and the fake secret is readable.
      writeFileSync(join(outside, 'host-control'), 'HOST_OK');
      assert.equal(readFileSync(join(outside, 'host-control'), 'utf8'), 'HOST_OK');
      assert.match(readFileSync(join(project, '.env'), 'utf8'), /teaching-only/);
      const execute = async command => (await prepareRunCommand(JSON.stringify({ command, cwd: '.', timeout_ms: 5000 }), project, signal())).execute(signal());
      const allowed = await prepareRunCommand(JSON.stringify({ command: 'printf INSIDE_OK > inside.txt', cwd: '.' }), project, signal());
      assert.equal(existsSync(join(project, 'inside.txt')), false, 'Preparing approval must not start the command');
      assert.match(allowed.preview, /隔离/);
      assert.equal((await allowed.execute(signal())).isError, false);
      assert.equal(readFileSync(join(project, 'inside.txt'), 'utf8'), 'INSIDE_OK');
      const escaped = join(outside, 'outside.txt');
      const rejected = await execute(node(`require('node:fs').writeFileSync(${JSON.stringify(escaped)},'ESCAPE')`));
      assert.equal(rejected.isError, true); assert.equal(existsSync(escaped), false);
      const readSecret = await execute('cat .env');
      assert.equal(readSecret.isError, true); assert.doesNotMatch(readSecret.content, /FAKE_SECRET=teaching-only/);
      assert.match((await execute('cat ordinary.txt')).content, /PUBLIC_SOURCE/);
      assert.equal((await execute('printf CHANGED > .env')).isError, true);
      assert.equal(readFileSync(join(project, '.env'), 'utf8'), 'FAKE_SECRET=teaching-only');
      const check = await prepareCheckProject('{"script":"test"}', project, signal());
      assert.match(check.preview, /check-escape/);
      assert.equal((await check.execute(signal())).isError, true);
      assert.equal(existsSync(join(outside, 'check-escape')), false, 'check_project must use the actual sandboxed path');
      assert.match((await (await prepareCheckProject('{"script":"typecheck"}', project, signal())).execute(signal())).content, /TYPECHECK_OK/);
      // A new workspace gets its own allow root; a previous workspace is not globally added.
      const other = directory(`${lesson}-other`);
      const otherRun = await prepareRunCommand(JSON.stringify({ command: node(`require('node:fs').writeFileSync(${JSON.stringify(join(project, 'cross-workspace'))},'ESCAPE')`), cwd: '.' }), other, signal());
      assert.equal((await otherRun.execute(signal())).isError, true); assert.equal(existsSync(join(project, 'cross-workspace')), false);
      // No unavailable-runtime or unwrapped-command fallback may launch a raw shell.
      await runtime.closeSandbox();
      const supported = SandboxManager.isSupportedPlatform;
      SandboxManager.isSupportedPlatform = () => false;
      try {
        await assert.rejects(execute('printf BAD > fallback.txt'), /隔离不可用/);
        assert.equal(existsSync(join(project, 'fallback.txt')), false);
      } finally { SandboxManager.isSupportedPlatform = supported; }
      const wrap = SandboxManager.wrapWithSandbox;
      SandboxManager.wrapWithSandbox = async command => command;
      try {
        await assert.rejects(execute('printf BAD > bypass.txt'), /包装未生效/);
        assert.equal(existsSync(join(project, 'bypass.txt')), false);
      } finally { SandboxManager.wrapWithSandbox = wrap; await runtime.closeSandbox(); }
      if (index >= 1) {
        const { prepareJob } = await compiled.load('tools/job-tools.js');
        for (const transport of ['pipe', 'pty']) {
          const target = join(outside, `job-${transport}`);
          const prepared = await prepareJob('start_job', JSON.stringify({ command: node(`require('node:fs').writeFileSync(${JSON.stringify(target)},'ESCAPE')`), cwd: '.', transport, timeout_ms: 5000 }), jobs, signal());
          assert.equal(existsSync(target), false);
          const started = await prepared.execute(signal());
          const final = await jobs.wait(started.metadata.job.id);
          assert.notEqual(final.exitCode, 0); assert.equal(existsSync(target), false);
          assert.ok(final.endedAt); assert.equal(final.command.includes('sandbox-exec'), false, 'Snapshot keeps original command');
        }
        const interactive = await jobs.start({ command: "printf 'READY\\n'; read line; printf 'received:%s\\n' \"$line\"", cwd: project, sandboxRoot: project, transport: 'pty', timeoutMs: 5000, readyText: 'READY' }, signal());
        const attached = jobs.attach(interactive.id, () => {});
        attached.write('hello\r');
        const final = await jobs.wait(interactive.id); attached.detach();
        assert.equal(final.exitCode, 0); assert.match(final.log, /received:hello/); assert.equal(final.readiness, 'ready');
        const long = await jobs.start({ command: "printf KEPT > before-stop.txt; printf 'READY\\n'; exec sleep 30", cwd: project, sandboxRoot: project, timeoutMs: 5000, readyText: 'READY' }, signal());
        await new Promise((resolve, reject) => {
          if (jobs.get(long.id).readiness === 'ready') return resolve();
          const timer = setTimeout(() => { unsubscribe(); reject(new Error('No readiness evidence')); }, 2000);
          const unsubscribe = jobs.subscribe(notice => { if (notice.job.id === long.id && notice.type === 'ready') { clearTimeout(timer); unsubscribe(); resolve(); } });
        });
        const stopped = await jobs.stop(long.id); assert.ok(stopped.endedAt); assert.equal(stopped.stopReason, 'user');
        assert.equal(readFileSync(join(project, 'before-stop.txt'), 'utf8'), 'KEPT');
        await runtime.closeSandbox();
        SandboxManager.isSupportedPlatform = () => false;
        const before = jobs.list().length;
        try { await assert.rejects(jobs.start({ command: 'printf BAD > job-fallback', cwd: project, timeoutMs: 1000 }), /隔离不可用/); }
        finally { SandboxManager.isSupportedPlatform = supported; }
        assert.equal(jobs.list().length, before); assert.equal(existsSync(join(project, 'job-fallback')), false);
      }
      if (index === 2) {
        const { sandboxInfo, runSandboxCheck } = await compiled.load('sandbox/diagnostics.js');
        const info = await sandboxInfo(project);
        assert.equal(info.available, true); assert.match(info.text, /未执行/); assert.match(info.text, /语言服务/); assert.match(info.text, /\.npm\/_logs/);
        const report = await runSandboxCheck();
        assert.equal(report.passed, true, JSON.stringify(report));
        assert.equal(report.checks.length, 5);
        // Both management branches work before model config and clean their resources.
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (/API_KEY|AUTH_TOKEN|BASE_URL|MODEL/.test(key)) delete env[key];
        for (const flag of ['--sandbox-info', '--sandbox-check']) {
          const result = spawnSync(process.execPath, [join(compiled.dist, 'cli.js'), flag], { cwd: project, env, encoding: 'utf8', timeout: 15000 });
          assert.equal(result.status, 0, `${flag}: ${result.stderr}`); assert.doesNotMatch(result.stderr, /缺少.*API|API.*required/i);
          assert.match(result.stdout, flag === '--sandbox-info' ? /未执行/ : /PASS.*直接网络/);
        }
        latest = { source: join(root, chapter, lesson, 'src') };
      }
      // The preceding LSP capability remains in every cumulative snapshot.
      assert.equal(typeof (await compiled.load('language-service/client.js')).LanguageService, 'function');
    } finally { await jobs.close(); await runtime.closeSandbox(); }
    console.log(`✓ 33.${index + 1}: actual sandbox, project checks, fail closed${index ? ', pipe and PTY' : ''}`);
  }
  // Compile and execute the exact complete answer from the published exercise page.
  const answers = [...readFileSync(join(root, chapter, 'EXERCISES.md'), 'utf8').matchAll(/<!-- answer-file: ([^ ]+) -->\n```[^\n]+\n([\s\S]*?)\n```/g)];
  assert.equal(answers.length, 1);
  const answer = directory('exercise'), source = join(answer, 'src');
  cpSync(latest.source, source, { recursive: true });
  for (const [, relative, content] of answers) { const path = join(answer, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content + '\n'); }
  writeFileSync(join(answer, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(answer, 'node_modules'));
  writeFileSync(join(answer, 'tsconfig.json'), JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: join(answer, 'dist'), typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, '**/*.ts'), join(source, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(answer, 'tsconfig.json')], { stdio: 'inherit' });
  const { checkEscapeRoutes } = await import(pathToFileURL(join(answer, 'dist/sandbox/escape-check.js')));
  assert.deepEqual(await checkEscapeRoutes(signal()), { control: true, childDenied: true, symlinkDenied: true });
  console.log('✓ 33 exercises: literal answer, ordinary child inheritance and symlink target denial');
} finally { process.chdir(previousCwd); temporary.close(); }
