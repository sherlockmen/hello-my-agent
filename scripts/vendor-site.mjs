// Pinned browser assets keep the public site independent of third-party CDNs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'website/vendor');
const assets = {
  'docsify.min.js': 'docsify@4.13.1/lib/docsify.min.js',
  'vue.css': 'docsify@4.13.1/lib/themes/vue.css',
  'search.min.js': 'docsify@4.13.1/lib/plugins/search.min.js',
  'docsify.LICENSE': 'docsify@4.13.1/LICENSE',
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
  const response = await fetch(`https://unpkg.com/${url}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  let body = await response.text();
  if (name === 'vue.css') body = body.replace(/@import[^;]+;/g, ''); // Use local system fonts.
  await fs.writeFile(path.join(vendor, name), body);
}));
console.log(`Downloaded ${Object.keys(assets).length} pinned site assets.`);
