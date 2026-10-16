/**
 * 35.3 显式真实模型评测 | [KEEP] extensions/manager.ts
 * 学习目标：把安装文件、当前启用状态和实际执行资源分开，并让失败可收尾。
 * 输入：本地明确选择、取消信号；输出：本地状态，不接受模型或包替用户授权。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   安装 -> 有界快照/校验 -> 临时目录 -> rename提交；启用 -> 预检 -> 连接 -> 原地发布
 *   停用 -> 撤下定义 -> 关闭资源 -> 确认；卸载 -> 停用成功 -> 删除拥有目录
 * 状态：单进程串行变更，首次变更持磁盘独占锁直到close；失败保留可诊断状态。
 * 边界：显式启用可运行任意本地程序，不是沙箱；不自动恢复死锁、不自动重试外部调用。
 */
import { constants } from "node:fs";
import { access, lstat, mkdir, open, opendir, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ToolError } from "../errors.js";
import { discoverSkills } from "../skills/catalog.js";
import type { SkillState } from "../skills/catalog.js";
import { loadHooks } from "../hooks/lifecycle.js";
import type { HookState } from "../hooks/lifecycle.js";
import { connectMcp, readServers } from "../mcp/client.js";
import type { McpState, ServerConfig } from "../mcp/client.js";
import { EXTENSION_LIMITS, extensionId, ordinaryDirectory, packagePath, readPackage } from "./manifest.js";
import type { PackageSnapshot } from "./manifest.js";

type Prepared = { snapshot: PackageSnapshot; skills: SkillState; hooks?: HookState; servers: ServerConfig[] };
type Active = { prepared: Prepared; mcp?: McpState; status: "enabled" | "cleanup_failed" };
const events = ["before_tool", "after_tool", "stop"] as const;

/**
 * 聚合对象只创建一次；模型、工具注册表和界面始终读取这些同一对象。
 * 项目能力保留原有引用和执行目录，扩展停用仅删除带自己owner的内容。
 */
export class ExtensionManager {
  readonly hooks: HookState;
  readonly mcp: McpState;
  readonly directory: string;
  private readonly active = new Map<string, Active>();
  private lock?: FileHandle;
  private tail: Promise<unknown> = Promise.resolve();
  private users = 0;
  private mutations = 0;
  private closing = false;
  private closed = false;
  constructor(readonly root: string, readonly skills: SkillState, projectHooks?: HookState, projectMcp?: McpState) {
    this.root = skills.root;
    this.directory = join(this.root, ".hello-my-agent/extensions");
    this.hooks = projectHooks ?? { root, hooks: {} };
    this.mcp = projectMcp ?? { servers: [], tools: new Map(), async close() {} };
  }

  /** 整轮任务持使用票据；本地变更只能在空闲时进行，释放幂等。 */
  beginUse(): () => void {
    if (this.closed || this.closing || this.mutations) throw new ToolError("扩展正在变更或关闭，请等待本地操作结束后开始任务。");
    this.users++; let released = false;
    return () => { if (!released) { released = true; this.users--; } };
  }

  /** 入队前同步占用变更票据；任务不能在异步连接间隙取得使用票据。 */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.closing || this.users) return Promise.reject(new ToolError("扩展当前忙碌或已关闭，请在任务结束后操作。"));
    // [KEEP 来自 31.2] 在第一次await之前占用；反向的beginUse也必须看到这次变更。
    this.mutations++;
    const next = this.tail.then(async () => {
      await this.ownStore(); return operation();
    }).finally(() => { this.mutations--; });
    this.tail = next.catch(() => {}); return next;
  }

  /** 首次变更拿锁并持到退出；其他进程明确busy，不冒险删除活动脚本。 */
  private async ownStore(): Promise<void> {
    if (this.lock) return;
    const metadata = dirname(this.directory);
    await mkdir(metadata, { recursive: true }); await ordinaryDirectory(metadata);
    await mkdir(this.directory, { recursive: true }); await ordinaryDirectory(this.directory);
    try { this.lock = await open(join(this.directory, ".lock"), "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ToolError("扩展目录被其他进程占用（.lock）；请先正常退出持有者。崩溃遗留锁需人工确认进程已退出后移走。"); throw error; }
    await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n"); await this.lock.sync();
  }

  /** 返回安装清单；损坏的包留在列表中作为诊断，不静默忽略。 */
  async list(signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted();
    let names: string[];
    try {
      await ordinaryDirectory(this.directory); names = [];
      for await (const entry of await opendir(this.directory)) {
        if (names.length >= 64) throw new ToolError("扩展安装目录超过64项；请先核对本地目录。");
        names.push(entry.name);
      }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ["没有已安装扩展。"]; throw error; }
    const lines: string[] = [];
    for (const id of names.sort().filter(name => !name.startsWith("."))) {
      signal.throwIfAborted();
      try { extensionId(id); const item = await readPackage(join(this.directory, id), signal); if (item.manifest.id !== id) throw new ToolError("目录与清单id不一致。"); lines.push(`${id}@${item.manifest.version} · ${this.active.get(id)?.status ?? "installed"}`); }
      catch (error) { signal.throwIfAborted(); lines.push(`${id} · invalid · ${error instanceof ToolError ? error.message : "文件不可读"}`); }
    }
    return lines.length ? lines : ["没有已安装扩展。"];
  }

  /** 静态预检复用原解析器，只生成配置与目录；绝不启动脚本、服务或安装依赖。 */
  private async prepare(idOrPath: string, signal: AbortSignal, source = false): Promise<Prepared> {
    const snapshot = await readPackage(source ? idOrPath : join(this.directory, extensionId(idOrPath)), signal);
    if (!source && snapshot.manifest.id !== idOrPath) throw new ToolError("扩展目录与清单id不一致。");
    const { manifest, root } = snapshot;
    const skills = manifest.skills ? await discoverSkills(this.root, signal, { directory: join(root, manifest.skills), owner: manifest.id }) : { root: this.root, entries: [], notices: [], loaded: new Map() };
    if (skills.notices.length) throw new ToolError(`扩展 Skills 校验失败：${skills.notices.map(notice => `${notice.path}: ${notice.reason}`).join("；")}`);
    const hooks = manifest.hooks ? await loadHooks(root, true, join(root, manifest.hooks)) : undefined;
    for (const event of events) for (const hook of hooks?.hooks[event] ?? []) {
      hook.owner = manifest.id; hook.cwd = root;
      const resolved = this.processConfig(root, hook.command, hook.args, snapshot); hook.command = resolved.command; hook.args = resolved.args;
    }
    const servers = manifest.mcp ? await readServers(join(root, manifest.mcp)) : [];
    for (const server of servers) if (server.transport === "stdio") Object.assign(server, this.processConfig(root, server.command, server.args, snapshot));
    return { snapshot, skills, hooks, servers };
  }

  /** 包内脚本使用./路径，安装后重新定位；拒绝越界参数和有路径的可执行文件。 */
  private processConfig(root: string, command: string, args: string[], snapshot: PackageSnapshot): { command: string; args: string[] } {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(command) || [".", ".."].includes(command)) throw new ToolError("扩展command须为PATH中的可执行名称；包内脚本放在args的./相对路径中。");
    return { command, args: args.map(arg => {
      if (arg.includes("../") || arg.includes("..\\") || arg.startsWith("/") || arg.includes("\\")) throw new ToolError("扩展参数不能包含绝对或越界路径。");
      if (!arg.startsWith("./")) return arg;
      const path = packagePath(arg.slice(2)); if (!snapshot.files.has(path)) throw new ToolError("扩展命令引用的包内脚本不存在。"); return join(root, path);
    }) };
  }

  /** 先完整复制到私有临时目录，再校验复制品；唯一rename是可见提交点。 */
  install(source: string, signal: AbortSignal): Promise<string> {
    return this.mutate(async () => {
      const snapshot = await readPackage(resolve(source), signal), target = join(this.directory, snapshot.manifest.id);
      if ((await this.list(signal)).filter(line => !line.startsWith("没有")).length >= EXTENSION_LIMITS.packages) throw new ToolError("最多安装16个扩展。");
      try { await lstat(target); throw new ToolError("同名扩展已安装；先停用并卸载，再安装明确选择的版本。"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const temporary = join(this.directory, `.tmp-${randomUUID()}`);
      try {
        await mkdir(temporary, { mode: 0o700 });
        for (const [path, bytes] of snapshot.files) {
          signal.throwIfAborted(); const destination = join(temporary, path); await mkdir(dirname(destination), { recursive: true });
          const file = await open(destination, "wx", 0o600); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        }
        await this.prepare(temporary, signal, true); signal.throwIfAborted();
        await ordinaryDirectory(this.directory); await rename(temporary, target);
        return `已安装 ${snapshot.manifest.id}@${snapshot.manifest.version}；当前未启用，未执行安装脚本。`;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }

  /** 检查依赖必须先显式启用；不替用户自动启动依赖。 */
  private checkDependencies(item: Prepared): void {
    for (const dependency of item.snapshot.manifest.requires ?? []) if (this.active.get(dependency)?.status !== "enabled") throw new ToolError(`依赖 ${dependency} 尚未启用；请先明确启用该包。`);
  }

  /** 缺少二进制和认证变量在连接前报告；诊断不会打印令牌或启动参数。 */
  private async environment(item: Prepared): Promise<void> {
    const commands = new Set<string>();
    for (const event of events) for (const hook of item.hooks?.hooks[event] ?? []) commands.add(hook.command);
    for (const server of item.servers) {
      if (server.transport === "stdio") commands.add(server.command);
      else if (server.tokenEnv && (!process.env[server.tokenEnv] || /[\r\n]/.test(process.env[server.tokenEnv]!))) throw new ToolError("扩展认证环境变量缺失或无效；请在终端配置清单选择的变量。");
    }
    for (const command of commands) {
      let found = false;
      for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) { try { await access(join(directory, command), constants.X_OK); found = true; break; } catch {} }
      if (!found) throw new ToolError(`扩展所需可执行程序不可用：${command}。`);
    }
  }

  /**
   * [KEEP 来自 31.2] 先预检、连接、检查总预算，再原地发布到现成Skills/Hooks/MCP对象。
   * 任何失败先关闭新资源；关闭未确认则保留cleanup_failed，不能伪称未启动。
   */
  enable(id: string, mode: string, signal: AbortSignal): Promise<string> {
    return this.mutate(async () => {
      extensionId(id); if (mode !== "execute") throw new ToolError("Plan模式不能启用扩展；请在本地切换execute后明确选择。");
      if (this.active.has(id)) throw new ToolError("扩展已启用或仍待清理；先停用后再试。");
      const item = await this.prepare(id, signal); this.checkDependencies(item); await this.environment(item);
      if (this.skills.entries.length + item.skills.entries.length > 64 || item.skills.entries.some(entry => this.skills.entries.some(old => old.name === entry.name))) throw new ToolError("扩展Skills名称冲突或总数超过64。");
      for (const event of events) if ((this.hooks.hooks[event]?.length ?? 0) + (item.hooks?.hooks[event]?.length ?? 0) > 8) throw new ToolError("扩展Hooks总数超过每事件8条。");
      if (this.mcp.servers.length + item.servers.length > 4) throw new ToolError("扩展MCP总服务数超过4。");
      let own: McpState | undefined;
      try {
        own = item.snapshot.manifest.mcp ? await connectMcp(join(item.snapshot.root, item.snapshot.manifest.mcp), item.snapshot.root, signal, id, item.servers, state => { own = state; }) : undefined;
        if (own?.servers.some(server => server.status !== "ready")) throw new ToolError("扩展MCP连接或发现失败；新增能力未发布。");
        const definitions = [...this.mcp.tools.values(), ...own?.tools.values() ?? []];
        if (definitions.length > 64 || Buffer.byteLength(JSON.stringify(definitions.map(entry => entry.definition))) > 65536 || [...own?.tools.keys() ?? []].some(name => this.mcp.tools.has(name))) throw new ToolError("扩展MCP工具名称冲突或总定义超过64个/64KiB。");
        signal.throwIfAborted();
        this.skills.entries.push(...item.skills.entries);
        for (const event of events) (this.hooks.hooks[event] ??= []).push(...item.hooks?.hooks[event] ?? []);
        this.mcp.servers.push(...own?.servers ?? []); for (const [name, value] of own?.tools ?? []) this.mcp.tools.set(name, value);
        this.active.set(id, { prepared: item, mcp: own, status: "enabled" });
        return `已启用 ${id}；Skills=${item.skills.entries.length}，Hooks=${events.reduce((sum, event) => sum + (item.hooks?.hooks[event]?.length ?? 0), 0)}，MCP=${own?.tools.size ?? 0}。仅本进程有效。`;
      } catch (error) {
        try { await own?.close(); }
        catch { this.active.set(id, { prepared: item, mcp: own, status: "cleanup_failed" }); throw new ToolError("启用失败且新MCP进程关闭未确认；包文件保留，请停用重试清理。"); }
        throw error;
      }
    });
  }

  /** [KEEP 来自 31.2] 先撤下能力，再等待自有资源关闭；失败保留拥有记录以便重试。 */
  private async stop(id: string): Promise<string> {
    extensionId(id);
    for (const [other, active] of this.active) if (other !== id && active.prepared.snapshot.manifest.requires?.includes(id)) throw new ToolError(`扩展 ${other} 仍依赖 ${id}；先停用依赖者。`);
    const item = this.active.get(id); if (!item) return `${id} 当前未启用。`;
    this.skills.entries.splice(0, this.skills.entries.length, ...this.skills.entries.filter(entry => entry.owner !== id));
    for (const name of this.skills.loaded.keys()) if (name.startsWith(`${id}:`)) this.skills.loaded.delete(name);
    for (const event of events) { const hooks = this.hooks.hooks[event]; if (hooks) hooks.splice(0, hooks.length, ...hooks.filter(hook => hook.owner !== id)); }
    const servers = new Set(item.mcp?.servers ?? []);
    this.mcp.servers.splice(0, this.mcp.servers.length, ...this.mcp.servers.filter(server => !servers.has(server)));
    for (const [name, tool] of this.mcp.tools) if (servers.has(tool.server)) this.mcp.tools.delete(name);
    item.status = "cleanup_failed";
    await item.mcp?.close(); this.active.delete(id); return `已停用 ${id}，本进程能力已撤下，资源关闭已确认。`;
  }
  disable(id: string): Promise<string> { return this.mutate(() => this.stop(id)); }

  /** [KEEP 来自 31.3] 只有停用清理成功，且目标仍是本管理器拥有的普通目录时才删除。 */
  uninstall(id: string, signal: AbortSignal): Promise<string> {
    return this.mutate(async () => {
      extensionId(id); await this.stop(id); const item = await readPackage(join(this.directory, id), signal);
      if (item.manifest.id !== id) throw new ToolError("清单与目标目录不一致；未删除。");
      signal.throwIfAborted(); await ordinaryDirectory(this.directory); await ordinaryDirectory(item.root);
      await rm(item.root, { recursive: true }); return `已卸载 ${id}；不会撤销脚本或远端服务此前产生的副作用。`;
    });
  }

  /** [KEEP 来自 31.3] 静态诊断只读取；不连接网络、不执行程序、不打印令牌。 */
  async diagnose(id: string, signal: AbortSignal): Promise<string> {
    const item = await this.prepare(extensionId(id), signal); await this.environment(item);
    const missing = (item.snapshot.manifest.requires ?? []).filter(dependency => this.active.get(dependency)?.status !== "enabled");
    return `${id}@${item.snapshot.manifest.version} · API兼容 · 包内路径与配置有效 · ${this.active.get(id)?.status ?? "installed"}${missing.length ? ` · 未启用依赖：${missing.join(", ")}` : " · 依赖满足"}；这是静态检查，服务可用性需显式启用后验证。`;
  }

  /** 退出先等本地操作结束；有活动任务拒绝提前销毁。反序关闭符合依赖的启用顺序。 */
  async close(): Promise<void> {
    if (this.users) throw new ToolError("仍有任务使用扩展；先取消并等待任务结束。");
    this.closing = true; await this.tail;
    let failed = false;
    for (const id of [...this.active.keys()].reverse()) { try { await this.stop(id); } catch { failed = true; } }
    if (failed) { this.closing = false; throw new ToolError("扩展资源关闭未确认；保留包与锁，请核对本地进程。"); }
    this.closed = true;
    if (this.lock) { await this.lock.close(); this.lock = undefined; await rm(join(this.directory, ".lock")); }
  }
}
