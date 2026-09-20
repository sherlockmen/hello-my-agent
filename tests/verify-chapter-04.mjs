/**
 * 第四章验收：逐节编译文件发现、内容搜索和分段读取，再验证三种工具能组成同一条 Agent Loop。
 * 全部模型行为使用内存对象或本地模拟接口，不读取开发机密钥，也不会访问外网。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { verifyChat } from "./verify-chat.mjs";

const root = new URL("../", import.meta.url).pathname;

/**
 * 把 dist 中的相对模块路径转换成当前平台可导入的文件 URL。
 *
 * - 输入：相对于 dist 的文件路径。
 * - 输出：可以传给动态 `import()` 的 URL 字符串。
 */
const moduleUrl = (path) => pathToFileURL(join(root, "dist", path)).href;

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
  compile("04.1");
  const { globTool } = await import(moduleUrl("tools/glob.js") + "?step=041");
  const listed = await globTool('{"pattern":"**/*"}', fixture);
  assert.match(listed, /src\/core\.ts/);
  assert.match(listed, /keep\.log/);
  assert.doesNotMatch(listed, /ignored\/skip\.ts|debug\.log|node_modules|\.env/);
  await assert.rejects(globTool('{"pattern":"../*.ts"}', fixture), /不能使用绝对路径或 \.\./);

  // 精确验证“多取一项”的边界：200 项不截断，201 项只返回前 200 项并标记截断。
  for (const [directory, count] of [["glob-exact", 200], ["glob-over", 201]]) {
    mkdirSync(join(fixture, directory));
    for (let index = 1; index <= count; index += 1) {
      writeFileSync(join(fixture, directory, `${String(index).padStart(3, "0")}.ts`), "");
    }
  }
  const exactGlob = await globTool('{"pattern":"glob-exact/*.ts"}', fixture);
  assert.equal(exactGlob.split("\n").filter((line) => line.startsWith("glob-exact/")).length, 200);
  assert.doesNotMatch(exactGlob, /结果已截断/);
  const overGlob = await globTool('{"pattern":"glob-over/*.ts"}', fixture);
  assert.equal(overGlob.split("\n").filter((line) => line.startsWith("glob-over/")).length, 200);
  assert.match(overGlob, /结果已截断，只显示前 200 项/);
  const cancelledGlob = new AbortController();
  cancelledGlob.abort();
  await assert.rejects(globTool('{"pattern":"**/*"}', fixture, cancelledGlob.signal), { name: "AbortError" });

  compile("04.2");
  const { grepTool } = await import(moduleUrl("tools/grep.js") + "?step=042");
  const matches = await grepTool('{"query":"targetFunction","glob":"src/**/*.ts"}', fixture);
  assert.match(matches, /src\/core\.ts:2:17: export function targetFunction/);
  assert.doesNotMatch(matches, /ignored|node_modules/);
  await assert.rejects(grepTool('{"query":"[","glob":"**/*"}', fixture), /不是有效的正则表达式/);
  const bounded = await grepTool('{"query":"needle","glob":"many.txt"}', fixture);
  assert.match(bounded, /结果已截断，只显示前 100 项/);
  assert.equal(bounded.split("\n").filter((line) => line.startsWith("many.txt:")).length, 100);
  const exact = await grepTool('{"query":"needle","glob":"exact.txt"}', fixture);
  assert.doesNotMatch(exact, /结果已截断/);
  assert.equal(exact.split("\n").filter((line) => line.startsWith("exact.txt:")).length, 100);
  const cancelledGrep = new AbortController();
  cancelledGrep.abort();
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*"}', fixture, cancelledGrep.signal),
    { name: "AbortError" },
  );

  compile("04.3");
  const { readFileTool } = await import(moduleUrl("tools/read-file.js") + "?step=043");
  const { toolDefinitions } = await import(moduleUrl("tools/registry.js") + "?step=043");
  const { agentLoop } = await import(moduleUrl("agent/agent-loop.js") + "?step=043");
  const { printProgress } = await import(moduleUrl("ui/terminal.js") + "?step=043");
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), ["read_file", "glob", "grep"]);

  const section = await readFileTool('{"path":"src/core.ts","offset":2,"limit":2}', fixture);
  assert.match(section, /^2: export function targetFunction/);
  assert.match(section, /3:   return 'needle';/);
  assert.match(section, /offset 设为 4/);
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
  assert.deepEqual(progress.map((event) =>
    event.type === "model_start" ? `model:${event.call}` : `${event.type}:${event.name}:${event.sequence}`), [
    "model:1",
    "tool_start:glob:1",
    "tool_finish:glob:1",
    "model:2",
    "tool_start:grep:2",
    "tool_finish:grep:2",
    "model:3",
    "tool_start:read_file:3",
    "tool_finish:read_file:3",
    "model:4",
  ]);

  // 进度事件只包含本地生成的信息；模型参数、调用 ID、控制字符和敏感内容都不能进入显示通道。
  const marker = "PROGRESS_SECRET_MUST_NOT_LOG";
  let unsafeCall = 0;
  const safeProgress = [];
  const unsafeModel = {
    async generate() {
      unsafeCall += 1;
      if (unsafeCall === 1) return {
        text: "",
        toolCalls: [
          { id: `id\n\u001b[31m${marker}`, name: "glob", arguments: `{\"pattern\":\"${marker}\n` },
          { id: "unknown", name: `bad\n\u001b[31m${marker}`, arguments: "{}" },
        ],
        inputTokens: 1, outputTokens: 1, truncated: false,
      };
      return { text: "已安全处理失败。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  };
  const safeReply = await agentLoop(
    unsafeModel, [], "触发失败", new AbortController().signal, (event) => safeProgress.push(event),
  );
  assert.equal(safeReply.text, "已安全处理失败。");
  assert.deepEqual(safeProgress.map((event) =>
    event.type === "model_start" ? `model:${event.call}` : `${event.type}:${event.name}:${event.sequence}:${event.isError ?? ""}`), [
    "model:1",
    "tool_start:glob:1:",
    "tool_finish:glob:1:true",
    "tool_start:未知工具:2:",
    "tool_finish:未知工具:2:true",
    "model:2",
  ]);
  assert.doesNotMatch(JSON.stringify(safeProgress), new RegExp(`${marker}|\\u001b`));

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

  const progressLines = [];
  const originalLog = console.log;
  console.log = (...values) => progressLines.push(values.join(" "));
  try {
    printProgress({ type: "model_start", call: 1 });
    printProgress({ type: "tool_start", sequence: 1, name: "glob" });
    printProgress({ type: "tool_finish", sequence: 1, name: "glob", isError: false });
    printProgress({ type: "tool_finish", sequence: 2, name: "未知工具", isError: true });
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(progressLines, [
    "模型 > 第 1 次决策：读取当前消息并选择下一步。",
    "工具 > 第 1 步：glob 开始。",
    "工具 > 第 1 步：glob 完成，结果已加入当前回合。",
    "工具 > 第 2 步：未知工具 失败，错误已加入当前回合。",
  ]);
  for (const line of progressLines) {
    assert.ok(line.length < 100);
    assert.doesNotMatch(line, /[\r\n\u001b]/);
    assert.doesNotMatch(line, new RegExp(marker));
  }

  await verifyChat(join(root, "dist/cli.js"), fixture, { reset: true, progress: true });
  console.log("✓ 第 04 章文件发现、内容搜索、分段读取和完整工具链检查通过");
} finally {
  process.chdir(originalCwd);
  rmSync(container, { recursive: true, force: true });
}
