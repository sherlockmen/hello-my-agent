# 04.3 把代码位置变成上下文

[上一节：把文本目标变成代码位置](../02-content-search/README.md) · [第四章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

**本节只解决一个核心问题：`grep` 给出命中位置后，Agent 怎样取得足够推理、又不会挤满上下文的源码片段？**

## 问题：匹配行不是推理上下文

上一节可能返回：

```text
src/models/client.ts:41:17: export function createModel(config: Config): Model {
```

这一行证明目标位于第 41 行，却没有函数体、分支和返回值。第三章的 `read_file(path)` 会读取整个小文件；文件变大后，完整读取会把与当前任务无关的文本一起放进 `turn`，后续每次模型调用还会再次携带它。

核心认识是：**读取工具不是“把文件交给模型”，而是为当前决策提供一个可续读的上下文窗口。**

## 解决方案

把 `read_file` 的参数扩展为：

```json
{
  "path": "src/models/client.ts",
  "offset": 41,
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

### 1. `offset + limit` 是面向模型的游标

假设文件内容为：

```text
1: import { readFile } from "node:fs/promises";
2:
3: export function target() {
4:   return "answer";
5: }
6:
7: export function other() {}
```

模型请求：

```json
{ "path": "src/example.ts", "offset": 3, "limit": 2 }
```

循环状态如下：

| 当前行 | 动作 | 已保留内容 |
| ---: | --- | --- |
| 1、2 | 小于 offset，跳过 | 空 |
| 3 | 保存 | 第 3 行 |
| 4 | 保存 | 第 3、4 行 |
| 5 | 不返回，只证明还有后文 | 第 3、4 行 |

结果：

```text
3: export function target() {
4:   return "answer";
[显示第 3-4 行；后面还有内容，请把 offset 设为 5 继续]
```

如果文件恰好在第 4 行结束，循环看不到额外一行，状态应是“已到文件末尾”。因此 `read_file`、`grep` 和 `glob` 都使用同一个判断原则：**只有实际观察到上限之外的一项，才能声称结果被截断。**

### 2. 流式读取减少内存，不提供随机行访问

实现使用 `createReadStream()` 和 `readline`：

```ts
const stream = createReadStream(filePath, {
  encoding: "utf8",
  signal,
});
const lines = createInterface({
  input: stream,
  crlfDelay: Infinity,
});

for await (const line of lines) {
  // 逐行处理
}
```

程序不再先创建包含整个文件内容的字符串，也不会把整个文件发送给模型。但普通文本文件没有行号索引，请求 `offset=5000` 时，程序仍要从文件开头经过前 4999 行。

因此当前成本近似为：

```text
扫描成本：O(offset + limit)
返回成本：O(limit)
```

流式读取优化的是常驻内存和模型上下文，不是随机访问速度。如果未来需要频繁跳转超大文件，需要额外建立行偏移索引或使用语言服务；本节没有提前加入这种复杂度。

### 3. 行数上限之外为什么还要限制单行

`limit=40` 只能限制行数。压缩 JSON、压缩 JavaScript 或生成文件可能把几十万个字符放在一行中。

```ts
function shortenLine(line: string): string {
  return line.length <= 1000
    ? line
    : `${line.slice(0, 1000)}… [本行已截断]`;
}
```

三种上限分别保护不同资源：

| 上限 | 当前值 | 保护对象 |
| --- | ---: | --- |
| 单次返回行数 | 400 | 模型上下文中的行数量 |
| 单行正文 | 前 1000 个原字符 | 单条异常长行的消息大小 |
| 可扫描文件 | 10 MiB | 本地最坏扫描规模 |

10 MiB 不代表工具会把 10 MiB 全部发给模型；`limit` 和单行截断决定实际输出。反过来，`limit=1` 也不代表只读取一个磁盘数据块，因为程序仍要走到 `offset`。

### 4. 路径检查为什么只是“检查时边界”

参数合法后，`resolveReadableFile()` 会：

```text
拒绝 .env 系列名称
  -> realpath(projectRoot)
  -> realpath(target)
  -> 检查此刻真实目标仍位于项目内
  -> 再检查真实文件名
  -> stat：普通文件且 <= 10 MiB
```

如果符号链接在检查前已经指向项目外，`realpath()` 能发现并拒绝它。但函数返回的是路径字符串，后面的 `createReadStream()` 还要再次按路径打开文件。

```text
realpath / stat 检查完成
          |
          | 另一个进程可能替换路径
          v
createReadStream 真正打开文件
```

这就是 TOCTOU：检查时间和使用时间之间状态发生变化。当前实现假设使用者控制本地工作区，不能抵抗恶意进程在两步之间替换路径，也不是文件系统沙箱。重复调用一次 `realpath()` 只会产生新的检查窗口。

更强隔离需要操作系统沙箱，或围绕同一个已经打开的文件描述符完成验证和读取。本章测试只能证明“检查前就已存在的越界符号链接会被拒绝”，不能证明竞态已经消失。

### 5. 两次读取为什么可能不属于同一文件版本

模型可能先读：

```json
{ "path": "src/a.ts", "offset": 1, "limit": 100 }
```

看到续读提示后再读：

```json
{ "path": "src/a.ts", "offset": 101, "limit": 100 }
```

如果外部编辑器在两次调用之间插入 20 行，第二次的第 101 行已经不是第一次结果的后续位置。当前工具没有锁、内容哈希或文件快照，所以“续读”只在文件没有变化的前提下成立。

第 06 章写入文件时会在修改前检查外部变化；第 14 章再引入检查点。这里先把一致性假设写清楚，不伪装成版本化读取。

### 6. 位置证据怎样完成一次 Agent Loop

一次完整过程可能显示：

```text
模型 > 第 1 次决策：读取当前消息并选择下一步。
工具 > 第 1 步：grep 开始。
工具 > 第 1 步：grep 完成，结果已加入当前回合。
模型 > 第 2 次决策：读取当前消息并选择下一步。
工具 > 第 2 步：read_file 开始。
工具 > 第 2 步：read_file 完成，结果已加入当前回合。
模型 > 第 3 次决策：读取当前消息并选择下一步。
Agent > createModel 根据 provider 创建对应客户端……
```

数据在当前回合中的形状是：

```text
user       原始目标
assistant  grep 请求，id=call_1
 tool      位置结果，toolCallId=call_1
assistant  read_file 请求，id=call_2
 tool      源码窗口，toolCallId=call_2
assistant  最终回答
```

只有最后出现最终回答，Agent Loop 才把整段 `turn` 提交到 `history`。如果取消、发生系统异常或八次模型调用后仍没有最终回答，这条未完成证据链不会污染后续会话。

工具进度只向终端说明控制流，没有把工具参数、调用 ID 或结果全文重复打印一遍。步骤号由 Agent Loop 生成，显示名称来自本地注册表；原始数据仍通过内部工具消息传给模型，避免不可信内容直接进入日志，也避免终端和模型历史形成两套状态来源。

## 动手构建

本节只改变分段读取相关代码：

| 文件 | 作用 |
| --- | --- |
| `src/tools/read-file.ts` | 校验 `offset`/`limit`，流式返回带行号片段 |
| `src/config/load-config.ts` | 提醒模型根据搜索位置分段读取 |

`glob`、`grep`、Agent Loop 和进度回调保持上一节契约。完整实现位于[本节源码](src/)。

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

## 接下来

Agent 已经能建立“候选路径 → 匹配位置 → 源码窗口”的只读证据链。下一章加入 allow、ask、deny 权限决策和终端审批；在文件写入与命令执行出现之前，先建立所有副作用都必须经过的统一入口。
