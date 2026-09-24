#!/usr/bin/env node
/**
 * 08.3 中断当前任务，继续对话 | [KEEP 来自 08.2] cli.ts
 *
 * 学习目标：让单次提问和连续会话都从终端层获得相同的审批能力。
 * 输入：provider、模型配置、可选的 --prompt。
 * 输出：普通工具显示执行过程；ask 工具先等待 y/s/n，再显示结果或拒绝。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   --doctor --> 显示运行环境 --> 结束
 *   其他输入 --> readConfig --> createModel
 *                         +-- 有 --prompt --> runSinglePrompt --> 审批 / 回答
 *                         +-- 无 --prompt --> startTerminal ----> 会话授权 / 多轮输入
 *   任一步失败 --> explainError --> 显示安全提示 --> exit 1
 *
 * 关键点：入口不保存权限；连续会话的 sessionGrants 由 ui/terminal.ts 在进程内维护。
 * 运行观察：--prompt 可批准当前操作；连续会话还可以选择 s 复用明确范围。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自第 01 章练习] 环境诊断不读取模型配置，也不会发送模型请求。
/**
 * 显示当前 Node.js 进程的最小诊断信息，不读取模型配置。
 *
 * - 输入：无显式参数；版本、平台、架构和工作目录都来自 Node.js 的 `process`。
 * - 输出：向终端依次打印 Node、Platform 和 Working directory 三行文本。
 * - 关键原因：诊断发生在 `readConfig()` 之前，因此缺少 API Key 时也能运行。
 * - 职责边界：不读取 `.env`，不创建模型客户端，也不发送网络请求。
 */
function printDoctor(): void {
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Working directory: ${process.cwd()}`);
}
// 命令入口选项在模型配置之外增加 --prompt 和 --doctor。
type CliOptions = Options & { prompt?: string; doctor?: boolean };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
  .option("--doctor", "显示当前运行环境")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 02.6] 沿用执行流程，只统一失败提示与结果显示。
  .action(async () => {
    const options = program.opts<CliOptions>();
    if (options.doctor) {
      printDoctor();
      return;
    }
    const config = readConfig(options);
    const model = createModel(config);
    if (options.prompt === undefined) {
      await startTerminal(model);
      return;
    }
    if (!options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    await runSinglePrompt(model, options.prompt);
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
}
