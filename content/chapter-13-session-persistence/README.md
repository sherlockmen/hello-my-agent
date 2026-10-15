# 第 13 章：保存、查找与恢复会话

第 12 章让 Agent 能在执行中接收补充、等待回答，也能整理未交付的要求。但这些内容仍在当前进程的内存中。退出以后，工作区里的 TypeScript 文件还在，新进程却不知道上次为什么改它、用什么工具检查过、还有什么要求没处理。

本章把一次讨论保存为本机文件，再逐步建立读取、恢复与管理入口。我们沿同一个小项目展开：`src/add.ts` 实现加法，`test/add.test.ts` 检查负数与零相加。Agent 先检查两个负数相加，退出后再接着讨论零相加；程序需要接上检查依据，也需要明确哪些操作没有完成证明。

## 会话恢复接上讨论，文件恢复改变工作区

假设上次的记录包含“读取 `src/add.ts`”“运行 `npm test`”以及对应工具结果。恢复后把这些消息交给下一次模型请求，模型就能理解已经讨论过什么。程序不会因为看到旧工具调用，再读一次文件或运行一次命令。

工具结果说的是当时返回了什么。会话文件没有为 `src/add.ts` 保存一个可回滚的文件版本，工作区也可能在两次启动之间被人改过。因此，继续修改前仍要检查当前文件和测试。[第 14 章](/content/chapter-14-session-checkpoints/README.md)再实现会话分支与文件检查点，讨论怎样恢复文件，以及恢复范围和冲突。

## 本章路线

| 小节 | 要理解的问题 | 完成后的能力 |
| --- | --- | --- |
| [13.1 会话保存](/content/chapter-13-session-persistence/01-save-session/README.md) | 保存哪些数据，等到哪一步才能说已保存 | 在明确时机捕获完整快照，依次追加并同步到 JSONL 文件 |
| [13.2 读取有效会话记录](/content/chapter-13-session-persistence/02-read-records/README.md) | 为什么最后一份能解析的 JSON 不一定能用 | 顺序检查版本、编号、状态和工具结果关系，取得连续有效记录中的最后一份快照 |
| [13.3 恢复会话并继续讨论](/content/chapter-13-session-persistence/03-resume-session/README.md) | 怎样取得写入权，恢复后什么会继续、什么要重新确认 | 持锁读回并续写同一会话，新输入才开始模型任务；中断情况与工作区差异有明确处理 |
| [13.4 查找、命名与导出会话](/content/chapter-13-session-persistence/04-manage-sessions/README.md) | 怎样识别要恢复的记录，怎样只读查看它 | 列表、命名、文字搜索和只读导出，管理命令不创建模型连接 |
| [本章练习与答案](/content/chapter-13-session-persistence/EXERCISES.md) | 换一种损坏位置或中断时刻，结论会怎样变化 | 用临时会话与确定性脚本检查有效前缀、锁、续写和管理行为 |

JSONL 只规定每行放一条 JSON。有效记录、独占写入和恢复都由本章程序实现，不能由文件扩展名推出来。每节先解释方法，再把同一方法落到对应的完整源码快照。

## 准备本章的 TypeScript 小项目

从 [12.5 队列编辑与撤回](/content/chapter-12-task-control/05-manage-queue/README.md) 的完整 `src/` 继续。第 12 章练习只有验证脚本，没有另一份产品源码要替换。

下面在仓库的编写材料目录创建独立演示项目。它复用仓库已经安装的 TypeScript 和 Node 类型，不增加依赖，也不会改课程源码。后文的 `npm test` 都指这个小项目的测试。

在仓库根目录执行：

```bash
mkdir -p docs/.work/ch13-typescript-demo/src docs/.work/ch13-typescript-demo/test
cat > docs/.work/ch13-typescript-demo/package.json <<'JSON'
{"private":true,"type":"module","scripts":{"test":"tsc -p tsconfig.json && node --test build/test/add.test.js"}}
JSON
cat > docs/.work/ch13-typescript-demo/tsconfig.json <<'JSON'
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"outDir":"build","rootDir":".","types":["node"]},"include":["src/**/*.ts","test/**/*.ts"]}
JSON
cat > docs/.work/ch13-typescript-demo/src/add.ts <<'TS'
export function add(a: number, b: number): number {
  return a + b;
}
TS
cat > docs/.work/ch13-typescript-demo/test/add.test.ts <<'TS'
import assert from "node:assert/strict";
import test from "node:test";
import { add } from "../src/add.js";

test("两个负数相加", () => assert.equal(add(-2, -3), -5));
test("两个零相加", () => assert.equal(add(0, 0), 0));
TS
```

进入演示工作区，先确认已有测试可运行：

```bash
cd docs/.work/ch13-typescript-demo
npm test
```

两项测试应通过。之后可以让 Agent 读取这些 TypeScript 文件并检查测试依据；本章的目标是保存和接上讨论，不需要制造一个加法错误。

切换学习快照时先回仓库根目录，依次使用 `npm run lesson:13.1` 到 `npm run lesson:13.4`。构建只选择和注册当前小节，不自动调用模型；运行时再进入上面的演示工作区执行 `hello-my-agent`。各节的运行验证会说明会话目录与需要观察的结果。
