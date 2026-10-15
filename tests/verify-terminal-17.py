# -*- coding: utf-8 -*-
"""第 17 章真实 PTY：来源可读、子目录根读取、说明不扩权、不挤掉草稿与底栏。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent17-pty-build-'))
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
SRC=ROOT/'chapter-17-project-instructions/03-inspect-loading/src'; DIST=BUILD/'dist'; CONFIG=BUILD/'tsconfig.json'
CONFIG.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(SRC),'outDir':str(DIST),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(SRC/'**/*.ts'),str(SRC/'**/*.tsx')]}))
subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(CONFIG)],check=True,timeout=60)
spec=importlib.util.spec_from_file_location('terminal13',ROOT/'tests/verify-terminal-13.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Terminal(mod.Terminal):
 def __init__(self,command,cwd,home,rows,columns):
  self.master,self.slave=pty.openpty();self.before=termios.tcgetattr(self.slave);self.output=b''
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
  self.process=subprocess.Popen(command,cwd=cwd,stdin=self.slave,stdout=self.slave,stderr=self.slave,env={'PATH':os.environ['PATH'],'HOME':str(home),'TERM':'xterm-256color','NO_COLOR':'1'})
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
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {startTui} from 'DIST/ui/tui/app.js';
import {createModel} from 'DIST/models/client.js';
import {loadProjectInstructions} from 'DIST/project/instructions.js';
const cwd=await realpath(process.cwd()), project=await loadProjectInstructions();
assert.equal(project.sources.length,3);
const adapter=createModel({provider:'openai',apiKey:'fixture-only',model:'fixture',baseURL:'http://127.0.0.1:1'},project);
let calls=0;
await startTui({...adapter,async generate(messages,signal,onText){
 signal.throwIfAborted();calls++;
 if(calls===1)return {text:'',toolCalls:[{id:'root-read',name:'read_file',arguments:JSON.stringify({path:'package.json',offset:1,limit:20})}],finishReason:'tool_calls',inputTokens:null,outputTokens:null,truncated:false};
 assert.match(messages.find(message=>message.role==='tool').content,/PROJECT_ROOT_PACKAGE/);
 onText?.('PROJECT_RULES_COMPLETE');
 return {text:'PROJECT_RULES_COMPLETE',toolCalls:[],finishReason:'stop',inputTokens:null,outputTokens:4,truncated:false};
}});
assert.equal(await realpath(process.cwd()),cwd);
writeFileSync('report.json',JSON.stringify({calls,sourcePaths:project.sources.map(source=>source.path)}));
'''.replace('DIST',DIST.as_posix())
with tempfile.TemporaryDirectory(prefix='hello-agent17-pty-') as temporary:
 work=pathlib.Path(temporary); start=work/'src/api'; start.mkdir(parents=True)
 (work/'package.json').write_text('{"name":"PROJECT_ROOT_PACKAGE","type":"module"}')
 for directory in [work,work/'src',start]: (directory/'AGENTS.md').write_text('SECRET_BODY_MUST_NOT_BE_PRINTED; use TypeScript.')
 (work/'harness.mjs').write_text(HARNESS)
 for rows,cols in [(16,40),(40,110)]:
  terminal=Terminal(['node',str(work/'harness.mjs')],start,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   if rows==40:
    terminal.until('SHA256');text=mod.ANSI.sub('',terminal.output.decode(errors='replace'))
    assert 'src/api/AGENTS.md' in text and '本地加载 3 份' in text,text
   terminal.send('PROJECT_RULES_CHECK');terminal.until('状态：已完成');terminal.read(.2)
   terminal.key(b'KEEP_DRAFT');terminal.read(.2)
   screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'),(rows,cols,'header',joined)
   assert '本地估算' in joined and 'KEEP_DRAFT' in joined,(rows,cols,'draft/budget',joined)
   assert lines[-1].startswith('Enter '),(rows,cols,'footer',joined)
   assert 'SECRET_BODY_MUST_NOT_BE_PRINTED' not in mod.ANSI.sub('',terminal.output.decode(errors='replace'))
   terminal.key(b'\x15');terminal.send('/exit');terminal.finish()
   report=json.loads((start/'report.json').read_text());assert report['calls']==2
   assert report['sourcePaths']==['AGENTS.md','src/AGENTS.md','src/api/AGENTS.md']
   print(f'✓ 17.3 PTY {rows}×{cols}: local sources, root tool read, draft/budget/footer, clean terminal exit')
  finally:terminal.close()
