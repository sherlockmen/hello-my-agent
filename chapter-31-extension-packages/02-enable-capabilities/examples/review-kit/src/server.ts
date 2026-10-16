/**
 * 示例 MCP 服务：从 TypeScript 编译到 dist/server.js，再由用户明确启用。
 * 输入：stdio JSON-RPC 请求；输出：初始化结果、工具目录与固定检查项。
 * 状态：运行时记录 PID，stdin 结束后退出；编译和安装不启动服务。
 */
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

type Request = {
  id?: string | number;
  method: string;
  params?: { protocolVersion?: string };
};

writeFileSync('server.pid', String(process.pid));
process.stdin.on('end', () => process.exit(0));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as Request;
  if (request.id === undefined) continue;
  let result: unknown;
  if (request.method === 'initialize') result = { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'review-notes', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'checklist', description: '取得固定代码检查项', inputSchema: { type: 'object', properties: {} } }] };
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: '检查空输入、失败返回值和取消后资源。' }] };
  else result = {};
  console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
