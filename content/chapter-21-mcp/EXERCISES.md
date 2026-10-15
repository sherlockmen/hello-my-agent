# 第 21 章练习与答案

[第 21 章首页](/content/chapter-21-mcp/README.md) · [21.3 连接生命周期](/content/chapter-21-mcp/03-connection-lifecycle/README.md)

先预测，再运行下面的完整 TypeScript 答案。答案使用真实 SDK、本机 stdio 子进程和本机 HTTP 服务；本地测试模型只固定调用顺序，不请求在线模型。

## 练习一：服务说只读，能否免去第二次审批

服务提供 `lookup_docs` 并标注 `readOnlyHint: true`。模型连续查两次，分别应有几次审批？Plan 能否调用？工具返回 `isError: true` 后，连接一定断开吗？

答案：两次都审批，不保存为全部外部调用授权；Plan 拒绝。只读提示来自外部服务，不能批准本地操作。明确的 `isError` 是已收到的工具响应，沿原编号返回，连接仍可为 ready；它不同于本地没有取得响应的传输错误。

## 练习二：地址能打开，为什么还没有工具

HTTP 端点返回 401，或返回普通页面的 200，是否可以向模型公布工具？如何证明固定 token 已正确接入，又没有进入普通诊断？

答案：必须完成 SDK 握手和完整工具发现才发布。下面先用错误 token 检查无定义、认证诊断与不泄露正文；再使用正确 token 完成真实调用并检查来源。只有“HTTP 成功”不能证明协议或工具成功。

## 练习三：旧映射还在，为什么不能执行

服务发送目录变化通知，随后模型再次提出旧名字；另一条长调用在等待中被取消。定义列表、执行入口与退出时分别应该怎样变化？

答案：通知使状态 stale，定义过滤为空，执行入口拒绝旧名字；请求失败或取消停用并关闭本地传输，不自动重连或重放。关闭成功后标为 closed，stdio 还核实直接 PID 退出。旧 Map 条目不是授权，也不是活连接；取消更不是远端回滚证明。

## 完整可执行答案

[examples/verify-mcp.ts](/content/chapter-21-mcp/examples/verify-mcp.ts.md) 与下面一致，同一文件的 `worker` 分支就是 stdio 服务，HTTP 服务也在文件内完整定义。测试中的直接 `callMcp` 只验证传输与生命周期；审批另外通过真实 Agent Loop 验证。

<details>
<summary>展开完整答案</summary>

```ts
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

</details>

先在仓库根编译 21.3，再编译并运行完整答案。

```bash
npm run lesson:21.3
```



```bash
export HMA_REPO="$PWD"
MCP_EXERCISE="$(mktemp -d)"
printf '%s\n' '{"type":"module"}' > "$MCP_EXERCISE/package.json"
ln -s "$HMA_REPO/node_modules" "$MCP_EXERCISE/node_modules"
"$HMA_REPO/node_modules/.bin/tsc" chapter-21-mcp/examples/verify-mcp.ts \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  --outDir "$MCP_EXERCISE"
node "$MCP_EXERCISE/verify-mcp.js"
```

看到三个“通过”才表示这些断言成立。若断言失败，保留原错误检查配置、SDK 版本或真实响应，不把它改成固定成功输出。完整答案为测试创建和清理临时目录；它不会证明任意远端服务安全或内容正确。
