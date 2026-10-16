/**
 * 31.1 安装本地扩展包 | [NEW] extensions/manager.ts
 * 学习目标：把安装文件、当前启用状态和实际执行资源分开，并让失败可收尾。
 * 输入：本地明确选择、取消信号；输出：本地状态，不接受模型或包替用户授权。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   安装 -> 有界快照/校验 -> 临时目录 -> rename提交；启用 -> 预检 -> 连接 -> 原地发布
 *   停用 -> 撤下定义 -> 关闭资源 -> 确认；卸载 -> 停用成功 -> 删除拥有目录
 * 状态：单进程串行变更，首次变更持磁盘独占锁直到close；失败保留可诊断状态。
 * 边界：显式启用可运行任意本地程序，不是沙箱；不自动恢复死锁、不自动重试外部调用。
 */
// [NEW 31.1] 安装与拥有关系；本节新增的生命周期操作。

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
import { readServers } from "../mcp/client.js";
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
    // 在第一次await之前登记正在写入，退出必须先等待写入收尾。
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

  /** 安装器退出释放本进程持有的锁；没有启动资源需要恢复。 */
  async close(): Promise<void> {
    this.closing = true; await this.tail; this.closed = true;
    if (this.lock) { await this.lock.close(); this.lock = undefined; await rm(join(this.directory, ".lock")); }
  }
}
