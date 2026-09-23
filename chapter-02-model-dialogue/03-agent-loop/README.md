# 02.3 建立 Agent Loop 核心

[第二章导航](../README.md) · [上一节](../02-first-reply/README.md) · [下一节：02.4](../04-conversation/README.md)

**本节目标：把组织消息、请求模型和保存成功问答从命令入口中分离出来，形成一轮独立的 Agent 执行。**

## 问题：一次请求结束后，什么时候算完成了一轮问答

上一节已经能向模型提问一次。接下来，我们想在同一段对话中继续问，让后一轮用到前面的回答。这样一来，程序就得决定：一轮问答在什么时候加入历史？

如果刚收到用户问题就保存，请求随后却失败了，历史里会多出一条没有回答的问题。下一次提问又把它发给模型，模型看到的上下文就和用户以为已经完成的对话不同。

现在就需要定好这条规则：先尝试完成本轮请求，成功后再把问题和回答一起保存。以后从命令参数提问，或在终端连续输入，都应该用同一套处理过程。

## 解决方案：把一轮问答交给 agentLoop()

我们新增 `agentLoop()`，接收模型、已有历史、本轮问题和取消信号。它先准备要发给模型的消息，等待回答，确认没有取消后再更新历史。

CLI 仍负责取得输入和显示结果；新函数负责回答“一轮执行怎样完成”。第三章加入工具后，模型需要继续请求工具还是可以结束，也会在这里判断。

```text
+-----------+      +-------------------------+
| input     | ---> | candidate messages      |
| history   |      | history + user message  |
+-----------+      +------------+------------+
                                |
                                v
                         +-------------+
                         | model       |
                         | generate()  |
                         +------+------+
                                |
                 +--------------+--------------+
                 | 失败 / 取消                 | 回答
                 v                             v
       history 保持不变               返回后已取消？
                 |                         | 是 --> history 保持不变
                 |                         | 否
                 v                         v
               抛错               保存 user + assistant
                                           |
                                           v
                                      返回 Reply
```

本节从外面看仍然是回答一次后退出。变化在于，消息怎样组织、何时保存，已经有了一个共同的处理位置。

## 工作原理

### 先看历史里应该留下什么

会话历史不是“程序碰到的所有输入”，而是后续请求要使用的对话记录。本节采用一个简单规则：只留下已经得到回答、并且没有取消的一轮问答。

例如，前一轮已经完成，用户又提出一个问题。程序需要把旧历史和这个新问题一起发给模型，但此时还不知道请求能否成功。所以，先另建一个本轮消息数组：

```ts
const userMessage: Message = { role: "user", content: input };
const messages: Message[] = [...history, userMessage];
const reply = await model.generate(messages, signal);
history.push(userMessage, { role: "assistant", content: reply.text });
return reply;
```

这段是省略取消检查的主线。`messages` 包含“已完成历史 + 正在尝试的新问题”；`history` 暂时保留原样。模型请求成功后，程序才把 `user` 和 `assistant` 两条消息一起追加进去。

如果 `await model.generate()` 抛错，后面的 `push()` 就不会执行，原历史也没有被改动。下一次请求仍从上一段完整对话继续。先准备、成功后再保存，比先改历史、失败时再撤销更直接，也不会遗漏某个错误分支的撤销操作。

展开语法在这里创建的是新数组，没有深拷贝里面的每个消息对象。当前流程只在新数组末尾追加本轮问题，不修改旧消息对象，因此足够把这次尝试与原历史分开。

### 用户取消了，刚好返回的回答还要保存吗

不应该。取消表示调用方已经不再需要本轮结果，所以核心在请求前和保存前各检查一次 `signal.throwIfAborted()`。

请求前的检查避免已经取消的任务继续发请求；保存前的检查则处理另一种时序：请求已经返回，但取消也已生效。此时程序跳过历史更新，不把这轮记成完成。

取消信号来自调用方。核心只检查和传递它，不读取键盘。`AbortSignal` 也不会凭空停止一切工作：网络请求如何中止，由接收它的 SDK 处理。02.4 会把终端的 Ctrl+C 接到这条信号上。

### 为什么这个函数叫 Agent Loop，却还没有 while

在用过的 Coding Agent 中，一条用户请求常常会触发多次模型调用。模型先提出需要的操作，程序执行，再把结果发回去；模型根据结果决定继续还是回答。这种“调用模型、检查结果、决定下一步”的过程叫 Agent Loop。

下面是第三章才会加入的工具路径，用来说明这个名字中的“Loop”：

```text
调用模型 --> 有工具请求？
               | 是 --> 执行工具 --> 追加工具结果 --> 再调用模型
               | 否 --> 返回最终回答
```

模型并不会因为说了一句“读取文件”，就让本机自动打开文件。真正的操作和是否继续，都由程序控制。[OpenAI 的 Agent Loop 说明](https://openai.github.io/openai-agents-js/guides/running-agents/#the-agent-loop)介绍了这种继续与结束的过程；[Anthropic 的 Agent 构建说明](https://www.anthropic.com/engineering/building-effective-agents)也用模型根据反馈决定后续步骤来解释 Agent。

当前我们只实现模型直接返回文本的路径，收到回答就结束一轮，没有需要重复执行的分支。因此先写一个普通异步函数就够了。第三章会在同一位置加入工具结果回传、再次调用模型和轮次上限。

### 谁保留历史，谁更新这一轮

`history` 由调用方创建，`agentLoop()` 在成功后更新它。这样的分工让历史能保存多久由输入方式决定，而成功规则只有一份。

本节 CLI 传入空数组：

```ts
const reply = await agentLoop(model, [], options.prompt, signal);
```

这表示本次没有旧对话。函数虽然保存了新问答，命令随后就退出，历史也随进程消失。下一节，终端模块会在循环外保存同一个数组，每读到一个问题就交给这个函数，这份历史才会跨轮使用。

同一个历史数组要按顺序交给核心。若两轮同时读写，后发出的请求可能先返回，保存顺序就不再与对话顺序一致；02.4 会通过逐轮等待来保证顺序。

### 为什么一个函数就够了

本节需要的四样输入都可以直接传入：模型、历史、问题和取消信号。函数等待一次回答，成功后更新历史并返回 `Reply`，无需额外保存一份内部状态。

这也让核心可以独立验证：把真实模型换成同样提供 `generate()` 的内存对象，就能稳定地制造成功、失败和取消，不依赖远端服务碰巧出错。`import type` 只导入这些 TypeScript 类型，编译后不会因此加载 SDK。

我们自己实现这几个步骤，是为了看清消息与历史怎样变化。等读懂这个过程，再使用框架的 Runner 时，也就能判断它替程序管理了什么，而不只是记住一个调用方法。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 组织本轮候选消息，成功且未取消时提交问答。 |
| 修改 | [src/cli.ts](src/cli.ts) | 将直接请求模型改为调用 `agentLoop()`。 |

## 动手构建

从空目录跟写时，把已经完成的 `chapter-02-model-dialogue/02-first-reply/src/` 复制到 `chapter-02-model-dialogue/03-agent-loop/src/`，再在这份代码上继续。下面的 `src/` 均指本节目录；已有配套仓库时无需复制。

### 第一步：实现一轮 Agent 执行

创建 `src/agent/agent-loop.ts`：

```ts
/**
 * 02.3 建立 Agent Loop 核心 | [NEW] agent/agent-loop.ts
 *
 * 学习目标：把一轮问答放到同一个函数中处理，并在成功且未取消后保存问答。
 * 输入：CLI 提交的用户文本、已有 history 和 AbortSignal。
 * 输出：最终回答返回 CLI；失败或取消时抛错，history 保持不变。
 *
 * 全局主流程（本节版本）：
 * 调用前已取消 -> 抛错，不发请求；未取消 -> 进入下面的请求过程。
 *
 * [KEEP 02.2]          [NEW 02.3]             [KEEP 02.2]
 * +------------+      +----------------+      +-----------------+
 * | CLI input  | ---> | agentLoop      | ---> | model.generate  |
 * +------------+      | history+input  |      | provider API    |
 *                     +-------+--------+      +--------+--------+
 *                             ^                        |
 *                             |                 成功返回文本？
 *                             |                 +------+------+
 *                             |                 | 否          | 是
 *                             |                 v             v
 *                             |          history 不变    再检查取消？
 *                             |          向外抛错        | 是 -> 不提交
 *                             |                          | 否
 *                             |                          v
 *                             +---------- append user + assistant
 *                                                        |
 *                                                        v
 *                                                   CLI 显示回答
 *
 * [NEW] 表示本节建立的核心；[KEEP] 表示从前一节沿用的入口和模型请求。
 * 关键点：agentLoop 先准备本轮消息，等模型返回且确认未取消，再把问题和回答一起存进历史。
 * 当前只有“模型直接回答”路径；工具请求与重复调用会在第三章接入这张图。
 * 运行观察：成功保存两条消息，失败和取消保存零条消息。
 */

import type { Message, Model, Reply } from "../models/client.js";

// [NEW 02.3] 本文件以下实现均为本节新增。
// 本轮只接收普通文本，成功后一起保存 user 与 assistant 消息。
// 调用方需要等这一轮结束，再把同一 history 交给下一轮，避免两轮同时修改历史。
/**
 * 完成当前这轮文本问答，成功且未取消后才把问答存进历史。
 *
 * model、history、input 和 signal 都由调用方提供；同一份 history 要按顺序使用。
 * 先用旧历史和新问题创建本轮消息数组，再等待模型返回，最后再次检查取消。
 * 通过检查后，把用户问题与模型回答一起追加到 history，并返回 Reply 给调用方显示。
 * 请求失败或取消时抛出异常，原历史保持不变；本节还没有需要重复调用模型的工具分支。
 */
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  // 1. 先检查取消，再用旧历史和新问题另建一个数组；这一步还不修改 history。
  signal.throwIfAborted();
  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];

  // 2. 调用模型。协议转换与空回答检查由 models/client.ts 完成。
  // [第 03 章扩展位置，尚未实现] 在这里处理工具调用 -> 回传结果 -> 再调用模型。
  const reply = await model.generate(messages, signal);

  // 3. 再检查取消，然后把问答一起存进历史；服务刚好返回也不等于用户仍需要这轮结果。
  signal.throwIfAborted();
  history.push(userMessage, { role: "assistant", content: reply.text });
  return reply;
}
```

两次 `throwIfAborted()` 分别在请求前和保存前检查取消。`messages` 是本轮要发给模型的消息；只有模型成功返回且仍未取消，函数才修改 `history`。这里的完整文件也就是[本节源码](src/agent/agent-loop.ts)。

### 第二步：让 CLI 调用核心

在 `src/cli.ts` 中导入：

```ts
import { agentLoop } from "./agent/agent-loop.js";
```

上一节的颜色函数继续保留在 `program` 创建后，无需再添加一份：

```ts
const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;
```

把上一节直接调用 `model.generate()` 的两行替换为：

```ts
const reply = await agentLoop(model, [], options.prompt, signal);
console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
```

这里传入空数组，所以命令仍然只回答一次。下一节会把长期存在的数组交给同一个函数。

### 第三步：准备模型配置

确认根目录 `.env` 中已有可用的 OpenAI 兼容配置。本节用真实请求观察成功路径，再用内存模型检查无法从终端直接观察的失败路径。

### 第四步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.3
```

这条 npm 命令只构建并注册本节，不执行 Agent Loop。要观察一轮真实请求，再运行：

```bash
hello-my-agent --prompt "用一句话解释什么是 CLI。"
```

## 运行验证

仍然只收到一次回答，然后退出。这是有意保持的行为；本节先把核心放到合适的位置，下一节才延长历史的生命周期。

在根目录执行本节检查：

```bash
npm run check:02.3
```

检查使用内存模型直接调用 `agentLoop()`，确认成功时保存完整问答，失败和取消时历史保持不变。它不读取 `.env`，也不使用真实密钥。

## 失败实验

真实命令可以通过无效地址观察“请求失败并退出”，但进程退出后，内存数组也已消失，无法直接查看。因此，失败后历史不变由上面的确定性检查证明：测试在同一个进程中保留数组，请求失败后立即比较失败前后的内容。

## 小练习

解释为什么代码先创建 `messages = [...history, userMessage]`，而不是先执行 `history.push(userMessage)`。

参考答案：候选数组允许模型先尝试处理本轮输入。请求失败或被取消时，原 `history` 没有变化；如果提前 `push()`，下一次请求就会带上这条没有回答的失败提问。

## 本节完成后的 Agent

此时，模型调用已经进入独立的 Agent 核心：

```text
CLI -> agentLoop(history, input)
              -> 组织候选消息
              -> 调用模型
              -> 成功后提交 user / assistant 消息
              -> 返回最终回答
```

Agent Loop 已经掌握“一轮任务何时成功、何时可以写入历史”，但 CLI 执行一次后进程就结束，内存中的历史没有机会被下一轮使用。下一节将加入终端输入循环，让多轮输入共享同一个 `history`。
