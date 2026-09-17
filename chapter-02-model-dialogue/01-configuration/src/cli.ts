#!/usr/bin/env node

/**
 * 02.1 读取模型配置 | [CHANGED] cli.ts
 *
 * 学习目标：让默认命令读取并校验模型配置，同时保证帮助和版本查询不需要密钥。
 * 输入：命令行选项，以及 readConfig() 从环境中取得的配置。
 * 输出：配置有效时显示就绪信息；配置无效时显示安全错误并设置失败退出码。
 *
 * 启动主流程（Agent Loop 尚未建立）：
 *   --doctor --> 显示 Node、平台和启动目录 --> 结束（不读取模型配置）
 *   其他输入：
 *   +------------+
 *   | parse argv |
 *   +-----+------+
 *         +-- --help / --version --> +----------+ --> 结束
 *         |                          | 显示信息 |
 *         |                          +----------+
 *         +-- 默认操作 --> +------------+ --> 配置有效？
 *                          | readConfig |
 *                          +------------+      | 否 --> 显示错误 --> exit 1
 *                                              | 是 --> 显示模型名 --> exit 0
 *
 * 关键点：Commander 只在默认操作中调用 action，因此帮助和版本不会触发配置读取。
 * 不要打印整个 Config，因为其中包含 API Key。
 * 运行观察：执行 hello-my-agent 只检查配置，不会发送模型请求。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, UserFacingError, type Options } from "./config/load-config.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自第 01 章练习] 环境诊断不读取模型配置，也不会发送模型请求。
function printDoctor(): void {
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Working directory: ${process.cwd()}`);
}

type CliOptions = Options & { doctor?: boolean };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
  .option("--doctor", "显示当前运行环境")
  // [NEW 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [CHANGED 02.1] 第一章直接输出欢迎语；现在先验证模型配置。
  .action(() => {
    const options = program.opts<CliOptions>();
    if (options.doctor) {
      printDoctor();
      return;
    }
    const config = readConfig(options);
    console.log("Hello，My Agent！");
    // 只说明模型就绪，不打印整个配置对象或密钥。
    console.log(`配置已就绪，模型：${config.model}。本节不发送模型请求。`);
  });

try {
  program.parse();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "配置读取失败，请检查当前目录。"}`);
  process.exitCode = 1;
}
