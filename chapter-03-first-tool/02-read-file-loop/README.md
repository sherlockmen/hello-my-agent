# 03.2 执行 read_file 并回传结果

[上一节：识别工具请求](../01-tool-request/README.md) · [第三章首页](../README.md) · [本节源码](src/) · [下一节：工具失败反馈](../03-error-boundary/README.md)

**本节目标：校验并执行 `read_file`，把结果配回模型请求，让 `agentLoop()` 循环到最终回答。**

## 问题

03.1 已经能得到统一的工具请求：

```ts
{
  id: "call_42",
  name: "read_file",
  arguments: "{\"path\":\"package.json\"}"
}
```

这仍然只是一组来自模型的数据，不代表程序已经允许或完成了文件读取。要把它变成一次安全、完整的工具调用，需要解决四个问题：

1. **怎样确认参数可以使用？** `arguments` 可能不是有效 JSON，也可能缺少 `path`。直接传给 Node.js 的文件读取函数，只会在更深的位置产生难懂的错误。
2. **怎样限制读取范围？** 模型可能请求项目根目录之外的文件，或读取包含密钥的 `.env`。模型提出请求不等于程序应该授予访问权限。
3. **怎样让模型知道结果属于哪次请求？** 一次响应可能包含多个工具请求。程序必须保留调用 ID，才能把每个文件结果配回正确的请求。
4. **怎样让工具结果参与后续推理？** 读取文件不是本轮终点。程序还要把结果发回模型，再次请求，直到模型返回最终回答；如果 `agentLoop()` 只调用模型一次，文件内容永远不会影响答案。

因此，本节要解决的问题是：**怎样校验并执行 `read_file`，把结果配回正确的工具请求，并继续调用模型直到得到最终回答？** 本节先让工具成功路径形成完整循环，工具失败后的自我修正留到下一节。

## 解决方案

把工作分成工具执行和循环控制两层：

```text
+-------------+      +-------+      +----------------+
| user prompt | ---> | Model | ---> | final answer？ |
+-------------+      +---^---+      +-------+--------+
                         |                  | 是 --> 提交并返回
                         |                  | 否
                         |                  v
                         |          +----------------+
                         |          | ToolCall       |
                         |          | id/name/args   |
                         |          +-------+--------+
                         |                  v
                         |          +----------------+
                         |          | registry       |
                         |          | choose tool    |
                         |          +-------+--------+
                         |                  v
                         |          +----------------+
                         |          | validate/read  |
                         |          +-------+--------+
                         |                  v
                         |               成功？
                         |          +-------+-------+
                         |          | 是            | 否
                         |          v               v
                         +---- tool result      ToolError
                          same call id          结束本轮
                              |                 history 不变
                              +----> 再请求模型
```

`read-file.ts` 只负责参数、路径和文件读取；`registry.ts` 只负责按名称选择工具；`agent-loop.ts` 只负责消息顺序、继续或结束。三个职责分开后，模型协议和文件系统不会互相渗透。

## 工作原理

### 第一步：把模型参数当成不可信输入

模型看到的 Schema 是说明，不是本地类型检查。`arguments` 必须在执行入口依次通过这些判断：

```text
字符串能被 JSON.parse 解析？
  ├─ 否 -> ToolError
  └─ 是
      是普通对象？
        ├─ 否 -> ToolError
        └─ 是
            只有一个 path 字段，并且是非空字符串？
              ├─ 否 -> ToolError
              └─ 是 -> 进入路径检查
```

代码使用 `unknown` 接收 `JSON.parse()` 的结果，再逐步缩小类型：

```ts
let value: unknown;
try {
  value = JSON.parse(argumentsJson);
} catch {
  throw new ToolError("参数不是有效的 JSON。");
}
```

如果一开始就写类型断言，例如 `JSON.parse(...) as { path: string }`，TypeScript 只会在编译时相信开发者，不会在运行时检查网络数据。错误对象仍可能通过并在文件 API 处造成难以理解的异常。

### 第二步：限制工具的文件系统范围

用户可能在仓库根目录启动 Agent，也可能进入某个章节目录后再启动。程序先从 `process.cwd()` 取得启动位置，然后逐级向上查找最近的 `package.json`。找到的目录作为本次运行的项目根目录；如果一直找不到，才使用原启动目录。

例如从 `chapter-03-first-tool/02-read-file-loop` 启动时，程序会向上找到仓库根目录的 `package.json`。模型请求 `package.json` 时，读取的就是仓库根文件，而不是小节目录下不存在的文件。

确定项目根目录后，`resolve(projectRoot, path)` 把模型给出的相对路径转换成绝对路径。配置读取和工具读取的边界仍不相同：

```text
启动目录
  └─ 向上找到最近的 package.json
       └─ 项目根目录
            ├─ 配置读取：查找 .env，只交给模型客户端
            └─ read_file：只能读取项目根目录以内，不能读取 .env 系列文件
```

因此模型客户端可以取得 API Key，`read_file` 却不能把它读成工具结果再发送给模型。`.env`、`.env.*` 和 `.envrc` 会直接得到 `ToolError`；真实路径检查还会阻止符号链接绕过这条规则。

只检查 `../` 还不够。项目内可能有一个符号链接：

```text
project/
  external -> /Users/example/private
```

模型请求 `external/secret.txt` 时，文字路径位于 `project` 下，真实文件却在项目外。代码因此对项目根目录和目标文件都调用 `realpath()`，再用 `relative()` 检查目标的真实位置：

```ts
const projectRootPath = await realpath(projectRoot);
const filePath = await realpath(resolve(projectRootPath, path));
const pathFromProjectRoot = relative(projectRootPath, filePath);

if (
  pathFromProjectRoot === ".." ||
  pathFromProjectRoot.startsWith(`..${sep}`) ||
  isAbsolute(pathFromProjectRoot)
) {
  throw new ToolError("path 不能离开当前项目根目录。");
}
```

随后检查目标必须是普通文件，并且不超过 64 KiB（65,536 字节）。目录、设备文件和过大文件都不会进入 `readFile()`。

本章用 `readFile(filePath, "utf8")` 按 UTF-8 解码普通文件，因为源码和配置通常使用 UTF-8，模型也需要文本输入。Node 遇到无效字节时会产生替代字符，所以这不是编码格式验证。图片、PDF 和其他附件会在后续章节使用不同的数据结构处理。

### 第三步：注册表决定什么能够执行

`ToolCall.name` 来自模型，不能直接写成动态函数调用。注册表使用显式分支：

```ts
export async function executeTool(call: ToolCall): Promise<string> {
  if (call.name === readFileDefinition.name) {
    return readFileTool(call.arguments);
  }
  throw new ToolError(`未知工具：${call.name}`);
}
```

当前只有一个工具，`if` 比通用插件系统更容易读。模型即使生成 `delete_file` 或 `run_shell`，本地也找不到允许分支，不会执行同名系统操作。

### 第四步：保存完整的因果链

模型第一次请求工具后，循环依次追加两条候选消息：

```ts
turn.push({
  role: "assistant",
  content: result.text,
  toolCalls: result.toolCalls,
});

turn.push({
  role: "tool",
  toolCallId: call.id,
  content,
  isError: false,
});
```

不能只把文件内容作为新的用户消息发送。那样会丢失三个事实：内容来自工具、它对应哪次请求、执行是否成功。协议可能拒绝不完整的消息，模型也可能误把文件内容理解成用户的新指令。

下一次请求发送：

```text
已有 history
+ 本轮 user
+ assistant 工具请求
+ tool 工具结果
```

OpenAI 适配层把最后一条转为 `role: "tool"`；Anthropic 适配层把它转为用户消息中的 `tool_result` 内容块。Agent Loop 不需要知道这些差异。

### 第五步：循环、用量和历史提交

`for` 循环每次代表一次模型请求，不是一次工具调用。一个模型响应可以包含多个工具请求，程序全部执行后才进入下一次模型请求。

```text
模型请求次数 1
  -> 返回 2 个工具调用
  -> 本地执行 2 次 read_file
模型请求次数 2
  -> 返回最终回答
```

用量是每次模型请求产生的，因此最终 `Reply` 把各次 `inputTokens` 和 `outputTokens` 相加。只要任意一次接口没有提供某类用量，合计就保持 `null`，不会把未知值当成 0。

本轮消息先存在局部 `turn` 中。得到最终回答并再次检查取消信号后，才执行：

```ts
history.push(...turn);
```

这样，工具执行中断或模型请求失败时，原历史不会出现只有请求、没有结果的断链。

### 第六步：为什么现在就加入 8 次上限

一旦代码出现循环，就必须同时定义停止条件。正常停止条件是模型返回不含工具请求的最终回答；异常停止条件是模型连续请求 8 次后仍不结束。

没有上限时，模型可能反复读取同一文件，持续消耗请求次数和 token。第 8 次模型响应若仍要求工具，程序会在执行工具前停止：此时已经没有第 9 次机会把结果反馈给模型，继续执行只会产生无用操作。8 不是所有 Agent 的通用最佳值，只是本教程当前阶段的明确边界。以后可以把预算扩展为轮次、时间、token 和费用的组合。

## 动手构建

### 本节修改哪些文件

| 文件 | 状态 | 职责 |
| --- | --- | --- |
| `src/tools/read-file.ts` | 修改 | 解析参数，限制路径，拒绝 `.env`，按 UTF-8 解码小文件 |
| `src/tools/registry.ts` | 修改 | 按工具名分派到本地实现 |
| `src/errors.ts` | 修改 | 定义可以安全展示和反馈的 `ToolError` |
| `src/models/client.ts` | 修改 | 转换 assistant 工具请求和 tool 工具结果 |
| `src/agent/agent-loop.ts` | 修改 | 循环请求、执行工具、累计用量、提交整轮历史 |

### 1. 实现文件读取边界

先在 `errors.ts` 中定义 `ToolError`。再在 `read-file.ts` 中导入它，并新增 `parsePath()` 和 `readFileTool()`。完整实现见 [read-file.ts](src/tools/read-file.ts)。请按执行顺序阅读：先解析参数，再拒绝 `.env`，再得到真实路径并检查边界、文件类型和大小，最后读取内容。

### 2. 增加本地执行入口

在 `registry.ts` 中新增 `executeTool()`。它只接受统一 `ToolCall`，不接收服务商对象，因此工具层不会依赖 OpenAI 或 Anthropic SDK。

### 3. 扩展本地消息类型

把 `Message` 改成三个分支：

```ts
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };
```

判别字段 `role` 让 TypeScript 在每个分支中知道可用字段。例如 `role === "tool"` 后，代码可以安全读取 `toolCallId`。

### 4. 转换两种协议消息

在 `models/client.ts` 中加入 `toOpenAIMessages()` 和 `toAnthropicMessages()`。Anthropic 要求连续工具结果组成同一条 `user` 消息，所以转换函数会把相邻的本地 `tool` 消息合并成多个 `tool_result` 内容块。

### 5. 完成 Agent Loop

用 [agent-loop.ts](src/agent/agent-loop.ts) 中的有界 `for` 循环替换 03.1 的主动停止分支。关键顺序是：

1. 调用模型。
2. 累计本次用量。
3. 没有工具请求时提交并返回。
4. 有工具请求时先检查是否还有下一次模型机会。
5. 有剩余机会才保存 assistant 消息，逐个执行工具并保存同 ID 结果。
6. 回到循环顶部，并在下一次模型请求前检查取消。

### 6. 构建并运行

在仓库根目录或当前小节目录执行：

```bash
npm run lesson:03.2
hello-my-agent --prompt "请读取 package.json，只告诉我 name 字段。"
```

预期回答包含：

```text
@sherlockmen/hello-my-agent
```

终端只显示最终回答和累计用量。本章尚未加入工具执行进度事件，实时展示会在第 09 章进入核心事件流，第 10 章进入 TUI。

## 本节实现清单

- 运行时校验工具参数，不依赖模型遵守 Schema。
- 向上查找最近的 `package.json`，确定一致的项目根目录。
- 使用真实路径阻止 `../` 和符号链接离开项目根目录。
- 拒绝 `.env` 系列文件；普通文件按 UTF-8 解码，大小上限为 64 KiB。
- 本地注册表决定允许执行的工具名称。
- 工具请求和结果使用同一个调用 ID。
- 两种模型协议都能表示完整工具消息链。
- Agent Loop 最多请求模型 8 次，并累计各次用量。
- 只有最终回答成功后才提交本轮历史。

## 运行验证

运行确定性检查：

```bash
npm run check:03
```

验收会先单独运行 03.2：固定请求一个不存在的文件，断言 `ToolError` 直接结束且历史为空。随后在 03.3 完成版中创建临时 `note.txt`，检查真实文件内容已经按同一调用 ID 进入下一次模型请求。

## 失败实验：读取不存在的文件

运行：

```bash
npm run lesson:03.2
hello-my-agent --prompt "请读取 definitely-missing.txt。"
```

本节的 `readFileTool()` 会抛出 `ToolError`，当前轮停止，历史不变。03.2 先建立成功路径；下一节会把这种可预期错误作为工具结果交还模型，让模型可以修正路径或解释失败。

如果模型没有选择工具而是直接说明文件不存在，这只能证明模型作出了文本判断，不能证明路径校验已运行。`npm run check:03` 使用固定工具请求验证真实错误分支。

## 小练习

解释为什么工具结果不能写成普通的 `{ role: "user", content: fileText }`。

答案：这样会丢失结果来源、成功状态和调用 ID。模型无法确定文本属于哪个请求，服务商协议也可能认为工具调用缺少结果。正确做法是先保留 assistant 的工具请求，再添加带同一 ID 的工具结果。完整的并列调用练习见 [本章练习](../EXERCISES.md)。

## 接下来

成功路径已经闭合，但文件不存在、参数错误和未知工具仍会直接结束当前轮。[03.3](../03-error-boundary/README.md) 将这些可预期失败转成 `isError: true` 的工具结果，并继续沿用本节已经建立的轮次上限。
