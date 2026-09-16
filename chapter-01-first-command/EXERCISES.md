# 第 01 章练习：显示运行环境

[返回本章](README.md) · [正式主线代码](cli.ts)

练习可以直接对照答案学习。下一章从正式主线代码继续，无需把本练习合入主线。

## 解释题参考答案

**1. 为什么开发启动成功还不够？** 开发目录里有源码和 tsx。安装者拿到的是 tarball，可能缺入口、缺运行依赖，或把源码路径写死。只有真的打包、安装、离开源码目录再运行，才能发现这类问题。

**2. 三个名字有什么关系？** `@sherlockmen/hello-my-agent` 是本地包名；`hello-my-agent` 是安装者输入的命令；`dist/cli.js` 是实际由 Node 运行的文件。`package.json` 的 `bin` 连接命令和文件。

**3. 为什么从程序位置找版本号？** 当前目录属于用户的项目，可能没有包清单，或记录了另一个项目的版本。`import.meta.url` 指向 Agent 入口；相对它查找，才能找到 Agent 自己的清单。

## 提示与思路

Commander 的 `.option()` 注册选项，`program.opts()` 返回解析后的选项对象。先判断是否要诊断；若需要，显示三项信息并 `return`，避免继续打印欢迎语。

`process.version` 是 Node 版本，`process.platform` 和 `process.arch` 是运行平台与架构，`process.cwd()` 是用户当前目录。它们都是 Node 已经提供的信息，无需再安装依赖。

## 完整答案

在自己的练习项目根目录中，用下面的完整文件替换 `chapter-01-first-command/cli.ts`。本书配套仓库另将答案保存为 [cli-with-doctor.ts](cli-with-doctor.ts)，可以在仓库根目录直接运行 `npm run exercise:01 -- --doctor`，无需覆盖正式代码：

```ts
#!/usr/bin/env node

/**
 * 第 01 章练习答案：给命令增加运行环境诊断。
 *
 * 要解决的问题：当别人的运行结果与你不同，怎样让对方报告环境和启动位置？
 * 保留：主线的版本读取、帮助、版本选项和无参数欢迎语。
 * 新增：--doctor 选项，以及默认操作里的诊断分支。
 *
 * 执行流程：
 *   读取本包版本 -> 登记规则 -> 解析参数
 *                              | --help / --version -> 输出后结束
 *                              | --doctor           -> 显示环境，返回
 *                              | 无参数             -> 显示欢迎语
 *
 * 关键区别：安装目录属于 Agent；工作目录是用户启动命令时所在的项目。
 * 查本包版本要从入口定位；报告用户在哪个项目里工作，要读取 process.cwd()。
 * 本文件保留完整实现，可以单独阅读；下一章仍从正式的 cli.ts 继续。
 *
 * 安装根目录依赖后，在仓库根目录运行：
 *   npm run exercise:01 -- --doctor -> 输出 Node、Platform、Working directory
 *   npm run exercise:01            -> 仍显示欢迎语
 */

// 1. 准备依赖。node:fs 随 Node 提供；Commander 处理参数和帮助。
import { readFileSync } from "node:fs";
import { Command } from "commander";

// 2. 与主线一致：版本属于本包，通过 import.meta.url 从当前程序文件向上找清单。
// 源文件在章节目录中，编译入口在 dist/ 中，都可以通过 ../package.json 定位本包。
// "utf8" 让文件内容以文本返回，JSON.parse 将其转为对象，随后读取 version。
// 这里不使用 process.cwd()，否则可能读到用户项目的版本；读取失败时直接暴露错误。
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// 3. 先登记规则。创建对象和设置选项都不会立刻执行 action 回调。
const program = new Command();

program
  // name 用于帮助显示；实际安装出的命令名由根目录 package.json 的 bin 决定。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  // 帮助、版本仍由 Commander 处理；解析到它们时输出后结束，不进入诊断分支。
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // 本练习新增：不带 <值> 的选项是布尔开关，--doctor 后不用再填参数。
  // 注册后它也会出现在帮助中；如果只写下面的 if，解析器仍会把该选项当成未知输入。
  .option("--doctor", "显示当前运行环境")
  .action(() => {
    // 本练习新增：action 执行时参数已经解析，opts() 可以取出选项对象。
    // 传入 --doctor 时 doctor 为 true；没传时它是 undefined，不进入此分支。
    if (program.opts().doctor) {
      // process 是 Node 提供的当前进程信息，无需额外依赖。
      // 模板字符串中的 ${...} 会替换成实际值，例如 Node: v22.23.2。
      console.log(`Node: ${process.version}`);
      // platform 是系统标识（macOS 为 darwin），arch 是当前 Node 的架构（例如 arm64）。
      console.log(`Platform: ${process.platform} ${process.arch}`);
      // cwd() 是调用时的工作目录。若在 /work/demo 启动，这里就显示 /work/demo。
      // 它不会因为命令安装在别处而变成 Agent 的安装目录。
      console.log(`Working directory: ${process.cwd()}`);
      // 结束本次回调，避免诊断后继续打印欢迎语；return 本身不会设置错误退出码。
      return;
    }

    // 未传 --doctor 时保持主线行为，增加练习功能不能破坏原来的启动方式。
    console.log("你好，我的 Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

// 4. 默认从 process.argv 解析；npm 命令中的第一个 -- 负责把后续参数交给这里。
// 规则登记完才开始解析，因此 --doctor 能被识别，未知选项仍然以状态 1 报错。
program.parse();
```

相较正式代码，只新增一个选项和默认操作开头的条件判断；版本读取和原有帮助流程继续使用。

## 运行并观察

```bash
npm run chapter:01 -- --doctor
npm run build
node dist/cli.js --doctor
```

在本章的 macOS arm64 验证环境里，前三项依次类似：

```text
Node: v22.23.2
Platform: darwin arm64
Working directory: /your/current/project
```

最后一行实际显示你当前目录；系统或架构不同，第二行也不同。`darwin` 是 Node 对 macOS 的平台标识。

再检查已有功能：

```bash
node dist/cli.js
node dist/cli.js --help
node dist/cli.js --version
```

无参数时仍显示欢迎语；帮助中增加 `--doctor`；版本仍是包清单中的值。

## 常见错误

- 只写判断，没有调用 `.option()`：Commander 会把 `--doctor` 判定为未知选项。
- 把判断放在 `.parse()` 之前：此时命令行还没解析，应该在操作回调里读取选项。
- 忘记 `return`：诊断后还会显示默认欢迎语。
- 修改源码后只运行 `dist/cli.js`：先编译，确保运行的是新版本。

读完后，说明“当前工作目录”和“Agent 自己的安装目录”的区别，就抓住了这道练习的重点。
