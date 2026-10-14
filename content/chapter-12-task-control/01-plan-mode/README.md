# 12.1 计划与执行模式

[第 12 章首页](/content/chapter-12-task-control/README.md) · [上一节：11.5 按终端列宽排版，保留阅读位置](/content/chapter-11-terminal-workbench/05-terminal-layout/README.md) · [下一节：12.2 任务清单](/content/chapter-12-task-control/02-task-list/README.md)

## 问题：先拿到可以判断的方案，再决定是否实施

第十一章解决了怎样舒服地输入和阅读。接下来，我们要用这个工作区处理代码任务：先让 Agent 弄清问题，再决定是否接受它的改法。本节实现两种模式，并解释为什么一句“先别改”还需要本地程序配合。

用一个很小的加法错误开始。函数本应相加，示例中的返回表达式却写成 `left - right`；测试要求 `add(2, 3)` 得到 `5`。如果我们只发“修复加法”，Agent 读到减号后就可能提出编辑。刚接手项目时，我们更想先知道：错误依据是什么，准备改哪里，怎样检查修改是否正确。

**计划是一次调查的交付物：它把发现的问题、建议的改变和验证办法连在一起，供人判断。** “分析代码、修复错误、运行测试”也像一份计划，却没有说明这个项目为什么需要这些动作。对于加法示例，读者应当能从方案推回原因：`2 - 3` 是 `-1`，测试要的是 `5`，所以建议把返回表达式改成相加，再用现有测试核对。计划的价值来自这条联系。



<img src="./content/chapter-12-task-control/01-plan-mode/assets/plan-purpose-cover-c556d1a8ec.png" data-gif-src="./content/chapter-12-task-control/01-plan-mode/assets/plan-purpose-0f5d75ec67.gif" data-cover="./content/chapter-12-task-control/01-plan-mode/assets/plan-purpose-cover-c556d1a8ec.png" alt="Plan先交付加法修复方案；用户切换模式后，另发执行要求才开始新一轮">

图中先读取实现与测试，再把依据交回模型，最后交付方案。方案中的“运行测试”是将来怎样验证的建议；Plan 本身没有执行它。`/mode execute` 选择下一项任务的模式，另发实施要求才开始执行。[静态图](/content/chapter-12-task-control/01-plan-mode/assets/plan-purpose-f660f7c56b.jpg.md)

## 解决方案：把调查任务与实施任务分开

本节为一次任务选择 `plan` 或 `execute`。Plan 允许调查项目、说明发现、提出实施和验证方案；execute 允许提出修改和命令，继续遵守已有的权限与审批。默认仍是 execute，启动选项 `--mode plan` 或空闲时的 `/mode plan` 可以选择 Plan。

这里的任务是从一份用户要求开始，到 Agent 停下为止的一次运行，界面有时称“一轮”。为了调查，任务可以多次请求模型：模型先提出读取，程序交回文件内容，模型再判断是否需要继续读。因此“一次 Plan 任务”并不等于“一次模型回答”。

我们同时做两件事。模型收到的说明和工具列表引导它调查；本地程序在每个工具执行前检查模式，禁止 Plan 的写入与命令。前者帮助模型提出合适动作，后者保证项目不会因为一次越界的调用而提前改变。

方案最终是一条普通回答，留在历史中供用户阅读。本节没有结构化计划对象，也没有后台执行按钮。任务结束后，先输入 `/mode execute`，再发送“按方案修复并运行测试”，才开始实施。模式切换为后续任务选择能力，不会自行产生新的任务。

## 工作原理

### 调查得到的是事实，计划组织的是改变

先把示例里已知与未知的内容分清。用户知道“加法结果不对”，但还没给出原因。读取实现后获得“返回表达式使用减号”；读取测试后获得“`add(2, 3)` 应为 `5`”。程序把两个读取结果按对应调用 ID 加入消息，下一次请求就带着这两份事实。

模型可以据此组织这样的方案：

| 方案要回答的问题 | 加法示例中的回答 |
| --- | --- |
| 为什么要改？ | `left - right` 对输入 `2, 3` 算出 `-1`，不符合测试要求的 `5` |
| 改变什么？ | 把加法函数的返回表达式改为 `left + right` |
| 怎样核对？ | 在练习项目目录运行现有测试，核对断言与退出结果 |

这里的 `-1` 可以由表达式推导，不需要先运行命令。读取测试也只告诉我们它检查什么，不能据此宣称测试已经通过。模型负责从材料中给出方案，程序没有校验回答必须包含这三行；实际回答可能详略不同，我们要审阅的就是它是否把依据、改变和验证联系起来。

如果条件换成“函数已经返回 `left + right`，但另一个输入失败”，这份改减号的计划就失去了依据。仍用相同方法调查，方案应围绕新的失败条件重新形成。这说明 Plan 控制的是调查与交付方案的阶段，不是一套固定修复步骤。

<img src="./content/chapter-12-task-control/01-plan-mode/assets/plan-method-cover-2e4d59dc31.png" data-gif-src="./content/chapter-12-task-control/01-plan-mode/assets/plan-method-6c132b6bc8.gif" data-cover="./content/chapter-12-task-control/01-plan-mode/assets/plan-method-cover-2e4d59dc31.png" alt="源码和测试的读取结果交回模型形成方案；额外编辑请求被本地Plan检查拒绝">

前半段展示正常调查：两份读取结果完整交回，模型再形成方案。后半段回到终答尚未返回的时点，单独比较模型请求编辑的另一种响应：本地先拒绝，配对的拒绝结果回到模型，文件没有因此改变。正常调查不需要先经历一次拒绝。[静态图](/content/chapter-12-task-control/01-plan-mode/assets/plan-method-694da43fd3.jpg.md)

### 三处使用同一个模式，分别解决什么问题

模式在任务开始时取定，随后传给模型请求和本地策略。我们可以从一次 `edit_file` 调用倒过来看为什么要这样安排。

模型先要知道任务目的，所以 Plan 提示词要求调查并给出可执行方案。模型还要知道可选动作，所以当前工具列表只列读取和搜索。这两处都发生在请求模型之前，让它更容易选择符合阶段的动作。

但是，返回内容仍是来自外部的输入。工具列表没列出编辑，并不能成为“编辑绝不会出现”的执行保证。因此程序收到调用后还检查本次任务的模式。若 Plan 中出现 `edit_file`，本地直接返回拒绝；修改预览、用户审批和文件写入都不会开始。拒绝作为该调用的结果交回模型，后续判断仍有完整的来由。

| 位置 | 它决定什么 | 单独使用时还缺什么 |
| --- | --- | --- |
| 提示词 | 本次任务应调查并提出计划 | 不能保证模型始终遵守 |
| 模型可见的工具列表 | 给模型提供哪些动作 | 不能替本地执行器拒绝越界请求 |
| 本地执行前检查 | 这次具体调用能否继续 | 仍需模型理解任务目标，才能交付好方案 |

TypeScript 的 `ExecutionMode` 类型让我们在本地代码里明确只有两个模式值；它不会让外部模型自动遵守模式。真正阻止一次调用的是运行中的检查。提示、选择和执行各有自己的作用，使用同一份模式才能保持一致。

<img src="./content/chapter-12-task-control/01-plan-mode/assets/plan-local-mode-gate-b8c15fb679.png" alt="本轮模式固定后，越界修改在本地模式关口被拒绝，未进入预览、审批与执行">

图从同一份模式连到模型请求与本地检查。下半部只追踪一次越界编辑：修改路径被拦截，拒绝结果仍按原调用 ID 保存，供后续请求说明原因。

### 为什么 Plan 连“运行测试”也不允许

本节的 `run_command` 能提交任意命令。一个命令即使名字叫测试，也可能生成文件、改配置或触发其他操作；我们没有实现证明它只读的办法。因此 Plan 禁用整个命令工具，把实际测试留到 execute。读取和搜索仍通过原有的路径与权限检查，Plan 也不能读取原本禁止访问的文件。

这还说明模式与权限是两个判断。模式问“当前阶段是否允许这类动作”；权限问“这次针对这个资源的动作是否允许”。Plan 中禁止编辑，不能通过批准一次差异来放行；execute 中允许提出编辑，也不能省略对具体差异的审批。

### 为什么切换模式要等当前任务结束

假设读取前告诉模型“只调查”，读取后本地却突然允许写入。模型的上下文和程序的执行条件就不再描述同一项任务。取定模式后保持到任务结束，让这项调查从第一份要求到最终方案都使用相同规则。

TUI 因而只在空闲时接受模式切换。切到 execute 后，历史里的调查和方案仍能供新任务参考；是否实施、实施哪份要求，则由下一次明确提交决定。到这里，我们已经能先得到一份可判断的计划。下一节把执行中的步骤和状态留在固定位置，解决“现在推进到哪里”的问题。

## 本节改动文件

本节围绕同一个模式值，连接模型的任务说明、工具选择、本地权限和各个运行入口。

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/agent/run-options.ts](/content/chapter-12-task-control/01-plan-mode/src/agent/run-options.ts.md) | 声明本地执行模式与本轮选项 |
| CHANGED | [src/models/client.ts](/content/chapter-12-task-control/01-plan-mode/src/models/client.ts.md) | 按本轮模式筛选工具，并告诉模型当前要求 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-12-task-control/01-plan-mode/src/permissions/policy.ts.md) | 在预览和审批前拒绝 Plan 的写入与命令 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-12-task-control/01-plan-mode/src/agent/agent-loop.ts.md) | 固定本轮模式，传给每次模型请求与权限判断 |
| CHANGED | [src/agent/run.ts](/content/chapter-12-task-control/01-plan-mode/src/agent/run.ts.md) | 把本轮选项传给核心循环 |
| CHANGED | [src/agent/run-stream.ts](/content/chapter-12-task-control/01-plan-mode/src/agent/run-stream.ts.md) | 让事件流入口继续传递同一份选项 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-12-task-control/01-plan-mode/src/ui/tui/app.tsx.md) | 空闲时切换模式，新轮开始时保存模式值 |
| CHANGED | [src/ui/tui/input-assist.ts](/content/chapter-12-task-control/01-plan-mode/src/ui/tui/input-assist.ts.md) | 补全 /mode 命令 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-12-task-control/01-plan-mode/src/ui/terminal.ts.md) | 文本会话和单次请求使用模式选项 |
| CHANGED | [src/ui/jsonl.ts](/content/chapter-12-task-control/01-plan-mode/src/ui/jsonl.ts.md) | 机器输出入口传递模式 |
| CHANGED | [src/cli.ts](/content/chapter-12-task-control/01-plan-mode/src/cli.ts.md) | 读取 --mode，交给实际运行入口 |

## 动手构建

从 11.5 的完整 `src/` 继续，目标目录为 `chapter-12-task-control/01-plan-mode/`。先声明模式，再让模型请求与本地权限使用它；最后把 CLI、TUI、文本和 JSONL 入口接到同一份选项。

下面先说明每处修改怎样承担正文中的职责，再给出准确替换范围与完整代码。实现可折叠对照，未列出的函数和文件继续沿用。

### 声明本地执行模式与本轮选项

模式是本地任务的选项，不是从普通聊天中解析出来的开关。先把两个值与传递容器声明清楚，后面的入口与核心才能约定同一份数据；声明本身不执行模式检查。

创建 `src/agent/run-options.ts`。这是本节的新模块，完整实现如下。

<details>
<summary>创建文件：run-options.ts</summary>

<!-- source: src/agent/run-options.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [NEW] agent/run-options.ts
 *
 * 学习目标：把本节的运行控制数据交给核心，界面不需要代替核心作决策。
 * 输入：本地入口选定的模式。
 * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
 * 状态：模式由启动入口取快照；本文件不保存模型消息。
 * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
 *   本地界面 -> 本轮选项 -> 核心 / 工具 / 模型请求
 * 省略模式时采用默认的 execute；类型声明不能代替运行时校验。
 * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
 */
// [NEW 12.1] 本文件以下类型声明均为本节新增。
// [NEW 12.1] 模式由本地运行入口选择，默认继续执行。
/**
 * 本地入口可选的两种运行模式。
 * plan 只调查和制定计划；execute 仍需遵守每次工具的权限与审批。
 */
export type ExecutionMode = "plan" | "execute";

/**
 * 把本轮模式放在独立的运行选项里。
 * 省略模式时沿用 execute；本地入口选择模式，普通聊天不能修改它。
 */
export type RunOptions = {
  // [NEW 12.1] 本轮模式由本地入口取快照。
  mode?: ExecutionMode;
};
```

</details>

### 按本轮模式筛选工具，并告诉模型当前要求

同一份模式在请求前改变两件事：模型本次应交付什么，以及它看到哪些可选动作。两家模型协议都从这里取得这份说明，避免某个协议仍把 Plan 当作普通执行。

在 `src/models/client.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `Model`、`createModel()`、`requestResult()`。

<details>
<summary>client.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/models/client.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] models/client.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责按本轮模式组装请求，收齐并检查模型结果。
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
 * [CHANGED 12.1] 每次请求使用本轮模式；Plan 隐藏写入、编辑和命令工具，提示只调查和计划。
 * 筛选工具帮助模型选择；permissions/policy.ts 的硬拒绝才保证禁止请求不会执行。
 * 运行观察：一批调用中只要有一份参数损坏，整批都不会进入权限与执行阶段。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { ExecutionMode } from "../agent/run-options.js";
```

**替换 Model：**

<!-- source: src/models/client.ts -->
```ts
// [CHANGED 12.1] generate 新增可选模式参数，核心可以固定这一轮的选择。
/**
 * 核心使用的统一模型接口。
 * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
 * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
 */
export interface Model {
  // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  // [CHANGED 12.1] 模式参数只影响本轮请求组装，本地权限策略还会再次检查。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void,
    options?: { mode?: ExecutionMode }): Promise<ModelResult>;
}
```

**替换 createModel：**

<!-- source: src/models/client.ts -->
```ts
/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：只暴露 generate 的 Model；创建对象时不发送请求，调用 generate 时才开始。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
 */
// [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
// [CHANGED 12.1] 返回的 generate 将本轮模式交给请求组装，取消与期限继续沿用。
export function createModel(config: Config): Model {
  const options = {
    apiKey: config.apiKey, baseURL: config.baseURL,
    timeout: 60_000, maxRetries: 0, logLevel: "off" as const,
  };
  const client = config.provider === "openai"
    ? new OpenAI({ ...options, organization: null, project: null })
    : new Anthropic({ ...options, authToken: null });
  // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  // [CHANGED 12.1] 适配层将模式传给请求组装，沿用原取消和期限处理。
  return { async generate(messages, signal, onText, options = {}) {
    const deadline = AbortSignal.timeout(60_000);
    try {
      return await requestResult(client, config.model, messages, AbortSignal.any([signal, deadline]), onText, options.mode ?? "execute");
    } catch (error) {
      signal.throwIfAborted();
      if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
      throw error;
    }
  } };
}
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
// [CHANGED 12.1] 请求组装接入本节模式和工具提示。
async function requestResult(
  client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
  onText?: (text: string) => void,
  // [CHANGED 12.1] 本轮模式沿接口传到两种模型协议。
  mode: ExecutionMode = "execute",
): Promise<ModelResult> {
  // [CHANGED 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
  // [CHANGED 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
  const definitions = mode === "plan"
    ? toolDefinitions.filter((tool) => ["read_file", "glob", "grep"].includes(tool.name))
    : toolDefinitions;
  // [CHANGED 12.1] 本节提示模型只调查和计划；执行仍逐次审批。
  const prompt = systemPrompt + (mode === "plan"
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

### 在预览和审批前拒绝 Plan 的写入与命令

这一步提供真正的执行限制。检查模式必须早于修改预览与批准，否则用户审阅方案之前就可能被要求批准一次本不该发生的修改。原路径保护继续保留。

在 `src/permissions/policy.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `decideToolPermission()`。

<details>
<summary>policy.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/permissions/policy.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] permissions/policy.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责在每个工具执行前判断模式、路径和本次批准。
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
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { ExecutionMode } from "../agent/run-options.js";
```

**替换 decideToolPermission：**

<!-- source: src/permissions/policy.ts -->
```ts
/**
 * 由本地策略判断这次工具能否执行。
 * 先检查登记工具和 JSON 对象，再检查本轮模式；Plan 的写入、编辑和命令直接 deny。
 * 执行模式的命令每次 ask；文件请求先检查硬拒绝，再查询只读会话授权，最后决定 allow 或 ask。
 * 返回 ask 时附本地生成的 scope 和 remember；只有可记住的只读范围才可进入授权集合。
 * 这里只返回决定，准备和执行仍要检查参数与路径，拒绝不会运行工具。
 */
// [CHANGED 12.1] 在现有策略中加入本节工具或模式判断。
export async function decideToolPermission(
  call: ToolCall,
  // [KEEP 来自 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
  sessionGrants: ReadonlySet<string> = new Set(),
  projectRoot = findProjectRoot(),
  // [CHANGED 12.1] 增加本轮模式参数，默认继续沿用执行模式。
  mode: ExecutionMode = "execute",
): Promise<PermissionDecision> {
  if (!toolDefinitions.some((tool) => tool.name === call.name)) {
    return { action: "deny", reason: `工具未登记：${call.name}` };
  }
  const input = parseArguments(call.arguments);
  if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };

  // [CHANGED 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
  if (mode === "plan" && ["write_file", "edit_file", "run_command"].includes(call.name)) {
    return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
  }
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

### 固定本轮模式，传给每次模型请求与权限判断

任务开始时取得模式，此后每次模型请求和每项工具调用都使用它。请对照这两个使用点：只改请求说明会缺本地限制，只改策略会缺模型的任务目标。

在 `src/agent/agent-loop.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `agentLoop()`。

<details>
<summary>agent-loop.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/agent/agent-loop.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：把调查计划与实际执行分开，并看清这些控制能力接在模型与工具循环的哪里。
 * 输入：问题、已有模型历史、取消信号、观察者、审批入口，以及本轮模式和本地控制选项。
 * 输出：完成时返回回答并提交本轮历史；中断时补齐工具状态、保存中断说明后抛错。
 * 状态：进入前已取消就不新增历史；已经发生的工具操作不会随取消撤销。
 *
 * 全局主流程（从这里进入各模块）：
 *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
 *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
 *                                                         +-- 有效 -> 配置、模型、消费者
 *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
 *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
 *   [CHANGED 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
 *   [KEEP 来自 11.5] TUI Enter -> 正在运行？-- 是 -> 保留草稿、等待结束
 *                                             +-- 否 -> 本地命令或新一轮问题
 *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
 *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
 *                                                                   +-- 否 -> 建立本轮消息
 *   [CHANGED 12.1] 固定本轮模式 -> A
 *   A: [KEEP] 请求模型
 *      [CHANGED 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
 *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
 *                                                                        +-- 是 -> B
 *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
 *                  |                         +-- 是 -> 保存 assistant 回答
 *                  |  -> 提交历史、返回回答
 *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
 *                                       +-- 否 -> 保存 assistant 调用 -> C
 *   C: [CHANGED 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
 *                                                             +-- 否 -> 原有 deny / ask / allow
 *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
 *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
 *                                                             +-- 批准 -> 执行 -> D
 *      allow -> 注册表找到工具 -> 执行 -> D
 *   D: 保存工具正文与错误标记 -> 发过程事件 -> 本批还有调用？-- 是 -> C
 *                                                                +-- 否 -> A
 *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
 *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
 *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
 *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
 *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
 *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
 *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
 *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
 *
 * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
 * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
 * 工具结果仍给模型，界面只处理显示副本；模式选择和聊天文字都不能产生批准。
 * 运行观察：Plan 仍能读取项目并给出计划；写入和命令会被策略拒绝。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { RunOptions } from "./run-options.js";
```

**替换 agentLoop：**

<!-- source: src/agent/agent-loop.ts -->
```ts
/**
 * 让模型读到问题和真实工具结果，继续决策直到本轮完成或中断。
 * 进入前先检查取消；本轮模式在入口固定，模型提示与权限策略都使用它。
 * 每个工具先过权限，写入与命令先准备再审批；拒绝和 ToolError 也回给原调用。
 * 成功提交完整本轮消息并返回回答；开始后中断则补齐工具结果、保存说明，再抛出原因。
 * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
 */
// [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
// [CHANGED 12.1] 核心接入本节控制选项；相互分开的新分支在下方另作标记。
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
  // [CHANGED 12.1] 增加本轮控制选项；调用方把模式快照传到核心。
  options: RunOptions = {},
): Promise<Reply> {
  signal.throwIfAborted();
  // [CHANGED 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
  const mode = options.mode ?? "execute";
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let toolSequence = 0;
  let pendingToolResults = 0;

  // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
  let executingCallId: string | undefined;
  try {
    for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
      // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
      signal.throwIfAborted();
      emitAgentEvent(observer, {
        type: "model_start",
        call: modelCall,
        contextMessages: history.length + turn.length,
        trigger: modelCall === 1
          ? { kind: "user", content: input }
          : { kind: "tool_results", count: pendingToolResults },
      });
      pendingToolResults = 0;
      // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
      // [CHANGED 12.1] 模型请求也接收本轮模式；工具隐藏只是辅助。
      const result = await model.generate([...history, ...turn], signal, (text) => {
        if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });

      }, { mode });
      inputTokens = addUsage(inputTokens, result.inputTokens);
      outputTokens = addUsage(outputTokens, result.outputTokens);
      truncated ||= result.truncated;
      emitAgentEvent(observer, {
        type: "model_finish",
        call: modelCall,
        // [KEEP 来自 08.2] 长度上限和拒绝不会伪装成成功回答。
        finishReason: result.finishReason,
        outcome: !["stop", "tool_calls"].includes(result.finishReason) ? "incomplete"
          : result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
        toolRequests: result.toolCalls.length,
        text: result.text,
      });

      // [KEEP 来自 08.2] 正常结束与工具数量必须一致，完整响应才允许进入权限判断。
      if (result.finishReason === "length") throw new UserFacingError("回答达到输出上限，本次响应未完成；其中的工具请求不会执行。");
      if (result.finishReason === "refusal") throw new UserFacingError("模型拒绝了本次请求，本次响应中的工具请求不会执行。");
      if (result.finishReason !== (result.toolCalls.length ? "tool_calls" : "stop")) {
        throw new UserFacingError("模型结束原因与内容不一致，或当前接口返回了不支持的结束原因。");
      }
      if (result.toolCalls.length === 0) {
        if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
        signal.throwIfAborted();
        turn.push({ role: "assistant", content: result.text });
        history.push(...turn);
        return { text: result.text, inputTokens, outputTokens, truncated };
      }

      // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
      if (modelCall === MAX_MODEL_CALLS) break;

      turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        signal.throwIfAborted();
        toolSequence += 1;
        // [CHANGED 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
        const permission = await decideToolPermission(call, sessionGrants, undefined, mode);
        emitAgentEvent(observer, {
          type: "permission_check",
          sequence: toolSequence,
          call,
          decision: permission,
        });
        let rejection: string | null = null;
        let prepared: PreparedToolCall | null = null;
        // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
        signal.throwIfAborted();
        if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
        if (permission.action === "ask") {
          try {
            // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
            prepared = await prepareTool(call, signal);
          } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            turn.push({
              role: "tool",
              toolCallId: call.id,
              content: `工具准备失败：${error.message}`,
              isError: true,
            });
            pendingToolResults += 1;
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "error",
              error: error.message,
            });
            continue;
          }
          if (prepared) {
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "success",
              previewChars: prepared.preview.length,
            });
          }
          emitAgentEvent(observer, {
            type: "approval_start",
            sequence: toolSequence,
            call,
            scope: permission.scope,
            allowSession: permission.remember,
            hasPreview: prepared !== null,
          });
          const response = requestApproval
            ? await requestApproval({
                call,
                reason: permission.reason,
                resource: permission.resource,
                scope: permission.scope,
                allowSession: permission.remember,
                ...(prepared ? { preview: prepared.preview } : {}),
              }, signal)
            : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
          // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
          signal.throwIfAborted();
          emitAgentEvent(observer, {
            type: "approval_finish",
            sequence: toolSequence,
            call,
            response,
          });
          // [KEEP 来自 06.1] 写入和命令批准都不能保存；只有可复用的读取范围进入 Set。
          if (response.decision === "allow_session") {
            if (permission.remember) sessionGrants.add(permission.scope);
            // [KEEP 来自 07.1] 写入与命令都只能批准当前操作。
            else rejection = "当前批准只适用于这一次操作预览";
          }
          if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
        }
        if (rejection) {
          turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
          pendingToolResults += 1;
          continue;
        }
        // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
        signal.throwIfAborted();
        executingCallId = call.id;
        emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
        try {
          // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
          // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
          const result = prepared
            ? await executePreparedTool(prepared, signal)
            : await executeTool(call, signal);
          // [KEEP 来自 07.1] 非零退出码表示本次命令失败，保留输出供模型决定下一步。
          turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: result.isError ?? false });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallId = undefined;
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "success",
            result,
          });
        } catch (error) {
          // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
          if (!(error instanceof ToolError)) throw error;
          turn.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具执行失败：${error.message}`,
            isError: true,
          });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallId = undefined;
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "error",
            error: error.message,
          });
        }
      }
    }

    throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
  } catch (error) {
    // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
    // 每个批次单独配对：后续模型请求即使复用同一个 ID，也不能借用前一批的完成记录。
    const lastBatch = turn.map((message) => message.role === "assistant" && Boolean(message.toolCalls?.length)).lastIndexOf(true);
    const completed = new Set(turn.slice(lastBatch + 1).filter((message) => message.role === "tool").map((message) => message.toolCallId));
    for (const message of lastBatch < 0 ? [] : [turn[lastBatch]]) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        if (completed.has(call.id)) continue;
        turn.push({ role: "tool", toolCallId: call.id, isError: true,
          content: call.id === executingCallId
            ? "操作已开始，但本轮中断前没有取得完整结果。可能已发生部分修改，请先核实当前文件或进程状态，不要直接重试。"
            : "本轮在该工具启动前中断，这个调用未执行。" });
        completed.add(call.id);
      }
    }
    // 这条状态由本地程序生成，明确标注来源，不把它冒充模型完成的回答。
    // [KEEP 来自 09.2] 按取消原因写入本地状态；队列或输出故障是错误，普通取消才记为取消。
    const cancelled = signal.aborted && !(signal.reason instanceof UserFacingError);
    turn.push({ role: "assistant", content: cancelled
      ? "[本地状态] 本轮已取消。已执行的操作不会自动撤销；继续前先核实工具结果。"
      : "[本地状态] 本轮因错误中断。已执行的操作不会自动撤销；继续前先核实工具结果。" });
    history.push(...turn);
    throw error;
  }
}
```

</details>

### 把本轮选项传给核心循环

文本与单次入口仍通过这个运行包装调用核心。把选项原样传进去，模式才不会在外围选好了、进入核心却回到默认执行。

完整替换 `src/agent/run.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：run.ts</summary>

<!-- source: src/agent/run.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] agent/run.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责给整轮任务发出开始、完成、取消或失败通知。
 * 输入：模型、历史、用户问题、取消信号、可选观察者、审批函数和会话只读授权。
 * 输出：run_start 与一次 run_finish 通知；成功返回 Reply，失败继续抛出原因。
 * 状态：核心仍负责成功或中断后的历史提交；外层通知不新增工具副作用，也不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] run_start -> 调用原有 agentLoop -> 成功？-- 是 -> run_finish/completed -> 返回 Reply
 *                                                   +-- 否 -> 选择取消原因或原错误
 *   信号已取消且原因不是 UserFacingError？-- 是 -> run_finish/cancelled -> 抛出原因
 *                                        +-- 否 -> run_finish/error -> 抛出原因
 *
 * 整轮可能包含多次模型请求；model_finish 只说明一次模型返回，run_finish 才说明整轮结束。
 * 事件发送复用 emitAgentEvent，观察者直接抛错不会成为任务失败；同步观察仍会占用当前线程。
 *
 * [CHANGED 12.1] RunOptions 随同一轮传入核心；本层不重新选择模式或处理工具业务。
 * 运行观察：普通任务收到开始、模型与工具过程、结束；取消或失败也有对应的结束状态。
 */
import { agentLoop } from "./agent-loop.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import { explainError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { RunOptions } from "./run-options.js";

// [KEEP 来自 09.1] 本文件以下实现沿用 09.1。
/**
 * 为一次完整任务通知开始和结束，让消费者不用猜最后一次模型响应是否已经结束任务。
 *
 * - 输入：沿用核心所需的模型、历史、问题、取消信号，以及观察者、审批函数和会话只读授权。
 * - 输出：先发 run_start；核心返回后发 completed 结束事件，再原样返回 Reply。
 * - 失败方式：核心抛错时优先采用已取消信号的 reason，发结束事件后继续抛出同一原因。
 * - 状态区分：信号已取消且原因不是 UserFacingError 时记为 cancelled；其余失败记为 error。
 * - 职责边界：本函数不重新实现模型与工具循环；历史提交、审批和资源清理由原有核心及工具负责。
 * - 观察限制：观察者抛错会被事件函数捕获；同步回调仍占用当前线程，并不代表显示可以无限耗时。
 */
// [CHANGED 12.1] 函数接收本轮运行选项，保持已有执行与清理顺序。
export async function runAgent(
  model: Model, history: Message[], input: string, signal: AbortSignal,
  observer?: AgentObserver, requestApproval?: ApprovalHandler,
  sessionGrants: Set<string> = new Set(),
  // [CHANGED 12.1] 新增可选运行选项，沿同一轮向核心传递。
  options: RunOptions = {},
): Promise<Reply> {
  // 先通知开始，即使传入的信号已经取消，外层仍能说明这次任务的结束状态。
  emitAgentEvent(observer, { type: "run_start" });
  try {
    const reply = await agentLoop(model, history, input, signal, observer, requestApproval, sessionGrants, options);
    emitAgentEvent(observer, { type: "run_finish", outcome: "completed", reply });
    return reply;
  } catch (error) {
    // 内部停止也可能使用取消信号；UserFacingError 表示需要报告的失败，不能全算用户取消。
    const reason = signal.aborted ? signal.reason : error;
    const cancelled = signal.aborted && !(reason instanceof UserFacingError);
    emitAgentEvent(observer, { type: "run_finish", outcome: cancelled ? "cancelled" : "error",
      message: cancelled ? "本轮任务已取消。" : explainError(reason) });
    throw reason;
  }
}
```

</details>

### 让事件流入口继续传递同一份选项

事件流改变的是消费结果的方式，模式仍要抵达同一个核心。沿用已有事件通道，传递选项，不在流消费者里重新决定任务能力。

完整替换 `src/agent/run-stream.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：run-stream.ts</summary>

<!-- source: src/agent/run-stream.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] agent/run-stream.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责让界面按自己的速度读取同一轮事件。
 * 输入：模型、历史、问题、外部取消信号、审批函数与会话只读授权。
 * 输出：带 version、runId、sequence、event 的异步记录流；任务失败会在已入队记录之后抛出。
 * 状态：队列与序号属于一轮；历史由核心更新，停止消费不撤销已发生的工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 首次拉取 -> 创建队列、runId 和合并信号 -> 启动 runAgent
 *   收到事件 -> run_finish？-- 是 -> 使用预留位置入队
 *                           +-- 否 -> 已发生送达错误？-- 是 -> 不再入队
 *                                                      +-- 否 -> 已有 128 条？-- 是 -> abort(UserFacingError)
 *                                                                           +-- 否 -> 加序号入队
 *   for await -> yield 下一条；runAgent 结束 -> queue.push(null)
 *   队列读完 -> 等 done -> 任务失败？-- 是 -> 抛出原因
 *                                  +-- 否 -> 结束迭代
 *   正常结束 / 消费者提前退出 -> finally -> 请求取消 -> 等 done 清理 -> 销毁队列
 *
 * MAX_BUFFERED_EVENTS 控制普通事件条数，run_finish 可占额外一个位置；这里没有限制单条事件字节数。
 * Readable 的 highWaterMark 不是这里的硬上限；本文件通过 readableLength 主动检查并停止过慢的任务。
 * 失败原因先保存，避免生产者 Promise 无人接收；消费者读到结束记录后仍会得到失败异常。
 *
 * [CHANGED 12.1] RunOptions 随同一轮传入核心；本层不重新选择模式或处理工具业务。
 * 运行观察：同一轮 runId 相同、sequence 递增；提前 break 要等待本轮清理后才完成退出。
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runAgent } from "./run.js";
import type { AgentEvent } from "./events.js";
import { UserFacingError } from "../errors.js";
import type { Message, Model } from "../models/client.js";
import type { ApprovalHandler } from "../permissions/policy.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { RunOptions } from "./run-options.js";

// [KEEP 来自 09.2] 本文件以下实现沿用 09.2。
// 外壳描述交付记录；event 仍是原有 AgentEvent，不把模型调用编号或工具步骤号改成全局序号。
export type AgentRecord = { version: 1; runId: string; sequence: number; event: AgentEvent };
// ponytail: 128 条普通事件后取消，不暂停上游网络；这是条数上限，不是总字节内存上限。
// 若需持续支持慢消费者，再增加可等待的生产端，或合并允许合并的文字增量。
const MAX_BUFFERED_EVENTS = 128;

/**
 * 把同步产生的事件暂存起来，让界面用 for await 按顺序接收一次任务。
 *
 * - 输入：模型、会话历史、问题和外部取消信号；审批仍由单独的 requestApproval 处理。
 * - 启动时机：异步生成器首次被拉取时才创建本轮 runId、队列和内部取消信号，并启动 runAgent。
 * - 输出：每次 yield 一条 AgentRecord，version 固定为 1，runId 本轮不变，sequence 从 1 递增。
 * - 容量规则：最多暂存 128 条普通事件，另外给 run_finish 留 1 个位置；限制的是条数，不是总字节数。
 * - 失败方式：队列装满后用 UserFacingError 请求停止，后续普通事件不再入队；结束事件说明 error。
 * - 交付顺序：先送完已入队事件，再抛出任务失败原因；序号只统计入队记录，不是工具步骤号。
 * - 提前退出：消费者 break 或抛错会进入 finally，取消本轮并等待 done，确认模型或工具结束清理。
 * - 职责边界：提前退出的消费者未必能读到结束事件；已经发生的工具操作不会因停止消费而撤销。
 */
// [CHANGED 12.1] 入口传递本节选项，沿用原有失败提示和退出规则。
export async function* streamAgentRun(
  model: Model, history: Message[], input: string, signal: AbortSignal,
  requestApproval?: ApprovalHandler, sessionGrants: Set<string> = new Set(),
  // [CHANGED 12.1] 新增可选运行选项，沿同一轮向核心传递。
  options: RunOptions = {},
): AsyncGenerator<AgentRecord> {
  const controller = new AbortController();
  // 用户取消和队列自己的停止请求都要传给同一次核心执行。
  const combined = AbortSignal.any([signal, controller.signal]);
  const queue = new Readable({ objectMode: true, read() {} });
  const runId = randomUUID();
  let sequence = 0;
  let deliveryError: UserFacingError | undefined;
  let failed = false;
  let failure: unknown;
  const done = runAgent(model, history, input, combined, (event) => {
    if (queue.destroyed) return;
    if (event.type !== "run_finish") {
      if (deliveryError) return;
      if (queue.readableLength >= MAX_BUFFERED_EVENTS) {
        // 超限事件不入队，随后也不再积累普通事件；预留位置仍允许送出结束状态。
        deliveryError = new UserFacingError("事件接收速度跟不上执行速度，已停止本轮。已发生的操作不会撤销。");
        controller.abort(deliveryError);
        return;
      }
    }
    // 结束事件绕过普通事件容量检查，最多成为队列里的第 129 条记录。
    queue.push({ version: 1, runId, sequence: ++sequence, event } satisfies AgentRecord);
  }, requestApproval, sessionGrants, options).catch((error: unknown) => {
    // 立刻接住生产者错误，等消费者取完队列后再向它抛出。
    failed = true;
    failure = error;
  }).finally(() => { if (!queue.destroyed) queue.push(null); });
  try {
    for await (const record of queue) yield record as AgentRecord;
    await done;
    if (failed) throw failure;
  } finally {
    // break 也会执行 finally；先等真实任务结束，不能只把队列销毁后留下后台工具。
    controller.abort();
    await done;
    queue.destroy();
  }
}
```

</details>

### 空闲时切换模式，新轮开始时保存模式值

会话记住下一项任务使用的模式，开始任务时取出快照。空闲切换与开始任务分别处理，因而输入 `/mode execute` 只改变选项，不会直接实施旧方案。

在 `src/ui/tui/app.tsx` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `Session`、`TuiApp()`、`startTui()`。

<details>
<summary>app.tsx 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：把调查计划与实际执行分开，让界面操作和本轮执行有清楚的先后关系。
 * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
 * 输出：草稿、历史、模式、运行状态和审批面板。
 * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
 * 失败：保留已收到的结果，等事件流清理后解除忙碌；取消不会撤销工具操作。
 *
 * 本文件局部流程（界面操作；全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
 *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
 *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
 *   [CHANGED 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
 *   普通 Enter -> 忙碌？-- 是 -> 保留草稿、等待结束；否 -> 本地命令或开始任务
 *   [KEEP] Ctrl+O -> 草稿 / 历史，审批期间不切换
 *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
 *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
 *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑 -> 卸载、移除监听
 *
 * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
 * 运行观察：切换模式后状态行立即更新，新一轮使用选定模式。
 */
import { useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [KEEP 来自 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { ExecutionMode } from "../../agent/run-options.js";
```

**替换 Session：**

<!-- source: src/ui/tui/app.tsx -->
```ts
// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
// [CHANGED 12.1] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 当前 TUI 会话的控制与长期状态。
 * 模式供新一轮取快照；历史和只读授权在各轮之间复用。
 * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
 */
type Session = {
  // [CHANGED 12.1] 会话模式供下一轮启动取快照。
  mode: ExecutionMode;
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
  external?: { controller: AbortController; done: Promise<void> };
};
```

**替换 TuiApp：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 把草稿、会话控制和执行事件连成可操作的终端工作区。
 * 普通任务只由提交 handler 启动；组件重绘不创建模型请求。
 * 焦点决定普通按键由哪一区处理，审批占用时暂停工作区输入。
 * 忙碌时继续编辑草稿，完成清理后才允许提交。
 * 局部 current 顺序累积事件；finally 等事件流清理后才解除占用。
 * 显示条目与模型历史分别保存；本组件不直接执行工具、提交历史或撤销副作用。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
// [CHANGED 12.1] 界面接入本节操作；具体状态和按键变化在对应分支标明。
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
   * 任务、审批或退出正在占用时只提示等待。
   * 编辑成功形成一次草稿修改；失败保留原文，结束后解除外部占用。
   */
  const openEditor = () => {
    if (session.done || session.external || session.closing || approval) { setNotice("请在当前任务结束后编辑草稿。"); return; }
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
    if (!tooSmall && key.ctrl && input === "o" && !approval) setFocus((old) => old === "draft" ? "history" : "draft");
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
    // [CHANGED 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
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

    // [CHANGED 12.1] 一轮取启动模式快照，后续重绘不改变它。
    const options = { mode: session.mode };
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
          setBusy(false);
        }
      }
    })();
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消任务 · Ctrl+D 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    <Box display={approval ? "none" : "flex"} flexDirection="column">
      <Transcript entries={display} active={focus === "history" && !approval && !editing && !tooSmall} width={columns} height={Math.max(2, rows - 12)} />
      <Text wrap="truncate">模式：{session.mode} · 状态：{view.status}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · 可编辑，完成本轮后再发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !editing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 · Ctrl+J 换行 · Ctrl+G 外部编辑 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}
```

**替换 startTui：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 创建整次 TUI 会话，并在退出前等占用全部清理。
 * 输入是模型和启动模式；会话对象只创建一次，重绘或单轮取消不重建历史和授权。
 * Ctrl+C 忙碌时取消本轮，空闲时退出；外部编辑占用期间交给编辑器。
 * 退出先设置 closing 阻止新提交，再取消并等待任务和外部编辑，最后卸载并移除监听。
 */
// [CHANGED 12.1] 会话初始化新增本节状态，退出仍等待任务清理。
export async function startTui(model: Model, initialMode: ExecutionMode = "execute"): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  const session: Session = { mode: initialMode, history: [], prompts: [], run: 0, nextId: 0, grants: new Set(), closing: false };
  let instance: ReturnType<typeof render> | undefined;
  /**
   * 开始退出，封住新提交后等待当前任务与外部编辑结束。
   * 取消对应控制器，清理完成才设置退出码并卸载界面；重复退出直接返回。
   */
  const quit = (code: number) => {
    if (session.closing) return;
    // 先封住新的提交和状态更新，再等待当前任务；否则退出期间仍可能继续绘制。
    session.closing = true;
    session.controller?.abort();
    session.external?.controller.abort();
    void Promise.all([session.done, session.external?.done]).then(() => { process.exitCode = code; instance?.unmount(); });
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  /**
   * 让 Ctrl+C 根据当前占用选择取消本轮或退出。
   * 外部编辑占用时留给编辑器；有任务控制器时只取消它，空闲时以 130 退出。
   */
  const interrupt = () => { if (session.external) return; if (session.controller) session.controller.abort(); else quit(130); };
  /**
   * 将 SIGTERM 交给同一退出清理入口，保留退出码 143。
   */
  const terminate = () => quit(143);
  /**
   * 将 SIGHUP 交给同一退出清理入口，保留退出码 129。
   */
  const hangup = () => quit(129);
  /**
   * 输入结束时正常退出，仍等待现有占用清理。
   */
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // [KEEP 来自 10.4] 界面按键和进程 SIGINT 使用同一个 interrupt 选择取消或退出。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false, alternateScreen: true });
    await instance.waitUntilExit();
  } finally {
    session.closing = true;
    session.controller?.abort();
    session.external?.controller.abort();
    await Promise.all([session.done, session.external?.done]);
    instance?.unmount();
    // 无论正常退出还是挂载失败，只移除本次添加的监听，避免下次进入界面收到重复通知。
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    process.stdin.off("end", endInput);
  }
}
```

</details>

### 补全 /mode 命令

补全帮助用户发现和输入本地命令。它只整理草稿，不执行切换；真正的切换仍由提交处理，并受空闲条件限制。

完整替换 `src/ui/tui/input-assist.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：input-assist.ts</summary>

<!-- source: src/ui/tui/input-assist.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] ui/tui/input-assist.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责找回已发送问题，补全本地命令和项目路径。
 * 输入：本次会话的问题列表，或当前草稿、光标和取消信号。
 * 输出：搜索候选，或补全后的文字、光标和提示；失败向调用方抛错，不提交问题。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   历史查询 -> 倒序、去重、按子串筛选 -> 返回候选
 *   Tab -> 光标前是单行 / 命令？-- 是 -> 匹配本地命令表
 *                                +-- 否 -> 有 @路径？-- 否 -> 原草稿与用法提示
 *                                                     +-- 是 -> 搜索项目内路径
 *   候选超出 20 项？-- 是 -> 保留原草稿，提示继续缩小范围
 *                    +-- 否 -> 唯一候选或共同前缀 -> 接回光标右侧文字
 *
 * 补全只查文件名称；项目根和忽略规则复用已有 glob 工具，不读取文件正文。
 * 运行观察：Tab 补入 @ 后的路径，仍需按 Enter 发送；候选过多时先继续输入。
 */
import { findMatchingFiles, validateGlobPattern } from "../../tools/glob.js";
import { findProjectRoot } from "../../tools/workspace.js";

// [KEEP 来自 11.2] 输入历史和补全只修改草稿，不启动 Agent 或读取文件正文。
/**
 * 按关键词找出之前发送过的问题，优先显示最近一次。
 *
 * - 输入：当前进程保存的问题数组和查询字符串。
 * - 输出：倒序、去重后匹配查询的文字数组；空查询可浏览全部唯一记录。
 * - 关键原因：先倒序再去重，重复问题留下最近的位置；比较忽略大小写。
 * - 职责边界：不读取模型回答、不修改原数组，也不从磁盘恢复历史。
 */
export function searchPrompts(prompts: string[], query: string): string[] {
  return [...new Set([...prompts].reverse())].filter((text) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}
/**
 * 找出所有候选共有的开头，避免替用户随意选择一项。
 *
 * - 输入：已经筛选过的候选字符串数组。
 * - 输出：所有值共同的前缀；空数组或没有共同开头时返回空字符串。
 * - 关键步骤：从第一项开始缩短前缀，直到每一项都以它开头；每次按完整 Unicode 码点缩短。
 * - 职责边界：不重新排序或查询候选；这里不按终端列宽截取文字。
 */
export function commonPrefix(values: string[]): string {
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) while (!value.startsWith(prefix)) prefix = Array.from(prefix).slice(0, -1).join("");
  return prefix;
}
/**
 * 只补全光标前的命令或 @路径，并保留后面的草稿。
 *
 * - 输入：草稿、UTF-16 光标下标及可选取消信号；光标由编辑器维护。
 * - 输出：新文字、新光标和提示；无候选、无补全位置或候选过多时保留原草稿。
 * - 关键步骤：本地命令查固定表；路径识别不要求 @ 前有空格；转义 glob 特殊符号后复用项目根和忽略规则，先筛选完整路径前缀，再检查 20 项上限。
 * - 候选处理：唯一候选补全整项，多个候选只延长共同前缀；唯一且含空白的路径用 JSON 引号保留边界。
 * - 失败方式：路径检查、搜索或取消错误交给编辑器显示；返回前检查取消，但是否仍是原草稿由组件另行确认。
 * - 职责边界：读取的是路径名，不是文件正文；函数返回文字，不执行工具或提交模型请求。
 */
// [CHANGED 12.1] 本地补全增加模式命令候选。
export async function completeInput(text: string, cursor: number, signal?: AbortSignal): Promise<{ text: string; cursor: number; hint: string }> {
  const left = text.slice(0, cursor), right = text.slice(cursor);
  let candidates: string[], start: number, prefix: string;
  if (left.startsWith("/") && !left.includes("\n")) {
    prefix = left; start = 0;
    candidates = ["/exit", "/reset", "/permissions", "/permissions reset", "/mode plan", "/mode execute"].filter((command) => command.startsWith(prefix));
  } else {
    const match = /@([^\s]*)$/.exec(left);
    if (!match) return { text, cursor, hint: "输入 / 补全本地命令，或 @ 后面的项目路径，再按 Tab。" };
    prefix = match[1]; start = left.length - prefix.length;
    const pattern = validateGlobPattern(prefix.replace(/[?*\[\]{}\\]/g, "\\$&") + "*");
    // [KEEP 来自 11.2] 名称匹配可能包含各目录同名文件，先筛选真正的路径候选，再限制数量。
    const result = await findMatchingFiles(pattern, findProjectRoot(), Infinity, signal);
    candidates = result.paths.filter((path) => path.startsWith(prefix));
    if (candidates.length > 20) return { text, cursor, hint: "候选超过 20 项，请继续输入更完整的路径。" };
  }
  signal?.throwIfAborted();
  if (!candidates.length) return { text, cursor, hint: "没有匹配的候选。" };
  let replacement = candidates.length === 1 ? candidates[0] : commonPrefix(candidates);
  if (candidates.length === 1 && /\s/.test(replacement) && !left.startsWith("/")) replacement = JSON.stringify(replacement);
  const next = left.slice(0, start) + replacement;
  return { text: next + right, cursor: next.length, hint: candidates.length === 1 ? "已补入草稿，尚未发送。" : `候选：${candidates.join(" · ")}` };
}
```

</details>

### 文本会话和单次请求使用模式选项

文本会话与单次任务也要区分本地选项和普通要求。让它们把选定模式交给运行入口，才能与 TUI 使用相同的 Plan 规则。

在 `src/ui/terminal.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `startTerminal()`、`runSinglePrompt()`。

<details>
<summary>terminal.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/terminal.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] ui/terminal.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责串行读取文本问题与审批，并显示同一轮事件。
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
 * [CHANGED 12.1] /mode 是空闲本地命令；提交普通问题时把模式快照传入本轮。
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
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { RunOptions } from "../agent/run-options.js";
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
// [CHANGED 12.1] 文本会话接入本节控制入口，保持串行输入。
export async function startTerminal(model: Model, options: RunOptions = {}): Promise<void> {
  const history: Message[] = [];
  let mode = options.mode ?? "execute";
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal });
  const lines = createLineReader(input);
  const requestApproval = createApprovalHandler(lines, terminal);
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
      // [CHANGED 12.1] 空闲本地切换模式，不把命令发送给模型。
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
          // [CHANGED 12.1] 普通问题携带当前模式快照。
          requestApproval, sessionGrants, { ...options, mode }), renderer);
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
// [CHANGED 12.1] 单次问题传入本节选项并等待同一轮事件。
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
      createApprovalHandler(lines, interactive), new Set<string>(), options), renderer);
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

### 机器输出入口传递模式

JSONL 负责输出结构化事件，不另建执行循环。传递模式以后，机器使用的入口也不能绕过本地 Plan 限制。

完整替换 `src/ui/jsonl.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：jsonl.ts</summary>

<!-- source: src/ui/jsonl.ts -->
```ts
/**
 * 12.1 计划与执行模式 | [CHANGED] ui/jsonl.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责把单轮事件逐条写成 JSONL，等待输出和任务清理。
 * 输入：已创建的模型和 --prompt；SIGINT 与 stdout 错误也会通知本轮停止。
 * 输出：stdout 每行一条 AgentRecord；取消说明与 CLI 错误使用 stderr。
 * 状态：本次使用空历史；ask 默认拒绝。失败或取消等待核心清理，但不回滚已发生的操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 注册 SIGINT / stdout error -> streamAgentRun（ask 返回 deny）
 *   下一条记录 -> stdout 已出错？-- 是 -> 抛错并结束消费
 *                               +-- 否 -> JSON.stringify + 换行 -> write
 *   write -> 回调成功 -> 读取下一条；流读完 -> 清理监听 -> 返回
 *         +-> 回调失败 / stdout error -> 停止消费 -> 等生成器清理 -> 向 CLI 抛错
 *   SIGINT -> 尚未取消？-- 否 -> 保留原停止原因
 *                       +-- 是 -> abort -> 拒绝当前写入等待 -> 停止消费
 *   用户取消后 -> 等模型与工具清理 -> stderr 说明、exitCode=130 -> 清理监听
 *            -> 写入回调仍未结束？-- 是 -> process.exit(130)
 *                                 +-- 否 -> 正常返回
 *
 * JSONL 指每一行都是独立 JSON；字符串中的换行会编码成转义，不会拆成多条记录。
 * 写入回调完成后才消费下一条，避免在本消费者里无限积累待写行；慢输出仍可能让事件队列超限。
 * 下游保持管道打开却不读取时，write 回调可能一直不结束。取消会解除 Promise 等待，
 * 但系统写请求仍可能让 Node 进程无法退出，所以先等 Agent 清理，再在这个窄分支主动退出。
 * 主动退出可能留下半行或缺少 run_finish；脚本读取 JSONL 时必须同时检查进程退出状态。
 * JSON 编码不是脱敏，记录可能包含完整问题、工具参数、模型与工具正文，不应直接当作公开日志。
 *
 * [CHANGED 12.1] RunOptions 随同一轮传入核心；本层不重新选择模式或处理工具业务。
 * 运行观察：--output jsonl --prompt 的 stdout 可逐行 JSON.parse，审批输入不会阻塞脚本。
 */
import { streamAgentRun } from "../agent/run-stream.js";
import { UserFacingError } from "../errors.js";
import type { Model } from "../models/client.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { RunOptions } from "../agent/run-options.js";

// [KEEP 来自 09.3] 本文件以下实现沿用 09.3。
/**
 * 运行一次提问，把每条执行记录写成独立的一行 JSON，供另一个程序读取。
 *
 * - 输入：已创建的模型和已校验的 prompt；本次使用空历史，不进入连续聊天。
 * - 输出：stdout 每行一个完整 AgentRecord，不加终端标签、颜色或教学摘要。
 * - 写入顺序：等待当前 write 回调结束再取下一条；回调完成只表示交给输出流，不代表下游已经处理。
 * - 审批规则：遇到 ask 直接返回 deny；不创建输入读取器，也不从管道文字推断用户批准。
 * - 取消处理：首次 SIGINT 取消同一轮，也拒绝正在等待的写入 Promise；结束消费时先等生成器清理模型与工具。
 * - 失败方式：stdout 出错会请求取消，退出消费时等待核心清理，再将可显示的错误交给 CLI。
 * - 退出方式：用户取消后设退出码 130 并清理监听；写入回调仍未完成时才主动 process.exit(130)。
 * - 取舍原因：拒绝 Promise 没有取消系统写请求，单设 exitCode 仍可能等管道；主动退出则可能丢掉半行或结束记录。
 * - 数据边界：JSON.stringify 只编码数据；原始问题、工具参数和正文仍可能包含敏感信息。
 * - 职责边界：消费端要结合退出状态判断结果是否完整；已经发生的工具副作用不会撤销。
 */
// [CHANGED 12.1] 函数接收本轮运行选项，保持已有执行与清理顺序。
export async function runJsonlPrompt(model: Model, prompt: string, options: RunOptions = {}): Promise<void> {
  const controller = new AbortController();
  let outputError: Error | undefined;
  let interrupted = false;
  // 只在 write 回调结束时清空；取消 Promise 等待，并不代表系统写入已经结束。
  let writing = false;
  // 只接受首次停止原因；如果输出故障已经触发取消，随后按 Ctrl+C 不把它改记为用户取消。
  const stop = () => {
    if (controller.signal.aborted) return;
    interrupted = true;
    controller.abort();
  };
  // 以可显示错误取消，让核心历史与 run_finish 都记录 error，而不是用户取消。
  const onOutputError = (error: Error) => { outputError = error; controller.abort(new UserFacingError("标准输出已关闭或写入失败。")); };
  process.on("SIGINT", stop);
  process.stdout.on("error", onOutputError);
  try {
    const records = streamAgentRun(model, [], prompt, controller.signal,
      async () => ({ decision: "deny", reason: "JSONL 模式不交互审批，本次操作未获批准" }), new Set<string>(), { ...options, mode: options.mode ?? "execute" });
    for await (const record of records) {
      if (outputError) throw outputError;
      // 等 write 回调后才继续拉取；这确认本行已交给输出流，并不确认下游已经处理。
      await new Promise<void>((resolve, reject) => {
        // 管道保持打开却没人读取时，write 回调可能不返回；abort 让消费者能先结束等待。
        const stopWriting = () => {
          reject(controller.signal.reason);
        };
        controller.signal.addEventListener("abort", stopWriting, { once: true });
        writing = true;
        process.stdout.write(`${JSON.stringify(record)}\n`, (error) => {
          // 只有真实回调才说明这次写入结束；正常完成时也要移除单次取消监听。
          writing = false;
          controller.signal.removeEventListener("abort", stopWriting);
          if (error) reject(error); else resolve();
        });
        // 信号可能在监听建立前已经取消，补查一次，避免留下无法解除的写入等待。
        if (controller.signal.aborted) stopWriting();
      });
    }
  } catch (error) {
    // 首次原因为用户取消时保持 130，不让随后出现的输出错误覆盖它。
    if (interrupted) {
      process.exitCode = 130;
      console.error("本次任务已取消。");
    } else {
      if (outputError) throw new UserFacingError("标准输出已关闭或写入失败，任务已停止。已执行的操作不会自动撤销。");
      throw error;
    }
  } finally {
    // for await 退出已等待生成器清理真实任务，再移除这个消费者的进程与输出监听。
    controller.abort();
    process.off("SIGINT", stop);
    process.stdout.off("error", onOutputError);
  }
  // Agent 已清理完，但未完成的系统写请求仍可能阻止 Node 退出，单设 exitCode 无法解除它。
  // 仅在用户取消且写入仍未完成时主动退出；这会放弃剩余输出，可能留下半行或缺少结束记录。
  if (interrupted && writing) process.exit(130);
}
```

</details>

### 读取 --mode，交给实际运行入口

启动参数来自外部文字，需要在 CLI 中检查，再交给实际入口。默认 execute 保留以前的使用方式，明确传入 plan 才改变本次启动模式。

在 `src/cli.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `CliOptions()`、`program-expression()`。

<details>
<summary>cli.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/cli.ts -->
```ts
#!/usr/bin/env node
/**
 * 12.1 计划与执行模式 | [CHANGED] cli.ts
 *
 * 学习目标：把调查计划与实际执行分开；本文件负责检查启动选项，把模式和输入交给选定的界面。
 * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
 * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
 * 状态：入口不保存历史或授权；参数不符合运行方式时不启动任务，运行失败不回滚工具操作。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   --help / --version -> 显示文字 -> 结束；--doctor -> 显示环境 -> 结束
 *   [KEEP] 输出格式受支持？-- 否 -> 抛出 UserFacingError
 *                            +-- 是 -> 继续检查运行方式
 *   [KEEP] auto？-- 是 -> 无 --prompt 且 stdin/stdout 为 TTY、TERM 非 dumb？
 *                     是 -> tui；否 -> text
 *                +-- 否 -> 保留显式选择
 *   tui？-- 是 -> stdin/stdout 为 TTY、TERM 非 dumb，且没有 --prompt？
 *                否 -> 抛错；是 -> 读取配置、创建模型 -> 动态载入 app -> startTui
 *        +-- 否 -> jsonl 但缺少 --prompt？-- 是 -> 抛错
 *                                          +-- 否 -> 读取配置、创建模型
 *   非 TUI 分支 -> 无 --prompt？-- 是 -> startTerminal
 *                              +-- 否 -> 内容为空？-- 是 -> 抛错
 *                                                  +-- 否 -> jsonl / text 单次消费者
 *   运行抛错 -> explainError -> stderr、exit 1；单次用户取消由消费者设 exit 130
 *
 * auto 在没有 --prompt、stdin/stdout 都是 TTY 且 TERM 不是 dumb 时选择 tui，其余选择 text。
 * TUI 只接受连续输入，单次任务继续用 text 或 jsonl；JSONL 必须同时给 --prompt。
 * 动态 import 只在 tui 分支载入 React / Ink，脚本模式不需要初始化终端界面。
 * --help、--version 和 --doctor 不读取模型配置；界面选择不改变模型、工具或权限协议。
 *
 * [CHANGED 12.1] --mode plan|execute 在创建模型前校验，再传给每种消费者。
 * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
// [CHANGED 12.1] 引入 run-options 的本节类型或实现。
import type { ExecutionMode, RunOptions } from "./agent/run-options.js";
// [KEEP 来自 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";
```

**替换 CliOptions：**

<!-- source: src/cli.ts -->
```ts
// [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
// [CHANGED 12.1] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string; mode?: string };
```

**替换 program-expression：**

<!-- source: src/cli.ts -->
```ts
// [CHANGED 12.1] 启动命令接入模式选项与校验，分别传到选定的界面。
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
  .option("--doctor", "显示当前运行环境")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 10.4] 默认值改为 auto；显式 text、tui、jsonl 仍由用户选择。
  .option("--output <format>", "输出格式：auto、tui、text 或 jsonl", "auto")
  // [CHANGED 12.1] 增加启动模式选项，默认 execute。
  .option("--mode <mode>", "模式：plan（只读计划）或 execute（执行）", "execute")
  // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    if (options.doctor) {
      printDoctor();
      return;
    }
    // [CHANGED 12.1] 创建模型前检查模式，非法值不会启动任务。
    if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
    const mode: ExecutionMode = options.mode === "plan" ? "plan" : "execute";
    // [CHANGED 12.1] 把启动模式传到 text、JSONL 和连续会话入口。
    const runOptions: RunOptions = { mode };
    // [KEEP 来自 10.4] 校验允许 auto，下一步再把它解析成具体消费者。
    if (!["auto", "tui", "text", "jsonl"].includes(options.output ?? "auto")) throw new UserFacingError("--output 只能是 auto、tui、text 或 jsonl。");
    // [KEEP 来自 10.4] 只在真实终端的连续会话中自动选择 TUI；--prompt 和管道默认仍用文本。
    if (options.output === "auto") options.output = options.prompt === undefined
      && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb" ? "tui" : "text";
    // [KEEP 来自 10.1] 只有真实终端才能把按键交给 Ink；单次问题继续使用已有输出模式。
    if (options.output === "tui" && (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === "dumb")) {
      throw new UserFacingError("TUI 需要交互终端，请使用 --output text 或 --output jsonl --prompt 提问。");
    }
    if (options.output === "tui" && options.prompt !== undefined) throw new UserFacingError("TUI 使用连续输入；单次提问请使用 --output text 或 jsonl。");
    if (options.output === "jsonl" && options.prompt === undefined) throw new UserFacingError("JSONL 模式需要 --prompt 提供一次任务。");
    const config = readConfig(options);
    const model = createModel(config);
    if (options.prompt === undefined) {
      // [KEEP 来自 10.1] 选择 TUI 时才载入 React / Ink，不让脚本模式初始化界面。
      if (options.output === "tui") {
        const { startTui } = await import("./ui/tui/app.js");
        // [CHANGED 12.1] 把启动模式交给 TUI 会话。
        await startTui(model, mode);
        return;
      }
      await startTerminal(model, runOptions);
      return;
    }
    if (!options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [KEEP 来自 09.3] 两种显示方式共用核心。
    if (options.output === "jsonl") await runJsonlPrompt(model, options.prompt, runOptions);
    else await runSinglePrompt(model, options.prompt, runOptions);
  });
```

</details>

## 运行验证

### 先核对当前示例，再开始调查

完成构建后，在 `chapter-12-task-control/01-plan-mode/` 目录注册本节：

```bash
npm run lesson:12.1
```

沿用仓库根目录 `.env`。先打开练习项目的 [add.mjs](/content/chapter-12-task-control/demo-project/src/add.mjs.md)，核对它目前使用加号还是减号，再在当前终端目录运行测试：

```bash
node --test ../demo-project/test/add.test.mjs
```

若文件已是 `left + right`，现有数字加法测试应通过；若仍是教学情境中的 `left - right`，`add(2, 3)` 为 `-1`，与期望 `5` 不同，测试应失败。根据实际文件解释实际结果，不必为重复练习重新制造错误。这条命令由我们在 Agent 外运行，用于核对起点，不受 Plan 限制。

### 观察 Plan 交付的是哪一种结果

在本节目录启动：

```bash
hello-my-agent --mode plan
```

发送：

```text
请读取 chapter-12-task-control/demo-project/src/add.mjs 和 chapter-12-task-control/demo-project/test/add.test.mjs，说明当前实现是否符合数字加法测试。有错误就给出修复与验证计划；已正确就说明依据和验证办法，先不要实施。
```

Agent 的项目根仍是教程仓库，所以要求里的文件路径使用完整前缀。核对回答是否把实现、输入与测试期望联系起来，而不只是列出“分析、修复、测试”。如果文件已修好，合理的方案应承认现状，不再建议改一遍减号。Plan 读取测试内容得到的是验证要求，不会通过 `run_command` 实际跑测试。

这一阶段应没有文件编辑或命令审批。若真实模型遵守了提示，我们只能看到正常调查，不能据此单独证明越界调用必被本地拒绝；固定输入检查才可以刻意返回这样的调用。

### 切模式与实施分别观察

本次任务结束后提交 `/mode execute`。界面应报告模式改变，没有因为切换就启动实施。再发送：

```text
核对 chapter-12-task-control/demo-project/src/add.mjs 的数字加法；如果仍有方案中的错误就按方案修复，然后运行 node --test test/add.test.mjs，cwd 为 chapter-12-task-control/demo-project。
```

现在模型可以提出编辑和命令，具体调用仍需原有审批。核对差异、实际文件与测试退出结果；已正确时无需再改文件，也能直接验证。实际模型的措辞与工具顺序可能不同，观察的是这些职责有没有成立。注册只准备本地程序，发送任务以后才会调用模型。

## 本节完成后的 Agent

我们现在可以在项目改变之前取得一份调查方案，并判断它的依据、范围与验证是否合适。模型说明和工具列表引导调查，本地模式检查阻止当前登记的写入与命令工具提前执行；结束后，用户明确选择实施。下一节解决实施过程中的另一个问题：计划里的步骤推进到哪里，怎样始终看得见。
