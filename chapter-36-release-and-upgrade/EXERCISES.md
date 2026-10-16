# 第 36 章练习：别把空模块当成完整交付

[本章首页](README.md) · [36.3 完成版](03-config-and-session-upgrade/README.md)

## 先解释一次升级

把 v1 连接配置中的 model 改成另一个合法名称，再运行迁移。迁移器应该忠实保留这个名称，还是替用户换成默认模型？如果 `.v1.bak` 已经存在，应该继续覆盖还是停下来？先根据正文说明原因，再实际检查目标与备份。

答案：迁移只改变已知结构，不替用户更换连接选择；已有备份必须保留，目标保持原文，用户核对后再决定怎样处理。成功迁移后的合法 v2 再运行，不产生新备份。

## 动手练习：拒绝零字节模块

36.2 的文件表检查确认了路径与必需入口，但一份 `dist/cli.js` 即使存在，长度为 0 也不能启动 Agent。请在 36.3 的 `src/release/check-package.ts` 增加一个检查：`dist/` 中每个模块的 `size` 必须是正的安全整数；否则返回固定错误，不打印原始清单。

只改这个文件，不新增配置项，也不修改打包清单。检查必须发生在返回“通过”之前；原有路径白名单、包身份和缺入口判断都保留。

## 完整答案

<!-- solution: src/release/check-package.ts -->
```typescript
/**
 * 36 章练习：拒绝空模块 | [CHANGED] release/check-package.ts
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
    // [CHANGED 练习] dist 模块必须有正整数长度，零字节模块不能算交付完整。
    if (path.startsWith("dist/") && (!Number.isSafeInteger(file.size) || (file.size as number) <= 0)) throw new UserFacingError("打包清单包含空模块或无效模块大小。");
    if (!["LICENSE", "README.md", "package.json"].includes(path) && !/^dist\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/.test(path)) throw new UserFacingError("打包内容超出范围：只允许说明文件、许可证、包清单和 dist JavaScript 模块。");
    if (paths.includes(path)) throw new UserFacingError("打包清单包含重复文件。");
    paths.push(path);
  }
  if (["LICENSE", "README.md", "package.json", "dist/cli.js"].some(path => !paths.includes(path))) throw new UserFacingError("打包清单缺少必需文件或 CLI 入口。");
  return paths.length;
}
```

## 运行验证

把答案完整替换到 36.3 对应文件后执行：

```bash
npm run lesson:36.3
```

```bash
npm run check:36
```

本章检查会在临时快照里加载这份完整答案，用真实 npm 清单确认正常包仍通过，再把 CLI 文件的 size 改为 0，确认新增分支拒绝它。它也会回归原先的未知路径和缺入口检查；正式源码不会被测试改写。

零字节检查只证明这个字段满足要求，不能证明 JavaScript 语法、依赖或运行行为正确。真正安装 tarball 后执行读改测的检查仍然需要保留。
