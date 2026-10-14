# 第 07 章练习：为本次命令选择等待时间

[第 07 章首页](README.md) · [先完成 07.3](03-ripgrep-search/README.md) · [命令工具源码](03-ripgrep-search/src/tools/run-command.ts) · [完整答案](#完整答案)

## 问题：每条命令都需要等 30 秒吗

本章的命令默认运行 30 秒后触发停止。这个默认值够我们观察测试结果，但不同命令的等待时间不一定相同。例如，演示一个不会结束的命令时，我们希望很快看到超时；较慢的测试则可能需要多等一会儿。

这道练习让 `run_command` 接受一个可选参数 `timeout_ms`，单位为毫秒。模型可以为本次请求选择等待时间，程序仍然校验范围，并把这个值与命令一起展示给用户。没有提供时，继续用 30,000 毫秒。

```json
{
  "command": "node -e \"setInterval(() => {}, 1000)\"",
  "cwd": ".",
  "timeout_ms": 100
}
```

这里的 `100` 表示运行 100 毫秒后开始请求停止。它不保证整个工具在第 100 毫秒已经返回，因为后面还有进程组与输出管道的清理。

## 练习要求

只修改 `chapter-07-command-feedback/03-ripgrep-search/src/tools/run-command.ts`。`runProcess()` 已经支持 `timeoutMs`，这次不用再修改进程执行器。

| 输入 | 预期行为 |
| --- | --- |
| 不提供 `timeout_ms` | 使用 `30000`，预览中也显示这个值 |
| 提供 `100`—`60000` 的整数 | 预览与实际执行使用这一值 |
| `99`、`60001`、`1.5` | 参数错误，不能进入审批或启动命令 |
| `"1000"`、`null`、`true` | 参数错误，不自动转换为数字 |

工具 Schema、参数解析、审批预览和实际执行都要更新。如果只改 Schema，模型虽然知道有这个字段，本地解析仍会拒绝；如果只改预览却没有传给执行器，用户看到的等待时间就与实际执行不一致。

其他规则继续保留：命令必须逐次批准，`cwd` 仍要检查，输出仍采用合计 32 KiB 上限，用户取消仍执行同组清理。

## 提示：只决定一次默认值，后面一直传这一个值

参数刚解析时，`timeout_ms` 还可能是任何 JSON 值。先分清“没有提供”和“提供了不合法的值”：只有 `undefined` 才采用默认值，`null` 不能代表省略。

校验通过后，把它存成内部字段 `timeoutMs`，与 `command`、`cwd` 一起返回。准备预览时展示它，执行闭包也从这份已准备的输入取值，最后传给 `runProcess()`。

```text
模型的 timeout_ms
  -> 未提供：30000 / 已提供：检查整数与范围
  -> input.timeoutMs
       +-> 审批预览
       +-> execute -> runProcess({ timeoutMs })
```

上限由本地代码固定，模型不能通过传入更大数字让命令无限等待。这个值也只作用于当前命令，不会改变后续命令或 rg 搜索的默认预算。

## 完整答案

将 `03-ripgrep-search/src/tools/run-command.ts` 替换为下面的完整文件：

<!-- solution: src/tools/run-command.ts -->
```ts
/**
 * 第 07 章练习：为本次命令选择等待时间 | [CHANGED 练习] tools/run-command.ts
 *
 * 学习目标：让模型选择本次时间上限，同时让本地校验和审批看到同一个值。
 * 输入：command、cwd、可选 timeout_ms；省略时使用 30000 毫秒。
 * 输出：带命令、目录和时间的预览；批准后返回真实进程结果。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   JSON -> 检查字段 -> timeout_ms 合法？-- 否 -> ToolError
 *                                      +-- 是 -> 保存 timeoutMs -> 预览
 *   批准 -> 复查目录 -> runProcess 使用同一个 timeoutMs -> 返回输出与状态
 *
 * timeout_ms 必须是 100—60000 之间的整数，不把字符串或 null 自动变成数字。
 * 本次等待时间和命令一起保存，审批后不重新采用默认值，也不保存为会话授权。
 * 时间到达只触发停止过程，仍要等同组清理与管道关闭；它不是命令隔离或回滚。
 * 观察：100 毫秒的常驻命令提前返回 timeout，省略字段时预览显示 30000。
 */

// [KEEP 来自 07.2] spawn 的生命周期交给共享执行器。
import { runProcess } from "../processes/run-process.js";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { ToolError } from "../errors.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import { findProjectRoot } from "./workspace.js";

// [KEEP 来自 07.1] 命令定义、参数检查和目录复查继续沿用。
export const runCommandDefinition = {
  name: "run_command",
  description: "经用户逐次批准，在指定项目目录执行非交互 shell 命令；返回 stdout、stderr 和退出码。",
  inputSchema: {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: "完整 shell 命令，例如 node --test；不能包含密钥。" },
      cwd: { type: "string" as const, description: "相对于项目根的执行目录；项目根传入 .。" },
      // [NEW 练习] Schema 告诉模型可选字段及范围，本地还会重新校验。
      timeout_ms: {
        type: "integer" as const,
        minimum: 100,
        maximum: 60_000,
        description: "本次命令最多等待多少毫秒；省略时为 30000，范围 100—60000。",
      },
    },
    required: ["command", "cwd"],
    additionalProperties: false,
  },
};

/**
 * 检查模型有没有把本次命令和运行目录说清楚。
 *
 * 输入是未经信任的 JSON 字符串，先检查对象和字段，再检查 command 与 cwd 的值。
 * command 去掉首尾空白后必须有内容；原字符串限制继续沿用主线。
 * cwd 只能是 500 字符以内的项目相对目录，不接受控制字符、绝对路径或 ..。
 * 可选 timeout_ms 省略时为 30000，提供时必须为 100—60000 的整数；通过后返回 timeoutMs。
 * 失败抛出 ToolError。这里只检查参数，真实目录稍后再查。
 */
// [CHANGED 练习] 返回已校验的等待时间，后面的预览和执行共用它。
function parseArguments(argumentsJson: string): { command: string; cwd: string; timeoutMs: number } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); }
  catch { throw new ToolError("run_command 参数不是有效的 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("run_command 参数必须是对象。");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["command", "cwd", "timeout_ms"].includes(key))) {
    throw new ToolError("run_command 参数只能包含 command、cwd 和可选 timeout_ms。");
  }
  if (typeof input.command !== "string" || !input.command.trim() || input.command.length > 4000
      || /[\x00\x80-\x9f\u202a-\u202e\u2066-\u2069]/.test(input.command)) {
    throw new ToolError("command 必须是 1—4000 个字符的非空命令，不能包含 NUL 或不可见方向控制字符。");
  }
  if (typeof input.cwd !== "string" || !input.cwd.trim() || input.cwd.length > 500
      || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(input.cwd) || isAbsolute(input.cwd) || win32.isAbsolute(input.cwd)
      || input.cwd.split(/[\\/]/).includes("..")) {
    throw new ToolError("cwd 必须是项目内的相对目录，不能使用绝对路径或 ..。");
  }
  // [NEW 练习] 只在字段未提供时用默认值；null、布尔值和数字字符串都不是有效整数。
  const timeoutMs = input.timeout_ms === undefined ? 30_000 : input.timeout_ms;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs)
      || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ToolError("timeout_ms 必须是 100—60000 之间的整数。" );
  }
  return { command: input.command.trim(), cwd: input.cwd.trim(), timeoutMs };
}

/**
 * 把受控进程的结束状态与输出整理成模型能够使用的工具结果。
 *
 * 输入是本次批准的 command、真实 cwd、timeoutMs 和取消信号；runProcess 负责生命周期。
 * 退出码不是 0，或者因时间/输出上限停止时，返回 isError=true，同时保留已收集的日志。
 * stdout 和 stderr 不用来互相推断成功与失败；信号终止时可能没有数字退出码。
 * 启动失败抛出 ToolError，由主循环转成工具错误交回模型，模型仍可继续决策。
 * 用户取消则向外传播取消原因，结束当前回合，不再请求模型。
 */
// [KEEP 来自 07.2] 命令不再自行管理子进程；搜索将在 07.3 复用同一执行器。
// [CHANGED 练习] timeoutMs 来自本次审批的准备结果，不在执行时重新决定。
async function executeCommand(
  command: string, cwd: string, signal: AbortSignal, timeoutMs: number,
): Promise<ToolExecutionResult> {
  const result = await runProcess("/bin/sh", ["-c", command], { cwd, signal, timeoutMs });
  const { exitCode, signal: exitSignal, stdout, stderr, stopReason } = result;
  return {
    isError: exitCode !== 0 || Boolean(stopReason),
    metadata: { kind: "run_command", ...result },
    content: `cwd: ${cwd}\n退出码: ${exitCode ?? "无"}\n信号: ${exitSignal ?? "无"}`
      + `\n停止原因: ${stopReason ?? "命令已退出"}`
      + `\nstdout:\n${stdout || "（空）"}\nstderr:\n${stderr || "（空）"}`,
  };
}

/**
 * 准备这一次命令，把启动进程留到用户批准之后。
 *
 * 解析参数后，查到 cwd 的真实位置并确认在项目内，记下目录的 dev/ino。
 * 返回的 preview 展示命令、真实目录和 timeoutMs；execute 闭包保留同一份输入，批准后才调用。
 * execute 先复查目录身份，发现等待期间被替换就抛出 ToolError，否则执行保存的命令。
 * 准备时不启动进程；路径检查与启动仍有时间间隔，也不限制命令自行访问其他路径。
 */
export async function prepareRunCommand(
  argumentsJson: string,
  projectRoot = findProjectRoot(),
  signal?: AbortSignal,
): Promise<PreparedToolCall> {
  signal?.throwIfAborted();
  if (process.platform === "win32") throw new ToolError("本章命令工具需要 macOS 或 Linux 的 /bin/sh；Windows 请在 WSL 中运行。");
  const input = parseArguments(argumentsJson);
  let cwd: string;
  try {
    const root = await realpath(projectRoot);
    cwd = await realpath(resolve(root, input.cwd));
    const path = relative(root, cwd);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new ToolError("cwd 的真实位置在项目外。");
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("cwd 目录不存在或无法访问。");
  }
  const before = await stat(cwd).catch(() => null);
  if (!before || !before.isDirectory()) throw new ToolError("cwd 必须是可访问的目录。");
  signal?.throwIfAborted();
  return {
    // [CHANGED 练习] 用户在启动前也能看到本次等待时间。
    preview: `工作目录：${JSON.stringify(cwd)}\n命令：${JSON.stringify(input.command)}\n最长运行时间（毫秒）：${input.timeoutMs}\n只批准这一次执行。`,
    async execute(executionSignal) {
      executionSignal.throwIfAborted();
      const current = await stat(cwd).catch(() => null);
      if (!current || current.dev !== before.dev || current.ino !== before.ino) {
        throw new ToolError("工作目录在等待审批期间发生了变化，请重新请求执行。");
      }
      return executeCommand(input.command, cwd, executionSignal, input.timeoutMs);
    },
  };
}
```

新增的 `timeout_ms` 没有放入 `required`，所以旧调用继续可用。内部只使用校验后的 `timeoutMs`；审批与执行不各自计算默认值，避免两边看到不同设置。

## 运行验证

完成修改后，在仓库根目录运行：

```bash
npm run exercise:07
```

检查会覆盖默认值、边界值、非法输入、预览和真实的短时超时。如果当前文件仍是练习起点，命令会说明参考答案通过，当前实现尚未加入这项能力；那不表示练习已经完成。

确认自己的实现通过后，重新构建本节：

```bash
npm run lesson:07.3
```

再在交互终端请求一次短时执行：

```bash
hello-my-agent --prompt '请调用 run_command，cwd 为 .，command 为 node -e "setInterval(() => {}, 1000)"，timeout_ms 为 100。收到超时结果后说明原因并停止，不要重试。'
```

预览应显示本次最长运行时间为 `100` 毫秒。批准后，工具应较快报告 `timeout`，不会仍按默认值等待 30 秒。再提出一条省略 `timeout_ms` 的命令，预览应显示 `30000`。

模型可能自行省略字段或换一条命令，因此手工实验先看实际预览。固定检查则直接用明确参数验证，不依赖模型恰好生成同一份请求。

## 完成练习后的 Agent

现在，命令工具可以在本地规定的范围内，为每次执行选择等待时间。这个值经过校验、进入预览、传入执行器，用户批准的设置与实际执行一致。

[08.1 让回答逐段显示](../chapter-08-streaming-turns/01-text-stream/README.md)从完成本练习后的代码继续。我们会沿用本章的命令结果和取消传递，在这个基础上加入流式显示与中断后继续交流。
