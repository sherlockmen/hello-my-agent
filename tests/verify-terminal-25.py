"""Actual PTY: parent cancellation waits for child cleanup, then a fresh task can run."""
import importlib.util,json,pathlib,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixtures',ROOT/'tests/terminal-fixtures.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
dist=f.compile_snapshot('chapter-25-subagents','03-child-observation')
HARNESS=r'''
import assert from 'node:assert/strict';import {writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';import {homedir} from 'node:os';
import {startTui} from 'DIST/ui/tui/app.js';import {createModel} from 'DIST/models/client.js';
import {createSessionWriter} from 'DIST/sessions/save-session.js';import {readSession} from 'DIST/sessions/read-session.js';
import {sdkServer,sendReply,reply} from 'FIXTURES';
const directory=join(homedir(),'.hello-my-agent','sessions');
const service=await sdkServer((entry,response)=>{
 const names=entry.body.tools.map(tool=>tool.function?.name??tool.name);
 if(!names.includes('delegate_task')){response.on('close',()=>writeFileSync('child-closed','yes'));response.writeHead(200,{'content-type':'text/event-stream'});response.write(': child waits\n\n');writeFileSync('child-ready','yes');return;}
 const content=entry.body.messages.filter(m=>m.role==='user').at(-1).content;
 const last=typeof content==='string'?content:content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
 if(last==='HOLD_CHILD')sendReply(entry,response,reply('',[{id:'delegate-pty',name:'delegate_task',arguments:'{"role":"review","task":"Wait for cancellation"}'}]));
 else{assert.equal(last,'NEXT_TASK');assert.match(JSON.stringify(entry.body),/cancelled/);sendReply(entry,response,reply('FRESH_TASK_COMPLETE'));}
});
const writer=await createSessionWriter(directory),parentId=writer.id;
const model=createModel({provider:'openai',model:'fixture',apiKey:'fixture',baseURL:service.url});
try{await startTui(model,'execute',writer);}finally{await service.close();}
assert.equal(service.requests.length,3);const parent=await readSession(parentId,directory);
const tool=parent.state.messages.find(m=>m.role==='tool'&&m.toolCallId==='delegate-pty');assert.ok(tool);const child=JSON.parse(tool.content);
assert.equal(child.status,'cancelled');assert.equal(child.parentSessionId,parentId);assert.equal(child.usage.inputTokens,null);
const saved=await readSession(child.sessionId,directory);assert.equal(saved.interrupted,false);assert.equal(saved.header.parent.sessionId,parentId);
assert.ok(readdirSync(directory).every(name=>!name.endsWith('.lock')));assert.match(JSON.stringify(parent.state.messages),/FRESH_TASK_COMPLETE/);
writeFileSync('report.json',JSON.stringify({cleaned:true,requests:3,childStatus:child.status}));
'''
def wait_file(terminal,path):
 end=time.monotonic()+10
 while not path.exists() and time.monotonic()<end:
  assert terminal.process.poll() is None,terminal.output[-4000:];terminal.read()
 assert path.exists(),str(path)+'\n'+f.ANSI.sub('',terminal.output.decode(errors='replace'))[-6000:]
for rows,cols in [(16,40),(40,110)]:
 with tempfile.TemporaryDirectory(prefix='hello-agent25-pty-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"type":"module"}')
  (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('FIXTURES',(ROOT/'tests/runtime-fixtures.mjs').as_posix()))
  terminal=f.Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.3);start=terminal.send('HOLD_CHILD');wait_file(terminal,work/'child-ready');terminal.read(.2)
   assert '子任务' in f.ANSI.sub('',terminal.output.decode(errors='replace'))
   terminal.key(b'\x03');terminal.until('状态：已取消本轮',start=start);wait_file(terminal,work/'child-closed')
   start=terminal.send('NEXT_TASK');terminal.until('状态：已完成',start=start)
   terminal.send('/exit');terminal.finish();assert json.loads((work/'report.json').read_text())['cleaned']
   print(f'✓ 25.3 PTY {rows}×{cols}: child progress, actual HTTP cancellation, paired cancelled parent result, child JSONL closed, fresh task and terminal restored')
  finally:terminal.close()
