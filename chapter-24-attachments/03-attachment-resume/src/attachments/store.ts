/**
 * 24.3 附件会话恢复 | [KEEP] attachments/store.ts
 *
 * 学习目标：把可发送附件与聊天文字分开，读取时固定来源与内容摘要。
 * 输入：本地已校验的配置或消息；外部字段仍要在使用处检查。
 * 输出：独立的转换结果；失败停止当前操作，保留已提交历史。
 * 本文件局部流程：/attach -> 有界读取/校验 -> pending ref -> user消息 -> 请求前重新校验
 * 观察：调用方等待完整结果后才继续，类型声明不会产生权限批准。
 */
import { validateImage } from "./image-format.js";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createIgnoreMatcher, findProjectRoot } from "../tools/workspace.js";
import { UserFacingError } from "../errors.js";
import type { Message } from "../models/client.js";

export const ATTACHMENT_LIMITS = { textBytes: 64 * 1024, imageBytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, count: 4, images: 2, edge: 4096, pixels: 16_777_216 } as const;
export type AttachmentRef = { id: string; path: string; mediaType: "text/plain" | "image/png" | "image/jpeg"; byteLength: number; sha256: string; status: "ready" | "missing" | "reattach" };
export type PreparedAttachment = { ref: AttachmentRef; text?: string; base64?: string };
export type AttachmentState = { readonly root: string; pending: AttachmentRef[]; command(text: string, signal: AbortSignal): Promise<{ ok: boolean; message: string }>; preflight(signal: AbortSignal, images: boolean): Promise<void>; take(): AttachmentRef[] };

/**
 * 用白名单重建可持久化引用；引用只描述本地来源，不含正文、base64 或绝对路径。
 * 严格拒绝未知字段、过量与重复 ID，避免恢复时把任意对象当成可读取文件。
 */
export function validateAttachmentRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value) || value.length > ATTACHMENT_LIMITS.count) throw new UserFacingError("附件列表超过限制。");
  const ids = new Set<string>();
  const refs = value.map((item): AttachmentRef => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new UserFacingError("附件引用格式无效。");
    const ref = item as Record<string, unknown>;
    if (Object.keys(ref).sort().join() !== ["id", "path", "mediaType", "byteLength", "sha256", "status"].sort().join()) throw new UserFacingError("附件引用字段无效。");
    if (typeof ref.id !== "string" || !/^[a-f0-9-]{36}$/.test(ref.id) || ids.has(ref.id)) throw new UserFacingError("附件编号无效。");
    ids.add(ref.id);
    if (typeof ref.path !== "string" || !validRelativePath(ref.path)) throw new UserFacingError("附件路径必须是项目内的相对路径。");
    if (ref.mediaType !== "text/plain" && ref.mediaType !== "image/png" && ref.mediaType !== "image/jpeg") throw new UserFacingError("附件类型不支持。");
    const max = ref.mediaType === "text/plain" ? ATTACHMENT_LIMITS.textBytes : ATTACHMENT_LIMITS.imageBytes;
    if (!Number.isSafeInteger(ref.byteLength) || (ref.byteLength as number) < 1 || (ref.byteLength as number) > max) throw new UserFacingError("附件大小无效。");
    if (typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || !["ready", "missing", "reattach"].includes(ref.status as string)) throw new UserFacingError("附件校验信息无效。");
    return { id: ref.id, path: ref.path, mediaType: ref.mediaType, byteLength: ref.byteLength as number, sha256: ref.sha256, status: ref.status as AttachmentRef["status"] };
  });
  if (refs.reduce((sum, ref) => sum + ref.byteLength, 0) > ATTACHMENT_LIMITS.totalBytes || refs.filter(ref => ref.mediaType !== "text/plain").length > ATTACHMENT_LIMITS.images) throw new UserFacingError("附件总量超过限制。");
  return refs;
}

/**
 * 相对路径不能回退、隐藏控制字符或使用平台相关反斜杠。
 * 真正的符号链接与忽略规则检查留在打开文件前执行。
 */
function validRelativePath(path: string): boolean {
  return !!path && path.length <= 400 && !isAbsolute(path) && !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part !== ".." && part !== "" && part !== ".");
}

/**
 * 读取一个有界普通文件并始终关闭句柄；真实路径仍须留在项目且不被忽略。
 * 本课程的路径检查不是操作系统沙箱；不支持并发恶意替换项目目录的进程隔离。
 */
async function readBytes(root: string, path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!validRelativePath(path)) throw new UserFacingError("附件路径必须是项目内的相对路径。");
  const realRoot = await realpath(root), target = await realpath(resolve(realRoot, path));
  const local = relative(realRoot, target).split(sep).join("/");
  if (!validRelativePath(local) || (await createIgnoreMatcher(realRoot)).ignores(path) || (await createIgnoreMatcher(realRoot)).ignores(local)) throw new UserFacingError("附件路径位于项目外或受保护、被忽略的范围。");
  const handle = await open(target, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > ATTACHMENT_LIMITS.imageBytes) throw new UserFacingError("附件必须是限制内的普通非空文件。");
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new UserFacingError("附件读取期间已变化，请重新 /attach。");
    signal.throwIfAborted();
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/**
 * 文本须为严格 UTF-8；图片扩展名必须与真实签名、结构和尺寸一致。
 * 二进制数据不能经过文字分支伪装成可用的附件正文。
 */
function describeBytes(bytes: Buffer, path: string): { mediaType: AttachmentRef["mediaType"]; text?: string } {
  if ([".png", ".jpg", ".jpeg"].includes(extname(path).toLowerCase())) return { mediaType: validateImage(bytes, extname(path).toLowerCase()) };
  if (bytes.length > ATTACHMENT_LIMITS.textBytes) throw new UserFacingError("文本附件超过 64 KiB。");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new UserFacingError("文本附件必须是有效 UTF-8。"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new UserFacingError("附件包含二进制或不支持的控制字符。");
  return { mediaType: "text/plain", text };
}

/**
 * 在加入待发送列表时读取并记录摘要；失败不改变旧列表。
 * 本地命令不构成用户消息，take 才把引用交给下一次普通输入。
 */
export function createAttachmentState(root = findProjectRoot()): AttachmentState {
  const submitted: AttachmentRef[] = [];
  const state: AttachmentState = { root, pending: [],
    async command(text, signal) {
      try {
        signal.throwIfAborted();
        if (text === "/attachments") return { ok: true, message: state.pending.length ? state.pending.map(ref => `${ref.id} ${ref.path} ${ref.mediaType} ${ref.byteLength} B`).join("\n") : "没有待发送附件。" };
        const detach = /^\/detach (all|[a-f0-9-]{36})$/.exec(text);
        if (detach) {
          if (detach[1] !== "all" && ![...state.pending, ...submitted].some(ref => ref.id === detach[1])) return { ok: false, message: "没有这个待发送附件。" };
          for (const ref of submitted) if (detach[1] === "all" || ref.id === detach[1]) ref.status = "reattach";
          state.pending = detach[1] === "all" ? [] : state.pending.filter(ref => ref.id !== detach[1]);
          return { ok: true, message: "已移除待发送附件引用。" };
        }
        const match = /^\/attach (.+)$/.exec(text);
        if (!match) return { ok: false, message: "用法：/attach <项目内相对路径>；/attachments；/detach <编号|all>。" };
        const path = match[1], bytes = await readBytes(root, path, signal), description = describeBytes(bytes, path);
        const ref: AttachmentRef = { id: randomUUID(), path, mediaType: description.mediaType, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), status: "ready" };
        const next = validateAttachmentRefs([...state.pending.filter(item => item.path !== path), ref]);
        signal.throwIfAborted();
        for (const previous of submitted) if (previous.path === path) previous.status = "reattach";
        state.pending = next;
        return { ok: true, message: `已加入待发送附件：${path}（${ref.mediaType}，${bytes.length} B）。下一条普通消息会关联这些引用。` };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        return { ok: false, message: error instanceof UserFacingError ? error.message : "附件无法读取；请核对项目路径、权限和文件是否存在。" };
      }
    },
    async preflight(signal, images) {
      await prepareAttachments([{ role: "user", content: "", attachments: state.pending }], signal, images, root);
    },
    take() { const refs = state.pending; state.pending = []; submitted.push(...refs); return refs; },
  };
  return state;
}

/**
 * 每次请求前重新打开引用并核对类型、长度与摘要；从磁盘取得本次实际发送的字节。
 * 非 ready 的旧引用只转成明确说明，不重发旧附件；验证失败时整次请求不发送。
 */
export async function prepareAttachments(messages: Message[], signal: AbortSignal, images: boolean, root = findProjectRoot()): Promise<Map<string, PreparedAttachment>> {
  const prepared = new Map<string, PreparedAttachment>();
  for (const message of messages) {
    if (message.role !== "user" || !message.attachments) continue;
    for (const ref of validateAttachmentRefs(message.attachments)) {
      signal.throwIfAborted();
      if (ref.status !== "ready") { prepared.set(ref.id, { ref, text: `[附件 ${ref.path} 状态为 ${ref.status}，未发送正文；用户需重新 /attach 才会发送。]` }); continue; }
      if (ref.mediaType !== "text/plain" && !images) throw new UserFacingError("当前模型未声明图片能力；请切换支持图片的配置或移除附件后重新提交。");
      const bytes = await readBytes(root, ref.path, signal), description = describeBytes(bytes, ref.path);
      if (description.mediaType !== ref.mediaType || bytes.length !== ref.byteLength || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) throw new UserFacingError(`附件 ${ref.path} 已变化，请重新 /attach 后提交。`);
      prepared.set(ref.id, { ref, ...(description.text !== undefined ? { text: `[附件 ${ref.path}]\n${description.text}` } : { base64: bytes.toString("base64") }) });
    }
  }
  return prepared;
}

/**
 * 恢复只核对来源可用性，永不把历史 ready 状态当作重新发送授权。
 * 可用且内容一致标记 reattach；缺失、损坏、变更或越界标记 missing，继续恢复其他文字。
 */
export async function restoreAttachmentStatuses(messages: Message[], root: string): Promise<number> {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "user" || !message.attachments) continue;
    for (const ref of message.attachments) {
      count += 1;
      try {
        const bytes = await readBytes(root, ref.path, new AbortController().signal), description = describeBytes(bytes, ref.path);
        ref.status = description.mediaType === ref.mediaType && bytes.length === ref.byteLength && createHash("sha256").update(bytes).digest("hex") === ref.sha256 ? "reattach" : "missing";
      } catch { ref.status = "missing"; }
    }
  }
  return count;
}
