/**
 * 27.3 整批结果屏障 | [KEEP] tools/workspace.ts
 *
 * 学习目标：继续复用项目根；搜索跳过专用元数据，不能靠项目忽略规则重新包含。
 * 输入：启动目录，以及项目根目录中的 .gitignore。
 * 输出：项目根目录和一个可以判断相对路径是否应被忽略的匹配器。
 * 状态：找不到项目标记时使用真实启动目录；忽略文件读取失败抛出 ToolError，不修改项目文件。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +---------------+      向上查找 package.json / .git      +--------------+
 *   | process.cwd() | ------------------------------> | project root |
 *   +---------------+                                 +------+-------+
 *                                                             v
 *                                             内置规则 + 根目录 .gitignore
 *                                                             |
 *                                                             v
 *                                                     Ignore matcher
 *
 * 关键点：Git 的忽略语法包含目录、通配符、否定规则等细节，本书使用成熟的 ignore 包解析，
 * 不自行实现一个容易出错的简化版本。内置规则始终保护 .env，并跳过受保护元数据、依赖和构建目录。
 * 运行观察：从章节子目录启动时仍以最近的 package.json 或 .git 为逻辑边界；被忽略的路径不会进入搜索结果。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
// [KEEP 来自 17.1] 工具边界与说明扫描共用同一项目根算法，项目正文不能改它。
import { findProjectRoot } from "../project/instructions.js";
export { findProjectRoot };
import ignore, { type Ignore } from "ignore";
import { ToolError } from "../errors.js";

const BUILT_IN_IGNORES = [
  ".git/",
  ".agents/",
  ".codex/",
  // [KEEP 来自 18.1] 专用记忆不能经通用搜索暴露，也不能被项目否定规则重新包含。
  ".hello-my-agent/",
  "node_modules/",
  "dist/",
  ".env",
  ".env.*",
  ".envrc",
];

/**
 * 合并内置保护规则和项目根目录的 `.gitignore`，建立路径过滤器。
 *
 * - 输入：已经确定的项目根目录。
 * - 输出：返回 `ignore` 匹配器；调用 `ignores(relativePath)` 可判断路径是否应跳过。
 * - 关键步骤：读取项目规则后再次加入内置规则，防止 `!` 否定规则重新暴露受保护路径。
 * - 失败方式：`.gitignore` 存在但无法读取或解析时抛出 `ToolError`，避免搜索范围悄悄扩大。
 * - 职责边界：本章只读取项目根目录的一份 `.gitignore`，尚未合并子目录中的嵌套规则。
 */
export async function createIgnoreMatcher(projectRoot: string): Promise<Ignore> {
  const matcher = ignore().add(BUILT_IN_IGNORES);
  const ignorePath = join(projectRoot, ".gitignore");
  if (!existsSync(ignorePath)) return matcher;
  try {
    // 项目规则可以使用 ! 重新包含路径；最后再加入内置规则，确保凭据与依赖目录不可被覆盖。
    return matcher.add(await readFile(ignorePath, "utf8")).add(BUILT_IN_IGNORES);
  } catch {
    throw new ToolError("无法读取或解析项目根目录的 .gitignore。");
  }
}
