# 12.3 澄清问题

[第 12 章首页](../README.md) · [上一节：12.2 任务清单](../02-task-list/README.md) · [下一节：12.4 运行中补充与打断](../04-live-input/README.md)

## 问题：代码能怎么写，不能替用户决定需求

上一节的清单能指出当前步骤，但“正在修复”并不代表实现条件都已经明确。假设我们接着要求加法接受数字字符串：`add("1", "2")` 应该得到数字 `3`。这个要求说明了正常输入的结果，却没有说明 `add("abc", 2)` 应该怎样处理。

模型可以写成报错，也可以写成返回 `0`。两种代码都能运行，但会给使用者不同的体验，也需要不同的测试。缺少的是用户对输入规则的决定，读取更多源码不一定能补上它。所以，Agent 应该先提出一个具体问题，等用户回答后再继续。

![非法字符串规则尚未给出，Agent提问，用户选择报错后原任务继续](assets/question-problem-ea4552fcd2.gif)

动画先摆出两个输入：数字字符串应该得到 `3`，非法字符串的规则仍是问号。Agent 把这个问号变成“报错还是返回0”的澄清问题；用户输入编号 `1` 并按 Enter 后，“报错”这张答案卡才回到原任务。Agent 因此能够按这个规则设计校验和测试，图中的后续方向不表示实际修改或测试已经完成。这里回答的是需求，后面若要修改文件，仍会出现原有的修改审批。[静态图](assets/question-problem-ec5765390d.jpg)

只让模型在普通回答里写一句问题，还没有实现等待。原来的循环看到不带工具调用的回答，可能就把这一轮结束了；问题如果夹在中间说明里，也没有一个专用位置接收答案。我们需要让“提出问题→等待答案→接着做原任务”成为执行流程的一部分。

## 解决方案：把问答接到工具等待结果的路径

本节加入 `ask_user` 工具。模型提交一个 `question` 和一个 `choices` 数组，程序把问题显示给用户，并等待这次问答完成。选项最多 4 项，也可以是空数组，让用户自由回答。

工具不会直接读键盘，而是调用运行入口提供的专用问答函数，代码中称为 `QuestionHandler`。这个函数返回一个 Promise：没有回答时保持等待，用户提交后返回答案。TUI 用澄清面板收集本次回答，核心继续等待工具结果，收到答案后才继续模型循环。

答案通过原来这次 `ask_user` 调用的 ID 交回模型。因此模型下一次同时看到“刚才问了什么”和“用户怎样回答”，能继续原来的加法任务。问答只补充需求信息，不授予文件或命令权限；后续每一次修改仍走现有审批。

## 工作原理

模型调用工具之后，本来就要等工具返回结果。读取工具返回文件内容，命令工具返回运行结果；本节让问答工具返回用户答案。不同的是这个结果来自人，需要程序和界面共同保持一次尚未完成的等待。

![ask_user等待用户答案，答案与原调用q1配对后进入下一次模型请求](assets/question-result-56e20b4c23.gif)

图中 `q1` 是这次问题的调用 ID。问题进入专用面板后，工具结果的位置仍然空着；用户输入编号 `1` 并提交，面板才把它转换成“报错”，完成这次等待。答案卡进入 `q1` 的结果位置，随后原要求、问题调用和对应结果一起进入下一次模型请求。图的后段从等待状态分别展示 Esc 和本轮取消：Esc 返回 `null`，工具据此返回缺少答案的错误；取消本轮则中断等待，旧问题的迟到答案不再被接受。[静态图](assets/question-result-779d978370.jpg)

### 先提出足以影响下一步的具体问题

模型可以提交下面的教学数据：

```json
{
  "question": "允许数字字符串时，非法字符串报错还是返回0？",
  "choices": ["报错", "返回0"]
}
```

这个问题把未知条件限制在一个具体选择上，回答后可以直接影响输入校验和测试。用户输入编号 `1`，面板把它转换成第一个选项的文字“报错”；用户也可以写自己的答案，例如“抛出 TypeError，并在错误里说明哪个参数不是数字”。

程序在显示前检查问题和选项，防止空问题、重复选项或过长内容进入面板。问题原文最多 500 个 UTF-16 单元，每个选项最多 80 个，不能纯空白；长度按 JavaScript 的 `.length` 计数。回答同样必须非空，最多 32,000 个单元。这些检查只能保证可用的输入形状，问题是否抓住了真正缺少的条件，仍要由模型和用户判断。

### 等待如何暂停，又怎样继续

问答函数为这次请求建立一个未完成的 Promise，显示带有独立标识的澄清面板。工具在 `await` 处等它，核心又在等工具，所以此时不会继续发起下一次模型请求。界面仍能显示并接收输入，等待并不等于整个程序停止响应。

用户按 Enter 后，面板把答案交给这次等待，Promise 完成，工具接着检查答案，再返回包含问题与答案的结果。核心把结果绑定原调用 ID，加入本轮消息。下一次请求携带这份消息，模型才会知道“非法字符串应报错”，然后决定怎样补输入校验与测试。

为什么不能把“报错”随手追加成普通聊天？因为模型提出的是一个待完成的工具调用。若对话里留下 `ask_user(q1)` 却没有 `q1` 的结果，调用与结果就没有配齐；新聊天也没有明确表明它回答的是哪次问题。沿用同一个 ID，既完成工具协议中的配对，也保留问题与答案的关系。

### 一次 Enter 只回答当前问题

普通草稿、审批面板和问答面板共用终端输入。问答出现时，TUI 暂停普通草稿的输入处理，让澄清面板独占本次回答；原草稿仍保留。否则，同一个 Enter 可能既回答“报错”，又把普通草稿发送出去。

每次问答都有独立的等待标识和结束标记。提交答案后先标记结束，再清理监听并关闭面板，后来的重复回调不能再次回答。若本轮被取消，取消信号结束这次等待；迟到的旧答案也不能落入下一轮的问题。按 Esc 表示这次没有回答，工具会返回缺少答案的错误，让模型说明还缺什么。

如果运行方式没有提供能够收集答案的问答函数，工具也直接返回“无法等待用户回答”的错误，不能一直挂起，更不能替用户选第一项。这样，用户能区分“正在等我的答案”和“当前入口无法收集答案”，模型也有真实结果可据此说明下一步。

本节处理的是模型主动发现缺少条件并提问。下一节换一个方向：模型没有问，我们在它运行时想起了新要求，怎样把这份补充送进正在进行的任务？

## 本节改动文件

本节把问题与答案接到已有工具结果路径，并由具体运行入口提供收集答案的方式。

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/run-options.ts](src/agent/run-options.ts) | 声明问题、选项和等待答案的 handler |
| NEW | [src/tools/ask-user.ts](src/tools/ask-user.ts) | 校验问题后等待答案，取消时拒绝旧答案 |
| NEW | [src/ui/tui/questions.tsx](src/ui/tui/questions.tsx) | 用独立等待对象和面板收取本次答案 |
| CHANGED | [src/tools/types.ts](src/tools/types.ts) | 给问答结果增加结构化元数据 |
| CHANGED | [src/tools/registry.ts](src/tools/registry.ts) | 注册 ask_user，把问答 handler 交给工具 |
| CHANGED | [src/permissions/policy.ts](src/permissions/policy.ts) | 允许澄清工具进入专用问答通道 |
| CHANGED | [src/models/client.ts](src/models/client.ts) | Plan 也提供问答工具，提示模型先澄清未定条件 |
| CHANGED | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 显示问题和已经返回的答案 |
| CHANGED | [src/ui/terminal.ts](src/ui/terminal.ts) | 文本输入只由现有读取器收取答案 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | 连接问答面板，暂停普通草稿与审批输入 |

## 动手构建

从 12.2 的完整 `src/` 继续，目标目录为 `chapter-12-task-control/03-clarify-questions/`。先建立问题与等待接口，再实现工具和面板，把 handler 沿原来的执行路径传进去。核心仍按已有调用 ID 写回结果。

以下代码是本节新增文件或明确替换片段。每一步先说明范围，再展开完整代码；没有列出的函数与文件继续沿用。

### 声明问题、选项和等待答案的 handler

完整替换 `src/agent/run-options.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：run-options.ts</summary>

<!-- source: src/agent/run-options.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] agent/run-options.ts
 *
 * 学习目标：把本节的运行控制数据交给核心，界面不需要代替核心作决策。
 * 输入：本地入口选定的模式、会话清单、问答 handler。
 * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
 * 状态：模式由启动入口取快照；清单属于会话，本文件不保存模型消息。
 * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
 *   本地界面 -> 本轮选项 -> 核心 / 工具 / 模型请求
 * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
 * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
 */
// [KEEP 来自 12.1] 模式由本地运行入口选择，默认继续执行。
/**
 * 本地入口可选的两种运行模式。
 * plan 只调查和制定计划；execute 仍需遵守每次工具的权限与审批。
 */
export type ExecutionMode = "plan" | "execute";

// [KEEP 来自 12.2] 容器由会话持有，切换模式和开始新一轮不会丢失任务清单。
/**
 * 清单中的一个步骤和模型报告的进度。
 * ID 用来辨认条目，状态不是测试证明；数量和字段限制由 todo_write 运行时检查。
 */
export type TaskItem = {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
};
/**
 * 会话持有的可替换清单容器。
 * 工具先校验完整新数组再替换 items，失败时旧数组继续使用。
 */
export type TaskState = { items: TaskItem[] };

// [CHANGED 12.3] 答案只交回正在等待的工具调用；null 表示用户未回答。
// [CHANGED 12.3] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 这次澄清要显示的问题与选项。
 * 选项可为空，用户仍可自由回答；内容约束由 ask_user 检查。
 */
export type UserQuestion = { question: string; choices: string[] };
// [CHANGED 12.3] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 界面提供的专用问答等待入口。
 * 返回有效答案或表示未回答的 null；取消和显示失败可拒绝 Promise。
 */
export type QuestionHandler = (request: UserQuestion, signal: AbortSignal) => Promise<string | null>;

// [CHANGED 12.3] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
 * 可选入口由本地调用方提供，模型不能在普通文字中创建它们。
 */
export type RunOptions = {
  // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
  mode?: ExecutionMode;
  // [KEEP 来自 12.2] 清单容器跨模型请求和工具调用共用。
  tasks?: TaskState;
  // [CHANGED 12.3] 问答是被工具等待的控制入口，观察事件不能替代它。
  askUser?: QuestionHandler;
};
```

</details>

### 校验问题后等待答案，取消时拒绝旧答案

创建 `src/tools/ask-user.ts`。这是本节的新模块，完整实现如下。

<details>
<summary>创建文件：ask-user.ts</summary>

<!-- source: src/tools/ask-user.ts -->
```ts
/**
 * 12.3 澄清问题 | [NEW] tools/ask-user.ts
 *
 * 学习目标：让工具等待用户补齐重要信息，再把答案交回原来的调用。
 * 输入：模型给出的问题和选项 JSON、可选问答 handler、取消信号。
 * 输出：包含问题与答案的工具结果；调用 ID 由核心继续绑定。
 * 状态：本文件不直接读取键盘、不改文件、不授予权限；没有回答不能猜测决定。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   参数有效？-- 否 -> ToolError；是 -> 有 handler？-- 否 -> ToolError
 *                                                     +-- 是 -> 等回答
 *   等待后已取消？-- 是 -> 抛出取消原因；否 -> 回答有效？-- 否 -> ToolError
 *                                                             +-- 是 -> 原调用的结果
 * handler 负责交互等待；ToolError 由核心变成错误工具结果，取消由本轮中断路径处理。
 * 运行观察：模型先请求澄清，收到该工具结果后才继续决策。
 */
// [NEW 12.3] 不明确的需求交给用户澄清，答案仍绑定原来的工具调用 ID。
import { ToolError } from "../errors.js";
import type { QuestionHandler, UserQuestion } from "../agent/run-options.js";
import type { ToolExecutionResult } from "./types.js";

// [NEW 12.3] 本文件以下类型、函数和界面均为本节新增。

export const askUserDefinition = {
  name: "ask_user",
  description: "询问会影响实现的重要缺失信息。question 是一个明确问题，choices 是最多 4 个简短选项，也可为空以接收自由回答。没有回答时不能猜测用户决定。",
  inputSchema: {
    type: "object" as const,
    properties: {
      question: { type: "string" as const, minLength: 1, maxLength: 500 },
      choices: {
        type: "array" as const,
        maxItems: 4,
        items: { type: "string" as const, minLength: 1, maxLength: 80 },
      },
    },
    required: ["question", "choices"],
    additionalProperties: false,
  },
};

/**
 * 检查模型提出的问题和选项，得到交互界面能使用的问答内容。
 * 问题最长 500 个 UTF-16 单元，最多 4 个选项，每个最长 80 个单元；选项去空白后不能重复。
 * 返回整理后的问题和选项；JSON、字段或内容不符合要求时抛出 ToolError，尚未开始等待用户。
 */
function parseQuestion(argumentsJson: string): UserQuestion {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("ask_user 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("ask_user 参数必须是包含 question 和 choices 的对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("question" in input) || !("choices" in input)) {
    throw new ToolError("ask_user 参数必须且只能包含 question 和 choices。");
  }
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 500) {
    throw new ToolError("ask_user question 必须为 1–500 字符的非空问题。");
  }
  if (!Array.isArray(input.choices) || input.choices.length > 4) {
    throw new ToolError("ask_user choices 必须是最多 4 个选项的数组，也可以为空。");
  }
  const choices = input.choices.map((choice: unknown) => {
    if (typeof choice !== "string" || !choice.trim() || choice.length > 80) {
      throw new ToolError("ask_user 每个选项必须为 1–80 字符的非空文字。");
    }
    return choice.trim();
  });
  if (new Set(choices).size !== choices.length) throw new ToolError("ask_user choices 不能包含重复选项。");
  return { question: input.question.trim(), choices };
}

/**
 * 等用户回答这次澄清，再把答案作为工具结果返回。
 * 输入是问题参数、专用 handler 和本轮信号；没有 handler 就报告无法等待。
 * 等待后先检查取消，再检查非空答案和 32000 个 UTF-16 单元上限；未回答时抛出 ToolError。
 * 返回问题与答案，核心负责将结果绑定原调用 ID；回答不能批准文件修改或命令。
 */
export async function askUserTool(
  argumentsJson: string, handler: QuestionHandler | undefined, signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const request = parseQuestion(argumentsJson);
  if (!handler) throw new ToolError("当前运行方式无法等待用户回答。请说明缺少的信息，不能猜测用户选择。");
  // [NEW 12.3] 此处真正等待专用问答，不用观察事件或普通聊天代替答案。
  const answer = await handler(request, signal);
  // 取消与答案同时发生时，旧答案不能继续进入模型历史。
  signal.throwIfAborted();
  // [NEW 12.3] 未答和空答成为工具错误，模型不能猜测用户决定。
  if (answer === null || typeof answer !== "string" || !answer.trim()) {
    throw new ToolError("用户没有回答这次澄清问题。请说明缺少的信息，不能猜测答案。");
  }
  if (answer.length > 32_000) throw new ToolError("用户回答不能超过 32000 字符。");
  return {
    content: JSON.stringify({ question: request.question, answer: answer.trim() }, null, 2),
    metadata: { kind: "ask_user", question: request.question, answer: answer.trim() },
  };
}
```

</details>

### 用独立等待对象和面板收取本次答案

创建 `src/ui/tui/questions.tsx`。这是本节的新模块，完整实现如下。

<details>
<summary>创建文件：questions.tsx</summary>

<!-- source: src/ui/tui/questions.tsx -->
```ts
/**
 * 12.3 澄清问题 | [NEW] ui/tui/questions.tsx
 *
 * 学习目标：用专用面板收集一次澄清答案，普通草稿不参与回答。
 * 输入：本次问题、选项、取消信号，以及面板尺寸和键盘输入。
 * 输出：waitForAnswer 的 Promise 返回答案或 null；问答结束就关闭面板。
 * 状态：每次请求有独立 key 和 settled 标记；取消后旧回调不能回答新问题。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   waitForAnswer -> 已取消？-- 是 -> 抛错；否 -> 显示新面板、监听 abort
 *   编号 / 自由文字 -> trim 后非空？-- 否 -> 提示重输；是 -> resolve 答案、关闭面板
 *   Esc -> resolve null；abort / 显示失败 -> reject；结束后旧 respond 返回 false
 *   QuestionPanel -> 问题换行分页 -> 独立 DraftEditor -> submit -> 原 respond
 * 先将等待标为结束，再移除监听和清面板，防止重复提交或旧答案落进下一次请求。
 * 运行观察：普通草稿仍保留；翻页不提交，Esc 表示本次未回答。
 */
// [NEW 12.3] 澄清独占自己的 Promise；旧面板回调不能回答新请求。
import { randomUUID } from "node:crypto";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import wrapAnsi from "wrap-ansi";
import type { UserQuestion } from "../../agent/run-options.js";
import { DraftEditor, newDraft } from "./editor.js";
import { screenText } from "./state.js";
import { useColor } from "./layout.js";

// [NEW 12.3] 本文件以下类型、函数和界面均为本节新增。

/**
 * 问答面板与正在等待的工具之间的一次性连接。
 * key 辨认当前请求；respond 返回是否接受答案，旧请求结束后只能返回 false。
 */
export type PendingQuestion = { key: string; request: UserQuestion; respond: (answer: string | null) => boolean };

/**
 * 把一次问答面板连接到核心正在等待的 Promise。
 * 先检查取消，再显示带独立 key 的请求；回答返回文字，Esc 返回 null。
 * 结束时只处理一次：标记 settled、移除监听、关闭面板，然后 resolve 或 reject。
 * 旧 respond 遇到已结束、已取消或空回答就返回 false；显示失败和取消向工具等待传播。
 */
export function waitForAnswer(request: UserQuestion, signal: AbortSignal,
  show: (pending: PendingQuestion | undefined) => void): Promise<string | null> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // [NEW 12.3] 每次等待独立保存结束标记，答案和取消只完成一次。
    let settled = false;
    /**
     * 收束这一次问答等待，避免答案和取消各自完成一次。
     * 先锁住 settled 并移除取消监听，再清面板；清面板失败时拒绝 Promise。
     * 有效答案 resolve，取消或显示错误 reject；后来的回调不再修改状态。
     */
    const finish = (outcome: { answer: string | null } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      try { show(undefined); } catch (error) { reject(error); return; }
      if ("answer" in outcome) resolve(outcome.answer); else reject(outcome.error);
    };
    /**
     * 把本轮信号的取消原因交给同一次问答等待。
     * 复用 finish 的单次结束保护，取消不会伪装成用户没有回答。
     */
    const abort = () => finish({ error: signal.reason });
    signal.addEventListener("abort", abort, { once: true });
    const pending: PendingQuestion = { key: randomUUID(), request,
    /**
     * 只接受这次尚未结束的问答答案。
     * 已结束、已取消或空回答返回 false；成功交给 finish 并返回 true。
     */
    respond(answer) {
      // [NEW 12.3] 旧回调失效或已取消时拒绝答案，不让它进入下一次问答。
      if (settled || signal.aborted || (answer !== null && !answer.trim())) return false;
      finish({ answer: answer === null ? null : answer.trim() });
      return true;
    } };
    try { show(pending); } catch (error) { finish({ error }); }
    if (signal.aborted) abort();
  });
}

/**
 * 显示并收集当前澄清问题，普通草稿由父组件继续保存。
 * 长问题按列宽换行分页；窗口不足 40 列、16 行时暂停普通面板输入。
 * 编号可以选择选项，也能输入自由文字；Enter 提交，Esc 表示本次未回答。
 * 面板只调用当前 pending.respond，不写模型历史，也不作出工具批准。
 */
export function QuestionPanel({ pending, columns, rows }: { pending: PendingQuestion; columns: number; rows: number }) {
  // [NEW 12.3] 问答使用独立草稿，不覆盖普通任务草稿。
  const [draft, setDraft] = useState(newDraft());
  const [page, setPage] = useState(0);
  const [hint, setHint] = useState("");
  const tooSmall = columns < 40 || rows < 16;
  const content = [pending.request.question, ...pending.request.choices.map((choice, index) => `${index + 1}. ${choice}`)].join("\n");
  const lines = wrapAnsi(screenText(content), Math.max(10, columns - 4), { hard: true, trim: false }).split("\n");
  const size = Math.max(1, rows - 11);
  const pages = Math.max(1, Math.ceil(lines.length / size));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage((old) => Math.min(old, pages - 1)), [pages]);
  useInput((input, key) => {
    if (key.escape) pending.respond(null);
    if (key.pageDown) setPage((old) => Math.min(pages - 1, old + 1));
    if (key.pageUp) setPage((old) => Math.max(0, old - 1));
  }, { isActive: !tooSmall });
  /**
   * 把问答草稿转换成选项内容或自由回答。
   * 空白只提示重输；有效编号取对应选项，其他文字去掉首尾空白后作为回答交回本次 respond。
   * 旧请求已结束时显示提示，不能把这份答案交给下一次问题。
   */
  const submit = (value: string) => {
    const answer = value.trim();
    if (!answer) { setHint("请输入回答，或按 Esc 跳过这次澄清。"); return; }
    const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    if (!pending.respond(pending.request.choices[index] ?? answer)) setHint("这次澄清已结束。");
  };
  return <Box borderStyle="round" borderColor={useColor ? "yellow" : undefined} paddingX={1} flexDirection="column">
    <Text wrap="truncate">等待澄清 · 第 {currentPage + 1}/{pages} 页</Text>
    <Text>{lines.slice(currentPage * size, (currentPage + 1) * size).join("\n")}</Text>
    <Text wrap="truncate">可输入选项编号，或直接写自己的回答。</Text>
    <Text wrap="truncate">PgUp/PgDn 查看问题 · Enter 回答 · Esc 未回答</Text>
    <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={!tooSmall} width={columns - 4} height={3} />
    <Text wrap="truncate">{hint || "回答只交回当前 ask_user；原普通草稿仍保留。"}</Text>
  </Box>;
}
```

</details>

### 给问答结果增加结构化元数据

完整替换 `src/tools/types.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：types.ts</summary>

<!-- source: src/tools/types.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] tools/types.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责区分给模型的工具正文和给界面的结果数据。
 * 输入：工具给出的预览与执行函数，或已运行完成的结果正文与元数据。
 * 输出：PreparedToolCall 用于审批；ToolExecutionResult.content 给模型，metadata 给界面。
 * 状态：这里只有类型声明，不会执行操作，也没有运行时状态提交。
 *
 * 本文件局部流程（数据关系；全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 准备结果 -> preview / execute；执行结果 -> content / metadata。
 * isError=true 也可以有完整 content：测试非零退出时，报告不能随错误标记一起丢掉。
 * 这里定义数据形状，不执行命令或修改文件。观察：终端能直接显示退出码和两条输出。
 */

import type { TaskItem } from "../agent/run-options.js";

// [KEEP 来自 07.1] 命令输出和退出状态同时交给模型与界面。
// [CHANGED 12.3] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
export type ToolResultMetadata =
  // [CHANGED 12.3] 澄清答案与问题有独立显示字段，不必从正文重新解析。
  | { kind: "ask_user"; question: string; answer: string | null }
  // [KEEP 来自 12.2] 清单条目作为界面数据返回，正文仍交给模型。
  | { kind: "todo_write"; items: TaskItem[] }
  | { kind: "run_command"; exitCode: number | null; signal: string | null; stdout: string; stderr: string; stopReason?: "timeout" | "output_limit" }
  | { kind: "read_file"; lineCount: 0 }
  | {
      kind: "read_file";
      lineCount: number;
      startLine: number;
      endLine: number;
      hasMore: boolean;
    }
  | { kind: "glob"; count: number; truncated: boolean; paths: string[] }
  | {
      kind: "grep";
      count: number;
      truncated: boolean;
      locations: Array<{ path: string; line: number; column: number }>;
    }
  // [KEEP 来自 06.1] 写入结果只暴露路径和字节数，完整内容由审批 diff 展示。
  | { kind: "write_file"; path: string; bytes: number }
  // [KEEP 来自 06.3] backupPath 是工具已经创建的真实恢复位置；模型和界面不从 content 解析它。
  | { kind: "edit_file"; path: string; bytes: number; backupPath: string };

export type ToolExecutionResult = {
  // [KEEP 来自 07.1] 命令可以正常返回结果，但测试本身失败。
  isError?: boolean;
  content: string;
  metadata: ToolResultMetadata;
};

/**
 * 把操作预览和批准后要调用的函数放在一起。
 *
 * preview 给人看；execute 闭包记住本次文件修改或命令，以及执行前需复查的数据。
 * 主循环等待审批后继续使用这个结果：拒绝就跳过，批准就为当前请求执行一次。
 * preview 只用来展示，不拿它写文件或当作待执行的 shell 命令。
 */
// [KEEP 来自 06.1] 准备结果把参数检查和预览，与真正写入或启动命令分开。
export type PreparedToolCall = {
  preview: string;
  execute(signal: AbortSignal): Promise<ToolExecutionResult>;
};
```

</details>

### 注册 ask_user，把问答 handler 交给工具

完整替换 `src/tools/registry.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：registry.ts</summary>

<!-- source: src/tools/registry.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] tools/registry.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责根据工具名称找到实现，并传入本轮清单与问答入口。
 * 输入：模型给出的工具名称、JSON 参数与取消信号。
 * 输出：读取、清单和问答工具返回结果；写入和命令先返回 preview/execute，批准后才返回实际结果。
 * 状态：分发失败向外抛错；执行入口调用过的工具可能已有副作用，注册表不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   prepareTool -> 写入或命令？-- 是 -> 对应准备函数 -> 返回预览，或抛错
 *                             +-- 否 -> 返回 null
 *   executeTool -> 直接执行工具？-- 是 -> 对应执行函数 -> 返回结果，或抛错
 *                           +-- 否 -> 拒绝直接写入、命令或未知工具
 *   executePreparedTool -> 保存的 execute -> 结果或错误
 *
 * 注册表只寻找实现，不产生批准；permissions/policy.ts 决定是否需要询问用户。
 * 命令和写入不能从旧的直接执行入口绕过审批，准备阶段也没有这些副作用。
 * 观察：run_command 先出现操作预览，批准后才出现命令结果。
 */

// [KEEP 来自 07.1] 命令和文件修改复用同一条准备、审批通道。
import { prepareRunCommand, runCommandDefinition } from "./run-command.js";
import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
import { editFileDefinition, prepareEditFile } from "./edit-file.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import type { RunOptions } from "../agent/run-options.js";
import { todoWriteDefinition, todoWriteTool } from "./todo-write.js";
// [CHANGED 12.3] 引入 ask-user 的本节类型或实现。
import { askUserDefinition, askUserTool } from "./ask-user.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
// [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
// [CHANGED 12.3] 保存本节所需选项或工具定义，不从聊天文字产生控制权限。
export const toolDefinitions = [
  // [KEEP 来自 07.1] 命令工具也要先批准，不能直接执行。
  readFileDefinition, globDefinition, grepDefinition, writeFileDefinition, editFileDefinition, runCommandDefinition,
  todoWriteDefinition,
  askUserDefinition,
];

/**
 * 找到需要审批的工具，先准备它的操作预览。
 *
 * write_file、edit_file 和 run_command 返回 PreparedToolCall，只读工具返回 null。
 * 主循环在权限判断之后、用户决定之前调用这里，所以准备不能写文件或启动命令。
 * 准备失败抛出 ToolError，由主循环转成工具错误交回模型。
 */
// [KEEP 来自 06.1] Agent Loop 在 ask 之后、审批之前调用这个准备入口。
export async function prepareTool(
  call: ToolCall,
  signal: AbortSignal,
): Promise<PreparedToolCall | null> {
  signal.throwIfAborted();
  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal);
  // [KEEP 来自 06.2] 精确替换也必须在审批前解析当前文件并生成 diff。
  if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal);
  // [KEEP 来自 07.1] 准备阶段只固定命令和目录，不启动子进程。
  if (call.name === runCommandDefinition.name) return prepareRunCommand(call.arguments, undefined, signal);
  return null;
}

/**
 * 把无需预览审批的工具分发到对应实现。
 * todo_write 接收本轮共用的清单；ask_user 接收问答 handler 并等待答案。
 * 读取和搜索工具接收参数与取消信号；返回正文和界面数据。
 * 写入、命令或未知工具抛出 ToolError，不能从这里绕过准备与审批；调用 ID 由核心管理。
 */
// [CHANGED 12.3] 工具分发新增本节实现或运行选项。
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
  // [KEEP 来自 12.2] 新增本轮控制选项，便于传入清单和后续问答入口。
  options: RunOptions = {},
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  // [KEEP 来自 12.2] 分发给清单工具，传入同一份 TaskState。
  if (call.name === todoWriteDefinition.name) return todoWriteTool(call.arguments, options.tasks ?? { items: [] }, signal);
  // [CHANGED 12.3] 分发给问答工具，等待本地 handler 后返回原调用结果。
  if (call.name === askUserDefinition.name) return askUserTool(call.arguments, options.askUser, signal);
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  // [KEEP 来自 07.1] 拒绝绕过审批的直接执行。
  if (call.name === writeFileDefinition.name || call.name === editFileDefinition.name || call.name === runCommandDefinition.name) {
    throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  }
  throw new ToolError(`未知工具：${call.name}`);
}

/**
 * 执行主循环已经批准的那一次操作。
 *
 * 只调用 prepared 中保存的 execute，并向它传递本轮取消信号。
 * 不重新解析模型请求，所以文件修改或命令仍来自准备时保存的输入。
 * 批准检查由调用方完成，文件或进程的具体执行与失败处理仍在对应工具里。
 */
// [KEEP 来自 06.1] 写入和命令的副作用都从这个已准备的入口执行。
export function executePreparedTool(
  prepared: PreparedToolCall,
  signal: AbortSignal,
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  return prepared.execute(signal);
}
```

</details>

### 允许澄清工具进入专用问答通道

在 `src/permissions/policy.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `decideToolPermission()`。

<details>
<summary>policy.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/permissions/policy.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] permissions/policy.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责在每个工具执行前判断模式、路径和本次批准。
 * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
 * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
 * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   已登记工具 + 参数对象？-- 否 -> deny
 *                         +-- 是 -> run_command？-- 是 -> ask，remember=false
 *                                                 +-- 否 -> 检查文件工具范围
 *   文件请求 -> 越界、.env 或禁止的元数据写入/搜索？-- 是 -> deny
 *                                                    +-- 否 -> 需要读取元数据？
 *              已有只读授权 -> allow / 尚无授权 -> ask
 *              普通写入 -> ask，remember=false / 普通只读 -> allow
 *
 * 命令不靠 cwd 推断副作用，也不会套用文件工具的 .env 检查冒充 shell 沙箱。
 * 它的完整参数和真实目录在准备阶段校验，之后展示给用户，只批准这一次操作。
 * 只读范围可以记住，命令和文件写入不可以；聊天里的“已经批准”不产生权限。
 * 观察：run_command 只有本次允许或拒绝，没有会话批准。
 */

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import { findProjectRoot } from "../tools/workspace.js";
import type { ExecutionMode } from "../agent/run-options.js";
```

**替换 decideToolPermission：**

<!-- source: src/permissions/policy.ts -->
```ts
/**
 * 由本地策略判断这次工具能否执行。
 * 先检查登记工具和 JSON 对象，再检查本轮模式；Plan 的写入、编辑和命令直接 deny。
 * 清单和澄清工具允许进入自身校验与执行，不需要文件审批；它们不能授予其他权限。
 * 执行模式的命令每次 ask；文件请求先检查硬拒绝，再查询只读会话授权，最后决定 allow 或 ask。
 * 返回 ask 时附本地生成的 scope 和 remember；只有可记住的只读范围才可进入授权集合。
 * 这里只返回决定，准备和执行仍要检查参数与路径，拒绝不会运行工具。
 */
// [CHANGED 12.3] 在现有策略中加入本节工具或模式判断。
export async function decideToolPermission(
  call: ToolCall,
  // [KEEP 来自 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
  sessionGrants: ReadonlySet<string> = new Set(),
  projectRoot = findProjectRoot(),
  // [KEEP 来自 12.1] 增加本轮模式参数，默认继续沿用执行模式。
  mode: ExecutionMode = "execute",
): Promise<PermissionDecision> {
  if (!toolDefinitions.some((tool) => tool.name === call.name)) {
    return { action: "deny", reason: `工具未登记：${call.name}` };
  }
  const input = parseArguments(call.arguments);
  if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };

  // [KEEP 来自 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
  if (mode === "plan" && ["write_file", "edit_file", "run_command"].includes(call.name)) {
    return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
  }
  // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
  if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
  // [CHANGED 12.3] 放行澄清等待；答案不产生文件或命令批准。
  if (call.name === "ask_user") return { action: "allow", reason: "澄清问题只等待用户回答，不授予工具执行权限" };
  // [KEEP 来自 07.1] 命令能做什么不能由 cwd 推断；每一次都交给用户确认。
  if (call.name === "run_command") {
    return { action: "ask", reason: "命令可能修改文件或访问网络，请核对命令和执行目录",
      resource: "本次命令与工作目录", scope: "run_command:once", remember: false };
  }
  const path = getRequestedPath(call, input);
  if (!path) return { action: "deny", reason: "工具缺少用于判断访问范围的路径参数" };
  const normalized = path.replaceAll("\\", "/");
  if (leavesProject(normalized)) return { action: "deny", reason: "请求不能离开当前项目" };
  if (containsEnvironmentFile(normalized)) return { action: "deny", reason: "环境配置文件属于硬保护范围" };
  const protectedDirectory = findApprovalDirectory(normalized);
  // [KEEP 来自 06.2] 创建与编辑共用同样的禁止写入范围。
  const changesFile = call.name === "write_file" || call.name === "edit_file";
  if (changesFile && protectedDirectory) {
    return { action: "deny", reason: `${protectedDirectory} 属于不可写入的项目元数据目录` };
  }
  if (call.name !== "read_file" && !changesFile && protectedDirectory) {
    return {
      action: "deny",
      reason: `搜索工具不访问 ${protectedDirectory}；如需读取，请用 read_file 请求具体文件`,
    };
  }

  if (call.name === "read_file") {
    const actualPath = await resolvePermissionPath(normalized, projectRoot);
    if (actualPath === null) return { action: "deny", reason: "文件的真实路径位于当前项目外" };
    if (containsEnvironmentFile(actualPath)) {
      return { action: "deny", reason: "环境配置文件属于硬保护范围" };
    }
    const directory = findApprovalDirectory(actualPath);
    if (directory) {
      const scope = `read_file:${directory}/**`;
      if (sessionGrants.has(scope)) {
        return { action: "allow", reason: `本次会话已经允许 ${scope}` };
      }
      return {
        action: "ask",
        reason: `读取 ${directory} 项目元数据需要用户确认`,
        resource: actualPath === normalized ? normalized : `${normalized} -> ${actualPath}`,
        scope,
        remember: true,
      };
    }
  }

  // [KEEP 来自 06.2] 创建和编辑都必须批准当前 diff，不能靠旧的目录授权直接写入。
  if (changesFile) {
    return {
      action: "ask",
      reason: "修改文件会改变工作区，必须先审查本次差异",
      resource: normalized,
      scope: `${call.name}:${normalized}`,
      remember: false,
    };
  }

  return { action: "allow", reason: "项目内普通只读工具" };
}
```

</details>

### Plan 也提供问答工具，提示模型先澄清未定条件

在 `src/models/client.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `requestResult()`。

<details>
<summary>client.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/models/client.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] models/client.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责按本轮模式组装请求，收齐并检查模型结果。
 * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
 * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
 * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 请求流 -> 文字片段 -> onText
 *                  +-> 完整消息 -> 归一化结束原因
 *   OpenAI 工具参数 -> SDK 累积的完整字符串 ------------------+
 *   Anthropic 参数 -> 按内容块 index 保存原始 JSON 片段         |
 *                  -> message_stop 与片段顺序有效？-- 否 -> 抛错
 *                                                 +-- 是 ----+
 *   完整结果 -> 正常文本或工具结束？-- 否 -> 返回结束原因，不返回工具
 *                                  +-- 是 -> 检查支持的工具类型与参数
 *   每个调用 ID 非空且批内唯一、参数为完整 JSON 对象？-- 否 -> 整批抛错
 *                                                     +-- 是 -> 返回 ModelResult
 *   请求、解析、超时或取消失败 -> 抛错，不返回半份结果
 *
 * [KEEP] 表示沿用前节。SDK 的流中途对象可能来自部分 JSON 解析，不能证明参数已经完整。
 * Anthropic 的执行参数来自本地累积的原始字符串；内容块结束后仍要通过 JSON.parse。
 * 这些检查只确认协议和 JSON 对象形状；字段值、路径与审批仍由已有工具和权限代码负责。
 * 每次 generate 设置独立的 60 秒期限，不自动重试；失败不改历史，也不在这里启动工具。
 *
 * [KEEP 来自 12.1] 每次请求使用本轮模式；Plan 隐藏写入、编辑和命令工具，提示只调查和计划。
 * 筛选工具帮助模型选择；permissions/policy.ts 的硬拒绝才保证禁止请求不会执行。
 * [KEEP 来自 12.2] 提示模型使用 todo_write 报告进度；这不会把报告变成测试证明。
 * [CHANGED 12.3] 提示模型用 ask_user 澄清重要缺失信息，并在 Plan 的可见列表中保留它。
 * 运行观察：一批调用中只要有一份参数损坏，整批都不会进入权限与执行阶段。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ExecutionMode } from "../agent/run-options.js";
```

**替换 requestResult：**

<!-- source: src/models/client.ts -->
```ts
/**
 * 接收模型文字和工具参数，等完整消息检查通过后返回统一结果。
 *
 * - 输入：SDK 客户端、模型 ID、本地消息数组、请求取消信号和可选文字回调。
 * - 输出：文字片段通过 onText 提前显示；返回值另有完整文本、工具调用、用量和结束原因。
 * - 关键步骤：OpenAI 使用 SDK 完整累积的参数；Anthropic 另外按内容块 index 累积原始 JSON 字符串。
 * - 参数检查：只在正常结束原因下检查整批工具的 ID 与 JSON 对象；字段值仍留给本地工具检查。
 * - 失败方式：SDK 失败、Anthropic 流未完整结束、片段顺序无效或参数损坏时抛错，不返回可执行的半份调用。
 * - 职责边界：length、refusal 等结束原因交给 Agent Loop 报告；这里不批准工具，也不提交历史。
 */
// [KEEP 来自 08.2] 片段用于显示，完整响应才进入统一结果。
// [CHANGED 12.3] 请求组装接入本节模式和工具提示。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
  onText?: (text: string) => void,
  // [KEEP 来自 12.1] 本轮模式沿接口传到两种模型协议。
  mode: ExecutionMode = "execute",
): Promise<ModelResult> {
  // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
  // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
  const definitions = mode === "plan"
    // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
    ? toolDefinitions.filter((tool) => ["read_file", "glob", "grep", "todo_write", "ask_user"].includes(tool.name))
    : toolDefinitions;
  // [CHANGED 12.3] 本节提示模型用专用工具澄清重要缺失信息，不猜测未回答的决定。
  const prompt = systemPrompt + " 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
    ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
    : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
  if (client instanceof OpenAI) {
    // [KEEP 来自 08.1] SDK 解析 SSE 并累积完整响应，content.delta 用来及时显示新文字。
    const stream = client.chat.completions.stream({
      model,
      messages: [{ role: "system", content: prompt }, ...toOpenAIMessages(messages)],
      tools: definitions.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name, description: tool.description,
          // [KEEP 来自 08.1] 第 07 章练习的 timeout_ms 保持可选；本地仍会完整校验工具参数。
          parameters: tool.inputSchema, strict: false,
        },
      })),
      stream_options: { include_usage: true },
    }, { signal });
    stream.on("content.delta", ({ delta }) => onText?.(delta));
    const response = await stream.finalChatCompletion();
    const choice = response.choices?.[0];
    if (!choice) throw new UserFacingError("接口没有返回可用结果，请检查模型是否支持工具调用。");
    // [KEEP 来自 08.2] 结束原因正常才接收工具；拒绝和截断只交给核心说明。
    const reason = choice.message.refusal ? "refusal" : finishReason(choice.finish_reason);
    if (choice.message.tool_calls?.some((call) => call.type !== "function")) {
      throw new UserFacingError("接口返回了本章尚不支持的工具类型，本批工具未执行。");
    }
    const calls = reason === "tool_calls" || reason === "stop"
      ? (choice.message.tool_calls ?? []).filter((call) => call.type === "function")
        .map((call) => normalizeToolCall(call.id, call.function.name, call.function.arguments))
      : [];
    return {
      text: choice.message.content ?? "", toolCalls: validateToolCalls(calls), finishReason: reason,
      inputTokens: tokenCount(response.usage?.prompt_tokens),
      outputTokens: tokenCount(response.usage?.completion_tokens),
      truncated: reason === "length",
    };
  }

  // [KEEP 来自 08.2] Anthropic 的文字和工具参数分开接收；SDK 负责 SSE 与完整消息聚合。
  const stream = client.messages.stream({
    model, system: prompt, messages: toAnthropicMessages(messages),
    tools: definitions.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema,
    })),
    max_tokens: 2048,
  }, { signal });
  const argumentsByIndex = new Map<number, { json: string; initial: unknown; closed: boolean }>();
  let messageStopped = false;
  let invalidSequence = false;
  stream.on("text", (text) => onText?.(text));
  stream.on("streamEvent", (event) => {
    if (event.type === "message_stop") messageStopped = true;
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      if (argumentsByIndex.has(event.index)) invalidSequence = true;
      argumentsByIndex.set(event.index, { json: "", initial: event.content_block.input, closed: false });
    }
    if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      const part = argumentsByIndex.get(event.index);
      if (!part || part.closed) invalidSequence = true;
      else part.json += event.delta.partial_json;
    }
    if (event.type === "content_block_stop") {
      const part = argumentsByIndex.get(event.index);
      if (part) part.closed = true;
    }
  });
  const response = await stream.finalMessage();
  if (!messageStopped || invalidSequence) {
    throw new UserFacingError("模型流没有完整结束或工具片段顺序无效，本批工具未执行。");
  }
  const reason = finishReason(response.stop_reason);
  const calls: ToolCall[] = [];
  if (reason === "tool_calls" || reason === "stop") {
    for (const [index, block] of response.content.entries()) {
      if (block.type === "text") continue;
      if (block.type !== "tool_use") throw new UserFacingError("接口返回了本章不支持的内容类型，本批工具未执行。");
      const part = argumentsByIndex.get(index);
      if (!part?.closed) throw new UserFacingError("工具参数还没有结束，本批工具未执行。");
      // SDK 的部分 JSON 快照方便界面展示，但执行必须检查完整的原始参数字符串。
      calls.push(normalizeToolCall(block.id, block.name, part.json || JSON.stringify(part.initial)));
    }
  }
  return {
    text: response.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
    toolCalls: validateToolCalls(calls), finishReason: reason,
    inputTokens: tokenCount(response.usage?.input_tokens),
    outputTokens: tokenCount(response.usage?.output_tokens),
    truncated: reason === "length",
  };
}
```

</details>

### 显示问题和已经返回的答案

在 `src/ui/teaching-trace.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `describeToolResult()`。

<details>
<summary>teaching-trace.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/teaching-trace.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] ui/teaching-trace.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责从结构化事件整理过程说明，保留模型正文的用途。
 * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
 * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 事件 -> run_start / run_finish？-- 是 -> 空数组，结果由调用方处理
 *                                             +-- 否 -> text_delta？-- 是 -> 空数组，正文由 renderer 追加
 *                                                                   +-- 否 -> 按事件类型选择字段
 *   字段 -> 控制字符清理、常见凭据特征隐藏与长度限制 -> 返回文本行
 *
 * run_finish 只提供整轮结果，不需要再打印一次最终正文；model_finish 仍解释单次决策的结果。
 * 工具状态来自元数据，命令退出码非零是失败，stderr 有字不能单独证明失败。
 * stdout/stderr 摘要各保留前 240 个清理后字符，超出再加省略号，不改变交给模型的工具正文。
 * 常见凭据检测不等于完整脱敏；原始事件仍可能包含敏感内容，不能直接作为公开日志。
 * 运行观察：连续文字由 renderer 显示，准备、审批和工具结果仍各有简短步骤说明。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";
```

**替换 describeToolResult：**

<!-- source: src/ui/teaching-trace.ts -->
```ts
/**
 * 把工具自己的元数据变成终端摘要，不从模型回答反推执行情况。
 *
 * 文件工具提供路径、位置和数量；命令还提供退出码、信号、停止原因及两条输出。
 * 返回值只给终端显示，输出会清理、限长并隐藏常见凭据特征；不改工具 content。
 * 命令是否失败由结果的 isError 交给外层决定，这里不会因为 stderr 有文字就改判结果。
 */
// [CHANGED 12.3] 界面摘要识别本节新增工具结果。
function describeToolResult(metadata: ToolResultMetadata): string {
  // [CHANGED 12.3] 回答是工具结果，不当作文件内容。
  // [CHANGED 12.3] 澄清结果显示已答或未答，不当作文件结果。
  if (metadata.kind === "ask_user") return metadata.answer === null ? "用户未回答本次澄清" : `已收到回答：${toTraceText(metadata.answer, 120)}`;
  // [KEEP 来自 12.2] 内存任务没有文件行数。
  // [KEEP 来自 12.2] 显示清单报告的数量，不把 completed 解释为测试通过。
  if (metadata.kind === "todo_write") return `任务清单：${metadata.items.length} 项，${metadata.items.filter((item) => item.status === "completed").length} 项已完成`;
  // [KEEP 来自 06.3] 只在工具成功事件中显示经过结构化元数据传来的备份路径；
  // 内容过期检测或备份失败走错误分支，不伪装成成功结果。
  // [KEEP 来自 07.1] 用退出码判断命令状态，stdout/stderr 分开显示。
  if (metadata.kind === "run_command") {
    return `退出码 ${metadata.exitCode ?? "无"}${metadata.signal ? `；信号 ${metadata.signal}` : ""}`
      + `${metadata.stopReason ? `；${metadata.stopReason === "timeout" ? "运行超时" : "输出超过上限"}` : ""}`
      + `\n  stdout：${metadata.stdout ? toTraceText(metadata.stdout, 240) : "（空）"}`
      + `\n  stderr：${metadata.stderr ? toTraceText(metadata.stderr, 240) : "（空）"}`;
  }
  if (metadata.kind === "edit_file") {
    return `已精确修改 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）；备份：${toTraceText(metadata.backupPath, 120)}`;
  }
  if (metadata.kind === "write_file") {
    return `已创建 ${toTraceText(metadata.path)}（${metadata.bytes} 字节）`;
  }
  if (metadata.kind === "glob") {
    const examples = metadata.paths.slice(0, 2).map((path) => toTraceText(path)).join("，");
    return `${metadata.count} 个路径${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }
  if (metadata.kind === "grep") {
    const examples = metadata.locations.slice(0, 2)
      .map(({ path, line, column }) => `${toTraceText(path)}:${line}:${column}`)
      .join("，");
    return `${metadata.count} 个匹配位置${metadata.truncated ? "（已截断）" : ""}`
      + `${examples ? `；示例：${examples}` : ""}`;
  }

  if (metadata.lineCount === 0 || !("startLine" in metadata)) return "0 行文件内容";
  return `${metadata.lineCount} 行源码（第 ${metadata.startLine}—${metadata.endLine} 行）`;
}
```

</details>

### 文本输入只由现有读取器收取答案

在 `src/ui/terminal.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `startTerminal()`、`runSinglePrompt()`。
在 `startTerminal()` 前新增 `createQuestionHandler()`；下方给出完整函数，它继续使用本文件已有的输入读取器。

<details>
<summary>terminal.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/terminal.ts -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：把缺少的重要信息交给用户澄清；本文件负责串行读取文本问题、审批与澄清，并显示同一轮事件。
 * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT。
 * 输出：stdout 显示模型正文；stderr 显示过程、审批、输入提示、本地状态与用量。
 * 状态：文本消费者沿用 09.3 的输出位置；失败或取消等待清理，不撤销已经发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件流 -> showRun -> renderer -> 模型文字？-- 是 -> stdout
 *                                            +-- 否 -> [KEEP] 步骤说明写 stderr
 *   completed -> Reply -> 正文已显示？-- 否 -> stdout 补正文
 *                                    +-- 是 -> 不重复正文
 *                         -> [KEEP] 用量与截断提示写 stderr
 *   审批 -> [KEEP] stderr 显示请求与预览 -> 可交互？-- 是 -> 共用输入读取决定
 *                                                             +-- 否 -> deny
 *   聊天 -> 本地命令 / 中断说明 -> [KEEP] stderr；退出时仍等待本轮与输入清理
 *
 * text 模式仍带终端标签，机器逐行解析使用另一个消费者 ui/jsonl.ts。
 * 两种输出模式使用相同的执行事件；本文件保持文本界面的交互审批，JSONL 不经过这里。
 * 颜色仍按 stdout.isTTY 决定；stdout 重定向时正文不含 ANSI 标签颜色。
 *
 * [KEEP 来自 12.1] /mode 是空闲本地命令；提交普通问题时把模式快照传入本轮。
 * [KEEP 来自 12.2] 清单在连续会话内复用，不因开始下一轮或切换模式重建。
 * [CHANGED 12.3] 澄清和审批共用 lines.read(signal)；/skip 或 EOF 表示没有回答。
 * 文本界面串行等待本轮结束；运行中的补充队列属于 TUI。
 * 运行观察：重定向 stdout 能保存模型文字，步骤、用量和本地提示留在 stderr。
 */

import { createInterface } from "node:readline";
// [KEEP 来自 08.3] 输入等待可以独立取消，不关闭整个终端。
import { createLineReader } from "./input.js";
// [KEEP 来自 09.1] 整轮通知由 runAgent 包装，Agent Loop 的决策逻辑沿用。
// [KEEP 来自 09.2] 终端通过异步迭代接收同一轮的结构化事件。
import { streamAgentRun, type AgentRecord } from "../agent/run-stream.js";
import type { AgentEvent } from "../agent/events.js";
import { explainError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
import { formatTeachingTrace } from "./teaching-trace.js";
// [CHANGED 12.3] 引入 run-options 的本节类型或实现。
import type { RunOptions, QuestionHandler } from "../agent/run-options.js";
```

**新增 createQuestionHandler：**

<!-- source: src/ui/terminal.ts -->
```ts
/**
 * 让澄清和聊天、审批串行使用同一个行读取器。
 * 只有可交互终端且存在 lines 时返回 handler，否则返回 undefined。
 * handler 显示问题和选项，循环等待非空编号或文字；/skip 或 EOF 返回 null。
 * 每次读取使用本轮信号，取消向工具传播；答案只交回原问答等待，不进入下一轮普通聊天。
 */
// [KEEP 来自 09.3] 本地状态写入 stderr。
// [CHANGED 12.3] 审批、澄清与普通问题串行使用同一读取器。
// [CHANGED 12.3] 函数接收本轮运行选项，保持已有执行与清理顺序。
export function createQuestionHandler(lines: ReturnType<typeof createLineReader> | undefined, interactive: boolean): QuestionHandler | undefined {
  if (!interactive || !lines) return undefined;
  return async (request, signal) => {
    signal.throwIfAborted();
    console.error(`澄清问题：${request.question}`);
    request.choices.forEach((choice, index) => console.error(`${index + 1}. ${choice}`));
    while (true) {
      process.stderr.write("回答（编号或文字；/skip 跳过）：");
      const { value, done } = await lines.read(signal);
      signal.throwIfAborted();
      if (done || value.trim() === "/skip") return null;
      const answer = value.trim();
      if (!answer) { console.error("回答不能为空，请重输或 /skip。"); continue; }
      const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      return request.choices[index] ?? answer;
    }
  };
}
```

**替换 startTerminal：**

<!-- source: src/ui/terminal.ts -->
```ts
// [KEEP 来自 02.4] history 的生命周期等于本次会话，agentLoop 负责每轮的提交规则。
/**
 * 持续读取聊天输入，在本轮结束清理后再接收下一次任务。
 *
 * - 输入：已创建的 Model；聊天、本地命令和 Ctrl+C 来自同一个终端。
 * - 输出：每轮显示回答或中断原因；/exit、EOF 或空闲时 Ctrl+C 结束会话。
 * - 关键步骤：每次普通问题创建 controller 和 renderer，history 与 sessionGrants 在整个会话内复用。
 * - 本轮执行：消费 streamAgentRun，由 showRun 逐条显示并从 completed 事件取得 Reply。
 * - 取消处理：Ctrl+C 取消 active、清空排队行与未提交草稿；等任务清理后才清空 active。
 * - 状态处理：核心保存本轮历史，/reset 只清空历史，不撤销授权或工具副作用。
 * - 职责边界：本地命令不进入模型，失败也不自动重试已经执行的工具。
 * - 输出位置：输入提示、readline 回显、本地命令和中断说明写入 stderr，模型文字仍由 renderer 写 stdout。
 */
// [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
// [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
// [CHANGED 12.3] 文本会话接入本节控制入口，保持串行输入。
export async function startTerminal(model: Model, options: RunOptions = {}): Promise<void> {
  const history: Message[] = [];
  let mode = options.mode ?? "execute";
  // [KEEP 来自 12.2] 持续会话复用清单，下一轮与模式切换不重建。
  const tasks = options.tasks ?? { items: [] };
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
  // [CHANGED 12.3] 交互问答复用同一行读取器，不能与聊天竞争输入。
  const askUser = options.askUser ?? createQuestionHandler(lines, terminal);
  const sessionGrants = new Set<string>();
  let active: AbortController | undefined;
  let exiting = false;
  const stop = () => {
    if (active) {
      active.abort();
      lines.clear();
      // [KEEP 来自 08.3] 丢弃未按回车的审批草稿，避免 y 残留成下一轮的 ynext。
      if (terminal) {
        input.write(null, { ctrl: true, name: "u" });
        input.write(null, { ctrl: true, name: "k" });
        process.stderr.write("\n");
      }
      return;
    }
    exiting = true;
    input.close();
    process.exitCode = 130;
  };
  input.on("SIGINT", stop);
  process.on("SIGINT", stop);
  console.error(`当前模式：${mode}；/mode plan|execute 切换模式。`);
  console.error("输入消息开始对话；运行中 Ctrl+C 取消本轮，空闲时 Ctrl+C 退出。/permissions 查看权限，/reset 清空历史，/exit 退出。");
  try {
    while (!exiting) {
      if (terminal) process.stderr.write(`${colorLabel("你", 36)} > `);
      const { value, done } = await lines.read();
      if (done) break;
      const text = value.trim();
      if (!text) continue;
      if (text === "/exit") break;
      if (handlePermissionCommand(text, sessionGrants)) continue;
      if (text === "/reset") {
        history.length = 0;
        console.error("已清空当前对话，下次提问将开始新的上下文。");
        continue;
      }
      // [KEEP 来自 12.1] 空闲本地切换模式，不把命令发送给模型。
      if (text === "/mode" || text.startsWith("/mode ")) {
        const requested = text.slice(6).trim();
        if (requested === "plan" || requested === "execute") mode = requested;
        console.error(`当前模式：${mode}${requested && requested !== "plan" && requested !== "execute" ? "；用法：/mode plan|execute" : ""}`);
        continue;
      }
      active = new AbortController();
      const renderer = createTurnRenderer();
      try {
        // [KEEP 来自 09.2] 同一份事件流驱动本轮显示。
        const reply = await showRun(streamAgentRun(model, history, text, active.signal,
          // [KEEP 来自 12.2] 每轮固定模式，并把共用清单传到核心。
          requestApproval, sessionGrants, { ...options, mode, tasks, askUser }), renderer);
        renderer.reply(reply);
        process.exitCode = 0;
      } catch (error) {
        renderer.finish();
        if (active.signal.aborted) {
          console.error("已取消本轮，可以继续输入。已执行的操作不会自动撤销。");
          process.exitCode = 0;
        } else {
          console.error(`错误：${explainError(error)} 已保留本轮状态，可以继续输入；程序不会自动重试。`);
          process.exitCode = 1;
        }
      } finally {
        // 必须先等请求或工具完成清理，再允许下一轮使用新信号。
        active = undefined;
      }
    }
  } finally {
    active?.abort();
    lines.dispose();
    input.off("SIGINT", stop);
    input.close();
    process.off("SIGINT", stop);
  }
}
```

**替换 runSinglePrompt：**

<!-- source: src/ui/terminal.ts -->
```ts
/**
 * 处理一次 --prompt 提问，完成或中断后退出，不进入连续聊天。
 *
 * - 输入：已创建的模型与非空问题；输入输出都可交互时才能询问审批，其他情况默认拒绝 ask。
 * - 执行方式：消费 streamAgentRun，逐条显示事件，流结束后取得完整 Reply。
 * - 输出：生成期间显示文字和步骤，成功时补上用量，已经显示的正文不会重复打印。
 * - 取消处理：Ctrl+C 或 SIGINT 取消同一轮并设退出码 130，等待模型或工具完成清理后退出。
 * - 失败方式：非取消错误继续交给 CLI 说明；finally 结束显示行、关闭输入并移除本次监听。
 * - 职责边界：不保存跨进程历史，不自动重试，也不撤销已经发生的文件或命令操作。
 * - 输出位置：审批与 readline 回显使用 stderr，正文保留在 stdout。
 */
// [KEEP 来自 08.3] 单次模式也使用可取消读取，并在退出时释放输入监听。
// [KEEP 来自 09.3] readline 的回显与审批提示使用 stderr。
// [CHANGED 12.3] 单次问题传入本节选项并等待同一轮事件。
export async function runSinglePrompt(model: Model, prompt: string, options: RunOptions = {}): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = interactive
    ? createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    : undefined;
  // [KEEP 来自 08.3] 单次模式的审批也复用可取消读取。
  const lines = input ? createLineReader(input) : undefined;
  // [KEEP 来自 07.2] 单次模式也传播 Ctrl+C，先取消子进程再关闭输入。
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    input?.close();
    process.exitCode = 130;
  };
  input?.on("SIGINT", stop);
  process.on("SIGINT", stop);
  // [KEEP 来自 08.1] 单次提问使用相同的增量显示器。
  const renderer = createTurnRenderer();
  try {
    const signal = controller.signal;
    console.error(`当前模式：${options.mode ?? "execute"}`);
    // [KEEP 来自 09.2] 单次提问复用同一个事件消费者。
    const reply = await showRun(streamAgentRun(model, [], prompt, signal,
      // [CHANGED 12.3] 单次文本任务也可等待澄清；非交互环境没有问答入口。
      createApprovalHandler(lines, interactive), new Set<string>(), { ...options, askUser: options.askUser ?? createQuestionHandler(lines, interactive) }), renderer);
    if (!controller.signal.aborted) renderer.reply(reply);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    renderer.finish();
    controller.abort();
    process.off("SIGINT", stop);
    lines?.dispose();
    input?.off("SIGINT", stop);
    input?.close();
  }
}
```

</details>

### 连接问答面板，暂停普通草稿与审批输入

在 `src/ui/tui/app.tsx` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `TuiApp()`。

<details>
<summary>app.tsx 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 12.3 澄清问题 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：把缺少的重要信息交给用户澄清，让界面操作和本轮执行有清楚的先后关系。
 * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
 * 输出：草稿、历史、模式、运行状态和审批面板。
 * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
 * 失败：保留已收到的结果，等事件流清理后解除忙碌；取消不会撤销工具操作。
 *
 * 本文件局部流程（界面操作；全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
 *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
 *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
 *   [KEEP 来自 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
 *   普通 Enter -> 忙碌？-- 是 -> 保留草稿、等待结束；否 -> 本地命令或开始任务
 *   [KEEP 来自 12.2] 任务清单工具结果 -> 会话内清单 -> 摘要和至多三项进度
 *   [CHANGED 12.3] ask_user -> waitForAnswer -> 问答面板独占输入 -> 原问答 Promise
 *                   -> 回答 / Esc / 取消 -> 关闭面板，普通草稿继续保留
 *   [KEEP] Ctrl+O -> 草稿 / 历史，审批或问答占用期间不切换
 *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
 *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
 *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑 -> 卸载、移除监听
 *
 * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
 * 清单进度是模型通过工具报告的状态；实际测试是否成功要看命令的结果。
 * 运行观察：澄清出现时普通草稿隐藏但仍保留，回答只交回当前问答。
 */
import { useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [KEEP 来自 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
// [CHANGED 12.3] 引入 questions 的本节类型或实现。
import { QuestionPanel, waitForAnswer, type PendingQuestion } from "./questions.js";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
import type { ExecutionMode, TaskState } from "../../agent/run-options.js";
```

**替换 TuiApp：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 把草稿、会话控制和执行事件连成可操作的终端工作区。
 * 普通任务只由提交 handler 启动；组件重绘不创建模型请求。
 * 焦点决定普通按键由哪一区处理，审批或澄清占用时暂停工作区输入。
 * 忙碌时继续编辑草稿，完成清理后才允许提交。
 * 局部 current 顺序累积事件；finally 等事件流清理后才解除占用。
 * 显示条目与模型历史分别保存；本组件不直接执行工具、提交历史或撤销副作用。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
// [CHANGED 12.3] 界面接入本节操作；具体状态和按键变化在对应分支标明。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<"draft" | "history">("draft");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  // [CHANGED 12.3] 澄清面板保存当前请求，与审批和普通草稿分开。
  const [question, setQuestion] = useState<PendingQuestion>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // [KEEP 来自 11.5] 先判断窗口是否容得下工作区，再决定普通输入是否激活。
  const tooSmall = columns < 40 || rows < 16;
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  /**
   * 把本地提示或已提交问题加入显示记录。
   * 分配稳定显示 ID，并以函数式更新追加到旧条目后；这里不提交模型历史。
   */
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };

  // [KEEP 来自 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
  /**
   * 在空闲时把终端交给外部编辑器，再取回仍未发送的草稿。
   * 任务、审批、问答或退出正在占用时只提示等待。
   * 编辑成功形成一次草稿修改；失败保留原文，结束后解除外部占用。
   */
  const openEditor = () => {
    if (session.done || session.external || session.closing || approval || question) { setNotice("请在当前任务结束后编辑草稿。"); return; }
    const controller = new AbortController();
    setEditing(true);
    session.external = { controller, done: (async () => {
      try {
        let text = draft.text;
        await suspendTerminal(async () => { text = await editExternally(draft.text, controller.signal); });
        if (!session.closing) { setDraft(changeDraft(draft, text)); setNotice("已取回编辑内容，按 Enter 才会发送。"); }
      } catch (error) { if (!session.closing) setNotice(screenText((error as Error).message)); }
      finally { session.external = undefined; if (!session.closing) setEditing(false); }
    })() };
  };
  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [KEEP 来自 11.5] 小窗口保留取消与退出，暂停焦点切换和外部编辑入口。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    if (!tooSmall && key.ctrl && input === "g" && focus === "draft") openEditor();
    if (!tooSmall && key.ctrl && input === "o" && !approval && !question) setFocus((old) => old === "draft" ? "history" : "draft");
  });

  /**
   * 处理普通草稿 Enter，决定本地命令、新任务或继续等待。
   * 忙碌时保留草稿，空白不提交；空闲本地命令只改会话状态。
   * 新任务记录已发送问题，并使用启动时的模式快照；失败提示不会自动重发。
   */
  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing || session.external) return;
    if (session.done) { setNotice("本轮仍在运行，草稿已保留；完成后再按 Enter 发送。"); return; }
    setNotice("");
    const prompt = value.trim();
    if (!prompt) return;
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    // [KEEP 来自 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
    if (prompt === "/mode" || prompt.startsWith("/mode ")) {
      const mode = prompt.slice(6).trim();
      if (mode === "plan" || mode === "execute") session.mode = mode;
      append("本地", `当前模式：${session.mode}${mode && mode !== "plan" && mode !== "execute" ? "；用法：/mode plan|execute" : ""}`);
      return;
    }
    session.prompts = [...session.prompts, prompt].slice(-100);
    append("你", prompt);
    const run = ++session.run;
    setBusy(true);
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();

    // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
    const options = { mode: session.mode, tasks: session.tasks,
      // [CHANGED 12.3] 问答工具等待这次 Promise，面板 key 让旧请求回调失效。
      askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
        if (!session.closing) setQuestion(pending);
      }),
    };
    session.controller = controller;
    session.done = (async () => {
      let current = emptyRunView();
      try {
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
          if (!session.closing) setApproval(pending);
        }), session.grants, options)) {
          // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // for await 完成或抛错前会等待生成器的 finally；此时才解除本轮占用。
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          // [CHANGED 12.3] 任务结束清掉当前面板，普通草稿未被改写。
          setQuestion(undefined);
          setBusy(false);
        }
      }
    })();
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。

  // [KEEP 来自 12.2] 按窗口显示摘要和至多三项，不丢弃真实清单。
  const taskLines = session.tasks.items.length === 0 ? 0 : 1 + (rows >= 20 ? Math.min(3, session.tasks.items.length, rows - 18) : 0);
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  // [KEEP 来自 12.2] 下方清单区域从会话读取进度，显示报告不等于测试通过。
  // [CHANGED 12.3] 下方澄清面板用独立 key 挂载，占用时隐藏普通区但保留草稿。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消任务 · Ctrl+D 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    {question && <QuestionPanel key={question.key} pending={question} columns={columns} rows={rows} />}
    <Box display={approval || question ? "none" : "flex"} flexDirection="column">
      {taskLines > 0 && <Box flexDirection="column">
        <Text wrap="truncate">任务：{session.tasks.items.filter((item) => item.status === "completed").length}/{session.tasks.items.length} 已完成 · {session.tasks.items.filter((item) => item.status === "in_progress").length} 进行中 · {session.tasks.items.filter((item) => item.status === "pending").length} 待办</Text>
        {session.tasks.items.slice(0, taskLines - 1).map((item) => <Text key={item.id} wrap="truncate">{item.status === "completed" ? "[完成]" : item.status === "in_progress" ? "[进行]" : "[待办]"} {screenText(item.text).replace(/\n/g, " ")}</Text>)}
      </Box>}
      <Transcript entries={display} active={focus === "history" && !approval && !question && !editing && !tooSmall} width={columns} height={Math.max(2, rows - 12 - taskLines)} />
      <Text wrap="truncate">模式：{session.mode} · 状态：{view.status}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · 可编辑，完成本轮后再发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !question && !editing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 · Ctrl+J 换行 · Ctrl+G 外部编辑 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}
```

</details>

## 运行验证

完成本节构建后，在仓库根目录运行：

```bash
npm run lesson:12.3
```

继续在仓库根目录启动 TUI：

```bash
hello-my-agent --mode plan
```

发送“计划让 chapter-12-task-control/demo-project/src/add.mjs 的 add 支持数字字符串。非法字符串怎样处理还没决定，请用 ask_user 问我，再给出计划”。先观察澄清面板出现时，Agent 是否保持等待。

在上面的教学示例中，“报错”是第 1 项，可以输入 `1` 并按 Enter；实际面板以模型提供的选项顺序为准，也可以直接输入“报错”。提交后观察面板关闭，以及后续回答怎样把这个条件接到校验与测试方案。此时仍是 Plan，回答问题没有授权修改文件。

这次观察能看到面板和答案回传。若模型先从现有测试得到明确规则，可能不需要再问；示例特意把规则留作待定，并要求调用问答工具。取消后不应继续采用刚才那次问题的答案。

## 本节完成后的 Agent

Agent 现在能在需求不明确时提出具体问题，保持这次问答等待，再把答案按原调用 ID 交回模型。回答让原任务获得继续所需的条件，文件修改仍按原规则审批。下一节让用户主动发来的补充和方向调整也能进入运行中的任务。
