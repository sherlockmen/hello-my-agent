# 04.1 控制文件搜索范围

[第四章首页](../README.md) · [本节源码](src/) · [下一节：把文本目标变成代码位置](../02-content-search/README.md)

**本节只解决一个核心问题：模型不知道准确路径时，本地程序怎样给它一份可信、有限、可以继续使用的候选文件列表？**

第三章的 `read_file(path)` 要求模型先说出路径。你在 Coding Agent 中看到的“正在查找文件”，本质上不是模型突然看见了目录，而是模型调用一个本地文件发现工具。

## 问题：路径猜测不是搜索

用户要求：

```text
找到负责读取模型配置的文件。
```

模型可以猜 `src/config.ts`，但猜错后只会得到“文件不存在”。它缺少的不是更强的推理，而是一个能回答下面问题的环境接口：

```text
在当前项目中，哪些真实路径符合 src/**/*.ts？
```

这个接口不能直接返回整个磁盘。它必须同时确定：

1. 从哪个目录开始解释相对路径。
2. 哪些目录和文件不应进入搜索。
3. 最多向模型返回多少条路径。
4. 模型生成的 pattern 是否允许执行。

因此本节新增 `glob(pattern)`。核心认识是：**文件发现工具首先定义搜索空间，其次才匹配文件名。**

## 解决方案

```text
模型生成 { pattern }
        |
        v
解析 JSON，校验对象形状和 pattern
        |
        v
以项目根目录为 cwd 执行 Node.js glob
        |
        v
在遍历阶段应用 .gitignore 和内置规则
        |
        v
只保留普通文件，观察到第 201 项后停止
        |
        v
返回前 200 条相对路径和截断状态
```

`glob` 只返回路径，不读取文件内容。模型拿到候选路径后，可以选择一个路径调用 `read_file`；下一节会增加内容搜索，避免逐个读取候选文件。

## 工作原理

### 1. `pattern` 是工具协议，不是 Shell 命令

模型返回的参数在协议层仍是一段 JSON 字符串：

```text
'{"pattern":"src/**/*.ts"}'
              |
              v JSON.parse
{ pattern: "src/**/*.ts" }
              |
              v 字段和值校验
"src/**/*.ts"
```

`parsePattern()` 依次检查：JSON 能否解析、结果是不是对象、对象是否只含 `pattern`、值是否为非空字符串。`validateGlobPattern()` 再拒绝绝对路径、`..` 和超过 500 个字符的模式。

```ts
if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
  throw new ToolError(
    "glob pattern 必须位于当前项目根目录内，不能使用绝对路径或 ..。",
  );
}
```

这条边界必须在本地执行。JSON Schema 只帮助模型生成正确格式；TypeScript 类型在编译后会消失；真正进入文件系统的仍是运行时字符串。

常用 pattern 的含义如下：

| pattern | 选择范围 |
| --- | --- |
| `src/*.ts` | `src` 直属目录中的 `.ts` 文件 |
| `src/**/*.ts` | `src` 及其子目录中的 `.ts` 文件 |
| `**/package.json` | 任意层级名为 `package.json` 的文件 |
| `chapter-0?/README.md` | `chapter-01` 到 `chapter-09` 这类单字符编号目录 |

pattern 只描述路径集合。它不会搜索文件内容，也不会像 Shell 那样执行命令替换。

### 2. 项目根决定所有相对路径的共同坐标系

如果你在 `chapter-04-code-search/01-file-discovery` 中启动 CLI，`process.cwd()` 指向小节目录。但模型请求 `package.json` 时，期望的是仓库根目录的文件。

`findProjectRoot()` 从启动目录向上寻找最近的 `package.json`：

```text
当前目录
  -> 有 package.json？是：项目根
  -> 否：进入父目录继续
  -> 到达文件系统根仍没找到：使用原启动目录
```

`glob`、`grep` 和 `read_file` 都使用这个根目录。于是 `glob` 返回的 `src/a.ts` 可以直接交给其他文件工具，不需要每个工具重新解释路径。

项目根是逻辑工作区边界，不是操作系统沙箱。具体文件是否允许读取，仍由 `read_file` 的真实路径和敏感文件检查决定。

### 3. 忽略规则决定“哪些路径不值得进入”

搜索整个仓库时，`node_modules`、`.git`、构建产物和凭据文件既浪费扫描成本，也可能把无关或敏感内容交给模型。本节合并两类规则：

```text
内置规则：.git/、node_modules/、dist/、.env、.env.*、.envrc
项目规则：仓库根目录的 .gitignore
```

项目 `.gitignore` 支持 `!` 否定规则，例如先忽略 `*.log`，再用 `!keep.log` 恢复一个文件。为了防止项目规则重新暴露 `.env` 或 `node_modules`，代码在加入项目规则后再次加入内置规则：

```ts
return matcher
  .add(await readFile(ignorePath, "utf8"))
  .add(BUILT_IN_IGNORES);
```

`exclude` 在目录遍历阶段执行。忽略 `node_modules/` 时，程序不会先走完目录再丢弃结果，而是在准备进入目录时就剪枝。这是搜索工具的重要成本边界：**越早缩小搜索空间，后续 I/O 越少。**

当前实现只读取项目根目录的一份 `.gitignore`，不处理嵌套 `.gitignore` 和全局 Git ignore。

### 4. 返回上限控制模型上下文，不等于遍历超时

工具最多返回 200 条路径，但代码会先观察第 201 条：

```ts
paths.push(path);
if (paths.length > maxResults) break;

paths.sort();
return {
  paths: paths.slice(0, maxResults),
  truncated: paths.length > maxResults,
};
```

第 201 条不返回，只用来证明结果确实超过上限。恰好发现 200 条时，程序没有证据说明还有更多结果，因此不能显示“已截断”。

这里排序的是遍历器最先交出的至多 201 条路径，并不是先扫描整个项目再取字典序最前的 200 条。这个选择让工具可以尽早停止；代价是截断结果不代表全项目的全局排序前 200 项。

200 条上限保护的是发送给模型的消息长度。它不能保证目录遍历在固定时间内完成。时间上限需要可中断的执行后端，第 07 章再处理。

### 5. 工具结果怎样进入下一次模型决策

注册表只执行已经登记的名称：

```ts
if (call.name === globDefinition.name) {
  return globTool(call.arguments, undefined, signal);
}
```

`globTool()` 返回路径文本后，Agent Loop 把结果和原 `toolCallId` 放进当前 `turn`。下一次 `model.generate()` 会同时看到：用户目标、模型自己的 glob 请求以及本地返回的路径列表。

本节新增的进度回调让这条内部链显示在终端：

```text
模型 > 第 1 次决策：读取当前消息并选择下一步。
工具 > 第 1 步：glob 开始。
工具 > 第 1 步：glob 完成，结果已加入当前回合。
模型 > 第 2 次决策：读取当前消息并选择下一步。
Agent > 配置读取位于 src/config/load-config.ts。
```

- 第一行在 `agentLoop()` 调用模型前产生。
- 第二行在注册表执行 `glob` 前产生。
- 第三行说明工具结果已经写入 `turn`。
- 第四行表示结果随当前消息再次发给模型。

工具步骤号由 Agent Loop 生成，显示名称来自本地注册表。模型返回的参数、调用 ID 和文件列表不会被进度事件重复打印；它们只在内部消息链中参与下一次模型决策。核心报告结构化状态，`ui/terminal.ts` 负责文字和颜色。显示回调即使失败也不会中断搜索；第 09 章接 TUI 时，也不需要从日志字符串猜测 Agent 正处于哪一步。

## 动手构建

本节修改以下位置：

| 文件 | 作用 |
| --- | --- |
| `src/tools/workspace.ts` | 统一项目根与忽略规则 |
| `src/tools/glob.ts` | 校验 pattern，遍历并返回有界路径 |
| `src/tools/registry.ts` | 注册 `glob` |
| `src/agent/agent-loop.ts` | 报告模型和工具执行步骤 |
| `src/ui/terminal.ts` | 显示结构化进度 |
| `src/cli.ts` | 单次提问也接入进度显示 |
| `src/config/load-config.ts` | 告诉模型当前真实工具能力 |

完整实现位于[本节源码](src/)。先读 `agent/agent-loop.ts` 的全局流程，再读 `tools/glob.ts` 和 `tools/workspace.ts` 的局部流程。

在仓库根目录执行：

```bash
npm run lesson:04.1
```

```bash
hello-my-agent --prompt "请找到所有 load-config.ts，并告诉我它们位于哪些目录。"
```

你应该先看到模型决策和 `glob` 的开始、完成记录，再看到最终回答。模型也可能继续调用 `read_file`；工具顺序由模型根据已有证据决定。

## 运行验证

```bash
npm run check:04
```

确定性检查会验证：

- 普通源码能被找到。
- `.gitignore`、`.env`、`node_modules` 和 `dist` 不进入结果。
- `!keep.log` 可以恢复普通文件，却不能恢复内置保护路径。
- `../*.ts` 被拒绝。
- 取消信号可以停止遍历。

### 失败实验

让模型请求项目外范围：

```text
glob({ "pattern": "../**/*.ts" })
```

本地程序应返回 `ToolError`，Agent Loop 再把失败结果交给模型。失败发生在目录遍历之前。

### 小练习

解释为什么结果上限为 200 时，程序必须观察第 201 项才能显示截断提示。

答案：返回 200 项只证明“至少有 200 项”；只有发现第 201 项，才能证明“还有未返回的结果”。这条判断也会在 `grep` 结果和 `read_file` 续读中重复出现。

## 接下来

`glob` 解决了“哪些文件可能相关”，却不知道目标文本位于哪个文件和哪一行。[04.2](../02-content-search/README.md) 将把候选路径进一步收窄成可引用的代码位置。
