/**
 * 第四章验收：逐节编译文件发现、内容搜索和分段读取，再验证三种工具能组成同一条 Agent Loop。
 * 全部模型行为使用内存对象或本地模拟接口，不读取开发机密钥，也不会访问外网。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyChat } from "./verify-chat.mjs";

const root = new URL("../", import.meta.url).pathname;
const sensitiveValue = "sk-test-sensitive-value";

/**
 * 把 dist 中的相对模块路径转换成当前平台可导入的文件 URL。
 *
 * - 输入：相对于 dist 的文件路径。
 * - 输出：可以传给动态 `import()` 的 URL 字符串。
 */
const moduleUrl = (path, dist = join(root, "dist")) => pathToFileURL(join(dist, path)).href;

/** 把教学追踪事件压缩成便于断言顺序的稳定文本。 */
function progressKey(event) {
  if (event.type === "model_start") {
    const toolResults = event.trigger.kind === "tool_results" ? event.trigger.count : 0;
    return `model_start:${event.call}:${toolResults}:${event.contextMessages}`;
  }
  if (event.type === "model_finish") {
    return `model_finish:${event.call}:${event.outcome}:${event.toolRequests}`;
  }
  if (event.type === "tool_start") return `tool_start:${event.sequence}`;
  return `tool_finish:${event.sequence}:${event.outcome}`;
}

/**
 * 编译指定小节，并确认生成的命令入口仍能运行环境诊断。
 *
 * - 输入：课程小节编号。
 * - 输出：编译产物写入 dist；失败时由断言输出编译或命令错误。
 */
function compile(step) {
  const result = spawnSync(process.execPath, [join(root, "scripts/compile.mjs"), step], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const doctor = spawnSync(process.execPath, [join(root, "dist/cli.js"), "--doctor"], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /Working directory:/);
  const snapshot = join(container, `dist-${step.replace(".", "-")}`);
  cpSync(join(root, "dist"), snapshot, { recursive: true });
  symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir");
  return snapshot;
}

const container = mkdtempSync(join(tmpdir(), "hello-agent-search-"));
const fixture = join(container, "workspace");
const outside = join(container, "outside.txt");
mkdirSync(join(fixture, "src"), { recursive: true });
mkdirSync(join(fixture, "ignored"));
mkdirSync(join(fixture, "node_modules", "fake"), { recursive: true });
writeFileSync(join(fixture, "package.json"), '{"name":"search-fixture"}\n');
writeFileSync(join(fixture, ".gitignore"), "ignored/\n*.log\n!keep.log\n!.env\n!node_modules/\n");
writeFileSync(join(fixture, ".env"), "SECRET=hidden\n");
writeFileSync(join(fixture, "src", "core.ts"), [
  "export const before = 1;",
  "export function targetFunction() {",
  "  return 'needle';",
  "}",
  "export const after = 2;",
].join("\n"));
writeFileSync(join(fixture, "src", "other.ts"), "export const other = 'needle';\n");
writeFileSync(join(fixture, "ignored", "skip.ts"), "needle\n");
writeFileSync(join(fixture, "debug.log"), "needle\n");
writeFileSync(join(fixture, "keep.log"), "needle\n");
writeFileSync(join(fixture, "node_modules", "fake", "index.ts"), "needle\n");
writeFileSync(join(fixture, "many.txt"), Array.from({ length: 120 }, (_, i) => `needle ${i + 1}`).join("\n"));
writeFileSync(join(fixture, "exact.txt"), Array.from({ length: 100 }, (_, i) => `needle ${i + 1}`).join("\n"));
writeFileSync(outside, "outside\n");
symlinkSync(outside, join(fixture, "outside-link.txt"));

const originalCwd = process.cwd();
try {
  const dist041 = compile("04.1");
  const { globTool } = await import(moduleUrl("tools/glob.js", dist041));
  const { toolDefinitions: toolDefinitions041 } = await import(moduleUrl("tools/registry.js", dist041));
  const { formatTeachingTrace: formatTeachingTrace041 } = await import(
    moduleUrl("ui/teaching-trace.js", dist041)
  );
  assert.deepEqual(toolDefinitions041.map((tool) => tool.name), ["read_file", "glob"]);
  assert.deepEqual(Object.keys(toolDefinitions041[0].inputSchema.properties), ["path"]);
  const safeUserLines = formatTeachingTrace041({
    type: "model_start", call: 1, contextMessages: 1,
    trigger: { kind: "user", content: `API key ${sensitiveValue}` },
  });
  assert.ok(safeUserLines.some((line) => line.includes("[已隐藏]")));
  assert.doesNotMatch(safeUserLines.join("\n"), new RegExp(sensitiveValue));
  const listed = await globTool('{"pattern":"**/*"}', fixture);
  assert.match(listed.content, /src\/core\.ts/);
  assert.match(listed.content, /keep\.log/);
  assert.doesNotMatch(listed.content, /ignored\/skip\.ts|debug\.log|node_modules|\.env/);
  assert.equal(listed.metadata.kind, "glob");
  assert.equal(listed.metadata.count, listed.metadata.paths.length);
  await assert.rejects(globTool('{"pattern":"../*.ts"}', fixture), /不能使用绝对路径或 \.\./);

  // 精确验证“多取一项”的边界：200 项不截断，201 项只返回前 200 项并标记截断。
  for (const [directory, count] of [["glob-exact", 200], ["glob-over", 201]]) {
    mkdirSync(join(fixture, directory));
    for (let index = 1; index <= count; index += 1) {
      writeFileSync(join(fixture, directory, `${String(index).padStart(3, "0")}.ts`), "");
    }
  }
  const exactGlob = await globTool('{"pattern":"glob-exact/*.ts"}', fixture);
  assert.equal(exactGlob.content.split("\n").filter((line) => line.startsWith("glob-exact/")).length, 200);
  assert.doesNotMatch(exactGlob.content, /结果已截断/);
  assert.equal(exactGlob.metadata.truncated, false);
  const overGlob = await globTool('{"pattern":"glob-over/*.ts"}', fixture);
  assert.equal(overGlob.content.split("\n").filter((line) => line.startsWith("glob-over/")).length, 200);
  assert.match(overGlob.content, /结果已截断，只显示前 200 项/);
  assert.equal(overGlob.metadata.truncated, true);
  const cancelledGlob = new AbortController();
  cancelledGlob.abort();
  await assert.rejects(globTool('{"pattern":"**/*"}', fixture, cancelledGlob.signal), { name: "AbortError" });

  const dist042 = compile("04.2");
  const { grepTool } = await import(moduleUrl("tools/grep.js", dist042));
  const { toolDefinitions: toolDefinitions042 } = await import(moduleUrl("tools/registry.js", dist042));
  const { formatTeachingTrace: formatTeachingTrace042 } = await import(
    moduleUrl("ui/teaching-trace.js", dist042)
  );
  assert.deepEqual(toolDefinitions042.map((tool) => tool.name), ["read_file", "glob", "grep"]);
  assert.deepEqual(Object.keys(toolDefinitions042[0].inputSchema.properties), ["path"]);
  assert.deepEqual(Object.keys(toolDefinitions042[2].inputSchema.properties), ["query", "glob"]);
  const safeArgumentLines = formatTeachingTrace042({
    type: "tool_start",
    sequence: 1,
    call: {
      id: "search", name: "grep",
      arguments: JSON.stringify({ query: `API key ${sensitiveValue}`, glob: "src/**/*.ts" }),
    },
  });
  assert.ok(safeArgumentLines.some((line) => line.includes('query="[已隐藏]"')));
  assert.doesNotMatch(safeArgumentLines.join("\n"), new RegExp(sensitiveValue));
  const matches = await grepTool('{"query":"targetFunction","glob":"src/**/*.ts"}', fixture);
  assert.match(matches.content, /src\/core\.ts:2:17: export function targetFunction/);
  assert.doesNotMatch(matches.content, /ignored|node_modules/);
  assert.deepEqual(matches.metadata, {
    kind: "grep",
    count: 1,
    truncated: false,
    locations: [{ path: "src/core.ts", line: 2, column: 17 }],
  });
  await assert.rejects(grepTool('{"query":"[","glob":"**/*"}', fixture), /不是有效的正则表达式/);
  const bounded = await grepTool('{"query":"needle","glob":"many.txt"}', fixture);
  assert.match(bounded.content, /结果已截断，只显示前 100 项/);
  assert.equal(bounded.content.split("\n").filter((line) => line.startsWith("many.txt:")).length, 100);
  assert.equal(bounded.metadata.truncated, true);
  assert.equal(bounded.metadata.locations.length, 100);
  const exact = await grepTool('{"query":"needle","glob":"exact.txt"}', fixture);
  assert.doesNotMatch(exact.content, /结果已截断/);
  assert.equal(exact.content.split("\n").filter((line) => line.startsWith("exact.txt:")).length, 100);
  assert.equal(exact.metadata.truncated, false);
  const cancelledGrep = new AbortController();
  cancelledGrep.abort();
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*"}', fixture, cancelledGrep.signal),
    { name: "AbortError" },
  );

  const dist043 = compile("04.3");
  const { readFileTool } = await import(moduleUrl("tools/read-file.js", dist043));
  const { toolDefinitions } = await import(moduleUrl("tools/registry.js", dist043));
  const { agentLoop } = await import(moduleUrl("agent/agent-loop.js", dist043));
  const { printProgress } = await import(moduleUrl("ui/terminal.js", dist043));
  const { formatTeachingTrace } = await import(moduleUrl("ui/teaching-trace.js", dist043));
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), ["read_file", "glob", "grep"]);
  assert.deepEqual(Object.keys(toolDefinitions[0].inputSchema.properties), ["path", "offset", "limit"]);

  const section = await readFileTool('{"path":"src/core.ts","offset":2,"limit":2}', fixture);
  assert.match(section.content, /^2: export function targetFunction/);
  assert.match(section.content, /3:   return 'needle';/);
  assert.match(section.content, /offset 设为 4/);
  assert.deepEqual(section.metadata, {
    kind: "read_file", lineCount: 2, startLine: 2, endLine: 3, hasMore: true,
  });
  await assert.rejects(readFileTool('{"path":"src/core.ts","offset":0,"limit":2}', fixture), /offset/);
  await assert.rejects(readFileTool('{"path":"src/core.ts","offset":1,"limit":401}', fixture), /limit/);
  await assert.rejects(readFileTool('{"path":".env","offset":1,"limit":2}', fixture), /不读取 \.env/);
  await assert.rejects(readFileTool('{"path":"outside-link.txt","offset":1,"limit":2}', fixture), /不能离开/);
  const cancelledRead = new AbortController();
  cancelledRead.abort();
  await assert.rejects(
    readFileTool('{"path":"src/core.ts","offset":1,"limit":2}', fixture, cancelledRead.signal),
    { name: "AbortError" },
  );

  process.chdir(fixture);
  const history = [];
  const progress = [];
  let modelCall = 0;
  const model = {
    async generate(messages) {
      modelCall += 1;
      if (modelCall === 1) return {
        text: "", toolCalls: [{ id: "find", name: "glob", arguments: '{"pattern":"src/**/*.ts"}' }],
        inputTokens: 1, outputTokens: 1, truncated: false,
      };
      if (modelCall === 2) {
        assert.match(messages.at(-1).content, /src\/core\.ts/);
        return {
          text: "", toolCalls: [{ id: "search", name: "grep", arguments: '{"query":"targetFunction","glob":"src/**/*.ts"}' }],
          inputTokens: 1, outputTokens: 1, truncated: false,
        };
      }
      if (modelCall === 3) {
        assert.match(messages.at(-1).content, /src\/core\.ts:2:/);
        return {
          text: "", toolCalls: [{ id: "read", name: "read_file", arguments: '{"path":"src/core.ts","offset":2,"limit":2}' }],
          inputTokens: 1, outputTokens: 1, truncated: false,
        };
      }
      assert.match(messages.at(-1).content, /2: export function targetFunction/);
      return { text: "目标函数位于 src/core.ts:2。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  };
  const reply = await agentLoop(
    model,
    history,
    "找到 targetFunction",
    new AbortController().signal,
    (event) => progress.push(event),
  );
  assert.equal(reply.text, "目标函数位于 src/core.ts:2。");
  assert.equal(modelCall, 4);
  assert.deepEqual(history.filter((message) => message.role === "tool").map((message) => message.toolCallId), [
    "find", "search", "read",
  ]);
  assert.equal(history.length, 8);
  assert.deepEqual(progress.map(progressKey), [
    "model_start:1:0:1",
    "model_finish:1:tools:1",
    "tool_start:1",
    "tool_finish:1:success",
    "model_start:2:1:3",
    "model_finish:2:tools:1",
    "tool_start:2",
    "tool_finish:2:success",
    "model_start:3:1:5",
    "model_finish:3:tools:1",
    "tool_start:3",
    "tool_finish:3:success",
    "model_start:4:1:7",
    "model_finish:4:final:0",
  ]);
  assert.equal(progress.find((event) => event.type === "model_start")?.trigger.content,
    "找到 targetFunction");
  assert.equal(progress.find((event) => event.type === "tool_start" && event.call.name === "glob")?.call.arguments,
    '{"pattern":"src/**/*.ts"}');
  assert.deepEqual(
    progress.find((event) => event.type === "tool_finish" && event.call.name === "grep")?.result.metadata,
    {
      kind: "grep",
      count: 1,
      truncated: false,
      locations: [{ path: "src/core.ts", line: 2, column: 17 }],
    },
  );
  assert.deepEqual(
    progress.find((event) => event.type === "tool_finish" && event.call.name === "read_file")?.result.metadata,
    { kind: "read_file", lineCount: 2, startLine: 2, endLine: 3, hasMore: true },
  );

  // 生命周期事件保留真实事实；教学渲染器负责允许列表、单行化和敏感内容隐藏。
  const marker = "PROGRESS_SECRET_MUST_NOT_LOG";
  let unsafeCall = 0;
  const safeProgress = [];
  const unsafeModel = {
    async generate() {
      unsafeCall += 1;
      if (unsafeCall === 1) return {
        text: "",
        toolCalls: [
          {
            id: `id\n\u001b[31m${marker}`,
            name: "glob",
            arguments: JSON.stringify({ pattern: `../${marker}\n\u001b[31m*.ts` }),
          },
          { id: "unknown", name: `bad\n\u001b[31m${marker}`, arguments: "{}" },
        ],
        inputTokens: 1, outputTokens: 1, truncated: false,
      };
      return { text: "已安全处理失败。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  };
  const safeReply = await agentLoop(
    unsafeModel, [], `触发 ${marker}\n\u001b[31m`, new AbortController().signal,
    (event) => safeProgress.push(event),
  );
  assert.equal(safeReply.text, "已安全处理失败。");
  assert.deepEqual(safeProgress.map(progressKey), [
    "model_start:1:0:1",
    "model_finish:1:tools:2",
    "tool_start:1",
    "tool_finish:1:error",
    "tool_start:2",
    "tool_finish:2:error",
    "model_start:2:2:4",
    "model_finish:2:final:0",
  ]);
  const safeLines = safeProgress.flatMap(formatTeachingTrace);
  assert.ok(safeLines.includes("  收到：新增用户问题「[已隐藏]」；Agent Loop 消息链共 1 条。"));
  assert.ok(safeLines.includes('  执行：pattern="[已隐藏]"。'));
  assert.ok(safeLines.includes("工具 > 第 2 步：未知工具"));
  assert.doesNotMatch(safeLines.join("\n"), new RegExp(`${marker}|\\u001b`));

  // 显示回调属于观察通道；即使它自身失败，最终回答和历史提交仍应成功。
  const observerHistory = [];
  const observerReply = await agentLoop({
    async generate() {
      return { text: "观察器不影响回答。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  }, observerHistory, "继续", new AbortController().signal, () => {
    throw new Error("display failed");
  });
  assert.equal(observerReply.text, "观察器不影响回答。");
  assert.equal(observerHistory.length, 2);

  // 观察者拿到事件快照；即使修改工具请求，也不能改变核心随后执行的真实调用。
  const mutationHistory = [];
  let mutationCall = 0;
  const mutationReply = await agentLoop({
    async generate(messages) {
      mutationCall += 1;
      if (mutationCall === 1) return {
        text: "",
        toolCalls: [{ id: "glob", name: "glob", arguments: '{"pattern":"src/**/*.ts"}' }],
        inputTokens: 1, outputTokens: 1, truncated: false,
      };
      assert.match(messages.at(-1).content, /src\/core\.ts/);
      return { text: "事件快照没有改变执行。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  }, mutationHistory, "继续", new AbortController().signal, (event) => {
    if (event.type === "tool_start") {
      event.call.name = "not_registered";
      event.call.arguments = "{}";
    }
  });
  assert.equal(mutationReply.text, "事件快照没有改变执行。");
  assert.equal(mutationHistory.find((message) => message.role === "tool")?.toolCallId, "glob");

  const progressLines = [];
  const originalLog = console.log;
  console.log = (...values) => progressLines.push(values.join(" "));
  try {
    printProgress({
      type: "model_start", call: 1, contextMessages: 1,
      trigger: { kind: "user", content: "找到 targetFunction" },
    });
    printProgress({ type: "model_finish", call: 1, outcome: "tools", toolRequests: 1, text: "" });
    printProgress({
      type: "tool_start", sequence: 1,
      call: {
        id: "search", name: "grep",
        arguments: '{"query":"targetFunction","glob":"src/**/*.ts"}',
      },
    });
    printProgress({
      type: "tool_finish", sequence: 1, outcome: "success",
      call: {
        id: "search", name: "grep",
        arguments: '{"query":"targetFunction","glob":"src/**/*.ts"}',
      },
      result: {
        content: 'src/core.ts:2:17: const port = "x:12:34:"',
        metadata: {
          kind: "grep", count: 1, truncated: false,
          locations: [{ path: "src/core.ts", line: 2, column: 17 }],
        },
      },
    });
    printProgress({
      type: "model_start", call: 2, contextMessages: 3,
      trigger: { kind: "tool_results", count: 1 },
    });
    printProgress({
      type: "model_finish", call: 2, outcome: "final", toolRequests: 0,
      text: "目标函数位于 src/core.ts:2。",
    });
    printProgress({
      type: "tool_finish", sequence: 2, outcome: "error", error: "内部详情不展示",
      call: { id: "unknown", name: "not_registered", arguments: "{}" },
    });
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(progressLines, [
    "模型 > 第 1 次决策",
    "  收到：新增用户问题「找到 targetFunction」；Agent Loop 消息链共 1 条。",
    "模型 < 第 1 次决策",
    "  返回：1 个工具请求。",
    "工具 > 第 1 步：grep",
    '  执行：query="targetFunction"，glob="src/**/*.ts"。',
    "工具 < 第 1 步：grep 完成",
    "  返回：1 个匹配位置；示例：src/core.ts:2:17。",
    "  去向：结果已加入当前回合，下一次模型决策会收到。",
    "模型 > 第 2 次决策",
    "  收到：新增 1 条工具结果；Agent Loop 消息链共 3 条。",
    "模型 < 第 2 次决策",
    "  返回：最终回答，交给终端显示。",
    "工具 < 第 2 步：未知工具 失败",
    "  返回：执行失败。",
    "  去向：错误已加入当前回合，下一次模型决策会收到。",
  ]);
  for (const line of progressLines) {
    assert.ok(line.length < 200);
    assert.doesNotMatch(line, /[\r\n\u001b]/);
    assert.doesNotMatch(line, new RegExp(marker));
  }
  assert.doesNotMatch(progressLines.join("\n"), /const port/);
  const bracketPathLines = formatTeachingTrace({
    type: "tool_finish",
    sequence: 3,
    outcome: "success",
    call: { id: "glob", name: "glob", arguments: '{"pattern":"**/*"}' },
    result: {
      content: "[generated]/a.ts",
      metadata: { kind: "glob", count: 1, truncated: false, paths: ["[generated]/a.ts"] },
    },
  });
  assert.ok(bracketPathLines.includes("  返回：1 个路径；示例：[generated]/a.ts。"));
  const sensitivePathLines = formatTeachingTrace({
    type: "tool_finish",
    sequence: 4,
    outcome: "success",
    call: { id: "glob", name: "glob", arguments: '{"pattern":"**/*"}' },
    result: {
      content: `src/API key ${sensitiveValue}.ts`,
      metadata: {
        kind: "glob",
        count: 1,
        truncated: false,
        paths: [`src/API key ${sensitiveValue}.ts`],
      },
    },
  });
  assert.ok(sensitivePathLines.some((line) => line.includes("[已隐藏]")));
  assert.doesNotMatch(sensitivePathLines.join("\n"), new RegExp(sensitiveValue));
  const longPathLines = formatTeachingTrace({
    type: "tool_finish",
    sequence: 5,
    outcome: "success",
    call: { id: "grep", name: "grep", arguments: '{"query":"needle","glob":"**/*"}' },
    result: {
      content: "省略",
      metadata: {
        kind: "grep",
        count: 2,
        truncated: false,
        locations: [
          { path: `src/${"a".repeat(200)}.ts`, line: 1, column: 1 },
          { path: `src/${"b".repeat(200)}.ts`, line: 2, column: 2 },
        ],
      },
    },
  });
  assert.ok(longPathLines.every((line) => line.length < 200));

  await verifyChat(join(root, "dist/cli.js"), fixture, { reset: true, progress: true });
  console.log("✓ 第 04 章文件发现、内容搜索、分段读取和完整工具链检查通过");
} finally {
  process.chdir(originalCwd);
  rmSync(container, { recursive: true, force: true });
}
