/** 第七章练习：在临时副本检查可配置的命令期限，不改正式源码或调用模型。 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "hello-my-agent-exercise-07-"));
const source = join(temporary, "src");
const dist = join(temporary, "dist");
const lesson = join(root, "chapter-07-command-feedback/03-ripgrep-search/src");
const original = readFileSync(join(lesson, "tools/run-command.ts"), "utf8");

/** 编译临时源码，查询参数使二次加载得到当前替换后的练习实现。 */
async function compileAndLoad(version) {
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(temporary, "tsconfig.json")], { stdio: "inherit" });
  return import(`${pathToFileURL(join(dist, "tools/run-command.js")).href}?version=${version}`);
}

try {
  cpSync(lesson, source, { recursive: true });
  writeFileSync(join(temporary, "package.json"), '{"type":"module"}');
  symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"));
  writeFileSync(join(temporary, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, noEmitOnError: true, rootDir: source, outDir: dist,
      typeRoots: [join(root, "node_modules/@types")] }, include: [join(source, "cli.ts")] }));
  if (process.argv[2]) writeFileSync(join(source, "tools/run-command.ts"), readFileSync(resolve(process.argv[2]), "utf8"));
  let implementation = await compileAndLoad(1);
  const startingPoint = !Object.hasOwn(implementation.runCommandDefinition.inputSchema.properties, "timeout_ms");
  if (startingPoint) {
    assert.equal(process.argv[2], undefined, "提交文件没有声明 timeout_ms");
    const exercise = readFileSync(join(root, "chapter-07-command-feedback/EXERCISES.md"), "utf8");
    const answer = exercise.match(/<!-- solution: src\/tools\/run-command\.ts -->\s*```ts\n([\s\S]*?)\n```/)?.[1];
    assert.ok(answer, "练习必须提供完整的 tools/run-command.ts 答案");
    writeFileSync(join(source, "tools/run-command.ts"), answer);
    implementation = await compileAndLoad(2);
  }
  const { prepareRunCommand, runCommandDefinition } = implementation;
  assert.equal(runCommandDefinition.inputSchema.properties.timeout_ms.type, "integer");
  assert.ok(!runCommandDefinition.inputSchema.required.includes("timeout_ms"));
  const workspace = join(temporary, "project");
  mkdirSync(workspace);
  const args = { command: "node -e \"console.log('done')\"", cwd: "." };
  const defaultCall = await prepareRunCommand(JSON.stringify(args), workspace);
  assert.match(defaultCall.preview, /30000/);
  assert.equal((await defaultCall.execute(new AbortController().signal)).isError, false);
  for (const timeout_ms of [99, 60001, 1.5, "1000", null, true]) {
    await assert.rejects(prepareRunCommand(JSON.stringify({ ...args, timeout_ms }), workspace), /timeout_ms|超时|期限/);
  }
  const deadline = await prepareRunCommand(JSON.stringify({ command: "node -e \"setInterval(()=>{},1000)\"", cwd: ".", timeout_ms: 100 }), workspace);
  assert.match(deadline.preview, /100/);
  const started = Date.now();
  const stopped = await deadline.execute(new AbortController().signal);
  assert.equal(stopped.metadata.stopReason, "timeout");
  assert.equal(stopped.isError, true);
  assert.ok(Date.now() - started < 3000, "工具必须实际采用 timeout_ms，而不只是显示它");
  assert.equal(readFileSync(join(lesson, "tools/run-command.ts"), "utf8"), original);
  console.log(startingPoint ? "○ 当前源码仍是练习起点；第 07 章参考答案的期限校验、审批预览与实际超时通过"
    : "✓ 第 07 章练习：你的实现会校验、展示并实际采用命令期限");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
