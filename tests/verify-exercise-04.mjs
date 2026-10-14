/**
 * 第 04 章练习验证：检查 grep 的 maxResults 参数控制截断，并拒绝缺失、越界或错误类型。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url).pathname;

/**
 * 编译读者修改后的 04.3 快照，确保练习代码进入 dist。
 *
 * - 输入：无显式参数，源码位置固定为第四章完成版。
 * - 输出：编译成功后继续；失败时用编译输出终止验收。
 */
function compileExercise() {
  const result = spawnSync(process.execPath, [join(root, "scripts/compile.mjs"), "04.3"], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

compileExercise();
const fixture = mkdtempSync(join(tmpdir(), "hello-agent-grep-limit-"));
try {
  writeFileSync(join(fixture, "package.json"), '{"name":"grep-limit"}\n');
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src", "sample.ts"), "needle one\nneedle two\nneedle three\n");
  writeFileSync(join(fixture, "src", "exact.ts"), "exact one\nexact two\n");
  const { grepTool } = await import(pathToFileURL(join(root, "dist/tools/grep.js")));
  const result = await grepTool(
    '{"query":"needle","glob":"src/**/*.ts","maxResults":2}',
    fixture,
  );
  assert.equal(result.content.split("\n").filter((line) => line.startsWith("src/sample.ts:")).length, 2);
  assert.match(result.content, /结果已截断，只显示前 2 项/);
  assert.equal(result.metadata.count, 2);
  assert.equal(result.metadata.truncated, true);
  const exact = await grepTool(
    '{"query":"exact","glob":"src/exact.ts","maxResults":2}',
    fixture,
  );
  assert.equal(exact.content.split("\n").filter((line) => line.startsWith("src/exact.ts:")).length, 2);
  assert.doesNotMatch(exact.content, /结果已截断/);
  assert.equal(exact.metadata.truncated, false);
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*","maxResults":0}', fixture),
    /maxResults/,
  );
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*","maxResults":101}', fixture),
    /maxResults/,
  );
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*","maxResults":2.5}', fixture),
    /maxResults/,
  );
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*","maxResults":"2"}', fixture),
    /maxResults/,
  );
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*"}', fixture),
    /maxResults/,
  );
  await assert.rejects(
    grepTool('{"query":"needle","glob":"**/*","maxResults":2,"extra":true}', fixture),
    /只能包含/,
  );
  console.log("✓ 第 04 章练习：grep maxResults 参数与边界检查通过");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
