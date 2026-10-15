# 20.2 执行后钩子：让检查结果进入下一次模型请求

[第 20 章首页](/content/chapter-20-hooks/README.md) · [上一节：20.1 执行前钩子](/content/chapter-20-hooks/01-before-tool/README.md) · [本章练习与答案](/content/chapter-20-hooks/EXERCISES.md)

## 问题：文件已经修改，项目检查怎样影响下一步

上一节把检查放在工具执行前，能够阻止一次不合约定的动作。现在换一个时机：模型修改了允许编辑的 `src/format.ts`，文件写入已经成功，我们还想检查格式或跑一项快速测试。检查必须读取修改后的文件，放在写入前就看不到这次变化。

只在终端显示一行“格式检查失败”还不够。用户能看到，模型的下一次请求却未必包含它；模型可能直接宣布完成。我们需要把真实工具结果与项目检查反馈一起交回模型，让它根据反馈继续修正。

本节增加执行后钩子（`after_tool`）。它观察一次工具已经返回的结果，并补充项目反馈。这里的“后”有实际含义：原工具已经执行，后置检查失败不能再把一次成功写入说成“写入没有发生”。

## 解决方案：保留工具事实，再追加带来源的检查反馈

`after_tool` 沿用上一节的配置与 JSON 输出约定。程序等待原工具返回后，将调用、结果摘要和成功或错误状态交给脚本。脚本可以检查磁盘上的当前文件，再通过 `message` 返回“格式通过”或“第 8 行需要调整”等说明。

程序把这段说明追加到原工具结果后面，并标明它来自本地执行后钩子。接下来仍走原有的工具结果保存与模型请求流程。模型读到“文件已写入”和“格式检查失败”这两个事实，可以继续修改同一文件；是否修改、怎样修改，仍由模型决定。

## 工作原理

### 检查必须接在产生待检查状态的操作后面

以一次 `write_file` 为例，执行前脚本通过之后，程序调用真实写入工具并等待返回。假设原结果是“写入完成”，这时磁盘已经包含新内容。随后 `after_tool` 启动项目检查脚本，脚本读取新文件，输出：

```json
{"message":"src/format.ts 的第 8 行仍使用了制表符，请改为空格。"}
```

程序形成的同一条工具结果包含两个来源清楚的部分：

```text
写入完成。

[本地执行后钩子反馈；不是权限]
src/format.ts 的第 8 行仍使用了制表符，请改为空格。
```

调用编号不变，因此模型能把反馈对应到刚才那次写入。反馈也不是新用户请求，不会替用户批准下一次写入。下一次调用仍然要经过自己的准备、权限和执行前检查。

模型能修正错误，靠的是下一次请求真正携带了这条工具消息，模型再据此提出新调用；不是脚本把文字打印到屏幕就自动改变了模型。若脚本没有输出 `message`，或者根本没有配置 `after_tool`，下一次请求就只包含原结果。

### 三个状态不能压成一个“成功”

这里至少有三个独立问题：原工具是否成功、检查脚本是否正常运行、检查对项目内容的判断是什么。工具返回 `isError` 是第一个问题。脚本退出码、超时和 JSON 格式是第二个问题。脚本的 `message` 是第三个问题。

例如文件写入成功，脚本正常退出并报告“测试发现一个失败”，这表示检查成功地完成了诊断，项目仍需修正。脚本应把诊断放进 JSON 的 `message`。如果脚本自己崩溃或输出不合法，程序追加“本地执行后钩子失败”的说明，并保留原工具的内容与错误标志。我们不能据此判断项目测试通过，也不能宣称写入回滚。

`continue: false` 在这个时机没有否决原工具的作用，因为原工具已经返回。需要禁止某项操作，就把条件放到 `before_tool`；需要观察操作造成的状态，就使用 `after_tool`。把同一字段移动到另一个事件，不能改变时间上已经发生的事实。

### 反馈有预算，检查也有成本

传给后置脚本的 `result` 最多保留原结果的前 8000 个 JavaScript 字符串单位；它是检查上下文，不是完整日志传输。脚本若要验证新文件，应该读取项目中的实际目标，而不是把一段工具摘要当成完整文件。脚本的 `message` 最多 4096 个字符串单位，子进程的输出与超时上限继续沿用上一节。

后置检查在每次实际工具正常返回结果后触发，返回对象可以带工具错误标记。前置拒绝或工具直接抛错没有进入这个返回点，不另外运行后置检查。我们通常会在脚本里先按工具名称筛选，只对 `write_file`、`edit_file` 或确实关心的动作执行检查。若每次 `read_file` 都跑全量测试，一个任务中重复的检查就会拉长等待；缩短检查范围应由项目脚本明确表达。

最后看取消发生在什么地方。如果在原工具开始前取消，原工具没有执行；如果写入已经返回、取消发生在后置检查中，程序保留“工具已返回，后置钩子中断，副作用未撤销”的结果，再结束任务。这样历史仍记录已经发生的写入，后续恢复不会把它误读成没有发生。

<!-- media:lesson:start -->
下面跟随 call_8 的真实写入与后置检查。先确认文件已写入，再把“第 8 行仍含 Tab”附到同一条工具结果；下一请求送达后，模型才获得这份检查依据。

<img src="./content/chapter-20-hooks/02-after-tool/assets/hooks-after-feedback-cover-5c079abc6a.png" data-gif-src="./content/chapter-20-hooks/02-after-tool/assets/hooks-after-feedback-21181031b9.gif" data-cover="./content/chapter-20-hooks/02-after-tool/assets/hooks-after-feedback-cover-5c079abc6a.png" data-no-zoom alt="已经写入，检查结果怎样改变模型下一步？">

[静态流程图](/content/chapter-20-hooks/02-after-tool/assets/after-tool-flow-49d8727083.png.md) · [静态封面](/content/chapter-20-hooks/02-after-tool/assets/hooks-after-feedback-cover-5c079abc6a.png.md) · [查看完整静态分镜](/content/chapter-20-hooks/02-after-tool/assets/hooks-after-feedback-storyboard-2546111be9.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/hooks/lifecycle.ts](/content/chapter-20-hooks/02-after-tool/src/hooks/lifecycle.ts.md) | 接纳 after_tool 事件，执行器按同一协议收集反馈。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-20-hooks/02-after-tool/src/agent/agent-loop.ts.md) | 真实工具返回后追加检查信息，失败也保留原执行事实。 |

<!-- generated:files:end -->

## 动手构建

从上一公开小节 20.1 的完整 `src/` 继续。下面只列本节新增与修改的文件；其余实现沿用。新增文件完整保存，修改文件按差异应用到当前工作树。标记中的 `KEEP` 说明来源，不需要为它复制整份未改动文件。

先让配置接纳新事件，再在工具已有返回值的位置调用它。这里保留原结果，再追加反馈，不能在检查失败时倒推工具没有执行。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/hooks/lifecycle.ts 的精确差异</summary>

<!-- source: src/hooks/lifecycle.ts -->
```diff
--- a/src/hooks/lifecycle.ts
+++ b/src/hooks/lifecycle.ts
@@ -1,7 +1,7 @@
 /**
- * 20.1 执行前钩子与显式启用 | [NEW] hooks/lifecycle.ts
+ * 20.2 执行后反馈与真实结果 | [CHANGED] hooks/lifecycle.ts
  *
- * 学习目标：在已获批准的工具启动前串行执行项目检查；只有 before_tool 的 continue=false 能阻止这次工具。
+ * 学习目标：工具返回后再运行项目检查，把反馈附在真实结果后；检查失败不能抹掉已发生的操作。
  * 输入：显式启用状态、项目配置、事件数据与取消信号。
  * 输出：校验后的 HookState，或事件的 blocked/messages；失败以 ToolError 说明。
  * 状态：配置完整校验后才交出列表；脚本自行产生的外部副作用不回滚。
@@ -11,7 +11,7 @@
  *                                             +-- 是 -> 解析单个 JSON -> 收集 message
  *   before_tool 且 continue=false？-- 是 -> blocked；否 -> 下一脚本 / 返回反馈
  *   取消 -> 请求停止同组进程 -> 等待 close 清理 -> 抛出取消原因
- * 观察：检查拒绝时工具尚未启动，错误仍交回原调用；取消要等子进程关闭。
+ * 观察：after_tool 取得已发生的结果；continue=false 不撤销工具，反馈和失败说明留在同一结果中。
  */
 
 import { open, realpath } from "node:fs/promises";
@@ -20,8 +20,9 @@
 import { runProcess } from "../processes/run-process.js";
 import type { ToolCall } from "../tools/registry.js";
 
-// [NEW 20.1] 本文件以下实现均为本节新增。
-export type HookEvent = "before_tool";
+// [KEEP 来自 20.1] 执行器整体来自 20.1；当前事件集合见下方类型。
+// [CHANGED 20.2] 后置输出作为反馈，不重新执行原工具。
+export type HookEvent = "before_tool" | "after_tool";
 type Hook = { command: string; args: string[]; timeout_ms: number };
 export type HookState = { root: string; hooks: Partial<Record<HookEvent, Hook[]>> };
 
@@ -43,7 +44,7 @@
     if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
     const hooks: HookState["hooks"] = {};
     for (const [event, value] of Object.entries(input)) {
-      if (!["before_tool"].includes(event) || !Array.isArray(value) || value.length > 8) throw new Error();
+      if (!["before_tool", "after_tool"].includes(event) || !Array.isArray(value) || value.length > 8) throw new Error();
       hooks[event as HookEvent] = value.map((item: unknown) => {
         if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error();
         const record = item as Record<string, unknown>;
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,7 +1,7 @@
 /**
- * 20.1 执行前钩子与显式启用 | [CHANGED] agent/agent-loop.ts
+ * 20.2 执行后反馈与真实结果 | [CHANGED] agent/agent-loop.ts
  *
- * 学习目标：在本次审批后、工具启动前等待项目检查；检查拒绝或失败也要给原调用留下结果。
+ * 学习目标：串联审批、执行前检查、真实工具与执行后检查；保留原结果，再把附加反馈交给下一次模型。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
  * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
  * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
@@ -51,7 +51,7 @@
  *                  |  次数已用完时不取走剩余补充，界面队列仍保留
  *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
  *                                       +-- 否 -> 保存 assistant 调用 -> C
- *   [CHANGED 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
+ *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
  *   C: [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
  *                                                             +-- 否 -> 原有 deny / ask / allow
  *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
@@ -70,6 +70,7 @@
  *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
  *                                                +-- 否 -> ToolError 或取消 -> D / X
  *                            TUI 面板独占输入；旧请求结束后旧回调失效
+ *   [CHANGED 20.2] 工具真实结果 -> after_tool -> 追加反馈或失败说明 -> D；取消保留已知结果
  *   D: 工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
  *                                                        +-- 是 -> 写完整本地日志、sync、关闭
  *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
@@ -91,13 +92,14 @@
  *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
  *   [KEEP 来自 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
  *
+ *   [NEW 20.2] 工具返回 -> after_tool -> 追加本地反馈/失败说明 -> 原调用结果 -> 下一模型请求
  * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
  * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
  * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
- * 运行观察：即使用户批准，before_tool 仍可阻止尚未执行的操作；原调用收到错误后模型才能继续判断。
+ * 运行观察：after_tool 的反馈随同一工具编号交给模型；检查失败不会把已经写入的文件伪装成未执行。
  */
 
-// [CHANGED 20.1] 钩子在原审批完成后运行，不能创造批准。
+// [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
 import { runHooks } from "../hooks/lifecycle.js";
 import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
 import { explainError, ToolError, UserFacingError } from "../errors.js";
@@ -363,14 +365,28 @@
           // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
           // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
           // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
-          // [CHANGED 20.1] 取消或before失败时尚未启动工具。
+          // [KEEP 来自 20.1] 取消或before失败时尚未启动工具。
           if (mode !== "plan") {
             const before = await runHooks(model.hooks, "before_tool", { call }, signal);
             if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
           }
-          const result = prepared
+          let result = prepared
             ? await executePreparedTool(prepared, signal)
             : await executeTool(call, signal, toolOptions);
+          // [CHANGED 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
+          if (mode !== "plan") {
+            try {
+              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, signal);
+              if (after.messages.length) result = { ...result, content: `${result.content}\n\n[本地执行后钩子反馈；不是权限]\n${after.messages.join("\n")}` };
+            } catch (error) {
+              if (!(error instanceof ToolError)) {
+                turn.push({ role: "tool", toolCallId: call.id, content: result.content + "\n[本地状态] 后置钩子中断；工具已返回，副作用未撤销。", isError: result.isError ?? false });
+                executingCallId = undefined;
+                throw error;
+              }
+              result = { ...result, content: `${result.content}\n[本地执行后钩子失败] ${error.message}` };
+            }
+          }
           // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
           executingCallId = undefined;
           let modelContent: string;
```

</details>

<!-- generated:build:end -->

## 运行验证

先回到仓库根，编译本节完整快照：

```bash
npm run lesson:20.2
```

示例脚本也是完整 TypeScript。仓库中的 [examples/after-tool.ts](/content/chapter-20-hooks/examples/after-tool.ts.md) 与下方内容一致；跟写时将它保存为该文件，再编译。标准输出只写协议 JSON，错误信息写到标准错误。

<details>
<summary>展开完整项目脚本</summary>

```ts
/**
 * 20.2 执行后检查示例 | [NEW 练习] after-tool.ts
 * 学习目标：在实际写入成功后检查文件内容，把制表符提示交回模型。
 * 输入：stdin 中完整的 after_tool 事件，含原调用、执行 outcome 与结果。
 * 输出：单个 message JSON；格式或读取失败写 stderr 并非零退出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整读事件 -> 成功的文件修改？-- 否 -> 空反馈；是 -> 读当前文件 -> 检查制表符 -> 反馈
 * 状态与观察：本脚本只读文件；工具已经完成，反馈不能阻止或撤销之前的写入。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// [NEW 练习] 项目自定义 after_tool 协议实现。

/**
 * 读取一条事件，校验检查脚本需要的字段。
 * 读取并校验输入后执行上面的局部流程；失败交给入口 catch 输出诊断并设置非零退出。
 */
async function main(): Promise<void> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要事件对象");
  const event = value as Record<string, unknown>;
  if (event.event !== "after_tool" || !event.call || typeof event.call !== "object") throw new Error("事件无效");
  const call = event.call as Record<string, unknown>;
  let message = "";
  if (event.outcome === "success" && (call.name === "write_file" || call.name === "edit_file")) {
    if (typeof call.arguments !== "string") throw new Error("缺少调用参数");
    const args: unknown = JSON.parse(call.arguments);
    if (!args || typeof args !== "object" || typeof (args as Record<string, unknown>).path !== "string") {
      throw new Error("缺少 path");
    }
    const path = (args as { path: string }).path;
    const content = await readFile(resolve(path), "utf8");
    message = content.includes("\t")
      ? `格式检查发现 ${path} 含制表符，请改为空格后重新检查。`
      : `格式检查：${path} 未发现制表符。`;
  }
  process.stdout.write(JSON.stringify({ message }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

</details>

仍在仓库根执行以下准备命令。临时项目的 `package.json` 固定工具工作区；脚本编译到这个项目自己的元数据目录。

```bash
export HMA_REPO="$PWD"
DEMO="$(mktemp -d)"
mkdir -p "$DEMO/.hello-my-agent/compiled" "$DEMO/generated" "$DEMO/src"
cat > "$DEMO/package.json" <<'JSON'
{"private":true,"type":"module"}
JSON
"$HMA_REPO/node_modules/.bin/tsc" "$HMA_REPO/chapter-20-hooks/examples/after-tool.ts" \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck \
  --outDir "$DEMO/.hello-my-agent/compiled"
cat > "$DEMO/.hello-my-agent/hooks.json" <<'JSON'
{
  "after_tool": [
    {
      "command": "node",
      "args": [
        ".hello-my-agent/compiled/after-tool.js"
      ],
      "timeout_ms": 5000
    }
  ]
}
JSON
cd "$DEMO"
```

让模型创建一个带制表符的文件，然后读取检查结果。

```bash
hello-my-agent --enable-project-hooks --prompt "请用 write_file 创建 src/format.ts，内容为 export function value() { 换行、一个制表符、return 1; 换行、}。不要运行命令。根据工具结果说明是否需要改进。"
```

批准写入后，真实结果旁会有格式检查反馈。检查发现制表符时，文件仍然已经写入；模型下一次请求可以据此选择修正或解释。它是否真的修正，需继续看之后的工具结果。将脚本中的协议输出临时改成非零退出，会看到“执行后钩子失败”，不能看到“原写入被撤销”。固定请求、原结果和下一次模型输入的断言见练习二。

实验结束后返回仓库根；临时项目可按需保留或删除。

```bash
cd "$HMA_REPO"
rm -rf "$DEMO"
```

## 本节完成后的 Agent

现在，工具真实结果与项目检查反馈会一起进入下一次模型请求。前置可以阻止尚未发生的操作，后置可以检查已经产生的结果；后置失败不会把原操作改写成未执行。下一节处理整项任务结束后只面向本地用户的收尾。

本节已落地的实现与限制如上；本章已于 2026-10-15 按用户通知确认完成。
