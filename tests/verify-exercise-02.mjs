/**
 * 第二章练习验收：编译读者实际修改的 02.6 源码，再验证 /reset 是否清空历史。
 * 模型响应来自本地 HTTP 服务；不读取开发机密钥，也不访问外网。
 *
 * 练习验证流程：
 *   02.6 实际源码 -> 编译到 dist -> 启动本地模型接口
 *                                 -> 对话 -> /reset -> 再对话
 *                                 -> 检查第二次请求不含旧历史
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyChat } from "./verify-chat.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "hello-agent-exercise-02-"));

try {
  const compile = spawnSync(process.execPath, [join(root, "scripts/compile.mjs"), "02.6"], {
    cwd: root,
    encoding: "utf8",
  });
  if (compile.status !== 0) throw new Error(compile.stdout + compile.stderr);
  await verifyChat(join(root, "dist/cli.js"), workspace, { reset: true });
  console.log("✓ 第二章练习：实际 terminal.ts 的 /reset 已通过双协议验收");
} catch (error) {
  console.error("✗ 第二章练习尚未通过：/reset 没有正确清空实际 terminal.ts 中的会话历史。");
  console.error("请对照练习要求检查 /reset 分支、history.length = 0 和 continue，然后重新运行。");
  console.error(`具体错误：${error instanceof Error ? error.message.trim() : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
