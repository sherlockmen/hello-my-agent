"""Chapter 23: local model commands, real SDK request, busy draft and cancellation in PTY."""
import importlib.util, json, pathlib, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixtures',ROOT/'tests/terminal-fixtures.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
dist=f.compile_snapshot('chapter-23-model-adapters','03-capabilities-errors')
HARNESS=r'''
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
import {startTui} from 'DIST/ui/tui/app.js';import {createModel} from 'DIST/models/client.js';
import {sdkServer,sendReply,reply} from 'FIXTURES';
const service=await sdkServer((entry,response)=>{
 const last=entry.body.messages.filter(m=>m.role==='user').at(-1).content;
 if(last==='HOLD'){response.on('close',()=>writeFileSync('closed','yes'));response.writeHead(200,{'content-type':'text/event-stream'});response.write(': wait\n\n');writeFileSync('ready','yes');return;}
 assert.equal(last,'DONE');sendReply(entry,response,reply('SWITCH_REQUEST_COMPLETE'));
});
for(const provider of ['OPENAI','ANTHROPIC']){process.env[provider+'_API_KEY']=provider+'-fixture';process.env[provider+'_BASE_URL']=service.url;process.env[provider+'_MODEL']='fixture';}
const model=createModel({provider:'openai',apiKey:'initial-fixture',model:'initial',baseURL:service.url});
try{await startTui(model,'execute');}finally{await service.close();}
assert.equal(service.requests.length,3);
assert.equal(service.requests[0].body.model,'fixture-a');assert.equal(service.requests[0].headers['x-api-key'],'ANTHROPIC-fixture');assert.equal(service.requests[0].headers.authorization,undefined);
assert.equal(service.requests[1].body.model,'fixture-a');
assert.equal(service.requests[2].body.model,'fixture-b');assert.equal(service.requests[2].headers.authorization,'Bearer OPENAI-fixture');assert.equal(service.requests[2].headers['x-api-key'],undefined);
writeFileSync('report.json',JSON.stringify({cleaned:true,requests:service.requests.length}));
'''
def wait_file(terminal,path):
 end=time.monotonic()+8
 while not path.exists() and time.monotonic()<end:
  assert terminal.process.poll() is None,terminal.output[-4000:];terminal.read()
 assert path.exists(),str(path)
for rows,cols in [(16,40),(40,110)]:
 with tempfile.TemporaryDirectory(prefix='hello-agent23-pty-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"type":"module"}')
  (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('FIXTURES',(ROOT/'tests/runtime-fixtures.mjs').as_posix()))
  terminal=f.Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   terminal.send('/model wrong missing');terminal.read(.2)
   screen=f.Screen(rows,cols);screen.feed(terminal.output);assert '/model wrong missing' in '\n'.join(screen.lines())
   terminal.key(b'\x15');terminal.send('/model anthropic fixture-a');terminal.read(.2)
   start=terminal.send('DONE');terminal.until('状态：已完成',start=start)
   start=terminal.send('HOLD');wait_file(terminal,work/'ready')
   terminal.send('/model openai blocked');terminal.until('草稿已保留',start=start)
   terminal.key(b'\x03');terminal.until('状态：已取消本轮',start=start);wait_file(terminal,work/'closed');terminal.read(.2)
   screen=f.Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'),joined
   assert '/model openai blocked' in joined and '本地估算' in joined,joined
   terminal.key(b'\x15');terminal.send('/model openai fixture-b');terminal.read(.2)
   start=terminal.send('DONE');terminal.until('状态：已完成',start=start)
   terminal.send('/exit');terminal.finish();assert json.loads((work/'report.json').read_text())['cleaned']
   print(f'✓ 23.3 PTY {rows}×{cols}: invalid/busy draft preserved, real provider credentials, cancel cleanup, future switch, terminal restored')
  finally:terminal.close()
