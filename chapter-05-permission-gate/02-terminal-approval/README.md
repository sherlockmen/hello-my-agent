# 05.2 在终端中完成一次审批

[上一节：权限策略](../01-policy-decision/README.md) · [第五章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

## 问题：程序知道要问，却还没有地方取得回答

上一节中，模型请求读取 `.git/HEAD` 时，程序已经能够判断这次读取需要确认：

```text
模型请求 read_file(".git/HEAD")
  -> 权限策略发现这是受保护文件
  -> 返回 ask，表示“必须先询问用户”
```

但 `ask` 只是“需要询问”的意思，不代表用户已经同意。05.1 没有审批界面，只能先让这次读取失败。接下来，我们把终端输入接进来，让用户有机会批准这次合理的读取。

这里要区分两种信息：权限策略说“这件事需要确认”，用户随后才回答“允许”或“拒绝”。只有后一项允许工具继续；如果程序显示完提示就立刻读文件，用户的回答便起不到作用。

## 解决方案：把显示问题和等待回答连起来

终端先说明准备读取哪个文件、为什么要询问，再等待一行输入：

```text
审批请求：read_file 将访问 .git/HEAD
原因：读取 .git 项目元数据需要用户确认
允许这一次操作吗？[y/N]
```

用户输入 `y`，程序才执行这一次读取；输入 `n`，就把拒绝原因交回模型。本节只处理当前这次请求，下一节再增加“本次会话允许”。

为了让 Agent Loop 能等到界面的回答，我们传入一个函数，叫作 `ApprovalHandler`。主循环交给它审批信息，它负责显示问题并取得选择，最后返回允许或拒绝。整个过程是：

```text
1. 用户提出目标，模型返回 read_file(".git/HEAD")
2. 权限策略返回 ask，工具尚未启动
3. Agent Loop 生成 ApprovalRequest，并 await ApprovalHandler
4. 终端显示原因，把 y / n 转成 allow_once / deny
5. allow_once 执行工具；deny 生成带原调用 ID 的错误结果
6. 工具结果或错误结果回到模型，模型继续决策并给出最终回答
```

这个函数只返回决定，不自己调用 `read_file`。工具仍由 Agent Loop 启动，成功内容或拒绝原因也仍由主循环配上原调用 ID，再交给模型。

## 工作原理

### `await` 把用户回答放在工具执行之前

权限策略返回 `ask` 时，会同时提供审批需要的信息。下面省略了原因等字段，只看这次文件和批准记录：

```text
permission = {
  action: "ask",
  resource: ".git/HEAD",
  scope: "read_file:.git/**"
}
```

Agent Loop 把这些信息连同工具请求交给审批函数，并等待它：

```ts
const response = await requestApproval(request, signal);
```

这里的 `await` 暂停的是当前这段异步流程，不会阻塞整个 Node.js 进程。用户尚未作出选择时，Promise 还没有结果，代码就不能往下走到 `tool_start` 和 `executeTool()`。所以工具是否运行，确实取决于用户的回答，而不只是在终端上多打印了一句提示。

如果调用方没有传入审批函数，主循环会拒绝当前请求。没有界面可能是装配遗漏，也可能是无人值守运行，不能把它当成用户已经同意。

### 聊天和审批，怎样使用同一份输入

终端已经有一个逐行读取输入的迭代器。我们让审批函数继续使用它，而不新建另一个 `readline`。当主循环正在等审批时，外层聊天循环也在等主循环结束：

```text
聊天循环正在等待 agentLoop()
Agent Loop 正在等待 ApprovalHandler
此时只有 ApprovalHandler 调用 lines.next()
```

因此，此时输入的 `y` 会被当前审批读到。如果两个地方各自读取标准输入，同一行就可能被另一方拿走，例如把 `y` 当成下一条聊天消息。共用一个迭代器，并且按调用顺序等待，就能避免这两个读取者争抢输入。

读取一行以后，终端去掉首尾空格、转成小写。只有 `y` 会允许当前请求；`n`、空行和其他文字都拒绝。输入结束（EOF）或没有交互终端时，也拒绝需要确认的操作，因为程序没有取得明确同意。普通 `allow` 请求不需要这一步，仍可执行。

连续会话中按下 Ctrl+C，外层会取消本轮并关闭 `readline`，让等待输入的 `lines.next()` 结束。第 10—11 章改用 TUI 后，仍然需要处理审批等待期间的取消，只是输入方式会改变。

### 用户回答以后，结果还要交回模型

审批函数返回后，主循环继续处理同一个工具请求：

```text
allow_once
  -> 发出 tool_start
  -> executeTool(read_file)
  -> 把文件内容作为 tool result 加入 turn
  -> 再次调用模型
  -> 模型根据真实内容返回最终回答

deny
  -> 不发出 tool_start
  -> 把“用户未批准”作为 isError=true 的 tool result 加入 turn
  -> 再次调用模型
  -> 模型说明无法读取，或改用其他方案
```

两条路径最终都会给模型一条工具结果。批准后，结果来自真正执行的文件工具；拒绝后，结果说明这次操作没有获得允许。它们都带有原调用 ID，模型看到的是对应请求的结果，而不是终端输入的字母 `y` 或 `n`。

模型因此能根据真实内容回答，也能根据拒绝原因换一种办法。拒绝只终止眼前这次工具请求，并不强制整个会话结束；模型仍可能提出另一个请求。

### 为什么显示事件的观察者不能兼任审批

第四章的 `AgentObserver` 只负责显示进度。它收到事件副本，抛出异常也不会改变主循环；这样的函数不能决定是否执行工具。否则，显示一次失败就可能意外放行或中断操作。

本节的 `approval_start` 和 `approval_finish` 仍是观察事件，分别告诉界面“开始等待”和“取得了什么选择”。主循环真正等待的是 `ApprovalHandler` 的返回值。第 09 章可以扩展日志，第 10 章可以用 TUI 按钮替换终端提问，而工具调用与结果回传仍留在同一个 Agent Loop 中。

如果让终端收到 `y` 后直接执行文件工具，界面还得负责调用 ID、错误处理和消息历史。让界面只返回选择，就能沿用已有的工具执行过程，也不必在 CLI 和 TUI 中各写一遍。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/permissions/policy.ts](src/permissions/policy.ts) | 定义传给界面的问题和返回的选择 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 取得审批回答后再执行工具 |
| 修改 | [src/agent/events.ts](src/agent/events.ts) | 增加审批开始和结束事件 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 共用现有输入迭代器，读取 `y / n` |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 显示等待审批和审批结果 |
| 修改 | [src/cli.ts](src/cli.ts) | 让单次提问也通过终端取得批准 |

## 动手构建

### 第一步：定义传给终端的问题和返回的选择

在 `src/permissions/policy.ts` 中，紧接 `PermissionDecision` 后增加下面三个类型。原有权限判断保持不变：

```ts
export type ApprovalRequest = {
  call: ToolCall;
  reason: string;
  resource: string;
  scope: string;
};

export type ApprovalResponse =
  | { decision: "allow_once" }
  | { decision: "deny"; reason: string };

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalResponse>;
```

`ApprovalRequest` 沿用权限策略提供的信息，`ApprovalResponse` 只表达允许一次或拒绝。函数返回 Promise，是因为终端需要等待用户输入。

在 `src/agent/events.ts` 中，把权限类型导入替换为：

```ts
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";
```

再在 `AgentEvent` 的 `permission_check` 后、`tool_start` 前加入两个分支：

```ts
// [CHANGED 05.2] 加入 AgentEvent 联合类型，报告审批开始和结束。
| { type: "approval_start"; sequence: number; call: ToolCall; scope: string }
| { type: "approval_finish"; sequence: number; call: ToolCall; response: ApprovalResponse }
```

### 第二步：让主循环等到回答

在 `src/agent/agent-loop.ts` 的权限导入中加入 `ApprovalHandler`：

```ts
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
```

在 `agentLoop()` 现有的 `observer?: AgentObserver` 参数之后，追加可选参数：

```ts
// [CHANGED 05.2] 追加到 agentLoop 的参数列表末尾。
requestApproval?: ApprovalHandler,
```

随后找到上一节的 `if (permission.action !== "allow")`。用下面代码替换这一整个分支，放在 `permission_check` 事件之后、`tool_start` 事件之前：

```ts
      let rejection: string | null = null;
      if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
      // [CHANGED 05.2] ask 会暂停循环；只有明确允许一次才继续执行工具。
      if (permission.action === "ask") {
        emitAgentEvent(observer, {
          type: "approval_start",
          sequence: toolSequence,
          call,
          scope: permission.scope,
        });
        const response = requestApproval
          ? await requestApproval({
              call,
              reason: permission.reason,
              resource: permission.resource,
              scope: permission.scope,
            }, signal)
          : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
        emitAgentEvent(observer, {
          type: "approval_finish",
          sequence: toolSequence,
          call,
          response,
        });
        if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
      }
      if (rejection) {
        turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
        pendingToolResults += 1;
        continue;
      }
```

`deny` 直接产生拒绝原因。`ask` 则等待审批，只有拒绝时才给 `rejection` 赋值。只要存在拒绝原因，就生成错误结果并跳过当前工具；否则继续执行原来的 `tool_start`、`try/catch` 和工具结果处理。

### 第三步：在终端中读取选择

在 `src/ui/terminal.ts` 增加类型导入：

```ts
import type { ApprovalHandler } from "../permissions/policy.js";
```

然后在 `printProgress()` 后加入完整的审批函数：

```ts
// [NEW 05.2] 终端适配器把 y/n 转成结构化审批结果。
/**
 * 创建一个等待当前审批回答的函数。
 *
 * - 接收与聊天共用的行迭代器，以及是否为交互终端。
 * - 显示请求与原因后读取一行，y 允许一次，其他输入拒绝。
 * - 非交互运行或 EOF 返回拒绝。连续会话中的 Ctrl+C 会由外层关闭 readline，解除等待。
 *
 * 这里只取得选择，不执行工具，也不把聊天输入另开一个读取者。
 */
export function createApprovalHandler(
  lines: AsyncIterator<string> | undefined,
  interactive: boolean,
): ApprovalHandler {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!interactive || !lines) {
      return { decision: "deny", reason: "非交互运行不能请求批准" };
    }
    console.log(`审批请求：${request.call.name} 将访问 ${request.resource}`);
    console.log(`原因：${request.reason}`);
    process.stdout.write("允许这一次操作吗？[y/N] ");
    // AbortSignal 不会自动结束 lines.next()；startTerminal 的 Ctrl+C 处理会同时关闭 readline。
    const { value, done } = await lines.next();
    signal.throwIfAborted();
    return !done && value.trim().toLowerCase() === "y"
      ? { decision: "allow_once" }
      : { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
  };
}
```

在 `startTerminal()` 中，已有 `const lines = input[Symbol.asyncIterator]()`。紧接它后面创建审批函数：

```ts
// [CHANGED 05.2] 与聊天共用已经创建的 lines。
const requestApproval = createApprovalHandler(lines, terminal);
```

再把循环里的 `agentLoop()` 调用替换为：

```ts
        const reply = await agentLoop(
          model,
          history,
          text,
          controller.signal,
          printProgress,
          requestApproval,
        );
```

聊天循环等待 `agentLoop()`，审批函数在这段等待中读取同一个 `lines`。外层已有的 Ctrl+C 处理与 `finally` 清理继续保留。

### 第四步：让单次提问也能审批

`--prompt` 也可能触发 `.git/HEAD` 读取，所以同样需要输入来源。在 `src/ui/terminal.ts` 的 `startTerminal()` 后、`printReply()` 前加入：

```ts
/**
 * 执行一次 --prompt 提问，并为可能出现的审批准备输入。
 *
 * - 接收模型和非空问题；交互终端中创建 readline，并把审批函数传给 Agent Loop。
 * - 没有交互终端时，审批函数会拒绝需要确认的请求，普通 allow 工具仍能运行。
 * - 显示回答后结束；无论成功还是抛错，finally 都会关闭本函数创建的输入。
 */
// [NEW 05.2] --prompt 模式复用相同审批适配器，不绕过权限入口。
export async function runSinglePrompt(model: Model, prompt: string): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    : undefined;
  const lines = input?.[Symbol.asyncIterator]();
  try {
    const signal = new AbortController().signal;
    const reply = await agentLoop(
      model,
      [],
      prompt,
      signal,
      printProgress,
      createApprovalHandler(lines, interactive),
    );
    printReply(reply);
  } finally {
    input?.close();
  }
}
```

这个函数只在交互终端中创建输入。结束时关闭它；没有交互终端时仍传入审批函数，由函数明确返回拒绝。

回到 `src/cli.ts`，删除原来的 `agentLoop` 导入，把终端导入改为：

```ts
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
```

保留 `--prompt` 的空字符串检查。检查之后，删去原先创建 signal、直接调用 `agentLoop()` 和 `printReply()` 的三行，改为：

```ts
await runSinglePrompt(model, options.prompt);
```

### 第五步：补上审批的过程记录

在 `src/ui/teaching-trace.ts` 的 `formatTeachingTrace()` 中，先把 `ask` 对应的文案从“需要用户确认，本节先阻止执行”改为“需要用户确认”。本节已经能够询问，不再一律阻止。

在 `permission_check` 处理之后、工具开始和结束处理之前，加入下面两个分支：

```ts
  // [CHANGED 05.2] 教学追踪区分等待审批和审批结果。
  if (event.type === "approval_start") {
    return [
      `审批 > 第 ${event.sequence} 步：等待用户决定`,
      `  范围：${toTraceText(event.scope)}。`,
    ];
  }

  if (event.type === "approval_finish") {
    return [
      `审批 < 第 ${event.sequence} 步：${event.response.decision === "allow_once" ? "允许一次" : "拒绝"}`,
    ];
  }
```

这些分支只打印状态，取得输入的代码仍在 `createApprovalHandler()` 中。

### 第六步：构建并观察批准后的读取

在仓库根目录执行：

```bash
npm run lesson:05.2
```

再启动一次需要审批的读取：

```bash
hello-my-agent --prompt "请读取 .git/HEAD，告诉我当前分支引用。"
```

输入 `y` 后，可以沿下面的示意记录观察顺序。部分行已省略，模型请求的行数、步骤编号和最后回答可能不同：

```text
模型 > 第 1 次决策
  收到：新增用户问题“请读取 .git/HEAD……”
模型 < 第 1 次决策
  返回：1 个工具请求。
权限 < 第 1 步：read_file
  判断：需要用户确认……
审批 > 第 1 步：等待用户决定
审批请求：read_file 将访问 .git/HEAD
允许这一次操作吗？[y/N] y
审批 < 第 1 步：允许一次
工具 > 第 1 步：read_file
  执行：path=".git/HEAD"，offset=1，limit=20。
工具 < 第 1 步：read_file 完成
  返回：1 行源码（第 1—1 行）。
  去向：结果已加入当前回合，下一次模型决策会收到。
模型 > 第 2 次决策
  收到：新增 1 条工具结果。
模型 < 第 2 次决策
  返回：最终回答，交给终端显示。
Agent > 当前分支引用是 refs/heads/main。
```

关键是“等待用户决定”之后，工具还没有启动；用户允许后，才出现这次 `read_file` 的开始和完成记录。文件内容进入当前回合，模型收到工具结果后再回答。

再运行一次并输入 `n`，当前请求应在审批结束后被拒绝，不出现它对应的“工具 >”记录。模型随后仍会收到拒绝结果，可能说明没有读取，也可能提出其他请求。

## 运行验证

在仓库根目录运行：

```bash
npm run check:05
```

已有检查会模拟允许、拒绝、EOF、非交互运行和未提供审批函数的情况。对于获准的这一次请求，事件顺序应为：

```text
permission_check -> approval_start -> approval_finish -> tool_start -> tool_finish
```

对于被拒绝的请求，流程到 `approval_finish` 后就不再发出它的 `tool_start` 或 `tool_finish`。这与模型后来是否提出新的请求是两件事。

## 失败实验

把命令放进管道，使输入不再是交互终端。遇到 `.git/HEAD` 这种 `ask` 请求时，审批函数会返回“非交互运行不能请求批准”。程序不会一直等输入，也不会因为无人回答就自动允许；普通 `allow` 请求仍可执行。

## 小练习

如果调用方忘了传入 `ApprovalHandler`，为什么应该拒绝，而不是默许？

因为没有询问界面并不表示用户已经同意。默认允许会把一次装配遗漏变成跳过审批；默认拒绝只让当前操作不能执行，之后还可以在支持审批的终端中重试。

## 本节完成后的 Agent

终端回答已经接到上一节的 `ask` 上：

```text
ToolCall -> 权限策略 -> ask -> 等待 handler
                                  |-- 允许 -> 工具结果 --|
                                  +-- 拒绝 -> 错误结果 --+-> 模型继续决策 -> 最终回答
```

Agent 现在能够说明要读什么，等待用户选择，再把实际结果交回模型。不过，连续读取 `.git/HEAD` 和 `.git/config` 仍会询问两次。下一节让用户选择是否记住本次批准，减少同一个目录中重复读取时的打断。
