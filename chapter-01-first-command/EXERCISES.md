# 第 01 章练习：显示运行环境

[返回本章](README.md) · [第一章代码](cli.ts)

本练习增加 `--doctor` 选项，用于显示 Node 版本、运行平台和当前工作目录。

## 工作原理

先把 `--doctor` 理解成一个**只读取当前进程状态的本地诊断分支**。它不检查模型服务，也不修改系统设置；它只是把“这个命令此刻由什么 Node、在什么系统、从什么目录运行”显示出来，方便比较两台机器或两个终端为什么结果不同。

```text
hello-my-agent --doctor
  -> Commander 解析参数
  -> options.doctor 为 true
  -> 读取 process.version / platform / arch / cwd()
  -> 打印三项信息
  -> return，结束本次 action
```

例如，Agent 安装在 `/usr/local/lib/...`，用户却从 `/work/demo` 启动它，诊断中的工作目录应该是 `/work/demo`。这说明 `process.cwd()` 回答“用户正在操作哪里”，而 `import.meta.url` 回答“程序文件安装在哪里”。二者都是真实路径，但解决的问题不同。

最容易误解的是只在 `.action()` 中判断 `doctor`，却没有先用 `.option("--doctor")` 登记。Commander 只会解析已经登记的规则；未登记的选项会在进入 `.action()` 前被当成未知输入。另一个常见错误是显示诊断后忘记 `return`，导致程序继续输出默认欢迎语。

本练习只增加环境信息显示，不判断这些版本是否满足要求，也不测试网络、密钥或模型可用性。真正的环境健康检查可以在后续能力增多后继续扩展。

## 解释题

完成代码前，先回答下面四个问题。它们分别检查安装边界、命令入口和路径含义。

1. 为什么只在开发目录中启动成功，还不能证明 npm 安装包可用？
2. 包名、命令名和入口文件分别解决什么问题？`package.json` 用哪个字段连接后两者？
3. 为什么读取版本号时要从程序文件的位置查找 `package.json`，不能依赖当前工作目录？
4. 为什么 `--doctor` 显示工作目录时反而要使用 `process.cwd()`？

## 提示与思路

先用 Commander 的 `.option()` 登记 `--doctor`，再在 `.action()` 的回调中调用 `program.opts()` 读取解析结果。传入该选项时，显示三项环境信息并 `return`，避免继续打印欢迎语。

`process.version` 是 Node 版本，`process.platform` 是系统标识，`process.arch` 是当前 Node 的架构，`process.cwd()` 返回工作目录。这些信息由 Node 提供，无需增加依赖。

## 完整答案

用下面的完整代码替换 `chapter-01-first-command/cli.ts`。需要核对时，可以查看 [完整答案](cli-with-doctor.ts)。

```ts
#!/usr/bin/env node

/**
 * 第 01 章练习答案：给命令增加运行环境诊断。
 *
 * 要解决的问题：当别人的运行结果与你不同，怎样查看对方的环境和工作目录？
 * 保留：版本读取、帮助和版本查询，以及无参数启动时的欢迎语。
 * 新增：--doctor 选项，以及 action 回调中的诊断分支。
 *
 * 执行流程：
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
  // 本练习新增：--doctor 是布尔开关，只表示是否开启诊断，后面不需要跟一个值。
  // 注册后它也会出现在帮助中；如果只写下面的 if，解析器仍会把该选项当成未知输入。
  .option("--doctor", "显示当前运行环境")
  .action(() => {
    // 本练习新增：执行 action 回调时参数已经解析，opts() 返回解析后的选项对象。
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
```

这份答案只新增一个选项和 `.action()` 开头的条件判断；版本读取、帮助、版本查询和欢迎语逻辑均保留。

## 解释题参考答案

**1. 为什么在开发目录里启动成功还不够？** 开发目录中有源码、编译工具和依赖，安装者拿到的却是打包后的文件。如果安装包漏掉了入口或运行依赖，或者程序依赖开发机上的路径，就可能安装成功却无法运行。实际打包、安装，并在源码目录之外运行，才能检查这些问题。

**2. 包名、命令名和入口文件有什么关系？**

| 名称 | 当前值 | 作用 |
| --- | --- | --- |
| 包名 | `@sherlockmen/hello-my-agent` | npm 安装和发布时识别这个包 |
| 命令名 | `hello-my-agent` | 使用者在终端输入的名字 |
| 入口文件 | `dist/cli.js` | Node 最终执行的 JavaScript 文件 |

`package.json` 的 `bin` 把命令名和入口文件连接起来。npm 注册或全局安装这个包时，根据这项配置创建命令入口。

**3. 为什么从程序文件的位置查找版本号？** 工作目录由用户决定，里面可能没有包清单，也可能记录了其他项目的版本。`import.meta.url` 是当前程序文件的 URL；相对入口文件查找，才能定位 Agent 自己的包清单。

**4. 为什么显示工作目录要用 `process.cwd()`？** 它返回当前进程的工作目录。例如，在 `/work/demo` 启动已安装的 Agent，诊断应显示 `/work/demo`。`import.meta.url` 表示程序文件的位置，适合查找本包资源，不能用来表示用户正在操作哪个目录。

## 运行并观察

把答案保存到 `chapter-01-first-command/cli.ts` 后，在项目根目录构建并注册：

```bash
npm run lesson:01
```

`npm run lesson:01` 会先按锁文件安装依赖，编译完成后自动注册命令。之后修改源码，仍然使用这一条命令重新构建。

现在直接运行：

```bash
hello-my-agent --doctor
```

在本章的 macOS arm64 验证环境里，诊断输出类似：

```text
Node: v22.23.2
Platform: darwin arm64
Working directory: /your/current/project
```

以上输出仅作示例。实际结果取决于你的 Node 版本、系统、架构和工作目录；`darwin` 是 Node 对 macOS 的平台标识。使用 `--doctor` 时应只显示这三行，不再显示欢迎语。

继续运行以下命令，检查原有功能：

```bash
hello-my-agent
hello-my-agent --help
hello-my-agent --version
```

无参数时仍显示欢迎语；帮助中增加 `--doctor`；版本仍是包清单中的值。

完成练习后，在项目根目录执行 `npm run lesson:02.1` 继续学习第二章。

## 常见错误

- 只写判断，没有调用 `.option()`：Commander 会把 `--doctor` 判定为未知选项。
- 在 `.action()` 回调之外、`.parse()` 之前直接读取选项：此时参数尚未解析。把判断放入回调，等解析完成后再执行。
- 忘记 `return`：诊断后还会显示默认欢迎语。
- 修改源码后没有重新构建：先执行 `npm run lesson:01`，确保命令运行的是新产物。
- `--doctor` 提示未知选项：确认已经替换 `cli.ts`，再执行 `npm run lesson:01` 重新构建。

完成后，试着解释：为什么同一个程序读取版本号和显示工作目录时，要使用不同的定位方式？
