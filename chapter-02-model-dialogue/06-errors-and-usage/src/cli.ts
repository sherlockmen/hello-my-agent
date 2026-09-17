#!/usr/bin/env node

/**
 * 02.6 说明错误与显示用量 | [CHANGED] cli.ts
 *
 * 学习目标：让单次提问和连续会话共用错误说明与结果显示。
 * 输入：provider、模型配置、可选的 --prompt。
 * 输出：成功时显示回答和用量；失败时显示可操作且不泄露凭据的提示。
 *
 * 执行流程：
 *   +-------------+
 *   | createModel |
 *   +------+------+
 *          v
 *     有 --prompt？
 *       | 是 --> +-----------+ --> +------------+
 *       |         | agentLoop |     | printReply |
 *       |         +-----------+     +------------+
 *       | 否 --> +---------------+
 *                 | startTerminal |
 *                 +---------------+
 *   任一步失败 --> +--------------+ --> 显示安全提示 --> exit 1
 *                   | explainError |
 *                   +--------------+
 *
 * 关键点：入口负责装配和选择运行模式；错误分类在 errors.ts，用量转换在 models/client.ts。
 * 运行观察：回答后显示输入/输出 token；不同失败原因得到不同检查建议。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import { agentLoop } from "./agent/agent-loop.js";
import { startTerminal, printReply } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// --prompt 从 02.2 引入；配置类型只管理模型配置，不混入本次提问。
type CliOptions = Options & { prompt?: string };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [CHANGED 02.6] 沿用执行流程，只统一失败提示与结果显示。
  .action(async () => {
    const options = program.opts<CliOptions>();
    const config = readConfig(options);
    const model = createModel(config);
    if (options.prompt === undefined) {
      await startTerminal(model);
      return;
    }
    if (!options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    const signal = new AbortController().signal;
    const reply = await agentLoop(model, [], options.prompt, signal);
    printReply(reply);
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
}
