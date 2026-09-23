/**
 * 公共构建步骤：根据小节编号选择入口，清理 dist，再编译该入口及其导入模块。
 * 读者不需要修改 TypeScript 构建配置；构建所需配置只在系统临时目录存在。
 * --prepare 负责安装依赖和注册命令；完成后只输出一行完成提示。
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const chapter = "chapter-02-model-dialogue";
const toolChapter = "chapter-03-first-tool";
const searchChapter = "chapter-04-code-search";
const permissionChapter = "chapter-05-permission-gate";
const editChapter = "chapter-06-precise-edit";
const commandChapter = "chapter-07-command-feedback";
const targets = {
  "01": "chapter-01-first-command",
  "02.1": `${chapter}/01-configuration/src`,
  "02.2": `${chapter}/02-first-reply/src`,
  "02.3": `${chapter}/03-agent-loop/src`,
  "02.4": `${chapter}/04-conversation/src`,
  "02.5": `${chapter}/05-anthropic/src`,
  "02.6": `${chapter}/06-errors-and-usage/src`,
  "03.1": `${toolChapter}/01-tool-request/src`,
  "03.2": `${toolChapter}/02-read-file-loop/src`,
  "03.3": `${toolChapter}/03-error-boundary/src`,
  "04.1": `${searchChapter}/01-file-discovery/src`,
  "04.2": `${searchChapter}/02-content-search/src`,
  "04.3": `${searchChapter}/03-chunked-reading/src`,
  "05.1": `${permissionChapter}/01-policy-decision/src`,
  "05.2": `${permissionChapter}/02-terminal-approval/src`,
  "05.3": `${permissionChapter}/03-session-grants/src`,
  "06.1": `${editChapter}/01-create-with-preview/src`,
  "06.2": `${editChapter}/02-exact-replacement/src`,
  "06.3": `${editChapter}/03-change-guard/src`,
  "07.1": `${commandChapter}/01-run-command/src`,
  "07.2": `${commandChapter}/02-process-lifecycle/src`,
  "07.3": `${commandChapter}/03-ripgrep-search/src`,
};
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--")) ?? "07.3";
const source = targets[target];

if (!source) {
  console.error(`未知小节：${target}。可选值：${Object.keys(targets).join("、")}。`);
  process.exitCode = 1;
} else {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const run = (command, commandArgs) => {
    const result = spawnSync(command, commandArgs, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32" && command === npm,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };

  let status = 0;
  if (args.includes("--prepare")) {
    status = run(npm, ["ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  }

  if (status === 0) {
    const sourceDir = join(root, source);
    const temporary = mkdtempSync(join(tmpdir(), "hello-my-agent-build-"));
    const config = join(temporary, "tsconfig.json");
    writeFileSync(config, JSON.stringify({
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false,
        noEmitOnError: true,
        rootDir: sourceDir,
        outDir: join(root, "dist"),
        typeRoots: [join(root, "node_modules/@types")],
      },
      include: [join(sourceDir, "cli.ts")],
    }));
    rmSync(join(root, "dist"), { recursive: true, force: true });
    status = run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", config]);
    rmSync(temporary, { recursive: true, force: true });
  }

  if (status === 0) {
    chmodSync(join(root, "dist/cli.js"), 0o755);
    if (args.includes("--prepare")) {
      status = run(npm, ["link", "--ignore-scripts", "--no-audit", "--no-fund"]);
    }
  }

  if (status === 0 && args.includes("--prepare")) {
    console.log(`✓ ${target} 已完成依赖安装、编译和命令注册。`);
  }
  process.exitCode = status;
}
