# 05.2 在终端中完成一次审批

[上一节：权限策略](../01-policy-decision/README.md) · [第五章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

**本节只解决一个核心问题：当一次工具调用必须经过用户确认时，Agent Loop 怎样在执行工具前询问用户，并根据用户的回答继续或拒绝？**

## 问题：工具需要确认，但程序还不知道用户是否同意

假设模型想读取 `.git/HEAD`。05.1 的权限策略知道 `.git` 目录受到保护，因此不会直接执行这个工具，而是返回 `ask`：

```text
模型请求 read_file(".git/HEAD")
  -> 权限策略发现这是受保护文件
  -> 返回 ask，表示“必须先询问用户”
```

这里的 `ask` 不是用户的回答。它只是权限策略发给 Agent Loop 的指令：**先不要执行工具，去询问用户。**

程序此时仍然缺少真正的执行决定：

| 决定来自哪里 | 内容 | 程序应该怎样处理 |
| --- | --- | --- |
| 权限策略 | `ask` | 暂停当前工具调用，等待用户回答 |
| 用户 | `y` | 只允许这一次工具调用 |
| 用户 | `n` | 拒绝这一次工具调用 |

如果程序把 `ask` 当成允许，受保护文件会在用户确认前被读取，审批就失去了作用。如果程序把 `ask` 当成拒绝，用户又没有机会批准一次合理的读取。

所以，05.1 只完成了“识别哪些操作需要确认”。本节还要补上后半段：Agent Loop 把工具名称、目标文件和确认原因交给终端，等待用户输入 `y` 或 `n`，再执行或拒绝这次工具调用。

**因此，本节要解决的问题是：Agent Loop 怎样在工具执行前取得用户的明确回答，并确保这个回答真正控制工具是否运行？** 本节只支持“允许这一次”和“拒绝”；重复授权留到 05.3。

## 解决方案

新增 `ApprovalHandler`，把界面和 Agent 核心连接起来：

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

一次 `.git/HEAD` 请求沿着同一条主线完成：

```text
1. 用户提出目标，模型返回 read_file(".git/HEAD")
2. 权限策略返回 ask，工具尚未启动
3. Agent Loop 生成 ApprovalRequest，并 await ApprovalHandler
4. 终端显示原因，把 y / n 转成 allow_once / deny
5. allow_once 执行工具；deny 生成带原调用 ID 的错误结果
6. 工具结果或错误结果回到模型，模型继续决策并给出最终回答
```

这六步就是本节的全部主线。`ApprovalHandler` 只回答“是否允许”，真正执行工具、保存调用 ID 和回传结果仍由 Agent Loop 负责。

## 工作原理

先记住一个核心结论：**`ask` 的作用不是弹出一行提示，而是在 Agent Loop 中插入一个必须等待的决策点。**

### 1. Agent Loop 在工具启动前停住

权限策略返回的实际数据是：

```text
permission = {
  action: "ask",
  resource: ".git/HEAD",
  scope: "read_file:.git/**"
}
```

Agent Loop 此时不会调用 `executeTool()`，而是把这三个字段连同原始 `ToolCall` 组成 `ApprovalRequest`，然后执行：

```ts
const response = await requestApproval(request, signal);
```

`await` 没有阻塞整个 Node 进程，只暂停当前工具分支。Promise 没有返回结果之前，代码到不了 `tool_start`，文件工具也不会运行。这条先后关系是审批真正有效的原因。

如果没有装配 `requestApproval`，Agent Loop 直接生成拒绝结果。缺少界面可能是程序接线错误，也可能是无人值守运行；两种情况都不能被解释成用户已经同意。

### 2. 终端把一行输入转换成结构化决定

终端收到 `ApprovalRequest` 后显示资源和原因，再读取一行：

```text
审批请求：read_file 将访问 .git/HEAD
原因：读取 .git 项目元数据需要用户确认
允许这一次操作吗？[y/N]
```

只有 `y` 或 `Y` 返回 `{ decision: "allow_once" }`。`n`、空行、其他文字、EOF 和非交互运行都返回 `deny`。这叫默认拒绝：程序必须取得明确允许，不能靠缺失输入推测用户同意。

聊天和审批复用同一个行迭代器，是为了保证这行 `y` 只属于当前审批：

```text
聊天循环正在等待 agentLoop()
Agent Loop 正在等待 ApprovalHandler
此时只有 ApprovalHandler 调用 lines.next()
```

如果创建两个 `readline` 同时读取 stdin，聊天循环可能先拿到 `y`，把它当成下一条用户消息。共享一个迭代器让输入所有权随着调用栈移动，不需要额外抢占规则。

Ctrl+C 时，外层同时标记取消并关闭 `readline`，让正在等待的 `lines.next()` 结束；handler 随后检查取消状态并停止本轮。第 10—11 章换成 TUI 输入与焦点管理后，仍要保证审批等待能够被取消。

### 3. Agent Loop 根据决定完成整轮任务

handler 返回后，控制权回到 Agent Loop：

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

因此，批准与拒绝都不会让消息链断在半路。模型最终看到的不是终端中的 `y` 或 `n`，而是一条与原调用 ID 配对的工具结果。

`approval_start` 和 `approval_finish` 事件只记录“正在等待”和“用户怎样选择”，供终端显示。Agent Loop 不读取观察者的返回值，所以日志函数不能批准工具；真正改变分支的只有 `ApprovalHandler` 返回的结构化决定。第 09 章会扩展观察事件，第 10 章会用 TUI 按钮实现新的 handler，这两个职责仍然分开。

### 4. 为什么不让终端直接执行工具

让终端在用户输入 `y` 后直接调用 `read_file` 看起来更短，却会绕过 Agent Loop。这样工具结果没有统一的调用 ID、错误处理和消息提交位置，CLI 与未来 TUI 还会各自复制一套执行逻辑。

当前设计让界面只收集决定，Agent Loop 始终拥有执行权。无论决定来自终端按键还是 TUI 按钮，后续都经过同一个工具注册表和同一条结果回传链。这是本节最重要的设计理由。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/permissions/policy.ts](src/permissions/policy.ts) | 定义审批请求、一次允许和拒绝。 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 等待审批结果后再决定是否执行工具。 |
| 修改 | [src/agent/events.ts](src/agent/events.ts) | 增加审批开始与结束事件。 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 用现有输入迭代器读取 `y / n`。 |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 显示等待审批和审批结果。 |
| 修改 | [src/cli.ts](src/cli.ts) | 让单次提问也从终端层取得审批能力。 |

## 动手构建

### 第一步：让 Agent Loop 等待审批结果

在 `permission.action === "ask"` 分支中加入下面的控制流程：

```ts
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

  if (response.decision === "deny") {
    rejection = `用户未批准工具执行：${response.reason}`;
  }
}
```

当没有 `requestApproval` 时，这段代码主动生成拒绝结果。只有 `allow_once` 会让 `rejection` 保持为 `null`，随后继续到 `tool_start`。

### 第二步：把终端输入转换成结构化决定

终端 handler 复用已有的 `lines`：

```ts
process.stdout.write("允许这一次操作吗？[y/N] ");
const { value, done } = await lines.next();
signal.throwIfAborted();

return !done && value.trim().toLowerCase() === "y"
  ? { decision: "allow_once" }
  : { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
```

输入去掉首尾空格并转成小写后，只有 `y`（包括大写 `Y`）会允许当前操作。`n`、空行和其他文字都进入拒绝分支，避免模糊输入被当成同意。

### 第三步：构建并运行

在仓库根目录执行：

```bash
npm run lesson:05.2
```

再启动一次需要审批的读取：

```bash
hello-my-agent --prompt "请读取 .git/HEAD，告诉我当前分支引用。"
```

输入 `y` 时会看到：

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

这些输出展示了完整闭环：权限检查暂停执行，handler 取得决定，工具在允许后启动，结果进入当前回合，模型读取结果后才形成最终回答。

输入 `n` 时，输出停在 `approval_finish`，不会出现“工具 >”。Agent Loop 会把拒绝结果交给模型，让模型说明没有读取文件或选择别的方案。

## 运行验证

```bash
npm run check:05
```

确定性检查分别模拟允许、拒绝、EOF、非交互运行和缺少 handler。允许场景的事件顺序必须是：

```text
permission_check -> approval_start -> approval_finish -> tool_start -> tool_finish
```

拒绝场景只能到 `approval_finish`，之后不允许出现 `tool_start` 或 `tool_finish`。

## 失败实验

把命令放进管道，使输入不再是交互终端。普通 `allow` 工具仍可执行；遇到 `.git/HEAD` 这种 `ask` 请求时，handler 返回“非交互运行不能请求批准”，程序不会挂起，也不会默认允许。

## 小练习

为什么没有 `ApprovalHandler` 时不能默认返回 `allow_once`？

答案：缺少 handler 可能只是调用方忘记装配，也可能表示当前环境无法展示问题。如果默认允许，一个程序接线错误就会绕过审批；默认拒绝只会让当前操作失败，用户仍可在支持审批的终端中重试。

## 本节完成后的 Agent

05.2 把真实用户决定接到了 05.1 留下的 `ask` 暂停点：

```text
ToolCall -> 权限策略 -> ask -> 等待 handler
                                  |-- 允许 -> 工具结果 --|
                                  +-- 拒绝 -> 错误结果 --+-> 模型继续决策 -> 最终回答
```

Agent 现在可以安全完成一次审批，但每个 `ask` 都会再次打断用户。05.3 将保存“本次进程已经批准的明确范围”，减少同一类请求的重复询问。
