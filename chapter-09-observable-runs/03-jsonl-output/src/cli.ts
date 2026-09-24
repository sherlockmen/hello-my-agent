#!/usr/bin/env node
/**
 * 09.3 让脚本读懂执行过程 | [CHANGED] cli.ts
 *
 * 学习目标：增加 --output text|jsonl，让一次任务可以选择终端文字或 JSONL 事件记录。
 * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 text。
 * 输出：选择对应消费者；JSONL 运行时 stdout 逐行输出 JSON，运行错误由 stderr 说明。
 * 状态：入口不保存历史或批准；参数错误不会启动任务，运行失败不撤销已经发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
 *   [NEW] output 是 text 或 jsonl？-- 否 -> 错误 -> stderr、exit 1
 *                                 +-- 是 -> jsonl 但没有 --prompt？-- 是 -> 错误
 *                                                                   +-- 否 -> readConfig -> createModel
 *   有 --prompt？-- 否 -> startTerminal（text）
 *                +-- 是 -> 内容为空？-- 是 -> 错误
 *                                    +-- 否 -> [CHANGED] output=jsonl？-- 是 -> runJsonlPrompt
 *                                                                         +-- 否 -> runSinglePrompt
 *   运行抛错 -> explainError -> stderr、exit 1；单次用户取消由消费者设 exit 130
 *
 * 输出格式决定消费方式，不改变模型或工具协议；text 可以交互审批，jsonl 遇到 ask 默认拒绝。
 * --help、--version 和 --doctor 是独立的文字诊断入口，不产生运行事件。
 * 运行观察：--output jsonl 必须同时给 --prompt；普通启动仍进入文本会话。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
// [NEW 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
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
// [CHANGED 09.3] output 只供入口选择消费者，不并入模型连接配置。
type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string };
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
  // [NEW 09.3] 输出格式只影响消费者，不改变模型与工具协议。
  .option("--output <format>", "输出格式：text 或 jsonl", "text")
  // [CHANGED 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    if (options.doctor) {
      printDoctor();
      return;
    }
    // [NEW 09.3] 启动前明确机器模式的输入与输出约定。
    if (!["text", "jsonl"].includes(options.output ?? "text")) throw new UserFacingError("--output 只能是 text 或 jsonl。");
    if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
    const config = readConfig(options);
    const model = createModel(config);
    if (options.prompt === undefined) {
      await startTerminal(model);
      return;
    }
    if (!options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [CHANGED 09.3] 两种显示方式共用核心。
    if (options.output === "jsonl") await runJsonlPrompt(model, options.prompt);
    else await runSinglePrompt(model, options.prompt);
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
}
