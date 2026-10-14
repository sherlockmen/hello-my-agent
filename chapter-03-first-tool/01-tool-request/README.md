# 03.1 识别模型的工具请求

[第三章首页](../README.md) · [本节源码](src/) · [下一节：执行 read_file](../02-read-file-loop/README.md)

**本节目标：向模型声明 `read_file`，识别它返回的文件读取请求并保存成统一数据，但暂不读取磁盘。**

## 问题：模型要读文件时，会返回什么

第二章里，模型返回一段文字，程序就把它显示到终端。现在我们提出“读取 `package.json`，告诉我包名”。模型不能直接打开本地文件，程序需要先告诉它：这里有一个名叫 `read_file` 的工具，提供路径就可以请求读取。

模型选择这个工具后，返回的会是**工具请求**：一份写明工具名称、参数和调用 ID 的数据。它和普通回答放在不同字段里。例如，OpenAI 兼容接口可能返回：

```text
用户：读取 package.json
模型：content = null
      tool_calls = [{ ... }]
```

如果程序还像第二章那样只看 `content`，就会把这次请求当成空回答。其实模型正在等待文件内容，程序只是还不认识这种结果。

所以，这一节先让程序看懂工具请求。我们会给模型提供工具说明，把两种服务商的返回字段转成同一种本地数据，再让 Agent Loop 区分“可以回答了”和“还需要工具”。本节识别到工具请求后会明确停止，真正的文件读取放到 03.2。

## 解决方案：先告诉模型能请求什么，再识别它的选择

我们先写一份 `read_file` 的说明，包含名称、用途和参数格式。请求模型时，程序把这份说明和对话消息一起发送。模型因此知道，需要文件内容时可以提出什么请求。

服务商返回工具请求后，模型适配层把它转成 `ToolCall`，也就是本书统一使用的工具请求类型。Agent Loop 只检查这个类型，不需要分别认识 OpenAI 的 `tool_calls` 和 Anthropic 的 `tool_use`。

```text
+--------------------+       +-----------------+
| read_file contract |       | user messages   |
| name/description   |       +--------+--------+
| JSON Schema        |                |
+---------+----------+                |
          |                           |
          +--------------------+      |
                               v      v
                         +---------------------+
                         | provider request    |
                         | tools + messages    |
                         +----------+----------+
                                    v
                                模型响应
                         text or tool request
                                    |
                                    v
                         +---------------------+
                         | models/client.ts    |
                         | normalize ToolCall  |
                         +----------+----------+
                                    v
                              toolCalls 有内容？
                           +--------+--------+
                           | 否              | 是
                           v                 v
                    提交并显示文本       不执行工具
                                             |
                                             v
                                   显示“下一节才会执行”
                                   本轮历史保持不变
```

这些工作分别放在下面几个位置：

- `tools/read-file.ts` 描述单个工具。
- `tools/registry.ts` 汇总可用工具，并定义统一 `ToolCall`。
- `models/client.ts` 负责协议字段转换。
- `agent/agent-loop.ts` 负责判断结果类型。

## 工作原理

先沿着“读取 `package.json`”看一遍：

```text
1. 用户要求读取 package.json
2. 模型返回 read_file 请求，而不是最终文本
3. 模型适配层把服务商字段转换成 ToolCall
4. Agent Loop 识别出这是工具请求，但不调用文件系统
5. Agent Loop 抛出阶段提示，命令入口或终端将它显示给用户
6. 本轮没有最终回答，因此 history 保持不变
```

图中的停止是本节的阶段结果：程序认出了请求，但读取函数还没有写出来。03.2 会接上第 4 步，把文件内容作为工具结果送回模型。下面先看请求为什么需要这些字段。

### 工具说明、模型请求、实际执行是三件事

这三个概念发生在不同时间：

| 概念 | 谁创建 | 作用 | 是否访问文件 |
| --- | --- | --- | --- |
| 工具定义 | Agent 开发者 | 告诉模型可以请求什么、参数长什么样 | 否 |
| 工具请求 | 模型 | 表达“我需要这个工具和这些参数” | 否 |
| 工具执行 | 本地 Agent | 校验请求并调用 Node.js API | 是，下一节实现 |

可以把工具定义看成发给模型的一份函数说明书：`name` 说明该请求哪个工具，`description` 说明什么时候用，`inputSchema` 说明参数怎么填写。这份说明本身不会读取文件。

本节的定义是：

```ts
export const readFileDefinition = {
  name: "read_file",
  description: "读取当前项目根目录内一个普通文件并按 UTF-8 解码；不读取 .env 系列环境配置文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于当前项目根目录的文件路径，例如 package.json。",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};
```

`inputSchema` 使用 JSON Schema 描述参数形状。这里的 `type: "object"` 要求参数是对象，`required: ["path"]` 要求提供路径，`additionalProperties: false` 表示不要添加其他字段。两种模型接口都能接收这样的参数说明，所以我们可以共用一份定义。

有了说明，也不能省去本地检查。模型或兼容接口仍可能返回无效 JSON、漏掉 `path`，或者多带一个未实现的字段。下一节会在读取函数入口重新检查这些数据。

### 为什么请求里还要有调用 ID

`registry.ts` 定义统一结构：

```ts
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};
```

三个字段各有不同作用：

- `name` 选择本地注册的工具。
- `arguments` 保存模型生成的 JSON，下一节才解析。
- `id` 把将来的执行结果配回这次请求。

例如模型一次请求两个文件：

```text
call_a -> read_file({ path: "package.json" })
call_b -> read_file({ path: "tsconfig.json" })
```

两个请求名称相同，结果不能只写“这是 read_file 的结果”。程序必须把第一个结果标成 `call_a`，第二个标成 `call_b`，模型才能恢复正确对应关系。

参数暂存为 JSON 字符串，是为了让 OpenAI 返回值和 Anthropic 返回值在同一个本地边界解析。OpenAI 原本就返回字符串；Anthropic 返回对象，适配层用 `JSON.stringify()` 统一。两种接口因此可以共用下一节的本地参数检查，不必各写一套路径校验。

### 两种接口怎样交给同一个 Agent Loop

OpenAI 兼容接口把定义放进 `tools[].function`，工具请求位于 `message.tool_calls[]`。Anthropic 把定义直接放进 `tools[]`，工具请求是 `content` 数组中的 `tool_use` 块。

本节分别读取服务商字段，最后都生成：

```ts
{
  id: "call_42",
  name: "read_file",
  arguments: "{\"path\":\"package.json\"}"
}
```

`ModelResult` 因此从第二章的纯文本结果扩展为：

```ts
export type ModelResult = Reply & { toolCalls: ToolCall[] };
```

这里的 `&` 是 TypeScript 的交叉类型，表示 `ModelResult` 同时拥有 `Reply` 的四个字段和新增的 `toolCalls` 字段。它不是运行时的逻辑运算；编译后的 JavaScript 中不会保留这段类型声明。

这也意味着 `ToolCall` 类型无法证明远程接口真的返回了合法字段。TypeScript 只能检查我们怎样使用 SDK 返回值；程序运行时，代理服务、兼容接口或错误响应仍可能给出空的调用 ID、名称或参数。协议适配层因此在创建 `ToolCall` 前检查三个字段：

```ts
function normalizeToolCall(id: unknown, name: unknown, argumentsJson: unknown): ToolCall {
  if (typeof id !== "string" || !id.trim()
    || typeof name !== "string" || !name.trim()
    || typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    throw new UserFacingError(
      "接口返回了无效的工具请求：调用 ID、名称和参数必须是非空字符串。",
    );
  }
  return { id, name, arguments: argumentsJson };
}
```

这一步只确认三个字段是非空字符串，尚未检查参数是不是合法 JSON。它适用于所有工具，所以放在模型适配层统一做；具体的 `path` 值是否合法，留给下一节的读取工具判断。

文本和工具请求可能同时出现，所以这里没有把它们设计成只能二选一的类型。只要 `toolCalls` 非空，Agent 就先处理工具；待模型不再请求工具时，`text` 才是最终回答。

本节的一次性响应可以直接取得完整参数字符串；第 08 章加入流式响应后，会先把分片参数组装完整，再允许工具进入执行分支。

### 识别到了请求，为什么还要停止

收到工具请求后，本节抛出一条明确错误：

```ts
if (result.toolCalls.length > 0) {
  throw new UserFacingError(
    "已收到模型的工具请求；03.2 将执行 read_file 并回传结果。",
  );
}
```

这条提示让我们能单独观察“请求识别”是否接通。此时本地还没有执行读取，模型也没收到文件内容，程序不能把这轮记作一次已经完成的问答。

由于本轮没有最终回答，`history.push()` 不会执行。下一次用户输入仍从上一次完整历史开始。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/tools/read-file.ts](src/tools/read-file.ts) | 定义 `read_file` 的名称、说明和参数 Schema。 |
| 新增 | [src/tools/registry.ts](src/tools/registry.ts) | 汇总工具定义，声明统一的 `ToolCall`。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | 发送工具定义，并归一化两种协议的工具请求。 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 区分最终回答与工具请求。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 让系统提示词准确说明当前工具边界。 |

## 动手构建

下面从第二章及 `/reset` 练习的完成版继续。我们先写工具说明，再把它接到模型请求和主循环里。下文路径都相对于本节 `src/`；配置读取、终端输入和错误显示继续沿用。

### 1. 写出 `read_file` 的完整说明

新增 `tools/read-file.ts`，完整内容如下。这里还没有读取函数，只有发给模型的工具说明：

```ts
/**
 * 03.1 识别模型的工具请求 | [NEW] tools/read-file.ts
 *
 * 学习目标：用一份结构化定义告诉模型 read_file 的名称、用途和参数形状。
 * 输入：本节没有直接读取文件；模型只会看到 path 参数的 JSON Schema。
 * 输出：readFileDefinition。真正访问磁盘的函数将在 03.2 加入。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +--------------------+      +------------------+      +----------------+
 *   | readFileDefinition| ---> | Model API tools  | ---> | model decision |
 *   | name/description  |      | schema in request|      +-------+--------+
 *   | inputSchema       |      +------------------+              |
 *   +--------------------+                              +--------+--------+
 *                                                       | text / tool call|
 *                                                       +-----------------+
 *
 * 关键点：工具定义只是给模型看的“接口说明”，不会自动读取文件。
 * 模型返回工具请求后，仍要由本地程序校验参数并执行；本节先解决请求识别。
 * 运行观察：请求体中出现 read_file；模型可返回名称、调用 ID 和 JSON 参数。
 */

// [NEW 03.1] 这份 JSON Schema 同时适用于 OpenAI 兼容接口和 Anthropic。
export const readFileDefinition = {
  name: "read_file",
  description: "读取当前项目根目录内一个普通文件并按 UTF-8 解码；不读取 .env 系列环境配置文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于当前项目根目录的文件路径，例如 package.json。",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};
```

再新增 `tools/registry.ts`。它保存本节的工具列表和统一请求类型，完整内容如下：

```ts
/**
 * 03.1 识别模型的工具请求 | [NEW] tools/registry.ts
 *
 * 学习目标：把工具定义集中成模型可读取的列表，并规定统一的工具请求形状。
 * 输入：各工具模块导出的定义，以及模型接口返回的服务商字段。
 * 输出：toolDefinitions 和统一的 ToolCall；本节尚不执行工具。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +---------------------+      +-----------------+
 *   | read_file definition| ---> | toolDefinitions |
 *   +---------------------+      +--------+--------+
 *                                         |
 *                                         v
 *                                +-----------------+
 *                                | models/client   |
 *                                | sends tools     |
 *                                +--------+--------+
 *                                         |
 *                          provider tool call fields
 *                                         v
 *                                +-----------------+
 *                                | ToolCall        |
 *                                | id/name/args    |
 *                                +-----------------+
 *
 * 关键点：调用 ID 由模型接口生成，用来把将来的工具结果配回原请求。
 * 参数先保存成 JSON 字符串，等本地准备执行时再解析并检查。
 * 运行观察：两种模型协议返回不同字段，上层最终都收到相同的 ToolCall。
 */

import { readFileDefinition } from "./read-file.js";

// [NEW 03.1] 以下请求类型与工具列表均为本节新增。
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [NEW 03.1] 目前只有一个工具，因此普通数组已经足够，不引入插件框架。
export const toolDefinitions = [readFileDefinition];
```

### 2. 让两种模型请求都带上工具说明

用下面的完整文件替换 `models/client.ts`。先看 `ModelResult`：它在原有回答字段上增加了 `toolCalls`。再看 `requestResult()` 的两个分支：发送时把 `toolDefinitions` 转为服务商要求的字段，返回时都调用 `normalizeToolCall()`，形成同一个本地类型。

`createModel()` 和用量处理仍保留原来的职责。文本为空时，要先看是否有工具请求，不能立即当成空回答。

```ts
/**
 * 03.1 识别模型的工具请求 | [CHANGED] models/client.ts
 *
 * 学习目标：向两种模型协议发送同一份工具定义，并把不同响应统一成 ToolCall。
 * 输入：普通对话消息、read_file 定义、AbortSignal。
 * 输出：文本、工具请求、用量和截断状态；不在这里访问文件系统。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      +-----------------------+
 *   | messages | ---> | provider request      |
 *   +----------+      | OpenAI tools/function |
 *                     | Anthropic tools        |
 *                     +-----------+-----------+
 *                                 v
 *                         返回了工具请求？
 *                           | 否 --> text result
 *                           | 是
 *                           v
 *                     +------------------+
 *                     | normalize fields |
 *                     | id/name/arguments|
 *                     +--------+---------+
 *                              v
 *                         ModelResult
 *
 * 关键点：模型只“提出”工具请求；协议适配层只整理数据，不在这里执行工具。
 * OpenAI 的 arguments 本来就是 JSON 字符串；Anthropic 的 input 先转成字符串，
 * 让后续本地执行入口使用同一套解析和校验规则。服务商响应属于外部输入，
 * 即使 SDK 提供了 TypeScript 类型，也要在运行时检查三个字段确实是非空字符串。
 * 运行观察：无论 provider 为哪一种，agentLoop() 都能看到经过校验的统一 toolCalls。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";

// [KEEP 来自 02.6] 本节还没有工具结果消息，因此历史仍只有普通 user/assistant 文本。
export type Message = { role: "user" | "assistant"; content: string };
export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};

// [NEW 03.1] 一次模型响应可以给出最终文本，也可以要求程序执行一个或多个工具。
export type ModelResult = Reply & { toolCalls: ToolCall[] };

// [CHANGED 03.1] generate() 的结果现在包含工具请求。
export interface Model {
  generate(messages: Message[], signal: AbortSignal): Promise<ModelResult>;
}

/**
 * 按配置创建模型客户端，让主循环始终通过 generate() 请求模型。
 *
 * config 已由 readConfig() 检查；这里只创建所选协议的 SDK 对象，不立即发送请求。
 * 返回的 generate() 记住客户端和模型 ID，之后接收消息与取消信号。
 * 关闭 SDK 自动重试和日志，让本章的一次调用对应一次请求，避免额外输出请求细节。
 * 初始化异常继续交给调用方处理；网络请求发生在 generate() 中。
 */
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  return { generate: (messages, signal) => requestResult(client, config.model, messages, signal) };
}

/**
 * 读取服务商报告的用量；缺少可用数字时保留“未知”。
 *
 * value 来自远程响应，只有有限且不小于 0 的数字才原样返回，否则返回 null。
 * null 不能换成 0，否则会把“接口没报告”显示成“没有消耗”。
 * 这里只检查数字格式，不验证服务商的统计是否准确，也不因用量缺失让回答失败。
 */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 把服务商返回的工具字段整理成主循环能使用的 ToolCall。
 *
 * ID、名称和参数都必须是非空字符串，否则抛出 UserFacingError，停止处理本次响应。
 * SDK 的类型不能保证兼容接口实际返回了什么，所以仍要在运行时检查。
 * 这里还不解析参数 JSON，也不判断工具是否存在；这些工作留给本地工具入口。
 */
// [NEW 03.1] 服务商字段进入主循环之前，先检查基本类型。
function normalizeToolCall(id: unknown, name: unknown, argumentsJson: unknown): ToolCall {
  if (typeof id !== "string" || !id.trim()
    || typeof name !== "string" || !name.trim()
    || typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    throw new UserFacingError("接口返回了无效的工具请求：调用 ID、名称和参数必须是非空字符串。");
  }
  return { id, name, arguments: argumentsJson };
}

/**
 * 发送消息和当前工具说明，再把服务商响应整理成 ModelResult。
 *
 * 输入是客户端、模型 ID、消息数组和取消信号；根据客户端协议发送相应字段。
 * 返回文本、工具请求、用量和截断状态。只要含有工具请求，文本为空也可以是正常响应。
 * 既没有文字也没有工具请求时抛出 UserFacingError；工具基础字段由 normalizeToolCall() 检查。
 * 网络、认证、取消或消息转换失败继续向外抛出；这里不执行工具，也不保存会话历史。
 */
// [CHANGED 03.1] 请求携带工具说明，响应同时保留文本与工具请求。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: true,
        },
      })),
      stream: false,
    }, { signal });
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments));
    const text = choice.message.content ?? "";
    if (!text.trim() && toolCalls.length === 0) {
      throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
    }
    return {
      text,
      toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: choice.finish_reason === "length",
    };
  }

  const response = await client.messages.create({
    model,
    system: systemPrompt,
    messages,
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    max_tokens: 2048,
    stream: false,
  }, { signal });
  const text = response.content.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  const toolCalls: ToolCall[] = response.content
    .filter((block) => block.type === "tool_use")
    .map((block) => normalizeToolCall(block.id, block.name, JSON.stringify(block.input)));
  if (!text.trim() && toolCalls.length === 0) {
    throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
  }
  return {
    text,
    toolCalls,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: response.stop_reason === "max_tokens",
  };
}
```

### 3. 在主循环里识别工具请求

用下面的完整文件替换 `agent/agent-loop.ts`。这节仍然只请求模型一次；工具分支先抛出阶段提示，所以还没有文件访问，也不会保存一轮未完成的问答。

```ts
/**
 * 03.1 识别模型的工具请求 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在固定主流程中区分“最终回答”和“工具请求”。
 * 输入：终端文本、已有 history、能够返回工具请求的 Model 和 AbortSignal。
 * 输出：文本回答照常提交；工具请求主动停止，history 保持不变。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP 第二章]       [CHANGED 03.1]        [CHANGED 03.1]
 * +----------+       +---------------+      +----------------+
 * | Terminal | ----> | agentLoop     | ---> | model.generate |
 * +----^-----+       | history+input |      | + tool schema  |
 *      |             +-------+-------+      +-------+--------+
 *      |                     ^                      |
 *      |                     |                返回哪种结果？
 *      |                     |          +-----------+-----------+
 *      |                     |          | final text            | tool call
 *      |                     |          v                       v
 *      +-- 显示并等待下一行 <-+-- 提交问答        [NEW 03.1] 明确停止
 *                                                       history 不变
 *
 * [CHANGED] 表示模型结果和 Agent 判断新增了工具分支；终端会话仍沿用第二章。
 * 本节只证明程序能识别结构化工具请求，还没有把请求交给本地工具执行。
 * 主动停止可以避免把没有执行过的工具请求误当成成功回答。
 * 运行观察：普通问题仍能回答；触发 read_file 时看到明确的边界提示。
 */

import { UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";

/**
 * 区分最终回答和工具请求，先让主循环认识新的响应形式。
 *
 * 输入是模型、已完成历史、本次用户文字和取消信号。请求时使用历史加本次输入的临时数组。
 * 只有非空最终文本才和用户消息一起加入 history；收到工具请求时用阶段提示停止。
 * 模型异常、空回答或取消同样不提交本次消息。本节还不解析参数，也不读取文件。
 */
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  signal.throwIfAborted();
  const userMessage: Message = { role: "user", content: input };
  const messages: Message[] = [...history, userMessage];
  const result = await model.generate(messages, signal);

  // [NEW 03.1] 能识别不等于能执行；先用明确边界防止错误地提交空回答。
  if (result.toolCalls.length > 0) {
    throw new UserFacingError("已收到模型的工具请求；03.2 将执行 read_file 并回传结果。");
  }
  if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");

  signal.throwIfAborted();
  const reply: Reply = result;
  history.push(userMessage, { role: "assistant", content: result.text });
  return reply;
}
```

### 4. 告诉模型当前完成到了哪里

在 `config/load-config.ts` 中，只替换 `systemPrompt` 这一项，其他配置读取代码不变：

```ts
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。需要文件内容时，请提出 read_file 工具请求，不要猜测。当前示例只识别工具请求，尚不能把文件内容返回给你；你也不能修改文件或执行命令，不要声称已经完成这些操作。";
```

模型现在可以提出请求，但本节还不能把文件内容交回去。提示词说明这个阶段，真正的停止动作仍由刚才的主循环执行。

### 构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:03.1
```

```bash
hello-my-agent --prompt "请先读取 package.json，再告诉我 name 字段。"
```

如果模型选择 `read_file`，终端会显示本节的停止提示。如果模型直接回答，可换成一个必须查看当前文件内容的问题。真实模型的选择不固定，下面的检查会固定触发工具分支。

## 运行验证

执行：

```bash
npm run check:03
```

验收先独立运行 03.1，固定让内存模型返回工具请求，断言程序主动停止且历史保持为空。完成版的本地接口还会分别返回 OpenAI `tool_calls` 和 Anthropic `tool_use`，检查两种响应是否保留相同的名称、调用 ID 和参数。测试不使用真实 API Key。

## 失败实验：模型请求工具后没有最终文本

运行本节源码并触发 `read_file`。如果模型返回工具请求，终端会显示：

```text
错误：已收到模型的工具请求；03.2 将执行 read_file 并回传结果。
```

这证明程序没有把空字符串写入历史，也没有声称已经读取文件。当前限制发生在 Agent Loop，不是模型接口故障。

## 小练习

回答下面问题：为什么不能只保存 `{ name, arguments }`，还必须保存 `id`？

答案：一个模型响应可以包含多个工具请求，同一工具也可能被调用多次。结果返回时，协议用 ID 建立一一对应；只保存名称会让模型无法确定每个结果属于哪次请求。在 [本章练习](../EXERCISES.md) 中，我们会用两个并列调用验证消息顺序。

## 本节完成后的 Agent

此时，Agent 已经能区分模型的两种决定：

```text
模型响应
   |-- 最终回答 --> 提交本轮历史并结束
   |
   +-- ToolCall --> 转成统一的名称、调用 ID 和参数 --> 主动停止
```

OpenAI 和 Anthropic 的工具请求已经变成相同的 `ToolCall`，但它仍只是一份尚未执行的请求。下一节将增加本地允许列表和 `read_file` 实现，把工具结果按原调用 ID 发回模型，让 Agent Loop 继续到最终回答。
