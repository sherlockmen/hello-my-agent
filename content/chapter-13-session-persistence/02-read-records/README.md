# 13.2 读取有效会话记录

[第 13 章首页](/content/chapter-13-session-persistence/README.md) · [上一节：13.1 会话保存](/content/chapter-13-session-persistence/01-save-session/README.md) · [下一节：13.3 恢复会话并继续讨论](/content/chapter-13-session-persistence/03-resume-session/README.md)

## 问题：文件还在，哪一份状态可以继续使用

上一节把负数检查的讨论写进了会话文件。正常退出后，文件里有会话头和依次追加的完整快照；如果进程在追加途中被强制结束，末尾却可能只剩 `{"version":1,"type":"check`。

我们希望读回此前已经完成的负数检查，不能因为最后几个字节没写完，就把前面的记录全部丢掉。但也不能“找到最后一行能解析的 JSON 就使用”：一行可能能解析，却属于另一个会话、使用未知版本，或者把 `test-1` 的结果错接到 `read-1`。

这时要回答的是：程序根据哪些约定接受记录，遇到哪里必须停止，以及最后交给恢复入口的状态来自哪一行。

## 解决方案：按顺序检查完整记录，只忽略未完成的最后一段

读取分成两层。先用换行找出完整记录的范围，末尾没有换行的片段不参与读取；再从第一行开始，依次检查格式版本、会话 ID、连续编号和状态内容。所有完整行都通过，才返回最后一份检查点。

这里把“从文件开头到某个位置，连续通过检查的记录”称为**有效前缀**。前缀不能跨过坏行。若中间一条完整记录不符合约定，即使后面还有看似正确的快照，整个读取也报错，原文件保持原样。下一节取得独占写入权后，才会处理可以丢弃的未换行尾片。

本节新增的是只读模块 `readSession()`，供后面的恢复和管理入口使用。它不启动模型、不执行工具、不修改会话文件；CLI 仍沿用上一节的新建会话入口。

## 工作原理

### 先用换行分出完整记录，再判断内容是否有效

看这份文件的简化结构。表中省略了 JSON 字段，用 `↵` 表示文件里的换行字节，并非真实协议文字：

| 文件位置 | 内容示意 | 读取时的处理 |
| --- | --- | --- |
| 第 1 行 | 会话头，版本 1，ID 为 A `↵` | 确认记录身份与采用的约定 |
| 第 2 行 | 检查点 #1，已保存负数检查 `↵` | 检查内容，通过后记住这份状态 |
| 第 3 行 | 检查点 #2，切到 Plan `↵` | 通过后用这份更新状态替换上一份 |
| 文件尾 | 检查点 #3 的部分字节，没有 `↵` | 不解析，返回警告；仍可返回 #2 |

上一节每次写入 `JSON.stringify(record) + "\n"`。因此，换行是本章判断“一条写入已到达记录边界”的依据。消息正文自身的换行会被 JSON 转义，不会被误认成新的记录。

即使尾片碰巧已经是合法 JSON，只要没有最终换行，也不把它当成完整提交。否则，同一条追加在只写完正文、还没写完分隔符时，就可能提前被读取者接受。这个规则保证读取者采用同一套边界；它不能证明写入者的 `sync()` 曾成功返回，读取检查和设备同步仍是两个问题。

如果完整的第 3 行是坏 JSON，或者它包含 `version: 2`，处理就不同了。它已经占据一个完整记录位置，程序无法把它解释成“最后一次只写了一半”。跳过去直接拿第 4 行，会掩盖记录中断、未知格式或人为改动，所以读取报错，并指出发生问题的行号。

这也解释了为什么不能先做 `trim().split("\n")`：`trim()` 会抹去“是否有最后一个换行”这个判断依据，还可能让空行等不合法记录消失。程序先在字节中记住最后换行的位置，再只解析前面的完整部分，未换行部分另行报告。

下面对照两份文件：左边只有最后一段没写完，可以返回此前状态并警告；右边已有带换行的坏记录，即使后面还有检查点，也不能跨过去。

<img src="./content/chapter-13-session-persistence/02-read-records/assets/record-boundaries-a640649262.png" alt="未换行尾片保留此前有效状态，完整坏行使读取停止且不修改原文件">

### JSON 解析成功，只说明文字能够表示数据

`JSON.parse()` 能把 `{"mode":"fly"}` 变成对象，却不知道 Agent 只支持 `plan` 与 `execute`。TypeScript 的 `SessionState` 类型也不会自动检查从磁盘取得的数据；类型检查发生在开发时，文件可能由旧版本、其他程序或手工编辑产生。

因此，读取者先把解析结果当作未知数据，再逐层检查，并从允许的字段重新建立状态：

| 检查对象 | 要确认的关系 | 不检查会怎样 |
| --- | --- | --- |
| 会话头 | 第一行是版本 1 的会话头，ID 与所选文件一致，时间可解释，工作区是绝对路径 | 把其他会话或未知格式当成本次记录 |
| 后续记录 | ID 仍相同，`seq` 从 1 连续增加，时间与记录种类符合约定 | 漏行、重复行或拼接的文件被悄悄接受 |
| 消息 | 角色与对应字段受支持；工具请求和结果形成完整批次 | 下一次请求携带缺少来源或缺少结果的消息 |
| 模式、清单 | 模式受支持，步骤 ID 唯一，状态受支持，最多一项进行中 | 恢复出本地程序无法解释的状态 |
| 队列与计数 | 条目 ID 递增且小于下一 ID，所属任务不超过已开始的任务编号；计数不能随快照倒退 | 编号碰撞，或把要求放入不可能存在的任务 |

“严格”还包括拒绝未约定的字段。比如文件里出现 `grants`，读取者不会因为恰好能够解析，就把它装进进程授权集合。遇到未来版本或未来字段，本章选择停止并说明不支持；格式迁移属于第 36 章的升级主题，不靠猜测兼容。

### 工具调用 ID 把结果接回提出它的请求

继续看负数检查。下面是 `state.messages` 中的一段完整关系示例，调用参数保留为 JSON 字符串，工具正文做了教学缩写：

```json
[
  {"role":"user","content":"请读取 src/add.ts，检查两个负数相加"},
  {"role":"assistant","content":"","toolCalls":[
    {"id":"read-1","name":"read_file","arguments":"{\"path\":\"src/add.ts\"}"}
  ]},
  {"role":"tool","toolCallId":"read-1","content":"export function add(a: number, b: number): number { return a + b; }","isError":false},
  {"role":"assistant","content":"","toolCalls":[
    {"id":"test-1","name":"run_command","arguments":"{\"command\":\"npm test\"}"}
  ]},
  {"role":"tool","toolCallId":"test-1","content":"两个负数相加：通过；两个零相加：通过","isError":false},
  {"role":"assistant","content":"负数测试通过，依据是 npm test 的返回结果。"}
]
```

读到第一条 assistant 工具消息后，程序记住这个批次等待的 ID：`["read-1"]`。下一条 tool 消息必须对应 `read-1`，接上后等待列表变空，才允许进入下一条普通消息。到了第二批，再等待 `test-1`。

若第二条工具结果写成 `toolCallId: "read-1"`，虽然它是合法字符串，也曾在前面出现过，但当前批次等待的是 `test-1`，所以拒绝。若少了结果就进入最终回答，同样拒绝。一个批次有多个调用时，本章按原调用顺序逐一配对，批内 ID 不能重复，批次结束不能留下未对应的调用。

这项检查只确认“历史能否解释”。`isError: false` 表示旧工具当时报告成功，不证明今天的文件仍是同一内容；参数能够解析成对象，也不等于已经通过路径和权限检查。恢复时不会执行这些旧请求，未来模型提出新的调用时，仍走原有工具校验与审批。

### 返回最后状态，同时保留读取依据

每读完一个有效检查点，程序用它的完整 `state` 替换候选状态。它不把 #1 的消息、#2 的清单和 #3 的队列拼起来；每行已经是一份完整快照，混用反而会制造一个从未保存过的状态。

结果中的 `seq` 记住最后一条记录的编号，`validBytes` 记住完整记录结束处的字节位置。二者用途不同：编号供下一节续写时接号，字节位置供持锁后截掉未完成尾片。只读调用先返回这些依据，文件保持不变。

文件可能只有完整会话头、没有检查点。这表示“知道会话身份，还没有保存过状态”；返回 `state: undefined`、`seq: 0`，后续可以从空状态继续，不能凭空生成负数检查历史。如果连会话头都没写完，就没有可用身份，读取直接报错。

本节还识别后面会使用的任务开始记录和命名记录。名称只更新 `name`，不替换最后状态；一个 `run_start` 后没有对应任务结束记录时，`interrupted` 为真。下一节会解释它能证明什么，以及为什么不能据此推断工具执行到哪里。

图中读取者从文件开头逐条检查。状态框只有在一整条检查点通过后才更新；到达未换行尾片时，返回最后已校验状态，同时把警告和有效字节位置交给调用者。



<img src="./content/chapter-13-session-persistence/02-read-records/assets/read-records-cover-64caf2b2b9.png" data-gif-src="./content/chapter-13-session-persistence/02-read-records/assets/read-records-8cfb7938de.gif" data-cover="./content/chapter-13-session-persistence/02-read-records/assets/read-records-cover-64caf2b2b9.png" data-no-zoom alt="读取者按顺序验证会话头和检查点，忽略未换行尾片，返回最后已校验状态、编号与有效字节位置">

[查看完整静态分镜](/content/chapter-13-session-persistence/02-read-records/assets/read-records-storyboard-1046c70b19.jpg.md)

这里的“返回”发生在全部完整行检查通过之后；图中逐步更新的状态只是读取过程中的已校验结果，遇到后续完整坏行仍会报错。

### 读取范围也需要有明确限制

`readSession()` 只接受完整的小写 UUID，再在选定目录里拼成 `<UUID>.jsonl`。传入 `../other` 或任意文件路径会在打开文件前被拒绝。文件必须是普通文件；本节检查符号链接、以不跟随链接的方式打开，并核对打开前后的文件身份。

本章一次读取最多 64 MiB，按字节限制实际读取量，防止会话过大或其他进程追加时无限增长内存。超过限制就报错，不偷偷裁掉旧历史。第 15 章会讨论上下文预算，但模型上下文裁剪不能替代这里的文件读取限制。

只读查看没有取得会话锁，所以结果是本次读取捕获到的文件内容；查看期间另一进程还可能继续追加。要根据文件决定下一条写入，必须等下一节在锁内重新读取，不能把先前只读结果当作永久不变的状态。

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/sessions/read-session.ts](/content/chapter-13-session-persistence/02-read-records/src/sessions/read-session.ts.md) | 验证 UUID、普通文件与大小，逐行校验完整记录，返回最后状态、警告和有效字节位置 |

## 动手构建

从 13.1 的完整 `src/` 继续，目标目录为 `chapter-13-session-persistence/02-read-records/`。其余文件保持上一节实现。先建立只读模块；恢复前的锁和文件修改留给下一节，不把读取函数变成隐式修复入口。

### 新增只读读取器

新建 `src/sessions/read-session.ts`，写入下面的完整文件。它先确定完整行的字节范围，再校验会话头和每条记录；状态验证也由这个模块统一提供，供后面的续写入口复用。`SessionState` 和消息只是类型导入，不会让读取器创建 writer 或模型。

<details>
<summary>完整文件：src/sessions/read-session.ts</summary>

<!-- source: src/sessions/read-session.ts -->
```ts
/**
 * 13.2 读取可信记录 | [NEW] sessions/read-session.ts
 *
 * 学习目标：先检查文件内容，再把最后一个完整、可信的状态交给恢复入口。
 * 输入：会话 UUID 与保存目录；磁盘里的 JSON 仍是未知数据，不能直接当作 SessionState。
 * 输出：会话头、最后状态、记录序号、未结束标记和有效字节边界；不执行历史工具。
 * 状态：只读取，不修改文件；只有没有换行的最后一段可以作为未完成写入忽略。
 * 失败：中间坏行、未来版本、非法状态或符号链接都停止读取，原文件保持不变。
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import type { Message } from "../models/client.js";
import type { CheckpointReason, SessionState } from "./save-session.js";

// [NEW 13.2] 大小限制约束一次读取的内存；本章还没有增量索引或历史压缩。
export const MAX_SESSION_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SESSION_DIRECTORY = join(homedir(), ".hello-my-agent", "sessions");
export type SessionHeader = { version: 1; type: "session"; sessionId: string; createdAt: string; cwd: string; workspace?: string };
export type ReadSessionResult = {
  header: SessionHeader;
  state?: SessionState;
  seq: number;
  warnings: string[];
  interrupted: boolean;
  name?: string;
  lastReason?: CheckpointReason | "run_start";
  validBytes: number;
  hasTrailingFragment: boolean;
  updatedAt: string;
};

/** 只把 UUID 组合成目录内文件名，拒绝路径片段、扩展名和相对路径穿越。 */
export function sessionPath(id: string, directory = DEFAULT_SESSION_DIRECTORY): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new UserFacingError("会话 ID 必须是完整的小写 UUID，不能是文件路径。");
  }
  return join(resolve(directory), `${id}.jsonl`);
}

/** 检查一条 JSON 的对象形状，拒绝数组、null 和未约定的字段。 */
function objectWithKeys(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要对象");
  const object = value as Record<string, unknown>;
  if (required.some(key => !(key in object)) || Object.keys(object).some(key => !required.includes(key) && !optional.includes(key))) throw new Error("字段不符合记录格式");
  return object;
}

/** 检查不用于终端控制或路径解析的非空文字；保留原始正文，不改写历史。 */
function text(value: unknown, limit = MAX_SESSION_BYTES): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("文字为空或过长");
  return value;
}

/** 序号和队列编号只能使用可精确比较的整数，不能接受负数、小数或 NaN。 */
function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("编号不是有效整数");
  return value;
}

/** 名称只用于显示和搜索，长度有界，不接收终端控制字符。 */
export function validateSessionName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new UserFacingError("会话名称必须是 1 到 80 个字符的文字。");
  if (/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new UserFacingError("会话名称不能包含控制字符。");
  const name = value.trim();
  return name;
}

/**
 * 校验一份完整快照并重建白名单数据。
 * 工具结果必须紧跟自己的调用批次、逐一对应；这里只检查关系，不调用工具注册表。
 * 队列编号、任务归属和下一编号一起检查，避免恢复后发生编号碰撞或跨任务投递。
 */
export function validateSessionState(value: unknown): SessionState {
  const state = objectWithKeys(value, ["messages", "mode", "tasks", "pendingInputs", "run", "nextInputId"]);
  if (state.mode !== "plan" && state.mode !== "execute") throw new Error("未知模式");
  const run = integer(state.run, 0), nextInputId = integer(state.nextInputId, 1);
  if (!Array.isArray(state.messages) || !Array.isArray(state.tasks) || !Array.isArray(state.pendingInputs)) throw new Error("状态列表不是数组");
  let expected: string[] = [];
  const messages: Message[] = state.messages.map((value): Message => {
    const message = objectWithKeys(value, ["role", "content"], ["toolCalls", "toolCallId", "isError"]);
    if (typeof message.content !== "string") throw new Error("消息正文不是文字");
    if (message.role === "tool") {
      objectWithKeys(message, ["role", "content", "toolCallId", "isError"]);
      if (!expected.length || message.toolCallId !== expected.shift() || typeof message.isError !== "boolean") throw new Error("工具调用与结果不配对");
      return { role: "tool", content: message.content, toolCallId: message.toolCallId as string, isError: message.isError };
    }
    if (expected.length) throw new Error("工具批次缺少结果");
    if (message.role === "user") {
      objectWithKeys(message, ["role", "content"]);
      text(message.content);
      return { role: "user", content: message.content };
    }
    if (message.role !== "assistant") throw new Error("未知消息角色");
    objectWithKeys(message, ["role", "content"], ["toolCalls"]);
    if (message.toolCalls === undefined) return { role: "assistant", content: message.content };
    if (!Array.isArray(message.toolCalls)) throw new Error("工具调用不是数组");
    const toolCalls = message.toolCalls.map(value => {
      const call = objectWithKeys(value, ["id", "name", "arguments"]);
      const id = text(call.id), name = text(call.name);
      if (typeof call.arguments !== "string") throw new Error("工具参数不是文字");
      const args: unknown = JSON.parse(call.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数不是对象");
      return { id, name, arguments: call.arguments };
    });
    expected = toolCalls.map(call => call.id);
    if (new Set(expected).size !== expected.length) throw new Error("同批工具 ID 重复");
    return { role: "assistant", content: message.content, toolCalls };
  });
  if (expected.length) throw new Error("工具批次缺少结果");
  if (state.tasks.length > 8 || state.pendingInputs.length > 20) throw new Error("状态列表超过限制");
  const taskIds = new Set<string>();
  let working = 0;
  const tasks = state.tasks.map((value): SessionState["tasks"][number] => {
    const item = objectWithKeys(value, ["id", "text", "status"]);
    const id = text(item.id, 80), description = text(item.text, 200);
    if (id !== id.trim() || taskIds.has(id)) throw new Error("任务 ID 重复或包含首尾空白");
    taskIds.add(id);
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") throw new Error("未知任务状态");
    if (item.status === "in_progress" && ++working > 1) throw new Error("多个任务同时进行中");
    return { id, text: description, status: item.status };
  });
  let previousId = 0;
  const pendingInputs = state.pendingInputs.map(value => {
    const entry = objectWithKeys(value, ["id", "text", "run"]);
    const id = integer(entry.id, 1), owner = integer(entry.run, 1), content = text(entry.text, 32_000);
    if (id <= previousId || id >= nextInputId || owner > run) throw new Error("队列编号或所属任务不符合计数");
    previousId = id;
    return { id, text: content, run: owner };
  });
  return { messages, mode: state.mode, tasks, pendingInputs, run, nextInputId };
}

/**
 * 逐行检查指定会话，返回最后一个完整检查点和有效前缀的字节长度。
 * 首行必须是对应 UUID 的版本 1 会话头；完整坏行不能略过，末尾未换行片段不参与恢复。
 * 使用只读且不跟随符号链接的句柄，最多读取 64 MiB；失败不会修改原文件。
 */
export async function readSession(id: string, directory?: string): Promise<ReadSessionResult> {
  const path = sessionPath(id, directory);
  let bytes: Buffer;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new UserFacingError("会话文件必须是普通文件，不能是符号链接。");
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) throw new UserFacingError("会话文件在读取前发生变化，请重试。");
      if (info.size > MAX_SESSION_BYTES) throw new UserFacingError("会话文件超过 64 MiB，本章暂不读取超大历史。");
      // 有界 read 防止另一个进程持续追加时 readFile 超出启动时检查的大小。
      bytes = Buffer.alloc(Math.min(info.size + 1, MAX_SESSION_BYTES + 1));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      bytes = bytes.subarray(0, offset);
      if (bytes.length > MAX_SESSION_BYTES) throw new UserFacingError("会话文件超过 64 MiB，本章暂不读取超大历史。");
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("无法读取会话文件，请检查 ID、目录和访问权限。");
  }
  const validBytes = bytes.lastIndexOf(10) + 1;
  if (!validBytes) throw new UserFacingError("会话头尚未完整写入，无法读取。");
  let contents: string;
  try { contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, validBytes)); }
  catch { throw new UserFacingError("完整记录含有无效 UTF-8，无法读取。"); }
  const lines = contents.slice(0, -1).split("\n");
  let header: SessionHeader | undefined, state: SessionState | undefined, seq = 0;
  let interrupted = false, name: string | undefined, lastReason: ReadSessionResult["lastReason"], updatedAt = "";
  for (let index = 0; index < lines.length; index++) {
    try {
      const record = objectWithKeys(JSON.parse(lines[index]), ["version", "type", "sessionId"], index === 0
        ? ["createdAt", "cwd", "workspace"] : ["seq", "savedAt", "reason", "state", "name"]);
      if (record.version !== 1) throw new Error("不支持这个记录版本");
      if (record.sessionId !== id) throw new Error("会话 ID 不一致");
      if (index === 0) {
        objectWithKeys(record, ["version", "type", "sessionId", "createdAt", "cwd"], ["workspace"]);
        if (record.type !== "session" || !Number.isFinite(Date.parse(text(record.createdAt))) || !isAbsolute(text(record.cwd))) throw new Error("会话头无效");
        if (record.workspace !== undefined && !isAbsolute(text(record.workspace))) throw new Error("工作区路径无效");
        header = { version: 1, type: "session", sessionId: id, createdAt: record.createdAt as string, cwd: record.cwd as string,
          ...(record.workspace !== undefined ? { workspace: record.workspace as string } : {}) };
        updatedAt = header.createdAt;
        continue;
      }
      if (integer(record.seq, 1) !== seq + 1 || !Number.isFinite(Date.parse(text(record.savedAt)))) throw new Error("记录序号或时间无效");
      if (record.type === "name") {
        objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "name"]);
        name = validateSessionName(record.name);
      } else {
        objectWithKeys(record, ["version", "type", "sessionId", "seq", "savedAt", "reason", "state"]);
        if (record.type !== "checkpoint" || !["run_start", "run_end", "reset", "mode", "queue_change", "exit"].includes(record.reason as string)) throw new Error("未知检查点类型");
        const nextState = validateSessionState(record.state);
        if (state && (nextState.run < state.run || nextState.nextInputId < state.nextInputId)) throw new Error("会话计数不能倒退");
        state = nextState;
        lastReason = record.reason as ReadSessionResult["lastReason"];
        if (record.reason === "run_start") interrupted = true;
        if (record.reason === "run_end" || record.reason === "exit") interrupted = false;
      }
      updatedAt = record.savedAt as string;
      seq++;
    } catch {
      throw new UserFacingError(`会话第 ${index + 1} 行不是支持的完整记录（版本、字段、编号或工具配对有误），已停止读取，原文件未修改。`);
    }
  }
  const hasTrailingFragment = validBytes < bytes.length;
  const warnings = hasTrailingFragment ? ["末尾有未换行片段，已忽略该片段；前面的完整记录仍可查看，原文件未修改。"] : [];
  if (interrupted) warnings.push("最后启动的任务没有结束记录，可能已有未记录的操作；继续前请核对工作区和进程，不要直接重做工具。");
  return { header: header!, state, seq, warnings, interrupted, name, lastReason, validBytes, hasTrailingFragment, updatedAt };
}
```

</details>

## 运行验证

在仓库根目录选择本节快照：

```bash
npm run lesson:13.2
```

然后运行本章已有检查：

```bash
npm run check:13
```

[本章练习二](/content/chapter-13-session-persistence/EXERCISES.md?id=%E7%BB%83%E4%B9%A0%E4%BA%8C%E9%AA%8C%E8%AF%81%E8%BF%9E%E7%BB%AD%E6%9C%89%E6%95%88%E5%89%8D%E7%BC%80%E4%B8%8E%E4%B8%A5%E6%A0%BC%E6%A0%A1%E9%AA%8C)给出完整只读脚本。它在临时目录构造符合约定的 JSONL，并调用真实 `readSession()`：先放入负数检查，再追加未换行片段，确认仍返回前一完整状态、产生警告且源文件字节不变；随后把完整中间行改坏，确认读取拒绝，而不是跳到后面的记录。

脚本还把一个工具结果的 ID 换错、把版本改为 2，分别检查运行时校验。这样能区分“读到了文件”“JSON 能解析”和“记录关系符合约定”这三件事，不需要真实模型配合制造损坏。

## 本节完成后的 Agent

程序有了一个可独立调用的只读读取器：它能解释哪些完整记录符合本章格式，返回最后保存的状态，并明确报告未完成尾片。它不会跨过坏的完整行，也不会改写原文件。

这些数据还没有接入运行中的 Agent。下一节要先取得同一会话的独占写入权，再重新读取、装回状态并续写；恢复动作本身不会触发模型或旧工具。
