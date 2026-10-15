# verify-mcp.ts

`chapter-21-mcp/examples/verify-mcp.ts`

<a href="./content/chapter-21-mcp/examples/verify-mcp.ts" download>下载原始文件</a>

```typescript
/**
 * 第21章完整验证答案 | [NEW 练习] verify-mcp.ts
 * 学习目标：通过真实 SDK、stdio/HTTP 和固定测试模型验证发现、审批与关闭。
 * 输入：已编译本章 dist（可用 HMA_MCP_DIST 指定）以及脚本临时建立的配置与服务。
 * 输出：各组断言的通过提示；finally 关闭服务、删除临时文件并恢复原 token。
 * 练习验证流程（产品全局主流程见 agent/agent-loop.ts）：
 *   临时配置 -> SDK 发现/调用 -> 核对真实 Loop 审批与下次消息
 *   本地 HTTP -> 正确/错误 token；目录变更或取消 -> 撤下定义、等待关闭 -> 断言
 * 状态与观察：测试不请求在线模型；本地关闭不能证明远端业务副作用回滚。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

// [NEW 练习] 真实 SDK 与核心的本地验证。

type Call = { id: string; name: string; arguments: string };
type Message = { role: string; content: string; toolCallId?: string; isError?: boolean };

/**
 * 创建带一个 lookup_docs 工具的真实 SDK 服务。
 * topic 选择固定返回、明确工具错误、目录变更通知或可取消的等待，供客户端观察生命周期。
 */
function docs(): McpServer {
  const server = new McpServer({ name: "exercise-docs", version: "1.0.0" });
  server.registerTool("lookup_docs", { description: "这是外部说明，不能替用户批准。",
    inputSchema: { topic: z.string() }, annotations: { readOnlyHint: true },
  }, async ({ topic }, extra) => {
    if (topic === "wait") await delay(10000, undefined, { signal: extra.signal });
    if (topic === "change") server.sendToolListChanged();
    return { content: [{ type: "text", text: `文档返回：${topic}；maxRetries=2` }], isError: topic === "error" };
  });
  return server;
}

/**
 * 启动临时 stdio/HTTP 服务，通过真实适配器核对发现、调用、取消与关闭。
 * 直接调用只证明传输；审批次数和结果进入下一请求由真实 Agent Loop 单独验证。
 * finally 等待服务关闭并恢复实验前环境，断言失败也经过相同收尾。
 */
async function main(): Promise<void> {
  const repo = resolve(process.env.HMA_REPO ?? process.cwd());
  const dist = resolve(process.env.HMA_MCP_DIST ?? join(repo, "dist"));
  const { connectMcp, callMcp, mcpDefinitions, mcpInfo } = await import(pathToFileURL(join(dist, "mcp/client.js")).href);
  const { runAgent } = await import(pathToFileURL(join(dist, "agent/run.js")).href);
  const { decideToolPermission } = await import(pathToFileURL(join(dist, "permissions/policy.js")).href);
  const script = fileURLToPath(import.meta.url);
  const root = await mkdtemp(join(tmpdir(), "mcp-exercises-"));
  const config = join(root, "mcp.json");
  const controller = new AbortController();
  const local = { name: "docs", transport: "stdio", command: process.execPath, args: [script, "worker"] };
  const oldToken = process.env.MCP_EXERCISE_TOKEN;
  let state: Awaited<ReturnType<typeof connectMcp>>;
  let http: ReturnType<typeof createServer> | undefined;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    await writeFile(config, JSON.stringify({ servers: [local] }));
    state = await connectMcp(config, root, controller.signal);
    const name = "mcp__docs__lookup_docs";
    assert.equal(state.servers[0].status, "ready");
    assert.equal(mcpDefinitions(state)[0].name, name);
    const call: Call = { id: "lookup-1", name, arguments: JSON.stringify({ topic: "重试参数" }) };
    const permission = await decideToolPermission(call, new Set(), root, "execute", new Set([name]));
    assert.equal(permission.action, "ask");
    assert.equal(permission.remember, false);
    assert.equal((await decideToolPermission(call, new Set(), root, "plan", new Set([name]))).action, "deny");
    let approvals = 0;
    let requests = 0;
    const history: Message[] = [];
    const seen: Message[][] = [];
    const model = { mcp: state, async generate(messages: Message[]) {
      seen.push(messages.map(item => ({ ...item })));
      requests += 1;
      const toolCalls = requests <= 2 ? [{ ...call, id: `lookup-${requests}` }] : [];
      return { text: toolCalls.length ? "" : "已根据文档回答。", toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : "stop", inputTokens: 1, outputTokens: 1, truncated: false };
    } };
    await runAgent(model, history, "查询两次", controller.signal, undefined,
      async () => { approvals += 1; return { decision: "allow_once" }; });
    assert.equal(approvals, 2);
    assert.ok(seen[1].some(item => item.toolCallId === "lookup-1" && item.content.includes("maxRetries=2")));
    const explicitError = await callMcp(state, { ...call, arguments: '{"topic":"error"}' }, controller.signal);
    assert.equal(explicitError.isError, true);
    assert.equal(state.servers[0].status, "ready");
    console.log("通过一：真实发现与调用，逐次审批，Plan 拒绝；结果沿原编号进入下一模型输入。");
    await state.close();
    assert.equal(state.servers[0].status, "closed");

    // HTTP 提供方真实校验认证头，错误凭据不会发布工具，也不应泄露令牌。
    const token = "exercise-only-token";
    http = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
      if (request.method !== "POST") { response.writeHead(405).end(); return; }
      const server = docs();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      response.once("close", () => { void server.close(); });
      try { await server.connect(transport); await transport.handleRequest(request, response); }
      catch { await server.close(); if (!response.headersSent) response.writeHead(500).end(); }
    });
    await new Promise<void>(done => http!.listen(0, "127.0.0.1", done));
    const address = http.address();
    assert.ok(address && typeof address !== "string");
    await writeFile(config, JSON.stringify({ servers: [{ name: "remote", transport: "http",
      url: `http://127.0.0.1:${address.port}/mcp`, tokenEnv: "MCP_EXERCISE_TOKEN" }] }));
    process.env.MCP_EXERCISE_TOKEN = "wrong-exercise-token";
    state = await connectMcp(config, root, controller.signal);
    assert.equal(mcpDefinitions(state).length, 0);
    assert.match(mcpInfo(state).join(), /401|认证/);
    assert.ok(!mcpInfo(state).join().includes("wrong-exercise-token"));
    await state.close();
    process.env.MCP_EXERCISE_TOKEN = token;
    state = await connectMcp(config, root, controller.signal);
    assert.equal(state.servers[0].status, "ready");
    const remote = await callMcp(state, { ...call, name: "mcp__remote__lookup_docs" }, controller.signal);
    assert.match(remote.content, /来源：remote\/lookup_docs/);
    assert.match(remote.content, /maxRetries=2/);
    await state.close();
    console.log("通过二：错误凭据没有定义；正确凭据完成 HTTP 握手、发现与真实调用，诊断无令牌正文。");

    // 变化通知撤下旧定义；取消另一组新连接，不自动恢复或重放。
    await writeFile(config, JSON.stringify({ servers: [local] }));
    state = await connectMcp(config, root, controller.signal);
    await callMcp(state, { ...call, arguments: '{"topic":"change"}' }, controller.signal);
    for (let i = 0; i < 50 && state.servers[0].status === "ready"; i += 1) await delay(10);
    assert.equal(state.servers[0].status, "stale");
    assert.equal(mcpDefinitions(state).length, 0);
    await assert.rejects(callMcp(state, call, controller.signal), /不可用/);
    await state.close();
    state = await connectMcp(config, root, controller.signal);
    const cancel = new AbortController();
    const pending = callMcp(state, { ...call, arguments: '{"topic":"wait"}' }, cancel.signal);
    const timer = setTimeout(() => cancel.abort(new Error("练习取消")), 80);
    try { await assert.rejects(pending, /练习取消/); } finally { clearTimeout(timer); }
    assert.equal(state.servers[0].status, "disconnected");
    assert.equal(mcpDefinitions(state).length, 0);
    await assert.rejects(callMcp(state, call, controller.signal), /不可用/);
    await state.close();
    assert.equal(state.servers[0].status, "closed");
    console.log("通过三：目录变化后旧定义停用，取消后等待关闭且不重连；直接子进程退出已核实。");
  } finally {
    await state?.close();
    http?.closeAllConnections();
    if (http?.listening) await new Promise<void>((done, reject) => http!.close(error => error ? reject(error) : done()));
    if (oldToken === undefined) delete process.env.MCP_EXERCISE_TOKEN;
    else process.env.MCP_EXERCISE_TOKEN = oldToken;
    await rm(root, { recursive: true, force: true });
  }
}

(process.argv[2] === "worker" ? docs().connect(new StdioServerTransport()) : main())
  .catch(error => { console.error(error); process.exitCode = 1; });
```
