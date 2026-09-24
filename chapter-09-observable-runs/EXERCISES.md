# 第 09 章练习：记录一次工具调用用了多久

[第 09 章首页](README.md) · [先完成 09.3](03-jsonl-output/README.md) · [完整答案](#完整答案)

## 问题：不修改核心，能观察真实工具的执行吗

本章让消费者按顺序收到任务事件。接下来，我们写一个自己的消费者：收到 `tool_start` 时记下本地时间，收到同一次调用的 `tool_finish` 时再次计时，显示两次观察之间经过了多久。

我们继续使用“读取 README，说明怎样启动”的任务。模型由本地替身提供固定输出，读取则交给正式的 `read_file` 工具。这样不需要模型账号，也不会因为模型选择了另一种做法，就失去要观察的工具事件。

这次测得的是**消费者观察到的时间间隔**。它包含事件送达和本地调度的影响，不能当成文件系统的精确读取性能。练习要学的是：从同一条事件流里配对开始与结束，不进入核心添加打印语句。

## 练习要求

新增 `chapter-09-observable-runs/exercises/tool-timing.mjs`，不修改正式源码。脚本完成下面的过程：

1. 在系统临时目录建立自己的项目，准备含启动说明的 `README.md`。
2. 让模型替身先提出完整的 `read_file` 请求，使用真实工具读取这个文件。
3. 用 `for await` 读取 `streamAgentRun()`，确认同一轮的 `runId` 不变，外层 `sequence` 从 1 开始连续增加。
4. 按 `event.sequence` 配对 `tool_start` 与 `tool_finish`，记录本地时间并打印间隔。
5. 让模型替身检查自己收到的真实工具结果，再给出最终回答；确认只有一个正常结束事件。
6. 无论成功或失败，都恢复原来的工作目录并清理自己的临时文件。

时间数据留在消费者自己的 `Map` 里。不要给正式工具新增计时参数，也不要直接伪造 `tool_finish`；只有真实工具运行后发出的事件，才能说明这次配对接到了正式执行流程。

## 提示：先分清两个顺序号

外层 `record.sequence` 是每条事件的编号，所以开始与结束一定不同。里面的 `record.event.sequence` 才是工具调用编号，同一次工具的开始与结束使用同一个值。

```text
record.sequence = 5，event.sequence = 1，tool_start
                      ↓ Map 以 1 为键，记下开始时间
record.sequence = 6，event.sequence = 1，tool_finish
                      ↓ 仍以 1 查找，算出时间间隔并删除记录
```

实际运行中的外层编号取决于此前产生了多少条事件。这里的 5 和 6 只演示两个编号之间的关系，答案不应该靠它们硬编码定位工具。

本练习只消费一轮，`Map` 也在这一轮内创建。若以后把多轮放进一个统计器，键还要包含 `runId`，否则每轮从 1 开始的工具编号会相互覆盖。

## 完整答案

创建 `exercises/` 目录，把下面内容保存为 `chapter-09-observable-runs/exercises/tool-timing.mjs`。它从根目录的 `dist/` 导入已经构建好的 09.3，运行前先完成该节构建。

<!-- solution: exercises/tool-timing.mjs -->
```js
/**
 * 第 09 章练习：记录一次工具调用用了多久 | [NEW 练习]
 *
 * 学习目标：不修改 Agent Loop，使用事件编号配对真实工具的开始与结束。
 * 输入：本地模型替身和临时 README；不访问模型服务，也不读取 API Key。
 * 输出：工具事件编号、本地观察耗时和唯一完成状态；结束后删除自己的临时目录。
 *
 * 练习验证流程（产品全局主流程见 09.3 的 agent/agent-loop.ts）：
 *   临时项目 -> 模型请求 read_file -> 正式工具读取 -> 结果再次交给模型
 *                                  |
 *                                  +-> tool_start -> Map 保存本地时间
 *                                  +-> tool_finish -> 按工具编号配对 -> 打印间隔
 *   模型返回回答 -> run_finish -> 顺序、配对与结果正确？-- 否 -> 断言失败
 *                                                       +-- 是 -> 实验通过
 *   无论成功或失败 -> 恢复 cwd -> 清理临时项目
 *
 * 计时点在消费者收到事件时，包含事件送达与调度影响，不是精确的磁盘性能测量。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { streamAgentRun } from "../../dist/agent/run-stream.js";

// [NEW 练习] 本文件以下实现均为练习新增，不改变正式运行流程。
/**
 * 用真实读取产生工具事件，再检查消费者记录的顺序与配对。
 *
 * 临时 package.json 把临时目录标成项目根；模型替身只请求读取该目录的 README。
 * 第二次模型调用必须收到实际读取结果，实验才允许返回最终回答。
 * finally 只清理本实验创建的目录，不覆盖或删除课程仓库中的文件。
 */
async function main() {
  const originalCwd = process.cwd();
  const project = await mkdtemp(join(tmpdir(), "hello-my-agent-timing-"));
  const controller = new AbortController();
  const history = [];
  const started = new Map();
  let runId;
  let lastSequence = 0;
  let modelCalls = 0;
  let finishedTools = 0;
  let finishedRuns = 0;

  const model = {
    async generate(messages, signal, onText) {
      signal.throwIfAborted();
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          text: "", inputTokens: 0, outputTokens: 0, truncated: false,
          finishReason: "tool_calls",
          toolCalls: [{
            id: "read_startup", name: "read_file",
            arguments: JSON.stringify({ path: "README.md", offset: 1, limit: 20 }),
          }],
        };
      }
      assert.equal(modelCalls, 2);
      const result = messages.find((message) => message.role === "tool"
        && message.toolCallId === "read_startup");
      assert.ok(result, "第二次模型请求应该收到真实工具结果");
      assert.equal(result.isError, false);
      assert.match(result.content, /npm run dev/);
      const text = "已读取 README.md，可使用 npm run dev 启动。";
      onText?.(text);
      return {
        text, toolCalls: [], finishReason: "stop",
        inputTokens: 0, outputTokens: 0, truncated: false,
      };
    },
  };

  try {
    await writeFile(join(project, "package.json"), '{"name":"timing-exercise","private":true}\n');
    await writeFile(join(project, "README.md"), "# 临时项目\n\n运行 npm run dev 启动。\n");
    process.chdir(project);

    for await (const record of streamAgentRun(
      model, history, "读取 README.md，说明项目怎样启动。", controller.signal,
    )) {
      // 外层编号检查事件顺序；每轮工具编号则用于下面的配对。
      assert.equal(record.version, 1);
      assert.equal(record.sequence, lastSequence + 1);
      lastSequence = record.sequence;
      runId ??= record.runId;
      assert.equal(record.runId, runId);
      if (record.sequence === 1) assert.equal(record.event.type, "run_start");

      const event = record.event;
      if (event.type === "tool_start") {
        assert.equal(started.has(event.sequence), false);
        started.set(event.sequence, { time: performance.now(), name: event.call.name });
        console.log(`事件 ${record.sequence}：工具 #${event.sequence} ${event.call.name} 开始`);
      }
      if (event.type === "tool_finish") {
        const start = started.get(event.sequence);
        assert.ok(start, "工具结束前应该有同一编号的开始事件");
        assert.equal(start.name, event.call.name);
        const elapsed = performance.now() - start.time;
        assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
        assert.equal(event.outcome, "success");
        assert.match(event.result.content, /npm run dev/);
        started.delete(event.sequence);
        finishedTools += 1;
        console.log(`事件 ${record.sequence}：工具 #${event.sequence} ${event.call.name} 完成，本地观察耗时 ${elapsed.toFixed(2)} ms`);
      }
      if (event.type === "run_finish") {
        finishedRuns += 1;
        assert.equal(event.outcome, "completed");
        console.log(`任务完成：${event.reply.text}`);
      }
    }

    assert.equal(modelCalls, 2);
    assert.equal(finishedTools, 1);
    assert.equal(finishedRuns, 1);
    assert.equal(started.size, 0, "正常结束后不应留下未配对的工具开始记录");
    assert.ok(history.some((message) => message.role === "tool"
      && message.toolCallId === "read_startup" && message.isError === false));
    console.log("练习通过：真实读取已完成，事件顺序连续，工具开始与结束已配对。");
  } finally {
    controller.abort();
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  }
}

await main();
```

这段答案没有把所有事件保存成一个数组。消费者只保存尚未结束的工具开始时间，等对应的结束事件到来后就删除；其他事件读取过以后继续向前。

`performance.now()` 适合计算同一进程内的时间间隔，打印出来的毫秒值会随机器和调度变化。断言只要求它是非负有限数，不要求每次恰好读了几毫秒。真正需要固定验证的是：事件顺序正确、开始与结束属于同一次调用、模型确实收到读取结果。

## 运行验证

先在仓库根目录构建 09.3：

```bash
npm run lesson:09.3
```

再运行刚保存的实验文件：

```bash
node chapter-09-observable-runs/exercises/tool-timing.mjs
```

输出会类似下面这样，耗时不要求一致：

```text
事件 5：工具 #1 read_file 开始
事件 6：工具 #1 read_file 完成，本地观察耗时 1.23 ms
任务完成：已读取 README.md，可使用 npm run dev 启动。
练习通过：真实读取已完成，事件顺序连续，工具开始与结束已配对。
```

如果找不到配对的开始记录，先检查是否误用了外层 `record.sequence` 作为工具键。如果第二次模型调用没有收到 `npm run dev`，检查工具请求是否包含 `path`、`offset`、`limit`，以及是否真正执行了 `read_file`。

使用完整配套仓库时，还可以运行已有检查：

```bash
npm run exercise:09
```

已经创建练习文件时，它检查当前文件；尚未创建时，它检查参考答案，并提示练习文件仍不存在。参考答案通过不代表自己的练习已经完成。检查使用独立临时构建，不改变当前命令对应的小节。

## 完成练习以后

我们已经写出第二种用途的事件消费者：不负责回答、不执行工具，只根据正式执行发出的事件记录一次读取。它还检查了工具结果确实回到模型，最终回答与结束事件都来自同一轮任务。

练习新增的是独立实验文件。第十章从 09.3 的正式源码继续，把这里已经能读取的事件显示成 TUI 中的消息、工具状态和任务状态。
