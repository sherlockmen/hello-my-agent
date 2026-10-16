# 36.3 新程序怎样继续使用旧配置和旧会话？

[本章首页](/content/chapter-36-release-and-upgrade/README.md) · [上一节：发布检查](/content/chapter-36-release-and-upgrade/02-release-gates/README.md) · [练习](/content/chapter-36-release-and-upgrade/EXERCISES.md)

## 问题：换了程序，磁盘上的旧数据不会一起变新

36.1 写下的 `connection.json` 把 provider、model、baseUrl 放在最外层。现在我们希望把连接参数收在 `connection` 对象里，给后续顶层设置留出位置。直接改读取代码，旧文件就会报错；启动时偷偷覆盖，又可能让用户失去原件。

会话还有另一种风险：旧记录里保存过一个 `run_command` 调用。升级后读回这条记录，是否应该再执行一次？如果那条命令曾经发过请求或写过文件，重复执行会产生新的副作用。

## 解决方案：配置显式迁移，会话只恢复事实

连接配置改为 v2。用户运行 `migrate-config <路径>` 时，程序先完整读取和验证 v1，再保存私有备份，准备新文件，最后替换指定配置。新版启动遇到 v1 会提示迁移，不替用户写文件；未知的新版本直接拒绝，避免旧程序猜测自己不懂的数据。

会话继续读取已有 v1 记录格式。恢复后把消息、已有结果与待处理文字交给界面，等用户提出新要求。历史里的工具调用只是已经记录的信息，不是待执行队列。要再次执行操作，必须经过新一轮模型决定和本地权限检查。

## 工作原理：先验证，为什么能保住原件？

迁移按以下顺序推进：读取有大小限制的普通文件；确认版本和字段合法；取得这个路径的专用迁移锁；重新核对原始内容；以排他创建方式写入 `.v1.bak`；把 v2 写进同目录的临时文件；最后重命名替换目标。

验证发生在任何写入之前，因此版本 99、缺模型名、误填密钥、不安全地址都不会产生一个“迁移了一半”的目标文件。备份和临时文件以仅属主可读写的权限创建；备份使用排他创建，已有同名备份就停止，不覆盖上次留下的原件。错误提示只说明失败的阶段，不展示配置全文。

临时文件与目标放在同一目录，是为了让最后的重命名在同一文件系统内完成。它减少用户读到半段 JSON 的机会；不构成跨电源故障、目录损坏和其他程序写入的完整事务。重命名成功之前若失败，迁移器不会替换目标；外部程序自己写入的变化也不会被自动撤销。已经成功建立的备份可能留下，再次运行前应先核对它，而不是自动删除备份重试。

重命名成功就是本次替换已经提交：目标现在是 v2，随后清理锁失败也不会退回 v1。本节把锁清理作为尽力收尾，因此这时命令仍返回迁移成功，但磁盘上可能留有 `.migrate.lock`。应核对目标已是合法 v2、备份保留原文，并确认没有迁移进程后再处理遗留锁；不能只凭锁还在就认定替换没有发生。

锁只约束遵守这套命令的迁移进程。另一个编辑器若不理会锁，仍可能在检查与替换之间写入。本节会在替换前再次比较原文，以发现大部分这种冲突，但不承诺对任意外部写入提供排他保护。迁移期间应关闭该文件的自动写入；异常退出留下的锁需要确认没有迁移进程后由用户处理。

已经是合法 v2 的文件返回“无需迁移”，不重复生成备份。这就是本节的幂等范围：同一份成功迁移后的输入再次执行，不产生新的数据变化。它不意味着任意失败都可以不检查现场地重复执行。

## 新旧格式怎样接上实际配置读取？

v2 形状是 `version: 2` 加 `connection: { provider, model, baseUrl? }`。迁移器只移动已验证的连接字段，不修改 `.env`，也不读取密钥。运行时读取器把 connection 还原为原有配置选项，再按照 36.1 的优先级合并；这使迁移结果确实能用于下一次启动，而不只是 JSON 看起来更整齐。

v1 是本章前两节刚引入的示例格式；第三十五章及以前只有 `.env` 的用户不需要迁移。缺少 `--config` 时，原有环境配置继续生效。升级包文件与迁移用户数据也是两个动作：重新安装 npm 包不会替换用户的连接文件和会话目录。

## 为什么恢复旧会话不会重放旧工具？

会话读取器先按编号检查记录，再恢复用户消息、模型响应和工具结果。工具执行入口只消费这轮新模型响应里的调用列表，恢复器没有把历史调用放进这个入口。于是旧 `run_command` 可以继续作为模型的上下文，但不会在 `--resume` 时自行启动。

我们用旧版保存器真的写出 v1 会话，里面放入一次会创建标记文件的历史命令；然后从新版本执行恢复，并立即结束输入。验收要同时看到“恢复成功”、没有模型请求、标记文件没有出现。只看最终回答里的“未执行”不足以证明这一点。

若旧工具在进程退出前已产生副作用、却未能保存结果，恢复后仍只能知道结果不确定。升级不能凭空补出事实，应先检查工作区或外部状态。会话中的旧结果也不保证当前文件仍相同；新任务需要时仍应重新读取。

<!-- media:lesson:start -->
配置先验证、保存原件和临时 v2，rename 成功才提交；清理失败可能留锁，不回滚已提交的 v2。旧会话只恢复事实，不重放工具。

<img src="./content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-cover-ed978d9058.png" data-gif-src="./content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-d848f35e2e.gif" data-cover="./content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-cover-ed978d9058.png" data-no-zoom alt="配置怎样安全换格式，旧会话怎样继续用？">

[静态流程图](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-flow-cb895bc5ab.png.md) · [静态封面](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-cover-ed978d9058.png.md) · [查看完整静态分镜](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/assets/config-rename-session-facts-storyboard-036eb500cb.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- changes:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/config/connection-profile.ts](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/src/config/connection-profile.ts.md) | 读取有效 v2，旧 v1 提示显式迁移，未知版本拒绝 |
| 新增 | [src/config/migrate-config.ts](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/src/config/migrate-config.ts.md) | 验证后排他备份，准备同目录新文件，最后替换目标 |
| 修改 | [src/cli.ts](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/src/cli.ts.md) | 接入 migrate-config 并加入补全候选 |
<!-- changes:end -->

## 动手构建

从 36.2 继续，替换连接配置读取器，加入迁移命令。会话读取、Agent Loop 和权限策略保持原有实现；我们用验收证明兼容，而不是另写一套会话重放逻辑。

<!-- source:start -->

<!-- build-file: src/config/connection-profile.ts -->
<details>
<summary>src/config/connection-profile.ts 完整文件</summary>

```typescript
/**
 * 36.3 配置与会话升级 | [CHANGED] config/connection-profile.ts
 *
 * 学习目标：让显式的非凭据连接配置进入已有的环境配置合并过程。
 * 输入：用户明确提供的 JSON 路径；输出：通过校验的连接选项。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   普通文件 -> 限制大小 -> 解析版本与字段 -> 安全连接选项 / 拒绝
 * 状态：只读取，不创建 SDK、不写配置；失败不会回显原文。
 * 观察：--config 不提供时，仍只有原先环境配置；密钥不允许写进 JSON。
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { UserFacingError } from "../errors.js";

// [KEEP 来自 36.1] 配置文件只有连接字段，不接受凭据或未来未知字段。
export type ConnectionProfile = { provider: "openai" | "anthropic"; model: string; baseUrl?: string };

/**
 * 读取不超过 64 KiB 的普通配置文件，拒绝符号链接和特殊文件。
 * 使用打开后的文件描述符检查大小，错误只给固定说明；不打印路径或原文。
 */
export function readProfileText(path: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65_536) throw new Error("invalid profile");
    // 多读一个字节即可判断超额；并发增长也不会触发无界读入。
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > 65_536) throw new Error("profile grew");
    return buffer.subarray(0, length).toString("utf8");
  } catch {
    throw new UserFacingError("无法读取连接配置：需要不超过 64 KiB 的普通 JSON 文件，不能使用符号链接。");
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** 将 JSON 解为对象；解析异常中可能含配置原文，因此不转发原始错误。 */
export function parseProfile(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch { throw new UserFacingError("连接配置不是有效的 JSON 对象。"); }
}

/**
 * 校验一个已知连接对象；只接受两个协议、非空模型和安全基础地址。
 * baseUrl 不允许凭据、查询或片段；未知字段包括误填的 apiKey，全部拒绝。
 */
export function validateConnection(value: Record<string, unknown>, allowed: string[]): ConnectionProfile {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new UserFacingError("连接配置包含未知字段；请删除密钥及未支持的设置。");
  if (value.provider !== "openai" && value.provider !== "anthropic") throw new UserFacingError("连接配置 provider 只能是 openai 或 anthropic。");
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 256 || /[\r\n\0]/.test(value.model)) throw new UserFacingError("连接配置需要非空且不超过 256 字符的模型 ID。");
  let baseUrl: string | undefined;
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== "string" || !value.baseUrl.trim() || value.baseUrl.length > 2048) throw new UserFacingError("连接配置 baseUrl 无效。");
    baseUrl = value.baseUrl.trim();
    let url: URL;
    try { url = new URL(baseUrl); } catch { throw new UserFacingError("连接配置 baseUrl 无效。"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new UserFacingError("连接配置 baseUrl 只能是没有凭据、查询和片段的 HTTP(S) 地址。");
  }
  return { provider: value.provider, model: value.model.trim(), ...(baseUrl ? { baseUrl } : {}) };
}

// [CHANGED 36.3] v2 只接受明确的顶层结构，迁移器与启动读取器共用校验。
/** 校验已知 v2 的连接对象，不接受未来未知顶层设置或凭据字段。 */
export function validateProfileV2(value: Record<string, unknown>): ConnectionProfile {
  if (value.version !== 2 || Object.keys(value).some(key => !["version", "connection"].includes(key))) throw new UserFacingError("连接配置不是受支持的 v2 结构。");
  const connection = value.connection;
  if (!connection || typeof connection !== "object" || Array.isArray(connection)) throw new UserFacingError("连接配置 v2 需要 connection 对象。");
  return validateConnection(connection as Record<string, unknown>, ["provider", "model", "baseUrl"]);
}

/** 只读取有效 v2；旧格式提示显式迁移，不在普通启动中写配置。 */
export function readConnectionProfile(path: string | undefined): Partial<ConnectionProfile> {
  if (path === undefined) return {};
  const value = parseProfile(readProfileText(path));
  if (value.version === 1) throw new UserFacingError("连接配置是 v1，请先运行 migrate-config <路径>。");
  if (value.version !== 2) throw new UserFacingError("连接配置版本不支持，不能读取未知新格式。");
  return validateProfileV2(value);
}
```

</details>

<!-- build-file: src/config/migrate-config.ts -->
<details>
<summary>src/config/migrate-config.ts 完整文件</summary>

```typescript
/**
 * 36.3 配置与会话升级 | [NEW] config/migrate-config.ts
 *
 * 学习目标：只迁移已知格式，在替换之前保留经验证的旧内容。
 * 输入：显式连接配置路径；输出：迁移成功 / 已是 v2，失败只给固定原因。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   验证 v1 -> 取得锁 -> 比较原文 -> 独占备份 -> 写同目录临时文件
 *   -> 再比较原文 -> rename -> 清理锁；v2 已有效 -> 无写入返回
 * 状态：备份排他创建，不覆盖已有备份；失败可能留下备份，不删除用户原件。
 * 边界：锁只约束本命令；外部编辑器和突然断电没有跨文件事务保证。
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import { parseProfile, readProfileText, validateConnection, validateProfileV2 } from "./connection-profile.js";

// [NEW 36.3] 使用 wx 和 0600，避免覆盖已有备份，也不继承原件的宽松权限。
/** 写入一个尚不存在的私有文件并同步文件内容；失败由调用方决定保留哪些产物。 */
function writePrivate(path: string, content: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  try { writeFileSync(descriptor, content, "utf8"); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

/**
 * 显式将本章的 v1 连接文件迁移到 v2，返回 true 表示本次替换成功。
 * 先校验后写入；已是有效 v2 时不写备份；未知版本不能猜测或降级。
 * 锁与替换前的原文比较减少合作进程和编辑冲突，不提供对外部写入者的完整隔离。
 */
export function migrateConfig(inputPath: string | undefined): boolean {
  if (!inputPath) throw new UserFacingError("用法：hello-my-agent migrate-config <连接配置路径>。");
  const path = resolve(inputPath);
  const original = readProfileText(path), value = parseProfile(original);
  if (value.version === 2) { validateProfileV2(value); return false; }
  if (value.version !== 1) throw new UserFacingError("连接配置版本不支持，不能迁移未知格式。");
  const connection = validateConnection(value, ["version", "provider", "model", "baseUrl"]);
  const next = `${JSON.stringify({ version: 2, connection }, null, 2)}\n`;
  const lock = `${path}.migrate.lock`, backup = `${path}.v1.bak`;
  const temporary = `${path}.migrate-${randomUUID()}.tmp`;
  let locked = false, createdTemporary = false;
  try {
    try { writePrivate(lock, "migration in progress\n"); locked = true; }
    catch { throw new UserFacingError("无法取得迁移锁；请确认没有其他迁移进程，且目录可写。"); }
    if (readProfileText(path) !== original) throw new UserFacingError("连接配置已变化，迁移停止；请核对原件后再操作。");
    try { writePrivate(backup, original); }
    catch { throw new UserFacingError("无法建立私有备份；已有 .v1.bak 不会被覆盖，请先核对。"); }
    // 先记住临时路径的所有权；随机路径只由这次命令创建。
    createdTemporary = true;
    writePrivate(temporary, next);
    if (readProfileText(path) !== original) throw new UserFacingError("替换前发现配置被修改，已停止；请核对原件和备份。");
    renameSync(temporary, path);
    createdTemporary = false;
    return true;
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("迁移未完成；请保留并核对连接配置与 .v1.bak，确认目录权限后再处理。");
  } finally {
    if (createdTemporary) { try { unlinkSync(temporary); } catch { /* 失败产物留待用户核对。 */ } }
    if (locked) { try { unlinkSync(lock); } catch { /* 异常遗留锁需要用户确认后处理。 */ } }
  }
}
```

</details>

<!-- build-file: src/cli.ts -->
<details>
<summary>src/cli.ts 完整文件</summary>

```typescript
#!/usr/bin/env node
/**
 * 36.3 配置与会话升级 | [CHANGED] cli.ts
 *
 * 学习目标：保留原有 CLI 装配与本地管理，所有自有任务结束后释放共享隔离资源。
 * 输入：模型选项与本地管理选项；--sandbox-info/check 在模型配置前独占处理。
 * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
 * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 30.1] argv[2]=schedule？-- 是 -> 独立定时管理 -> 结束；否 -> 普通聊天入口
 *   显式网页/搜索选项且非 Plan？-- 是 -> 完整校验本地配置 -> 创建 WebState；否 -> 不启用网页
 *   配置失败 -> 启动错误；配置成功只装配工具，不提前抓取或查询
 *   [KEEP 来自 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
 *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 只把名称/用途交给模型和启动信息
 *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
 *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
 *                            +-- 是 -> 继续检查运行方式
 *   [KEEP] auto？-- 是 -> 无 --prompt 且 stdin/stdout 为 TTY、TERM 非 dumb？
 *                     是 -> tui；否 -> text
 *                +-- 否 -> 保留显式选择
 *   tui？-- 是 -> stdin/stdout 为 TTY、TERM 非 dumb，且没有 --prompt？
 *                否 -> 抛错；是 -> 读取配置、创建模型 -> 动态载入 app -> startTui
 *        +-- 否 -> jsonl 但缺少 --prompt？-- 是 -> 抛错
 *                                          +-- 否 -> 读取配置、创建模型
 *   [KEEP 来自 13.1] text / tui -> 创建新会话文件、显示 ID 和路径 -> 消费者 -> finally close
 *   非 TUI 分支 -> 无 --prompt？-- 是 -> startTerminal
 *                              +-- 否 -> 内容为空？-- 是 -> 抛错
 *                                                  +-- 否 -> jsonl / text 单次消费者
 *   运行抛错 -> explainError -> stderr、exit 1；单次用户取消由消费者设 exit 130
 *
 * auto 在没有 --prompt、stdin/stdout 都是 TTY 且 TERM 不是 dumb 时选择 tui，其余选择 text。
 * TUI 只接受连续输入，单次任务继续用 text 或 jsonl；JSONL 必须同时给 --prompt。
 * 动态 import 只在 tui 分支载入 React / Ink，脚本模式不需要初始化终端界面。
 * --help、--version 不读取模型配置；--doctor 只做本地校验，不创建SDK或联网。
 *
 * [KEEP 来自 12.1] --mode plan|execute 在创建模型前校验，再传给每种消费者。
 * [KEEP 来自 12.2] 非 TUI 入口为当前会话准备共用清单；TUI 在 startTui 内创建自己的清单。
 * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
 */
// [KEEP 来自 31.3] 无需密钥的管理入口及显式启动、退出收尾。


// [KEEP 来自 18.1] 本地记忆动作在模型配置与会话创建前完成。
// [KEEP 来自 20.1] 项目脚本必须由本次启动显式启用。
// [KEEP 来自 21.1] 显式配置授权启动服务，退出始终关闭本次连接。
// [KEEP 来自 22.1] 网络开关不读取网页或会话里的指令。
// [KEEP 来自 36.1] 本地交付入口先于模型配置。
import { completionScript } from "./release/completion.js";
// [KEEP 来自 36.2] 本地核对打包清单。
import { checkPackage } from "./release/check-package.js";
// [NEW 36.3] 用户显式选择时迁移连接配置。
import { migrateConfig } from "./config/migrate-config.js";
import { closeSandbox } from "./sandbox/runtime.js";
import { sandboxInfo, runSandboxCheck, formatSandboxReport } from "./sandbox/diagnostics.js";
import { runCodeCommand } from "./code-command.js";
import { loadWeb } from "./web/client.js";
import { runScheduleCommand } from "./schedules/commands.js";
import { ExtensionManager } from "./extensions/manager.js";
import { extensionCommand } from "./extensions/commands.js";
import { connectMcp, mcpInfo } from "./mcp/client.js";
import { loadHooks } from "./hooks/lifecycle.js";
// [KEEP 来自 19.1] 固定项目目录发现元信息，不加载正文。
import { discoverSkills, skillInfo } from "./skills/catalog.js";
import { createMemoryController, memoryCommand } from "./memory/commands.js";
import { findProjectRoot } from "./project/instructions.js";
import { dirname } from "node:path";
// [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
import { readFileSync } from "node:fs";
// [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
import { forkSessionWriter } from "./sessions/fork-session.js";
import { realpath } from "node:fs/promises";
import { Command } from "commander";
// [KEEP 来自 35.1] 评测先于普通模型配置，只在自建样本中执行。
import { runEvaluationCommand } from "./evaluation/command.js";
// [KEEP 来自 34.3] doctor只复用本地校验，不创建SDK或任何执行资源。
import { diagnoseConfiguration } from "./diagnostics/config.js";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import type { ExecutionMode, RunOptions } from "./agent/run-options.js";
// [KEEP 来自 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";
// [KEEP 来自 13.1] 入口创建并最终关闭 writer，模型配置不进入存储模块。
import { createSessionWriter, resumeSessionWriter } from "./sessions/save-session.js";
// [KEEP 来自 13.4] 本地管理复用读取与写入协议，无需模型配置。
import { listSessions, renameSession, exportSession } from "./sessions/manage-sessions.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自 34.3] 保留环境三项检查，并追加本地配置校验。
/**
 * 显示运行环境并校验本地模型配置；不发网络请求。
 *
 * - 输入：本次启动的模型选项；版本、平台、架构和工作目录来自 Node.js 的 `process`。
 * - 输出：向终端打印环境与安全配置状态，不打印配置值。
 * - 关键原因：诊断捕获缺项，只给本地说明；缺少 API Key 时也能运行。
 * - 职责边界：读取并校验 `.env`；不创建模型客户端，也不发送网络请求。
 */
function printDoctor(options: Options): void {
  // [KEEP 来自 34.3] 只返回白名单结果，绝不打印配置对象。
  for (const line of diagnoseConfiguration(options)) console.log(line);
}
// [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
// [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
type CliOptions = Options & { evaluate?: string; evaluationDir?: string; quiet?: boolean; idleTimeout?: string; sandboxInfo?: boolean; sandboxCheck?: boolean; extension?: string[]; enableExtension?: string[]; enableProjectHooks?: boolean; mcpConfig?: string; mcpInfo?: boolean; enableWeb?: boolean; webSearchConfig?: string;  memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自 34.3] --doctor 捕获配置缺项后直接结束，没有 API Key 也能使用。
  // [KEEP 来自 20.1] 仅这次启动授权项目生命周期脚本；恢复会话不恢复启用状态。
  // [KEEP 来自 21.1] 不自动读取仓库中的MCP启动命令。
  // [KEEP 来自 22.1] 启用仅注册，真正GET仍逐次审批。
  // [KEEP 来自 22.2] 提供配置也明确启用网页工具；无提供方不注册web_search。
  .option("--web-search-config <path>", "配置JSON GET搜索提供方(endpoint/queryParam/tokenEnv)")
  .option("--enable-web", "明确启用逐次审批的网页抓取工具")
  .option("--extension <command...>", "本地扩展管理：list/install/diagnose/uninstall，无需模型密钥")
  .option("--enable-extension <id...>", "仅本进程明确启用列出的已安装扩展；可能启动脚本和服务")
  .option("--mcp-config <path>", "明确启用指定MCP配置（会启动或连接其中的服务）")
  .option("--mcp-info", "连接、发现并诊断指定MCP配置后退出，无需模型密钥")
  .option("--enable-project-hooks", "明确启用项目 .hello-my-agent/hooks.json 中的脚本")
  // [KEEP 来自 35.3] 评测入口先校验互斥动作，只有明确live才读取凭据。
  // [KEEP 来自 35.3] 帮助明确列出需显式选择的live评测。
  .option("--evaluate <suite>", "固定任务评测：offline、regression、live")
  .option("--evaluation-dir <path>", "固定任务与报告保存目录")
  .option("--sandbox-info", "显示隔离依赖、规则和实际通道范围，不执行边界实验")
  .option("--sandbox-check", "用临时样本主动验证真实文件与网络限制")
  // [KEEP 来自 34.3] 简洁只改变text呈现；沉默上限传给共同runtime。
  .option("--quiet", "text只显示正文、审批、失败与诊断位置")
  .option("--idle-timeout <seconds>", "无进展上限秒数（1—3600，默认90）")
  .option("--doctor", "显示环境并静态检查模型配置，不联网")
  // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
  .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
  // [KEEP 来自 18.1] 显式管理命令无需API Key。
  .option("--memory <command>", "本地项目记忆：list、show <id>、add <正文>、edit <id> <正文>、invalidate <id> <理由>、delete <id>")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  // [KEEP 来自 36.1] 不自动发现连接文件，凭据继续从环境读取。
  .option("--config <path>", "明确读取带版本的非凭据连接 JSON")
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 10.4] 默认值改为 auto；显式 text、tui、jsonl 仍由用户选择。
  .option("--output <format>", "输出格式：auto、tui、text 或 jsonl", "auto")
  // [KEEP 来自 12.1] 增加启动模式选项，默认 execute。
  .option("--mode <mode>", "模式：plan 或 execute（新会话默认 execute，恢复沿用已保存模式）")
  // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
  .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
  // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
  // [KEEP 来自 14.1] fork 创建新身份；resume 继续旧身份。
  .option("--fork <id>", "从指定会话的最后完整状态创建新分支，不重放工具")
  .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
  .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
  // [KEEP 来自 13.4] 显式管理动作在读取模型配置前完成。
  .option("--sessions", "列出本地会话，可配合 --search")
  .option("--search <text>", "在会话 ID、名称、工作区和已保存消息中搜索")
  .option("--rename <id>", "给指定会话追加名称，需要 --name")
  .option("--name <text>", "会话名称，1—80 个字符")
  .option("--export <id>", "将指定会话导出为 Markdown，默认输出到 stdout")
  .option("--export-to <path>", "导出到一个尚不存在的文件，需要 --export")
  // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    // [KEEP 来自 35.1] 独占分支在任何模型、扩展、服务创建之前结束。
    if (options.evaluate !== undefined) { await runEvaluationCommand(options); return; }
    if (options.evaluationDir !== undefined) throw new UserFacingError("--evaluation-dir 需要 --evaluate。");
    // [KEEP 来自 33.3] 独占管理分支在模型、扩展和服务连接之前结束；不需要模型凭据。
    if (options.sandboxInfo || options.sandboxCheck) {
      const allowed = new Set(["output", options.sandboxInfo ? "sandboxInfo" : "sandboxCheck"]);
      if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
          && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
        throw new UserFacingError("--sandbox-info 与 --sandbox-check 请分别单独使用。");
      }
      if (options.sandboxInfo) {
        const info = await sandboxInfo(findProjectRoot()); console.log(info.text);
        if (!info.available) process.exitCode = 1;
      } else {
        const report = await runSandboxCheck(); console.log(formatSandboxReport(report));
        if (!report.passed) process.exitCode = 1;
      }
      return;
    }
    // [KEEP 来自 18.1] 管理动作拒绝混用提问、会话和连接选项；Plan只可查询。
    if (options.memory !== undefined) {
      if (options.prompt !== undefined || options.projectInfo || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.output !== "auto" || options.sessionDir !== undefined || options.resume !== undefined || options.recover
        || options.fork !== undefined || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--memory请单独使用，可配合--mode plan查询。");
      if (!["execute", "plan"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode只能是plan或execute。");
      console.log(await memoryCommand(findProjectRoot(), options.memory, options.mode as ExecutionMode | undefined));
      return;
    }
    // [KEEP 来自 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
    if (options.projectInfo) {
      if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
        || options.sessionDir !== undefined || options.resume !== undefined || options.recover || options.fork !== undefined
        || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--project-info 请单独使用，不与提问、模型、模式、会话或输出选项混用。 ");
      const project = await loadProjectInstructions();
      for (const line of projectInstructionInfo(project)) console.log(line);
      return;
    }
    // [KEEP 来自 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
    const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
    if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
    if (options.search !== undefined && !options.sessions) throw new UserFacingError("--search 必须与 --sessions 一起使用。");
    if (options.name !== undefined && options.rename === undefined) throw new UserFacingError("--name 必须与 --rename <id> 一起使用。");
    if (options.exportTo !== undefined && options.export === undefined) throw new UserFacingError("--export-to 必须与 --export <id> 一起使用。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (management) {
      if (options.fork !== undefined || options.resume !== undefined || options.recover || options.prompt !== undefined || options.doctor
        || options.mode !== undefined || options.model !== undefined || options.provider !== undefined || options.baseUrl !== undefined || options.output !== "auto") {
        throw new UserFacingError("本地会话管理请单独使用，不与恢复、提问、模型或输出模式选项混用。");
      }
      if (options.sessions) {
        const result = await listSessions(options.sessionDir, options.search);
        for (const warning of result.warnings) console.error(`会话提示：${warning}`);
        if (!result.sessions.length) console.log("没有匹配的本地会话。");
        for (const session of result.sessions) console.log(`${session.id}  ${session.name}\n  ${session.updatedAt} · ${session.messages} 条消息 · ${session.pending} 条待交付${session.interrupted ? " · 上次中断" : ""}\n  ${session.cwd}`);
      } else if (options.rename !== undefined) {
        if (options.name === undefined) throw new UserFacingError("--rename <id> 需要 --name <text>。");
        const seq = await renameSession(options.rename, options.name, options.sessionDir);
        console.log(`名称已保存：${options.rename} · 第 ${seq} 条记录。`);
      } else {
        const markdown = await exportSession(options.export!, options.sessionDir, options.exportTo);
        if (options.exportTo === undefined) process.stdout.write(markdown);
        else console.log(`已导出：${options.exportTo}`);
      }
      return;
    }
    // [KEEP 来自 21.1] 本地诊断在readConfig前完成，不需要模型凭据。
    if (options.mcpInfo) {
      if (!options.mcpConfig) throw new UserFacingError("--mcp-info 需要 --mcp-config <path>。");
      const mcp = await connectConfiguredMcp(options.mcpConfig, findProjectRoot());
      try { for (const line of mcpInfo(mcp)) console.log(line); } finally { await mcp?.close(); }
      return;
    }
    // [KEEP 来自 31.1] 本地安装与诊断无需模型凭据，完成后一定关闭管理器。
    if (options.extension) {
      if (options.enableExtension || options.prompt || options.resume || options.fork || options.mcpConfig || options.enableProjectHooks) throw new UserFacingError("--extension 不与运行或其他能力启用参数混用。");
      if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
      if (options.extension[0] === "enable") throw new UserFacingError("独立管理命令不保留进程；请用 --enable-extension <id...> 启动，或在会话中 /extension enable <id>。");
      const root = findProjectRoot(), manager = new ExtensionManager(root, await discoverSkills(root));
      const controller = new AbortController(), cancel = () => controller.abort(new UserFacingError("扩展操作已取消。"));
      process.once("SIGINT", cancel);
      try { console.log(await extensionCommand(options.extension, manager, options.mode ?? "execute", controller.signal)); }
      finally { process.removeListener("SIGINT", cancel); await manager.close(); }
      return;
    }
    if (options.doctor) {
      printDoctor(options);
      return;
    }
    // [KEEP 来自 12.1] 创建模型前检查模式，非法值不会启动任务。
    if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
    let mode: ExecutionMode = options.mode === "plan" ? "plan" : "execute";
    // [KEEP 来自 12.1] 把启动模式传到 text、JSONL 和连续会话入口。
    // [KEEP 来自 12.2] 非 TUI 入口创建共用清单；TUI 在自己的会话内创建。
    // [KEEP 来自 34.3] 严格秒数校验发生在模型与会话创建前。
    const idleTimeout = options.idleTimeout ?? "90";
    if (!/^[1-9]\d*$/.test(idleTimeout) || Number(idleTimeout) > 3600) throw new UserFacingError("--idle-timeout 必须为 1 至 3600 的整数秒。");
    if (options.quiet && options.output !== "auto" && options.output !== "text") throw new UserFacingError("--quiet 只支持 text 输出。");
    if (options.quiet) options.output = "text";
    const runOptions: RunOptions = { mode, tasks: { items: [] }, quiet: options.quiet, noProgressTimeoutMs: Number(idleTimeout) * 1000 };
    // [KEEP 来自 10.4] 校验允许 auto，下一步再把它解析成具体消费者。
    if (!["auto", "tui", "text", "jsonl"].includes(options.output ?? "auto")) throw new UserFacingError("--output 只能是 auto、tui、text 或 jsonl。");
    // [KEEP 来自 10.4] 只在真实终端的连续会话中自动选择 TUI；--prompt 和管道默认仍用文本。
    if (options.output === "auto") options.output = options.prompt === undefined
      && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb" ? "tui" : "text";
    // [KEEP 来自 10.1] 只有真实终端才能把按键交给 Ink；单次问题继续使用已有输出模式。
    if (options.output === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === "dumb")) {
      throw new UserFacingError("TUI 需要交互终端，请使用 --output text 或 --output jsonl --prompt 提问。");
    }
    if (options.output === "tui" && options.prompt !== undefined) throw new UserFacingError("TUI 使用连续输入；单次提问请使用 --output text 或 jsonl。");
    if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
    // [KEEP 来自 13.1] 在创建模型和文件前拒绝不支持的组合与空问题。
    if (options.output === "jsonl" && options.sessionDir !== undefined) throw new UserFacingError("--session-dir 只支持 text 或 tui；JSONL 机器输出暂不保存会话。");
    if (options.recover && options.resume === undefined) throw new UserFacingError("--recover 必须与 --resume <id> 一起使用。");
    if (options.resume !== undefined && options.output === "jsonl") throw new UserFacingError("会话恢复只支持 text 或 tui。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
    if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
    // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
    if (options.enableExtension?.length && (mode === "plan" || options.resume || options.fork)) throw new UserFacingError("启动启用扩展仅支持新的execute会话；恢复后请在本地明确启用。");
    const project = await loadProjectInstructions();
    const config = readConfig(options);
    // [KEEP 来自 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
    const memory = await createMemoryController(project.root);
    const skills = await discoverSkills(project.root);
    // [KEEP 来自 20.1] Plan不读取/运行钩子；执行模式没有显式开关也不读取。
    const hooks = await loadHooks(project.root, Boolean(options.enableProjectHooks) && mode !== "plan");
    // [KEEP 来自 21.1] Plan不启动本地服务；恢复与新启动都必须再次显式选择。
    const mcp = mode === "plan" ? undefined : await connectConfiguredMcp(options.mcpConfig, project.root);
    const extensions = new ExtensionManager(project.root, skills, hooks, mcp);
    let model: ReturnType<typeof createModel> | undefined;
    try {
    // [KEEP 来自 31.2] 启动显式启用也接收Ctrl+C；只在资源收尾后离开初始化阶段。
    const extensionAbort = new AbortController(), cancelExtension = () => extensionAbort.abort(new UserFacingError("扩展初始化已取消。"));
    process.once("SIGINT", cancelExtension);
    try { for (const id of options.enableExtension ?? []) console.error(await extensions.enable(id, mode, extensionAbort.signal)); }
    finally { process.removeListener("SIGINT", cancelExtension); }
    const web = mode === "plan" ? undefined : await loadWeb(Boolean(options.enableWeb), options.webSearchConfig);
    model = createModel(config, project, memory, skills, extensions.hooks, extensions.mcp, web, extensions);
    for (const line of mcpInfo(model.mcp)) console.error(line);
    for (const line of skillInfo(skills)) console.error(line);
    for (const line of projectInstructionInfo(project)) console.error(line);
    // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
    if (options.output === "jsonl") {
      await runJsonlPrompt(model, options.prompt!, runOptions);
      return;
    }
    // [KEEP 来自 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
    const writer = options.fork !== undefined
      ? await forkSessionWriter(options.fork, options.sessionDir)
      : options.resume !== undefined
      ? await resumeSessionWriter(options.resume, options.sessionDir, options.recover)
      : await createSessionWriter(options.sessionDir);
    // [KEEP 来自 14.2] 文件恢复数据与会话同属一个身份，分支自动使用新的目录。
    runOptions.fileCheckpoints = createFileCheckpointStore(writer.id, dirname(writer.path));
    console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
    try {
      // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
      const restored = writer.restored;
      const initial = restored?.state;
      if (restored) {
        const workspace = restored.header.workspace ?? await realpath(restored.header.cwd);
        if (workspace !== await realpath(process.cwd())) throw new UserFacingError(`工作区不同：请先进入 ${restored.header.cwd} 再恢复，当前目录不会执行旧任务。`);
        for (const warning of restored.warnings) console.error(`恢复提示：${warning}`);
        console.error(`已恢复 ${initial?.messages.length ?? 0} 条消息；等待新要求，不重放旧工具；本进程权限需重新确认。`);
        if (initial?.pendingInputs.length) console.error(`保留 ${initial.pendingInputs.length} 条旧补充；不会自动交给新任务，请在 TUI 队列中明确选择发送。`);
      }
      mode = (options.mode ?? initial?.mode ?? "execute") as ExecutionMode;
      runOptions.mode = mode;
      if (options.prompt === undefined) {
        // [KEEP 来自 10.1] 选择 TUI 时才载入 React / Ink，不让脚本模式初始化界面。
        if (options.output === "tui") {
          const { startTui } = await import("./ui/tui/app.js");
          // [KEEP 来自 13.1] 会话 writer 与启动模式一起交给 TUI，授权仍由 TUI 保存在内存。
          // [KEEP 来自 34.3] TUI也接受同一个本地超时选项，不依赖默认值碰巧一致。
          await startTui(model, mode, writer, initial, runOptions.fileCheckpoints, runOptions.noProgressTimeoutMs);
        } else await startTerminal(model, runOptions, writer, initial);
      } else await runSinglePrompt(model, options.prompt, runOptions, writer, initial);
    } finally {
      // [KEEP 来自 13.1] 消费者先等任务和最后检查点；即使保存失败，这里仍关闭句柄。
      await writer.close();
    }
    // [KEEP 来自 26.1] 退出等待自有作业清理；即使close失败也关闭MCP。
    } finally { try { await model?.jobs?.close(); } finally { try { await model?.languageService?.close(); } finally { try { await extensions.close(); } finally { await mcp?.close(); } } } }
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  // [KEEP 来自 30.3] schedule动作结束后不再进入普通聊天入口。
  if (process.argv[2] === "code") await runCodeCommand(process.argv.slice(3));
  else if (process.argv[2] === "schedule") await runScheduleCommand(process.argv.slice(3));
  // [CHANGED 36.3] 静态补全与文件管理不创建 SDK，也不发送请求。
  else if (process.argv[2] === "completion") {
    if (process.argv.length !== 4) throw new UserFacingError("用法：hello-my-agent completion bash|zsh。");
    console.log(completionScript(process.argv[3], program.options.flatMap(option => [option.short, option.long]).filter((flag): flag is string => typeof flag === "string"), ["code", "schedule", "completion", "release-check", "migrate-config"]));
  }
  else if (process.argv[2] === "release-check") {
    if (process.argv.length !== 4) throw new UserFacingError("用法：hello-my-agent release-check <pack.json>。");
    console.log(`包内容检查通过：${checkPackage(process.argv[3], packageJson)} 个文件。`);
  }
  else if (process.argv[2] === "migrate-config") {
    if (process.argv.length !== 4) throw new UserFacingError("用法：hello-my-agent migrate-config <连接配置路径>。");
    console.log(migrateConfig(process.argv[3]) ? "连接配置已迁移到 v2，旧内容保存在 .v1.bak。" : "连接配置已经是有效 v2，无需迁移。");
  }
  else await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
} finally {
  // [KEEP 来自 33.1] parseAsync 已等待各入口和自有作业收尾，最后释放共享隔离资源。
  try { await closeSandbox(); }
  catch (error) { console.error(`隔离清理失败：${explainError(error)}`); process.exitCode = 1; }
}

/**
 * [KEEP 来自 21.1] 让启动时的 Ctrl+C 也能停止正在建立的 MCP 连接。
 * 输入是本地配置路径与已确定的项目根；取消信号交给连接器，等待它关闭已启动的服务。
 * 无论连接成功、失败还是取消，最后都移除本次 SIGINT 监听，避免影响之后的任务。
 */
async function connectConfiguredMcp(path: string | undefined, root: string) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("MCP初始化已取消。"));
  process.once("SIGINT", cancel);
  try { return await connectMcp(path, root, controller.signal); }
  finally { process.removeListener("SIGINT", cancel); }
}
```

</details>

<!-- source:end -->

```bash
npm run lesson:36.3
```

```bash
hello-my-agent migrate-config ./connection.json
hello-my-agent --config ./connection.json --doctor
```

迁移后的文件应是：

```json
{"version":2,"connection":{"provider":"openai","model":"your-model-id"}}
```

## 运行验证

先保存一份合法 v1 文件，执行迁移后检查 v2 字段与 `.v1.bak` 原文。再执行一次，应该无需迁移，备份不变。将另一个文件的版本改成 99，应拒绝且保留原文；预先创建 `.v1.bak`，也应停止而不覆盖任何文件。

```bash
npm run check:36
```

恢复自己的旧会话时，仍需在原工作区使用已有编号：

```bash
hello-my-agent --resume <会话编号>
```

应先显示恢复信息并等待输入，权限批准也不会从旧进程继承。恢复失败时保留旧会话；不要为了让检查通过而直接改掉记录的版本号或删除错误结果。

## 本节完成后的 Agent

安装包、程序版本、连接配置版本和会话记录版本已经各有边界。我们能显式迁移已知格式、保留原件、拒绝未知格式，并用真实恢复验证旧工具不会被自动重放。课程到这里形成了从命令入口、运行内核到安装交付的一条完整路径。
