# stop.ts

`chapter-20-hooks/examples/stop.ts`

<a href="./content/chapter-20-hooks/examples/stop.ts" download>下载原始文件</a>

```typescript
/**
 * 20.3 结束检查示例 | [NEW 练习] stop.ts
 * 学习目标：在整轮 completed 或 error 后给出本地复核提示。
 * 输入：stdin 中一个 stop 事件；它不代表每次 model_finish。
 * 输出：stdout 的单个 message JSON；非法输入写 stderr 并非零退出。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   完整读事件 -> stop 且 outcome 有效？-- 否 -> 失败；是 -> 完成/错误对应提示
 * 状态与观察：不改文件、不请求模型；提示由外层加入本地结果，不是新的测试结论。
 */

// [NEW 练习] 项目自定义 stop 协议实现。

/**
 * 只消费整轮结束事件，stdout 输出一个反馈对象。
 * 读取并校验输入后执行上面的局部流程；失败交给入口 catch 输出诊断并设置非零退出。
 */
async function main(): Promise<void> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要事件对象");
  const event = value as Record<string, unknown>;
  if (event.event !== "stop" || !["completed", "error"].includes(String(event.outcome))) {
    throw new Error("事件无效");
  }
  process.stdout.write(JSON.stringify({ message: event.outcome === "completed"
    ? "本地收尾提醒：请人工查看这次改动；此提示没有执行测试。"
    : "本地收尾记录：本轮出错，请保留原始错误排查。" }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```
