#!/usr/bin/env node

/**
 * 02.2 向模型提问一次 | [CHANGED] cli.ts
 *
 * 学习目标：接收一段非空问题，向 OpenAI 兼容接口请求一次回答，然后结束程序。
 * 输入：--prompt、模型配置和取消信号。
 * 输出：成功时打印一条回答；空问题、配置错误或请求失败时显示安全提示。
 *
 * 启动主流程（Agent Loop 尚未建立）：
 *   --doctor --> 显示 Node、平台和启动目录 --> 结束（不读取模型配置）
 *   其他输入：
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
 * 交互终端中的 Agent 标签使用紫色；管道和文件输出保持纯文本。
 * 运行观察：执行 hello-my-agent --prompt "你好"，程序回答一次后退出。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";

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
// 只在交互终端中加入 ANSI 颜色；重定向到文件或管道时保留纯文本。
/**
 * 根据输出目标决定是否给终端标签添加 ANSI 颜色。
 *
 * - 输入：要显示的文字和 ANSI 颜色编号。
 * - 输出：交互终端得到带颜色的字符串；管道或文件得到原始纯文本。
 * - 关键原因：转义字符适合人眼终端，不应混入日志、重定向文件或测试结果。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;
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
  // [NEW 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [CHANGED 02.2] 创建模型并发送一次请求。
  .action(async () => {
    const options = program.opts<CliOptions>();
    if (options.doctor) {
      printDoctor();
      return;
    }
    const config = readConfig(options);
    const model = createModel(config);
    if (!options.prompt?.trim()) throw new UserFacingError('请使用 --prompt "你好" 提问。');
    const signal = new AbortController().signal;
    const reply = await model.generate([{ role: "user", content: options.prompt }], signal);
    console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  });

// [CHANGED 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
