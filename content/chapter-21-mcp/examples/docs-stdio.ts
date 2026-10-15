/**
 * 21.1 本地文档服务 | [NEW 练习] docs-stdio.ts
 * 学习目标：用官方 SDK 提供一个可被发现和调用的 MCP 工具。
 * 输入：stdin 上的 MCP 协议消息；lookup_docs 需要非空 topic。
 * 输出：stdout 只由 SDK 写协议，诊断写 stderr；工具返回固定演示文档。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   建服务 -> 注册 Schema/处理函数 -> 连接 stdio -> tools/list 或 tools/call -> SDK 响应
 * 状态与观察：服务不保存项目文件；读到 maxRetries=2 只证明收到这份演示返回。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

// [NEW 练习] 可独立编译运行的 MCP stdio 服务。

/**
 * 服务在每次调用时接收 topic；这里返回可预测的演示文档。
 * 读取并校验输入后执行上面的局部流程；失败交给入口 catch 输出诊断并设置非零退出。
 */
async function main(): Promise<void> {
  const server = new McpServer({ name: "tutorial-docs", version: "1.0.0" });
  server.registerTool("lookup_docs", {
    description: "查询演示客户端的重试参数与返回类型。",
    inputSchema: { topic: z.string().min(1).describe("要查询的主题") },
  }, async ({ topic }) => ({ content: [{ type: "text", text: topic.includes("重试")
    ? "演示文档：maxRetries 默认值为 2；仅对幂等读取重试。"
    : "演示文档：lookup 返回 Promise<string>。" }] }));
  await server.connect(new StdioServerTransport());
}

main().catch(error => { console.error(error); process.exitCode = 1; });
