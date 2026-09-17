# 02.2 向模型提问一次

[第二章导航](../README.md) · [上一节](../01-configuration/README.md) · [下一节：02.3](../03-agent-loop/README.md)

**本节目标：让 `hello-my-agent --prompt "你好"` 向 OpenAI 兼容接口发送一次请求，输出回答后退出。**

## 问题

上一节只能证明程序读到了格式正确的密钥、模型 ID 和基础地址，不能证明远端服务能够理解我们的请求，也不能证明响应中一定存在可用文本。只有真正完成一次请求，配置、网络、认证、模型 ID 和协议字段才能一起接受检验。

一次提问需要跨过三个边界：

1. 用户文字先变成本地消息对象，再变成服务商规定的 JSON。
2. 网络不会立即返回结果，程序会先得到一个 Promise，之后才能取得响应。
3. 响应中可能没有文本，也可能要求调用本章尚未实现的工具。

如果入口直接假定 `choices[0].message.content` 永远存在，一个不完整响应就会被当成成功结果。

因此，本节真正要解决的是：**怎样把一条命令行问题转换成 OpenAI 兼容请求，等待远端响应，并且只把经过检查的纯文本作为成功回答交还给程序。**

## 解决方案

新增模型模块，把 SDK 初始化、请求字段和响应检查封装在 `Model.generate()` 中。命令入口只负责验证问题、调用模型并显示结果。

```text
+------------------+
| --prompt <text>  |
+--------+---------+
         |
   +-----v------+
   | non-empty? |
   +--+------+--+
      | 否   | 是
      v      v
   显示提示   readConfig --> createModel --> SDK 请求
                                             |
                              +--------------+--------------+
                              | 失败                        | 响应
                              v                             v
                         安全提示                  有可用文本？
                                                      | 否 --> 安全提示
                                                      | 是
                                                      v
                                                显示回答 --> 结束
```

这一节只有一次模型请求。无论成功还是失败，程序处理完本次结果后都会退出。

## 工作原理

先把一次模型调用理解成一次**跨网络的请求与响应往返**。本地程序准备消息，SDK 把消息转换成 HTTP 请求，远端模型服务返回 JSON，模型模块再从 JSON 中挑出本项目认可的结果。SDK 是负责传输和协议转换的客户端，不是模型本身。

```text
用户文字
  -> 本地 Message[]
  -> SDK 生成 JSON、认证头和请求地址
  -> HTTP(S) 到达模型服务
  -> 服务返回响应 JSON
  -> 本地检查 choices、文本和工具调用
  -> Reply 或错误
```

例如，用户输入“只回答 OK”后，本地会形成一条 `user` 消息，程序再把系统说明放到它前面。远端若返回第一项选择且内容为 `OK`，模型模块生成 `{ text: "OK" }`。若返回空文本或工具调用，本章无法处理，就明确失败，不能把它伪装成正常回答。

最容易误解的是 TypeScript 类型能够保证远端响应正确。类型只帮助编译器检查我们怎样使用 SDK；网络另一端实际返回什么，仍必须在运行时判断。本节只处理一次非流式纯文本请求，不处理历史、流式分片或工具执行。

### 第一步：给模型一段系统说明

在 [src/config/load-config.ts](src/config/load-config.ts) 中增加 `systemPrompt`，说明助手身份、使用中文回答，以及目前没有文件和命令工具。系统说明是程序给模型的规则；本次用户提问是需要模型回答的内容，两者职责不同。

### 第二步：定义模型模块的输入和输出

在 [src/models/client.ts](src/models/client.ts) 中定义 `Message`、`Reply` 和 `Model`，本节只支持文本：

```ts
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}
```

`user` 是用户提问，`assistant` 是模型回答。`generate()` 是本地方法名，它把“发消息、拿回答”包起来；实际网络调用是 OpenAI SDK 的 `client.chat.completions.create()`。这层很小的接口将来可以接入另一种协议，调用它的代码不必知道服务商字段。

`createModel()` 根据配置创建 SDK 客户端。调用 `generate()` 时，把系统说明放在第一条 `system` 消息中，再放入用户消息；SDK 负责 JSON、HTTP 和认证。响应的文本从 `choices[0].message.content` 读取。

模型模块还规定了四个运行边界：

- 空文本和工具调用不算本章的成功回答。
- 单次请求最多等待 60 秒。
- 请求失败后不自动重试，避免同一个问题被重复发送。
- 不输出 SDK 调试日志，避免原始响应进入终端。

`AbortSignal` 是取消请求的信号。本节先把它传给 SDK，后面接入终端取消时可以继续使用同一条取消链路。

### 第三步：理解一次请求怎样穿过运行时

先看数据怎样变化：

```text
JavaScript 消息对象
  -> SDK 生成 JSON、请求地址和认证信息
  -> Node 把 HTTP(S) 请求交给操作系统发送
  -> 模型服务返回 HTTP 响应
  -> SDK 把响应 JSON 还原成 JavaScript 对象
```

DNS 查询、建立连接和 TLS 加密都发生在“发送 HTTP(S) 请求”这一步。它们解释了为什么地址错误、网络不通和证书问题会在模型生成回答之前失败，但本节不需要手写这些网络过程。

再看程序等待期间发生什么：

```text
调用 generate()
  -> 得到一个 Promise
  -> await 暂停当前 async 函数
  -> Node 继续处理计时器、信号等事件
  -> 网络响应到达，Promise 完成
  -> 当前函数从 await 后面继续执行
```

`generate()` 返回 Promise，因为网络结果在未来某个时间才会到达。`await` 暂停的是当前 `async` 函数，不是整个操作系统，也不是用循环反复检查网络。Node 可以继续处理计时器、信号等事件；Promise 完成后，事件循环安排后续代码继续执行。

SDK 成功返回只说明取得了一个符合 SDK 类型的响应，不代表它符合本章的业务要求。当前 Agent 只接受一个非空纯文本回答，所以还要检查第一项选择、文本字段和工具调用。远程响应属于不可信输入，运行时校验不能由 TypeScript 类型代替。

### 第四步：理解 Model 接口的作用

`Model` 描述调用方所依赖的最小形状：一个 `generate()` 方法。TypeScript 使用结构类型检查对象是否满足它，并在编译后删除接口。运行时没有名为 `Model` 的基类；真正被调用的是 `createModel()` 返回对象上的函数。

这个边界让 Agent 核心依赖“能生成回答的对象”，而不是依赖 OpenAI SDK。后面接入 Anthropic 或测试用内存模型时，只要提供相同方法，调用方不必改写。

### 第五步：把命令行问题交给模型模块

在 [src/cli.ts](src/cli.ts) 中登记 `--prompt <text>`，无参启动时提示填写提问。在 `.action()` 中创建模型，然后发送一条用户消息：

```ts
const reply = await model.generate([{ role: "user", content: options.prompt }], signal);
console.log(`Agent > ${reply.text}`);
```

这里的 `options.prompt` 已在前面检查非空；`signal` 来自 `new AbortController().signal`。完整上下文见源码。

网络请求不会立即结束，所以 `.action()` 改为 `async`，底部的 `parse()` 改为 `await program.parseAsync()`。如果仍用同步 `parse()`，Commander 不会替顶层等待异步操作完整结束。此时仍没有会话历史，每次启动都是一个新问题。

### 为什么选择官方 SDK 和一次性响应

OpenAI SDK 已经负责认证头、请求路径、JSON 序列化、响应解析、超时和取消信号。模型模块只需要处理本项目真正关心的边界：怎样把本地消息转换成协议字段，以及怎样把远端响应收敛为非空文本。这样既能看到协议数据，也不会把通用 HTTP 细节混进入口。

本节先使用一次性响应，而不是流式输出。一次性响应只有“等待 → 成功或失败”两种结果，适合先看清异步请求和响应校验。流式响应还需要处理事件分片、增量文本、终端刷新和中途失败；这些能力将在界面需要逐字显示时单独讲解。

### 还有哪些方案

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 直接使用 `fetch()` | 可以完整观察 URL、请求头和 JSON，也不依赖 SDK | 需要自己维护认证、状态码、超时和不同响应结构。 |
| 使用 OpenAI Responses API | 适合新的 OpenAI 原生能力和统一响应项 | 许多兼容网关仍以 Chat Completions 为共同协议，本章还要与 Anthropic Messages 对照。 |
| 一开始就使用流式响应 | 首个字符更快出现在终端 | 会同时引入流事件和界面状态，掩盖本节的一次请求主线。 |
| 让 `cli.ts` 直接调用 SDK | 文件更少 | 命令解析和协议转换会耦合在一起，后续增加另一种协议时要改入口。 |

本节选择“小型模型模块 + 官方 SDK + 非流式请求”，因为它用最少的新概念打通真实网络，同时为后续协议适配留下清楚边界。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 修改 | `src/config/load-config.ts` | 增加系统提示词。 |
| 新增 | `src/models/client.ts` | 发送 OpenAI 兼容请求并检查响应。 |
| 修改 | `src/cli.ts` | 接收 `--prompt`，等待一次回答。 |

### 第一步：增加系统提示词

在 `src/config/load-config.ts` 的类型定义后加入：

```ts
export const systemPrompt =
  "你是 Hello, My Agent，一个帮助用户学习编程的助手。请用中文清楚回答。" +
  "当前没有文件或命令工具，不要声称已经操作用户的项目。";
```

系统提示词描述 Agent 当前真实拥有的能力。它不能阻止模型犯错，但可以减少模型声称已经读取文件或执行命令的情况。

### 第二步：实现模型模块

创建 `src/models/client.ts`。下面是本节的完整模型模块；[教学注释版源码](src/models/client.ts)同时标出了协议转换和失败分支。

```ts
import OpenAI from "openai";
import { systemPrompt, UserFacingError, type Config } from "../config/load-config.js";

export type Message = { role: "user" | "assistant"; content: string };
export type Reply = { text: string };

export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<Reply>;
}

export function createModel(config: Config): Model {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 60_000,
    maxRetries: 0,
    logLevel: "off",
    organization: null,
    project: null,
  });

  return {
    async generate(messages, signal) {
      const response = await client.chat.completions.create(
        {
          model: config.model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: false,
        },
        { signal },
      );
      const choice = response.choices?.[0];
      const text = choice?.message?.content;
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

type CliOptions = Options & { prompt?: string };
```

登记提问选项，并把默认操作替换为异步版本：

```ts
.option("--prompt <text>", "提问一次后退出")
.action(async () => {
  const options = program.opts<CliOptions>();
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
  console.log(`Agent > ${reply.text}`);
});
```

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

在根目录 `.env` 中填写 [02.1 介绍的三项配置](../01-configuration/README.md#填写第一组配置)。本节开始真正请求服务，需要使用有效的 Key、模型 ID 和基础地址，不能继续用练习假值。

OpenAI 分支使用 [Chat Completions](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)：程序提交模型 ID 和带角色的消息数组，接口返回 `choices`，本节从第一项选择中提取回答文本。只提供 Responses 接口、没有实现 Chat Completions 请求格式的网关不适用。

OpenAI 官方目前建议新项目优先评估 Responses API；本教程选择 Chat Completions，是因为本章目标是先实现广泛使用的 OpenAI 兼容消息协议，并与 Anthropic Messages 对照学习。这里讲解的是协议边界，不表示所有 OpenAI 新项目都应选择同一个接口。

### 第五步：运行本节程序

在仓库根目录执行：

```bash
npm run lesson:02.2
```

命令会用“你好”完成一次请求。要更换问题，运行：

```bash
hello-my-agent --prompt "用一句话解释什么是 CLI。"
```

这条 `hello-my-agent` 可以在仓库根目录运行，也可以进入当前 `02-first-reply` 目录后运行。配置读取会向上找到仓库根目录的 `.env`。

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 加入 `--prompt`，创建模型并等待一次回答。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 提供随请求发送的系统提示词。 |
| 新增 | [src/models/client.ts](src/models/client.ts) | 使用 OpenAI SDK 发送纯文本消息并返回 `Reply`。 |

## 运行验证

应看到一行 `Agent > ...`，然后进程退出；实际回答不固定。暂时没有交互输入框、历史或用量显示。

## 失败实验

运行 `hello-my-agent --prompt "   "`。程序应该提示填写提问，不应发送网络请求。再把密钥临时改成无效值，程序应显示安全的通用失败提示，不应打印请求头或完整响应。

## 小练习

把提问改成“只回答 OK”，观察程序是否仍在打印一条回答后退出。思考：如果想继续输入，历史数组应该由哪个模块长期保存？

参考答案：本节仍会回答一次后退出。连续会话的历史应由负责输入生命周期的终端模块保存，再把同一个数组交给每一轮 `agentLoop()`；02.4 会实现这个模块。

## 接下来

一次提问已经通了。下一节把执行流程从命令入口提取到 Agent Loop。
