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

本练习要验证：**Agent Loop 会先执行同一响应中的全部工具请求，保留各自调用 ID，然后才再次请求模型。**

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

验收至少检查：

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

内存模型只需要实现与正式模型相同的 `generate(messages)` 方法。第一次返回两个 `toolCalls`，第二次检查 `messages` 后返回空工具列表和最终文本。

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
 * 学习目标：验证一个模型响应中的多个工具请求会全部执行后再进入下一轮。
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
 * 关键点：两个结果分别保留 call_a 和 call_b。第二次模型调用发生在两个工具都完成之后。
 * 运行观察：终端输出“✓ 多工具请求顺序正确”，history 最终包含 5 条消息。
 */

import assert from "node:assert/strict";
import { agentLoop } from "../dist/agent/agent-loop.js";

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

这个练习使用内存模型，所以结果由代码决定，不受真实模型选择影响；文件读取仍调用第三章的真实 `read_file` 实现。
