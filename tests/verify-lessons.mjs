/**
 * 第二章渐进快照验收：每个小节只检查当时已引入的能力。
 *
 * +----------+      +-----------+      +----------------+
 * | Snapshot | ---> | CLI       | ---> | Local HTTP LLM |
 * +----------+      +-----------+      +--------+-------+
 *                        ^                    |
 *                        +------ reply -------+
 *
 * 02.1 不允许发送 HTTP；02.2/02.3 提问一次；02.4 加历史；02.5 加第二种协议。
 * 02.6 的完整错误、用量与取消检查继续使用 verify-chat，不依赖真实密钥。
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./verify-chat.mjs";

export const lessons = [
  "01-configuration", "02-first-reply", "03-agent-loop",
  "04-conversation", "05-anthropic", "06-errors-and-usage",
];

// 白名单随小节逐步增加，防止练习或尚未引入的模块进入安装包。
export function lessonModules(step) {
  return ["cli", "config/load-config", ...(step >= 2 ? ["models/client"] : []),
    ...(step >= 3 ? ["agent/agent-loop"] : []), ...(step >= 4 ? ["ui/terminal"] : []),
    ...(step >= 6 ? ["errors"] : [])];
}

export async function verifyLesson(cli, cwd, step) {
  const requests = [];
  const secret = "fake-lesson-key-do-not-log";
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: request.url, body, headers: request.headers });
    const anthropic = request.url.endsWith("/messages");
    const last = body.messages.at(-1).content;
    const first = body.messages.find((m) => m.role === "user").content;
    response.setHeader("content-type", "application/json");
    if (last === "[401]") {
      response.writeHead(401);
      response.end(JSON.stringify({ error: { type: "authentication_error", message: secret } }));
      return;
    }
    const text = last === "记得吗" ? `记得：${first}` : `收到：${last}`;
    response.end(JSON.stringify(anthropic
      ? { id: "lesson", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }
      : { id: "lesson", object: "chat.completion", model: body.model, choices: [
        { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
      ], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = {
    OPENAI_API_KEY: secret, OPENAI_MODEL: "fixture", OPENAI_BASE_URL: `${origin}/v1`,
    ANTHROPIC_API_KEY: secret, ANTHROPIC_MODEL: "fixture", ANTHROPIC_BASE_URL: origin,
  };
  const invoke = (args = [], input = "", extra = {}) => runCli(cli, args, cwd, { ...env, ...extra }, input);
  const nested = join(cwd, "chapter-02-model-dialogue", lessons[step - 1]);
  try {
    assert.equal((await runCli(cli, ["--help"], cwd)).status, 0);
    const missing = await runCli(cli, [], cwd);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /缺少 OPENAI_API_KEY/);

    // 回归：从章节子目录启动时，应读取最近项目根目录中的 .env。
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(cwd, "package.json"), "{}");
    writeFileSync(join(cwd, ".env"), `OPENAI_API_KEY=${secret}\nOPENAI_MODEL=parent-env\nOPENAI_BASE_URL=${origin}/v1\n`);
    const fromNested = await runCli(cli, step === 1 ? [] : ["--prompt", "父目录配置"], nested);
    assert.equal(fromNested.status, 0, fromNested.stderr);
    assert.match(fromNested.stdout, step === 1 ? /parent-env/ : /收到：父目录配置/);
    rmSync(join(cwd, ".env"));
    rmSync(join(cwd, "package.json"));
    rmSync(join(cwd, "chapter-02-model-dialogue"), { recursive: true });
    requests.length = 0;

    if (step === 1) {
      // 第一次配置可以使用假值；这节只读配置，不能偷偷调用模型。
      writeFileSync(join(cwd, ".env"), `OPENAI_API_KEY=${secret}\nOPENAI_MODEL=file-model\nOPENAI_BASE_URL=${origin}/v1\n`);
      assert.match((await runCli(cli, [], cwd)).stdout, /file-model/);
      assert.match((await invoke()).stdout, /fixture/);
      assert.match((await invoke(["--model", "cli-model"])).stdout, /cli-model/);
      const invalid = await invoke(["--base-url", `https://${secret}:password@example.invalid`]);
      assert.equal(invalid.status, 1);
      assert.ok(!invalid.stderr.includes(secret));
      assert.equal(requests.length, 0);
    } else {
      for (const provider of step >= 5 ? ["openai", "anthropic"] : ["openai"]) {
        requests.length = 0;
        const flags = step >= 5 ? ["--provider", provider] : [];
        const once = await invoke([...flags, "--prompt", "青柠"]);
        assert.equal(once.status, 0, once.stderr);
        assert.match(once.stdout, /收到：青柠/);
        assert.equal(requests.length, 1);
        const req = requests[0];
        assert.equal(req.headers[provider === "openai" ? "authorization" : "x-api-key"],
          provider === "openai" ? `Bearer ${secret}` : secret);
        assert.deepEqual(req.body.messages.filter((m) => m.role !== "system"), [{ role: "user", content: "青柠" }]);
        assert.equal(req.url, provider === "openai" ? "/v1/chat/completions" : "/v1/messages");
        assert.doesNotMatch(once.stdout, /用量：/); // 02.6 才引入用量。
        assert.equal((await invoke([...flags, "--prompt", "   "])).status, 1);
        if (step >= 4) {
          requests.length = 0;
          const chat = await invoke(flags, "青柠\n记得吗\n/exit\n");
          assert.equal(chat.status, 0, chat.stderr);
          assert.match(chat.stdout, /记得：青柠/);
          assert.equal(requests.length, 2);
          assert.deepEqual(requests[1].body.messages.filter((m) => m.role !== "system").map((m) => m.role), ["user", "assistant", "user"]);
          requests.length = 0;
          const recover = await invoke(flags, "[401]\n重试\n/exit\n");
          assert.equal(recover.status, 0);
          assert.ok(!recover.stderr.includes(secret));
          assert.deepEqual(requests[1].body.messages.filter((m) => m.role !== "system"), [{ role: "user", content: "重试" }]);
        }
      }
    }
    console.log(`✓ 02.${step} 独立快照：本节能力、配置与输入输出通过`);
  } finally {
    rmSync(join(cwd, ".env"), { force: true });
    rmSync(join(cwd, "package.json"), { force: true });
    rmSync(join(cwd, "chapter-02-model-dialogue"), { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
