# 03.2 执行 read_file 并回传结果

[上一节：识别工具请求](../01-tool-request/README.md) · [第三章首页](../README.md) · [本节源码](src/) · [下一节：工具失败反馈](../03-error-boundary/README.md)

**本节目标：校验并执行 `read_file`，把结果配回模型请求，让 `agentLoop()` 循环到最终回答。**

## 问题：读到了文件，还要让模型收到它

上一节，程序已经能识别这样的请求：

```ts
{
  id: "call_42",
  name: "read_file",
  arguments: "{\"path\":\"package.json\"}"
}
```

但它在这里就停下来了。模型提出“我要读 `package.json`”，不等于文件已经打开；即使程序读到了内容，只在终端打印出来，远程模型也仍然看不到。

我们需要补完后半程：本地工具检查参数并读取文件，Agent Loop 把文件内容放进下一次模型请求，让模型继续回答“这个包叫什么”。所以，本节会同时接上读取函数和结果回传。有了这次来回，`agentLoop()` 才真正开始在模型和工具之间循环。

## 解决方案：工具负责读取，主循环负责把结果送回去

模型请求 `read_file` 时，程序先从注册表找到本地读取函数。函数检查路径和文件大小后返回文本，Agent Loop 再为它加上原来的调用 ID，告诉模型“这是 `call_42` 的结果”。

接下来仍然请求同一个模型，只是消息里多了刚才的工具请求和文件内容。模型可以据此回答，也可以提出新的工具请求。

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

`read-file.ts` 只负责参数、路径和文件读取；`registry.ts` 只负责按名称选择工具；`agent-loop.ts` 只负责消息顺序、继续或结束。以后增加其他工具时，只需把它接入注册表，主循环仍按相同方式发送结果。

## 工作原理

“读取 `package.json` 并回答包名”会经过下面这次来回：

```text
1. 用户要求读取 package.json，模型返回 read_file 请求
2. Agent Loop 把请求交给工具注册表
3. read_file 校验参数、项目边界、文件类型和大小
4. 工具返回文件内容，Agent Loop 用原调用 ID 生成工具结果
5. Agent Loop 把工具结果加入本轮消息，再次请求模型
6. 模型根据真实内容返回包名，Agent Loop 提交完整本轮并交给终端显示
```

本节先让读取成功的情况完整跑通。参数检查或读取失败时，本轮会抛错并结束，正式历史保持不变；03.3 再把这类错误送回模型，让模型获得修正机会。

### 执行之前，先确认参数确实能用

模型看到的 Schema 告诉它应该怎样填写；本地程序还要确认它实际填了什么。`arguments` 必须在执行入口依次通过这些判断：

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

这里用 `unknown`，是在提醒接下来的代码：解析成功只证明字符串符合 JSON 语法，还不能直接取 `path`。它也可能是数组、数字，或者一个没有路径的对象。只有检查完形状和字段，程序才知道得到了可用字符串。写成 `as { path: string }` 只会让编译器相信我们，不会替程序完成这些检查。

### `package.json` 到底指哪个目录里的文件

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

因此模型客户端可以取得 API Key，`read_file` 却不能把它读成工具结果再发送给模型。`.env`、`.env.*` 和 `.envrc` 会直接得到 `ToolError`；真实路径检查还会拒绝检查时已经通过符号链接指向这些文件的目标。

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

这项判断只证明检查发生时解析到的目标位于项目内。检查结束到 `readFile()` 真正打开文件之间，其他进程仍可能替换路径。当前教程假设使用者控制本地工作区，因此这里不是文件系统沙箱。第 05 章会解释为什么应用层审批仍不能代替沙箱，第 33 章再接入操作系统级执行隔离；第 04 章讨论的是多次分段读取之间文件内容可能变化，是另一类问题。

随后检查目标是普通文件，并且此刻不超过 64 KiB（65,536 字节）。检查时不符合要求的目录、设备文件和过大文件不会进入 `readFile()`；检查以后仍可能发生的文件变化，属于前面说的竞态限制。

本章用 `readFile(filePath, "utf8")` 按 UTF-8 解码普通文件，因为源码和配置通常使用 UTF-8，模型也需要文本输入。Node 遇到无效字节时会产生替代字符，所以这不是编码格式验证；第 24 章会为图片和其他附件增加独立的数据结构、格式检查和模型能力判断。

### 工具名怎样对应到本地函数

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

### 为什么要把请求和结果一起发回模型

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

前一条 `assistant` 消息记录模型提出了什么请求，后一条 `tool` 消息记录程序执行后的结果。`toolCallId` 使用原来的 `call.id`，两条消息就能对应起来。

如果只把文件正文写成新的用户消息，就丢掉了这种对应关系：模型服务可能判定工具请求缺少结果，消息角色也不能再说明这些文字来自文件。保留工具角色能表达来源，但它并不保证模型一定不会受文件中的文字误导；后续还需要专门处理不可信内容。

下一次请求发送：

```text
已有 history
+ 本轮 user
+ assistant 工具请求
+ tool 工具结果
```

OpenAI 适配层把最后一条转为 `role: "tool"`；Anthropic 适配层把它转为用户消息中的 `tool_result` 内容块。Agent Loop 不需要知道这些差异。

### 一轮里可以多次请求模型，历史最后再保存

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

### 模型一直要读文件时，程序怎样停下来

一旦代码出现循环，就必须同时定义停止条件。正常停止条件是模型返回不含工具请求的最终回答；另一个停止条件是已经请求模型 8 次，它仍然要求使用工具。

没有上限时，模型可能反复读取同一文件，持续消耗请求次数和 token。第 8 次模型响应若仍要求工具，程序会在执行工具前停止：此时已经没有第 9 次机会把结果反馈给模型，继续执行只会产生无用操作。8 不是所有 Agent 的通用最佳值，只是本教程当前阶段的明确边界；第 15 章会加入上下文与 token 预算，第 27 章会加入任务并发与资源上限，第 34 章再处理无进展检测。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/tools/read-file.ts](src/tools/read-file.ts) | 解析参数、限制路径、拒绝凭据文件并读取小型文本文件。 |
| 修改 | [src/tools/registry.ts](src/tools/registry.ts) | 按工具名把请求分派到本地实现。 |
| 修改 | [src/errors.ts](src/errors.ts) | 定义可以安全展示和反馈的 `ToolError`。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | 转换 assistant 工具请求和 tool 工具结果。 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 循环请求、执行工具、累计用量并提交完整回合。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 把系统提示词中的工具边界更新为“可以真实读取文件”。 |

## 动手构建

我们从 03.1 继续，先实现读取，再接上消息回传。下文路径都相对于本节 `src/`。终端仍然只调用 `agentLoop()`，不需要知道里面新增了多少次工具往返。

### 1. 定义可以向外说明的工具错误

在 `errors.ts` 的 `UserFacingError` 后面加入：

```ts
// [NEW 03.2] 工具边界只用经过设计的安全文案创建此错误；03.3 会把它作为结果反馈给模型。
export class ToolError extends UserFacingError {}
```

这样，读取工具可以用自己的错误类型说明“参数无效”“文件不存在”等情况。03.2 仍会结束本轮，03.3 再让主循环识别这种错误并发回模型。

### 2. 把工具说明接上真实读取

用下面的完整文件替换 `tools/read-file.ts`。原来的 `readFileDefinition` 保留；新增代码先解析参数、找到项目根，再检查真实目标并读取文件。

```ts
/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：把模型给出的 JSON 参数变成一次经过参数和路径检查的文件读取。
 * 输入：arguments JSON 字符串，以及从启动位置向上找到的最近项目根目录。
 * 输出：成功时返回按 UTF-8 解码的文本；参数、路径或文件不合法时抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       JSON 可解析？ ---- 否 ---> ToolError
 *            | 是
 *            v
 *       path 是非空字符串？-- 否 ---> ToolError
 *            | 是
 *            v
 *   检查时 realpath 在项目根目录内？-- 否 ---> ToolError
 *            | 是
 *            v
 *       非 .env 且为普通文件？-- 否 ---> ToolError
 *            | 是
 *            v
 *       文件 <= 64 KiB？ ------ 否 ---> ToolError
 *            | 是
 *            v
 *       readFile(utf8) ----------> 文件内容
 *
 * 关键点：模型输出属于不可信输入，即使参数声明了 JSON Schema，本地仍必须重新校验。
 * realpath 会解析符号链接，因此能拒绝检查时已经指向项目外的目标。
 * 检查与读取不是同一个操作；当前实现假设本地工作区及其他进程可信，不是文件系统沙箱。
 * .env 系列文件可能保存模型密钥，因此直接拒绝读取；第 05 章也会保留这条规则。
 * 64 KiB（65,536 字节）是固定保护上限；第 04 章会增加分段读取和结果控制。
 * 运行观察：从仓库内的小节目录启动也能读取根目录文件；越界路径仍会停止。
 */

import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError } from "../errors.js";

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

// [NEW 03.2] 先限制整文件读取的大小。
const MAX_FILE_BYTES = 64 * 1024;

/**
 * 识别不允许工具读取的 .env 系列文件名。
 *
 * 输入可以是模型路径，也可以是 realpath 得到的真实路径。
 * 只取最后一段名称并忽略大小写，命中 .env、.env.* 或 .envrc 时返回 true。
 * 这样同一类文件放在不同目录里，仍会被名称规则识别。
 */
// [NEW 03.2] 模型路径和解析后的真实路径都用这条名称规则。
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 先确认读取请求只包含一个可用的相对路径。
 *
 * 参数来自模型，先解析 JSON，再检查对象是否只有非空字符串 path，并去掉首尾空格。
 * JSON、字段或相对路径要求不满足时抛出 ToolError；通过后返回路径字符串。
 * 这里只检查参数，文件是否存在、真实位置在哪里，要在读取前继续确认。
 */
// [NEW 03.2] 读取前重新检查模型参数。
function parsePath(argumentsJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("参数必须是包含 path 的对象。");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "path" || typeof entries[0][1] !== "string") {
    throw new ToolError("参数只能包含非空字符串 path。");
  }
  const path = entries[0][1].trim();
  if (!path) throw new ToolError("path 不能为空。");
  if (isAbsolute(path)) throw new ToolError("path 必须是当前项目根目录内的相对路径。");
  return path;
}

/**
 * 找到最近的 package.json，让文件工具共用同一个相对路径起点。
 *
 * 从 start 开始逐级向上查找；默认起点是 process.cwd()。
 * 找到时返回该目录，找不到时返回规范化后的原起点。
 * 这里只确定项目根，不检查某个文件是否允许读取，也不提供文件系统隔离。
 */
// [NEW 03.2] 从子目录启动时，也让路径相对于项目根解释。
function findProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

/**
 * 检查模型要读的文件，再把完整正文返回给主循环。
 *
 * 输入是模型的 JSON 参数和项目根。先检查相对路径与 .env 名称，再解析符号链接，
 * 确认检查时的真实目标位于项目内、是普通文件且不超过 64 KiB，最后才读取正文。
 * 成功返回 UTF-8 正文，由主循环配上调用 ID，再发送给模型。
 * 参数和预期文件检查失败时抛出 ToolError；后续 stat() 或读取异常交给外层处理。
 * 检查与打开是两个操作，不能阻止其他进程在中间替换或增大文件；这里不是文件系统沙箱。
 * 内容按 UTF-8 解码，但没有验证具体编码或二进制格式。
 */
// [CHANGED 03.2] read_file 从“只有工具定义”变为真正校验边界并读取文件。
export async function readFileTool(argumentsJson: string, projectRoot = findProjectRoot()): Promise<string> {
  const path = parsePath(argumentsJson);
  if (isEnvironmentFile(path)) throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  let projectRootPath: string;
  let filePath: string;
  try {
    projectRootPath = await realpath(projectRoot);
    filePath = await realpath(resolve(projectRootPath, path));
  } catch {
    throw new ToolError(`文件不存在或无法访问：${path}`);
  }
  const pathFromProjectRoot = relative(projectRootPath, filePath);
  if (pathFromProjectRoot === ".." || pathFromProjectRoot.startsWith(`..${sep}`) || isAbsolute(pathFromProjectRoot)) {
    throw new ToolError("path 不能离开当前项目根目录。");
  }
  // 检查此刻解析到的真实目标，拒绝已经通过符号链接指向同目录 .env 的路径。
  if (isEnvironmentFile(pathFromProjectRoot)) {
    throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ToolError(`目标不是普通文件：${path}`);
  if (fileStat.size > MAX_FILE_BYTES) throw new ToolError("文件超过 64 KiB，本章暂不读取。");
  return readFile(filePath, "utf8");
}
```

注意这里先检查模型填写的文件名，再检查解析后的真实文件名。这样，给 `.env` 起一个符号链接别名，也不能绕过已经存在目标的名称检查。

### 3. 用名称找到读取函数

用下面的完整文件替换 `tools/registry.ts`。新增的 `executeTool()` 是主循环唯一需要调用的工具入口：

```ts
/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] tools/registry.ts
 *
 * 学习目标：让 Agent Loop 只通过一个入口查找并执行工具。
 * 输入：统一的 ToolCall，包含调用 ID、名称和 JSON 参数。
 * 输出：已知名称转交对应实现；未知名称抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+      name == read_file？
 *   | ToolCall | ---> | 是 --> readFileTool(arguments) --> 文本
 *   +----------+      | 否 --> ToolError
 *
 * 关键点：模型只能请求工具，真正可执行的名称由本地注册表决定。
 * 调用 ID 不参与文件读取；Agent Loop 会用它把结果配回原来的工具请求。
 * 运行观察：read_file 可以执行；任何未注册名称都不会变成函数调用。
 */

import { ToolError } from "../errors.js";
import { readFileDefinition, readFileTool } from "./read-file.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export const toolDefinitions = [readFileDefinition];

// [NEW 03.2] 使用显式分支即可覆盖当前唯一工具；工具增多后再扩展注册方式。
/**
 * 把已登记的工具名称对应到本地实现。
 *
 * 输入是通过模型适配层检查的 ToolCall；这里只在明确的名称分支里调用工具。
 * 成功返回工具的文本结果，未知名称抛出 ToolError；具体参数仍由对应工具校验。
 * 调用 ID 留给 Agent Loop 配对结果，注册表不修改历史，也不负责终端显示。
 */
export async function executeTool(call: ToolCall): Promise<string> {
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments);
  throw new ToolError(`未知工具：${call.name}`);
}
```

调用 ID 不参与读取，它留在主循环中，用于把返回正文配回模型的原请求。

### 4. 让消息能够保存工具请求和结果

用下面的完整文件替换 `models/client.ts`。这次主要变化是三种 `Message`，以及两个消息转换函数。OpenAI 的工具结果有独立的 `tool` 角色；Anthropic 则把连续结果合成一条 `user` 消息中的多个 `tool_result` 块。

这些差异只在这里处理。发送请求时，`requestResult()` 改为调用对应转换函数，主循环继续使用本地 `Message[]`。

```ts
/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] models/client.ts
 *
 * 学习目标：让统一消息既能保存工具请求，也能保存按调用 ID 配对的工具结果。
 * 输入：user、assistant、tool 三类本地消息和 read_file 定义。
 * 输出：两种协议各自需要的请求结构，以及统一的 ModelResult。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-------------------------+
 *   | local Message[]         |
 *   | user / assistant / tool |
 *   +------------+------------+
 *                +-- OpenAI ----> assistant.tool_calls + role=tool
 *                |
 *                +-- Anthropic -> tool_use + user.tool_result
 *                                      |
 *                                      v
 *                                provider response
 *                                      |
 *                                      v
 *                          text + normalized ToolCall[]
 *
 * 关键点：工具请求和工具结果必须使用同一个调用 ID，否则模型无法判断结果属于哪次请求。
 * 本地 Message 隔离服务商格式；Agent Loop 不需要知道 tool_calls 或 tool_result 字段。
 * 服务商响应属于外部输入，进入本地 ToolCall 前仍要检查 ID、名称和参数。
 * 运行观察：第二次模型请求同时包含第一次的工具请求和对应结果。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";

// [CHANGED 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };

export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};
export type ModelResult = Reply & { toolCalls: ToolCall[] };

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
function normalizeToolCall(id: unknown, name: unknown, argumentsJson: unknown): ToolCall {
  if (typeof id !== "string" || !id.trim()
    || typeof name !== "string" || !name.trim()
    || typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    throw new UserFacingError("接口返回了无效的工具请求：调用 ID、名称和参数必须是非空字符串。");
  }
  return { id, name, arguments: argumentsJson };
}

/**
 * 把本地消息转换成 OpenAI 接口能识别的工具对话。
 *
 * 输入包含用户文字、模型请求和工具结果。输出保留原来的消息顺序与调用 ID，
 * 让 tool_call_id 能找到前面 assistant 消息中的请求。
 * 这里只转换内存中的数据，不发送请求，也不执行工具。
 */
// [NEW 03.2] 把本地三类消息转成 OpenAI 的工具消息。
function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "user") return message;
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  });
}

/**
 * 把本地消息转换成 Anthropic 的内容块，并把工具结果配回请求。
 *
 * 模型请求转换为 tool_use，结果转换为同 ID 的 tool_result；
 * 连续的工具结果放进同一条 user 消息，满足这个接口对结果消息的组织方式。
 * 返回转换后的数组，不发送请求。若历史里的参数不是合法 JSON，转换会抛错。
 */
// [NEW 03.2] 把连续工具结果合成 Anthropic 的同一条 user 消息。
function toAnthropicMessages(messages: Message[]): MessageParam[] {
  const converted: MessageParam[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (!message) break;
    if (message.role === "tool") {
      // Anthropic 把连续工具结果放进同一条 user 消息；OpenAI 则使用独立的 role=tool。
      const results: ContentBlockParam[] = [];
      while (messages[index]?.role === "tool") {
        const toolMessage = messages[index] as Extract<Message, { role: "tool" }>;
        results.push({
          type: "tool_result",
          tool_use_id: toolMessage.toolCallId,
          content: toolMessage.content,
          is_error: toolMessage.isError,
        });
        index += 1;
      }
      converted.push({ role: "user", content: results });
      continue;
    }
    if (message.role === "user") {
      converted.push(message);
      index += 1;
      continue;
    }
    const content: ContentBlockParam[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: JSON.parse(call.arguments) });
    }
    converted.push({ role: "assistant", content });
    index += 1;
  }
  return converted;
}

/**
 * 发送消息和当前工具说明，再把服务商响应整理成 ModelResult。
 *
 * 输入是客户端、模型 ID、消息数组和取消信号；根据客户端协议发送相应字段。
 * 返回文本、工具请求、用量和截断状态。只要含有工具请求，文本为空也可以是正常响应。
 * 既没有文字也没有工具请求时抛出 UserFacingError；工具基础字段由 normalizeToolCall() 检查。
 * 网络、认证、取消或消息转换失败继续向外抛出；这里不执行工具，也不保存会话历史。
 */
// [CHANGED 03.2] 发送前调用对应转换函数，把上一轮工具结果也带给模型。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
): Promise<ModelResult> {
  if (client instanceof OpenAI) {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          parameters: tool.inputSchema, strict: true,
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
      text, toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: choice.finish_reason === "length",
    };
  }

  const response = await client.messages.create({
    model, system: systemPrompt, messages: toAnthropicMessages(messages),
    tools: toolDefinitions.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema,
    })),
    max_tokens: 2048, stream: false,
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
    text, toolCalls,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: response.stop_reason === "max_tokens",
  };
}
```

### 5. 执行工具后，再带着结果请求模型

用下面的完整文件替换 `agent/agent-loop.ts`。03.1 的一次请求现在放进最多执行 8 次的循环里。每次有工具请求，先保存那条 assistant 消息，再逐个执行并保存同 ID 结果；没有工具请求时，才返回最终文字并提交历史。

```ts
/**
 * 03.2 执行 read_file 并回传结果 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在已有主循环里接通“请求工具 -> 本地执行 -> 回传结果 -> 再判断”。
 * 输入：终端文本、history、支持工具消息的 Model 和 AbortSignal。
 * 输出：最终回答与累计用量；任一步失败时，本轮候选消息不写入 history。
 *
 * 全局主流程（本节版本）：
 *
 * [KEEP]             [CHANGED 03.2]        [KEEP 03.1]
 * +----------+      +----------------+     +----------------+
 * | Terminal | ---> | agentLoop      | --> | model.generate |
 * +----^-----+      | turn + history |     +-------+--------+
 *      |            +-------+--------+             |
 *      |                    ^                返回哪种结果？
 *      |                    |          +-----------+-----------+
 *      |                    |          | final text            | tool call(s)
 *      |                    |          v                       v
 *      |                    |   提交完整 turn          [NEW 03.2] registry
 *      |                    |          |                       |
 *      |                    |          v                 validate + read_file
 *      +--- 显示回答 <------+------ return                     |
 *                           |                                  v
 *                           +-------- tool result + call ID ----+
 *
 * 异常或取消 -----------------> 丢弃 turn，不修改 history，向外抛错
 * 第 8 次仍请求工具 ----------> 不执行该工具，停止并丢弃 turn
 *
 * [NEW] 是本地工具执行和结果回传；回传后沿箭头再次请求模型，形成 Agent Loop。
 * 模型只生成结构化请求，Node.js 才真正读取文件；调用 ID 负责配对请求与结果。
 * 只有拿到最终回答才提交整个 turn，避免下次会话继承一条不完整消息链。
 * 运行观察：模型先请求 read_file，收到文件内容后再生成最终回答。
 */

import { UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { executeTool } from "../tools/registry.js";

// [NEW 03.2] 开始循环时，同时规定最多请求模型几次。
const MAX_MODEL_CALLS = 8;

/**
 * 累加本轮各次模型请求报告的用量。
 *
 * total 或 value 为 null，表示有一次用量未知，合计也只能返回 null。
 * 两项都有数字时才相加，避免把不完整的统计显示成完整总量。
 */
// [NEW 03.2] 一轮可能多次请求模型，因此累计用量。
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 执行模型提出的工具请求，再带着结果请求模型，直到得到最终回答。
 *
 * 输入是模型、已完成历史、用户文字和取消信号。本轮消息先保存在局部 turn 中。
 * 工具请求与结果按调用 ID 配对；没有新的工具请求时，才把完整 turn 加入 history 并返回累计用量。
 * 最多请求模型 8 次，第 8 次仍要用工具就停止，避免执行无法再发回模型的操作。
 * 工具失败、模型异常或取消都会抛给外层，本轮不保存；把 ToolError 发回模型留到 03.3。
 */
// [CHANGED 03.2] 主循环开始执行已登记工具，并把带调用 ID 的结果追加到本轮候选消息。
export async function agentLoop(
  model: Model, history: Message[], input: string, signal: AbortSignal,
): Promise<Reply> {
  signal.throwIfAborted();
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;

  for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
    // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
    signal.throwIfAborted();
    const result = await model.generate([...history, ...turn], signal);
    inputTokens = addUsage(inputTokens, result.inputTokens);
    outputTokens = addUsage(outputTokens, result.outputTokens);
    truncated ||= result.truncated;

    if (result.toolCalls.length === 0) {
      if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
      signal.throwIfAborted();
      turn.push({ role: "assistant", content: result.text });
      history.push(...turn);
      return { text: result.text, inputTokens, outputTokens, truncated };
    }

    // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
    if (modelCall === MAX_MODEL_CALLS) break;

    // 先保存模型提出的完整调用，再逐个保存同 ID 的结果；下一次请求才能还原因果关系。
    turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      signal.throwIfAborted();
      const content = await executeTool(call);
      turn.push({ role: "tool", toolCallId: call.id, content, isError: false });
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
```

这里的外层 `for` 计算模型请求次数，内层 `for` 处理同一次响应中的全部工具请求。一个响应包含两个工具，不会让模型请求计数增加两次。

### 6. 更新模型对当前能力的认识

在 `config/load-config.ts` 中，用下面这一项替换原来的 `systemPrompt`：

```ts
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。你可以调用 read_file 读取当前项目根目录内的普通文件，但 .env 系列环境配置文件不可读取。你不能修改文件或执行命令，也不要声称已经完成这些操作。需要文件内容时必须调用工具，不要猜测。";
```

读取已经接通，因此提示词可以说明真实读取能力；文件修改和命令执行仍没有实现。

### 构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:03.2
```

```bash
hello-my-agent --prompt "请读取 package.json，只告诉我 name 字段。"
```

预期回答包含：

```text
@sherlockmen/hello-my-agent
```

终端目前只显示最终回答和累计用量。第四章会加入 `AgentEvent` 和文本过程记录；第 09 章再扩展 JSONL 等输出约定，第 10 章接入 TUI。

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
```

```bash
hello-my-agent --prompt "请读取 definitely-missing.txt。"
```

本节的 `readFileTool()` 会抛出 `ToolError`，当前轮停止，历史不变。03.2 先建立成功路径；下一节会把这种可预期错误作为工具结果交还模型，让模型可以修正路径或解释失败。

如果模型没有选择工具而是直接说明文件不存在，这只能证明模型作出了文本判断，不能证明路径校验已运行。`npm run check:03` 使用固定工具请求验证真实错误分支。

## 小练习

解释为什么工具结果不能写成普通的 `{ role: "user", content: fileText }`。

答案：这样会丢失结果来源、成功状态和调用 ID。模型无法确定文本属于哪个请求，服务商协议也可能认为工具调用缺少结果。正确做法是先保留 assistant 的工具请求，再添加带同一 ID 的工具结果。完整的并列调用练习见 [本章练习](../EXERCISES.md)。

## 本节完成后的 Agent

现在，模型提出的读取请求已经能真正影响回答：

```text
模型请求 read_file
   -> 注册表找到已登记的读取函数
   -> read_file 校验路径并读取文件
   -> 带原调用 ID 的工具结果进入当前回合
   -> 模型读取结果并返回最终回答
```

Agent 已经能读取一个已知文件，但参数错误、文件不存在和未知工具仍会抛出异常并结束本轮。下一节将把这些可预期失败也转换成工具结果，让模型有机会修正请求，同时保留轮次上限防止无限循环。
