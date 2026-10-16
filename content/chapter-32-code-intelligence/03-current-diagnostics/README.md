# 32.3 只报告当前文件的诊断

[上一节：用语言服务定位符号](/content/chapter-32-code-intelligence/02-lsp-navigation/README.md) · [本章首页](/content/chapter-32-code-intelligence/README.md) · [练习与完整答案](/content/chapter-32-code-intelligence/EXERCISES.md)

## 报错消失以前，先确认我们检查的是哪份代码

模型修改了 `const count: number = 'one'`，把字符串换成数字。界面仍显示上一轮“string不能赋给number”。如果我们只保存“最近一次诊断”，模型可能继续修改已经正确的文件；反过来，旧的空诊断也可能让它提前宣布修复完成。

本节给code_intelligence增加diagnostics动作，同时为打开的文件保存文本和递增版本。首次查询发送didOpen；以后查询发现磁盘内容不同，先递增版本，再发送包含完整新文本的didChange。服务器接到新内容以后，才处理紧随其后的查询。这里采用完整文本同步，省去计算编辑区间，也避免把错误的增量补丁应用到旧内容上。

文档版本只在这个客户端进程内有意义，服务重启以后重新从1开始。它记录同步先后，不能当成跨会话文件身份。所以结果还包含本次文本的SHA-256摘要，用来说明这份证据对应哪段内容。

## 为什么不直接转发最近一次publishDiagnostics

标准LSP的publishDiagnostics是服务器主动推送的通知，版本字段是可选的。推送可以在我们提出查询之前已经排队，未带版本的通知不能证明它对应刚发出的didChange。给它补上客户端当前版本，只是把猜测写得更像事实。[LSP诊断定义](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_publishDiagnostics)

因此本章不把推送缓存当作诊断答案。对于所选TypeScript服务器，我们通过固定的workspace/executeCommand扩展，分别发出syntacticDiagnosticsSync与semanticDiagnosticsSync。这两条命令由tsserver真正计算语法及语义诊断；外层LSP请求仍有id，响应只能交给发出该请求的等待者。[服务器扩展说明](https://github.com/typescript-language-server/typescript-language-server/tree/v5.1.3#send-tsserver-command) · [TypeScript协议类型](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/server/protocol.ts)

这是一条有意限定的适配路径：定义与引用是标准LSP请求，诊断是TypeScript服务器扩展。客户端只允许内部写死的两条读诊断命令，模型不能传任意executeCommand名称，更不能借此调用重构或应用编辑。更换语言服务器时，需要重新选择其有明确完成响应和文档关联的诊断接口。

## 请求关联以后，为什么还要重读一次文件

请求id只说明“这个响应回答了哪个请求”，不能阻止用户在等待期间保存文件。客户端因此先读取目标文本A、同步A、取得响应，再从磁盘重新读取目标。只有路径仍在允许范围、文本仍等于A，才返回诊断与A的摘要。若已经变成B，这次结果直接作废，报“文件在查询期间变化，请重试”。

客户端最多保留32个已打开文档，超过时明确报错。打开过的其他文档也会在查询前从磁盘刷新，避免已缓存文本一直遮住磁盘变化。查询后再核对这些已同步文档，变化时同样拒绝结果。但未打开的依赖、tsconfig以及整个磁盘没有被冻结；这一机制提供目标与已同步文档的内容证据，不声称全项目事务一致。复杂依赖变化之后仍应运行项目自己的typecheck与测试。

没有诊断只有在两条请求都成功且复核通过时才返回空列表。启动失败、命令不支持、响应格式不对、文件变化或超时都返回错误，不能降格成“没有发现问题”。错误进入原工具消息，模型下一次请求才能据此选择重试、搜索或批准检查。

## 超时不是简单地不再等待

只用Promise.race让界面先返回，会把服务和迟到的响应留在后台。下一次查询可能接到上一次的状态，CLI退出时也可能留下tsserver。客户端因此为本次查询设置总期限，包含初始化、同步和取响应；期限到达先拒绝等待者，再终止自己创建的进程组并等待收尾，清空文档视图。

本次工具返回明确的超时错误，不在同一次调用中无限重试。下一次独立查询才按需启动新服务、重新初始化与didOpen。服务自然崩溃走同一条清理路线。若清理无法确认，保留资源引用并阻止再次启动，继续报告清理错误，不能一边声称关闭成功一边启动第二组服务。

用户取消与服务超时的去向不同：超时是可恢复工具错误，模型可继续选择grep或check_project；用户取消表示本轮任务停止，清理完后向外抛出取消，不再自动请求模型。CLI正常退出先尝试shutdown与exit，再以有界的进程清理兜底。在macOS/Linux上，客户端为服务创建独立进程组，只有直接子进程已close且该进程组不存在，才释放所有者引用；Windows分支只确认直接子进程，不能提供相同的后代进程保证。即使在进程组模式下，也不能控制已经逃离该组的第三方程序。

<!-- media:lesson:start -->
从 A 的类型错误到 B 的零条结果：每次都经过完整文本同步、双请求响应和磁盘回读。

<img src="./content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-cover-dbac334ce5.png" data-gif-src="./content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-2079cc9efa.gif" data-cover="./content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-cover-dbac334ce5.png" data-no-zoom alt="零条诊断，凭什么能对应当前文件？">

[静态流程图](/content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-flow-c746e20060.png.md) · [静态封面](/content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-cover-dbac334ce5.png.md) · [查看完整静态分镜](/content/chapter-32-code-intelligence/03-current-diagnostics/assets/diagnostics-freshness-storyboard-23d3c200ce.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/language-service/client.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/language-service/client.ts.md) | 文档版本、完整内容变化、请求关联诊断与返回前复核。 |
| CHANGED | [src/tools/code-intelligence.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/tools/code-intelligence.ts.md) | 开放diagnostics，返回有内容身份的诊断。 |
| CHANGED | [src/code-command.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/code-command.ts.md) | 本地入口支持无需行列的diagnostics。 |

## 动手构建

以上一节的完整源码为起点，保留未列入本节变更表的文件。按下面路径保存完整内容，每份文件都位于本节自己的 `src/` 中。

### src/language-service/client.ts

目标文件：[src/language-service/client.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/language-service/client.ts.md)。

<!-- build-file: src/language-service/client.ts -->
<details>
<summary>src/language-service/client.ts 完整文件</summary>

```typescript
/**
 * 32.3 只报告当前文件的诊断 | [CHANGED] language-service/client.ts
 * 输入：本地根目录、固定读动作、目标源码和取消；输出：真正tsserver的符号与当前内容诊断。
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

export type CodeAction = "definition" | "references" | "diagnostics";
export type CodeLocation = { path: string; line: number; column: number };
// [NEW 32.3] 本次内容版本与摘要随诊断一起返回，绝不采用无版本push。
export type CodeDiagnostic = { line: number; column: number; code: number; category: string; message: string };
export type CodeResult = { path: string; version: number; sha256: string; action: CodeAction; locations?: CodeLocation[]; diagnostics?: CodeDiagnostic[]; truncated: boolean };
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

  /** [CHANGED 32.3] 同步所有已打开文件；结果只在这些文本仍相同的条件下采用。 */
  private async perform(action: CodeAction, path: string, line: number | undefined, column: number | undefined, signal: AbortSignal): Promise<CodeResult> {
    const source = await this.source(path);
    const lines = source.text.split(/\r?\n/);
    if (action !== "diagnostics" && (!Number.isInteger(line) || !Number.isInteger(column) || line! < 1 || column! < 1 || line! > lines.length || column! > lines[line! - 1].length + 1)) throw new ToolError("行列必须指向当前源码，从1开始，列使用UTF-16单元。");
    signal.throwIfAborted();
    const session = await this.start(source.root, signal);
    signal.throwIfAborted();
    for (const uri of session.documents.keys()) {
      if (uri !== source.uri) this.sync(session, await this.source(relative(source.root, fileURLToPath(uri)).split(sep).join("/")));
    }
    if (!session.documents.has(source.uri) && session.documents.size >= 32) throw new ToolError("本次语言服务已打开32个文件；请开启新会话或改用搜索与项目检查。");
    const document = this.sync(session, source);
    const evidence = [...session.documents].map(([uri, doc]) => ({ uri, text: doc.text }));
    const identity = { path: source.name, action, version: document.version, sha256: createHash("sha256").update(source.text).digest("hex") };
    let result: CodeResult;
    if (action === "diagnostics") {
      const diagnostics: CodeDiagnostic[] = [];
      // [NEW 32.3] 固定只读tsserver扩展，均要求带id的成功响应，不能由push补齐。
      for (const command of ["syntacticDiagnosticsSync", "semanticDiagnosticsSync"]) {
        const response = object(await this.request(session, "workspace/executeCommand", { command: "typescript.tsserverRequest", arguments: [command, { file: source.absolute, includeLinePosition: true }, { expectsResult: true, isAsync: false, executionTarget: 0 }] }));
        if (response.type !== "response" || response.success !== true || !Array.isArray(response.body)) throw new ToolError("语言服务诊断响应无效，不能作为空诊断采用。");
        for (const raw of response.body.slice(0, 1000)) {
          const entry = object(raw), start = object(entry.startLocation);
          if (!Number.isInteger(start.line) || Number(start.line) < 1 || !Number.isInteger(start.offset) || Number(start.offset) < 1 || !Number.isInteger(entry.code) || typeof entry.category !== "string" || typeof entry.message !== "string") throw new ToolError("语言服务诊断位置格式无效。");
          diagnostics.push({ line: Number(start.line), column: Number(start.offset), code: Number(entry.code), category: entry.category, message: entry.message.slice(0, 4000) });
        }
        if (response.body.length > 1000) throw new ToolError("语言服务诊断过多，未取得完整结果；请先运行项目检查。");
      }
      result = { ...identity, diagnostics: diagnostics.slice(0, 100), truncated: diagnostics.length > 100 };
    } else {
      const raw = await this.request(session, `textDocument/${action}`, { textDocument: { uri: source.uri }, position: { line: line! - 1, character: column! - 1 }, ...(action === "references" ? { context: { includeDeclaration: true } } : {}) });
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
      result = { ...identity, locations: locations.slice(0, 100), truncated: locations.length > 100 || (Array.isArray(raw) && raw.length > 1000) };
    }
    for (const before of evidence) {
      const after = await this.source(relative(source.root, fileURLToPath(before.uri)).split(sep).join("/"));
      if (after.uri !== before.uri || after.text !== before.text) throw new ToolError("文件在查询期间变化，本次结果作废；请重试。");
    }
    signal.throwIfAborted();
    return result;
  }

  /** [NEW 32.3] 首次全量打开，内容变化才递增版本并发送完整didChange。 */
  private sync(session: Session, source: { uri: string; name: string; text: string }): Document {
    let document = session.documents.get(source.uri);
    if (!document) {
      document = { text: source.text, version: 1 };
      session.documents.set(source.uri, document);
      const extension = extname(source.name), languageId = extension === ".tsx" ? "typescriptreact" : extension === ".jsx" ? "javascriptreact" : [".ts", ".mts", ".cts"].includes(extension) ? "typescript" : "javascript";
      this.notify(session, "textDocument/didOpen", { textDocument: { uri: source.uri, languageId, version: document.version, text: source.text } });
    } else if (document.text !== source.text) {
      document.text = source.text;
      document.version++;
      this.notify(session, "textDocument/didChange", { textDocument: { uri: source.uri, version: document.version }, contentChanges: [{ text: source.text }] });
    }
    return document;
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
    // [KEEP 来自 32.2] 单个完整服务，避免加载期间的轻量语法结果只定位到import别名。
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

目标文件：[src/tools/code-intelligence.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/tools/code-intelligence.ts.md)。

<!-- build-file: src/tools/code-intelligence.ts -->
<details>
<summary>src/tools/code-intelligence.ts 完整文件</summary>

```typescript
/**
 * 32.3 只报告当前文件的诊断 | [CHANGED] tools/code-intelligence.ts
 * 输入：模型JSON与本地客户端；输出：带源码摘要的结构化符号位置。
 * JSON -> 固定action/位置校验 -> 本地LanguageService -> 工具消息 -> 模型读取目标
 * 参数错误/服务失败 -> ToolError；用户取消 -> 原信号向任务外传播。
 * 只读意图不允许模型选择服务命令或执行任意workspace/executeCommand。
 */
import { ToolError } from "../errors.js";
import type { CodeAction, LanguageService } from "../language-service/client.js";
import type { ToolExecutionResult } from "./types.js";

// [CHANGED 32.3] diagnostics只需路径；其余工具位置从1开始，适合与read_file输出对照。
export const codeIntelligenceDefinition = {
  name: "code_intelligence", description: "读取当前JS/TS源码的定义、引用或当前诊断；行列从1开始，列按UTF-16计数。失败可退回grep/read_file或批准check_project。",
  inputSchema: { type: "object" as const, properties: {
    action: { type: "string" as const, enum: ["definition", "references", "diagnostics"] },
    path: { type: "string" as const }, line: { type: "integer" as const, minimum: 1 }, column: { type: "integer" as const, minimum: 1 },
  }, required: ["action", "path"], additionalProperties: false },
};

/** 完整校验工具输入；只有本地引用能够选择实际语言服务。 */
export async function codeIntelligenceTool(json: string, service: LanguageService | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  let input: { action: CodeAction; path: string; line?: number; column?: number };
  try {
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["action", "path", "line", "column"].includes(key)) || !["definition", "references", "diagnostics"].includes(value.action) || typeof value.path !== "string" || !value.path.trim() || (value.action === "diagnostics" ? value.line !== undefined || value.column !== undefined : !Number.isInteger(value.line) || value.line < 1 || !Number.isInteger(value.column) || value.column < 1)) throw new Error();
    input = value;
  } catch { throw new ToolError("code_intelligence需要action与path；definition/references还需要从1开始的line/column，diagnostics不接受位置。"); }
  if (!service) throw new ToolError("本地语言服务未绑定；可改用grep/read_file或批准check_project。");
  const result = await service.query(input.action, input.path, input.line, input.column, signal);
  return { content: JSON.stringify(result, null, 2), metadata: { kind: "code_intelligence", result } };
}
```

</details>

### src/code-command.ts

目标文件：[src/code-command.ts](/content/chapter-32-code-intelligence/03-current-diagnostics/src/code-command.ts.md)。

<!-- build-file: src/code-command.ts -->
<details>
<summary>src/code-command.ts 完整文件</summary>

```typescript
/**
 * 32.3 只报告当前文件的诊断 | [CHANGED] code-command.ts
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
  // [CHANGED 32.3] 诊断没有光标位置；两种入口共用严格工具校验。
  if (action === "diagnostics" ? args.length !== 2 : args.length !== 4 || !["definition", "references"].includes(action)) throw new UserFacingError("用法：hello-my-agent code <definition|references> <path> <line> <column>；或 code diagnostics <path>");
  // [KEEP 来自 32.2] 独立查询拥有自己的服务；结果或错误输出后都必须关闭。
  const service = new LanguageService(), controller = new AbortController();
  const cancel = () => controller.abort(new UserFacingError("本地代码查询已取消。"));
  process.once("SIGINT", cancel);
  try { console.log((await codeIntelligenceTool(JSON.stringify({ action, path, ...(action === "diagnostics" ? {} : { line: Number(line), column: Number(column) }) }), service, controller.signal)).content); }
  finally { process.removeListener("SIGINT", cancel); await service.close(); }
}
```

</details>

保存文件后，在仓库根目录构建本节：

```bash
npm run lesson:32.3
```

## 运行验证

进入目标项目，执行本地诊断，不需要模型密钥：

```bash
hello-my-agent code diagnostics src/main.ts
```

让同一Agent查询一次错误文件，再通过edit_file批准修复，再次查询diagnostics。第二次应同步新文本并取得新诊断；结果里的version增加，sha256变化，旧报错消失。单独执行两次本地code命令会创建两个进程，版本各从1开始，不能用它演示同一会话的版本递增。

## 验证“没有错误”确实来自新内容

用一个最小项目，设置strict与noEmit，源码写 `export const count: number = 'one';`。第一次诊断应包含TypeScript的2322错误。把源码改为 `export const count: number = 1;`，同一客户端再次查询，应返回空诊断、较新的version与新的sha256。再故意写出语法错误，应取得语法诊断；这样才分别覆盖了两个实际后端请求。

验收脚本还会让测试专用服务不响应初始化，确认期限到达以后调用失败、资源结束；随后在同一客户端改回真正服务器，确认下一次能重新初始化。另一个测试会在真实诊断请求发出后修改源码，确认返回前的复核拒绝旧结果。这些测试服务只用来制造协议故障，定义、引用和诊断的成功验收全部由实际TypeScript语言服务器完成。

至此，模型可以先定位符号，修改以后查当前文件诊断，再取得批准运行项目检查。任一证据来源失败，错误都保留来源和去向；模型仍可用搜索继续调查，最终只报告实际完成的检查。
