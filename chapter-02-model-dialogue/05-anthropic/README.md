# 02.5 接入 Anthropic 接口

[第二章导航](../README.md) · [上一节](../04-conversation/README.md) · [下一节：02.6](../06-errors-and-usage/README.md)

**本节目标：在相同的 Agent Loop 和终端流程下，增加 Anthropic Messages 协议。运行时选择协议，核心不用跟着改。**

## 问题

上一节的连续会话只能通过 OpenAI 兼容协议请求模型。Anthropic Messages 虽然同样接收用户与助手消息，但它的认证配置、系统提示词位置、请求方法和响应内容块都不同，不能只替换基础地址就直接复用 Chat Completions 请求。

接入第二种协议会产生三个问题：

1. **怎样发送不同格式的请求？** 两种协议放置系统提示词和历史消息的位置不同，调用的 SDK 方法也不同。
2. **怎样得到相同格式的结果？** OpenAI 兼容接口从 `choices` 读取文本和用量，Anthropic 从内容块和 `usage` 读取。如果上层直接处理这些字段，Agent Loop 就必须分别编写两套逻辑。
3. **怎样避免混用凭据？** 选择 Anthropic 后误用 OpenAI Key，不只是请求失败，还可能把认证材料发送到错误的地址。

因此，本节要解决的问题是：**怎样在运行时选择 OpenAI 或 Anthropic，把两种协议转换成同一种本地模型能力，并确保每种协议只使用自己的配置？** 本节只增加第二种模型协议，不改变连续会话和一轮 Agent 执行规则。

## 解决方案

让配置模块先确定 `provider`，再读取对应的一组凭据；让模型模块把两种协议都转换成相同的 `Reply`。Agent Loop 和终端继续只面对统一的 `Model` 接口。

```text
+----------------+
| choose provider|
+-------+--------+
        |
  +-----v-----------------------------+
  | openai or anthropic?              |
  +----------+------------------+------+
             | openai           | anthropic
             v                  v
       read OPENAI_*      read ANTHROPIC_*
             |                  |
             v                  v
       OpenAI client      Anthropic client
             |                  |
             v                  v
       Chat Completions   Messages API
             |                  |
             +--------+---------+
                      v
               normalize Reply
                      |
                      v
              agentLoop / terminal

协议无效或缺少所选协议的配置 --> 安全提示
```

协议差异停在配置和模型模块中。上层不需要根据服务商编写两套会话流程。

## 工作原理

先把模型模块理解成一个**双向翻译器**。Agent Loop 使用本项目自己的 `Message` 和 `Reply`；模型模块把统一消息翻译成目标服务商的请求，再把不同响应翻译回统一结果。统一的是本地语义，服务商协议本身并没有变成同一种格式。

```text
本地 Message[]
  ├─ provider = openai    -> OpenAI 请求    -> OpenAI 响应    -+
  └─ provider = anthropic -> Anthropic 请求 -> Anthropic 响应 -+
                                                               |
                                                               v
                                                         统一为 Reply
```

例如，同一条系统说明在 OpenAI 请求中是一条 `role: "system"` 消息，在 Anthropic 请求中却是独立的 `system` 字段；同一段回答在 OpenAI 响应中位于 `choices[0].message.content`，在 Anthropic 响应中位于 `content` 的文本块。适配层负责这两次转换，Agent Loop 只看到“输入消息，得到回答”。

最容易误解的是认为换一个 `baseURL` 就等于支持另一种协议。地址只决定请求发到哪里，不能改变 JSON 字段、认证方式和响应结构。本节只支持在每次启动时选择一种协议，不支持在同一会话中途切换，也还不处理两种协议的工具调用格式。

### 第一步：先选协议，再选凭据

在 [src/config/load-config.ts](src/config/load-config.ts) 为 `Options` 和 `Config` 增加 `provider`。选择优先级是 `--provider → AGENT_PROVIDER 环境变量 → .env → openai`。

选择 `openai` 后读取 `OPENAI_*`，选择 `anthropic` 后读取 `ANTHROPIC_*`。模型和基础地址继续允许命令行覆盖；密钥只读取选定协议那一组。如果没有 Anthropic Key，应提示缺少配置，不应拿另一组密钥尝试。

### 第二步：把两种协议转换成同一种结果

[src/models/client.ts](src/models/client.ts) 的 `createModel()` 现在按协议创建 OpenAI 或 Anthropic 客户端。两者仍提供相同的 `generate(messages, signal)`，返回 `{ text }`。

| 同一份对话 | OpenAI 兼容接口 | Anthropic Messages |
| --- | --- | --- |
| SDK 调用 | `chat.completions.create()` | `messages.create()` |
| 系统提示词 | `messages` 内的 `system` 消息 | 独立的 `system` 字段 |
| 问答历史 | `user` / `assistant` | `user` / `assistant` |
| 文本结果 | `choices[0].message.content` | `content` 中的 `text` 块 |

Anthropic 的 `max_tokens: 2048` 是本次最多生成的 token 数，不表示一定生成这么多。`content` 可能包含多种内容块，当前只接收纯文本，工具调用仍留给第三章。

[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) 的请求和响应有两个关键结构：

- 请求把系统提示词放在独立的 `system` 字段，把对话放在 `messages` 数组。
- 响应的 `content` 是内容块数组，每个块可能是文本或工具请求。

本节遍历所有文本块并用换行连接。如果没有文本，或者停止原因是 `tool_use`，就不能把它当作本章已经完成的回答。

两种请求的转换集中在 `requestReply()`。OpenAI 分支生成 Chat Completions 字段，Anthropic 分支生成 Messages 字段。两个分支都把服务商响应转换成 `{ text }`，因此 Agent Loop 和终端不需要判断服务商。

### 第三步：理解协议适配为什么放在模型层

Agent Loop 关心的是领域语义：一组消息能否得到一个回答。OpenAI 和 Anthropic 的 SDK 类型、系统提示词位置、响应内容块和停止原因属于传输协议。把传输字段暴露给 Agent Loop，会让核心同时承担调度和服务商转换两种职责。

模型模块把两种外部协议收敛成同一个本地接口。这不是在运行时创建新的 `Model` 类型；TypeScript 类型已经被删除。运行时实际发生的是：`createModel()` 根据 `config.provider` 创建对应 SDK 实例，并返回一个带 `generate()` 函数的普通对象。

`requestReply()` 接收 `OpenAI | Anthropic` 联合类型，再通过运行时对象判断选择请求分支。两个分支最后都返回 `{ text }`，因此上层只能看到统一结果。协议新增字段时，修改范围仍限制在模型模块。

### 第四步：凭据必须跟随协议选择

程序先确定 provider，再读取这一组前缀对应的 Key、模型和地址。不能先混合所有配置再猜测使用哪一个，因为密钥是发送到远程地址的认证材料；选错组合不仅会请求失败，还可能把凭据交给错误的服务端。

`baseURL` 是 SDK 拼接接口路径的基础地址。OpenAI 兼容地址通常包含 `/v1`，Anthropic 官方基础地址不附加 `/v1/messages`，具体请求路径由 SDK 加入。基础地址和模型 ID 必须遵循目标服务商的约定。

### 第五步：入口登记 --provider

在 [src/cli.ts](src/cli.ts) 加入这一项规则：

```ts
.option("--provider <type>", "接口协议：openai 或 anthropic")
```

入口把 `--provider` 交给 `readConfig()`，再把得到的 `Config` 交给 `createModel()`。入口只传递选择结果，不拼装任何服务商请求字段。

### 为什么选择适配层

Agent Loop 的问题是“根据消息得到下一步结果”，协议层的问题是“怎样向某个 HTTP API 表达这些消息”。让 `createModel()` 返回统一的 `generate()`，可以把稳定的 Agent 语义与会变化的服务商字段分开。新增协议时，只要完成“本地消息 → 请求”和“响应 → Reply”两次转换。

当前只有两个协议，而且转换代码仍然很短，所以使用一个文件中的联合类型和分支已经足够。等协议数量增加，或某个适配器本身变大，再拆成 `openai.ts`、`anthropic.ts`；现在提前拆分只会增加跳转文件。

### 还有哪些方案

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 在 `agentLoop()` 中判断 provider | 可以直接访问所有协议字段 | 核心会同时负责调度与传输转换，每增加服务商都要修改核心。 |
| 为两个服务商复制完整 Agent | 每份代码只看一种协议 | 会复制历史、取消和终端逻辑，修复时容易出现行为差异。 |
| 统一发送 OpenAI 格式给兼容代理 | 本地只保留一种协议 | 依赖额外代理，且无法学习或使用 Anthropic 原生 Messages 差异。 |
| 手写 `fetch()` 适配器 | 不依赖服务商 SDK | 需要自己维护认证头、错误对象、版本头和响应类型。 |

本节使用 [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) 和 OpenAI SDK 处理各自的认证、请求路径、JSON 与错误对象，再在本地模型模块完成最小适配。这样既保留协议真实差异，也让上层只有一条执行路径。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 修改 | `src/config/load-config.ts` | 先选择协议，再读取对应配置。 |
| 修改 | `src/models/client.ts` | 增加 Anthropic 请求和响应转换。 |
| 修改 | `src/cli.ts` | 登记 `--provider`。 |

### 第一步：让配置先选择协议

在 `src/config/load-config.ts` 中扩展选项和配置类型：

```ts
export type Options = {
  provider?: string;
  model?: string;
  baseUrl?: string;
};

export type Config = {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
  baseURL: string;
};
```

在 `readConfig()` 取得 `fileEnv` 和 `env()` 后，用下面的逻辑替换原来的 OpenAI 固定字段读取：

```ts
const provider = options.provider?.trim() || env("AGENT_PROVIDER") || "openai";
if (provider !== "openai" && provider !== "anthropic") {
  throw new UserFacingError("AGENT_PROVIDER 或 --provider 只能是 openai 或 anthropic。");
}

const prefix = provider === "openai" ? "OPENAI" : "ANTHROPIC";
const apiKey = env(`${prefix}_API_KEY`);
const model = options.model?.trim() || env(`${prefix}_MODEL`);
if (!apiKey) {
  throw new UserFacingError(`缺少 ${prefix}_API_KEY。请在当前目录、项目根目录的 .env 或环境变量中配置。`);
}
if (!model) {
  throw new UserFacingError(`缺少 ${prefix}_MODEL。请填写服务商提供的模型 ID，或使用 --model。`);
}

const baseURL = options.baseUrl?.trim() || env(`${prefix}_BASE_URL`) ||
  (provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com");
```

地址校验仍沿用上一节，函数最后改为返回：

```ts
return { provider, apiKey, model, baseURL };
```

这段代码先确定 `provider`，再计算变量前缀。它不会同时读取两组密钥，也不会在缺少 Anthropic Key 时退回 OpenAI Key。完整上下文见[配置源码](src/config/load-config.ts)。

### 第二步：增加 Anthropic 协议分支

在 `src/models/client.ts` 顶部导入 Anthropic SDK：

```ts
import Anthropic from "@anthropic-ai/sdk";
```

把 `createModel()` 改成按协议创建客户端：

```ts
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 60_000,
    maxRetries: 0,
    logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });

  return {
    generate: (messages, signal) =>
      requestReply(client, config.model, messages, signal),
  };
}
```

新增 `requestReply()`。函数先用 `instanceof OpenAI` 进入原有 OpenAI 分支；不满足时，TypeScript 会把 `client` 收窄为 Anthropic 客户端。完整结构如下：

```ts
async function requestReply(
  client: OpenAI | Anthropic,
  model: string,
  messages: Message[],
  signal: AbortSignal,
): Promise<Reply> {
  if (client instanceof OpenAI) {
    const response = await client.chat.completions.create(
      {
        model,
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
  }

  const response = await client.messages.create(
    {
      model,
      system: systemPrompt,
      messages,
      max_tokens: 2048,
      stream: false,
    },
    { signal },
  );

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (!text.trim() || response.stop_reason === "tool_use") {
    throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
  }
  return { text };
}
```

两个分支都返回 `{ text }`，这是 Agent Loop 能继续保持不变的原因。包含逐行说明的版本见[模型源码](src/models/client.ts)。

### 第三步：登记协议选项

在 `src/cli.ts` 的其他 `.option()` 后加入：

```ts
.option("--provider <type>", "接口协议：openai 或 anthropic")
```

入口不需要增加协议判断。`program.opts()` 把选择交给 `readConfig()`，返回的 `Config` 再交给 `createModel()`。

### 第四步：增加 Anthropic 配置

在同一个 `.env` 中保留 OpenAI 那组，再加入：

```dotenv
AGENT_PROVIDER=openai
ANTHROPIC_API_KEY=此处填写Anthropic接口密钥
ANTHROPIC_MODEL=此处填写该服务商模型ID
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

这组中文值是占位符，需要替换。官方基础地址不追加 `/v1/messages`；SDK 会拼接路径。使用兼容网关时，按网关给出的基础地址配置。

`AGENT_PROVIDER=openai` 设置默认协议。启动时使用 `--provider anthropic`，只切换当前进程使用的协议，不会修改 `.env`。

### 第五步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.5
```

这条 npm 命令只构建并注册本节，不调用 Anthropic 或 OpenAI。准备验证 Anthropic 接口时运行：

```bash
hello-my-agent --provider anthropic
```

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 增加 `--provider` 选项。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 先选择协议，再读取对应的一组凭据。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | 增加 Anthropic 分支，继续返回相同的 `Reply`。 |

## 运行验证

用 Anthropic 重复 02.4 的两轮提问，再以 `hello-my-agent --provider openai` 重复一次，两种协议的使用方式相同。每次启动创建独立历史；本节只在启动时选择协议，不在会话中途切换。

## 失败实验

只保留 OpenAI 配置，然后运行 `hello-my-agent --provider anthropic`。程序应提示缺少 `ANTHROPIC_API_KEY`，不能回退到 OpenAI，也不能把 OpenAI Key 发给 Anthropic 地址。

## 小练习

对照协议表，解释为什么系统提示词的转换必须放在模型模块，而不是放进 `agentLoop()`。

参考答案：OpenAI 把系统提示词放进 `messages`，Anthropic 使用独立的 `system` 字段。把差异留在模型模块后，`agentLoop()` 只处理统一消息，不需要判断服务商。

## 接下来

两种协议已经走同一个核心。下一节补充错误分类和用量显示。
