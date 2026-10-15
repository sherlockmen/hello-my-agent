# 13.4 查找、命名与导出会话

[第 13 章首页](/content/chapter-13-session-persistence/README.md) · [上一节：13.3 恢复会话并继续讨论](/content/chapter-13-session-persistence/03-resume-session/README.md) · [本章练习与答案](/content/chapter-13-session-persistence/EXERCISES.md) · [下一章：会话分支与文件检查点](/content/chapter-14-session-checkpoints/README.md)

## 问题：有了会话 ID，几天后怎样找到那次讨论

我们已经能保存、读取和恢复会话。实际使用几天后，目录里会有许多 UUID 文件。想找“检查 `src/add.ts` 中负数相加”的讨论，逐个打开文件既慢，也容易把另一个工作区的记录认成当前项目。

会话还可能需要交给自己稍后阅读：保留模型依据了哪次工具结果、哪些补充仍未交付，同时不为了查看记录就启动模型，也不为了给会话起名字重写整份历史。

本节给出三个管理入口：先列出和搜索可识别的摘要，用名称补充辨认线索，再把已经验证的状态导出成 Markdown 阅读副本。恢复仍然使用明确的完整 ID，并核对原工作区。

## 解决方案：从同一个读取结果生成列表、名称和阅读副本

列表逐个调用 `readSession()`，从有效状态提取完整 ID、名称、更新时间、工作区、消息数、待处理数和中断提示。没有明确名称时，以第一条用户消息的首行作为辨认线索；都没有时显示“未命名会话”。搜索在这些来源中的 ID、名称、工作区和消息正文里匹配文字。

名称是追加的元数据，不改变会话身份。命名先取得上一节的独占 writer，再追加一条 `name` 记录；它与检查点共享编号，历史消息与检查点保持原样。

导出只读最后有效状态，将用户、Agent、工具调用与结果排成 Markdown，另列本地清单和未交付队列。它默认输出到标准输出；指定文件时仅创建新文件，目标已存在就拒绝。管理命令在创建模型配置与模型客户端之前分流，因此本地查看不依赖网络，也不会执行历史工具。

## 工作原理

### 先从已验证数据提取线索，再选择明确的身份

假设目录里有两份讨论，都出现过 `src/add.ts`。列表中的名称方便人辨认，完整会话 ID 才是恢复与命名的对象：

| 摘要字段 | 来自哪里 | 能帮助我们判断什么 |
| --- | --- | --- |
| 完整 ID | 文件名与会话头的一致性检查 | 后续命令究竟选择哪一份记录 |
| 名称 | 最后一条名称元数据；没有时取第一条 user 消息首行 | 这次讨论大致做过什么 |
| 更新时间 | 最后一条有效记录的时间；只有会话头时取创建时间 | 哪份记录最近仍有保存动作 |
| 工作区 | 会话头里的 `cwd` | 同名相对路径属于哪个项目 |
| 消息数、待处理数 | 最后完整状态中的两个数组 | 当前保存了多少消息，是否还留有未交付要求 |
| 中断提示 | 尚未被结束记录收尾的 `run_start` | 是否需要先核对实际文件与进程 |

消息数统计的是消息对象，不是用户提问数：一次“读文件，再测试”的任务会产生 assistant 工具调用、tool 结果和最终回答等多条消息。待处理数也不能算作已发给模型的消息。

列表按记录时间从近到远排序，同时间用 ID 固定次序。时间来自记录本身，不是执行完成的证明。名称、路径等显示文字会移除终端控制字符，避免历史文字变成终端控制操作。

一个文件损坏，不应让其他正常会话从列表里消失。列表对每个文件独立验证：能读的生成摘要，不能读的单独警告并跳过。它不会为显示列表修复坏行，也不会把损坏文件误报成空会话。

搜索只做本地文本匹配，忽略大小写。它搜索 ID、名称、工作区和最后保存历史中的消息正文，不会把旧检查点中的已清空消息、队列文字或工具参数一并当成搜索范围。比如 `/reset` 后最后状态的历史为空，旧检查点仍在文件里，但列表搜索不再从旧历史中寻找关键词。

### 名称与检查点共用顺序，命名不替换原记录

假设 #8 是测试结束的检查点。命名会在后面追加 #9 的 `name` 记录，接下来的任务保存 #10。读取时，#9 更新名称，#10 更新状态；两种记录分别保留最近的值。

这解释了两个行为：命名后消息数不变，恢复后仍从统一编号继续。名称没有被塞进 `state.messages`，不会作为一条用户要求发送给模型；重命名也不会删除以前的名称记录。

命名属于写入，因此必须取得同一把锁。会话正在运行时，管理进程不能绕过它修改名称；正常退出、释放锁后再命名。中断会话也不能借命名跳过恢复检查，应先按上一节显式接管、核对并正常结束，再做管理。

本节名称长度为 1—80 个字符，去掉首尾空白后不能为空，不能带换行、终端控制或双向文本控制字符。名称可以重复；重复名称不合并会话，也不允许用模糊名称代替 ID 执行恢复。

图中沿着同一份会话看命名前后的变化：名称记录追加到文件尾，列表再把名称与最后状态组合成摘要。A 是图中的讨论用简称，实际命令使用完整 UUID。

<img src="./content/chapter-13-session-persistence/04-manage-sessions/assets/find-and-name-a204abd2ce.png" alt="给会话追加名称后，以相同完整 ID 列出和搜索，最后检查点中的消息与队列保持原样">

### 导出是一个状态的阅读副本，工具文字始终是文字

导出先运行同一读取器，因此完整坏行、未知版本或错误工具 ID 配对不会被美化成可信文档。有效前缀后面若有未完成尾片，导出可以呈现有效状态，并带上原有警告；它不截断源文件。

Markdown 里保留角色与工具调用 ID。于是我们能沿着“模型提出 `read-1` → 工具 `read-1` 返回 `src/add.ts` → 模型提出 `test-1` → 测试返回 → 模型解释”核对结论。工具参数和返回内容放在代码围栏中；围栏长度会避开内容里已有的反引号，防止一段工具输出提前结束代码块。

导出保留清单状态与未交付补充的 ID、原任务归属，并明确说明这些补充没有因导出而发送。若上次任务中断，也保留“没有结束记录”的提示，不能把最后几行排成漂亮文档就宣布操作完成。

它没有打包 `src/add.ts`、`test/add.test.ts` 的当前文件，没有导出授权、环境变量或正在运行的进程，也没有生成另一份可恢复 JSONL。恢复入口只接受原会话 ID；把 Markdown 移到另一个项目，不会让其中的相对路径安全地属于那个项目。

默认写到标准输出，便于直接阅读或交给 shell 管道。使用 `--export-to` 时，程序用 `wx` 创建目标；现有文件和符号链接都会导致失败，因此不会覆盖已有笔记。这里的“不覆盖”来自文件创建方式，不是先检查一次路径再写入——检查与写入之间仍可能有别的进程创建同名文件。

下面把阅读副本与执行入口并排观察。导出保留消息关系供人核对，恢复仍须回到原会话、原工作区并取得写入权；把文档拷贝到别处并没有完成这些检查。

<img src="./content/chapter-13-session-persistence/04-manage-sessions/assets/export-and-workspace-3adabe59c9.png" alt="导出只读生成保留工具关系的 Markdown，新文件拒绝覆盖，恢复仍核对会话的原工作区">

### 管理路径在模型初始化之前结束

`--sessions`、`--rename` 和 `--export` 都是本地操作。CLI 先验证参数组合，再调用对应管理函数，打印结果后返回；只有普通新建或恢复执行会话才继续读取模型配置与创建客户端。

一次命令只选择一个管理动作。`--search` 只跟 `--sessions`，`--name` 只跟 `--rename`，`--export-to` 只跟 `--export`；管理动作独立使用，不与恢复、prompt、模型、模式或输出模式选项混用。这样参数先决定一条明确的本地路径，不会一边导出、一边启动执行会话。

因而“没有 API Key 也能列出和导出”有明确的结构原因：这些路径根本没有走到模型初始化。它们也不调用 Agent Loop，历史里的 `run_command` 只会成为摘要或文档内容。

只读列表和导出没有持有 writer 的锁，看到的是一次读取取得的有效状态。若原会话随后继续保存，它们不会自动刷新；这个结果适合识别和阅读，恢复仍须按 13.3 在持锁后重新读取、核对工作区。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/sessions/manage-sessions.ts](/content/chapter-13-session-persistence/04-manage-sessions/src/sessions/manage-sessions.ts.md) | 从读取结果生成列表、搜索与 Markdown；通过独占 writer 追加名称 |
| CHANGED | [src/cli.ts](/content/chapter-13-session-persistence/04-manage-sessions/src/cli.ts.md) | 在模型配置之前处理互斥的本地管理命令，验证参数并输出结果 |

## 动手构建

从 13.3 的完整 `src/` 继续，目标目录为 `chapter-13-session-persistence/04-manage-sessions/`。先把读取结果投影为摘要和 Markdown，再接入 CLI 的本地管理分支。我们复用读取器和独占 writer，不另写一套宽松 JSON 解析，也不让管理入口调用执行循环。

### 新增本地管理模块

新建 `src/sessions/manage-sessions.ts`，写入下面完整文件。列表逐份验证，名称经 writer 追加，导出只从读取结果排版；三者都没有模型参数，也没有调用 Agent Loop。Markdown 围栏按正文中最长的连续反引号增长，工具返回文字始终留在代码块内。

<details>
<summary>完整文件：src/sessions/manage-sessions.ts</summary>

<!-- source: src/sessions/manage-sessions.ts -->
```ts
/**
 * 13.4 查找与导出会话 | [NEW] sessions/manage-sessions.ts
 *
 * 学习目标：从可信记录生成列表、标题和 Markdown；管理动作不创建模型请求。
 * 输入：会话目录、搜索文字、明确的会话 ID 和可选导出路径。
 * 输出：摘要列表、追加的名称记录或只读 Markdown 副本。
 * 状态：命名复用独占 writer；读取与导出不改历史，不执行历史中的工具。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   列目录 -> 逐个 readSession -> 摘要 / 报告损坏文件 -> 搜索 -> 显示
 *   改名 -> resumeSessionWriter 拿锁 -> rename -> close 释放锁
 *   导出 -> readSession -> Markdown -> stdout / wx 新文件；已有目标拒绝覆盖
 */
import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import { DEFAULT_SESSION_DIRECTORY, readSession, validateSessionName, type ReadSessionResult } from "./read-session.js";
import { resumeSessionWriter, explainSessionError } from "./save-session.js";

// [NEW 13.4] 摘要保留完整 ID；标题只是便于辨认的标签，不能代替身份。
export type SessionSummary = { id: string; name: string; updatedAt: string; cwd: string; messages: number; pending: number; interrupted: boolean };
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");

/** 顺序读取每个候选文件；一个损坏文件不让其他会话从列表消失。 */
export async function listSessions(directory = DEFAULT_SESSION_DIRECTORY, search = ""): Promise<{ sessions: SessionSummary[]; warnings: string[] }> {
  let entries;
  try { entries = await readdir(resolve(directory), { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [], warnings: [] };
    throw new UserFacingError(`无法列出会话：${explainSessionError(error)}`);
  }
  const sessions: SessionSummary[] = [], warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.slice(0, -6);
    try {
      const record = await readSession(id, directory);
      const messages = record.state?.messages ?? [];
      const name = record.name ?? messages.find((message) => message.role === "user")?.content.split("\n")[0].slice(0, 60) ?? "未命名会话";
      const searchable = [id, name, record.header.cwd, ...messages.map((message) => message.content)].join("\n").toLocaleLowerCase();
      if (search && !searchable.includes(search.toLocaleLowerCase())) continue;
      sessions.push({ id, name: plain(name), updatedAt: record.updatedAt ?? record.header.createdAt, cwd: plain(record.header.cwd), messages: messages.length, pending: record.state?.pendingInputs.length ?? 0, interrupted: record.interrupted });
      warnings.push(...record.warnings.map((warning) => `${id}：${plain(warning)}`));
    } catch (error) { warnings.push(`${plain(entry.name)}：${error instanceof UserFacingError ? plain(error.message) : "无法读取，已跳过"}`); }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { sessions, warnings };
}

/** 改名追加一条事件，沿用锁与保存队列；不重写已有消息和工具结果。 */
export async function renameSession(id: string, name: string, directory?: string): Promise<number> {
  const title = validateSessionName(name);
  const writer = await resumeSessionWriter(id, directory);
  try { return await writer.rename(title); } finally { await writer.close(); }
}

/** 采用足够长的围栏，记录里的 Markdown 不会提前关闭代码块。 */
function block(text: string, language = "text"): string {
  const lengths = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...lengths.map((length) => length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}

/** 将验证后的一个快照投影为阅读副本，保留调用 ID 与结果，不伪装成可恢复文件。 */
export function sessionMarkdown(record: ReadSessionResult): string {
  const lines = [`# ${plain(record.name ?? "会话导出")}`, "", `会话 ID：${record.header.sessionId}`, "", `工作区：${plain(record.header.cwd)}`, "", "这是本地保存状态的阅读副本。工具文字不会被执行；项目文件和访问权限不在导出范围。", ""];
  if (record.interrupted) lines.push("> 上次任务没有留下结束记录；以下内容不能证明崩溃前的操作已经完成。", "");
  for (const warning of record.warnings) lines.push(`> ${plain(warning)}`, "");
  for (const message of record.state?.messages ?? []) {
    lines.push(`## ${message.role === "user" ? "用户" : message.role === "assistant" ? "Agent" : `工具 ${plain(message.toolCallId)} · ${message.isError ? "失败" : "已返回"}`}`, "", block(message.content), "");
    if (message.role === "assistant") for (const call of message.toolCalls ?? []) lines.push(`调用 ${plain(call.id)}：${plain(call.name)}`, "", block(call.arguments, "json"), "");
  }
  if (record.state) {
    lines.push("## 本地状态", "", `模式：${record.state.mode}；任务编号：${record.state.run}；下一补充编号：${record.state.nextInputId}。`, "");
    for (const task of record.state.tasks) lines.push(block(`${task.id} · ${task.status} · ${task.text}`), "");
    lines.push("## 尚未交付的补充", "", "这些文字保持原任务归属；导出不表示它们已经发送给模型。", "");
    for (const input of record.state.pendingInputs) lines.push(block(`#${input.id} → 任务 ${input.run}\n${input.text}`), "");
  }
  return lines.join("\n");
}

/** 默认交给 stdout；显式路径只创建新文件，避免覆盖已有笔记或符号链接。 */
export async function exportSession(id: string, directory?: string, destination?: string): Promise<string> {
  const markdown = sessionMarkdown(await readSession(id, directory));
  if (destination !== undefined) {
    if (!destination.trim()) throw new UserFacingError("--export-to 不能为空。");
    try { await writeFile(resolve(destination), markdown, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) { throw new UserFacingError(`无法导出会话（已有文件不会覆盖）：${explainSessionError(error)}`); }
  }
  return markdown;
}
```

</details>

### 在读取模型配置之前接入管理分支

以 13.3 的 `src/cli.ts` 为起点应用下面完整 diff。管理参数先决定一个动作，执行和打印后立即返回，后面的 `readConfig()` 与模型创建只属于执行会话。`--export` 默认直接写标准输出，避免再混入一行成功提示破坏 Markdown；指定目标文件才输出保存位置。

<details>
<summary>完整改动：src/cli.ts</summary>

<!-- source: src/cli.ts -->
```diff
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,6 +1,6 @@
 #!/usr/bin/env node
 /**
- * 13.3 恢复会话 | [CHANGED] cli.ts
+ * 13.4 查找与导出会话 | [CHANGED] cli.ts
  *
  * 学习目标：为人类交互入口创建会话文件，把存储句柄交给消费者，并在正常退出时关闭它。
  * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
@@ -35,7 +35,7 @@
  */

 import { readFileSync } from "node:fs";
-// [CHANGED 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
+// [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
 import { realpath } from "node:fs/promises";
 import { Command } from "commander";
 import { readConfig, type Options } from "./config/load-config.js";
@@ -47,6 +47,8 @@
 import { UserFacingError, explainError } from "./errors.js";
 // [KEEP 来自 13.1] 入口创建并最终关闭 writer，模型配置不进入存储模块。
 import { createSessionWriter, resumeSessionWriter } from "./sessions/save-session.js";
+// [NEW 13.4] 本地管理复用读取与写入协议，无需模型配置。
+import { listSessions, renameSession, exportSession } from "./sessions/manage-sessions.js";

 // [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
 const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
@@ -67,7 +69,7 @@
 }
 // [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
 // [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
-type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean };
+type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string };
 const program = new Command();
 program
   // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
@@ -90,12 +92,47 @@
   .option("--mode <mode>", "模式：plan 或 execute（新会话默认 execute，恢复沿用已保存模式）")
   // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
   .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
-  // [CHANGED 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
+  // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
   .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
   .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
+  // [NEW 13.4] 显式管理动作在读取模型配置前完成。
+  .option("--sessions", "列出本地会话，可配合 --search")
+  .option("--search <text>", "在会话 ID、名称、工作区和已保存消息中搜索")
+  .option("--rename <id>", "给指定会话追加名称，需要 --name")
+  .option("--name <text>", "会话名称，1—80 个字符")
+  .option("--export <id>", "将指定会话导出为 Markdown，默认输出到 stdout")
+  .option("--export-to <path>", "导出到一个尚不存在的文件，需要 --export")
   // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
   .action(async () => {
     const options = program.opts<CliOptions>();
+    // [NEW 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
+    const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
+    if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
+    if (options.search !== undefined && !options.sessions) throw new UserFacingError("--search 必须与 --sessions 一起使用。");
+    if (options.name !== undefined && options.rename === undefined) throw new UserFacingError("--name 必须与 --rename <id> 一起使用。");
+    if (options.exportTo !== undefined && options.export === undefined) throw new UserFacingError("--export-to 必须与 --export <id> 一起使用。");
+    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
+    if (management) {
+      if (options.resume !== undefined || options.recover || options.prompt !== undefined || options.doctor
+        || options.mode !== undefined || options.model !== undefined || options.provider !== undefined || options.baseUrl !== undefined || options.output !== "auto") {
+        throw new UserFacingError("本地会话管理请单独使用，不与恢复、提问、模型或输出模式选项混用。");
+      }
+      if (options.sessions) {
+        const result = await listSessions(options.sessionDir, options.search);
+        for (const warning of result.warnings) console.error(`会话提示：${warning}`);
+        if (!result.sessions.length) console.log("没有匹配的本地会话。");
+        for (const session of result.sessions) console.log(`${session.id}  ${session.name}\n  ${session.updatedAt} · ${session.messages} 条消息 · ${session.pending} 条待交付${session.interrupted ? " · 上次中断" : ""}\n  ${session.cwd}`);
+      } else if (options.rename !== undefined) {
+        if (options.name === undefined) throw new UserFacingError("--rename <id> 需要 --name <text>。");
+        const seq = await renameSession(options.rename, options.name, options.sessionDir);
+        console.log(`名称已保存：${options.rename} · 第 ${seq} 条记录。`);
+      } else {
+        const markdown = await exportSession(options.export!, options.sessionDir, options.exportTo);
+        if (options.exportTo === undefined) process.stdout.write(markdown);
+        else console.log(`已导出：${options.exportTo}`);
+      }
+      return;
+    }
     if (options.doctor) {
       printDoctor();
       return;
@@ -135,7 +172,7 @@
       : await createSessionWriter(options.sessionDir);
     console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
     try {
-      // [CHANGED 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
+      // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
       const restored = writer.restored;
       const initial = restored?.state;
       if (restored) {
```

</details>

## 运行验证

在仓库根目录切换完整快照：

```bash
npm run lesson:13.4
```

运行本章检查：

```bash
npm run check:13
```

沿用 13.3 正常退出后留下的 `SESSION_DEMO_DIR` 和完整 `SESSION_ID`。先列出，再给刚才的讨论命名：

```bash
hello-my-agent --session-dir "$SESSION_DEMO_DIR" --sessions
hello-my-agent --session-dir "$SESSION_DEMO_DIR" --rename "$SESSION_ID" --name 'add.ts 负数与零相加'
hello-my-agent --session-dir "$SESSION_DEMO_DIR" --sessions --search '负数'
```

应看到同一个完整 ID、更新后的名称、原工作区和消息数。命名前后源文件只多一条名称记录，消息、清单和队列不变。若会话仍被另一个进程打开，命名应报锁占用，先在原会话正常退出。

将阅读副本写入一个新的临时目录：

```bash
SESSION_EXPORT_DIR=$(mktemp -d)
hello-my-agent --session-dir "$SESSION_DEMO_DIR" --export "$SESSION_ID" --export-to "$SESSION_EXPORT_DIR/add-session.md"
cat "$SESSION_EXPORT_DIR/add-session.md"
```

核对工具调用 ID、测试输出、最终解释以及未交付补充。再次执行同一条导出命令，应拒绝覆盖已有文件。只想在终端阅读时，省略 `--export-to`：

```bash
hello-my-agent --session-dir "$SESSION_DEMO_DIR" --export "$SESSION_ID"
```

[练习四](/content/chapter-13-session-persistence/EXERCISES.md?id=%E7%BB%83%E4%B9%A0%E5%9B%9B%E9%AA%8C%E8%AF%81%E7%AE%A1%E7%90%86%E4%B8%8D%E6%94%B9%E5%8E%86%E5%8F%B2%E4%B9%9F%E4%B8%8D%E5%90%AF%E5%8A%A8%E6%A8%A1%E5%9E%8B)会在没有模型配置的临时工作区中运行管理命令，比较源文件字节，并检查重命名、损坏文件警告和拒绝覆盖。

## 本节完成后的 Agent

Agent 能先在本地列出、搜索和命名会话，再按明确 ID 选择继续讨论；也能把已经保存的历史、工具依据与未交付要求导出为阅读副本。查看与导出不会发起模型请求，命名沿用独占写入和统一编号。

本章把“当前进程里的讨论”变成了可验证、可识别、可继续的本地记录。会话记录仍不能替代工作区文件。下一章处理文件检查点，让讨论状态与文件状态之间的差别也有可检查的入口。
