# 04.2 把文本目标变成代码位置

[上一节：控制文件搜索范围](../01-file-discovery/README.md) · [第四章首页](../README.md) · [本节源码](src/) · [下一节：把代码位置变成上下文](../03-chunked-reading/README.md)

上一节，模型可以用 `glob` 找到一批 TypeScript 文件。接下来，我们要让它从这些文件中定位具体内容。

## 问题：知道有这些文件，还不知道函数在哪里

用户要求：

```text
找到 createModel 的定义。
```

文件名不一定含有 `createModel`。即使 `glob` 列出了所有 `.ts` 文件，模型也还不知道这个名称出现在哪里。若逐个读取，再把整份正文送给模型查找，就会花掉许多模型请求，还把大量无关内容放进消息里。

查找某段文本很适合交给本地程序。模型先把目标变成搜索条件，工具在文件里匹配，再只返回命中位置和所在行。本节把这个工具命名为 `grep`；这里的名字表示内容搜索能力，当前实现仍是 Node.js 代码，还没有调用系统命令。

例如，在一个把源码放在 `src/` 的项目中，可以这样表达搜索条件：

```ts
grep({
  query: "export\\s+function\\s+createModel",
  glob: "src/**/*.ts",
});
```

`query` 是正则表达式，表示要找的文字形状；`glob` 是路径模式，表示去哪些文件里找。在本书仓库中，模型应把范围改成相应小节的源码目录。返回的一项会有这样的形状，下面的行号仅作示意：

```text
chapter-04-code-search/02-content-search/src/models/client.ts:59:1: export function createModel(config: Config): Model {
```

它同时告诉模型文件路径、行号、列号和匹配行。模型就能引用位置，或者继续读取周围代码。

## 解决方案：在本地搜索，只把命中位置带回来

`grep` 先复用上一节的路径匹配，得到候选文件，再读取候选正文、逐行运行正则表达式。命中时，它保存文件路径、行号、列号和该行文本。没命中的文件不需要进入模型上下文。

```text
模型生成 query + glob
        |
        v
解析 JSON，校验字段、glob 和正则
        |
        v
复用 glob 得到候选文件（最多 500）
        |
        v
逐个检查大小并读取文本
        |
        +-- > 1 MiB 或含 NUL --> 跳过
        |
        v
逐行执行 RegExp
        |
        v
返回 path:line:column:text（最多 100 项）
        |
        v
Agent Loop 把位置结果交回模型
        |
        v
模型继续读取上下文，或给出最终回答
```

`glob` 控制“去哪里找”，`query` 控制“找什么”。把两者放在同一次调用里，搜索就不依赖上一次 `glob` 保存了什么。模型既可以根据刚才的路径列表选择范围，也可以一开始就直接给出范围。正则或参数无效时，工具返回带原调用 ID 的错误结果，模型可以修改查询后继续。

## 工作原理

沿着这次函数查找，工具结果会这样回到模型：

```text
1. 用户提出目标，模型只有名称，不知道它位于哪个文件和哪一行
2. 模型请求 grep，并给出 query 和 glob
3. 本地工具校验参数，在受控候选文件中搜索真实文本
4. 工具返回匹配位置或抛出 ToolError，Agent Loop 配上原调用 ID
5. Agent Loop 把位置或错误结果加入本轮消息，再次请求模型
6. 模型根据位置继续调用 read_file，或在证据已经足够时给出最终回答
```

正则匹配看的是文本，不会分析 TypeScript 语法树。`createModel` 可能出现在定义、调用、注释或字符串里。因此，搜索结果是值得继续看的位置，是否已经足够回答，要由模型结合匹配行和任务来判断。若任务是解释函数工作方式，通常还需要读取函数体。

### 1. 先把搜索目标说成文字模式

仅搜索 `createModel` 会找到这个名称的各种出现位置。加入 `export\s+function\s+`，就能把范围缩到更像函数定义的行。其中 `\s+` 表示一个或多个空白，因而普通空格和较宽的缩进都能匹配。

模型负责选择查询，程序负责执行匹配。两边约定的是：

```text
输入：query + glob
输出：path:line:column:text
失败：ToolError
```

Agent Loop 不必知道底层怎样搜索。注册表把 `grep` 名称映射到当前实现，工具结果仍用原调用 ID 回到模型。

工具名称和结果形状一致时，程序可以更换底层搜索方法，主循环仍然只做“执行请求，再发回结果”。本节先把逐行查找讲清楚，后面再说明为什么第 07 章要改用受控系统 `rg`。

### 2. JSON 和正则分别检查什么

模型协议返回：

```text
'{"query":"function\\s+createModel","glob":"src/**/*.ts"}'
```

本地程序依次执行：

```text
JSON 字符串
  -> JSON.parse：得到 unknown
  -> 对象形状：只能包含 query 和 glob
  -> 字段值：query 非空且 <= 500 字符，glob 不越界
  -> RegExp 编译：语法必须有效
  -> GrepArguments：执行层可以使用的内部值
```

这些检查各自回答不同问题：JSON 解析说明参数能读成一个值，对象和字段检查说明工具拿到了所需内容，正则编译才说明查询语法可执行。通过编译并不保证正则一定很快，耗时限制后面还会单独说明。

反斜杠会经过 JSON 和正则两次解释：

```text
JSON 文本中的 query：function\\s+createModel
JSON.parse 后：       function\s+createModel
RegExp 解释后：       function + 一个或多个空白 + createModel
```

如果模型给出 `[`，`new RegExp("[", "u")` 会在读取文件前失败。Agent Loop 把这次 `ToolError` 放回当前 `turn`，模型可以修正参数而不必终止整个任务。

### 3. 为什么先选候选文件，再搜索内容

`grepTool()` 复用 04.1 的 `findMatchingFiles()`：

```ts
const candidates = await findMatchingFiles(
  input.glob,
  projectRoot,
  MAX_FILES,
  signal,
);
```

这样项目根、`.gitignore` 和内置保护规则只有一份实现。`grep` 不再维护第二套目录遍历逻辑。

候选文件上限是 500。如果实际文件更多，`candidates.truncated` 会记录范围不完整，模型可以从返回提示中知道还有未检查的候选文件。

空结果只能说明本次实际检查的文本没有匹配，不能直接写成“整个项目没有这个函数”。除了候选范围可能截断，工具还会跳过过大、含 NUL 或无法读取的文件。范围过宽时，模型可以缩小 `glob` 再找；怀疑目标被跳过时，则要进一步确认文件情况。

### 4. 文本怎样变成行号和列号

每个候选文件先经过三项检查：

```ts
const filePath = join(projectRoot, path);
if ((await stat(filePath)).size > MAX_FILE_BYTES) continue;
content = await readFile(filePath, { encoding: "utf8", signal });
if (content.includes("\0")) continue;
```

- 大小检查会跳过当时已经超过 1 MiB 的文件。检查后文件仍可能变化，这不是对并发修改文件的严格内存保证。
- `readFile()` 接收同一个取消信号。
- NUL 字节是二进制文件的实用判断，不是完整格式识别。

程序随后逐行执行正则：

```ts
const match = expression.exec(line);
if (!match) continue;

matches.push({
  path,
  line: index + 1,
  column: (match.index ?? 0) + 1,
  text: shortenLine(line),
});
```

数组下标和 `match.index` 从 0 开始，源码位置从 1 开始，所以两者都加 1。JavaScript 的列索引按 UTF-16 code unit 计算；匹配位置前含有 emoji 时，它可能和编辑器显示列不同。本节返回的是可靠的行定位和近似列定位，不是语言服务器的语义位置。

当前实现一行只返回第一处匹配。同一行出现三次目标文本，也只生成一条结果。这足够帮助模型找到值得读取的行，却不能拿来精确统计这个词一共出现几次。匹配行很长时，只保留开头 300 个原字符再追加省略号；即使命中在更后面，位置仍会返回，但正文片段里可能看不到那个词。

### 5. 少返回结果和更快结束是两回事

| 上限 | 当前值 | 控制什么 | 没有控制什么 |
| --- | ---: | --- | --- |
| 候选文件 | 500 | 进入内容读取阶段的文件数 | glob 遍历耗时 |
| 单文件大小 | 检查时 1 MiB | 跳过当时已过大的文件 | 检查后文件增长、正则执行时间 |
| 匹配结果 | 100 | 进入模型上下文的结果条数 | 已经扫描的文件成本 |
| 单行正文 | 前 300 个原字符，再加省略号 | 返回的正文片段长度 | 原文件行长度、路径长度 |

结果上限同样使用“多看一项”的判断：只有观察到第 101 个匹配，程序才返回前 100 项并标记截断。恰好 100 项不能推断还有更多。

文件数和结果数上限不能阻止病态正则。`RegExp.exec()` 是同步调用；如果它发生灾难性回溯，JavaScript 事件循环在返回前无法检查 `AbortSignal`。这正是当前后端与生产搜索之间最重要的差距。

### 6. 系统 `grep` 与 `rg`

工具名叫 `grep`，不表示程序已经启动了系统 `grep`。本节自己读取候选文件，再用 JavaScript 正则逐行匹配，是为了让我们看清路径筛选、行号生成和结果回传如何配合。

真正调用系统 `rg`，除了换一个搜索函数，还要处理进程启动、工作目录、参数传递、退出码、输出大小、取消和超时。第 07 章会先讲受控子进程，再把内容搜索迁到这个执行方式。届时仍要保留本地参数校验和工具结果的形状，不能把模型生成的字符串直接拼成任意 shell 命令。

所以，当前的文件数和结果数上限只是这个教学实现已有的限制，不能代替未来的进程控制，也不能承诺任意正则都能及时取消。

### 7. 终端过程怎样对应真实控制流

下面用示意行号说明一次直接搜索的过程；实际位置以工具本次返回为准：

```text
模型 > 第 1 次决策
  收到：新增用户问题「找到 createModel 的定义」；Agent Loop 消息链共 1 条。
模型 < 第 1 次决策
  返回：1 个工具请求。
工具 > 第 1 步：grep
  执行：query="createModel"，glob="chapter-04-code-search/02-content-search/src/**/*.ts"。
工具 < 第 1 步：grep 完成
  返回：1 个匹配位置；示例：chapter-04-code-search/02-content-search/src/models/client.ts:59:17。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 2 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 3 条。
模型 < 第 2 次决策
  返回：最终回答，交给终端显示。
Agent > createModel 位于 chapter-04-code-search/02-content-search/src/models/client.ts:59。
```

`工具 <` 不表示用户任务已经完成，只表示本地搜索结果已经加入 `turn`。第二次模型调用可能直接回答，也可能继续请求 `read_file`。Agent Loop 负责“是否继续”，`grepTool()` 只负责返回这次查到了什么。

如果第一次模型响应同时返回两个 `grep` 请求，追踪会先显示“返回：2 个工具请求”，再依次出现工具第 1、2 步，最后才进入模型第 2 次决策。这表示两个搜索请求来自同一次模型响应；当前 Agent Loop 按顺序执行它们，并把两个结果一起交给下一次模型调用。

第 27 章会继续讲并发调度，包括哪些只读请求可以同时运行，以及怎样限制数量、处理失败。当前仍是一个完成后再执行下一个。

如果正则无效，过程会变成：

```text
工具 > 第 1 步：grep
  执行：query="["，glob="**/*"。
工具 < 第 1 步：grep 失败
  返回：执行失败。
  去向：错误已加入当前回合，下一次模型决策会收到。
模型 > 第 2 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 3 条。
```

`grepTool()` 在生成模型需要的匹配正文时，同时保存不含正文的 `{ path, line, column }` 元数据。教学渲染器根据 `grep` 的 Schema 显示 `query` 和 `glob`，再根据元数据显示位置，因此不需要从 `path:line:column:text` 字符串中反向解析字段。输出仍会移除控制字符、限制长度，并隐藏带有 secret、token、password、authorization 或 API key 特征的内容。

失败事件保留真实工具请求和错误事实，普通终端只显示经过筛选的安全说明。这条失败记录说明 `ToolError` 已成为模型可修正的环境反馈，而不是整个进程的崩溃。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/tools/grep.ts](src/tools/grep.ts) | 校验查询条件，生成模型正文与结构化位置元数据。 |
| 修改 | [src/tools/types.ts](src/tools/types.ts) | 在工具结果联合类型中加入 `grep` 元数据。 |
| 修改 | [src/tools/registry.ts](src/tools/registry.ts) | 注册并执行 `grep`。 |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 根据参数 Schema 和位置元数据显示搜索步骤。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 告诉模型三个只读工具的分工。 |

`AgentEvent` 和 Agent Loop 沿用 04.1 的控制结构。内容搜索作为新工具接入注册表，不需要给主循环增加 `grep` 专用分支。

## 动手构建

我们从 04.1 继续。新增一个搜索工具，再扩展工具列表、元数据和显示函数即可；主循环和事件类型都保持不变。下文路径相对于本节 `src/`。

### 1. 实现内容搜索

新增 `tools/grep.ts`，完整内容如下。搜索先复用 `findMatchingFiles()`，每行执行一次正则；结果数组达到 101 项时，只返回前 100 项并标记截断。

```ts
/**
 * 04.2 把文本目标变成代码位置 | [NEW] tools/grep.ts
 *
 * 学习目标：让模型用正则表达式搜索文件内容，并获得带文件名和行号的真实位置。
 * 输入：query 正则表达式和 glob 文件范围。
 * 输出：给模型的 path:line:column:text 文本，以及不含源码正文的位置元数据。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *   参数与正则有效？ ------ 否 ---> ToolError
 *            | 是
 *            v
 *   glob 找候选文件（最多 500 个）
 *            |
 *            v
 *   跳过 > 1 MiB / 二进制文件
 *            |
 *            v
 *   逐行匹配 --> path:line:column --> 前 100 项 + 截断说明
 *
 * 关键点：glob 缩小文件范围，grep 再检查内容。结果包含真实文件位置，模型才能继续调用 read_file。
 * 文件数、文件大小、匹配数和单行长度分别受限，避免一个宽泛查询占满内存和模型上下文。
 * 运行观察：搜索函数名时返回文件、行号和文本；无效正则作为工具错误反馈给模型。
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [NEW 04.2] 本文件以下 grep 契约、参数校验和内容搜索均为本节新增。
export const grepDefinition = {
  name: "grep",
  description: "用正则表达式搜索项目文件内容，返回文件路径、行号、列号和匹配行。",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "JavaScript 正则表达式，例如 export\\s+function\\s+createModel。",
      },
      glob: {
        type: "string" as const,
        description: "文件范围，例如 src/**/*.ts；搜索全部文件时传入 **/*。",
      },
    },
    required: ["query", "glob"],
    additionalProperties: false,
  },
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

type GrepArguments = { query: string; glob: string };
type GrepMatch = { path: string; line: number; column: number; text: string };

/**
 * 在扫描文件前确认搜索条件可用。
 *
 * 输入是模型的 JSON 参数；只接受非空且不超过 500 字符的 query，以及通过检查的 glob。
 * 正则会先编译一次，语法错误可立即作为 ToolError 返回，不必等到读取文件后才发现。
 * 成功返回查询和路径模式。编译成功只说明语法合法，不保证正则执行一定很快。
 */
function parseArguments(argumentsJson: string): GrepArguments {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("grep 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("grep 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["query", "glob"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ToolError("grep 参数只能包含 query 和 glob。");
  }
  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new ToolError("grep query 必须是非空字符串。");
  }
  if (input.query.length > 500) throw new ToolError("grep query 不能超过 500 个字符。");
  const filePattern = validateGlobPattern(input.glob);
  try {
    new RegExp(input.query, "u");
  } catch {
    throw new ToolError(`grep query 不是有效的正则表达式：${input.query}`);
  }
  return { query: input.query, glob: filePattern };
}

/**
 * 只保留匹配行的开头，避免超长正文占满模型上下文。
 *
 * 输入是一整行，超过 300 个原字符时保留前 300 个，再追加省略号。
 * 这不是围绕匹配处截取；匹配发生在第 300 个字符之后时，返回的正文可能不含目标词，
 * 但 grepTool() 仍会单独返回它的行号和列号。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;
}

/**
 * 在候选文件中逐行查找，把位置和匹配行一起返回给模型。
 *
 * 输入是模型参数、项目根和可选取消信号；先用 glob 选出最多 500 个候选文件。
 * 跳过检查时超过 1 MiB、含 NUL 或无法读取的文件；每行只保留第一处匹配。
 * 观察到第 101 个匹配后，返回前 100 个并标记截断。content 含匹配行，metadata 只含位置与数量。
 * 参数或正则无效会抛出 ToolError；读取单个文件失败会跳过，取消则继续向外传播。
 * 空结果只说明实际检查的文本没有命中。同步正则没有时间上限，执行期间无法响应取消；第 07 章再迁移到受控 rg。
 */
export async function grepTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const expression = new RegExp(input.query, "u");
  const candidates = await findMatchingFiles(input.glob, projectRoot, MAX_FILES, signal);
  const matches: GrepMatch[] = [];

  for (const path of candidates.paths) {
    signal?.throwIfAborted();
    let content: string;
    try {
      const filePath = join(projectRoot, path);
      if ((await stat(filePath)).size > MAX_FILE_BYTES) continue;
      content = await readFile(filePath, { encoding: "utf8", signal });
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    if (content.includes("\0")) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      signal?.throwIfAborted();
      const line = lines[index] ?? "";
      const match = expression.exec(line);
      if (!match) continue;
      matches.push({
        path,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        text: shortenLine(line),
      });
      if (matches.length > MAX_MATCHES) {
        const selected = matches.slice(0, MAX_MATCHES);
        return {
          content: `${selected.map(({ path, line, column, text }) => `${path}:${line}:${column}: ${text}`).join("\n")}\n[结果已截断，只显示前 ${MAX_MATCHES} 项]`,
          metadata: {
            kind: "grep",
            count: selected.length,
            truncated: true,
            locations: selected.map(({ path, line, column }) => ({ path, line, column })),
          },
        };
      }
    }
  }

  if (matches.length === 0) {
    const scope = candidates.truncated ? `前 ${MAX_FILES} 个候选文件` : "候选文件";
    return {
      content: `${scope}中没有匹配：${input.query}`,
      metadata: { kind: "grep", count: 0, truncated: candidates.truncated, locations: [] },
    };
  }
  const suffix = candidates.truncated ? `\n[文件范围已截断，只扫描前 ${MAX_FILES} 个候选文件]` : "";
  return {
    content: `${matches.map(({ path, line, column, text }) => `${path}:${line}:${column}: ${text}`).join("\n")}${suffix}`,
    metadata: {
      kind: "grep",
      count: matches.length,
      truncated: candidates.truncated,
      locations: matches.map(({ path, line, column }) => ({ path, line, column })),
    },
  };
}
```

### 2. 给界面提供独立的位置数据

用下面的完整文件替换 `tools/types.ts`。新增的 `grep` 分支只保存路径、行号和列号，匹配正文仍在 `content` 中：

```ts
/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节给 grep 增加位置元数据，包含路径、行号和列号，不保存匹配正文。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
 */

export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: number }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] }
  // [CHANGED 04.2] grep 为界面提供位置元数据，匹配正文仍只进入 content。
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

### 3. 把新工具加入注册表

在 `tools/registry.ts` 的导入区加入：

```ts
import { grepDefinition, grepTool } from "./grep.js";
```

替换 `toolDefinitions`：

```ts
export const toolDefinitions = [readFileDefinition, globDefinition, grepDefinition];
```

再用下面的完整函数替换 `executeTool()`：

```ts
/**
 * 把已登记的工具名称对应到本地实现并把同一个取消信号交给工具。
 *
 * 输入是通过模型适配层检查的 ToolCall；这里只在明确的名称分支里调用工具。
 * 成功返回工具的content 和 metadata，未知名称抛出 ToolError；具体参数仍由对应工具校验。
 * 调用 ID 留给 Agent Loop 配对结果，注册表不修改历史，也不负责终端显示。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  // [NEW 04.2] 新增内容搜索分支，继续传递同一个取消信号。
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
```

主循环依旧会把它的 `content` 按原 ID 发回模型，把元数据交给观察者。

### 4. 显示搜索结果的位置

在 `ui/teaching-trace.ts` 中，用下面的完整函数替换 `describeToolResult()`。新增 `grep` 分支读取位置元数据，其他事件格式和终端接线不变：

```ts
/**
 * 根据工具自己提供的元数据，生成结果摘要。
 *
 * glob 显示路径数，grep 显示匹配数和位置，read_file 显示行数。
 * 路径示例还会经过显示筛选。这里不读取 content，所以无需从源码正文反推数量和位置。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }
  // [CHANGED 04.2] grep 只显示数量和位置示例，不回显匹配正文。
  if (metadata.kind === "grep") {
    const examples = metadata.locations.slice(0, 2)
      .map(({ path, line, column }) => `${toTraceText(path)}:${line}:${column}`)
      .join("，");
    return `${metadata.count} 个匹配位置${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  return `${metadata.lineCount} 行文件内容`;
}
```

### 5. 说明三种工具分别做什么

在 `config/load-config.ts` 中替换 `systemPrompt`：

```ts
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。你可以调用 glob 查找文件、grep 搜索代码位置，再调用 read_file 读取不超过 64 KiB 的普通文件；.env 系列环境配置文件不可读取。你不能修改文件或执行命令，也不要声称已经完成这些操作。需要项目信息时必须调用工具，不要猜测。";
```

### 构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:04.2
```

```bash
hello-my-agent --prompt "请找到 createModel 的定义，只告诉我文件和行号。"
```

终端可能直接出现一次 `grep`，也可能先出现 `glob`。观察搜索返回的路径和行号怎样进入下一次模型请求，而不是要求模型每次使用完全相同的顺序。

## 运行验证

```bash
npm run check:04
```

确定性检查会验证：

- `targetFunction` 返回 `src/core.ts:2`。
- 忽略路径不参与内容搜索。
- 无效正则在扫描文件前失败。
- 101 个匹配只返回前 100 个，恰好 100 个时不误报截断。
- 取消信号沿 Agent Loop、注册表和搜索工具传播。

### 失败实验

请求无效正则：

```text
grep({ "query": "[", "glob": "**/*" })
```

本地程序应在读取候选文件前返回 `ToolError`。终端随后显示“错误已加入当前回合”，模型可以修正 query 再试。

### 小练习

为什么 `grep` 返回 `path:line:column:text`，而不是只返回文件名？

答案：文件名只能缩小到文件级。下一节给 `read_file` 加入行范围后，搜索行号就能成为它的 `offset`；匹配文本帮助模型判断它命中的是定义、调用、注释还是字符串。列号用于更精确地引用位置，但当前 UTF-16 计算仍不是编辑器显示宽度。

## 本节完成后的 Agent

此时，Agent 已经可以根据当前证据动态选择三种只读工具：

```text
用户目标 -> Agent Loop -> 模型决定下一步
                          |-- glob(pattern) --------> 候选路径
                          |-- grep(query, glob) ----> 候选匹配位置
                          |     内部重新选择文件      path:line:column:text
                          |-- read_file(path) ------> 整个文件
                          +-- 最终回答 -------------> 结束

每次工具结果 -------------------------> 返回模型继续决策
```

模型可以先调用 `glob` 了解目录，也可以直接调用带 `glob` 参数的 `grep`；程序没有规定固定顺序。Agent 现在能获得一个或多个候选匹配位置，但单独的匹配行通常没有完整函数体和上下文，读取整个大文件又会浪费模型上下文。下一节将把 `read_file` 改为按行分段读取，让模型围绕候选位置取得有限、可续读的源码窗口。
