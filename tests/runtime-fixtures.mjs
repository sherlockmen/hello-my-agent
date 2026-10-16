/** Chapters 23–25 share isolated builds and real local SDK transports. */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const signal = () => new AbortController().signal;
export const reply = (text = '', toolCalls = []) => ({ text, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', inputTokens: 3, outputTokens: 2, truncated: false });

export function workspace(label) {
  const directory = mkdtempSync(join(tmpdir(), `hello-agent-${label}-`));
  return {
    directory,
    file(name, content) {
      const path = join(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}

export function build(chapter, lesson, temporary) {
  const source = join(root, chapter, lesson, 'src');
  const directory = join(temporary.directory, lesson);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{"name":"fixture","version":"0.0.0","type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  const dist = join(directory, 'dist');
  const config = join(directory, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: {
    noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist,
    typeRoots: [join(root, 'node_modules/@types')],
  }, include: [join(source, '**/*.ts'), join(source, '**/*.tsx')] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  return { dist, load: name => import(pathToFileURL(join(dist, name))) };
}

export async function sdkServer(respond = (entry, response) => sendReply(entry, response)) {
  const requests = [], sockets = new Set();
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const entry = { path: request.url, headers: request.headers, body: JSON.parse(body) };
      requests.push(entry);
      await respond(entry, response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500);
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export function sendReply(entry, response, result = reply('SDK_COMPLETE'), usage) {
  response.setHeader('content-type', 'text/event-stream');
  if (entry.path.includes('messages')) {
    const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({ type: 'message_start', message: { id: 'm-fixture', type: 'message', role: 'assistant', model: 'fixture',
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0, ...usage } } });
    let index = 0;
    if (result.text) {
      send({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      send({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: result.text } });
      send({ type: 'content_block_stop', index: index++ });
    }
    for (const call of result.toolCalls) {
      send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } });
      send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: call.arguments } });
      send({ type: 'content_block_stop', index: index++ });
    }
    send({ type: 'message_delta', delta: { stop_reason: result.toolCalls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
    send({ type: 'message_stop' });
  } else {
    const send = choices => response.write(`data: ${JSON.stringify({ id: 'c-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices })}\n\n`);
    send([{ index: 0, delta: { role: 'assistant', content: result.text || null,
      ...(result.toolCalls.length ? { tool_calls: result.toolCalls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) }, finish_reason: null }]);
    send([{ index: 0, delta: {}, finish_reason: result.toolCalls.length ? 'tool_calls' : 'stop' }]);
    if (usage) response.write(`data: ${JSON.stringify({ id: 'c-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [], usage })}\n\n`);
    response.write('data: [DONE]\n\n');
  }
  response.end();
}
