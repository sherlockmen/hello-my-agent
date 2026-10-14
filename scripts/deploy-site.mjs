// Publish only the generated, checked website. The tutorial checkout stays untouched.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'site-dist');
const repo = 'sherlockmen/hello-my-agent';
const remote = `https://github.com/${repo}.git`;
const branch = 'gh-pages';
function git(args, cwd = root, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`Git ${args[0]} failed: ${result.stderr || '没有返回成功结果'}`);
  return result.stdout.trim();
}
const report = JSON.parse(await fs.readFile(path.join(output, 'build-report.json'), 'utf8'));
if (!await fs.stat(path.join(output, 'index.html'))) throw new Error('网站尚未生成');
// Read the existing Git credential silently; never put it in command args or output.
const credentialResult = spawnSync('git', ['credential', 'fill'], {
  cwd: root, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
});
const credential = Object.fromEntries((credentialResult.stdout || '').split('\n').filter(line => line.includes('=')).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
async function pages(method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pages`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(credential.password ? { Authorization: `Bearer ${credential.password}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
const current = await pages();
if (![200, 404].includes(current.status)) throw new Error(`无法读取 Pages 设置：HTTP ${current.status} ${current.data.message || ''}`);
if (current.status === 404 && !credential.password) throw new Error('启用 GitHub Pages 需要此仓库的管理员授权。请先配置 GitHub 登录。');
if (current.status === 200 && current.data.cname) throw new Error('仓库已有自定义域名，请先确认其用途再切换发布来源。');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hello-my-agent-pages-'));
try {
  const exists = git(['ls-remote', remote, `refs/heads/${branch}`]).length > 0;
  if (exists) git(['clone', '--quiet', '--depth=1', '--branch', branch, remote, temporary]);
  else {
    git(['init', '--quiet', '--initial-branch', branch], temporary);
    git(['remote', 'add', 'origin', remote], temporary);
  }
  for (const item of await fs.readdir(temporary)) {
    if (item !== '.git') await fs.rm(path.join(temporary, item), { recursive: true, force: true });
  }
  await fs.cp(output, temporary, { recursive: true });
  git(['config', 'user.name', 'sherlockmen'], temporary);
  git(['config', 'user.email', '59763768+sherlockmen@users.noreply.github.com'], temporary);
  git(['add', '--all'], temporary);
  const changed = git(['status', '--porcelain'], temporary).length > 0;
  if (changed) {
    git(['commit', '--quiet', '-m', 'Publish Docsify teaching website'], temporary);
    git(['push', '--quiet', 'origin', branch], temporary);
  }
  const commit = git(['rev-parse', 'HEAD'], temporary);
  if (current.status === 404 || current.data.source?.branch !== branch || current.data.source?.path !== '/') {
    const result = await pages(current.status === 404 ? 'POST' : 'PUT', { build_type: 'legacy', source: { branch, path: '/' } });
    if (![200, 201, 204].includes(result.status)) {
      // A first gh-pages push can enable Pages before the explicit setup request arrives.
      const refreshed = current.status === 404 && result.status === 409 ? await pages() : null;
      const alreadyReady = refreshed?.status === 200 && !refreshed.data.cname
        && refreshed.data.source?.branch === branch && refreshed.data.source?.path === '/';
      if (!alreadyReady) throw new Error(`站点已推送，但 Pages 设置失败：HTTP ${result.status} ${result.data.message || ''}`);
    }
  }
  const evidence = { repository: repo, branch, commit, url: 'https://sherlockmen.github.io/hello-my-agent/', publishedAt: new Date().toISOString(), build: report };
  const work = path.join(root, 'docs/.work/site-deploy');
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(path.join(work, 'deployment.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`已推送网站 ${commit.slice(0, 8)}。GitHub Pages 正在发布：https://sherlockmen.github.io/hello-my-agent/`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
