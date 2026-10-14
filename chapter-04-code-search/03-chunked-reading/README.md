# 04.3 把代码位置变成上下文

[上一节：把文本目标变成代码位置](../02-content-search/README.md) · [第四章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

上一节，我们让模型拿到了目标出现的位置。接下来，它还要读到周围的代码，才能解释这里究竟做了什么。

## 问题：找到了函数名，还没看到函数体

上一节的搜索结果可能长这样，行号在这里用作示例：

```text
chapter-04-code-search/03-chunked-reading/src/models/client.ts:59:17: export function createModel(config: Config): Model {
```

在这份示例中，第 59 行只有函数开头。它没有说明 `config.provider` 怎样参与选择，也没有展示函数最后返回什么。要解释函数，模型还得读到这些后续内容。

第三章的 `read_file(path)` 一次返回整个小文件，超过 64 KiB 就拒绝。文件较大时，我们也未必需要它的全部内容：开头几百行可能都与当前函数无关，却会在后续每次请求中继续占据上下文。

这一节把读取方式改成按行选择一段。模型先读目标附近的代码，已经够用就回答，不够再读下一段。

## 解决方案：从指定行开始读，保留继续读取的位置

我们给 `read_file` 增加起始行和行数。模型可以把搜索得到的行号放在一个读取范围里，例如从第 50 行开始，最多读 60 行：

```json
{
  "path": "chapter-04-code-search/03-chunked-reading/src/models/client.ts",
  "offset": 50,
  "limit": 60
}
```

- `offset` 是从 1 开始的起始行，与 `grep` 和编辑器行号一致。
- `limit` 是本次最多返回的行数，范围为 1 到 400。

执行链：

```text
模型生成 path + offset + limit
        |
        v
校验 JSON、字段、相对路径和整数范围
        +-- 失败 --> 带原调用 ID 的错误结果 --> 模型重新决策
        |
        v
检查此刻的真实路径、文件类型和 10 MiB 上限
        |
        v
从文件开头逐行经过，跳过 offset 之前的内容
        |
        v
保留 limit 行，再观察一行判断是否还有后文
        |
        v
返回带真实行号的片段和下一次 offset
        |
        v
Agent Loop 把片段交回模型，直到模型给出最终回答
```

参数或文件检查产生 `ToolError` 时，失败说明沿用第三章的规则回到模型；取消、程序故障或轮次超限则停止本轮，不提交不完整历史。

## 工作原理

按行读取主要要回答两个问题：这次返回哪些行，以及模型怎样知道后面还有没有内容。我们继续使用原来的工具循环，让模型在每次收到片段后决定是否再读，不由读取工具自动把整份文件送完。

### 1. `grep` 提供位置，`read_file` 提供上下文

沿用刚才的示例，`grep` 返回：

```text
chapter-04-code-search/03-chunked-reading/src/models/client.ts:59:17: export function createModel(config: Config): Model {
```

第 59 行只是一个坐标。要解释 `createModel`，模型通常还需要看到函数前面的注释、函数体和返回分支。因此，模型根据当前任务选择一个包含第 59 行的读取范围：

```json
{
  "path": "chapter-04-code-search/03-chunked-reading/src/models/client.ts",
  "offset": 50,
  "limit": 60
}
```

这三个参数的含义是：读取该文件，从第 50 行开始，最多返回 60 行。若文件足够长，本次窗口覆盖第 50—109 行。

```text
用户要求解释 createModel
          |
          v
模型调用 grep("createModel")
          |
          v
程序返回：目标位于第 59 行
          |
          v
模型调用 read_file(path, offset=50, limit=60)
          |
          v
程序返回：第 50—109 行源码 + 后面是否还有内容
          |
          +-- 信息足够 --> 模型给出最终回答
          |
          +-- 信息不足 --> 模型调整 offset，再读一段
```

这里没有程序预设的“先 `grep`、再 `read_file`”工作流。Agent Loop 把每次工具结果交回模型，由模型根据已有证据选择下一步。

### 2. `read_file` 怎样取出指定范围

以 `offset=3、limit=2` 为例：

```text
1: import { readFile } from "node:fs/promises";
2:
3: export function target() {
4:   return "answer";
5: }
6:
7: export function other() {}
```

读取过程只有三步：

1. 跳过第 1、2 行，因为它们位于 `offset` 之前。
2. 保存第 3、4 行，因为 `limit=2`。
3. 再观察第 5 行，但不把它放进结果。第 5 行的存在证明文件后面还有内容。

模型收到：

```text
3: export function target() {
4:   return "answer";
[显示第 3-4 行；后面还有内容，请把 offset 设为 5 继续]
```

程序必须多观察一行才能正确计算 `hasMore`。如果文件恰好在第 4 行结束，结果就会标记“已到文件末尾”；如果第 5 行存在，下一段应从第 5 行开始。

源码使用 `createReadStream()` 和 `readline` 从文件开头逐行处理。这样不需要先把整个文件装入一个字符串，但普通文本文件没有内建的行号索引，所以读取第 5000 行时仍要经过前 4999 行。这里减少的是内存占用和发送给模型的文本量，不是跳转到任意行所需的扫描时间。

### 3. 一次工具执行产生两种结果

`readFileTool()` 返回：

```ts
{
  content: "50: ...\n51: ...\n[显示第 50-109 行；后面还有内容，请把 offset 设为 110 继续]",
  metadata: {
    kind: "read_file",
    lineCount: 60,
    startLine: 50,
    endLine: 109,
    hasMore: true,
  },
}
```

- `content` 包含真正的源码，Agent Loop 把它作为工具结果发回模型。
- `metadata` 只描述这次读取，终端用它显示“读取了第 50—109 行”。

两者来自同一次工具执行。界面不需要解析源码文本，模型也不需要接收专门为界面准备的中文过程说明。第 09 章会继续扩展 JSONL 等事件输出，第 10 章再接入 TUI。它们可以读取同样的范围数据，不必从源码文字中提取行号。

### 4. 信息不足时，Agent Loop 怎样继续

如果第 50—109 行已经包含完整函数，模型可以直接回答。如果函数还没有结束，模型会看到“后面还有内容”的续读提示，可以再发出一次工具请求：

```json
{
  "path": "chapter-04-code-search/03-chunked-reading/src/models/client.ts",
  "offset": 110,
  "limit": 60
}
```

第二次读取结果仍以工具消息加入当前回合。Agent Loop 不需要为“续读”增加特殊分支，它仍然执行同一条规则：

```text
模型请求工具
    -> 程序执行工具
    -> 工具结果加入当前回合
    -> 模型读取新增结果并再次决策
```

`hasMore` 只说明文件还有后文，不说明后文对任务一定有用。即使它是 `true`，当前片段也可能已经包含完整的 `createModel`，模型这时就可以回答。若片段里出现另一个需要理解的函数，它也可以改读那个位置。

这就是分段读取节省上下文的原因：模型有机会在每段之后停下来，而不是程序自动把一个大文件的所有分段都发送完。

### 实现边界

每次最多返回 400 行；每行过长时，保留前 1000 个原字符，再追加“本行已截断”标记和行号。这两条限制减少发送给模型的正文，但不意味着读取时一行最多占 1000 个字符：`readline` 仍要先取得整行，随后才截短。

工具检查项目范围、`.env` 系列文件和普通文件类型，也会拒绝检查时超过 10 MiB 的文件。和第三章一样，路径、大小检查与实际打开文件不是同一个操作；当前实现假设这是可信的本地工作区，不能抵抗恶意并发替换。

两次读取之间，编辑器也可能插入或删除行。此时下一次 `offset` 对应的是新版本的行号，不保证和前一段连续。本节没有读取快照。第 06 章会在保存修改之前检查文件是否变化，那是写入检查，不会让这里的多次读取自动看到同一个版本。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/tools/read-file.ts](src/tools/read-file.ts) | 校验 `offset` 和 `limit`，返回带行号的有限片段。 |
| 修改 | [src/tools/types.ts](src/tools/types.ts) | 给 `read_file` 元数据增加行号范围和续读状态。 |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 显示读取参数和真实行号范围。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 提醒模型根据搜索位置分段读取。 |

`glob`、`grep`、注册表、`AgentEvent` 和 Agent Loop 都沿用上一节。本节只扩展 `read_file` 的输入、结果元数据和显示方式。

## 动手构建

本节仍使用已有的 `read_file` 名称，只改变它的参数和读取方式。下文路径都相对于本节 `src/`，注册表、模型适配层和主循环保持不变。

### 1. 把整文件读取改为按行读取

用下面的完整文件替换 `tools/read-file.ts`。`parseArguments()` 要求模型提供全部三个字段；`resolveReadableFile()` 先完成文件检查；最后的读取循环负责跳过前文、收集目标行和多看一行。

无论正常读完、提前停止还是抛错，`finally` 都关闭行读取器并销毁文件流，避免一次分段读取结束后仍占着资源。

```ts
/**
 * 04.3 把代码位置变成上下文 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：根据搜索得到的行号读取一段源码，并让模型知道怎样继续读取下一段。
 * 输入：path、从 1 开始的 offset 和 1 到 400 之间的 limit。
 * 输出：给模型的带行号片段，以及给界面的行号范围与续读状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       参数有效？ -------- 否 ---> ToolError
 *            | 是
 *            v
 *   检查时 realpath 在项目内？-- 否 ---> ToolError
 *            | 是
 *            v
 *   非 .env 且为普通文件？-- 否 ---> ToolError
 *            | 是
 *            v
 *   逐行跳过 offset 前内容 --> 收集 limit 行 --> 带行号片段
 *                                      |
 *                                      +--> 还有内容：提示下一次 offset
 *                                      +--> 已结束：标记到达文件末尾
 *
 * 关键点：grep 返回位置，read_file 读取位置附近的上下文。分段读取限制返回给模型的文本量，
 * 不必因为一个大文件把整份内容放入消息历史。真实路径检查会拒绝检查时已经越界的目标，
 * 但不会把路径读取变成抵抗并发替换的文件系统沙箱。
 * 运行观察：offset=20、limit=40 只返回第 20 行开始的最多 40 行，并提示是否继续。
 */

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [CHANGED 04.3] read_file 契约新增 offset/limit，执行改为按行读取有限片段。
export const readFileDefinition = {
  name: "read_file",
  description: "按行读取项目内文件的一段内容。offset 从 1 开始，limit 最大为 400；不读取 .env 系列文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于项目根目录的文件路径。",
      },
      offset: {
        type: "integer" as const,
        minimum: 1,
        description: "开始读取的行号，从 1 开始。",
      },
      limit: {
        type: "integer" as const,
        minimum: 1,
        maximum: 400,
        description: "最多返回多少行。",
      },
    },
    required: ["path", "offset", "limit"],
    additionalProperties: false,
  },
};

// [CHANGED 04.3] 新增行数与单行长度限制，并允许检查时不超过 10 MiB 的文件。
const MAX_LIMIT = 400;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LINE_CHARS = 1000;

// [CHANGED 04.3] 校验后的读取参数同时保存路径与行范围。
type ReadArguments = { path: string; offset: number; limit: number };

/**
 * 识别不允许工具读取的 .env 系列文件名。
 *
 * 输入可以是模型路径，也可以是 realpath 得到的真实路径。
 * 只取最后一段名称并忽略大小写，命中 .env、.env.* 或 .envrc 时返回 true。
 * 这样同一类文件放在不同目录里，仍会被名称规则识别。
 */
function isEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".envrc";
}

/**
 * 确认模型同时给出了相对路径、起始行和读取行数。
 *
 * JSON 对象必须恰好包含 path、offset、limit；path 非空且不能是绝对路径，
 * offset 是至少为 1 的整数，limit 是 1 到 400 的整数。任何一项不满足就抛出 ToolError。
 * 成功只返回整理后的参数，不读取文件；文件位置和大小接下来才检查。
 */
// [CHANGED 04.3] 从只接收 path 改为同时检查 offset 和 limit。
function parseArguments(argumentsJson: string): ReadArguments {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("read_file 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("read_file 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 3 || !keys.every((key) => ["path", "offset", "limit"].includes(key))) {
    throw new ToolError("read_file 参数必须且只能包含 path、offset 和 limit。");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new ToolError("read_file path 必须是非空字符串。");
  }
  const path = input.path.trim();
  if (isAbsolute(path)) throw new ToolError("path 必须是当前项目根目录内的相对路径。");
  if (!Number.isInteger(input.offset) || (input.offset as number) < 1) {
    throw new ToolError("read_file offset 必须是从 1 开始的整数。");
  }
  if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > MAX_LIMIT) {
    throw new ToolError(`read_file limit 必须是 1 到 ${MAX_LIMIT} 之间的整数。`);
  }
  return { path, offset: input.offset as number, limit: input.limit as number };
}

/**
 * 缩短单个超长行，补上只限制行数还不够的地方。
 *
 * 超过 1000 个原字符时，保留开头 1000 个，再追加省略号和“本行已截断”提示。
 * 输入已经是读取出来的一整行，所以这个限制只减少返回正文，不限制读入整行时的内存。
 */
// [NEW 04.3] 行数少也可能包含超长行，因此再限制返回的行正文。
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}… [本行已截断]`;
}

/**
 * 在打开文件前检查相对路径，并取得此刻解析到的真实位置。
 *
 * 输入是模型路径和项目根。先拒绝 .env 系列名称，再用 realpath 解析符号链接，
 * 检查真实目标仍在项目内、不是环境文件、是普通文件且此刻不超过 10 MiB。
 * 这些检查失败时抛出 ToolError；realpath 之后的 stat() 系统异常继续向外传播。
 * 返回的是路径字符串，不是已经锁定的文件；其他进程仍可能在检查后替换它。
 */
// [NEW 04.3] 先完成路径和文件检查，再建立按行读取的文件流。
async function resolveReadableFile(path: string, projectRoot: string): Promise<string> {
  if (isEnvironmentFile(path)) throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  let rootPath: string;
  let filePath: string;
  try {
    rootPath = await realpath(projectRoot);
    filePath = await realpath(resolve(rootPath, path));
  } catch {
    throw new ToolError(`文件不存在或无法访问：${path}`);
  }
  const relativePath = relative(rootPath, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new ToolError("path 不能离开当前项目根目录。");
  }
  if (isEnvironmentFile(relativePath)) {
    throw new ToolError("为防止泄露凭据，read_file 不读取 .env 系列文件。");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new ToolError(`目标不是普通文件：${path}`);
  if (fileStat.size > MAX_FILE_BYTES) throw new ToolError("文件超过 10 MiB，本章暂不读取。");
  return filePath;
}

/**
 * 返回模型指定的一段源码，并说明下一段该从哪行开始。
 *
 * 参数和真实路径检查通过后，从文件开头逐行经过，跳过 offset 之前的行，再收集最多 limit 行。
 * 多看到一行才设置 hasMore；content 带源码与续读提示，metadata 带真实行号范围供终端显示。
 * 空文件且 offset=1 时正常返回空文件说明；其他越过文件末尾的起点抛出 ToolError。
 * 流读取、stat() 或取消异常继续向外传播；finally 无论成功失败都关闭行读取器并销毁文件流。
 * 这里只减少返回内容，读取靠后行仍要经过前文；多次调用也没有固定文件快照。
 * 检查与打开之间仍可发生路径变化，当前实现适用于可信本地工作区，不是文件系统沙箱。
 */
// [CHANGED 04.3] 逐行选出片段，多看一行后返回续读提示。
export async function readFileTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const filePath = await resolveReadableFile(input.path, projectRoot);
  const stream = createReadStream(filePath, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const selected: string[] = [];
  let lineNumber = 0;
  let hasMore = false;

  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      lineNumber += 1;
      if (lineNumber < input.offset) continue;
      if (selected.length === input.limit) {
        hasMore = true;
        break;
      }
      selected.push(`${lineNumber}: ${shortenLine(line)}`);
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  if (lineNumber === 0 && input.offset === 1) {
    return {
      content: `文件为空：${input.path}`,
      metadata: { kind: "read_file", lineCount: 0 },
    };
  }
  if (selected.length === 0) throw new ToolError(`起始行 ${input.offset} 超过文件范围。`);
  const lastLine = input.offset + selected.length - 1;
  const status = hasMore
    ? `[显示第 ${input.offset}-${lastLine} 行；后面还有内容，请把 offset 设为 ${lastLine + 1} 继续]`
    : `[显示第 ${input.offset}-${lastLine} 行；已到文件末尾]`;
  return {
    content: `${selected.join("\n")}\n${status}`,
    metadata: {
      kind: "read_file",
      lineCount: selected.length,
      startLine: input.offset,
      endLine: lastLine,
      hasMore,
    },
  };
}
```

### 2. 记录这次实际返回的行范围

用下面的完整文件替换 `tools/types.ts`。空文件和普通片段分别表示，终端不会给空文件显示一个不存在的起止行：

```ts
/**
 * 04.3 把代码位置变成上下文 | [CHANGED] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节给 read_file 增加起止行和 hasMore，空文件单独用 lineCount=0 表示。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
 */

export type ToolResultMetadata =
  // [CHANGED 04.3] read_file 元数据开始区分空文件和带范围的源码片段。
  | { kind: "read_file"; lineCount: 0 }
  | {
      kind: "read_file";
      lineCount: number;
      startLine: number;
      endLine: number;
      hasMore: boolean;
    }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] }
  | {
      kind: "grep";
      count: number;
      truncated: boolean;
      locations: Array<{ path: string; line: number; column: number }>;
    };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};
```

### 3. 让终端显示实际行号

在 `ui/teaching-trace.ts` 中，用下面的完整函数替换 `describeToolResult()`。`glob` 和 `grep` 的显示保持原样，读取结果改为显示元数据中的起止行：

```ts
/**
 * 根据工具自己提供的元数据，生成结果摘要。
 *
 * glob 显示路径数，grep 显示匹配数和位置，read_file 显示实际起止行；空文件显示 0 行。
 * 路径示例还会经过显示筛选。这里不读取 content，所以无需从源码正文反推数量和位置。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }
  if (metadata.kind === "grep") {
    const examples = metadata.locations.slice(0, 2)
      .map(({ path, line, column }) => `${toTraceText(path)}:${line}:${column}`)
      .join("，");
    return `${metadata.count} 个匹配位置${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  // [CHANGED 04.3] 分段读取显示真实起止行，而不是只显示行数。
  if (metadata.lineCount === 0 || !("startLine" in metadata)) return "0 行文件内容";
  return `${metadata.lineCount} 行源码（第 ${metadata.startLine}—${metadata.endLine} 行）`;
}
```

### 4. 告诉模型怎样请求一段内容

在 `config/load-config.ts` 中替换 `systemPrompt`：

```ts
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。你可以调用 glob 查找文件、grep 搜索代码位置，再调用 read_file 按 offset 和 limit 分段读取普通文件；.env 系列环境配置文件不可读取。你不能修改文件或执行命令，也不要声称已经完成这些操作。需要项目信息时必须调用工具，不要猜测。";
```

`models/client.ts` 会从同一个工具定义列表里取得新的 Schema，因此不用再为两个服务商分别写一次行号参数。

### 构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:04.3
```

```bash
hello-my-agent --prompt "找到 createModel 的定义，读取函数附近代码并解释它返回什么。"
```

可以观察 `grep` 返回的位置与后续 `read_file` 的范围是否相接，以及最终回答是否基于读到的函数体。模型可能先找路径，也可能多读一段；工具顺序由本次任务和已读内容决定。

## 运行验证

```bash
npm run check:04
```

确定性检查会验证：

- `offset=2, limit=2` 只返回第 2、3 行，并提示下一段从第 4 行开始。
- `offset=0`、`limit=401`、`.env` 和检查前已越界的符号链接被拒绝。
- `glob -> grep -> read_file -> 最终回答` 的调用 ID、消息顺序和进度事件一一对应。
- 取消和历史提交规则仍然成立。

### 失败实验

使用本节实际存在的 `src/models/client.ts`，故意请求远超文件行数的第 99999 行。这里的完整路径相对于仓库根目录，用来验证已有文件的行号越界：

```text
read_file({
  "path": "chapter-04-code-search/03-chunked-reading/src/models/client.ts",
  "offset": 99999,
  "limit": 20
})
```

工具返回 `ToolError`，Agent Loop 把错误加入当前 `turn`。模型可以重新使用 `grep` 获取位置，或向用户说明文件没有那么多行。

### 小练习

`grep` 返回目标位于第 120 行。如果我们希望同时看到前面的注释和后面的函数体，可以请求：

```json
{
  "path": "src/example.ts",
  "offset": 110,
  "limit": 50
}
```

文件足够长时，这会返回第 110—159 行，包含目标前 10 行、目标行和后续 39 行。如果还需要后文，下一次把 `offset` 设为 160。上下文窗口大小由模型根据任务调整，本地程序只保证范围合法且输出受限。

## 本节完成后的 Agent

第四章结束时，Agent 已经具备一条完整的只读代码检索链：

```text
用户目标 -> Agent Loop -> 模型决定下一步
                          |-- glob(pattern) ------------> 候选路径
                          |-- grep(query, glob) --------> 候选匹配位置
                          |-- read_file(path, offset,
                          |             limit) ---------> 源码窗口
                          +-- 最终回答 -----------------> 提交本轮历史

每次工具结果 ------------------------------> 返回模型继续决策
```

一次任务可能经过 `glob → grep → read_file → 最终回答`，也可能跳过不需要的工具；顺序由模型根据工具结果决定。核心循环只产生结构化事件，当前终端据此显示执行过程。Agent 目前只有只读工具；[下一章](../../chapter-05-permission-gate/README.md)将在加入文件写入和命令执行之前，先建立 `allow`、`ask`、`deny` 权限决策以及需要用户确认的统一入口。
