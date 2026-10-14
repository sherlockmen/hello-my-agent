/** 第 07 章验收：只在临时项目运行命令，使用内存模型，不调用在线服务。 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "hello-my-agent-07-"));
const workspace = join(temporary, "project");
const originalCwd = process.cwd();
mkdirSync(workspace);
writeFileSync(join(workspace, "package.json"), "{}\n");
const signal = () => new AbortController().signal;
const call = (id, name, input) => ({ id, name, arguments: JSON.stringify(input) });
const response = (toolCalls, text = "") => ({ text, toolCalls, inputTokens: 1, outputTokens: 1, truncated: false });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** 独立编译快照，避免改变用户当前选择的 dist。 */
function compile(lesson) {
  const source = join(root, "chapter-07-command-feedback", lesson, "src");
  const project = join(temporary, lesson);
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), '{"type":"module"}');
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"));
  const outDir = join(project, "dist");
  const config = join(project, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ extends: join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir,
      typeRoots: [join(root, "node_modules/@types")] }, include: [join(source, "cli.ts")] }));
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  return outDir;
}

/** 等待测试进程写入就绪文件，避免用固定休眠猜测启动完成。 */
async function waitForFile(path) {
  const deadline = Date.now() + 3000;
  while (!existsSync(path) && Date.now() < deadline) await wait(20);
  assert.ok(existsSync(path), `进程未就绪：${path}`);
}

/** 等待自己创建的进程消失，验证停止动作不是只结束了 Promise。 */
async function assertGone(pid) {
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await wait(20);
  }
  assert.fail(`测试进程 ${pid} 未被清理`);
}

try {
  process.chdir(workspace);
  for (const lesson of ["01-run-command", "02-process-lifecycle", "03-ripgrep-search"]) {
    const dist = compile(lesson);
    const load = (path) => import(pathToFileURL(join(dist, path)));
    const { prepareRunCommand } = await load("tools/run-command.js");
    const { executeTool } = await load("tools/registry.js");
    const { decideToolPermission } = await load("permissions/policy.js");
    const { agentLoop } = await load("agent/agent-loop.js");
    const { formatTeachingTrace } = await load("ui/teaching-trace.js");
    const denied = call("denied", "run_command", { command: "node -e \"require('fs').writeFileSync('denied.txt','no')\"", cwd: "." });
    const decision = await decideToolPermission(denied, new Set(["run_command:once"]));
    assert.equal(decision.action, "ask");
    assert.equal(decision.remember, false);
    await assert.rejects(executeTool(denied, signal()), /必须先/);
    for (const approval of ["deny", "allow_session"]) {
      let turn = 0;
      const observed = [];
      const model = { async generate(messages) {
        if (turn++ === 0) return response([denied]);
        assert.equal(messages.at(-1).isError, true);
        return response([], "没有执行");
      } };
      await agentLoop(model, [], "执行命令", signal(), (e) => observed.push(e), async () => ({ decision: approval, reason: "测试" }));
      assert.equal(existsSync(join(workspace, "denied.txt")), false);
      assert.equal(observed.some((e) => e.type === "tool_start"), false);
    }
    for (const input of [{ command: "pwd", cwd: ".." }, { command: "pwd", cwd: "/tmp" },
      { command: "pwd", cwd: "missing" }, { command: "", cwd: "." }, { command: "pwd", cwd: ".", extra: true }]) {
      await assert.rejects(prepareRunCommand(JSON.stringify(input), workspace), /cwd|command/);
    }
    mkdirSync(join(workspace, "race"));
    const stale = await prepareRunCommand(JSON.stringify({ command: "pwd", cwd: "race" }));
    renameSync(join(workspace, "race"), join(workspace, "race-old"));
    mkdirSync(join(workspace, "race"));
    await assert.rejects(stale.execute(signal()), /发生了变化/);
    rmSync(join(workspace, "race"), { recursive: true });
    rmSync(join(workspace, "race-old"), { recursive: true });

    cpSync(join(root, "chapter-07-command-feedback/demo"), join(workspace, "demo"), { recursive: true });
    // 练习源码可能已经被读者修好；只在测试创建的临时副本中恢复故障起点。
    writeFileSync(join(workspace, "demo/add.mjs"), "export function add(a, b) { return a - b; }\n");
    const messagesSeen = [];
    const events = [];
    const script = [response([call("test-fails", "run_command", { command: "node --test add.test.mjs", cwd: "demo" })]),
      response([call("repair", "edit_file", { path: "demo/add.mjs", old_text: "a - b", new_text: "a + b" })]),
      response([call("test-passes", "run_command", { command: "node --test add.test.mjs", cwd: "demo" })]),
      response([], "已修复，实际测试通过")];
    const model = { async generate(messages) { messagesSeen.push(structuredClone(messages)); return script.shift(); } };
    let approvals = 0;
    const reply = await agentLoop(model, [], "修复加法测试", signal(), (e) => events.push(e), async (request) => {
      approvals++;
      assert.equal(request.allowSession, false);
      assert.ok(request.preview.length > 0);
      return { decision: "allow_once" };
    });
    assert.equal(approvals, 3);
    assert.equal(reply.text, "已修复，实际测试通过");
    assert.match(messagesSeen[1].at(-1).content, /退出码: 1/);
    assert.equal(messagesSeen[1].at(-1).isError, true);
    assert.match(messagesSeen[3].at(-1).content, /退出码: 0/);
    assert.equal(messagesSeen[3].at(-1).isError, false);
    assert.equal(messagesSeen[1].at(-1).toolCallId, "test-fails");
    const trace = events.flatMap(formatTeachingTrace).join("\n");
    assert.match(trace, /退出码 1/);
    assert.match(trace, /stdout：/);
    assert.match(trace, /stderr：/);
    const warning = await prepareRunCommand(JSON.stringify({ command: "node -e \"console.error('warning')\"", cwd: "." }));
    const warned = await warning.execute(signal());
    assert.equal(warned.isError, false, "stderr 非空不等于失败");
    assert.match(warned.metadata.stderr, /warning/);

    if (lesson === "01-run-command") continue;
    const { runProcess } = await load("processes/run-process.js");
    const options = { cwd: workspace, timeoutMs: 1000 };
    const eof = await runProcess(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>console.log('EOF'))"], options);
    assert.equal(eof.stdout.trim(), "EOF");
    const split = await runProcess(process.execPath, ["-e", "console.log('out');console.error('err');process.exitCode=7"], options);
    assert.equal(split.exitCode, 7);
    assert.equal(split.stdout.trim(), "out");
    assert.equal(split.stderr.trim(), "err");
    const limited = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], { ...options, maxOutputBytes: 1000 });
    assert.equal(limited.stopReason, "output_limit");
    assert.ok(Buffer.byteLength(limited.stdout) + Buffer.byteLength(limited.stderr) <= 1000);
    const slow = await runProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { ...options, timeoutMs: 200 });
    assert.equal(slow.stopReason, "timeout");
    assert.equal(slow.signal, "SIGKILL");
    await assert.rejects(runProcess("hello-my-agent-absent-program", [], options), /ENOENT/);
    const ready = join(workspace, "descendant.pid");
    rmSync(ready, { force: true });
    const grandchild = `require('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
    const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
    const controller = new AbortController();
    const cancelled = runProcess(process.execPath, ["-e", parent], { cwd: workspace, signal: controller.signal });
    const rejected = assert.rejects(cancelled, { name: "AbortError" });
    await waitForFile(ready);
    const pid = Number(readFileSync(ready, "utf8"));
    controller.abort();
    await rejected;
    await assertGone(pid);
    process.env.OPENAI_API_KEY_TEST_SENTINEL = "do-not-inherit";
    const env = await runProcess(process.execPath, ["-e", "console.log(process.env.OPENAI_API_KEY_TEST_SENTINEL ?? 'absent')"], options);
    delete process.env.OPENAI_API_KEY_TEST_SENTINEL;
    assert.equal(env.stdout.trim(), "absent");

    if (lesson !== "03-ripgrep-search") continue;
    const { globTool } = await load("tools/glob.js");
    const { grepTool } = await load("tools/grep.js");
    mkdirSync(join(workspace, "search"));
    for (const path of ["visible.ts", "ignored.ts", ".env", ".env.local"]) writeFileSync(join(workspace, "search", path), "export const needle = 7;\n");
    mkdirSync(join(workspace, "search/.git"));
    writeFileSync(join(workspace, "search/.git/config"), "needle");
    writeFileSync(join(workspace, ".gitignore"), "search/ignored.ts\n");
    symlinkSync(join(workspace, "search/.env"), join(workspace, "search/link.ts"));
    const discovered = await globTool('{"pattern":"search/**/*"}');
    assert.deepEqual(discovered.metadata.paths, ["search/visible.ts"]);
    const searched = await grepTool('{"query":"needle","glob":"search/**/*.ts"}');
    assert.equal(searched.metadata.count, 1);
    assert.equal(searched.metadata.locations[0].line, 1);
    assert.match(searched.content, /visible\.ts:1:14/);
    assert.equal((await grepTool('{"query":"absent","glob":"search/**/*.ts"}')).metadata.count, 0);
    await assert.rejects(grepTool('{"query":"(?=needle)","glob":"search/**/*.ts"}'), /rg 搜索失败/);
    await assert.rejects(globTool('{"pattern":"!**/*"}'), /pattern/);
    writeFileSync(join(workspace, "search/dashes.ts"), "two--dashes\n");
    assert.equal((await grepTool('{"query":"--","glob":"search/dashes.ts"}')).metadata.count, 1);
    const shellText = await grepTool(JSON.stringify({ query: "needle;touch injected", glob: "search/**/*.ts" }));
    assert.equal(shellText.metadata.count, 0);
    assert.equal(existsSync(join(workspace, "injected")), false);
    writeFileSync(join(workspace, "search/large.ts"), "needle\n" + "x".repeat(2 * 1024 * 1024));
    assert.equal((await grepTool('{"query":"needle","glob":"search/large.ts"}')).metadata.count, 0);
    writeFileSync(join(workspace, "search/noisy.ts"), "needle".repeat(60000));
    await assert.rejects(grepTool('{"query":"needle","glob":"search/noisy.ts"}'), /输出超过 256 KiB/);
    writeFileSync(join(workspace, "search/pathological.ts"), "a".repeat(20000) + "!\n");
    const started = Date.now();
    await grepTool('{"query":"(a+)+$","glob":"search/pathological.ts"}');
    assert.ok(Date.now() - started < 5000, "默认正则不能卡住 Agent 主线程");

    // 实际单次入口收到 SIGINT 后，要把取消信号传给进程并以 130 退出。
    const singleReady = join(workspace, "single.pid");
    const launcher = join(temporary, "single.mjs");
    const childCode = `require('fs').writeFileSync(${JSON.stringify(singleReady)}, String(process.pid));setInterval(()=>{},1000)`;
    writeFileSync(launcher, `import {runSinglePrompt} from ${JSON.stringify(pathToFileURL(join(dist, "ui/terminal.js")).href)};
      import {runProcess} from ${JSON.stringify(pathToFileURL(join(dist, "processes/run-process.js")).href)};
      await runSinglePrompt({generate:async(_,signal)=>{await runProcess(process.execPath,['-e',${JSON.stringify(childCode)}],{cwd:${JSON.stringify(workspace)},signal});return {text:'unexpected',toolCalls:[]}}},'cancel');`);
    const app = spawn(process.execPath, [launcher], { stdio: "pipe" });
    const exited = new Promise((resolveExit, rejectExit) => { app.once("error", rejectExit); app.once("close", (code, sig) => resolveExit({ code, sig })); });
    await waitForFile(singleReady);
    app.kill("SIGINT");
    assert.deepEqual(await exited, { code: 130, sig: null });
    await assertGone(Number(readFileSync(singleReady, "utf8")));
  }
  console.log("✓ 第 07 章：审批、测试失败→修改→复测、输出/期限/EOF/取消、同组清理与 rg 搜索通过");
} finally {
  process.chdir(originalCwd);
  rmSync(temporary, { recursive: true, force: true });
}
