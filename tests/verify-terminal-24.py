"""Actual PTY: attachment commands stay local, rejected input survives, image payload is real."""
import importlib.util,json,pathlib,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixtures',ROOT/'tests/terminal-fixtures.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
dist=f.compile_snapshot('chapter-24-attachments','03-attachment-resume')
HARNESS=r'''
import assert from 'node:assert/strict';import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {startTui} from 'DIST/ui/tui/app.js';import {createModel} from 'DIST/models/client.js';
import {createSessionWriter} from 'DIST/sessions/save-session.js';import {readSession} from 'DIST/sessions/read-session.js';
import {sdkServer,sendReply,reply} from 'FIXTURES';
const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082','hex');
writeFileSync('note.txt','PTY_ATTACHMENT_TEXT');writeFileSync('pixel.png',png);
const service=await sdkServer((entry,response)=>{sendReply(entry,response,reply('ATTACHMENT_REQUEST_COMPLETE'));writeFileSync('requests.json',JSON.stringify(service.requests));});
process.env.OPENAI_API_KEY='fixture';process.env.OPENAI_BASE_URL=service.url;
const model=createModel({provider:'openai',model:'text',apiKey:'fixture',baseURL:service.url});
const writer=await createSessionWriter('sessions'),save=writer.save.bind(writer);
writer.save=async(state,reason)=>{if(reason==='run_start'&&existsSync('race-armed')){unlinkSync('race-armed');writeFileSync('note.txt','CHANGED_AFTER_UI_PREFLIGHT');}return save(state,reason);};
try{await startTui(model,'execute',writer);}finally{await service.close();await writer.close();}
assert.equal(service.requests.length,2);assert.match(JSON.stringify(service.requests[0].body),/PTY_ATTACHMENT_TEXT/);
assert.equal(service.requests[1].body.model,'vision');assert.match(JSON.stringify(service.requests[1].body),/data:image\/png;base64,/);
assert.equal(model.attachments.pending.length,1);
const restored=await readSession(writer.id,'sessions');assert(!restored.state.messages.some(m=>m.role==='user'&&m.content==='RACE_DRAFT'));
writeFileSync('report.json',JSON.stringify({cleaned:true,requests:2,raceDraftUncommitted:true}));
'''
for rows,cols in [(16,40),(40,110)]:
 with tempfile.TemporaryDirectory(prefix='hello-agent24-pty-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"type":"module"}')
  (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('FIXTURES',(ROOT/'tests/runtime-fixtures.mjs').as_posix()))
  terminal=f.Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   start=terminal.send('/attach absent.txt');terminal.until('附件操作已结束',start=start);terminal.read(.2)
   screen=f.Screen(rows,cols);screen.feed(terminal.output);assert '/attach absent.txt' in '\n'.join(screen.lines())
   terminal.key(b'\x15');start=terminal.send('/attach note.txt');terminal.until('附件操作已结束',start=start)
   start=terminal.send('CHECK_TEXT');terminal.until('状态：已完成',start=start)
   start=terminal.send('/attach pixel.png');terminal.until('附件操作已结束',start=start)
   start=terminal.send('CHECK_IMAGE');terminal.read(.5)
   screen=f.Screen(rows,cols);screen.feed(terminal.output);assert 'CHECK_IMAGE' in '\n'.join(screen.lines()),'Unsupported model must retain original input'
   assert len(json.loads((work/'requests.json').read_text()))==1,'Rejected image must not issue HTTP'
   terminal.key(b'\x15');terminal.send('/model openai vision images');terminal.read(.2)
   start=terminal.send('CHECK_IMAGE');terminal.until('状态：已完成',start=start)
   start=terminal.send('/attach note.txt');terminal.until('附件操作已结束',start=start)
   (work/'race-armed').write_text('change after UI preflight')
   start=terminal.send('RACE_DRAFT');terminal.until('状态：运行失败',start=start);terminal.read(.2)
   screen=f.Screen(rows,cols);screen.feed(terminal.output)
   visible='\n'.join(screen.lines())
   assert 'RACE_DRAFT' in visible.split('草稿')[-1],f'Precommit race must restore cleared draft:\n{visible}'
   assert len(json.loads((work/'requests.json').read_text()))==2,'Core preflight race must not issue HTTP'
   terminal.key(b'\x15');terminal.send('/exit');terminal.finish();assert json.loads((work/'report.json').read_text())['cleaned']
   print(f'✓ 24.3 PTY {rows}×{cols}: local failure and precommit race retain draft/pending, actual text/image sent after valid selection, terminal restored')
  finally:terminal.close()
