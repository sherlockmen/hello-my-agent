/**
 * 36.2 发布门禁 | [KEEP] code-command.ts
 * 输入：本地用户的code参数；输出：JSON结果或可见错误，不调用模型。
 * argv -> 参数有效？-- 否 -> 使用说明
 *                 +-- 是 -> 客户端查询 -> 输出 -> finally关闭服务
 * 入口在模型密钥检查前分流，工具和本地命令复用同一参数校验。
 */
import { LanguageService } from "./language-service/client.js";
import { codeIntelligenceTool } from "./tools/code-intelligence.js";
import { UserFacingError } from "./errors.js";

/** 本地只读查询也响应Ctrl+C，所有路径都等待拥有资源关闭。 */
export async function runCodeCommand(args: string[]): Promise<void> {
  const [action, path, line, column] = args;
  // [KEEP 来自 32.3] 诊断没有光标位置；两种入口共用严格工具校验。
  if (action === "diagnostics" ? args.length !== 2 : args.length !== 4 || !["definition", "references"].includes(action)) throw new UserFacingError("用法：hello-my-agent code <definition|references> <path> <line> <column>；或 code diagnostics <path>");
  const service = new LanguageService(), controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("本地代码查询已取消。"));
  process.once("SIGINT", cancel);
  try { console.log((await codeIntelligenceTool(JSON.stringify({ action, path, ...(action === "diagnostics" ? {} : { line: Number(line), column: Number(column) }) }), service, controller.signal)).content); }
  finally { process.removeListener("SIGINT", cancel); await service.close(); }
}
