/**
 * 第二章协议与对话验收：使用本地 HTTP 服务验证 SDK 真正发出的请求。
 *
 * 这里没有真实模型，也不使用真实密钥。它能验证消息历史、两种协议、配置覆盖和错误路径，
 * 不能证明真实服务商可用或模型回答正确；真实模型验收由教程单独记录。
 * verifyChat 接收已安装的命令路径和临时工作目录，所有进程与服务在结束后清理。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// 只传入运行所需的环境，排除开发机上的模型凭据、SDK 日志和代理设置。
export function isolatedEnv(extra = {}) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

/** 异步启动 CLI，让本进程仍能响应 SDK 的 HTTP 请求；超时会停止子进程。 */
export function runCli(cli, args, cwd, env = {}, input = "", onStart = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      cwd, env: isolatedEnv(env), stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI 验收超时")); }, 15_000);
    child.stdout.setEncoding("utf8").on("data", (text) => { stdout += text; });
    child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status, signal });
    });
    // 发生启动错误时，输入端可能先关闭；最终仍通过退出结果报告失败。
    child.stdin.on("error", () => {});
    onStart(child);
    child.stdin.end(input);
  });
}

export async function verifyChat(cli, cwd, { reset = false, progress = false } = {}) {
  const secret = "fixture-api-secret-MUST-NOT-LOG";
  const requests = [];
  let pendingChild;
  // 本地服务按最后一条用户消息选择故障场景，同时保存完整请求供断言检查。
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: request.url, headers: request.headers, body });
    const anthropic = request.url.endsWith("/messages");
    const last = body.messages.at(-1).content;
    const failure = /^\[(401|403|404|429|500)\]$/.exec(last);
    response.setHeader("content-type", "application/json");
    if (last === "[wait]") {
      // 等待期间发出 SIGINT，验证请求能够被中断，命令能结束。
      setTimeout(() => pendingChild?.kill("SIGINT"), 50);
      return;
    }
    if (failure) {
      response.statusCode = Number(failure[1]);
      response.end(JSON.stringify({ error: { type: "test_error", message: `不要打印这段：${secret}` } }));
      return;
    }
    const first = body.messages.find((message) => message.role === "user").content;
    const text = last === "[empty]" ? "" : last === "记得吗" ? `记得：${first}` : `收到：${last}`;
    const truncated = last === "[limit]";
    const usage = body.model === "no-usage" ? undefined : anthropic
      ? { input_tokens: 21, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      : { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 };
    response.end(JSON.stringify(anthropic ? {
      id: "msg_fixture", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text }], stop_reason: truncated ? "max_tokens" : "end_turn",
      stop_sequence: null, usage,
    } : {
      id: "chat_fixture", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: truncated ? "length" : "stop" }], usage,
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = {
    OPENAI_API_KEY: secret, OPENAI_MODEL: "openai-fixture", OPENAI_BASE_URL: `${origin}/openai/v1`,
    ANTHROPIC_API_KEY: secret, ANTHROPIC_MODEL: "anthropic-fixture", ANTHROPIC_BASE_URL: `${origin}/anthropic`,
    // 即使用户打开 SDK 调试日志，本章也不能把原始错误或密钥打印出来。
    OPENAI_LOG: "debug", ANTHROPIC_LOG: "debug", ANTHROPIC_AUTH_TOKEN: "wrong-ambient-token",
  };
  const invoke = (args, input = "", extra = {}) => runCli(cli, args, cwd, { ...env, ...extra }, input);
  try {
    // 1. 帮助和版本不依赖密钥；缺配置应在发送 HTTP 之前失败。
    const help = await runCli(cli, ["--help"], cwd);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--provider/);
    const missing = await runCli(cli, [], cwd);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /缺少 OPENAI_API_KEY/);
    const modelMissing = await runCli(cli, [], cwd, { OPENAI_API_KEY: secret });
    assert.match(modelMissing.stderr, /缺少 OPENAI_MODEL/);
    assert.equal(requests.length, 0);

    // 2. 对每种协议都检查认证头、路径和第二轮的完整 user/assistant 历史。
    for (const provider of ["openai", "anthropic"]) {
      requests.length = 0;
      const result = await invoke(["--provider", provider], "\n记住青柠\n记得吗\n/exit\n");
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /记得：记住青柠/);
      assert.match(result.stdout, /输入 21，输出 8/);
      assert.equal(requests.length, 2);
      const first = requests[0], second = requests[1];
      assert.equal(first.headers[provider === "openai" ? "authorization" : "x-api-key"], provider === "openai" ? `Bearer ${secret}` : secret);
      if (provider === "openai") {
        assert.equal(first.url, "/openai/v1/chat/completions");
        assert.equal(first.body.messages[0].role, "system");
        assert.deepEqual(second.body.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
      } else {
        assert.equal(first.url, "/anthropic/v1/messages");
        assert.equal(first.headers.authorization, undefined);
        assert.equal(typeof first.body.system, "string");
        assert.equal(first.body.max_tokens, 2048);
        assert.deepEqual(second.body.messages.map((message) => message.role), ["user", "assistant", "user"]);
      }
      const previousAssistantContent = second.body.messages.at(-2).content;
      const previousAssistantText = typeof previousAssistantContent === "string"
        ? previousAssistantContent
        : previousAssistantContent.find((block) => block.type === "text")?.text;
      assert.equal(previousAssistantText, "收到：记住青柠");

      // 单次提问从 02.2 一直保留到完成版，不能因为增加终端交互而消失。
      requests.length = 0;
      const once = await invoke(["--provider", provider, "--prompt", "只问一次"]);
      assert.equal(once.status, 0, once.stderr);
      assert.match(once.stdout, /收到：只问一次/);
      assert.match(once.stdout, /输入 21，输出 8/);
      if (progress) {
        assert.match(once.stdout, /模型 > 第 1 次决策/);
        assert.match(once.stdout, /收到：新增用户问题「只问一次」/);
        assert.match(once.stdout, /返回：最终回答，交给终端显示/);
      }
      assert.equal(requests.length, 1);
      assert.equal((await invoke(["--provider", provider, "--prompt", "   "])).status, 1);

      // 请求失败后不污染历史；关闭自动重试，401/429/500 等均只发送一次。
      requests.length = 0;
      const retry = await invoke(["--provider", provider], "[401]\n恢复了\n/exit\n");
      assert.equal(retry.status, 0);
      assert.match(retry.stderr, /认证失败/);
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[1].body.messages.filter((m) => m.role !== "system"), [{ role: "user", content: "恢复了" }]);
      assert.ok(!(retry.stdout + retry.stderr).includes(secret));
      for (const status of [403, 404, 429, 500]) {
        requests.length = 0;
        const error = await invoke(["--provider", provider], `[${status}]\n/exit\n`);
        assert.equal(error.status, 1);
        assert.equal(requests.length, 1);
        assert.ok(!(error.stdout + error.stderr).includes(secret));
      }
      assert.match((await invoke(["--provider", provider, "--model", "no-usage"], "你好\n")).stdout, /输入 未知，输出 未知/);
      assert.match((await invoke(["--provider", provider], "[limit]\n")).stdout, /达到输出上限/);
      assert.equal((await invoke(["--provider", provider], "[empty]\n")).status, 1);
      if (reset) {
        requests.length = 0;
        const cleared = await invoke(["--provider", provider], "旧内容\n/reset\n新内容\n/exit\n");
        assert.equal(cleared.status, 0);
        assert.match(cleared.stdout, /已清空当前对话/);
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1].body.messages.filter((m) => m.role !== "system"), [{ role: "user", content: "新内容" }]);
      }
    }

    // 3. .env 的配置要来自运行目录，并按环境变量、命令行依次覆盖。
    writeFileSync(join(cwd, ".env"), `AGENT_PROVIDER=anthropic\nOPENAI_API_KEY=${secret}\nOPENAI_MODEL=file-model\nOPENAI_BASE_URL=${origin}/file/v1\n`);
    requests.length = 0;
    const fileOnly = await runCli(cli, ["--provider", "openai"], cwd, {}, "文件配置\n");
    assert.equal(fileOnly.status, 0, fileOnly.stderr);
    assert.equal(requests[0].body.model, "file-model");
    assert.equal(requests[0].url, "/file/v1/chat/completions");
    requests.length = 0;
    await invoke([], "环境配置\n", { AGENT_PROVIDER: "openai" });
    assert.equal(requests[0].body.model, "openai-fixture");
    assert.equal(requests[0].url, "/openai/v1/chat/completions");
    requests.length = 0;
    await invoke(["--provider", "openai", "--model", "cli-model", "--base-url", `${origin}/cli/v1`], "命令行配置\n");
    assert.equal(requests[0].body.model, "cli-model");
    assert.equal(requests[0].url, "/cli/v1/chat/completions");
    rmSync(join(cwd, ".env"));
    assert.equal((await invoke(["--provider", "invalid"])).status, 1);
    const invalidURL = await invoke(["--base-url", `https://${secret}:pass@example.invalid`]);
    assert.equal(invalidURL.status, 1);
    assert.ok(!invalidURL.stderr.includes(secret));
    // 切到 Anthropic 时必须使用它自己的 Key，不能退回到已有的 OpenAI Key。
    const wrongFamily = await runCli(cli, ["--provider", "anthropic"], cwd, { OPENAI_API_KEY: secret });
    assert.match(wrongFamily.stderr, /缺少 ANTHROPIC_API_KEY/);

    // 4. 输入结束和 /exit 不调用模型；SIGINT 在请求等待期间也能结束进程。
    requests.length = 0;
    assert.equal((await invoke([], "\n/exit\n")).status, 0);
    assert.equal(requests.length, 0);
    const cancelled = await runCli(cli, [], cwd, env, "[wait]\n", (child) => { pendingChild = child; });
    assert.equal(cancelled.status, 130, cancelled.stderr);
    console.log(`✓ ${reset ? "第二章练习" : "第二章"}：双接口、多轮历史、配置优先级、错误脱敏、用量与退出均通过`);
  } finally {
    rmSync(join(cwd, ".env"), { force: true });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
