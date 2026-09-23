/**
 * 安装与渐进快照验收：检查读者实际运行的版本，而不只检查源码能否编译。
 *
 * +----------+      +----------+      +----------------+      +---------+
 * | compile  | ---> | npm pack | ---> | temp install   | ---> | run CLI |
 * +----------+      +----------+      +----------------+      +---------+
 *
 * 当前默认构建和 02.6 完成版检查真实 tarball；中间小节逐个独立编译、调用本地模拟服务。
 * 第一章与两章练习继续回归。所有目录和安装前缀都由测试创建，结束后清理。
 * 不使用真实模型凭据，不改变用户的构建目标和全局命令链接。Windows 仍待实测。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync,
  symlinkSync, cpSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyChat, isolatedEnv } from "./verify-chat.mjs";
import { verifyAgentLoop } from "./verify-agent-loop.mjs";
import { lessons, lessonModules, verifyLesson } from "./verify-lessons.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const chapter = "chapter-02-model-dialogue";
// 复用第二章完成版的安装后对话验收；当前包的新增模块由白名单和后续章节检查覆盖。
const currentStep = 6;
const currentPackageModules = [
  "agent/agent-loop", "agent/events", "cli", "config/load-config", "errors", "models/client",
  "permissions/policy",
  "tools/change-preview", "tools/edit-file", "tools/glob", "tools/grep", "tools/read-file",
  "tools/registry", "tools/types", "tools/workspace", "tools/write-file",
  "ui/teaching-trace", "ui/terminal",
];
const requestedStep = process.argv[2] === undefined ? null : Number(process.argv[2]);
if (requestedStep !== null && ![3, 4].includes(requestedStep)) {
  throw new Error("本节检查只支持 3 或 4。");
}
const sandbox = mkdtempSync(join(tmpdir(), "hello-my-agent-install-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cwd = join(sandbox, "unrelated project");
mkdirSync(cwd);

// 同步命令只用于编译/安装；调用模型的检查使用异步子进程，避免阻塞本地 HTTP 服务。
function run(command, args, workdir, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd: workdir, env: isolatedEnv(), encoding: "utf8", timeout: 120_000,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result;
}

// 编译任意章节/小节。替换练习模块时使用临时源码副本，不修改正式文件。
function compileSnapshot(sourcePath, filename, label, replacement) {
  const project = join(sandbox, label);
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify(pkg));
  for (const name of ["README.md", "LICENSE"]) copyFileSync(join(root, name), join(project, name));
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  let source = join(root, sourcePath);
  if (replacement) {
    source = join(project, "source");
    cpSync(join(root, sourcePath), source, { recursive: true });
    // 全书验收只检查教程中的标准答案没有失效；读者实际文件由 npm run exercise:02 检查。
    const exercise = readFileSync(join(root, chapter, "EXERCISES.md"), "utf8");
    const solution = exercise.match(/<!-- solution: src\/ui\/terminal\.ts -->\s*```ts\n([\s\S]*?)\n```/);
    assert.ok(solution, "第二章练习必须保留完整终端替换代码及其目标标记");
    writeFileSync(join(source, "ui/terminal.ts"), `${solution[1]}\n`);
  }
  const configPath = join(project, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, rootDir: source, outDir: join(project, "dist") },
    include: [join(source, filename)],
  }));
  run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", configPath], root);
  const cli = join(project, "dist", filename.replace(/\.ts$/, ".js"));
  chmodSync(cli, 0o755);
  return cli;
}

// 包白名单按所选阶段计算。安装后离开源码目录，检查帮助、版本与该阶段的实际行为。
async function verifyPackage(project, step, label, moduleOverride) {
  const destination = join(sandbox, label);
  mkdirSync(destination);
  const packed = run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], project);
  const parsed = JSON.parse(packed.stdout);
  const archive = Array.isArray(parsed) ? parsed[0] : parsed[pkg.name];
  assert.ok(archive, "npm pack 未返回当前包的信息");
  const modules = moduleOverride ?? (step === 0 ? ["cli"] : lessonModules(step));
  assert.deepEqual(archive.files.map((file) => file.path).sort(),
    ["LICENSE", "README.md", "package.json", ...modules.map((name) => `dist/${name}.js`)].sort());
  const prefix = join(destination, "installed");
  run(npm, ["install", "--global", "--prefix", prefix, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
    join(destination, archive.filename)], destination);
  const installedModules = run(npm, ["root", "--global", "--prefix", prefix], destination).stdout.trim();
  const installed = join(installedModules, ...pkg.name.split("/"));
  for (const name of ["chapter-01-first-command", chapter]) assert.ok(!existsSync(join(installed, name)));
  for (const dep of ["typescript", "@types/node"]) assert.ok(!existsSync(join(installed, "node_modules", dep)));
  const cli = resolve(prefix, process.platform === "win32" ? "hello-my-agent.cmd" : "bin/hello-my-agent");
  assert.match(run(cli, ["--help"], cwd).stdout, /--help/);
  assert.equal(run(cli, ["--version"], cwd).stdout.trim(), pkg.version);
  assert.equal(run(cli, ["-v"], cwd).stdout.trim(), pkg.version);
  if (step > 0) assert.match(run(cli, ["--doctor"], cwd).stdout, /Working directory:/);
  assert.match(run(cli, ["--unknown"], cwd, 1).stderr, /unknown option/);
  assert.match(run(cli, ["unexpected-argument"], cwd, 1).stderr, /too many arguments/);
  if (step === 0) assert.match(run(cli, [], cwd).stdout, /Hello，My Agent！/);
  else if (step === 6) {
    await verifyAgentLoop(join(installed, "dist/agent/agent-loop.js"));
    await verifyChat(cli, cwd);
  } else await verifyLesson(cli, cwd, step);
  console.log(`✓ ${label}：包内容、临时安装、源码之外运行与退出状态通过`);
}

try {
  if (requestedStep !== null) {
    const lesson = lessons[requestedStep - 1];
    const cli = compileSnapshot(`${chapter}/${lesson}/src`, "cli.ts", `lesson-${requestedStep}`);
    await verifyLesson(cli, cwd, requestedStep);
    if (requestedStep === 3) {
      await verifyAgentLoop(join(dirname(cli), "agent/agent-loop.js"));
    }
    console.log(`✓ 02.${requestedStep} 的确定性检查全部通过`);
    process.exitCode = 0;
  } else {
  // 直接执行原始产物，防止 npm 安装时补权限掩盖清理重建后失去执行权限的问题。
  if (process.platform !== "win32") {
    assert.equal(run(join(root, "dist/cli.js"), ["--version"], cwd).stdout.trim(), pkg.version);
  }
  await verifyPackage(root, currentStep, "current-package", currentPackageModules);
  // 回归：构建脚本收到 02.2 时，产物必须登记该节新增的 --prompt。
  run(process.execPath, [join(root, "scripts/compile.mjs"), "02.2"], root);
  assert.match(run(join(root, "dist/cli.js"), ["--help"], cwd).stdout, /--prompt/);
  assert.match(run(process.execPath, [join(root, "scripts/compile.mjs"), "unknown"], root, 1).stderr, /未知小节/);
  run(process.execPath, [join(root, "scripts/compile.mjs")], root); // 恢复默认构建目标。
  const first = compileSnapshot("chapter-01-first-command", "cli.ts", "first");
  assert.match(run(process.execPath, [first], cwd).stdout, /Hello，My Agent！/);
  assert.equal(run(process.execPath, [first, "--version"], cwd).stdout.trim(), pkg.version);
  if (existsSync(join(root, "chapter-01-first-command/cli-with-doctor.ts"))) {
    const doctor = compileSnapshot("chapter-01-first-command", "cli-with-doctor.ts", "doctor");
    assert.match(run(process.execPath, [doctor, "--doctor"], cwd).stdout, /Working directory:/);
  }
  for (const [index, lesson] of lessons.entries()) {
    const sourcePath = `${chapter}/${lesson}/src`;
    if (!existsSync(join(root, sourcePath))) continue; // 从空目录跟写时，后续小节可能尚未创建。
    const cli = compileSnapshot(sourcePath, "cli.ts", `lesson-${index + 1}`);
    assert.match(run(process.execPath, [cli, "--doctor"], cwd).stdout, /Working directory:/);
    if (index === 5) {
      if (currentStep !== 6) await verifyPackage(dirname(dirname(cli)), 6, "completed-package");
      const reset = compileSnapshot(sourcePath, "cli.ts", "reset", true);
      await verifyChat(reset, cwd, { reset: true });
    } else {
      if (index + 1 !== currentStep) await verifyLesson(cli, cwd, index + 1);
      if (index === 2) await verifyAgentLoop(join(dirname(cli), "agent/agent-loop.js"));
    }
  }
  console.log("✓ 第一章、第二章各小节及教程中的练习答案均可独立构建运行");
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
