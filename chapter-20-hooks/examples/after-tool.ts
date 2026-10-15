/**
 * 20.2 执行后检查示例 | [NEW 练习] after-tool.ts
 * 学习目标：在实际写入成功后检查文件内容，把制表符提示交回模型。
 * 输入：stdin 中完整的 after_tool 事件，含原调用、执行 outcome 与结果。
 * 输出：单个 message JSON；格式或读取失败写 stderr 并非零退出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整读事件 -> 成功的文件修改？-- 否 -> 空反馈；是 -> 读当前文件 -> 检查制表符 -> 反馈
 * 状态与观察：本脚本只读文件；工具已经完成，反馈不能阻止或撤销之前的写入。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// [NEW 练习] 项目自定义 after_tool 协议实现。

/**
 * 读取一条事件，校验检查脚本需要的字段。
 * 读取并校验输入后执行上面的局部流程；失败交给入口 catch 输出诊断并设置非零退出。
 */
async function main(): Promise<void> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要事件对象");
  const event = value as Record<string, unknown>;
  if (event.event !== "after_tool" || !event.call || typeof event.call !== "object") throw new Error("事件无效");
  const call = event.call as Record<string, unknown>;
  let message = "";
  if (event.outcome === "success" && (call.name === "write_file" || call.name === "edit_file")) {
    if (typeof call.arguments !== "string") throw new Error("缺少调用参数");
    const args: unknown = JSON.parse(call.arguments);
    if (!args || typeof args !== "object" || typeof (args as Record<string, unknown>).path !== "string") {
      throw new Error("缺少 path");
    }
    const path = (args as { path: string }).path;
    const content = await readFile(resolve(path), "utf8");
    message = content.includes("\t")
      ? `格式检查发现 ${path} 含制表符，请改为空格后重新检查。`
      : `格式检查：${path} 未发现制表符。`;
  }
  process.stdout.write(JSON.stringify({ message }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
