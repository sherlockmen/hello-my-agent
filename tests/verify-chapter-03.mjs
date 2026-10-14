/**
 * 第三章验收：编译三个递进快照，再验证工具边界、循环消息和两种协议的真实请求形状。
 * 全部模型响应来自本地 HTTP 服务，不读取开发机密钥，也不会访问外网。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { isolatedEnv, runCli, verifyChat } from "./verify-chat.mjs";

const root = new URL("../", import.meta.url).pathname;

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

function runSnapshotCheck(source) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

const agentModule = pathToFileURL(join(root, "dist/agent/agent-loop.js")).href;

// 03.1 只能识别工具请求，必须主动停止且不提交历史。
compile("03.1");
runSnapshotCheck(`
  import assert from "node:assert/strict";
  import { agentLoop } from ${JSON.stringify(agentModule)};
  const history = [];
  const result = {
    text: "", toolCalls: [{ id: "call_1", name: "read_file", arguments: "{\\\"path\\\":\\\"note.txt\\\"}" }],
    inputTokens: 1, outputTokens: 1, truncated: false,
  };
  await assert.rejects(agentLoop({ async generate() { return result; } }, history, "读取", new AbortController().signal), /03.2/);
  assert.deepEqual(history, []);
`);

// 03.2 已执行成功工具循环，但 ToolError 会直接结束当前轮。
compile("03.2");
runSnapshotCheck(`
  import assert from "node:assert/strict";
  import { agentLoop } from ${JSON.stringify(agentModule)};
  const history = [];
  let calls = 0;
  await assert.rejects(agentLoop({ async generate() {
    calls += 1;
    return {
      text: "", toolCalls: [{ id: "missing", name: "read_file", arguments: "{\\\"path\\\":\\\"definitely-missing.txt\\\"}" }],
      inputTokens: 1, outputTokens: 1, truncated: false,
    };
  } }, history, "读取", new AbortController().signal), /文件不存在/);
  assert.equal(calls, 1);
  assert.deepEqual(history, []);
`);

// 后续运行时检查使用 03.3 完成版。
compile("03.3");

const { readFileTool } = await import(pathToFileURL(join(root, "dist/tools/read-file.js")));
const { ToolError } = await import(pathToFileURL(join(root, "dist/errors.js")));
const { agentLoop } = await import(pathToFileURL(join(root, "dist/agent/agent-loop.js")));
const container = mkdtempSync(join(tmpdir(), "hello-agent-tools-"));
const fixture = join(container, "workspace");
const continuityWorkspace = join(container, "continuity-workspace");
const originalCwd = process.cwd();
mkdirSync(fixture);
mkdirSync(continuityWorkspace);
writeFileSync(join(continuityWorkspace, "package.json"), '{"name":"continuity-fixture"}\n');
writeFileSync(join(fixture, "note.txt"), "工具读到了青柠。\n");
writeFileSync(join(fixture, "package.json"), '{"name":"fixture-project"}\n');
const nestedLesson = join(fixture, "chapter-03", "02-read-file-loop");
mkdirSync(nestedLesson, { recursive: true });
writeFileSync(join(fixture, ".env"), "OPENAI_API_KEY=must-not-leak\n");
writeFileSync(join(container, "outside.txt"), "不应读取。\n");
symlinkSync(join(container, "outside.txt"), join(fixture, "outside-link.txt"));
symlinkSync(join(fixture, ".env"), join(fixture, "env-link.txt"));

try {
  // 第一、二章练习形成的 --doctor 与 /reset 必须在第三章完成版继续可用。
  await verifyChat(join(root, "dist/cli.js"), continuityWorkspace, { reset: true });

  assert.equal(await readFileTool('{"path":"note.txt"}', fixture), "工具读到了青柠。\n");
  await assert.rejects(readFileTool('{"path":""}', fixture), ToolError);
  await assert.rejects(readFileTool('{"path":"missing.txt"}', fixture), /文件不存在/);
  await assert.rejects(readFileTool('{"path":"../outside.txt"}', fixture), /不能离开/);
  await assert.rejects(readFileTool('{"path":"outside-link.txt"}', fixture), /不能离开/);
  await assert.rejects(readFileTool('{"path":".env"}', fixture), /不读取 .env/);
  await assert.rejects(readFileTool('{"path":"env-link.txt"}', fixture), /不读取 .env/);

  // 从章节子目录启动时，read_file 仍以最近的 package.json 所在目录作为项目根目录。
  process.chdir(nestedLesson);
  assert.match(await readFileTool('{"path":"package.json"}'), /fixture-project/);
  process.chdir(fixture);

  const history = [];
  const calls = [];
  const results = [
    {
      text: "", toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"note.txt"}' }],
      inputTokens: 5, outputTokens: 2, truncated: false,
    },
    { text: "内容是青柠。", toolCalls: [], inputTokens: 7, outputTokens: 3, truncated: false },
  ];
  const model = { async generate(messages) { calls.push(structuredClone(messages)); return results.shift(); } };
  const reply = await agentLoop(model, history, "读取 note.txt", new AbortController().signal);
  assert.equal(reply.text, "内容是青柠。");
  assert.equal(reply.inputTokens, 12);
  assert.equal(reply.outputTokens, 5);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(-2), [
    {
      role: "assistant", content: "",
      toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"note.txt"}' }],
    },
    { role: "tool", toolCallId: "call_1", content: "工具读到了青柠。\n", isError: false },
  ]);
  assert.equal(history.length, 4);

  // 工具完成后发生取消时，循环顶部必须阻止第二次模型调用。
  const cancelled = new AbortController();
  let cancelledCalls = 0;
  await assert.rejects(agentLoop({ async generate() {
    cancelledCalls += 1;
    setImmediate(() => cancelled.abort());
    return {
      text: "", toolCalls: [{ id: "cancel_1", name: "read_file", arguments: '{"path":"note.txt"}' }],
      inputTokens: 1, outputTokens: 1, truncated: false,
    };
  } }, [], "读取后取消", cancelled.signal), { name: "AbortError" });
  assert.equal(cancelledCalls, 1);

  for (const toolCall of [
    { id: "bad_args", name: "read_file", arguments: "{}" },
    { id: "missing", name: "read_file", arguments: '{"path":"missing.txt"}' },
    { id: "unknown", name: "run_magic", arguments: "{}" },
  ]) {
    const errorHistory = [];
    let attempt = 0;
    await agentLoop({ async generate(messages) {
      attempt += 1;
      if (attempt === 1) return { text: "", toolCalls: [toolCall], inputTokens: 1, outputTokens: 1, truncated: false };
      const result = messages.at(-1);
      assert.equal(result.role, "tool");
      assert.equal(result.toolCallId, toolCall.id);
      assert.equal(result.isError, true);
      return { text: "已说明工具失败。", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    } }, errorHistory, "触发失败", new AbortController().signal);
    assert.equal(errorHistory.at(-2).isError, true);
  }

  const boundedHistory = [];
  let boundedCalls = 0;
  let executedToolCalls = 0;
  await assert.rejects(agentLoop({ async generate() {
    boundedCalls += 1;
    const toolCall = { id: `loop_${boundedCalls}`, name: "read_file" };
    // executeTool 只有真正执行该调用时才会读取 arguments；getter 让这个边界可以被计数。
    Object.defineProperty(toolCall, "arguments", {
      enumerable: true,
      get() {
        executedToolCalls += 1;
        return '{"path":"note.txt"}';
      },
    });
    return {
      text: "", toolCalls: [toolCall],
      inputTokens: 1, outputTokens: 1, truncated: false,
    };
  } }, boundedHistory, "一直读取", new AbortController().signal), /8 次/);
  assert.equal(boundedCalls, 8);
  assert.equal(executedToolCalls, 7);
  assert.deepEqual(boundedHistory, []);

  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: request.url, body });
    const anthropic = request.url.endsWith("/messages");
    response.setHeader("content-type", "application/json");
    if (JSON.stringify(body).includes("[invalid-tool]")) {
      response.end(JSON.stringify(anthropic ? {
        id: "msg_invalid", type: "message", role: "assistant", model: body.model,
        content: [{ type: "tool_use", id: "", name: "read_file", input: { path: "note.txt" } }],
        stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 2 },
      } : {
        id: "chat_invalid", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "", type: "function", function: { name: "read_file", arguments: '{"path":"note.txt"}' } }],
        }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }));
      return;
    }
    if (requests.length % 2 === 1) {
      response.end(JSON.stringify(anthropic ? {
        id: "msg_tool", type: "message", role: "assistant", model: body.model,
        content: [{ type: "tool_use", id: "tool_42", name: "read_file", input: { path: "note.txt" } }],
        stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 2 },
      } : {
        id: "chat_tool", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "tool_42", type: "function", function: { name: "read_file", arguments: '{"path":"note.txt"}' } }],
        }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }));
      return;
    }
    response.end(JSON.stringify(anthropic ? {
      id: "msg_final", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: "文件内容是青柠。" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 7, output_tokens: 3 },
    } : {
      id: "chat_final", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "文件内容是青柠。" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cli = join(root, "dist/cli.js");
  try {
    for (const provider of ["openai", "anthropic"]) {
      const start = requests.length;
      const env = provider === "openai" ? {
        OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: `${origin}/openai/v1`,
      } : {
        ANTHROPIC_API_KEY: "fixture", ANTHROPIC_MODEL: "fixture", ANTHROPIC_BASE_URL: `${origin}/anthropic`,
      };
      const result = await runCli(cli, ["--provider", provider, "--prompt", "读取 note.txt"], fixture, isolatedEnv(env));
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /文件内容是青柠/);
      const [first, second] = requests.slice(start, start + 2);
      assert.equal(first.body.tools[0].name ?? first.body.tools[0].function.name, "read_file");
      if (provider === "openai") {
        assert.deepEqual(second.body.messages.slice(-2).map((message) => message.role), ["assistant", "tool"]);
        assert.equal(second.body.messages.at(-1).tool_call_id, "tool_42");
      } else {
        assert.deepEqual(second.body.messages.slice(-2).map((message) => message.role), ["assistant", "user"]);
        assert.equal(second.body.messages.at(-1).content[0].tool_use_id, "tool_42");
      }
    }
    for (const provider of ["openai", "anthropic"]) {
      const env = provider === "openai" ? {
        OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: `${origin}/openai/v1`,
      } : {
        ANTHROPIC_API_KEY: "fixture", ANTHROPIC_MODEL: "fixture", ANTHROPIC_BASE_URL: `${origin}/anthropic`,
      };
      const result = await runCli(cli, ["--provider", provider, "--prompt", "[invalid-tool]"], fixture, isolatedEnv(env));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /无效的工具请求/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("✓ 第三章：继承命令、递进快照、凭据保护、路径边界、结果配对、失败反馈、取消、轮次上限和双协议均通过");
} finally {
  process.chdir(originalCwd);
  rmSync(container, { recursive: true, force: true });
}
