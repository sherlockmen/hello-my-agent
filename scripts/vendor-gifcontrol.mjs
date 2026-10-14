import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = path.join(root, 'website/vendor');
const version = '0.2.1';
let Reader;

// The upstream decoder also supplies static covers without a second GIF dependency.
function gifReader() {
  if (!Reader) {
    const context = vm.createContext({ window: {}, Element: class {}, setTimeout, clearTimeout });
    vm.runInContext(readFileSync(path.join(vendorDirectory, 'docsify-gifcontrol.js'), 'utf8'), context);
    Reader = context.window.HmaGifControl.GifReader;
  }
  return Reader;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(data.length);
  const suffix = Buffer.alloc(4);
  suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, body, suffix]);
}

export function writeGifCover(sourcePath, outputPath) {
  const GifReader = gifReader();
  const reader = new GifReader(new Uint8Array(readFileSync(sourcePath)));
  const pixels = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(0, pixels);
  const rows = Buffer.alloc((reader.width * 4 + 1) * reader.height);
  for (let y = 0; y < reader.height; y++) {
    rows.set(pixels.subarray(y * reader.width * 4, (y + 1) * reader.width * 4), y * (reader.width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(reader.width, 0);
  header.writeUInt32BE(reader.height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, png);
  return { width: reader.width, height: reader.height };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
  return response.text();
}

async function vendor() {
  await mkdir(vendorDirectory, { recursive: true });
  const cssMarker = '/* Hello, My Agent GIF controls */';
  const cssPath = path.join(vendorDirectory, 'docsify-gifcontrol.css');
  const currentCss = readFileSync(cssPath, 'utf8');
  assert.ok(currentCss.includes(cssMarker), 'Local GIF control styles must be retained');
  const overrides = currentCss.slice(currentCss.indexOf(cssMarker));
  const [upstreamJs, upstreamCss, pluginLicense, omggifSource, giflerLicense, coreJsLicense, runtimeLicense] = await Promise.all([
    download(`https://cdn.jsdelivr.net/npm/docsify-gifcontrol@${version}/dist/docsify-gifcontrol.js`),
    download(`https://cdn.jsdelivr.net/npm/docsify-gifcontrol@${version}/dist/docsify-gifcontrol.css`),
    download(`https://cdn.jsdelivr.net/npm/docsify-gifcontrol@${version}/LICENSE`),
    download('https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js'),
    download('https://raw.githubusercontent.com/spdx/license-list-data/v3.25.0/text/Apache-2.0.txt'),
    download('https://cdn.jsdelivr.net/npm/core-js@2.6.9/LICENSE'),
    download('https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.3/LICENSE'),
  ]);
  let source = upstreamJs;
  const replacements = [
    ['setTimeout(this.nextFrame.bind(this),0)', 'this.timer=setTimeout(this.nextFrame.bind(this),0)'],
    ['return this.running=!1,this', 'return this.running=!1,clearTimeout(this.timer),cancelAnimationFrame(this.raf),this'],
    ['requestAnimationFrame(this.nextFrameRender.bind(this))', 'this.raf=requestAnimationFrame(this.nextFrameRender.bind(this))'],
    ['setTimeout(this.nextFrame.bind(this),t);break', 'this.timer=setTimeout(this.nextFrame.bind(this),t);break'],
    ['t}(),s=Element.prototype', 't}();window.HmaGifControl={Loader:c,GifReader:e.GifReader};var s=Element.prototype'],
    ['t.doneEach(function(t){var r=', 't.doneEach(function(t){if(n.config.gifcontrol&&n.config.gifcontrol.managed)return;var r='],
  ];
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length - 1, 1, `Upstream patch target changed: ${before}`);
    source = source.replace(before, after);
  }
  await writeFile(path.join(vendorDirectory, 'docsify-gifcontrol.js'), `/* docsify-gifcontrol ${version}; local patches: managed mode, loader export, cancellable animation timers. See THIRD_PARTY.md. */\n${source}`);
  const omggifLicense = omggifSource.split('// omggif is a JavaScript implementation')[0].replace(/^\/\/ ?/gm, '').trim();
  assert.ok(omggifLicense.includes('Permission is hereby granted') && omggifLicense.includes('IN THE SOFTWARE.'));
  await Promise.all([
    writeFile(cssPath, `${upstreamCss}\n\n${overrides}`),
    writeFile(path.join(vendorDirectory, 'docsify-gifcontrol.LICENSE'), pluginLicense),
    writeFile(path.join(vendorDirectory, 'omggif.LICENSE'), `${omggifLicense}\n`),
    writeFile(path.join(vendorDirectory, 'gifler.LICENSE'), `gifler 0.1.0 by Bill Dwyer\nDeclared license: Apache-2.0\nPackage: https://www.npmjs.com/package/gifler/v/0.1.0\nUpstream GIF animator is modified by docsify-gifcontrol 0.2.1.\n\n${giflerLicense}`),
    writeFile(path.join(vendorDirectory, 'core-js.LICENSE'), coreJsLicense),
    writeFile(path.join(vendorDirectory, 'regenerator-runtime.LICENSE'), runtimeLicense),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await vendor();
