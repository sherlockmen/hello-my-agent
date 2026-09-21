# 第 04 章：让 Agent 找到代码

[全书目录](../README.md) · [04.1 控制文件搜索范围](01-file-discovery/README.md) · [04.2 把文本目标变成代码位置](02-content-search/README.md) · [04.3 把代码位置变成上下文](03-chunked-reading/README.md) · [练习与答案](EXERCISES.md)

**本章只回答一个问题：Coding Agent 怎样从一句自然语言要求，逐步取得足以支持回答的真实代码证据？**

你已经使用过 Coding Agent，也见过它显示“Searching”“Reading file”一类状态。本章不再介绍这些功能是什么，而是拆开它们内部的控制链：模型选择下一步，本地程序取得证据，Agent Loop 把证据送回模型，模型再决定是否继续。

## 为什么 `read_file` 还不够

第三章已经实现：模型知道准确路径时，可以调用 `read_file` 读取文件。但真实任务通常只有语义目标：

```text
找到 createModel 的定义，解释它怎样选择模型服务。
```

这句话没有路径、行号或读取范围。Agent 必须依次消除三种不确定性：

```text
文件范围未知          目标位置未知             上下文不足
     |                     |                      |
     v                     v                      v
 glob(pattern)   ->   grep(query, glob)   ->   read_file(path, offset, limit)
     |                     |                      |
候选路径列表          path:line:column        带行号的源码窗口
```

这条链的核心不是“三个工具”，而是**逐步收窄证据范围**：先确定搜索空间，再定位命中点，最后只把命中点附近的必要上下文交给模型。

## 三个小节各解决一个问题

| 小节 | 核心问题 | 学完后应理解的原理 |
| --- | --- | --- |
| [04.1](01-file-discovery/README.md) | Agent 怎样得到可信、有限的候选路径？ | 项目根、glob、忽略规则和返回上限共同定义搜索空间 |
| [04.2](02-content-search/README.md) | Agent 怎样把文本目标变成可引用的代码位置？ | `grep` 工具契约与具体搜索实现彼此分离 |
| [04.3](03-chunked-reading/README.md) | Agent 怎样围绕命中点取得足够而不过量的上下文？ | `offset + limit` 把文件读取变成可续读的上下文窗口 |

上一节的输出会直接成为下一节的输入。每节只增加一层能力，第三章的 Agent Loop、调用 ID、失败反馈和历史提交规则不变。

## 完整控制链

一次真实运行可能经历四次模型调用：

```text
用户目标
  |
  v
模型调用 #1：选择 glob，并生成 pattern
  |
  v
本地 glob：遍历项目，返回候选路径
  |
  v
模型调用 #2：读取路径列表，选择 grep，并生成 query + glob
  |
  v
本地 grep：读取候选文件，返回 path:line:column
  |
  v
模型调用 #3：选择 read_file，并生成 path + offset + limit
  |
  v
本地 read_file：返回带行号的源码窗口
  |
  v
模型调用 #4：证据足够，生成最终回答
  |
  v
Agent Loop 一次性把完整 turn 提交到 history
```

这条链有三种结束方式：

- 文件参数、正则或读取失败时，Agent Loop 把错误作为工具结果交回模型，模型可以修正请求或解释原因。
- 模型给出最终回答时，Agent Loop 才把本轮用户消息、工具请求、工具结果和回答一起提交到 `history`。
- 用户取消、程序出现意外异常或达到模型请求上限时，本轮立即停止，尚未完成的 `turn` 不进入 `history`。

这里有两个不同的循环：

- **模型决策循环**由 `agentLoop()` 控制。它判断模型返回的是最终回答还是工具请求。
- **文件处理循环**由具体工具控制。例如 `glob` 遍历目录，`grep` 遍历候选文件，`read_file` 遍历文本行。

模型不访问磁盘，也不直接执行正则。它只生成结构化请求。本地 TypeScript 程序校验请求并访问真实环境，工具结果才是模型下一次决策可以依赖的事实。

## 为什么终端现在显示过程

第三章只显示最终回答，读者很难把屏幕上的停顿对应到 Agent Loop 的哪一步。直接在 `agentLoop()` 里写 `console.log()` 虽然能看到过程，却会让核心依赖当前终端格式；第 09 章增加 JSONL、第 10 章接入 TUI 时还要再次修改循环。

本章先建立一个可以继续演进的观察边界：

```text
Agent Loop ── AgentEvent ──┬── teaching-trace.ts ── 普通终端
                           ├── JSONL              第 09 章
                           └── Ink TUI            第 10 章
```

`agent/events.ts` 定义生命周期事件。事件只描述“发生了什么”，不包含中文排版规则：

```ts
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
  | { type: "tool_finish"; sequence: number; call: ToolCall; outcome: "error"; error: string };
```

工具也不再让界面反向解析给模型的文本，而是一次返回两个用途不同的值：

```ts
export type ToolExecutionResult = {
  content: string;              // 加入消息链，交给模型
  metadata: ToolResultMetadata; // 路径数、位置、行号范围等结构化事实
};
```

例如 `grep` 的 `content` 含有匹配行，帮助模型理解代码；它的 `metadata` 只含 `path`、`line` 和 `column`，界面可以安全显示位置而不必从源码字符串中猜字段。`registry.ts` 只登记和执行工具，不再负责生成终端摘要。

`ui/teaching-trace.ts` 是本章的文本消费者。它根据工具 Schema 选择允许显示的参数字段，执行单行化、限长和敏感值隐藏，再生成下面的中文记录。`>` 表示组件收到输入或开始执行，`<` 表示组件已经返回。

下面展示一次可能的真实路径。工具顺序由模型根据已有证据决定，并不是 Agent Loop 写死的：

```text
模型 > 第 1 次决策
  收到：新增用户问题「找到 createModel 的定义，解释它怎样选择模型服务」；Agent Loop 消息链共 1 条。
模型 < 第 1 次决策
  返回：1 个工具请求。
工具 > 第 1 步：glob
  执行：pattern="chapter-04-code-search/03-chunked-reading/src/**/*.ts"。
工具 < 第 1 步：glob 完成
  返回：11 个路径；示例：chapter-04-code-search/03-chunked-reading/src/agent/agent-loop.ts，chapter-04-code-search/03-chunked-reading/src/cli.ts。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 2 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 3 条。
模型 < 第 2 次决策
  返回：1 个工具请求。
工具 > 第 2 步：grep
  执行：query="createModel"，glob="chapter-04-code-search/03-chunked-reading/src/**/*.ts"。
工具 < 第 2 步：grep 完成
  返回：1 个匹配位置；示例：chapter-04-code-search/03-chunked-reading/src/models/client.ts:59:17。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 3 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 5 条。
模型 < 第 3 次决策
  返回：1 个工具请求。
工具 > 第 3 步：read_file
  执行：path="chapter-04-code-search/03-chunked-reading/src/models/client.ts"，offset=50，limit=60。
工具 < 第 3 步：read_file 完成
  返回：第 50—109 行源码；包含 createModel 的协议选择分支。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 4 次决策
  收到：新增 1 条工具结果；Agent Loop 消息链共 7 条。
模型 < 第 4 次决策
  返回：最终回答，交给终端显示。
Agent > createModel 位于第 59 行。它根据 config.provider 选择 OpenAI 或 Anthropic 客户端……
```

`grep` 返回位置时，用户任务还没有完成；模型必须读取函数体，取得足以解释选择逻辑的源码后才能回答。最终回答出现后，Agent Loop 才提交完整 `turn`。

这段输出可以直接回答四个问题：

- `模型 >`：这次模型调用收到了哪些新增信息。
- `模型 <`：模型返回最终回答，还是返回一个或多个工具请求。
- `工具 >`：本地程序实际执行哪个工具以及哪些安全参数。
- `工具 <`：工具得到什么规模的结果，以及结果接下来交给谁。

观察者不参与模型选择、工具执行和历史提交。核心使用 `structuredClone()` 发送事件快照，所以观察者修改工具名或参数也不会改变随后执行的真实请求；终端显示函数抛出异常同样不能把成功执行改写成失败。事件对象保留核心运行所需的真实事实，因此不能未经筛选直接写日志；普通终端的安全处理集中在 `teaching-trace.ts`。第 09 章将在同一边界上增加 JSONL、事件送达和输出通道规则，第 10 章让 Ink TUI 订阅同一事件，而不再修改 Agent Loop。

## 本章完成后你应能解释

1. 为什么 Coding Agent 通常先建立候选范围，再搜索内容，最后读取上下文。
2. 为什么模型生成的工具请求不能直接当作可信的本地操作。
3. 为什么结果数量上限、扫描成本上限和执行时间上限不是同一件事。
4. 为什么更换搜索实现不需要重写 Agent Loop。
5. 为什么过程输出应来自核心的结构化状态，而不是从最终回答文字中猜测。

## 当前边界与后续章节

| 当前限制 | 为什么本章不解决 | 后续位置 |
| --- | --- | --- |
| 事件观察者目前同步调用 | 异步送达、背压和 JSONL 需要完整消费者 | 第 09 章 |
| 文件工具全部只读 | 写入前必须先建立权限决策 | 第 05—06 章 |
| 分段读取没有文件快照 | 需要写入冲突与检查点机制 | 第 06、14 章 |
| 工具调用串行执行 | 并发需要队列、资源上限和失败汇总 | 第 27 章 |

从 [04.1](01-file-discovery/README.md) 开始，先解决证据链的第一步：怎样定义并控制 Agent 的文件搜索空间。

完成三个小节后，继续进入[第 05 章：在执行前作出权限决定](../chapter-05-permission-gate/README.md)，把模型的工具请求与真实执行隔开。
