# 02.6 说明错误与显示用量

[第二章导航](../README.md) · [上一节](../05-anthropic/README.md) · [本章练习](../EXERCISES.md)

**本节目标：把失败转换成可执行的排查提示，并在成功回答后显示服务商报告的用量与截断状态。**

## 问题

上一节已经能通过两种协议持续对话，但所有未知异常最终都会变成近似的“模型请求失败”。用户无法判断应该检查网络、密钥、权限、模型 ID，还是等待限流恢复。直接打印 SDK 的原始异常虽然信息更多，却可能把远端响应体、请求地址或其他敏感上下文带到终端。

成功结果也丢失了重要信息。模型响应除了文本，还可能包含输入 token、输出 token 和停止原因。如果程序只保留文本，用户无法观察本轮上下文消耗，也无法知道回答是否因为达到输出上限而提前结束。兼容接口还可能完全不返回用量，此时显示 `0` 会错误地表示“没有消耗”。

因此，本节真正要解决的是：**怎样把失败安全地分类成可执行的排查提示，同时把不同协议的用量和停止原因转换成统一结果，并诚实表示缺失数据。**

## 解决方案

把成功结果统一为“文本、用量、是否截断”，把失败统一交给 `explainError()` 分类。终端只负责选择成功或失败的显示路径。

```text
+----------------+
| model request  |
+-------+--------+
        |
  +-----+----------------------------------+
  | 成功                                   | 失败
  v                                        v
+------------------+               +----------------+
| normalize Reply  |               | explainError   |
| text + usage     |               +-------+--------+
| + truncated     |                       |
+--------+---------+               +-------+-------------------+
         |                         | network / 401 / 403 /     |
         |                         | 404 / 429 / server / other|
         |                         +-------+-------------------+
         v                                 v
 print text + usage                 print fixed safe hint
         |
  +------v-------+
  | truncated?   |
  +---+-------+--+
      | 否    | 是
      v       v
     结束   显示截断提示 --> 结束
```

成功和失败是两条独立分支：用量来自成功响应，错误提示来自异常对象。程序不会根据错误响应猜测 token 用量。

## 工作原理

先把远程调用的结果分成两条通道：**失败通道回答“为什么没有结果”，成功通道回答“得到了什么以及消耗了什么”**。异常分类只处理失败；文本、用量和停止原因只来自成功响应。两条通道不能互相猜测。

```text
模型调用
  ├─ 抛出异常 -> 判断本地配置、网络或 HTTP 状态 -> 安全提示
  └─ 返回响应 -> 提取文本、用量和停止原因 -> 统一 Reply
```

例如，服务返回 401 时没有可信回答，也没有本轮成功用量；程序只显示“检查 API Key 与接口是否匹配”。服务返回文本并以 `max_tokens` 停止时，请求已经成功，程序应显示回答和用量，再提醒回答可能不完整。把第二种情况当异常，会丢掉仍然有用的文本。

最容易误解的是“信息越原始越方便排错”。SDK 原始异常可能携带响应体、请求地址或调试上下文，直接输出会扩大泄露范围；字符长度也不能可靠推算 token。本节只展示固定错误分类和服务商明确报告的用量，不计算费用，也不自动重试。

### 第一步：规定哪些错误可以直接显示

在 [src/errors.ts](src/errors.ts) 中定义 `UserFacingError`，让配置和模型模块都能标记程序自己编写、可以直接展示的安全提示。

新增 `explainError()` 分类 SDK 错误。入口处理启动失败，终端处理每轮请求失败，但两处使用同一套提示规则：

| 情况 | 提示你检查什么 |
| --- | --- |
| 超时 / 网络连接失败 | 网络和接口地址 |
| 401 | 密钥是否与接口匹配 |
| 403 | 账号和模型权限 |
| 404 | 基础地址与模型 ID |
| 429 | 额度，或稍后重试 |
| 服务端错误 | 稍后重试 |

只展示固定文案，不打印 SDK 的原始 `message`、响应体、请求头或堆栈。本节把原来的通用提示细分为可以采取行动的检查建议。

### 第二步：区分配置错误、传输错误和 HTTP 错误

配置错误发生在发送请求之前，例如缺少 Key 或 URL 无效；程序可以为它编写确定且安全的 `UserFacingError`。传输错误表示没有正常取得 HTTP 响应，例如 DNS、连接失败或超时。HTTP 错误表示远端已经响应，但拒绝或无法处理请求。

这三层错误需要不同提示，因为修复动作不同。把所有异常都写成“模型请求失败”，读者无法判断应该检查本地配置、网络还是账号权限。另一方面，直接输出远端原始错误又会扩大日志中的敏感信息，所以这里只根据受控类型和状态码选择固定文案。

异常沿调用栈向上传播：SDK 抛错后，模型函数不会返回 `Reply`，`agentLoop()` 不会提交历史，终端或入口的 `catch` 最终负责显示。每一层只处理自己能够解释的职责。

### 第三步：把两种协议的用量归一化

在 [src/models/client.ts](src/models/client.ts) 的 `Reply` 上增加 `inputTokens`、`outputTokens` 和 `truncated`。OpenAI 读取 `prompt_tokens / completion_tokens`，Anthropic 读取 `input_tokens / output_tokens`。

有些兼容接口不返回用量，缺失或无效值转为 `null`，显示时写“未知”。Anthropic 本节展示原始输入/输出字段，暂不合并缓存字段；本节不计算费用。

`finish_reason: length` 或 `stop_reason: max_tokens` 表示达到输出上限。把它转成 `truncated`，由终端显示提示。

token 是模型分词器处理的单位，不等于字符数或单词数。服务端可能加入或转换协议内容，因此本地不能通过 `text.length` 推算可靠用量。当前实现只展示响应明确报告的数值；字段缺失时使用 `null` 表示“未知”，而不是用 0 冒充没有消耗。

停止原因也不是异常。模型达到输出上限时，请求仍然成功并产生可用文本，只是回答可能不完整。把它保存为 `truncated`，可以同时保留回答和提醒使用者。

### 第四步：统一显示成功结果

在 [src/ui/terminal.ts](src/ui/terminal.ts) 的 `printReply()` 中追加：

```ts
console.log(`用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`);
if (reply.truncated) console.log("提示：回答达到输出上限，可能尚未完整。");
```

`??` 只在左侧是 `null` 或 `undefined` 时使用默认值，合法的 0 会正常显示。单次提问与连续对话都调用 `printReply()`，所以无需各写一套。

`agentLoop()` 只接收统一的 `Reply` 并提交成功问答。错误码在模型边界解释，用量在终端边界显示，核心不需要知道某个服务商怎样命名这些字段。

### 为什么选择在边界处翻译错误

底层 SDK 错误包含传输细节，使用者需要的是下一步能做什么。`errors.ts` 负责识别 OpenAI、Anthropic 的 SDK 错误类型和 HTTP 状态码，并把它们翻译成有限的故障类别；模型模块只负责协议请求和成功响应转换，CLI 与终端负责调用 `explainError()` 后展示。固定文案还避免把远端响应体、请求地址中的参数或调试信息直接写到屏幕。

用量也在协议边界归一化，因为 OpenAI 与 Anthropic 使用不同字段名。终端只处理 `number | null`，不会依赖某个 SDK 的响应对象。这个边界保证单次提问和连续会话可以复用同一个显示函数。

### 还有哪些方案

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 直接打印原始异常 | 调试信息最多 | 输出结构不稳定，还可能暴露响应体、地址或其他敏感上下文。 |
| 所有失败只显示一句通用提示 | 实现最短 | 用户无法区分密钥、权限、限流和服务端故障。 |
| 返回 `Result` 联合类型而不抛异常 | 成功和失败都体现在类型中 | 需要让每一层转发结果；当前 SDK 本身使用异常，额外包装没有减少分支。 |
| 按字符数估算 token | 即使服务商不返回用量也能显示数字 | 不同模型分词规则不同，估算值不能代表计费或上下文占用。 |

因此本节保留 SDK 的异常传播方式，只在最了解异常的边界做一次安全分类；用量只相信服务端明确返回的值，缺失时诚实显示“未知”。

## 动手构建

### 本节会修改哪些文件

| 操作 | 文件 | 作用 |
| --- | --- | --- |
| 新增 | `src/errors.ts` | 分类 SDK 异常并生成安全提示。 |
| 修改 | `src/config/load-config.ts` | 从共用错误模块导入 `UserFacingError`。 |
| 修改 | `src/models/client.ts` | 统一两种协议的用量和截断状态。 |
| 修改 | `src/ui/terminal.ts` | 显示用量，并用 `explainError()` 解释失败。 |
| 修改 | `src/cli.ts` | 单次提问复用相同的显示和错误分类。 |

### 第一步：实现错误分类

创建 `src/errors.ts`：

```ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export class UserFacingError extends Error {}

export function explainError(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return "请求超过 60 秒，请稍后重试，或检查接口连接。";
  }

  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof Anthropic.APIConnectionError
  ) {
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

在 `src/config/load-config.ts` 中删除原来的 `UserFacingError` 类，改为：

```ts
import { UserFacingError } from "../errors.js";
```

### 第二步：扩展统一结果

在 `src/models/client.ts` 中改写 `Reply`：

```ts
export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
};
```

加入统一数值检查：

```ts
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
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

两套字段在模型边界变成同一种 `Reply`，所以上层不需要判断服务商。模型模块还要从 `../errors.js` 导入 `UserFacingError`；完整修改见[模型源码](src/models/client.ts)。

### 第三步：统一终端显示

在 `src/ui/terminal.ts` 中导入：

```ts
import { explainError } from "../errors.js";
```

把请求失败提示改为：

```ts
console.error(`错误：${explainError(error)} 本轮未加入历史，可重新输入。`);
```

再把 `printReply()` 替换为：

```ts
export function printReply(reply: Reply): void {
  console.log(`Agent > ${reply.text}`);
  console.log(
    `用量：输入 ${reply.inputTokens ?? "未知"}，输出 ${reply.outputTokens ?? "未知"} token。`,
  );
  if (reply.truncated) {
    console.log("提示：回答达到输出上限，可能尚未完整。");
  }
}
```

`??` 不会把合法的 0 替换成“未知”。只有 `null` 或 `undefined` 才表示服务商没有提供可靠数值。

### 第四步：让单次提问使用相同边界

在 `src/cli.ts` 中从 `errors.ts` 导入：

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

使用根目录 `.env` 中已经配置好的任一服务商。本节不需要增加环境变量；成功响应本身会提供可用的用量字段。

### 第六步：运行本节程序

在仓库根目录执行：

```bash
npm run lesson:02.6
```

启动后会进入带错误分类和用量显示的连续对话。之后也可以直接运行：

```bash
hello-my-agent
```

## 本节实现清单

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| 新增 | [src/errors.ts](src/errors.ts) | 定义安全错误并分类 SDK 错误。 |
| 修改 | [src/config/load-config.ts](src/config/load-config.ts) | 使用共用的 `UserFacingError` 表示配置错误。 |
| 修改 | [src/models/client.ts](src/models/client.ts) | `Reply` 增加用量与截断信息。 |
| 修改 | [src/ui/terminal.ts](src/ui/terminal.ts) | 显示用量、截断提示和分类错误。 |
| 修改 | [src/cli.ts](src/cli.ts) | 单次提问复用相同的显示和错误处理。 |

## 运行验证

成功回答下方应出现用量行，具体数值由接口返回；没有返回时显示“未知”。达到输出上限时会多一行提示。

## 失败实验

运行 `npm run verify`。本地模拟服务会依次制造 401、403、404、429、500、缺失用量和截断响应，并检查日志不含测试密钥。它能验证程序分支，不能证明真实模型的回答质量或账号可用性。

## 小练习

完成[本章 `/reset` 练习](../EXERCISES.md)，让用户清空当前对话历史后继续输入。这个命令只修改终端状态，不应发送给模型。

练习页包含实现思路、完整替换代码、运行命令和预期结果。

## 接下来

下一章在 src/agent/agent-loop.ts 内添加工具分支、结果回传和循环上限。本章尚不执行工具。
