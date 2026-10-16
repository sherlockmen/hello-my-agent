import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSite } from "../scripts/build-site.mjs";

const root = mkdtempSync(join(tmpdir(), "hello-agent-site-"));
const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const get = (path) => readFileSync(join(root, "site-dist", path), "utf8");

try {
  put("website/index.html", "<!doctype html><title>Fixture</title>");
  put("README.md", "# Fixture\n\n[Start](chapter-01-fixture/README.md) · [Private](docs/AUTHORING.md) · [Source](chapter-01-fixture/src/)\n");
  put("docs/SETUP.md", "# Setup\n");
  put("docs/PROGRESS.md", "# Progress\n");
  put("docs/AUTHORING.md", "DO NOT PUBLISH AUTHOR INSTRUCTIONS");
  put("docs/.work/private.md", "DO NOT PUBLISH PRIVATE PREVIEW");
  put(".env", "DO NOT PUBLISH SECRET");
  put("chapter-01-fixture/README.md", [
    "# Chapter 1", "", "[Lesson](01-example/README.md#why-await) · [Code](src/index.ts)", "",
    '<a href="01-example/README.md#why-await">HTML lesson link</a>', "",
    "```md", "[Literal](not-a-file.md)", '<img src="not-a-file.png">', "```", "",
    '<style>.motion-player { display: block; }</style>', '<details class="motion-player">', '<summary>',
    '<img class="motion-cover" src="assets/cover.png" alt="Cover">', '<span>开始播放动图</span>', '</summary>',
    '<img class="motion-gif" src="assets/move.gif" loading="lazy" alt="A moves into the file">', '</details>', "",
    "[Storyboard](assets/story.jpg)", "![Ordinary GIF](assets/ordinary.gif)", "",
    '<img src="assets/still.png" alt="Static">', "",
  ].join("\n"));
  put("chapter-01-fixture/01-example/README.md", "# Lesson 1.1\n\n[Parent](../README.md)\n");
  put("chapter-01-fixture/EXERCISES.md", "# Exercises\n");
  put("chapter-01-fixture/examples/review-kit/skills/SKILL.md", "# Example Skill\n");
  put("chapter-01-fixture/examples/README.md", "# Example commands\n");
  put("chapter-01-fixture/src/index.ts", 'export const greeting: string = "hello";\n');
  put("chapter-01-fixture/src/nested/view.tsx", "export const View = () => <div>Hello</div>;\n");
  for (const name of ["cover.png", "move.gif", "story.jpg", "ordinary.gif", "still.png"]) put(`chapter-01-fixture/assets/${name}`, `Fixture ${name}`);
  put("chapter-01-fixture/assets/ordinary.gif", Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
  put("chapter-01-fixture/assets/variants/private.gif", "DO NOT PUBLISH UNUSED CANDIDATE");

  const before = readFileSync(join(root, "chapter-01-fixture/README.md"), "utf8");
  const report = buildSite({ root });
  assert.equal(readFileSync(join(root, "chapter-01-fixture/README.md"), "utf8"), before, "Source Markdown must remain unchanged");
  assert.equal(report.chapters, 1);
  assert.equal(report.lessonPages, 1);
  assert.equal(report.exercisePages, 1);
  assert.equal(report.convertedMotionPlayers, 1);
  assert.equal(report.sourcePages, 2, "Directory source links must expose nested files");
  assert.equal(report.referencedAssets, 5, "Player covers must be copied; unreferenced variants must not be copied");
  assert.equal(report.generatedGifCovers.length, 1);
  const cover = readFileSync(join(root, "site-dist/content/chapter-01-fixture/assets/ordinary.gif.cover.png"));
  assert.deepEqual(cover.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "Generated GIF cover must be a PNG");
  assert.equal(cover.readUInt32BE(16), 1, "Cover must preserve the first frame width");
  assert.equal(cover.readUInt32BE(20), 1, "Cover must preserve the first frame height");
  const chapter = get("content/chapter-01-fixture/README.md");
  assert.match(chapter, /\[Lesson\]\(\/content\/chapter-01-fixture\/01-example\/README\.md\?id=why-await\)/, "Markdown links must let Docsify construct the hash route");
  assert.match(chapter, /href="#\/content\/chapter-01-fixture\/01-example\/README\.md\?id=why-await"/, "Raw HTML links need the final hash route");
  assert.match(chapter, /<img src="\.\/content\/chapter-01-fixture\/assets\/cover\.png" data-gif-src="\.\/content\/chapter-01-fixture\/assets\/move\.gif" data-cover="\.\/content\/chapter-01-fixture\/assets\/cover\.png" data-no-zoom alt="A moves into the file">/, "GIF playback controls must not be intercepted by static-image zoom");
  assert.doesNotMatch(chapter, /motion-player|motion-cover|motion-toggle|<style>|开始播放动图/);
  assert.match(chapter, /\[Literal\]\(not-a-file\.md\)/, "Fenced Markdown examples must not be interpreted as links");
  assert.match(chapter, /<img src="not-a-file\.png">/, "Fenced HTML examples must remain literal");
  assert.match(chapter, /\[Storyboard\]\(\/content\/chapter-01-fixture\/assets\/story\.jpg\.md\)/);
  assert.match(get("content/chapter-01-fixture/assets/story.jpg.md"), /src="\.\/content\/chapter-01-fixture\/assets\/story\.jpg"/);
  assert.match(get("content/chapter-01-fixture/src/index.ts.md"), /```typescript\nexport const greeting/);
  assert.match(get("content/chapter-01-fixture/src/_index.md"), /\[nested\/view\.tsx\]\(\/content\/chapter-01-fixture\/src\/nested\/view\.tsx\.md\)/);
  assert.match(get("content/README.md"), /\[Source\]\(\/content\/chapter-01-fixture\/src\/_index\.md\)/);
  assert.match(get("_sidebar.md"), /Chapter 1[\s\S]*Lesson 1\.1[\s\S]*练习与答案/);
  assert.match(get("_sidebar.md"), /\[Chapter 1\]\(\/content\/chapter-01-fixture\/README\.md\)/);
  assert.doesNotMatch(get("_sidebar.md"), /\]\(#\/content\//, "Hash-prefixed Markdown destinations are interpreted as heading anchors by Docsify");
  assert.doesNotMatch(get("content/README.md"), /docs\/AUTHORING\.md/);
  for (const excluded of ["content/docs/AUTHORING.md", "content/docs/.work/private.md", "content/.env", "content/chapter-01-fixture/assets/variants/private.gif"]) {
    assert.equal(existsSync(join(root, "site-dist", excluded)), false, `Excluded path was published: ${excluded}`);
  }
  const manifest = JSON.parse(get("navigation.json"));
  assert.deepEqual(manifest.chapters[0].other, [], "Example package files must not become lessons or pagination stops");
  assert.ok(existsSync(join(root, "site-dist/content/chapter-01-fixture/examples/review-kit/skills/SKILL.md")), "Example material remains readable by its direct link");
  assert.doesNotMatch(get("_sidebar.md"), /Example Skill|Example commands/);
  for (const page of manifest.pages) {
    assert.ok(existsSync(join(root, "site-dist", page.path)), `Missing manifest page ${page.path}`);
    assert.ok(page.route.startsWith("#/content/"), "Manifest must retain directly navigable hash URLs");
    assert.doesNotMatch(get(page.path), /\]\(#\/content\//, `Markdown page emits a heading-style destination: ${page.path}`);
  }
  const firstSidebar = get("_sidebar.md");
  buildSite({ root });
  assert.equal(get("_sidebar.md"), firstSidebar, "Build navigation must be deterministic");
  put("chapter-01-fixture/01-example/README.md", "# Broken\n\n[Missing](missing.md)\n");
  assert.throws(() => buildSite({ root }), /missing local reference/, "Missing links must fail before replacing the prior build");
  assert.equal(get("_sidebar.md"), firstSidebar);
  put("chapter-01-fixture/01-example/README.md", "# Escape\n\n[Outside](../../../../outside.md)\n");
  assert.throws(() => buildSite({ root }), /reference escapes repository/);
  assert.throws(() => buildSite({ root, output: root }), /Output must be/);
  console.log("✓ Site builder preserves source, adapts GIFs in place, includes source indexes, rejects broken/escaping links and excludes private files.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
