# 08.1 让回答逐段显示

[上一章：执行测试并读取结果](../../chapter-07-command-feedback/README.md) · [第 08 章首页](../README.md) · [本节源码](src/) · [下一节：收齐工具参数，再执行](../02-complete-tool-calls/README.md)

## 问题：模型还在回答，终端为什么一直没有文字

上一章中，Agent 已经能运行测试并读懂结果。假设测试结束后，模型要解释失败原因和下一步修改，它可能需要写好几段话。我们现在会等接口返回完整结果，再一次性把这些文字打印出来。回答越长，看到第一句话之前的等待就越明显。

但服务端通常不需要等整篇文字都生成完，才把内容发出来。它可以在生成过程中持续发送新增内容。我们希望终端尽早显示这些文字，让用户一边等后面的回答，一边阅读前面的说明。

这叫**流式输出**：同一个响应会分多次到达，接收方每收到一部分，就可以处理这一部分。它改善的是何时开始看见内容，不保证模型更快完成整次生成，也不会缩短本地测试的执行时间。

## 解决方案：收到文字就显示，结束后仍拿到完整结果

本节先把 OpenAI 兼容接口换成流式请求。模型适配层收到新增文字时，通过一个可选回调通知 Agent Loop；核心把它转成已有的 `AgentEvent`，终端只负责显示。整次响应收完以后，模型适配层仍然返回原来的 `ModelResult`，其中包含完整文本、工具请求与用量。

```text
同一次模型响应
    ├─ 新增文字到达 → 通知终端 → 先显示给用户
    └─ 整次响应结束 → 得到完整 ModelResult → 主循环继续判断
```

这样，流式显示接在已有流程旁边，工具执行仍然等 `generate()` 完成。模型说“我准备运行测试”时，终端可以先显示这句话；只有最终结果里确实包含工具请求，主循环才会继续检查权限并请求批准。

Anthropic 在本节仍返回完整响应，终端会一次显示它的文字。[08.2](../02-complete-tool-calls/README.md)再接入 Anthropic 流，并进一步检查工具参数和响应结束原因。我们先用一种接口把文字增量的用途讲清楚，再处理工具请求带来的完整性问题。

## 工作原理

### 生成、传输和显示是三件事

我们可以把完整回答想成“测试失败，因为 add 返回了减法结果”。模型生成这句话时，内部会不断选择后续 token。token 是模型处理文本的单位，它可能对应一个字、一部分单词或其他文本片段，和终端上的一行文字没有固定关系。

服务端通过 HTTP 把生成结果送回来。本节使用的流式接口采用 **SSE**（Server-Sent Events，服务端发送事件）：连接保持打开，服务端在其中连续发送事件，每个事件携带这一时刻新增的信息。SDK 会处理网络读取、事件分隔和 JSON 解码，再把我们需要的字段交出来。

因此，程序不能把“一次网络读取”“一个 SSE 事件”“一个 token”看成同一件事。网络可能一次带来几个事件，也可能把一个事件分成几次读取；一个文字事件也可能包含一小段文本。我们使用 SDK 的文字事件，不自己按网络块切 JSON。[OpenAI Chat 流式接口](https://developers.openai.com/api/reference/resources/chat)定义了这些响应字段。

下面只表示解码后的文字增量，不是原始网络字节：

| 收到的次序 | 本次新增文字 | 终端累计显示 |
| --- | --- | --- |
| 1 | `测试失败，` | `测试失败，` |
| 2 | `因为 add` | `测试失败，因为 add` |
| 3 | ` 返回了减法结果。` | `测试失败，因为 add 返回了减法结果。` |

这里的**增量**也叫 `delta`，表示“相对于之前，又增加了什么”。终端每次只追加中间这一列。如果把累计文本每次都追加一次，就会得到“测试失败，测试失败，因为 add……”这样的重复内容。

### 展示中的片段，与可继续执行的结果各有用途

文字增量适合立即展示，因为读到半句话不会启动本地操作。完整 `ModelResult` 则用于主循环判断：模型是继续请求工具，还是已经给出最终回答？下一次模型请求应该带上哪些完整消息？

这两种用途可以同时存在。OpenAI SDK 的 `.stream()` 一边触发 `content.delta` 事件，一边聚合完整响应。`finalChatCompletion()` 等待这次响应完成，再交回聚合结果。我们不需要在终端再拼出一份“真正回答”，也不必让终端判断模型是否提出了工具请求。

模型接口只增加一个可选的 `onText` 回调，原来的 Promise 返回值继续保留。回调表示“这里有一段可以显示的文字”，返回值表示“本次模型调用已经完成，结果在这里”。没有回调的调用方仍能拿到完整结果。

对于工具参数，同样可能有增量，但它们不属于本节的文字显示入口。收到 `{"path":"demo/` 时，文件路径还没说完，既不能当成一条消息提交，也不能尝试执行。SDK 会继续收集这些内容；下一节专门讲怎样判断完整工具请求可以交给主循环。

### 同一份回答为什么不会打印两遍

此前终端只在 `agentLoop()` 返回以后调用 `printReply()`。现在回答可能已经通过文字事件显示完，如果继续无条件打印 `reply.text`，用户会看到一模一样的第二份回答。

终端因此要记住当前这次模型调用有没有显示过文字。收到第一段时打印 `Agent >`，后续增量接在同一段后面；模型调用结束时补上换行。最终显示用量时，已经流式显示的正文就不再重放。

这个状态要按**每次模型调用**重置。一轮用户任务可能先请求工具，再请求模型总结。第一次模型调用显示过“我先读测试”，不能据此跳过第二次调用的完整回答。对于本节仍非流式的 Anthropic，终端没有收到增量，就从完整结果补上文字。

终端输出用普通文本追加。Markdown 的 `**`、代码围栏等也会按原文出现；我们此时不重新排版尚未收完的代码块。后面的 TUI 章节再处理更丰富的显示。

### 显示是观察，不能成为批准

第四章已经把执行事件和终端显示分开了。本节沿用这个关系：模型适配层不直接操作终端，Agent Loop 通过文字事件报告新增内容，终端消费者负责打印。

所以，文字里即使出现“已获批准”，也只是一段模型输出，不会改变本地权限。工具仍走原有的注册表、参数校验、权限与审批。显示消费者的异常也不会替主循环增加或取消工具调用。

收到部分文字后断开连接，已经显示的内容留在屏幕上，但 `generate()` 不会因此返回一个伪造的成功结果。本节会把失败交给终端说明；[08.3](../03-cancel-and-continue/README.md)再完善中断后的历史与继续输入。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/models/client.ts](src/models/client.ts) | 增加可选文字回调，OpenAI 使用 SDK 流，完整结果与接收期限保留 |
| CHANGED | [src/agent/events.ts](src/agent/events.ts) | 在既有事件中增加文字增量 |
| CHANGED | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 将回调变成观察事件，继续等待完整模型结果 |
| CHANGED | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 文字片段不包装成普通步骤日志 |
| CHANGED | [src/ui/terminal.ts](src/ui/terminal.ts) | 逐段显示、补齐换行，避免最终回答重复打印 |

## 动手构建

从 07.3 及[第七章练习](../../chapter-07-command-feedback/EXERCISES.md)的完成代码开始，把完整 `src/` 复制到 `chapter-08-streaming-turns/01-text-stream/src/`。本节保留命令的 `timeout_ms`，并继续使用已经安装的 OpenAI 与 Anthropic SDK。

### 给模型接口增加文字回调

在 `models/client.ts` 中，把 `Model` 接口替换为：

```ts
export interface Model {
  // [CHANGED 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void): Promise<ModelResult>;
}
```

`onText` 是可选的第三个参数，调用方不传也仍能得到完整 `ModelResult`。接着把 `createModel()` 替换为下面的函数，让回调传进适配层，同时给整次请求设置接收期限：

```ts
/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：只暴露 generate 的 Model；创建对象时不发送请求，调用 generate 时才开始。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
 */
// [CHANGED 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // [CHANGED 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  return { async generate(messages, signal, onText) {
    const deadline = AbortSignal.timeout(60_000);
    try {
      return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText);
    } catch (error) {
      signal.throwIfAborted();
      if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
      throw error;
    }
  } };
}
```

`AbortSignal.any()` 把用户取消和 60 秒期限合在一起，任意一个发生，请求都要停止。错误处理仍先检查用户取消，让主动中断与响应超时有不同说明。这个期限包含已经开始返回文字后的时间，服务端持续发送片段也不能让一次请求无限等待。

### 让 SDK 一边发送文字事件，一边聚合结果

在同一个文件的 `requestResult()` 参数列表末尾增加 `onText?: (text: string) => void`，原来的 `signal` 参数和 `Promise<ModelResult>` 返回类型保留。

将函数里整个 `if (client instanceof OpenAI) { ... }` 分支替换为下面这一段。后面的 Anthropic 完整响应分支继续沿用：

```ts
  if (client instanceof OpenAI) {
    // [CHANGED 08.1] SDK 解析 SSE 并累积完整响应，content.delta 用来及时显示新文字。
    const stream = client.chat.completions.stream({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: toolDefinitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          // [CHANGED 08.1] 第 07 章练习的 timeout_ms 保持可选；本地仍会完整校验工具参数。
          parameters: tool.inputSchema, strict: false,
        },
      })),
      stream_options: { include_usage: true },
    }, { signal });
    stream.on("content.delta", ({ delta }) => onText?.(delta));
    const response = await stream.finalChatCompletion();
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments));
    // [NEW 08.1] 文字可能已经显示，结束原因不正常时仍不能执行工具或提交历史。
    if (choice.finish_reason !== (toolCalls.length ? "tool_calls" : "stop")) {
      throw new UserFacingError("模型响应未正常完成，已停止本轮；屏幕上的文字可能不完整。");
    }
    const text = choice.message.content ?? "";
    if (!text.trim() && toolCalls.length === 0) {
      throw new UserFacingError("接口既没有返回文本，也没有返回工具请求。");
    }
    return {
      text, toolCalls,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: false,
    };
  }
```

`content.delta` 只取本次新增的 `delta`。`finalChatCompletion()` 则继续等待完整结果，我们从那里读取工具请求和用量；本节没有调用 SDK 的 `runTools()`，SDK 不会替程序执行工具。

这里把服务端严格输出模式设为 `strict: false`，与第七章练习中可以省略的 `timeout_ms` 保持一致。本地工具的参数校验仍然照常执行，这个选项也不会改变权限和审批规则。`include_usage` 请求接口在流结束时报告用量；接口没有提供时，继续显示“未知”。

### 把文字片段接到现有事件

在 `agent/events.ts` 的 `AgentEvent` 联合类型开头增加一个分支，其余事件保留：

```ts
  | { type: "text_delta"; call: number; text: string }
```

`call` 标明这是当前回合的第几次模型调用，`text` 只包含本次新增文字。在 `agent/agent-loop.ts` 中，把原来的单行 `model.generate()` 调用替换为：

```ts
    const result = await model.generate([...history, ...turn], signal, (text) => {
      if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });
    });
```

回调只报告文字事件。后面的用量累计、完整结果判断和工具执行顺序全部保留；片段不会写入消息历史。

在 `ui/teaching-trace.ts` 的 `formatTeachingTrace()` 函数第一行加入：

```ts
  if (event.type === "text_delta") return [];
```

文字不经过普通步骤日志，否则每个片段都会多出标签和换行。下面由专门的回合显示器追加它。

### 让一轮显示共用同一个状态

在 `ui/terminal.ts` 的 `printProgress()` 后新增 `createTurnRenderer()`：

```ts
/**
 * 创建本轮专用的显示器，让连续文字和步骤记录按顺序出现。
 *
 * - 输入：本轮 AgentEvent；输出是 observe、finish 和 reply 三个显示入口。
 * - 显示片段：第一次 text_delta 写出 Agent 标签，后续片段直接追加；切到步骤或错误提示前补换行。
 * - 完整响应：某次模型决策没有发出片段时，model_finish 仍可显示完整文字。
 * - 避免重复：每次 model_start 重置是否显示过文字的记录，reply 根据最后一次决策决定是否再打印正文。
 * - 职责边界：这里只保存显示状态，不提交历史；已显示的片段也不能证明本轮已经成功。
 */
// [NEW 08.1] 每轮创建独立显示状态，结束时不会再重复打印已显示的回答。
export function createTurnRenderer() {
  let opened = false;
  let streamed = false;
  const finish = () => {
    if (opened) process.stdout.write("\n");
    opened = false;
  };
  const observe = (event: AgentEvent) => {
    if (event.type === "text_delta") {
      if (!opened) process.stdout.write(`${colorLabel("Agent", 35)} > `);
      opened = true;
      streamed = true;
      process.stdout.write(event.text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ""));
      return;
    }
    finish();
    if (event.type === "model_start") streamed = false;
    if (event.type === "model_finish" && !streamed && event.text) {
      console.log(`${colorLabel("Agent", 35)} > ${event.text}`);
      streamed = true;
    }
    printProgress(event);
  };
  return { observe, finish, reply: (reply: Reply) => { finish(); printReply(reply, !streamed); } };
}
```

`opened` 表示当前文字行还没收尾，`streamed` 表示本次模型调用已经显示过正文。`model_start` 会把后者重置，所以工具调用前说过的一句话不会影响工具结果回传后的新回答。显示器还会清理文字片段中的终端控制字符；它只改显示副本，不改变完整模型结果。

接着把文件末尾的 `printReply()` 替换为：

```ts
/**
 * 在本轮完成后显示尚未输出的回答，并补上用量信息。
 *
 * - 输入：统一 Reply，以及是否需要输出正文的 showText；默认显示正文。
 * - 输出：showText 为 false 时只打印用量与可选截断提示，避免重复已经逐段显示的回答。
 * - 关键原因：用量沿用接口报告值，未知值显示“未知”，不根据文本长度估算 token 或费用。
 * - 职责边界：只负责显示，不修改历史，也不再次调用模型。
 */
// [CHANGED 08.1] 文字已经逐段显示时，只补用量，不重复整段回答。
export function printReply(reply: Reply, showText = true): void {
  if (showText) console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
```

最后在同一个文件里接入显示器。下面每个位置都在现有函数内部，不新增第二次 Agent Loop 调用：

| 所在位置 | 修改 |
| --- | --- |
| `startTerminal()` 处理完本地命令、进入本轮 `try` 之前 | 新增 `const renderer = createTurnRenderer();` |
| `startTerminal()` 调用 `agentLoop()` 的观察者参数 | 把 `printProgress` 换成 `renderer.observe` |
| `startTerminal()` 成功后的 `printReply(reply)` | 换成 `renderer.reply(reply)` |
| `startTerminal()` 的本轮 `catch` 第一行 | 新增 `renderer.finish();`，避免错误提示接在半句话后面 |
| `runSinglePrompt()` 注册 `SIGINT`、进入 `try` 之前 | 新增 `const renderer = createTurnRenderer();` |
| `runSinglePrompt()` 调用 `agentLoop()` 的观察者参数 | 把 `printProgress` 换成 `renderer.observe` |
| `runSinglePrompt()` 成功分支 | 改为 `if (!controller.signal.aborted) renderer.reply(reply);` |
| `runSinglePrompt()` 的 `finally` 第一行 | 新增 `renderer.finish();`，再沿用原来的取消和清理 |

这样，单次提问和连续对话都会把同一轮的事件交给同一个显示器。原来的输入、审批和 Ctrl+C 退出行为在本节保留。

## 运行验证

在仓库根目录构建本节：

```bash
npm run lesson:08.1
```

配置好 OpenAI 兼容接口后，再单独运行。服务需要支持 Chat Completions 的 SSE 响应与 `stream_options.include_usage`；没有用量统计时显示“未知”，但旧网关如果直接拒绝这个参数，本节会报错，不自动回退。第 23 章再完善接口能力适配。

```bash
hello-my-agent --provider openai --prompt "不调用工具，用两小段解释测试失败报告为什么能帮助 Agent 继续修复问题。"
```

预期是 `Agent >` 后的文字持续增加，完整回答结束后显示用量，正文不会重新打印一遍。实际分成多少段由模型服务和传输决定，短回答也可能一次就显示完；这不说明程序没有使用流式请求。

如果已配置 Anthropic，可以用同一个问题观察本节的完整响应路径：

```bash
hello-my-agent --provider anthropic --prompt "不调用工具，用两小段解释测试失败报告为什么能帮助 Agent 继续修复问题。"
```

它仍在完整结果回来后显示文字，也应只显示一次。这证明终端可以同时接住两种返回方式，不要求两种接口在本节表现一致。

真实服务的回答和分段不固定。文字先于最终结果到达、两次模型调用互不混淆、正文只输出一次等情况，由本章的本地固定检查覆盖；观察一次网络回答不能替代这些检查。

## 本节完成后的 Agent

现在，OpenAI 兼容接口的文字增量可以沿现有事件送到终端，完整响应仍然返回主循环。此前的读文件、修改和测试继续使用同一个工具执行入口。

接下来，我们要看增量中的另一种内容：工具参数。文字可以先读，工具请求却必须完整。[下一节](../02-complete-tool-calls/README.md)会把 Anthropic 也接入流式响应，并解释怎样等到整次响应正常结束以后再执行工具。
