# 02.4 连续输入与会话历史

[第二章导航](../README.md) · [上一节](../03-agent-loop/README.md) · [下一节：02.5](../05-anthropic/README.md)

**本节目标：让程序持续读取输入，并让第二轮请求带上第一轮已经完成的问答。**

## 问题

上一节的一轮 Agent 执行结束后，命令进程立即退出。即使再次运行命令，程序也会重新创建空历史；第二次请求只包含第二个问题，模型并不知道第一次问答发生过。

连续会话还不只是“多调用几次函数”。程序必须在多轮输入之间保存同一个历史数组，保证上一轮完成后才开始下一轮，并区分普通问题、空行、`/exit`、EOF 和 Ctrl+C。EOF 表示输入流已经结束，在 macOS 和 Linux 的交互终端中通常按 Ctrl+D 产生。若两轮请求并发修改历史，消息顺序就可能与用户输入顺序不一致；若把本地退出命令发给模型，又会产生一次不必要的请求。

因此，本节真正要解决的是：**怎样建立一个持续读取输入的终端循环，让多轮请求按顺序共享同一份进程内历史，同时正确处理不应进入模型的本地输入和退出信号。**

## 解决方案

新增终端模块，让它在输入循环外创建一个 `history` 数组。每收到一行普通文本，就把同一个数组交给 `agentLoop()`；本地命令和退出信号由终端模块直接处理。

```text
+----------------+
| read one line  |
+-------+--------+
        |
  +-----v-----------+
  | EOF or /exit?   |
  +--+--------------+
     | 是 --> 关闭输入 --> 结束
     | 否
     v
  空行？ ------ 是 --> 读取下一行
     |
     否
     v
+----------------+      +-------------+
| agentLoop      | ---> | model       |
| same history   |      +------+------+
+-------+--------+             |
        |              +-------+-------+
        |              | 成功          | 失败
        |              v               v
        +-------- 显示回答         显示错误
                       |               |
                       +-------+-------+
                               v
                        读取下一行

Ctrl+C --> 取消请求 --> 关闭输入 --> exit 130
```

这里有两层不同的循环：终端的循环等待下一次用户输入；未来 Agent Loop 的循环会处理同一轮中的模型和工具调用。

## 工作原理

先把会话历史理解成一份**每次请求都重新附上的聊天记录**。模型服务看不到本地内存，也不会因为同一个终端窗口还开着就自动记住上一轮。程序表现得像“有记忆”，是因为下一次请求再次携带已经完成的问答。

例如，用户先让模型记住项目名，第二轮再询问这个名字，请求内容会这样增长：

```text
第一轮：发送 [用户：项目叫青柠]
        保存 [用户：项目叫青柠, 助手：记住了]

第二轮：发送 [用户：项目叫青柠, 助手：记住了, 用户：项目叫什么]
        模型才能根据前文回答“青柠”
```

`history` 必须在 `while` 循环开始之前创建。这样程序启动会话时只创建一个数组，之后每一轮都使用并更新这同一个数组：

```text
启动会话
  -> 创建 history = []                         只创建一次
  -> 读取问题 1
  -> 等待回答 1
  -> history = [问题 1, 回答 1]
  -> 读取问题 2
  -> 等待回答 2
  -> history = [问题 1, 回答 1, 问题 2, 回答 2]
```

如果把 `const history = []` 写进 `while` 循环，程序每读到一个问题都会重新创建空数组。第一轮虽然保存了问答，但循环进入下一轮后会换成另一个空数组，第二轮就看不到第一轮内容：

```text
读取问题 1 -> 创建 [] -> 保存 [问题 1, 回答 1]
读取问题 2 -> 又创建 [] -> 请求中只有问题 2
```

每一轮还必须按顺序完成。代码在读取下一行之前使用 `await agentLoop(...)` 等待当前回答，所以执行顺序始终是“问题 1 → 回答 1 → 问题 2 → 回答 2”。如果同时发出两轮请求，问题 2 的回答可能先返回，历史就会按照错误顺序保存。当前实现一次只处理一轮，避免了这个问题。

最容易误解的是把终端循环和 Agent Loop 当成同一个循环：

| 循环 | 处理什么 | 什么时候进入下一次 |
| --- | --- | --- |
| 终端循环 | 不同的用户问题 | 当前问题回答完成后，再读取下一行 |
| Agent Loop | 同一个问题内部的模型和工具步骤 | 工具结果返回模型后，继续判断下一步 |

本节只增加终端循环，并继续使用无工具的 Agent Loop。历史只存在于当前进程，退出后不会保存到磁盘。

### 第一步：在输入循环外创建会话历史

在 [src/ui/terminal.ts](src/ui/terminal.ts) 的 `startTerminal()` 中创建 `history: Message[]`。把它放在输入循环之外，整个会话只创建一次；如果每次输入后都新建空数组，模型就无法收到前文。

输入交给 Node 的 `readline`。提前建立异步迭代器，后续按行读取；这样一次通过管道传入多行也不会丢掉后面的输入。

### 第二步：每行普通文本调用同一个核心

从输入循环里截取主线：

```ts
const { value, done } = await lines.next();
if (done) break;
const text = value.trim();
if (!text) continue;
if (text === "/exit") break;
const reply = await agentLoop(model, history, text, controller.signal);
printReply(reply);
```

完整代码在调用处有 `try/catch`：失败就显示安全提示，继续等待下一次输入；核心仍会保留原历史。空行和 `/exit` 在本地处理，不发给模型。

第二次提问的消息会是 `user → assistant → user`。这不是模型在后台记住了你，而是程序把已完成的问答再次放进请求。退出程序后数组消失；持久化会话在后续章节实现。

### 第三步：理解“记忆”为什么等于重发历史

本节使用的模型接口是无状态请求。服务端处理当前请求体，不会读取本地 JavaScript 数组，也不会自动取得上一次 CLI 调用的内容。要让第二轮理解第一轮，客户端必须把已经完成的 `user` 和 `assistant` 消息再次放进请求。

因此，历史增长会直接扩大后续请求。第 `n` 轮通常携带前 `n-1` 轮的消息，输入 token、序列化数据量和模型处理时间也随之增加。本节保留完整历史是为了展示机制；后续上下文章节会处理裁剪、总结和窗口上限。

`history` 存在 Node 进程的堆内存中。退出程序后，进程地址空间被回收，数组不会保留。要跨进程恢复会话，必须把消息序列化到文件或数据库，再在新进程启动时读回。

### 第四步：区分终端循环和 Agent Loop

终端的 `while` 处理不同用户输入：读一行，等待这一轮完成，再读下一行。Agent Loop 处理同一项任务内部的步骤：调用模型，未来可能执行工具并继续调用模型。两层循环拥有不同的继续条件，不能合并。

`readline` 把 `stdin` 字节流切成一行行字符串。异步迭代器负责按顺序交付这些行；提前取得迭代器，可以避免程序在等待模型时重新注册读取逻辑。当前实现串行处理输入，保证同一个 `history` 不会被两轮请求同时修改。

### 第五步：在终端边界处理退出与显示

`printReply()` 输出文本，单次提问也复用它。Ctrl+C 触发 `AbortController`，取消当前请求并关闭输入；`finally` 负责释放资源。程序把退出状态设置为 130，这是类 Unix 系统表示进程被 Ctrl+C 中断的常用状态。此时 Ctrl+C 会退出程序，尚不支持“取消当前轮后继续聊”。

### 第六步：入口增加连续会话分支

在 [src/cli.ts](src/cli.ts) 中，没有 `--prompt` 时调用 `startTerminal(model)`；有 `--prompt` 时调用 `agentLoop()` 并显示一次结果。入口只决定输入模式，历史数组和逐行读取都属于终端模块。

### 为什么选择 readline 的异步迭代器

`readline` 是 Node 处理逐行终端输入的标准模块。异步迭代器把输入表示成一个有顺序的序列：取得一行，`await` 当前模型请求完成，再取得下一行。代码不会在上一轮结束前启动下一轮，因此两个请求不会同时修改同一个 `history`。

把历史保存在终端函数的局部变量中，也明确了它的生命周期：进入会话时创建，整个输入循环共享，退出进程后释放。本节需要的是进程内记忆，不必先引入文件或数据库。

### 还有哪些方案

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 监听 readline 的 `line` 事件 | 写简单回调很直接 | 用户连续输入时回调可能重叠，需要额外队列保证历史按顺序提交。 |
| 递归调用 `question()` | 适合一问一答式交互 | 管道输入、EOF 和资源清理需要更多分支。 |
| 只保存服务端会话 ID | 本地请求可能更小 | 依赖特定服务商的会话能力，无法直接观察或迁移完整历史。 |
| 每轮把历史写入文件或数据库 | 进程退出后可以恢复 | 引入序列化、并发写入和损坏恢复；这些属于会话持久化问题。 |

当前方案使用 Node 标准库和一个数组，就能清楚展示“模型记忆来自客户端重发历史”。等课程讨论跨进程恢复时，再增加持久化层。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 新增 | `src/ui/terminal.ts` | 逐行读取输入并保存会话历史。 |
| 修改 | `src/cli.ts` | 在单次提问和连续会话之间选择。 |

### 第一步：实现终端输入循环

创建 `src/ui/terminal.ts`：

```ts
import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { UserFacingError } from "../config/load-config.js";
import type { Message, Model, Reply } from "../models/client.js";

const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const controller = new AbortController();
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  const lines = input[Symbol.asyncIterator]();

  const stop = () => {
    controller.abort();
    input.close();
    process.exitCode = 130;
  };

  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.log("Hello，My Agent！输入消息开始对话，输入 /exit 退出。");

  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.next();
      if (done) break;

      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;

      try {
        const reply = await agentLoop(model, history, text, controller.signal);
        if (controller.signal.aborted) break;
        printReply(reply);
        process.exitCode = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        const message = error instanceof UserFacingError
          ? error.message
          : "模型请求失败，请检查配置和网络。";
        console.error(`错误：${message} 本轮未加入历史，可重新输入。`);
        process.exitCode = 1;
      }
    }
  } finally {
    controller.abort();
    input.close();
    process.off("SIGINT", stop);
  }
}

export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
}
```

`history` 在 `while` 外创建，整个会话只使用这一份数组。`await agentLoop(...)` 位于读取下一行之前，因此各轮按顺序完成。颜色代码 `36` 把“你”显示为青色，`35` 把“Agent”显示为紫色；非交互输出不加颜色。[教学注释版源码](src/ui/terminal.ts)还说明了 EOF、SIGINT 和资源清理分支。

### 第二步：让入口选择运行模式

在 `src/cli.ts` 中导入终端函数：

```ts
import { startTerminal, printReply } from "./ui/terminal.js";
```

把 `.action()` 中检查 `prompt` 和执行 Agent Loop 的部分替换为：

```ts
if (options.prompt === undefined) {
  await startTerminal(model);
  return;
}
if (!options.prompt.trim()) {
  throw new UserFacingError("提问内容不能为空。");
}
const signal = new AbortController().signal;
const reply = await agentLoop(model, [], options.prompt, signal);
printReply(reply);
```

没有 `--prompt` 时，进程进入连续会话；传入 `--prompt` 时，仍然只执行一次并退出。

### 第三步：准备模型配置

确认根目录 `.env` 中已有可用模型配置。你可以从仓库根目录或本小节目录运行，配置读取会向上找到最近项目的 `.env`。

### 第四步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.4
```

这条 npm 命令只构建并注册本节，不会进入连续对话，也不会调用模型。准备开始对话时运行：

```bash
hello-my-agent
```

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 不传 `--prompt` 时启动连续会话；传入时仍只提问一次。 |
| 新增 | [src/ui/terminal.ts](src/ui/terminal.ts) | 保存历史，逐行读取输入，显示结果并处理退出。 |

## 运行验证

依次输入下面三行，每次等待回答后再输入下一行：

```text
请记住，我的项目叫青柠。
我刚才说的项目叫什么？
/exit
```

第二轮请求应包含前一轮的问答。程序不会保证真实模型逐字回答，但应把上下文完整发送出去。退出再启动后历史为空；需要保存会话的机制还没加入。

真实模型的措辞并不固定，因此再运行确定性检查：

```bash
npm run check:02.4
```

检查使用本地模拟接口读取第二次请求，确认 OpenAI 消息角色顺序是 `system → user → assistant → user`。这直接证明程序发送了第一轮历史，不依赖模型是否恰好回答“青柠”。

再运行 `hello-my-agent --prompt "你好"`，应只回答一次后退出。

## 失败实验

进入连续会话后输入空行，程序应继续等待，不发送请求。等待输入或模型回答时按 Ctrl+C，程序应取消请求、关闭输入，并以状态 130 退出。

## 小练习

解释为什么 `history` 必须在 `while` 循环外创建。把它移到循环内会导致第二次请求发生什么变化？

参考答案：循环外的数组在整个会话中持续存在。移到循环内后，每次输入都会创建空数组，第二次请求只能看到第二个问题，无法带上第一轮问答。

## 接下来

连续会话已经通了。下一节只在配置和模型层增加 Anthropic 协议。
