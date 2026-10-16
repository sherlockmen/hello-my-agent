/**
 * 36.3 配置与会话升级 | [KEEP] sandbox/diagnostics.ts
 * 学习目标：分开报告依赖条件与真实实验，不用“enabled”代替边界证明。
 * 输入：本次项目根或主动自检请求；输出：规则说明与逐项观察。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：临时样本 -> 宿主对照 -> 沙箱实际访问 -> 核对副作用 -> 清理。
 * 结束依据：所有子命令已关闭，HTTP 服务与运行时释放后才返回；失败给非零退出码由 CLI 设置。
 * 边界：仅使用假密钥与临时服务；不读取用户凭据，不宣称其他工具通道已经隔离。
 */
import { mkdtemp, mkdir, writeFile, readFile, access, rm, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { runProcess } from "../processes/run-process.js";
import { sandboxPolicy } from "./policy.js";
import { sandboxAvailability, wrapSandboxCommand, closeSandbox } from "./runtime.js";

// [KEEP 来自 33.3] 准备条件和实验结论采用不同字段，避免把包已安装当成限制已验证。
export type SandboxCheck = { name: string; passed: boolean; detail: string };
export type SandboxReport = { platform: string; runtime: string; passed: boolean; checks: SandboxCheck[] };

/**
 * POSIX shell 的单引号编码只用于宿主生成的 Node 命令，不插入用户提供的 shell 片段。
 */
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
/**
 * 生成使用本次 Node 可执行文件的命令，脚本与路径不会被 shell 再解释。
 */
function nodeCommand(script: string): string { return `${quote(process.execPath)} -e ${quote(script)}`; }
/**
 * 只核对临时目标是否存在，不通过错误文字推断副作用。
 */
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

/**
 * 显示当前项目规则与依赖，明确没有执行实验；不创建模型或初始化共享代理。
 * 路径不存在时向外报错，避免用不同目录冒充用户请求的项目。
 */
export async function sandboxInfo(projectRoot: string): Promise<{ text: string; available: boolean }> {
  const root = await realpath(projectRoot);
  const status = await sandboxAvailability();
  const policy = sandboxPolicy(root);
  return { available: status.errors.length === 0, text: [
    `Sandbox runtime: @anthropic-ai/sandbox-runtime@${status.runtime}`,
    `平台: ${status.platform}；准备条件: ${status.errors.length ? "不可用" : "依赖检查通过"}`,
    "边界实验: 未执行；使用 --sandbox-check 主动验证。",
    `依赖错误: ${status.errors.join("；") || "无"}`,
    `依赖提醒: ${status.warnings.join("；") || "无"}`,
    `项目规则: ${JSON.stringify(policy.filesystem, null, 2)}`,
    `运行时额外可写位置: ${JSON.stringify(status.defaultWritePaths)}`,
    "命令网络: 空允许列表；禁止直接联网与临时询问放行。",
    "已接入: run_command、check_project、start_job(pipe/PTY)。",
    "独立通道: 模型API、内置文件/搜索/Git辅助、语言服务、Hooks、MCP、扩展处理器。",
    "读规则只保护列出的路径，不扫描其他命名或嵌套秘密；Linux新建路径需重新包装并实测。",
  ].join("\n") };
}

/**
 * 创建可控样本：宿主先证明文件与本地 HTTP 可用，再由真实沙箱拒绝越界访问。
 * 请求停止交给共享执行器，finally 等子命令结束后清理服务、代理与样本。
 * 自检独占 CLI 管理分支；不能在仍有其他沙箱任务时调用 closeSandbox。
 */
export async function runSandboxCheck(): Promise<SandboxReport> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("沙箱自检已取消。"));
  const base = await mkdtemp(join(tmpdir(), "hello-agent-sandbox-check-"));
  process.once("SIGINT", cancel);
  const sockets = new Set<Socket>();
  let requests = 0;
  const token = `FAKE_SECRET_${randomUUID()}`;
  const server = createServer((_request, response) => { requests++; response.end("LOCAL_CONTROL_OK"); });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  try {
    const status = await sandboxAvailability();
    if (status.errors.length) throw new Error(`隔离不可用：${status.errors.join("；")}。没有启动未隔离命令。`);
    const root = join(base, "project"), outside = join(base, "outside.txt"), inside = join(root, "report.txt");
    await mkdir(root);
    await writeFile(join(root, ".env"), token);
    await writeFile(outside, "HOST_WRITE_OK");
    const hostFiles = await readFile(outside, "utf8") === "HOST_WRITE_OK"
      && await readFile(join(root, ".env"), "utf8") === token;
    await rm(outside);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("临时 HTTP 服务没有获得端口。");
    const url = `http://127.0.0.1:${address.port}`;
    const hostNetwork = await (await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) })).text() === "LOCAL_CONTROL_OK";
    const requestCount = requests;
    /**
 * 每次都走真实包装入口并等待管道关闭；不是模拟拒绝结果。
 */
    const execute = async (script: string) => {
      const command = await wrapSandboxCommand(nodeCommand(script), root, controller.signal);
      return runProcess("/bin/sh", ["-c", command], { cwd: root, signal: controller.signal, timeoutMs: 4000 });
    };
    const allowed = await execute(`require('node:fs').writeFileSync(${JSON.stringify(inside)},'INSIDE_OK')`);
    const deniedWrite = await execute(`require('node:fs').writeFileSync(${JSON.stringify(outside)},'ESCAPED')`);
    const deniedRead = await execute("process.stdout.write(require('node:fs').readFileSync('.env','utf8'))");
    const deniedNetwork = await execute(`const http=require('node:http');const request=http.get(${JSON.stringify(url)},r=>{r.resume();r.on('end',()=>process.exit(0))});request.on('error',()=>process.exit(71));request.setTimeout(1500,()=>{request.destroy();process.exit(72)})`);
    const checks: SandboxCheck[] = [
      { name: "宿主对照", passed: hostFiles && hostNetwork && requestCount === 1, detail: "宿主可写外部样本、读假.env、访问本地HTTP。" },
      { name: "项目内写入", passed: allowed.exitCode === 0 && await readFile(inside, "utf8") === "INSIDE_OK", detail: `exit=${allowed.exitCode}` },
      { name: "项目外写入拒绝", passed: deniedWrite.exitCode !== 0 && !await exists(outside), detail: `exit=${deniedWrite.exitCode}；外部目标不存在。` },
      { name: "假密钥读取拒绝", passed: deniedRead.exitCode !== 0 && !deniedRead.stdout.includes(token), detail: `exit=${deniedRead.exitCode}；stdout不含假密钥。` },
      { name: "直接网络连接拒绝", passed: deniedNetwork.exitCode !== 0 && requests === requestCount, detail: `exit=${deniedNetwork.exitCode}；HTTP请求数=${requests}，宿主对照后未增加。` },
    ];
    return { platform: status.platform, runtime: status.runtime, passed: checks.every(check => check.passed), checks };
  } finally {
    try {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      try { await closeSandbox(); }
      finally { await rm(base, { recursive: true, force: true }); process.removeListener("SIGINT", cancel); }
    }
  }
}

/**
 * 用可读文本呈现观察，只有全部实验通过才给出通过结论。
 */
export function formatSandboxReport(report: SandboxReport): string {
  return [`Sandbox runtime: ${report.runtime}；平台: ${report.platform}`,
    ...report.checks.map(check => `${check.passed ? "PASS" : "FAIL"} ${check.name}：${check.detail}`),
    report.passed ? "本次边界实验通过；范围仅限列出的样本与通道。" : "边界实验失败，请按具体项目排查；没有自动降级。"].join("\n");
}
