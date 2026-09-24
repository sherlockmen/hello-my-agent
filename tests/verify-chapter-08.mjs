/** 第八章验收：本地 SSE、真实终端输入和临时文件，不调用在线模型。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hello-my-agent-08-'));
const workspace = join(temporary, 'project');
const previousCwd = process.cwd();
mkdirSync(workspace);
writeFileSync(join(workspace, 'package.json'), '{}\n');
writeFileSync(join(workspace, 'a.txt'), 'alpha\n');
writeFileSync(join(workspace, 'b.txt'), 'beta\n');
const signal = () => new AbortController().signal;
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = [];
let handler;
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  frames.push(body);
  try { await handler(body, response); }
  catch (error) { response.destroy(error); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const fixtureConfig = (provider) => ({ provider, apiKey: 'fixture-only', model: 'fixture', baseURL });
const send = (res, event, anthropic = false) => res.write(`${anthropic ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
const openFrame = (delta, finish_reason = null) => ({ id: 'response_1', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
const startAnthropic = (res) => send(res, { type: 'message_start', message: { id: 'message_1', type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 0 } } }, true);
const endAnthropic = (res, reason = 'end_turn') => {
  send(res, { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 2 } }, true);
  send(res, { type: 'message_stop' }, true); res.end();
};
const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
const readCalls = () => [call('a', 'read_file', { path: 'a.txt', offset: 1, limit: 5 }), call('b', 'read_file', { path: 'b.txt', offset: 1, limit: 5 })];
const result = (text, toolCalls = []) => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', inputTokens: 1, outputTokens: 1, truncated: false });

/** 独立编译三个小节，不切换读者当前的命令产物。 */
function compile(lesson) {
  const source = join(root, 'chapter-08-streaming-turns', lesson, 'src');
  const project = join(temporary, lesson);
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ type: 'module', version: 'fixture' }));
  symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'));
  const outDir = join(project, 'dist');
  const config = join(project, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir, typeRoots: [join(root, 'node_modules/@types')] }, include: [join(source, 'cli.ts')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  chmodSync(join(outDir, 'cli.js'), 0o755);
  return outDir;
}

/** 发出两条工具调用，可在参数未收齐时暂停，也可故意留下无效 JSON。 */
async function toolStream(provider, res, { calls = readCalls(), halfway, reason, broken = false } = {}) {
  res.setHeader('content-type', 'text/event-stream');
  if (provider === 'openai') {
    send(res, openFrame({ role: 'assistant', tool_calls: calls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments.slice(0, 8) } })) }));
    if (halfway) await halfway();
    // 第二个调用先完成，验证按 index 聚合，而不是按到达顺序拼成一条。
    for (const index of [...calls.keys()].reverse()) {
      send(res, openFrame({ tool_calls: [{ index, function: { arguments: calls[index].arguments.slice(8, broken ? -1 : undefined) } }] }));
    }
    send(res, openFrame({}, reason ?? 'tool_calls'));
    res.end('data: [DONE]\n\n');
  } else {
    startAnthropic(res);
    for (const [index, c] of calls.entries()) {
      send(res, { type: 'content_block_start', index, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } }, true);
      send(res, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c.arguments.slice(0, 8) } }, true);
      if (index === 0 && halfway) await halfway();
      send(res, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c.arguments.slice(8, broken ? -1 : undefined) } }, true);
      send(res, { type: 'content_block_stop', index }, true);
    }
    endAnthropic(res, reason ?? 'tool_use');
  }
}

/** 发送可见文字后停在明确的测试关口，用于验证完成之前就已经显示。 */
async function textStream(provider, res, { halfway, disconnect = false } = {}) {
  res.setHeader('content-type', 'text/event-stream');
  if (provider === 'openai') send(res, openFrame({ role: 'assistant', content: '第一段中文' }));
  else {
    startAnthropic(res);
    send(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, true);
    send(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '第一段中文' } }, true);
  }
  if (halfway) await halfway();
  if (disconnect) { res.end(); return; }
  if (provider === 'openai') {
    send(res, openFrame({ content: '，第二段。' })); send(res, openFrame({}, 'stop')); res.end('data: [DONE]\n\n');
  } else {
    send(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '，第二段。' } }, true);
    send(res, { type: 'content_block_stop', index: 0 }, true); endAnthropic(res);
  }
}

try {
  process.chdir(workspace);
  for (const [index, lesson] of ['01-text-stream', '02-complete-tool-calls', '03-cancel-and-continue'].entries()) {
    const dist = compile(lesson);
    const load = (p) => import(pathToFileURL(join(dist, p)).href);
    const { createModel } = await load('models/client.js');
    const { agentLoop } = await load('agent/agent-loop.js');
    for (const provider of index === 0 ? ['openai'] : ['openai', 'anthropic']) {
      const model = createModel(fixtureConfig(provider));
      const firstText = gate(), release = gate();
      handler = (_, res) => textStream(provider, res, { halfway: () => release.promise });
      const history = [], events = [];
      let finished = false;
      const work = agentLoop(model, history, '解释测试', signal(), (e) => { events.push(e); if (e.type === 'text_delta') firstText.resolve(); }).then((r) => { finished = true; return r; });
      await firstText.promise;
      assert.equal(finished, false); assert.equal(history.length, 0);
      assert.equal(events.some((e) => e.type === 'model_finish'), false);
      release.resolve();
      assert.equal((await work).text, '第一段中文，第二段。');
      assert.equal(history[1].content, '第一段中文，第二段。');

      // 真正的中途取消必须结束 SDK 接收，部分文本不能保存成正式回答。
      const controller = new AbortController();
      handler = (_, res) => textStream(provider, res, { halfway: () => new Promise((r) => res.on('close', r)), disconnect: true });
      const cancelledHistory = [];
      await assert.rejects(agentLoop(model, cancelledHistory, '取消', controller.signal, (e) => { if (e.type === 'text_delta') controller.abort(); }), { name: 'AbortError' });
      assert.equal(cancelledHistory.some((m) => m.content.includes('第一段中文')), false);
      assert.equal(cancelledHistory.length, index === 2 ? 2 : 0);
      handler = (_, res) => textStream(provider, res, { disconnect: true });
      const brokenHistory = []; const before = frames.length;
      await assert.rejects(agentLoop(model, brokenHistory, '断流', signal()));
      assert.equal(frames.length - before, 1, '断流不能自动重试');
      assert.equal(brokenHistory.some((m) => m.content.includes('第一段中文')), false);

      const boundary = gate(), continueTools = gate();
      let count = 0;
      handler = (_, res) => count++ === 0
        ? toolStream(provider, res, { halfway: async () => { boundary.resolve(); await continueTools.promise; } })
        : textStream(provider, res);
      const toolEvents = [], toolHistory = [];
      const tools = agentLoop(model, toolHistory, '读两份文件', signal(), (e) => toolEvents.push(e));
      await boundary.promise;
      await sleep(30); // 让客户端有机会处理已发送的半份参数。
      assert.equal(toolEvents.some((e) => e.type === 'tool_start'), false);
      continueTools.resolve(); await tools;
      assert.deepEqual(toolHistory.filter((m) => m.role === 'tool').map((m) => m.toolCallId), ['a', 'b']);
      assert.match(toolHistory.find((m) => m.toolCallId === 'a').content, /alpha/);
      assert.match(toolHistory.find((m) => m.toolCallId === 'b').content, /beta/);
      const replay = frames.at(-1).messages;
      if (provider === 'openai') assert.deepEqual(replay.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['a', 'b']);
      else assert.deepEqual(replay.at(-1).content.map((m) => m.tool_use_id), ['a', 'b']);

      if (index >= 1) {
        for (const options of [{ broken: true }, { reason: provider === 'openai' ? 'length' : 'max_tokens' },
          { reason: provider === 'openai' ? 'content_filter' : 'refusal' }, { reason: 'future_reason' },
          { reason: provider === 'openai' ? 'stop' : 'end_turn' }, { calls: [readCalls()[0], { ...readCalls()[1], id: 'a' }] }]) {
          handler = (_, res) => toolStream(provider, res, options);
          const observed = [];
          await assert.rejects(agentLoop(model, [], '无效响应', signal(), (e) => observed.push(e)));
          assert.equal(observed.some((e) => e.type === 'permission_check' || e.type === 'tool_start'), false);
        }
      }
    }
    if (index !== 2) { console.log(`✓ 08.${index + 1}：逐段到达、完成前不执行、工具配对、取消与断流通过`); continue; }

    // 第一批已写入，第二批复用同一 ID；取消时不能把第二批误认为已经有结果。
    const controller = new AbortController(); let round = 0;
    const history = [];
    const model = { async generate(_messages, sig, onText) {
      if (round++ === 0) return result('', [call('same-id', 'write_file', { path: 'created.txt', content: 'saved\n' })]);
      if (round === 2) return result('', [call('same-id', 'run_command', { command: 'node -e "setInterval(()=>{},1000)"', cwd: '.', timeout_ms: 1000 }), call('later', 'write_file', { path: 'never.txt', content: 'no' })]);
      throw new Error('取消后不应再调用模型');
    } };
    await assert.rejects(agentLoop(model, history, '先创建再测试', controller.signal, (e) => {
      if (e.type === 'tool_start' && e.call.name === 'run_command') setTimeout(() => controller.abort(), 40);
    }, async () => ({ decision: 'allow_once' })), { name: 'AbortError' });
    assert.equal(readFileSync(join(workspace, 'created.txt'), 'utf8'), 'saved\n');
    assert.equal(existsSync(join(workspace, 'never.txt')), false);
    const toolResults = history.filter((m) => m.role === 'tool');
    assert.equal(toolResults.length, 3); assert.match(toolResults[1].content, /可能已发生部分修改/); assert.match(toolResults[2].content, /未执行/);
    const nextModel = { async generate(messages, sig) { assert.equal(sig.aborted, false); assert.deepEqual(messages.slice(0, -1), history); return result('继续检查'); } };
    await agentLoop(nextModel, history, '现在检查状态', signal());

    // 审批等待被取消后，新的输入必须交给新读取，不被旧的 next() 消耗。
    const { createLineReader } = await load('ui/input.js');
    const { createApprovalHandler } = await load('ui/terminal.js');
    const stdin = new PassThrough(), stdout = new PassThrough();
    const input = createInterface({ input: stdin, output: stdout, terminal: false });
    const lines = createLineReader(input), approvalController = new AbortController();
    const approve = createApprovalHandler(lines, true);
    const approval = approve({ call: readCalls()[0], reason: '测试', resource: 'a.txt', scope: 'read_file:a.txt', allowSession: false }, approvalController.signal);
    approvalController.abort(); await assert.rejects(approval, { name: 'AbortError' });
    const nextLine = lines.read(); stdin.write('下一轮问题\n'); assert.equal((await nextLine).value, '下一轮问题');
    stdin.end(); assert.equal((await lines.read()).done, true); lines.dispose(); input.close();

    // 实际CLI进程收到SIGINT后继续输入；--prompt仍退出130，输出不重复。
    for (const single of [false, true]) {
      handler = (body, res) => textStream('openai', res, body.messages.at(-1).content === 'wait'
        ? { halfway: () => new Promise((r) => res.on('close', r)), disconnect: true } : {});
      const child = spawn(process.execPath, [join(dist, 'cli.js'), ...(single ? ['--prompt', 'wait'] : [])], {
        cwd: workspace, env: { PATH: process.env.PATH, HOME: temporary, OPENAI_API_KEY: 'fixture', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: baseURL }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '', errors = '', cancelled = false, sent = false;
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 8000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (!cancelled && output.includes('第一段中文')) { cancelled = true; child.kill('SIGINT'); }
        if (!single && !sent && output.includes('已取消本轮')) { sent = true; child.stdin.end('next\n/exit\n'); }
      });
      child.stderr.on('data', (chunk) => { errors += chunk; });
      child.stdin.on('error', () => {});
      if (!single) child.stdin.write('wait\n');
      const status = await new Promise((r) => child.on('close', r)); clearTimeout(watchdog);
      assert.equal(status, single ? 130 : 0, output + errors);
      if (!single) assert.equal(output.split('第一段中文，第二段。').length - 1, 1, '完整回答不应重复打印');
    }
    console.log('✓ 08.3：保留副作用、批次ID配对、取消审批、EOF、真实CLI中断后续聊与单次退出通过');
  }
} finally {
  process.chdir(previousCwd);
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  rmSync(temporary, { recursive: true, force: true });
}
