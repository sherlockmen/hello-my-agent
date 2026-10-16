# 36.2 上传之前，先让发布准备可重复

[本章首页](/content/chapter-36-release-and-upgrade/README.md) · [上一节：安装包](/content/chapter-36-release-and-upgrade/01-package-and-install/README.md) · [下一节：升级](/content/chapter-36-release-and-upgrade/03-config-and-session-upgrade/README.md)

## 问题：打包成功，是否就可以直接上传？

我们刚修好一个功能，构建通过，`npm pack` 也生成了文件。此时仍可能漏掉语言服务模块，带上调试资源，或者安装命令指向旧版本。打包成功只说明 npm 能生成压缩包，并不说明包里的程序已经满足交付要求。

更麻烦的是，这些检查若只存在作者记忆里，下一次发布就可能漏做。我们需要把“检查什么、什么情况必须停止”变成每次都能执行的步骤。

## 解决方案：生成同一份清单，让本地和 CI 检查它

本节增加 `release-check <pack.json>`。我们保存 `npm pack --json` 的输出，让命令核对包的身份、必须存在的入口和允许交付的路径。安装验收继续检查真正的 tarball；两者分别回答“带了什么”和“装完能做什么”。

CI 模板在提交和手工触发时执行锁文件安装、类型检查、章节回归、打包检查和临时安装。任何一步失败，任务立即失败，不继续声称“已准备发布”。CI 中没有公开上传步骤，也不需要 npm 发布凭据。

## 工作原理：一条门禁怎样阻止错误交付？

`npm pack --json` 返回的文件表来自这次打包。npm 12 以包名为键返回对象，较早版本使用数组；检查器把两种形状归一成单包列表，再核对内容，不依赖固定的数组下标。[npm 12.0.2 的官方实现](https://github.com/npm/cli/blob/v12.0.2/lib/commands/pack.js)可用于核对这一版本差异。我们要求存在 `package.json`、`README.md`、`LICENSE` 和 `dist/cli.js`；其余只接受 `dist` 下的 JavaScript 模块。路径穿越、源码文件和额外资源会失败。它检查的是文件范围，不能证明源码中没有硬编码秘密，也不能替代安装后的行为检查。

`--dry-run` 可以预览 npm 将要做的动作，但不能据此声称远端已经收下包。[npm pack 文档](https://docs.npmjs.com/cli/v12/commands/npm-pack)给出了 JSON 输出与打包行为；[npm publish 文档](https://docs.npmjs.com/cli/v12/commands/npm-publish)则区分了上传、访问级别和试运行。本课程的检查真正生成 tarball，后续验证使用这份文件。

CI 是在干净检出上再执行一次相同检查。锁文件固定 npm 安装的依赖树；`npm ci` 会在清单与锁不一致时失败。检查使用的 Node 版本仍须满足项目最低要求；本地 Node 版本、操作系统和原生依赖也应记录在发布说明中。[GitHub 的 Node 包发布教程](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages)展示了检出、设置 Node 和运行 npm 命令的衔接方式。

## 版本、标签和文章分别指向什么？

包版本标识 npm 上的一个交付物。Git 章节标签标识课程对应的源码提交。教学网站则可以继续更新排版和文章，不能用网站当前内容反推读者当时安装了哪个包。发布记录要把版本、提交、tarball 文件名与实际检查结果放在一起，后续才有依据复现。

课程源码分支仍保存原生 Markdown 与配图；Docsify 页面配置留在教学网站分支。这种分离沿用前面确定的发布方式，不要求为了 npm 包把文章从源码分支删除。

创建章节标签前先选定已经提交的快照，再从标签检出并运行该章构建。发布者在确认提交后，可以采用下面的形式；`<已确认提交>` 要换成实际提交号：

```bash
git tag -a chapter-36 <已确认提交> -m "Chapter 36 installable snapshot"
git worktree add --detach /tmp/hello-agent-chapter-36 chapter-36
```

切换到这个检出目录后运行 `npm ci`、`npm run lesson:36.3` 和 `npm run check:36`。确认标签指向正确提交后，才由发布者执行 `git push origin chapter-36`；本章不会自动创建或推送这些标签。示例中的 `chapter-36` 只是发布者准备采用的名字，不表示本仓库已经创建了这个标签，也不能给一个早于本章的提交贴上它。

<!-- media:lesson:start -->
包检查核对交付范围，安装验收核对真实行为，CI 在干净检出重复步骤；准备记录不代表已上传 npm 或已创建章节标签。

<img src="./content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-cover-0f4bea98f6.png" data-gif-src="./content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-38e4442c21.gif" data-cover="./content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-cover-0f4bea98f6.png" data-no-zoom alt="发布准备通过，究竟证明到了哪一层？">

[静态流程图](/content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-flow-0079d21356.png.md) · [静态封面](/content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-cover-0f4bea98f6.png.md) · [查看完整静态分镜](/content/chapter-36-release-and-upgrade/02-release-gates/assets/release-gates-separated-storyboard-7b06b4e5dc.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- changes:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/release/check-package.ts](/content/chapter-36-release-and-upgrade/02-release-gates/src/release/check-package.ts.md) | 只读打包清单，核对包身份、必需入口和路径白名单 |
| 修改 | [src/cli.ts](/content/chapter-36-release-and-upgrade/02-release-gates/src/cli.ts.md) | 在模型配置之前处理 release-check，并加入补全候选 |
| 新增 | [release/ci.yml](/content/chapter-36-release-and-upgrade/02-release-gates/release/ci.yml.md) | 固定版本执行相同的本地检查，作为待接入的 CI 模板 |
<!-- changes:end -->

## 动手构建

从 36.1 继续。检查器只读取打包清单，不修改 package.json，也不联网；CLI 在模型启动之前识别这个本地命令。模板保存在本节 `release/ci.yml`，要接入 GitHub Actions 时再复制到仓库 `.github/workflows/`。

<!-- source:start -->

<!-- build-file: src/release/check-package.ts -->
<details>
<summary>src/release/check-package.ts 完整文件</summary>

```typescript
/**
 * 36.2 发布门禁 | [NEW] release/check-package.ts
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

// [NEW 36.2] npm 的结构数据作为未知输入逐层检查，不信任清单里的路径。
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
```

</details>

<!-- build-file: src/cli.ts -->
<details>
<summary>src/cli.ts 完整文件</summary>

```typescript
#!/usr/bin/env node
/**
 * 36.2 发布门禁 | [CHANGED] cli.ts
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
// [NEW 36.2] 本地核对打包清单。
import { checkPackage } from "./release/check-package.js";
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
  // [CHANGED 36.2] 静态补全与文件管理不创建 SDK，也不发送请求。
  else if (process.argv[2] === "completion") {
    if (process.argv.length !== 4) throw new UserFacingError("用法：hello-my-agent completion bash|zsh。");
    console.log(completionScript(process.argv[3], program.options.flatMap(option => [option.short, option.long]).filter((flag): flag is string => typeof flag === "string"), ["code", "schedule", "completion", "release-check"]));
  }
  else if (process.argv[2] === "release-check") {
    if (process.argv.length !== 4) throw new UserFacingError("用法：hello-my-agent release-check <pack.json>。");
    console.log(`包内容检查通过：${checkPackage(process.argv[3], packageJson)} 个文件。`);
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

将下面的模板保存到本节 `release/ci.yml`。模板安装原生依赖和 Linux 隔离所需组件，再运行相同的本地检查；它尚未自动接入远端 workflow，也没有公开上传动作。Actions 与 npm 版本按本次核对固定，维护时应一并更新验证。

<!-- ci-template:start -->
```yaml
# 保存为 .github/workflows/package-check.yml 后，才会由 GitHub Actions 执行。
# 本模板仅检查，不持有发布权限，也没有 npm publish 步骤。
name: Check installable package
on:
  push:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.2'
          cache: npm
      - run: npm install --global npm@12.0.2
      - run: sudo apt-get update && sudo apt-get install -y bubblewrap socat zsh
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm rebuild node-pty --foreground-scripts
        env:
          npm_config_build_from_source: 'true'
      - run: npm run typecheck
      - run: npm run check:35
      - run: npm run check:36
      - run: mkdir -p "$RUNNER_TEMP/release"
      - run: npm pack --json --pack-destination "$RUNNER_TEMP/release" > "$RUNNER_TEMP/release/pack.json"
      - run: node dist/cli.js release-check "$RUNNER_TEMP/release/pack.json"
```
<!-- ci-template:end -->

```bash
npm run lesson:36.2
```

```bash
mkdir -p /tmp/hello-agent-release
npm pack --json --pack-destination /tmp/hello-agent-release > /tmp/hello-agent-release/pack.json
hello-my-agent release-check /tmp/hello-agent-release/pack.json
```

`npm pack` 会执行根目录的 prepack，因此最终交付时它会重新构建默认完成版；单节代码学习由 `lesson:36.2` 选择，不应把同一个 dist 同时当成两个版本。本章检查会独立编译各节，避免相互覆盖。

## 运行验证

正常清单应输出“包内容检查通过”。复制一份清单，在 files 中加入 `source/config.ts`，检查必须失败；删除 `dist/cli.js` 也必须失败。无效 JSON 只报告清单不可读取，不把整个输入原样输出。

发布准备使用以下顺序，每一步的输出都要实际核对：

```bash
npm ci --ignore-scripts
npm rebuild node-pty --foreground-scripts
npm run typecheck
npm run check:35
npm run check:36
npm pack --json --pack-destination /tmp/hello-agent-release > /tmp/hello-agent-release/pack.json
hello-my-agent release-check /tmp/hello-agent-release/pack.json
npm publish --dry-run
```

仓库保持 `private: true`，公开上传仍受这层保护。实际试运行中，当前版本 `0.1.0-dev.1` 在 npm 12 中先因未指定预发布标签 `--tag` 而停止；这次退出不能归因于 private，也不能当成公开发布准备已通过。下面的首次发布示例会明确设置正式版本 `0.1.0`，随后需要从头重做完整的发布准备，并核对每一步结果。

准备公开发布自己的包时，先选择可用包名，明确首次版本和 scoped 包的访问级别，核对清单与 tarball，再在自己的发布分支显式移除 private。确认有账户权限后才执行 `npm publish --access public`。第二次发布必须使用新的版本号；已经发布的同名同版本不能再覆盖。账户认证和 npm 当前要求由发布者按照官方提示完成，不把令牌写进配置或教程。

公开发布前后使用明确版本，避免把全局旧链接当成新包。发布者先在自己的包中设置首次版本：

```bash
npm version 0.1.0 --no-git-tag-version
```

这会同时更新清单与锁文件。先提交这次版本变更，再重新执行上面的发布准备步骤，保存这一版本生成的 tarball，并完成临时安装验收。公开上传使用刚刚验过的那个文件；下面的包名和文件名都要替换成自己实际生成的名称：

```bash
npm publish /tmp/hello-agent-release/自己的包名-0.1.0.tgz --access public
npm install --global @自己的范围/自己的包名@0.1.0
hello-my-agent --version
```

第二次发布先改成新的版本号，例如 0.1.1，再重新检查、上传和安装。安装命令需要保留本项目原生依赖的构建约定，不能把跳过脚本后尚未构建的 PTY 当成可用。

发布后安装那个明确版本，再跑一次读改测，才把“首次公开发布通过”写入记录。升级发布同样记录新旧版本、迁移结果和回退限制。本章只提供可执行的准备与验收，不虚构这两次远端发布记录。

## 本节完成后的 Agent

程序有了可重复的交付检查入口；CI 可以在上传前重复同一条路径。文件表、安装结果与远端上传是三个不同事实，发布记录开始有了明确依据。
