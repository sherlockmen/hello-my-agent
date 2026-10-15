# 15.2 缩短工具结果并保留完整日志

[第 15 章首页](/content/chapter-15-context-budget/README.md) · [上一节：15.1 估算请求大小并预留输出](/content/chapter-15-context-budget/01-estimate-tokens/README.md) · [下一节：15.3 显示预算并在超限时停止](/content/chapter-15-context-budget/03-enforce-budget/README.md)

## 问题：一次长测试日志，会跟着后续请求重复发送

Agent 运行 `npm test` 后，工具可能返回成千上万行日志。模型要依据其中的错误决定下一步，但长日志一旦原样进入 `history`，以后的“再看一下文件”也会带着这整份结果。

上一节的估算让这种增长可见。现在要减少单份结果占用，又不能悄悄丢掉中间文字：测试失败原因可能就在被省略的部分，用户也需要找到完整结果核对。

本节在工具结果进入模型历史之前，保存工具已经返回的完整正文，再用开头、结尾、明确的裁剪说明和日志编号替换长正文。短结果保持原样；模型需要被省略的中段时，通过受控日志工具按行继续读取。

## 解决方案：本机保留完整结果，模型收到可辨认的短版本

工具执行完成以后，程序先数返回正文的 Unicode 字符。超过本节上限时，独占创建一个私有日志文件，把完整正文写完并同步；成功后，才生成带日志路径的短版本，沿原工具调用 ID 返回给模型。

短版本保留开头 6,000 个字符与结尾 2,000 个字符，中间明确写出省略数量，开头说明“以下仅为头尾”。这样模型和用户都能辨认它不是原始全文。短版本还给出日志 UUID，模型可以调用 `read_tool_result` 读取其中一小段；用户也能按路径在本机核对，不能把省略的文字当成已经看过。

如果完整日志没能保存，程序不能一边丢掉正文，一边给出不可用的路径。它会补齐当前工具调用的失败说明并停止本轮，请用户检查本机目录或磁盘。

## 工作原理

### 先分清正在缩短的是哪一份结果

`run_command` 本身已经限制执行时间和收集输出的大小，避免一个进程无限输出占满内存。读取文件等工具也有自己的返回范围。本节接到的是这些工具完成收集后返回的正文，不是外部进程从开始到结束产生过的无限原始字节。

因此，“完整日志”准确地说是“本次完整工具返回正文”。如果原工具已经写明输出截断，这份说明也会保存在日志里；本节不能恢复上游根本没有收集的内容。

三个限制分别发生在不同位置：

| 位置 | 控制什么 | 达到限制以后 |
| --- | --- | --- |
| 原工具执行与收集 | 单次运行时间、内存中的返回范围 | 按原工具规则结束或返回截断说明 |
| 本节工具结果处理 | 单份结果进入历史的原文长度 | 原返回正文保存本机，短版本进入历史 |
| 下一节请求预算 | 整次输入加输出预留是否装得下 | 超预算时不发出下一次模型请求 |

把每份结果变短，不能保证整个请求永远不过限：许多短结果、长用户输入和工具 Schema 仍会累积。它解决的是单项增长，整次请求要由下一节再判断。

### 保存成功以后，结果才换成头尾与定位信息

用一份 10,000 字符的测试返回正文举例。程序先保存全部 10,000 字符，关闭成功后，构造发给模型的内容：

```text
[工具结果已裁剪；以下仅为头尾；本机路径与日志 UUID；可调用 read_tool_result]
原正文开头 6,000 字符
[中间省略 2,000 个字符；裁剪可能省略重要信息]
原正文结尾 2,000 字符
```

这里为了说明组成省略了真实日志。最终消息会比 8,000 字符长，因为定位信息和省略说明也是消息正文；上限约束的是保留的原始字符，不是最终消息的精确 Token 数。下一次请求仍会按整个短版本重新估算。

程序按 Unicode 码点截取，不从 JavaScript 代理对中间切开，避免把一个表情拆成两个无效片段。头尾规则没有理解日志含义，也不保证保留最重要的错误。保留开头通常能看到命令与环境，保留结尾通常能看到汇总，但这是取舍，不是语义筛选。

工具调用 ID、角色和错误状态保持原来的对应关系，改变的是结果正文。模型仍知道这是哪次 `run_command` 的返回，不会因为裁剪凭空多出一个用户要求；新用户补充的交付时机也保持原循环规则。

### 同一份短结果交给历史和后续模型

裁剪必须发生在工具结果加入历史之前。如果只是把 TUI 展示缩短，而 `history` 仍保存原全文，下次请求就不会变小；如果只在发送时临时替换，界面和会话恢复又可能看见另一份结果。

本节由核心循环统一处理，再把同一份结果交给工具事件和历史。后续模型请求、会话保存与恢复都使用这份短正文；完整正文单独留在本机日志。日志默认位于用户目录的 `.hello-my-agent/tool-results`，每次使用新的 UUID 文件名，以私有目录和文件权限创建。

### 模型按日志编号取回需要的部分

日志位于项目工作区之外，不能让项目文件工具接受任意绝对路径来绕过工作区限制。程序因此增加专门的 `read_tool_result`：只接受消息里给出的日志 UUID，固定到本机日志目录查找对应文件，不接受磁盘路径。

假设头尾里能看到测试报错，但具体断言位于第 700 行附近。模型可以请求下面这一小段；这里仅展示工具参数，省略调用 ID 和外层消息。

```json
{ "id": "日志的完整UUID", "offset": 698, "limit": 5 }
```

`offset` 从第 1 行开始，每次最多 5 行，每行最多返回 1,000 个原字符，并标出真实行列位置。某行超过 1,000 字符时，结果给出 `column` 续读位置；再请求同一行的下一列，才能继续查看行中间，而不是永久丢掉长行的后半部分。下一段也会说明起始行，模型据此决定是否还缺信息。

这个读取工具返回的仍是一份有限工具结果，也沿相同调用 ID 进入历史和预算。因此按需读取会消耗上下文，但每次能控制范围，不会因为“打开完整日志”又把整份正文送回模型。无效 UUID、越界范围、日志缺失或超过读取大小上限时，返回工具错误，模型可以根据错误调整参数或向用户说明，不能伪造读到了中间内容。

绝对路径供用户本机定位，UUID 供本地工具定位；两者都没有让远端模型直接访问磁盘。模型先提出工具调用，本地程序读取后才把有限片段发回。日志移动或清理后引用会失效，这里不是永久归档服务。

### 日志失败和取消时，先保住结果关系，再收尾

长正文保存发生在工具已经运行之后。保存失败不能撤销测试命令或已发生的文件修改，所以错误必须说明是“结果日志无法保存”，不能把它写成“工具没有执行”。程序用明确的失败说明补齐当前调用结果，收束这一轮并回到可交互状态；不再让模型基于一份被静默丢弃的正文继续推理。

取消时也要区分阶段。保存开始前检测到取消，就不启动保存；保存过程中已经进入系统调用时，程序等待关闭句柄，尽量删除未完成日志，再传播停止。只有完整写入、同步、关闭并再次检查取消以后，日志路径才被宣称可用。失败或取消的半份文件不会作为成功引用发给模型。

这份日志处理没有锁住整个文件系统，也不替原工具回滚副作用。目录检查会拒绝发现的异常，但仍是在我们控制的本机目录中工作，不能将它当成抵抗恶意并发替换的沙箱。

<!-- generated:media:start -->
下面把 12,000 字符的返回正文分成头、中、尾。先保存全文，才把头尾和编号放入历史；模型请求中段后，受控工具取出原文，并把它作为这次调用的结果送回历史。

<img src="./content/chapter-15-context-budget/02-bound-tool-results/assets/bound-tool-result-cover-d0c70175ec.png" data-gif-src="./content/chapter-15-context-budget/02-bound-tool-results/assets/bound-tool-result-09227471fe.gif" data-cover="./content/chapter-15-context-budget/02-bound-tool-results/assets/bound-tool-result-cover-d0c70175ec.png" data-no-zoom alt="长结果先同步保存全文，再给头尾与编号；按编号读取第70行的调用移向日志，原文片段返回并与读取调用配对">

[静态封面](/content/chapter-15-context-budget/02-bound-tool-results/assets/bound-tool-result-cover-d0c70175ec.png.md) · [查看完整静态分镜](/content/chapter-15-context-budget/02-bound-tool-results/assets/bound-tool-result-storyboard-c844c46802.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/context/tool-results.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/context/tool-results.ts.md) | 先同步保存长结果全文，再返回头尾与日志编号；提供受控分段读取 |
| NEW | [src/tools/read-tool-result.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/tools/read-tool-result.ts.md) | 验证 UUID、行号和列号，读取少量日志原文 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/agent/run-options.ts.md) | 允许注入同一个日志目录，便于隔离验证 |
| CHANGED | [src/tools/registry.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/tools/registry.ts.md) | 登记 read_tool_result 并传入受控日志目录 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/permissions/policy.ts.md) | 识别受控日志读取，沿用只读工具规则 |
| CHANGED | [src/models/client.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/models/client.ts.md) | 在当前模式提供读取工具，说明不能把裁剪结果当作完整依据 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-15-context-budget/02-bound-tool-results/src/agent/agent-loop.ts.md) | 工具结果入历史前裁剪；失败时补齐调用结果后停止 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 15.1 的完整 `src/` 继续，目标目录为 `chapter-15-context-budget/02-bound-tool-results/`。先新增日志与裁剪模块，再接到核心循环“取得工具结果 → 发出结果事件、加入历史”之间。原工具的执行上限与返回格式不变。

<!-- generated:build:start -->
### 1. 先同步保存长结果全文，再返回头尾与日志编号；提供受控分段读取

新建 `src/context/tool-results.ts`，完整内容如下。

<details>
<summary>完整文件：src/context/tool-results.ts（NEW）</summary>

<!-- source: src/context/tool-results.ts -->
```ts
/**
 * 15.2 限制大工具结果 | [NEW] context/tool-results.ts
 *
 * 学习目标：把模型需要的短结果与本机可定位的完整工具结果分开保存。
 * 输入：工具已经收集并返回的正文，不是无限长的进程原始输出。
 * 输出：短正文原样返回；长正文先写私有日志、sync，再返回开头、结尾与文件引用。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整工具正文 -> 超过 8000 字符？-- 否 -> 原样返回
 *                             +-- 是 -> 写完整日志、sync、关闭 -> 头尾 + 省略提示 + 可续读编号
 *   写入失败 / 取消 -> 等关闭、尽量删除不完整日志 -> 核心保留工具状态并停止本轮
 * 这里不绕过原工具的输出限制，也不保证磁盘上无限期保留日志。
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";

// [NEW 15.2] 长度按 Unicode 码点计数，头尾不会从代理对中间切开。
export const MAX_TOOL_RESULT_CHARS = 8_000;
export const TOOL_RESULT_HEAD_CHARS = 6_000;
export const TOOL_RESULT_TAIL_CHARS = 2_000;
export const DEFAULT_TOOL_RESULT_DIRECTORY = join(homedir(), ".hello-my-agent", "tool-results");
export type BoundedToolResult = { content: string; originalChars: number; logPath?: string; logId?: string };

/**
 * 为结果保留前 6000 和后 2000 个原字符，中间明确写出省略数量。
 * 附加说明不计入 8000 个原字符，所以最终正文会比 8000 更长。
 */
export function clippedToolText(content: string): string {
  const characters = Array.from(content);
  if (characters.length <= MAX_TOOL_RESULT_CHARS) return content;
  return characters.slice(0, TOOL_RESULT_HEAD_CHARS).join("")
    + `\n\n[中间省略 ${characters.length - MAX_TOOL_RESULT_CHARS} 个字符；裁剪可能省略重要信息]\n\n`
    + characters.slice(-TOOL_RESULT_TAIL_CHARS).join("");
}

/**
 * 成功保存完整正文后才给出日志引用；日志文件使用独占创建与 0600 权限。
 * signal 在开始和写完后检查；写入中的系统调用仍会等关闭，取消不留下已宣称成功的半份日志。
 * 失败或取消会关闭并尽量删除未完成文件；失败抛出安全说明，由核心保留调用结果摘要并停止本轮。
 * 目录只拒绝最后一级已存在的符号链接；这不是抵抗恶意并发替换的文件系统沙箱。
 */
export async function boundToolResult(content: string, signal: AbortSignal, directory = DEFAULT_TOOL_RESULT_DIRECTORY): Promise<BoundedToolResult> {
  signal.throwIfAborted();
  const originalChars = Array.from(content).length;
  if (originalChars <= MAX_TOOL_RESULT_CHARS) return { content, originalChars };
  const targetDirectory = resolve(directory);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let path: string | undefined;
  let complete = false;
  try {
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    const information = await lstat(targetDirectory);
    if (!information.isDirectory() || information.isSymbolicLink()) throw new Error("invalid log directory");
    signal.throwIfAborted();
    const id = randomUUID();
    path = join(targetDirectory, `${id}.log`);
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    signal.throwIfAborted();
    complete = true;
    return { content: `[工具结果已裁剪；以下仅为头尾，完整工具返回保存在本机：${path}；日志编号 ${id}。\n需要中间内容时调用 read_tool_result，id 使用该编号，offset 从 1 开始，limit 最多 5；超长行可用 column 续读。]\n`
      + clippedToolText(content), originalChars, logPath: path, logId: id };
  } catch {
    signal.throwIfAborted();
    throw new UserFacingError("完整工具结果日志无法保存，本轮已停止；没有生成可用的完整日志引用。请检查本机磁盘与目录权限。");
  } finally {
    await handle?.close().catch(() => {});
    if (!complete && path) await unlink(path).catch(() => {});
  }
}
```

</details>

### 2. 验证 UUID、行号和列号，读取少量日志原文

新建 `src/tools/read-tool-result.ts`，完整内容如下。

<details>
<summary>完整文件：src/tools/read-tool-result.ts（NEW）</summary>

<!-- source: src/tools/read-tool-result.ts -->
```ts
/**
 * 15.2 限制大工具结果 | [NEW] tools/read-tool-result.ts
 *
 * 学习目标：让模型能够继续读取被裁掉的原文，而不是只看到一条无法访问的磁盘路径。
 * 输入：已给出的日志 UUID、起始行、最多 5 行，以及可选的首行起始列。
 * 输出：带行列位置的有限片段；超长单行可用 column 继续读取，不会永久丢失行中间。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   严格校验编号与范围 -> 只打开日志目录内对应普通文件 -> 有界读取 -> 按行列返回片段
 *   文件 / 目录不合法、超过大小或取消 -> 关闭句柄 -> 明确错误 / 取消
 * 不接受任意路径；拒绝日志文件和目录末级符号链接。假设本机目录可信，不是文件系统沙箱。
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_TOOL_RESULT_DIRECTORY } from "../context/tool-results.js";
import { ToolError } from "../errors.js";
import type { ToolExecutionResult } from "./types.js";

// [NEW 15.2] 每次最多 5 行、每行 1000 个码点，防止取回原文时再次塞入一整份大结果。
export const readToolResultDefinition = {
  name: "read_tool_result",
  description: "按已知 UUID 读取本机完整工具日志。offset 从 1 开始，limit 最多 5 行；长行用 column 从指定字符继续。只接受日志编号，不接受磁盘路径。",
  inputSchema: { type: "object" as const, properties: {
    id: { type: "string" as const, description: "大结果消息中给出的日志 UUID。" },
    offset: { type: "integer" as const, minimum: 1, description: "起始行号。" },
    limit: { type: "integer" as const, minimum: 1, maximum: 5, description: "最多读取的行数。" },
    column: { type: "integer" as const, minimum: 1, description: "首行从第几个字符开始，默认 1；其余行从第 1 个字符开始。" },
  }, required: ["id", "offset", "limit"], additionalProperties: false },
};

/**
 * 验证日志编号和读取范围，再从本机专用目录打开普通日志。
 * 单次读取至多 16 MiB 的原始文件，但只返回 5×1000 个原字符；每行标出续读位置。
 * 取消、缺失、符号链接、过大文件和其他读取失败都不会返回伪造的成功内容。
 */
export async function readToolResultTool(argumentsJson: string, signal?: AbortSignal,
  directory = DEFAULT_TOOL_RESULT_DIRECTORY): Promise<ToolExecutionResult> {
  signal?.throwIfAborted();
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch { throw new ToolError("read_tool_result 参数必须是 JSON 对象。"); }
  if (Object.keys(input).some((key) => !["id", "offset", "limit", "column"].includes(key))
    || typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id)
    || !Number.isSafeInteger(input.offset) || (input.offset as number) < 1
    || !Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 5
    || (input.column !== undefined && (!Number.isSafeInteger(input.column) || (input.column as number) < 1))) {
    throw new ToolError("read_tool_result 需要有效的 UUID、从 1 开始的 offset/column，以及 1-5 的 limit。");
  }
  const offset = input.offset as number, limit = input.limit as number, column = (input.column as number | undefined) ?? 1;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let content: string;
  try {
    const root = resolve(directory);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error();
    handle = await open(join(root, `${input.id}.log`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const information = await handle.stat();
    if (!information.isFile() || information.size > 16 * 1024 * 1024) throw new Error();
    signal?.throwIfAborted();
    // stat 后文件仍可能增长；只读上限再多 1 字节，超出就拒绝，不依赖旧尺寸。
    const maximum = 16 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximum) {
      signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); total += bytesRead;
    }
    if (total > maximum) throw new Error();
    content = Buffer.concat(chunks, total).toString("utf8");
    signal?.throwIfAborted();
  } catch {
    signal?.throwIfAborted();
    throw new ToolError("完整工具日志不存在、无法读取或超过 16 MiB；请检查本机日志文件。");
  } finally { await handle?.close(); }
  const lines = content.split(/\r?\n/);
  if (offset > lines.length) throw new ToolError("起始行超过日志范围。");
  const selected = lines.slice(offset - 1, offset - 1 + limit).map((line, index) => {
    const characters = Array.from(line), start = index === 0 ? column : 1;
    if (start > characters.length + 1) throw new ToolError("起始列超过日志行范围。");
    const excerpt = characters.slice(start - 1, start - 1 + 1000).join("");
    const continuation = characters.length > start - 1 + 1000
      ? ` [本行未完：offset=${offset + index}, column=${start + 1000}]` : "";
    return `${offset + index}:${start}: ${excerpt}${continuation}`;
  });
  const endLine = offset + selected.length - 1, hasMore = endLine < lines.length;
  return { content: `[完整工具日志 ${input.id}；第 ${offset}-${endLine} 行]\n${selected.join("\n")}\n`
    + (hasMore ? `[下一段 offset=${endLine + 1}；有行内续读提示时先读取该列]` : "[已到日志末行；仍需检查行内续读提示]"),
    metadata: { kind: "read_file", lineCount: selected.length, startLine: offset, endLine, hasMore } };
}
```

</details>

### 3. 允许注入同一个日志目录，便于隔离验证

在上一节的 `src/agent/run-options.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/run-options.ts（CHANGED）</summary>

<!-- source: src/agent/run-options.ts -->
```diff
--- a/src/agent/run-options.ts
+++ b/src/agent/run-options.ts
@@ -1,5 +1,5 @@
 /**
- * 14.2 文件检查点 | [CHANGED] agent/run-options.ts
+ * 15.2 限制大工具结果 | [CHANGED] agent/run-options.ts
  *
  * 学习目标：保存会话时辨明运行选项与持久状态；本文件沿用整轮控制数据约定。
  * 输入：本地入口选定的模式、会话清单、问答 handler 与本轮队列回调。
@@ -58,8 +58,10 @@
  * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
  * 省略可选项时使用默认模式或缺省交互；回调仅负责本轮，不能把旧轮补充带进新轮。
  */
-// [CHANGED 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
+// [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
 export type RunOptions = {
+  // [NEW 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
+  toolResultDirectory?: string;
   fileCheckpoints?: FileCheckpointStore;
   // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
   mode?: ExecutionMode;
```

</details>

### 4. 登记 read_tool_result 并传入受控日志目录

在上一节的 `src/tools/registry.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/tools/registry.ts（CHANGED）</summary>

<!-- source: src/tools/registry.ts -->
```diff
--- a/src/tools/registry.ts
+++ b/src/tools/registry.ts
@@ -1,8 +1,7 @@
 /**
- * 14.2 文件检查点 | [CHANGED] tools/registry.ts
+ * 15.2 限制大工具结果 | [CHANGED] tools/registry.ts
  *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责根据工具名称找到实现，并传入本轮清单与问答入口。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 学习目标：让模型能按日志编号取回被裁剪的内容；本文件注册只读日志工具，并把本轮日志目录传给对应实现。
  * 输入：模型给出的工具名称、JSON 参数与取消信号。
  * 输出：读取、清单和问答工具返回结果；写入和命令先返回 preview/execute，批准后才返回实际结果。
  * 状态：分发失败向外抛错；执行入口调用过的工具可能已有副作用，注册表不负责回滚。
@@ -10,7 +9,8 @@
  * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
  *   prepareTool -> 写入或命令？-- 是 -> 对应准备函数 -> 返回预览，或抛错
  *                             +-- 否 -> 返回 null
- *   executeTool -> 直接执行工具？-- 是 -> 对应执行函数 -> 返回结果，或抛错
+ *   executeTool -> read_tool_result？-- 是 -> 传入本轮日志目录 -> 按编号读取 -> 结果或错误
+ *                           +-- 否 -> 已有直接工具？-- 是 -> 对应执行函数 -> 结果或错误
  *                           +-- 否 -> 拒绝直接写入、命令或未知工具
  *   executePreparedTool -> 保存的 execute -> 结果或错误
  *
@@ -25,6 +25,8 @@
 import { globDefinition, globTool } from "./glob.js";
 import { grepDefinition, grepTool } from "./grep.js";
 import { readFileDefinition, readFileTool } from "./read-file.js";
+// [NEW 15.2] 日志读取只接受保存后生成的编号，不开放任意磁盘路径。
+import { readToolResultDefinition, readToolResultTool } from "./read-tool-result.js";
 import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
 import { editFileDefinition, prepareEditFile } from "./edit-file.js";
 import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
@@ -41,6 +43,8 @@
 // [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
 // [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
 export const toolDefinitions = [
+  // [NEW 15.2] 让模型能发现按编号补读完整日志的只读工具。
+  readToolResultDefinition,
   // [KEEP 来自 07.1] 命令工具也要先批准，不能直接执行。
   readFileDefinition, globDefinition, grepDefinition, writeFileDefinition, editFileDefinition, runCommandDefinition,
   todoWriteDefinition,
@@ -58,7 +62,7 @@
 export async function prepareTool(
   call: ToolCall,
   signal: AbortSignal,
-  // [CHANGED 14.2] 只有获批准的写入闭包会使用本会话检查点。
+  // [KEEP 来自 14.2] 只有获批准的写入闭包会使用本会话检查点。
   options: RunOptions = {},
 ): Promise<PreparedToolCall | null> {
   signal.throwIfAborted();
@@ -87,6 +91,8 @@
   if (call.name === todoWriteDefinition.name) return todoWriteTool(call.arguments, options.tasks ?? { items: [] }, signal);
   // [KEEP 来自 12.3] 分发给问答工具，等待本地 handler 后返回原调用结果。
   if (call.name === askUserDefinition.name) return askUserTool(call.arguments, options.askUser, signal);
+  // [NEW 15.2] 使用保存日志时的同一个目录，避免编号指向另一处存储。
+  if (call.name === readToolResultDefinition.name) return readToolResultTool(call.arguments, signal, options.toolResultDirectory);
   if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
   if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
   if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
```

</details>

### 5. 识别受控日志读取，沿用只读工具规则

在上一节的 `src/permissions/policy.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/permissions/policy.ts（CHANGED）</summary>

<!-- source: src/permissions/policy.ts -->
```diff
--- a/src/permissions/policy.ts
+++ b/src/permissions/policy.ts
@@ -1,8 +1,7 @@
 /**
- * 13.1 保存会话 | [KEEP] permissions/policy.ts
- *
- * 学习目标：把会话状态保存到磁盘；本文件沿用已有职责，负责在每个工具执行前判断模式、路径和本次批准。
- * 阅读说明：本节沿用此模块；保存入口接在消费者收尾，不把本文件的配置、显示或控制对象整包存盘。
+ * 15.2 限制大工具结果 | [CHANGED] permissions/policy.ts
+ *
+ * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责在每个工具执行前判断模式、路径和本次批准。
  * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
  * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
  * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
@@ -179,6 +178,8 @@
     return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
   }
   // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
+  // [NEW 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
+  if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
   if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
   // [KEEP 来自 12.3] 放行澄清等待；答案不产生文件或命令批准。
   if (call.name === "ask_user") return { action: "allow", reason: "澄清问题只等待用户回答，不授予工具执行权限" };
```

</details>

### 6. 在当前模式提供读取工具，说明不能把裁剪结果当作完整依据

在上一节的 `src/models/client.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/models/client.ts（CHANGED）</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,5 +1,5 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] models/client.ts
+ * 15.2 限制大工具结果 | [CHANGED] models/client.ts
  *
  * 学习目标：分清本地输入估算、服务商用量与费用估计；本文件负责按本轮模式组装请求，收齐并检查模型结果。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -64,7 +64,7 @@
  * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
  */
 export interface Model {
-  // [NEW 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
+  // [KEEP 来自 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
   inspectContext?(messages: Message[], mode?: ExecutionMode): ContextBudget;
   estimateCost?(input: number | null, output: number | null): number | null;
   // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
@@ -265,11 +265,13 @@
 function requestParts(mode: ExecutionMode): { prompt: string; definitions: typeof toolDefinitions } {
   // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
   // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
+  // [CHANGED 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
   const definitions = mode === "plan"
     // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
-    ? toolDefinitions.filter((tool) => ["read_file", "glob", "grep", "todo_write", "ask_user"].includes(tool.name))
+    ? toolDefinitions.filter((tool) => ["read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user"].includes(tool.name))
     : toolDefinitions;
-  const prompt = systemPrompt + " 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
+  // [CHANGED 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
+  const prompt = systemPrompt + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
     ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
     : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
   return { prompt, definitions };
@@ -307,7 +309,7 @@
           parameters: tool.inputSchema, strict: false,
         },
       })),
-      // [NEW 15.1] 输出上限与本地预留使用同一个值，包含服务商计入 completion 的生成 token。
+      // [KEEP 来自 15.1] 输出上限与本地预留使用同一个值，包含服务商计入 completion 的生成 token。
       max_completion_tokens: limits.outputReserve,
       stream_options: { include_usage: true },
     }, { signal });
@@ -338,7 +340,7 @@
     tools: definitions.map((tool) => ({
       name: tool.name, description: tool.description, input_schema: tool.inputSchema,
     })),
-    // [NEW 15.1] Anthropic 使用本协议要求的输出上限字段。
+    // [KEEP 来自 15.1] Anthropic 使用本协议要求的输出上限字段。
     max_tokens: limits.outputReserve,
   }, { signal });
   const argumentsByIndex = new Map<number, { json: string; initial: unknown; closed: boolean }>();
```

</details>

### 7. 工具结果入历史前裁剪；失败时补齐调用结果后停止

在上一节的 `src/agent/agent-loop.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/agent/agent-loop.ts（CHANGED）</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,8 +1,8 @@
 /**
- * 15.1 估算请求大小 | [CHANGED] agent/agent-loop.ts
+ * 15.2 限制大工具结果 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：对即将发送的完整输入做本地估算，并把估算、服务商用量与费用估计分开。
- * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供当前模式的输入估算和本地单价计算。
+ * 学习目标：先保存完整工具正文，再把有明确省略和可续读引用的头尾交回模型。
+ * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
  *
@@ -32,9 +32,9 @@
  *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
  *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
  *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
- *      [NEW 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
+ *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
  *      本节先显示预算；尚未启用超限停止 -> 请求模型
- *      [NEW 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
+ *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
  *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
  *                                                                        +-- 是 -> B
  *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
@@ -57,8 +57,13 @@
  *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
  *                                                +-- 否 -> ToolError 或取消 -> D / X
  *                            TUI 面板独占输入；旧请求结束后旧回调失效
- *   D: 保存工具正文与错误标记 -> 发过程事件 -> 本批还有调用？-- 是 -> C
- *                                                                +-- 否 -> A
+ *   D: 工具已返回 -> [NEW 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
+ *                                                        +-- 是 -> 写完整本地日志、sync、关闭
+ *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
+ *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
+ *      [NEW 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
+ *      保存正文 / 裁剪正文与原调用 ID、错误标记 -> 过程事件 -> 本批还有调用？-- 是 -> C
+ *                                                                             +-- 否 -> A
  *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
  *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
  *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
@@ -75,11 +80,12 @@
  *
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
- * 工具结果仍给模型，界面只处理显示副本；模式选择、澄清答案和聊天文字都不能产生批准。
+ * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
  * 运行观察：本地估算不是服务商计数或容量保证；服务商 usage 缺失时保持未知，本节不自动摘要。
  */

 import { ToolError, UserFacingError } from "../errors.js";
+import { boundToolResult, clippedToolText } from "../context/tool-results.js";
 import type { Message, Model, Reply } from "../models/client.js";
 import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
 import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
@@ -151,7 +157,7 @@
         emitAgentEvent(observer, { type: "input_applied", ...queued, call: modelCall });
       }
       signal.throwIfAborted();
-      // [NEW 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
+      // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
       const messages = [...history, ...turn];
       const budget = model.inspectContext?.(messages, mode);
       if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
@@ -173,7 +179,7 @@
       inputTokens = addUsage(inputTokens, result.inputTokens);
       outputTokens = addUsage(outputTokens, result.outputTokens);
       truncated ||= result.truncated;
-      // [NEW 15.1] 任一次 usage 缺失后累计值保持未知，不以估算补充；费用只按用户配置计算。
+      // [KEEP 来自 15.1] 任一次 usage 缺失后累计值保持未知，不以估算补充；费用只按用户配置计算。
       emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
         costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
       emitAgentEvent(observer, {
@@ -306,17 +312,26 @@
           const result = prepared
             ? await executePreparedTool(prepared, signal)
             : await executeTool(call, signal, toolOptions);
-          // [KEEP 来自 07.1] 非零退出码表示本次命令失败，保留输出供模型决定下一步。
-          turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: result.isError ?? false });
-          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
+          // [NEW 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
           executingCallId = undefined;
+          let modelContent: string;
+          try { modelContent = (await boundToolResult(result.content, signal, options.toolResultDirectory)).content; }
+          catch (error) {
+            // 原工具的错误标记保持不变；给本次调用留下明确摘要，不声明不存在的日志引用。
+            const content = `[本地状态：工具已返回，但完整日志未保存；本轮停止，以下仅为头尾，不能找回被省略部分]\n${clippedToolText(result.content)}`;
+            turn.push({ role: "tool", toolCallId: call.id, content, isError: result.isError ?? false });
+            emitAgentEvent(observer, { type: "tool_finish", sequence: toolSequence, call, outcome: "success", result: { ...result, content } });
+            throw error;
+          }
+          // [KEEP 来自 07.1] 非零退出码仍是错误；裁剪不改变原调用编号或成功/失败。
+          turn.push({ role: "tool", toolCallId: call.id, content: modelContent, isError: result.isError ?? false });
           pendingToolResults += 1;
           emitAgentEvent(observer, {
             type: "tool_finish",
             sequence: toolSequence,
             call,
             outcome: "success",
-            result,
+            result: { ...result, content: modelContent },
           });
         } catch (error) {
           // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根目录编译并链接本节：

```bash
npm run lesson:15.2
```

进入加法演示工作区，启动 Agent：

```bash
cd docs/.work/ch13-typescript-demo
hello-my-agent
```

输入下面要求，审批时核对命令只打印演示日志：

```text
运行 node -e 'console.log("测试日志开始\n" + "过程记录\n".repeat(2000) + "测试日志结束")'。不要修改文件。根据结果说明是否看到了全部中间内容，不要把省略的日志当成已读。
```

工具正文足够长时，结果开头应有明确的裁剪说明和本机日志路径，结尾仍能看到“测试日志结束”。下一次请求的历史里保存的是这份短结果，模型应承认中间内容被省略。

正常退出后，在本机打开结果中显示的日志路径，核对它同时包含开头、全部过程记录与结尾。这里的原命令输出应在原工具收集上限内；不要用无限输出实验代替日志裁剪验证。

8,000 字符的边界、表情截取、按行列续读和无效编号使用[章末练习](/content/chapter-15-context-budget/EXERCISES.md)验证。使用完整配套仓库时，可在根目录运行 `npm run check:15`，另行核对日志失败、取消后的等待与清理；这些检查均不调用真实模型。

## 本节完成后的 Agent

Agent 现在会在长工具结果进入历史前保存完整本机正文，用明确标记的头尾和路径交给模型。用户可以核对全文，模型也能按日志编号取回缺少的有限片段。单份结果变短以后，整个请求仍会随历史增长；下一节在每次模型调用前检查预算，并在没有足够空间时明确停止。
