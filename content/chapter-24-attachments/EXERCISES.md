# 第 24 章练习与答案

[第 24 章首页](/content/chapter-24-attachments/README.md) · [24.3 附件恢复](/content/chapter-24-attachments/03-attachment-resume/README.md)

先预测下面三种情况，再运行完整 TypeScript 答案。答案在临时工作区创建材料，调用真实附件、协议转换和会话存储模块，不访问在线模型。它检查“哪些字节能进入请求”，图片中的语义仍需要真实模型任务另行观察。

## 练习一：登记成功，文件后来变了

先附加 `note.txt`，再修改同一路径的内容。发送时可以直接使用磁盘新内容吗？另一份附件登记失败，原来的待发送引用应怎样处理？

答案：同一路径不保证同一份材料。发送前核对摘要，变化使预检失败且保留待发送引用，用户重新附加后再提交；登记失败也保留旧列表。完整答案还检查越界路径、无效 UTF-8、64 KiB 文本上限、引用未知字段，以及读取取消不继续执行。

## 练习二：文本配置收到了一张合法PNG

文件是合规 PNG，是否就一定能发送给当前模型？把相同字节发给两种协议，内部附件引用是否需要保存两份 base64？

答案：图片合法和配置允许图片是两项条件。文本配置在发送前拒绝，图片配置材料化后再由适配器形成各自内容块。完整答案用一张真实1×1 PNG 检查 data URL 和 Anthropic base64 image 块中的字节相同，伪装成 PNG 的文本被拒绝，持久化引用中没有 base64。

## 练习三：文件还在，为什么恢复成reattach

保存并关闭会话，文件没有改动。恢复以后能否立刻把图片或文本再次发给模型？文件消失时，是否应该让整段文字聊天也无法恢复？

答案：恢复的是来源记录，程序不能把旧引用当作本次重新发送的动作。相同文件标记 `reattach`，缺失或变化标记 `missing`，请求只携带状态说明。完整答案实际写入 JSONL，再读取检查状态与字节缺席；重新 `/attach` 生成 ready 新引用，不改写恢复后的旧消息。

## 完整可执行答案

将下面完整保存为 [examples/verify-attachments.ts](/content/chapter-24-attachments/examples/verify-attachments.ts.md)。这是独立练习，不修改下一章沿用的 `src/`；脚本的断言失败会以非零状态退出，结束后清理自己创建的资源。

<details>
<summary>展开完整 TypeScript 答案</summary>

```ts
/**
 * 第24章完整答案 | [NEW 练习] examples/verify-attachments.ts
 * 学习目标：区分待发送引用、请求材料和恢复状态，并验证内容身份。
 * 输入：已构建的本节dist与组号1/2/3/all；输出：真实附件模块和会话模块的断言。
 * 练习流程：临时工作区 -> 登记 -> 材料化/协议转换 -> 引用持久化与重新附加。
 * 本例不访问在线模型；finally恢复工作目录并删除临时材料。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const dist = resolve(process.env.HMA_ATTACHMENTS_DIST ?? join(process.env.HMA_REPO ?? process.cwd(), "dist"));
  const load = (path: string) => import(pathToFileURL(join(dist, path)).href);
  const { createAttachmentState, prepareAttachments, validateAttachmentRefs } = await load("attachments/store.js");
  const group = process.argv[2] ?? "all";
  assert.ok(["1", "2", "3", "all"].includes(group), "组号必须是1、2、3或all");
  const directory = await mkdtemp(join(tmpdir(), "hma-attachment-exercise-"));
  const project = join(directory, "project"), previousCwd = process.cwd();
  const signal = () => new AbortController().signal;
  const source = "EXERCISE_ORIGINAL_MATERIAL\n验收：保存后可以恢复。\n";
  // 一张真实的1×1 RGB PNG，包含正确的CRC和压缩数据。
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082", "hex");
  try {
    await mkdir(project);
    await writeFile(join(project, "package.json"), '{"type":"module"}');
    await writeFile(join(project, "note.txt"), source);
    await writeFile(join(project, "pixel.png"), png);
    process.chdir(project);
    if (group === "1" || group === "all") {
      const state = createAttachmentState(project);
      assert.equal((await state.command("/attach note.txt", signal())).ok, true);
      assert.equal(state.pending.length, 1);
      const id = state.pending[0].id;
      assert.equal((await state.command("/attach ../outside.txt", signal())).ok, false);
      await writeFile(join(project, "bad.txt"), Buffer.from([0xff, 0xfe]));
      assert.equal((await state.command("/attach bad.txt", signal())).ok, false);
      await writeFile(join(project, "large.txt"), "x".repeat(64 * 1024 + 1));
      assert.equal((await state.command("/attach large.txt", signal())).ok, false);
      assert.equal(state.pending[0].id, id, "登记失败保留旧列表");
      await writeFile(join(project, "note.txt"), "CHANGED_BEFORE_SEND");
      await assert.rejects(state.preflight(signal(), false), /变化/);
      assert.equal(state.pending[0].id, id, "发送前预检失败也保留待发送引用");
      await writeFile(join(project, "note.txt"), source);
      await state.preflight(signal(), false);
      const refs = state.take(); assert.equal(state.pending.length, 0);
      const messages = [{ role: "user", content: "整理验收项", attachments: refs }];
      assert.match((await prepareAttachments(messages, signal(), false, project)).get(id).text, /EXERCISE_ORIGINAL_MATERIAL/);
      assert.throws(() => validateAttachmentRefs([{ ...refs[0], base64: "extra" }]), /字段/);
      await writeFile(join(project, "note.txt"), "CHANGED_MATERIAL");
      await assert.rejects(prepareAttachments(messages, signal(), false, project), /变化/);
      await writeFile(join(project, "note.txt"), source);
      const cancelled = new AbortController(); cancelled.abort(new Error("CANCEL_EXERCISE"));
      await assert.rejects(state.command("/attach note.txt", cancelled.signal), /CANCEL_EXERCISE/);
      console.log("通过一：登记不发请求；材料化核对内容，失败保留状态，取消不继续读取。");
    }
    if (group === "2" || group === "all") {
      const { toOpenAIMessages, toAnthropicMessages } = await load("models/protocol.js");
      const state = createAttachmentState(project);
      await writeFile(join(project, "disguised.png"), "plain text");
      assert.equal((await state.command("/attach disguised.png", signal())).ok, false);
      assert.equal((await state.command("/attach pixel.png", signal())).ok, true);
      const refs = state.take(), messages = [{ role: "user", content: "描述图片", attachments: refs }];
      await assert.rejects(prepareAttachments(messages, signal(), false, project), /图片能力/);
      const prepared = await prepareAttachments(messages, signal(), true, project);
      const openai = toOpenAIMessages(messages, prepared)[0].content.find((block: { type: string }) => block.type === "image_url");
      const anthropic = toAnthropicMessages(messages, prepared)[0].content.find((block: { type: string }) => block.type === "image");
      assert.equal(openai.image_url.url, `data:image/png;base64,${png.toString("base64")}`);
      assert.equal(anthropic.source.media_type, "image/png");
      assert.equal(anthropic.source.data, png.toString("base64"));
      assert.ok(!JSON.stringify(refs).includes(png.toString("base64")));
      console.log("通过二：同一张真实PNG转换成两种协议内容；文本配置在转换前拒绝图片。");
    }
    if (group === "3" || group === "all") {
      const { createSessionWriter } = await load("sessions/save-session.js");
      const { readSession } = await load("sessions/read-session.js");
      const state = createAttachmentState(project);
      assert.equal((await state.command("/attach note.txt", signal())).ok, true);
      const original = state.take()[0], messages = [{ role: "user", content: "检查附件", attachments: [original] }];
      const sessions = join(directory, "sessions"), writer = await createSessionWriter(sessions);
      try { await writer.save({ messages, mode: "execute", tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, "run_end"); }
      finally { await writer.close(); }
      const stored = await readFile(writer.path, "utf8");
      assert.ok(!stored.includes("EXERCISE_ORIGINAL_MATERIAL"));
      assert.ok(!stored.includes('"base64"'));
      const restored = await readSession(writer.id, sessions);
      const old = restored.state.messages[0].attachments[0];
      assert.equal(old.status, "reattach");
      const prepared = await prepareAttachments(restored.state.messages, signal(), false, project);
      assert.match(prepared.get(old.id).text, /reattach/);
      assert.ok(!prepared.get(old.id).text.includes("EXERCISE_ORIGINAL_MATERIAL"));
      await unlink(join(project, "note.txt"));
      const missing = await readSession(writer.id, sessions);
      assert.equal(missing.state.messages[0].attachments[0].status, "missing");
      await writeFile(join(project, "note.txt"), source);
      assert.equal((await state.command("/attach note.txt", signal())).ok, true);
      const fresh = state.take()[0];
      assert.equal(fresh.status, "ready"); assert.notEqual(fresh.id, old.id);
      assert.equal(old.status, "reattach", "新引用不改写恢复后的旧消息");
      assert.match((await prepareAttachments([{ role: "user", content: "重新提交", attachments: [fresh] }], signal(), false, project)).get(fresh.id).text, /EXERCISE_ORIGINAL_MATERIAL/);
      console.log("通过三：磁盘只存引用；恢复不重发旧正文，缺失可继续恢复，新登记产生新引用。");
    }
  } finally { process.chdir(previousCwd); await rm(directory, { recursive: true, force: true }); }
}
await main();
```

</details>

## 构建与运行

完成 24.1 时先编译 24.1，再运行组号 `1`；完成 24.2 时编译 24.2，再运行 `2`。学完 24.3 后按下面步骤运行全部三组。先从仓库根构建本章最终快照：

```bash
npm run lesson:24.3
```

再单独编译练习。临时目录中的 package.json 让 Node 按 ES module 解释编译结果；`HMA_REPO` 使脚本能找到刚构建的本章 dist。

```bash
export HMA_REPO="$PWD"
ATTACHMENT_EXERCISE="$(mktemp -d)"
printf '%s\n' '{"private":true,"type":"module"}' > "$ATTACHMENT_EXERCISE/package.json"
"$HMA_REPO/node_modules/.bin/tsc" chapter-24-attachments/examples/verify-attachments.ts \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
  --outDir "$ATTACHMENT_EXERCISE"
```

最后运行，编译命令本身不会触发断言：

```bash
node "$ATTACHMENT_EXERCISE/verify-attachments.js" all
```

将最后的 `all` 换成 `1`、`2` 或 `3`，可以只检查一组。输出对应的“通过”才表示断言成立；程序抛错时先核对当前构建的小节，不要把输出改为固定成功文字。临时编译目录可在查看结果后自行删除。

本章状态：待用户确认。
