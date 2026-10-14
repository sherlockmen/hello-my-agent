// Pinned browser assets keep the public site independent of third-party CDNs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'website/vendor');
const assets = {
  'docsify.min.js': 'docsify@4.13.1/lib/docsify.min.js',
  'vue.css': 'docsify@4.13.1/lib/themes/vue.css',
  'search.min.js': 'docsify@4.13.1/lib/plugins/search.min.js',
  'zoom-image.js': 'docsify@4.13.1/lib/plugins/zoom-image.js',
  'docsify.LICENSE': 'docsify@4.13.1/LICENSE',
  'medium-zoom.LICENSE': 'medium-zoom@1.0.8/LICENSE',
  'docsify-toc.js': 'docsify-toc@1.1.0/dist/toc.js',
  'docsify-toc.LICENSE': 'docsify-toc@1.1.0/LICENSE',
  'docsify-sidebar-collapse.js': 'docsify-sidebar-collapse@1.3.5/dist/docsify-sidebar-collapse.js',
  'docsify-sidebar-collapse.LICENSE': 'docsify-sidebar-collapse@1.3.5/LICENSE',
  'docsify-copy-code.min.js': 'docsify-copy-code@3.0.2/dist/docsify-copy-code.min.js',
  'docsify-copy-code.LICENSE': 'docsify-copy-code@3.0.2/LICENSE',
  'docsify-pagination.min.js': 'docsify-pagination@2.10.1/dist/docsify-pagination.min.js',
  'docsify-pagination.LICENSE': 'docsify-pagination@2.10.1/LICENSE',
  'prism.LICENSE': 'prismjs@1.30.0/LICENSE'
};
for (const language of ['typescript', 'jsx', 'tsx', 'bash', 'json', 'yaml', 'diff']) {
  assets[`prism-${language}.min.js`] = `prismjs@1.30.0/components/prism-${language}.min.js`;
}
await fs.mkdir(vendor, { recursive: true });
await Promise.all(Object.entries(assets).map(async ([name, url]) => {
  let body = await download(`https://unpkg.com/${url}`);
  if (name === 'vue.css') body = body.replace(/@import[^;]+;/g, ''); // Use local system fonts.
  if (name === 'docsify-toc.js') {
    body = replaceOnce(body, "var selector = options.scope + ' ' + options.headings", "var selector = options.headings.split(',').map(function (heading) { return options.scope + ' ' + heading.trim(); }).join(',')");
  }
  if (name === 'docsify-sidebar-collapse.js') {
    // Retain folding, but leave mobile navigation to Docsify's existing toggle.
    const start = body.indexOf('  var css$1 =');
    const end = body.indexOf('  function install()', start);
    if (start < 0 || end < start) throw new Error('Sidebar mobile patch no longer matches upstream.');
    body = body.slice(0, start) + body.slice(end);
    const clickStart = body.indexOf('  function handleMenuClick(e)');
    const clickEnd = body.indexOf('  function getActiveNode()', clickStart);
    if (clickStart < 0 || clickEnd < clickStart) throw new Error('Sidebar click patch no longer matches upstream.');
    body = body.slice(0, clickStart) + `  function handleMenuClick(e) {
    var control = e.target.closest('button[data-sidebar-toggle]');
    if (!control) return;
    var node = control.parentElement;
    var open = !node.classList.contains('open');
    node.classList.toggle('open', open);
    node.classList.toggle('collapse', !open);
    control.setAttribute('aria-expanded', String(open));
  }

` + body.slice(clickEnd);
    body = replaceOnce(body, 'var curLink = document.querySelector(".sidebar-nav a[href=\\\"".concat(decodeURIComponent(location.hash).replace(/ /gi, \'%20\'), "\\\"]"));', "var route = decodeURIComponent(location.hash).split('?')[0].replace(/\\.md$/, '');\n      var curLink = Array.from(document.querySelectorAll('.sidebar-nav a')).find(function (a) { return decodeURIComponent(a.hash).split('?')[0].replace(/\\.md$/, '') === route; });");
  }
  if (name === 'zoom-image.js') {
    // One zoom instance owns the document listeners across route changes.
    body = replaceOnce(body, '    hook.doneEach(function (_) {', `    hook.beforeEach(function (content, next) {
      if (!zoom) { next(content); return; }
      zoom.close().then(function () { zoom.detach(); next(content); });
    });

    hook.doneEach(function (_) {`);
    body = replaceOnce(body, '      zoom = mediumZoom(elms);', "      if (zoom) { zoom.attach(elms); }\n      else { zoom = mediumZoom(elms, { background: '#fffefa', margin: 24 }); }");
    // Transition events may be suppressed by reduced motion or a hidden tab.
    body = replaceOnce(body, '        var _handleOpenEnd = function _handleOpenEnd() {', '        var openFinished = false;\n        var openTimer;\n        var _handleOpenEnd = function _handleOpenEnd() {\n          if (openFinished) return;\n          openFinished = true;\n          clearTimeout(openTimer);');
    body = replaceOnce(body, "        active.zoomed.addEventListener('transitionend', _handleOpenEnd);", "        active.zoomed.addEventListener('transitionend', _handleOpenEnd);\n        openTimer = setTimeout(_handleOpenEnd, 450);");
    body = replaceOnce(body, '        if (isAnimating || !active.original) {', '        if (isAnimating) {\n          setTimeout(function () { close().then(resolve); }, 30);\n          return;\n        }\n        if (!active.original) {');
    body = replaceOnce(body, '        var _handleCloseEnd = function _handleCloseEnd() {', '        var closeFinished = false;\n        var closeTimer;\n        var _handleCloseEnd = function _handleCloseEnd() {\n          if (closeFinished) return;\n          closeFinished = true;\n          clearTimeout(closeTimer);');
    body = replaceOnce(body, "        active.zoomed.addEventListener('transitionend', _handleCloseEnd);", "        active.zoomed.addEventListener('transitionend', _handleCloseEnd);\n        closeTimer = setTimeout(_handleCloseEnd, 450);");
  }
  await fs.writeFile(path.join(vendor, name), body);
}));
console.log(`Downloaded ${Object.keys(assets).length} pinned site assets.`);

function replaceOnce(body, from, to) {
  if (!body.includes(from) || body.indexOf(from) !== body.lastIndexOf(from)) throw new Error('Site vendor patch no longer matches upstream.');
  return body.replace(from, to);
}

async function download(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    // curl respects the local proxy on Node versions without env-proxy support.
    try {
      return (await promisify(execFile)('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '30', url], { maxBuffer: 2 * 1024 * 1024 })).stdout;
    } catch (fallbackError) {
      throw new Error(`Unable to download ${url}: ${fallbackError.message}`, { cause: error });
    }
  }
}
