#!/usr/bin/env node

/**
 * 第 01 章练习：显示运行环境 | [CHANGED 练习] cli.ts
 *
 * 要解决的问题：同一个命令在两个终端里表现不同，怎样比较它们的环境和工作目录？
 * 保留：版本读取、帮助和版本查询，以及无参数启动时的欢迎语。
 * 新增：--doctor 选项，以及 action 回调中的诊断分支。
 * 输入：终端参数。输出：诊断时显示三行环境信息；不修改文件或配置。
 *
 * 启动主流程（Agent Loop 尚未建立）：
 *   读取本包版本 -> 登记规则 -> 解析参数
 *                              | --help / -h    -> 显示帮助，结束
 *                              | --version / -v -> 显示版本，结束
 *                              | --doctor       -> 显示环境，返回
 *                              | 无参数         -> 显示欢迎语
 *                              | 不支持的参数   -> 报错，结束
 *
 * 关键区别：安装目录存放 Agent 的程序；工作目录是用户运行命令时所在的目录。
 * 读取本包版本时，相对入口文件查找；显示当前工作目录时，调用 process.cwd()。
 *
 * 将本文件内容写入 chapter-01-first-command/cli.ts。
 * 在项目根目录执行 npm run lesson:01，自动安装依赖、编译并注册，之后直接运行：
 *   hello-my-agent --doctor -> 输出 Node、Platform、Working directory
 *   hello-my-agent          -> 仍显示欢迎语
 */

// 1. 准备依赖：node:fs 是 Node 内置的文件模块；Commander 处理参数和帮助。
import { readFileSync } from "node:fs";
import { Command } from "commander";

// 2. 读取本包版本：import.meta.url 是当前文件的 URL，new URL 据此定位包清单。
// 源文件在章节目录中，编译入口在 dist/ 中；向上一层都能找到本包的 package.json。
// "utf8" 指定文本编码；JSON.parse 把 JSON 文本转成对象，供后面读取 version。
// 这里不使用 process.cwd()，以免读到用户项目的版本；文件缺失或 JSON 无效时直接报错。
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// 3. 先登记规则。创建对象和设置选项都不会立刻执行 action 回调。
const program = new Command();

program
  // 设置帮助中显示的命令名；本机的命令入口由 npm 根据 bin 字段创建。
  .name("hello-my-agent")
  // 设置帮助中的简介，说明命令用途。
  .description("你好，我的 Agent：从 0 到 npm 发布")
  // -v 与 --version 等价；解析到其中任意一个时显示版本并结束，不执行 action。
  .version(packageJson.version, "-v, --version", "显示版本号")
  // -h 与 --help 等价；帮助内容由已登记的规则生成，也会包含下面的 --doctor。
  .helpOption("-h, --help", "显示帮助")
  // [NEW 练习] --doctor 是布尔开关，只表示是否开启诊断，后面不需要跟一个值。
  // 注册后它也会出现在帮助中；如果只写下面的 if，解析器仍会把该选项当成未知输入。
  .option("--doctor", "显示当前运行环境")
  .action(() => {
    // [CHANGED 练习] 执行 action 回调时参数已经解析，opts() 返回解析后的选项对象。
    // 传入 --doctor 时 doctor 为 true；没传时它是 undefined，不进入此分支。
    if (program.opts().doctor) {
      // process 是 Node 提供的全局对象，可用于读取当前进程信息，无需额外安装依赖。
      // 模板字符串中的 ${...} 会替换成实际值，例如 Node: v22.23.2。
      console.log(`Node: ${process.version}`);
      // platform 是系统标识（macOS 为 darwin），arch 是当前 Node 的架构（例如 arm64）。
      console.log(`Platform: ${process.platform} ${process.arch}`);
      // cwd() 返回调用时的工作目录。若在 /work/demo 启动，这里就显示 /work/demo。
      // 它不会因为命令安装在别处而变成 Agent 的安装目录。
      console.log(`Working directory: ${process.cwd()}`);
      // 结束本次回调，避免诊断后继续打印欢迎语；return 本身不会设置错误退出码。
      return;
    }

    // 未传 --doctor 时保持原来的启动行为。
    console.log("Hello，My Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

// 4. 默认读取命令行参数数组 process.argv，跳过 Node 和入口文件的路径后解析用户参数。
// 运行 hello-my-agent --doctor 时，Commander 识别该选项，再调用上面的 action。
// 所有规则都要在 parse() 前登记；未知选项或多余的位置参数仍会报错，并以退出码 1 结束。
program.parse();
