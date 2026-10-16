/** Attachment identity, byte validation, actual dual SDK payloads and explicit resume. */
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { build, sdkServer, signal, workspace } from './runtime-fixtures.mjs';

const temporary = workspace('24'), previousCwd = process.cwd();
const service = await sdkServer();
// A real 1×1 RGB PNG; no image decoder or remote model is used by this fixture.
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082','hex');
try {
  const project = join(temporary.directory, 'project');
  temporary.file('project/package.json', '{"type":"module"}');
  const note = temporary.file('project/note.txt', 'ATTACHMENT_ACTUAL_TEXT\n');
  temporary.file('project/pixel.png', png);
  temporary.file('project/.env', 'PRIVATE_MUST_NOT_BE_READ');
  temporary.file('project/large.txt', 'x'.repeat(64 * 1024 + 1));
  temporary.file('project/binary.dat', Buffer.from([0xff, 0xfe, 0]));
  const outside = temporary.file('outside.txt', 'OUTSIDE_MUST_NOT_BE_READ');
  symlinkSync(outside, join(project, 'escape.txt'));
  process.chdir(project);
  for (const lesson of ['01-attachment-references', '02-image-protocol', '03-attachment-resume']) {
    const { load } = build('chapter-24-attachments', lesson, temporary);
    const { createAttachmentState, prepareAttachments, validateAttachmentRefs, restoreAttachmentStatuses } = await load('attachments/store.js');
    const { createModel } = await load('models/client.js');
    const { agentLoop } = await load('agent/agent-loop.js');
    const state = createAttachmentState(project);
    for (const path of ['../outside.txt', 'escape.txt', '.env', 'large.txt', 'binary.dat']) {
      assert.equal((await state.command(`/attach ${path}`, signal())).ok, false, path);
      assert.equal(state.pending.length, 0);
    }
    assert.equal((await state.command('/attach note.txt', signal())).ok, true);
    assert.equal((await state.command('/attach note.txt', signal())).ok, true);
    assert.equal(state.pending.length, 1);
    const ref = { ...state.pending[0] };
    assert.equal((await state.command('/detach bad', signal())).ok, false);
    assert.equal(state.pending.length, 1);
    assert.throws(() => validateAttachmentRefs([{ ...ref, data: 'MUST_NOT_PERSIST' }]), /字段/);
    assert.throws(() => validateAttachmentRefs([{ ...ref, path: '../outside.txt' }]), /相对路径/);
    const cancelled = new AbortController(); cancelled.abort(new Error('CANCEL_ATTACHMENT'));
    await assert.rejects(state.command('/attach note.txt', cancelled.signal), /CANCEL_ATTACHMENT/);
    assert.equal(state.pending.length, 1);
    const refs = state.take(); assert.equal(state.pending.length, 0);
    assert.match((await prepareAttachments([{ role: 'user', content: 'inspect', attachments: refs }], signal(), false, project)).get(ref.id).text, /ATTACHMENT_ACTUAL_TEXT/);

    for (const provider of ['openai', 'anthropic']) {
      const model = createModel({ provider, model: 'fixture', apiKey: 'fixture', baseURL: service.url });
      assert.equal((await model.attachments.command('/attach note.txt', signal())).ok, true);
      const history = [];
      await agentLoop(model, history, '请检查附件', signal());
      assert.equal(history[0].attachments.length, 1);
      assert.doesNotMatch(JSON.stringify(history[0].attachments), /ATTACHMENT_ACTUAL_TEXT|base64|\/private\/|\/var\//);
      assert.match(JSON.stringify(service.requests.at(-1).body), /ATTACHMENT_ACTUAL_TEXT/);
      const count = service.requests.length;
      writeFileSync(note, 'CHANGED_TEXT\n');
      await assert.rejects(model.generate(history, signal()), /变化/);
      assert.equal(service.requests.length, count);
      writeFileSync(note, 'ATTACHMENT_ACTUAL_TEXT\n');

      const raceModel = createModel({ provider, model: 'fixture', apiKey: 'fixture', baseURL: service.url });
      await raceModel.attachments.command('/attach note.txt', signal());
      const rejectedHistory = [];
      writeFileSync(note, 'CHANGED_BEFORE_COMMIT\n');
      await assert.rejects(agentLoop(raceModel, rejectedHistory, 'not committed', signal()), /变化/);
      assert.equal(rejectedHistory.length, 0);
      assert.equal(raceModel.attachments.pending.length, 1);
      writeFileSync(note, 'ATTACHMENT_ACTUAL_TEXT\n');
      const generate = raceModel.generate.bind(raceModel);
      raceModel.generate = (...args) => {
        writeFileSync(note, 'CHANGED_AFTER_COMMIT\n');
        return generate(...args);
      };
      const committedHistory = [], beforeRace = service.requests.length;
      await assert.rejects(agentLoop(raceModel, committedHistory, 'already committed', signal()), /变化/);
      assert.equal(service.requests.length, beforeRace);
      assert.equal(raceModel.attachments.pending.length, 0);
      assert.equal(committedHistory[0].content, 'already committed');
      assert.equal(committedHistory[0].attachments.length, 1);
      assert.match(committedHistory.at(-1).content, /本地状态.*错误中断/);
      writeFileSync(note, 'ATTACHMENT_ACTUAL_TEXT\n');

      if (lesson !== '01-attachment-references') {
        const imageModel = createModel({ provider, model: 'vision', apiKey: 'fixture', baseURL: service.url, imageInput: true });
        assert.equal((await imageModel.attachments.command('/attach pixel.png', signal())).ok, true);
        const imageHistory = [];
        await agentLoop(imageModel, imageHistory, '检查图片', signal());
        const content = service.requests.at(-1).body.messages.at(-1).content;
        const block = content.find(item => item.type === (provider === 'openai' ? 'image_url' : 'image'));
        assert.ok(block, JSON.stringify(content));
        assert.equal(provider === 'openai' ? block.image_url.url : block.source.data,
          provider === 'openai' ? `data:image/png;base64,${png.toString('base64')}` : png.toString('base64'));
        const count = service.requests.length;
        await assert.rejects(model.generate(imageHistory, signal()), /图片能力/);
        assert.equal(service.requests.length, count);
        temporary.file('project/disguised.png', 'plain text');
        assert.equal((await imageModel.attachments.command('/attach disguised.png', signal())).ok, false);
      }
    }
    if (lesson === '01-attachment-references') assert.equal((await state.command('/attach pixel.png', signal())).ok, false);
    if (lesson === '03-attachment-resume') {
      const messages = [{ role: 'user', content: 'saved', attachments: [{ ...ref }] }];
      assert.equal(await restoreAttachmentStatuses(messages, project), 1);
      assert.equal(messages[0].attachments[0].status, 'reattach');
      const prepared = await prepareAttachments(messages, signal(), false, project);
      assert.doesNotMatch(prepared.get(ref.id).text, /ATTACHMENT_ACTUAL_TEXT/);
      unlinkSync(note);
      await restoreAttachmentStatuses(messages, project);
      assert.equal(messages[0].attachments[0].status, 'missing');
      writeFileSync(note, 'ATTACHMENT_ACTUAL_TEXT\n');
      assert.equal((await state.command('/attach note.txt', signal())).ok, true);
      assert.equal(state.pending[0].status, 'ready');
      const { createSessionWriter } = await load('sessions/save-session.js');
      const { readSession } = await load('sessions/read-session.js');
      const directory = join(temporary.directory, 'sessions');
      const writer = await createSessionWriter(directory);
      const sessionId = writer.id;
      try { await writer.save({ messages, mode: 'execute', tasks: [], pendingInputs: [], run: 1, nextInputId: 1 }, 'run_end'); }
      finally { await writer.close(); }
      const restored = await readSession(sessionId, directory);
      assert.deepEqual(restored.state.messages, [{ ...messages[0], attachments: [{ ...ref, status: 'reattach' }] }]);
      assert.doesNotMatch(JSON.stringify(restored.state), /ATTACHMENT_ACTUAL_TEXT|base64/);
    }
    console.log(`✓ 24 ${lesson}: bounded paths/bytes/hash, actual dual SDK payloads, unsupported/changed rejection${lesson.endsWith('resume') ? ', reference-only persistence and explicit reattach' : ''}`);
  }
} finally {
  process.chdir(previousCwd);
  await service.close(); temporary.close();
}
