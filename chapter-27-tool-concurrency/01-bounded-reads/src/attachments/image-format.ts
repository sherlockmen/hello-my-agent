/**
 * 27.1 有界只读并发 | [KEEP] attachments/image-format.ts
 *
 * 学习目标：用本地文件的真实字节判断格式与尺寸，再转图片协议。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：签名 -> 有界格式/尺寸检查 -> PNG/JPEG类型；错误拒绝发送
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { inflateSync } from "node:zlib";
import { UserFacingError } from "../errors.js";
import { ATTACHMENT_LIMITS, type AttachmentRef } from "./store.js";

/**
 * PNG 块校验使用标准 CRC32，逐字节计算有界文件；不把扩展名当作格式证据。
 * 校验覆盖块类型和数据，避免缺块或损坏数据被直接转换为 base64。
 */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 检查 PNG 签名、块边界、CRC、IHDR 与解压后的扫描线长度和过滤字节。
 * 为保持无额外依赖的边界，课程只支持非交错 PNG；不把此检查宣称为通用图片解码器。
 */
function pngDimensions(bytes: Buffer): [number, number] {
  let offset = 8, width = 0, height = 0, expected = 0, rowBytes = 0, ended = false, sawData = false;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length || size > ATTACHMENT_LIMITS.imageBytes) throw new UserFacingError("PNG 块长度无效。");
    const type = bytes.toString("ascii", offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new UserFacingError("PNG 块校验失败。");
    if (!width && type !== "IHDR") throw new UserFacingError("PNG 缺少起始 IHDR。");
    if (type === "IHDR") {
      if (width || size !== 13) throw new UserFacingError("PNG IHDR 无效。");
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); checkDimensions(width, height);
      const depth = chunk[8], color = chunk[9], channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) throw new UserFacingError("仅支持标准压缩、非交错 PNG。");
      rowBytes = Math.ceil(width * channels[color] * depth / 8); expected = (rowBytes + 1) * height;
      if (expected > 128 * 1024 * 1024) throw new UserFacingError("PNG 解压数据超过本地限制。");
    } else if (type === "IDAT") { data.push(chunk); sawData = true; }
    else if (type === "IEND") { if (size || end !== bytes.length || !sawData) throw new UserFacingError("PNG 结束块无效。"); ended = true; break; }
    offset = end;
  }
  if (!ended) throw new UserFacingError("PNG 文件不完整。");
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected }); } catch { throw new UserFacingError("PNG 压缩内容无效或超过尺寸。"); }
  if (raw.length !== expected) throw new UserFacingError("PNG 扫描线长度与尺寸不一致。");
  for (let row = 0; row < height; row++) if (raw[row * (rowBytes + 1)] > 4) throw new UserFacingError("PNG 扫描线过滤类型无效。");
  return [width, height];
}

/**
 * 检查 JPEG 标记边界与帧尺寸，要求扫描数据和末尾 EOI。
 * 课程接纳常见 baseline/progressive JPEG；熵编码的完整解码仍由服务端图片解析器完成。
 */
function jpegDimensions(bytes: Buffer): [number, number] {
  let offset = 2, width = 0, height = 0, scan = false;
  if (bytes.length < 12 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw new UserFacingError("JPEG 文件不完整。");
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) throw new UserFacingError("JPEG 标记无效。");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) throw new UserFacingError("JPEG 段顺序无效。");
    if (offset + 2 > bytes.length) throw new UserFacingError("JPEG 段不完整。");
    const length = bytes.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > bytes.length - 2) throw new UserFacingError("JPEG 段长度无效。");
    if (marker === 0xc0 || marker === 0xc2) {
      if (width || length < 11 || bytes[offset + 2] !== 8) throw new UserFacingError("JPEG 帧格式不支持。");
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); checkDimensions(width, height);
      const components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) throw new UserFacingError("JPEG 颜色分量无效。");
    } else if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) throw new UserFacingError("只支持 baseline/progressive JPEG。");
    if (marker === 0xda) {
      if (!width || length < 6) throw new UserFacingError("JPEG 扫描数据缺少帧信息。");
      scan = true; offset = end;
      while (offset < bytes.length - 2) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0x00 || next >= 0xd0 && next <= 0xd7) { offset += 2; continue; }
        break;
      }
    } else offset = end;
  }
  if (!width || !scan || offset !== bytes.length - 2) throw new UserFacingError("JPEG 缺少完整扫描数据。");
  return [width, height];
}

/**
 * 像素边长和面积同时检查，防止很小的压缩文件声明超大图像。
 * 这里的限制是课程本地策略，不冒充任何模型服务的公开上限。
 */
function checkDimensions(width: number, height: number): void {
  if (!width || !height || width > ATTACHMENT_LIMITS.edge || height > ATTACHMENT_LIMITS.edge || width * height > ATTACHMENT_LIMITS.pixels) throw new UserFacingError("图片尺寸超过 4096×4096 或像素限制。");
}

/**
 * 按真实签名选择 PNG/JPEG，并要求扩展名声明一致；限制格式后才做协议转换。
 * 返回类型来自字节检查，既不推测 URL，也不下载远端附件。
 */
export function validateImage(bytes: Buffer, extension: string): AttachmentRef["mediaType"] {
  if (bytes.length > ATTACHMENT_LIMITS.imageBytes) throw new UserFacingError("图片附件超过 4 MiB。");
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (png && extension === ".png") { pngDimensions(bytes); return "image/png"; }
  if (jpeg && [".jpg", ".jpeg"].includes(extension)) { jpegDimensions(bytes); return "image/jpeg"; }
  throw new UserFacingError("图片内容与 PNG/JPEG 扩展名不一致，或格式不支持。");
}
