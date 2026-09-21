/**
 * 第 05 章确定性验收：逐节验证策略、一次审批和会话授权。
 *
 * +-----------+      +------------+      +------------+      +------+
 * | ToolCall  | ---> | permission | ---> | approval?  | ---> | tool |
 * +-----------+      +------------+      +------------+      +------+
 *
 * 测试使用临时项目和内存模型，不调用真实模型，也不修改用户项目文件。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "hello-my-agent-05-"));
const workspace = join(sandbox, "project");
mkdirSync(join(workspace, ".git"), { recursive: true });
mkdirSync(join(workspace, ".agents"), { recursive: true });
mkdirSync(join(workspace, ".codex"), { recursive: true });
writeFileSync(join(workspace, "package.json"), "{}");
writeFileSync(join(workspace, "source.ts"), "export const answer = 42;\n");
writeFileSync(join(workspace, ".env"), "SECRET=must-not-reach-model\n");
writeFileSync(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");
writeFileSync(join(workspace, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");
writeFileSync(join(workspace, ".agents", "rules.md"), "local rules\n");
writeFileSync(join(workspace, ".codex", "note.txt"), "separate approval scope\n");
writeFileSync(join(sandbox, "outside.txt"), "outside project\n");
symlinkSync(".git/HEAD", join(workspace, "hidden-git-head"));
symlinkSync(join(sandbox, "outside.txt"), join(workspace, "outside-link"));

/** 编译一个独立小节，确保测试使用该节自己的完整源码快照。 */
function compileSnapshot(lesson, label) {
  const source = resolve(root, `chapter-05-permission-gate/${lesson}/src`);
  const project = join(sandbox, label);
  const output = join(project, "dist");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir");
  const config = join(project, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      noEmitOnError: true,
      rootDir: source,
      outDir: output,
      typeRoots: [join(root, "node_modules/@types")],
    },
    include: [join(source, "cli.ts")],
  }));
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", config], {
    cwd: root,
    stdio: "inherit",
  });
  return output;
}

const toolCall = (id, path) => ({
  id,
  name: "read_file",
  arguments: JSON.stringify({ path, offset: 1, limit: 20 }),
});
const modelResult = (toolCalls, text = "") => ({
  text,
  toolCalls,
  inputTokens: 1,
  outputTokens: 1,
  truncated: false,
});

/** 建立按顺序返回结果的内存模型，并保存每次真正收到的消息。 */
function scriptedModel(results) {
  const received = [];
  return {
    received,
    async generate(messages) {
      received.push(structuredClone(messages));
      const result = results.shift();
      assert.ok(result, "内存模型缺少下一次返回值");
      return result;
    },
  };
}

/** 建立可控的逐行输入，让终端审批适配器消费与真实 readline 相同的 next() 契约。 */
function inputLines(...values) {
  let index = 0;
  return {
    async next() {
      return index < values.length
        ? { value: values[index++], done: false }
        : { value: undefined, done: true };
    },
  };
}

/** 捕获终端适配器的提示文字，避免测试输出混入交互提示。 */
async function captureTerminalOutput(run) {
  const output = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  console.log = (...values) => output.push(`${values.join(" ")}\n`);
  process.stdout.write = (value) => {
    output.push(String(value));
    return true;
  };
  try {
    return { result: await run(), output: output.join("") };
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
}

try {
  process.chdir(workspace);

  const first = compileSnapshot("01-policy-decision", "policy");
  const firstPolicy = await import(pathToFileURL(join(first, "permissions/policy.js")));
  const firstLoop = await import(pathToFileURL(join(first, "agent/agent-loop.js")));
  const firstRegistry = await import(pathToFileURL(join(first, "tools/registry.js")));
  assert.equal((await firstPolicy.decideToolPermission(toolCall("a", "source.ts"))).action, "allow");
  assert.equal((await firstPolicy.decideToolPermission(toolCall("b", ".git/HEAD"))).action, "ask");
  assert.equal((await firstPolicy.decideToolPermission(toolCall("c", ".env"))).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission(toolCall("d", "../outside.txt"))).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission(toolCall("e", "C:\\outside.txt"))).action, "deny");
  const hiddenGit = await firstPolicy.decideToolPermission(toolCall("f", "hidden-git-head"));
  assert.equal(hiddenGit.action, "ask");
  assert.match(hiddenGit.resource, /hidden-git-head -> \.git\/HEAD/);
  assert.equal((await firstPolicy.decideToolPermission(toolCall("g", "outside-link"))).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission({ id: "unknown", name: "shell", arguments: "{}" })).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission({ id: "json", name: "read_file", arguments: "{" })).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission({ id: "array", name: "read_file", arguments: "[]" })).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission({ id: "path", name: "read_file", arguments: "{}" })).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission(toolCall("agents", ".agents/rules.md"))).action, "ask");
  const protectedGrep = {
    id: "grep-protected",
    name: "grep",
    arguments: JSON.stringify({ query: "approval scope", glob: ".codex/**/*.txt" }),
  };
  assert.equal((await firstPolicy.decideToolPermission(protectedGrep)).action, "deny");
  const protectedGlob = {
    id: "glob-protected",
    name: "glob",
    arguments: JSON.stringify({ pattern: ".agents/**/*.md" }),
  };
  assert.equal((await firstPolicy.decideToolPermission(protectedGlob)).action, "deny");
  const broadGrep = await firstRegistry.executeTool({
    id: "grep-broad",
    name: "grep",
    arguments: JSON.stringify({ query: "approval scope|local rules", glob: "**/*" }),
  }, new AbortController().signal);
  assert.equal(broadGrep.metadata.count, 0, "宽泛搜索必须跳过受保护元数据目录");

  const blockedModel = scriptedModel([
    modelResult([toolCall("blocked", ".git/HEAD")]),
    modelResult([], "已说明没有执行"),
  ]);
  const blockedEvents = [];
  await firstLoop.agentLoop(
    blockedModel,
    [],
    "读取 Git HEAD",
    new AbortController().signal,
    (event) => blockedEvents.push(event),
  );
  const blockedResult = blockedModel.received[1].at(-1);
  assert.equal(blockedResult.role, "tool");
  assert.equal(blockedResult.isError, true);
  assert.match(blockedResult.content, /尚未接入审批/);
  assert.doesNotMatch(blockedResult.content, /refs\/heads\/main/);
  assert.deepEqual(blockedEvents.filter((event) =>
    ["permission_check", "tool_start"].includes(event.type)).map((event) => event.type),
  ["permission_check"]);

  const second = compileSnapshot("02-terminal-approval", "approval");
  const secondLoop = await import(pathToFileURL(join(second, "agent/agent-loop.js")));
  const secondTerminal = await import(pathToFileURL(join(second, "ui/terminal.js")));
  const approvalRequest = {
    call: toolCall("terminal", ".git/HEAD"),
    reason: "读取 .git 项目元数据需要用户确认",
    resource: ".git/HEAD",
    scope: "read_file:.git/**",
  };
  const approvalChoices = secondTerminal.createApprovalHandler(inputLines("y", "n"), true);
  const allowedByTerminal = await captureTerminalOutput(() =>
    approvalChoices(approvalRequest, new AbortController().signal));
  assert.deepEqual(allowedByTerminal.result, { decision: "allow_once" });
  assert.match(allowedByTerminal.output, /允许这一次操作吗/);
  assert.deepEqual((await captureTerminalOutput(() =>
    approvalChoices(approvalRequest, new AbortController().signal))).result,
  { decision: "deny", reason: "用户拒绝" });
  assert.deepEqual((await captureTerminalOutput(() =>
    secondTerminal.createApprovalHandler(inputLines(), true)(
      approvalRequest,
      new AbortController().signal,
    ))).result,
  { decision: "deny", reason: "输入已结束" });
  assert.deepEqual((await captureTerminalOutput(() =>
    secondTerminal.createApprovalHandler(undefined, false)(
      approvalRequest,
      new AbortController().signal,
    ))).result,
  { decision: "deny", reason: "非交互运行不能请求批准" });

  let releaseApprovalInput;
  const waitingLines = {
    next: () => new Promise((resolve) => { releaseApprovalInput = resolve; }),
  };
  const cancellation = new AbortController();
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  console.log = () => {};
  process.stdout.write = () => true;
  try {
    const waitingApproval = secondTerminal.createApprovalHandler(waitingLines, true)(approvalRequest, cancellation.signal);
    let waitingSettled = false;
    waitingApproval.then(
      () => { waitingSettled = true; },
      () => { waitingSettled = true; },
    );
    cancellation.abort();
    await Promise.resolve();
    assert.equal(waitingSettled, false, "abort 不会自动结束任意的 lines.next()");
    releaseApprovalInput({ value: undefined, done: true });
    await assert.rejects(waitingApproval, { name: "AbortError" });
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }

  const approvedModel = scriptedModel([
    modelResult([toolCall("approved", ".git/HEAD")]),
    modelResult([], "读取完成"),
  ]);
  let approvalRequests = 0;
  const approvalEvents = [];
  const allowOnce = secondTerminal.createApprovalHandler(inputLines("y"), true);
  await secondLoop.agentLoop(
    approvedModel,
    [],
    "读取 Git HEAD",
    new AbortController().signal,
    (event) => approvalEvents.push(event),
    async (request) => {
      approvalRequests += 1;
      assert.equal(request.resource, ".git/HEAD");
      assert.equal(request.scope, "read_file:.git/**");
      return (await captureTerminalOutput(() =>
        allowOnce(request, new AbortController().signal))).result;
    },
  );
  assert.equal(approvalRequests, 1);
  assert.match(approvedModel.received[1].at(-1).content, /refs\/heads\/main/);
  assert.deepEqual(approvalEvents.filter((event) =>
    ["permission_check", "approval_start", "approval_finish", "tool_start", "tool_finish"]
      .includes(event.type)).map((event) => event.type),
  ["permission_check", "approval_start", "approval_finish", "tool_start", "tool_finish"]);

  const deniedModel = scriptedModel([
    modelResult([toolCall("denied", ".git/HEAD")]),
    modelResult([], "已停止"),
  ]);
  const denyOnce = secondTerminal.createApprovalHandler(inputLines("n"), true);
  await secondLoop.agentLoop(
    deniedModel,
    [],
    "读取 Git HEAD",
    new AbortController().signal,
    undefined,
    async (request, signal) => (await captureTerminalOutput(() => denyOnce(request, signal))).result,
  );
  assert.match(deniedModel.received[1].at(-1).content, /用户未批准/);
  assert.doesNotMatch(deniedModel.received[1].at(-1).content, /refs\/heads\/main/);

  const missingHandlerModel = scriptedModel([
    modelResult([toolCall("missing-handler", ".git/HEAD")]),
    modelResult([], "已说明当前无法审批"),
  ]);
  await secondLoop.agentLoop(
    missingHandlerModel,
    [],
    "读取 Git HEAD",
    new AbortController().signal,
  );
  assert.match(missingHandlerModel.received[1].at(-1).content, /无法请求用户批准/);
  assert.doesNotMatch(missingHandlerModel.received[1].at(-1).content, /refs\/heads\/main/);

  const third = compileSnapshot("03-session-grants", "session");
  const thirdPolicy = await import(pathToFileURL(join(third, "permissions/policy.js")));
  const thirdLoop = await import(pathToFileURL(join(third, "agent/agent-loop.js")));
  const thirdTerminal = await import(pathToFileURL(join(third, "ui/terminal.js")));
  const grants = new Set();
  let sessionPrompts = 0;
  const allowSession = thirdTerminal.createApprovalHandler(inputLines("s"), true);
  const firstTurn = scriptedModel([
    modelResult([toolCall("session-1", ".git/HEAD")]),
    modelResult([], "第一次读取完成"),
  ]);
  await thirdLoop.agentLoop(
    firstTurn,
    [],
    "读取 Git HEAD",
    new AbortController().signal,
    undefined,
    async (request, signal) => {
      sessionPrompts += 1;
      return (await captureTerminalOutput(() => allowSession(request, signal))).result;
    },
    grants,
  );
  assert.deepEqual([...grants], ["read_file:.git/**"]);

  const secondTurn = scriptedModel([
    modelResult([toolCall("session-2", ".git/config")]),
    modelResult([], "第二次读取完成"),
  ]);
  await thirdLoop.agentLoop(
    secondTurn,
    [],
    "读取 Git config",
    new AbortController().signal,
    undefined,
    async () => {
      sessionPrompts += 1;
      return { decision: "deny", reason: "不应再次询问" };
    },
    grants,
  );
  assert.equal(sessionPrompts, 1, "同一会话、同一范围不应再次询问");
  assert.match(secondTurn.received[1].at(-1).content, /repositoryformatversion/);
  const nestedGit = await thirdPolicy.decideToolPermission(
    toolCall("nested-git", "packages/demo/.git/config"),
    grants,
  );
  assert.equal(nestedGit.action, "ask", "不同位置的 .git 目录不能共用批准记录");
  assert.equal(nestedGit.scope, "read_file:packages/demo/.git/**");
  assert.equal((await thirdPolicy.decideToolPermission(toolCall("other", ".codex/note.txt"), grants)).action, "ask");
  assert.equal((await thirdPolicy.decideToolPermission(toolCall("secret", ".env"), grants)).action, "deny");
  const displayed = await captureTerminalOutput(async () =>
    thirdTerminal.handlePermissionCommand("/permissions", grants));
  assert.equal(displayed.result, true);
  assert.match(displayed.output, /read_file:\.git\/\*\*/);
  assert.equal(thirdTerminal.handlePermissionCommand("普通问题", grants), false);

  console.log("✓ 第 05 章权限策略、一次审批和会话范围授权检查通过");
} finally {
  process.chdir(root);
  rmSync(sandbox, { recursive: true, force: true });
}
