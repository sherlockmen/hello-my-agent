#!/usr/bin/env node

/**
 * 02.2 向模型提问一次 | [CHANGED] cli.ts
 *
 * 学习目标：接收一段非空问题，向 OpenAI 兼容接口请求一次回答，然后结束程序。
 * 输入：--prompt、模型配置和取消信号。
 * 输出：成功时打印一条回答；空问题、配置错误或请求失败时显示安全提示。
 *
 * 执行流程：
 *   +------------------+
 *   | --prompt <text>  |
 *   +--------+---------+
 *            v
 *        非空文本？ -- 否 --> 显示提示 --> exit 1
 *            | 是
 *            v
 *   +------------+   +-------------+   +----------+
 *   | readConfig |-->| createModel |-->| generate |
 *   +------------+   +-------------+   +----+-----+
 *                                          | 失败 --> 显示错误 --> exit 1
 *                                          | 成功 --> 打印回答 --> exit 0
 *
 * 关键点：网络调用是异步操作，所以 action 使用 async，入口使用 parseAsync() 等待它完成。
 * 运行观察：执行 hello-my-agent --prompt "你好"，程序回答一次后退出。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";

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
  // [NEW 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [CHANGED 02.2] 创建模型并发送一次请求。
  .action(async () => {
    const options = program.opts<CliOptions>();
    const config = readConfig(options);
    const model = createModel(config);
    if (!options.prompt?.trim()) throw new UserFacingError('请使用 --prompt "你好" 提问。');
    const signal = new AbortController().signal;
    const reply = await model.generate([{ role: "user", content: options.prompt }], signal);
    console.log(`Agent > ${reply.text}`);
  });

// [CHANGED 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
