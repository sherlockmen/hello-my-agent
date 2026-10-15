# -*- coding: utf-8 -*-
"""第 16 章真实 PTY：摘要期间可取消，完成后预算、草稿和底栏仍可见。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent16-pty-build-'))
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
SRC=ROOT/'chapter-16-context-compaction/03-compact-and-continue/src'
DIST=BUILD/'dist'
CONFIG=BUILD/'tsconfig.json'
CONFIG.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(SRC),'outDir':str(DIST),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(SRC/'**/*.ts'),str(SRC/'**/*.tsx')]}))
subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(CONFIG)],check=True,timeout=60)
spec=importlib.util.spec_from_file_location('terminal13',ROOT/'tests/verify-terminal-13.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Terminal(mod.Terminal):
 def __init__(self,command,cwd,home,rows,columns):
  self.master,self.slave=pty.openpty();self.before=termios.tcgetattr(self.slave);self.output=b''
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
  self.process=subprocess.Popen(command,cwd=cwd,stdin=self.slave,stdout=self.slave,stderr=self.slave,env={'PATH':os.environ['PATH'],'HOME':str(home),'TERM':'xterm-256color','NO_COLOR':'1'})
# A small VT viewport for the cursor/erase/SGR sequences emitted by Ink. It records actual
# PTY bytes, allowing an extra rendered row to be detected when the title scrolls away.
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
HARNESS=r'''
import {startTui} from 'DIST/ui/tui/app.js';
import {appendFile} from 'node:fs/promises';
const initial={messages:[...Array.from({length:6},(_,i)=>({role:'assistant',content:'OLD_'+i+'x'.repeat(1000)})),...Array.from({length:4},(_,i)=>({role:i%2?'assistant':'user',content:'RECENT_'+i}))],context:{summary:'',through:0},mode:'execute',tasks:[],pendingInputs:[],run:1,nextInputId:1};
const budget=(n)=>({inputEstimate:n,systemEstimate:20,toolsEstimate:20,messagesEstimate:n-40,windowTokens:1050,outputReserve:50,remainingEstimate:1000-n,withinBudget:n<=1000});
let summaries=0;
await startTui({inspectContext(messages){return budget(JSON.stringify(messages).length+100);},inspectSummary(){return budget(100);},async summarize(source,signal){summaries++;await appendFile('events.jsonl',JSON.stringify({event:'summary',attempt:summaries})+'\n');await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,process.argv[2]==='cancel'&&summaries===1?5000:350);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});return {text:'旧记录摘要，测试仍待执行',toolCalls:[],finishReason:'stop',inputTokens:10,outputTokens:3,truncated:false};},async generate(messages,signal,onText){signal.throwIfAborted();await appendFile('events.jsonl',JSON.stringify({event:'generate',input:messages.filter(m=>m.role==='user').at(-1)?.content})+'\n');onText?.('LAYOUT_COMPLETE');return {text:'LAYOUT_COMPLETE',toolCalls:[],finishReason:'stop',inputTokens:4,outputTokens:2,truncated:false};}},'execute',undefined,initial);
'''.replace('DIST',DIST.as_posix())
with tempfile.TemporaryDirectory(prefix='hello-agent16-pty-') as temporary:
 work=pathlib.Path(temporary);(work/'package.json').write_text('{"type":"module"}');(work/'harness.mjs').write_text(HARNESS)
 for rows,cols in [(16,40),(17,40),(20,80),(40,110)]:
  terminal=Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2);terminal.send('LAYOUT_CHECK');terminal.until('正在压缩旧记录');terminal.until('状态：已完成');terminal.read(.25)
   terminal.key(b'KEEP_DRAFT');terminal.read(.2);screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'),(rows,cols,joined)
   assert '本地估算' in joined and '草稿' in joined and 'KEEP_DRAFT' in joined,(rows,cols,joined)
   assert lines[-1].startswith('Enter '),(rows,cols,joined)
   terminal.key(b'\x15');terminal.send('/exit');terminal.finish()
   print(f'✓ 16.3 PTY {rows}×{cols}: compaction, budget, draft/footer and clean exit')
  finally:terminal.close()
 (work/'events.jsonl').write_text('')
 terminal=Terminal(['node',str(work/'harness.mjs'),'cancel'],work,work,40,110)
 try:
  terminal.until('Hello, My Agent');terminal.send('OLD_TASK');terminal.until('正在压缩旧记录');terminal.key(b'NEW_TASK');terminal.key(b'\x13');terminal.until('状态：已完成');terminal.read(.2)
  events=[json.loads(line) for line in (work/'events.jsonl').read_text().splitlines()]
  assert len([e for e in events if e['event']=='summary'])==2,events
  assert [e['input'] for e in events if e['event']=='generate']==['NEW_TASK'],events
  terminal.send('/exit');terminal.finish();print('✓ 16.3 PTY Ctrl+S during summary cancels old request, waits cleanup, then only generates new task')
 finally:terminal.close()
