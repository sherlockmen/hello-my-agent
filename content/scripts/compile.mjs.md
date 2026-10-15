# compile.mjs

`scripts/compile.mjs`

<a href="./content/scripts/compile.mjs" download>下载原始文件</a>

```javascript
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
  "08.1": "chapter-08-streaming-turns/01-text-stream/src",
  "08.2": "chapter-08-streaming-turns/02-complete-tool-calls/src",
  "08.3": "chapter-08-streaming-turns/03-cancel-and-continue/src",
  "09.1": "chapter-09-observable-runs/01-run-lifecycle/src",
  "09.2": "chapter-09-observable-runs/02-event-stream/src",
  "09.3": "chapter-09-observable-runs/03-jsonl-output/src",
  "10.1": "chapter-10-terminal-ui/01-first-screen/src",
  "10.2": "chapter-10-terminal-ui/02-live-progress/src",
  "10.3": "chapter-10-terminal-ui/03-tool-approval/src",
  "10.4": "chapter-10-terminal-ui/04-cancel-and-restore/src",
  "11.1": "chapter-11-terminal-workbench/01-editable-draft/src",
  "11.2": "chapter-11-terminal-workbench/02-recall-and-complete/src",
  "11.3": "chapter-11-terminal-workbench/03-browse-results/src",
  "11.4": "chapter-11-terminal-workbench/04-external-editor/src",
  "11.5": "chapter-11-terminal-workbench/05-terminal-layout/src",
  "12.1": "chapter-12-task-control/01-plan-mode/src",
  "12.2": "chapter-12-task-control/02-task-list/src",
  "12.3": "chapter-12-task-control/03-clarify-questions/src",
  "12.4": "chapter-12-task-control/04-live-input/src",
  "12.5": "chapter-12-task-control/05-manage-queue/src",
  "13.1": "chapter-13-session-persistence/01-save-session/src",
  "13.2": "chapter-13-session-persistence/02-read-records/src",
  "13.3": "chapter-13-session-persistence/03-resume-session/src",
  "13.4": "chapter-13-session-persistence/04-manage-sessions/src",
  "14.1": "chapter-14-session-checkpoints/01-fork-session/src",
  "14.2": "chapter-14-session-checkpoints/02-file-checkpoints/src",
  "14.3": "chapter-14-session-checkpoints/03-review-and-restore/src",
  "15.1": "chapter-15-context-budget/01-estimate-tokens/src",
  "15.2": "chapter-15-context-budget/02-bound-tool-results/src",
  "15.3": "chapter-15-context-budget/03-enforce-budget/src",
  "16.1": "chapter-16-context-compaction/01-select-history/src",
  "16.2": "chapter-16-context-compaction/02-generate-summary/src",
  "16.3": "chapter-16-context-compaction/03-compact-and-continue/src",
  "17.1": "chapter-17-project-instructions/01-project-root/src",
  "17.2": "chapter-17-project-instructions/02-scoped-instructions/src",
  "17.3": "chapter-17-project-instructions/03-inspect-loading/src",
  "18.1": "chapter-18-long-term-memory/01-save-memory/src",
  "18.2": "chapter-18-long-term-memory/02-propose-memory/src",
  "18.3": "chapter-18-long-term-memory/03-manage-memory/src",
  "19.1": "chapter-19-skills/01-discover-skills/src",
  "19.2": "chapter-19-skills/02-load-on-demand/src",
  "19.3": "chapter-19-skills/03-model-skill-tools/src",
  "20.1": "chapter-20-hooks/01-before-tool/src",
  "20.2": "chapter-20-hooks/02-after-tool/src",
  "20.3": "chapter-20-hooks/03-stop-hooks/src",
  "21.1": "chapter-21-mcp/01-stdio-tools/src",
  "21.2": "chapter-21-mcp/02-streamable-http/src",
  "21.3": "chapter-21-mcp/03-connection-lifecycle/src",
  "22.1": "chapter-22-web/01-fetch-page/src",
  "22.2": "chapter-22-web/02-search-sources/src",
  "22.3": "chapter-22-web/03-grounded-answers/src",
};
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--")) ?? "22.3";
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
      include: [join(sourceDir, "cli.ts"), ...(target === "13.2" ? [join(sourceDir, "sessions/read-session.ts")] : [])],
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
```
