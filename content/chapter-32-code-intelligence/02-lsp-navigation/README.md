# 32.2 用语言服务定位符号

[上一节：把检查结果交回模型](/content/chapter-32-code-intelligence/01-project-checks/README.md) · [本章首页](/content/chapter-32-code-intelligence/README.md) · [下一节：只报告当前文件的诊断](/content/chapter-32-code-intelligence/03-current-diagnostics/README.md)

## 同名文字不一定是同一个符号

假设两个模块都导出了 `parse`，一个解析配置，一个解析消息。grep能找到每一处parse文字，却无法仅凭文字判断某个调用经过import实际指向哪个声明。给模型更多匹配行，也没有自动获得编译器的模块解析和作用域信息。

我们增加 `code_intelligence`，让模型提交文件、行、列以及 `definition` 或 `references` 动作。位置使用从1开始的行列，便于和read_file的输出对照；列按JavaScript字符串的UTF-16单元计数。工具把位置转换成LSP从0开始的位置，再把结果转回从1开始的项目相对路径与行列。

定义回答“这个位置绑定哪个声明”，引用回答“服务器在当前项目理解中发现哪些使用处”。结果仍是可继续阅读的坐标。模型应使用read_file打开目标附近的代码，结合检查结果判断，不能仅凭一个坐标宣称已经理解整个调用链。

## 模型、客户端、语言服务器分别做什么

模型负责选择问题与位置。本地 `LanguageService` 负责进程、文档与消息编号。真正分析TypeScript/JavaScript的是tsserver，`typescript-language-server`把它的能力包装为LSP。LSP在这里约定通信消息，不负责执行模型，也不是类型检查算法。[服务器官方说明](https://github.com/typescript-language-server/typescript-language-server/tree/v5.1.3#what-is-it-exactly)

客户端第一次查询才启动已安装的服务器，使用当前Node执行固定的CLI文件，随后发送initialize，声明根目录、UTF-16位置及支持的只读能力。收到初始化响应以后才发送initialized和didOpen，再请求definition或references。我们显式指定课程安装的TypeScript后端，不让模型提供可执行文件或插件参数。

初始化还把 `tsserver.useSyntaxServer` 设为 `"never"`：默认auto会另外启动轻量语法服务，让项目尚在加载时先回答部分问题；本章用一个完整服务处理查询，等待它建立模块和类型关系。在本章跨模块示例中，这避免首次定义查询只停在import别名。这个设置控制服务分工，不能代替请求超时与失败处理。[该版本配置说明](https://github.com/typescript-language-server/typescript-language-server/blob/v5.1.3/docs/configuration.md#tsserver-options)

本节每次查询都先关闭旧的文档视图，再打开刚从磁盘读取的文本；下一节会改成保留文档版本并发送didChange。这样本节可以先看清“先告诉服务它分析什么，再询问符号”的顺序。客户端没有TUI编辑缓冲区，分析的是磁盘上读取到的文件。

## 一根管道为什么需要长度和请求编号

stdin/stdout是字节流。一次data事件可能只有半个JSON，也可能同时含两条消息，不能用“收到一块就JSON.parse”来拆包。客户端先找到头部的空行，读取Content-Length，再等到足够多的UTF-8字节，取出一条JSON，剩下的字节留给下一轮。长度是字节数，中文占用多个UTF-8字节，不能使用字符串length替代。[LSP基础协议原文](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/specification.md#base-protocol)

发请求前，客户端先把递增id和本地等待者放进pending表；响应带着同一id回来，才能完成对应Promise。通知没有id，不应拿来完成请求。服务器可能夹着发送日志或诊断通知，这些消息不会顶替定义查询的响应。

客户端只实现本章需要的协议子集。服务器请求应用编辑时，客户端拒绝；未实现的服务器请求返回方法不存在。文件写入继续走已有的write_file/edit_file审批通道。协议解析设有大小上限，未知消息不变成工具动作。

## 结果怎样回到Agent，以及出错时怎样退出

`createModel`为一次CLI会话持有一个LanguageService，但构造时不启动进程。Agent Loop把它放进RunOptions，注册表把模型工具调用转交给它。工具结果包含坐标与源文件摘要，随后照常保存日志、成为工具消息；text、JSONL和TUI继续使用原有工具事件展示结果。

客户端串行处理语言服务查询，避免两个调用交叉更新同一文档。每次请求有总期限。启动失败、协议错误或服务退出会拒绝等待者并清理进程；模型收到的是服务错误，可以改用glob、grep、read_file，或提出本节继承的check_project。客户端不把没有取得的响应填成空数组。

用户取消沿现有AbortSignal传入；客户端结束服务资源后把取消抛回整轮任务。CLI退出也会关闭自己创建的服务。这个本地进程与MCP、后台作业分别拥有生命周期，不复用模型返回的PID。

<!-- media:lesson:start -->
同一个 amount 使用位置经过坐标转换、LSP 请求编号和工具结果，回到模型的下一次决定。

<img src="./content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-cover-0aece0bcef.png" data-gif-src="./content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-d9581e6574.gif" data-cover="./content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-cover-0aece0bcef.png" data-no-zoom alt="同名符号，怎样查到真正的定义位置？">

[静态流程图](/content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-flow-21d2e3b037.png.md) · [静态封面](/content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-cover-0aece0bcef.png.md) · [查看完整静态分镜](/content/chapter-32-code-intelligence/02-lsp-navigation/assets/lsp-location-roundtrip-storyboard-d51f6098d5.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| NEW | [src/language-service/client.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/language-service/client.ts.md) | 真实stdio LSP、消息拆包、初始化和符号查询。 |
| NEW | [src/tools/code-intelligence.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/code-intelligence.ts.md) | 参数校验、结构化只读结果。 |
| NEW | [src/code-command.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/code-command.ts.md) | 无需模型密钥的本地查询入口。 |
| CHANGED | [src/tools/registry.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/registry.ts.md) | 登记并分发语言服务工具。 |
| CHANGED | [src/tools/types.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/types.ts.md) | 增加语言服务结果元数据。 |
| CHANGED | [src/permissions/policy.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/permissions/policy.ts.md) | 按文件路径检查只读查询范围。 |
| CHANGED | [src/models/client.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/models/client.ts.md) | 会话持有客户端；Plan可查询符号。 |
| CHANGED | [src/agent/run-options.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/agent/run-options.ts.md) | 传递本地客户端引用。 |
| CHANGED | [src/agent/agent-loop.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/agent/agent-loop.ts.md) | 为工具执行绑定同一客户端。 |
| CHANGED | [src/cli.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/cli.ts.md) | 在密钥加载前处理本地查询，退出时关闭服务。 |

## 动手构建

以上一节的完整源码为起点，保留未列入本节变更表的文件。按下面路径保存完整内容，每份文件都位于本节自己的 `src/` 中。

### src/language-service/client.ts

目标文件：[src/language-service/client.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/language-service/client.ts.md)。

<!-- build-file: src/language-service/client.ts -->
<details>
<summary>src/language-service/client.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [NEW] language-service/client.ts
 * 输入：本地根目录、固定读动作、目标源码和取消；输出：真正tsserver的符号位置。
 * 状态：首次查询启动；错误/取消结束拥有的进程组；后续独立查询重新初始化。
 * 查询 -> 安全读文件 -> initialize -> didOpen -> request(id) -> response(id) -> 结果
 *                   |                              | 超时/崩溃/取消
 *                   +-- 非法路径 -> 错误            +-> 清理 -> 工具错误/整轮取消
 * stdout按UTF-8字节长度拆包；服务器编辑请求始终拒绝，不产生文件写入授权。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolError } from "../errors.js";
import { createIgnoreMatcher, findProjectRoot } from "../tools/workspace.js";

export type CodeAction = "definition" | "references";
export type CodeLocation = { path: string; line: number; column: number };
export type CodeResult = { path: string; version: number; sha256: string; action: CodeAction; locations: CodeLocation[]; truncated: boolean };
export type LanguageServiceOptions = { root?: string; command?: string; args?: string[]; timeoutMs?: number };
type Document = { text: string; version: number };
type Waiter = { resolve(value: unknown): void; reject(reason: unknown): void };
type Session = { child: ChildProcessWithoutNullStreams; closed: Promise<void>; exited: boolean; poisoned: boolean; buffer: Buffer;
  pending: Map<number, Waiter>; sequence: number; documents: Map<string, Document> };
const require = createRequire(import.meta.url), MAX_BYTES = 8 * 1024 * 1024;

/** 只接受非空对象，协议消息与模型输入都不能凭类型断言直接信任。 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("语言服务响应不是对象。");
  return value as Record<string, unknown>;
}

/** 读动作的会话拥有者；创建时不启动进程，查询串行，close后不再启动。 */
export class LanguageService {
  private session?: Session;
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private stopping?: Promise<void>;
  constructor(private readonly options: LanguageServiceOptions = {}) {
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30_000)) throw new ToolError("语言服务期限必须是100—30000毫秒。");
  }

  /** 串行进入查询；失败不会毒化队列，用户取消原样向任务外传播。 */
  query(action: CodeAction, path: string, line: number | undefined, column: number | undefined, signal: AbortSignal): Promise<CodeResult> {
    const result = this.tail.then(() => this.run(action, path, line, column, signal));
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** 对本次实际执行设总期限；失败先等待进程清理，再把错误交回工具循环。 */
  private async run(action: CodeAction, path: string, line: number | undefined, column: number | undefined, signal: AbortSignal): Promise<CodeResult> {
    signal.throwIfAborted();
    if (this.closing) throw new ToolError("语言服务已经关闭。");
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new ToolError("语言服务超时；已结束本次服务，可改用grep/read_file或批准check_project，下次查询将重新启动。")), this.options.timeoutMs ?? 15_000);
    const combined = AbortSignal.any([signal, deadline.signal]);
    let abort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(combined.reason);
      combined.addEventListener("abort", abort, { once: true });
      if (combined.aborted) abort();
    });
    try { return await Promise.race([this.perform(action, path, line, column, combined), interrupted]); }
    catch (error) {
      await this.stop();
      signal.throwIfAborted();
      if (error instanceof ToolError) throw error;
      throw new ToolError(`语言服务失败：${error instanceof Error ? error.message : String(error)}。可使用grep/read_file或批准check_project。`);
    } finally { clearTimeout(timer); combined.removeEventListener("abort", abort); }
  }

  /** 真实路径、忽略规则和大小共同约束目标；不宣称限制服务器内部的所有读取。 */
  private async source(path: string) {
    const root = await realpath(this.options.root ?? findProjectRoot());
    if (!path || isAbsolute(path) || win32.isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) throw new ToolError("语言服务只接受项目内相对源码路径。");
    const absolute = await realpath(resolve(root, path));
    const name = relative(root, absolute).split(sep).join("/");
    if (!name || name === ".." || name.startsWith("../") || isAbsolute(name) || (await createIgnoreMatcher(root)).ignores(name)) throw new ToolError("语言服务目标越界或被忽略。");
    if (![".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(extname(name))) throw new ToolError("语言服务仅支持JS/TS源码。");
    const info = await stat(absolute);
    if (!info.isFile() || info.size > 1024 * 1024) throw new ToolError("语言服务目标必须是1MiB以内的普通源码文件。");
    const text = await readFile(absolute, "utf8");
    if (Buffer.byteLength(text) > 1024 * 1024 || text.includes("\0")) throw new ToolError("语言服务目标过大或不是文本。");
    return { root, absolute, name, text, uri: pathToFileURL(absolute).href };
  }

  /** 初始化完成后才打开文档；本节每次重新打开，下一节保留版本并发送变化。 */
  private async perform(action: CodeAction, path: string, line: number | undefined, column: number | undefined, signal: AbortSignal): Promise<CodeResult> {
    const source = await this.source(path);
    const lines = source.text.split(/\r?\n/);
    if (!Number.isInteger(line) || !Number.isInteger(column) || line! < 1 || column! < 1 || line! > lines.length || column! > lines[line! - 1].length + 1) throw new ToolError("行列必须指向当前源码，从1开始，列使用UTF-16单元。");
    signal.throwIfAborted();
    const session = await this.start(source.root, signal);
    signal.throwIfAborted();
    if (session.documents.has(source.uri)) this.notify(session, "textDocument/didClose", { textDocument: { uri: source.uri } });
    const document = { text: source.text, version: 1 };
    session.documents.set(source.uri, document);
    this.notify(session, "textDocument/didOpen", { textDocument: { uri: source.uri, languageId: extname(path) === ".tsx" ? "typescriptreact" : extname(path) === ".jsx" ? "javascriptreact" : [".ts", ".mts", ".cts"].includes(extname(path)) ? "typescript" : "javascript", version: 1, text: source.text } });
    const raw = await this.request(session, `textDocument/${action}`, { textDocument: { uri: source.uri }, position: { line: line! - 1, character: column! - 1 }, ...(action === "references" ? { context: { includeDeclaration: true } } : {}) });
    signal.throwIfAborted();
    if (raw !== null && !Array.isArray(raw)) throw new ToolError("语言服务位置响应不是数组。");
    const locations: CodeLocation[] = [];
    for (const value of ((raw ?? []) as unknown[]).slice(0, 1000)) {
      const entry = object(value), uri = entry.uri ?? entry.targetUri;
      const range = object(entry.range ?? entry.targetSelectionRange), start = object(range.start);
      if (typeof uri !== "string" || !uri.startsWith("file:") || !Number.isInteger(start.line) || !Number.isInteger(start.character) || Number(start.line) < 0 || Number(start.character) < 0) throw new ToolError("语言服务位置格式无效。");
      const name = relative(source.root, fileURLToPath(uri)).split(sep).join("/");
      try { const target = await this.source(name); locations.push({ path: target.name, line: Number(start.line) + 1, column: Number(start.character) + 1 }); }
      catch { /* 外部库、被忽略及不可读位置不公开为项目源码结果。 */ }
    }
    return { path: source.name, action, version: document.version, sha256: createHash("sha256").update(source.text).digest("hex"), locations: locations.slice(0, 100), truncated: locations.length > 100 || (Array.isArray(raw) && raw.length > 1000) };
  }

  /** 启动固定安装的真实服务器，完成initialize；本地测试可注入故障进程。 */
  private async start(root: string, signal: AbortSignal): Promise<Session> {
    signal.throwIfAborted();
    if (this.session) {
      if (this.session.exited || this.session.poisoned) await this.stop();
      else return this.session;
    }
    const command = this.options.command ?? process.execPath;
    const args = this.options.args ?? [require.resolve("typescript-language-server/lib/cli.mjs"), "--stdio", "--log-level", "1"];
    const child = spawn(command, args, { cwd: root, detached: process.platform !== "win32", stdio: "pipe" });
    const session: Session = { child, closed: Promise.resolve(), exited: false, poisoned: false, buffer: Buffer.alloc(0), pending: new Map(), sequence: 0, documents: new Map() };
    session.closed = new Promise(resolve => { child.once("close", () => { session.exited = true; this.fail(session, new ToolError("语言服务进程已退出。")); resolve(); }); });
    this.session = session;
    child.on("error", error => this.fail(session, new ToolError(`无法启动语言服务：${error.message}`)));
    child.stdin.on("error", error => this.fail(session, new ToolError(`语言服务管道失败：${error.message}`)));
    child.stdout.on("data", chunk => { try { this.consume(session, chunk); } catch (error) { this.fail(session, error); void this.stop().catch(() => undefined); } });
    child.stderr.resume();
    // [NEW 32.2] 单个完整服务，避免加载期间的轻量语法结果只定位到import别名。
    const response = object(await this.request(session, "initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { definition: { linkSupport: false } } }, initializationOptions: { tsserver: { useSyntaxServer: "never", path: require.resolve("typescript/lib/tsserver.js") }, disableAutomaticTypingAcquisition: true } }));
    const capabilities = object(response.capabilities);
    if (capabilities.positionEncoding && capabilities.positionEncoding !== "utf-16") throw new ToolError("语言服务没有选择UTF-16位置编码。");
    this.notify(session, "initialized", {});
    return session;
  }

  /** 按Content-Length积累完整UTF-8字节；响应只完成同id的等待者。 */
  private consume(session: Session, chunk: Buffer): void {
    session.buffer = Buffer.concat([session.buffer, chunk]);
    if (session.buffer.length > MAX_BYTES) throw new ToolError("语言服务消息超出8MiB上限。");
    while (true) {
      const end = session.buffer.indexOf("\r\n\r\n");
      if (end < 0) { if (session.buffer.length > 8192) throw new ToolError("语言服务消息头过长。"); return; }
      const header = session.buffer.subarray(0, end).toString("ascii"), match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (!match || end > 8192) throw new ToolError("语言服务消息头无效。");
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length > MAX_BYTES) throw new ToolError("语言服务消息长度无效。");
      if (session.buffer.length < end + 4 + length) return;
      const message = object(JSON.parse(session.buffer.subarray(end + 4, end + 4 + length).toString("utf8")));
      session.buffer = session.buffer.subarray(end + 4 + length);
      if (message.jsonrpc !== "2.0") throw new ToolError("语言服务JSON-RPC版本无效。");
      if (message.method && message.id !== undefined) {
        this.send(session, { jsonrpc: "2.0", id: message.id, ...(message.method === "workspace/applyEdit" ? { result: { applied: false, failureReason: "只读客户端不应用编辑。" } } : { error: { code: -32601, message: "Method not supported" } }) });
      } else if (typeof message.id === "number") {
        const waiter = session.pending.get(message.id);
        if (!waiter) continue;
        session.pending.delete(message.id);
        if (message.error) waiter.reject(new ToolError(`语言服务请求失败：${String(object(message.error).message).slice(0, 2000)}`));
        else if ("result" in message) waiter.resolve(message.result);
        else waiter.reject(new ToolError("语言服务响应缺少result。"));
      }
      // 没有id的push/log通知不能完成任何等待中的查询。
    }
  }

  /** 在发送前登记等待者；即使服务立即响应也不会错过本次id。 */
  private request(session: Session, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++session.sequence;
      session.pending.set(id, { resolve, reject });
      try { this.send(session, { jsonrpc: "2.0", id, method, params }); }
      catch (error) { session.pending.delete(id); reject(error); }
    });
  }
  /** 通知不登记等待者；调用方负责遵守初始化与文档同步顺序。 */
  private notify(session: Session, method: string, params: unknown): void { this.send(session, { jsonrpc: "2.0", method, params }); }
  /** 协议长度按UTF-8字节计算；不把日志写进stdout协议流。 */
  private send(session: Session, message: unknown): void {
    if (session.exited || session.child.stdin.destroyed) throw new ToolError("语言服务管道已经关闭。");
    const body = Buffer.from(JSON.stringify(message));
    session.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }
  /** 失败一次性拒绝全部等待者，清空请求表，迟到响应不再有接收者。 */
  private fail(session: Session, reason: unknown): void { session.poisoned = true; for (const waiter of session.pending.values()) waiter.reject(reason); session.pending.clear(); }

  /** 多条失败路径共用一次清理；失败后保留拥有者，后续查询只能重试清理。 */
  private async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const cleanup = this.dispose();
    this.stopping = cleanup;
    try { await cleanup; } finally { if (this.stopping === cleanup) this.stopping = undefined; }
  }

  /** 必须同时确认直接子进程close和自有进程组消失；期限本身不证明资源退出。 */
  private async dispose(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.fail(session, new ToolError("语言服务本次连接已结束。"));
    const pid = session.child.pid;
    const target = pid && (process.platform === "win32" ? pid : -pid);
    const kill = (signal: NodeJS.Signals) => {
      if (!target) return;
      try { process.kill(target, signal); }
      catch (error) { if (!["ESRCH", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    };
    const gone = () => {
      if (!target) return session.exited;
      try { process.kill(target, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return session.exited; if ((error as NodeJS.ErrnoException).code === "EPERM") return false; throw error; }
    };
    const wait = async (ms: number) => {
      const until = Date.now() + ms;
      while (!gone() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
      return gone();
    };
    kill("SIGTERM");
    if (!await wait(500)) { kill("SIGKILL"); if (!await wait(1500)) throw new ToolError("语言服务清理无法确认；请检查本地进程，当前客户端禁止重新启动。"); }
    await session.closed;
    if (this.session === session) this.session = undefined;
  }

  /** 正常退出尝试LSP shutdown/exit，再有界清理；即使协议不响应也不会无限等。 */
  async close(): Promise<void> {
    this.closing = true;
    await this.tail;
    const session = this.session;
    if (session && !session.exited) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.request(session, "shutdown", null), new Promise(resolve => { timer = setTimeout(resolve, 300); })]); this.notify(session, "exit", null); }
      catch { /* 协议关闭失败仍继续清理拥有的进程。 */ }
      finally { clearTimeout(timer); }
    }
    await this.stop();
  }
}
```

</details>

### src/tools/code-intelligence.ts

目标文件：[src/tools/code-intelligence.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/code-intelligence.ts.md)。

<!-- build-file: src/tools/code-intelligence.ts -->
<details>
<summary>src/tools/code-intelligence.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [NEW] tools/code-intelligence.ts
 * 输入：模型JSON与本地客户端；输出：带源码摘要的结构化符号位置。
 * JSON -> 固定action/位置校验 -> 本地LanguageService -> 工具消息 -> 模型读取目标
 * 参数错误/服务失败 -> ToolError；用户取消 -> 原信号向任务外传播。
 * 只读意图不允许模型选择服务命令或执行任意workspace/executeCommand。
 */
import { ToolError } from "../errors.js";
import type { CodeAction, LanguageService } from "../language-service/client.js";
import type { ToolExecutionResult } from "./types.js";

// [NEW 32.2] 工具位置从1开始，适合与read_file输出对照。
export const codeIntelligenceDefinition = {
  name: "code_intelligence", description: "读取当前JS/TS源码的定义或引用；行列从1开始，列按UTF-16计数。失败可退回grep/read_file或批准check_project。",
  inputSchema: { type: "object" as const, properties: {
    action: { type: "string" as const, enum: ["definition", "references"] },
    path: { type: "string" as const }, line: { type: "integer" as const, minimum: 1 }, column: { type: "integer" as const, minimum: 1 },
  }, required: ["action", "path", "line", "column"], additionalProperties: false },
};

/** 完整校验工具输入；只有本地引用能够选择实际语言服务。 */
export async function codeIntelligenceTool(json: string, service: LanguageService | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  let input: { action: CodeAction; path: string; line?: number; column?: number };
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["action", "path", "line", "column"].includes(key)) || !["definition", "references"].includes(value.action) || typeof value.path !== "string" || !value.path.trim() || !Number.isInteger(value.line) || value.line < 1 || !Number.isInteger(value.column) || value.column < 1) throw new Error();
    input = value;
  } catch { throw new ToolError("code_intelligence需要definition/references、path和从1开始的line/column。"); }
  if (!service) throw new ToolError("本地语言服务未绑定；可改用grep/read_file或批准check_project。");
  const result = await service.query(input.action, input.path, input.line, input.column, signal);
  return { content: JSON.stringify(result, null, 2), metadata: { kind: "code_intelligence", result } };
}
```

</details>

### src/code-command.ts

目标文件：[src/code-command.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/code-command.ts.md)。

<!-- build-file: src/code-command.ts -->
<details>
<summary>src/code-command.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [NEW] code-command.ts
 * 输入：本地用户的code参数；输出：JSON结果或可见错误，不调用模型。
 * argv -> 参数有效？-- 否 -> 使用说明
 *                 +-- 是 -> 客户端查询 -> 输出 -> finally关闭服务
 * 入口在模型密钥检查前分流，工具和本地命令复用同一参数校验。
 */
import { LanguageService } from "./language-service/client.js";
import { codeIntelligenceTool } from "./tools/code-intelligence.js";
import { UserFacingError } from "./errors.js";

/** 本地只读查询也响应Ctrl+C，所有路径都等待拥有资源关闭。 */
export async function runCodeCommand(args: string[]): Promise<void> {
  const [action, path, line, column] = args;
  if (args.length !== 4 || !["definition", "references"].includes(action)) throw new UserFacingError("用法：hello-my-agent code <definition|references> <path> <line> <column>");
  // [NEW 32.2] 独立查询拥有自己的服务；结果或错误输出后都必须关闭。
  const service = new LanguageService(), controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("本地代码查询已取消。"));
  process.once("SIGINT", cancel);
  try { console.log((await codeIntelligenceTool(JSON.stringify({ action, path, line: Number(line), column: Number(column) }), service, controller.signal)).content); }
  finally { process.removeListener("SIGINT", cancel); await service.close(); }
}
```

</details>

### src/tools/registry.ts

目标文件：[src/tools/registry.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/registry.ts.md)。

<!-- build-file: src/tools/registry.ts -->
<details>
<summary>src/tools/registry.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] tools/registry.ts
 *
 * 本节变化：项目检查先预览审批；语言服务只从本地绑定的客户端分发。
 * 学习目标：分别准备网页 URL 或搜索查询的完整预览，复制本次参数；批准后才执行对应的网络请求。
 * 输入：模型给出的工具名称、JSON 参数与取消信号。
 * 输出：本地直接工具返回实际结果；需审批的文件修改、命令与外部工具返回 preview/execute，批准后才执行。
 * 状态：分发失败向外抛错；执行入口调用过的工具可能已有副作用，注册表不负责回滚。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   网页调用 -> 校验 URL 或查询、复制参数 -> 返回本次网络预览和 execute；此时不发请求
 *   prepareTool -> MCP工具？-- 是 -> 复制参数、生成完整来源预览 -> 返回 execute，尚未调用服务
 *                 +-- 否 -> 写入或命令？-- 是 -> 对应准备函数 -> 返回预览，或抛错
 *                             +-- 否 -> 返回 null
 *   executeTool -> MCP名称？-- 是 -> 按当前连接映射调用 -> 带来源结果或错误
 *                 +-- 否 -> read_tool_result？-- 是 -> 传入本轮日志目录 -> 按编号读取 -> 结果或错误
 *                           +-- 否 -> 已有直接工具？-- 是 -> 对应执行函数 -> 结果或错误
 *                           +-- 否 -> 拒绝直接写入、命令或未知工具
 *   executePreparedTool -> 保存的 execute -> 结果或错误
 *
 * 注册表只寻找实现，不产生批准；permissions/policy.ts 决定是否需要询问用户。
 * 核心先完成权限与审批才调用执行入口；准备预览不会调用服务或执行文件修改。
 * 观察：准备预览不会发出 GET；用户批准本次 URL 或查询后，保存的 execute 才调用网页模块。
 */

// [KEEP 来自 07.1] 命令和文件修改复用同一条准备、审批通道。
// [KEEP 来自 18.2] 模型候选复用现有预览、审批、执行通道。
// [KEEP 来自 19.3] 专用只读技能工具不执行正文中的命令。
// [KEEP 来自 21.1] 动态映射属于本次进程，不从模型文字创建。
// [KEEP 来自 22.1] 网页GET也先固定参数和本次审批预览。
// [KEEP 来自 26.1] 后台作业沿用统一准备/审批通道，只读观察只访问会话登记表。
// [KEEP 来自 28.1] 自有工作区修改仍走同一prepare/approval入口。
// [KEEP 来自 29.1] 共享工具只使用本地RunOptions绑定。
// [KEEP 来自 32.1] 项目检查也只从准备与逐次审批入口执行。
// [NEW 32.2] 只读语言服务和原有工具共享消息与日志通路。
import { codeIntelligenceDefinition, codeIntelligenceTool } from "./code-intelligence.js";
import { checkProjectDefinition, prepareCheckProject } from "./check-project.js";
import { sharedTaskDefinitions, sharedTaskTool } from "./shared-task-tools.js";
import { worktreeDefinitions, worktreeMutations, readWorktree, prepareWorktree } from "./worktree-tools.js";
import { prepareJob, readJob, startJobDefinition, readJobDefinition, stopJobDefinition } from "./job-tools.js";
import { delegateTaskDefinition, delegateTaskTool } from "./delegate-task.js";
import { callWeb, parseWebCall } from "../web/client.js";
import { callMcp } from "../mcp/client.js";
import { loadSkillDefinition, readSkillResourceDefinition, skillTool } from "./skill-tools.js";
import { prepareMemory, proposeMemoryDefinition } from "./propose-memory.js";
import { prepareRunCommand, runCommandDefinition } from "./run-command.js";
import { ToolError } from "../errors.js";
import { globDefinition, globTool } from "./glob.js";
import { grepDefinition, grepTool } from "./grep.js";
import { readFileDefinition, readFileTool } from "./read-file.js";
// [KEEP 来自 15.2] 日志读取只接受保存后生成的编号，不开放任意磁盘路径。
import { readToolResultDefinition, readToolResultTool } from "./read-tool-result.js";
import { prepareWriteFile, writeFileDefinition } from "./write-file.js";
import { editFileDefinition, prepareEditFile } from "./edit-file.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";
import type { RunOptions } from "../agent/run-options.js";
import { todoWriteDefinition, todoWriteTool } from "./todo-write.js";
import { askUserDefinition, askUserTool } from "./ask-user.js";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

// [KEEP 来自 06.1] write_file 进入模型可见的工具列表，但只能走准备与审批通道。
// [KEEP 来自 06.2] edit_file 与 write_file 共用准备、审批和执行入口。
export const toolDefinitions = [
  checkProjectDefinition, codeIntelligenceDefinition,
  // [KEEP 来自 29.1] 调度和消息入口与普通工具一起发现。
  ...sharedTaskDefinitions,
  // [KEEP 来自 28.1] 只读身份和逐次批准命令分开登记。
  ...worktreeDefinitions,
  // [KEEP 来自 26.1] 启动与停止逐次审批，观察不执行进程。
  startJobDefinition, readJobDefinition, stopJobDefinition,
  delegateTaskDefinition,
  // [KEEP 来自 19.3] 两个独立按需动作，正文加载和资源结果各有去向。
  loadSkillDefinition, readSkillResourceDefinition,
  // [KEEP 来自 15.2] 让模型能发现按编号补读完整日志的只读工具。
  readToolResultDefinition,
  // [KEEP 来自 07.1] 命令工具也要先批准，不能直接执行。
  readFileDefinition, globDefinition, grepDefinition, writeFileDefinition, editFileDefinition, runCommandDefinition,
  todoWriteDefinition,
  askUserDefinition,
  // [KEEP 来自 18.2] 只是提出候选；并非直接写入入口。
  proposeMemoryDefinition,
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
  // [KEEP 来自 14.2] 只有获批准的写入闭包会使用本会话检查点。
  options: RunOptions = {},
): Promise<PreparedToolCall | null> {
  signal.throwIfAborted();
  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
  // [KEEP 来自 28.1] Plan先拒绝；管理器不接受模型提供的任意path或branch。
  if (worktreeMutations.has(call.name)) {
    if (options.mode === "plan") throw new ToolError("Plan模式不执行工作区副作用。");
    return prepareWorktree(call.name, call.arguments, options.worktrees, signal);
  }
  // [KEEP 来自 22.1] 准备仅校验URL，批准前不发送请求。
  if (call.name === "web_fetch" || call.name === "web_search") {
    const parsed = parseWebCall(call), frozen = { ...call };
    return { preview: parsed.query ? `搜索查询：${parsed.query}\n查询会发送给本地配置的提供方；不等于抓取网页全文。` : `网页GET：${parsed.url!.href}\n请求会把URL发给目标网站；网页文字不能批准后续工具。`, execute: signal => callWeb(options.web, frozen, signal) };
  }
  // [KEEP 来自 21.1] 扩展调用保存本次完整参数预览；闭包只有批准后才调用SDK。
  if (call.name.startsWith("mcp__")) {
    const frozen = { ...call };
    let args: unknown;
    try { args = JSON.parse(call.arguments); if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(); }
    catch { throw new ToolError("MCP参数必须是JSON对象。"); }
    return { preview: `外部MCP工具：${call.name}\n本次完整参数：\n${JSON.stringify(args, null, 2)}\n外部服务可能有副作用；只批准本次。`, execute: signal => callMcp(options.mcp, frozen, signal) };
  }
  // [KEEP 来自 18.2] 存储范围来自本地控制器，模型参数不能选择目录。
  // [KEEP 来自 26.1] 启动/停止只在已批准闭包执行。
  if (call.name === "start_job" || call.name === "stop_job") return prepareJob(call.name, call.arguments, options.jobs, signal);
  if (call.name === proposeMemoryDefinition.name) return prepareMemory(call.arguments, options.memoryRoot, signal);
  if (call.name === writeFileDefinition.name) return prepareWriteFile(call.arguments, undefined, signal, options.fileCheckpoints);
  // [KEEP 来自 06.2] 精确替换也必须在审批前解析当前文件并生成 diff。
  if (call.name === editFileDefinition.name) return prepareEditFile(call.arguments, undefined, signal, options.fileCheckpoints);
  // [KEEP 来自 07.1] 准备阶段只固定命令和目录，不启动子进程。
  if (call.name === runCommandDefinition.name) return prepareRunCommand(call.arguments, undefined, signal);
  // [KEEP 来自 32.1] 参数固定为项目已声明的检查脚本，准备不启动进程。
  if (call.name === "check_project") return prepareCheckProject(call.arguments, undefined, signal);
  return null;
}

/**
 * 把无需预览审批的工具分发到对应实现。
 * todo_write 接收本轮共用的清单；ask_user 接收问答 handler 并等待答案。
 * 读取和搜索工具接收参数与取消信号；返回正文和界面数据。
 * 写入、命令或未知工具抛出 ToolError，不能从这里绕过准备与审批；调用 ID 由核心管理。
 */
export async function executeTool(
  call: ToolCall,
  signal: AbortSignal,
  // [KEEP 来自 12.2] 新增本轮控制选项，便于传入清单和后续问答入口。
  options: RunOptions = {},
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (options.allowedTools && !options.allowedTools.includes(call.name)) throw new ToolError(`子任务不允许工具：${call.name}`);
  // [KEEP 来自 28.1] 只读快照直接执行；副作用禁止绕过预览和审批。
  // [KEEP 来自 29.1] 仍经过allowedTools和权限策略，工具内部再次检查模式。
  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return sharedTaskTool(call.name, call.arguments, signal, options);
  if (call.name === "read_worktree") return readWorktree(call.arguments, options.worktrees, signal);
  if (worktreeMutations.has(call.name)) throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  // [KEEP 来自 21.1] 主循环先审批，注册表只按已发现映射执行。
  // [KEEP 来自 26.1] 观察入口拒绝跨会话PID，启动/停止禁止直接调用。
  // [KEEP 来自 32.1] 直接执行不能绕过检查审批。
  // [NEW 32.2] 本地会话引用决定服务，模型不能选择启动参数。
  if (call.name === "code_intelligence") return codeIntelligenceTool(call.arguments, options.languageService, signal);
  if (call.name === "check_project") throw new ToolError("check_project 必须先生成预览并获得本次批准。");
  if (call.name === "read_job") return readJob(call.arguments, options.jobs, signal);
  if (call.name === "start_job" || call.name === "stop_job") throw new ToolError(`${call.name} 必须先生成预览并获得本次批准。`);
  if (call.name === delegateTaskDefinition.name) return delegateTaskTool(call.arguments, signal, options);
  if (call.name === "web_fetch" || call.name === "web_search") return callWeb(options.web, call, signal);
  if (call.name.startsWith("mcp__")) return callMcp(options.mcp, call, signal);
  // [KEEP 来自 19.3] 串行等待完整读取，再回传当前调用的结果。
  if (call.name === loadSkillDefinition.name || call.name === readSkillResourceDefinition.name) return skillTool(call.name, call.arguments, options.skills, signal);
  // [KEEP 来自 12.2] 分发给清单工具，传入同一份 TaskState。
  if (call.name === todoWriteDefinition.name) return todoWriteTool(call.arguments, options.tasks ?? { items: [] }, signal);
  // [KEEP 来自 12.3] 分发给问答工具，等待本地 handler 后返回原调用结果。
  if (call.name === askUserDefinition.name) return askUserTool(call.arguments, options.askUser, signal);
  // [KEEP 来自 15.2] 使用保存日志时的同一个目录，避免编号指向另一处存储。
  if (call.name === readToolResultDefinition.name) return readToolResultTool(call.arguments, signal, options.toolResultDirectory);
  if (call.name === readFileDefinition.name) return readFileTool(call.arguments, undefined, signal);
  if (call.name === globDefinition.name) return globTool(call.arguments, undefined, signal);
  if (call.name === grepDefinition.name) return grepTool(call.arguments, undefined, signal);
  // [KEEP 来自 07.1] 拒绝绕过审批的直接执行。
  if (call.name === proposeMemoryDefinition.name || call.name === writeFileDefinition.name || call.name === editFileDefinition.name || call.name === runCommandDefinition.name) {
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
  options: RunOptions = {},
): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  if (options.allowedTools) throw new ToolError("子任务不允许执行需准备的操作。");
  return prepared.execute(signal);
}
```

</details>

### src/tools/types.ts

目标文件：[src/tools/types.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/tools/types.ts.md)。

<!-- build-file: src/tools/types.ts -->
<details>
<summary>src/tools/types.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] tools/types.ts
 *
 * 学习目标：用同一工具契约携带网页启用状态、来源及字节元数据；网页正文通过 content 回模型，显示信息通过 metadata 回界面。
 * 输入：本地网页状态、工具准备出的预览和执行闭包，或已取得的正文、来源与截断标志。
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
// [KEEP 来自 21.1] 外部JSON Schema保留原样，工具名由可信映射提供。
export type ToolDefinition = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; [key: string]: unknown } };
// [KEEP 来自 22.1] 来源只由已完整读完的真实HTTP响应提供。
// [KEEP 来自 28.1] 界面直接消费工作区身份，不从工具正文猜测。
export type ToolResultMetadata =
  // [NEW 32.2] 保存源码身份与符号位置，界面仍沿用普通工具结果。
  | { kind: "code_intelligence"; result: import("../language-service/client.js").CodeResult }
  // [KEEP 来自 29.1] 结果与正文由同一份协调者快照产生。
  | { kind: "shared_tasks"; tasks: import("../collaboration/coordinator.js").SharedTask[] }
  // [KEEP 来自 29.3] 消息与ack在独立元数据中显示，不冒充任务完成。
  | { kind: "agent_messages"; messages: import("../collaboration/coordinator.js").AgentMessage[] }

  | { kind: "worktree"; worktree: import("../workspaces/worktrees.js").WorktreeSnapshot | null }
  // [KEEP 来自 26.1] Job状态在内存登记表；保存metadata不表示能恢复控制权。
  | { kind: "job"; job: import("../processes/jobs.js").JobSnapshot | null }
  | { kind: "subagent"; result: import("../subagents/runner.js").ChildResult }
  | { kind: "web"; sources: import("../web/client.js").WebSource[]; bytes: number; truncated: boolean }
  | { kind: "mcp"; server: string; tool: string }
  // [KEEP 来自 19.3] 来源由工具结构化返回，界面不从正文猜测路径。
  | { kind: "load_skill" | "read_skill_resource"; name: string; path: string; bytes: number; sha256: string }
  // [KEEP 来自 18.2] 已保存编号供界面检查，正文仍回传模型。
  | { kind: "memory"; id: string }
  // [KEEP 来自 12.3] 澄清答案与问题有独立显示字段，不必从正文重新解析。
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

### src/permissions/policy.ts

目标文件：[src/permissions/policy.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/permissions/policy.ts.md)。

<!-- build-file: src/permissions/policy.ts -->
<details>
<summary>src/permissions/policy.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] permissions/policy.ts
 *
 * 本节变化：check_project逐次批准且Plan拒绝；语言服务按只读路径过滤。
 * 学习目标：把本次启用的网页工具与 MCP 一并列为外部工具；Plan 硬拒绝，执行模式仍逐次询问，网页文字不产生批准。
 * 输入：模型给出的工具名、JSON 参数和当前进程的只读授权集合。
 * 输出：allow、ask 或 deny；这里只判断权限，不执行请求或保存批准。
 * 状态：权限判断只返回决定；拒绝不执行工具，批准记录仍由 Agent Loop 在取得用户决定后保存。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   本次外部工具集合包含网页？-- 是 -> 参数有效且非 Plan？-- 否 -> deny；是 -> ask，只批准本次
 *                              +-- 否 -> 继续原有本地工具规则
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
 * 观察：网页请求在 Plan 被拒绝，在执行模式每次审批；上次批准不会给下一 URL 或查询授权。
 */

// [KEEP 来自 28.1] 副作用集合由实际登记的工作区工具生成，不给会话记住权限。
// [KEEP 来自 29.1] 本地共享状态可在执行模式操作，Plan不得启动worker。
import { sharedTaskDefinitions, sharedTaskMutations } from "../tools/shared-task-tools.js";
import { worktreeMutations } from "../tools/worktree-tools.js";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import { findProjectRoot } from "../tools/workspace.js";
import type { ExecutionMode } from "../agent/run-options.js";

export type PermissionDecision =
  | { action: "allow"; reason: string }
  // [KEEP 来自 06.1] remember=false 表示批准只覆盖当前准备好的文件修改或命令。
  | { action: "ask"; reason: string; resource: string; scope: string; remember: boolean }
  | { action: "deny"; reason: string };

export type ApprovalRequest = {
  call: ToolCall;
  reason: string;
  resource: string;
  scope: string;
  allowSession: boolean;
  preview?: string;
};

export type ApprovalResponse =
  | { decision: "allow_once" }
  // [KEEP 来自 05.3] allow_session 表示把这次 ask 携带的批准记录保存到当前会话。
  | { decision: "allow_session" }
  | { decision: "deny"; reason: string };

export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal,
) => Promise<ApprovalResponse>;

// [KEEP 来自 18.1] 专用元数据目录不能从通用写入入口绕过记忆控制器。
const APPROVAL_DIRECTORIES = new Set([".git", ".agents", ".codex", ".hello-my-agent"]);

/**
 * 把未经信任的工具参数解析成顶层对象。
 *
 * - 输入：模型返回的 JSON 字符串。
 * - 输出：普通对象；JSON 无效、数组或非对象返回 `null`。
 * - 关键原因：权限判断发生在工具参数校验之前，不能直接相信 TypeScript 类型。
 * - 职责边界：这里只读取权限判断需要的顶层字段，完整 Schema 仍由具体工具校验。
 */
function parseArguments(argumentsJson: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(argumentsJson);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * 从不同文件工具的参数中取出决定访问范围的路径字段。
 *
 * - 输入：工具名称和已解析的顶层参数。
 * - 输出：文件工具的 `path`、`glob.pattern` 或 `grep.glob`；字段缺失或类型错误时返回 `null`。
 * - 关键原因：权限层只关心工具准备访问哪里，不重复实现 query、offset、limit 等业务校验。
 */
function getRequestedPath(call: ToolCall, input: Record<string, unknown>): string | null {
  // [KEEP 来自 06.2] 两个写入工具都用 path 决定访问范围。
  // [NEW 32.2] 语言服务按目标文件判断只读范围。
  const value = ["read_file", "write_file", "edit_file", "code_intelligence"].includes(call.name)
    ? input.path
    : call.name === "glob"
      ? input.pattern
      : call.name === "grep"
        ? input.glob
        : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 判断路径文字是否明确要求离开当前项目。
 *
 * - 输入：相对路径或 glob 模式。
 * - 输出：绝对路径，或任一目录段为 `..` 时返回 `true`。
 * - 职责边界：这是执行前的快速拒绝；符号链接和真实路径仍由具体文件工具检查。
 */
function leavesProject(path: string): boolean {
  if (isAbsolute(path) || win32.isAbsolute(path)) return true;
  return path.replaceAll("\\", "/").split("/").some((segment) => segment === "..");
}

/**
 * 判断路径是否点名环境配置文件。
 *
 * - 输入：已经统一为 `/` 分隔的相对路径。
 * - 输出：任一目录段是 `.env`、`.env.*` 或 `.envrc` 时返回 `true`。
 * - 关键原因：命中 deny 后不提供审批入口，后续人工批准也不能覆盖它。
 */
function containsEnvironmentFile(path: string): boolean {
  return path.toLowerCase().split("/").some((segment) =>
    segment === ".env" || segment.startsWith(".env.") || segment === ".envrc");
}

/**
 * 找出需要人工确认的项目元数据目录。
 *
 * - 输入：已经统一为 `/` 分隔的相对路径。
 * - 输出：从项目根到第一个受保护目录的完整相对路径；普通源码路径返回 `null`。
 * - 示例：`.git/HEAD` 返回 `.git`，`packages/demo/.git/config` 返回 `packages/demo/.git`。
 * - 关键原因：两个位置不同但同名的 `.git` 目录不能共用同一条批准记录。
 */
function findApprovalDirectory(path: string): string | null {
  const segments = path.split("/");
  const index = segments.findIndex((segment) => APPROVAL_DIRECTORIES.has(segment.toLowerCase()));
  return index === -1 ? null : segments.slice(0, index + 1).join("/");
}

/**
 * 把现有文件的表面路径转换成项目内真实路径，防止符号链接隐藏受保护目标。
 *
 * - 输入：模型提供的相对路径和当前项目根目录。
 * - 输出：文件存在时返回相对于真实项目根的路径；目标不存在时保留原路径交给工具报错。
 * - 失败方式：真实目标位于项目外时返回 `null`，权限层据此 deny。
 * - 竞态边界：检查与工具打开文件仍是两步；本章不能把它描述成操作系统沙箱。
 */
async function resolvePermissionPath(path: string, projectRoot: string): Promise<string | null> {
  try {
    const rootPath = await realpath(projectRoot);
    const targetPath = await realpath(resolve(rootPath, path));
    const target = relative(rootPath, targetPath);
    if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) return null;
    return target.replaceAll("\\", "/");
  } catch {
    return path;
  }
}

/**
 * 由本地策略判断这次工具能否执行。
 * 先检查登记工具和 JSON 对象，再检查本轮模式；Plan 的写入、编辑和命令直接 deny。
 * 清单和澄清工具允许进入自身校验与执行，不需要文件审批；它们不能授予其他权限。
 * 执行模式的命令每次 ask；文件请求先检查硬拒绝，再查询只读会话授权，最后决定 allow 或 ask。
 * 返回 ask 时附本地生成的 scope 和 remember；只有可记住的只读范围才可进入授权集合。
 * 这里只返回决定，准备和执行仍要检查参数与路径，拒绝不会运行工具。
 */
export async function decideToolPermission(
  call: ToolCall,
  // [KEEP 来自 05.3] 策略会查询已批准记录，但每次仍先执行 deny 检查。
  sessionGrants: ReadonlySet<string> = new Set(),
  projectRoot = findProjectRoot(),
  // [KEEP 来自 12.1] 增加本轮模式参数，默认继续沿用执行模式。
  mode: ExecutionMode = "execute",
  // [KEEP 来自 21.1] 可信控制器传入本进程已发现的工具集合。
  externalTools: ReadonlySet<string> = new Set(),
): Promise<PermissionDecision> {
  // [KEEP 来自 21.1] MCP说明和readOnlyHint不能跳过逐次批准，Plan一律拒绝。
  if (externalTools.has(call.name)) {
    if (!parseArguments(call.arguments)) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };
    if (mode === "plan") return { action: "deny", reason: "Plan 模式不调用外部网络工具" };
    return { action: "ask", reason: "外部工具可能有文件或网络副作用，请核对本次完整参数", resource: call.name, scope: `${call.name}:once`, remember: false };
  }
  if (!toolDefinitions.some((tool) => tool.name === call.name)) {
    return { action: "deny", reason: `工具未登记：${call.name}` };
  }
  const input = parseArguments(call.arguments);
  if (!input) return { action: "deny", reason: "工具参数不是有效的 JSON 对象" };

  // [KEEP 来自 12.1] Plan 的硬拒绝早于预览和审批，会话授权也不能跳过。
  if (mode === "plan" && (sharedTaskMutations.has(call.name) || worktreeMutations.has(call.name) || ["write_file", "edit_file", "run_command", "check_project", "propose_memory", "start_job", "stop_job"].includes(call.name))) {
    return { action: "deny", reason: "Plan 模式只允许调查和制定计划，不能修改文件或执行命令" };
  }
  // [KEEP 来自 28.1] 只读登记不会授予路径控制；创建/命令/后续副作用逐次审批。
  // [KEEP 来自 29.1] 这里只允许固定协调者动作，不给文件、命令或外部工具授权。
  if (sharedTaskDefinitions.some(tool => tool.name === call.name)) return { action: "allow", reason: "当前进程固定只读worker与有界共享登记" };
  if (call.name === "read_worktree") return { action: "allow", reason: "只读当前CLI自有Git工作区状态" };
  if (worktreeMutations.has(call.name)) return { action: "ask", reason: "工作区操作可能修改本地Git或文件，请核对本次身份、版本和命令", resource: typeof input.worktree_id === "string" ? input.worktree_id : "当前仓库的固定HEAD", scope: `${call.name}:once`, remember: false };
  // [KEEP 来自 19.3] 只读专用入口仍自行检查名字、路径和大小；不会授权其他工具。
  if (["load_skill", "read_skill_resource"].includes(call.name)) return { action: "allow", reason: "技能只读加载，范围与格式由专用工具再次检查" };
  // [KEEP 来自 18.2] 候选不能用会话授权，也不能靠项目文字跳过逐次审批。
  // [KEEP 来自 26.1] 模型启动/停止各批准一次；本地stdin不变成模型授权。
  if (call.name === "start_job" || call.name === "stop_job") return { action: "ask", reason: "后台进程有文件/网络副作用，停止也可能中断写入，请核对本次作业", resource: "本次后台作业", scope: `${call.name}:once`, remember: false };
  if (call.name === "read_job") return { action: "allow", reason: "只读本次会话作业状态和有界日志" };
  if (call.name === "propose_memory") return { action: "ask", reason: "长期记忆会跨会话保留，请核对正文、项目范围和来源", resource: "本项目长期记忆", scope: "propose_memory:once", remember: false };
  // [KEEP 来自 12.2] 放行内存清单工具，内容是否合法仍由工具完整校验。
  // [KEEP 来自 15.2] 仅放行专用日志读取入口；UUID、范围和目录由工具再次检查，不授予任意路径读取权。
  if (call.name === "read_tool_result") return { action: "allow", reason: "只读本机完整工具日志，编号与范围仍由工具校验" };
  if (call.name === "delegate_task") return { action: "allow", reason: "独立只读子任务，实际工具仍按原权限逐次检查" };
  if (call.name === "todo_write") return { action: "allow", reason: "任务清单只更新本地会话内存" };
  // [KEEP 来自 12.3] 放行澄清等待；答案不产生文件或命令批准。
  if (call.name === "ask_user") return { action: "allow", reason: "澄清问题只等待用户回答，不授予工具执行权限" };
  // [KEEP 来自 07.1] 命令能做什么不能由 cwd 推断；每一次都交给用户确认。
  // [KEEP 来自 32.1] 脚本名不是执行权限；npm钩子与项目代码仍可能有副作用。
  if (call.name === "run_command" || call.name === "check_project") {
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

### src/models/client.ts

目标文件：[src/models/client.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/models/client.ts.md)。

<!-- build-file: src/models/client.ts -->
<details>
<summary>src/models/client.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] models/client.ts
 *
 * 学习目标：每次请求读取同一组能力对象，整轮运行持有扩展使用票据。
 * 输入：完整消息历史、工具定义、取消信号和文字回调；两种协议都使用 SDK 接收流。
 * 输出：文字片段供界面显示；完整结果包含文本、工具请求、用量和统一的 finishReason。
 * 状态：失败不返回半份可执行结果，也不在这里修改历史；已经发出的文字片段可能已被界面显示。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   本地来源台账 -> 只列编号/类型的提示 -> 同时用于估算与 generate；正文仍由 tool 消息携带
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
 * [KEEP 来自 12.3] 提示模型用 ask_user 澄清重要缺失信息，并在 Plan 的可见列表中保留它。
 * 运行观察：来源编号提示会随实际取得的来源更新；预算估算与 generate 使用相同提示，存在编号不证明引用语义正确。
 */

// [KEEP 来自 18.1] 记忆快照由明确任务边界刷新，估算和发送读取同一字符串。
// [KEEP 来自 19.1] 目录和正文由本地会话持有；组装提示不读取磁盘。
import { skillPrompt, type SkillState } from "../skills/catalog.js";
import type { MemoryController } from "../memory/commands.js";
// [KEEP 来自 17.1] 项目说明在模型创建时冻结；估算与发送使用相同文本。
import { projectInstructionInfo, projectInstructionPrompt, type ProjectInstructions } from "../project/instructions.js";
import { createAttachmentState, type AttachmentRef, type AttachmentState } from "../attachments/store.js";
// [KEEP 来自 26.1] 会话级进程所有权不在消息或会话文件里。
// [KEEP 来自 28.1] text/TUI共用同一模型对象持有的会话工作区登记。
// [KEEP 来自 29.1] createModel为整个CLI会话持有单一协调者。
// [NEW 32.2] 构造客户端不启动语言服务器。
import { LanguageService } from "../language-service/client.js";
import { SharedCoordinator } from "../collaboration/coordinator.js";
import { WorktreeManager } from "../workspaces/worktrees.js";
import { JobManager } from "../processes/jobs.js";
import { safeModelError } from "./model-errors.js";
import { createProtocolAdapter, SUMMARY_PROMPT, type ModelProfile } from "./protocol.js";
import { readConfig, systemPrompt, type Config } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";
// [KEEP 来自 21.1] 动态定义与预算、两种模型协议使用同一份列表。
// [KEEP 来自 22.1] 网络工具和本地工具共用请求定义、预算与Plan过滤。
import { webDefinitions, webPrompt, type WebState } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import type { McpState } from "../mcp/client.js";
import type { ToolDefinition } from "../tools/types.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ExecutionMode } from "../agent/run-options.js";
import { DEFAULT_CONTEXT_LIMITS, estimateContext, estimateCostUsd, type ContextBudget, type ContextLimits } from "../context/budget.js";

// [KEEP 来自 03.2] assistant 保存模型提出的调用；tool 保存本地执行结果和同一个调用 ID。
export type Message =
  | { role: "user"; content: string; attachments?: AttachmentRef[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError: boolean };

export type Reply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
};
// [KEEP 来自 08.2] 把两种接口的结束原因转成核心可以统一判断的值。
export type ModelFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "unsupported";
// [KEEP 来自 08.2] 完整结果同时携带结束原因，主循环据此决定是否继续。
export type ModelResult = Reply & { toolCalls: ToolCall[]; finishReason: ModelFinishReason };

// [KEEP 来自 23.3] 只记录请求异常的本地边界，不改错误对象或 Model 接口；旧测试模型未标记时保守视为可能已发送。
const failedRequestStarts = new WeakMap<object, boolean>();
export function requestFailedBeforeSending(error: unknown): boolean {
  return typeof error === "object" && error !== null && failedRequestStarts.get(error) === false;
}
async function trackRequest<T>(operation: (onRequestStart: () => void) => Promise<T>): Promise<T> {
  let started = false;
  try { return await operation(() => { started = true; }); }
  catch (error) {
    if (typeof error === "object" && error !== null) failedRequestStarts.set(error, started);
    throw error;
  }
}

/**
 * 核心使用的统一模型接口。
 * 输入完整消息、取消信号和可选文字回调；Promise 返回经过检查的完整结果。
 * 本轮模式通过 options 传入，省略时沿用 execute；接口本身不批准或执行工具。
 */
export type ModelRequestScope = { allowedTools?: readonly string[]; rolePrompt?: string };

export interface Model {
  // [KEEP 来自 26.1] 单轮结束保留registry；整次CLI退出才close。
  readonly jobs?: import("../processes/jobs.js").JobManager;
  // [KEEP 来自 28.1] 不随消息持久化，也不导入旧CLI的Git目录。
  readonly worktrees?: WorktreeManager;
  // [KEEP 来自 29.1] 不从会话JSON恢复控制权。
  readonly sharedTasks?: SharedCoordinator;
  // [NEW 32.2] 同一CLI会话共用，退出时由CLI关闭。
  readonly languageService?: LanguageService;
  // [KEEP 来自 31.2] 显式本地扩展入口，不属于模型工具。
  readonly extensions?: import("../extensions/manager.js").ExtensionManager;
  // [KEEP 来自 18.1] 本地管理入口不属于会话消息或模型授权。
  // [KEEP 来自 20.1] 本地启用状态不进入聊天或会话文件。
  // [KEEP 来自 21.1] 本地连接不进入模型消息或保存记录。
  // [KEEP 来自 22.1] 网页启用只来自本次启动。
  readonly attachments?: AttachmentState;
  readonly profile?: ModelProfile;
  beginRun?(): () => void;
  command?(text: string): { ok: boolean; message: string };
  readonly web?: WebState;
  readonly mcp?: McpState;
  readonly hooks?: import("../hooks/lifecycle.js").HookState;
  readonly memory?: MemoryController;
  // [KEEP 来自 19.1] 后续节本地命令与模型工具复用同一份技能状态。
  readonly skills?: SkillState;
  // [KEEP 来自 17.1] 来源是本地启动信息，不是模型接收确认。
  readonly projectInfo?: readonly string[];
  // [KEEP 来自 16.2] 摘要使用独立、无工具的请求，先估算其输入，返回完整结果才考虑采用。
  inspectSummary?(source: string): ContextBudget;
  summarize?(source: string, signal: AbortSignal): Promise<ModelResult>;
  // [KEEP 来自 15.1] 估算与发送共用同一份系统提示和工具列表；其他教学测试模型可不提供此观察接口。
  inspectContext?(messages: Message[], mode?: ExecutionMode, scope?: ModelRequestScope): ContextBudget;
  estimateCost?(input: number | null, output: number | null): number | null;
  // [KEEP 来自 08.1] 增量只用于显示，完整结果仍由 Promise 返回。
  // [KEEP 来自 12.1] 模式参数只影响本轮请求组装，本地权限策略还会再次检查。
  generate(messages: Message[], signal: AbortSignal, onText?: (text: string) => void,
    options?: { mode?: ExecutionMode } & ModelRequestScope): Promise<ModelResult>;
}

/**
 * 根据配置创建统一模型对象，并为每次请求设置总等待期限。
 *
 * - 输入：readConfig 已校验的协议、密钥、模型 ID 和基础地址。
 * - 输出：Model 可在本地估算请求；创建对象和 inspectContext 都不发送 HTTP，generate 才发送。
 * - 关键步骤：将调用方的取消信号与 60 秒期限合并，传给同一次 SDK 请求。
 * - 期限覆盖：等待响应和接收流都计入这 60 秒，不会因为收到一段文字重新计时。
 * - 失败方式：用户取消优先向外抛出取消原因；期限到达则抛出可显示的超时提示，其他错误继续向外传播。
 * - 职责边界：关闭 SDK 自动重试与日志，失败后由外层决定是否让用户发起新一轮。
 */
// [KEEP 来自 08.1] generate 同时返回完整结果、转发文字片段，并处理本次总期限。
export function createModel(config: Config, project?: ProjectInstructions, memory?: MemoryController, skills?: SkillState, hooks?: import("../hooks/lifecycle.js").HookState, mcp?: McpState, web?: WebState, extensions?: import("../extensions/manager.js").ExtensionManager): Model {
  // [KEEP 来自 17.1] 转成字符串与只读显示快照，后续文件变化不偷偷改变请求。
  const projectPrompt = project ? projectInstructionPrompt(project) : "";
  const projectInfo = project ? Object.freeze(projectInstructionInfo(project)) : undefined;
  const attachments = createAttachmentState();
  // [KEEP 来自 26.1] createModel一次创建，后续run共用；不会从历史加载PID。
  const jobs = new JobManager();
  // [KEEP 来自 28.1] 创建管理器不创建Git工作区，副作用必须等工具批准。
  const worktrees = new WorktreeManager();
  // [KEEP 来自 29.1] 本地构造，不接受模型配置worker数或租约。
  const sharedTasks = new SharedCoordinator();
  // [NEW 32.2] 延迟启动，构造模型时不创建语言服务器进程。
  const languageService = new LanguageService();
  let adapter = createProtocolAdapter(config);
  let activeRequests = 0;
  // [KEEP 来自 08.1] 每次请求设置 60 秒总期限，接收正文期间也计时。
  // [KEEP 来自 12.1] 适配层将模式传给请求组装，沿用原取消和期限处理。
  let limits = config.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
  // [KEEP 来自 16.2] 专用摘要不继承执行工具；输出预留也计入摘要自己的本地预算。
  const summaryLimits = () => ({ ...limits, outputReserve: Math.min(limits.outputReserve, 2048) });
  return {
    // [KEEP 来自 18.1] 整项任务固定记忆；保存不在中途替换此引用里的prompt。
    // [KEEP 来自 20.1] TUI与text从同一模型对象取得可信状态。
    memory, skills, hooks, mcp, web, attachments, jobs, worktrees, sharedTasks, languageService, extensions,
    get profile() { return structuredClone(adapter.profile); },
    beginRun() {
      const releaseExtensions = extensions?.beginUse();
      activeRequests += 1; let released = false;
      return () => { if (!released) { released = true; activeRequests -= 1; releaseExtensions?.(); } };
    },
    command(text) {
      if (activeRequests) return { ok: false, message: "任务正在进行；本次切换未执行，请在空闲时重试。" };
      const match = /^\/model(?: (openai|anthropic) ([^\s]{1,200})(?: (images|text))?)?$/.exec(text.trim());
      if (!match) return { ok: false, message: "用法：/model；/model <openai|anthropic> <模型ID> [images|text]。" };
      if (match[1]) {
        try {
          // 重新读取目标协议专用凭据，不继承旧连接的密钥、地址或价格。
          const candidate = readConfig({ provider: match[1], model: match[2] });
          if (match[3]) candidate.imageInput = match[3] === "images";
          const next = createProtocolAdapter(candidate);
          adapter = next; limits = candidate.contextLimits ?? DEFAULT_CONTEXT_LIMITS;
        } catch (error) { return { ok: false, message: error instanceof UserFacingError ? error.message : "模型配置无法创建，旧连接保留。" }; }
      }
      const profile = adapter.profile;
      return { ok: true, message: `当前模型：${profile.provider}/${profile.model}；工具/流式：启用；图片：${profile.capabilities.images ? "本地声明支持" : "未声明支持"}。能力声明仍需服务端验证；历史保留，预算随连接更新。` };
    },
    projectInfo,
    inspectSummary(source) {
      return estimateContext([{ role: "user", content: source }], SUMMARY_PROMPT, [], summaryLimits());
    },
    async summarize(source, signal) {
      return trackRequest(async onRequestStart => {
        signal.throwIfAborted();
        const messages: Message[] = [{ role: "user", content: source }];
        if (!estimateContext(messages, SUMMARY_PROMPT, [], summaryLimits()).withinBudget) throw new UserFacingError("摘要请求本身超出本地预算，未发送。");
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          return await adapter.summarize(source, AbortSignal.any([signal, deadline]), summaryLimits().outputReserve, onRequestStart);
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("摘要超过 60 秒，候选未采用；不会自动重试同一段内容。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
    inspectContext(messages, mode = "execute", scope = {}) {
      const { prompt, definitions } = requestParts(mode, projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web) + (scope.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], scope.allowedTools);
      return estimateContext(messages, prompt, definitions, limits);
    },
    estimateCost(input, output) { return estimateCostUsd(input, output, limits); },
    async generate(messages, signal, onText, options = {}) {
      return trackRequest(async onRequestStart => {
        // [KEEP 来自 15.3] 直接调用模型适配器也执行相同门槛，避免绕过 Agent Loop 发出超本地预算的请求。
        signal.throwIfAborted();
        // [KEEP 来自 19.1] 本次请求固定相同字符串；加载工具完成后下一次请求才重组正文。
        // [KEEP 来自 22.3] 估算和真实发送共用同份已登记来源提示。
        const references = projectPrompt + (memory?.prompt ?? "") + (skills ? skillPrompt(skills) : "") + webPrompt(web);
        const { prompt, definitions } = requestParts(options.mode ?? "execute", references + (options.rolePrompt ?? ""), [...mcpDefinitions(mcp), ...webDefinitions(web)], options.allowedTools);
        const budget = estimateContext(messages, prompt, definitions, limits);
        if (!budget.withinBudget) throw new UserFacingError(`本地上下文预算不足：输入估算 ${budget.inputEstimate} + 输出预留 ${budget.outputReserve} > 窗口 ${budget.windowTokens}。本次请求未发送。`);
        const deadline = AbortSignal.timeout(60_000);
        activeRequests += 1;
        try {
          return await adapter.generate(messages, AbortSignal.any([signal, deadline]), onText, { prompt, definitions, limits, onRequestStart });
        } catch (error) {
          signal.throwIfAborted();
          if (deadline.aborted) throw new UserFacingError("模型响应超过 60 秒，已停止接收。本次请求不会自动重试。");
          throw safeModelError(error);
        } finally { activeRequests -= 1; }
      });
    },
  };
}

/**
 * 为估算与真实发送生成同一套系统提示和可见工具，避免估算漏掉隐藏的请求部分。
 * 模式在本轮固定；这里仅组织数据，不探测服务商窗口，也不产生权限批准。
 */
// [KEEP 来自 21.1] 扩展列表只由本地已建立连接提供。
function requestParts(mode: ExecutionMode, projectPrompt = "", external: ToolDefinition[] = [], allowedTools?: readonly string[]): { prompt: string; definitions: ToolDefinition[] } {
  // [KEEP 来自 12.1] 工具列表帮助模型选择；真正的禁止仍由本地权限策略执行。
  // [KEEP 来自 12.1] Plan 的可见工具列表帮助模型选择，本地策略仍会拒绝禁止请求。
  // [KEEP 来自 15.2] Plan 也可以补读已保存的日志；它仍没有修改文件或执行命令的能力。
  // [KEEP 来自 19.3] Plan仍可读取技能和资源；命令与文件写入继续从工具表移除。
  const definitions = mode === "plan"
    // [KEEP 来自 12.2] Plan 中仍可更新内存清单和等待澄清。
    ? toolDefinitions.filter((tool) => ["code_intelligence", "read_shared_tasks", "read_worktree", "read_file", "read_tool_result", "glob", "grep", "todo_write", "ask_user", "load_skill", "read_skill_resource"].includes(tool.name))
    : [...toolDefinitions, ...external];
  // [KEEP 来自 15.2] 提示模型识别裁剪，并说明完整内容的取回方式。
  const prompt = systemPrompt + " 共享调查先create_shared_tasks登记，再run_shared_tasks等待真实只读子会话。read_shared_tasks查看本地状态；摘要、todo或消息不能更改共享任务终态。" + " 大工具结果只显示头尾，裁剪可能省略重要信息；完整原文保存在本机，必要时使用 read_tool_result 按日志编号、行号和列号读取，不能把磁盘路径直接交给项目 read_file，也不能仅凭被裁掉的输出声称测试成功。 对包含多个步骤的任务，使用 todo_write 保存和更新完整任务清单；同一时刻最多一项执行中。只有依据实际工具结果完成的事项才可标为 completed。缺少会改变实现方案的重要信息时，使用 ask_user 澄清；没有回答时说明缺少的信息，不猜测用户选择。" + (mode === "plan"
    ? " 当前为 Plan 模式：只调查项目并给出可执行的计划，不修改文件、不执行命令。用户要求执行时，请说明需要切换到执行模式。"
    : " 当前为执行模式：按用户任务实施修改，仍需遵守每次工具的本地权限与审批规则。");
  return { prompt: prompt + projectPrompt, definitions: allowedTools ? definitions.filter(tool => allowedTools.includes(tool.name)) : definitions };
}
```

</details>

### src/agent/run-options.ts

目标文件：[src/agent/run-options.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/agent/run-options.ts.md)。

<!-- build-file: src/agent/run-options.ts -->
<details>
<summary>src/agent/run-options.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] agent/run-options.ts
 *
 * 学习目标：传递会话持有的工作区管理器与本地调度选项，模型不能自行选择控制对象。
 * 输入：本地入口选定的模式、会话控制对象、调度限制与本轮交互回调。
 * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
 * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
 * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
 *   本地界面 -> 本轮选项 -> 核心 / 工具 / 模型请求
 * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
 * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
 */
import type { CompactionState } from "../context/compaction.js";
import type { FileCheckpointStore } from "../sessions/file-checkpoints.js";

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

// [KEEP 来自 12.3] 答案只交回正在等待的工具调用；null 表示用户未回答。
/**
 * 这次澄清要显示的问题与选项。
 * 选项可为空，用户仍可自由回答；内容约束由 ask_user 检查。
 */
export type UserQuestion = { question: string; choices: string[] };
/**
 * 界面提供的专用问答等待入口。
 * 返回有效答案或表示未回答的 null；取消和显示失败可拒绝 Promise。
 */
export type QuestionHandler = (request: UserQuestion, signal: AbortSignal) => Promise<string | null>;

// [KEEP 来自 12.4] ID 用于界面确认哪条补充已被核心收取。
/**
 * 核心实际收取的一条补充。
 * ID 供界面确认哪条已加入上下文；所属轮由界面回调闭包固定。
 */
export type QueuedInput = { id: number; text: string };

/**
 * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
 * 省略可选项时使用默认模式或缺省交互；回调仅负责本轮，不能把旧轮补充带进新轮。
 */
// [KEEP 来自 14.2] 写入前的持久化入口属于本地运行控制，不交给模型。
// [KEEP 来自 19.3] 工具使用进程内已发现目录，模型不能自行选择根目录。
export type RunOptions = {
  // [NEW 32.2] 只接受本地绑定的语言服务，不序列化进会话。
  languageService?: import("../language-service/client.js").LanguageService;
  // [KEEP 来自 27.1] 本地入口配置容量；未列入白名单或有 Hooks 的调用仍串行。
  toolConcurrency?: number;
  // [KEEP 来自 27.2] 白名单只读调用从入批开始计排队，从领槽开始计执行；超期后仍等待收尾。
  toolQueueTimeoutMs?: number;
  toolExecutionTimeoutMs?: number;
  // [KEEP 来自 26.1] 作业属于会话，不能从磁盘恢复PID；子任务allowlist仍阻止启动。
  jobs?: import("../processes/jobs.js").JobManager;
  // [KEEP 来自 28.1] 当前CLI持有自有工作区登记，child不继承写入能力。
  worktrees?: import("../workspaces/worktrees.js").WorktreeManager;
  // [KEEP 来自 29.1] 当前会话共享同一登记；回调只由本地Agent Loop绑定。
  sharedTasks?: import("../collaboration/coordinator.js").SharedCoordinator;
  runSharedTasks?: (signal: AbortSignal) => Promise<import("../collaboration/coordinator.js").SharedTask[]>;
  // [KEEP 来自 29.3] worker只能访问本地绑定的任务和租约，模型不能自报身份。
  sharedWorker?: import("../collaboration/coordinator.js").WorkerLease;
  sessionId?: string;
  childSessionDirectory?: string;
  childDepth?: number;
  maxModelCalls?: number;
  allowedTools?: readonly string[];
  delegateTask?: (argumentsJson: string, signal: AbortSignal) => Promise<import("../subagents/runner.js").ChildResult>;
  // [KEEP 来自 21.1] 连接只存内存，不写会话或给模型选择配置路径。
  // [KEEP 来自 22.1] 本地网页启用状态不写会话。
  web?: import("../web/client.js").WebState;
  mcp?: import("../mcp/client.js").McpState;
  skills?: import("../skills/catalog.js").SkillState;
  // [KEEP 来自 18.2] 只由本地记忆控制器提供，候选参数不能改项目范围。
  memoryRoot?: string;
  // [KEEP 来自 16.1] 摘要只改变请求视图；完整消息仍由会话保存。
  context?: CompactionState;
  // [KEEP 来自 15.2] 本机日志目录供写入和受控读取共用；省略时使用用户目录下的固定位置。
  toolResultDirectory?: string;
  fileCheckpoints?: FileCheckpointStore;
  // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
  mode?: ExecutionMode;
  // [KEEP 来自 12.2] 清单容器跨模型请求和工具调用共用。
  tasks?: TaskState;
  // [KEEP 来自 12.3] 问答是被工具等待的控制入口，观察事件不能替代它。
  askUser?: QuestionHandler;
  // [KEEP 来自 12.4] 由核心请求前主动收取，保持当前轮 FIFO 顺序。
  takePendingInputs?: () => QueuedInput[];
  // [KEEP 来自 12.4] 最终回答后只检查是否待处理，不提前移出队列。
  hasPendingInputs?: () => boolean;
};
```

</details>

### src/agent/agent-loop.ts

目标文件：[src/agent/agent-loop.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/agent/agent-loop.ts.md)。

<!-- build-file: src/agent/agent-loop.ts -->
<details>
<summary>src/agent/agent-loop.ts 完整文件</summary>

```typescript
/**
 * 32.2 用语言服务定位符号 | [CHANGED] agent/agent-loop.ts
 *
 * [KEEP 来自 27.1] 工具批 -> 相邻只读段(最多 N 项) -> 串行屏障 -> 本批完成 -> 下一次模型决策。
 * [KEEP 来自 27.2] 排队期限 / 领槽后的执行期限 -> 发停止请求 -> await底层收尾 -> 归还槽。
 * [KEEP 来自 27.3] 每项独立缓冲 -> 同伴全部收尾 -> 按原callID顺序提交整批观察 -> 下一次模型。
 * 学习目标：每项单独保存观察，同伴收尾后按原调用身份提交整批结果，再请求模型。
 * 输入：问题、历史、取消信号、事件消费者和审批入口；模型提供实际输入估算，选项连接队列、文件检查点与工具日志。
 * 输出：回答和服务商累计用量；过程另发本地预算和费用估计，失败补齐工具状态、保留历史后抛错。
 * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
 *
 * 全局主流程（从这里进入各模块）：
 *   [KEEP 来自 29.1–29.3] 父generate -> create/run共享任务工具 -> 固定worker认领 -> 只读子循环
 *       -> 保存关闭 -> 任务快照tool消息 -> 父下一次generate；消息send/read/ack只传线索，不替代任务完成
 *   [KEEP 来自 30.1] CLI schedule create/list -> 本地锁/校验/快照 -> 结束，不加载模型配置
 *   [KEEP 来自 30.2] schedule serve -> 到期且无active？-- 否 -> 等下一tick；是 -> 预算预留落盘 -> 只读runSubagent
 *       -> 工具观察回到子模型 -> runner settle -> 终态写盘 -> 释放active -> 下一tick
 *   [KEEP 来自 30.3] stop -> stopped落盘 -> abort -> await真实settle；显式恢复 -> interrupted/paused，不重放
 *   [KEEP 来自 19.1] 启动discoverSkills -> 名称/用途目录常驻参考，不读正文
 *   [KEEP 来自 19.2] 空闲 /skill review -> 完整读取接纳 -> loaded Map -> 后续system正文
 *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
 *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
 *                                                         +-- 有效 -> 配置、模型、消费者
 *   [KEEP 来自 13.3] text / TUI -> 新建 ID 或锁定、校验并恢复指定会话；jsonl 仍只输出事件
 *   [KEEP 来自 18.1] --memory / 空闲 /memory -> 本地读写项目记忆，不请求模型
 *   [KEEP 来自 13.4] --sessions / --search / --rename / --export -> 本地管理记录，不请求模型
 *   [KEEP 来自 14.1] --fork ID -> 复制可信状态到新 ID；保留来源记录，不继承旧轮占用或授权
 *   [KEEP 来自 14.3] 空闲 /changes、/restore ID -> 查看差异或按当前内容核验后恢复；不执行旧工具
 *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
 *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
 *   [KEEP 来自 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
 *   [KEEP 来自 12.4] TUI Enter -> 正在运行？-- 是 -> 校验补充 -> 记入当前轮 FIFO 队列
 *                                           +-- 否 -> 本地命令或新一轮问题
 *   [KEEP 来自 12.4] Ctrl+S -> 先保存新要求、锁住提交 -> abort 旧轮 -> 等旧 done
 *                   -> 已退出？-- 是 -> 结束；否 -> 新控制器、新一轮（旧队列留存）
 *   [KEEP 来自 12.5] Ctrl+O -> 草稿 / 历史 / 队列；队列 e 编辑、x 撤回、空闲 Enter 发送
 *                  -> 每次按固定 ID 查找；已收取？-- 是 -> 保留编辑稿、可 Ctrl+B 复制
 *                                                   +-- 否 -> 校验后保存原条目
 *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
 *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
 *                                                                   +-- 否 -> 建立本轮消息
 *   [KEEP 来自 18.1] 首次估算前 await memory.refresh -> 失败走X；成功固定本项任务prompt
 *   [KEEP 来自 12.1] 固定本轮模式 -> A
 *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
 *   A: [KEEP 来自 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
 *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 准备完整输入
 *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
 *      [KEEP 来自 15.1] 同一系统提示 + 实际工具定义 + 历史 / 本轮消息 -> UTF-8 启发式估算 -> context_budget
 *      [KEEP 来自 16.3] 输入估算 + 输出预留 <= 本地窗口？-- 否 -> 完整组候选 -> 独立摘要请求（整项用户任务最多两次）
 *           -> 候选仍超限 / 失败 / 取消？-- 是 -> X（原视图与完整记录保留）
 *                                       +-- 否 -> 提交摘要游标，再请求模型
 *                                                      +-- 是 -> 请求模型
 *      [KEEP 来自 15.1] 请求带输出上限；完整响应的服务商 usage -> 累计已知数 / 未知，另算非账单费用
 *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
 *                                                                        +-- 是 -> B
 *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
 *                  |                         +-- 是 -> 保存 assistant 回答
 *                  |  [KEEP 来自 12.4] 仍有补充且未到第 8 次？-- 是 -> A（继续决策）
 *                  |                                              +-- 否 -> 提交历史、返回回答
 *                  |  次数已用完时不取走剩余补充，界面队列仍保留
 *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
 *                                       +-- 否 -> 保存 assistant 调用 -> S
 *   [KEEP 来自 22.3] 已完整取得来源 -> 台账/模型来源提示 -> 最终引用ID检查 -> 本地核验反馈；不自动重试
 *   [KEEP 来自 22.2] 固定搜索endpoint -> 本次查询审批 -> 有界JSON响应 -> 真正返回的URL/摘要 -> 模型
 *   [KEEP 来自 22.1] 明确启用 -> URL/本次审批 -> 单一期限/逐块限额/逐跳校验 -> 真实来源与正文 -> 模型
 *   [KEEP 来自 21.3] close/断线/定义变化 -> 撤下可调用定义；取消先关闭本地传输，远端副作用仍需核实
 *   [KEEP 来自 21.2] HTTP配置 -> HTTPS/loopback校验 -> 固定Bearer环境变量 -> 官方StreamableHTTP
 *   [KEEP 来自 21.1] 显式MCP配置 -> SDK握手 -> 分页发现/命名 -> 模型定义 -> 逐次审批 -> SDK调用/原调用结果
 *   [KEEP 来自 20.1] 审批通过 -> before_tool JSON -> 阻止/失败？-- 是 -> 原调用错误结果；否 -> 工具
 *   S: [KEEP 来自 27.1] 固定 sequence/callID -> 相邻白名单只读段最多 N 项；其他调用为串行屏障
 *       -> 每项分别进入 C；Hooks 启用时整批串行；当前段全部收尾后才进入下一段
 *       -> 全部段收尾 -> 本批观察齐全 -> A
 *   [KEEP 来自 28.1] create/read/run_worktree_command -> 会话自有ID/base/path -> 同一gate -> 实际状态回D
 *   C: 单项调用 -> [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
 *                                                             +-- 否 -> 原有 deny / ask / allow
 *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
 *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
 *                                                             +-- 批准 -> 执行 -> D
 *      [KEEP 来自 18.2] propose_memory -> 完整正文/依据预览 -> allow_once -> 锁内保存
 *                     拒绝/取消不执行闭包；已保存结果回原调用，下一任务才刷新记忆
 *      [KEEP 来自 19.3] load_skill -> 完整接纳Map -> 成功摘要回D -> 下一请求system加入正文
 *      [KEEP 来自 19.3] read_skill_resource -> 已加载技能内有界读取 -> 文字/来源回D
 *                     资源随原toolCallId结果进下一请求；失败同样有结果，取消走X
 *      allow -> 注册表找到工具 -> 执行 -> D
 *        [KEEP 来自 14.2] write_file / edit_file -> 先保存前后内容检查点，成功才实际写入
 *        [KEEP 来自 12.2] todo_write -> 全部条目校验成功？-- 否 -> ToolError、旧清单不变
 *                                                     +-- 是 -> 一次替换内存清单 -> D
 *        [KEEP 来自 12.3] ask_user -> 校验问题 -> 专用 handler 等回答
 *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
 *                                                +-- 否 -> ToolError 或取消 -> D / X
 *                            TUI 面板独占输入；旧请求结束后旧回调失效
 *   [KEEP 来自 20.2] 工具真实结果 -> after_tool -> 追加反馈或失败说明 -> D；取消保留已知结果
 *   D: 单项工具已返回 -> [KEEP 来自 15.2] 正文超过 8000 字符？-- 否 -> 保留正文
 *                                                        +-- 是 -> 写完整本地日志、sync、关闭
 *                                                          -> 成功 -> 6000 头 + 2000 尾 + 省略提示和日志 ID
 *                                                          -> 失败 / 取消 -> 保存已知工具状态与无引用头尾 -> X
 *      [KEEP 来自 15.2] read_tool_result -> 仅按日志 ID、行和列受控续读；错误仍有对应结果
 *      [KEEP 来自 27.1] 保存本项正文 / 裁剪正文、原调用 ID 与错误标记 -> 本项过程事件 -> 返回 S
 *      一批调用全部有结果后才回到下一次模型请求
 *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
 *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
 *   [KEEP 来自 20.3] runAgent -> 非取消的完成/错误 -> stop一次 -> 本地反馈；取消不启动stop
 *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
 *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
 *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
 *   [KEEP 来自 13.1] text / TUI 流清理完 -> Message[] 已提交 -> 白名单检查点 -> 串行 append、sync
 *                  -> 成功 / 保存失败反馈（模型结果另行显示）；TUI done 此后才解除占用
 *   [KEEP 来自 13.1] reset / 有效 mode / 队列编辑撤回 -> 白名单检查点；Enter 入队仍只改内存
 *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
 *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
 *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
 *   [KEEP 来自 13.1] 退出 -> 封住提交、取消并等清理 -> 最终检查点 -> close -> TUI 卸载 / text 返回
 *
 * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
 * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
 * 模型取得有省略提示的工具正文，完整正文保存在受控日志中；聊天、问答或模式选择不能产生批准。
 * 运行观察：读取按调用身份显示进度；串行屏障等待当前读取段收尾，本批观察齐全后模型才继续。
 */

// [KEEP 来自 20.1] 钩子在原审批完成后运行，不能创造批准。
// [KEEP 来自 21.1] 每次调用重新检查当前定义是否可用。
// [KEEP 来自 22.1] 网页也使用同一条审批与原调用结果通道。
import { randomUUID } from "node:crypto";
import { ChildBudgetError, runSubagent } from "../subagents/runner.js";
import { webDefinitions, citationFeedback } from "../web/client.js";
import { mcpDefinitions } from "../mcp/client.js";
import { runHooks } from "../hooks/lifecycle.js";
import { emptyCompaction, prepareCompaction, requestMessages } from "../context/compaction.js";
import { explainError, ToolError, UserFacingError } from "../errors.js";
import { boundToolResult, clippedToolText } from "../context/tool-results.js";
import { requestFailedBeforeSending, type Message, type Model, type ModelResult, type Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
// [KEEP 来自 29.1] 共享调度仍用同一权限/工具/模型返回链路。
import { runSharedTasks } from "../collaboration/runner.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import type { RunOptions } from "./run-options.js";
// [KEEP 来自 27.1] 原单项权限链由调度器调用，相邻白名单读取才共用有限容量。
import { runToolBatch, validateBatch } from "./tool-batch.js";

const MAX_MODEL_CALLS = 8;

/**
 * 把新一次模型调用的 token 数累加到本轮总量。
 *
 * - 输入：当前累计值和本次调用值；任一值都可能是表示未知的 `null`。
 * - 输出：两项都已知时返回和；任一项未知时返回 `null`。
 * - 关键原因：部分缺失的数据不能计算出真实总量，继续显示数字会造成误导。
 */
function addUsage(total: number | null, value: number | null): number | null {
  return total === null || value === null ? null : total + value;
}

/**
 * 让模型读到问题和真实工具结果，继续决策直到本轮完成或中断。
 * 进入前先检查取消；本轮模式在入口固定，模型提示与权限策略都使用它。
 * 清单容器在这轮工具之间共用；工具完整校验后更新内存，核心不从回答文字推断进度。
 * 每次模型请求前取出当前轮 FIFO 补充，加入本轮消息；上一批工具先全部产生结果。
 * 最终回答后还有补充且未用尽 8 次请求时继续；用尽次数不收取剩余补充。
 * 每个工具先过权限，写入与命令先准备再审批；拒绝和 ToolError 也回给原调用。
 * ask_user 通过注册表等待专用 handler，答案仍是该次工具结果。
 * 成功提交完整本轮消息并返回回答；开始后中断则补齐工具结果、保存说明，再抛出原因。
 * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
 */
// [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
// [KEEP 来自 25.3] 只把子状态转发给父观察者，子文字留在子历史。
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 增加本轮控制选项；调用方把模式快照传到核心。
  options: RunOptions = {},
): Promise<Reply> {
  signal.throwIfAborted();
  const releaseRun = model.beginRun?.();
  // [KEEP 来自 24.1] 验证失败尚未提交 user 消息，也不取走 pending；结束时释放切换锁。
  try { await model.attachments?.preflight(signal, model.profile?.capabilities.images === true); }
  catch (error) { releaseRun?.(); throw error; }
  // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
  const mode = options.mode ?? "execute";
  const maxModelCalls = Math.min(MAX_MODEL_CALLS, Math.max(1, Math.floor(options.maxModelCalls ?? MAX_MODEL_CALLS)));
  const parentSessionId = options.sessionId ?? randomUUID();
  let childCount = 0;
  // [KEEP 来自 16.1] 会话可复用摘要游标，离线调用者未提供时只在本轮持有。
  const context = options.context ?? emptyCompaction();
  // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
  // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
  // [KEEP 来自 19.3] 两个只读技能工具共享本模型的已加载集合；审批与Plan仍走原策略。
  // [KEEP 来自 28.1] 本轮采用CLI对象持有的自有工作区登记；不把Git身份写进会话恢复状态。
  // [NEW 32.2] 语言服务是会话对象，工具只接收本地绑定的引用。
  const toolOptions: RunOptions = { ...options, jobs: model.jobs ?? options.jobs, worktrees: model.worktrees ?? options.worktrees, sharedTasks: model.sharedTasks ?? options.sharedTasks, languageService: model.languageService ?? options.languageService, mcp: model.mcp, web: model.web, skills: model.skills, memoryRoot: model.memory?.root, tasks: options.tasks ?? { items: [] } };
  toolOptions.delegateTask = async (argumentsJson, childSignal) => {
    if (options.childDepth || ++childCount > 3) throw new ToolError("每轮最多三个只读子任务，子任务不能继续委派。");
    return runSubagent(model, argumentsJson, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory, requestApproval, depth: options.childDepth ?? 0,
      // [KEEP 来自 25.3] 子增量和模型编号不混入父流；结构化状态与最终工具结果分别转交。
      observer: event => { if (event.type === "child_state") emitAgentEvent(observer, event); },
    });
  };
  // [KEEP 来自 27.1] 多个只读调用可能请求敏感文件审批；同一界面一次只显示一个批准请求。
  let approvalTail = Promise.resolve();
  const orderedApproval: ApprovalHandler = async (request, approvalSignal) => {
    const previous = approvalTail;
    let release!: () => void;
    approvalTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { approvalSignal.throwIfAborted(); return await requestApproval!(request, approvalSignal); }
    finally { release(); }
  };
  // [KEEP 来自 29.1] 等所有worker子会话收尾后返回，结果继续成为tool消息进入下一次generate。
  toolOptions.runSharedTasks = childSignal => {
    if (options.childDepth || mode === "plan" || !toolOptions.sharedTasks) throw new ToolError("当前模式或子层不能启动共享worker。");
    return runSharedTasks(model, toolOptions.sharedTasks, childSignal, { parentSessionId, sessionDirectory: options.childSessionDirectory,
      requestApproval: requestApproval ? orderedApproval : undefined, observer });
  };
  const attachments = model.attachments?.take();
  const turn: Message[] = [{ role: "user", content: input, ...(attachments?.length ? { attachments } : {}) }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let cachedInputTokens: number | null = 0, cacheWriteTokens: number | null = 0;
  // [KEEP 来自 23.3] 已发送但未收齐结果时，累计值不能继续冒充整轮总量；未发送的预检拒绝保留旧值。
  const incompleteUsage = (call: number, error: unknown) => {
    if (requestFailedBeforeSending(error)) return;
    inputTokens = outputTokens = cachedInputTokens = cacheWriteTokens = null;
    emitAgentEvent(observer, { type: "model_usage", call, inputTokens, outputTokens,
      costEstimateUsd: null, cachedInputTokens, cacheWriteTokens });
  };
  let toolSequence = 0;
  let pendingToolResults = 0;
  // [KEEP 来自 16.3] 整项用户任务至多两次摘要请求，独立于八次普通决策；候选不原地修改会话。
  let compactionAttempts = 0;

  // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
  // [KEEP 来自 27.1] 并发时可能同时有多个尚未返回结果的调用。
  const executingCallIds = new Set<string>();
  try {
    // [KEEP 来自 18.1] 首次估算前刷新；本项任务后续请求继续共用这份记忆快照。
    await model.memory?.refresh(signal);
    for (let modelCall = 1; modelCall <= maxModelCalls; modelCall += 1) {
      // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
      signal.throwIfAborted();

      // [KEEP 来自 12.4] 每次请求前收取当前轮 FIFO 补充；上一批调用已有完整工具结果。
      for (const queued of options.takePendingInputs?.() ?? []) {
        turn.push({ role: "user", content: queued.text });
        // [KEEP 来自 12.4] 此事件只确认核心已收取并加入本次上下文，不保证远端收到。
        emitAgentEvent(observer, { type: "input_applied", ...queued, call: modelCall });
      }
      signal.throwIfAborted();
      // [KEEP 来自 15.1] 补充已经加入，工具已完成；估算的正是即将发出的整份输入。
      let messages = requestMessages([...history, ...turn], context, toolOptions.tasks?.items);
      let budget = model.inspectContext?.(messages, mode);
      if (budget) emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
      // [KEEP 来自 16.3] 摘要先进入候选，只有最终普通请求也适配预算，才一次提交新的请求视图。
      if (budget && !budget.withinBudget) {
        const candidate = { ...context };
        try {
          while (!budget.withinBudget && compactionAttempts < 2) {
            compactionAttempts += 1;
            emitAgentEvent(observer, { type: "compaction_start", attempt: compactionAttempts });
            const prepared = await prepareCompaction(model, [...history, ...turn], candidate, signal, mode,
              toolOptions.tasks?.items, result => {
                inputTokens = addUsage(inputTokens, result.inputTokens);
                outputTokens = addUsage(outputTokens, result.outputTokens);
                cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
                cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
                emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
                  costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
              }, error => incompleteUsage(modelCall, error));
            Object.assign(candidate, prepared.state);
            messages = requestMessages([...history, ...turn], candidate, toolOptions.tasks?.items);
            budget = model.inspectContext!(messages, mode);
            emitAgentEvent(observer, { type: "compaction_candidate", attempt: compactionAttempts,
              before: prepared.before, after: prepared.after, through: candidate.through });
          }
          signal.throwIfAborted();
          if (!budget.withinBudget) throw new UserFacingError("本项任务的摘要次数已用尽，请求仍超出本地预算；候选未采用，完整记录保留。");
          Object.assign(context, candidate);
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "applied", through: context.through });
          emitAgentEvent(observer, { type: "context_budget", call: modelCall, budget });
        } catch (error) {
          emitAgentEvent(observer, { type: "compaction_finish", outcome: "retained",
            message: signal.aborted ? "压缩已取消，旧请求视图和完整记录保留。" : explainError(error) });
          throw error;
        }
      }
      emitAgentEvent(observer, {
        type: "model_start",
        call: modelCall,
        contextMessages: messages.length,
        trigger: modelCall === 1
          ? { kind: "user", content: input }
          : { kind: "tool_results", count: pendingToolResults },
      });
      pendingToolResults = 0;
      // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
      // [KEEP 来自 12.1] 模型请求也接收本轮模式；工具隐藏只是辅助。
      let result: ModelResult;
      try {
        result = await model.generate(messages, signal, (text) => {
          if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });
        }, { mode });
      } catch (error) { incompleteUsage(modelCall, error); throw error; }
      inputTokens = addUsage(inputTokens, result.inputTokens);
      outputTokens = addUsage(outputTokens, result.outputTokens);
      truncated ||= result.truncated;
      cachedInputTokens = addUsage(cachedInputTokens, result.cachedInputTokens ?? null);
      cacheWriteTokens = addUsage(cacheWriteTokens, result.cacheWriteTokens ?? null);
      // [KEEP 来自 15.1] 任一次 usage 缺失后累计值保持未知，不以估算补充；费用只按用户配置计算。
      emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens,
        costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null, cachedInputTokens, cacheWriteTokens });
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
        // [KEEP 来自 22.3] 不编造修复后的引用；本地核验反馈随最终结果显示并保存。
        const feedback = citationFeedback(model.web, result.text);
        const finalText = result.text + (feedback ? `\n\n${feedback}` : "");
        turn.push({ role: "assistant", content: finalText });

        // [KEEP 来自 12.4] 最终回答后仍有补充且有请求预算就继续；第 8 次后的剩余条目保留。
        if (modelCall < maxModelCalls && options.takePendingInputs && options.hasPendingInputs?.()) continue;
        history.push(...turn);
        return { text: finalText, inputTokens, outputTokens, truncated, cachedInputTokens, cacheWriteTokens };
      }

      // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
      if (modelCall === maxModelCalls) break;

      // [KEEP 来自 27.1] 先固定编号，后续完成乱序不会改变调用身份；副作用与依赖工具是屏障。
      const items = result.toolCalls.map((call, index) => ({ call, sequence: toolSequence + index + 1 }));
      // [KEEP 来自 27.3] 无法配对的响应尚未进入历史，也没有工具开始。
      validateBatch(items);
      turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      toolSequence += items.length;
      const observations = new Map(items.map(item => [item.call.id, [] as Message[]]));
      let batchFailed = false, batchError: unknown;
      try {
      await runToolBatch(items, signal, async ({ call, sequence }, callSignal) => {
        // [KEEP 来自 27.3] 同伴不会写进本项数组；完成顺序仅影响即时事件。
        const callMessages = observations.get(call.id)!;
        callSignal.throwIfAborted();
        // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
        const permission = options.allowedTools && !options.allowedTools.includes(call.name)
          ? { action: "deny" as const, reason: `子任务不允许工具：${call.name}` }
          : await decideToolPermission(call, sessionGrants, undefined, mode, new Set([...mcpDefinitions(model.mcp), ...webDefinitions(model.web)].map(tool => tool.name)));
        emitAgentEvent(observer, {
          type: "permission_check",
          sequence,
          call,
          decision: permission,
        });
        let rejection: string | null = null;
        let prepared: PreparedToolCall | null = null;
        // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
        callSignal.throwIfAborted();
        if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
        if (permission.action === "ask") {
          try {
            // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
            // [KEEP 来自 14.2] 把本地文件检查点入口传到写入准备层。
            prepared = await prepareTool(call, callSignal, toolOptions);
          } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            callMessages.push({
              role: "tool",
              toolCallId: call.id,
              content: `工具准备失败：${error.message}`,
              isError: true,
            });
            pendingToolResults += 1;
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence,
              call,
              outcome: "error",
              error: error.message,
            });
            return false;
          }
          if (prepared) {
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence,
              call,
              outcome: "success",
              previewChars: prepared.preview.length,
            });
          }
          emitAgentEvent(observer, {
            type: "approval_start",
            sequence,
            call,
            scope: permission.scope,
            allowSession: permission.remember,
            hasPreview: prepared !== null,
          });
          const response = requestApproval
            ? await orderedApproval({
                call,
                reason: permission.reason,
                resource: permission.resource,
                scope: permission.scope,
                allowSession: permission.remember,
                ...(prepared ? { preview: prepared.preview } : {}),
              }, callSignal)
            : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
          // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
          callSignal.throwIfAborted();
          emitAgentEvent(observer, {
            type: "approval_finish",
            sequence,
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
          callMessages.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
          pendingToolResults += 1;
          return false;
        }
        // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
        callSignal.throwIfAborted();
        executingCallIds.add(call.id);
        emitAgentEvent(observer, { type: "tool_start", sequence, call });
        try {
          // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
          // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
          // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
          // [KEEP 来自 20.1] 取消或before失败时尚未启动工具。
          if (mode !== "plan") {
            const before = await runHooks(model.hooks, "before_tool", { call }, callSignal);
            if (before.blocked) throw new ToolError(`执行前钩子阻止工具：${before.messages.join("\n") || "脚本拒绝"}`);
          }
          let result = prepared
            ? await executePreparedTool(prepared, callSignal, toolOptions)
            : await executeTool(call, callSignal, toolOptions);
          if (result.metadata.kind === "subagent") {
            const childUsage = result.metadata.result.usage;
            inputTokens = addUsage(inputTokens, childUsage.inputTokens); outputTokens = addUsage(outputTokens, childUsage.outputTokens);
            cachedInputTokens = addUsage(cachedInputTokens, childUsage.cachedInputTokens); cacheWriteTokens = addUsage(cacheWriteTokens, childUsage.cacheWriteTokens);
            emitAgentEvent(observer, { type: "model_usage", call: modelCall, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, costEstimateUsd: model.estimateCost?.(inputTokens, outputTokens) ?? null });
          }
          if (result.metadata.kind === "subagent" && callSignal.aborted) {
            callMessages.push({ role: "tool", toolCallId: call.id, content: result.content, isError: true });
            executingCallIds.delete(call.id);
            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result });
            callSignal.throwIfAborted();
          }
          // [KEEP 来自 20.2] 保存真实结果后才运行后置钩子；失败只追加说明，绝不把已执行改成未执行。
          if (mode !== "plan") {
            try {
              const after = await runHooks(model.hooks, "after_tool", { call, result: result.content.slice(0, 8000), outcome: result.isError ? "error" : "success" }, callSignal);
              if (after.messages.length) result = { ...result, content: `${result.content}\n\n[本地执行后钩子反馈；不是权限]\n${after.messages.join("\n")}` };
            } catch (error) {
              if (!(error instanceof ToolError)) {
                callMessages.push({ role: "tool", toolCallId: call.id, content: result.content + "\n[本地状态] 后置钩子中断；工具已返回，副作用未撤销。", isError: result.isError ?? false });
                executingCallIds.delete(call.id);
                throw error;
              }
              result = { ...result, content: `${result.content}\n[本地执行后钩子失败] ${error.message}` };
            }
          }
          // [KEEP 来自 15.2] 工具已返回，执行状态已知；日志保存失败也不能把它改写成“未执行”。
          executingCallIds.delete(call.id);
          let modelContent: string;
          try { modelContent = (await boundToolResult(result.content, callSignal, options.toolResultDirectory)).content; }
          catch (error) {
            // 原工具的错误标记保持不变；给本次调用留下明确摘要，不声明不存在的日志引用。
            const content = `[本地状态：工具已返回，但完整日志未保存；本轮停止，以下仅为头尾，不能找回被省略部分]\n${clippedToolText(result.content)}`;
            callMessages.push({ role: "tool", toolCallId: call.id, content, isError: result.isError ?? false });
            emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "success", result: { ...result, content } });
            throw error;
          }
          // [KEEP 来自 07.1] 非零退出码仍是错误；裁剪不改变原调用编号或成功/失败。
          callMessages.push({ role: "tool", toolCallId: call.id, content: modelContent, isError: result.isError ?? false });
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence,
            call,
            outcome: "success",
            result: { ...result, content: modelContent },
          });
          // [KEEP 来自 27.1] 工具返回的错误标记也决定调度终态，避免 succeeded 覆盖界面失败状态。
          return !result.isError;
        } catch (error) {
          // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
          if (!(error instanceof ToolError)) throw error;
          callMessages.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具执行失败：${error.message}`,
            isError: true,
          });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallIds.delete(call.id);
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence,
            call,
            outcome: "error",
            error: error.message,
          });
          return false;
        }
      }, (item, state) => emitAgentEvent(observer, { type: "tool_state", ...item, state }),
      // [KEEP 来自 27.2] 超时与取消交代原调用身份；已返回的真实结果保留并补充本地状态。
      { concurrency: options.toolConcurrency, serial: Boolean(model.hooks),
        queueTimeoutMs: options.toolQueueTimeoutMs, executionTimeoutMs: options.toolExecutionTimeoutMs,
        onFailure: ({ call, sequence }, failure) => {
          // [KEEP 来自 27.3] 超时/取消也填入同一项；真实结果已返回时追加状态，不重复一份消息。
          const callMessages = observations.get(call.id)!;
          const last = callMessages[callMessages.length - 1];
          if (last?.role === "tool") { last.content += `\n[本地状态] ${failure.message}`; last.isError = true; }
          else { callMessages.push({ role: "tool", toolCallId: call.id, content: failure.message, isError: true }); pendingToolResults += 1; }
          executingCallIds.delete(call.id);
          emitAgentEvent(observer, { type: "tool_finish", sequence, call, outcome: "error", error: last?.role === "tool" ? last.content : failure.message });
        },
      });
      } catch (error) { batchFailed = true; batchError = error; }
      finally {
        // [KEEP 来自 27.3] 即使父取消或同伴异常，也先提交已取得的真实结果及未启动交代。
        for (const { call } of items) turn.push(...observations.get(call.id)!);
        pendingToolResults = items.length;
        emitAgentEvent(observer, { type: "tool_batch_finish", call: modelCall,
          results: items.length, interrupted: batchFailed });
      }
      if (batchFailed) throw batchError;

    }

    if (options.childDepth) throw new ChildBudgetError("子任务已用尽模型决策次数，尚未得到完整最终回答。");
    throw new UserFacingError(`Agent 连续请求模型 ${maxModelCalls} 次仍未得到最终回答，已停止本轮。`);
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
          content: executingCallIds.has(call.id)
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
  } finally { releaseRun?.(); }
}
```

</details>

### src/cli.ts

目标文件：[src/cli.ts](/content/chapter-32-code-intelligence/02-lsp-navigation/src/cli.ts.md)。

<!-- build-file: src/cli.ts -->
<details>
<summary>src/cli.ts 完整文件</summary>

```typescript
#!/usr/bin/env node
/**
 * 32.2 用语言服务定位符号 | [CHANGED] cli.ts
 *
 * 学习目标：提供本地停用、卸载与静态诊断，退出时先等资源关闭再释放安装锁。
 * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
 * 输出：装配模型后选择一个消费者；入口错误由 stderr 说明并设置 exitCode=1。
 * 状态：入口不持有消息历史或授权；只创建 writer，消费者提供白名单快照。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP 来自 30.1] argv[2]=schedule？-- 是 -> 独立定时管理 -> 结束；否 -> 普通聊天入口
 *   显式网页/搜索选项且非 Plan？-- 是 -> 完整校验本地配置 -> 创建 WebState；否 -> 不启用网页
 *   配置失败 -> 启动错误；配置成功只装配工具，不提前抓取或查询
 *   [KEEP 来自 18.1] --memory -> 检查混用和模式 -> 找真实项目根 -> 本地管理 -> 结束
 *   [KEEP 来自 19.1] 正常启动 -> 同根discoverSkills -> 只把名称/用途交给模型和启动信息
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
 *   [KEEP 来自 13.1] text / tui -> 创建新会话文件、显示 ID 和路径 -> 消费者 -> finally close
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
 * [KEEP 来自 12.1] --mode plan|execute 在创建模型前校验，再传给每种消费者。
 * [KEEP 来自 12.2] 非 TUI 入口为当前会话准备共用清单；TUI 在 startTui 内创建自己的清单。
 * 运行观察：直接在交互终端启动会进入 TUI；单次提问、管道和 dumb 终端仍走 text。
 */
// [KEEP 来自 31.3] 无需密钥的管理入口及显式启动、退出收尾。


// [KEEP 来自 18.1] 本地记忆动作在模型配置与会话创建前完成。
// [KEEP 来自 20.1] 项目脚本必须由本次启动显式启用。
// [KEEP 来自 21.1] 显式配置授权启动服务，退出始终关闭本次连接。
// [KEEP 来自 22.1] 网络开关不读取网页或会话里的指令。
// [NEW 32.2] 本地代码入口不读取模型密钥。
import { runCodeCommand } from "./code-command.js";
import { loadWeb } from "./web/client.js";
import { runScheduleCommand } from "./schedules/commands.js";
import { ExtensionManager } from "./extensions/manager.js";
import { extensionCommand } from "./extensions/commands.js";
import { connectMcp, mcpInfo } from "./mcp/client.js";
import { loadHooks } from "./hooks/lifecycle.js";
// [KEEP 来自 19.1] 固定项目目录发现元信息，不加载正文。
import { discoverSkills, skillInfo } from "./skills/catalog.js";
import { createMemoryController, memoryCommand } from "./memory/commands.js";
import { findProjectRoot } from "./project/instructions.js";
import { dirname } from "node:path";
// [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
import { readFileSync } from "node:fs";
// [KEEP 来自 13.3] 使用真实目录比较工作区，符号链接别名不会误判成另一个项目。
import { forkSessionWriter } from "./sessions/fork-session.js";
import { realpath } from "node:fs/promises";
import { Command } from "commander";
import { readConfig, type Options } from "./config/load-config.js";
import { createModel } from "./models/client.js";
import type { ExecutionMode, RunOptions } from "./agent/run-options.js";
// [KEEP 来自 09.3] 机器输出也调用相同的 Agent 事件流。
import { runJsonlPrompt } from "./ui/jsonl.js";
import { runSinglePrompt, startTerminal } from "./ui/terminal.js";
import { UserFacingError, explainError } from "./errors.js";
// [KEEP 来自 13.1] 入口创建并最终关闭 writer，模型配置不进入存储模块。
import { createSessionWriter, resumeSessionWriter } from "./sessions/save-session.js";
// [KEEP 来自 13.4] 本地管理复用读取与写入协议，无需模型配置。
import { listSessions, renameSession, exportSession } from "./sessions/manage-sessions.js";

// [KEEP 第 01 章] 构建产物始终是 dist/cli.js，因此从它的上一级读取 package.json。
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// [KEEP 来自第 01 章练习] 环境诊断不读取模型配置，也不会发送模型请求。
/**
 * 显示当前 Node.js 进程的最小诊断信息，不读取模型配置。
 *
 * - 输入：无显式参数；版本、平台、架构和工作目录都来自 Node.js 的 `process`。
 * - 输出：向终端依次打印 Node、Platform 和 Working directory 三行文本。
 * - 关键原因：诊断发生在 `readConfig()` 之前，因此缺少 API Key 时也能运行。
 * - 职责边界：不读取 `.env`，不创建模型客户端，也不发送网络请求。
 */
function printDoctor(): void {
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Working directory: ${process.cwd()}`);
}
// [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
// [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
type CliOptions = Options & { extension?: string[]; enableExtension?: string[]; enableProjectHooks?: boolean; mcpConfig?: string; mcpInfo?: boolean; enableWeb?: boolean; webSearchConfig?: string;  memory?: string; projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
const program = new Command();
program
  // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
  .name("hello-my-agent")
  .description("你好，我的 Agent：从 0 到 npm 发布")
  .version(packageJson.version, "-v, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
  // [KEEP 来自 20.1] 仅这次启动授权项目生命周期脚本；恢复会话不恢复启用状态。
  // [KEEP 来自 21.1] 不自动读取仓库中的MCP启动命令。
  // [KEEP 来自 22.1] 启用仅注册，真正GET仍逐次审批。
  // [KEEP 来自 22.2] 提供配置也明确启用网页工具；无提供方不注册web_search。
  .option("--web-search-config <path>", "配置JSON GET搜索提供方(endpoint/queryParam/tokenEnv)")
  .option("--enable-web", "明确启用逐次审批的网页抓取工具")
  .option("--extension <command...>", "本地扩展管理：list/install/diagnose/uninstall，无需模型密钥")
  .option("--enable-extension <id...>", "仅本进程明确启用列出的已安装扩展；可能启动脚本和服务")
  .option("--mcp-config <path>", "明确启用指定MCP配置（会启动或连接其中的服务）")
  .option("--mcp-info", "连接、发现并诊断指定MCP配置后退出，无需模型密钥")
  .option("--enable-project-hooks", "明确启用项目 .hello-my-agent/hooks.json 中的脚本")
  .option("--doctor", "显示当前运行环境")
  // [KEEP 来自 17.3] 本地检查在读取模型配置和创建会话之前完成。
  .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
  // [KEEP 来自 18.1] 显式管理命令无需API Key。
  .option("--memory <command>", "本地项目记忆：list、show <id>、add <正文>、edit <id> <正文>、invalidate <id> <理由>、delete <id>")
  // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
  .option("--model <id>", "本次使用的模型 ID")
  .option("--base-url <url>", "本次使用的接口基础地址")
  // [KEEP 来自 02.2] 单次提问；02.4 增加连续输入后仍保留此用法。
  .option("--prompt <text>", "提问一次后退出")
  // [KEEP 来自 02.5] 本次启动选择接口协议。
  .option("--provider <type>", "接口协议：openai 或 anthropic")
  // [KEEP 来自 10.4] 默认值改为 auto；显式 text、tui、jsonl 仍由用户选择。
  .option("--output <format>", "输出格式：auto、tui、text 或 jsonl", "auto")
  // [KEEP 来自 12.1] 增加启动模式选项，默认 execute。
  .option("--mode <mode>", "模式：plan 或 execute（新会话默认 execute，恢复沿用已保存模式）")
  // [KEEP 来自 13.1] text / tui 保存新会话；JSONL 机器事件流暂不接入。
  .option("--session-dir <path>", "text / tui 的会话保存目录（默认 ~/.hello-my-agent/sessions）")
  // [KEEP 来自 13.3] 恢复需要明确 ID；恢复中断需再明确 --recover。
  // [KEEP 来自 14.1] fork 创建新身份；resume 继续旧身份。
  .option("--fork <id>", "从指定会话的最后完整状态创建新分支，不重放工具")
  .option("--resume <id>", "恢复指定会话，等待新输入；不重放旧工具")
  .option("--recover", "确认恢复已中断会话或清理已失效的进程锁")
  // [KEEP 来自 13.4] 显式管理动作在读取模型配置前完成。
  .option("--sessions", "列出本地会话，可配合 --search")
  .option("--search <text>", "在会话 ID、名称、工作区和已保存消息中搜索")
  .option("--rename <id>", "给指定会话追加名称，需要 --name")
  .option("--name <text>", "会话名称，1—80 个字符")
  .option("--export <id>", "将指定会话导出为 Markdown，默认输出到 stdout")
  .option("--export-to <path>", "导出到一个尚不存在的文件，需要 --export")
  // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
  .action(async () => {
    const options = program.opts<CliOptions>();
    // [KEEP 来自 18.1] 管理动作拒绝混用提问、会话和连接选项；Plan只可查询。
    if (options.memory !== undefined) {
      if (options.prompt !== undefined || options.projectInfo || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.output !== "auto" || options.sessionDir !== undefined || options.resume !== undefined || options.recover
        || options.fork !== undefined || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--memory请单独使用，可配合--mode plan查询。");
      if (!["execute", "plan"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode只能是plan或execute。");
      console.log(await memoryCommand(findProjectRoot(), options.memory, options.mode as ExecutionMode | undefined));
      return;
    }
    // [KEEP 来自 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
    if (options.projectInfo) {
      if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
        || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
        || options.sessionDir !== undefined || options.resume !== undefined || options.recover || options.fork !== undefined
        || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--project-info 请单独使用，不与提问、模型、模式、会话或输出选项混用。 ");
      const project = await loadProjectInstructions();
      for (const line of projectInstructionInfo(project)) console.log(line);
      return;
    }
    // [KEEP 来自 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
    const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
    if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
    if (options.search !== undefined && !options.sessions) throw new UserFacingError("--search 必须与 --sessions 一起使用。");
    if (options.name !== undefined && options.rename === undefined) throw new UserFacingError("--name 必须与 --rename <id> 一起使用。");
    if (options.exportTo !== undefined && options.export === undefined) throw new UserFacingError("--export-to 必须与 --export <id> 一起使用。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (management) {
      if (options.fork !== undefined || options.resume !== undefined || options.recover || options.prompt !== undefined || options.doctor
        || options.mode !== undefined || options.model !== undefined || options.provider !== undefined || options.baseUrl !== undefined || options.output !== "auto") {
        throw new UserFacingError("本地会话管理请单独使用，不与恢复、提问、模型或输出模式选项混用。");
      }
      if (options.sessions) {
        const result = await listSessions(options.sessionDir, options.search);
        for (const warning of result.warnings) console.error(`会话提示：${warning}`);
        if (!result.sessions.length) console.log("没有匹配的本地会话。");
        for (const session of result.sessions) console.log(`${session.id}  ${session.name}\n  ${session.updatedAt} · ${session.messages} 条消息 · ${session.pending} 条待交付${session.interrupted ? " · 上次中断" : ""}\n  ${session.cwd}`);
      } else if (options.rename !== undefined) {
        if (options.name === undefined) throw new UserFacingError("--rename <id> 需要 --name <text>。");
        const seq = await renameSession(options.rename, options.name, options.sessionDir);
        console.log(`名称已保存：${options.rename} · 第 ${seq} 条记录。`);
      } else {
        const markdown = await exportSession(options.export!, options.sessionDir, options.exportTo);
        if (options.exportTo === undefined) process.stdout.write(markdown);
        else console.log(`已导出：${options.exportTo}`);
      }
      return;
    }
    // [KEEP 来自 21.1] 本地诊断在readConfig前完成，不需要模型凭据。
    if (options.mcpInfo) {
      if (!options.mcpConfig) throw new UserFacingError("--mcp-info 需要 --mcp-config <path>。");
      const mcp = await connectConfiguredMcp(options.mcpConfig, findProjectRoot());
      try { for (const line of mcpInfo(mcp)) console.log(line); } finally { await mcp?.close(); }
      return;
    }
    // [KEEP 来自 31.1] 本地安装与诊断无需模型凭据，完成后一定关闭管理器。
    if (options.extension) {
      if (options.enableExtension || options.prompt || options.resume || options.fork || options.mcpConfig || options.enableProjectHooks) throw new UserFacingError("--extension 不与运行或其他能力启用参数混用。");
      if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
      if (options.extension[0] === "enable") throw new UserFacingError("独立管理命令不保留进程；请用 --enable-extension <id...> 启动，或在会话中 /extension enable <id>。");
      const root = findProjectRoot(), manager = new ExtensionManager(root, await discoverSkills(root));
      const controller = new AbortController(), cancel = () => controller.abort(new UserFacingError("扩展操作已取消。"));
      process.once("SIGINT", cancel);
      try { console.log(await extensionCommand(options.extension, manager, options.mode ?? "execute", controller.signal)); }
      finally { process.removeListener("SIGINT", cancel); await manager.close(); }
      return;
    }
    if (options.doctor) {
      printDoctor();
      return;
    }
    // [KEEP 来自 12.1] 创建模型前检查模式，非法值不会启动任务。
    if (!["plan", "execute"].includes(options.mode ?? "execute")) throw new UserFacingError("--mode 只能是 plan 或 execute。");
    let mode: ExecutionMode = options.mode === "plan" ? "plan" : "execute";
    // [KEEP 来自 12.1] 把启动模式传到 text、JSONL 和连续会话入口。
    // [KEEP 来自 12.2] 非 TUI 入口创建共用清单；TUI 在自己的会话内创建。
    const runOptions: RunOptions = { mode, tasks: { items: [] } };
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
    // [KEEP 来自 13.1] 在创建模型和文件前拒绝不支持的组合与空问题。
    if (options.output === "jsonl" && options.sessionDir !== undefined) throw new UserFacingError("--session-dir 只支持 text 或 tui；JSONL 机器输出暂不保存会话。");
    if (options.recover && options.resume === undefined) throw new UserFacingError("--recover 必须与 --resume <id> 一起使用。");
    if (options.resume !== undefined && options.output === "jsonl") throw new UserFacingError("会话恢复只支持 text 或 tui。");
    if (options.sessionDir !== undefined && !options.sessionDir.trim()) throw new UserFacingError("--session-dir 不能为空。");
    if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
    // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
    if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
    // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
    if (options.enableExtension?.length && (mode === "plan" || options.resume || options.fork)) throw new UserFacingError("启动启用扩展仅支持新的execute会话；恢复后请在本地明确启用。");
    const project = await loadProjectInstructions();
    const config = readConfig(options);
    // [KEEP 来自 18.1] 初始记忆供界面估算，正式任务开始时会重新加载并冻结。
    const memory = await createMemoryController(project.root);
    const skills = await discoverSkills(project.root);
    // [KEEP 来自 20.1] Plan不读取/运行钩子；执行模式没有显式开关也不读取。
    const hooks = await loadHooks(project.root, Boolean(options.enableProjectHooks) && mode !== "plan");
    // [KEEP 来自 21.1] Plan不启动本地服务；恢复与新启动都必须再次显式选择。
    const mcp = mode === "plan" ? undefined : await connectConfiguredMcp(options.mcpConfig, project.root);
    const extensions = new ExtensionManager(project.root, skills, hooks, mcp);
    let model: ReturnType<typeof createModel> | undefined;
    try {
    // [KEEP 来自 31.2] 启动显式启用也接收Ctrl+C；只在资源收尾后离开初始化阶段。
    const extensionAbort = new AbortController(), cancelExtension = () => extensionAbort.abort(new UserFacingError("扩展初始化已取消。"));
    process.once("SIGINT", cancelExtension);
    try { for (const id of options.enableExtension ?? []) console.error(await extensions.enable(id, mode, extensionAbort.signal)); }
    finally { process.removeListener("SIGINT", cancelExtension); }
    const web = mode === "plan" ? undefined : await loadWeb(Boolean(options.enableWeb), options.webSearchConfig);
    model = createModel(config, project, memory, skills, extensions.hooks, extensions.mcp, web, extensions);
    for (const line of mcpInfo(model.mcp)) console.error(line);
    for (const line of skillInfo(skills)) console.error(line);
    for (const line of projectInstructionInfo(project)) console.error(line);
    // [KEEP 来自 13.1] JSONL 仍只输出机器事件；其余入口共用一次 writer 生命周期。
    if (options.output === "jsonl") {
      await runJsonlPrompt(model, options.prompt!, runOptions);
      return;
    }
    // [KEEP 来自 14.1] 新分支复制来源数据，随后所有检查点只写新文件。
    const writer = options.fork !== undefined
      ? await forkSessionWriter(options.fork, options.sessionDir)
      : options.resume !== undefined
      ? await resumeSessionWriter(options.resume, options.sessionDir, options.recover)
      : await createSessionWriter(options.sessionDir);
    // [KEEP 来自 14.2] 文件恢复数据与会话同属一个身份，分支自动使用新的目录。
    runOptions.fileCheckpoints = createFileCheckpointStore(writer.id, dirname(writer.path));
    console.error(`会话 ID：${writer.id}\n保存文件：${writer.path}`);
    try {
      // [KEEP 来自 13.3] 采用拿锁后重读的快照；任何失败都会走 finally 释放本进程的锁。
      const restored = writer.restored;
      const initial = restored?.state;
      if (restored) {
        const workspace = restored.header.workspace ?? await realpath(restored.header.cwd);
        if (workspace !== await realpath(process.cwd())) throw new UserFacingError(`工作区不同：请先进入 ${restored.header.cwd} 再恢复，当前目录不会执行旧任务。`);
        for (const warning of restored.warnings) console.error(`恢复提示：${warning}`);
        console.error(`已恢复 ${initial?.messages.length ?? 0} 条消息；等待新要求，不重放旧工具；本进程权限需重新确认。`);
        if (initial?.pendingInputs.length) console.error(`保留 ${initial.pendingInputs.length} 条旧补充；不会自动交给新任务，请在 TUI 队列中明确选择发送。`);
      }
      mode = (options.mode ?? initial?.mode ?? "execute") as ExecutionMode;
      runOptions.mode = mode;
      if (options.prompt === undefined) {
        // [KEEP 来自 10.1] 选择 TUI 时才载入 React / Ink，不让脚本模式初始化界面。
        if (options.output === "tui") {
          const { startTui } = await import("./ui/tui/app.js");
          // [KEEP 来自 13.1] 会话 writer 与启动模式一起交给 TUI，授权仍由 TUI 保存在内存。
          await startTui(model, mode, writer, initial, runOptions.fileCheckpoints);
        } else await startTerminal(model, runOptions, writer, initial);
      } else await runSinglePrompt(model, options.prompt, runOptions, writer, initial);
    } finally {
      // [KEEP 来自 13.1] 消费者先等任务和最后检查点；即使保存失败，这里仍关闭句柄。
      await writer.close();
    }
    // [KEEP 来自 26.1] 退出等待自有作业清理；即使close失败也关闭MCP。
    } finally { try { await model?.jobs?.close(); } finally { /* [NEW 32.2] 当前CLI拥有并等待语言服务退出。 */ try { await model?.languageService?.close(); } finally { try { await extensions.close(); } finally { await mcp?.close(); } } } }
  });

// [KEEP 来自 02.2] 请求返回 Promise，parseAsync 会等待默认操作结束。
try {
  // [KEEP 来自 30.3] schedule动作结束后不再进入普通聊天入口。
  // [NEW 32.2] 必须早于program.parseAsync触发的模型配置。
  if (process.argv[2] === "code") await runCodeCommand(process.argv.slice(3));
  else if (process.argv[2] === "schedule") await runScheduleCommand(process.argv.slice(3));
  else await program.parseAsync();
} catch (error) {
  console.error(`错误：${explainError(error)}`);
  process.exitCode = 1;
}

/**
 * [KEEP 来自 21.1] 让启动时的 Ctrl+C 也能停止正在建立的 MCP 连接。
 * 输入是本地配置路径与已确定的项目根；取消信号交给连接器，等待它关闭已启动的服务。
 * 无论连接成功、失败还是取消，最后都移除本次 SIGINT 监听，避免影响之后的任务。
 */
async function connectConfiguredMcp(path: string | undefined, root: string) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("MCP初始化已取消。"));
  process.once("SIGINT", cancel);
  try { return await connectMcp(path, root, controller.signal); }
  finally { process.removeListener("SIGINT", cancel); }
}
```

</details>

保存文件后，在仓库根目录构建本节：

```bash
npm run lesson:32.2
```

## 运行验证

进入一个有源码的TypeScript项目，不需要配置模型密钥就能查询。参数依次是动作、文件、行、列：

```bash
hello-my-agent code definition src/main.ts 2 13
```

选择的坐标必须落在真实标识符上；可以先用带行号的read_file确认。查询引用：

```bash
hello-my-agent code references src/main.ts 2 13
```

通过模型使用时，提示它先读文件确定坐标，再查definition并读取返回位置。代码工具默认只接受项目内、未被忽略的常见JS/TS源码，拒绝越界与受保护路径；返回位置也过滤到同样范围。服务器为分析可能读取项目配置、导入和库文件，因此这个工具范围不是语言服务器的操作系统沙箱。

## 让结果足以证明绑定关系

建 `lib.ts`，导出 `export const amount = 1;`；建 `main.ts`，第一行写 `import { amount } from './lib.js';`，第二行写 `console.log(amount);`。查询main.ts第二行第13列，应返回lib.ts第一行中的声明；查询引用应包含main.ts第二行中的使用处。

再在另一个文件声明同名的amount，原调用仍应指向lib.ts。它验证的是绑定关系，而不是输出里是否出现某个字符串。越界路径应在启动服务前失败；服务失败后，已有grep和check_project继续可以使用。

下一节处理更隐蔽的问题：服务器已经给出了结果，但分析期间文件又变了，我们还可以把它当作当前文件的证据吗？
