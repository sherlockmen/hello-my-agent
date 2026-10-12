# 第 12 章练习：检查任务控制的状态与请求

[第 12 章首页](README.md) · [先完成 12.5](05-manage-queue/README.md) · [完整答案](#完整答案)

## 问题：看见提示，还要能说明程序接受了什么

本章的几种交互都在改变任务：清单告诉我们进展，澄清答案决定输入规则，队列补充进入下一次模型判断。手动运行能观察这些画面，但一次成功的回答还不能说明中间过程总是按预期发生。

我们需要把讲过的过程重新走一遍，并在关键时刻检查数据。例如，提交了无效清单，旧清单应该完整保留；用户选择“报错”，下一次模型请求应该收到原问题的对应答案；当前轮收取队列时，旧轮的文字应该留在本地。只有知道检查哪个对象、在什么时候检查，才知道画面背后的方法是否成立。

本练习使用本地模型替身：它直接返回约定的完整响应，让每次实验都沿同一条路径运行。清单、问答和队列仍调用正式实现，所以我们检查的是它们怎样改变状态、怎样进入核心的模型请求，而不是重新手写一份类似逻辑。实验不需要 API Key，也不修改加法项目。

## 先预测变化，再检查中间状态

先看清单。我们写入“检查完成、修复进行中、测试待办”三项，再提交一份 ID 重复的新清单。预期不只是“报错”，还包括旧三项一字不变；否则前面几项已经改了，最后一项才失败，也可能看起来像一次正确拒绝。

再看问答。第一次模型响应提出 `ask_user`，原调用 ID 为 `question-1`。这时只有一次模型请求，核心应等待用户。提交“报错”之后，第二次请求里要出现 ID 同为 `question-1` 的工具结果，内容包含这次问题与答案。这样才证明回答接回了原任务，不只是问答函数单独返回了一个字符串。

然后看队列。旧第 7 轮留一条文字，当前第 8 轮有负数与小数两条。按第 8 轮收取时，只应按顺序取走当前两条，旧文字继续保留。我们在收取前留下小数项的编辑副本，收取后再尝试保存：原 ID 已不在队列里，更新应失败，副本里的新文字仍在。

最后看最终回答。模型刚返回“原任务完成”时，用户又排了一条负数要求。还有请求预算时，核心应继续一次，把补充加入下一次请求，而不是随着最终回答直接结束。我们会检查请求的内容，避免只看模型替身最后写了“处理完成”。

## 练习要求

新增 `chapter-12-task-control/exercises/task-control-state.mjs`，写一个独立实验，正式源码继续沿用 12.5。每组实验先制造本章讲过的操作，再用断言比较操作前后；断言失败会停止运行，告诉我们哪一个预期不成立。

| 实验 | 必须检查的结果 | 提示 |
| --- | --- | --- |
| 先提交有效清单，再提交重复 ID 与两项进行中 | 两次无效更新都报错，旧清单完全不变 | 用 `todoWriteTool()` 更新；成功后复制旧状态，失败后比较 |
| 模型提出澄清，用户回答报错 | 等待时模型只有一次请求；第二次请求把答案配回原 ID | 用替身记录 `generate()` 收到的消息，通过 `waitForAnswer()` 回答 |
| 问题取消后，旧面板再尝试回答 | 原等待因取消结束，旧回答返回 `false` | 先准备捕获拒绝的断言，再取消，最后调用旧回答入口 |
| 同一队列同时含旧轮与当前轮的文字 | 只按顺序收取当前轮，旧轮项仍保留 | 用真实 `enqueueInput()` 添加，`takePendingInputs()` 按轮次取出 |
| 编辑期间原项被收取 | 按原 ID 保存返回失败，编辑副本仍有新文字 | 先记编辑副本，再收取原项，最后调用 `updateQueuedInput()` |
| 模型返回最终回答时新增补充 | 核心再请求一次，补充成为下一次请求的 user 消息 | 在替身第一次 `generate()` 中入队，再返回最终回答 |

替身只需要实现 `generate()`：第一次返回约定工具调用，后面返回普通回答；每次先复制收到的消息保存下来，便于检查。问答实验不用模拟键盘，直接通过这次等待对象的 `respond()` 提交答案。队列实验同样操作真实函数，重点是文字与所属轮次的变化。

这里没有启动 React 组件，所以可以稳定检查内部消息与状态。实际按键、焦点、复制和终端恢复，则继续通过本章各节的手动操作观察。

## 完整答案

创建 `exercises/`，把下面的完整代码保存为 `chapter-12-task-control/exercises/task-control-state.mjs`。`dist/` 必须先构建成 12.5；实验从章目录回到仓库根目录的 `dist/`，没有跨小节导入未来实现。

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

## 答案怎样对应本章的原理

`checkTaskList()` 先用正式工具保存三项有效进度，复制一份旧状态，再分别提交重复 ID 和两项进行中的候选。每次报错后都把当前状态与旧状态完整比较。这对应 12.2 的提交顺序：检查候选期间不改原清单，全部通过之后才一次替换。

`checkQuestionPairing()` 把问答放进真实的 `agentLoop()`。替身第一次返回 `ask_user(question-1)`，问答等待出现之后先检查模型调用次数仍为 1；提交“报错”并等整轮结束，再检查第二次请求里的工具结果 ID 与答案。最后重新创建一份问答并取消，验证迟到的旧回答无法结束它。这对应 12.3 的一次等待和原 ID 配对。

`checkQueueOwnership()` 给旧轮与当前轮分别入队。它先验证仍待发送的负数项能按 ID 改文，再为小数项留下编辑副本，随后收取当前轮的两项。接着用旧 ID 保存，必须返回 `false`；编辑副本仍保留“请测试两个小数相加”。最后只撤回队列里剩下的旧轮项。这对应 12.4 的轮次归属与 12.5 的保存重查，代码没有假装能改写已经收取的消息。

`checkFinalBoundary()` 在第一次回答即将返回时排队负数要求。它检查核心确实发起两次模型请求，第二次请求末尾的 user 消息就是这条要求，并且只产生一次 `input_applied` 事件。我们检查的是补充实际进入了消息，不以替身的最终回答文字代替这一证据。

## 运行验证

完成 12.5 与练习文件后，在仓库根目录构建并注册：

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

## 完成练习后的 Agent

完成练习后，我们能用具体状态和请求解释本章的交互：清单何时提交，问答怎样接回原任务，补充如何进入下一次决策，编辑为什么可能保存失败。实验没有增加新产品功能，而是让这些已经实现的方法可以重复核对。

这些任务记录目前仍保存在内存中。下一章把会话保存到文件时，也要保留原请求、对应工具结果和中断位置；恢复之后，模型才能接着理解已经发生的过程。
