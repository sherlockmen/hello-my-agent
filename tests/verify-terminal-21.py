# -*- coding: utf-8 -*-
"""第21章真实PTY：SDK工具逐次批准/拒绝、Plan隔离、取消关闭、草稿与退出恢复。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, time, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=ROOT/'chapter-21-mcp'
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent21-pty-build-')).resolve()
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

SERVER=r"""import{createInterface}from'node:readline';import{appendFileSync,writeFileSync}from'node:fs';
writeFileSync('server-pid',String(process.pid));process.stdin.on('end',()=>process.exit(0));
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;let result;
if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
else if(m.method==='tools/list')result={tools:[{name:'echo',description:'外部说明，不代表本地授权',inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:true}}]};
else if(m.method==='tools/call'){appendFileSync('calls.jsonl',JSON.stringify(m.params)+'\n');if(m.params.arguments.text==='CANCEL'){writeFileSync('ready','yes');continue;}result={content:[{type:'text',text:'MCP_PTY_REAL_RESULT'}]};}
console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));}
"""
HARNESS=r"""import assert from 'node:assert/strict';import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{startTui}from'DIST/ui/tui/app.js';import{createModel}from'DIST/models/client.js';import{loadProjectInstructions}from'DIST/project/instructions.js';import{connectMcp}from'DIST/mcp/client.js';
const project=await loadProjectInstructions(),mcp=await connectMcp('mcp.json',project.root,new AbortController().signal);
const adapter=createModel({provider:'openai',apiKey:'fixture-only',model:'fixture',baseURL:'http://127.0.0.1:1'},project,undefined,undefined,undefined,mcp);
const counts={ALLOW:0,DENY:0,PLAN:0,CANCEL:0};const reply=(text='',toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:10,outputTokens:4,truncated:false});
try{await startTui({...adapter,async generate(messages,signal,onText,options){signal.throwIfAborted();const task=messages.filter(m=>m.role==='user').at(-1).content;assert.ok(task in counts,task);counts[task]++;assert.equal(options.mode,task==='PLAN'?'plan':'execute');
if(counts[task]===1)return reply('',[{id:task,name:'mcp__demo__echo',arguments:JSON.stringify({text:task})}]);
assert.equal(counts[task],2);assert.notEqual(task,'CANCEL');const result=messages.at(-1);assert.equal(result.toolCallId,task);
if(task==='ALLOW'){assert.equal(result.isError,false);assert.match(result.content,/MCP_PTY_REAL_RESULT/);}else{assert.equal(result.isError,true);assert.match(result.content,task==='PLAN'?/Plan/:/未批准/);}
onText?.(task+'_COMPLETE');return reply(task+'_COMPLETE');}},'execute');}finally{await mcp.close();}
assert.deepEqual(counts,{ALLOW:2,DENY:2,PLAN:2,CANCEL:1});const calls=readFileSync('calls.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(c=>c.arguments.text),['ALLOW','CANCEL']);assert.throws(()=>process.kill(Number(readFileSync('server-pid')),0),e=>e.code==='ESRCH');writeFileSync('report.json',JSON.stringify({cleaned:true,counts}));
"""
def approve(terminal):
 terminal.until('等待批准');terminal.read(.15)
 raw=mod.ANSI.sub('',terminal.output.decode(errors='replace'));pages=re.findall(r'等待批准 · 第 (\d+)/(\d+) 页',raw);assert pages
 count=int(pages[-1][1])
 for _ in range(count-1):terminal.send('next')
 terminal.send('y')
def wait_file(terminal,path):
 end=time.monotonic()+6
 while not path.exists() and time.monotonic()<end:
  assert terminal.process.poll() is None,terminal.output[-5000:];terminal.read()
 assert path.exists(),f'未收到握手：{path}'
src=SOURCE/'03-connection-lifecycle/src';dist=BUILD/'dist';config=BUILD/'tsconfig.json'
config.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(src),'outDir':str(dist),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(src/'**/*.ts'),str(src/'**/*.tsx')]}))
subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(config)],check=True,timeout=60)
for rows,cols in [(16,40),(40,110)]:
 with tempfile.TemporaryDirectory(prefix='hello-agent21-pty-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"name":"mcp-fixture","type":"module"}');(work/'server.mjs').write_text(SERVER)
  (work/'mcp.json').write_text(json.dumps({'servers':[{'name':'demo','transport':'stdio','command':shutil.which('node'),'args':[str(work/'server.mjs')]}]}));(work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()))
  terminal=Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
  try:
   terminal.until('Hello, My Agent');terminal.read(.2)
   start=terminal.send('ALLOW');approve(terminal);terminal.until('状态：已完成',start=start)
   start=terminal.send('DENY');terminal.until('等待批准',start=start);terminal.send('n');terminal.until('状态：已完成',start=start)
   terminal.send('/mode plan');terminal.until('当前模式：plan');start=terminal.send('PLAN');terminal.until('状态：已完成',start=start)
   terminal.send('/mode execute');terminal.until('当前模式：execute');start=terminal.send('CANCEL');approve(terminal);wait_file(terminal,work/'ready');terminal.key(b'KEEP_DRAFT');terminal.key(b'\x03');terminal.until('状态：已取消本轮',start=start)
   try:os.kill(int((work/'server-pid').read_text()),0);raise AssertionError('取消完成时直接SDK进程还活着')
   except ProcessLookupError:pass
   terminal.read(.2);screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
   assert lines[0].startswith('Hello, My Agent'),joined
   assert '本地估算' in joined and 'KEEP_DRAFT' in joined,joined
   assert lines[-1].startswith('Enter ') or '草稿已保留' in lines[-1],joined
   terminal.key(b'\x15');terminal.send('/exit');terminal.finish();assert json.loads((work/'report.json').read_text())['cleaned']
   print(f'✓ 21.3 PTY {rows}×{cols}: explicit approval/deny/Plan, real SDK result → model, cancel awaits process exit, draft/budget/footer, restored')
  finally:terminal.close()
