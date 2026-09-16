#!/usr/bin/env node

/**
 * 第 01 章：从空目录到自己的命令。
 *
 * 要解决的问题：别人安装这个包后，怎样在自己的项目里启动它、查用法和报版本？
 * 本章从零增加命令入口、帮助和版本；下一章从这个入口接入模型。
 *
 * 执行流程：
 *   读取本包版本 -> 注册命令行为 -> 解析用户参数
 *                                  | 无参数       -> 显示欢迎语
 *                                  | --help       -> 显示帮助，结束
 *                                  | --version    -> 显示版本，结束
 *                                  | 不支持的参数 -> 报错，结束
 *
 * 两个概念：CLI 是命令行界面；入口文件是 Node 开始执行程序的文件。
 * npm 通过 package.json 的 bin 把 hello-my-agent 命令连接到编译后的入口。
 * 第一行的 #!/usr/bin/env node 让类 Unix 系统通过 PATH 找到 Node 执行它。
 *
 * 安装根目录依赖后，在仓库根目录运行：
 *   npm run chapter:01                 -> 显示欢迎语
 *   npm run chapter:01 -- --help        -> 显示帮助
 *   npm run chapter:01 -- --version     -> 显示 package.json 中的版本
 */

// 1. 准备依赖：Node 负责读本地文件，Commander 负责解析命令参数。
// node:fs 是 Node 自带的文件模块，无需安装；commander 是本项目的运行依赖。
import { readFileSync } from "node:fs";
import { Command } from "commander";

// 2. 读取 Agent 自己的版本，避免在代码里再维护一份版本字符串。
// import.meta.url 指向本文件；new URL("../package.json", ...) 找到它上一层的包清单。
// 源码在 chapter-01-first-command/，编译后在 dist/，两个目录都紧邻包清单。
// 例如用户在 /work/demo 启动已安装的命令，这里仍读取 Agent 安装目录的清单。
// 若只写 readFileSync("package.json")，就会到用户当前目录找，可能读错包或找不到。
// readFileSync 的 "utf8" 让结果成为文本；JSON.parse 再把文本转成可取 version 的对象。
// 本章在启动时同步读取这个小文件；清单缺失或 JSON 无效时会报错，暴露安装包问题。
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// 3. 创建命令对象并登记规则；此时还没有开始解析用户输入。
// 下面的方法返回同一个命令对象，所以可以用 .name().description() 连续配置。
const program = new Command();

program
  // 设置帮助中的命令名；真正让系统找到命令的是 package.json 的 bin 字段。
  .name("hello-my-agent")
  // 这段介绍会出现在 --help 中，让安装者知道命令的用途。
  .description("你好，我的 Agent：从 0 到 npm 发布")
  // 注册 -v 和 --version；解析到它们时打印版本并正常结束，不进入默认操作。
  .version(packageJson.version, "-v, --version", "显示版本号")
  // 给 Commander 的帮助选项设置别名与中文说明；帮助内容由已登记的规则生成。
  .helpOption("-h, --help", "显示帮助")
  // () => { ... } 是交给 Commander 的回调；登记它时不会立即打印欢迎语。
  // 在本章的参数规则下，无参数启动才会执行这里。接入模型时从这个操作继续扩展。
  .action(() => {
    console.log("你好，我的 Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

// 4. 开始执行：默认读取 process.argv，跳过 Node 和入口路径后解析用户参数。
// 例如 node dist/cli.js --help，真正参与选项解析的是 --help。
// npm run chapter:01 -- --help 中，第一个 -- 由 npm 处理，后面的 --help 才交给本程序。
// 必须先登记规则再 parse；未知选项或多余位置参数会由 Commander 报错并以状态 1 结束。
program.parse();
