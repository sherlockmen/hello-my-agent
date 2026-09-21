# 05.3 让 Agent 在本次运行中记住你的批准

[上一节：终端审批](../02-terminal-approval/README.md) · [第五章首页](../README.md) · [本节源码](src/) · [练习与答案](../EXERCISES.md)

**本节只解决一个核心问题：你选择“本次会话允许”后，Agent 怎样记住这个选择，并且只把它用于你批准过的读取？**

## 问题：为什么同一个任务会连续要求确认

假设你让 Agent 完成这个任务：

```text
告诉我当前仓库使用哪个分支，并检查是否配置了远程仓库。
```

为了回答，模型可能先读取当前分支信息，再读取远程仓库配置：

```text
第一次读取：.git/HEAD
第二次读取：.git/config
```

05.2 只有 `y`，它表示“只允许眼前这一次读取”。因此程序会这样运行：

```text
读取 .git/HEAD   -> 询问一次 -> 用户输入 y -> 执行
读取 .git/config -> 再询问一次 -> 用户再次输入 y -> 执行
```

两次读取都需要确认，不是因为第二次更危险，而是因为程序没有保存第一次的选择。

本节增加一个新选择：

```text
s = 在这次 CLI 运行期间，继续允许同一工具读取同一受保护目录
```

第一次读取 `.git/HEAD` 时输入 `s`，程序便记住“这次运行允许读取 `.git` 目录”。随后读取 `.git/config` 时不再询问；退出 CLI 后，这条记录自动消失。

**因此，本节要回答三个具体问题：程序记住什么、把它保存在哪里、下次读取时怎样使用它？**

## 解决方案

核心实现就是一个 `Set<string>`：

```ts
const sessionGrants = new Set<string>();
```

先把它理解成一张“本次运行已经批准的操作清单”。它不保存文件内容，也不保存模型回答，只保存下面这种批准记录：

```text
read_file:.git/**
```

这段字符串可以拆成两部分：

| 部分 | 含义 |
| --- | --- |
| `read_file` | 只允许文件读取工具 |
| `.git/**` | 只允许读取 `.git` 目录中的文件 |

它表示“本次运行允许 `read_file` 读取项目根目录下的 `.git`”。代码用 `scope` 字段传递这条记录，再把它放入 `sessionGrants` 这个 Set。

`**` 在这里不会启动 glob 搜索。整个 `read_file:.git/**` 只是一个普通字符串，Set 使用 `has()` 做精确比较。

一次保存和一次复用的过程如下：

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

三个审批选项的区别是：

| 用户选择 | 是否执行当前工具 | 是否记住这次允许 |
| --- | --- | --- |
| `y`：允许一次 | 是 | 否 |
| `s`：本次会话允许 | 是 | 是，写入 Set |
| `n`：拒绝 | 否 | 否 |

## 工作原理

本节的核心规则只有一句：**程序把“工具名 + 允许访问的目录”保存成一条批准记录；下一次得到相同记录时，才跳过询问。**

### 1. 为什么不能只保存 `true`

下面这种写法只能表达“用户曾经批准过某件事”：

```ts
let approved = true;
```

下一次请求到来时，程序无法知道用户批准的是读取还是写入，也不知道批准的是 `.git` 还是 `.codex`。如果看到 `true` 就全部放行，一次读取批准可能变成所有工具的通行证。

Set 保存具体的批准记录后，不同操作会得到不同结果：

| 工具请求 | 生成的批准记录 | 已批准 `.git` 读取后是否放行 |
| --- | --- | --- |
| `read_file(".git/config")` | `read_file:.git/**` | 是 |
| `read_file(".codex/note.txt")` | `read_file:.codex/**` | 否，记录不同 |
| 第 06 章的 `write_file(".git/config")` | `write_file:.git/**` | 否，工具不同 |

### 2. 为什么不保存单个文件路径

如果 Set 只保存 `.git/HEAD`，下一次读取 `.git/config` 时仍然无法命中，又会弹出确认。这样与 05.2 的“允许一次”没有区别。

本节需要记住的是：“本次运行允许 `read_file` 读取项目根目录下的 `.git`。”所以批准记录同时包含工具名和完整的项目内目录：

```text
read_file + .git/** -> read_file:.git/**
```

这条记录由本地权限策略生成。模型只能提出“读取 `.git/HEAD`”，不能自己写入 `{ "scope": "all" }` 来扩大权限。

如果模型请求 `packages/demo/.git/config`，程序会生成另一条记录：

```text
read_file:packages/demo/.git/**
```

它不会命中 `read_file:.git/**`。两个目录都叫 `.git`，但位置不同，所以需要分别批准。

### 3. Set 中没有相同记录时，程序才询问

权限策略识别出 `.git` 目录后，会生成批准记录并查询 Set。代码中的变量名 `scope` 表示“这次批准可以复用到哪里”：

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

第一次读取时，Set 为空，`has()` 返回 `false`，所以策略要求确认。第二次读取 `.git/config` 时会生成相同记录，`has()` 返回 `true`，所以策略直接允许执行。

权限策略只负责生成和查询记录，不会自行批准请求。只有你明确输入 `s` 后，Agent Loop 才把记录加入 Set：

```ts
if (response.decision === "allow_session") {
  sessionGrants.add(permission.scope);
}
```

这样，模型和权限策略都不能替你作出“本次会话允许”的决定。

### 4. 已保存的批准仍然不能绕过禁止规则

每个新请求都先重新检查不可批准的情况，然后才查询 Set：

```text
工具请求
  -> 是否是未知工具、项目外路径或凭据文件？
       | 是 -> 直接拒绝，不查询 Set
       | 否 -> 生成批准记录
                  | Set 中已有相同记录 -> 允许
                  | Set 中没有相同记录 -> 询问用户
```

例如，用户已经允许读取 `.git` 后又请求 `.git/.env`。这个路径会先命中凭据文件禁止规则，因此直接拒绝。程序不会因为 Set 中存在 `read_file:.git/**` 就放行它。

会话授权的作用只是减少重复询问，不是关闭权限检查。

### 5. Set 为什么放在终端输入循环外

终端启动时创建一次 Set，然后把同一个 Set 交给每轮 Agent Loop：

```text
启动终端
  -> 创建 Set {}
  -> 第一轮 Agent Loop 把批准记录写入 Set
  -> 第二轮 Agent Loop 查询同一个 Set
  -> 退出终端，Set 消失
```

如果在 `agentLoop()` 内部创建 Set，每轮开始都会得到一个新空集合，程序无法记住上一轮的批准。

如果把 Set 写入磁盘，授权就会在重启后继续存在，还必须处理来源、过期和撤销。第 17 章会专门实现项目级信任配置；本节只保存当前进程中的临时授权。

对话历史 `history` 和权限集合 `sessionGrants` 都位于输入循环外，但用途不同：

- `history` 保存已经完成的对话，并在下一次请求时发给模型。
- `sessionGrants` 保存本次运行的批准记录，只供本地权限策略查询，不会发给模型。

因此，`/reset` 只清空对话历史，不会顺便修改权限。本章练习会增加单独的权限撤销命令。

## 四个模块分别做什么

| 模块 | 本节职责 |
| --- | --- |
| 权限策略 | 根据工具和目录生成批准记录，并查询 Set 中是否已经存在 |
| 终端 | 创建并持有 Set，把用户输入的 `s` 转成“本次会话允许” |
| Agent Loop | 你选择 `s` 后把批准记录写入 Set，再执行当前工具 |
| 文件工具 | 只负责校验和读取文件，不知道用户选择了 `y` 还是 `s` |

这种分工让权限规则不依赖当前界面。第 10 章把终端提示升级成 TUI 后，仍然可以复用同一个 Set、权限策略和 Agent Loop。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 修改 | [src/permissions/policy.ts](src/permissions/policy.ts) | 为受保护读取生成批准记录，并在询问前查询 Set。 |
| 修改 | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 你选择“本次会话允许”后，把批准记录写入 Set。 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 创建会话 Set，并把输入 `s` 转换成“本次会话允许”。 |
| 修改 | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 在过程输出中区分“允许一次”和“本次会话允许”。 |

## 动手构建

### 第一步：让审批结果能够表示“本次会话允许”

05.2 只有“允许一次”和“拒绝”。先在 `src/permissions/policy.ts` 的审批结果中增加第三种选择：

```ts
export type ApprovalResponse =
  | { decision: "allow_once" }
  | { decision: "allow_session" }
  | { decision: "deny"; reason: string };
```

然后在 `src/ui/terminal.ts` 中把用户输入的 `s` 转成这个结果：

```ts
if (choice === "y") return { decision: "allow_once" };
if (choice === "s") return { decision: "allow_session" };
return { decision: "deny", reason: done ? "输入已结束" : "用户拒绝" };
```

到这里，终端只表达了用户选择，还没有保存授权。

### 第二步：让权限策略在询问前查询 Set

权限策略识别出受保护目录后，生成一条批准记录：

```ts
const scope = `read_file:${directory}/**`;
```

随后查询 Set。已有相同记录时直接允许，没有时才返回确认请求：

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

权限策略仍然先执行项目外路径、凭据文件和未知工具等禁止检查。Set 只参与原本需要询问的分支。

### 第三步：用户输入 `s` 后，把批准记录加入 Set

Agent Loop 等到终端返回审批结果。如果用户选择“本次会话允许”，就保存权限策略生成的批准记录：

```ts
const response = await requestApproval(request, signal);

if (response.decision === "allow_session") {
  sessionGrants.add(permission.scope);
}
```

保存完成后，当前工具继续执行。用户输入 `y` 时不会写入 Set；输入 `n` 时既不保存，也不执行工具。

### 第四步：让每一轮使用同一个 Set

在 `src/ui/terminal.ts` 的输入循环外创建 Set：

```ts
const sessionGrants = new Set<string>();
```

每轮调用 Agent Loop 时传入同一个对象：

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

Set 没有在循环内重新创建，因此第一次保存的记录可以被后续请求查到。

### 第五步：构建并运行

在仓库根目录执行：

```bash
npm run lesson:05.3
```

启动连续会话：

```bash
hello-my-agent
```

输入一个需要连续读取 Git 信息的问题：

```text
告诉我当前仓库使用哪个分支，并检查是否配置了远程仓库。
```

模型具体请求哪些文件由它自己决定。为了清楚观察本节机制，也可以分两次输入：

```text
请读取 .git/HEAD，告诉我当前分支引用。
```

第一次出现审批问题时输入 `s`。随后输入：

```text
请读取 .git/config，只告诉我是否存在 remote 配置。
```

你需要观察的不是模型回答的具体措辞，而是下面两个差异：

```text
第一次读取 .git 文件：
权限 -> 需要确认
审批 -> 用户选择“本次会话允许”
工具 -> 开始并完成

第二次读取 .git 文件：
权限 -> 本次会话已经允许 read_file:.git/**
工具 -> 直接开始并完成
```

第二次仍会显示权限检查，说明程序没有绕过权限策略；它不会再次显示审批提示，说明 Set 已经命中。

输入下面的本地命令可以查看 Set 中保存的批准记录：

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

这项检查会验证四件事：

1. 第一次选择“本次会话允许”后，Set 中出现 `read_file:.git/**`。
2. 第二次读取 `.git` 文件时不再调用审批处理函数。
3. 读取 `.codex` 时，因为生成的是另一条批准记录，仍然需要确认。
4. 读取 `.env` 时，即使 `.git` 已授权也必须拒绝。

## 失败实验

先输入 `s`，允许本次会话读取 `.git`。然后要求 Agent 读取 `.git/.env`。

预期结果是直接拒绝：不会出现审批问题，也不会启动文件工具。原因是凭据文件禁止规则先于 Set 查询执行。

这个实验验证：Set 只减少重复询问，不能覆盖程序明确禁止的操作。

## 小练习

如果把 `const sessionGrants = new Set<string>()` 写进终端输入循环，会发生什么？

答案：每读取一条用户消息都会创建一个新的空 Set。第一次输入 `s` 保存的记录会随本轮结束而丢失，下一轮仍然会再次询问。

完整章末练习会增加 `/permissions clear`，让用户在不退出 CLI 的情况下主动清空这张授权清单，见[练习与答案](../EXERCISES.md)。

## 本节完成后的 Agent

加入本节后，一次临时授权会这样工作：

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

Agent 现在能记住“本次运行允许哪个工具访问哪个目录”。它仍然不能修改文件。第 06 章会在同一个权限入口后加入 `write_file`，继续解决“用户批准的内容必须与最终写入内容一致”。
