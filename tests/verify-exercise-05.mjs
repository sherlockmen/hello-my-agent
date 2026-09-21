/**
 * 第 05 章练习验证：临时加入 /permissions clear，并确认清空范围后同类请求重新询问。
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const lesson = join(root, "chapter-05-permission-gate/03-session-grants/src");
// 临时快照放在仓库根目录下，使 TypeScript 能沿父目录找到现有依赖和 ESM package 配置。
const temporary = await mkdtemp(join(root, ".tmp-exercise-05-"));
const source = join(temporary, "src");
const dist = join(temporary, "dist");

try {
  await cp(lesson, source, { recursive: true });
  const terminalPath = join(source, "ui/terminal.ts");
  const terminal = await readFile(terminalPath, "utf8");
  const functionStart = terminal.indexOf("/**\n * 处理只属于本地终端的权限命令。");
  const functionEnd = terminal.indexOf("\n}\n", terminal.indexOf("export function handlePermissionCommand", functionStart)) + 3;
  assert.ok(functionStart >= 0 && functionEnd > functionStart, "正式源码中的权限命令函数已变化");
  const exercise = await readFile(join(root, "chapter-05-permission-gate/EXERCISES.md"), "utf8");
  const solution = exercise.match(/<!-- solution: handlePermissionCommand -->\s*```ts\n([\s\S]*?)\n```/);
  assert.ok(solution, "练习文档必须保留 handlePermissionCommand 完整答案");
  const answeredTerminal = `${terminal.slice(0, functionStart)}${solution[1]}\n${terminal.slice(functionEnd)}`;
  assert.match(answeredTerminal, /if \(handlePermissionCommand\(text, sessionGrants\)\) continue;/);
  await writeFile(terminalPath, answeredTerminal);

  const configPath = join(temporary, "tsconfig.json");
  await writeFile(configPath, JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist },
    include: [join(source, "**/*.ts")],
  }));
  const compiled = spawnSync("npx", ["tsc", "--project", configPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

  const { agentLoop } = await import(pathToFileURL(join(dist, "agent/agent-loop.js")));
  const { handlePermissionCommand } = await import(pathToFileURL(join(dist, "ui/terminal.js")));
  const grants = new Set();
  let approvals = 0;
  const model = {
    calls: 0,
    async generate() {
      this.calls += 1;
      return this.calls % 2 === 1
        ? {
            text: "",
            toolCalls: [{ id: `call-${this.calls}`, name: "read_file", arguments: JSON.stringify({ path: ".git/HEAD" }) }],
            inputTokens: 1,
            outputTokens: 1,
            truncated: false,
          }
        : { text: "完成", toolCalls: [], inputTokens: 1, outputTokens: 1, truncated: false };
    },
  };
  const requestApproval = async () => {
    approvals += 1;
    return { decision: "allow_session" };
  };

  await agentLoop(model, [], "第一次", new AbortController().signal, undefined, requestApproval, grants);
  assert.equal(approvals, 1);
  assert.ok(grants.has("read_file:.git/**"));

  const messages = [];
  const originalLog = console.log;
  console.log = (...values) => messages.push(values.join(" "));
  try {
    assert.equal(handlePermissionCommand("/permissions clear", grants), true);
  } finally {
    console.log = originalLog;
  }
  assert.equal(grants.size, 0, "撤销命令必须真正清空会话授权集合");
  assert.deepEqual(messages, ["已清空本次会话的权限范围。"]);
  assert.equal(handlePermissionCommand("普通问题", grants), false);
  await agentLoop(model, [], "撤销后再次读取", new AbortController().signal, undefined, requestApproval, grants);
  assert.equal(approvals, 2, "清空范围后，同类请求必须重新进入审批");
  console.log("✓ 第 05 章练习：会话授权可以被明确撤销");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
