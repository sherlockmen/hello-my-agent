/**
 * 36.3 配置与会话升级 | [KEEP] release/check-package.ts
 *
 * 学习目标：检查这次 npm pack 的实际文件表，让多余文件或缺少入口提前失败。
 * 输入：npm pack --json 保存的清单路径和当前包身份；输出：通过摘要或安全错误。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   JSON 单包清单 -> 身份匹配? -> 必需文件齐全? -> 每条路径在范围内? -> 通过
 *   任一失败 -> 抛出固定原因；不上传、不改包、不回显清单原文。
 * 状态：只读清单，不能证明模块行为正确，也不扫描源码常量中的秘密。
 */
import { readFileSync, statSync } from "node:fs";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 36.2] npm 的结构数据作为未知输入逐层检查，不信任清单里的路径。
/**
 * 核对单包身份与交付范围；返回的计数只说明清单通过，不能当作安装成功。
 * 需要额外的 tarball 安装验收来证明依赖完整和读改测真正执行。
 */
export function checkPackage(path: string | undefined, identity: { name: string; version: string }): number {
  let value: unknown;
  try {
    if (!path) throw new Error("missing path");
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 2_000_000) throw new Error("invalid file");
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch { throw new UserFacingError("无法读取打包清单：请提供 npm pack --json 的单包 JSON 输出。"); }
  // npm 12 用包名作为键，较早版本使用数组；两者都必须恰好包含一个包。
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  if (entries.length !== 1 || !entries[0] || typeof entries[0] !== "object" || Array.isArray(entries[0])) throw new UserFacingError("打包清单必须只有一个包。");
  const info = entries[0] as Record<string, unknown>;
  if (info.name !== identity.name || info.version !== identity.version) throw new UserFacingError("打包清单的名称或版本与当前程序不一致。");
  if (!Array.isArray(info.files) || info.files.length > 5000) throw new UserFacingError("打包清单缺少有效文件表。");
  const paths: string[] = [];
  for (const file of info.files) {
    if (!file || typeof file !== "object" || typeof file.path !== "string") throw new UserFacingError("打包清单包含无效文件项。");
    const path = file.path as string;
    if (!["LICENSE", "README.md", "package.json"].includes(path) && !/^dist\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/.test(path)) throw new UserFacingError("打包内容超出范围：只允许说明文件、许可证、包清单和 dist JavaScript 模块。");
    if (paths.includes(path)) throw new UserFacingError("打包清单包含重复文件。");
    paths.push(path);
  }
  if (["LICENSE", "README.md", "package.json", "dist/cli.js"].some(path => !paths.includes(path))) throw new UserFacingError("打包清单缺少必需文件或 CLI 入口。");
  return paths.length;
}
