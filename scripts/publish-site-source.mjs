// Publish the runnable public source without changing the author's checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const remote = 'https://github.com/sherlockmen/hello-my-agent.git';
const branch = 'codex/teaching-site';
// master excludes the website; its publication restores the site's commands and ignore rules.
function publicContent(path) {
  const content = readFileSync(join(root, path));
  if (path === '.gitignore') return Buffer.from(content.toString().split('\n# Docsify belongs to codex/teaching-site;')[0].trimEnd() + '\n');
  if (path !== 'package.json') return content;
  const pkg = JSON.parse(content);
  Object.assign(pkg.scripts, {
    'site:build': 'node scripts/build-site.mjs',
    'site:check': 'node tests/verify-site-build.mjs',
    'site:serve': 'node scripts/serve-site.mjs',
    'site:source': 'npm run site:build && node scripts/publish-site-source.mjs',
    'site:deploy': 'npm run site:build && npm run site:check && node scripts/publish-site-source.mjs && node scripts/deploy-site.mjs',
  });
  return Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
}
const args = process.argv.slice(2);
const checkOnly = args.length === 1 && args[0] === '--check';
const publicDocs = [
  'docs/SETUP.md', 'docs/PROGRESS.md', 'docs/CODING-AGENT-REFERENCES.md',
  'docs/CODING-AGENT-GAP-REVIEW.md', 'docs/planning/COURSE.md',
  'docs/planning/CAPABILITIES.md', 'docs/planning/REFERENCE-NOTES.md',
];
const blockedSegments = new Set(['.git', '.work', '.capture', '.idea', 'node_modules', 'dist', 'site-dist', 'coverage', '__pycache__', 'variants']);
const imagePattern = /\.(?:gif|png|jpe?g|webp|svg|avif)$/i;
const slash = path => path.split(sep).join('/');
const blocked = path => path.split('/').some(segment => blockedSegments.has(segment))
  || (basename(path).startsWith('.env') && basename(path) !== '.env.example')
  || basename(path) === '.DS_Store' || /\.(?:pyc|tgz)$/i.test(path);

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, {
    cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs[0]} 失败：${(result.stderr || result.stdout || '没有成功结果').trim()}`);
  return result.stdout.trim();
}

function walk(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink() || blocked(path)) return [];
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function selectSource(report) {
  const selected = new Set([
    'package.json', 'package-lock.json', 'tsconfig.json', 'LICENSE', '.env.example',
    '.npmrc', '.nvmrc', '.gitignore', 'README.md', ...publicDocs,
  ]);
  // Retain tracked root fixtures and configuration, including the TUI demo file.
  for (const path of run('git', ['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (!path.includes('/') && existsSync(join(root, path)) && !blocked(path)) selected.add(path);
  }
  const assets = new Set(report.assets);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^chapter-\d+-/.test(entry.name)) {
      for (const path of walk(entry.name)) {
        if ((!path.includes('/assets/') && !imagePattern.test(path)) || assets.has(path)) selected.add(path);
      }
    }
  }
  for (const directory of ['scripts', 'tests', 'website']) for (const path of walk(directory)) selected.add(path);
  for (const path of assets) {
    if (imagePattern.test(path) && existsSync(join(root, path))) selected.add(path);
  }
  const files = [...selected].sort();
  for (const path of files) {
    assert.ok(!blocked(path) && !isAbsolute(path) && !path.split('/').includes('..'), `禁止公开的路径：${path}`);
    const file = join(root, path);
    assert.ok(existsSync(file) && lstatSync(file).isFile(), `缺少公开源码文件：${path}`);
    const withinRoot = relative(root, realpathSync(file));
    assert.ok(!withinRoot.startsWith(`..${sep}`) && !isAbsolute(withinRoot), `源码路径越出仓库：${path}`);
    if (path.startsWith('docs/')) assert.ok(publicDocs.includes(path), `文档不在公开清单：${path}`);
    if (path.startsWith('chapter-') && (path.includes('/assets/') || imagePattern.test(path))) assert.ok(assets.has(path), `图片未被网站引用：${path}`);
  }
  for (const chapter of [13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) assert.ok(files.includes(`tests/verify-chapter-${chapter}.mjs`));
  assert.ok(files.includes('tests/verify-terminal-14.py'));
  assert.ok(files.includes('tests/verify-terminal-15.py'));
  assert.ok(files.includes('tests/verify-terminal-16.py'));
  assert.ok(files.includes('tests/verify-terminal-17.py'));
  assert.ok(files.includes('tests/verify-terminal-13.py'));
  assert.ok(files.includes('tui-approval-demo.txt'));
  assert.ok(files.some(path => path.startsWith('tests/') && path.endsWith('.py')));
  assert.ok(files.includes('scripts/publish-site-source.mjs'));
  return files;
}

function verifySnapshot(snapshot, expected) {
  const pkg = JSON.parse(readFileSync(join(snapshot, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(snapshot, 'package-lock.json'), 'utf8'));
  assert.ok(pkg.scripts['lesson:13.4'] && pkg.scripts['check:13'], '配套源码缺少 13.4 的运行或验收命令');
  assert.ok(pkg.scripts['lesson:15.3'] && pkg.scripts['check:14'] && pkg.scripts['check:15'], '配套源码缺少第十四、十五章的运行或验收命令');
  assert.ok(pkg.scripts['lesson:17.3'] && pkg.scripts['check:16'] && pkg.scripts['check:17'], '配套源码缺少第十六、十七章的运行或验收命令');
  assert.ok(pkg.scripts['lesson:22.3'] && pkg.scripts['check:20'] && pkg.scripts['check:21'] && pkg.scripts['check:22'], '配套源码缺少第二十至二十二章的运行或验收命令');
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, '依赖与锁文件不一致');
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, '开发依赖与锁文件不一致');
  assert.ok(existsSync(join(snapshot, 'chapter-13-session-persistence/04-manage-sessions/src/cli.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-15-context-budget/03-enforce-budget/src/cli.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-16-context-compaction/03-compact-and-continue/src/cli.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-17-project-instructions/03-inspect-loading/src/cli.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-20-hooks/03-stop-hooks/src/hooks/lifecycle.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-21-mcp/03-connection-lifecycle/src/mcp/client.ts')));
  assert.ok(existsSync(join(snapshot, 'chapter-22-web/03-grounded-answers/src/web/client.ts')));
  for (const command of Object.values(pkg.scripts)) {
    for (const match of command.matchAll(/(?:node|python3?)\s+([\w./-]+\.(?:mjs|py))/g)) {
      assert.ok(existsSync(join(snapshot, match[1])), `构建或验收脚本缺失：${match[1]}`);
    }
  }
  run(process.execPath, ['scripts/build-site.mjs'], snapshot);
  const rebuilt = JSON.parse(readFileSync(join(snapshot, 'site-dist/build-report.json'), 'utf8'));
  for (const field of ['chapters', 'tutorialPages', 'lessonPages', 'exercisePages', 'sourcePages']) {
    assert.equal(rebuilt[field], expected[field], `源码快照无法重建相同的 ${field}；请先重新构建网站`);
  }
  assert.deepEqual(rebuilt.assets, expected.assets, '源码快照无法重建相同的图片清单；请先重新构建网站');
  run(process.execPath, ['tests/verify-site-build.mjs'], snapshot);
  // Dependencies are borrowed only for checks and are never committed or published.
  const dependencies = join(root, 'node_modules');
  assert.ok(existsSync(join(dependencies, 'typescript/bin/tsc')), '请先运行 npm ci 安装验收所需依赖');
  symlinkSync(dependencies, join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], snapshot);
    for (const chapter of [13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) run(process.execPath, [`tests/verify-chapter-${chapter}.mjs`], snapshot);
  } finally {
    rmSync(join(snapshot, 'node_modules'), { force: true });
    rmSync(join(snapshot, 'dist'), { recursive: true, force: true });
    rmSync(join(snapshot, 'site-dist'), { recursive: true, force: true });
  }
  return { websiteRebuild: true, websiteFixtures: true, typecheck: true, chapter13: true, chapter14: true, chapter15: true, chapter16: true, chapter17: true, chapter18: true, chapter19: true, chapter20: true, chapter21: true, chapter22: true };
}

let temporary;
try {
  if (args.length && !checkOnly) throw new Error('用法：node scripts/publish-site-source.mjs [--check]');
  assert.ok(existsSync(join(root, 'site-dist/index.html')), '请先运行 npm run site:build');
  const report = JSON.parse(readFileSync(join(root, 'site-dist/build-report.json'), 'utf8'));
  assert.ok(Array.isArray(report.assets) && report.chapters > 0, '网站构建清单无效，请重新构建网站');
  const files = selectSource(report);
  temporary = mkdtempSync(join(tmpdir(), 'hello-my-agent-source-'));
  if (!checkOnly) {
    const exists = run('git', ['ls-remote', remote, `refs/heads/${branch}`]).length > 0;
    if (exists) run('git', ['clone', '--quiet', '--depth=1', '--branch', branch, remote, temporary]);
    else {
      run('git', ['init', '--quiet', '--initial-branch', branch], temporary);
      run('git', ['remote', 'add', 'origin', remote], temporary);
    }
    for (const name of readdirSync(temporary)) if (name !== '.git') rmSync(join(temporary, name), { recursive: true, force: true });
  }
  const manifest = [];
  for (const path of files) {
    mkdirSync(dirname(join(temporary, path)), { recursive: true });
    writeFileSync(join(temporary, path), publicContent(path));
    const content = readFileSync(join(temporary, path));
    manifest.push({ path: slash(path), bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const checks = verifySnapshot(temporary, report);
  let commit = null;
  if (!checkOnly) {
    run('git', ['config', 'user.name', 'sherlockmen'], temporary);
    run('git', ['config', 'user.email', '59763768+sherlockmen@users.noreply.github.com'], temporary);
    run('git', ['add', '--all'], temporary);
    assert.deepEqual(run('git', ['ls-files', '-z'], temporary).split('\0').filter(Boolean).sort(), files, 'Git 忽略规则使公开源码缺失，请先检查后再发布');
    if (run('git', ['status', '--porcelain'], temporary)) {
      run('git', ['commit', '--quiet', '-m', 'Publish current tutorial and Docsify source'], temporary);
      run('git', ['-c', 'http.postBuffer=524288000', 'push', '--quiet', 'origin', branch], temporary);
    }
    commit = run('git', ['rev-parse', 'HEAD'], temporary);
  }
  const evidenceDirectory = join(root, 'docs/.work/site-deploy');
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, checkOnly ? 'source-check.json' : 'source-publication.json'), JSON.stringify({
    repository: 'sherlockmen/hello-my-agent', branch, commit, checkOnly, checkedAt: new Date().toISOString(),
    checks, files: manifest,
  }, null, 2) + '\n');
  console.log(`✓ ${files.length} 份公开源码通过网站重建、TypeScript 和第十三至二十二章验收${checkOnly ? '（未推送）' : `，已发布到 ${branch} ${commit.slice(0, 8)}`}。`);
} catch (error) {
  console.error(`源码发布失败：${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
