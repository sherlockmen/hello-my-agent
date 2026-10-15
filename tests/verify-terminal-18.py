# -*- coding: utf-8 -*-
"""第18章真实PTY：本地命令、来源、Plan、提议批准/拒绝/取消、跨任务快照与终端恢复。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, time, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent18-pty-build-'))
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
SRC=ROOT/'chapter-18-long-term-memory/03-manage-memory/src'; DIST=BUILD/'dist'; CONFIG=BUILD/'tsconfig.json'
CONFIG.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(SRC),'outDir':str(DIST),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(SRC/'**/*.ts'),str(SRC/'**/*.tsx')]}))
subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(CONFIG)],check=True,timeout=60)
spec=importlib.util.spec_from_file_location('terminal13',ROOT/'tests/verify-terminal-13.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Terminal(mod.Terminal):
 def __init__(self,command,cwd,home,rows,columns):
  self.master,self.slave=pty.openpty();self.before=termios.tcgetattr(self.slave);self.output=b''
  fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))
  self.process=subprocess.Popen(command,cwd=cwd,stdin=self.slave,stdout=self.slave,stderr=self.slave,env={'PATH':os.environ['PATH'],'HOME':str(home),'TERM':'xterm-256color','NO_COLOR':'1'})
 def finish_text(self):
  deadline=time.monotonic()+8
  while self.process.poll() is None and time.monotonic()<deadline:self.read()
  assert self.process.poll()==0,(self.process.poll(),self.output[-4000:]);self.read()
  mask=termios.ECHO|termios.ICANON
  assert termios.tcgetattr(self.slave)[3]&mask==self.before[3]&mask,'文本终端没有恢复'
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
HARNESS="""
import assert from 'node:assert/strict';
import {appendFile,writeFile} from 'node:fs/promises';
import {startTui} from 'DIST/ui/tui/app.js';
import {startTerminal} from 'DIST/ui/terminal.js';
import {createModel} from 'DIST/models/client.js';
import {createMemoryController} from 'DIST/memory/commands.js';
import {readMemory} from 'DIST/memory/store.js';
const memory=await createMemoryController(process.cwd());
const adapter=createModel({provider:'openai',apiKey:'fixture-only',model:'fixture',baseURL:'http://127.0.0.1:1',contextLimits:{windowTokens:32768,outputReserve:2048}},undefined,memory);
let calls=0;
const model={...adapter,async generate(messages,signal,onText,options){
 signal.throwIfAborted();calls++;
 assert(!messages.some(message=>message.role==='user'&&message.content.startsWith('/memory')),'本地命令不应进入模型历史');
 const input=messages.findLast(message=>message.role==='user').content;
 await appendFile('requests.jsonl',JSON.stringify({input,messages,prompt:memory.prompt,mode:options?.mode})+'\\n');
 if(input.startsWith('PROPOSE')&&messages.at(-1).role!=='tool')return {text:'',toolCalls:[{id:'memory-'+calls,name:'propose_memory',arguments:JSON.stringify({content:'MODEL_MEMORY_APPROVED',reason:'用户明确给出可复用测试命令'})}],finishReason:'tool_calls',inputTokens:null,outputTokens:null,truncated:false};
 onText?.('TASK_COMPLETE_'+input);
 return {text:'TASK_COMPLETE_'+input,toolCalls:[],finishReason:'stop',inputTokens:null,outputTokens:4,truncated:false};
}};
if(process.argv[2]==='text')await startTerminal(model);else await startTui(model);
await writeFile('report.json',JSON.stringify({calls,data:await readMemory(process.cwd())}));
""".replace('DIST',DIST.as_posix())

def requests(work):
 path=work/'requests.jsonl'
 return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
def data(work):return json.loads((work/'.hello-my-agent/memory.json').read_text())
def command(terminal,text,expected):
 start=terminal.send(text);terminal.until(expected,start);terminal.read(.15);return start

def exercise(work,surface,rows=40,cols=110):
 work.mkdir();(work/'package.json').write_text('{"type":"module"}');(work/'harness.mjs').write_text(HARNESS)
 terminal=Terminal(['node',str(work/'harness.mjs'),surface],work,work,rows,cols)
 try:
  terminal.until('当前模式：execute' if surface=='text' else 'Hello, My Agent')
  command(terminal,'/memory list','没有项目记忆');assert requests(work)==[]
  command(terminal,'/memory add USER_TEST_UNIT','记忆已保存');id=data(work)['entries'][0]['id']
  command(terminal,'/memory show '+id,'用户通过本地记忆命令明确保存');assert requests(work)==[]
  command(terminal,'CHECK_FIRST','TASK_COMPLETE_CHECK_FIRST');assert 'USER_TEST_UNIT' in requests(work)[-1]['prompt']
  command(terminal,'/memory invalidate '+id+' OLD_TEST_COMMAND','记忆已失效')
  command(terminal,'CHECK_INVALID','TASK_COMPLETE_CHECK_INVALID');assert 'USER_TEST_UNIT' not in requests(work)[-1]['prompt']
  command(terminal,'/memory edit '+id+' USER_CORRECTED','已纠正并恢复有效')
  command(terminal,'CHECK_EDIT','TASK_COMPLETE_CHECK_EDIT');assert 'USER_CORRECTED' in requests(work)[-1]['prompt']
  command(terminal,'/memory delete '+id,'已删除正文');assert data(work)['entries']==[]
  if surface=='text':command(terminal,'/memory show '+id,'"entry": null')
  else:
   command(terminal,'/memory show '+id,'用户通过本地命令删除正文，保留操作来源')
   start=terminal.key(b'\x0f');terminal.key(b'\x1b[5~');terminal.until('"entry": null',start)
   terminal.key(b'\x1b[F');terminal.key(b'\x0f');terminal.key(b'\x0f')
  command(terminal,'/mode plan','当前模式：plan')
  before=(work/'.hello-my-agent/memory.json').read_bytes();command(terminal,'/memory add PLAN_NOT_SAVED','Plan模式不能保存')
  assert (work/'.hello-my-agent/memory.json').read_bytes()==before
  command(terminal,'PROPOSE_PLAN','TASK_COMPLETE_PROPOSE_PLAN');assert data(work)['entries']==[]
  command(terminal,'/mode execute','当前模式：execute')
  def propose(name,choice):
   start=terminal.send(name);terminal.until('请选择：' if surface=='text' else '等待批准',start);terminal.read(.15)
   assert data(work)['entries']==[],'查看候选前已落盘'
   text=mod.ANSI.sub('',terminal.output[start:].decode(errors='replace'))
   if surface=='text':assert 'MODEL_MEMORY_APPROVED' in text and '用户逐次批准' in text,text
   else:
    # 预览必须完整查看到最后一页；长临时项目路径可能增加分页。
    for _ in range(8):
     text=mod.ANSI.sub('',terminal.output[start:].decode(errors='replace'))
     pages=re.findall(r'等待批准 · 第 (\d+)/(\d+) 页',text)
     if pages and pages[-1][0]==pages[-1][1]:break
     terminal.send('next');terminal.read(.15)
    else:raise AssertionError('审批未到最后一页')
   if choice=='cancel':
    start=terminal.key(b'\x03');terminal.until('已取消本轮' if surface=='text' else '已取消',start)
   else:command(terminal,choice,'TASK_COMPLETE_'+name)
   terminal.read(.15)
  propose('PROPOSE_DENY','n');assert data(work)['entries']==[]
  propose('PROPOSE_CANCEL','cancel');assert data(work)['entries']==[]
  propose('PROPOSE_ALLOW','y');assert len(data(work)['entries'])==1 and data(work)['entries'][0]['source']['kind']=='model'
  allowed=[row for row in requests(work) if row['input']=='PROPOSE_ALLOW'];assert len(allowed)==2 and all('MODEL_MEMORY_APPROVED' not in row['prompt'] for row in allowed)
  command(terminal,'CHECK_NEXT_TASK','TASK_COMPLETE_CHECK_NEXT_TASK');assert 'MODEL_MEMORY_APPROVED' in requests(work)[-1]['prompt']
  if surface=='tui':
   terminal.key(b'KEEP_DRAFT');terminal.read(.2);screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();view='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent') and 'KEEP_DRAFT' in view and '本地估算' in view and lines[-1].startswith('Enter '),view
   terminal.key(b'\x15')
  terminal.send('/exit')
  if surface=='tui':terminal.finish()
  else:terminal.finish_text()
  report=json.loads((work/'report.json').read_text());assert report['calls']==len(requests(work));assert len(report['data']['entries'])==1
  print(f'✓ 18.3 {surface} PTY {rows}×{cols}: local CRUD/source, Plan, proposal deny/cancel/allow, next-task snapshot, terminal restore',flush=True)
 finally:terminal.close()

with tempfile.TemporaryDirectory(prefix='hello-agent18-pty-') as temporary:
 work=pathlib.Path(temporary)
 exercise(work/'text','text');exercise(work/'tui','tui')
 # 最小工作区管理查询后仍能编辑草稿，来源条目通过历史区保留，底栏不被长UUID推走。
 narrow=work/'narrow';narrow.mkdir();(narrow/'package.json').write_text('{"type":"module"}');(narrow/'harness.mjs').write_text(HARNESS)
 terminal=Terminal(['node',str(narrow/'harness.mjs'),'tui'],narrow,narrow,16,40)
 try:
  terminal.until('Hello, My Agent');command(terminal,'/memory add NARROW_MEMORY','记忆操作已结束');assert data(narrow)['entries'][0]['content']=='NARROW_MEMORY';command(terminal,'/memory list','记忆操作已结束')
  # 16行终端只有两行历史视口，完整条目要通过真实历史翻页查看，不能只等最新两行。
  start=terminal.key(b'\x0f')
  for _ in range(20):
   terminal.key(b'\x1b[5~');terminal.read(.1)
   if 'NARROW_MEMORY' in mod.ANSI.sub('',terminal.output[start:].decode(errors='replace')):break
  else:raise AssertionError('窄屏历史翻页后仍未显示记忆正文')
  terminal.key(b'\x1b[F');terminal.key(b'\x0f');terminal.key(b'\x0f')
  terminal.key(b'KEEP_DRAFT');terminal.read(.2);screen=Screen(16,40);screen.feed(terminal.output);lines=screen.lines();view='\n'.join(lines)
  assert lines[0].startswith('Hello, My Agent') and 'KEEP_DRAFT' in view and lines[-1].startswith('记忆操作已结束'),view
  assert requests(narrow)==[];terminal.key(b'\x15');terminal.send('/exit');terminal.finish()
  print('✓ 18.3 TUI PTY 16×40: local management remains usable, draft/header/footer preserved, zero model requests',flush=True)
 finally:terminal.close()
