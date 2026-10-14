# 第 13 章练习与答案

[第 13 章首页](README.md) · [返回 13.1：会话保存](01-save-session/README.md)

当前练习对应 13.1。我们先检验保存对象与完成依据，后续再增加有效记录读取与恢复练习。这里的查看脚本只读取正常退出后的临时文件，遇到非法 JSON 就报错；它没有坏尾处理或恢复能力。

## 练习一：三份文字分别保存在哪里

任务 6 正在执行，TUI 出现下面三种状态：

1. “请测试负数”已经被核心收取，进入本轮局部消息，但任务还没结束。
2. `#18`“顺便说明零相加”仍在待处理队列，所属任务为 6。
3. 我们正在编辑 `#18`，编辑稿是“顺便说明两个零相加”，还没有按 Enter 保存。

先从保存对象判断：如果捕获这个时刻的白名单状态，三份文字分别会从哪个对象进入快照，哪份还不会保存？这里只预测数据范围，不增加新的界面保存入口。再预测任务 6 收尾后实际追加的快照有什么变化。

<details>
<summary>参考答案</summary>

第一份已经离开队列，但仍在核心本轮局部消息里，尚未提交到会话 `history`；此时不能仅因“核心已收取”，就认为它已经出现在快照的 `state.messages` 中。任务正常结束或完成中断收束后，核心提交本轮消息，收尾快照才保存这些已提交消息。

第二份从队列进入 `state.pendingInputs`，保留 `id: 18`、原文和 `run: 6`。这说明它仍待处理，没有被写成 user 消息。若任务后续没有收取它，收尾快照仍保留该队列项；它不会自动改属下一项任务。

第三份属于独立编辑稿，尚未明确提交，不在本节白名单中。因此保存的仍是队列原文“顺便说明零相加”。如果原项仍在且编辑保存成功，队列原文才更新，随后由 `queue_change` 检查点记录新文。

保存点捕获的是各字段当时已经持有的值。`messages` 是已提交的模型历史，不等于当前运行中所有局部数据；这也是为什么本节先写文件，还不能直接承诺恢复任何保存点并继续运行。

</details>

## 练习二：查看模式切换与清空历史留下的记录

本练习不修改产品源码。在仓库根目录切换到 13.1：

```bash
npm run lesson:13.1
```

为本次检查创建独立临时目录，再启动文本会话：

```bash
SESSION_DEMO_DIR=$(mktemp -d)
hello-my-agent --output text --session-dir "$SESSION_DEMO_DIR"
```

依次输入下面三行。它们都是本地命令，不会发送模型请求；启动仍沿用已有模型配置要求。

```text
/mode plan
/reset
/exit
```

预测文件中有哪些记录，哪一项能说明 `/reset` 没有删除旧记录。然后在仓库根目录新建 `inspect-session.mts`，只读展示本次文件：

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("请提供本次临时目录。");
const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
if (names.length !== 1) throw new Error("本练习的临时目录应只有一份会话文件。");
const contents = await readFile(join(directory, names[0]), "utf8");
const records = contents.trimEnd().split("\n").map((line) => JSON.parse(line));
console.log("会话头：", records[0]);
console.table(records.filter((record) => record.type === "checkpoint").map((record) => ({
  seq: record.seq,
  reason: record.reason,
  mode: record.state.mode,
  messages: record.state.messages.length,
  tasks: record.state.tasks.length,
  pendingInputs: record.state.pendingInputs.length,
  run: record.state.run,
  nextInputId: record.state.nextInputId,
})));
```

正常退出后，复用仓库已安装的 TypeScript，把查看脚本编译到本次临时目录，再运行生成的文件；产品源码不变：

```bash
npx tsc inspect-session.mts --module NodeNext --target ES2022 --skipLibCheck --outDir "$SESSION_DEMO_DIR/inspection"
node "$SESSION_DEMO_DIR/inspection/inspect-session.mjs" "$SESSION_DEMO_DIR"
```

<details>
<summary>参考答案</summary>

第一行是 `type: "session"` 的会话头，包含 `version: 1`、会话 ID、创建时间与工作区路径。后续依次有 `reason` 为 `mode`、`reset`、`exit` 的三个检查点，编号依次增加。

三个检查点的模式都是 `plan`，消息、清单和队列均为空；因为没有启动任务，`run` 为 0，文本会话的 `nextInputId` 为 1。`reset` 之后，前面的 `mode` 检查点仍在文件里，这说明清空当前历史通过追加新快照表示，没有重写或删除旧记录。

本练习只说明已创建文件、正常保存点的字段与追加顺序。它没有检验工具消息是否完整，也不能仅凭 `JSON.parse` 成功判断这份记录可以恢复。工具历史、当次副本与保存等待，由 13.1 的确定性验证入口进一步检查。

</details>

## 练习三：改变一步，保存结论怎样变化

先判断，再展开答案。

| 变化 | 需要判断的问题 |
| --- | --- |
| 保存 A 只记状态引用，等轮到写文件才复制；等待期间清单由 `in_progress` 变为 `completed` | A 能否证明发起保存时的状态？ |
| 保留串行追加，却把 `sync()` 移到保存 Promise 之外 | `await save()` 返回后还能说哪几步已完成？ |
| 运行中按 Enter 入队后，尚未到任何保存点就强制结束进程 | 能否从“入队成功”推出文字已在文件中？ |
| 任务执行成功，但检查点追加失败 | 是否应把模型任务也改判失败，或者自动重做工具？ |

<details>
<summary>参考答案</summary>

A 不能证明发起时状态。引用随后变化，延迟复制取得的是后来的 `completed`。当次同步复制负责固定内容，串行追加负责固定文件顺序，两者解决不同问题。

若保存 Promise 只包含追加，`await` 返回只能确认被等待的追加操作成功，不能确认同步请求完成。TypeScript 的 `Promise<number>` 仍只描述返回检查点编号的异步接口；完成含义由运行时等待的操作决定。

入队成功保证有效文字已经进入当前进程的队列，不能推出已写入文件。13.1 不为每次 Enter 单独刷盘，这份新文字需要等待任务收尾或其他实际保存点。

任务结果与会话保存结果分别报告。追加失败不改变已经执行的工具及其返回，也不自动触发重试；内存会话仍可继续，但该文件停止追加。自动重做工具可能重复已经发生的操作，保存失败并没有提供重做的依据。

</details>
