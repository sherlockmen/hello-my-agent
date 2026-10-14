/**
 * 第 06 章确定性验收：创建预览、唯一替换、变化检测与修改前备份。
 *
 * 测试使用临时项目和内存模型，不调用真实模型，也不修改教程仓库中的示例文件。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "hello-my-agent-06-"));
const workspace = join(sandbox, "project");
mkdirSync(join(workspace, "src"), { recursive: true });
mkdirSync(join(workspace, ".git"));
writeFileSync(join(workspace, "package.json"), "{}\n");
writeFileSync(join(workspace, "src", "value.ts"), "export const value = 1;\n");
writeFileSync(join(workspace, "src", "repeated.ts"), "same\nmiddle\nsame\n");
writeFileSync(join(workspace, ".env"), "SECRET=hidden\n");

/** 编译一个独立小节，确保测试使用该节自己的完整源码快照。 */
function compileSnapshot(lesson, label) {
  const source = resolve(root, `chapter-06-precise-edit/${lesson}/src`);
  const project = join(sandbox, label);
  const output = join(project, "dist");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"),
    process.platform === "win32" ? "junction" : "dir");
  const config = join(project, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      noEmitOnError: true,
      rootDir: source,
      outDir: output,
      typeRoots: [join(root, "node_modules/@types")],
    },
    include: [join(source, "cli.ts")],
  }));
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", config], {
    cwd: root,
    stdio: "inherit",
  });
  return output;
}

const call = (id, name, input) => ({ id, name, arguments: JSON.stringify(input) });
const modelResult = (toolCalls, text = "") => ({
  text, toolCalls, inputTokens: 1, outputTokens: 1, truncated: false,
});

/** 建立按顺序返回结果的内存模型，并保存每次真正收到的消息。 */
function scriptedModel(results) {
  const received = [];
  return {
    received,
    async generate(messages) {
      received.push(structuredClone(messages));
      const result = results.shift();
      assert.ok(result, "内存模型缺少下一次返回值");
      return result;
    },
  };
}

try {
  process.chdir(workspace);

  const first = compileSnapshot("01-create-with-preview", "create");
  const firstPolicy = await import(pathToFileURL(join(first, "permissions/policy.js")));
  const firstRegistry = await import(pathToFileURL(join(first, "tools/registry.js")));
  const firstLoop = await import(pathToFileURL(join(first, "agent/agent-loop.js")));
  const firstDiff = await import(pathToFileURL(join(first, "tools/change-preview.js")));
  const firstTrace = await import(pathToFileURL(join(first, "ui/teaching-trace.js")));
  assert.match(firstDiff.createUnifiedDiff("line.txt", "same\n", "same"),
    /No newline at end of file/, "文件末尾换行变化必须出现在预览中");
  assert.match(firstDiff.createUnifiedDiff("line.txt", "same\r\n", "same\n"),
    /\\x0d/, "CRLF 到 LF 的字节变化必须出现在预览中");
  assert.doesNotMatch(firstDiff.createUnifiedDiff("line.txt", null, "safe\u001b[2J\n"),
    /\u001b/, "审批预览不能包含可执行的 ANSI ESC 控制字符");
  const createCall = call("create", "write_file", {
    path: "src/created.ts", content: "export const created = true;\n",
  });
  const createPermission = await firstPolicy.decideToolPermission(createCall);
  assert.equal(createPermission.action, "ask");
  assert.equal(createPermission.remember, false);
  assert.equal((await firstPolicy.decideToolPermission(call("env", "write_file", {
    path: ".env", content: "SECRET=changed\n",
  }))).action, "deny");
  assert.equal((await firstPolicy.decideToolPermission(call("git", "write_file", {
    path: ".git/config", content: "changed\n",
  }))).action, "deny");
  await assert.rejects(firstRegistry.prepareTool(call("nul", "write_file", {
    path: "src/nul.txt", content: "before\u0000after",
  }), new AbortController().signal), /控制字符/);

  const createPlan = await firstRegistry.prepareTool(createCall, new AbortController().signal);
  assert.ok(createPlan);
  assert.match(createPlan.preview, /--- \/dev\/null/);
  assert.match(createPlan.preview, /\+export const created = true;/);
  assert.equal(existsSync(join(workspace, "src", "created.ts")), false,
    "生成预览不能提前创建文件");
  const created = await firstRegistry.executePreparedTool(createPlan, new AbortController().signal);
  assert.equal(created.metadata.kind, "write_file");
  assert.equal(readFileSync(join(workspace, "src", "created.ts"), "utf8"),
    "export const created = true;\n");
  await assert.rejects(
    firstRegistry.prepareTool(createCall, new AbortController().signal),
    /不会覆盖/,
  );
  await assert.rejects(
    firstRegistry.executeTool(createCall, new AbortController().signal),
    /必须先生成差异预览/,
  );
  const racedCall = call("raced", "write_file", { path: "src/raced.ts", content: "planned\n" });
  const racedPlan = await firstRegistry.prepareTool(racedCall, new AbortController().signal);
  writeFileSync(join(workspace, "src", "raced.ts"), "external\n");
  await assert.rejects(
    firstRegistry.executePreparedTool(racedPlan, new AbortController().signal),
    /目标可能已存在/,
  );
  assert.equal(readFileSync(join(workspace, "src", "raced.ts"), "utf8"), "external\n");
  mkdirSync(join(workspace, "race-parent"));
  const parentPlan = await firstRegistry.prepareTool(call("parent", "write_file", {
    path: "race-parent/new.ts", content: "planned\n",
  }), new AbortController().signal);
  renameSync(join(workspace, "race-parent"), join(workspace, "race-parent-old"));
  mkdirSync(join(workspace, "race-parent"));
  await assert.rejects(
    firstRegistry.executePreparedTool(parentPlan, new AbortController().signal),
    /父目录在差异预览后发生了变化/,
  );
  assert.equal(existsSync(join(workspace, "race-parent", "new.ts")), false);

  const deniedPath = join(workspace, "src", "denied.ts");
  const rawEventSentinel = "RAW_EVENT_CONTENT_SENTINEL_06";
  const deniedModel = scriptedModel([
    modelResult([call("deny", "write_file", {
      path: "src/denied.ts", content: `denied\n${rawEventSentinel}\n`,
    })]),
    modelResult([], "已取消"),
  ]);
  let approvalPreview = "";
  const deniedEvents = [];
  await firstLoop.agentLoop(
    deniedModel,
    [],
    "创建文件",
    new AbortController().signal,
    (event) => deniedEvents.push(event),
    async (request) => {
      approvalPreview = request.preview ?? "";
      assert.equal(request.allowSession, false);
      return { decision: "deny", reason: "测试拒绝" };
    },
  );
  assert.match(approvalPreview, /\+denied/);
  assert.equal(existsSync(deniedPath), false, "拒绝审批后不能产生文件副作用");
  assert.match(deniedModel.received[1].at(-1).content, /用户未批准/);
  assert.deepEqual(deniedEvents.filter((event) => [
    "permission_check", "tool_prepare", "approval_start", "approval_finish", "tool_start",
  ].includes(event.type)).map((event) => event.type), [
    "permission_check", "tool_prepare", "approval_start", "approval_finish",
  ], "生成预览应可观察，但拒绝后不能出现 tool_start");
  const preparedEvent = deniedEvents.find((event) => event.type === "tool_prepare");
  assert.ok(preparedEvent, "拒绝审批前必须已经生成待执行修改");
  assert.match(preparedEvent.call.arguments, new RegExp(rawEventSentinel),
    "原始进程内事件必须保留真实工具参数");
  assert.equal(Object.hasOwn(preparedEvent, "preview"), false,
    "tool_prepare 事件只记录预览字符数，不能再复制完整 diff");
  const displayedTrace = deniedEvents.flatMap(firstTrace.formatTeachingTrace).join("\n");
  assert.doesNotMatch(displayedTrace, new RegExp(rawEventSentinel),
    "终端展示必须投影字段，不能输出文件正文");

  const second = compileSnapshot("02-exact-replacement", "replace");
  const secondRegistry = await import(pathToFileURL(join(second, "tools/registry.js")));
  const exactCall = call("exact", "edit_file", {
    path: "src/value.ts",
    old_text: "export const value = 1;",
    new_text: "export const value = 2;",
  });
  const exactPlan = await secondRegistry.prepareTool(exactCall, new AbortController().signal);
  assert.ok(exactPlan);
  assert.match(exactPlan.preview, /-export const value = 1;/);
  assert.match(exactPlan.preview, /\+export const value = 2;/);
  assert.equal(readFileSync(join(workspace, "src", "value.ts"), "utf8"),
    "export const value = 1;\n", "生成编辑预览不能提前修改文件");
  await secondRegistry.executePreparedTool(exactPlan, new AbortController().signal);
  assert.equal(readFileSync(join(workspace, "src", "value.ts"), "utf8"),
    "export const value = 2;\n");
  await assert.rejects(secondRegistry.prepareTool(call("missing", "edit_file", {
    path: "src/value.ts", old_text: "value = 1", new_text: "value = 3",
  }), new AbortController().signal), /不存在/);
  await assert.rejects(secondRegistry.prepareTool(call("repeated", "edit_file", {
    path: "src/repeated.ts", old_text: "same", new_text: "changed",
  }), new AbortController().signal), /出现多次/);
  assert.equal(readFileSync(join(workspace, "src", "repeated.ts"), "utf8"),
    "same\nmiddle\nsame\n");

  const third = compileSnapshot("03-change-guard", "guard");
  const thirdRegistry = await import(pathToFileURL(join(third, "tools/registry.js")));
  writeFileSync(join(workspace, "src", "guard.ts"), "export const guarded = 1;\n");
  const guardCall = call("guard", "edit_file", {
    path: "src/guard.ts",
    old_text: "export const guarded = 1;",
    new_text: "export const guarded = 2;",
  });
  const stalePlan = await thirdRegistry.prepareTool(guardCall, new AbortController().signal);
  writeFileSync(join(workspace, "src", "guard.ts"), "export const guarded = 99;\n");
  await assert.rejects(
    thirdRegistry.executePreparedTool(stalePlan, new AbortController().signal),
    /预览后发生了变化/,
  );
  assert.equal(readFileSync(join(workspace, "src", "guard.ts"), "utf8"),
    "export const guarded = 99;\n", "外部修改必须保留");

  writeFileSync(join(workspace, "src", "guard.ts"), "export const guarded = 1;\n");
  const replacedPlan = await thirdRegistry.prepareTool(guardCall, new AbortController().signal);
  renameSync(join(workspace, "src", "guard.ts"), join(workspace, "src", "guard-original.ts"));
  writeFileSync(join(workspace, "src", "guard.ts"), "export const guarded = 1;\n");
  await assert.rejects(
    thirdRegistry.executePreparedTool(replacedPlan, new AbortController().signal),
    /预览后被替换/,
    "内容相同但文件身份变化时也必须重新预览",
  );

  writeFileSync(join(workspace, "src", "guard.ts"), "export const guarded = 1;\n");
  const safePlan = await thirdRegistry.prepareTool(guardCall, new AbortController().signal);
  const safeResult = await thirdRegistry.executePreparedTool(safePlan, new AbortController().signal);
  assert.equal(safeResult.metadata.kind, "edit_file");
  assert.equal(readFileSync(join(workspace, "src", "guard.ts"), "utf8"),
    "export const guarded = 2;\n");
  assert.ok(existsSync(safeResult.metadata.backupPath));
  assert.equal(readFileSync(safeResult.metadata.backupPath, "utf8"),
    "export const guarded = 1;\n");

  // 255 字节的目标文件名仍可创建，但追加 .bak 后超过常见文件系统的单段名称上限。
  // 这会让备份文件写入失败，用来确认候选路径不会被误报成可恢复副本。
  const longName = `${"a".repeat(252)}.ts`;
  const longRelativePath = `src/${longName}`;
  const longOriginal = "export const longValue = 1;\n";
  writeFileSync(join(workspace, longRelativePath), longOriginal);
  const backupFailurePlan = await thirdRegistry.prepareTool(call("backup-failure", "edit_file", {
    path: longRelativePath,
    old_text: "export const longValue = 1;",
    new_text: "export const longValue = 2;",
  }), new AbortController().signal);
  await assert.rejects(
    thirdRegistry.executePreparedTool(backupFailurePlan, new AbortController().signal),
    /无法创建修改前备份，目标文件未修改/,
  );
  assert.equal(readFileSync(join(workspace, longRelativePath), "utf8"), longOriginal,
    "备份创建失败时目标文件必须保持原样");

  console.log("✓ 第 06 章差异预览、唯一替换、变化检测和修改前备份检查通过");
} finally {
  process.chdir(root);
  rmSync(sandbox, { recursive: true, force: true });
}
