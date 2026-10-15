# -*- coding: utf-8 -*-
"""第 15 章真实 PTY：预算行不挤掉草稿/底栏，含最小窗口与队列焦点。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent15-pty-build-'))
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
SRC=ROOT/'chapter-15-context-budget/03-enforce-budget/src'
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
HARNESS='''
import {startTui} from 'DIST/ui/tui/app.js';
const initial={messages: Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'LONG_HISTORY_'+i+' x'.repeat(100)})),mode:'execute',tasks:[{id:'one',text:'TASK_ONE',status:'in_progress'},{id:'two',text:'TASK_TWO',status:'pending'},{id:'three',text:'TASK_THREE',status:'pending'}],pendingInputs:[],run:1,nextInputId:1};
const budget={inputEstimate:1000,systemEstimate:200,toolsEstimate:300,messagesEstimate:500,windowTokens:32768,outputReserve:2048,remainingEstimate:29720,withinBudget:true};
await startTui({inspectContext(){return budget;}, async generate(messages,signal,onText){signal.throwIfAborted();onText?.('LAYOUT_COMPLETE');return {text:'LAYOUT_COMPLETE',toolCalls:[],finishReason:'stop',inputTokens:null,outputTokens:4,truncated:false};}},'execute',undefined,initial);
'''.replace('DIST',DIST.as_posix())
with tempfile.TemporaryDirectory(prefix='hello-agent15-pty-') as temporary:
 work=pathlib.Path(temporary);(work/'package.json').write_text('{"type":"module"}');(work/'harness.mjs').write_text(HARNESS)
 for rows,cols in [(16,40),(17,40),(20,80),(40,110)]:
  terminal=Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   terminal.send('LAYOUT_CHECK');terminal.until('状态：已完成');terminal.read(.25)
   terminal.key(b'KEEP_DRAFT');terminal.read(.2)
   screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'), (rows,cols,'title scrolled',joined)
   assert '本地估算' in joined,(rows,cols,'budget missing',joined)
   assert '草稿' in joined and 'KEEP_DRAFT' in joined,(rows,cols,'draft missing',joined)
   assert lines[-1].startswith('Enter '),(rows,cols,'footer missing',joined)
   if rows==16:assert '任务：' not in joined,(rows,cols,joined)
   else:assert '任务：' in joined,(rows,cols,joined)
   terminal.key(b'\x0f');terminal.key(b'\x0f');terminal.until('待发送队列');terminal.read(.2)
   queue=Screen(rows,cols);queue.feed(terminal.output);queue_lines=queue.lines();queue_text='\n'.join(queue_lines)
   assert queue_lines[0].startswith('Hello, My Agent') and '待发送队列' in queue_text,(rows,cols,'queue overflow',queue_text)
   assert '本地估算' in queue_text and 'KEEP_DRAFT' in queue_text and queue_lines[-1].startswith('Enter '),(rows,cols,queue_text)
   terminal.key(b'\x0f');terminal.key(b'\x15');terminal.send('/exit');terminal.finish()
   print(f'✓ 15.3 PTY {rows}×{cols}: header, budget, draft and footer remain in viewport; clean exit')
  finally:terminal.close()
