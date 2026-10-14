# 第 04 章：让 Agent 找到代码

[全书目录](../README.md) · [04.1 控制文件搜索范围](01-file-discovery/README.md) · [04.2 把文本目标变成代码位置](02-content-search/README.md) · [04.3 把代码位置变成上下文](03-chunked-reading/README.md) · [练习与答案](EXERCISES.md)

第三章结束时，模型只要知道文件路径，就能请求 `read_file`，读到内容以后再回答。但平时使用 Coding Agent，我们往往只会说“找一下模型在哪初始化”，不会先替它查好文件。

这一章，我们让 Agent 自己完成查找。模型先根据目标选择搜索方式，本地工具返回真实的路径或匹配行，模型再决定读哪一段。终端里熟悉的“查找文件”“搜索代码”“读取文件”，就是这些请求和结果在来回传递。

## 为什么 `read_file` 还不够

第三章已经实现：模型知道准确路径时，可以调用 `read_file` 读取文件。但真实任务通常只有语义目标：

```text
找到 createModel 的定义，解释它怎样选择模型服务。
```

这个要求没有给出路径和行号。要回答它，模型需要逐渐弄清楚三件事：相关文件在哪里，目标出现在哪一行，以及周围代码是怎样工作的。三个工具分别帮助它取得这些信息：

```text
文件范围未知          目标位置未知             上下文不足
     |                     |                      |
     v                     v                      v
 glob(pattern)   ->   grep(query, glob)   ->   read_file(path, offset, limit)
     |                     |                      |
候选路径列表          path:line:column        带行号的源码窗口
```

这样做能减少无关内容。只需要寻找路径时，不必读取正文；只需要定位函数时，不必把几百个文件全部交给模型；找到函数后，再读取附近的代码。每一步返回的内容，都要帮助模型决定下一步去哪里看。

## 三个小节各解决一个问题

| 小节 | 核心问题 | 学完后应理解的原理 |
| --- | --- | --- |
| [04.1](01-file-discovery/README.md) | 不知道准确路径，怎样先找文件？ | 用路径模式匹配真实文件，并跳过无关目录 |
| [04.2](02-content-search/README.md) | 文件很多，怎样定位想找的内容？ | 在本地搜索正文，返回路径、行号和匹配行 |
| [04.3](03-chunked-reading/README.md) | 有了行号，怎样读到足够的上下文？ | 用 `offset + limit` 选择一段，不够时再继续读 |

这些工具可以接着使用，但程序没有写死必须先 `glob`、再 `grep`。模型已经知道文件范围时，可以直接搜索内容；已经知道路径和行号时，也可以直接读取。第三章的 Agent Loop 继续负责执行请求、回传结果和判断何时结束。

## 完整控制链

例如，完成上面的要求可能经历四次模型调用：

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

这条链继续沿用第三章的处理规则：

- 参数、正则或文件检查产生 `ToolError` 时，Agent Loop 把失败说明发回模型，模型可以修正请求或解释原因；`grep` 中无法读取的单个候选文件会跳过。
- 模型给出最终回答时，Agent Loop 才把本轮用户消息、工具请求、工具结果和回答一起提交到 `history`。
- 程序发现取消、遇到意外异常或达到模型请求上限时，停止本轮，尚未完成的 `turn` 不进入 `history`。

这里有两个不同的循环：

- **模型决策循环**由 `agentLoop()` 控制。它判断模型返回的是最终回答还是工具请求。
- **文件处理循环**由具体工具控制。例如 `glob` 遍历目录，`grep` 遍历候选文件，`read_file` 遍历文本行。

这两个循环的工作不同。模型决定要找什么，本地工具逐个检查文件和文本；检查结果回到模型后，它才获得这一步的新信息。把两者分开，也让搜索实现可以继续升级：第 07 章会把内容搜索迁到受控的系统 `rg`，主循环仍使用工具请求和工具结果。

## 为什么终端现在显示过程

第三章只显示最终回答，读者很难把屏幕上的停顿对应到 Agent Loop 的哪一步。直接在 `agentLoop()` 里写 `console.log()` 虽然能看到过程，却会让核心依赖当前终端格式；第 09 章增加 JSONL、第 10 章接入 TUI 时还要再次修改循环。

我们先让主循环在开始请求模型、收到响应、开始执行工具和得到结果时，发出一条事件。事件就是一份描述当前步骤的数据，由终端把它写成可读的过程记录：

```text
Agent Loop ── AgentEvent ──┬── teaching-trace.ts ── 普通终端
                           ├── JSONL              第 09 章
                           └── Ink TUI            第 10 章
```

`agent/events.ts` 用 `AgentEvent` 定义这些数据。比如 `model_start` 表示开始一次模型请求，`tool_finish` 表示工具已经返回。这些类型记录步骤、数量和结果，不规定终端应该怎样排版：

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

模型需要源码来理解问题，终端通常只需要显示“找到多少项”“读取了哪几行”。为了让终端不必从源码字符串中猜这些信息，工具一次返回两个值：

```ts
export type ToolExecutionResult = {
  content: string;              // 加入消息链，交给模型
  metadata: ToolResultMetadata; // 路径数、位置、行号范围等结构化事实
};
```

例如 `grep` 的 `content` 含有匹配行，帮助模型理解代码；它的 `metadata.locations` 只保存 `path`、`line` 和 `column`，界面可以直接取出位置，再经过显示筛选，而不必解析源码字符串。`registry.ts` 只登记和执行工具，不再负责生成终端摘要。

`ui/teaching-trace.ts` 是本章的文本消费者。它根据工具 Schema 选择允许显示的参数字段，执行单行化、限长和敏感值隐藏，再生成下面的中文记录。`>` 表示组件收到输入或开始执行，`<` 表示组件已经返回。

下面是一段说明执行顺序的示例，路径数量、行号和回答只用于演示，不是当前源码的实测记录。实际运行时，工具顺序由模型决定，路径和行号以本次工具结果为准：

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

这个任务要求解释函数怎样选择服务，仅知道函数名所在的行还不够。模型还要取得函数体里的选择分支，才能据此回答。最终回答出现后，Agent Loop 才把整个 `turn` 加入历史。

这段输出可以直接回答四个问题：

- `模型 >`：这次模型调用收到了哪些新增信息。
- `模型 <`：模型返回最终回答，还是返回一个或多个工具请求。
- `工具 >`：本地程序实际执行哪个工具以及哪些安全参数。
- `工具 <`：工具得到什么规模的结果，以及结果接下来交给谁。

观察者不参与模型选择、工具执行和历史提交。核心使用 `structuredClone()` 发送事件快照，所以观察者修改工具名或参数也不会改变随后执行的真实请求；终端显示函数抛出异常同样不能把成功执行改写成失败。事件对象保留核心运行所需的真实事实，因此不能未经筛选直接写日志；普通终端的安全处理集中在 `teaching-trace.ts`。第 09 章会在这个接口上扩展 JSONL、事件送达和输出约定，第 10 章再接入 Ink TUI。本章只有同步观察者和普通终端记录，这些后续输出方式还没有实现。

## 学完以后，我们能解释什么

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
| 两次分段读取可能看到不同版本 | 本章没有保存一份固定文件快照 | 第 06 章会检查写入前的变化，第 14 章再讲检查点；本章续读仍需注意文件是否变化 |
| 工具调用串行执行 | 并发需要队列、资源上限和失败汇总 | 第 27 章 |

从 [04.1](01-file-discovery/README.md) 开始，先让模型拿到项目里真实存在的文件路径。

完成三个小节后，继续进入[第 05 章：工具执行之前，先检查权限](../chapter-05-permission-gate/README.md)，在每次工具执行前，决定是否直接允许、需要确认或拒绝。
