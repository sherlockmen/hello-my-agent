# 03.1 识别模型的工具请求

[第三章首页](../README.md) · [本节源码](src/) · [下一节：执行 read_file](../02-read-file-loop/README.md)

**本节目标：向模型声明 `read_file`，识别它返回的文件读取请求并保存成统一数据，但暂不读取磁盘。**

## 问题：模型已经请求读取文件，程序却只会处理文本回答

第二章只处理一种模型结果：模型返回文本，程序把文本显示给用户。到了“读取文件”这样的任务，模型不能直接访问磁盘，它只能先向 Agent 提出工具请求。

工具请求与普通回答的结构不同。例如，OpenAI 兼容接口可能返回：

```text
用户：读取 package.json
模型：content = null
      tool_calls = [{ ... }]
```

这里产生了三个需要分别处理的问题：

1. **怎样判断模型想做什么？** 这次响应可能是可以直接显示的最终回答，也可能是等待程序处理的工具请求。`content` 为空不一定表示响应无效；只检查 `content`，会把合法的工具请求误判成“空回答”。
2. **怎样隔离不可信的模型输出？** `name: "read_file"` 只是模型生成的数据，不是已经获得执行权限的 JavaScript 调用。程序不能根据这个名称直接执行同名函数，否则会绕过程序预先允许使用的工具列表和参数校验。
3. **怎样屏蔽服务商协议差异？** OpenAI 把工具请求放在 `tool_calls` 中，Anthropic 使用 `tool_use` 内容块。如果 Agent Loop 分别编写两套判断逻辑，每增加一种协议都要修改 Agent 核心。

因此，本节要解决的问题是：**怎样识别模型提出的 `read_file` 请求，把不同服务商的字段保存成统一的本地请求数据，同时确保程序还没有执行它？** 这份数据会在解决方案中命名为 `ToolCall`。本节不会校验工具参数或读取文件，这两步留到下一节。

## 解决方案

先定义工具的公开契约，再由模型适配层发送契约并统一响应字段。统一后的本地数据叫作 `ToolCall`。Agent Loop 只识别它，不执行它；随后用明确提示结束本轮。

```text
+--------------------+      +------------------+
| read_file contract | ---> | provider request |
| name/description   |      | tools            |
| JSON Schema        |      +--------+---------+
+--------------------+               v
+----------------+          text or tool request
| user messages  | -----------------+
+----------------+                  |
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

本节新增 `tools/` 目录，因为工具契约已经成为独立职责：

- `tools/read-file.ts` 描述单个工具。
- `tools/registry.ts` 汇总可用工具，并定义统一 `ToolCall`。
- `models/client.ts` 负责协议字段转换。
- `agent/agent-loop.ts` 负责判断结果类型。

## 工作原理

先用“读取 `package.json`”看清本节实际完成到哪里：

```text
1. 用户要求读取 package.json
2. 模型返回 read_file 请求，而不是最终文本
3. 模型适配层把服务商字段转换成 ToolCall
4. Agent Loop 识别出这是工具请求，但不调用文件系统
5. Agent Loop 抛出阶段提示，命令入口或终端将它显示给用户
6. 本轮没有最终回答，因此 history 保持不变
```

这条链故意停在“识别完成”。如果本节假装继续，就只能跳过参数校验直接访问文件，或者把空文本错误地当成最终回答。03.2 会从第 4 步继续，执行工具并把结果送回模型。

### 第一步：区分工具定义、工具请求和工具执行

这三个概念发生在不同时间：

| 概念 | 谁创建 | 作用 | 是否访问文件 |
| --- | --- | --- | --- |
| 工具定义 | Agent 开发者 | 告诉模型可以请求什么、参数长什么样 | 否 |
| 工具请求 | 模型 | 表达“我需要这个工具和这些参数” | 否 |
| 工具执行 | 本地 Agent | 校验请求并调用 Node.js API | 是，下一节实现 |

工具定义类似一份函数说明书。它提高模型生成正确参数的概率，却不会自动创建权限，也不会替代本地校验。

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

`required: ["path"]` 表示参数不能缺少路径，`additionalProperties: false` 表示模型不应添加其他字段。这里使用 JSON Schema，是因为两种模型接口都用这种结构描述对象参数。

最容易误解的是“接口接受了 Schema，返回值就一定合法”。模型输出仍可能是无效 JSON、缺字段或多字段；兼容接口也可能忽略一部分约束。Schema 是生成提示，本地校验才是执行边界。

### 第二步：保存调用 ID、名称和原始参数

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

参数暂存为 JSON 字符串，是为了让 OpenAI 返回值和 Anthropic 返回值在同一个本地边界解析。OpenAI 原本就返回字符串；Anthropic 返回对象，适配层用 `JSON.stringify()` 统一。解析和校验只写一次，放到下一节的工具实现中。

### 第三步：把不同协议归一化

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

这个检查放在模型适配边界，而不是文件工具内部。第 04—07 章继续增加搜索、编辑和 Shell 工具时，无效的服务商响应仍不会进入 Agent Loop，更不会开始本地执行。

文本和工具请求可能同时出现，所以这里没有把它们设计成只能二选一的类型。只要 `toolCalls` 非空，Agent 就先处理工具；待模型不再请求工具时，`text` 才是最终回答。

本节的一次性响应可以直接取得完整参数字符串；第 08 章加入流式响应后，会先把分片参数组装完整，再允许工具进入执行分支。

### 第四步：本节为什么主动停止

收到工具请求后，本节抛出一条明确错误：

```ts
if (result.toolCalls.length > 0) {
  throw new UserFacingError(
    "已收到模型的工具请求；03.2 将执行 read_file 并回传结果。",
  );
}
```

这不是最终行为，而是刻意保留的学习边界。此时程序已经证明它能识别工具请求，但还没有参数校验和文件执行入口。继续运行只会产生两种错误行为：把空文本当回答，或假装工具已经成功。

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

### 1. 定义工具契约

创建 `src/tools/read-file.ts`，写入前面展示的 `readFileDefinition`。名称是稳定的协议字段；修改名称后，模型请求、注册表和历史消息必须一起变化。

### 2. 建立工具列表和统一请求类型

创建 `src/tools/registry.ts`：

```ts
import { readFileDefinition } from "./read-file.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition];
```

当前只有一个工具，数组已经足够。等真正出现多个工具后再扩展分派逻辑，不提前建立插件框架。

### 3. 扩展模型返回值

在 `models/client.ts` 中给 `ModelResult` 增加 `toolCalls`，并在两种请求中传入 `toolDefinitions`。响应转换的关键代码如下：

```ts
const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
  .filter((call) => call.type === "function")
  .map((call) => normalizeToolCall(
    call.id,
    call.function.name,
    call.function.arguments,
  ));
```

Anthropic 的转换只在参数来源上不同：

```ts
const toolCalls: ToolCall[] = response.content
  .filter((block) => block.type === "tool_use")
  .map((block) => normalizeToolCall(
    block.id,
    block.name,
    JSON.stringify(block.input),
  ));
```

只有当文本为空并且工具列表也为空时，响应才是真的不可用。

### 4. 在 Agent Loop 中选择分支

把第二章直接提交文本的逻辑改成：先检查工具请求，再检查最终文本。完整实现见 [agent-loop.ts](src/agent/agent-loop.ts)。

### 5. 声明真实能力

系统提示词只声明当前实际边界：模型可以提出 `read_file` 请求，但本节程序尚不能把文件内容返回给它；修改文件和执行命令也不可用。提示词能约束模型行为，但不能代替工具注册表；即使模型请求一个未登记工具，本地也不会因此获得对应函数。

### 6. 构建并运行

在仓库根目录执行：

```bash
npm run lesson:03.1
```

```bash
hello-my-agent --prompt "请先读取 package.json，再告诉我 name 字段。"
```

模型若选择 `read_file`，你会看到本节的停止提示。模型若根据已有上下文直接回答，可换成一个只有当前文件内容才能确定的问题。模型行为存在不确定性，协议结构由本地验收固定检查。

## 运行验证

执行：

```bash
npm run check:03
```

验收先独立运行 03.1，固定让内存模型返回工具请求，断言程序主动停止且历史保持为空。完成版的本地接口还会分别返回 OpenAI `tool_calls` 和 Anthropic `tool_use`，检查两种响应是否保留相同的名称、调用 ID 和参数。测试不使用真实 API Key。

## 失败实验：模型请求工具后没有最终文本

运行本节源码并触发 `read_file`。工具响应通常没有普通文本，你应看到：

```text
错误：已收到模型的工具请求；03.2 将执行 read_file 并回传结果。
```

这证明程序没有把空字符串写入历史，也没有声称已经读取文件。当前限制发生在 Agent Loop，不是模型接口故障。

## 小练习

回答下面问题：为什么不能只保存 `{ name, arguments }`，还必须保存 `id`？

答案：一个模型响应可以包含多个工具请求，同一工具也可能被调用多次。结果返回时，协议用 ID 建立一一对应；只保存名称会让模型无法确定每个结果属于哪次请求。你可以在 [本章练习](../EXERCISES.md) 中用两个并列调用验证消息顺序。

## 本节完成后的 Agent

此时，Agent 已经能区分模型的两种决定：

```text
模型响应
   |-- 最终回答 --> 提交本轮历史并结束
   |
   +-- ToolCall --> 转成统一的名称、调用 ID 和参数 --> 主动停止
```

OpenAI 和 Anthropic 的工具请求已经变成相同的 `ToolCall`，但它仍只是一份尚未执行的数据。下一节将增加本地允许列表和 `read_file` 实现，把工具结果按原调用 ID 发回模型，让 Agent Loop 继续到最终回答。
