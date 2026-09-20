# 第 02 章练习：只改终端模块，增加 /reset

[第二章导航](README.md) · [先完成 02.6](06-errors-and-usage/README.md) · [终端代码](06-errors-and-usage/src/ui/terminal.ts) · [完整答案](#完整替换代码)

目标：输入 `/reset` 后清空会话历史，继续等待输入。系统提示词、模型与接口配置不变。

## 工作原理

先把 `/reset` 理解成一个**只修改本地会话状态的终端命令**。它不需要询问模型，也不删除 `.env`、系统提示词或模型配置；它只让后续请求不再携带当前 `history` 中的旧问答。

```text
终端读到一行输入
  ├─ /exit  -> 结束会话
  ├─ /reset -> 清空 history -> 显示提示 -> 继续读下一行
  └─ 普通文本 -> agentLoop -> 模型请求
```

例如，历史原来是：

```text
[用户：暗号是青柠, 助手：记住了]
```

执行 `history.length = 0` 后，原数组变成 `[]`。下一次提问仍使用同一个数组对象，但请求中已经没有旧问答。`const history` 只禁止把变量重新指向另一个数组，不禁止修改这个数组的内容。

最容易误解的是把 `/reset` 交给 `agentLoop()`。那样模型只会收到一条内容为 `/reset` 的普通用户消息，本地数组不会自动清空。因此终端必须在模型调用前识别它，并用 `continue` 跳过本轮请求。

终端负责本地命令和 `history` 的生命周期，所以修改发生在 `ui/terminal.ts`。本练习只清空当前进程中的问答；退出后本来就会丢失历史，跨进程会话和服务端会话不在本练习范围内。

## 只增加这段判断

在 `/exit` 判断之后、调用 `agentLoop()` 之前加入：

```ts
if (text === "/reset") {
  history.length = 0;
  console.log("已清空当前对话，下次提问将开始新的上下文。");
  continue;
}
```

`const` 只是禁止变量指向另一个数组，仍允许修改数组内容。`length = 0` 清空所有消息；`continue` 跳过模型调用，因此 `/reset` 本身不会发送出去。

## 完整替换代码

用下面代码替换 **`06-errors-and-usage/src/ui/terminal.ts`**。只修改这个文件。

<!-- solution: src/ui/terminal.ts -->
```ts
/**
 * 02.6 练习：输入 /reset，开始一段新对话。
 *
 * 学习目标：增加一个只修改本地会话状态、不会发送给模型的 /reset 命令。
 * 输入：普通文本、/reset、/exit、EOF 或 Ctrl+C。
 * 输出：/reset 清空 history 并继续等待；其他输入保持 02.6 的处理方式。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-----------+
 *   | read line |
 *   +-----+-----+
 *         +-- /exit ----> 关闭输入 --> 结束
 *         +-- /reset ---> +--------------------+ --> 显示提示 --> 读取下一行
 *         |               | history.length = 0 |
 *         |               +--------------------+
 *         +-- 普通文本 --> +-----------+ --> 模型 --> 显示回答 --> 读取下一行
 *                          | agentLoop |
 *                          +-----------+
 *
 * 关键点：把数组 length 设为 0，旧问答就不再进入下一次请求。
 * continue 跳过 agentLoop 调用，所以 /reset 本身不会发送给模型。
 * 系统提示词和模型配置不在 history 中，清空问答不会清空它们。
 * 交互终端中“你”为青色、“Agent”为紫色；管道和文件输出保持纯文本。
 * 运行观察：先对话，再输入 /reset；下一次请求中不再包含之前的 user/assistant 消息。
 */

import { createInterface } from "node:readline";
import { agentLoop } from "../agent/agent-loop.js";
import { explainError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

// ANSI 颜色只用于交互终端；管道和日志仍得到不含控制字符的纯文本。
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;

// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/** 等待输入 -> 调用 agentLoop -> 显示回答；会话内的各轮请求顺序执行。 */
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
  // [CHANGED 练习] 提示新增的本地命令。
  console.log("Hello，My Agent！输入消息开始对话，输入 /reset 清空历史，输入 /exit 退出。");
  try {
    while (!controller.signal.aborted) {
      if (terminal) process.stdout.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.next();
      if (done) break; // EOF：输入结束，正常退出。
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      // [NEW 练习] 修改数组内容即可清空历史；continue 避免把 /reset 发给模型。
      if (text === "/reset") {
        history.length = 0;
        console.log("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      try {
        // 终端只把输入交给核心，历史的提交规则集中在 agent/agent-loop.ts。
        const reply = await agentLoop(model, history, text, controller.signal);
        if (controller.signal.aborted) break;
        printReply(reply);
        process.exitCode = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`错误：${explainError(error)} 本轮未加入历史，可重新输入。`);
        process.exitCode = 1;
      }
    }
  } finally {
    // 正常退出和异常退出都关闭输入、移除监听，避免终端或请求一直占用进程。
    controller.abort();
    input.close();
    process.off("SIGINT", stop);
  }
}

// [KEEP 主线 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
```

## 运行与观察

替换源码后，在根目录执行：

```bash
npm run lesson:02.6
```

```bash
hello-my-agent
```

第一条命令只构建并注册练习所在小节，不调用模型；第二条命令才开始连续对话。先让模型记住“青柠”，收到回答后输入 `/reset`，再问“暗号是什么”。应看到清空提示。模型可能猜测答案，因此严格检查应看请求中是否还包含旧消息。

运行下面的练习验收，它会编译你刚刚修改的 `06-errors-and-usage/src/ui/terminal.ts`，再检查 `/reset` 是否清除了 OpenAI 和 Anthropic 两种协议的历史消息：

```bash
npm run exercise:02
```

验收使用本地模拟接口，不读取 API Key，也不访问外网。通过后进入第三章时，`/reset` 会作为已经完成的会话能力继续保留。
