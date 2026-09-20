# 04.2 把文本目标变成代码位置

[上一节：控制文件搜索范围](../01-file-discovery/README.md) · [第四章首页](../README.md) · [本节源码](src/) · [下一节：把代码位置变成上下文](../03-chunked-reading/README.md)

**本节只解决一个核心问题：Agent 怎样把“找某段逻辑”的语义目标，转换成可以继续读取的 `path:line:column` 证据？**

上一节的 `glob` 能列出路径。面对 300 个 TypeScript 文件时，路径列表仍然不能回答 `createModel` 定义在哪一行。逐个调用 `read_file` 会把搜索成本变成大量模型轮次和上下文文本。

## 问题：模型需要位置证据，而不是更多文件内容

用户要求：

```text
找到 createModel 的定义。
```

`glob("src/**/*.ts")` 只能把搜索空间缩小到 TypeScript 文件。下一步需要一个本地工具完成两件事：

1. 在候选文件中匹配文本。
2. 把命中转换成模型可引用、可继续读取的位置。

因此本节新增：

```ts
grep({
  query: "export\\s+function\\s+createModel",
  glob: "src/**/*.ts",
});
```

结果形状固定为：

```text
src/models/client.ts:41:17: export function createModel(config: Config): Model {
```

核心认识是：**`grep` 的职责不是理解代码语义，而是把模糊目标转换成位置证据。** 注释、字符串和真正的定义都可能命中；模型要在下一节读取上下文后再判断。

## 解决方案

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
```

`glob` 控制“去哪里找”，`query` 控制“找什么”。把两者放在同一次工具调用里，模型每次搜索都必须明确范围。

## 工作原理

### 1. `grep` 是稳定契约，搜索引擎是可替换后端

Agent Loop 只认识这份工具契约：

```text
输入：query + glob
输出：path:line:column:text
失败：ToolError
```

它并不关心底层怎样完成搜索。注册表把 `grep` 名称映射到当前实现，工具结果仍用原调用 ID 回到模型。

这种分层非常关键：更换搜索实现时，模型协议和 Agent Loop 不需要修改，变化集中在 `grepTool()` 后面的执行后端。

### 2. 参数为什么要经过四层约束

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

工具 Schema 面向模型，TypeScript 类型面向编译器，本地校验面向真正要执行的数据。这三层不能互相替代。

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

候选文件上限是 500。如果实际文件更多，`candidates.truncated` 会记录范围不完整。因此“候选文件中没有匹配”只证明已经扫描的这一批没有命中，不能证明未扫描区域也不存在目标。

这揭示了 Agent 搜索中的一个通用原则：**空结果只有在搜索范围完整时才是全局否定证据。** 范围被截断时，模型应该缩小 glob 或换一个搜索策略。

### 4. 文本怎样变成行号和列号

每个候选文件先经过三项检查：

```ts
const filePath = join(projectRoot, path);
if ((await stat(filePath)).size > MAX_FILE_BYTES) continue;
content = await readFile(filePath, { encoding: "utf8", signal });
if (content.includes("\0")) continue;
```

- 1 MiB 上限限制单个文件进入内存的规模。
- `readFile()` 接收同一个取消信号。
- NUL 字节是二进制文件的实用判断，不是完整格式识别。

程序随后逐行执行正则：

```ts
const match = expression.exec(line);
if (!match) continue;

matches.push(
  `${path}:${index + 1}:${(match.index ?? 0) + 1}: ${shortenLine(line)}`,
);
```

数组下标和 `match.index` 从 0 开始，源码位置从 1 开始，所以两者都加 1。JavaScript 的列索引按 UTF-16 code unit 计算；匹配位置前含有 emoji 时，它可能和编辑器显示列不同。本节返回的是可靠的行定位和近似列定位，不是语言服务器的语义位置。

当前实现一行只返回第一处匹配。同一行出现三次目标文本，也只生成一条结果。这符合“先找到值得读取的行”这一目标，但不适合精确统计全部出现次数。

### 5. 三种上限保护三种不同资源

| 上限 | 当前值 | 控制什么 | 没有控制什么 |
| --- | ---: | --- | --- |
| 候选文件 | 500 | 进入内容读取阶段的文件数 | glob 遍历耗时 |
| 单文件大小 | 1 MiB | 单次读入内存的数据量 | 正则执行时间 |
| 匹配结果 | 100 | 进入模型上下文的结果条数 | 已经扫描的文件成本 |
| 单行正文 | 前 300 个原字符 | 单条消息大小 | 原文件行长度 |

结果上限同样使用“多看一项”的判断：只有观察到第 101 个匹配，程序才返回前 100 项并标记截断。恰好 100 项不能推断还有更多。

文件数和结果数上限不能阻止病态正则。`RegExp.exec()` 是同步调用；如果它发生灾难性回溯，JavaScript 事件循环在返回前无法检查 `AbortSignal`。这正是当前后端与生产搜索之间最重要的差距。

### 6. 系统 `grep` 与 `rg`

本节先用 Node.js 讲清内容搜索的核心流程；系统 `grep` 和 `rg` 的进程调用将在第 07 章“执行测试并读取结果”中统一实现。

### 7. 终端过程怎样对应真实控制流

运行时可能看到：

```text
模型 > 第 1 次决策：读取当前消息并选择下一步。
工具 > 第 1 步：grep 开始。
工具 > 第 1 步：grep 完成，结果已加入当前回合。
模型 > 第 2 次决策：读取当前消息并选择下一步。
Agent > createModel 位于 src/models/client.ts:41。
```

`工具完成`不表示用户任务已经完成，只表示本地搜索结果已经加入 `turn`。第二次模型调用可能直接回答，也可能继续请求 `read_file`。Agent Loop 负责“是否继续”，`grepTool()` 只负责生成位置证据。

如果正则无效，过程会变成：

```text
工具 > 第 1 步：grep 开始。
工具 > 第 1 步：grep 失败，错误已加入当前回合。
模型 > 第 2 次决策：读取当前消息并选择下一步。
```

进度事件不会打印 query、glob、调用 ID 或匹配结果，只用本地步骤号和已注册工具名说明控制流。因此即使模型参数包含换行、终端控制字符或敏感文本，也不会直接进入进度日志。这条失败记录说明 `ToolError` 已成为模型可修正的环境反馈，而不是整个进程的崩溃。

## 动手构建

本节只扩展工具层：

| 文件 | 作用 |
| --- | --- |
| `src/tools/grep.ts` | 校验 query 和 glob，生成有界位置结果 |
| `src/tools/registry.ts` | 注册 `grep` |
| `src/config/load-config.ts` | 告诉模型三个只读工具的分工 |

04.1 已经建立的进度回调保持不变。完整实现位于[本节源码](src/)。

在仓库根目录执行：

```bash
npm run lesson:04.2
```

```bash
hello-my-agent --prompt "请找到 createModel 的定义，只告诉我文件和行号。"
```

你应该先看到模型决策、`grep` 开始、`grep` 完成，再看到最终回答。如果模型先调用 `glob`，终端会额外显示一轮；这说明模型根据当前证据动态选择工具，而不是程序写死了固定顺序。

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

答案：文件名只能缩小到文件级。行号可以直接成为下一次 `read_file` 的 `offset`；匹配文本帮助模型判断它命中的是定义、调用、注释还是字符串。列号用于更精确地引用位置，但当前 UTF-16 计算仍不是编辑器显示宽度。

## 接下来

`grep` 已经把语义目标变成真实位置，但单独一行通常不足以解释函数的分支和返回值。[04.3](../03-chunked-reading/README.md) 将把位置变成可续读的源码窗口，并解释为什么流式读取仍不是随机访问。
