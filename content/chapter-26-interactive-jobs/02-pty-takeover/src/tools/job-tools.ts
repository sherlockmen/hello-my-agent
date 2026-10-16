/**
 * 26.2 真实PTY | [CHANGED] tools/job-tools.ts
 * 模型只能批准启动/停止和只读观察；没有模型 stdin 工具。JobID 来自本会话真实 spawn。
 */
import { ToolError } from "../errors.js";
import { describeJob, type JobManager, type JobSnapshot } from "../processes/jobs.js";
import { prepareRunCommand } from "./run-command.js";
import type { PreparedToolCall, ToolExecutionResult } from "./types.js";

// [KEEP 来自 26.1] start_job 与 run_command 的等待退出语义各自明确。
export const startJobDefinition = {
  name: "start_job", description: "逐次批准后启动后台 pipe 或真实PTY作业，返回真实 JobID；running 不证明服务就绪。作业属于当前CLI会话；用read_job观察、stop_job停止。",
  inputSchema: { type: "object" as const, properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 100, maximum: 60_000 }, transport: { type: "string", enum: ["pipe", "pty"], description: "省略为非交互pipe；需要人类终端输入时选择真实pty" } }, required: ["command", "cwd"], additionalProperties: false },
};
export const readJobDefinition = {
  name: "read_job", description: "只读本次会话自有JobID的当前状态与有界尾日志；不知道ID时返回列表。旧会话的PID不能恢复。",
  inputSchema: { type: "object" as const, properties: { job_id: { type: "string" } }, additionalProperties: false },
};
export const stopJobDefinition = {
  name: "stop_job", description: "逐次批准后停止本会话自有JobID，等待对应transport收尾（pipe close / PTY onExit与订阅清理）后返回结果。",
  inputSchema: { type: "object" as const, properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false },
};
/** 参数、ID 与登记表在本地检查；不能靠模型给出的 PID 选中外部程序。 */
function parseId(json: string, required: boolean): string | undefined {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new ToolError("作业参数不是JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("作业参数必须是对象。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "job_id") || (input.job_id !== undefined && (typeof input.job_id !== "string" || !/^[0-9a-f-]{36}$/.test(input.job_id))) || (required && input.job_id === undefined)) throw new ToolError("只接受本次会话的 job_id，不接受PID。");
  return input.job_id as string | undefined;
}
/** 每条观察把同一状态同时送给模型与界面，不把stderr非空直接视为失败。 */
function result(job: JobSnapshot): ToolExecutionResult {
  return { content: describeJob(job), isError: job.state === "failed" || (job.state === "exited" && (job.exitCode !== 0 || Boolean(job.signal) || Boolean(job.stopReason))), metadata: { kind: "job", job } };
}
/** 启动/停止均先保存本次参数；批准前不启动或发信号。 */
export async function prepareJob(name: string, json: string, jobs: JobManager | undefined, signal: AbortSignal): Promise<PreparedToolCall> {
  if (!jobs) throw new ToolError("当前会话未连接作业管理器。");
  if (name === "start_job") {
    // [NEW 26.2] 先验证transport，再把其余参数交给已有命令/目录验证，禁止未知字段。
    let input: Record<string, unknown>; try { const parsed = JSON.parse(json); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); input = parsed; } catch { throw new ToolError("start_job参数必须是JSON对象。"); }
    const { transport = "pipe", ...commandInput } = input;
    if (transport !== "pipe" && transport !== "pty") throw new ToolError("transport只能是pipe或pty。");
    const prepared = await prepareRunCommand(JSON.stringify(commandInput), undefined, signal, async (command, cwd, executionSignal, timeoutMs) => result(await jobs.start({ command, cwd, timeoutMs, transport }, executionSignal)));
    return { ...prepared, preview: `启动后台作业（不会等待退出），transport=${transport}\n${prepared.preview}\n只管理本会话自有进程组；日志有界，退出Agent会清理作业。` };
  }
  const id = parseId(json, true)!;
  const job = jobs.get(id);
  return { preview: `停止本次会话作业\n${describeJob(job)}\n命令：${JSON.stringify(job.command)}\n目录：${JSON.stringify(job.cwd)}\n只批准这一次停止。`, async execute(executionSignal) { executionSignal.throwIfAborted(); return result(await jobs.stop(id)); } };
}
/** 只读观察无需审批，但只能查询当前登记表，不重连历史PID。 */
export async function readJob(json: string, jobs: JobManager | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted(); if (!jobs) throw new ToolError("当前会话未连接作业管理器。");
  const id = parseId(json, false);
  if (id) return result(jobs.get(id));
  return { content: jobs.list().map(job => `${job.id} ${job.state}`).join("\n") || "本次会话没有作业。", metadata: { kind: "job", job: null } };
}
