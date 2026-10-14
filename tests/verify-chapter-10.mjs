/** 第十章：显示状态、审批等待与 CLI 输出选择。真实按键另由 PTY 检查。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { runCli } from './verify-chat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hello-agent-check-10-'));
let server;
try {
  const source = join(root, 'chapter-10-terminal-ui/04-cancel-and-restore/src');
  writeFileSync(join(temporary, 'package.json'), '{"type":"module","version":"0.1.0"}');
  symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'));
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: {
    noEmit: false, noEmitOnError: true, rootDir: source, outDir: join(temporary, 'dist'),
    typeRoots: [join(root, 'node_modules/@types')],
  }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config]);
  const load = (file) => import(pathToFileURL(join(temporary, 'dist/ui/tui', file)));
  const { emptyRunView, updateRunView, screenText, runTranscript } = await load('state.js');
  const { waitForApproval, approvalPages } = await load('approval.js');

  // 增量显示只累计一次；工具按执行序号配对，而不是按可重复的名字配对。
  const initial = emptyRunView();
  let view = initial;
  const original = structuredClone(initial);
  view = updateRunView(view, { type: 'model_start', call: 1 });
  view = updateRunView(view, { type: 'text_delta', call: 1, text: 'hello' });
  view = updateRunView(view, { type: 'model_finish', call: 1, outcome: 'final', toolRequests: 0, text: 'hello' });
  assert.equal(view.answers[0].text, 'hello');
  assert.deepEqual(initial, original);
  for (const sequence of [1, 2]) view = updateRunView(view, { type: 'tool_start', sequence, call: { id: `${sequence}`, name: 'read_file', arguments: '{}' } });
  view = updateRunView(view, { type: 'run_finish', outcome: 'cancelled', message: 'cancelled' });
  assert.equal(view.tools.length, 2);
  assert.ok(view.tools.every((tool) => tool.status === '已中断'));
  assert.equal(runTranscript(view).match(/hello/g).length, 1);
  assert.equal(screenText('\x1b[2J\u202e正文\n\t末尾'), '\\u001b[2J\\u202e正文\n    末尾');

  // 预览不能丢掉最后一页，不能用会话批准放行写入，取消后旧回调必须失效。
  const request = { call: { id: 'write', name: 'write_file', arguments: '{}' }, resource: 'sample.txt', reason: '确认内容', allowSession: false,
    preview: Array.from({ length: 80 }, (_, i) => `+第${i}行`).join('\n') };
  const pages = approvalPages(request, 60, 20);
  assert.ok(pages.length > 1);
  assert.equal(pages.join('\n'), `工具：write_file\n目标：sample.txt\n原因：确认内容\n\n${request.preview}`);
  let pending;
  const controller = new AbortController();
  const waiting = waitForApproval(request, controller.signal, (value) => { pending = value; });
  const stale = pending;
  assert.equal(pending.respond('s'), false);
  assert.equal(pending.respond('other'), false);
  const cancelled = assert.rejects(waiting, { name: 'AbortError' });
  controller.abort();
  await cancelled;
  assert.equal(pending, undefined);
  assert.equal(stale.respond('y'), false);
  const accepted = waitForApproval(request, new AbortController().signal, (value) => { pending = value; });
  assert.equal(pending.respond('y'), true);
  assert.deepEqual(await accepted, { decision: 'allow_once' });

  // 真正启动入口检查自动降级与单次输出；只有本地 HTTP 替身，没有外网模型请求。
  const cli = join(temporary, 'dist/cli.js');
  chmodSync(cli, 0o755);
  const cwd = join(temporary, 'workspace');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), '{}');
  let requests = 0;
  server = createServer(async (request, response) => {
    let input = ''; for await (const part of request) input += part;
    const body = JSON.parse(input); requests++;
    assert.equal(body.stream, true);
    response.setHeader('content-type', 'text/event-stream');
    const chunk = { id: 'local', object: 'chat.completion.chunk', model: 'fixture', created: 1 };
    response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'LOCAL_REPLY' }, finish_reason: null }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = { HOME: temporary, OPENAI_API_KEY: 'local-fixture', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
  for (const [args, message] of [
    [['--output', 'tui'], /需要交互终端/],
    [['--output', 'jsonl'], /需要 --prompt/],
    [['--output', 'invalid'], /只能是/],
  ]) {
    const result = await runCli(cli, args, cwd, { HOME: temporary });
    assert.equal(result.status, 1); assert.match(result.stderr, message);
  }
  for (const args of [[], ['--output', 'text']]) {
    const result = await runCli(cli, args, cwd, env, '/exit\n');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\x1b\[|输入问题/);
  }
  assert.equal(requests, 0);
  for (const args of [[], ['--output', 'text'], ['--output', 'jsonl']]) {
    const result = await runCli(cli, [...args, '--prompt', 'test'], cwd, env);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\x1b\[/);
    if (args.includes('jsonl')) {
      const records = result.stdout.trim().split('\n').map(JSON.parse);
      assert.equal(records[0].event.type, 'run_start');
      assert.equal(records.at(-1).event.type, 'run_finish');
      assert.equal(records.at(-1).event.outcome, 'completed');
    } else assert.equal(result.stdout.trim(), 'Agent > LOCAL_REPLY');
  }
  assert.equal(requests, 3);
  console.log('✓ 第 10 章：显示状态、完整分页、审批取消与旧回调、非 TTY 降级、文本和 JSONL 输出通过');
} finally {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  rmSync(temporary, { recursive: true, force: true });
}
