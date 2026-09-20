/**
 * 直接调用 Agent 核心，验证历史在成功、失败和取消时的变化。
 * 模型用内存函数代替，不需要终端、配置或网络；两种 HTTP 协议另由 verify-chat 验证。
 * 参数是已编译的 agent-loop.js 路径，因此也能检查真实安装包中的核心模块。
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export async function verifyAgentLoop(modulePath) {
  const { agentLoop } = await import(pathToFileURL(modulePath).href);
  const history = [];
  const reply = { text: "已记住青柠", inputTokens: 9, outputTokens: 4, truncated: false };
  const modelReply = { ...reply, toolCalls: [] };
  const controller = new AbortController();
  const calls = [];
  const model = { async generate(messages, signal) {
    assert.equal(signal, controller.signal, "取消信号必须传递到模型");
    calls.push(structuredClone(messages));
    return modelReply;
  } };

  // 一次输入只触发一次无工具调用；下一轮包含前轮完整问答。
  const firstReply = await agentLoop(model, history, "项目叫青柠", controller.signal);
  assert.deepEqual({
    text: firstReply.text,
    inputTokens: firstReply.inputTokens,
    outputTokens: firstReply.outputTokens,
    truncated: firstReply.truncated,
  }, reply);
  await agentLoop(model, history, "记得吗", controller.signal);
  assert.deepEqual(calls[1], [
    { role: "user", content: "项目叫青柠" },
    { role: "assistant", content: "已记住青柠" },
    { role: "user", content: "记得吗" },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(history.length, 4);
  const completed = structuredClone(history);

  // 请求失败不能污染已完成的历史，也不能吞掉错误、返回一个假的成功结果。
  const failure = new Error("模拟请求失败");
  await assert.rejects(agentLoop({ async generate() { throw failure; } }, history, "失败轮", controller.signal),
    (error) => error === failure);
  assert.deepEqual(history, completed);

  // 处理“取消与返回同时发生”的情况：即使模型返回了文本，也不能保存已取消的轮次。
  await assert.rejects(agentLoop({ async generate() {
    controller.abort();
    return modelReply;
  } }, history, "取消轮", controller.signal), { name: "AbortError" });
  assert.deepEqual(history, completed);

  // 请求开始前已经取消时，不应再调用模型。
  await assert.rejects(agentLoop(model, history, "已取消", controller.signal), { name: "AbortError" });
  assert.equal(calls.length, 2);
  assert.deepEqual(history, completed);
  console.log("✓ Agent Loop 可独立调用，历史提交与失败、取消规则正确");
}
