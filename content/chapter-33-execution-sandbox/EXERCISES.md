# 第 33 章练习与完整答案

[本章目录](/content/chapter-33-execution-sandbox/README.md)

## 练习：换一条访问路线，限制还在吗

本章自检验证了直接读写。现在把外部写入换成两条路线：第一条由命令再启动一个 Node.js 子进程，第二条沿项目内的符号链接写入项目外目录。两条命令都应被拒绝，外部目标文件也都不应存在。

以 33.3 完整快照为起点，新增 `src/sandbox/escape-check.ts`。函数创建自己拥有的临时目录，先用宿主写入做对照，再使用本章真实适配器执行命令，最后等待命令结束并清理。不拿用户真实凭据或项目外的已有文件做实验。

返回值包含 `control`、`childDenied` 和 `symlinkDenied`。只有三者都为 `true` 才算完成。还要解释：为什么只检查非零退出码不够，以及为什么 `cwd` 内的符号链接不能使系统限制失效。

## 完整答案

以下是新增文件的完整内容，可以直接保存；没有其他文件需要修改。它是独立验证函数，不会注册成模型工具，也不扩大运行时的允许范围。

<!-- answer-file: src/sandbox/escape-check.ts -->
```typescript
/**
 * 33 章练习：子进程与符号链接 | [NEW] sandbox/escape-check.ts
 * 输入：一次独占诊断请求；输出：宿主对照、子进程、符号链接三项结果。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：临时目录 -> 对照 -> 两条真实越界命令 -> 核对目标 -> finally清理。
 * 边界：函数不接入模型工具；只在没有其他沙箱任务的独立进程中调用。
 * 结束：runProcess等待命令收尾，再释放运行时和样本；不碰用户项目或凭据。
 */
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../processes/run-process.js";
import { wrapSandboxCommand, closeSandbox } from "./runtime.js";

// [NEW 第 33 章练习] 使用同一个真实适配器，不能在练习里模拟“被拒绝”。
/**
 * 编码宿主生成的脚本参数，不把临时路径里的字符当成 shell 语法。
 */
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
/**
 * 文件不存在才说明本次目标副作用没有发生，退出码本身不足以证明。
 */
async function missing(path: string): Promise<boolean> { try { await access(path); return false; } catch { return true; } }
/**
 * 验证限制跟随普通子进程，并按符号链接最终目标约束写入。
 * 宿主先对同一外部目录写入成功，排除文件权限本来就不可写的情况。
 */
export async function checkEscapeRoutes(signal?: AbortSignal): Promise<{ control: boolean; childDenied: boolean; symlinkDenied: boolean }> {
  const base = await mkdtemp(join(tmpdir(), "hello-agent-escape-check-"));
  try {
    const root = join(base, "project"), outside = join(base, "outside");
    await mkdir(root); await mkdir(outside);
    const controlFile = join(outside, "control");
    await writeFile(controlFile, "CONTROL_OK");
    const control = await readFile(controlFile, "utf8") === "CONTROL_OK";
    await symlink(outside, join(root, "link"));
    const childFile = join(outside, "child.txt"), linkedFile = join(outside, "linked.txt");
    /**
 * 子进程也走操作系统规则；shell字符串只由本次样本组成。
 */
    const execute = async (script: string) => {
      const wrapped = await wrapSandboxCommand(`${quote(process.execPath)} -e ${quote(script)}`, root, signal);
      return runProcess("/bin/sh", ["-c", wrapped], { cwd: root, signal, timeoutMs: 3000 });
    };
    const nestedScript = `require('node:fs').writeFileSync(${JSON.stringify(childFile)},'ESCAPED')`;
    const child = await execute(`const r=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(nestedScript)}],{stdio:'inherit'});process.exit(r.status??70)`);
    const linked = await execute("require('node:fs').writeFileSync('link/linked.txt','ESCAPED')");
    return { control, childDenied: child.exitCode !== 0 && await missing(childFile),
      symlinkDenied: linked.exitCode !== 0 && await missing(linkedFile) };
  } finally {
    try { await closeSandbox(); } finally { await rm(base, { recursive: true, force: true }); }
  }
}
```

子进程继承系统隔离，所以第二层 Node.js 的实际写入同样受限。符号链接本身在项目内，但最终写入目标在项目外，系统会根据最终访问位置拒绝操作。测试先确认外部目录对宿主可写，避免把普通权限错误误认为隔离成功；再同时检查命令失败和目标不存在，避免脚本先写成功、随后因其他原因退出失败。

在仓库根目录运行 `npm run check:33`，确认完整答案可以编译，并用真实进程验证两条越界路线。函数关闭共享运行时，因此只能在没有其他活动沙箱任务的独立验证进程中调用。
