# 02.2 向模型提问一次

[第二章导航](../README.md) · [上一节](../01-configuration/README.md) · [下一节：02.3](../03-agent-loop/README.md)

**本节目标：让 `hello-my-agent --prompt "你好"` 向 OpenAI 兼容接口发送一次请求，输出回答后退出。**

## 问题：配置读到了，怎样让模型真正回答一次

上一节的“配置已就绪”只表示本地字段齐全、地址格式符合要求。我们还没有把任何问题发出去，密钥能否使用、模型是否存在、网络能否连接，都还不知道。

这次就从一句“用一句话解释什么是 CLI”开始。命令行收到的是字符串，远端服务需要的却是一份带模型名、消息角色和认证信息的请求。发送之后，程序还得等它回答，再从响应中取出可以显示的文本。

我们先完成这一来一回：运行命令，得到一条回答，结束进程。等这个过程清楚了，再加入连续对话。

## 解决方案：由模型模块发送请求，入口等待并显示回答

我们使用 OpenAI SDK 处理网络请求，在它外面放一个很小的模型模块。入口把问题交给模块的 `generate()` 方法，等待它返回 `{ text }`，再显示给用户。

SDK 负责请求地址、认证和网络收发；模型模块负责把本书的消息转成接口要求的格式，并检查返回的内容能否作为本节的回答。

```text
+------------------+
| --prompt <text>  |
+--------+---------+
         |
         v
 readConfig --> createModel
         | 失败 --> 显示提示 --> 结束
         | 成功
         v
   +------------+
   | non-empty? |
   +--+------+--+
      | 否   | 是
      v      v
   显示提示   SDK 请求
               |
       +-------+-------+
       | 失败          | 响应
       v               v
    显示提示      有可用文本？
                  | 否 --> 显示提示
                  | 是
                  v
            显示回答 --> 结束
```

配置和问题检查通过后才会发出请求。空白问题、网络失败或没有可用文本都会显示提示，不会被当成一次正常回答。

## 工作原理

### 模型收到的不只是一个字符串

聊天接口使用带角色的消息，让服务区分“程序给出的说明”和“用户提出的问题”。本节的一次请求包含两部分：系统提示词说明助手要做什么，`user` 消息保存本轮问题。

```ts
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}
```

这里的 `Message` 表示本地问答消息，`user` 是用户输入，`assistant` 是模型回答。本节只有一条用户消息；`assistant` 会在后面的会话历史中用到。系统提示词单独保存在配置模块，发送时由模型模块放在最前面，成为 `role: "system"` 的消息。

系统说明把助手描述为“运行在命令行中的个人编程 Agent”，并说明当前只能文本对话。这样，模型得到的职责与实际程序相符：可以解释代码，却没有读取文件或执行命令的工具。提示词不能保证模型永远说对，但程序不能在尚未提供能力时，先告诉它这些事已经能做。

### SDK 怎样把消息送到模型，再把回答带回来

`createModel()` 根据上一节的 `Config` 创建客户端。这一步只是准备好连接配置，还没有发送问题。真正调用 `generate()` 时，模块才把消息交给 `client.chat.completions.create()`。

```text
JavaScript 消息对象
  -> SDK 生成 JSON、请求地址和认证信息
  -> Node 把 HTTP(S) 请求交给操作系统发送
  -> 模型服务返回 HTTP 响应
  -> SDK 把响应 JSON 还原成 JavaScript 对象
```

SDK 是本地的客户端库，模型仍在服务端运行。它省去了手写 HTTP 请求的重复工作，但本地程序仍然决定使用哪个模型、发送哪些消息，以及怎样处理结果。地址、连接或证书有问题时，请求可能还没到模型就已经失败。

本节使用非流式响应，也就是等待完整响应后再显示。这样先看清一次请求何时成功、何时失败；第 08 章再加入边生成边显示的流式输出。

### 等待模型时，程序停在哪里

网络回答不会在调用函数的瞬间出现，所以 `generate()` 返回 `Promise<Reply>`。Promise 表示这项操作还在进行，将来可能得到结果，也可能失败。

```text
调用 generate()
  -> 得到一个 Promise
  -> await 暂停当前 async 函数
  -> Node 继续处理计时器、信号等事件
  -> 网络响应到达，Promise 完成
  -> 当前函数从 await 后面继续执行
```

`await` 让当前函数在这里等，并没有卡住整个 Node 进程。只有请求成功完成，程序才会继续读取 `reply.text`；请求抛错时，则转到外层的错误处理。

命令入口也要等待这个过程。因此 `.action()` 改为 `async`，最外层使用 `await program.parseAsync()`。普通 `parse()` 不会等待异步 action 的 Promise；即使网络连接让进程暂时没有退出，外层的 `try/catch` 也不能靠同步调用接住之后才发生的拒绝。使用异步解析，等待和错误处理才能覆盖整个请求。

为了避免一次输入长时间没有结果，客户端把超时设为 60 秒，并关闭自动重试。`AbortSignal` 则把调用方的取消状态传给 SDK；02.4 接入 Ctrl+C 时会用到它。

### 网络请求成功，为什么还要检查文本

SDK 返回对象以后，程序从 `choices[0].message.content` 读取第一项回答。但 HTTP 成功不等于本节一定得到了可显示的文本：第一项可能不存在，文本可能为空，响应也可能要求调用工具。

当前程序只会显示纯文本，所以模型模块要检查文本存在、去掉空白后仍有内容，并且没有工具请求。满足这些条件才返回 `{ text }`；不满足就给出明确提示。工具请求需要本地程序执行并回传结果，第三章才会加入，当前不能把它当成空回答悄悄略过。

TypeScript 能帮助我们按正确方式访问 SDK，但不会在运行时自动检查网络返回的每个字段。这些判断仍要由程序完成。

### 为什么让入口只接收 Reply

CLI 需要的是“发出问题后得到一段回答”，并不需要理解 `choices` 的嵌套结构。我们用 `Model` 约定这一点：接收消息和取消信号，返回 `Reply`。`generate()` 是本书的本地方法名，不是服务商规定的接口名称。

运行时，`createModel()` 返回的是一个普通对象，它带有 `generate()` 函数。TypeScript 的接口在编译后会被删除，不会生成额外的基类。到了 02.5，Anthropic 虽然使用另一种请求和响应格式，只要模型模块仍返回相同的 `Reply`，入口就能继续显示。

命令入口当前这样使用它，下面只展示调用和显示两行：

```ts
const reply = await model.generate([{ role: "user", content: options.prompt }], signal);
console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
```

这里的问题已经检查过非空，`signal` 来自 `AbortController`。本节每次启动都只有这个问题，还没有保存历史。

### 这次为什么选择 Chat Completions 和官方 SDK

本章要学习的是消息怎样进出模型服务，还要在后面与 Anthropic Messages 对照，所以先使用 OpenAI 兼容的 Chat Completions 消息格式。SDK 已经处理认证、JSON、超时和取消，我们只补上当前程序需要的消息转换与文本检查。

直接使用 `fetch()` 也能完成请求，但需要自己处理这些通用细节。直接让 `cli.ts` 调 SDK 会少一个文件，却会让命令参数和协议字段混在一起；增加第二种协议时，入口也得跟着改。本节的模型模块把这部分转换放在一个明确的位置。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 加入 `--prompt`，创建模型并等待一次回答。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 提供随请求发送的系统提示词。 |
| 新增 | [src/models/client.ts](src/models/client.ts) | 使用 OpenAI SDK 发送纯文本消息并返回 `Reply`。 |

## 动手构建

先按[下一小节的跟写方法](../../docs/SETUP.md#进入下一小节时怎样继续跟写)，把已经完成的 `chapter-02-model-dialogue/01-configuration/src/` 复制到 `chapter-02-model-dialogue/02-first-reply/src/`。下面只修改本节这份代码，文中的 `src/` 也都指向本节；已有配套仓库时无需复制。

### 第一步：增加系统提示词

在 `src/config/load-config.ts` 的类型定义后加入：

```ts
export const systemPrompt =
  "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。" +
  "当前阶段只能进行文本对话，尚未获得读取文件、修改代码或执行命令的工具；" +
  "不要声称已经执行这些操作。";
```

系统提示词描述 Agent 当前真实拥有的能力。它不能阻止模型犯错，但可以减少模型声称已经读取文件或执行命令的情况。

### 第二步：实现模型模块

创建 `src/models/client.ts`，完整文件如下。先看请求怎样变成 `Reply`，再把它接进入口：

```ts
/**
 * 02.2 向模型提问一次 | [NEW] models/client.ts
 *
 * 学习目标：把普通消息转换成 OpenAI Chat Completions 请求，并取出可用的文本回答。
 * 输入：模型配置、user/assistant 消息数组和 AbortSignal。
 * 输出：{ text }；空文本或工具调用会抛出 UserFacingError。
 *
 * 本文件局部流程（当前启动主流程见 cli.ts）：
 *   +----------+   +---------------+   +-------------+   +----------+
 *   | messages |-->| add system    |-->| SDK request |-->| response |
 *   +----------+   +---------------+   +-------------+   +----+-----+
 *                                                             v
 *                                                        可用文本？
 *                                                         | 否 --> UserFacingError
 *                                                         | 是 --> Reply
 *
 * 关键点：超时设为 60 秒，关闭自动重试和调试日志，避免一次输入被重复发送或敏感响应进入日志。
 * 运行观察：得到可用文本时返回 Reply；空回答会抛错，由调用方显示原因。
 */

import OpenAI from "openai";
import { systemPrompt, UserFacingError, type Config } from "../config/load-config.js";

// [NEW 02.2] 本文件以下实现均为本节新增。
// user 是提问，assistant 是模型回答；暂时只处理纯文本。
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };
// generate 是本地 TypeScript 方法，真正的服务商请求由下方 SDK 方法完成。
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}

/**
 * 准备一个能接收消息、返回回答的 OpenAI 兼容模型对象。
 *
 * config 来自 readConfig()，已经检查过必填值和地址格式。
 * 创建 SDK 客户端时不发送请求；调用返回对象的 generate() 才会请求服务。
 * 客户端设置 60 秒超时，并关闭自动重试和日志，避免一次输入被重复发送或输出原始请求信息。
 * 请求异常继续交给调用方处理，历史也由调用方管理。
 */
export function createModel(config: Config): Model {
  const client = new OpenAI({
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off",
    organization: null, project: null,
  });
  return {
    /**
     * 发送这次消息，并从 OpenAI 兼容响应中取出可用的文本。
     *
     * messages 是调用方准备的问答，signal 用来传递取消状态。
     * 程序先在消息前加入系统说明，再等待 SDK 请求；响应有非空文本且没有工具请求时返回 { text }。
     * 不满足本节要求时抛出 UserFacingError，网络或取消等 SDK 异常继续向外传递。
     * 这个方法只负责消息收发和结果检查，不会修改传入的历史数组。
     */
    async generate(messages, signal) {
      // system 说明规则，user/assistant 保存问答；每次请求都重新传入上下文。
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: false,
      }, { signal });
      const choice = response.choices?.[0];
      const text = choice?.message?.content;
      // 尚无工具能力；拒绝工具调用或空文本，避免把无效响应当作成功回答。
      if (typeof text !== "string" || !text.trim() || choice?.message?.tool_calls?.length) {
        throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
      }
      return { text };
    },
  };
}
```

`createModel()` 只创建一次 SDK 客户端。`generate()` 每次接收当前消息，发送请求，然后把复杂响应收敛成 `{ text }`。这样 CLI 不需要知道 `choices[0]` 等协议字段。

### 第三步：接入命令入口

在 `src/cli.ts` 中加入模型模块导入和包含 `prompt` 的选项类型：

```ts
import { createModel } from "./models/client.js";

type CliOptions = Options & { prompt?: string; doctor?: boolean };

const colorLabel = (text: string, color: number) =>
  process.stdout.isTTY ? `\u001b[${color}m${text}\u001b[0m` : text;
```

保留已有的 `--doctor`、`--model` 和 `--base-url`，在这些选项后新增 `--prompt`，然后替换 `.action()`。下面从新增选项开始展示；环境诊断继续在读取配置和创建模型之前结束。

```ts
// [CHANGED 02.2] 保留原有选项，在其后增加提问与异步处理。
.option("--prompt <text>", "提问一次后退出")
.action(async () => {
  const options = program.opts<CliOptions>();
  if (options.doctor) {
    printDoctor();
    return;
  }
  const config = readConfig(options);
  const model = createModel(config);
  if (!options.prompt?.trim()) {
    throw new UserFacingError('请使用 --prompt "你好" 提问。');
  }
  const signal = new AbortController().signal;
  const reply = await model.generate(
    [{ role: "user", content: options.prompt }],
    signal,
  );
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
});
```

颜色代码 `35` 表示紫色。只有 `stdout` 连接交互终端时才添加 ANSI 颜色；输出被重定向到文件或管道时仍是普通文本。

底部把同步解析改成异步解析：

```ts
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${error instanceof UserFacingError ? error.message : "模型请求失败，请检查配置和网络。"}`);
  process.exitCode = 1;
}
```

### 第四步：准备真实模型配置

在根目录 `.env` 中填写 [02.1 介绍的三项配置](../01-configuration/README.md#第三步填写第一组配置)。本节开始真正请求服务，需要使用有效的 Key、模型 ID 和基础地址，不能继续用练习假值。

OpenAI 分支使用 [Chat Completions](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)：程序提交模型 ID 和带角色的消息数组，接口返回 `choices`，本节从第一项选择中提取回答文本。只提供 Responses 接口、没有实现 Chat Completions 请求格式的网关不适用。

OpenAI 官方目前建议新项目优先评估 Responses API；本教程选择 Chat Completions，是因为本章目标是先实现广泛使用的 OpenAI 兼容消息协议，并与 Anthropic Messages 对照学习。这里讲解的是协议边界，不表示所有 OpenAI 新项目都应选择同一个接口。

### 第五步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.2
```

这条 npm 命令只完成依赖安装、编译和命令注册，不调用模型。准备好真实请求后，再运行：

```bash
hello-my-agent --prompt "用一句话解释什么是 CLI。"
```

这条 `hello-my-agent` 可以在仓库根目录运行，也可以进入当前 `02-first-reply` 目录后运行。配置读取会向上找到仓库根目录的 `.env`。

## 运行验证

应看到一行 `Agent > ...`，然后进程退出；实际回答不固定。暂时没有交互输入框、历史或用量显示。

## 失败实验

运行 `hello-my-agent --prompt "   "`。程序应该提示填写提问，不应发送网络请求。再把密钥临时改成无效值，程序应显示安全的通用失败提示，不应打印请求头或完整响应。

## 小练习

把提问改成“只回答 OK”，观察程序是否仍在打印一条回答后退出。思考：如果想继续输入，历史数组应该由哪个模块长期保存？

参考答案：本节仍会回答一次后退出。连续会话的历史应由负责输入生命周期的终端模块保存，再把同一个数组交给每一轮 `agentLoop()`；02.4 会实现这个模块。

## 本节完成后的 Agent

此时，Agent 已经具备一条最短的模型调用链：

```text
用户问题 -> CLI -> Config -> Model.generate() -> 模型服务 -> 最终回答 -> 终端
```

我们已经能通过命令完成一次真实问答，不过问题还由入口临时组成消息，也没有保存问答的规则。下一节会把一轮处理交给 `agentLoop()`，让程序明确知道什么时候可以把这次问答留给下一轮使用。
