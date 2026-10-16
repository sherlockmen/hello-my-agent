/**
 * 36.3 配置与会话升级 | [KEEP] evaluation/terminal.ts
 * 学习目标：用真实编辑/浏览模块与本地PTY验证输入所有权、尺寸变化和退出。
 * 输入：评测输出目录；输出：有名字的探针结果，不冒称所有UI交互已覆盖。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：编辑与布局断言 -> PTY独占输入 -> 真尺寸变化 -> EOF -> 等待清理。
 * 状态：只启动当前评测自有的固定子进程；失败仍等待close，不留下后台探针。
 */
// [KEEP 来自 35.2] 探针复用真实模块；终端截图或模型文字不代替断言。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { JobManager } from "../processes/jobs.js";
import { draftLines, editKey, insertText, newDraft } from "../ui/tui/editor.js";
import { transcriptLines, visibleStart } from "../ui/tui/transcript.js";

export type TerminalProbe = { name: string; passed: boolean };

/** 在固定期限内等待真实输出条件，超时是失败，不无限等待终端安静。 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("终端探针没有在期限内给出预期事实。");
    await delay(20);
  }
}

/** 固定启动参数仍按shell字面值引用，目录中的空格或引号不能改变命令。 */
function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

/**
 * 每个通过记录都在实际断言后写入；某一步失败会留下该项失败，并统一等待自有作业收尾。
 * 只验证列出的机制；React焦点、终端软件差异和其他平台仍需要各自实测。
 */
export async function runTerminalProbes(outputDirectory: string): Promise<TerminalProbe[]> {
  const results: TerminalProbe[] = [];
  const check = (name: string, operation: () => void) => {
    try { operation(); results.push({ name, passed: true }); }
    catch { results.push({ name, passed: false }); }
  };
  check("long-draft-unicode", () => {
    const text = "中文👨‍👩‍👧‍👦é\n".repeat(300);
    const draft = insertText(newDraft(), text);
    assert.equal(editKey(draft, "", { leftArrow: true }).text, text);
    const displayed = draftLines(draft, 20, 5);
    assert.equal(displayed.length, 5);
    assert.equal(displayed.filter(line => line.cursor !== undefined).length, 1);
    assert.equal(editKey(draft, "z", { ctrl: true }).text, "");
    assert.equal(draft.past.length, 1);
  });
  check("resize-reading-anchor", () => {
    const entries = [{ id: "long-output", label: "工具" as const, text: "中文🙂".repeat(120) }];
    const anchor = transcriptLines(entries, 60, new Set())[3];
    const lines = transcriptLines(entries, 22, new Set());
    const start = visibleStart(lines, 5, anchor);
    assert.equal(lines[start].id, anchor.id);
    assert.ok(lines[start].offset <= anchor.offset);
    assert.ok(lines[start + 1].offset > anchor.offset);
  });
  await mkdir(outputDirectory, { recursive: true });
  const directory = await mkdtemp(join(outputDirectory, "terminal-"));
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  const script = join(directory, "probe.mjs");
  await writeFile(script, 'process.stdin.on("data",data=>console.log("INPUT:"+data.toString().trim()));process.stdin.on("end",()=>{console.log("EOF_DONE");process.exit(0)});process.stdout.on("resize",()=>console.log("SIZE:"+process.stdout.columns+":"+process.stdout.rows));console.log("EVAL_READY:"+process.stdin.isTTY+":"+process.stdout.isTTY);');
  const jobs = new JobManager();
  let current = "pty-start";
  try {
    const job = await jobs.start({ command: `${quote(process.execPath)} ${quote(script)}`, cwd: directory, transport: "pty", timeoutMs: 6000 });
    await until(() => jobs.get(job.id).log.includes("EVAL_READY:true:true"));
    results.push({ name: current, passed: true });
    current = "pty-exclusive-input";
    const owner = jobs.attach(job.id, () => {});
    assert.throws(() => jobs.attach(job.id, () => {}), /所有者/);
    owner.write("HUMAN_TEXT\n");
    await until(() => jobs.get(job.id).log.includes("INPUT:HUMAN_TEXT"));
    owner.detach();
    assert.throws(() => owner.write("STALE_INPUT"), /接管已结束/);
    results.push({ name: current, passed: true });
    current = "pty-resize";
    const next = jobs.attach(job.id, () => {});
    next.resize(93, 31);
    await until(() => jobs.get(job.id).log.includes("SIZE:93:31"));
    results.push({ name: current, passed: true });
    current = "pty-eof-exit";
    next.eof();
    const ended = await jobs.wait(job.id);
    next.detach();
    assert.equal(ended.exitCode, 0);
    assert.ok(ended.log.includes("EOF_DONE"));
    results.push({ name: current, passed: true });
  } catch { results.push({ name: current, passed: false }); }
  finally { await jobs.close(); }
  return results;
}
