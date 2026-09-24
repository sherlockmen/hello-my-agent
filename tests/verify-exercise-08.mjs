/** 第八章练习：在临时副本运行读者文件或教程答案，不改变当前构建选择。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hello-my-agent-exercise-08-'));
try {
  const source = join(root, 'chapter-08-streaming-turns/03-cancel-and-continue/src');
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'));
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: join(temporary, 'dist'), typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const submitted = process.argv[2] ? resolve(process.argv[2]) : join(root, 'chapter-08-streaming-turns/exercises/cancel-and-continue.mjs');
  const ownAnswer = existsSync(submitted);
  if (process.argv[2]) assert.ok(ownAnswer, '指定的练习文件不存在');
  const answer = ownAnswer ? readFileSync(submitted, 'utf8')
    : readFileSync(join(root, 'chapter-08-streaming-turns/EXERCISES.md'), 'utf8')
      .match(/<!-- solution: exercises\/cancel-and-continue\.mjs -->\s*```js\n([\s\S]*?)\n```/)?.[1];
  assert.ok(answer, '教程必须包含完整练习答案');
  const exerciseDir = join(temporary, 'chapter-08-streaming-turns/exercises');
  mkdirSync(exerciseDir, { recursive: true });
  const script = join(exerciseDir, 'cancel-and-continue.mjs');
  writeFileSync(script, answer);
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, HOME: temporary } });
  assert.match(output, /练习通过/);
  console.log(ownAnswer ? '✓ 第 08 章练习文件已运行，取消后文件、历史与续聊断言通过'
    : '○ 尚未创建练习文件；第 08 章参考答案的真实写入、取消和续聊断言通过');
} finally { rmSync(temporary, { recursive: true, force: true }); }
