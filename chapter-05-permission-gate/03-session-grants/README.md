# 05.3 让 Agent 记住本次运行的批准

[上一节：终端审批](../02-terminal-approval/README.md) · [第五章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

## 问题：同一个任务，为什么要接连确认两次

接下来，我们让 Agent 查看两项 Git 信息：

```text
告诉我当前仓库使用哪个分支，并检查是否配置了远程仓库。
```

模型可能先读当前分支，再读远程仓库配置：

```text
第一次读取：.git/HEAD
第二次读取：.git/config
```

05.2 的 `y` 只允许眼前这一次读取，所以两个文件要分别确认：

```text
读取 .git/HEAD   -> 询问一次 -> 用户输入 y -> 执行
读取 .git/config -> 再询问一次 -> 用户再次输入 y -> 执行
```

程序再次询问，并不是认定第二个文件更危险，而是上一次的批准已经随着那次请求结束了。它没有收到“后续同类读取也允许”的指示，也没有保存可以复用的记录。

用户如果愿意在当前任务中继续读取 `.git`，就可以选择本节新增的 `s`：

```text
s = 在这次 CLI 运行期间，继续允许同一工具读取同一受保护目录
```

第一次读取 `.git/HEAD` 时选择它，程序便记住“本次运行允许读取这个 `.git` 目录”。之后读取 `.git/config` 不再询问；退出 CLI，记录随之消失。

## 解决方案：记下允许哪个工具读取哪个目录

我们用一个 Set 保存本次运行已经批准的操作：

```ts
const sessionGrants = new Set<string>();
```

Set 里的每一项都是具体记录，例如：

```text
read_file:.git/**
```

| 记录的一部分 | 表示什么 |
| --- | --- |
| `read_file` | 允许的是读取文件这个工具 |
| `.git/**` | 可以读取项目根目录下的这个 `.git` 目录中的文件 |

程序通过 `scope` 字段传递这条记录，再把它放入 `sessionGrants`。这里的 `**` 是记录格式的一部分，不会启动 glob 搜索；查询时只是用 `Set.has()` 比较整个字符串是否相同。

同一记录怎样保存和复用，可以沿着下面的过程看：

```text
CLI 启动
  -> 已批准清单：Set {}

第一次读取 .git/HEAD
  -> 程序生成批准记录 read_file:.git/**
  -> Set 中没有这条记录
  -> 终端询问用户
  -> 用户输入 s
  -> 程序把记录加入 Set
  -> 已批准清单：Set { read_file:.git/** }
  -> 执行读取，结果回到模型
  -> 模型给出回答

第二次读取 .git/config
  -> 程序生成同一条批准记录 read_file:.git/**
  -> Set 中已经有这条记录
  -> 不再询问，直接执行读取
  -> 结果回到模型
  -> 模型给出回答

CLI 退出
  -> Set 随进程结束而消失
```

用户仍然可以只允许一次，或者拒绝。因此终端现在提供三个选择：

| 选择 | 当前请求是否执行 | 是否留下批准记录 |
| --- | --- | --- |
| `y`：允许一次 | 是 | 否 |
| `s`：本次会话允许 | 是 | 是，加入 Set |
| `n`：拒绝 | 否 | 否 |

模型收到的仍然是实际工具结果。用户选择 `s`，并不意味着程序可以跳过文件工具自身的参数、类型和大小检查。

## 工作原理

### 为什么不能只记一个“已经同意”

如果只保存一个布尔值：

```ts
let approved = true;
```

程序只能知道发生过批准，却不知道批准的是什么。下次请求读取 `.codex/note.txt` 时，这个 `true` 无法说明用户是否也同意了那个目录；以后加入写入工具，它同样无法区分读和写。

把工具名和目录一起保存，就能逐项比较：

| 新请求 | 生成的记录 | 已保存 `read_file:.git/**` 后怎样处理 |
| --- | --- | --- |
| `read_file(".git/config")` | `read_file:.git/**` | 相同，可以继续读取 |
| `read_file(".codex/note.txt")` | `read_file:.codex/**` | 不同，仍要询问 |
| `read_file("packages/demo/.git/config")` | `read_file:packages/demo/.git/**` | 位置不同，仍要询问 |

第六章的写入也不会复用这条只读记录。写入前还要显示具体修改，每次重新批准；不能因为同意读文件，就认为也同意修改文件。

### 为什么本节记目录，而不是只记文件

如果只记录 `.git/HEAD`，以后再读同一文件确实可以少问一次，但读取 `.git/config` 时仍要重新确认。这解决不了当前任务中连续查看几个 Git 文件的重复询问。

所以我们让 `s` 表示“本次运行允许读取这个目录”，记录按下面的方式组成：

```text
read_file + .git/** -> read_file:.git/**
```

这里要保存完整的项目内目录，不能只取最后的 `.git` 名称。例如 `packages/demo/.git/config` 对应的是：

```text
read_file:packages/demo/.git/**
```

这与项目根目录下的 `.git` 是两处不同位置，应分别批准。路径经过符号链接解析后，也按实际指向的目录生成记录，不能只因为请求里用了另一个名字，就忽略真正要读取的位置。

记录由本地权限策略根据请求生成。模型可以提出读取哪个文件，却不能通过参数中的 `{ "scope": "all" }` 自己添加许可。

### 下一次请求，怎样知道是否已经获准

识别出需要确认的目录后，策略算出 `scope`，再查询 Set。下面只展示记录比较，路径显示的细节留在完整实现中：

```ts
const scope = `read_file:${directory}/**`;

if (sessionGrants.has(scope)) {
  return { action: "allow", reason: `本次会话已经允许 ${scope}` };
}

return {
  action: "ask",
  reason: `读取 ${directory} 项目元数据需要用户确认`,
  resource: actualPath,
  scope,
};
```

第一次读取时，Set 为空，所以返回 `ask`。用户选择 `s` 后，Agent Loop 才把策略提供的记录保存下来：

```ts
if (response.decision === "allow_session") {
  sessionGrants.add(permission.scope);
}
```

读取 `.git/config` 时又得到 `read_file:.git/**`，Set 中已经存在它，于是返回 `allow`。这次仍然运行了权限检查，只是检查发现已经取得过适用的批准，所以不再询问。

策略只生成和查询记录，不自行批准。记录也在执行工具之前保存：用户批准的是后续读取许可，不是保证这次文件一定读得成功。工具随后报错不会自动删除它，撤销需要明确操作。

### 已经批准，也要先检查有没有禁止的情况

Set 只参与原本需要询问的那条分支。每个新请求仍要先经过禁止检查。下面省略普通源码直接允许的情况，只展开对受保护目录的读取：

```text
工具请求
  -> 是否是未知工具、项目外路径或凭据文件？
       | 是 -> 直接拒绝，不查询 Set
       | 否 -> 生成批准记录
                  | Set 中已有相同记录 -> 允许
                  | Set 中没有相同记录 -> 询问用户
```

比如已经允许读取 `.git`，接着又请求 `.git/.env`。策略先识别到禁止读取的 `.env`，直接返回 `deny`，根本不会查询这次目录批准。记住许可的作用是少问重复问题，不是关闭原来的检查。

### 为什么 Set 要放在终端输入循环外

如果每轮调用 `agentLoop()` 都新建一个 Set，上一轮保存的记录就无处可查。因此，终端启动时创建一次，再把同一个 Set 传给每轮主循环：

```text
启动终端
  -> 创建 Set {}
  -> 第一轮 Agent Loop 把批准记录写入 Set
  -> 第二轮 Agent Loop 查询同一个 Set
  -> 退出终端，Set 消失
```

这样，一轮里连续执行工具可以复用批准，接着输入下一条消息也可以复用。退出进程后，内存中的 Set 消失，重新启动就需要再次确认。本节没有把批准写到磁盘；第 17 章再讨论需要长期保存的项目信任配置。

`history` 也由终端保存，但两者用途不同。历史中的已完成消息会发给模型，批准记录只供本地策略查询。因此，`/reset` 只清空对话，不撤销批准。程序提供 `/permissions` 查看记录，章末练习再加入单独的清空命令。

## 执行时，各部分负责什么

| 部分 | 负责的事情 |
| --- | --- |
| 权限策略 | 根据工具和实际目录生成记录，检查 Set 中是否存在 |
| 终端 | 保存这次运行的 Set，把用户输入的 `s` 转成会话批准回答 |
| Agent Loop | 收到会话批准后加入记录，再执行当前工具 |
| 文件工具 | 检查参数并读取文件，不处理 `y` 和 `s` 的区别 |

第 10 章换成 TUI 时，主要改变的是怎样显示问题和收集选择。这份记录、权限检查和主循环都可以继续使用。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/permissions/policy.ts](src/permissions/policy.ts) | 按完整目录生成记录，在询问前检查是否已获准 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 接收会话 Set，并在用户选择 `s` 后保存记录 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 创建 Set，增加 `s` 和 `/permissions` |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 区分允许一次与允许本次会话 |

## 动手构建

### 第一步：让终端能够返回“本次会话允许”

在 `src/permissions/policy.ts` 中替换 `ApprovalResponse`：

```ts
export type ApprovalResponse =
  | { decision: "allow_once" }
  | { decision: "allow_session" }
  | { decision: "deny"; reason: string };
```

`ApprovalRequest` 和 `ApprovalHandler` 保持原样，因为新选择仍通过同一个审批函数返回。

在 `src/ui/terminal.ts` 的 `createApprovalHandler()` 中，保留前面的取消检查、非交互拒绝和请求说明。从原先的 `process.stdout.write()` 开始，到审批函数的返回值结束，替换为：

```ts
    process.stdout.write("请选择：[y] 允许一次，[s] 本次会话允许，[N] 拒绝：");
    // AbortSignal 不会自动结束 lines.next()；startTerminal 的 Ctrl+C 处理会同时关闭 readline。
    const { value, done } = await lines.next();
    signal.throwIfAborted();
    const choice = done ? "" : value.trim().toLowerCase();
    if (choice === "y") return { decision: "allow_once" };
    if (choice === "s") return { decision: "allow_session" };
    return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
```

终端到这里仍然只是返回用户选择，没有把任何记录放入 Set。

### 第二步：按完整目录查找已批准记录

在 `src/permissions/policy.ts` 中替换 `findApprovalDirectory()`：

```ts
/**
 * 找出需要确认的目录，并保留它在项目中的位置。
 *
 * - .git/HEAD 返回 .git，packages/demo/.git/config 返回 packages/demo/.git。
 * - 找不到受保护目录时返回 null；有多个时取路径中第一个。
 * - 两个目录都叫 .git，也不能共用批准，所以返回完整相对目录，而不只是最后的名称。
 */
function findApprovalDirectory(path: string): string | null {
  const segments = path.split("/");
  const index = segments.findIndex((segment) => APPROVAL_DIRECTORIES.has(segment.toLowerCase()));
  return index === -1 ? null : segments.slice(0, index + 1).join("/");
}
```

05.2 只需要知道路径中有没有 `.git` 等名称；现在要区分不同位置的同名目录，所以返回值包括它前面的项目内路径。

在 `decideToolPermission()` 的 `call` 与 `projectRoot` 参数之间加入：

```ts
// [CHANGED 05.3] 插入 decideToolPermission 的第二个参数位置。
sessionGrants: ReadonlySet<string> = new Set(),
```

随后找到 `if (directory)` 分支。先生成记录：

```ts
const scope = `read_file:${directory}/**`;
```

再把原来直接返回 `ask` 的部分替换为下面的查询和返回。上面的 `scope` 仍放在同一个 `if (directory)` 分支内：

```ts
if (sessionGrants.has(scope)) {
  return { action: "allow", reason: `本次会话已经允许 ${scope}` };
}

return {
  action: "ask",
  reason: `读取 ${directory} 项目元数据需要用户确认`,
  resource: actualPath === normalized ? normalized : `${normalized} -> ${actualPath}`,
  scope,
};
```

前面的未知工具、项目外路径和环境文件等拒绝条件都保留原位。这样 Set 才不会覆盖禁止规则。

### 第三步：让 Agent Loop 保存用户选择

在 `src/agent/agent-loop.ts` 中，给 `agentLoop()` 的 `requestApproval` 参数后追加：

```ts
// [CHANGED 05.3] 追加到 agentLoop 的参数列表末尾。
sessionGrants: Set<string> = new Set(),
```

工具循环里调用策略的那一行改为：

```ts
const permission = await decideToolPermission(call, sessionGrants);
```

在发出 `approval_finish` 之后、检查 `response.decision === "deny"` 之前，加入：

```ts
// [CHANGED 05.3] 只保存这次权限策略生成的记录。
if (response.decision === "allow_session") sessionGrants.add(permission.scope);
```

保存完成后，继续原来的执行流程。输入 `y` 不写入 Set；输入 `n` 既不保存，也不执行当前工具。

### 第四步：由终端保存 Set，并提供查看命令

在 `src/ui/terminal.ts` 的 `startTerminal()` 中，`requestApproval` 创建之后、输入循环之前加入：

```ts
const sessionGrants = new Set<string>();
```

循环里的主循环调用改为：

```ts
const reply = await agentLoop(
  model,
  history,
  text,
  controller.signal,
  printProgress,
  requestApproval,
  sessionGrants,
);
```

`runSinglePrompt()` 虽然只处理一条用户消息，模型在这一轮内也可能连续读取多个文件。因此，在它调用 `agentLoop()` 时，同样在 `createApprovalHandler(lines, interactive)` 后传入一个新的 Set：

```ts
    const reply = await agentLoop(
      model,
      [],
      prompt,
      signal,
      printProgress,
      createApprovalHandler(lines, interactive),
      new Set<string>(),
    );
```

然后在 `startTerminal()` 前加入查看命令的两个完整函数：

```ts
/**
 * 显示本次运行已经保存的批准记录。
 *
 * 读取终端与 Agent Loop 共用的 Set；为空时显示提示，否则逐项打印。
 * 这里只查看，不新增或删除记录。
 */
function printSessionGrants(sessionGrants: ReadonlySet<string>): void {
  if (sessionGrants.size === 0) {
    console.log("本次会话没有已批准的权限范围。");
    return;
  }
  console.log("本次会话已批准：");
  for (const scope of sessionGrants) console.log(`- ${scope}`);
}

/**
 * 处理只属于本地终端的权限命令。
 *
 * - 接收一行用户文字和当前运行共用的 sessionGrants。
 * - /permissions 显示记录后返回 true，其他文字返回 false。
 * - 终端据此 continue，已处理的命令不会再进入模型消息。
 *
 * 本节只支持查看；章末练习再增加主动清空。
 */
// [NEW 05.3] 本地命令只查看会话授权，不进入模型消息。
export function handlePermissionCommand(
  text: string,
  sessionGrants: ReadonlySet<string>,
): boolean {
  if (text !== "/permissions") return false;
  printSessionGrants(sessionGrants);
  return true;
}
```

在终端循环已经处理空行和 `/exit`、尚未处理 `/reset` 的位置，插入：

```ts
if (handlePermissionCommand(text, sessionGrants)) continue;
```

命令返回 `true` 时，`continue` 让终端等待下一行，`/permissions` 不会作为聊天消息发给模型。把启动问候改成下面的现有版本，让用户知道这个命令：

```ts
console.log("Hello，My Agent！输入消息开始对话，输入 /permissions 查看会话权限，输入 /reset 清空历史，输入 /exit 退出。");
```

### 第五步：显示会话批准的结果

在 `src/ui/teaching-trace.ts` 中，替换 `formatTeachingTrace()` 的 `approval_finish` 分支：

```ts
  if (event.type === "approval_finish") {
    const result = event.response.decision === "allow_once"
      ? "允许一次"
      // [CHANGED 05.3] 终端明确区分单次允许和会话允许。
      : event.response.decision === "allow_session"
        ? "允许本次会话"
        : "拒绝";
    return [
      `审批 < 第 ${event.sequence} 步：${result}`,
    ];
  }
```

### 第六步：构建后连续读取两个文件

在仓库根目录执行：

```bash
npm run lesson:05.3
```

启动连续会话：

```bash
hello-my-agent
```

输入前面的任务：

```text
告诉我当前仓库使用哪个分支，并检查是否配置了远程仓库。
```

具体读取哪些文件由模型决定。为了更容易观察，也可以分两次明确提出请求。先输入：

```text
请读取 .git/HEAD，告诉我当前分支引用。
```

第一次出现审批时输入 `s`，然后继续输入：

```text
请读取 .git/config，只告诉我是否存在 remote 配置。
```

下面是要观察的过程示意，不要求终端逐字一致：

```text
第一次读取 .git 文件：
权限 -> 需要确认
审批 -> 用户选择“本次会话允许”
工具 -> 开始并完成

第二次读取 .git 文件：
权限 -> 本次会话已经允许 read_file:.git/**
工具 -> 直接开始并完成
```

第二次仍会显示权限检查，但不再显示这次读取的审批提示。前者说明检查没有被跳过，后者说明它找到了相同的批准记录。

再输入本地命令：

```text
/permissions
```

应看到类似输出：

```text
本次会话已批准：
- read_file:.git/**
```

## 运行验证

在仓库根目录执行：

```bash
npm run check:05
```

检查会验证：第一次会话批准确实加入 Set；同目录的第二次读取不再调用审批函数；换到 `.codex` 仍要确认；禁止读取的 `.env` 不会因为已有目录批准而获准。

## 失败实验

先输入 `s`，允许本次会话读取 `.git`，然后要求 Agent 读取 `.git/.env`。如果模型提出这个工具请求，程序应直接拒绝，不显示审批问题，也不启动文件工具。

这是因为禁止规则在 Set 查询之前运行。若模型没有提出读取请求，就没有触发这个本地分支；可以结合上面的固定检查确认程序行为。

## 小练习

如果把 `const sessionGrants = new Set<string>()` 移进终端输入循环，会发生什么？

每读取一条用户消息就会创建新的空集合。当前这一轮内部仍可复用刚保存的记录，但下一条用户消息到来时又换了 Set，所以会重新询问。

章末练习会增加 `/permissions clear`，在不退出 CLI 的情况下主动撤销记录，见[练习与答案](../EXERCISES.md)。

## 本节完成后的 Agent

现在，临时批准会这样参与每次工具请求：

```text
工具请求
  -> 先执行不可批准规则
  -> 为需要确认的操作生成批准记录
       | Set 中已有相同记录 -> 直接执行工具
       | Set 中没有相同记录 -> 询问用户
                              | y -> 只执行这一次
                              | s -> 记录加入 Set，再执行
                              | n -> 不执行
  -> 工具结果或拒绝结果回到模型
  -> 模型继续决策并给出最终回答
```

Agent 已经能记住本次运行允许哪个工具读取哪个目录，又保留原来的禁止检查。它仍然只有读取能力。第六章会加入文件创建和编辑：在同一个审批过程里先展示具体修改，获准后再保存。
