/**
 * 20.1 执行前检查示例 | [NEW 练习] before-tool.ts
 * 学习目标：用项目脚本阻止写入 generated/；这是项目约定，不是操作系统沙箱。
 * 输入：Agent 在工具已获批准后写入 stdin 的单个 before_tool JSON。
 * 输出：stdout 只写一个 continue/message JSON；解析失败写 stderr 并非零退出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整读 stdin -> 对象/事件有效？-- 否 -> 失败退出；是 -> 写入或编辑？
 *     否 -> continue=true；是 -> 检查 path -> generated 内？-- 是 -> continue=false；否 -> true
 * 状态与观察：本脚本不改文件；拒绝时真实工具尚未启动，核心再把原因交回原调用。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

// [NEW 练习] 项目自定义 before_tool 协议实现。

/**
 * 等 stdin 结束后再解析一整份 JSON。
 * stdout 专供返回协议使用；输入或解析失败交给 main 的错误收尾。
 */
async function readInput(): Promise<unknown> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return JSON.parse(text);
}

/**
 * 要求已解析值为非数组对象，再允许调用者读取字段。
 * JSON 字符串、数组和 null 虽然合法，却不是这个协议所需的事件对象。
 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要对象");
  return value as Record<string, unknown>;
}

/**
 * 以当前工作目录为基准，比较 path 与 generated 的词法相对位置。
 * 结果只表达项目路径约定，没有解析符号链接，也不能作为文件系统隔离保证。
 */
function generated(path: string): boolean {
  const inside = relative(resolve("generated"), resolve(path));
  return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/**
 * 验证 before_tool 事件，只检查 write_file 与 edit_file 的 path。
 * 返回 continue=false 让核心阻止尚未开始的调用；其他工具按本项目规则通过。
 */
async function main(): Promise<void> {
  const event = object(await readInput());
  if (event.event !== "before_tool") throw new Error("不是 before_tool");
  const call = object(event.call);
  let blocked = false;
  if (call.name === "write_file" || call.name === "edit_file") {
    if (typeof call.arguments !== "string") throw new Error("缺少调用参数");
    const args = object(JSON.parse(call.arguments));
    if (typeof args.path !== "string") throw new Error("缺少 path");
    blocked = generated(args.path);
  }
  process.stdout.write(JSON.stringify(blocked
    ? { continue: false, message: "generated/ 由构建生成，请修改源文件。" }
    : { continue: true }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
