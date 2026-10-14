# 第 10 章练习：检查事件怎样变成界面状态

[第 10 章首页](README.md) · [先完成 10.4](04-cancel-and-restore/README.md) · [完整答案](#完整答案)

## 问题：屏幕看起来在变化，状态真的接对了吗

本章把执行事件转换成界面状态。真实模型的回答可以帮助我们体验文字和工具进展，但每次请求的用词、分片和工具选择都可能不同，不适合用来精确检查“有没有漏掉一段文字”“工具完成时有没有更新原来的那一项”。

这次练习使用一个可控的模型替身：它先要求读取临时项目中的 `README.md`，收到真实工具结果以后，再分几段给出固定回答。事件仍由正式执行链产生，界面状态也仍使用正式转换函数。

我们不启动整个终端界面，而是逐条观察它准备显示的数据。这个实验能验证事件与状态的对应关系；实际键盘输入、终端重绘和退出恢复，仍由 10.4 的交互实验检查。

## 练习要求

新增 `chapter-10-terminal-ui/exercises/ui-state.mjs`，保留所有正式源码不变。脚本完成以下过程：

1. 在系统临时目录创建独立项目和 `README.md`，文件里写入一条明确的启动命令。
2. 模型替身第一次调用时返回 `read_file` 请求，第二次调用必须检查历史里出现了真实读取内容。
3. 第二次调用通过文字回调分两段给出回答，再返回相同的完整结果。
4. 用 `for await` 读取正式 `streamAgentRun()`，让每条事件经过正式的界面状态转换。
5. 在工具开始和结束、文字片段到达、整轮结束这些时刻分别检查状态，而不是只检查最后一张画面。
6. 确认最终回答只保留一次；无论成功或失败，都恢复工作目录并清理本实验创建的临时项目。

## 提示：从实际事件推导下一份状态

检查要跟在实际接收到的事件后面。例如，只有读取真的开始以后，事件流才会交出 `tool_start`；让它经过状态转换，然后检查工具项为运行中。随后收到 `tool_finish` 时，检查的是同一个工具编号，而不是新建一个叫作“已完成”的工具项。

文字检查也分两步。第一段到达时，状态中应该出现第一段；第二段到达时，应该已经包含两段。最后的完整结果用于结束显示，不能让两段文字再重复出现。

不要在实验里直接构造一份“已完成”的界面状态。那样只证明断言读到了自己刚写进去的数据，不能证明状态转换接住了正式执行产生的事件。

## 完整答案

创建 `exercises/` 目录，把下面的完整代码保存为 `chapter-10-terminal-ui/exercises/ui-state.mjs`。它从根目录 `dist/` 导入已经构建好的 10.4，因此运行前先完成该节构建。

<!-- solution: exercises/ui-state.mjs -->
```js
/**
 * 第 10 章练习：检查事件怎样变成界面状态 | [NEW 练习]
 *
 * 学习目标：让真实工具与文字事件经过正式状态转换，观察界面为何变化。
 * 输入：临时 README 和本地模型替身；不读取 API Key，不调用真实模型服务。
 * 输出：工具开始与完成、两次文字累计和唯一结束状态；完成后删除自己的临时目录。
 *
 * 练习验证流程（产品全局主流程见 10.4 的 agent/agent-loop.ts）：
 *   临时项目 -> 模型请求 read_file -> 正式读取 -> 模型检查结果并返回两段文字
 *                                  |
 *                                  +-> 正式 AgentRecord -> updateRunView -> 检查当前状态
 *   run_finish -> 回答没有重复、工具已完成？-- 否 -> 断言失败
 *                                             +-- 是 -> 实验通过
 *   无论成功或失败 -> 恢复 cwd -> 清理临时项目
 *
 * 本实验验证显示数据，不验证按键、终端重绘或实际终端兼容性。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamAgentRun } from "../../dist/agent/run-stream.js";
import { emptyRunView, updateRunView, runTranscript } from "../../dist/ui/tui/state.js";

// [NEW 练习] 本文件以下实现均为练习新增，不改变正式界面或 Agent Loop。
/**
 * 使用真实读取产生事件，再验证正式界面状态如何随事件改变。
 *
 * 临时 package.json 确定项目根，模型替身只能读取该目录的 README。
 * 中间断言跟在事件转换后面，防止只检查终态而漏掉过程显示错误。
 * finally 只清理本实验创建的临时目录，不改课程仓库中的文件。
 */
async function main() {
  const originalCwd = process.cwd();
  const project = await mkdtemp(join(tmpdir(), "hello-my-agent-ui-state-"));
  const controller = new AbortController();
  const history = [];
  const parts = ["已读取 README，", "运行 npm run dev 启动。"];
  const finalText = parts.join("");
  let view = emptyRunView();
  let modelCalls = 0;
  let startedTools = 0;
  let finishedTools = 0;
  let textEvents = 0;
  let finishedRuns = 0;
  let receivedText = "";

  const model = {
    async generate(messages, signal, onText) {
      signal.throwIfAborted();
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          text: "", inputTokens: 0, outputTokens: 0, truncated: false,
          finishReason: "tool_calls",
          toolCalls: [{ id: "read_startup", name: "read_file",
            arguments: JSON.stringify({ path: "README.md", offset: 1, limit: 20 }) }],
        };
      }
      assert.equal(modelCalls, 2);
      const result = messages.find((message) => message.role === "tool"
        && message.toolCallId === "read_startup");
      assert.ok(result, "第二次模型调用必须收到正式读取的结果");
      assert.equal(result.isError, false);
      assert.match(result.content, /npm run dev/);
      for (const part of parts) onText?.(part);
      return { text: finalText, toolCalls: [], finishReason: "stop",
        inputTokens: 0, outputTokens: 0, truncated: false };
    },
  };

  try {
    await writeFile(join(project, "package.json"), '{"name":"ui-state-exercise","private":true}\n');
    await writeFile(join(project, "README.md"), "# 临时项目\n\n运行 npm run dev 启动。\n");
    process.chdir(project);

    for await (const { event } of streamAgentRun(
      model, history, "读取 README.md，说明项目怎样启动。", controller.signal,
    )) {
      // 先让正式事件更新正式状态，再检查这一步应该改变的显示数据。
      view = updateRunView(view, event);
      if (event.type === "tool_start") {
        startedTools += 1;
        const tool = view.tools.find((item) => item.sequence === event.sequence);
        assert.ok(tool);
        assert.equal(tool.name, "read_file");
        assert.equal(tool.status, "执行中");
        console.log(`工具 #${tool.sequence}：${tool.status}`);
      }
      if (event.type === "tool_finish") {
        finishedTools += 1;
        assert.equal(event.outcome, "success");
        assert.match(event.result.content, /npm run dev/);
        const tool = view.tools.find((item) => item.sequence === event.sequence);
        assert.ok(tool);
        assert.equal(view.tools.length, 1, "同一次工具结束时应更新原条目");
        assert.equal(tool.status, "完成");
        console.log(`工具 #${tool.sequence}：${tool.status}`);
      }
      if (event.type === "text_delta") {
        textEvents += 1;
        receivedText += event.text;
        const answer = view.answers.find((item) => item.call === event.call);
        assert.ok(answer);
        assert.equal(answer.text, receivedText, "新片段必须接在此前文字后面");
        console.log(`文字 ${textEvents}：${answer.text}`);
      }
      if (event.type === "run_finish") {
        finishedRuns += 1;
        assert.equal(event.outcome, "completed");
        assert.equal(view.status, "已完成");
      }
    }

    assert.equal(modelCalls, 2);
    assert.equal(startedTools, 1);
    assert.equal(finishedTools, 1);
    assert.equal(textEvents, 2);
    assert.equal(finishedRuns, 1);
    assert.deepEqual(view.answers.filter((answer) => answer.text), [{ call: 2, text: finalText }]);
    assert.equal(runTranscript(view).split(finalText).length - 1, 1, "结束摘要不能重复追加完整回答");
    assert.ok(history.some((message) => message.role === "tool"
      && message.toolCallId === "read_startup" && message.isError === false));
    console.log("练习通过：真实事件已更新工具与文字状态，最终回答没有重复。");
  } finally {
    controller.abort();
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  }
}

await main();
```

## 运行与预期结果

在仓库根目录先构建 10.4：

```bash
npm run lesson:10.4
```

再运行刚保存的实验文件：

```bash
node chapter-10-terminal-ui/exercises/ui-state.mjs
```

预期输出：

```text
工具 #1：执行中
工具 #1：完成
文字 1：已读取 README，
文字 2：已读取 README，运行 npm run dev 启动。
练习通过：真实事件已更新工具与文字状态，最终回答没有重复。
```

如果工具结束时出现两个条目，检查是否用工具步骤号更新了原来的那一项。如果第二段覆盖第一段，检查状态转换是否接着上一份状态累积。如果最后的回答出现两遍，检查是否把完整结果再次追加到了流式文字后面。

使用完整配套仓库时，还可以运行已有检查：

```bash
npm run exercise:10
```

已经保存练习文件时，它运行当前文件；尚未创建时，它运行参考答案，并提示自己的练习文件仍不存在。参考答案通过不代表已经完成自己的练习。检查使用独立临时构建，不改变当前注册命令对应的小节。

## 为什么这个实验能帮助我们检查界面

模型替身让输入顺序确定，真实文件工具让读取过程可信，正式状态转换则把两者接到本章的显示规则上。中途检查能够发现“最后碰巧正确、过程却没有显示”的问题；最终检查能发现流式文字与完整结果重复拼接的问题。

练习只新增独立实验，不改变正式运行能力。因此，第十一章继续使用 10.4 的完整 `src/` 作为起点，无需把实验脚本并入产品入口。
