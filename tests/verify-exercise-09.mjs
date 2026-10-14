/** 第九章练习：在临时构建中验证真实工具事件，不改变当前命令。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hello-my-agent-exercise-09-'));
try {
  const source = join(root, 'chapter-09-observable-runs/03-jsonl-output/src');
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'));
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: join(temporary, 'dist'), typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const submitted = process.argv[2] ? resolve(process.argv[2]) : join(root, 'chapter-09-observable-runs/exercises/tool-timing.mjs');
  const ownAnswer = existsSync(submitted);
  if (process.argv[2]) assert.ok(ownAnswer, '指定的练习文件不存在');
  const answer = ownAnswer ? readFileSync(submitted, 'utf8')
    : readFileSync(join(root, 'chapter-09-observable-runs/EXERCISES.md'), 'utf8')
      .match(/<!-- solution: exercises\/tool-timing\.mjs -->\s*```js\n([\s\S]*?)\n```/)?.[1];
  assert.ok(answer, '教程必须包含完整练习答案');
  const exerciseDir = join(temporary, 'chapter-09-observable-runs/exercises');
  mkdirSync(exerciseDir, { recursive: true });
  const script = join(exerciseDir, 'tool-timing.mjs');
  writeFileSync(script, answer);
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, HOME: temporary } });
  assert.match(output, /练习通过/);
  console.log(ownAnswer ? '✓ 第 09 章练习文件已运行，真实工具结果、事件顺序与开始结束配对通过'
    : '○ 尚未创建练习文件；第 09 章参考答案的真实工具结果、事件顺序与开始结束配对通过');
} finally { rmSync(temporary, { recursive: true, force: true }); }
