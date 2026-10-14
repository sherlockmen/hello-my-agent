# 第 08 章练习：取消以后，下一轮还知道什么

[第 08 章首页](README.md) · [先完成 08.3](03-cancel-and-continue/README.md) · [完整答案](#完整答案)

## 问题：已经创建的文件，会随着取消一起消失吗

本章已经让任务中断以后还能继续对话。接下来，我们用一次不访问模型服务的小实验，观察取消前后究竟留下了什么。

实验中的模型由我们自己编写。第一次调用时，它请求创建一个文件；拿到真实工具结果后，第二次调用只发出半句话，然后等待取消。我们在收到这段文字时主动调用 `abort()`，等 Agent Loop 退出后，再用同一份历史、新的取消信号开始下一轮。

这不是重新实现 Agent。我们继续调用 08.3 的 `agentLoop()`，也继续使用真实的 `write_file`、参数检查、预览和执行。模型替身只是把输出固定下来，避免真实模型在实验中改换工具或回答。

## 练习要求

新增 `chapter-08-streaming-turns/exercises/cancel-and-continue.mjs`，不修改正式源码。脚本完成下面的过程：

1. 在系统临时目录建立自己的项目，让真实 `write_file` 创建其中的 `result.txt`。
2. 用完整模型结果提出工具调用，在实验审批函数中只批准这一次固定的临时文件写入。
3. 第二次模型调用发送文字增量，然后保持等待；收到增量后主动取消本轮。
4. 检查文件仍然存在，历史保留完整工具请求、成功结果和本地中断说明，而未完成文字没有作为完整回答保存。
5. 使用新的 `AbortController` 再提问，检查模型确实收到刚才保留的历史。
6. 无论实验成功或失败，都恢复原来的工作目录并清理临时项目。

我们要检查的是实际传给下一轮模型的消息，不能仅凭终端打印“已保留”就认为记录存在。实验也不能直接往 `history` 里填成功消息来代替真实工具执行。

## 提示：先建立取消等待，再通知外面

第二次 `generate()` 会用 `onText` 发出片段。观察者收到片段后可能立即调用 `abort()`，所以模型替身应先建立取消等待，再调用 `onText`。否则取消已经发生，代码才开始等待一个以后不会再次发生的通知，实验就可能卡住。

```text
第一次 generate → 完整 write_file 请求 → 真实工具创建文件
第二次 generate → 先等取消，再发出半句文字
                     ↓
观察者调用 controller.abort()
                     ↓
Agent Loop 退出 → 检查文件与历史
                     ↓
新控制器 + 同一 history → 下一轮模型收到保存的记录
```

`AbortSignal` 只负责通知；模型替身中的等待也要主动监听这个信号，才能像 SDK 一样在取消后退出。这里不需要人为等待几秒，更不需要真实 API Key。

## 完整答案

创建 `exercises/` 目录，把下面内容保存为 `chapter-08-streaming-turns/exercises/cancel-and-continue.mjs`。它从根目录的 `dist/` 导入已经构建好的 08.3，因此运行前要先完成该节构建。

<!-- solution: exercises/cancel-and-continue.mjs -->
```js
/**
 * 第 08 章练习：取消以后，下一轮还知道什么 | [NEW 练习]
 *
 * 学习目标：亲手取消一次已产生副作用的任务，检查下一轮实际收到的历史。
 * 输入：本地模型替身的固定输出；不访问真实模型，不读取 API Key。
 * 输出：临时文件、保留的工具消息与中断说明；实验结束清理自己的临时项目。
 *
 * 练习验证流程（产品全局主流程见 08.3 的 agent/agent-loop.ts）：
 *   临时项目 -> 模型提出 write_file -> 检查并批准固定预览 -> 真实创建
 *            -> 模型只发半句 -> 主动 abort -> Agent Loop 保存中断状态
 *            -> 文件和消息符合预期？-- 否 -> 断言失败
 *                                  +-- 是 -> 新信号继续 -> 检查实际模型输入
 *   无论成功或失败 -> 恢复原 cwd -> 清理临时项目
 *
 * 本实验不测试键盘事件、审批输入或网络 SSE；这些由本章固定检查覆盖。
 * 它验证的是同一个核心如何响应取消，以及已经发生的写入怎样留在历史中。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../../dist/agent/agent-loop.js";

// [NEW 练习] 本文件以下实现均为练习新增，不修改产品执行流程。
const fileContent = "这份文件在取消之前已经创建。\n";
const partialText = "文件已经创建，接下来我会";
const originalInput = "创建 result.txt，然后说明结果。";

/**
 * 模拟一个已经开始、正在等待取消的模型请求。
 *
 * 信号已经取消时立即抛错；否则监听 abort，并用同一个取消原因拒绝 Promise。
 * 本函数不会自动完成，也不会发起网络请求，结束完全由调用方的取消动作控制。
 */
function waitForAbort(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => {
      signal.removeEventListener("abort", stop);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

/**
 * 用真实工具和固定模型输出完成一次可重复的取消实验。
 *
 * 临时 package.json 让工具把临时目录识别为项目根；result.txt 由真实 write_file 创建。
 * 审批函数只允许预先规定的一次写入，断言不符合时实验失败，不扩大批准范围。
 * finally 恢复 cwd 并删除临时项目，不清理或覆盖用户自己的文件。
 */
async function main() {
  const originalCwd = process.cwd();
  const project = await mkdtemp(join(tmpdir(), "hello-my-agent-cancel-"));
  const history = [];
  const requests = [];
  const controller = new AbortController();
  const cancelReason = new Error("练习主动取消当前任务");
  let modelCalls = 0;
  let approvalCount = 0;

  const model = {
    async generate(messages, signal, onText) {
      requests.push(structuredClone(messages));
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          text: "", inputTokens: 0, outputTokens: 0, truncated: false,
          finishReason: "tool_calls",
          toolCalls: [{
            id: "create_result", name: "write_file",
            arguments: JSON.stringify({ path: "result.txt", content: fileContent }),
          }],
        };
      }
      if (modelCalls === 2) {
        // 先注册监听；观察者收到文字时会同步发出取消。
        const waiting = waitForAbort(signal);
        onText?.(partialText);
        return await waiting;
      }
      return {
        text: "收到上一轮的工具结果和中断说明。",
        toolCalls: [], finishReason: "stop",
        inputTokens: 0, outputTokens: 0, truncated: false,
      };
    },
  };

  try {
    await writeFile(join(project, "package.json"), '{"name":"cancel-exercise","private":true}\n');
    process.chdir(project);
    await assert.rejects(
      () => agentLoop(
        model, history, originalInput, controller.signal,
        (event) => {
          if (event.type !== "text_delta") return;
          console.log(`收到未完成文字：${event.text}`);
          controller.abort(cancelReason);
        },
        async (request) => {
          assert.equal(request.call.name, "write_file");
          assert.deepEqual(JSON.parse(request.call.arguments), {
            path: "result.txt", content: fileContent,
          });
          assert.ok(request.preview?.includes("result.txt"));
          approvalCount += 1;
          return { decision: "allow_once" };
        },
      ),
      (error) => error === cancelReason,
    );

    // 先查实际文件，再查核心自己保存的消息，不能手工补出成功记录。
    assert.equal(await readFile(join(project, "result.txt"), "utf8"), fileContent);
    assert.equal(approvalCount, 1);
    assert.equal(modelCalls, 2);
    const callMessage = history.find((message) => message.role === "assistant"
      && message.toolCalls?.some((call) => call.id === "create_result"));
    const toolResult = history.find((message) => message.role === "tool"
      && message.toolCallId === "create_result");
    assert.ok(callMessage);
    assert.ok(toolResult);
    assert.equal(toolResult.isError, false);
    assert.equal(history.some((message) => message.content === partialText), false);
    assert.equal(history[0].content, originalInput);
    assert.match(history.at(-1).content, /^\[本地状态\].*取消/);
    console.log("文件仍存在；完整工具请求与成功结果仍在历史中。");
    console.log(`历史末尾：${history.at(-1).content}`);

    const saved = structuredClone(history);
    const nextController = new AbortController();
    await agentLoop(model, history, "继续：先说明刚才做到哪里。", nextController.signal);
    // 第三次 generate 是新一轮的实际入口，前面收到的应是已保存的全部消息。
    assert.deepEqual(requests[2].slice(0, saved.length), saved);
    assert.equal(requests[2].at(-1).role, "user");
    assert.equal(modelCalls, 3);
    console.log("下一轮已收到原问题、工具结果与本地中断说明。");
    console.log("练习通过：取消停止当前任务，已经发生的写入没有从历史中消失。");
  } finally {
    controller.abort();
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  }
}

await main();
```

这里用 `assert.rejects()` 等待第一轮确实因取消退出。它不是忽略错误：只有抛出的值等于本次 `cancelReason` 才通过，其他失败仍会让实验报错。

`requests[2]` 保存的是新一轮实际调用 `generate()` 时收到的消息。把它的前半部分与中断后历史比较，可以确认这些记录确实进入下一轮，而不仅是保存在一个再也没用到的数组中。

## 运行验证

先在仓库根目录构建 08.3：

```bash
npm run lesson:08.3
```

再运行刚保存的实验文件：

```bash
node chapter-08-streaming-turns/exercises/cancel-and-continue.mjs
```

预期会依次看到未完成文字、文件与工具结果仍在、本地取消说明，以及下一轮收到原历史的确认。最后一行应为：

```text
练习通过：取消停止当前任务，已经发生的写入没有从历史中消失。
```

成功与失败都会清理临时文件，因此实验结束后不需要到课程目录找 `result.txt`。脚本只批准它自己创建的临时项目中的固定写入，不把这个实验审批函数接入日常 Agent。

如果实验卡在第二次模型调用，检查是否在 `onText()` 之前监听了取消，以及是否把同一个 `signal` 传给等待函数。如果下一轮立即取消，检查是否误用了已经取消的控制器；历史要复用，控制器要新建。

使用完整配套仓库时，还可以运行已有检查：

```bash
npm run exercise:08
```

已经创建实验文件时，它检查当前文件；尚未创建时，它会检查参考答案，并明确提示练习文件还不存在。参考答案通过不表示自己的练习已经完成。这项检查使用独立临时构建，不会改变当前 `hello-my-agent` 对应的小节。

## 完成练习以后

我们已经用真实文件和实际消息输入验证：取消会停止本轮，但不会回滚写入，也不会让已完成工具记录从历史里消失。未完成文字可以留在屏幕上，却不会冒充最终回答进入下一轮。

这道练习新增的是独立实验文件。第 09 章的产品代码继续从 08.3 正式实现开始，再把文字、工具、审批与结束状态整理成统一的界面事件和输出约定。
