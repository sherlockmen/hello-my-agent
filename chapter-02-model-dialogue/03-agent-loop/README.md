# 02.3 建立 Agent Loop 核心

[第二章导航](../README.md) · [上一节](../02-first-reply/README.md) · [下一节：02.4](../04-conversation/README.md)

**本节目标：实现 Agent Loop 的无工具路径，明确候选消息、模型请求和历史提交的顺序。**

## 问题

上一节已经能得到一次模型回答，但 `src/cli.ts` 同时负责解析命令、创建模型、组织消息、发送请求和显示结果。现在只有一次请求时还能读懂；加入多轮历史、工具调用和取消处理后，入口将同时承担界面与 Agent 执行，任何一种能力变化都会改动同一段主流程。

更关键的问题是状态何时生效。用户问题在请求前已经产生，而模型回答可能成功、失败或被取消。如果先把问题写入正式历史，请求失败后就会留下只有 `user`、没有 `assistant` 的半轮记录，下一次请求会把失败状态继续发给模型。

因此，本节真正要解决的是：**怎样定义一轮 Agent 执行的稳定边界，让它负责构造候选上下文、调用模型，并且只在整轮成功且未取消时提交完整问答。**

## 解决方案

新增 `agentLoop()`，让它负责一轮 Agent 执行：构造本轮上下文、调用模型、确认没有取消，再提交成功的问答。CLI 只把输入交给它。

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

失败和取消都不会留下半轮历史。这条提交规则会在后续连续会话和工具调用中继续使用。

## 工作原理

### 第一步：确定什么属于 Agent 核心

命令行只负责获得用户输入。组织上下文、请求模型、决定何时保存结果，属于一轮 Agent 执行。因此本节新增 [src/agent/agent-loop.ts](src/agent/agent-loop.ts)，将这条主线放在一起。

先把 Agent Loop 理解成一个**由程序控制的反复决策过程**。模型本身不会在你的电脑上不断运行，也不会亲自读取文件或执行命令。每次调用模型，它只根据当前上下文返回一次结果；程序检查这个结果，再决定结束还是继续。

一个完整 Agent Loop 通常按下面的顺序运行：

```text
1. 把用户目标、历史消息和可用工具说明发给模型
2. 检查模型本次返回的结果
   ├─ 最终回答：结束本轮，把回答交给用户
   ├─ 工具请求：校验参数并执行工具，把工具结果加入历史，回到第 1 步
   └─ 转交请求：切换到另一个 Agent，保留已有上下文，回到第 1 步
3. 每继续一次就增加轮次；达到上限仍未结束，则停止并报错
```

这里最容易误解的是“模型调用工具”。模型实际上只返回一段结构化请求，例如“调用 `read_file`，参数是 `{ path: "src/cli.ts" }`”。Agent 程序收到请求后，才会检查工具是否存在、参数是否合法、用户是否允许，然后真正读取文件。读取结果还必须作为一条工具结果消息发回模型，否则模型不知道工具是否成功，也看不到文件内容。

以 Coding Agent 修复测试为例，循环可能经历这些步骤：

```text
用户：修复失败的测试
  -> 模型请求 run_tests
  -> 程序执行测试，把失败日志发回模型
  -> 模型请求 read_file
  -> 程序读取源码，把内容发回模型
  -> 模型请求 edit_file
  -> 程序应用修改，把修改结果发回模型
  -> 模型请求 run_tests
  -> 程序执行测试，把通过结果发回模型
  -> 模型返回最终回答
  -> 循环结束
```

工具结果是模型了解真实环境的依据。模型可以猜测某个文件存在或某次修改会通过测试，但只有文件读取结果和测试输出能证明真实情况。程序还必须设置最大轮数、取消信号或权限检查，否则错误决策可能不断重复并持续消耗时间与 token。token 是模型读取和生成文本时使用的计量单位，不固定等于一个字符或单词。

OpenAI 将这套控制过程描述为“调用模型 → 检查最终回答、工具调用或转交 → 必要时继续 → 超过最大轮数则停止”；Anthropic 则强调 Agent 与固定工作流的区别在于，下一步由模型根据环境反馈动态决定。两者描述的是同一个核心结构：[OpenAI Agent Loop](https://openai.github.io/openai-agents-js/guides/running-agents/#the-agent-loop)、[Anthropic 的 Agent 构建说明](https://www.anthropic.com/engineering/building-effective-agents)。

**本小节只实现“模型直接回答”的无工具路径。** 一次调用便结束本轮，尚无实际重复的工具分支，因此没有放一个只执行一次的 `while`。第 03 章将在这个函数中加入工具调用与轮次上限。

### 第二步：读通核心的三个步骤

先看主流程，完整源码包含逐行注释：

```ts
const userMessage: Message = { role: "user", content: input };
const messages: Message[] = [...history, userMessage];
const reply = await model.generate(messages, signal);
history.push(userMessage, { role: "assistant", content: reply.text });
return reply;
```

第一步用历史和新问题构造候选消息数组。第二步等待模型。第三步在成功后才将一问一答一起加入历史。如果请求抛错，就到不了 `push()`，下次不会带着一条失败的提问继续请求。

完整实现还在请求前、保存前调用 `signal.throwIfAborted()`。如果调用方已经取消，就不应再发请求，也不应保存刚好返回的回答。取消信号由调用方提供；核心不读取键盘，也不操作终端。

`history` 由调用方持有，核心负责提交本轮结果。同一数组按顺序交给核心，不并发修改。`import type` 只导入 TypeScript 类型，编译后核心不会因为这条语句加载 SDK。

### 第三步：理解候选状态和提交状态

`messages` 与 `history` 表示两个不同阶段。`messages` 是即将发送给模型的候选上下文，可以包含尚未成功的本轮输入；`history` 是已经完成的会话状态，只能包含完整问答。

先复制再请求，使一轮执行具备类似事务的性质：准备候选状态，执行可能失败的外部操作，成功后一次提交。如果提前修改 `history`，请求失败后就必须回滚；一旦遗漏回滚，下一轮会把失败问题当成已完成历史发送。

取消存在竞争窗口：请求可能在收到取消信号的同时返回。请求前检查取消可以避免无意义调用；响应后再检查一次，可以防止把用户已经取消的回答提交到历史。`AbortSignal` 负责传播取消状态，真正停止网络请求仍要依赖 SDK 对该信号的支持。

### 第四步：Agent Loop 为什么还没有 while

循环应该由真实的继续条件驱动。当前模型只可能返回纯文本，拿到回答后本轮必然结束；加入只执行一次的 `while` 不会增加能力。第三章加入工具调用后，模型结果会出现“执行工具并继续”和“输出最终回答”两个分支，那时循环才有停止条件和轮次上限。

### 第五步：让入口调用核心

在 [src/cli.ts](src/cli.ts) 导入 `agentLoop()`，只替换原来直接请求模型的位置：

```ts
const reply = await agentLoop(model, [], options.prompt, signal);
```

空数组表示当前调用没有历史，因此命令回答一次后结束。只要调用方长期持有同一个数组，并在每轮继续传入，核心就能在成功后逐步积累会话状态。

### 为什么选择函数而不是类

`agentLoop()` 这一轮只需要四个明确输入：模型、历史、用户文本和取消信号。状态由调用方持有，函数只在成功时提交问答。这让数据流可以从参数直接追到返回值，也方便用内存模型验证失败和取消分支。

类更适合需要长期持有很多内部状态的对象，例如会话 ID、工具注册表和事件订阅。当前只有一个历史数组，而且它的生命周期属于终端；现在引入类只会把状态藏进实例，没有增加能力。

### 还有哪些方案

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 继续在 `cli.ts` 中调用模型 | 当前代码最少 | 工具调度、历史提交和命令参数会逐渐混在一个入口文件。 |
| 先把用户消息写入 `history` | 不需要候选数组 | 请求失败时必须回滚；漏掉回滚会留下半轮状态。 |
| 使用 Agent 框架的 Runner | 工具循环、追踪和生命周期通常已经实现 | 本教程会看不到 Agent Loop 的继续条件和状态提交原理。 |
| 现在就加入 `while` | 外形更像完整 Agent Loop | 当前没有工具分支，循环只能执行一次，没有真实的继续条件。 |

因此本节只提取一个可验证的函数，并保留真实的无工具停止条件。等模型可以返回工具调用时，再在同一个核心中加入循环和轮次上限。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 新增 | `src/agent/agent-loop.ts` | 定义一轮 Agent 执行和历史提交规则。 |
| 修改 | `src/cli.ts` | 把直接模型调用替换为 `agentLoop()`。 |

### 第一步：实现一轮 Agent 执行

创建 `src/agent/agent-loop.ts`：

```ts
import type { Message, Model, Reply } from "../models/client.js";

export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
): Promise<Reply> {
  signal.throwIfAborted();

  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];
  const reply = await model.generate(messages, signal);

  signal.throwIfAborted();
  history.push(userMessage, { role: "assistant", content: reply.text });
  return reply;
}
```

两次 `throwIfAborted()` 分别保护请求前和提交前。`messages` 是本轮候选上下文；只有模型成功返回且仍未取消，函数才修改正式 `history`。[教学注释版源码](src/agent/agent-loop.ts)用流程图标出了这两个失败出口。

### 第二步：让 CLI 调用核心

在 `src/cli.ts` 中导入：

```ts
import { agentLoop } from "./agent/agent-loop.js";
```

如果还没有上一节的颜色函数，在 `program` 创建后加入：

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

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 将直接请求模型改为调用 `agentLoop()`。 |
| 新增 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 组织本轮消息，成功且未取消才提交问答。 |

## 运行验证

仍然只收到一次回答，然后退出。这是有意保持的行为；本节先把核心放到合适的位置，下一节才延长历史的生命周期。

在根目录执行本节检查：

```bash
npm run check:02.3
```

检查使用内存模型直接调用 `agentLoop()`，确认成功时保存完整问答，失败和取消时历史保持不变。它不读取 `.env`，也不使用真实密钥。

## 失败实验

真实命令可以通过无效地址观察“请求失败并退出”，但它退出后无法让你检查内存数组。因此，失败后历史不变由上面的确定性检查证明：测试在同一个进程中保留数组，请求失败后立即比较失败前后的内容。

## 小练习

解释为什么代码先创建 `messages = [...history, userMessage]`，而不是先执行 `history.push(userMessage)`。

参考答案：候选数组允许模型先尝试处理本轮输入。请求失败或被取消时，原 `history` 没有变化；如果提前 `push()`，失败的半轮消息会污染下一次请求。

## 接下来

核心已经独立。下一节让终端保留 history，连续调用同一个核心。
