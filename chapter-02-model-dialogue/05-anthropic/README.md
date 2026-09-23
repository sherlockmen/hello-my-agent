# 02.5 接入 Anthropic 接口

[第二章导航](../README.md) · [上一节](../04-conversation/README.md) · [下一节：02.6](../06-errors-and-usage/README.md)

**本节目标：在相同的 Agent Loop 和终端流程下，增加 Anthropic Messages 协议。运行时选择协议，核心不用跟着改。**

## 问题：更换模型服务商，为什么只改地址还不够

上一节已经能连续对话。现在，我们想保留同样的输入方式和聊天历史，改用 Anthropic 的模型。

如果新服务兼容 OpenAI 的 Chat Completions，换一组配置就可能继续使用；Anthropic 原生的 Messages 接口却使用另一种消息格式。比如，OpenAI 把系统说明放进消息数组，Anthropic 把它放在单独的 `system` 字段。只改地址，发出去的仍然是旧格式，接收方并不会自动理解。

所以，这一节要增加的是另一种协议的发送和接收方式。用户仍按原来的方法提问，Agent 也仍按原来的规则保存历史。

## 解决方案：模型模块负责两种格式之间的转换

我们让配置模块先选协议，再读取对应的密钥、模型和地址。模型模块收到统一消息后，按所选协议发出请求；收到响应后，再取出文本，返回同一种 `Reply`。

以这次提问为例：

```text
hello-my-agent --provider anthropic --prompt "用一句话解释 Promise"
```

程序会这样处理：

```text
用户输入文字，并选择 anthropic
  -> 配置模块只读取 ANTHROPIC_* 配置
  -> Agent Loop 组织统一的 Message[]
  -> 模型模块把消息转换成 Anthropic Messages 请求
  -> Anthropic 响应被转换成统一的 Reply
  -> Agent Loop 保存本轮问答
  -> 终端显示最终回答
```

换成 `openai` 后，中间的请求与响应转换不同，历史保存和终端显示仍然相同。`provider` 在本章表示使用哪种接口协议，并不意味着所有提供 OpenAI 兼容接口的服务都属于 OpenAI。

## 工作原理

### 同一段对话，为什么会有两种写法

对 Agent 来说，一段对话就是按顺序排列的用户问题与模型回答；对远端 API 来说，这些内容要放进它规定的字段。我们要保留对话的含义，只改变它在请求和响应里的表示方式。

| 同一份对话 | OpenAI 兼容接口 | Anthropic Messages |
| --- | --- | --- |
| SDK 调用 | `chat.completions.create()` | `messages.create()` |
| 系统提示词 | `messages` 内的 `system` 消息 | 独立的 `system` 字段 |
| 问答历史 | `user` / `assistant` | `user` / `assistant` |
| 文本结果 | `choices[0].message.content` | `content` 中的 `text` 块 |

例如，同样是“用中文回答编程问题”，OpenAI 请求把它作为第一条 `system` 消息，Anthropic 请求则单独填写 `system`。用户的 Promise 问题仍是一条 `user` 消息，之前的问答也仍按原顺序发送。

模型模块要做两次转换：先把本地消息写成服务商的请求，之后再把响应中的文本取回来。

```text
本地 Message[]
  ├─ provider = openai    -> OpenAI 请求    -> OpenAI 响应    -+
  └─ provider = anthropic -> Anthropic 请求 -> Anthropic 响应 -+
                                                               |
                                                               v
                                                         统一为 Reply
```

这就是本节的协议适配。统一的是程序内部使用的 `Message` 和 `Reply`，并不是把两个服务商的 API 改成了一样。

### Anthropic 为什么返回一个内容块数组

[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) 的 `content` 可以包含多段内容，每段用 `type` 标明种类。本节只接收文本，所以程序取出 `type === "text"` 的块，再把其中的文字用换行连接。

如果没有非空文本，或者停止原因是 `tool_use`，就不能把它当作这一轮已完成的回答。第三章才会让程序处理工具请求，本节继续遵守纯文本问答的限制。

请求还需要 `max_tokens`。这里填写 `2048`，表示允许本次最多生成这么多个 token，不是要求每次都生成这么多。达到上限时回答可能没说完，下一节会把这种停止原因显示给用户。

### 选了协议，为什么还要跟着选凭据

密钥要随请求发给目标服务。假如选择了 Anthropic，却在缺少配置时借用 OpenAI Key，程序就可能把一家的凭据交给另一家。因此先确定 `provider`，再读取这一组配置，不能拿另一组填空。

协议的选择顺序是 `--provider`、`AGENT_PROVIDER` 环境变量、`.env`，最后默认 `openai`。选择 `openai` 就使用 `OPENAI_*`，选择 `anthropic` 就使用 `ANTHROPIC_*`。读取 `.env` 时仍会把文件解析成对象，但选择本次配置时只取对应前缀的字段。

模型名和地址仍允许命令行覆盖；这些覆盖值也必须适用于当前所选协议。程序会检查地址结构，却不能判断某个网址是否真属于某家服务商，所以使用兼容网关时，密钥、模型与地址仍应来自同一服务。

基础地址只写到服务商要求的位置。OpenAI 的默认值包含 `/v1`；Anthropic 官方基础地址是 `https://api.anthropic.com`，无需手动加 `/v1/messages`，具体请求路径由 SDK 补上。

### 核心为什么可以继续用原来的代码

02.2 已经约定了 `generate(messages, signal)`。调用方把消息交进去，拿到 `Reply`，不直接访问服务商字段。本节只要在这个方法内部加入另一种转换，就能继续使用原来的 Agent Loop。

实际运行时，`createModel()` 根据配置创建 OpenAI 或 Anthropic 客户端，再返回带有 `generate()` 的普通对象。请求进入 `requestReply()` 后，程序根据客户端种类选择相应 SDK 方法，两个分支最终都返回 `{ text }`。

因此，核心不需要知道系统提示词放在哪个字段，也不用判断回答来自 `choices` 还是 `content`。它仍然只负责准备本轮消息、等待结果、成功后保存问答。这种分工让协议的变化留在处理协议的地方。

### 为什么继续用一个模型文件

当前只有两种协议，转换代码也不长，把两个分支放在 `models/client.ts` 中便于对照。为每种服务复制整个 Agent，会把终端、历史和取消规则也复制一遍；在核心里直接判断协议，则会让这些规则和请求字段混在一起。

两家的 SDK 分别处理认证、网络和错误对象，我们负责把消息与回答接到本地接口上。本节采用 [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) 与已有 OpenAI SDK。以后某一套转换明显变长，再按协议拆文件即可。

本节是在每次启动时选择一种协议，还不能在会话中途切换。第 23 章会继续扩展这处转换，处理模型能力差异以及运行中的切换。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/cli.ts](src/cli.ts) | 增加 `--provider` 选项。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 先选择协议，再读取对应的一组凭据。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | 增加 Anthropic 分支，继续返回统一的 `Reply`。 |

## 动手构建

从空目录跟写时，把已经完成的 `chapter-02-model-dialogue/04-conversation/src/` 复制到 `chapter-02-model-dialogue/05-anthropic/src/`，再在这份代码上继续。下面的 `src/` 均指本节目录；已有配套仓库时无需复制。

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

地址校验的规则沿用上一节，但解析失败的提示也要跟上协议选择。找到 `new URL(baseURL)` 后的 `catch`，把其中原来提示检查 `OPENAI_BASE_URL` 的 `throw` 替换为：

```ts
throw new UserFacingError("接口地址无效，请检查所选协议的 BASE_URL 或 --base-url。");
```

这样选择 Anthropic 时，地址写错也不会仍然提示检查 OpenAI 配置。后面的 HTTP(S) 与凭据字段检查保持原样，函数最后改为返回：

```ts
return { provider, apiKey, model, baseURL };
```

这段代码先确定 `provider`，再计算变量前缀。它只选择对应前缀的密钥，也不会在缺少 Anthropic Key 时退回 OpenAI Key。完整上下文见[配置源码](src/config/load-config.ts)。

### 第二步：增加 Anthropic 协议分支

在 `src/models/client.ts` 顶部导入 Anthropic SDK：

```ts
import Anthropic from "@anthropic-ai/sdk";
```

把 `createModel()` 改成按协议创建客户端：

```ts
/**
 * 按已选协议准备客户端，让调用方仍然只使用 generate()。
 *
 * config 包含经过本地检查的协议、密钥、模型和基础地址。
 * 这里只创建当前需要的 SDK 客户端，关闭自动重试与日志，再返回带 generate() 的普通对象。
 * 实际请求由 generate() 转交 requestReply()，因此创建对象本身不会发送消息。
 * SDK 初始化若失败，异常交回入口；这里不保存会话历史。
 */
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  // 显式固定认证方式，不额外混入 SDK 从环境读取的租户标识或 Bearer Token。
  // [CHANGED 02.5] 按协议创建需要的客户端，对外仍提供同一个 generate 方法。
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // 调用方只需发送消息；SDK 对象、模型 ID 和两种协议的字段差异留在本模块。
  return { generate: (messages, signal) => requestReply(client, config.model, messages, signal) };
}
```

在 `createModel()` 后新增 `requestReply()`，把原来 `generate()` 中的请求逻辑移到它的 OpenAI 分支，再加入 Anthropic 分支。函数先用 `instanceof OpenAI` 判断客户端；不满足时，TypeScript 将它收窄为 Anthropic 客户端。完整结构如下：

```ts
// [CHANGED 02.5] 把原来的 OpenAI 请求移入这里，再加入 Anthropic 分支。
/**
 * 把当前消息发给所选服务，再把回答转换成统一结果。
 *
 * 输入包括 SDK 客户端、模型 ID、消息和取消信号。
 * OpenAI 分支使用 chat.completions，Anthropic 分支使用 messages，分别按各自的字段收发。
 * 两个分支都返回 { text }，所以调用方不必判断服务商。
 * 请求失败时继续抛出 SDK 异常；空文本或当前不能处理的工具请求则抛出 UserFacingError。
 * 这里只转换消息和响应，不修改会话历史。
 */
async function requestReply(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<Reply> {
  if (client instanceof OpenAI) {
    // OpenAI 兼容接口：系统说明也放在 messages 中；SDK 负责 JSON、HTTP 和认证头。
    const response = await client.chat.completions.create({
      model, messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: false,
    }, { signal });
    const choice = response.choices?.[0];
    const text = choice?.message?.content;
    // 本章没有注册工具。遇到空文本或工具调用，明确失败，不把空回答写入历史。
    if (typeof text !== "string" || !text.trim() || choice?.message?.tool_calls?.length) {
      throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
    }
    return { text };
  }

  // [NEW 02.5] Anthropic Messages：system 是独立字段，messages 保存 user/assistant 对话。
  // max_tokens 是本次最多生成的 token 数，并不表示一定会生成这么多。
  const response = await client.messages.create({
    model, system: systemPrompt, messages, max_tokens: 2048, stream: false,
  }, { signal });
  // content 是内容块数组；本章只接收文本，工具调用留给后续章节。
  const text = response.content.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  if (!text.trim() || response.stop_reason === "tool_use") {
    throw new UserFacingError("接口没有返回可用的纯文本回答，请检查模型是否支持本章的聊天接口。");
  }
  return { text };
}
```

两个分支都返回 `{ text }`，这是 Agent Loop 能继续保持不变的原因。两个函数在[模型源码](src/models/client.ts)中的位置与这里一致。

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

## 运行验证

用 Anthropic 重复 02.4 的两轮提问，再以 `hello-my-agent --provider openai` 重复一次，两种协议的使用方式相同。每次启动创建独立历史；本节只在启动时选择协议，不在会话中途切换。

## 失败实验

只保留 OpenAI 配置，然后运行 `hello-my-agent --provider anthropic`。程序应提示缺少 `ANTHROPIC_API_KEY`，不能回退到 OpenAI，也不能把 OpenAI Key 发给 Anthropic 地址。

## 小练习

对照协议表，解释为什么系统提示词的转换必须放在模型模块，而不是放进 `agentLoop()`。

参考答案：OpenAI 把系统提示词放进 `messages`，Anthropic 使用独立的 `system` 字段。把差异留在模型模块后，`agentLoop()` 只处理统一消息，不需要判断服务商。

## 本节完成后的 Agent

此时，Agent 的核心已经与具体模型协议分离：

```text
provider 配置
   -> createModel()
      |-- OpenAI 兼容协议 --|
      |-- Anthropic 协议 ---|-> 统一 Model 接口 -> Agent Loop -> 会话历史
```

现在，两种服务都能接上同一套连续会话。模型模块把各自的消息格式转来转去，核心仍只保存成功问答。不过，请求失败时的提示还不够具体，成功时也没显示用量；下一节补上这些信息，让用户知道结果意味着什么。
