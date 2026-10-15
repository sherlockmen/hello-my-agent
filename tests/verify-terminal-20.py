# -*- coding: utf-8 -*-
"""第20章真实PTY：钩子阻止/反馈接回模型、取消等待close、Plan隔离、草稿与退出恢复。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, time, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=ROOT/'chapter-20-hooks'
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent20-pty-build-')).resolve()
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
spec=importlib.util.spec_from_file_location('terminal13',ROOT/'tests/verify-terminal-13.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Terminal(mod.Terminal):
 def __init__(self,command,cwd,home,rows,columns):
  self.master,self.slave=pty.openpty();self.before=termios.tcgetattr(self.slave);self.output=b''
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
  try:self.process=subprocess.Popen(command,cwd=cwd,stdin=self.slave,stdout=self.slave,stderr=self.slave,env={'PATH':os.environ['PATH'],'HOME':str(home),'TERM':'xterm-256color','NO_COLOR':'1'})
  except BaseException:os.close(self.master);os.close(self.slave);raise
class Screen:
 def __init__(self,rows,cols):self.rows=rows;self.cols=cols;self.x=0;self.y=0;self.grid=[[' ']*cols for _ in range(rows)]
 def feed(self,raw):
  text=raw.decode(errors='replace');i=0
  while i<len(text):
   c=text[i]
   if c=='\x1b':
    m=re.match(r'\x1b\[([0-?]*)([ -/]*)([@-~])',text[i:])
    if m:
     p,_,end=m.groups();i+=len(m.group());n=[int(v or 0) for v in p.lstrip('?').split(';')];a=n[0] or 1
     if end=='A':self.y=max(0,self.y-a)
     elif end=='B':self.y=min(self.rows-1,self.y+a)
     elif end=='C':self.x=min(self.cols-1,self.x+a)
     elif end=='D':self.x=max(0,self.x-a)
     elif end=='G':self.x=min(self.cols-1,a-1)
     elif end in ['H','f']:self.y=min(self.rows-1,a-1);self.x=min(self.cols-1,(n[1] or 1)-1 if len(n)>1 else 0)
     elif end=='J':
      if n[0] in [2,3]:self.grid=[[' ']*self.cols for _ in range(self.rows)]
      elif n[0]==0:
       self.grid[self.y][min(self.x,self.cols):]=[' ']*max(0,self.cols-self.x)
       for y in range(self.y+1,self.rows):self.grid[y]=[' ']*self.cols
     elif end=='K':
      if n[0]==2:self.grid[self.y]=[' ']*self.cols
      elif n[0]==0:self.grid[self.y][min(self.x,self.cols):]=[' ']*max(0,self.cols-self.x)
     elif end=='h' and p=='?1049':self.grid=[[' ']*self.cols for _ in range(self.rows)];self.x=self.y=0
     continue
    if text[i:i+2]=='\x1b]':
     end=text.find('\x07',i+2);i=len(text) if end<0 else end+1;continue
    i+=2;continue
   i+=1
   if c=='\r':self.x=0;continue
   if c=='\n':self.y+=1
   elif ord(c)<32:continue
   else:
    if unicodedata.combining(c):continue
    w=2 if unicodedata.east_asian_width(c) in ['W','F'] else 1
    if self.x+w>self.cols:self.x=0;self.y+=1
    if self.y>=self.rows:self.grid.pop(0);self.grid.append([' ']*self.cols);self.y=self.rows-1
    self.grid[self.y][self.x]=c
    if w==2:self.grid[self.y][self.x+1]=''
    self.x+=w;continue
   if self.y>=self.rows:self.grid.pop(0);self.grid.append([' ']*self.cols);self.y=self.rows-1
 def lines(self):return [''.join(line).rstrip() for line in self.grid]

HOOK=r'''import {appendFileSync,writeFileSync} from 'node:fs';
let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw);
appendFileSync('events.jsonl',JSON.stringify(input)+'\n');
if(input.event==='before_tool'&&input.call.id==='cancel'){
 process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync('closed','yes');process.exit(0);},100));
 writeFileSync('hook-pid',String(process.pid));writeFileSync('ready','yes');setInterval(()=>{},1000);
}else console.log(JSON.stringify(input.event==='before_tool'?{continue:input.call.id!=='block',message:'BEFORE_BLOCK'}:input.event==='after_tool'?{message:'AFTER_FEEDBACK'}:{message:'STOP_FEEDBACK'}));
'''
HARNESS=r'''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {startTui} from 'DIST/ui/tui/app.js';
import {createModel} from 'DIST/models/client.js';
import {loadProjectInstructions} from 'DIST/project/instructions.js';
import {loadHooks} from 'DIST/hooks/lifecycle.js';
const project=await loadProjectInstructions(),hooks=await loadHooks(project.root,true);
const adapter=createModel({provider:'openai',apiKey:'fixture-only',model:'fixture',baseURL:'http://127.0.0.1:1'},project,undefined,undefined,hooks);
const calls={BLOCK:0,AFTER:0,CANCEL:0,PLAN:0};
const answer=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:10,outputTokens:4,truncated:false});
const call=id=>answer('',[{id,name:'read_file',arguments:JSON.stringify({path:'notes.txt',offset:1,limit:1})}]);
const events=()=>existsSync('events.jsonl')?readFileSync('events.jsonl','utf8').trim().split('\n').map(JSON.parse):[];
await startTui({...adapter,async generate(messages,signal,onText,options){
 signal.throwIfAborted();const task=messages.filter(m=>m.role==='user').at(-1).content;assert.ok(task in calls,task);calls[task]++;
 assert.equal(options.mode,task==='PLAN'?'plan':'execute');
 if(calls[task]===1){if(task==='PLAN'){assert.ok(existsSync('closed'));assert.equal(events().filter(e=>e.event==='stop').length,2);}return call(task==='BLOCK'?'block':task==='CANCEL'?'cancel':task.toLowerCase());}
 assert.equal(calls[task],2);assert.notEqual(task,'CANCEL','取消后不得继续模型');const result=messages.at(-1);
 assert.equal(result.toolCallId,task.toLowerCase());
 if(task==='BLOCK'){assert.equal(result.isError,true);assert.match(result.content,/BEFORE_BLOCK/);}
 else{assert.equal(result.isError,false);assert.match(result.content,/REAL_TOOL_BODY/);if(task==='AFTER')assert.match(result.content,/AFTER_FEEDBACK/);else assert.doesNotMatch(result.content,/FEEDBACK/);}
 onText?.(task+'_COMPLETE');return answer(task+'_COMPLETE');
}},'execute');
assert.deepEqual(calls,{BLOCK:2,AFTER:2,CANCEL:1,PLAN:2});const log=events();
assert.deepEqual(log.map(e=>e.event),['before_tool','stop','before_tool','after_tool','stop','before_tool']);
assert.equal(log[3].call.id,'after');assert.match(log[3].result,/REAL_TOOL_BODY/);assert.equal(log[3].outcome,'success');
assert.equal(log.filter(e=>e.event==='stop').length,2);assert.ok(existsSync('closed'));assert.throws(()=>process.kill(Number(readFileSync('hook-pid')),0),e=>e.code==='ESRCH');
writeFileSync('report.json',JSON.stringify({calls,events:log.length,cleaned:true}));
'''
def wait_file(terminal,path):
 end=time.monotonic()+6
 while not path.exists() and time.monotonic()<end:
  assert terminal.process.poll() is None,terminal.output[-5000:]
  terminal.read()
 assert path.exists(),f'未收到进程握手：{path}'

src=SOURCE/'03-stop-hooks/src';dist=BUILD/'dist';config=BUILD/'tsconfig.json'
config.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(src),'outDir':str(dist),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(src/'**/*.ts'),str(src/'**/*.tsx')]}))
subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(config)],check=True,timeout=60)
for rows,cols in [(16,40),(40,110)]:
 with tempfile.TemporaryDirectory(prefix='hello-agent20-pty-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'.hello-my-agent').mkdir();(work/'package.json').write_text('{"name":"hooks-fixture","type":"module"}')
  (work/'notes.txt').write_text('REAL_TOOL_BODY');(work/'hook.mjs').write_text(HOOK)
  command={'command':shutil.which('node'),'args':[str(work/'hook.mjs')]}
  (work/'.hello-my-agent/hooks.json').write_text(json.dumps({name:[command] for name in ['before_tool','after_tool','stop']}))
  (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()))
  terminal=Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   for task in ['BLOCK','AFTER']:
    start=terminal.send(task);terminal.until('状态：已完成',start=start);terminal.read(.2)
    # 16行窗口的历史区只有2行；进入历史向上浏览，验证收尾正文可读。
    terminal.key(b'\x0f')
    for _ in range(6):terminal.key(b'\x1b[A')
    terminal.until('STOP_FEEDBACK',start=start);terminal.key(b'\x1b[F');terminal.key(b'\x0f');terminal.key(b'\x0f')
   start=terminal.send('CANCEL');wait_file(terminal,work/'ready');terminal.key(b'KEEP_DRAFT');terminal.key(b'\x03');terminal.until('状态：已取消本轮',start=start)
   assert (work/'closed').exists(),'UI取消完成前钩子必须close'
   try:os.kill(int((work/'hook-pid').read_text()),0);raise AssertionError('钩子进程未退出')
   except ProcessLookupError:pass
   terminal.read(.2);screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'),('header',rows,cols,joined)
   assert '本地估算' in joined and 'KEEP_DRAFT' in joined,('budget/draft',rows,cols,joined)
   assert lines[-1].startswith('Enter ') or '草稿已保留' in lines[-1],('footer',rows,cols,joined)
   terminal.key(b'\x15');terminal.send('/mode plan');terminal.until('当前模式：plan')
   start=terminal.send('PLAN');terminal.until('状态：已完成',start=start);terminal.read(.2)
   terminal.send('/exit');terminal.finish()
   report=json.loads((work/'report.json').read_text());assert report['cleaned'] and report['events']==6
   print(f'✓ 20.3 PTY {rows}×{cols}: before block/after result → next model, cancel waits close, Plan, draft/budget/footer, terminal restored')
  finally:terminal.close()
