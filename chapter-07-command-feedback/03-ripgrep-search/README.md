# 07.3 让搜索也使用受控子进程

[上一节：停止卡住或输出过多的命令](../02-process-lifecycle/README.md) · [第 07 章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

## 问题：搜索也可能让 Agent 停在原地

第四章已经有 `glob` 和 `grep`。模型用路径模式寻找候选文件，再用文字或正则定位代码，最后调用 `read_file` 读取上下文。这套顺序不需要改变，但当时的搜索是在 Agent 自己的 Node.js 进程里运行的。

其中，内容搜索逐行调用 JavaScript 的 `RegExp.exec()`。它是同步操作；某些正则遇到特定输入时会长时间回溯，直到匹配返回前，程序都无法处理取消信号。限制返回一百条结果，解决不了这一段匹配已经耗时过长的问题。

现在我们已经能启动、停止外部命令，就可以兑现第四章留下的改进：把文件发现和内容匹配交给单独的搜索进程，让搜索也能接受超时和取消。

## 解决方案：工具名称保留，实际搜索交给 rg

`rg` 是 ripgrep 提供的命令。它可以列出符合条件的文件，也可以搜索文件内容。本节仍让模型调用熟悉的 `glob` 和 `grep`，只更换本地工具内部的搜索方法。

以“找到 `createModel` 的定义”为例，模型仍然提出 `query` 和 `glob`，程序把它们作为独立参数交给 `rg`，再把搜索结果转换回文件路径和行列位置。

```text
模型调用 grep(query, glob)
          ↓
本地检查参数和搜索范围
          ↓
用固定的 rg 程序与参数数组启动搜索
          ↓
沿用上一节的时间、输出和取消控制
          ↓
把命中记录转换成 path:line:column:text
          ↓
结果回到模型，继续 read_file 或回答
```

主循环仍然只处理工具请求与结果。它不需要知道搜索已经换成另一个进程，也不必增加“如果这是 rg”的特殊分支。

## 工作原理

### 复用进程执行，不等于让模型编写搜索命令

前两节的 `run_command` 允许模型提出一整条 shell 命令，因此每次都要先向用户确认。搜索工具的职责更窄：模型只需要说“找什么”“去哪里找”，本地程序知道要运行的就是 `rg`。

所以，搜索工具会分别保存可执行程序名称和参数数组，直接启动 `rg`。查询即使含有空格、引号或 shell 的特殊字符，也只是其中一个参数，不会被拼成另一条待 shell 解释的命令。比如 `a; b` 在这里是一段查询，不会让 shell 执行第二个命令。

程序还把选项与文件路径分开保存，最后在两者之间放入 `--`，表示后面都是路径。`query` 则紧跟在 `--regexp` 后作为一个独立值；即使查询文字本身恰好是 `--`，也不会被误认为路径分隔符。

这仍然需要运行时校验。参数数组解决的是 shell 不再解释查询文字，不代表查询语法必然有效，也不代表搜索目录可以任意指定。项目相对路径、受保护文件和查询长度等规则仍由本地工具检查；正则是否合法，则由实际执行搜索的 `rg` 判断。

两种调用共用的是进程启动、输出收集和停止方法，各自允许执行什么，仍由对应工具决定。模型不能通过把命令写进 `query`，把一次只读搜索变成任意命令执行。

### 先找到文件，再解释内容结果

文件发现与内容搜索仍然是两项能力。`glob` 要的是路径清单，`grep` 要的是命中文本的位置。换成 `rg` 后，工具还要把外部程序的结果整理成这两个已经约定好的形状。

一次 `glob` 启动 `rg --files --null --glob pattern`，让路径以 NUL 分隔。NUL 是数值为 0 的字节，不能出现在文件名中，所以即使路径中有换行，也能明确区分两条路径。一次 `grep` 则分两步：先用这项文件发现取得最多 500 个候选，检查它们仍是 1 MiB 以内的普通文件，再启动第二次 `rg --json` 搜索正文。类型、大小不合适或检查时无法访问的候选会跳过。

这样模型不用因为搜索实现改变，就重新学习一套使用方式。它拿到的路径仍可交给 `read_file`，命中的行仍是下一次读取的定位依据。

不过，搜索程序的内部格式不一定能直接当作工具结果。例如，路径本身可能含有空格；内容里也可能有冒号。程序需要按 `rg` 提供的输出格式解析，不能随意把一整行按空格或冒号拆开，再猜哪一段是文件名、哪一段是正文。

`--json` 会让 rg 逐行输出 JSON 事件。工具只处理其中的 `match`，从独立字段里取得路径、行号、原行文字和第一个匹配的偏移。偏移按 UTF-8 字节计算，程序先把匹配前面的字节解码成字符串，再用字符串长度换算成第四章沿用的 JavaScript 列号。它仍不是编辑器的精确显示列：emoji 等字符会影响显示宽度。

本节只处理 UTF-8 源码。如果路径或命中内容不能按这种格式表示，工具会报错，不能拿编码后的字节串冒充正常文本。

搜索结果也不能代替阅读代码。`createModel` 可能出现在定义、调用、注释或字符串中。把搜索移到子进程里，改善的是执行方式；模型仍然要结合命中行判断它是不是所需位置，再读取上下文。

### 没有匹配，与搜索失败要分开

上一节我们常用退出码 `0` 表示成功、非零表示失败。到了 `rg`，必须继续看这个具体工具的约定：它会区分“找到匹配”“没有匹配”和“执行出错”。

| rg 退出码 | 含义 | 工具怎么处理 |
| --- | --- | --- |
| `0` | 找到匹配 | 解析结果 |
| `1` | 没有匹配 | 返回空结果说明 |
| `2` | 执行出错，例如正则无效 | 把诊断作为错误交回模型 |

如果进程被信号终止而没有数字退出码，同样不能按空结果处理。

没有匹配是一次可以理解的搜索结果，模型可以换一个名称或缩小范围继续找。无效正则、搜索程序不存在或进程超时则是执行出了问题，程序要把原因交回模型，不能伪装成空列表。

这也说明通用进程层和搜索工具层为什么要分开。进程层如实记录退出状态和输出；工具层知道自己调用的是哪个程序，再把它解释成“找到了什么”或“为什么没能搜完”。通用进程层如果写死“所有非零码都意味着工具失败”，就无法正确表达 `rg` 的无匹配情况。

正则语法也要跟着实际引擎走。本节固定使用 rg 的默认引擎，它不支持回溯引用和环视，不能先用 JavaScript `RegExp` 判定“这里是合法的”，再要求 rg 接受。工具只先检查 query 的类型、长度和 NUL，搜索时由 rg 报告具体语法问题。

### 少返回结果，与停止执行仍然各有用途

我们继续保留第四章的结果数量限制。它限制带回模型的路径或匹配条目；只有实际看到了上限以外的结果，才能提示还有内容没有展示。

本节先收齐 rg 在输出预算内的结果，再处理条数。公开的 `glob` 工具过滤、排序完整返回的这批路径，再取前 200 项；`grep` 独立调用同一个文件发现函数，把候选上限传成 500，最后返回前 100 条命中行。它不再像第四章那样，从 Node.js 遍历器多拿一条就提前结束。

每次 rg 进程使用 10 秒和两条输出合计 256 KiB 的预算。一次 grep 通常有先查路径、后搜正文两个进程，这不是整次 grep 合计 10 秒。`--max-count 101` 限制每个文件的匹配行，解析时再保留全局前 101 条以判断是否截断；它不会把所有文件的进程输出限制成 101 条。

上一节的进程控制则管运行时间与收集到的输出。两者不能互相代替：结果少，不代表搜索过程一定很快；命令及时结束，也不代表结果适合全部放进模型上下文。

如果进程被取消或达到运行上限，本次搜索没有完整结束。程序不能把已经收到的一部分结果包装成“整个项目只有这些”。模型需要收到停止原因，才能选择更小的目录、更具体的模式，或者告诉用户本次没有完成搜索。本节遇到时间或输出上限会直接返回工具错误，不继续解析可能被截成半行的 JSON。

### 搜索程序换了，忽略规则也要核对

`rg` 会使用自己的忽略规则，但它的正向 `--glob` 可以重新包含 `.gitignore` 中排除的路径。因此，文件发现结果还会再经过原来的根目录 `.gitignore` 过滤；程序内置的 `.env` 系列、`.git`、`.agents`、`.codex`、依赖和构建目录也继续排除。

内置排除选项放在模型的正向范围后面，避免模型用一个更宽的模式重新包含这些内容。工具也关闭用户的 rg 配置、全局与父目录 ignore，减少同一请求因机器配置不同而产生的意外变化。

不过，rg 还可能识别项目内部的嵌套忽略文件，匹配语法也有自己的规则，所以这里不承诺与第四章的 Node.js 实现逐项等价。本节保证的是工具输入与结果形状继续可用，根目录和内置保护继续执行，搜索过程也能接收停止请求。更复杂的忽略语义可以对照 [ripgrep 官方指南](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)。

把搜索放进子进程以后，搜索程序忙于匹配时，Agent 所在的进程仍可处理定时器与取消，再请求停止它。这正是第四章同步正则缺少的能力。它改善了搜索过程的可控性，但没有把工作目录变成沙箱；路径检查和真正访问文件之间仍可能发生变化，操作系统隔离仍留到第 33 章。


## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/tools/ripgrep.ts](src/tools/ripgrep.ts) | 固定 rg 参数、进程预算和退出码处理 |
| CHANGED | [src/tools/glob.ts](src/tools/glob.ts) | 用 rg 发现路径，保留根忽略规则和结果上限 |
| CHANGED | [src/tools/grep.ts](src/tools/grep.ts) | 让 rg 匹配正文，解析 JSON 命中结果 |

## 动手构建

把 07.2 的完整 `src/` 复制到 `chapter-07-command-feedback/03-ripgrep-search/src/`，下面只修改新目录里的工具文件。`run_command`、权限策略、主循环和 `processes/run-process.ts` 都继续沿用。

### 先准备系统 rg

本节用的是系统中的 `rg`，不新增 npm 依赖。先在终端确认：

```bash
rg --version
```

已经输出版本就可以继续。macOS 使用 Homebrew 且尚未安装时，运行：

```bash
brew install ripgrep
```

再检查一次 `rg --version`。Linux 或 WSL 的安装方式见 [ripgrep 官方安装说明](https://github.com/BurntSushi/ripgrep#installation)。程序找不到 `rg` 时会明确报错，不会悄悄退回第四章的同步搜索。

### 统一 rg 的启动和结果解释

新增 `tools/ripgrep.ts`，完整文件如下：

```ts
/**
 * 07.3 让搜索也使用受控子进程 | [NEW] tools/ripgrep.ts
 *
 * 学习目标：共用进程执行器，但按 rg 的规则解释退出状态与失败。
 * 输入：本地程序组装的参数数组、项目根和取消信号；输出：完整收集到的预算内进程结果。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数数组 -> 加入固定选项和内置排除 -> runProcess("rg", ...)
 *   无法启动？-- 是 -> ToolError；找不到时提示安装
 *             +-- 否 -> 超时或超量？-- 是 -> ToolError，要求缩小查询
 *                                   +-- 否 -> 退出码 0 或 1？-- 是 -> 返回
 *                                                          +-- 否 -> 返回错误原因
 *
 * 每次 rg 任务最多运行 10 秒、合计收集 256 KiB；没有 shell，查询不会变成 shell 操作。
 * 0 表示找到匹配，1 表示没有匹配，其他状态不能解释为空结果。
 * 排除规则放在模型的正向范围后面，环境配置与内置目录不能被重新包含。
 * 观察：rg 不存在时有安装提示，无效正则会保留 rg 的诊断，不静默退回同步搜索。
 */

import { ToolError } from "../errors.js";
import { runProcess, type ProcessResult } from "../processes/run-process.js";

// [NEW 07.3] 本文件以下实现均为本节新增。
/**
 * 执行一次固定用途的 rg 请求，返回可以继续解析的完整输出。
 *
 * args 由 glob 或 grep 在本地构造，查询、选项和路径按数组分开，不交给 shell 解释。
 * 禁用用户 rg 配置和父目录/全局忽略规则，再把内置排除放在模型范围之后。
 * 执行时采用 10 秒与两条输出合计 256 KiB 的预算；缺少 rg、被限额停止或异常退出都抛出 ToolError。
 * 只放行退出码 0 与 1，调用方据此解析路径或 JSON；不解析被截断的半行内容。
 * 本层保留 rg 自身的文件忽略语义，根 .gitignore 的再次过滤在 glob 中完成。
 */
export async function runRipgrep(
  args: string[], cwd: string, signal?: AbortSignal, paths: string[] = ["."],
): Promise<ProcessResult> {
  const exclusions = [".git", ".agents", ".codex", "node_modules", "dist"]
    .flatMap((name) => ["--iglob", `!**/${name}/**`]);
  exclusions.push("--iglob", "!**/.env", "--iglob", "!**/.env.*", "--iglob", "!**/.envrc");
  let result: ProcessResult;
  try {
    result = await runProcess("rg", [
      "--no-config", "--color", "never", "--hidden", "--no-ignore-global", "--no-ignore-parent",
      "--no-require-git", "--threads", "1", ...args, ...exclusions,
      "--", ...paths,
    ], { cwd, signal, timeoutMs: 10_000, maxOutputBytes: 256 * 1024 });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ToolError && error.message.includes("ENOENT")) {
      throw new ToolError("找不到 rg。请先安装 ripgrep，并确认 rg --version 可以运行。");
    }
    throw error;
  }
  if (result.stopReason) throw new ToolError(`rg 因 ${result.stopReason === "timeout" ? "超过 10 秒" : "输出超过 256 KiB"} 停止，请缩小 glob 或 query。`);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new ToolError(`rg 搜索失败（退出码 ${result.exitCode ?? "无"}）：${result.stderr.slice(0, 1000)}`);
  }
  return result;
}
```

`runProcess()` 仍只负责运行。`runRipgrep()` 额外知道 rg 的退出码、哪些选项固定、哪些目录需要排除，并把异常状态变成 `ToolError`。参数数组没有交给 shell，搜索参数也就不会变成 shell 操作。

### 替换文件发现的方法

打开 `tools/glob.ts`，把导入区替换为：

```ts
// [CHANGED 07.3] 使用 rg 查找文件，其他代码继续使用原工具结果类型。
import { runRipgrep } from "./ripgrep.js";
import { isAbsolute, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";
import { createIgnoreMatcher, findProjectRoot } from "./workspace.js";
```

把 `validateGlobPattern()` 换成下面的完整函数，增加 Windows 绝对路径、NUL 和开头 `!` 的检查。其他字段检查仍保留：

```ts
/**
 * 检查模型提供的文件范围，返回整理后的正向 glob 模式。
 *
 * 输入是未知值；必须为非空字符串，去掉首尾空白后不超过 500 字符。
 * 拒绝绝对路径、..、NUL，以及以 ! 开始的排除模式，防止把工具的“搜索范围”改成另一种含义。
 * 失败抛出 ToolError。这里只检查模式边界，完整匹配语义仍由 rg 判断。
 */
export function validateGlobPattern(value: unknown): string {
  if (typeof value !== "string") throw new ToolError("glob pattern 必须是字符串。");
  const pattern = value.trim();
  if (!pattern) throw new ToolError("glob pattern 不能为空。");
  if (pattern.length > 500) throw new ToolError("glob pattern 不能超过 500 个字符。");
  // [CHANGED 07.3] rg 的 ! 表示排除模式，这个工具只接受正向的文件范围。
  if (isAbsolute(pattern) || win32.isAbsolute(pattern) || pattern.startsWith("!") || pattern.includes("\0") || pattern.split(/[\\/]/).includes("..")) {
    throw new ToolError("glob pattern 必须位于当前项目根目录内，不能使用绝对路径或 ..。");
  }
  return pattern;
}
```

把 `findMatchingFiles()` 换成：

```ts
/**
 * 让 rg 查找文件，再把完整的路径输出整理为受限列表。
 *
 * pattern 已通过校验；maxResults 是返回条数，时间和输出字节限制由 runRipgrep 管理。
 * 先读取根 .gitignore，再用 --files 与 NUL 分隔输出；进程正常完成后拆分并再次过滤根规则。
 * 对这批过滤后的全部路径排序，然后取前 maxResults 项，确有额外路径才标记 truncated。
 * 超时、超量或 rg 执行失败时抛出 ToolError；取消继续向外传播，不把半份结果当成完整列表。
 * 这里不读取正文；结果数量上限并不限制 rg 已完成的目录遍历成本。
 */
export async function findMatchingFiles(
  pattern: string,
  projectRoot = findProjectRoot(),
  maxResults = MAX_RESULTS,
  signal?: AbortSignal,
): Promise<GlobResult> {
  signal?.throwIfAborted();
  const matcher = await createIgnoreMatcher(projectRoot);
  // [CHANGED 07.3] -0 用 NUL 分隔路径，文件名里有换行也不会拆成两条结果。
  const result = await runRipgrep(["--files", "--null", "--glob", pattern], projectRoot, signal);
  const paths = result.stdout.split("\0").filter(Boolean)
    .map((path) => path.replace(/^\.\//, ""))
    // rg 的正向 --glob 可能重新包含 .gitignore 里的文件，所以仍应用根目录忽略规则。
    .filter((path) => !matcher.ignores(path)).sort();
  return { paths: paths.slice(0, maxResults), truncated: paths.length > maxResults };
}
```

`globTool()` 继续保留。它拿到的仍然是 `paths` 和 `truncated`，不需要因为内部用了新程序而改变模型可见的结果。

注意这里的先后顺序：完整 rg 结果按 NUL 拆分，根忽略规则过滤，排序，再截取。200 限制返回条数；10 秒和 256 KiB 则由前面的进程执行负责。

### 把内容搜索改为解析 JSON 事件

打开 `tools/grep.ts`，将导入区替换为：

```ts
// [CHANGED 07.3] 检查候选文件后，把内容匹配交给 rg。
import { runRipgrep } from "./ripgrep.js";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import type { ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";
```

保留 `MAX_FILES = 500`、`MAX_FILE_BYTES = 1024 * 1024`、`MAX_MATCHES = 100` 与 `MAX_LINE_CHARS = 300`。在 `grepDefinition` 定义前加入 `// [CHANGED 07.3] 工具定义改用 rg 默认正则的语法说明。`，再把其中的 `query.description` 改成：

```ts
description: "ripgrep 默认正则（不支持回溯引用、环视），例如 export\\s+function\\s+createModel。",
```

把 `parseArguments()` 连同说明替换为下面的函数。这里最关键的变化是删除 `new RegExp()`，具体语法交给实际搜索的 rg：

```ts
/**
 * 检查搜索参数的形状与范围，把正则语法留给实际搜索引擎。
 *
 * 输入是模型 JSON；只接受非空、500 字符以内且不含 NUL 的 query，以及有效 glob。
 * 返回这两个字符串，不在主进程创建或执行 RegExp，因为 rg 使用的是另一种正则引擎。
 * JSON、字段或范围不符合要求时抛出 ToolError；具体正则错误由稍后的 rg 输出说明。
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
  // [CHANGED 07.3] 正则语法由 rg 校验，不能再拿 JavaScript 正则预判。
  if (input.query.includes("\0")) throw new ToolError("grep query 不能包含 NUL 字符。");
  return { query: input.query, glob: filePattern };
}
```

`shortenLine()` 继续保留，它仍然只取前 300 个原字符，超出再加省略号。最后，把 `grepTool()` 连同说明替换为：

```ts
/**
 * 把 rg 的结构化命中记录转换成已有的内容搜索结果。
 *
 * 先用 glob 取得最多 500 个已过滤候选，再启动第二次 rg 任务搜索这些路径。
 * rg 只检查 1 MiB 以内的文件，使用默认正则和 --json；每个文件最多输出 101 条匹配行。
 * 收齐结果后只解析前 101 条 match，返回前 100 条；候选或匹配确实更多时标记截断。
 * 非 UTF-8 路径或内容报错，避免把无法按本书文字规则处理的数据猜成路径和正文。
 * 正则、读取或进程失败抛出 ToolError，取消向外传播；这里不修改文件，也不执行 shell。
 */
export async function grepTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  // [CHANGED 07.3] 先拿到已过滤的候选路径，再把参数数组直接交给 rg。
  const candidates = await findMatchingFiles(input.glob, projectRoot, MAX_FILES, signal);
  const paths: string[] = [];
  // 显式传给 rg 的文件不会受 --max-filesize 过滤，因此先逐个检查大小与普通文件类型。
  for (const path of candidates.paths) {
    signal?.throwIfAborted();
    const file = await lstat(join(projectRoot, path)).catch(() => null);
    if (file?.isFile() && file.size <= MAX_FILE_BYTES) paths.push(path);
  }
  if (paths.length === 0) {
    return { content: "候选范围内没有可搜索的普通文件（文件须不超过 1 MiB）。",
      metadata: { kind: "grep", count: 0, truncated: candidates.truncated, locations: [] } };
  }
  const result = await runRipgrep([
    "--json", "--engine", "default", "--max-count", "101",
    "--regexp", input.query,
  ], projectRoot, signal, paths);
  const matches: GrepMatch[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type !== "match") continue;
    const data = event.data;
    // 非 UTF-8 的路径或匹配内容没有 text 字段；本章只处理 UTF-8 源码。
    if (typeof data.path?.text !== "string" || typeof data.lines?.text !== "string") {
      throw new ToolError("搜索结果包含非 UTF-8 路径或内容，请缩小到 UTF-8 源码范围。");
    }
    const text = data.lines.text.replace(/\r?\n$/, "");
    // rg 的偏移按 UTF-8 字节计；转换成与已有工具相同的 JavaScript 字符位置。
    const prefix = Buffer.from(text).subarray(0, data.submatches[0]?.start ?? 0).toString("utf8");
    matches.push({ path: data.path.text.replace(/^\.\//, ""), line: data.line_number,
      column: prefix.length + 1, text: shortenLine(text) });
    if (matches.length > MAX_MATCHES) break;
  }
  const selected = matches.slice(0, MAX_MATCHES);
  const truncated = candidates.truncated || matches.length > MAX_MATCHES;
  const suffix = truncated ? "\n[文件范围或匹配结果已截断，请缩小 glob 或 query]" : "";
  return {
    content: (selected.length ? selected.map(({ path, line, column, text }) =>
      `${path}:${line}:${column}: ${text}`).join("\n") : `候选文件中没有匹配：${input.query}`) + suffix,
    metadata: { kind: "grep", count: selected.length, truncated,
      locations: selected.map(({ path, line, column }) => ({ path, line, column })) },
  };
}
```

`lstat()` 先筛选仍是普通文件、检查时不超过 1 MiB 的候选。之后的搜索仍可能遇到文件变化，因此这些检查不是文件锁，也不是强制隔离。

解析时只收集 `match` 事件。每条命中行可能有多个匹配，当前工具只用第一个匹配生成列号，这与第四章“一行返回一项”的用法一致。第 101 条用于证明结果超出上限，真正给模型的仍是前 100 条。

## 运行验证

确认 `rg --version` 可用后，在仓库根目录构建本节：

```bash
npm run lesson:07.3
```

下面从同一目录运行 Agent，避免把示例的项目相对路径换成别的位置。

### 找到定义，再读取上下文

```bash
hello-my-agent --prompt "请在 chapter-07-command-feedback/03-ripgrep-search/src 内找到 createModel 的定义，使用 grep 定位后再用 read_file 读取必要上下文，解释它返回了什么。"
```

模型可能先用 glob 确认文件范围，再发起 grep，也可能直接搜索。预期应定位到本节 `src/models/client.ts`，随后读取函数附近的内容。搜索得到的是位置，读到的正文才支持最后的解释。

这次搜索不需要调用 `run_command`，也不应该请求任意 shell 的批准。模型用的仍是已经登记的只读工具；系统中的 rg 是本地工具自己选择的执行方法。

### 区分没有匹配与正则错误

先查一个本节源码里没有的标记：

```bash
hello-my-agent --prompt "请用 grep 在 chapter-07-command-feedback/03-ripgrep-search/src/**/*.ts 中搜索 HMA_DEMO_NO_MATCH_7391，只报告搜索结果，不修改文件。"
```

应该返回没有匹配，正常交回模型。再故意传入不完整的正则：

```bash
hello-my-agent --prompt "请尝试调用 grep，glob 为 chapter-07-command-feedback/03-ripgrep-search/src/**/*.ts，query 只包含一个左方括号 [。若工具拒绝，说明原因并停止，不要改写查询重试。"
```

如果模型按指定参数调用，应看到 rg 搜索失败，而不是没有匹配。模型也可能主动修正查询，这时只能说明本次没有触发指定错误，不能据此证明或否定错误处理。

### 检查固定情况

使用完整配套仓库并完成本节后，在仓库根目录运行：

```bash
npm run check:07
```

这项检查会在临时项目中运行实际子进程，覆盖测试失败后修改再复测、拒绝与单次批准、输出与退出码、EOF、超时、输出上限、取消与同组子进程清理，还会用实际 rg 检查忽略规则、查询和错误情况。它不调用真实模型，证明的是本地程序在这些固定输入下的行为。

真实模型调用则用来观察它怎样选择工具、分析报告和继续任务。本节不要求它每次用相同次数找到定义，也不把某一次回答当成所有搜索情况都正确的证明。

## 本节完成后的 Agent

现在，第四章的搜索已经用上前两节建立的进程控制。模型继续用 glob、grep 和 read_file 找代码，本地程序负责实际 rg 调用、结果转换与失败反馈；遇到复杂匹配时，Agent 仍能处理超时与取消。

本章把读取、修改和验证连成了一条完整过程。先完成[章末练习](../EXERCISES.md)，让每次命令可以在明确范围内选择等待时间。[第 08 章](../../chapter-08-streaming-turns/README.md)再改善执行中的交流：输出及时显示，当前任务中断后还能继续输入。
