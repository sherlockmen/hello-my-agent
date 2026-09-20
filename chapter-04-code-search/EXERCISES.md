# 第 04 章练习：让模型收紧本次搜索预算

[第四章首页](README.md) · [先完成 04.3](03-chunked-reading/README.md) · [grep 源码](03-chunked-reading/src/tools/grep.ts) · [完整答案](#完整答案)

**本练习只解决一个问题：怎样允许模型减少本次工具输出，同时不能让模型突破程序的硬上限？**

正式实现把 `grep` 上限固定为 100 项。这个值保护本地程序和模型上下文，却无法表达一次具体任务只需要 5 项结果。

```text
模型本次需求：maxResults = 5
程序永久上限：MAX_MATCHES = 100
合法关系：     1 <= maxResults <= MAX_MATCHES
```

这是 Agent 工具常见的两层预算：

- **调用预算**由模型根据当前任务选择，可以主动缩小。
- **系统硬上限**由程序维护者决定，模型不能扩大。

## 为什么参数必须穿过完整契约

增加 `maxResults` 不能只修改循环中的常量。数据要经过：

```text
JSON Schema 声明字段
        |
        v
模型生成 arguments JSON
        |
        v
parseArguments() 检查字段、类型和范围
        |
        v
GrepArguments 保存可信内部值
        |
        v
grepTool() 用本次预算停止并输出
```

只改 Schema，兼容接口、旧历史或手写请求仍可能绕过范围；只改执行代码，模型又不知道该生成什么字段。工具定义和运行时校验共同组成契约。

## 为什么仍要多观察一项

假设 `maxResults=2`：

```text
实际只有 2 项：返回 2 项，不能声称截断
实际至少 3 项：观察到第 3 项后，返回前 2 项并标记截断
```

因此判断条件是：

```ts
if (matches.length > input.maxResults) {
  // 第 maxResults + 1 项只用来证明还有结果
}
```

`maxResults` 只控制返回给模型的匹配数量。它不会改变候选文件数、单文件大小、正则 CPU 时间或工具超时。

## 练习要求

修改 `chapter-04-code-search/03-chunked-reading/src/tools/grep.ts`：

1. 给工具 Schema 增加必填整数 `maxResults`，范围为 1 到 100。
2. 在 `parseArguments()` 中拒绝缺失、多余、非整数或越界值。
3. 用 `input.maxResults` 控制停止、切片和截断提示。
4. 保留 `MAX_MATCHES = 100` 作为不可突破的本地硬上限。

在仓库根目录运行：

```bash
npm run exercise:04
```

预期输出：

```text
✓ 第 04 章练习：grep maxResults 参数与边界检查通过
```

## 完整答案

用下面的完整文件替换 `chapter-04-code-search/03-chunked-reading/src/tools/grep.ts`：

```ts
/**
 * 第 04 章练习答案 | [CHANGED 练习] tools/grep.ts
 *
 * 学习目标：让模型用正则表达式搜索文件内容，并获得带文件名和行号的真实位置。
 * 输入：query 正则表达式、glob 文件范围和 1 到 100 的 maxResults。
 * 输出：path:line:column: text 格式的匹配结果；返回数量由本次 maxResults 收紧。
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
 *   逐行匹配 --> path:line:column --> 前 maxResults 项 + 截断说明
 *
 * 关键点：glob 缩小文件范围，grep 再检查内容。结果包含真实文件位置，模型才能继续调用 read_file。
 * 文件数、文件大小、匹配数和单行长度分别受限，避免一个宽泛查询占满内存和模型上下文。
 * 运行观察：maxResults=2 时最多返回两项；0、101 或小数会作为工具错误反馈给模型。
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import { findProjectRoot } from "./workspace.js";

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
      maxResults: {
        type: "integer" as const,
        minimum: 1,
        maximum: 100,
        description: "本次最多返回多少个匹配结果。",
      },
    },
    required: ["query", "glob", "maxResults"],
    additionalProperties: false,
  },
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

type GrepArguments = { query: string; glob: string; maxResults: number };

/**
 * 校验 grep 的 JSON 参数，并在本地编译正则表达式。
 *
 * - 输入：未经信任的工具参数字符串。
 * - 输出：返回正则查询、经过边界检查的 glob 模式和不超过硬上限的 maxResults。
 * - 关键步骤：拒绝多余字段，再用 `RegExp` 验证查询语法，避免执行阶段才发现格式错误。
 * - 失败方式：JSON、字段类型、glob 边界、maxResults 范围或正则语法无效时抛出 `ToolError`。
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
  const allowed = new Set(["query", "glob", "maxResults"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ToolError("grep 参数只能包含 query、glob 和 maxResults。");
  }
  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new ToolError("grep query 必须是非空字符串。");
  }
  if (input.query.length > 500) throw new ToolError("grep query 不能超过 500 个字符。");
  const filePattern = validateGlobPattern(input.glob);
  if (!Number.isInteger(input.maxResults)
    || (input.maxResults as number) < 1
    || (input.maxResults as number) > MAX_MATCHES) {
    throw new ToolError(`grep maxResults 必须是 1 到 ${MAX_MATCHES} 之间的整数。`);
  }
  try {
    new RegExp(input.query, "u");
  } catch {
    throw new ToolError(`grep query 不是有效的正则表达式：${input.query}`);
  }
  return { query: input.query, glob: filePattern, maxResults: input.maxResults as number };
}

/**
 * 缩短过长的匹配行，同时保留匹配位置附近的可读文本。
 *
 * - 输入：一整行文本。
 * - 输出：保留前 300 个原字符；超出时再追加省略标记。
 * - 关键原因：结果数量有限仍可能遇到超长压缩行，单行上限可继续保护模型上下文。
 */
function shortenLine(line: string): string {
  return line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;
}

/**
 * 执行有界内容搜索，并返回可以直接定位源码的文本结果。
 *
 * - 输入：模型生成的 query、glob、maxResults，项目根目录和可选取消信号。
 * - 输出：最多返回 maxResults 项，每项包含相对路径、1 起始行号、1 起始列号和匹配行。
 * - 关键步骤：先用 glob 选择候选文件，再跳过大文件和含 NUL 字节的二进制内容，最后逐行匹配。
 * - 失败方式：参数、模式或正则无效时抛出 `ToolError`；读取期间消失或无权限的单个文件会跳过；取消会立即向外传播。
 * - 职责边界：maxResults 只能收紧 100 项硬上限；本节不修改文件，单次正则执行仍没有时间上限。
 */
export async function grepTool(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const input = parseArguments(argumentsJson);
  const expression = new RegExp(input.query, "u");
  const candidates = await findMatchingFiles(input.glob, projectRoot, MAX_FILES, signal);
  const matches: string[] = [];

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
      matches.push(`${path}:${index + 1}:${(match.index ?? 0) + 1}: ${shortenLine(line)}`);
      if (matches.length > input.maxResults) {
        return `${matches.slice(0, input.maxResults).join("\n")}\n`
          + `[结果已截断，只显示前 ${input.maxResults} 项]`;
      }
    }
  }

  if (matches.length === 0) {
    const scope = candidates.truncated ? `前 ${MAX_FILES} 个候选文件` : "候选文件";
    return `${scope}中没有匹配：${input.query}`;
  }
  const suffix = candidates.truncated ? `\n[文件范围已截断，只扫描前 ${MAX_FILES} 个候选文件]` : "";
  return `${matches.join("\n")}${suffix}`;
}
```

## 验收结果怎样证明实现正确

验收脚本覆盖两类边界：

| 输入 | 预期结果 | 证明什么 |
| --- | --- | --- |
| 实际 3 项，`maxResults=2` | 返回 2 项并显示截断 | 调用预算控制输出，并观察了额外一项 |
| 实际正好 2 项，`maxResults=2` | 返回 2 项，不显示截断 | 不会把“达到上限”误判成“超过上限” |
| 缺少 `maxResults` | `ToolError` | 字段是契约必需部分 |
| 多余字段 | `ToolError` | 未实现参数不会被静默忽略 |
| `0`、`101`、`2.5`、`"2"` | `ToolError` | 本地重新检查范围和整数类型 |

完整答案修改了五个位置：Schema、`required`、内部参数类型、运行时校验和搜索停止条件。这五处共同保证“模型可以收紧预算，但不能扩大系统边界”。

这个原则会继续用于后面的命令超时、文件读取范围和子 Agent 预算：模型表达本次需求，本地程序决定不可突破的上限。
