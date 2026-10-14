# 第 12 章练习：检查任务控制的状态与请求

[第 12 章首页](/content/chapter-12-task-control/README.md) · [先完成 12.5](/content/chapter-12-task-control/05-manage-queue/README.md) · [完整答案](#完整答案)

## 问题：什么证据能说明一次交互成立

终端显示“已更新清单”，我们还需要知道无效的新清单有没有改坏旧状态。终端显示用户选择了“报错”，我们还需要知道答案有没有接回提出问题的那次工具调用。队列里一条文字消失，也可能表示撤回、收取或重发；只看消失这个结果，无法判断模型是否收到它。

这几种交互都允许我们找到更具体的证据：比较操作前后的完整清单，查看下一次模型请求里的工具调用 ID，检查收取之后剩下的队列项。练习要做的就是选对对象、选对检查时刻。这样即使模型最后说“已经完成”，我们也能独立说明程序接受了什么、留下了什么。

先把 12.1 的方案写成三句话：从哪些现有事实判断是否需要修改，准备在哪一处改变什么行为，用什么结果验证行为。当前加法文件若已经正确，方案应转向检查与验证；不要为了套用“发现错误、修复错误”的流程，重新制造错误。下面的实验继续使用本章的加法情境，但不会修改加法项目。

## 先预测变化，再运行固定实验

我们会把真实模型换成本地替身。替身的 `generate()` 直接返回约定的完整响应，并记录每次收到的消息；清单、问答、队列和 Agent Loop 仍沿用正式实现。固定响应让我们知道下一步必定发生什么，因而可以在同一个位置检查状态，也不需要 API Key。

先看清单。有效候选是“检查完成、修复进行中、测试待办”三项。第二份候选前一项有效，后一项才暴露重复 ID。预测重点是**旧三项完整保留**：如果程序边检查边修改，最终抛出错误也不能说明提交过程正确。再提交两项进行中的候选，应得到同样的保留结果。

再看问答。第一次模型响应提出 `ask_user`，调用 ID 是 `question-1`。问答出现时，核心正在等待，模型请求次数应停在 1。我们提交“报错”后，第二次请求应包含 ID 仍为 `question-1` 的工具结果，答案也是“报错”。这个配对说明答案继续了原工具调用；问答函数单独返回一个字符串还不足以证明它进入了模型请求。

随后看队列。旧任务 7 有一条文字，当前任务 8 有负数与小数两条。这里的 7、8 是任务编号，不是模型请求次数。按任务 8 收取时，当前两项应保持原顺序被取出，旧任务项继续留在队列。我们先留下小数项的编辑副本，再收取原项，最后按原 ID 保存。保存应失败，因为队列已经没有这个 ID；副本中的文字则还在，便于用户决定下一步。

最后看回答边界。替身第一次返回最终回答之前，排入一条负数要求。此时任务未取消，也有剩余模型请求次数，核心应继续第二次请求，把这条要求作为 user 消息交给模型。实验只覆盖这个**仍有预算**的分支；如果要验证第 8 次请求用尽之后的行为，需要另设实验，不能从本次通过结果推断出来。

## 练习要求

新增 `chapter-12-task-control/exercises/task-control-state.mjs`，正式源码继续沿用 12.5。每组实验先执行一种操作，再用断言比较操作前后的数据。断言失败会停止运行，告诉我们哪一个预测不成立。

| 实验 | 检查对象与时刻 | 成立时的结果 |
| --- | --- | --- |
| 有效清单之后提交重复 ID、两项进行中的候选 | 每次拒绝之后的整个清单 | 两次都报错，旧清单完整保留 |
| 模型提出澄清，用户回答“报错” | 等待中的请求次数，以及回答后的第二次请求 | 等待时只有一次请求，第二次请求把答案配回原调用 ID |
| 取消一份独立的问答等待，再从旧入口回答 | 取消后的 Promise 与旧 `respond()` 返回值 | 等待因取消而拒绝，迟到的回答返回 `false` |
| 同一队列包含旧任务与当前任务的文字 | 当前任务收取的数组，以及剩余队列 | 只按顺序收取当前任务项，旧任务项仍在 |
| 留下编辑副本后，原项被收取 | 按原 ID 保存的结果，以及本地副本 | 保存返回 `false`，副本仍保留新文字 |
| 第一次最终回答前排入补充 | 第二次请求的消息、应用事件与剩余队列 | 补充成为 user 消息，只应用一次，队列不再留有该项 |

清单实验直接调用正式的 `todoWriteTool()`；问答实验让工具真实经过 `agentLoop()`，再通过等待对象的 `respond()` 回答；队列实验调用正式的入队、收取和更新函数。替身每次先复制收到的消息，避免后续操作改变用于比较的记录。

本实验没有启动 React 组件。编辑冲突中的副本是一个普通对象，能说明“原项消失后，副本仍可保留”这一数据关系；它没有验证 `QueuePanel` 是否显示冲突提示、保留光标或让用户复制文字。实际按键、焦点、复制和终端恢复，仍应通过各节的手动操作核对。

## 完整答案

创建 `exercises/`，把下面的完整代码保存为 `chapter-12-task-control/exercises/task-control-state.mjs`。先把仓库根目录的 `dist/` 构建成 12.5；实验会导入这份已构建实现，不会跨小节导入未来代码。

<details>
<summary>完整新增实验：task-control-state.mjs</summary>

<!-- solution: exercises/task-control-state.mjs -->
```js
/**
 * 第 12 章练习：检查任务控制的状态与请求 | [NEW 练习]
 *
 * 学习目标：用固定输入检查清单的整体更新、澄清答案配对、队列归属与编辑冲突。
 * 输入：本地模型替身、内存清单、内存队列与问答等待对象；不需要 API Key。
 * 输出：每一步的断言与通过提示；失败时抛出断言，不修改项目文件。
 *
 * 练习验证流程（产品全局主流程见 12.5 的 agent/agent-loop.ts）：
 *   清单 -> 有效更新 -> 无效更新？-- 是 -> 原状态保留
 *   ask_user -> 等待 -> 答案 -> tool result 配对 -> 下一次请求
 *   队列 -> 按 run 收取 -> 剩余旧项保留 -> 按 ID 编辑/撤回
 *   最终回答 -> 此时有补充？-- 是 -> 下一次请求包含补充
 *   任一步不符合预期？-- 是 -> 断言失败；否 -> 打印通过
 *
 * 本实验调用正式函数，没有启动 React 界面。真实按键、审批和终端恢复由交互检查覆盖。
 */
import assert from "node:assert/strict";
import { todoWriteTool } from "../../dist/tools/todo-write.js";
import { agentLoop } from "../../dist/agent/agent-loop.js";
import { waitForAnswer } from "../../dist/ui/tui/questions.js";
import {
  newInputQueue, enqueueInput, takePendingInputs, hasPendingInputs,
  findQueuedInput, updateQueuedInput, removeQueuedInput,
} from "../../dist/ui/tui/input-queue.js";

/** 把本地替身的一次完整回复写成与正式 ModelResult 相同的形状。 */
function reply(text, toolCalls = []) {
  return { text, toolCalls, inputTokens: 0, outputTokens: 0,
    truncated: false, finishReason: toolCalls.length ? "tool_calls" : "stop" };
}

/** 先更新成功，再故意提交半途才发现无效的列表，检查原清单没有改过。 */
async function checkTaskList() {
  const tasks = { items: [] };
  const signal = new AbortController().signal;
  const items = [
    { id: "inspect", text: "检查实现和测试", status: "completed" },
    { id: "fix", text: "修复数字加法", status: "in_progress" },
    { id: "test", text: "运行测试", status: "pending" },
  ];
  await todoWriteTool(JSON.stringify({ items }), tasks, signal);
  assert.deepEqual(tasks.items, items);
  const saved = structuredClone(tasks.items);
  const duplicate = [items[0], { ...items[1], id: "inspect" }];
  await assert.rejects(todoWriteTool(JSON.stringify({ items: duplicate }), tasks, signal), /不能重复/);
  assert.deepEqual(tasks.items, saved);
  const twoRunning = [{ ...items[0], status: "in_progress" }, items[1]];
  await assert.rejects(todoWriteTool(JSON.stringify({ items: twoRunning }), tasks, signal), /最多只能有一项/);
  assert.deepEqual(tasks.items, saved);
}

/** 让 ask_user 真正经过 Agent Loop，下一次模型请求中检查原调用与答案。 */
async function checkQuestionPairing() {
  let calls = 0;
  const requests = [];
  const model = { async generate(messages) {
    requests.push(structuredClone(messages));
    calls += 1;
    return calls === 1 ? reply("需要问清输入规则。", [{
      id: "question-1", name: "ask_user", arguments: JSON.stringify({
        question: "允许数字字符串时，非法字符串报错还是返回0？", choices: ["报错", "返回0"],
      }),
    }]) : reply("采用报错规则，计划补充校验与测试。");
  } };
  let pending;
  const history = [];
  const done = agentLoop(model, history, "计划支持数字字符串，先问清非法字符串规则。",
    new AbortController().signal, undefined, undefined, new Set(), {
      mode: "plan", askUser: (request, signal) => waitForAnswer(request, signal, (value) => { pending = value; }),
    });
  // 让核心走到问答等待；这里只等微任务，不模拟终端输入。
  for (let attempt = 0; attempt < 20 && !pending; attempt += 1) await Promise.resolve();
  assert.ok(pending);
  assert.equal(calls, 1);
  const original = pending;
  assert.equal(original.respond("报错"), true);
  await done;
  assert.equal(calls, 2);
  const result = requests[1].find((message) => message.role === "tool");
  assert.equal(result.toolCallId, "question-1");
  assert.equal(JSON.parse(result.content).answer, "报错");
  assert.equal(original.respond("返回0"), false);

  const controller = new AbortController();
  let cancelledQuestion;
  const wait = waitForAnswer({ question: "这个问题将被取消", choices: [] }, controller.signal,
    (value) => { if (value) cancelledQuestion = value; });
  const rejection = assert.rejects(wait, /练习取消/);
  controller.abort(new Error("练习取消"));
  await rejection;
  assert.equal(cancelledQuestion.respond("迟到的答案"), false);
}

/** 从实际队列收取，再用原 ID 保存编辑稿，检查不会写回已生效的项。 */
function checkQueueOwnership() {
  const queue = newInputQueue();
  const old = enqueueInput(queue, "旧轮尚未发送", 7);
  const first = enqueueInput(queue, "请测试负数", 8);
  const second = enqueueInput(queue, "请测试小数", 8);
  assert.ok(hasPendingInputs(queue, 8));
  assert.equal(updateQueuedInput(queue, first.id, "请测试两个负数相加"), true);
  assert.equal(findQueuedInput(queue, first.id).text, "请测试两个负数相加");
  const editing = { id: second.id, text: "请测试两个小数相加" };
  const taken = takePendingInputs(queue, 8);
  assert.deepEqual(taken.map((item) => item.id), [first.id, second.id]);
  assert.deepEqual(queue.items.map((item) => item.id), [old.id]);
  assert.equal(updateQueuedInput(queue, editing.id, editing.text), false);
  assert.equal(editing.text, "请测试两个小数相加");
  assert.equal(hasPendingInputs(queue, 8), false);
  assert.equal(removeQueuedInput(queue, old.id).text, "旧轮尚未发送");
  assert.equal(queue.items.length, 0);
}

/** 在第一次最终回答即将返回时排队，确认核心仍请求下一次模型，而非直接结束。 */
async function checkFinalBoundary() {
  const queue = newInputQueue();
  const requests = [];
  const events = [];
  let calls = 0;
  const model = { async generate(messages) {
    requests.push(structuredClone(messages));
    calls += 1;
    if (calls === 1) {
      enqueueInput(queue, "请测试两个负数相加", 9);
      return reply("原任务完成。");
    }
    return reply("已继续处理补充要求。");
  } };
  const result = await agentLoop(model, [], "检查加法", new AbortController().signal,
    (event) => events.push(event), undefined, new Set(), {
      mode: "plan", takePendingInputs: () => takePendingInputs(queue, 9),
      hasPendingInputs: () => hasPendingInputs(queue, 9),
    });
  assert.equal(calls, 2);
  assert.equal(result.text, "已继续处理补充要求。");
  assert.equal(requests[1].at(-1).role, "user");
  assert.equal(requests[1].at(-1).content, "请测试两个负数相加");
  assert.equal(events.filter((event) => event.type === "input_applied").length, 1);
  assert.equal(queue.items.length, 0);
}

await checkTaskList();
await checkQuestionPairing();
checkQueueOwnership();
await checkFinalBoundary();
console.log("练习通过：清单更新、问答配对、队列归属与最终回答边界符合预期。");
```

</details>

## 答案怎样证明本章的原理

清单实验把成功后的三项复制下来，用它作为两次失败更新的比较基准。这里必须比较整个数组：只检查长度，发现不了文字、状态或顺序已经被部分修改。两次无效候选都保留旧数组，才支持 12.2 的提交方法——先检查完整候选，再一次替换。

问答实验检查两段关系。第一段是在等待出现之后，模型请求次数仍为 1；这说明核心确实停在答案处。第二段是在回答之后，下一次请求携带原调用 ID 对应的工具结果；这说明答案接回了原任务。后面的取消检查另建一份独立等待，证明这份等待结束之后，旧入口不能再次提交答案。它没有模拟整项任务在终端里按 Ctrl+C 的过程。

队列实验先按 ID 修改仍待发送的负数项，再收取当前任务的两项。它同时比较收取顺序和剩余队列，避免“取到了想要的两项，却误删旧任务项”的错误通过。接着用已经收取的小数项 ID 保存，必须失败；普通编辑副本仍有文字。这分别对应 12.4 的任务归属和 12.5 的保存时重查。

最终回答实验检查第二次请求末尾的 user 消息，而不以替身最后说“已继续处理”作为证据。它还检查只有一次 `input_applied` 事件、队列已经清空，说明这条补充经过了收取与应用。该实验只用了两次模型请求，验证范围也止于仍有预算时继续任务。

遮住完整答案，再推理三个变体：把清单候选中的最后一项改成无效状态，旧清单应怎样变化；在问答结束之后再次调用旧 `respond()`，它应怎样返回；队列先撤回负数项，再收取当前任务，小数项为什么仍能被正确识别。理由应来自完整提交、一次等待和固定 ID，而不是来自“答案代码就是这么写的”。

## 运行验证

在仓库根目录构建并注册 12.5：

```bash
npm run lesson:12.5
```

单独运行实验：

```bash
node chapter-12-task-control/exercises/task-control-state.mjs
```

应显示：

```text
练习通过：清单更新、问答配对、队列归属与最终回答边界符合预期。
```

这行提示表示前面的断言全部通过。其中最终回答实验只覆盖有剩余预算时继续第二次请求，没有检查第 8 次请求用尽的边界；编辑副本实验也没有启动 React 面板。若有断言失败，先看它比较的对象与时刻：是旧清单被改了、答案没有配对、收取范围不对，还是补充没有进入下一次请求。再回到相应小节解释规则，避免只调整替身的最终回答来迎合预期。

最后完成 12.3 的实际问答取消与 12.5 的编辑、复制、重发操作。固定实验使内部状态可以重复核对，手动操作则检查这些状态是否被界面正确呈现；二者各自提供一部分证据。

## 完成练习后的 Agent

我们已经能从状态和请求解释任务控制：清单怎样完整提交，澄清答案怎样继续原工具调用，运行中的补充何时进入后续请求，按原 ID 保存为什么可能失败。遇到新条件时，也能先预测哪些数据会改变，再选择验证证据。

这些记录目前仍在内存中。后续学习会话保存时，同样要保留已经发生的请求、工具结果与中断位置，才能让恢复后的任务继续理解这段过程。
