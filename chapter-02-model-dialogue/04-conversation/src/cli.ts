#!/usr/bin/env node

/**
 * 02.4 连续输入与会话历史 | [CHANGED] cli.ts
 *
 * 学习目标：在单次提问和连续会话之间选择正确入口。
 * 输入：可选的 --prompt、模型配置和取消信号。
 * 输出：传入 --prompt 时回答一次；没有传入时启动终端输入循环。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   --doctor --> 显示 Node、平台和启动目录 --> 结束（不读取模型配置）
 *   其他输入：
 *   +------------+   +-------------+
 *   | readConfig |-->| createModel |
 *   +------------+   +------+------+
 *                         v
 *                   有 --prompt？
 *                     | 是 --> +-----------+ --> 打印一次 --> 结束
 *                     |         | agentLoop |
 *                     |         +-----------+
 *                     | 否 --> +---------------+
 *                               | startTerminal | --> 连续输入
 *                               +---------------+
 *
 * 关键点：CLI 只选择运行模式。会话历史由终端保存，一轮消息的提交规则仍由 agentLoop() 负责。
 * 运行观察：hello-my-agent 进入连续会话；带 --prompt 时回答一次后退出。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import { agentLoop } from "./agent/agent-loop.js";
import { startTerminal, printReply } from "./ui/terminal.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自第 01 章练习] 环境诊断不读取模型配置，也不会发送模型请求。
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
  // [CHANGED 02.4] 有 --prompt 就提问一次，没有时启动连续会话。
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
    const signal = new AbortController().signal;
    const reply = await agentLoop(model, [], options.prompt, signal);
    printReply(reply);
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
