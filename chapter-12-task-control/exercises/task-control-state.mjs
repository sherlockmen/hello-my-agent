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
