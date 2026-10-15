# web-provider.ts

`chapter-22-web/examples/web-provider.ts`

<a href="./content/chapter-22-web/examples/web-provider.ts" download>下载原始文件</a>

```typescript
/**
 * 第 22 章本机资料服务 | [NEW 练习] examples/web-provider.ts
 * 学习目标：用可控制的响应观察抓取、搜索、超量与慢正文。
 * 输入：loopback HTTP 路径与 q 查询词；输出：真实 HTML、JSON 或分块正文。
 * 本文件实验服务流程（全局主流程见 agent/agent-loop.ts）：
 * request -> 路径存在？-- 否 -> 404
 *                    -- 是 -> 对应资料/重定向/边界响应 -> response close
 * 关键点：搜索只给候选摘要，默认值留在正文；慢正文等关闭才清理计时器。
 * 观察：读取 /redirect 得到最终文档；/oversize 超量；/slow 不能被当作完整来源。
 */
import { createServer } from "node:http";

// [NEW 练习] 只监听本机，测试不需要在线搜索账户或密钥。
const port = Number(process.env.WEB_DEMO_PORT ?? 17722);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const base = `http://127.0.0.1:${port}`;
  if (url.pathname === "/search") {
    const query = url.searchParams.get("q") ?? "";
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ results: query.includes("无命中") ? [] : [
      { title: "重试配置说明", url: `${base}/docs/retries`, snippet: "maxRetries 表示重试次数；具体默认值见正文。" },
    ] }));
    return;
  }
  if (url.pathname === "/redirect") { response.writeHead(302, { Location: "/docs/retries" }).end(); return; }
  if (url.pathname === "/docs/retries") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<title>重试配置说明</title><h1>Retries</h1><p>maxRetries 控制重试次数，默认值为 2。该资料没有验证你的本地代码。</p><script>这是脚本文本，不应成为正文。</script>");
    return;
  }
  if (url.pathname === "/oversize") {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.write("x".repeat(65536));
    response.end("x".repeat(65537));
    return;
  }
  if (url.pathname === "/slow") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.write("尚未完整取得的正文");
    const timer = setTimeout(() => response.end("完成"), 10000);
    response.once("close", () => clearTimeout(timer));
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" }).end("没有这个页面");
});
server.listen(port, "127.0.0.1", () => console.error(`网页实验服务：http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.closeAllConnections(); server.close(error => { if (error) { console.error(error); process.exitCode = 1; } });
});
```
