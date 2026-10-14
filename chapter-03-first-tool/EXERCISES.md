# 第 03 章练习：一次处理两个工具请求

[第三章首页](README.md) · [先完成 03.3](03-error-boundary/README.md) · [Agent Loop 源码](03-error-boundary/src/agent/agent-loop.ts) · [完整答案](#完整答案)

## 问题：同一次响应包含两个工具请求时，程序不能只处理第一个

一个模型响应不一定只包含一个工具请求。模型可能同时要求读取 `package.json` 和 `tsconfig.json`，再比较两份配置：

```text
assistant
  tool call_a -> read_file(package.json)
  tool call_b -> read_file(tsconfig.json)
```

如果程序执行第一个工具后立刻再次请求模型，`call_b` 就没有对应结果。协议消息链不完整，模型也无法在同一次推理中使用两份文件。

03.3 的工具循环已经会处理整个请求数组。这个练习中，我们不再加一个工具，而是换成行为固定的内存模型，亲自检查：两个文件的结果是否都回来了，是否各自配上原来的 ID，以及模型什么时候再次运行。

## 练习要求

创建 `chapter-03-first-tool/multi-tool-check.mjs`，使用内存模型完成下面流程：

```text
第 1 次模型调用
  -> 同时返回 call_a 和 call_b
  -> Agent 读取两个文件
第 2 次模型调用
  -> 检查消息顺序和调用 ID
  -> 返回最终回答
```

需要检查这些现象：

1. 模型总共调用 2 次。
2. 第二次请求前已经有 2 条工具结果。
3. 两条结果的 ID 分别为 `call_a` 和 `call_b`。
4. 第一条结果包含包名，第二条结果包含 TypeScript 配置。
5. 最终成功后，完整消息才进入 `history`。

先回到仓库根目录，再执行：

```bash
npm run lesson:03.3
```

在仓库根目录创建练习文件并运行：

```bash
node chapter-03-first-tool/multi-tool-check.mjs
```

如果终端仍位于 `chapter-03-first-tool/03-error-boundary`，先执行 `cd ../../` 回到仓库根目录。命令中的相对路径都以当前终端目录为起点。

## 提示

内存模型不会访问远程服务，它只实现和正式模型相同的 `generate(messages)` 方法。这样我们能规定第一次必定返回两个请求，第二次必定先检查收到的消息，再给出最终回答；本地的文件读取仍然真实执行。

模型响应的最小形状是：

```js
{
  text: "",
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  truncated: false,
}
```

## 完整答案

```js
/**
 * 第 03 章练习答案 | [NEW] multi-tool-check.mjs
 *
 * 学习目标：让固定响应替代模型随机选择，看清同一批工具结果何时一起返回。
 * 输入：内存模型返回两个 read_file 调用；工具读取当前项目中的两个真实文件。
 * 输出：全部断言通过后打印完成提示；断言或工具失败时进程以错误结束。
 *
 * 练习验证流程（不属于 Agent 全局主流程）：
 *   +-------------------+
 *   | model call 1      |
 *   | call_a + call_b   |
 *   +---------+---------+
 *             v
 *   +-------------------+
 *   | read package.json |
 *   +---------+---------+
 *             v
 *   +-------------------+
 *   | read tsconfig.json|
 *   +---------+---------+
 *             v
 *   +-------------------+
 *   | model call 2      |
 *   | inspect 2 results |
 *   +---------+---------+
 *             v
 *        final answer -> commit history
 *
 * 两个结果分别保留 call_a 和 call_b，因此模型能知道每段内容来自哪个请求。
 * 第二次模型调用发生在两个工具都完成之后，最终回答出现前不保存本轮历史。
 * 运行观察：终端输出“✓ 多工具请求顺序正确”，history 最终包含 5 条消息。
 */

import assert from "node:assert/strict";
import { agentLoop } from "../dist/agent/agent-loop.js";

// [NEW 练习] 以下内存模型与断言只用于观察已实现的工具循环。
const history = [];
let modelCalls = 0;

const model = {
  async generate(messages) {
    modelCalls += 1;
    if (modelCalls === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "call_a",
            name: "read_file",
            arguments: '{"path":"package.json"}',
          },
          {
            id: "call_b",
            name: "read_file",
            arguments: '{"path":"tsconfig.json"}',
          },
        ],
        inputTokens: 5,
        outputTokens: 2,
        truncated: false,
      };
    }

    const toolResults = messages.filter((message) => message.role === "tool");
    assert.equal(toolResults.length, 2);
    assert.deepEqual(toolResults.map((result) => result.toolCallId), ["call_a", "call_b"]);
    assert.match(toolResults[0].content, /@sherlockmen\/hello-my-agent/);
    assert.match(toolResults[1].content, /compilerOptions/);
    // 最终回答尚未返回，本轮消息此时还不能提交到 history。
    assert.equal(history.length, 0);

    return {
      text: "两份配置都已读取。",
      toolCalls: [],
      inputTokens: 8,
      outputTokens: 3,
      truncated: false,
    };
  },
};

const reply = await agentLoop(
  model,
  history,
  "读取 package.json 和 tsconfig.json",
  new AbortController().signal,
);

assert.equal(modelCalls, 2);
assert.equal(reply.text, "两份配置都已读取。");
assert.equal(reply.inputTokens, 13);
assert.equal(reply.outputTokens, 5);
assert.equal(history.length, 5);
assert.deepEqual(history.map((message) => message.role), [
  "user",
  "assistant",
  "tool",
  "tool",
  "assistant",
]);

console.log("✓ 多工具请求顺序正确");
```

运行结果应为：

```text
✓ 多工具请求顺序正确
```

## 答案解析

第一次 `generate()` 返回两个请求后，Agent Loop 先保存一条包含两个 `toolCalls` 的 assistant 消息。随后 `for (const call of result.toolCalls)` 按数组顺序执行两个工具，分别追加 `call_a` 和 `call_b` 的结果。

只有内层工具循环结束，外层模型循环才回到顶部，因此第二次 `generate()` 能同时看到两份结果。最终 `history` 有五条消息：一条用户输入、一条工具请求、两条工具结果和一条最终回答。

两个工具虽然来自同一次模型响应，本章仍然按顺序执行。这个练习证明了结果配对和再次请求的时机，没有实现并发。

到这里，第三章的读取循环已经完整：一条或多条请求都能执行，预期失败也能反馈。接下来进入[第四章](../chapter-04-code-search/README.md)，让模型在不知道准确路径时，也能先找到需要读的文件。
