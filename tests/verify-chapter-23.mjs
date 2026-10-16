/** Real SDK round trips, credential ownership, switching and complete response boundaries. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, reply, sdkServer, sendReply, signal, workspace } from './runtime-fixtures.mjs';

const temporary = workspace('23'), previousCwd = process.cwd();
const previousEnv = { ...process.env };
let mode = 'tools';
let requestFailure;
const call = { id: 'read-source', name: 'read_file', arguments: '{"path":"source.ts","offset":1,"limit":20}' };
const service = await sdkServer((entry, response) => {
  if (mode === 'hold') return;
  if (mode === '429') {
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"PRIVATE_TOKEN_MUST_NOT_LEAK","type":"rate_limit_error"}}');
    return;
  }
  const hasResult = entry.body.messages.some(message => message.role === 'tool'
    || Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'));
  if (requestFailure && (requestFailure.kind === 'summary' ? !entry.body.stream : hasResult)) {
    if (requestFailure.outcome === 'hold') return;
    if (requestFailure.outcome === 'disconnect') { response.destroy(); return; }
    const content = requestFailure.outcome === 'empty' ? '' : 'SUMMARY_COMPLETE';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(entry.path.includes('messages')
      ? { id: 'summary', type: 'message', role: 'assistant', model: 'fixture', content: [{ type: 'text', text: content }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      : { id: 'summary', object: 'chat.completion', created: 1, model: 'fixture',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } } }));
    return;
  }
  const result = mode === 'invalid' ? reply('', [call, { id: 'bad', name: 'read_file', arguments: '{' }])
    : mode === 'tools' && !hasResult ? reply('', [call]) : reply('ROUND_TRIP_COMPLETE');
  sendReply(entry, response, result, entry.path.includes('messages')
    ? { cache_read_input_tokens: 4, cache_creation_input_tokens: 5 }
    : { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, prompt_tokens_details: { cached_tokens: 4 } });
});

try {
  temporary.file('project/package.json', '{"type":"module"}');
  const source = temporary.file('project/source.ts', 'export const evidence = "ACTUAL_FILE_CONTENT";\n');
  process.chdir(new URL('./project/', `file://${temporary.directory}/`).pathname);
  for (const provider of ['OPENAI', 'ANTHROPIC']) {
    process.env[`${provider}_API_KEY`] = `${provider}-fixture-key`;
    process.env[`${provider}_MODEL`] = 'fixture';
    process.env[`${provider}_BASE_URL`] = service.url;
    delete process.env[`${provider}_IMAGE_INPUT`];
  }
  for (const lesson of ['01-adapter-contract', '02-model-switching', '03-capabilities-errors']) {
    const { load } = build('chapter-23-model-adapters', lesson, temporary);
    const { createModel } = await load('models/client.js');
    const { agentLoop } = await load('agent/agent-loop.js');
    for (const provider of ['openai', 'anthropic']) {
      mode = 'tools';
      const model = createModel({ provider, model: 'fixture', apiKey: `${provider.toUpperCase()}-fixture-key`, baseURL: service.url });
      const history = [], events = [];
      const result = await agentLoop(model, history, '读取 source.ts 后回答', signal(), event => events.push(event));
      assert.match(result.text, /ROUND_TRIP_COMPLETE/);
      assert.equal(history.filter(message => message.role === 'tool').length, 1);
      assert.match(history.find(message => message.role === 'tool').content, /ACTUAL_FILE_CONTENT/);
      const entry = service.requests.at(-1);
      assert.equal(entry.body.model, 'fixture');
      assert.equal(provider === 'openai' ? entry.headers.authorization : entry.headers['x-api-key'],
        provider === 'openai' ? 'Bearer OPENAI-fixture-key' : 'ANTHROPIC-fixture-key');
      if (provider === 'openai') assert.equal(entry.body.messages.find(message => message.role === 'tool').tool_call_id, call.id);
      else assert.equal(entry.body.messages.at(-1).content[0].tool_use_id, call.id);
      assert.equal(model.profile.provider, provider);
      assert.doesNotMatch(JSON.stringify(model.profile), /fixture-key/);
      if (lesson === '03-capabilities-errors') {
        assert.equal(result.cachedInputTokens, 8);
        assert.equal(result.cacheWriteTokens, provider === 'anthropic' ? 10 : null);
        assert.equal(result.inputTokens, 24);
        assert.equal(events.filter(event => event.type === 'model_usage').at(-1).cachedInputTokens, 8);
      }
      mode = 'invalid';
      await assert.rejects(model.generate([{ role: 'user', content: 'invalid batch' }], signal()), /JSON|收齐/);
      assert.match(readFileSync(source, 'utf8'), /ACTUAL_FILE_CONTENT/);
    }

    if (lesson !== '01-adapter-contract') {
      const model = createModel({ provider: 'openai', model: 'before', apiKey: 'old-key', baseURL: service.url });
      assert.match(JSON.stringify(model.command('/model anthropic after')), /anthropic\/after/);
      assert.equal(model.profile.provider, 'anthropic');
      assert.equal(model.profile.model, 'after');
      const copy = model.profile;
      copy.model = 'MUTATED';
      assert.equal(model.profile.model, 'after');
      mode = 'text';
      await model.generate([{ role: 'user', content: 'after switching' }], signal());
      assert.equal(service.requests.at(-1).headers['x-api-key'], 'ANTHROPIC-fixture-key');
      assert.equal(service.requests.at(-1).headers.authorization, undefined);
      delete process.env.OPENAI_API_KEY;
      assert.match(JSON.stringify(model.command('/model openai missing')), /OPENAI_API_KEY/);
      assert.equal(model.profile.provider, 'anthropic');
      process.env.OPENAI_API_KEY = 'OPENAI-fixture-key';
      mode = 'hold';
      const controller = new AbortController();
      const count = service.requests.length;
      const pending = model.generate([{ role: 'user', content: 'cancel' }], controller.signal);
      const rejected = assert.rejects(pending, /CANCEL_REQUEST/);
      while (service.requests.length === count) await new Promise(resolve => setTimeout(resolve, 5));
      assert.match(JSON.stringify(model.command('/model openai blocked')), /正在进行/);
      assert.equal(model.profile.provider, 'anthropic');
      controller.abort(new Error('CANCEL_REQUEST'));
      await rejected;
      assert.match(JSON.stringify(model.command('/model openai resumed')), /openai\/resumed/);
    }
    if (lesson === '03-capabilities-errors') {
      const { classifyModelError, safeModelError } = await load('models/model-errors.js');
      const { anthropicInputTokens } = await load('models/protocol.js');
      for (const [value, expected] of [[{ status: 401 }, 'authentication'], [{ status: 429 }, 'rate_limit'],
        [{ status: 500 }, 'unavailable'], [{ status: 400 }, 'request'], [{ name: 'APIConnectionError' }, 'connection']]) {
        assert.equal(classifyModelError(value), expected);
        assert.doesNotMatch(safeModelError({ ...value, message: 'PRIVATE_TOKEN_MUST_NOT_LEAK' }).message, /PRIVATE_TOKEN/);
      }
      assert.equal(anthropicInputTokens({ input_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 }), 12);
      assert.equal(anthropicInputTokens({ input_tokens: 3 }), null);
      mode = '429';
      const count = service.requests.length;
      const model = createModel({ provider: 'openai', model: 'fixture', apiKey: 'fixture', baseURL: service.url });
      await assert.rejects(model.generate([{ role: 'user', content: 'no retry' }], signal()), error => /限流/.test(error.message) && !/PRIVATE_TOKEN/.test(error.message));
      assert.equal(service.requests.length, count + 1);

      const { runAgent } = await load('agent/run.js');
      const { emptyRunView, updateRunView } = await load('ui/tui/state.js');
      const usageFields = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens'];
      const lastUsage = events => events.filter(event => event.type === 'model_usage').at(-1);
      const viewOf = events => events.reduce(updateRunView, emptyRunView());
      const priced = provider => createModel({ provider, model: 'fixture', apiKey: 'fixture', baseURL: service.url,
        contextLimits: { windowTokens: 32768, outputReserve: 2048, inputPricePerMillion: 1, outputPricePerMillion: 2 } });
      const assertUnknown = (events, outcome = 'error') => {
        assert.ok(events.find(event => event.type === 'model_usage').costEstimateUsd > 0);
        assert.deepEqual(usageFields.map(field => lastUsage(events)[field]), [null, null, null, null]);
        assert.equal(lastUsage(events).costEstimateUsd, null);
        assert.equal(events.at(-1).outcome, outcome);
        assert.match(viewOf(events).usage, /输入 未知 \/ 输出 未知.*缓存读取 未知 \/ 写入 未知.*费用未估计/);
      };
      const assertRetained = (events, expectedInput = 12, expectedOutput = 2) => {
        assert.equal(lastUsage(events).inputTokens, expectedInput);
        assert.equal(lastUsage(events).outputTokens, expectedOutput);
        assert.ok(lastUsage(events).costEstimateUsd > 0);
        assert.match(viewOf(events).usage, new RegExp(`输入 ${expectedInput} / 输出 ${expectedOutput}.*费用估计`));
      };
      const waitFor = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          assert.ok(Date.now() < deadline, 'fixture request did not start');
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      };
      // A known first response must not remain a whole-turn total after an unreported remote request.
      for (const provider of ['openai', 'anthropic']) {
        for (const kind of ['ordinary', 'summary']) {
          for (const outcome of ['disconnect', 'hold']) {
            mode = 'tools'; requestFailure = { kind, outcome };
            const base = priced(provider), events = [], controller = new AbortController();
            let generated = false;
            const model = { ...base,
              inspectContext(messages, mode) {
                const budget = base.inspectContext(messages, mode);
                return kind === 'summary' && generated ? { ...budget, withinBudget: false } : budget;
              },
              async generate(...args) { const result = await base.generate(...args); generated = true; return result; },
            };
            const history = Array.from({ length: 8 }, (_, index) => ({ role: 'assistant', content: `OLD_${index}` }));
            const before = service.requests.length;
            const rejected = assert.rejects(runAgent(model, history, 'read then continue', controller.signal, event => events.push(event)));
            if (outcome === 'hold') {
              await waitFor(() => service.requests.length === before + 2);
              controller.abort(new Error('CANCEL_USAGE_REQUEST'));
            }
            await rejected;
            assert.equal(service.requests.length, before + 2);
            assertUnknown(events, outcome === 'hold' ? 'cancelled' : 'error');
          }
        }
        // Both ordinary and summary local budget gates, and pre-send cancellation, preserve the first report.
        for (const local of ['ordinary-budget', 'summary-budget', 'cancel-before-send', ...(provider === 'anthropic' ? ['message-conversion'] : [])]) {
          mode = 'tools'; requestFailure = undefined;
          const base = priced(provider), events = [], controller = new AbortController();
          let generated = false;
          const model = { ...base,
            inspectContext(messages, mode) {
              const budget = base.inspectContext(messages, mode);
              return local === 'summary-budget' && generated ? { ...budget, withinBudget: false } : budget;
            },
            inspectSummary: () => ({ withinBudget: true }),
            summarize: (_source, current) => base.summarize('x'.repeat(150000), current),
            async generate(messages, current, onText, options) {
              if (generated && local === 'cancel-before-send') controller.abort(new Error('CANCEL_BEFORE_SEND'));
              const extra = !generated ? [] : local === 'ordinary-budget' ? [{ role: 'user', content: 'x'.repeat(150000) }]
                : local === 'message-conversion' ? [{ role: 'assistant', content: '', toolCalls: [{ ...call, id: 'malformed-old-call', arguments: '{' }] }] : [];
              const result = await base.generate([...messages, ...extra], current, onText, options);
              generated = true; return result;
            },
          };
          const history = Array.from({ length: 8 }, () => ({ role: 'assistant', content: 'OLD' }));
          const before = service.requests.length;
          await assert.rejects(runAgent(model, history, 'local failure after known usage', controller.signal, event => events.push(event)));
          assert.equal(service.requests.length, before + 1);
          assert.equal(events.filter(event => event.type === 'model_usage').length, 1);
          assertRetained(events);
        }
        // Receiving a complete summary still counts when candidate validation or later cancellation rejects it.
        for (const outcome of ['empty', 'complete-then-cancel']) {
          mode = 'tools'; requestFailure = { kind: 'summary', outcome };
          const base = priced(provider), events = [], controller = new AbortController();
          let generated = false;
          const model = { ...base,
            inspectContext(messages, mode) { const budget = base.inspectContext(messages, mode); return generated ? { ...budget, withinBudget: false } : budget; },
            async generate(...args) { const result = await base.generate(...args); generated = true; return result; },
            async summarize(...args) {
              const result = await base.summarize(...args);
              if (outcome === 'complete-then-cancel') controller.abort(new Error('CANCEL_AFTER_SUMMARY'));
              return result;
            },
          };
          const history = Array.from({ length: 8 }, () => ({ role: 'assistant', content: 'OLD' }));
          await assert.rejects(runAgent(model, history, 'summary result boundary', controller.signal, event => events.push(event)));
          assert.equal(events.filter(event => event.type === 'model_usage').length, 2);
          assertRetained(events, 19, 3);
          assert.equal(events.at(-1).outcome, outcome === 'empty' ? 'error' : 'cancelled');
        }
      }
      // Existing Model substitutes need no new hook: an unmarked failed request is conservatively unknown.
      requestFailure = undefined;
      let fakeCalls = 0; const fakeEvents = [];
      await assert.rejects(runAgent({ estimateCost: () => 1, async generate() {
        if (++fakeCalls === 1) return { ...reply('', [call]), inputTokens: 12, outputTokens: 2, cachedInputTokens: 4, cacheWriteTokens: 5 };
        throw new Error('legacy fake interrupted');
      } }, [], 'legacy model', signal(), event => fakeEvents.push(event)));
      assertUnknown(fakeEvents);
      console.log('✓ 23.3 usage events → TUI: sent failures/cancellation unknown; local preflight retained; complete rejected summaries counted; legacy Models compatible');
    }
    console.log(`✓ 23 ${lesson}: real dual SDK → read_file → paired results; complete JSON; switching/cancel/error/cache as applicable`);
  }
} finally {
  process.chdir(previousCwd);
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await service.close();
  temporary.close();
}
