/**
 * 05.1 让工具调用先经过权限策略 | [CHANGED] tools/workspace.ts
 *
 * 学习目标：让文件工具从同一个项目目录开始，并跳过不应搜索的文件。
 * 输入：启动目录和项目根目录中的 .gitignore。
 * 输出：项目根目录，以及用于判断相对路径是否应跳过的 ignore 匹配器。
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
 * 不自行实现一个容易出错的简化版本。内置规则始终保护 .env，并跳过受保护元数据、依赖和构建目录。
 * 运行观察：从章节子目录启动时仍以最近的 package.json 为边界；被忽略的路径不会进入搜索结果。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ignore, { type Ignore } from "ignore";
import { ToolError } from "../errors.js";

// [CHANGED 05.1] 搜索工具不进入需要单文件审批的元数据目录，防止 grep 绕过 read_file 的权限入口。
const BUILT_IN_IGNORES = [
  ".git/",
  ".agents/",
  ".codex/",
  "node_modules/",
  "dist/",
  ".env",
  ".env.*",
  ".envrc",
];

/**
 * 向上找到最近的 package.json，确定文件工具从哪里开始。
 *
 * 默认从当前工作目录出发。找到就返回所在目录，走到文件系统根仍没找到则返回整理后的起点。
 * 这里只选定项目目录，还没有判断某个文件能不能访问。
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
 * 把项目忽略规则和程序必须跳过的路径合在一起。
 *
 * - 传入项目根目录，返回 ignore 匹配器；调用 ignores(relativePath) 判断是否跳过。
 * - 项目 .gitignore 读入后，再追加一次内置规则，避免 ! 把受保护目录重新包含进来。
 * - .gitignore 无法读取或解析时抛出 ToolError；本节还不合并子目录中的 .gitignore。
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
