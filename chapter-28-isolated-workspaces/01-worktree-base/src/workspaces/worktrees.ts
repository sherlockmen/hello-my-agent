/**
 * 28.1 独立工作区 | [NEW] workspaces/worktrees.ts
 * 学习目标：从固定base创建会话自有Git worktree，让结果返回真实身份。
 * 输入：本地启动目录、本管理器生成的ID、取消信号；不接受任意目录或分支。
 * 输出：身份快照或固定预览/执行闭包；Git失败保留目录、分支与冲突，不自动回滚。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   创建 -> 固定目标branch/HEAD -> 审批 -> 复查 -> git worktree add -> 登记实际状态
 *   命令 -> 预览自有目录/完整命令 -> 审批 -> 复查身份 -> 执行 -> 最新状态回模型
 * 观察：dirty/untracked/ignored留在原处；自有工作区不等于安全沙箱。
 * shortcut: 登记只存当前CLI内存，重启后须按Git事实人工恢复；不把worktree当安全沙箱。
 */
import { lstat, mkdtemp, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ToolError } from "../errors.js";
import { runProcess, type ProcessResult } from "../processes/run-process.js";
import { prepareRunCommand } from "../tools/run-command.js";
import type { PreparedToolCall, ToolExecutionResult } from "../tools/types.js";

// [NEW 28.1] 本文件以下实现均为本节新增；ID和分支由本实例生成，路径只从本地登记表取得。
export type WorktreeSnapshot = {
  id: string; path: string; repository: string; commonDirectory: string; branch: string;
  baseSha: string; targetBranch: string; currentTargetBranch: string; headSha: string | null; targetSha: string | null;
  dirty: boolean; hasIgnored: boolean; targetDirty: boolean; operation: string | null; targetOperation: string | null; state: "creating" | "ready" | "failed" | "removed";
  failure?: string;
};
type Entry = { snapshot: WorktreeSnapshot };
type Origin = { repository: string; commonDirectory: string; branch: string; sha: string; dirty: boolean; operation: string | null };

// [KEEP 来自 28.1] 不拼shell；固定Git设置不执行hooks、签名和外部diff；受信本机Git过滤器/merge driver仍不是沙箱。
/** 运行固定Git程序与参数数组，不经过shell。
 * 输入真实cwd、受本模块控制的argv与轮次信号；输出有界日志、退出码和停止原因。
 * hooks/fsmonitor/签名在本次命令关闭，diff另设no-ext-diff/no-textconv；filter/merge driver仍可能运行。
 * 取消会等待进程组收尾后抛出，已发生的Git或文件副作用不会回滚。
 */
async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<ProcessResult> {
  return runProcess("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "merge.gpgSign=false", ...args], { cwd, signal, timeoutMs: 30_000, maxOutputBytes: 256 * 1024 });
}
/** 把Git退出事实保留成工具可见文字。
 * 输入ProcessResult，输出退出码、信号、停止原因和已有两条流；不把stderr单独当成失败。
 * 这里只排版，不检查成功、不丢弃冲突现场。
 */
function failure(result: ProcessResult): string { return `exit=${result.exitCode} signal=${result.signal ?? "none"} stop=${result.stopReason ?? "none"}\n${result.stdout}${result.stderr}`; }
/** 只接纳完整结束且退出码为0的Git查询/操作。
 * 输入cwd、参数和取消信号；输出trim后的完整stdout；超时、超量或非0抛ToolError。
 * 不完整diff不能进入评审；抛错仍可能发生在Git已经写盘之后。
 */
async function checked(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await git(cwd, args, signal);
  if (result.exitCode !== 0 || result.signal || result.stopReason) throw new ToolError(`Git ${args[0]} 未完成：${failure(result)}`);
  return result.stdout.trim();
}
/** 读取任务或目标目录的已跟踪修改与全部未跟踪文件。
 * 输入真实cwd，输出porcelain是否非空；ignored另记供清理检查。
 * Git失败向上抛错，不能把观察失败当作clean。
 */
async function dirty(cwd: string, signal?: AbortSignal): Promise<boolean> {
  return Boolean(await checked(cwd, ["status", "--porcelain=v1", "--untracked-files=all"], signal));
}
/** 只把不存在视为false，不能把权限或IO错误当作安全的空现场。
 * 输入本模块从Git/登记表取得的路径，输出是否有目录项；其他错误继续抛出。
 * 使用lstat保留符号链接本身的存在事实，不跟随未知目标判断删除成功。
 */
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
/** 检查即使porcelain为clean也可能残留的Git操作标记。
 * 输入真实cwd，输出首个merge/cherry-pick/revert/rebase/sequencer标记或null。
 * 路径由git rev-parse给出；发现标记只报告，绝不自行abort或清理。
 */
async function operation(cwd: string, signal?: AbortSignal): Promise<string | null> {
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const path = resolve(cwd, await checked(cwd, ["rev-parse", "--git-path", name], signal));
    if (await exists(path)) return name;
  }
  return null;
}
/** 取得当前提交的固定对象名。
 * 输入真实cwd与信号，输出Git验证过的HEAD commit SHA。
 * 无提交、无效仓库或取消向上失败，不接受模型自报SHA。
 */
async function head(cwd: string, signal?: AbortSignal): Promise<string> { return checked(cwd, ["rev-parse", "--verify", "HEAD^{commit}"], signal); }
/** 取得当前工作目录实际检出的分支。
 * 输入真实cwd与信号，输出symbolic-ref短分支名。
 * detached HEAD直接失败，不能猜测需要整合到哪个分支。
 */
async function branch(cwd: string, signal?: AbortSignal): Promise<string> { return checked(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal); }
/** 把启动目录解析成可核实的本地Git身份。
 * 输入cwd与信号，输出canonical根/common-dir、实际分支/HEAD、dirty及未结束操作。
 * 不改变目录或Git状态；任一步观察失败都阻止后续副作用。
 */
async function origin(cwd: string, signal?: AbortSignal): Promise<Origin> {
  const repository = await realpath(await checked(cwd, ["rev-parse", "--show-toplevel"], signal));
  const commonDirectory = await realpath(resolve(repository, await checked(repository, ["rev-parse", "--git-common-dir"], signal)));
  return { repository, commonDirectory, branch: await branch(repository, signal), sha: await head(repository, signal), dirty: await dirty(repository, signal), operation: await operation(repository, signal) };
}
/** 预览与execute只使用同一份输入，避免批准后重新解析模型参数。
 * 输入完整预览与执行函数，输出一次性PreparedToolCall。
 * 取消先拒绝；同一闭包再次执行失败，调用者必须重新请求预览。
 */
function once(preview: string, execute: PreparedToolCall["execute"]): PreparedToolCall {
  let used = false;
  return { preview, async execute(signal) { signal.throwIfAborted(); if (used) throw new ToolError("本次工作区操作已经执行，请重新请求。"); used = true; return execute(signal); } };
}
/** 给模型返回完整身份快照。
 * 输入本地观测对象，输出JSON文字；不从模型回答补充缺少的状态。
 * 显示控制字符由UI处理，这里保留工具结果原文。
 */
export function describeWorktree(value: WorktreeSnapshot): string { return JSON.stringify(value, null, 2); }
/** 让模型正文和界面元数据携带同一工作区事实。
 * 输入快照、说明与失败标志，输出ToolExecutionResult。
 * isError表示操作未确认成功，目录或成果仍可能存在，不能据此自动回滚。
 */
export function worktreeResult(snapshot: WorktreeSnapshot, message: string, isError = false): ToolExecutionResult {
  return { content: `${message}\n${describeWorktree(snapshot)}`, isError, metadata: { kind: "worktree", worktree: snapshot } };
}

/** 管理当前CLI自己登记的工作区，所有自有副作用在本实例串行。
 * 输入可信本地启动目录；公开API返回快照或固定preview/execute。
 * 本机其他进程仍可能修改Git，身份检查与执行之间不是操作系统隔离。
 * 没有自动恢复、丢弃、reset、abort或递归删除入口。
 */
export class WorktreeManager {
  private readonly entries = new Map<string, Entry>();
  private directory?: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly cwd = process.cwd()) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> { const result = this.tail.then(action); this.tail = result.catch(() => {}); return result; }
  private entry(id: string): Entry { const entry = this.entries.get(id); if (!entry) throw new ToolError("未知WorktreeID；只接受本次CLI会话创建的工作区。"); return entry; }
  // [KEEP 来自 28.1] 检查时拒绝路径/仓库/分支身份冒充；路径检查与Git调用仍有TOCTOU间隔。
  private async verify(entry: Entry, signal?: AbortSignal): Promise<void> {
    const value = entry.snapshot;
    if (value.state !== "ready") throw new ToolError(`工作区状态为${value.state}，保留路径${value.path}，请先人工核实。`);
    if (await realpath(value.path) !== value.path) throw new ToolError("工作区真实路径发生变化。");
    const current = await origin(value.path, signal);
    if (current.repository !== value.path || current.commonDirectory !== value.commonDirectory || current.branch !== value.branch) throw new ToolError("工作区根、仓库或分支身份变化，拒绝操作。");
    const registration = await checked(value.repository, ["worktree", "list", "--porcelain"], signal);
    if (!registration.split("\n\n").some(block => block.split("\n").includes(`worktree ${value.path}`) && block.split("\n").includes(`branch refs/heads/${value.branch}`))) throw new ToolError("Git工作区登记与本地身份不一致。");
  }
  private async inspect(entry: Entry, signal?: AbortSignal): Promise<WorktreeSnapshot> {
    const value = entry.snapshot;
    if (value.state === "ready") {
      await this.verify(entry, signal);
      const target = await origin(value.repository, signal);
      if (target.repository !== value.repository || target.commonDirectory !== value.commonDirectory) throw new ToolError("原目标仓库身份变化。");
      value.headSha = await head(value.path, signal); value.targetSha = target.sha; value.currentTargetBranch = target.branch;
      value.dirty = await dirty(value.path, signal); value.targetDirty = target.dirty;
      value.hasIgnored = Boolean(await checked(value.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], signal));
      value.operation = await operation(value.path, signal); value.targetOperation = target.operation;
    }
    return structuredClone(value);
  }
  get(id: string, signal?: AbortSignal): Promise<WorktreeSnapshot> { return this.exclusive(() => this.inspect(this.entry(id), signal)); }
  list(signal?: AbortSignal): Promise<WorktreeSnapshot[]> { return this.exclusive(() => Promise.all([...this.entries.values()].map(entry => this.inspect(entry, signal)))); }
  async prepareCreate(signal?: AbortSignal): Promise<PreparedToolCall> {
    const before = await origin(this.cwd, signal), id = randomUUID(), taskBranch = `codex/hello-agent-${id}`;
    return once(`创建独立Git worktree\n仓库：${before.repository}\n目标分支：${before.branch}\nbase SHA：${before.sha}\n原目录dirty：${before.dirty}\n任务分支：${taskBranch}\n未提交、未跟踪和ignored文件仍留在原目录，不复制。工作区不是安全沙箱；当前CLI退出后登记不会恢复。Git可能运行受信本机仓库配置的filter/merge driver。`, executionSignal => this.exclusive(async () => {
      const current = await origin(this.cwd, executionSignal);
      if (current.repository !== before.repository || current.commonDirectory !== before.commonDirectory || current.branch !== before.branch || current.sha !== before.sha) throw new ToolError("创建审批后目标仓库、分支或HEAD变化，请重新请求。");
      if ([...this.entries.values()].filter(entry => entry.snapshot.state !== "removed").length >= 4 || this.entries.size >= 16) throw new ToolError("最多保留4个工作区、16条会话登记，请先处理已有成果。");
      this.directory ??= await realpath(await mkdtemp(join(tmpdir(), "hello-agent-worktrees-")));
      const value: WorktreeSnapshot = { id, path: join(this.directory, id), repository: before.repository, commonDirectory: before.commonDirectory,
        branch: taskBranch, baseSha: before.sha, targetBranch: before.branch, currentTargetBranch: current.branch, headSha: null, targetSha: before.sha, dirty: false, hasIgnored: false, operation: null, targetOperation: current.operation,
        targetDirty: current.dirty, state: "creating" };
      const entry: Entry = { snapshot: value }; this.entries.set(id, entry);
      try {
        await checked(value.repository, ["worktree", "add", "-b", taskBranch, "--", value.path, value.baseSha], executionSignal);
        value.state = "ready";
        return worktreeResult(await this.inspect(entry, executionSignal), "已创建真实工作区；未自动复制原目录dirty内容。");
      } catch (error) {
        value.state = "failed"; value.failure = error instanceof Error ? error.message : String(error);
        if (executionSignal.aborted) throw error;
        return worktreeResult(structuredClone(value), "创建未确认成功；保留登记、目录与可能已创建的分支，请按Git事实核实。", true);
      }
    }));
  }
  async prepareCommand(id: string, argumentsJson: string, signal?: AbortSignal): Promise<PreparedToolCall> {
    const entry = this.entry(id); await this.verify(entry, signal);
    const prepared = await prepareRunCommand(argumentsJson, entry.snapshot.path, signal);
    return once(`WorktreeID：${id}\n任务分支：${entry.snapshot.branch}\nbase SHA：${entry.snapshot.baseSha}\n${prepared.preview}\n命令仍可能访问工作区外的文件/网络；请核对完整命令。`, executionSignal => this.exclusive(async () => {
      await this.verify(entry, executionSignal);
      const result = await prepared.execute(executionSignal);
      return worktreeResult(await this.inspect(entry, executionSignal), result.content, Boolean(result.isError));
    }));
  }
}
