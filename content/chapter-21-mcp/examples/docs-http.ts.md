# docs-http.ts

`chapter-21-mcp/examples/docs-http.ts`

<a href="./content/chapter-21-mcp/examples/docs-http.ts" download>下载原始文件</a>

```typescript
/**
 * 21.2 HTTP 文档服务 | [NEW 练习] docs-http.ts
 * 学习目标：用固定 Bearer 演示无状态 Streamable HTTP，不引入自动登录。
 * 输入：本地 DOCS_MCP_TOKEN/PORT 和回环地址 /mcp 的请求。
 * 输出：认证通过的 POST 由 SDK 回 JSON；路径、Origin、认证、方法失败各有状态码。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   校验环境 -> 监听回环 -> 路径/Origin/token/POST 有效？-- 否 -> 拒绝
 *     是 -> 本次新建 SDK 服务与传输 -> 处理请求 -> 响应关闭后关闭对应服务
 *   SIGINT/SIGTERM -> 关连接与 HTTP 监听；错误写 stderr
 * 状态与观察：本例不提供 GET 事件流和 DELETE 会话；固定演示文档不代表真实线上查询。
 */
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

// [NEW 练习] 可独立运行的 MCP HTTP 服务。

/**
 * 在回环地址启动带固定 token 检查的 HTTP 监听。
 * 每个有效 POST 使用一组 SDK 对象，响应关闭后释放；信号负责停止监听和现有连接。
 * token 只来自本地环境，既不打印，也不由模型工具参数选择。
 */
async function main(): Promise<void> {
  const token = process.env.DOCS_MCP_TOKEN;
  if (!token || /[\r\n]/.test(token)) throw new Error("请先设置 DOCS_MCP_TOKEN。");
  const port = Number(process.env.DOCS_MCP_PORT ?? "17721");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口无效。");
  const http = createServer(async (request, response) => {
    if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    // 本例不提供独立 GET 事件流与 DELETE 会话终止；POST 响应使用 JSON。
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    const server = new McpServer({ name: "tutorial-http-docs", version: "1.0.0" });
    server.registerTool("lookup_docs", {
      description: "查询远端演示文档。",
      inputSchema: { topic: z.string().min(1) },
    }, async ({ topic }) => ({ content: [{ type: "text", text: `远端演示文档：${topic}；maxRetries 默认值为 2。` }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once("close", () => { void server.close().catch(error => console.error(error)); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error(error);
      await server.close();
      if (!response.headersSent) response.writeHead(500).end();
    }
  });
  http.on("error", error => { console.error(error); process.exitCode = 1; });
  http.listen(port, "127.0.0.1", () => console.error(`MCP 演示端点 http://127.0.0.1:${port}/mcp`));
  process.once("SIGINT", () => { http.closeAllConnections(); http.close(); });
  process.once("SIGTERM", () => { http.closeAllConnections(); http.close(); });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
```
