# verify-models.ts

`chapter-23-model-adapters/examples/verify-models.ts`

<a href="./content/chapter-23-model-adapters/examples/verify-models.ts" download>下载原始文件</a>

```typescript
/**
 * 第23章完整答案 | [NEW 练习] examples/verify-models.ts
 * 学习目标：分别验证协议语义、整轮切换锁和有证据的错误/缓存用量。
 * 输入：已构建的本节dist与组号1/2/3/all；输出：真实SDK和本地状态的断言。
 * 练习流程：本机双协议服务 -> 真实适配器 -> 调用/结果往返 -> 状态断言。
 * 模型服务只返回预定片段，不访问在线模型；失败抛出，finally关闭服务并恢复环境。
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 验证真实适配边界；服务端断言失败也以HTTP错误返回，避免无声挂起。 */
async function main(): Promise<void> {
  const dist = resolve(process.env.HMA_MODELS_DIST ?? join(process.env.HMA_REPO ?? process.cwd(), "dist"));
  const { createProtocolAdapter } = await import(pathToFileURL(join(dist, "models/protocol.js")).href);
  const { createModel } = await import(pathToFileURL(join(dist, "models/client.js")).href);
  const group = process.argv[2] ?? "all";
  assert.ok(["1", "2", "3", "all"].includes(group), "组号必须是1、2、3或all");
  let handlerError: unknown;
  let seen = 0;
  let reportUsage = true;
  const server = createServer(async (request, response) => {
    try {
      let source = "";
      for await (const part of request) source += part.toString();
      const body = JSON.parse(source);
      const openai = request.url?.endsWith("/chat/completions");
      const second = openai ? body.messages.some((m: { role: string }) => m.role === "tool")
        : body.messages.some((m: { content: unknown }) => Array.isArray(m.content) && m.content.some((b: { type: string }) => b.type === "tool_result"));
      if (second) {
        if (openai) {
          const tool = body.messages.find((m: { role: string }) => m.role === "tool");
          assert.equal(tool.tool_call_id, "call_1"); assert.equal(tool.content, "start=node cli.js");
        } else {
          const tool = body.messages.flatMap((m: { content: unknown }) => Array.isArray(m.content) ? m.content : []).find((b: { type: string }) => b.type === "tool_result");
          assert.equal(tool.tool_use_id, "call_1"); assert.equal(tool.content, "start=node cli.js");
        }
      }
      seen += 1;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (event: object, name?: string) => response.write(`${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
      if (openai) {
        const base = { id: "chat_1", object: "chat.completion.chunk", created: 0, model: "fixture" };
        emit({ ...base, choices: [{ index: 0, delta: second ? { role: "assistant", content: "启动命令是 node cli.js。" }
          : { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"package.json"}' } }] }, finish_reason: null }] });
        emit({ ...base, choices: [{ index: 0, delta: {}, finish_reason: second ? "stop" : "tool_calls" }] });
        if (reportUsage) emit({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, prompt_tokens_details: { cached_tokens: 3 } } });
        response.end("data: [DONE]\n\n");
      } else {
        emit({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "fixture", content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 7, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } }, "message_start");
        emit({ type: "content_block_start", index: 0, content_block: second ? { type: "text", text: "" } : { type: "tool_use", id: "call_1", name: "read_file", input: {} } }, "content_block_start");
        emit({ type: "content_block_delta", index: 0, delta: second ? { type: "text_delta", text: "启动命令是 node cli.js。" } : { type: "input_json_delta", partial_json: '{"path":"package.json"}' } }, "content_block_delta");
        emit({ type: "content_block_stop", index: 0 }, "content_block_stop");
        emit({ type: "message_delta", delta: { stop_reason: second ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 4 } }, "message_delta");
        emit({ type: "message_stop" }, "message_stop"); response.end();
      }
    } catch (error) { handlerError = error; response.writeHead(500).end(); }
  });
  const saved = new Map<string, string | undefined>();
  const env = (key: string, value: string) => { saved.set(key, process.env[key]); process.env[key] = value; };
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const baseURL = `http://127.0.0.1:${address.port}/v1`;
    if (group === "1" || group === "all" || group === "3") {
      for (const provider of ["openai", "anthropic"]) {
        const adapter = createProtocolAdapter({ provider, apiKey: "fixture-only", model: "fixture", baseURL });
        const messages = [{ role: "user", content: "读取package.json并说明启动命令" }];
        const request = { prompt: "根据工具结果回答。", definitions: [{ name: "read_file", description: "读取文件", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }], limits: { windowTokens: 8192, outputReserve: 1024 } };
        const first = await adapter.generate(messages, new AbortController().signal, undefined, request);
        assert.equal(first.finishReason, "tool_calls"); assert.equal(first.toolCalls[0].id, "call_1");
        assert.deepEqual(JSON.parse(first.toolCalls[0].arguments), { path: "package.json" });
        const second = await adapter.generate([...messages, { role: "assistant", content: "", toolCalls: first.toolCalls },
          { role: "tool", toolCallId: "call_1", content: "start=node cli.js", isError: false }], new AbortController().signal, undefined, request);
        assert.equal(second.finishReason, "stop"); assert.match(second.text, /node cli.js/);
        if (group === "3" || group === "all") {
          assert.equal(first.cachedInputTokens, 3);
          assert.equal(first.inputTokens, 12, "Anthropic总输入包括普通、缓存读和缓存写");
          assert.equal(first.cacheWriteTokens, provider === "anthropic" ? 2 : null);
        }
      }
      assert.equal(seen, 4); assert.equal(handlerError, undefined);
      console.log("通过一：两种真实SDK保留调用编号，工具结果进入第二次请求。");
    }
    if (group === "2" || group === "all") {
      env("OPENAI_API_KEY", "fixture-openai"); env("OPENAI_BASE_URL", baseURL);
      env("ANTHROPIC_API_KEY", "fixture-anthropic"); env("ANTHROPIC_BASE_URL", baseURL);
      const model = createModel({ provider: "openai", apiKey: "fixture-openai", model: "before", baseURL });
      const release = model.beginRun();
      assert.equal(model.command("/model anthropic after text").ok, false);
      assert.equal(model.profile.model, "before");
      release(); release();
      assert.equal(model.command("/model anthropic after text").ok, true);
      assert.equal(model.profile.provider, "anthropic"); assert.equal(model.profile.model, "after");
      assert.equal(model.command("/model other malformed").ok, false);
      assert.equal(model.profile.model, "after");
      assert.ok(!JSON.stringify(model.profile).includes("fixture-anthropic"));
      console.log("通过二：整轮锁拒绝切换；释放后原子切换，错误命令保留当前配置。");
    }
    if (group === "3" || group === "all") {
      const { classifyModelError, safeModelError } = await import(pathToFileURL(join(dist, "models/model-errors.js")).href);
      for (const [error, expected] of [[{ status: 401 }, "authentication"], [{ status: 429 }, "rate_limit"], [{ status: 503 }, "unavailable"], [{ name: "APIConnectionError" }, "connection"], [{ status: 400 }, "request"], [{}, "unknown"]]) {
        assert.equal(classifyModelError(error), expected);
      }
      assert.ok(!safeModelError({ status: 401, message: "secret-fixture" }).message.includes("secret-fixture"));
      reportUsage = false;
      const unknown = await createProtocolAdapter({ provider: "openai", apiKey: "fixture", model: "fixture", baseURL }).generate([{ role: "user", content: "测试缺失用量" }], new AbortController().signal, undefined, { prompt: "测试", definitions: [], limits: { windowTokens: 8192, outputReserve: 1024 } });
      assert.equal(unknown.inputTokens, null); assert.equal(unknown.outputTokens, null);
      assert.equal(unknown.cachedInputTokens, null); assert.equal(unknown.cacheWriteTokens, null);
      console.log("通过三：错误按证据分类；缓存报告沿真实响应转换，缺失用量保持null。");
    }
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
}
await main();
```
