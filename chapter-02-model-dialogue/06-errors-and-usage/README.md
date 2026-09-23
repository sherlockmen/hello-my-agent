# 02.6 说明错误与显示用量

[第二章导航](../README.md) · [上一节](../05-anthropic/README.md) · [本章练习](../EXERCISES.md)

**本节目标：把失败转换成可执行的排查提示，并在成功回答后显示服务商报告的用量与截断状态。**

## 问题：请求失败了，接下来应该检查什么

上一节已经能用两种协议持续对话，但网络断开、密钥不对、请求太频繁，最后都可能显示相同的“模型请求失败”。这些问题的处理方式不同，同一句提示却没有告诉用户从哪里查起。

成功时也还有信息没有显示：这次用了多少 token，模型是不是因为输出达到上限才停下。如果回答停在半句话，单看文本无法判断发生了什么。

这一节让运行结果更容易理解。失败时说明可以检查什么；成功时保留回答，同时显示服务商报告的用量和停止信息。

## 解决方案：失败解释原因，成功显示回答和用量

我们保留现有的请求和历史规则。模型模块把成功响应整理成统一的 `Reply`，加入用量和截断标记；请求失败时仍然抛出异常，由入口或终端调用同一个 `explainError()`，转成可以显示的提示。

```text
程序启动 -> 读取并检查配置
       |
       |-- 配置失败 -> CLI 调用 explainError() -> 显示安全提示并结束
       |
       `-- 配置成功 -> 创建模型 -> 等待用户输入
                                      |
                                      v
                            Agent Loop 组织本轮消息
                                      |
                                      v
                              模型模块发送请求
                               |              |
                         成功响应          网络或 HTTP 失败
                               |              |
                               v              v
                      转成统一 Reply      抛出异常
                               |              |
                               v              v
                    Agent Loop 提交问答   本轮历史不提交
                               |              |
                               v              v
                    终端显示回答、用量    终端分类并显示
                    和可能的截断提示      固定安全提示
```

网络或 HTTP 错误不会产生本轮 `Reply`，所以核心也不会保存本轮问答。成功响应即使用量缺失，仍然可以保留文本，只把用量显示为“未知”。

## 工作原理

### 从请求走到哪一步，判断应该检查哪里

一次请求失败，可能发生在不同位置。先按这个过程理解错误，比先记状态码更容易：

| 发生的位置 | 例子 | 用户可以先检查什么 |
| --- | --- | --- |
| 还没发送请求 | 缺少 Key、基础地址格式不对 | 本地 `.env`、环境变量或命令选项 |
| 发送后没有正常取得响应 | 网络连接失败、超时 | 网络和接口地址 |
| 远端已经返回 HTTP 错误 | 认证失败、权限不足、请求受限 | 对应账号、模型、额度或服务状态 |

配置错误由程序自己发现，可以直接写出明确的提示。网络和 HTTP 错误则来自 SDK，需要根据其错误类型与状态码解释：

| 情况 | 提示用户检查什么 |
| --- | --- |
| 超时 / 网络连接失败 | 网络和接口地址 |
| 401 | 密钥是否与接口匹配 |
| 403 | 账号和模型权限 |
| 404 | 基础地址与模型 ID |
| 429 | 额度，或稍后重试 |
| 服务端错误 | 稍后重试 |

例如收到 401，程序提示检查 API Key 与接口是否匹配；收到 429，则提示检查额度或稍后重试。提示不是代替服务商诊断所有原因，而是让用户知道下一步从哪一类问题查起。

### 为什么不直接打印 SDK 的错误文字

外部错误可能带有响应正文、请求地址或其他调试信息。直接输出 `error.message` 虽然省事，却会把这些内容一并带到终端和日志。我们只需要告诉用户如何处理，并不需要显示整份请求。

因此，`explainError()` 区分两种来源：程序自己创建的 `UserFacingError` 使用已经写好的提示；SDK 错误只取类型和状态码，选择固定文案。不认识的异常也使用通用提示，不把原始对象展开。

这里的 `UserFacingError` 只是一个错误类型名，表示“这段文字是程序准备给用户看的”。它本身没有自动脱敏功能，创建它时就不能放入密钥或原始响应。

入口处理启动阶段的失败，终端处理连续会话中的单轮失败，两处都调用同一个解释函数。SDK 抛错后，模型模块不返回 `Reply`，核心也走不到保存历史的位置；异常一直传到入口或终端的 `catch`，才变成屏幕上的提示。

第 34 章会在这些分类上加入日志、重试退避和恢复。本节先把原因说清楚，不自动重复请求。

### 用量为什么不能拿文本长度代替

token 是模型把文本切分后使用的计量单位，不固定等于一个字符或一个单词。并且，请求中还有系统说明与历史，不能只看这次问题或回答有多长，就得出实际用量。

我们直接使用服务商响应中的统计。OpenAI 使用 `prompt_tokens` 和 `completion_tokens`，Anthropic 使用 `input_tokens` 和 `output_tokens`；模型模块分别读取，再统一为 `inputTokens` 与 `outputTokens`。

有些兼容接口不返回这些字段，所以本地类型使用 `number | null`。程序只接受有限的非负数字，其余值写成 `null`，表示没有可显示的统计。这个检查只能确认数字格式，不能验证服务商是怎样计算的。

`null` 与 `0` 不能混用：前者是没有数据，后者是接口明确报告零。终端用 `?? "未知"` 处理缺失值，合法的零仍然显示为零。

Anthropic 本节只展示原始输入与输出字段，没有把缓存字段相加。第 15 章会把用量用于上下文预算和费用估算，第 23 章再统一缓存统计；这里先不把显示的数字当成完整账单。

### 达到输出上限，为什么仍然保留回答

服务可能已经返回了文本，只是因为达到输出上限停止。OpenAI 用 `finish_reason: length` 表示这种情况，Anthropic 使用 `stop_reason: max_tokens`。

这和网络失败不同：请求已经有了可用文本，只是回答可能没说完。模型模块把这个信息转换成 `truncated: true`，核心仍然保存问答，终端先显示文本和用量，再追加“回答可能尚未完整”的提示。如果把它当成异常，反而会丢掉已经生成的内容。

停止原因也不能证明回答一定正确、一定完成了用户任务；这里仅提示服务报告的输出上限。

### 两种运行方式怎样显示同一份结果

单次 `--prompt` 和连续会话已经共用 `printReply()`，所以只需在这个函数中增加用量与截断显示：

```ts
console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
```

Agent Loop 仍然只接收 `Reply`，按原规则保存问题和回答，然后把结果返回调用方。服务商字段由模型模块转换，错误由 `errors.ts` 解释，显示由终端负责。核心不必为了新增两行输出再多一套分支。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/errors.ts](src/errors.ts) | 定义安全错误并分类 SDK 错误。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 使用共用的 `UserFacingError` 表示配置错误。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | 给 `Reply` 增加用量与截断信息。 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 显示用量、截断提示和分类错误。 |
| 修改 | [src/cli.ts](src/cli.ts) | 让单次提问复用相同的显示和错误处理。 |

## 动手构建

从空目录跟写时，把已经完成的 `chapter-02-model-dialogue/05-anthropic/src/` 复制到 `chapter-02-model-dialogue/06-errors-and-usage/src/`，再在这份代码上继续。下面的 `src/` 均指本节目录；已有配套仓库时无需复制。

### 第一步：实现错误分类

创建 `src/errors.ts`：

```ts
/**
 * 02.6 说明错误与显示用量 | [NEW] errors.ts
 *
 * 学习目标：让用户知道请求失败后先检查哪里，同时避免把原始请求与响应直接显示出来。
 * 输入：配置错误、OpenAI / Anthropic SDK 错误或未知异常。
 * 输出：程序自建的提示，或按错误类型选择的固定中文提示；不展开 SDK 原始异常。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +-------+
 *   | error |
 *   +---+---+
 *       v
 *   UserFacingError？ -- 是 --> 返回安全文案
 *       | 否
 *       v
 *   SDK error？ -------- 否 --> 返回通用提示
 *       | 是
 *       v
 *   +-------------------------------+
 *   | timeout / network / HTTP code |
 *   +---------------+---------------+
 *                   v
 *   401 / 403 / 404 / 429 / 5xx / other --> 对应检查建议
 *
 * 关键点：只有程序自己创建的 UserFacingError 可以原样展示；外部错误只按类型和状态码分类。
 * 运行观察：不同失败原因给出不同建议，任何提示都不包含测试密钥。
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// [NEW 02.6] 本文件以下实现均为本节新增。
// 这种错误的 message 会原样显示，创建时就要使用不含敏感内容的提示。
export class UserFacingError extends Error {}

/**
 * 把捕获到的错误转成用户可以据此排查的提示。
 *
 * error 可能来自本地检查、两种 SDK，或其他未知位置。
 * 程序自建的 UserFacingError 已使用可显示的文案，直接返回；SDK 错误按超时、网络和状态码选择固定提示。
 * 无法识别时返回通用提示，不展开原始异常，也不打印响应体、请求头或堆栈。
 * UserFacingError 本身不会脱敏，创建它时就必须避免放入凭据和原始响应。
 */
export function explainError(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionTimeoutError) {
    return "请求超过 60 秒，请稍后重试，或检查接口连接。";
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError) {
    return "无法连接模型服务，请检查网络和接口地址。";
  }
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) {
    if (error.status === 401) return "认证失败（401），请检查所选协议的 API Key 与接口是否匹配。";
    if (error.status === 403) return "没有访问权限（403），请检查账号与模型权限。";
    if (error.status === 404) return "接口或模型不存在（404），请检查接口地址和模型 ID。";
    if (error.status === 429) return "请求受限（429），请检查额度或稍后重试。";
    if (error.status && error.status >= 500) return "模型服务暂时不可用，请稍后重试。";
    return "模型服务拒绝了请求，请检查协议、模型与配置。";
  }
  return "本次操作失败，请检查配置和服务状态后重试。";
}
```

只有 `UserFacingError` 的文字可以原样显示，因为这些文字由程序编写。SDK 异常只读取类型和状态码，不把远端 `message`、响应体或请求信息写到终端。[教学注释版源码](src/errors.ts)展示了完整分类流程。

在 `src/config/load-config.ts` 中删除原来的 `UserFacingError` 类，把下面这条导入放到文件顶部：

```ts
import { UserFacingError } from "../errors.js";
```

### 第二步：扩展统一结果

在 `src/models/client.ts` 中，保留配置导入中的 `systemPrompt` 和 `type Config`，把 `UserFacingError` 改从错误模块导入：

```ts
import { systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
```

然后替换原来的 `Reply` 定义：

```ts
export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};
```

在 `createModel()` 后、`requestReply()` 前加入用量检查函数：

```ts
// [NEW 02.6] 用量缺失或不是有限的非负数字时，统一记为未知。
/**
 * 检查服务商返回的用量能否作为一个数字显示。
 *
 * value 来自远端响应，可能缺失或不是数字；只保留有限的非负数字，其余返回 null。
 * null 表示未知，不能换成 0，否则会把没有统计误写成没有消耗。
 * 这里只检查数字格式，不验证服务商的统计方法；用量缺失也不会让已经返回的文本失败。
 */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
```

OpenAI 分支返回：

```ts
return {
  text,
  inputTokens: tokenCount(response.usage?.prompt_tokens),
  outputTokens: tokenCount(response.usage?.completion_tokens),
  truncated: choice.finish_reason === "length",
};
```

Anthropic 分支返回：

```ts
return {
  text,
  inputTokens: tokenCount(response.usage?.input_tokens),
  outputTokens: tokenCount(response.usage?.output_tokens),
  truncated: response.stop_reason === "max_tokens",
};
```

两套字段在模型边界变成同一种 `Reply`，所以上层不需要判断服务商。前面已经完成错误类型的导入替换；其余请求和纯文本检查保持原样。

### 第三步：统一终端显示

在 `src/ui/terminal.ts` 中，删除原先从配置模块导入 `UserFacingError` 的语句，换成：

```ts
import { explainError } from "../errors.js";
```

在单轮请求的 `catch` 中，保留取消判断和退出码处理，把原来的 `console.error()` 换成下面这一行：

```ts
console.error(`错误：${explainError(error)} 本轮未加入历史，可重新输入。`);
```

再把 `printReply()` 替换为：

```ts
// [CHANGED 02.6] 同一处输出同时服务于连续对话与 --prompt 单次提问。
/**
 * 显示回答，并补上服务商报告的用量与输出上限提示。
 *
 * reply 来自模型模块，字段已经转换成统一名称。
 * 先显示文本，再显示输入和输出用量；缺失值写“未知”，合法的 0 保持为 0。
 * truncated 为真时提醒回答可能不完整，不根据文本长度猜测 token 或费用。
 * 单次提问和连续会话共用这里；历史已经由核心保存，本函数只负责显示。
 */
export function printReply(reply: Reply): void {
  console.log(`${colorLabel("Agent", 35)} > ${reply.text}`);
  // 显示接口报告的本轮字段，不估算价格，也不把历史文本长度当成 token 数。
  console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
  if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
}
```

`colorLabel()` 延续 02.4 的终端规则：“你”使用青色，“Agent”使用紫色，并且只在交互终端中添加 ANSI 颜色。

`??` 不会把合法的 0 替换成“未知”。只有 `null` 或 `undefined` 才表示服务商没有提供可靠数值。

### 第四步：让单次提问使用相同边界

在 `src/cli.ts` 中，配置导入改为只保留 `readConfig` 和 `type Options`，再从错误模块导入下面两个名字：

```ts
import { readConfig, type Options } from "./config/load-config.js";
```

```ts
import { UserFacingError, explainError } from "./errors.js";
```

底部的失败处理改为：

```ts
try {
  await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
}
```

单次提问和连续对话已经都调用 `printReply()`，所以它们会显示相同的回答、用量和截断提示。

### 第五步：准备模型配置

使用根目录 `.env` 中已经配置好的任一服务商。本节不需要增加环境变量；成功响应中有可用统计时就显示数值，没有时显示“未知”。

### 第六步：构建并运行本节

在仓库根目录执行：

```bash
npm run lesson:02.6
```

这条 npm 命令只构建并注册本节，不调用模型。准备观察错误分类和用量时运行：

```bash
hello-my-agent
```

## 运行验证

成功回答下方应出现用量行，具体数值由接口返回；没有返回时显示“未知”。达到输出上限时会多一行提示。

## 失败实验

运行 `npm run verify`。本地模拟服务会依次制造 401、403、404、429、500、缺失用量和截断响应，并检查日志不含测试密钥。它能验证程序分支，不能证明真实模型的回答质量或账号可用性。

## 小练习

完成[本章 `/reset` 练习](../EXERCISES.md)，让用户清空当前对话历史后继续输入。这个命令只修改终端状态，不应发送给模型。

练习页包含实现思路、完整替换代码、运行命令和预期结果。

## 本节完成后的 Agent

第二章结束时，Agent 已经形成完整的纯对话链：

```text
终端输入
   -> Agent Loop 组织本轮消息
   -> 已按配置创建的模型返回回答与可选用量
   -> Agent Loop 确认未取消，保存本轮问答
   -> 终端显示回答、已知或未知用量，失败时显示脱敏错误
   -> 等待下一次输入
```

我们现在可以连续提问、切换启动时使用的协议，也能看见请求失败的类别与服务报告的用量。程序仍只接收文本回答，模型不能因此知道本地文件里写了什么。完成 `/reset` 练习后，第三章会从读取 `package.json` 开始，先识别工具请求，再执行读取、把结果送回同一个 Agent Loop。
