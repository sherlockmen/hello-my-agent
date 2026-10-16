/**
 * 示例 Hook：从 TypeScript 编译出 dist/hook.js，供显式启用后的真实工具入口调用。
 * 输入：stdin 中的 Hook JSON；输出：包目录中的事件记录与允许继续的协议反馈。
 * 状态：编译和安装均不运行本文件；Hook 反馈不授予工具批准。
 */
import { appendFileSync } from 'node:fs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input) as { event: string };
appendFileSync('hook-ran.txt', event.event + '\n');
console.log(JSON.stringify({ continue: true, message: 'review-kit 已检查本次工具入口。' }));
