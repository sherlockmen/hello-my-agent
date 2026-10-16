# 第 34 章练习：从诊断中判断下一步

从 34.3 的完整源码继续。本组练习增加一个供本地调用的只读摘要器，不注册模型工具，不恢复旧权限，也不执行日志中描述的操作。三题共用 `src/diagnostics/review-log.ts`，下方提供同时完成三题的完整文件。

## 练习一：读取同一次运行

接收诊断 JSONL 路径，返回 runId、最终状态与日志是否完整。先验证版本、运行编号和从 1 开始的连续序号；限制读取为 1 MiB，避免误把完整工具输出文件当作诊断。损坏文件的错误说明不能包含原始行，因为误选的文件可能带有秘密。

完整日志的 `outcome` 来自最后的 `run_finish`；没有结束记录时返回 `unknown`，不能把“没有失败记录”解释为成功。

## 练习二：列出尚未配对的操作

按 `call` 保存模型开始与结束，按 `toolSequence` 保存工具开始与结束。返回两组未配对编号，并累计 `model_retry` 数量。一次重试仍属于原来的 call，不额外增加一项模型决策。

未配对列表只表示本地没有取得完成记录：工具可能尚在执行，也可能已完成而记录丢失。摘要不能据此自动重发命令。即使工具列表为空，最终 outcome 仍可能是 error，例如工具完成后的总结请求失败。

## 练习三：区分失败与日志缺失

有 `run_finish/error` 且 `logComplete: true`，表示日志完整记录了一个失败任务；不等于工作区回到原状。缺少最终行或 `logComplete: false` 时，`complete` 为 false，仍保留已经读到的编号和重试次数供核对。若混入另一次运行、序号跳跃或格式错误，应停止解析并给出固定错误。

用这些例子预测摘要，然后执行验收：

| 日志事实 | 预期判断 |
| --- | --- |
| 工具结束，下一次模型请求开始后没有结束行 | outcome 为 unknown；模型编号仍未配对，文件操作不能重做。 |
| 所有模型和工具都有结束行，最终 error | outcome 为 error；未配对列表可以为空，失败不等于撤销。 |
| 完整结束行标记日志超额 | 保留 outcome，但 complete 为 false。 |
| 读到第 4 行才发现 runId 改变 | 拒绝整个摘要；不能把两轮拼成一轮。 |

## 完整答案

在 `03-stop-and-diagnose/src/diagnostics/` 新建下列文件。它只接受本地调用，结果不进入模型上下文；后续若增加 CLI 命令，也应由用户明确选择诊断文件。

<!-- answer-file: src/diagnostics/review-log.ts -->
```typescript
/**
 * 第34章练习 | [NEW] diagnostics/review-log.ts
 *
 * 学习目标：从有界白名单日志生成只读摘要，不把缺少记录当作没有副作用。
 * 输入：用户本地选择的JSONL路径；输出：运行状态、重试数和未配对编号。
 * 本文件局部流程：有界读取 -> 逐行校验 -> 累计编号 -> 最终状态或unknown。
 * 状态：不修改日志、会话、工作区或权限，不重放工具；格式错误使用固定文案。
 * 观察：complete描述诊断记录；outcome描述任务，二者不能替代工作区核对。
 */
// [NEW 练习] 日志是诊断材料，不是恢复执行权的指令文件。
import { open } from "node:fs/promises";
import { UserFacingError } from "../errors.js";

export type LogReview = {
  runId: string;
  outcome: "completed" | "cancelled" | "error" | "unknown";
  complete: boolean;
  retries: number;
  unfinishedModels: number[];
  unfinishedTools: number[];
};
const MAX_BYTES = 1024 * 1024;

/** 校验编号为正整数，拒绝隐式字符串转换，错误不带原始字段。 */
function numberId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new UserFacingError("诊断格式无效，请核对文件和版本。");
  }
  return value;
}

/**
 * 读取最多1MiB加一个探测字节并关闭句柄；超额和磁盘错误均给固定说明。
 * 不以文件大小预检代替读取上限，避免文件在检查后继续增长。
 */
async function boundedText(path: string): Promise<string> {
  try {
    const file = await open(path, "r");
    try {
      if (!(await file.stat()).isFile()) throw new Error("Not a file");
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > MAX_BYTES) throw new Error("Too large");
      return buffer.subarray(0, offset).toString("utf8");
    } finally { await file.close(); }
  } catch {
    throw new UserFacingError("无法读取诊断，请选择不超过1MiB的普通JSONL文件。");
  }
}

/**
 * 按同一runId和连续序号累积元数据；没有结束行时保留可核对的事实。
 * 开始未配对不证明操作仍活着，结束为error也不撤销工具；调用者必须另行核实。
 * 只返回白名单字段；即使误选含敏感字段的JSON，也不把原行复制到异常或结果。
 */
export async function reviewRunLog(path: string): Promise<LogReview> {
  const text = await boundedText(path), lines = text.trimEnd().split("\n");
  const models = new Set<number>(), tools = new Set<number>();
  const review: LogReview = { runId: "", outcome: "unknown", complete: false,
    retries: 0, unfinishedModels: [], unfinishedTools: [] };
  let ended = false;
  try {
    for (const [index, line] of lines.entries()) {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const item = parsed as Record<string, unknown>;
      if (ended || item.version !== 1 || typeof item.runId !== "string" || !item.runId
        || item.sequence !== index + 1 || typeof item.event !== "string") throw new Error();
      if (!review.runId) review.runId = item.runId;
      if (item.runId !== review.runId) throw new Error();
      if (item.event === "model_start") models.add(numberId(item.call));
      if (item.event === "model_finish") models.delete(numberId(item.call));
      if (item.event === "tool_start") tools.add(numberId(item.toolSequence));
      if (item.event === "tool_finish") tools.delete(numberId(item.toolSequence));
      if (item.event === "model_retry") { numberId(item.call); review.retries++; }
      if (item.event === "run_finish") {
        if (!["completed", "cancelled", "error"].includes(String(item.outcome))
          || typeof item.logComplete !== "boolean") throw new Error();
        review.outcome = item.outcome as LogReview["outcome"];
        review.complete = item.logComplete;
        ended = true;
      }
    }
  } catch {
    throw new UserFacingError("诊断格式无效，请核对文件和版本。");
  }
  review.unfinishedModels = [...models].sort((a, b) => a - b);
  review.unfinishedTools = [...tools].sort((a, b) => a - b);
  return review;
}
```

## 运行验证

在仓库根目录执行：

```bash
node tests/verify-chapter-34.mjs
```

脚本会把上面这份字面答案加入 34.3 的临时源码，独立编译后实际调用 `reviewRunLog`，核对完整失败、缺少最终行、未配对编号、重试次数、超额、混入其他运行和格式损坏。正式主线源码不包含练习文件；读者完成练习后可以在本地继续使用摘要器。

[返回本章](/content/chapter-34-reliability/README.md)
