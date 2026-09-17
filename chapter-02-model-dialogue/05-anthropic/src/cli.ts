#!/usr/bin/env node

/**
 * 02.5 接入 Anthropic 接口 | [CHANGED] cli.ts
 *
 * 学习目标：增加 --provider，让同一个 Agent Loop 可以使用 OpenAI 或 Anthropic 协议。
 * 输入：provider、模型配置、可选的 --prompt。
 * 输出：创建所选协议的模型客户端，再进入单次提问或连续会话。
 *
 * 执行流程：
 *   +------------+   +------------------+
 *   | --provider |-->| readConfig       |
 *   +------------+   +--------+---------+
 *                             v
 *                        provider？
 *                     +-------+--------+
 *                     |                |
 *                   openai          anthropic
 *                     |                |
 *                     +-------+--------+
 *                             v
 *                      +-------------+ --> 单次提问 / 连续会话
 *                      | createModel |
 *                      +-------------+
 *   其他值 --> 显示错误 --> exit 1
 *
 * 关键点：入口只传递 provider，不处理两种协议的请求字段；协议转换属于 models/client.ts。
 * 运行观察：使用 --provider anthropic 切换协议，交互方式和会话历史规则不变。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import { agentLoop } from "./agent/agent-loop.js";
import { startTerminal, printReply } from "./ui/terminal.js";

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
  // [NEW 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [CHANGED 02.5] 配置决定客户端协议，后面的 Agent 调用保持不变。
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
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
