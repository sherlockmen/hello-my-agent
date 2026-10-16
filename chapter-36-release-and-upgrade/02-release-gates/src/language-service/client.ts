/**
 * 36.2 发布门禁 | [KEEP] language-service/client.ts
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
// [KEEP 来自 32.3] 本次内容版本与摘要随诊断一起返回，绝不采用无版本push。
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

  /** [KEEP 来自 32.3] 同步所有已打开文件；结果只在这些文本仍相同的条件下采用。 */
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
      // [KEEP 来自 32.3] 固定只读tsserver扩展，均要求带id的成功响应，不能由push补齐。
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

  /** [KEEP 来自 32.3] 首次全量打开，内容变化才递增版本并发送完整didChange。 */
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
