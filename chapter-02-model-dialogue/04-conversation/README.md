# 02.4 连续输入与会话历史

[第二章导航](../README.md) · [上一节](../03-agent-loop/README.md) · [下一节：02.5](../05-anthropic/README.md)

**本节目标：让程序持续读取输入，并让第二轮请求带上第一轮已经完成的问答。**

## 问题：再问一次，模型为什么不知道刚才说过什么

上一节已经能在一轮成功后保存问题和回答，但 CLI 随即退出。再次运行命令时，程序重新创建空数组，上一轮自然不会出现在这次请求里。

我们试着把项目名告诉模型，再问“我刚才说的项目叫什么”。要让第二个问题有意义，程序既要继续等待输入，也要把第一轮问答一起发出去。仅仅让终端窗口开着，模型并不会自动知道前文。

本节就把一次提问变成持续会话：同一个进程接收多次输入，各轮按顺序共享已经完成的对话。

## 解决方案：终端保留历史，每次输入都交给同一个核心

我们新增终端模块。会话开始时，它创建一份 `history`；每读到一行普通文本，就用这份历史调用 `agentLoop()`。等本轮完成、显示结果后，再处理下一行。

空行和退出命令由终端自己处理，无需询问模型。这样，用户输入的问题和控制终端的操作就不会混在一起。

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

这里新增的是“等待下一条用户输入”的循环。`agentLoop()` 仍然完成其中一轮，代码沿用上一节。

## 工作原理

### 模型的“记忆”从哪里来

本章的请求每次都要提交消息，模型服务不会读取本地的 `history` 数组。连续对话之所以能接上前文，是因为程序把以前的问答再发了一遍：

```text
第一轮：发送 [用户：项目叫青柠]
        保存 [用户：项目叫青柠, 助手：记住了]

第二轮：发送 [用户：项目叫青柠, 助手：记住了, 用户：项目叫什么]
        模型才能根据前文回答“青柠”
```

第二轮里的“项目”因此有了明确指代。若只发送第二个问题，模型看不到名字，只能表示不知道或猜测。界面显示过前文也不够，前文必须真正进入下一次请求。

这也解释了为什么聊天越久，请求通常越大。第 `n` 轮会带上前 `n-1` 轮问答，输入 token 也随之增加。token 是模型处理文本时的计量单位，不固定等于一个字或一个单词。本节先完整保留历史，第 15 章会加入上下文预算，第 16 章再压缩较早的内容。

### 一份数组怎样跨过多轮输入

终端在输入循环外创建历史，所以进入会话时只创建一次：

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

每轮还是由 `agentLoop()` 决定是否保存问答。终端只保留这个数组，并把它再次传进去；请求失败时显示原因，历史仍停在上一轮成功的位置。

如果把创建数组的语句放在循环里面，结果就不同了：

```text
读取问题 1 -> 创建 [] -> 保存 [问题 1, 回答 1]
读取问题 2 -> 又创建 [] -> 请求中只有问题 2
```

第一轮保存没有出错，但第二轮换成了一个新数组，之前的内容没有机会再使用。由此可见，能不能连续对话，既取决于保存了什么，也取决于保存它的变量能活多久。

这里的数组只在当前 Node 进程的内存里。退出再启动，就会重新创建空数组。第 13 章会把会话写入文件，解决关闭程序后继续对话的问题。

### 为什么要等这一轮结束，再处理下一行

若用户连续输入两行，第二轮需要看到第一轮的回答。程序不能同时发出两次请求，否则第二轮发送时第一轮还没完成，历史不全；两个回答若以相反顺序返回，保存顺序也会错。

我们使用 Node 的 `readline` 把标准输入切成一行行文本，再通过异步迭代器依次取出。`await agentLoop()` 放在读取下一行之前，让“读取、请求、保存、显示”按轮完成。

下面只展示输入循环中的主线，完整代码还会捕获请求错误：

```ts
const { value, done } = await lines.next();
if (done) break;
const text = value.trim();
if (!text) continue;
if (text === "/exit") break;
const reply = await agentLoop(model, history, text, controller.signal);
printReply(reply);
```

异步迭代器在进入循环前就建立，输入行可以按顺序等待读取。这样即使管道一次送来多行，程序也会逐轮处理。直接用异步的 `line` 事件回调则不同：事件不会自动等待上一个回调里的请求，需要额外安排队列。

### 两个循环分别在等什么

我们现在可以区分终端循环和 Agent Loop：

| 循环 | 处理什么 | 什么时候进入下一次 |
| --- | --- | --- |
| 终端循环 | 不同的用户问题 | 当前问题处理结束后，读取下一行 |
| Agent Loop | 同一个问题内部的模型和工具步骤 | 第三章接入工具后，把工具结果返回模型，再判断下一步 |

本节的终端已经会循环，但 Agent 核心仍只请求模型一次。将来一个用户问题可以在核心内部走过多次工具调用，终端仍只需要等它交回最终回答。

### 退出与取消由终端处理

空行不包含问题，终端直接跳过；`/exit` 是本地退出命令，也不发送给模型。EOF 表示输入流已经结束，在 macOS / Linux 终端中通常由 Ctrl+D 产生，程序读到后结束循环。

Ctrl+C 还可能发生在模型正在回答时。终端会调用 `AbortController.abort()`，让取消信号传到核心和 SDK，然后关闭输入并设置退出码 130。核心仍按上一节的规则，在保存前检查取消；终端也会检查，避免继续显示已取消的结果。

`finally` 在离开会话时关闭输入、移除进程信号监听，保证这些资源不再占着进程。本节按 Ctrl+C 会退出程序；第 08 章会进一步区分“中断当前任务”和“退出整个会话”。

### 单次提问仍然怎么用

命令入口只做一次选择：传入 `--prompt` 就完成一次问答，没有传入就启动终端循环。两种方式都调用 `agentLoop()`，也都用 `printReply()` 显示回答。

这样我们只新增了终端输入和历史的保存位置，没有复制一套模型请求或成功规则。一个标准库输入模块、一个历史数组，就能把上一节的单轮执行接成连续会话。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 不传 `--prompt` 时启动连续会话；传入时仍只提问一次。 |
| 新增 | [src/ui/terminal.ts](src/ui/terminal.ts) | 保存历史，逐行读取输入，显示结果并处理退出。 |

## 动手构建

从空目录跟写时，把已经完成的 `chapter-02-model-dialogue/03-agent-loop/src/` 复制到 `chapter-02-model-dialogue/04-conversation/src/`，再在这份代码上继续。下面的 `src/` 均指本节目录；已有配套仓库时无需复制。

### 第一步：实现终端输入循环

创建 `src/ui/terminal.ts`：

```ts
/**
 * 02.4 连续输入与会话历史 | [NEW] ui/terminal.ts
 *
 * 学习目标：持续读取终端输入，并让整个进程中的多轮对话共享同一个 history。
 * 输入：逐行用户文本、/exit、EOF 或 Ctrl+C。
 * 输出：普通文本交给 agentLoop()；本地退出信号直接关闭输入和请求。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-----------+
 *   | read line |
 *   +-----+-----+
 *         +-- EOF / /exit --> 关闭输入 --> 结束
 *         +-- 空行 ----------> 读取下一行
 *         +-- 普通文本 ------> +-----------+
 *                             | agentLoop |
 *                             +-----+-----+
 *                                   | 成功 --> 显示回答 --> 读取下一行
 *                                   | 失败 --> 显示错误 --> 读取下一行
 *   Ctrl+C --> 取消请求 --> 关闭输入 --> exit 130
 *
 * 关键点：history 在 while 外创建，所以第二轮能带上第一轮问答。失败时显示提示并继续等待，成功时打印回答。
 * 交互终端中“你”为青色、“Agent”为紫色；管道和文件输出不包含 ANSI 控制字符。
 * 这个 while 等待不同的用户输入，不是 Agent 内部处理工具调用的循环。
 * 运行观察：连续提问时保留上下文；退出再启动后历史重新为空。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { UserFacingError } from "../config/load-config.js";
import type { Message, Model, Reply } from "../models/client.js";

// [NEW 02.4] 本文件以下实现均为本节新增。
// ANSI 颜色只用于交互终端：用户标签为青色，Agent 标签为紫色。
// 输出被管道或文件接收时不加控制字符，便于日志和脚本读取。
/**
 * 只在交互终端中给标签加上颜色。
 *
 * text 是要显示的标签，color 是 ANSI 颜色编号。
 * stdout 连接终端时返回带颜色的字符串；输出到文件或管道时返回原文，
 * 这样日志和后续程序读到的内容就不会混入颜色控制字符。
 */
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

// [NEW 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续接收用户输入，让每轮问答按顺序使用同一份历史。
 *
 * model 已由入口创建，用户文字从标准输入逐行取得。
 * 历史在循环外创建；每次等 agentLoop() 完成，再显示回答或错误、处理下一行。
 * 单轮失败保留已有成功历史，用户可以继续输入。
 * /exit 或 EOF 结束会话；Ctrl+C 还会取消当前请求，并设置退出码 130。
 * 历史只在本进程中保留，函数结束时清理输入和监听，不会把聊天写入磁盘。
 */
export async function startTerminal(model: Model): Promise<void> {
  const history: Message[] = [];
  const controller = new AbortController();
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal });
  // 提前建立异步迭代器，输入会按行排队；管道一次输入多行时也不会丢掉后面的行。
  const lines = input[Symbol.asyncIterator]();
  const stop = () => {
    controller.abort();
    input.close();
    process.exitCode = 130;
  };
  // 终端内的 Ctrl+C 和进程收到的 SIGINT 都停止请求并退出；本章还没有“取消后续聊”。
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.log("Hello，My Agent！输入消息开始对话，输入 /exit 退出。");
  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.next();
      if (done) break; // EOF：输入结束，正常退出。
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        const reply = await agentLoop(model, history, text, controller.signal);
        if (controller.signal.aborted) break;
        printReply(reply);
        process.exitCode = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"} 本轮未加入历史，可重新输入。`);
        process.exitCode = 1;
      }
    }
  } finally {
    // 离开会话时都要关闭输入并移除监听，避免仍有资源让进程无法结束。
    controller.abort();
    input.close();
    process.off("SIGINT", stop);
  }
}

// [NEW 02.4] 将显示集中在终端层，单次提问和连续对话都调用它。
/**
 * 把模型返回的文本显示给用户。
 *
 * 输入是统一的 Reply，输出加上 Agent 标签，颜色只在交互终端出现。
 * 单次提问与连续会话共用这里，因此显示方式一致。
 * 这个函数不修改历史，也不会再次请求模型。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
}
```

`history` 在 `while` 外创建，整个会话只使用这一份数组。`await agentLoop(...)` 位于读取下一行之前，因此各轮按顺序完成。颜色代码 `36` 把“你”显示为青色，`35` 把“Agent”显示为紫色；非交互输出不加颜色。这里的代码与[本节源码](src/ui/terminal.ts)一致，EOF、SIGINT 和资源清理也都在这个函数中处理。

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

没有 `--prompt` 时，进程进入连续会话；传入 `--prompt` 时，仍然只执行一次并退出。原来 `cli.ts` 里的 `colorLabel()` 已移到终端模块，可以删除；`UserFacingError` 仍用于拒绝空白提问，继续保留导入。

### 第三步：准备模型配置

确认根目录 `.env` 中已有可用模型配置。可以从仓库根目录或本小节目录运行，配置读取会向上找到最近项目的 `.env`。

### 第四步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.4
```

这条 npm 命令只构建并注册本节，不会进入连续对话，也不会调用模型。准备开始对话时运行：

```bash
hello-my-agent
```

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

## 本节完成后的 Agent

此时，Agent 已经可以在一个终端会话中连续工作：

```text
终端读取一行
   -> agentLoop(history, input)
   -> 模型返回回答，核心保存本轮消息
   -> 终端显示回答
   -> 使用同一个 history 等待下一行
```

现在，后一次提问可以使用前面的成功问答，失败的一轮则不会留进历史。我们先用 OpenAI 兼容协议完成了这种会话；下一节改接 Anthropic，看看怎样转换消息格式，让终端和保存历史的规则继续使用。
