# 第 23 章练习与答案

[第 23 章首页](README.md) · [23.3 能力、错误与用量](03-capabilities-errors/README.md)

先预测下面三种情况，再运行完整 TypeScript 答案。第一组经过真实 OpenAI/Anthropic SDK 和本机流式服务，后两组检查模型配置与实际转换后的用量；不会访问在线模型。模型回答内容是预定材料，我们检查的是程序如何保留和交接语义。

## 练习一：换协议之后，工具结果交给谁

两种服务都要求读取 `package.json`，工具调用编号都是 `call_1`。本地读取完以后，第二次请求只带“start=node cli.js”，却不带对应调用编号，能否保持相同语义？

答案：不能。文字是观察内容，编号说明这份观察回答了哪次调用。完整答案分别通过真实 SDK 接收工具流，检查内部参数，再把预定的本地工具结果按原编号转换回协议。模拟服务确认 OpenAI 的 `tool_call_id` 和 Anthropic 的 `tool_use_id` 后，才返回下一段回答。

## 练习二：锁住一次请求，是否等于锁住整个任务

模型请求已经结束，但程序还在等待工具结果。用户此时切到另一份配置，下一次工具结果会送给谁？目标命令无效时，当前配置能否先被改掉？

答案：整轮任务持有同一把运行锁；请求、工具与摘要之间也不能切换。完整答案直接持有这把锁，确认切换失败且旧配置保留，再释放并切换。新配置先准备完整才替换；错误命令保留已生效配置，显示出来的 profile 不含凭据。这里验证本地状态，不证明目标账号能访问远端模型。

## 练习三：缓存读入3，是否就能计算完整账单

Anthropic 报告普通输入7、缓存读入3、缓存创建2；OpenAI 报告总输入12、其中缓存读入3。内部总输入应怎样表示？如果下一次响应没有 usage，应填0吗？

答案：两者总输入都是12。缓存字段仍分别保留，OpenAI 没有报告缓存创建时保持 `null`。完整答案另发一份没有 usage 的真实流，断言输入、输出和缓存字段均为未知，并检查认证、限流、服务、连接、请求及未知错误的分类。数字不包含一套完整的服务商账单规则。

## 完整可执行答案

将下面完整保存为 [examples/verify-models.ts](examples/verify-models.ts)。这是独立练习，不修改下一章沿用的 `src/`；脚本的断言失败会以非零状态退出，结束后清理自己创建的资源。

<details>
<summary>展开完整 TypeScript 答案</summary>

```ts
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

</details>

## 构建与运行

完成 23.1 时先编译 23.1，再运行组号 `1`；完成 23.2 时编译 23.2，再运行 `2`。学完 23.3 后按下面步骤运行全部三组。先从仓库根构建本章最终快照：

```bash
npm run lesson:23.3
```

再单独编译练习。临时目录中的 package.json 让 Node 按 ES module 解释编译结果；`HMA_REPO` 使脚本能找到刚构建的本章 dist。

```bash
export HMA_REPO="$PWD"
MODEL_EXERCISE="$(mktemp -d)"
printf '%s\n' '{"private":true,"type":"module"}' > "$MODEL_EXERCISE/package.json"
"$HMA_REPO/node_modules/.bin/tsc" chapter-23-model-adapters/examples/verify-models.ts \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  --outDir "$MODEL_EXERCISE"
```

最后运行，编译命令本身不会触发断言：

```bash
node "$MODEL_EXERCISE/verify-models.js" all
```

将最后的 `all` 换成 `1`、`2` 或 `3`，可以只检查一组。输出对应的“通过”才表示断言成立；程序抛错时先核对当前构建的小节，不要把输出改为固定成功文字。临时编译目录可在查看结果后自行删除。

本章状态：待用户确认。
