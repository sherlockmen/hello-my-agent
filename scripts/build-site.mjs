import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeGifCover } from "./vendor-gifcontrol.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicDocs = [
  "docs/SETUP.md", "docs/PROGRESS.md", "docs/planning/COURSE.md",
  "docs/planning/CAPABILITIES.md", "docs/planning/REFERENCE-NOTES.md",
  "docs/CODING-AGENT-REFERENCES.md", "docs/CODING-AGENT-GAP-REVIEW.md",
];
const privateDocs = new Set([
  "docs/AUTHORING.md", "docs/EDITORIAL-WORKFLOW.md", "docs/READER-REVIEW.md",
  "docs/REFERENCE-STRUCTURE.md", "docs/planning/README.md", "docs/planning/PLAN.md",
  "docs/planning/BLUEPRINT.md", "docs/planning/CONTEXT.md",
]);
const excludedSegments = new Set([".git", ".work", "node_modules", "dist", "site-dist", ".capture"]);
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".py", ".sh", ".css", ".html", ".yaml", ".yml", ".txt"]);
const imageExtensions = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".avif"]);
const languageFor = { ".ts": "typescript", ".tsx": "tsx", ".mts": "typescript", ".cts": "typescript", ".js": "javascript", ".jsx": "jsx", ".mjs": "javascript", ".cjs": "javascript", ".json": "json", ".py": "python", ".sh": "bash", ".css": "css", ".html": "html", ".yaml": "yaml", ".yml": "yaml" };
const slash = (path) => path.split(sep).join("/");
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const titleOf = (markdown, fallback) => markdown.match(/^#\s+(.+)$/m)?.[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replaceAll("`", "") ?? fallback;
const encodedPath = (path) => path.split("/").map(encodeURIComponent).join("/");
const route = (path, anchor = "") => `#/content/${encodedPath(path)}${anchor ? `?id=${encodeURIComponent(anchor)}` : ""}`;
// Docsify converts Markdown path links into hash routes itself. A leading # is
// reserved for heading anchors, so only the manifest and raw HTML use hash URLs.
const markdownUrl = (path, anchor = "") => route(path, anchor).slice(1);
const assetUrl = (path) => `./content/${encodedPath(path)}`;

function exclusion(path) {
  const segments = path.split("/");
  if (segments.some((part) => excludedSegments.has(part))) return "temporary or generated directory";
  if (segments.some((part) => part.startsWith(".env") && part !== ".env.example")) return "local environment file";
  if (path.startsWith("docs/verification/")) return "verification evidence";
  if (privateDocs.has(path)) return "authoring or planning workspace";
  return null;
}

function walk(directory, root, predicate) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      const relativePath = slash(relative(root, path));
      if (entry.isSymbolicLink() || exclusion(relativePath)) return [];
      return entry.isDirectory() ? walk(path, root, predicate) : predicate(relativePath) ? [relativePath] : [];
    });
}

// Protect literal code examples before adapting Markdown and HTML links.
function outsideCode(markdown, transform) {
  const code = [];
  const masked = markdown.replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[~`]*[ \t]*(?=\n|$)|$)/g, (value) => {
    code.push(value);
    return `\u0000SITE_CODE_${code.length - 1}\u0000`;
  }).replace(/(`+)([^\n]*?)\1/g, (value) => {
    code.push(value);
    return `\u0000SITE_CODE_${code.length - 1}\u0000`;
  });
  return transform(masked).replace(/\u0000SITE_CODE_(\d+)\u0000/g, (_, index) => code[Number(index)]);
}

function markdownDestinations(text, transform) {
  // Destinations may use angle brackets or contain one balanced pair of parentheses.
  return text.replace(/(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^\s()]+(?:\([^\n()]*\)[^\s()]*)*)(\s+"[^"\n]*"|\s+'[^'\n]*')?\)/g,
    (original, image, label, destination, title = "") => transform({ original, image: Boolean(image), label, destination: destination.replace(/^<|>$/g, ""), title }));
}

/** Build a standalone Docsify tree without changing any tutorial source. */
export function buildSite({ root = projectRoot, output = join(root, "site-dist"), shell = join(root, "website") } = {}) {
  const requestedRoot = resolve(root);
  root = realpathSync(root);
  output = resolve(root, relative(requestedRoot, resolve(output)));
  if (output === root || relative(root, output).startsWith("..") || isAbsolute(relative(root, output))
    || !basename(output).startsWith("site-dist")) {
    throw new Error("Output must be a site-dist* directory inside the repository.");
  }
  if (!existsSync(join(shell, "index.html"))) throw new Error(`Missing website shell: ${join(shell, "index.html")}`);
  const chapters = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^chapter-\d+-/.test(entry.name))
    .map((entry) => entry.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const tutorialPages = chapters.flatMap((chapter) => walk(join(root, chapter), root, (path) => extname(path) === ".md" && !path.includes("/assets/variants/")));
  const initialPages = ["README.md", ...publicDocs.filter((path) => existsSync(join(root, path))), ...tutorialPages];
  const pages = new Map();
  const assets = new Set();
  const sourceFiles = new Set();
  const sourceDirectories = new Set();
  const generatedGifCovers = new Map();
  const omittedLinks = [];
  const errors = [];
  const queued = new Set(initialPages);
  const queue = [...initialPages];
  let convertedPlayers = 0;
  let gifCount = 0;

  function gifImage(path, alt, specifiedCover = null) {
    let cover = specifiedCover;
    if (!cover) {
      const stem = basename(path, ".gif").replace(/-[a-f\d]{6,}$/i, "");
      const neighbor = readdirSync(dirname(join(root, path))).sort().find((name) => name.startsWith(`${stem}-cover`) && name.endsWith(".png"));
      if (neighbor) {
        cover = slash(join(dirname(path), neighbor));
        if (!checkTarget(cover, path)) cover = null;
        else assets.add(cover);
      }
    }
    if (!cover) {
      cover = `${path}.cover.png`;
      generatedGifCovers.set(path, cover);
    }
    return `<img src="${escapeHtml(assetUrl(cover))}" data-gif-src="${escapeHtml(assetUrl(path))}" data-cover="${escapeHtml(assetUrl(cover))}" data-no-zoom alt="${escapeHtml(alt)}">`;
  }

  function checkTarget(path, from) {
    const blocked = exclusion(path);
    if (blocked) {
      omittedLinks.push({ from, target: path, reason: blocked });
      return false;
    }
    const target = join(root, path);
    if (!existsSync(target)) {
      errors.push(`${from}: missing local reference ${path}`);
      return false;
    }
    const actual = realpathSync(target);
    const inside = relative(root, actual);
    if (inside.startsWith("..") || isAbsolute(inside) || lstatSync(target).isSymbolicLink()) {
      errors.push(`${from}: reference escapes repository ${path}`);
      return false;
    }
    return true;
  }

  function sourcePage(path) {
    sourceFiles.add(path);
    const text = readFileSync(join(root, path), "utf8");
    const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
    const language = languageFor[extname(path)] ?? (basename(path) === ".env.example" ? "bash" : "text");
    const page = `${path}.md`;
    pages.set(page, {
      title: basename(path), kind: "source", source: path,
      text: `# ${basename(path)}\n\n\`${path}\`\n\n<a href="${escapeHtml(assetUrl(path))}" download>下载原始文件</a>\n\n${fence}${language}\n${text.replace(/\n?$/, "\n")}${fence}\n`,
    });
    return page;
  }

  function directoryPage(path) {
    const readme = `${path}/README.md`;
    if (existsSync(join(root, readme)) && !exclusion(readme)) {
      enqueue(readme);
      return readme;
    }
    const page = `${path}/_index.md`;
    if (pages.has(page)) return page;
    sourceDirectories.add(path);
    const files = walk(join(root, path), root, (file) => sourceExtensions.has(extname(file)) || basename(file) === ".env.example" || basename(file) === "LICENSE");
    pages.set(page, {
      title: `${basename(path)} 源码`, kind: "source-index", source: path,
      text: `# ${basename(path)} 源码\n\n\`${path}/\`\n\n${files.map((file) => `- [${file.slice(path.length + 1)}](${markdownUrl(sourcePage(file))})`).join("\n")}\n`,
    });
    return page;
  }

  function enqueue(path) {
    if (!queued.has(path)) {
      queued.add(path);
      queue.push(path);
    }
  }

  function localDestination(destination, from, image) {
    const decoded = destination.replaceAll("&amp;", "&");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(decoded)) return { url: destination, local: false };
    const [pathname, suffix = ""] = decoded.split(/(?=[?#])/, 2);
    let path;
    try {
      path = slash(relative(root, resolve(dirname(join(root, from)), decodeURIComponent(pathname))));
    } catch {
      errors.push(`${from}: invalid URL ${destination}`);
      return { omitted: true };
    }
    if (path.startsWith("..") || isAbsolute(path)) {
      errors.push(`${from}: reference escapes repository ${destination}`);
      return { omitted: true };
    }
    if (!checkTarget(path, from)) return { omitted: true };
    const extension = extname(path).toLowerCase();
    const anchor = suffix.startsWith("#") ? decodeURIComponent(suffix.slice(1)) : new URLSearchParams(suffix.slice(1)).get("id") ?? "";
    if (statSync(join(root, path)).isDirectory()) return { url: markdownUrl(directoryPage(path), anchor), local: true };
    if (extension === ".md") {
      enqueue(path);
      return { url: markdownUrl(path, anchor), local: true };
    }
    if (image) {
      assets.add(path);
      if (extension === ".gif") gifCount++;
      return { url: assetUrl(path), local: true, path, extension };
    }
    if (imageExtensions.has(extension)) {
      assets.add(path);
      const page = `${path}.md`;
      const image = extension === ".gif" ? gifImage(path, basename(path)) : `<img src="${escapeHtml(assetUrl(path))}" alt="${escapeHtml(basename(path))}">`;
      pages.set(page, { title: basename(path), kind: "image", source: path, text: `# ${extension === ".gif" ? "教学动图" : "教学配图"}\n\n${image}\n` });
      return { url: markdownUrl(page), local: true };
    }
    if (sourceExtensions.has(extension) || basename(path) === "LICENSE" || basename(path) === ".env.example") {
      return { url: markdownUrl(sourcePage(path), anchor), local: true };
    }
    assets.add(path);
    return { url: assetUrl(path), local: true, attachment: true };
  }

  function prepareMarkdown(markdown, from) {
    return outsideCode(markdown, (text) => {
      text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (style) => /\.motion-player\b/.test(style) ? "" : style);
      text = text.replace(/<details\b[^>]*class=["'][^"']*\bmotion-player\b[^"']*["'][^>]*>[\s\S]*?<\/details>/gi, (player) => {
        const gif = player.match(/<img\b[^>]*\bclass=["'][^"']*\bmotion-gif\b[^"']*["'][^>]*>/i)?.[0];
        if (!gif) {
          errors.push(`${from}: motion-player is missing its motion-gif image`);
          return player;
        }
        convertedPlayers++;
        const gifSource = gif.match(/\bsrc=["']([^"']+)["']/i)?.[1];
        const cover = player.match(/<img\b[^>]*\bclass=["'][^"']*\bmotion-cover\b[^"']*["'][^>]*>/i)?.[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
        const alt = gif.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "教学动图";
        const target = localDestination(gifSource, from, true);
        const staticTarget = cover ? localDestination(cover, from, true) : null;
        return target.omitted ? alt : gifImage(target.path, alt, staticTarget?.path);
      });
      text = markdownDestinations(text, ({ original, image, label, destination, title }) => {
        const target = localDestination(destination, from, image);
        if (target.omitted) return label;
        if (!target.local) return original;
        if (image) return target.extension === ".gif" ? gifImage(target.path, label) : `<img src="${escapeHtml(target.url)}" alt="${escapeHtml(label)}"${title ? ` title=${title.trim()}` : ""}>`;
        if (target.attachment) return `<a href="${escapeHtml(target.url)}">${label}</a>`;
        return `[${label}](${target.url}${title})`;
      });
      text = text.replace(/^(\s*\[[^\]\n]+\]:\s*)(<?[^\s>]+>?)(.*)$/gm, (original, lead, destination, rest) => {
        const target = localDestination(destination.replace(/^<|>$/g, ""), from, false);
        return target.omitted ? "" : `${lead}${target.url}${rest}`;
      });
      text = text.replace(/<(img|a)\b[^>]*>/gi, (tag, name) => {
        const attribute = name.toLowerCase() === "img" ? "src" : "href";
        const match = tag.match(new RegExp(`\\b${attribute}=(["'])(.*?)\\1`, "i"));
        if (!match || match[2].startsWith("./content/")) return tag;
        const target = localDestination(match[2], from, attribute === "src");
        if (target.omitted) return tag.replace(match[0], "");
        if (attribute === "src" && target.extension === ".gif") {
          const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "教学动图";
          return gifImage(target.path, alt);
        }
        const url = attribute === "href" && target.local && target.url.startsWith("/content/") ? `#${target.url}` : target.url;
        return tag.replace(match[0], `${attribute}="${escapeHtml(url)}"`);
      });
      return text;
    });
  }

  while (queue.length) {
    const path = queue.shift();
    if (pages.has(path)) continue;
    if (!checkTarget(path, "initial navigation")) continue;
    const markdown = readFileSync(join(root, path), "utf8");
    pages.set(path, { title: titleOf(markdown, basename(path)), kind: "tutorial", source: path, text: prepareMarkdown(markdown, path) });
  }
  if (errors.length) throw new Error(`Site build failed:\n${[...new Set(errors)].join("\n")}`);

  const chapterNavigation = chapters.map((directory) => {
    const overview = `${directory}/README.md`;
    const lessons = [...pages.keys()].filter((path) => path.startsWith(`${directory}/`) && /^\d+-[^/]+\/README\.md$/.test(path.slice(directory.length + 1)))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const exercises = `${directory}/EXERCISES.md`;
    const other = tutorialPages.filter((path) => path.startsWith(`${directory}/`) && !path.includes("/examples/") && path !== overview && path !== exercises && !lessons.includes(path));
    return { directory, title: pages.get(overview)?.title ?? directory, overview, lessons, exercises: pages.has(exercises) ? exercises : null, other };
  });
  const sidebar = [
    `- [课程首页](${markdownUrl("README.md")})`, `- [环境准备](${markdownUrl("docs/SETUP.md")})`, `- [课程进度 · 36 章路线](${markdownUrl("docs/PROGRESS.md")})`, "",
    ...chapterNavigation.flatMap((chapter) => [
      `- [${chapter.title}](${markdownUrl(chapter.overview)})`,
      ...chapter.lessons.map((path) => `  - [${pages.get(path).title}](${markdownUrl(path)})`),
      ...(chapter.exercises ? [`  - [练习与答案](${markdownUrl(chapter.exercises)})`] : []),
      ...chapter.other.map((path) => `  - [${pages.get(path).title}](${markdownUrl(path)})`),
    ]), "", "- 课程与参考资料",
    ...publicDocs.filter((path) => !["docs/SETUP.md", "docs/PROGRESS.md"].includes(path) && pages.has(path)).map((path) => `  - [${pages.get(path).title}](${markdownUrl(path)})`), "",
  ].join("\n");

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const write = (path, content) => { mkdirSync(dirname(join(output, path)), { recursive: true }); writeFileSync(join(output, path), content); };
  const copy = (from, to) => { mkdirSync(dirname(join(output, to)), { recursive: true }); copyFileSync(from, join(output, to)); };
  for (const path of walk(shell, shell, () => true)) copy(join(shell, path), path);
  for (const [path, page] of pages) write(`content/${path}`, page.text);
  for (const path of new Set([...assets, ...sourceFiles])) copy(join(root, path), `content/${path}`);
  for (const [gif, cover] of generatedGifCovers) {
    mkdirSync(dirname(join(output, "content", cover)), { recursive: true });
    writeGifCover(join(root, gif), join(output, "content", cover));
  }
  write("_sidebar.md", sidebar);
  write(".nojekyll", "");
  const pageManifest = [...pages].map(([path, page]) => ({ path: `content/${path}`, route: route(path), title: page.title, kind: page.kind, source: page.source })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const navigation = { version: 1, home: route("README.md"), chapters: chapterNavigation, pages: pageManifest };
  write("navigation.json", `${JSON.stringify(navigation, null, 2)}\n`);
  const report = {
    version: 1, chapters: chapters.length, tutorialPages: pageManifest.filter((page) => page.kind === "tutorial").length,
    lessonPages: chapterNavigation.reduce((sum, chapter) => sum + chapter.lessons.length, 0), exercisePages: chapterNavigation.filter((chapter) => chapter.exercises).length,
    sourcePages: sourceFiles.size, sourceIndexes: sourceDirectories.size, imagePages: pageManifest.filter((page) => page.kind === "image").length,
    referencedAssets: assets.size, gifReferences: gifCount, convertedMotionPlayers: convertedPlayers,
    assetBytes: [...assets].reduce((sum, path) => sum + statSync(join(root, path)).size, 0),
    generatedGifCovers: [...generatedGifCovers.values()].sort(),
    excluded: ["docs/.work/**", "docs/verification/**", ...privateDocs, ".git/**", ".env (except .env.example)", "node_modules/**", "dist/**", "unreferenced assets, including assets/variants candidates"],
    omittedLinks, missingLocalReferences: [], assets: [...assets].sort(),
  };
  write("build-report.json", `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--out-dir")) throw new Error("Usage: node scripts/build-site.mjs [--out-dir site-dist-name]");
    const report = buildSite({ output: args.length ? resolve(projectRoot, args[1]) : join(projectRoot, "site-dist") });
    console.log(`Built ${report.chapters} chapters, ${report.tutorialPages} tutorial pages, ${report.sourcePages} source pages, ${report.referencedAssets} referenced assets; ${report.convertedMotionPlayers} GIF players adapted.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
