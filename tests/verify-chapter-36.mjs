/** Chapter 36: real isolated snapshots, tarball installation, configuration migration, and v1 session compatibility. */
import assert from 'node:assert/strict';
import fs, { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, workspace, build, sdkServer, sendReply, reply } from './runtime-fixtures.mjs';
import { isolatedEnv, runCli } from './verify-chat.mjs';

const chapter = 'chapter-36-release-and-upgrade';
const lessons = ['01-package-and-install', '02-release-gates', '03-config-and-session-upgrade'];
const temporary = workspace('chapter-36');
const originalDirectory = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let server;
function command(binary, args, cwd = temporary.directory, expected = 0, env = {}) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 120_000,
    env: isolatedEnv({ HOME: temporary.directory, ...env }), shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (expected !== null) assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}
function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(directory, name) : [name];
  });
}
function json(path, value) { writeFileSync(path, JSON.stringify(value)); return path; }
try {
  for (const [index, lesson] of lessons.entries()) {
    const markdown = readFileSync(join(root, chapter, lesson, 'README.md'), 'utf8');
    const blocks = [...markdown.matchAll(/<!-- build-file: ([^ ]+) -->[\s\S]*?```typescript\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, [5, 2, 3][index], 'every changed/new file has a complete public build block');
    for (const match of blocks) assert.equal(match[2] + '\n', readFileSync(join(root, chapter, lesson, match[1]), 'utf8'), `${lesson}/${match[1]} public source matches snapshot`);
  }
  const built = lessons.map(lesson => build(chapter, lesson, temporary));
  const cwd = join(temporary.directory, 'unrelated-project');
  mkdirSync(cwd); json(join(cwd, 'package.json'), { private: true });
  const v1 = { version: 1, provider: 'openai', model: 'profile-model', baseUrl: 'https://example.invalid/v1' };
  const profile = join(cwd, 'connection.json'); json(profile, v1);
  for (const [index, snapshot] of built.entries()) {
    const cli = join(snapshot.dist, 'cli.js');
    const bash = command(process.execPath, [cli, 'completion', 'bash'], cwd).stdout;
    const zsh = command(process.execPath, [cli, 'completion', 'zsh'], cwd).stdout;
    assert.match(bash, /--config/); assert.match(bash, /complete -F/); assert.match(zsh, /compdef _hello_my_agent/);
    command(process.execPath, [cli, 'completion', 'fish'], cwd, 1);
    command(process.execPath, [cli, 'completion', 'bash', 'extra'], cwd, 1);
    const bashFile = temporary.file(`completion-${index}.bash`, bash);
    command('bash', ['-n', bashFile]);
    const completion = command('bash', ['-c', 'source "$1"; COMP_WORDS=(hello-my-agent --con); COMP_CWORD=1; _hello_my_agent; printf "%s\\n" "${COMPREPLY[@]}"', 'fixture', bashFile]);
    assert.match(completion.stdout, /--config/);
    if (process.platform !== 'win32') {
      const zshFile = temporary.file(`completion-${index}.zsh`, zsh);
      command('zsh', ['-n', zshFile]);
      command('zsh', ['-c', 'autoload -Uz compinit; compinit -D; source "$1"; (( $+functions[_hello_my_agent] ))', 'fixture', zshFile]);
    }
    const config = await snapshot.load('config/load-config.js');
    const profileModule = await snapshot.load('config/connection-profile.js');
    json(profile, index === 2 ? { version: 2, connection: { provider: v1.provider, model: v1.model, baseUrl: v1.baseUrl } } : v1);
    process.chdir(cwd);
    const previousEnvironment = { ...process.env };
    try {
      for (const name of Object.keys(process.env)) if (/^(OPENAI|ANTHROPIC|AGENT)_/.test(name)) delete process.env[name];
      writeFileSync(join(cwd, '.env'), 'OPENAI_API_KEY=file-key\nOPENAI_MODEL=file-model\nANTHROPIC_API_KEY=file-anthropic\nANTHROPIC_MODEL=file-claude\nANTHROPIC_BASE_URL=https://anthropic.example.invalid\n');
      process.env.OPENAI_API_KEY = 'process-key'; process.env.OPENAI_MODEL = 'process-model';
      assert.equal(config.readConfig({ config: profile }).model, 'profile-model');
      assert.equal(config.readConfig({ config: profile, model: 'cli-model' }).model, 'cli-model');
      assert.equal(config.readConfig({}).model, 'process-model');
      assert.equal(config.readConfig({ config: profile }).apiKey, 'process-key');
      const switched = config.readConfig({ config: profile, provider: 'anthropic' });
      assert.equal(switched.provider, 'anthropic'); assert.equal(switched.apiKey, 'file-anthropic'); assert.equal(switched.model, 'file-claude'); assert.equal(switched.baseURL, 'https://anthropic.example.invalid');
      const overridden = config.readConfig({ config: profile, provider: 'anthropic', model: 'explicit-claude', baseUrl: 'https://explicit.example.invalid' });
      assert.equal(overridden.model, 'explicit-claude'); assert.equal(overridden.baseURL, 'https://explicit.example.invalid');
      const anthropic = { provider: 'anthropic', model: 'claude-fixture' };
      json(profile, index === 2 ? { version: 2, connection: anthropic } : { version: 1, ...anthropic });
      assert.equal(config.readConfig({ config: profile }).apiKey, 'file-anthropic');
      json(profile, { version: 99, apiKey: 'DO-NOT-PRINT-secret' });
      assert.throws(() => config.readConfig({ config: profile }), error => !error.message.includes('DO-NOT-PRINT'));
      writeFileSync(profile, '{"secret":"DO-NOT-PRINT');
      assert.throws(() => profileModule.readConnectionProfile(profile), error => !error.message.includes('DO-NOT-PRINT'));
      json(profile, index === 2 ? { version: 2, connection: { ...anthropic, apiKey: 'DO-NOT-PRINT' } } : { version: 1, ...anthropic, apiKey: 'DO-NOT-PRINT' });
      assert.throws(() => profileModule.readConnectionProfile(profile), /未知字段/);
      writeFileSync(profile, ' '.repeat(65_537)); assert.throws(() => profileModule.readProfileText(profile), /64 KiB/);
      const link = join(cwd, `profile-link-${index}`); symlinkSync(profile, link); assert.throws(() => profileModule.readProfileText(link), /普通 JSON/);
      assert.throws(() => profileModule.readProfileText(cwd), /普通 JSON/);
      if (process.platform !== 'win32') {
        const fifo = join(cwd, `profile-fifo-${index}`); command('mkfifo', [fifo]);
        // A timeout here catches opening a FIFO in blocking mode before the regular-file check.
        const readFifo = spawnSync(process.execPath, ['--input-type=module', '-e', `const {readProfileText}=await import(${JSON.stringify(pathToFileURL(join(snapshot.dist, 'config/connection-profile.js')).href)});try{readProfileText(process.argv[1]);process.exit(2)}catch{}` , fifo], { encoding: 'utf8', timeout: 2000 });
        assert.equal(readFifo.error, undefined, 'FIFO must be rejected without waiting for a writer'); assert.equal(readFifo.status, 0);
      }
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previousEnvironment)) delete process.env[key];
      Object.assign(process.env, previousEnvironment); process.chdir(originalDirectory);
    }
  }
  console.log('✓ 36.1/2/3 strictly compiled; actual Bash/Zsh registration, config precedence, protocol keys, safe errors, FIFO and bounded input checks passed');

  const final = built[2];
  const migration = await final.load('config/migrate-config.js');
  const reader = await final.load('config/connection-profile.js');
  const migratePath = join(cwd, 'upgrade.json');
  const original = JSON.stringify({ ...v1, model: 'another-real-model' }); writeFileSync(migratePath, original);
  assert.equal(migration.migrateConfig(migratePath), true);
  assert.equal(reader.readConnectionProfile(migratePath).model, 'another-real-model');
  assert.equal(readFileSync(`${migratePath}.v1.bak`, 'utf8'), original);
  if (process.platform !== 'win32') for (const path of [migratePath, `${migratePath}.v1.bak`]) assert.equal(statSync(path).mode & 0o777, 0o600);
  const once = readFileSync(migratePath, 'utf8'); assert.equal(migration.migrateConfig(migratePath), false); assert.equal(readFileSync(migratePath, 'utf8'), once);
  for (const [label, value] of [['future', { version: 99 }], ['secret', { ...v1, apiKey: 'DO-NOT-PRINT' }], ['url', { ...v1, baseUrl: 'https://user:secret@example.invalid' }]]) {
    const path = join(cwd, `${label}.json`); const text = JSON.stringify(value); writeFileSync(path, text);
    assert.throws(() => migration.migrateConfig(path)); assert.equal(readFileSync(path, 'utf8'), text); assert.ok(!existsSync(`${path}.v1.bak`));
  }
  for (const suffix of ['.v1.bak', '.migrate.lock']) {
    const path = join(cwd, `existing-${suffix.slice(1)}.json`); const text = JSON.stringify(v1); writeFileSync(path, text); writeFileSync(path + suffix, 'KEEP');
    assert.throws(() => migration.migrateConfig(path)); assert.equal(readFileSync(path, 'utf8'), text); assert.equal(readFileSync(path + suffix, 'utf8'), 'KEEP');
  }
  const renameFailure = join(cwd, 'rename-fails.json'); json(renameFailure, v1);
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('simulated pre-commit failure'); }; syncBuiltinESMExports();
    assert.throws(() => migration.migrateConfig(renameFailure), /迁移未完成/);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.deepEqual(JSON.parse(readFileSync(renameFailure, 'utf8')), v1); assert.ok(existsSync(`${renameFailure}.v1.bak`)); assert.ok(!existsSync(`${renameFailure}.migrate.lock`));
  const cleanupFailure = join(cwd, 'cleanup-fails.json'); json(cleanupFailure, v1);
  const unlink = fs.unlinkSync;
  try {
    fs.unlinkSync = path => { if (String(path) === `${cleanupFailure}.migrate.lock`) throw new Error('simulated cleanup failure'); return unlink(path); }; syncBuiltinESMExports();
    assert.equal(migration.migrateConfig(cleanupFailure), true);
  } finally { fs.unlinkSync = unlink; syncBuiltinESMExports(); }
  assert.equal(reader.readConnectionProfile(cleanupFailure).model, 'profile-model'); assert.ok(existsSync(`${cleanupFailure}.migrate.lock`));
  console.log('✓ 36.3 migration: faithful fields, private backup/target, idempotence, unknown versions, existing backup/lock, pre-commit failure and post-commit cleanup failure passed');

  // Pack the independently compiled final snapshot, preserving the real package identity and runtime dependency list.
  const stage = join(temporary.directory, lessons[2]); json(join(stage, 'package.json'), pkg);
  for (const name of ['README.md', 'LICENSE']) copyFileSync(join(root, name), join(stage, name));
  chmodSync(join(final.dist, 'cli.js'), 0o755);
  const packed = command(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary.directory], stage);
  const manifest = Object.values(JSON.parse(packed.stdout)); const packPath = temporary.file('pack.json', packed.stdout);
  const expectedModules = files(join(root, chapter, lessons[2], 'src')).filter(path => /\.tsx?$/.test(path)).map(path => `dist/${path.replace(/\.tsx?$/, '.js')}`);
  assert.deepEqual(manifest[0].files.map(item => item.path).sort(), ['LICENSE', 'README.md', 'package.json', ...expectedModules].sort());
  const release = await final.load('release/check-package.js'); assert.equal(release.checkPackage(packPath, pkg), expectedModules.length + 3);
  const invalid = temporary.file('invalid-pack.json', '');
  json(invalid, manifest); release.checkPackage(invalid, pkg);
  json(invalid, { [pkg.name]: manifest[0], extra: manifest[0] }); assert.throws(() => release.checkPackage(invalid, pkg), /只有一个包/);
  for (const mutate of [info => info.files.push({ path: '../secret', size: 1 }), info => info.files.push({ path: 'source/config.ts', size: 1 }), info => { info.files = info.files.filter(file => file.path !== 'dist/cli.js'); }, info => { info.version = 'wrong'; }]) {
    const copy = structuredClone(manifest); mutate(copy[0]); json(invalid, copy); assert.throws(() => release.checkPackage(invalid, pkg));
  }
  writeFileSync(invalid, '{DO-NOT-PRINT'); assert.throws(() => release.checkPackage(invalid, pkg), error => !error.message.includes('DO-NOT-PRINT'));
  if (process.platform !== 'win32') {
    const fifo = join(cwd, 'pack-fifo'); command('mkfifo', [fifo]);
    const rejected = spawnSync(process.execPath, [join(final.dist, 'cli.js'), 'release-check', fifo], { cwd, encoding: 'utf8', timeout: 2000 });
    assert.equal(rejected.error, undefined, 'release-check must reject FIFO without opening it'); assert.equal(rejected.status, 1);
  }
  // Compile and execute the complete published exercise replacement without touching the chapter snapshot.
  const answer = readFileSync(join(root, chapter, 'EXERCISES.md'), 'utf8').match(/<!-- solution: src\/release\/check-package\.ts -->\s*```typescript\n([\s\S]*?)\n```/);
  assert.ok(answer); const exercise = join(temporary.directory, 'exercise'); mkdirSync(join(exercise, 'src/release'), { recursive: true });
  json(join(exercise, 'package.json'), { type: 'module' }); symlinkSync(join(root, 'node_modules'), join(exercise, 'node_modules'));
  copyFileSync(join(root, chapter, lessons[2], 'src/errors.ts'), join(exercise, 'src/errors.ts')); writeFileSync(join(exercise, 'src/release/check-package.ts'), answer[1] + '\n');
  json(join(exercise, 'tsconfig.json'), { extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: join(exercise, 'src'), outDir: join(exercise, 'dist') }, include: [join(exercise, 'src/**/*.ts')] });
  command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(exercise, 'tsconfig.json')]);
  const solved = await import(pathToFileURL(join(exercise, 'dist/release/check-package.js')));
  solved.checkPackage(packPath, pkg);
  for (const size of [0, -1, 1.5, undefined, Number.MAX_SAFE_INTEGER + 1]) { const copy = structuredClone(manifest); copy[0].files.find(file => file.path === 'dist/cli.js').size = size; json(invalid, copy); assert.throws(() => solved.checkPackage(invalid, pkg), /空模块|大小/); }
  const extra = structuredClone(manifest); extra[0].files.push({ path: 'source/config.ts', size: 1 }); json(invalid, extra); assert.throws(() => solved.checkPackage(invalid, pkg), /范围/);
  const missing = structuredClone(manifest); missing[0].files = missing[0].files.filter(file => file.path !== 'dist/cli.js'); json(invalid, missing); assert.throws(() => solved.checkPackage(invalid, pkg), /缺少/);
  console.log(`✓ Real npm tarball has exactly ${expectedModules.length + 3} approved files; release gate and complete exercise replacement passed`);

  const prefix = join(temporary.directory, 'installed');
  command(npm, ['install', '--global', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary.directory, manifest[0].filename)]);
  command(npm, ['rebuild', 'node-pty', '--global', '--prefix', prefix, '--foreground-scripts', '--allow-scripts=node-pty'], temporary.directory, 0,
    { npm_config_build_from_source: 'true', ...(process.env.npm_config_nodedir ? { npm_config_nodedir: process.env.npm_config_nodedir } : {}) });
  const modules = command(npm, ['root', '--global', '--prefix', prefix]).stdout.trim();
  const installed = join(modules, ...pkg.name.split('/'));
  assert.ok(!existsSync(join(installed, 'node_modules/@types/node')));
  assert.ok(existsSync(join(installed, 'node_modules/typescript/lib/tsserver.js')));
  const cli = join(prefix, process.platform === 'win32' ? 'hello-my-agent.cmd' : 'bin/hello-my-agent');
  assert.equal(command(cli, ['--version'], cwd).stdout.trim(), pkg.version);
  assert.match(command(cli, ['completion', 'bash'], cwd).stdout, /release-check/);
  assert.match(command(cli, ['release-check', packPath], cwd).stdout, /检查通过/);
  const v2 = json(join(cwd, 'installed-v2.json'), { version: 2, connection: { provider: 'openai', model: 'installed-profile' } });
  assert.match(command(cli, ['--config', v2, '--doctor'], cwd, 0, { OPENAI_API_KEY: 'local-fixture' }).stdout, /通过|完整|有效/);
  let frame = 0;
  server = await sdkServer((entry, response) => {
    const previousIds = [[], ['read-source', 'read-tests'], ['fix-add'], ['test-add']][frame];
    for (const id of previousIds ?? []) assert.ok(entry.body.messages.some(message => message.role === 'tool' && message.tool_call_id === id));
    const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
    const frames = [reply('', [call('read-source', 'read_file', { path: 'src/add.mjs', offset: 1, limit: 40 }), call('read-tests', 'read_file', { path: 'test/add.test.mjs', offset: 1, limit: 40 })]),
      reply('', [call('fix-add', 'edit_file', { path: 'src/add.mjs', old_text: 'return a - b;', new_text: 'return a + b;' })]),
      reply('', [call('test-add', 'check_project', { script: 'test' })]), reply('LOCAL_INSTALLED_COMPLETE')];
    sendReply(entry, response, frames[frame++]);
  });
  const sdkEnv = { HOME: temporary.directory, OPENAI_API_KEY: 'local-fixture', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: `${server.url}/v1` };
  const evaluationDirectory = join(temporary.directory, 'installed-sdk-evaluation');
  const evaluated = await runCli(cli, ['--evaluate', 'live', '--evaluation-dir', evaluationDirectory], cwd, sdkEnv);
  assert.equal(evaluated.status, 0, evaluated.stderr || evaluated.stdout); assert.equal(server.requests.length, 4);
  const caseDir = readdirSync(evaluationDirectory).find(name => name.startsWith('repair-'));
  const report = JSON.parse(readFileSync(join(evaluationDirectory, caseDir, 'report.json'), 'utf8'));
  assert.equal(report.taskPassed, true); assert.equal(report.testSucceeded, true); assert.equal(report.toolResults, 4); assert.deepEqual(report.changedPaths, ['src/add.mjs']);
  assert.match(readFileSync(join(report.workspace, 'src/add.mjs'), 'utf8'), /return a \+ b;/);
  const lastTools = server.requests[3].body.messages.filter(message => message.role === 'tool');
  assert.ok(lastTools.some(message => message.tool_call_id === 'test-add' && /exit|退出|passed|通过/i.test(JSON.stringify(message.content))));
  console.log('✓ Installed --omit=dev tarball outside source: real SDK 4 rounds -> file reads -> edit -> actual test exit 0 -> tool results returned');

  // Write a genuine v1 record through Chapter 13, then restore using only the installed Chapter 36 CLI.
  const old = build('chapter-13-session-persistence', '04-manage-sessions', temporary);
  const storage = await old.load('sessions/save-session.js'); const sessionDirectory = join(temporary.directory, 'old-sessions');
  const marker = join(cwd, 'HISTORY_MUST_NOT_REPLAY');
  process.chdir(cwd);
  const writer = await storage.createSessionWriter(sessionDirectory);
  const state = { messages: [{ role: 'user', content: '记住已经完成的命令' }, { role: 'assistant', content: '', toolCalls: [{ id: 'old-command', name: 'run_command', arguments: JSON.stringify({ command: 'touch HISTORY_MUST_NOT_REPLAY', cwd: '.' }) }] },
    { role: 'tool', toolCallId: 'old-command', content: '历史记录中的结果', isError: false }, { role: 'assistant', content: '历史任务结束' }], mode: 'execute', tasks: [], pendingInputs: [], run: 1, nextInputId: 1 };
  await writer.save(state, 'run_end'); await writer.close(); process.chdir(originalDirectory);
  assert.equal(JSON.parse(readFileSync(writer.path, 'utf8').split('\n')[0]).version, 1);
  const requestsBefore = server.requests.length;
  const resumed = await runCli(cli, ['--resume', writer.id, '--session-dir', sessionDirectory, '--output', 'text'], cwd, sdkEnv, '/exit\n');
  assert.equal(resumed.status, 0, resumed.stderr); assert.match(resumed.stderr, /已恢复 4 条消息/); assert.equal(server.requests.length, requestsBefore); assert.ok(!existsSync(marker));
  const installedReader = await import(pathToFileURL(join(installed, 'dist/sessions/read-session.js')));
  const restored = await installedReader.readSession(writer.id, sessionDirectory);
  assert.deepEqual(restored.state.messages, state.messages);
  assert.ok(!existsSync(join(sessionDirectory, `${writer.id}.lock`)));
  console.log('✓ Genuine Chapter 13 v1 history resumed by installed Chapter 36: zero requests, no historical command replay, lock released');

  // npm's dry run is local preparation; private remains true and no upload command is issued.
  const dry = command(npm, ['publish', '--dry-run', '--ignore-scripts', '--offline'], stage, null);
  assert.ok([0, 1].includes(dry.status));
  console.log(`✓ npm publish --dry-run --ignore-scripts --offline exit=${dry.status}; package remains private=true; no public upload performed`);
} finally {
  process.chdir(originalDirectory);
  if (server) await server.close();
  temporary.close();
}
