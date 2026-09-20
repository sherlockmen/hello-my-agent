# 04.3 把代码位置变成上下文

[上一节：把文本目标变成代码位置](../02-content-search/README.md) · [第四章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

**本节只解决一个核心问题：`grep` 给出命中位置后，Agent 怎样取得足够推理、又不会挤满上下文的源码片段？**

## 问题：匹配行不是推理上下文

上一节可能返回：

```text
chapter-04-code-search/03-chunked-reading/src/models/client.ts:59:17: export function createModel(config: Config): Model {
```

这一行证明目标位于第 59 行，却没有函数体、分支和返回值。第三章的 `read_file(path)` 会读取整个小文件；文件变大后，完整读取会把与当前任务无关的文本一起放进 `turn`，后续每次模型调用还会再次携带它。

核心认识是：**读取工具不是“把文件交给模型”，而是为当前决策提供一个可续读的上下文窗口。**

## 解决方案

把 `read_file` 的参数扩展为：

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
```

## 工作原理

本节没有增加新的循环，也没有规定模型必须按照固定顺序调用工具。它只改变 `read_file` 的读取方式：模型不再只能读取整个文件，而是可以指定从哪一行开始、最多读取多少行。

### 1. `grep` 提供位置，`read_file` 提供上下文

假设 `grep` 返回：

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

两者来自同一次工具执行。界面不需要解析源码文本，模型也不需要接收专门为界面准备的中文过程说明。后续接入 TUI 时，TUI 继续读取同一份 `metadata`，不需要修改 `read_file` 或 Agent Loop。

### 4. 信息不足时，Agent Loop 怎样继续

如果第 50—109 行已经包含完整函数，模型可以直接回答。如果函数还没有结束，模型会看到 `hasMore` 对应的续读提示，再发出一次工具请求：

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

因此，分段读取不是把一个大文件自动切成多段全部发送。每读一段，模型都要判断现有证据是否已经足够；只有不足时才继续读取。这正是它比“直接读取整个文件”更节省上下文的原因。

### 实现边界

当前实现用三条限制控制最坏输出：每次最多返回 400 行、每行最多保留 1000 个字符、只处理不超过 10 MiB 的普通文件。它还会拒绝项目外路径和 `.env` 文件。

两次 `read_file` 调用之间，文件可能被编辑，因此续读依赖“文件在两次调用之间没有变化”。第 06 章实现文件修改时会加入外部变化检查；本节只解决如何取得有界的只读源码上下文。

## 动手构建

本节只改变分段读取相关代码：

| 文件 | 作用 |
| --- | --- |
| `src/tools/read-file.ts` | 校验 `offset`/`limit`，流式返回带行号片段 |
| `src/tools/types.ts` | 给 `read_file` 元数据增加实际行号范围和续读状态 |
| `src/ui/teaching-trace.ts` | 根据新 Schema 与元数据显示读取参数和行号范围 |
| `src/config/load-config.ts` | 提醒模型根据搜索位置分段读取 |

`glob`、`grep`、注册表、`AgentEvent` 和 Agent Loop 保持上一节契约；只有工具结果类型与界面消费者适配分段读取字段。完整实现位于[本节源码](src/)。

在仓库根目录执行：

```bash
npm run lesson:04.3
```

```bash
hello-my-agent --prompt "找到 createModel 的定义，读取函数附近代码并解释它返回什么。"
```

你应该看到 `grep -> read_file -> 最终回答` 对应的过程记录。模型如果先调用 `glob`，会多一轮文件发现；程序没有把工具顺序写死。

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

请求超出文件范围的位置：

```text
read_file({
  "path": "src/core.ts",
  "offset": 99999,
  "limit": 20
})
```

工具返回 `ToolError`，Agent Loop 把错误加入当前 `turn`。模型可以重新使用 `grep` 获取位置，或向你说明文件没有那么多行。

### 小练习

`grep` 返回目标位于第 120 行。你希望同时看到前面的注释和后面的函数体，可以请求：

```json
{
  "path": "src/example.ts",
  "offset": 110,
  "limit": 50
}
```

这会覆盖目标前 10 行和后续 39 行。如果结果提示还有内容，下一次把 `offset` 设为 160。上下文窗口大小由模型根据任务调整，本地程序只保证范围合法且输出受限。

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

一次任务可能经过 `glob → grep → read_file → 最终回答`，也可能跳过不需要的工具；顺序由模型根据工具结果决定。核心循环只产生结构化事件，当前终端和未来 TUI 可以各自显示同一执行过程。Agent 目前只有只读工具；下一章将在加入文件写入和命令执行之前，先建立 `allow`、`ask`、`deny` 权限决策以及需要用户确认的统一入口。
