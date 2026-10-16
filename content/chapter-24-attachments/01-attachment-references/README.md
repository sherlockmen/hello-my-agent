# 24.1 把一份本地文本文件附到下一条消息

[第 24 章首页](/content/chapter-24-attachments/README.md) · [上一节：23.3 能力、错误与用量](/content/chapter-23-model-adapters/03-capabilities-errors/README.md) · [本章练习与答案](/content/chapter-24-attachments/EXERCISES.md)

## 问题

用户可以让模型调用 `read_file`，但有时已经知道要讨论哪份材料。例如，用户希望“根据这份需求文本，整理验收项”。如果只是把路径写进问题，模型收到的仍然只是路径字符串；它必须另外调用工具，才可能拿到文件内容。

本节增加显式附件：先执行 `/attach notes/requirements.txt`，再发送“整理这份材料的验收项”。程序把指定文件与这条用户消息关联，并在模型请求中加入经过检查的文本。模型不需要再猜测要读取哪个路径。

这里有一个重要区别：给消息登记附件，并不意味着可以永久相信该路径上的文件。在点击发送前，文件可能已被修改；保存会话时，也不应顺手把所有原始文件字节塞进历史 JSON。

## 解决方案

我们先保存**附件引用**：一份描述附件身份的小记录，包括编号、工作区相对路径、类型、字节数、内容摘要及状态。真正准备请求时，程序根据引用重新读取文件，确认内容仍与登记时相同，再把文本装入请求。

本节先支持有大小上限的 UTF-8 文本文件。`/attachments` 查看等待发送的附件，`/detach <id|all>` 撤下附件。登记失败会说明原因，不能留下一个看似可用的引用。

## 工作原理

### 一、待发送附件与会话消息有不同的生命周期

`/attach` 改变的是当前输入旁边的待发送列表。此时还没有用户任务，也没有模型请求。用户可以继续写问题，或者用 `/detach` 移除材料。

提交问题时，程序先核对待发送文件仍然存在、内容未变，并检查当前模型配置是否接纳这些附件。核心预检通过后，才收取引用、关联到本轮 user 消息并清空待发送列表。真正调用服务前仍会重新读取并核对摘要，因为预检后文件也可能继续变化。

两次核对之间的失败，留下的状态不同：

| 失败发生在哪里 | 问题与附件留下在哪里 | 用户下一步 |
| --- | --- | --- |
| 核心尚未收取输入 | 不写入这条用户历史，引用仍待发送。TUI 预检拒绝时草稿保留；若界面先清稿、随后核心预检失败，则在草稿仍为空时恢复原问题，已有新草稿不被覆盖。 | 撤下或重新登记材料，再提交问题。 |
| 已收取输入，请求前复读发现变化 | 这次服务请求尚未发出；错误收尾把该 user 消息、附件引用与本地中断说明写入历史。待发送列表已空，原问题不自动退回草稿。 | 重新 `/attach` 同一路径，取得新引用后重新发送问题；或撤下旧材料后继续。 |

第二种情况下，重新附加关联的是下一条新问题，不会替换旧消息中的材料身份。`/detach all` 会把本进程先前提交的引用改为 `reattach`，以后只发送说明，不再读取这些旧正文；重新 `/attach` 同一路径也会停用先前提交的引用，再登记新身份。这样我们能在历史保留来源关系的同时，明确撤下后续重发的材料。

关联关系说明“这次问题附了哪份材料”；它不把附件提升为系统指令。文件里即使写着“忽略之前的要求”，也仍然是用户提供的待分析内容。

如果输入只有“整理验收项”，附件记录才使程序知道需要同时提供 `notes/requirements.txt`。但模型最终看到的必须是内容：仅有一个 `path` 字段，远端模型无法访问我们的本地磁盘。

### 二、路径、类型和大小检查发生在读取边界

程序根据当前工作区解析相对路径，检查解析后的实际位置，避免把工作区外文件作为附件。随后检查文件类型、大小和 UTF-8 解码结果。扩展名能提示类型，却不能证明任意二进制字节都是文本，因此解码也需要明确成功。

本节每份文本最多 64 KiB，一条消息最多关联四份引用。读取失败、UTF-8 无效或登记后被修改时，程序说明原因，用户重新选择材料后再提交。

这些限制服务于一个具体承诺：本节发出的是一份完整、可解释的有界文本材料。过大的文件直接返回原因，不能静默截去尾部，再让模型把残缺内容当作全文。

例如，一份需求有十条验收条件，最后两条被截去，模型仍可能给出很有条理的八项总结。界面没有异常，却无法支撑用户想要的结果。因此超限应在请求前成为可见失败，下一步由用户缩小材料或换一份文件。

### 三、内容摘要防止“同一路径”冒充“同一份材料”

登记时，程序为文件字节计算 SHA-256 摘要。摘要是一段由内容计算出的标识；它不解释内容，只帮助程序比较两次读取是否相同。

```text
登记：requirements.txt，摘要 A
用户编辑文件
发送：requirements.txt，摘要 B
比较：A ≠ B → 停止这次材料化，提示重新附加
```

重新读取并转换成请求内容的过程叫**材料化**。把它放在发送前，意味着模型收到的是经过本次校验的内容。路径相同但字节变化时，程序不会悄悄替换用户当初选择的材料。

### 四、引用负责身份，临时内容负责发送

材料化取得的文本只用于构造本次请求；内存消息保留引用信息，不保存原始字节或 base64。本节先完成当前进程内的收发，现有会话存储还会省略附件字段。24.3 再扩展存储契约，把白名单引用写入存档；不能把本节的纯文字恢复误认为附件已经恢复。这样逐步建立的历史能记录附件身份，又不会因为一份大文件把每次保存都变成重复复制。

代价是恢复会话时必须处理文件状态。文件被删除、移动或修改之后，旧引用不能凭空恢复原内容。24.3 会专门讲恢复时如何解释这些情况；下一节先把相同引用机制扩展到截图。

<!-- media:lesson:start -->
下面故意选择第二个变化窗口：提交前预检通过后，问题和 ref_a 已进入历史；真正请求前文件变成 B，复读会拒绝且没有 HTTP，但不会把已提交输入自动退回草稿。静态图另列“核心尚未收取输入”的拒绝与空稿恢复规则。

<img src="./content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-cover-b18c4e2932.png" data-gif-src="./content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-4404bd1a05.gif" data-cover="./content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-cover-b18c4e2932.png" data-no-zoom alt="附件引用怎样证明这次选中的实际内容？">

[静态流程图](/content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-flow-7a288abfe3.png.md) · [静态封面](/content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-cover-b18c4e2932.png.md) · [查看完整静态分镜](/content/chapter-24-attachments/01-attachment-references/assets/attachment-reference-checks-storyboard-f7561a2b72.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/attachments/store.ts](/content/chapter-24-attachments/01-attachment-references/src/attachments/store.ts.md) | 登记有界 UTF-8 引用，预检后提交，请求前再次核对内容。 |
| CHANGED | [src/models/protocol.ts](/content/chapter-24-attachments/01-attachment-references/src/models/protocol.ts.md) | 把经核验的文本作为用户材料加入两种请求。 |
| CHANGED | [src/models/client.ts](/content/chapter-24-attachments/01-attachment-references/src/models/client.ts.md) | 用户消息关联引用，并在请求预算与适配器之间准备附件。 |
| CHANGED | [src/context/budget.ts](/content/chapter-24-attachments/01-attachment-references/src/context/budget.ts.md) | 把待发送文本材料纳入本地输入估算。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-24-attachments/01-attachment-references/src/agent/agent-loop.ts.md) | 预检成功才收取引用并写入用户历史。 |
| CHANGED | [src/ui/terminal.ts](/content/chapter-24-attachments/01-attachment-references/src/ui/terminal.ts.md) | 管理当前待发送附件与本地命令。 |
| CHANGED | [src/ui/tui/app.tsx](/content/chapter-24-attachments/01-attachment-references/src/ui/tui/app.tsx.md) | 独占预检；提交前失败保留引用，仅在空稿时恢复原问题。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md) 准备依赖、构建脚本与模型配置，再从上一公开小节 23.3 的完整 `src/` 继续。新增文件完整保存，修改文件按精确差异应用；未列出的实现沿用。下面差异以前面公开块累计形成的读者工作树为基线，不需要复制仓库内最终快照覆盖自己的实现。

<!-- generated:build:start -->

<details>
<summary>NEW：src/attachments/store.ts 的完整文件</summary>

<!-- source: src/attachments/store.ts -->
```ts
/**
 * 24.1 附件引用 | [NEW] attachments/store.ts
 *
 * 学习目标：把可发送附件与聊天文字分开，读取时固定来源与内容摘要。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：/attach -> 有界读取/校验 -> pending ref -> user消息 -> 请求前重新校验
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createIgnoreMatcher, findProjectRoot } from "../tools/workspace.js";
import { UserFacingError } from "../errors.js";
import type { Message } from "../models/client.js";

// [NEW 24.1] 登记有界 UTF-8 引用，预检后提交，请求前再次核对内容。
export const ATTACHMENT_LIMITS = { textBytes: 64 * 1024, imageBytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, count: 4, images: 2, edge: 4096, pixels: 16_777_216 } as const;
export type AttachmentRef = { id: string; path: string; mediaType: "text/plain" | "image/png" | "image/jpeg"; byteLength: number; sha256: string; status: "ready" | "missing" | "reattach" };
export type PreparedAttachment = { ref: AttachmentRef; text?: string; base64?: string };
export type AttachmentState = { readonly root: string; pending: AttachmentRef[]; command(text: string, signal: AbortSignal): Promise<{ ok: boolean; message: string }>; preflight(signal: AbortSignal, images: boolean): Promise<void>; take(): AttachmentRef[] };

/**
 * 用白名单重建可持久化引用；引用只描述本地来源，不含正文、base64 或绝对路径。
 * 严格拒绝未知字段、过量与重复 ID，避免恢复时把任意对象当成可读取文件。
 */
export function validateAttachmentRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value) || value.length > ATTACHMENT_LIMITS.count) throw new UserFacingError("附件列表超过限制。");
  const ids = new Set<string>();
  const refs = value.map((item): AttachmentRef => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new UserFacingError("附件引用格式无效。");
    const ref = item as Record<string, unknown>;
    if (Object.keys(ref).sort().join() !== ["id", "path", "mediaType", "byteLength", "sha256", "status"].sort().join()) throw new UserFacingError("附件引用字段无效。");
    if (typeof ref.id !== "string" || !/^[a-f0-9-]{36}$/.test(ref.id) || ids.has(ref.id)) throw new UserFacingError("附件编号无效。");
    ids.add(ref.id);
    if (typeof ref.path !== "string" || !validRelativePath(ref.path)) throw new UserFacingError("附件路径必须是项目内的相对路径。");
    if (ref.mediaType !== "text/plain" && ref.mediaType !== "image/png" && ref.mediaType !== "image/jpeg") throw new UserFacingError("附件类型不支持。");
    const max = ref.mediaType === "text/plain" ? ATTACHMENT_LIMITS.textBytes : ATTACHMENT_LIMITS.imageBytes;
    if (!Number.isSafeInteger(ref.byteLength) || (ref.byteLength as number) < 1 || (ref.byteLength as number) > max) throw new UserFacingError("附件大小无效。");
    if (typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || !["ready", "missing", "reattach"].includes(ref.status as string)) throw new UserFacingError("附件校验信息无效。");
    return { id: ref.id, path: ref.path, mediaType: ref.mediaType, byteLength: ref.byteLength as number, sha256: ref.sha256, status: ref.status as AttachmentRef["status"] };
  });
  if (refs.reduce((sum, ref) => sum + ref.byteLength, 0) > ATTACHMENT_LIMITS.totalBytes || refs.filter(ref => ref.mediaType !== "text/plain").length > ATTACHMENT_LIMITS.images) throw new UserFacingError("附件总量超过限制。");
  return refs;
}

/**
 * 相对路径不能回退、隐藏控制字符或使用平台相关反斜杠。
 * 真正的符号链接与忽略规则检查留在打开文件前执行。
 */
function validRelativePath(path: string): boolean {
  return !!path && path.length <= 400 && !isAbsolute(path) && !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part !== ".." && part !== "" && part !== ".");
}

/**
 * 读取一个有界普通文件并始终关闭句柄；真实路径仍须留在项目且不被忽略。
 * 本课程的路径检查不是操作系统沙箱；不支持并发恶意替换项目目录的进程隔离。
 */
async function readBytes(root: string, path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!validRelativePath(path)) throw new UserFacingError("附件路径必须是项目内的相对路径。");
  const realRoot = await realpath(root), target = await realpath(resolve(realRoot, path));
  const local = relative(realRoot, target).split(sep).join("/");
  if (!validRelativePath(local) || (await createIgnoreMatcher(realRoot)).ignores(path) || (await createIgnoreMatcher(realRoot)).ignores(local)) throw new UserFacingError("附件路径位于项目外或受保护、被忽略的范围。");
  const handle = await open(target, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > ATTACHMENT_LIMITS.imageBytes) throw new UserFacingError("附件必须是限制内的普通非空文件。");
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new UserFacingError("附件读取期间已变化，请重新 /attach。");
    signal.throwIfAborted();
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/**
 * 24.1 只接纳严格 UTF-8 文本；不靠扩展名把任意二进制伪装成文字。
 * 图片在后续协议节添加独立签名与尺寸检查，此处先完整拒绝。
 */
function describeBytes(bytes: Buffer, path: string): { mediaType: AttachmentRef["mediaType"]; text?: string } {
  if ([".png", ".jpg", ".jpeg"].includes(extname(path).toLowerCase())) throw new UserFacingError("本节只支持 UTF-8 文本附件。");
  if (bytes.length > ATTACHMENT_LIMITS.textBytes) throw new UserFacingError("文本附件超过 64 KiB。");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new UserFacingError("文本附件必须是有效 UTF-8。"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new UserFacingError("附件包含二进制或不支持的控制字符。");
  return { mediaType: "text/plain", text };
}

/**
 * 在加入待发送列表时读取并记录摘要；失败不改变旧列表。
 * 本地命令不构成用户消息，take 才把引用交给下一次普通输入。
 */
export function createAttachmentState(root = findProjectRoot()): AttachmentState {
  const submitted: AttachmentRef[] = [];
  const state: AttachmentState = { root, pending: [],
    async command(text, signal) {
      try {
        signal.throwIfAborted();
        if (text === "/attachments") return { ok: true, message: state.pending.length ? state.pending.map(ref => `${ref.id} ${ref.path} ${ref.mediaType} ${ref.byteLength} B`).join("\n") : "没有待发送附件。" };
        const detach = /^\/detach (all|[a-f0-9-]{36})$/.exec(text);
        if (detach) {
          if (detach[1] !== "all" && ![...state.pending, ...submitted].some(ref => ref.id === detach[1])) return { ok: false, message: "没有这个待发送附件。" };
          for (const ref of submitted) if (detach[1] === "all" || ref.id === detach[1]) ref.status = "reattach";
          state.pending = detach[1] === "all" ? [] : state.pending.filter(ref => ref.id !== detach[1]);
          return { ok: true, message: "已移除待发送附件引用。" };
        }
        const match = /^\/attach (.+)$/.exec(text);
        if (!match) return { ok: false, message: "用法：/attach <项目内相对路径>；/attachments；/detach <编号|all>。" };
        const path = match[1], bytes = await readBytes(root, path, signal), description = describeBytes(bytes, path);
        const ref: AttachmentRef = { id: randomUUID(), path, mediaType: description.mediaType, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), status: "ready" };
        const next = validateAttachmentRefs([...state.pending.filter(item => item.path !== path), ref]);
        signal.throwIfAborted();
        for (const previous of submitted) if (previous.path === path) previous.status = "reattach";
        state.pending = next;
        return { ok: true, message: `已加入待发送附件：${path}（${ref.mediaType}，${bytes.length} B）。下一条普通消息会关联这些引用。` };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        return { ok: false, message: error instanceof UserFacingError ? error.message : "附件无法读取；请核对项目路径、权限和文件是否存在。" };
      }
    },
    async preflight(signal, images) {
      await prepareAttachments([{ role: "user", content: "", attachments: state.pending }], signal, images, root);
    },
    take() { const refs = state.pending; state.pending = []; submitted.push(...refs); return refs; },
  };
  return state;
}

/**
 * 每次请求前重新打开引用并核对类型、长度与摘要；从磁盘取得本次实际发送的字节。
 * 非 ready 的旧引用只转成明确说明，不重发旧附件；验证失败时整次请求不发送。
 */
export async function prepareAttachments(messages: Message[], signal: AbortSignal, images: boolean, root = findProjectRoot()): Promise<Map<string, PreparedAttachment>> {
  const prepared = new Map<string, PreparedAttachment>();
  for (const message of messages) {
    if (message.role !== "user" || !message.attachments) continue;
    for (const ref of validateAttachmentRefs(message.attachments)) {
      signal.throwIfAborted();
      if (ref.status !== "ready") { prepared.set(ref.id, { ref, text: `[附件 ${ref.path} 状态为 ${ref.status}，未发送正文；用户需重新 /attach 才会发送。]` }); continue; }
      if (ref.mediaType !== "text/plain" && !images) throw new UserFacingError("当前模型未声明图片能力；请切换支持图片的配置或移除附件后重新提交。");
      const bytes = await readBytes(root, ref.path, signal), description = describeBytes(bytes, ref.path);
      if (description.mediaType !== ref.mediaType || bytes.length !== ref.byteLength || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) throw new UserFacingError(`附件 ${ref.path} 已变化，请重新 /attach 后提交。`);
      prepared.set(ref.id, { ref, ...(description.text !== undefined ? { text: `[附件 ${ref.path}]\n${description.text}` } : { base64: bytes.toString("base64") }) });
    }
  }
  return prepared;
}

/**
 * 恢复只核对来源可用性，永不把历史 ready 状态当作重新发送授权。
 * 可用且内容一致标记 reattach；缺失、损坏、变更或越界标记 missing，继续恢复其他文字。
 */
export async function restoreAttachmentStatuses(messages: Message[], root: string): Promise<number> {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "user" || !message.attachments) continue;
    for (const ref of message.attachments) {
      count += 1;
      try {
        const bytes = await readBytes(root, ref.path, new AbortController().signal), description = describeBytes(bytes, ref.path);
        ref.status = description.mediaType === ref.mediaType && bytes.length === ref.byteLength && createHash("sha256").update(bytes).digest("hex") === ref.sha256 ? "reattach" : "missing";
      } catch { ref.status = "missing"; }
    }
  }
  return count;
}
```

</details>

<details>
<summary>CHANGED：src/models/protocol.ts 的精确差异</summary>

<!-- source: src/models/protocol.ts -->
```diff
--- a/src/models/protocol.ts
+++ b/src/models/protocol.ts
@@ -1,5 +1,5 @@
 /**
- * 23.3 能力与错误 | [CHANGED] models/protocol.ts
+ * 24.1 附件引用 | [CHANGED] models/protocol.ts
  *
  * 学习目标：把协议差异留在一个出口；核心只看统一消息与完整结果。
  * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
@@ -7,6 +7,8 @@
  * 本文件局部流程：统一消息/工具 -> SDK流 -> 完整性检查 -> ModelResult
  * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
  */
+import { prepareAttachments, type PreparedAttachment } from "../attachments/store.js";
+import { findProjectRoot } from "../tools/workspace.js";
 import OpenAI from "openai";
 import Anthropic from "@anthropic-ai/sdk";
 import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
@@ -32,7 +34,9 @@
  * generate 统一接收消息、工具、提示和预算；完整参数校验仍在协议响应出口完成。
  * 创建对象不发送请求；SDK 禁止自动重试，取消由调用方传入。
  */
+// [CHANGED 24.1] 把经核验的文本作为用户材料加入两种请求。
 export function createProtocolAdapter(config: Config): ProtocolAdapter {
+  const workspaceRoot = findProjectRoot();
   const options = { apiKey: config.apiKey, baseURL: config.baseURL, timeout: 60_000, maxRetries: 0, logLevel: "off" as const };
   const client = config.provider === "openai"
     ? new OpenAI({ ...options, organization: null, project: null })
@@ -40,11 +44,11 @@
   const profile: ModelProfile = { provider: config.provider, model: config.model,
     capabilities: { tools: true, streaming: true, images: config.imageInput === true, cacheUsage: "reported-only" } };
   return { profile,
-    generate: (messages, signal, onText, request) => requestResult(observeRequestStart(client, request.onRequestStart), config.model, messages, signal, onText, request.limits, request.prompt, request.definitions),
+    generate: (messages, signal, onText, request) => requestResult(observeRequestStart(client, request.onRequestStart), config.model, messages, signal, onText, request.limits, request.prompt, request.definitions, workspaceRoot, profile.capabilities.images),
     summarize: (source, signal, reserve, onRequestStart) => requestSummary(observeRequestStart(client, onRequestStart), config.model, source, signal, reserve),
   };
 }
-// [CHANGED 23.3] 每次请求单独观察 fetch；预算、附件材料化和 SDK 本地构建失败不算已发送。
+// [KEEP 来自 23.3] 每次请求单独观察 fetch；预算、附件材料化和 SDK 本地构建失败不算已发送。
 function observeRequestStart(client: OpenAI | Anthropic, onRequestStart?: () => void): OpenAI | Anthropic {
   if (!onRequestStart) return client;
   return client.withOptions({ fetch: (input, init) => {
@@ -135,9 +139,9 @@
  * - 关键步骤：工具结果转换成 `role=tool`，助手工具请求转换成 `tool_calls`。
  * - 职责边界：只转换内存数据，不发送请求，也不执行工具。
  */
-function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
+export function toOpenAIMessages(messages: Message[], prepared: Map<string, PreparedAttachment> = new Map()): ChatCompletionMessageParam[] {
   return messages.map((message) => {
-    if (message.role === "user") return message;
+    if (message.role === "user") return { role: "user", content: [message.content, ...(message.attachments ?? []).map(ref => prepared.get(ref.id)?.text ?? `[附件 ${ref.path} 未提供正文]`)].join("\n\n") };
     if (message.role === "tool") {
       return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
     }
@@ -162,7 +166,7 @@
  * - 失败方式：已保存的工具参数不是有效 JSON 时，`JSON.parse()` 会抛错并停止请求。
  * - 职责边界：只转换内存数据，不发送请求，也不执行工具。
  */
-function toAnthropicMessages(messages: Message[]): MessageParam[] {
+export function toAnthropicMessages(messages: Message[], prepared: Map<string, PreparedAttachment> = new Map()): MessageParam[] {
   const converted: MessageParam[] = [];
   for (let index = 0; index < messages.length;) {
     const message = messages[index];
@@ -184,7 +188,7 @@
       continue;
     }
     if (message.role === "user") {
-      converted.push(message);
+      converted.push({ role: "user", content: [message.content, ...(message.attachments ?? []).map(ref => prepared.get(ref.id)?.text ?? `[附件 ${ref.path} 未提供正文]`)].join("\n\n") });
       index += 1;
       continue;
     }
@@ -210,7 +214,6 @@
  * - 职责边界：length、refusal 等结束原因交给 Agent Loop 报告；这里不批准工具，也不提交历史。
  */
 // [KEEP 来自 08.2] 片段用于显示，完整响应才进入统一结果。
-// [CHANGED 23.3] 转换已报告的缓存字段，缺失用量保持未知。
 async function requestResult(
   client: OpenAI | Anthropic, model: string, messages: Message[], signal: AbortSignal,
   onText: ((text: string) => void) | undefined,
@@ -218,13 +221,15 @@
   limits: ContextLimits,
   prompt: string,
   definitions: ToolDefinition[],
+  workspaceRoot: string, images: boolean,
 ): Promise<ModelResult> {
+  const prepared = await prepareAttachments(messages, signal, images, workspaceRoot);
   // [KEEP 来自 21.1] 发送定义与预算检查使用同一个可信列表。
   if (client instanceof OpenAI) {
     // [KEEP 来自 08.1] SDK 解析 SSE 并累积完整响应，content.delta 用来及时显示新文字。
     const stream = client.chat.completions.stream({
       model,
-      messages: [{ role: "system", content: prompt }, ...toOpenAIMessages(messages)],
+      messages: [{ role: "system", content: prompt }, ...toOpenAIMessages(messages, prepared)],
       tools: definitions.map((tool) => ({
         type: "function" as const,
         function: {
@@ -261,7 +266,7 @@
 
   // [KEEP 来自 08.2] Anthropic 的文字和工具参数分开接收；SDK 负责 SSE 与完整消息聚合。
   const stream = client.messages.stream({
-    model, system: prompt, messages: toAnthropicMessages(messages),
+    model, system: prompt, messages: toAnthropicMessages(messages, prepared),
     tools: definitions.map((tool) => ({
       name: tool.name, description: tool.description, input_schema: tool.inputSchema,
     })),
```

</details>

<details>
<summary>CHANGED：src/models/client.ts 的精确差异</summary>

<!-- source: src/models/client.ts -->
```diff
--- a/src/models/client.ts
+++ b/src/models/client.ts
@@ -1,5 +1,5 @@
 /**
- * 23.3 能力与错误 | [CHANGED] models/client.ts
+ * 24.1 附件引用 | [CHANGED] models/client.ts
  *
  * 学习目标：每次估算和请求使用相同来源编号提示及工具定义；URL与正文保留在工具消息中，提示不复制网页正文。
  * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
@@ -38,6 +38,7 @@
 import type { MemoryController } from "../memory/commands.js";
 // [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
 import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
+import { createAttachmentState, type AttachmentRef, type AttachmentState } from "../attachments/store.js";
 import { safeModelError } from "./model-errors.js";
 import { createProtocolAdapter, SUMMARY_PROMPT, type ModelProfile } from "./protocol.js";
 import { readConfig, systemPrompt, type Config } from "../config/load-config.js";
@@ -53,12 +54,12 @@
 import { DEFAULT_CONTEXT_LIMITS, estimateContext, estimateCostUsd, type ContextBudget, type ContextLimits } from "../context/budget.js";
 
 // [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
+// [CHANGED 24.1] 用户消息关联引用，并在请求预算与适配器之间准备附件。
 export type Message =
-  | { role: "user"; content: string }
+  | { role: "user"; content: string; attachments?: AttachmentRef[] }
   | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
   | { role: "tool"; toolCallId: string; content: string; isError: boolean };
 
-// [CHANGED 23.3] 区分用户取消与服务错误，不透出远端原始错误。
 export type Reply = {
   text: string;
   inputTokens: number | null;
@@ -72,7 +73,7 @@
 // [KEEP 来自 08.2] 完整结果同时携带结束原因，主循环据此决定是否继续。
 export type ModelResult = Reply & { toolCalls: ToolCall[]; finishReason: ModelFinishReason };
 
-// [CHANGED 23.3] 只记录请求异常的本地边界，不改错误对象或 Model 接口；旧测试模型未标记时保守视为可能已发送。
+// [KEEP 来自 23.3] 只记录请求异常的本地边界，不改错误对象或 Model 接口；旧测试模型未标记时保守视为可能已发送。
 const failedRequestStarts = new WeakMap<object, boolean>();
 export function requestFailedBeforeSending(error: unknown): boolean {
   return typeof error === "object" && error !== null && failedRequestStarts.get(error) === false;
@@ -96,6 +97,7 @@
   // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
   // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
   // [KEEP 来自 22.1] 网页启用只来自本次启动。
+  readonly attachments?: AttachmentState;
   readonly profile?: ModelProfile;
   beginRun?(): () => void;
   command?(text: string): { ok: boolean; message: string };
@@ -134,6 +136,7 @@
   // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
   const projectPrompt = project ? projectInstructionPrompt(project) : "";
   const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
+  const attachments = createAttachmentState();
   let adapter = createProtocolAdapter(config);
   let activeRequests = 0;
   // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
@@ -144,7 +147,7 @@
   return {
     // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
     // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
-    memory, skills, hooks, mcp, web,
+    memory, skills, hooks, mcp, web, attachments,
     get profile() { return structuredClone(adapter.profile); },
     beginRun() {
       activeRequests += 1; let released = false;
```

</details>

<details>
<summary>CHANGED：src/context/budget.ts 的精确差异</summary>

<!-- source: src/context/budget.ts -->
```diff
--- a/src/context/budget.ts
+++ b/src/context/budget.ts
@@ -1,5 +1,5 @@
 /**
- * 19.3 模型选择与资源读取 | [KEEP] context/budget.ts
+ * 24.1 附件引用 | [CHANGED] context/budget.ts
  *
  * 学习目标：区分发出前的本地估算、服务商返回的用量和按配置价格计算的费用估计。
  * 输入：准备发送的系统提示、工具定义、消息，以及本地选择的窗口和输出预留。
@@ -43,10 +43,11 @@
  * 工具定义含名称、说明、参数 Schema；额外 32 代表协议开销的近似，不是精确协议计费。
  * withinBudget 只比较本地数字，服务商仍可能按自己的窗口和切分拒绝请求。
  */
+// [CHANGED 24.1] 把待发送文本材料纳入本地输入估算。
 export function estimateContext(messages: Message[], prompt: string, definitions: unknown[], limits: ContextLimits): ContextBudget {
   const systemEstimate = estimateTextTokens(prompt) + 8;
   const toolsEstimate = estimateTextTokens(JSON.stringify(definitions)) + 16;
-  const messagesEstimate = messages.reduce((sum, message) => sum + estimateTextTokens(JSON.stringify(message)) + 8, 0) + 32;
+  const messagesEstimate = messages.reduce((sum, message) => sum + estimateTextTokens(JSON.stringify(message)) + 8 + (message.role === "user" ? (message.attachments ?? []).filter(ref => ref.status === "ready").reduce((sum, ref) => sum + (ref.mediaType === "text/plain" ? Math.ceil(ref.byteLength / 3) : 8192), 0) : 0), 0) + 32;
   const inputEstimate = systemEstimate + toolsEstimate + messagesEstimate;
   const remainingEstimate = limits.windowTokens - limits.outputReserve - inputEstimate;
   return { inputEstimate, systemEstimate, toolsEstimate, messagesEstimate, windowTokens: limits.windowTokens,
```

</details>

<details>
<summary>CHANGED：src/agent/agent-loop.ts 的精确差异</summary>

<!-- source: src/agent/agent-loop.ts -->
```diff
--- a/src/agent/agent-loop.ts
+++ b/src/agent/agent-loop.ts
@@ -1,5 +1,5 @@
 /**
- * 23.3 能力与错误 | [CHANGED] agent/agent-loop.ts
+ * 24.1 附件引用 | [CHANGED] agent/agent-loop.ts
  *
  * 学习目标：保持网页结果回原调用的流程，并在最终回答后核对来源编号；本地反馈不自动制造新一轮模型请求。
  * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
@@ -146,7 +146,6 @@
  * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
  */
 // [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
-// [CHANGED 23.3] 摘要与常规请求一同累计用量，任一未知保持未知。
 export async function agentLoop(
   model: Model,
   history: Message[],
@@ -161,6 +160,9 @@
 ): Promise<Reply> {
   signal.throwIfAborted();
   const releaseRun = model.beginRun?.();
+  // [CHANGED 24.1] 验证失败尚未提交 user 消息，也不取走 pending；结束时释放切换锁。
+  try { await model.attachments?.preflight(signal, model.profile?.capabilities.images === true); }
+  catch (error) { releaseRun?.(); throw error; }
   // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
   const mode = options.mode ?? "execute";
   // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
@@ -169,12 +171,13 @@
   // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
   // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
   const toolOptions: RunOptions = { ...options, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
-  const turn: Message[] = [{ role: "user", content: input }];
+  const attachments = model.attachments?.take();
+  const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
   let inputTokens: number | null = 0;
   let outputTokens: number | null = 0;
   let truncated = false;
   let cachedInputTokens: number | null = 0, cacheWriteTokens: number | null = 0;
-  // [CHANGED 23.3] 已发送但未收齐结果时，累计值不能继续冒充整轮总量；未发送的预检拒绝保留旧值。
+  // [KEEP 来自 23.3] 已发送但未收齐结果时，累计值不能继续冒充整轮总量；未发送的预检拒绝保留旧值。
   const incompleteUsage = (call: number, error: unknown) => {
     if (requestFailedBeforeSending(error)) return;
     inputTokens = outputTokens = cachedInputTokens = cacheWriteTokens = null;
```

</details>

<details>
<summary>CHANGED：src/ui/terminal.ts 的精确差异</summary>

<!-- source: src/ui/terminal.ts -->
```diff
--- a/src/ui/terminal.ts
+++ b/src/ui/terminal.ts
@@ -1,5 +1,5 @@
 /**
- * 23.2 空闲切换模型 | [CHANGED] ui/terminal.ts
+ * 24.1 附件引用 | [CHANGED] ui/terminal.ts
  *
  * 学习目标：消费同一任务事件，显示模型正文，并在结束后补打新增的本地反馈。
  * 输入：用户输入、本地命令、AgentRecord 记录流，以及 Ctrl+C / SIGINT / SIGTERM / SIGHUP。
@@ -259,7 +259,7 @@
 // [KEEP 来自 08.3] controller 属于当前回合，终端与历史属于整个会话。
 // [KEEP 来自 09.3] 输入提示与本地交互输出使用 stderr。
 // [KEEP 来自 13.1] writer 由 CLI 管理；可选参数方便离线调用，不改变模型接口。
-// [CHANGED 23.2] 接收本地 /model 命令并展示结果。
+// [CHANGED 24.1] 管理当前待发送附件与本地命令。
 export async function startTerminal(model: Model, options: RunOptions = {}, writer?: SessionWriter, initial?: SessionState): Promise<void> {
   // [KEEP 来自 13.3] 只恢复白名单数据；控制器和授权仍由这次进程新建。
   const history: Message[] = structuredClone([...(initial?.messages ?? [])]);
@@ -330,6 +330,13 @@
       if (!text) continue;
       if (text === "/exit") break;
       if (/^\/model(?:\s|$)/.test(text)) { console.error(screenText(model.command?.(text).message ?? "当前模型不支持本地切换。")); continue; }
+      if (/^\/(attach|attachments|detach)(?:\s|$)/.test(text)) {
+        active = new AbortController();
+        try { console.error(screenText((await model.attachments?.command(text, active.signal))?.message ?? "当前模型未连接附件状态。")); }
+        catch (error) { console.error(active.signal.aborted ? "附件读取已取消，原待发送引用保留。" : screenText(explainError(error))); }
+        finally { active = undefined; }
+        continue;
+      }
       // [KEEP 来自 19.2] 加载时 Ctrl+C 只取消本地读取，finally 后才接下一行。
       if (/^\/(skills|skill)(?:\s|$)/.test(text)) {
         active = new AbortController();
```

</details>

<details>
<summary>CHANGED：src/ui/tui/app.tsx 的精确差异</summary>

<!-- source: src/ui/tui/app.tsx -->
```diff
--- a/src/ui/tui/app.tsx
+++ b/src/ui/tui/app.tsx
@@ -1,5 +1,5 @@
 /**
- * 23.2 空闲切换模型 | [CHANGED] ui/tui/app.tsx
+ * 24.1 附件引用 | [CHANGED] ui/tui/app.tsx
  *
  * 学习目标：显示模型的加载与资源结果；本地命令、审批、任务取消保持各自入口。
  * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
@@ -178,7 +178,6 @@
  */
 // [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
 // [KEEP 来自 12.5] 界面接入本节操作；具体状态和按键变化在对应分支标明。
-// [CHANGED 23.2] 切换成功才收取命令，忙或失败时保留原稿。
 function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
   // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
   const [draft, setDraft] = useState(newDraft());
@@ -294,6 +293,19 @@
     // 本地命令只改本地会话；它们不作为 user 消息送给模型。
     if (prompt === "/exit") { quit(0); return; }
     if (/^\/model(?:\s|$)/.test(prompt)) { const result = model.command?.(prompt); append("本地", result?.message ?? "当前模型不支持本地切换。"); if (!result?.ok) setDraft(draft); return; }
+    if (/^\/(attach|attachments|detach)(?:\s|$)/.test(prompt)) {
+      const controller = new AbortController();
+      session.controller = controller; session.clearing = true; setNotice("正在检查附件，Ctrl+C 可取消…");
+      setDraft(draft);
+      session.done = (async () => {
+        try {
+          const result = await model.attachments?.command(prompt, controller.signal);
+          if (!session.closing) { append("本地", result?.message ?? "当前模型未连接附件状态。"); if (result?.ok) setDraft(newDraft()); }
+        } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件读取已取消，原稿与待发送引用保留。" : explainError(error)); }
+        finally { session.controller = undefined; session.done = undefined; session.clearing = false; if (!session.closing) setNotice("附件操作已结束；/attachments 可核对待发送列表。"); }
+      })();
+      return;
+    }
     // [KEEP 来自 19.2] 本地加载拥有独立取消控制器；退出等待读取句柄关闭，不产生用户消息。
     if (/^\/(skills|skill)(?:\s|$)/.test(prompt)) {
       const controller = new AbortController();
@@ -350,6 +362,7 @@
       if (mode === "plan" || mode === "execute") void checkpoint("mode");
       return;
     }
+    setDraft(draft);
     startRun(prompt);
   };
 
@@ -357,7 +370,7 @@
    * 识别必须在空闲时本地处理的命令。
    * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
    */
-  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
+  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode|model|attach|attachments|detach|changes|restore|memory|skills|skill)(?:\s|$)/.test(text);
   /**
    * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
    * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
@@ -379,7 +392,6 @@
     // [KEEP 来自 12.4] 等待期间若已退出，停止发送已保存的新要求。
     if (session.closing) return;
     session.clearing = false;
-    setDraft(newDraft());
     startRun(prompt);
   };
 
@@ -390,6 +402,31 @@
    * finally 等流清理后解除忙碌、保存显示结果，并提示未收取补充仍保留。
    */
   const startRun = (prompt: string, queuedId?: number) => {
+    if (session.closing || session.external || session.clearing || session.done) return;
+    if (!model.attachments?.pending.length) {
+      if (queuedId === undefined) setDraft(newDraft());
+      startPreparedRun(prompt, queuedId); return;
+    }
+    const controller = new AbortController();
+    session.controller = controller; session.clearing = true; setNotice("正在预检待发送附件，Ctrl+C 可取消…");
+    session.done = (async () => {
+      let accepted = false;
+      try {
+        await model.attachments?.preflight(controller.signal, model.profile?.capabilities.images === true);
+        controller.signal.throwIfAborted(); accepted = true;
+      } catch (error) { if (!session.closing) append("本地", controller.signal.aborted ? "附件预检已取消；原稿与待发送引用保留。" : explainError(error)); }
+      finally { session.controller = undefined; session.done = undefined; session.clearing = false; }
+      if (!accepted || session.closing) return;
+      if (queuedId === undefined) setDraft(newDraft());
+      setNotice(""); startPreparedRun(prompt, queuedId);
+    })();
+  };
+
+  /**
+   * 预检已经通过才提交问题；SDK 请求仍会重新读取和核对实际发送字节。
+   * 这里继续复用原队列、取消、会话保存与审批流程，不在失败回调覆盖用户新输入。
+   */
+  const startPreparedRun = (prompt: string, queuedId?: number) => {
     if (session.closing || session.external || session.clearing || session.done) return;
     session.prompts = [...session.prompts, prompt].slice(-100);
     append("你", prompt);
@@ -437,6 +474,10 @@
       } finally {
         // [KEEP 来自 13.3] 重发文字进入历史后才移出旧队列；开始前失败则保留，避免丢失已保存文字。
         const committed = session.history[historyLength];
+        // [CHANGED 24.1] 提交前失败时取回清掉的原稿；用户已写的新草稿不能被覆盖。
+        if (queuedId === undefined && !session.closing && !(committed?.role === "user" && committed.content === prompt)) {
+          setDraft((currentDraft) => currentDraft.text ? currentDraft : newDraft(prompt));
+        }
         if (queuedId !== undefined && committed?.role === "user" && committed.content === prompt
           && session.queue.items.find((item) => item.id === queuedId)?.text === prompt) {
           removeQueuedInput(session.queue, queuedId);
```

</details>

<!-- generated:build:end -->

## 运行验证

先从仓库根编译本节完整快照：

```bash
npm run lesson:24.1
```

再按照 [本章完整答案](/content/chapter-24-attachments/EXERCISES.md?id=%E6%9E%84%E5%BB%BA%E4%B8%8E%E8%BF%90%E8%A1%8C) 的“单独编译练习”步骤，准备 `ATTACHMENT_EXERCISE`。本节只运行第 1 组，运行命令与上面的构建命令分开：

```bash
node "$ATTACHMENT_EXERCISE/verify-attachments.js" 1
```

输出“通过一”说明登记失败与发送前内容变化都保留待发送引用，实际材料化得到原始文本，取消不继续读取。可在交互入口先 /attach 一份 UTF-8 文件、再修改它，观察提交被拒绝后草稿仍在；重新附加或撤下后再发送。

需要观察交互入口时，在同一份编译结果上另行运行：

```bash
node dist/cli.js --output tui
```

## 本节完成后的 Agent

现在，用户明确选定的 UTF-8 材料经预检、引用关联与发送前核验进入请求。下一节扩展到图片，并由协议适配器生成对应内容块。

本节状态：待用户确认。
