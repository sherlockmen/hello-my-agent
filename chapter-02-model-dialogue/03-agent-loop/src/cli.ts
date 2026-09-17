#!/usr/bin/env node

/**
 * 02.3 建立 Agent Loop 核心 | [CHANGED] cli.ts
 *
 * 学习目标：让 CLI 只处理参数和显示，把一轮 Agent 执行交给 agentLoop()。
 * 输入：--prompt、模型配置和取消信号。
 * 输出：成功时打印 agentLoop() 返回的回答；失败时显示安全提示。
 *
 * 执行流程：
 *   +----------+   +------------+   +-------------+   +-----------+
 *   | --prompt |-->| readConfig |-->| createModel |-->| agentLoop |
 *   +----------+   +------------+   +-------------+   +-----+-----+
 *                                                            | 失败 --> 显示错误 --> exit 1
 *                                                            | 成功 --> 打印回答 --> exit 0
 *
 * 关键点：CLI 不再组装消息或修改历史。以后增加工具时，命令入口不需要承担 Agent 调度。
 * 交互终端中的 Agent 标签使用紫色；管道和文件输出保持纯文本。
 * 运行观察：终端效果与 02.2 相同，但执行职责已经移入 agent/agent-loop.ts。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import { agentLoop } from "./agent/agent-loop.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
// --prompt 从 02.2 引入；配置类型只管理模型配置，不混入本次提问。
type CliOptions = Options & { prompt?: string };
const program = new Command();
// 只在交互终端中加入 ANSI 颜色；重定向到文件或管道时保留纯文本。
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;
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
  // [CHANGED 02.3] 把本轮执行交给 agentLoop；命令用法沿用上一节。
  .action(async () => {
    const options = program.opts<CliOptions>();
    const config = readConfig(options);
    const model = createModel(config);
    if (!options.prompt?.trim()) throw new UserFacingError('请使用 --prompt "你好" 提问。');
    const signal = new AbortController().signal;
    const reply = await agentLoop(model, [], options.prompt, signal);
    console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
