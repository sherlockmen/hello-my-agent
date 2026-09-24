/**
 * 教程增量标记验收：让 README 的文件表、源码头部状态和代码旁标记保持一致。
 *
 * 检查范围是第 01 章及所有已经存在的带 `src/` 小节；新增章节会被自动发现。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

/** 递归收集目录中的 TypeScript 文件，不把生成目录和依赖目录带入教程检查。 */
function findTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** 把系统路径转成 README 链接使用的正斜杠路径。 */
function toMarkdownPath(path) {
  return path.split(sep).join("/");
}

/** 把 TypeScript 源码转换成不含注释和排版的语法 token，用于比较相邻教学快照。 */
function sourceTokens(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const tokens = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JSDocComment) return;
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.kind > ts.SyntaxKind.LastTriviaToken) {
      tokens.push(`${node.kind}:${node.getText(sourceFile)}`);
    }
  };
  visit(sourceFile);
  return tokens.join("\u0000");
}

const firstSource = readFileSync(join(root, "chapter-01-first-command/cli.ts"), "utf8");
const firstReadme = readFileSync(join(root, "chapter-01-first-command/README.md"), "utf8");
assert.match(firstSource, /\[NEW 01\]/, "第 01 章源码必须在实际代码旁标出 [NEW 01]");
assert.ok(firstReadme.indexOf("## 本章改动文件") < firstReadme.indexOf("## 动手构建"),
  "第 01 章必须先列改动文件，再进入动手构建");

const chapterDirectories = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^chapter-\d{2}-/.test(entry.name)
    && !entry.name.startsWith("chapter-01-"))
  .map((entry) => join(root, entry.name))
  .sort();

const lessonDirectories = chapterDirectories.flatMap((chapterDirectory) =>
  readdirSync(chapterDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => join(chapterDirectory, entry.name))
    .sort());

const exercise = readFileSync(join(root, "chapter-02-model-dialogue/EXERCISES.md"), "utf8");
const resetSolution = exercise.match(
  /<!-- solution: src\/ui\/terminal\.ts -->\s*```ts\n([\s\S]*?)\n```/,
)?.[1];
assert.ok(resetSolution, "第二章练习必须保留下一章使用的完整 /reset 基线");

let previousSourceDirectory = join(root, "chapter-01-first-command");

for (const lessonDirectory of lessonDirectories) {
  const chapterDirectory = join(lessonDirectory, "..");
  const chapterNumber = Number(chapterDirectory.match(/chapter-(\d+)/)?.[1]);
  const lessonNumber = Number(basename(lessonDirectory).match(/^(\d{2})-/)?.[1]);
  const lessonId = `${String(chapterNumber).padStart(2, "0")}.${lessonNumber}`;
  const sourceDirectory = join(lessonDirectory, "src");
  const readmePath = join(lessonDirectory, "README.md");
  if (!existsSync(sourceDirectory) || !existsSync(readmePath)) continue;

  const expectedFiles = new Map();
  for (const sourcePath of findTypeScriptFiles(sourceDirectory)) {
    const source = readFileSync(sourcePath, "utf8");
    const header = source.slice(0, source.indexOf("*/") + 2);
    const status = header.match(/\| \[(NEW|CHANGED|KEEP)(?: [^\]]+)?\]/)?.[1];
    assert.ok(status, `${relative(root, sourcePath)} 缺少文件头 NEW/CHANGED/KEEP 状态`);

    const sourcePathFromRoot = relative(sourceDirectory, sourcePath);
    const previousPath = join(previousSourceDirectory, sourcePathFromRoot);
    let previousSource = lessonId === "03.1" && sourcePathFromRoot === "ui/terminal.ts"
      ? `${resetSolution}\n`
      : existsSync(previousPath) ? readFileSync(previousPath, "utf8") : null;
    if (lessonId === "07.1" && sourcePathFromRoot === "tools/edit-file.ts" && previousSource) {
      const editExercise = readFileSync(join(root, "chapter-06-precise-edit/EXERCISES.md"), "utf8");
      const answer = editExercise.match(/<!-- solution: findUniqueMatch -->\s*```ts\n([\s\S]*?)\n```/)?.[1];
      assert.ok(answer, "第六章练习必须保留匹配计数的完整答案");
      const start = previousSource.indexOf("function findUniqueMatch(");
      const end = previousSource.indexOf("\n}\n", start) + 3;
      previousSource = previousSource.slice(0, start) + answer.slice(answer.indexOf("function findUniqueMatch("))
        + "\n" + previousSource.slice(end);
    }
    if (lessonId === "08.1" && sourcePathFromRoot === "tools/run-command.ts") {
      const commandExercise = readFileSync(join(root, "chapter-07-command-feedback/EXERCISES.md"), "utf8");
      previousSource = commandExercise.match(/<!-- solution: src\/tools\/run-command\.ts -->\s*```ts\n([\s\S]*?)\n```/)?.[1];
      assert.ok(previousSource, "第七章练习必须保留可配置期限的完整答案");
    }
    const actualStatus = previousSource === null
      ? "NEW"
      : sourceTokens(previousSource, previousPath) === sourceTokens(source, sourcePath)
        ? "KEEP"
        : "CHANGED";
    assert.equal(status, actualStatus,
      `${relative(root, sourcePath)} 的文件头状态与上一教学基线的真实差异不一致`);

    const body = source.slice(source.indexOf("*/") + 2);
    for (const marker of body.matchAll(/\[(NEW|CHANGED) (\d{2}\.\d+)\]/g)) {
      assert.equal(marker[2], lessonId,
        `${relative(root, sourcePath)} 的历史活动标记必须改为 KEEP`);
    }
    if (status === "KEEP") continue;

    assert.match(body, new RegExp(`\\[(?:NEW|CHANGED) ${lessonId.replace(".", "\\.")}\\]`),
      `${relative(root, sourcePath)} 必须在实际代码旁标出本节改动`);
    expectedFiles.set(toMarkdownPath(relative(lessonDirectory, sourcePath)), status);
  }

  const readme = readFileSync(readmePath, "utf8");
  const changeHeading = readme.indexOf("## 本节改动文件");
  const buildHeading = readme.indexOf("## 动手构建");
  assert.ok(changeHeading >= 0 && changeHeading < buildHeading,
    `${relative(root, readmePath)} 必须先列本节改动文件，再进入动手构建`);
  const section = readme.slice(changeHeading, buildHeading);
  const listedFiles = new Map();
  for (const match of section.matchAll(/^\| (新增|修改|NEW|CHANGED) \| \[([^\]]+\.ts)\]\([^\)]+\) \|/gm)) {
    listedFiles.set(match[2], ["新增", "NEW"].includes(match[1]) ? "NEW" : "CHANGED");
  }
  assert.deepEqual([...listedFiles].sort(), [...expectedFiles].sort(),
    `${relative(root, readmePath)} 的改动文件表必须与源码真实差异一致`);
  previousSourceDirectory = sourceDirectory;
}

console.log("✓ 各章相邻快照、改动文件表、源码状态与代码旁增量标记一致");
