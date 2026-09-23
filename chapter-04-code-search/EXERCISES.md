# 第 04 章练习：让模型收紧本次搜索预算

[第四章首页](README.md) · [先完成 04.3](03-chunked-reading/README.md) · [grep 源码](03-chunked-reading/src/tools/grep.ts) · [完整答案](#完整答案)

完成 04.3 后，Agent 已经能搜索位置、读取片段并继续回答。现在再改进一个使用细节：如果当前只想看前 5 个匹配，工具有没有必要返回最多 100 个？

正式实现把 `grep` 的返回上限固定为 100 项。这个上限限制进入模型上下文的结果条数，我们可以允许模型在本次调用中选一个更小的数，但仍由本地程序守住 100 项上限。

```text
模型本次需求：maxResults = 5
程序永久上限：MAX_MATCHES = 100
合法关系：     1 <= maxResults <= MAX_MATCHES
```

这里有两个数字，分别由不同角色决定：

- **本次返回数量**由模型根据任务选择，例如只要 5 项。
- **程序硬上限**仍为 100。模型请求 101 项时，本地检查会拒绝。

## 新参数怎样从模型一路传到搜索循环

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

只在 Schema 写上“最多 100”，本地执行仍可能接到 101；只改搜索循环，模型又不知道新增了什么字段。所以我们既要告诉模型该怎么填写，也要让程序检查本次实际收到的值，再让循环使用它。

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

`maxResults` 会收紧返回的匹配数量，也会影响搜索循环何时停止。候选文件仍最多选出 500 个，单文件的 1 MiB 大小限制也不变；但找到第 `maxResults + 1` 个匹配后，函数就会提前返回。较小的预算因此可能减少实际检查的内容和耗时，不过它不能限制一次同步正则匹配的 CPU 时间，也不提供工具超时保证。

## 练习要求

修改 `chapter-04-code-search/03-chunked-reading/src/tools/grep.ts`：

1. 给工具 Schema 增加必填整数 `maxResults`，范围为 1 到 100。
2. 在 `parseArguments()` 中拒绝缺失、多余、非整数或越界值。
3. 用 `input.maxResults` 控制停止、切片和截断提示。
4. 保留 `MAX_MATCHES = 100` 作为不可突破的本地硬上限。

第五章的配套代码继续使用 04.3 的正式版：`grep` 只接收 `query` 和 `glob`，固定最多返回 100 项。我们在自己的跟写工程中可以保留本练习的 `maxResults`；第五章权限层只从 `grep` 参数中提取 `glob` 来判断文件范围，新增的返回数量不会影响这一步。

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
 * 学习目标：让模型为本次搜索选择更少的返回结果，同时保留程序的 100 项硬上限。
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
 * maxResults 不改变候选文件和单文件大小上限；找到第 maxResults + 1 个匹配时会提前返回。
 * 较小预算可能减少实际内容扫描量和耗时，但不提供正则 CPU 时间或工具超时保证。
 * 大小检查后文件仍可能增大。
 * 运行观察：maxResults=2 时最多返回两项；0、101 或小数会作为工具错误反馈给模型。
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ToolError } from "../errors.js";
import { findMatchingFiles, validateGlobPattern } from "./glob.js";
import type { ToolExecutionResult } from "./types.js";
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
      // [NEW 练习] 模型每次明确选择 1 到 100 的返回数量。
      maxResults: {
        type: "integer" as const,
        minimum: 1,
        maximum: 100,
        description: "本次最多返回多少个匹配结果。",
      },
    },
    // [CHANGED 练习] 新字段必须和查询、范围一起提供。
    required: ["query", "glob", "maxResults"],
    additionalProperties: false,
  },
};

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

// [CHANGED 练习] 校验后的本次上限要传给搜索循环。
type GrepArguments = { query: string; glob: string; maxResults: number };
type GrepMatch = { path: string; line: number; column: number; text: string };

/**
 * 确认搜索条件可用，并检查模型选择的返回数量没有超过程序上限。
 *
 * 输入是模型的 JSON 参数；只接受 query、glob 和必填整数 maxResults。
 * query 必须是非空且不超过 500 字符的正则，glob 通过路径检查，maxResults 必须在 1 到 100 之间。
 * 通过时返回这些内部参数；缺字段、多余字段、错误类型、越界或正则语法错误都抛出 ToolError。
 * 正则编译成功只说明语法合法，不保证执行一定很快。
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
  // [CHANGED 练习] 只接收已经声明的三个字段。
  const allowed = new Set(["query", "glob", "maxResults"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ToolError("grep 参数只能包含 query、glob 和 maxResults。");
  }
  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new ToolError("grep query 必须是非空字符串。");
  }
  if (input.query.length > 500) throw new ToolError("grep query 不能超过 500 个字符。");
  const filePattern = validateGlobPattern(input.glob);
  // [NEW 练习] 本地重新检查，不能只相信发给模型的 Schema。
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
  // [CHANGED 练习] 把已检查的值交给执行函数。
  return { query: input.query, glob: filePattern, maxResults: input.maxResults as number };
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
 * 在候选文件中逐行查找，并按模型本次选择的数量返回结果。
 *
 * 输入是 query、glob、maxResults、项目根和可选取消信号；先用 glob 选出最多 500 个候选文件。
 * 跳过检查时超过 1 MiB、含 NUL 或无法读取的文件，每行只取第一处匹配。
 * 多看到第 maxResults + 1 项才截断；content 含匹配正文，metadata 只保存位置和数量。
 * 参数或正则无效会抛出 ToolError；单个文件读取失败会跳过，取消继续向外传播。
 * maxResults 只能收紧 100 项返回上限，候选文件上限和单文件大小限制不变。
 * 较小预算可能更早触发返回，减少实际内容扫描量和耗时；正则 CPU 时间和工具总耗时仍没有保证。
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
      // [CHANGED 练习] 多看一项再判断截断，切片和提示都使用本次选择的上限。
      if (matches.length > input.maxResults) {
        const selected = matches.slice(0, input.maxResults);
        return {
          content: `${selected.map(({ path, line, column, text }) => `${path}:${line}:${column}: ${text}`).join("\n")}\n`
            + `[结果已截断，只显示前 ${input.maxResults} 项]`,
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

## 验收结果怎样证明实现正确

验收脚本覆盖两类边界：

| 输入 | 预期结果 | 证明什么 |
| --- | --- | --- |
| 实际 3 项，`maxResults=2` | 返回 2 项并显示截断 | 调用预算控制输出，并观察了额外一项 |
| 实际正好 2 项，`maxResults=2` | 返回 2 项，不显示截断 | 不会把“达到上限”误判成“超过上限” |
| 缺少 `maxResults` | `ToolError` | 模型必须明确给出本次数量 |
| 多余字段 | `ToolError` | 未实现参数不会被静默忽略 |
| `0`、`101`、`2.5`、`"2"` | `ToolError` | 本地重新检查范围和整数类型 |

完整答案把新字段连过了五处：Schema 的字段定义、`required`、内部参数类型、运行时校验和搜索停止条件。前两处告诉模型需要填写什么，中间两处确认值能用，最后一处才让它改变本次返回数量。

完成练习后，模型可以为每次搜索选择返回数量，而不能越过本地的 100 项上限。接下来我们再处理另一个问题：参数合法、工具也存在，是否就应该立即执行？这需要独立的权限判断。
