/**
 * 第 06 章练习验证：始终检查文档中的完整答案；读者开始修改源码后，
 * 改为直接编译并检查读者的实现，错误答案不会被参考答案覆盖。
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const lesson = join(root, "chapter-06-precise-edit/03-change-guard/src");
const originalPath = join(lesson, "tools/edit-file.ts");
const original = await readFile(originalPath, "utf8");
const submittedPath = process.argv[2] ? resolve(process.argv[2]) : originalPath;
const submitted = await readFile(submittedPath, "utf8");
const temporary = await mkdtemp(join(root, ".tmp-exercise-06-"));
const source = join(temporary, "src");
const dist = join(temporary, "dist");

try {
  await cp(lesson, source, { recursive: true });
  const exercise = await readFile(join(root, "chapter-06-precise-edit/EXERCISES.md"), "utf8");
  const solution = exercise.match(/<!-- solution: findUniqueMatch -->\s*```ts\n([\s\S]*?)\n```/);
  assert.ok(solution, "第 06 章练习必须保留 findUniqueMatch 完整答案");

  const targetPath = join(source, "tools/edit-file.ts");
  await writeFile(targetPath, submitted);
  const target = submitted;
  const functionStart = target.indexOf("function findUniqueMatch(");
  const functionEnd = target.indexOf("\n}\n", functionStart) + 3;
  assert.ok(functionStart >= 0 && functionEnd > functionStart,
    "正式源码中的 findUniqueMatch 函数已变化");
  const startingFunction = `function findUniqueMatch(content: string, oldText: string): number {
  const first = content.indexOf(oldText);
  if (first === -1) throw new ToolError("old_text 在当前文件中不存在，请重新读取文件后再修改。");
  if (content.indexOf(oldText, first + 1) !== -1) {
    throw new ToolError("old_text 在当前文件中出现多次，请提供更多上下文，让它只匹配一次。");
  }
  return first;
}`;
  const submittedFunction = target.slice(functionStart, functionEnd).trim();
  const stillAtStartingPoint = submittedFunction === startingFunction;
  const checkedFunction = stillAtStartingPoint ? solution[1].trim() : submittedFunction;
  const answered = `${target.slice(0, functionStart)}${checkedFunction}\n${target.slice(functionEnd)}`
    .replace("function findUniqueMatch(", "export function findUniqueMatch(");
  await writeFile(targetPath, answered);

  await symlink(join(root, "node_modules"), join(temporary, "node_modules"),
    process.platform === "win32" ? "junction" : "dir");
  const configPath = join(temporary, "tsconfig.json");
  await writeFile(join(temporary, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(configPath, JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      noEmitOnError: true,
      rootDir: source,
      outDir: dist,
      typeRoots: [join(root, "node_modules/@types")],
    },
    include: [join(source, "cli.ts")],
  }));
  const compiled = spawnSync(process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "--project", configPath],
    { cwd: root, encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

  const { findUniqueMatch } = await import(pathToFileURL(join(dist, "tools/edit-file.js")));
  assert.equal(findUniqueMatch("before target after", "target"), 7);
  assert.throws(() => findUniqueMatch("before after", "target"), /不存在/);
  assert.throws(() => findUniqueMatch("aaaa", "aa"), /出现 3 次/,
    "练习答案必须统计重叠的三个匹配位置 0、1、2");
  assert.equal(await readFile(originalPath, "utf8"), original, "练习验证不能修改正式源码");
  console.log(stillAtStartingPoint
    ? "○ 当前源码仍是练习起点；第 06 章参考答案验收通过"
    : "✓ 第 06 章练习：你的实现会报告实际匹配次数");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
