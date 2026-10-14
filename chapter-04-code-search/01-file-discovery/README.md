# 04.1 控制文件搜索范围

[第四章首页](../README.md) · [本节源码](src/) · [下一节：把文本目标变成代码位置](../02-content-search/README.md)

第三章的 `read_file(path)` 已经能读取文件，但前提是模型先说出准确路径。接下来，我们让 Agent 在不知道路径时，也能先看看项目里有哪些相关文件。

## 问题：不知道文件名时，不能一直猜路径

用户要求：

```text
找到负责读取模型配置的文件。
```

模型可能想到 `src/config.ts`，也可能想到 `src/config/load-config.ts`。这些名称都合理，却不代表项目里真的存在。继续调用 `read_file` 逐个试，只会把一次查找变成反复猜测。

模型需要的是一份来自文件系统的候选列表。例如，先找名称里带 `config` 的 TypeScript 文件，再挑选可能相关的文件读取。这样，路径由本地工具从磁盘取得，模型负责根据任务判断哪些值得继续看。

这就是本节要加入的 `glob`：按路径模式找文件。它会在项目里查找，跳过依赖、构建产物和受保护文件，并限制返回的路径数量，避免一次把整个仓库的列表塞进模型上下文。

## 解决方案：先列出真实路径，再决定读哪个文件

模型用 `pattern` 表达要找的路径形状，例如 `**/*config*.ts`。本地 `glob` 工具把这个模式交给 Node.js 的文件匹配功能，收集符合条件的普通文件，再把相对路径列表发回模型。

```text
模型生成 { pattern }
        |
        v
解析 JSON，校验对象形状和 pattern
        |
        v
以项目根目录为 cwd 执行 Node.js glob
        |
        v
在遍历阶段应用 .gitignore 和内置规则
        |
        v
只保留普通文件，观察到第 201 项后停止
        |
        v
返回前 200 条相对路径和截断状态
        |
        v
Agent Loop 把路径列表交回模型
        |
        v
模型选择具体文件继续读取，或给出最终回答
```

`glob` 只返回路径，不读取文件内容。参数或路径规则无效时，工具抛出 `ToolError`，Agent Loop 再用原调用 ID 发回失败说明，模型可以修改范围后重试。模型拿到候选路径后，可以选择一个路径调用 `read_file`；下一节会增加内容搜索，避免逐个读取候选文件。

## 工作原理

沿着这个配置文件查找任务，看各个角色怎样配合：

```text
1. 用户提出目标，模型不知道准确文件路径
2. 模型请求 glob，并给出路径匹配规则
3. 本地工具限制项目根、忽略目录和返回数量，再遍历真实文件系统
4. 工具返回候选路径或抛出 ToolError，由 Agent Loop 配上原调用 ID
5. Agent Loop 把路径列表或错误结果加入本轮消息，再次请求模型
6. 模型选择一个候选文件继续读取，或根据现有证据给出最终回答
```

这里得到的是候选路径。即使文件名叫 `load-config.ts`，也还不能只凭名字断定它具体读取什么；模型可以接着调用 `read_file`，确认正文后再回答。路径匹配和内容理解分成这两步，各自做自己擅长的事。

### 1. 路径模式怎样表达“我想找这些文件”

glob 模式是一段带通配符的路径。`*` 可以匹配当前层级里的部分名称，`**` 可以覆盖多层目录。模型不需要先知道每个文件名，只要描述它想找的范围。

模型返回参数时，这个模式仍放在 JSON 字符串里：

```text
'{"pattern":"src/**/*.ts"}'
              |
              v JSON.parse
{ pattern: "src/**/*.ts" }
              |
              v 字段和值校验
"src/**/*.ts"
```

`parsePattern()` 依次检查：JSON 能否解析、结果是不是对象、对象是否只含 `pattern`、值是否为非空字符串。`validateGlobPattern()` 再拒绝绝对路径、`..` 和超过 500 个字符的模式。

```ts
if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
  throw new ToolError(
    "glob pattern 必须位于当前项目根目录内，不能使用绝对路径或 ..。",
  );
}
```

模式最终会影响程序遍历哪里，所以本地要重新检查。工具 Schema 负责告诉模型怎么填，TypeScript 负责检查我们写的代码，二者都不能替代对本次参数的判断。

常用 pattern 的含义如下：

| pattern | 选择范围 |
| --- | --- |
| `src/*.ts` | `src` 直属目录中的 `.ts` 文件 |
| `src/**/*.ts` | `src` 及其子目录中的 `.ts` 文件 |
| `**/package.json` | 任意层级名为 `package.json` 的文件 |
| `chapter-0?/README.md` | `chapter-01` 到 `chapter-09` 这类单字符编号目录 |

pattern 只描述路径集合。它不会搜索文件内容，也不会像 Shell 那样执行命令替换。

### 2. 所有工具要从同一个目录理解路径

如果从 `chapter-04-code-search/01-file-discovery` 启动 CLI，`process.cwd()` 指向小节目录。但模型请求 `package.json` 时，期望的是仓库根目录的文件。

`findProjectRoot()` 从启动目录向上寻找最近的 `package.json`：

```text
当前目录
  -> 有 package.json？是：项目根
  -> 否：进入父目录继续
  -> 到达文件系统根仍没找到：使用原启动目录
```

本节的 `glob` 和 `read_file` 共用这个根目录，下一节的 `grep` 也会继续使用它。比如工具返回 `chapter-04-code-search/01-file-discovery/src/config/load-config.ts`，模型就可以把这条路径原样交给 `read_file`，不必再补前缀或猜当前目录。

项目根是逻辑工作区边界，不是操作系统沙箱。具体文件是否允许读取，仍由 `read_file` 的真实路径和敏感文件检查决定。

### 3. 为什么有些目录连进去看都没有必要

寻找项目代码时，依赖和构建产物通常会带来大量重复或无关路径，`.env` 系列文件还可能保存密钥。我们让搜索工具先跳过这些内容。除程序内置的规则外，项目也可以通过根目录 `.gitignore` 指定要忽略的路径：

```text
内置规则：.git/、node_modules/、dist/、.env、.env.*、.envrc
项目规则：仓库根目录的 .gitignore
```

项目 `.gitignore` 支持 `!` 否定规则，例如先忽略 `*.log`，再用 `!keep.log` 恢复一个文件。为了防止项目规则重新暴露 `.env` 或 `node_modules`，代码在加入项目规则后再次加入内置规则：

```ts
return matcher
  .add(await readFile(ignorePath, "utf8"))
  .add(BUILT_IN_IGNORES);
```

`exclude` 在目录遍历阶段执行。忽略 `node_modules/` 时，程序不会先走完目录再丢弃结果，而是在准备进入目录时就剪枝。这样做减少了后续目录访问，和“最后少返回几条路径”解决的是不同问题。

当前实现只读取项目根目录的一份 `.gitignore`，不处理嵌套 `.gitignore` 和全局 Git ignore。

### 4. 为什么要多找到一条，再提示结果被截断

工具最多返回 200 条路径，但代码会先观察第 201 条：

```ts
paths.push(path);
if (paths.length > maxResults) break;

paths.sort();
return {
  paths: paths.slice(0, maxResults),
  truncated: paths.length > maxResults,
};
```

看到第 201 条，才能证明结果确实超过上限。程序随后把这批 201 条一起排序，再取前 200 条，所以最后找到的那一条也可能进入返回列表。恰好发现 200 条时，还不能断定有更多结果，不能显示“已截断”。

这里排序的是遍历器最先交出的至多 201 条路径，并不是先扫描整个项目再取字典序最前的 200 条。这个选择让工具可以尽早停止；代价是截断结果不代表全项目的全局排序前 200 项。

200 限制的是返回路径的条数，并没有限制每条路径的字符数，也不能保证目录遍历在固定时间内完成。本节在每次遍历交出一项时检查取消信号；还没交出下一项时，不会因为结果数上限而自动超时。第 07 章引入受控子进程时，会进一步处理执行时间和停止操作。

### 5. 模型收到完整路径，终端只显示过程摘要

注册表只执行已经登记的名称：

```ts
if (call.name === globDefinition.name) {
  return globTool(call.arguments, undefined, signal);
}
```

`globTool()` 返回 `{ content, metadata }`。Agent Loop 只把 `content` 和原 `toolCallId` 放进当前 `turn`；`metadata` 随 `AgentEvent` 交给观察者。下一次 `model.generate()` 会同时看到：用户目标、模型自己的 glob 请求以及本地返回的路径列表，但不会收到仅供界面使用的元数据。

本节也让终端显示这些步骤。下面用示意数量和回答说明输出顺序；实际路径数量以当前项目为准：

```text
模型 > 第 1 次决策
  收到：新增用户问题「找到所有 load-config.ts」；Agent Loop 消息链共 1 条。
模型 < 第 1 次决策
  返回：1 个工具请求。
工具 > 第 1 步：glob
  执行：pattern="**/load-config.ts"。
工具 < 第 1 步：glob 完成
  返回：12 个路径；示例：chapter-02-model-dialogue/01-configuration/src/config/load-config.ts，chapter-02-model-dialogue/02-first-reply/src/config/load-config.ts。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 2 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 3 条。
模型 < 第 2 次决策
  返回：最终回答，交给终端显示。
Agent > 配置读取位于 src/config/load-config.ts。
```

- `模型 >` 与 `模型 <` 分别出现在 `model.generate()` 前后。
- `工具 >` 由 `teaching-trace.ts` 根据工具 Schema 显示允许字段。
- `工具 <` 根据 `glob` 直接产生的结构化元数据显示路径数量和最多两个示例；完整路径列表仍通过 `content` 发给模型。
- 第二次 `模型 >` 明确说明模型已经收到上一条工具结果。

工具步骤号由 Agent Loop 生成，工具名和参数随事件传给显示函数。终端只显示本地 Schema 允许的字段，并处理控制字符、敏感词特征和过长文本。模型收到的完整结果仍走工具消息，不从终端摘要里取数据。

我们把接收事件的函数叫作观察者。它收到的是事件副本，修改副本或抛出异常都不能改变工具结果；不传观察者时，程序照样能完成同样的请求和回传。第 09 章会扩展事件输出，第 10 章再让 TUI 接收这些事件。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/tools/workspace.ts](src/tools/workspace.ts) | 统一项目根与忽略规则。 |
| 新增 | [src/tools/glob.ts](src/tools/glob.ts) | 校验 `pattern`，返回模型文本与结构化路径元数据。 |
| 新增 | [src/tools/types.ts](src/tools/types.ts) | 定义给模型的正文和给终端的摘要数据。 |
| 新增 | [src/agent/events.ts](src/agent/events.ts) | 定义当前终端使用的步骤事件，供第 09、10 章继续扩展。 |
| 新增 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 把结构化事件转换成安全的教学记录。 |
| 修改 | [src/tools/read-file.ts](src/tools/read-file.ts) | 复用项目根，并返回结构化读取元数据。 |
| 修改 | [src/tools/registry.ts](src/tools/registry.ts) | 注册并执行 `glob`，统一返回工具结果。 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 在真实状态转换处发送事件。 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 消费教学事件并输出带颜色的过程记录。 |
| 修改 | [src/cli.ts](src/cli.ts) | 为单次提问装配同一个观察者。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 告诉模型当前真实工具能力。 |

## 动手构建

我们从第三章的完整工具循环继续。先做文件发现，再让工具同时返回正文和摘要数据，最后把执行步骤接到终端。下文路径都相对于本节 `src/`；新文件给出完整内容，只修改旧文件中本节需要的部分。

### 1. 让文件工具共用项目根和忽略规则

新增 `tools/workspace.ts`，完整内容如下。`findProjectRoot()` 是上一章读取工具里的同一个查找方法，现在搬到这里，供多个文件工具共同使用。项目忽略语法交给已安装的 `ignore` 包处理：

```ts
/**
 * 04.1 控制文件搜索范围 | [NEW] tools/workspace.ts
 *
 * 学习目标：让所有文件工具使用同一个项目根目录和同一组忽略规则。
 * 输入：启动目录，以及项目根目录中的 .gitignore。
 * 输出：项目根目录和一个可以判断相对路径是否应被忽略的匹配器。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +---------------+      向上查找 package.json      +--------------+
 *   | process.cwd() | ------------------------------> | project root |
 *   +---------------+                                 +------+-------+
 *                                                             v
 *                                             内置规则 + 根目录 .gitignore
 *                                                             |
 *                                                             v
 *                                                     Ignore matcher
 *
 * 关键点：Git 的忽略语法包含目录、通配符、否定规则等细节，本书使用成熟的 ignore 包解析，
 * 不自行实现一个容易出错的简化版本。内置规则始终保护 .env，并跳过 .git、node_modules 和 dist。
 * 运行观察：从章节子目录启动时仍以最近的 package.json 为边界；被忽略的路径不会进入搜索结果。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ignore, { type Ignore } from "ignore";
import { ToolError } from "../errors.js";

// [NEW 04.1] 本文件以下项目根查找与忽略规则实现均为本节新增。
const BUILT_IN_IGNORES = [
  ".git/",
  "node_modules/",
  "dist/",
  ".env",
  ".env.*",
  ".envrc",
];

/**
 * 找到最近的 package.json，让文件工具共用同一个相对路径起点。
 *
 * 从 start 开始逐级向上查找；默认起点是 process.cwd()。
 * 找到时返回该目录，找不到时返回规范化后的原起点。
 * 这里只确定项目根，不检查某个文件是否允许读取，也不提供文件系统隔离。
 */
export function findProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(start);
    directory = parent;
  }
}

/**
 * 让搜索同时遵守项目忽略规则和程序内置保护。
 *
 * 读取项目根目录的一份 .gitignore，返回可用 ignores() 判断相对路径的匹配器。
 * 项目规则中的 ! 可以重新包含普通文件，因此最后再加入内置规则，防止恢复 .env 或依赖目录。
 * 没有 .gitignore 时只用内置规则；存在但读取或解析失败时抛出 ToolError，不悄悄扩大搜索范围。
 * 本章还不读取子目录的 .gitignore 或全局 Git 忽略规则。
 */
export async function createIgnoreMatcher(projectRoot: string): Promise<Ignore> {
  const matcher = ignore().add(BUILT_IN_IGNORES);
  const ignorePath = join(projectRoot, ".gitignore");
  if (!existsSync(ignorePath)) return matcher;
  try {
    // 项目规则可以使用 ! 重新包含路径；最后再加入内置规则，确保凭据与依赖目录不可被覆盖。
    return matcher.add(await readFile(ignorePath, "utf8")).add(BUILT_IN_IGNORES);
  } catch {
    throw new ToolError("无法读取或解析项目根目录的 .gitignore。");
  }
}
```

### 2. 分开模型正文和界面摘要数据

新增 `tools/types.ts`，完整内容如下。`content` 仍是原来的工具正文，`metadata` 让终端知道找到多少路径、读了多少行：

```ts
/**
 * 04.1 控制文件搜索范围 | [NEW] tools/types.ts
 *
 * 学习目标：让模型得到完整工具结果，让终端直接知道结果规模。
 * 输入：具体工具已经取得的路径或正文。
 * 输出：content 给模型，metadata 给终端；本文件只声明类型，不改变运行状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   工具结果 -> content / metadata -> 模型消息 / 观察事件
 *
 * 本节引入正文与元数据两个字段，glob 返回路径，read_file 返回行数。
 * 运行观察：模型能据正文继续回答，终端无需解析正文就能显示数量或范围。
 */

// [NEW 04.1] 本文件以下工具结果与观察元数据契约均为本节新增。
export type ToolResultMetadata =
  | { kind: "read_file"; lineCount: number }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] };

export type ToolExecutionResult = {
  content: string;
  metadata: ToolResultMetadata;
};
```

### 3. 完成文件发现工具

新增 `tools/glob.ts`，完整内容如下。先看 `findMatchingFiles()`：忽略规则传给遍历器的 `exclude`，目录可以在进入之前被跳过；收到额外一项之后才标记截断。`globTool()` 再把相同结果分别整理为正文和元数据。

```ts
/**
 * 04.1 控制文件搜索范围 | [NEW] tools/glob.ts
 *
 * 学习目标：让模型用 glob 模式查找项目中的真实文件，而不是猜测文件名。
 * 输入：包含 pattern 的 JSON 参数，例如匹配 src 下所有 TypeScript 文件的模式。
 * 输出：给模型的最多 200 条路径组成的文本，以及供界面使用的路径数量、截断状态和路径元数据。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +------------------+
 *   | arguments string |
 *   +--------+---------+
 *            v
 *       参数有效？ -------- 否 ---> ToolError
 *            | 是
 *            v
 *   node:fs glob 匹配路径
 *            |
 *            v
 *   .gitignore / 内置规则过滤
 *            |
 *            v
 *   仅保留普通文件 --> 排序 --> 前 200 项 + 截断说明
 *
 * 关键点：glob 负责按路径找文件，不读取文件内容。模型输出仍是不可信输入，
 * 所以本地会拒绝绝对模式和包含 .. 的模式。忽略规则减少目录访问，数量上限减少返回路径；二者都不是执行超时。
 * 运行观察：匹配所有 TypeScript 文件时能找到源码，但不会返回 node_modules、dist、.env 或 .gitignore 忽略的文件。
 */

import { glob } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { createIgnoreMatcher, findProjectRoot } from "./workspace.js";

// [NEW 04.1] 本文件以下 glob 契约、参数校验和遍历实现均为本节新增。
export const globDefinition = {
  name: "glob",
  description: "按 glob 模式查找当前项目中的文件。返回相对路径并遵守忽略规则，例如 src/**/*.ts。",
  inputSchema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string" as const,
        description: "相对于项目根目录的 glob 模式，例如 src/**/*.ts 或 **/package.json。",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

const MAX_RESULTS = 200;

type GlobResult = { paths: string[]; truncated: boolean };

/**
 * 检查模型给出的路径模式能否用于本项目的搜索。
 *
 * 只接受非空字符串，去掉首尾空格后返回；超过 500 字符、绝对路径或包含 .. 路径段时抛出 ToolError。
 * 这里只检查模式文本，不访问磁盘，也不检查完整工具参数对象。
 */
export function validateGlobPattern(value: unknown): string {
  if (typeof value !== "string") throw new ToolError("glob pattern 必须是字符串。");
  const pattern = value.trim();
  if (!pattern) throw new ToolError("glob pattern 不能为空。");
  if (pattern.length > 500) throw new ToolError("glob pattern 不能超过 500 个字符。");
  if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
    throw new ToolError("glob pattern 必须位于当前项目根目录内，不能使用绝对路径或 ..。");
  }
  return pattern;
}

/**
 * 从工具请求中取出唯一的 pattern，再检查它的值。
 *
 * 输入是模型生成的 JSON 字符串；无效 JSON、非对象或多余字段都会抛出 ToolError。
 * 返回值已经通过 validateGlobPattern()，接下来才用于真实文件匹配。
 */
function parsePattern(argumentsJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ToolError("glob 参数不是有效的 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("glob 参数必须是包含 pattern 的对象。");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "pattern") {
    throw new ToolError("glob 参数只能包含 pattern。");
  }
  return validateGlobPattern(entries[0][1]);
}

/**
 * 找出一批符合模式的普通文件，供 glob 返回或 grep 继续读取。
 *
 * 输入是已校验的模式、项目根、返回数量上限和可选取消信号。
 * 遍历时就跳过忽略目录；收集到 maxResults + 1 项便停止，这时才知道确实需要截断。
 * 随后只对这批已收集路径排序，再返回前 maxResults 项，不是全项目排序后的前若干项。
 * 没有匹配时返回空数组；遍历失败抛出 ToolError，取消则向外抛出取消异常。
 * 数量上限不限制遍历耗时，程序只能在遍历交出下一项时检查取消。
 */
export async function findMatchingFiles(
  pattern: string,
  projectRoot = findProjectRoot(),
  maxResults = MAX_RESULTS,
  signal?: AbortSignal,
): Promise<GlobResult> {
  signal?.throwIfAborted();
  const matcher = await createIgnoreMatcher(projectRoot);
  const paths: string[] = [];
  try {
    for await (const entry of glob(pattern, {
      cwd: projectRoot,
      withFileTypes: true,
      // 目录在遍历阶段就排除，避免先进入 node_modules、dist 等目录再逐项过滤。
      exclude: (entry) => {
        const path = relative(projectRoot, join(entry.parentPath, entry.name)).split(sep).join("/");
        return matcher.ignores(entry.isDirectory() ? `${path}/` : path);
      },
    })) {
      signal?.throwIfAborted();
      if (!entry.isFile()) continue;
      const path = relative(projectRoot, join(entry.parentPath, entry.name)).split(sep).join("/");
      if (matcher.ignores(path)) continue;
      paths.push(path);
      if (paths.length > maxResults) break;
    }
  } catch {
    signal?.throwIfAborted();
    throw new ToolError(`无法完成 glob 匹配：${pattern}`);
  }
  paths.sort();
  return { paths: paths.slice(0, maxResults), truncated: paths.length > maxResults };
}

/**
 * 把路径匹配结果整理成模型结果和终端所需的数量信息。
 *
 * 输入是模型参数、项目根和可选取消信号。参数通过检查后，最多返回 200 条路径。
 * content 保存完整的本次路径列表与截断说明，metadata 保存数量、路径和截断状态供终端使用。
 * 没有匹配时返回明确说明；参数或遍历失败抛出 ToolError，取消继续向外传播。
 * 这里只找路径，不读取匹配文件的正文。
 */
export async function globTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const pattern = parsePattern(argumentsJson);
  const result = await findMatchingFiles(pattern, projectRoot, MAX_RESULTS, signal);
  if (result.paths.length === 0) {
    return {
      content: `没有文件匹配：${pattern}`,
      metadata: { kind: "glob", count: 0, truncated: result.truncated, paths: [] },
    };
  }
  const suffix = result.truncated ? `\n[结果已截断，只显示前 ${MAX_RESULTS} 项]` : "";
  return {
    content: `${result.paths.join("\n")}${suffix}`,
    metadata: {
      kind: "glob", count: result.paths.length, truncated: result.truncated, paths: result.paths,
    },
  };
}
```

### 4. 让原有读取工具使用相同的返回形式

用下面的完整文件替换 `tools/read-file.ts`。项目根查找改为从 `workspace.ts` 导入，读取成功后改为返回 `content` 与实际行数。`signal` 也继续传入 `readFile()`，让正在读取的操作可以收到取消请求。

```ts
/**
 * 04.1 控制文件搜索范围 | [CHANGED] tools/read-file.ts
 *
 * 学习目标：继续在项目边界内安全读取一个小型普通文件。
 * 输入：包含相对 path 的 JSON 参数，以及统一确定的项目根目录。
 * 输出：按 UTF-8 解码的正文和实际行数；先拒绝检查时超过 64 KiB 的文件，参数无效时抛出 ToolError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   arguments --> 校验 path --> realpath 边界 --> .env / 类型 / 大小检查 --> 文件内容
 *                    |              |                    |
 *                    +-- 失败 ------+--------------------+--> ToolError
 *
 * 关键点：04.1 把项目根目录查找移到 workspace.ts，使 read_file、glob 和后续 grep 使用同一边界。
 * realpath 会拒绝检查时已经指向项目外的符号链接；它不能阻止检查后的并发替换。
 * 本小节尚未改变一次读取完整小文件的方式。
 * 运行观察：原有 read_file 行为保持不变，glob 找到的相对路径可以直接交给它读取。
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [KEEP 来自 03.1] 本节仍接收 path，读取行范围到 04.3 再加入。
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

const MAX_FILE_BYTES = 64 * 1024;

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
 * 先确认读取请求只包含一个可用的相对路径。
 *
 * 参数来自模型，先解析 JSON，再检查对象是否只有非空字符串 path，并去掉首尾空格。
 * JSON、字段或相对路径要求不满足时抛出 ToolError；通过后返回路径字符串。
 * 这里只检查参数，文件是否存在、真实位置在哪里，要在读取前继续确认。
 */
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
 * 检查模型要读的文件，再把完整正文返回给主循环。
 *
 * 输入是模型的 JSON 参数和项目根。先检查相对路径与 .env 名称，再解析符号链接，
 * 确认检查时的真实目标位于项目内、是普通文件且不超过 64 KiB，最后才读取正文。
 * content 保存 UTF-8 正文，metadata 保存实际行数，给模型和终端分别使用。
 * 参数和预期文件检查失败时抛出 ToolError；取消信号会传给 readFile()；后续 stat() 或读取异常交给外层处理。
 * 检查与打开是两个操作，不能阻止其他进程在中间替换或增大文件；这里不是文件系统沙箱。
 * 内容按 UTF-8 解码，但没有验证具体编码或二进制格式。
 */
// [CHANGED 04.1] 使用共享项目根，向读取传递取消，并返回正文和行数。
export async function readFileTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
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
  const content = await readFile(filePath, { encoding: "utf8", signal });
  const lines = content === "" ? [] : content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return { content, metadata: { kind: "read_file", lineCount: lines.length } };
}
```

然后用下面的完整文件替换 `tools/registry.ts`。注册表加入 `glob`，把取消信号传给对应工具，并统一返回 `ToolExecutionResult`：

```ts
/**
 * 04.1 控制文件搜索范围 | [CHANGED] tools/registry.ts
 *
 * 学习目标：让主循环通过同一个入口找到本地工具。
 * 输入：ToolCall 中的名称与 JSON 参数，以及本轮取消信号。
 * 输出：工具产生的 content 与 metadata；未知名称抛出 ToolError，不修改历史。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   ToolCall -> 已取消？ -- 是 --> 抛出取消异常
 *                   | 否
 *                   v
 *               名称已登记？ -- 否 --> ToolError
 *                   | 是
 *                   v
 *               read_file / glob -> 对应工具结果
 *
 * 本节增加 glob，并把取消信号和新的工具结果传回主循环。
 * 登记只说明程序提供什么工具；第 05 章再独立判断某次请求是否允许执行。
 * 运行观察：新增工具仍按原调用 ID 回传，未登记名称不会变成任意函数调用。
 */

import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
import type { ToolExecutionResult } from "./types.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [CHANGED 04.1] 允许列表加入 glob；工具统一返回 ToolExecutionResult。
export const toolDefinitions = [readFileDefinition, globDefinition];

/**
 * 把已登记的工具名称对应到本地实现并把同一个取消信号交给工具。
 *
 * 输入是通过模型适配层检查的 ToolCall；这里只在明确的名称分支里调用工具。
 * 成功返回工具的content 和 metadata，未知名称抛出 ToolError；具体参数仍由对应工具校验。
 * 调用 ID 留给 Agent Loop 配对结果，注册表不修改历史，也不负责终端显示。
 */
// [CHANGED 04.1] 将取消传给已登记工具，返回正文与元数据。
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  throw new ToolError(`未知工具：${call.name}`);
}
```

### 5. 在真实步骤发生时报告事件

新增 `agent/events.ts`，完整内容如下。它定义事件字段，并通过副本隔开观察者与正在执行的请求：

```ts
/**
 * 04.1 控制文件搜索范围 | [NEW] agent/events.ts
 *
 * 学习目标：让界面知道主循环进行到哪一步，而不参与执行决定。
 * 输入：主循环产生的模型开始、模型返回、工具开始和工具返回事件。
 * 输出：把事件副本交给可选观察者；观察者出错也不修改主循环的数据。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   event -> 有观察者？ -- 否 --> 返回
 *                  | 是
 *                  v
 *              复制事件 -> 同步调用观察者
 *                               | 成功 --> 返回
 *                               | 抛错 --> 接住异常后返回
 *
 * 事件记录数量、请求和结果，不决定终端文案。当前消费者是教学终端；
 * 第 09 章继续扩展 JSONL 和送达方式，第 10 章再接入 TUI。
 * 运行观察：关闭观察者仍可得到同样的工具结果，显示失败不会中止一次成功读取。
 */

import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";

// [NEW 04.1] 本文件以下事件契约与安全发送函数均为本节新增。
export type AgentEvent =
  | {
      type: "model_start";
      call: number;
      contextMessages: number;
      trigger: { kind: "user"; content: string } | { kind: "tool_results"; count: number };
    }
  | {
      type: "model_finish";
      call: number;
      outcome: "tools" | "final" | "empty";
      toolRequests: number;
      text: string;
    }
  | { type: "tool_start"; sequence: number; call: ToolCall }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      result: ToolExecutionResult;
    }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    };

export type AgentObserver = (event: AgentEvent) => void;

/**
 * 把当前步骤交给观察者显示，同时保护主循环正在使用的数据。
 *
 * 有 observer 时，同步发送 structuredClone() 得到的副本；没有时直接返回。
 * 观察者即使修改副本，也不会改到真实工具参数；观察者抛出异常时，这里会接住它。
 * 因此显示失败不会变成工具执行失败。此处不等待异步回调，异步送达留到第 09 章。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 观察通道是旁路，不能改变模型、工具和历史的执行结果。
  }
}
```

再用下面的完整文件替换 `agent/agent-loop.ts`。模型开始和返回处各报告一次事件；工具开始和返回处也各报告一次。工具返回后，先把 `result.content` 加入 `turn`，再报告完成，所以终端才能准确显示“结果已加入当前回合”。

```ts
/**
 * 04.1 控制文件搜索范围 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：沿用最多请求模型 8 次的 Agent Loop，把取消信号传给文件工具，并报告内部执行步骤。
 * 输入：终端文本、history、支持工具消息的 Model、AbortSignal 和可选 AgentObserver。
 * 输出：执行时发送结构化生命周期事件；最终回答成功时提交整轮消息。
 *
 * 全局主流程（本节版本）：
 *
 * +----------+      +----------------+      +----------------+
 * | Terminal | ---> | agentLoop      | ---> | model.generate |
 * +----^-----+      | turn + history |      +-------+--------+
 *      |            +-------+--------+              |
 *      |                    ^                 返回哪种结果？
 *      |                    |           +-----------+-----------+
 *      |          AgentEvent <-+        | final text            | tool call(s)
 *      |                    |           v                       v
 *      |                    |    提交完整 turn        executeTool(call, signal)
 *      |                    |           |                  glob
 *      |                    |           v                       |
 *      +--- 显示回答 <------+------- return                     v
 *                           +---------------- tool result / error result
 *                                      使用原调用 ID 再请求模型
 *
 * [CHANGED] Agent Loop 不按工具名称增加分支；本节把取消信号传给工具注册表，
 * 同时用结构化回调报告“模型收到/返回、工具执行/返回”，让终端可观察内部循环。
 * 取消、意外异常或第 8 次仍请求工具时停止并丢弃 turn，history 保持不变。
 * 运行观察：模型收到工具结果后可以继续请求工具，最终回答出现后才保存整轮消息。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { executeTool } from "../tools/registry.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";

const MAX_MODEL_CALLS = 8;

/**
 * 累加本轮各次模型请求报告的用量。
 *
 * total 或 value 为 null，表示有一次用量未知，合计也只能返回 null。
 * 两项都有数字时才相加，避免把不完整的统计显示成完整总量。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

// [CHANGED 04.1] agentLoop 增加观察者事件，并把取消信号继续传给文件工具。
/**
 * 让模型根据工具的成功或失败结果继续处理当前用户要求。
 *
 * 输入是模型、已完成历史、用户文字和取消信号。本轮消息先放在 turn，最终回答出现后才一起加入 history。
 * 工具成功和 ToolError 都用原调用 ID 返回；其他异常、取消或 8 次内仍无最终回答时停止，本轮不保存。
 * 第 8 次若还请求工具，先停止，不执行已经没有机会反馈的最后一批操作。
 * 主循环只发出步骤事件，不写终端文案；观察者收到副本，显示异常也不改变工具结果。
 */
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
): Promise<Reply> {
  signal.throwIfAborted();
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let toolSequence = 0;
  let pendingToolResults = 0;

  for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
    // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
    signal.throwIfAborted();
    emitAgentEvent(observer, {
      type: "model_start",
      call: modelCall,
      contextMessages: history.length + turn.length,
      trigger: modelCall === 1
        ? { kind: "user", content: input }
        : { kind: "tool_results", count: pendingToolResults },
    });
    pendingToolResults = 0;
    const result = await model.generate([...history, ...turn], signal);
    inputTokens = addUsage(inputTokens, result.inputTokens);
    outputTokens = addUsage(outputTokens, result.outputTokens);
    truncated ||= result.truncated;
    emitAgentEvent(observer, {
      type: "model_finish",
      call: modelCall,
      outcome: result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
      toolRequests: result.toolCalls.length,
      text: result.text,
    });

    if (result.toolCalls.length === 0) {
      if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
      signal.throwIfAborted();
      turn.push({ role: "assistant", content: result.text });
      history.push(...turn);
      return { text: result.text, inputTokens, outputTokens, truncated };
    }

    // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
    if (modelCall === MAX_MODEL_CALLS) break;

    turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      signal.throwIfAborted();
      toolSequence += 1;
      emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
      try {
        // [CHANGED 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
        const result = await executeTool(call, signal);
        turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: false });
        pendingToolResults += 1;
        emitAgentEvent(observer, {
          type: "tool_finish",
          sequence: toolSequence,
          call,
          outcome: "success",
          result,
        });
      } catch (error) {
        // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
        if (!(error instanceof ToolError)) throw error;
        turn.push({
          role: "tool",
          toolCallId: call.id,
          content: `工具执行失败：${error.message}`,
          isError: true,
        });
        pendingToolResults += 1;
        emitAgentEvent(observer, {
          type: "tool_finish",
          sequence: toolSequence,
          call,
          outcome: "error",
          error: error.message,
        });
      }
    }
  }

  throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
}
```

主循环继续只认识 `executeTool()`，不会按 `glob` 或 `read_file` 再写专用分支。

### 6. 把事件显示到终端

新增 `ui/teaching-trace.ts`，完整内容如下。它把事件转换成几行文字；参数按本地 Schema 选择，结果按元数据显示，不从源码正文里提取显示字段：

```ts
/**
 * 04.1 控制文件搜索范围 | [NEW] ui/teaching-trace.ts
 *
 * 学习目标：把模型和工具的来回显示出来，便于观察一次任务怎样完成。
 * 输入：主循环发送的 AgentEvent 副本，以及本地工具 Schema。
 * 输出：供终端逐行打印的文字；这里不调用模型、不执行工具，也不修改历史。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   AgentEvent -> 哪种事件？
 *                  | 模型开始/返回 -> 新增信息或返回类型
 *                  | 工具开始 ----> 已登记名称 + 允许显示的参数
 *                  | 工具成功 ----> 元数据中的数量与位置
 *                  | 工具失败 ----> 固定失败说明
 *
 * 本节首次把模型与工具事件写成中文过程记录。
 * 路径和参数先单行化、限长并隐藏常见凭据词特征；这不是对任意敏感信息的完整识别。
 * 运行观察：终端显示搜索到多少项、读取了哪些行，模型收到的完整正文仍走工具消息。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";

// [NEW 04.1] 本文件以下安全摘要与教学追踪实现均为本节新增。
const MAX_TRACE_VALUE_CHARS = 60;

/**
 * 把问题、参数或路径处理成一行简短的显示文字。
 *
 * 先移除控制字符并合并空白，命中常见凭据词特征时显示“已隐藏”。
 * 过长时保留前 maxChars 个处理后的字符，再追加省略号；这里只改显示副本。
 * 这种词特征检查不能识别所有秘密，原始事件也不能未经筛选直接当作公开日志。
 */
function toTraceText(value: string, maxChars = MAX_TRACE_VALUE_CHARS): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/secret|api[\s_-]?key|token|password|authorization/i.test(oneLine)) return "[已隐藏]";
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

/**
 * 只显示本地工具说明里允许出现的参数字段。
 *
 * 输入是事件中的 ToolCall。未知工具不显示参数；参数过长、不能解析为对象时显示固定提示。
 * 已知字段中的字符串再交给 toTraceText() 处理，避免把控制字符和明显凭据直接打到终端。
 * 这里生成显示摘要，不替代工具真正执行前的参数校验。
 */
function describeToolCall(call: ToolCall): { name: string; input: string } {
  const definition = toolDefinitions.find((tool) => tool.name === call.name);
  if (!definition) return { name: "未知工具", input: "参数不展示" };
  if (call.arguments.length > 1000) return { name: definition.name, input: "参数无法解析" };

  let input: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(call.arguments);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { name: definition.name, input: "参数无法解析" };
    }
    input = value as Record<string, unknown>;
  } catch {
    return { name: definition.name, input: "参数无法解析" };
  }

  const fields = Object.keys(definition.inputSchema.properties).map((key) => {
    const value = input[key];
    if (typeof value === "string") return `${key}=${JSON.stringify(toTraceText(value))}`;
    if (typeof value === "number" || typeof value === "boolean") return `${key}=${value}`;
    return `${key}=<无效>`;
  });
  return { name: definition.name, input: fields.join("，") };
}

/**
 * 根据工具自己提供的元数据，生成结果摘要。
 *
 * glob 显示路径数和最多两个示例，read_file 显示行数。
 * 路径示例还会经过显示筛选。这里不读取 content，所以无需从源码正文反推数量和位置。
 */
function describeToolResult(metadata: ToolResultMetadata): string {
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  return `${metadata.lineCount} 行文件内容`;
}

/**
 * 把一次模型或工具事件写成几行可读的过程记录。
 *
 * 模型事件显示第几次请求、收到什么新增信息、返回回答还是工具请求。
 * 工具事件显示调用摘要和执行结果，失败时使用固定说明，不直接打印底层错误。
 * 返回字符串数组，由 terminal.ts 决定怎样输出；这里不执行工具，也不改变历史。
 */
export function formatTeachingTrace(event: AgentEvent): string[] {
  if (event.type === "model_start") {
    const received = event.trigger.kind === "user"
      ? `新增用户问题「${toTraceText(event.trigger.content, 100)}」`
      : `新增 ${event.trigger.count} 条工具结果`;
    return [
      `模型 > 第 ${event.call} 次决策`,
      `  收到：${received}；Agent Loop 消息链共 ${event.contextMessages} 条。`,
    ];
  }

  if (event.type === "model_finish") {
    const result = event.outcome === "tools"
      ? `${event.toolRequests} 个工具请求。`
      : event.outcome === "final"
        ? "最终回答，交给终端显示。"
        : "空结果，本轮将停止并报告错误。";
    return [`模型 < 第 ${event.call} 次决策`, `  返回：${result}`];
  }

  const tool = describeToolCall(event.call);
  if (event.type === "tool_start") {
    return [
      `工具 > 第 ${event.sequence} 步：${tool.name}`,
      `  执行：${tool.input}。`,
    ];
  }

  const failed = event.outcome === "error";
  return [
    `工具 < 第 ${event.sequence} 步：${tool.name}${failed ? " 失败" : " 完成"}`,
    `  返回：${failed ? "执行失败" : describeToolResult(event.result.metadata)}。`,
    `  去向：${failed ? "错误" : "结果"}已加入当前回合，下一次模型决策会收到。`,
  ];
}
```

在 `ui/terminal.ts` 的导入区加入：

```ts
import type { AgentEvent } from "../agent/events.js";
```

```ts
import { formatTeachingTrace } from "./teaching-trace.js";
```

保留原来的 `colorLabel()`，在它后面、`startTerminal()` 之前加入下面的完整函数：

```ts
/**
 * 把主循环报告的步骤显示出来，让终端能看见模型和工具的来回。
 *
 * 输入是 AgentEvent；先交给 formatTeachingTrace() 生成文字，再给模型、工具标签加颜色。
 * 这里只显示已经收到的事件，不从最终回答猜执行过程，也不决定下一个工具。
 */
// [NEW 04.1] 终端开始消费 Agent Loop 的结构化事件。
export function printProgress(event: AgentEvent): void {
  for (const line of formatTeachingTrace(event)) {
    if (line.startsWith("模型")) console.log(`${colorLabel("模型", 33)}${line.slice(2)}`);
    else if (line.startsWith("工具")) console.log(`${colorLabel("工具", 34)}${line.slice(2)}`);
    else console.log(line);
  }
}
```

然后找到 `startTerminal()` 中调用 `agentLoop()` 的那一行，替换成：

```ts
        const reply = await agentLoop(model, history, text, controller.signal, printProgress);
```

这样，连续会话就把 `printProgress` 作为观察者交给了主循环。单次提问也需要接入：在 `cli.ts` 中替换终端函数的导入：

```ts
import { startTerminal, printProgress, printReply } from "./ui/terminal.js";
```

再把单次模式里调用 `agentLoop()` 的那一行替换成：

```ts
    const reply = await agentLoop(model, [], options.prompt, signal, printProgress);
```

`printReply()` 继续显示最终回答与用量，不需要修改。

### 7. 告诉模型可以先找路径

在 `config/load-config.ts` 中替换 `systemPrompt`，配置读取函数保持不变：

```ts
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。你可以调用 glob 按路径查找项目文件，再调用 read_file 读取不超过 64 KiB 的普通文件；.env 系列环境配置文件不可读取。你不能修改文件或执行命令，也不要声称已经完成这些操作。需要项目信息时必须调用工具，不要猜测。";
```

### 构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:04.1
```

```bash
hello-my-agent --prompt "请找到所有 load-config.ts，并告诉我它们位于哪些目录。"
```

终端应先显示模型与工具的过程记录，再显示最终回答。模型也可能继续读取候选文件；每次工具结果回去以后，下一步仍由模型决定。

## 运行验证

```bash
npm run check:04
```

确定性检查会验证：

- 普通源码能被找到。
- `.gitignore` 规则指定的路径，以及 `.env`、`node_modules` 和 `dist` 不进入结果。
- `!keep.log` 可以恢复普通文件，却不能恢复内置保护路径。
- `../*.ts` 被拒绝。
- 取消信号可以停止遍历。

### 失败实验

让模型请求项目外范围：

```text
glob({ "pattern": "../**/*.ts" })
```

本地程序应返回 `ToolError`，Agent Loop 再把失败结果交给模型。失败发生在目录遍历之前。

### 小练习

解释为什么结果上限为 200 时，程序必须观察第 201 项才能显示截断提示。

答案：返回 200 项只证明“至少有 200 项”；只有发现第 201 项，才能证明“还有未返回的结果”。这条判断也会在 `grep` 结果和 `read_file` 续读中重复出现。

## 本节完成后的 Agent

此时，Agent 已经能从未知项目结构中取得候选路径：

```text
用户目标 -> Agent Loop -> 模型决定下一步
                          |-- 最终回答 ------> 结束
                          |-- read_file ------> 读取已知路径
                          +-- glob(pattern) --> 发现候选路径
                                                |
                         工具结果返回模型 <----+
```

`glob` 让模型知道哪些文件确实存在，但只能按路径筛选。想知道哪个文件包含 `createModel`，还得检查正文。下一节将加入 `grep(query, glob)`：它会按自己的 `glob` 参数选择搜索范围，再返回带行号和列号的候选匹配位置。
