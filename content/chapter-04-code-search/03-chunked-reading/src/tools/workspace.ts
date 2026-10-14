/**
 * 04.3 把代码位置变成上下文 | [KEEP 来自 04.1] tools/workspace.ts
 *
 * 学习目标：让所有文件工具使用同一个项目根目录和同一组忽略规则。
 * 输入：启动目录，以及项目根目录中的 .gitignore。
 * 输出：项目根目录和一个可以判断相对路径是否应被忽略的匹配器。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +---------------+      向上查找 package.json      +--------------+
 *   | process.cwd() | ------------------------------> | project root |
 *   +---------------+                                 +------+-------+
 *                                                             v
 *                                             内置规则 + 根目录 .gitignore
 *                                                             |
 *                                                             v
 *                                                     Ignore matcher
 *
 * 关键点：Git 的忽略语法包含目录、通配符、否定规则等细节，本书使用成熟的 ignore 包解析，
 * 不自行实现一个容易出错的简化版本。内置规则始终保护 .env，并跳过 .git、node_modules 和 dist。
 * 运行观察：从章节子目录启动时仍以最近的 package.json 为边界；被忽略的路径不会进入搜索结果。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ignore, { type Ignore } from "ignore";
import { ToolError } from "../errors.js";

const BUILT_IN_IGNORES = [
  ".git/",
  "node_modules/",
  "dist/",
  ".env",
  ".env.*",
  ".envrc",
];

/**
 * 找到最近的 package.json，让文件工具共用同一个相对路径起点。
 *
 * 从 start 开始逐级向上查找；默认起点是 process.cwd()。
 * 找到时返回该目录，找不到时返回规范化后的原起点。
 * 这里只确定项目根，不检查某个文件是否允许读取，也不提供文件系统隔离。
 */
export function findProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

/**
 * 让搜索同时遵守项目忽略规则和程序内置保护。
 *
 * 读取项目根目录的一份 .gitignore，返回可用 ignores() 判断相对路径的匹配器。
 * 项目规则中的 ! 可以重新包含普通文件，因此最后再加入内置规则，防止恢复 .env 或依赖目录。
 * 没有 .gitignore 时只用内置规则；存在但读取或解析失败时抛出 ToolError，不悄悄扩大搜索范围。
 * 本章还不读取子目录的 .gitignore 或全局 Git 忽略规则。
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
