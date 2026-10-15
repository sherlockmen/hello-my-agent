# -*- coding: utf-8 -*-
"""第19章真实PTY：手动加载不发模型、按任务加载/资源/错误接回模型、忙碌草稿和退出。"""
import atexit, fcntl, importlib.util, json, os, pathlib, pty, re, shutil, struct, subprocess, tempfile, termios, unicodedata
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=pathlib.Path(tempfile.mkdtemp(prefix='hello-agent19-pty-build-'))
atexit.register(shutil.rmtree,BUILD,ignore_errors=True)
(BUILD/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
(BUILD/'package.json').write_text('{"type":"module"}')
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

HARNESS=r'''import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {startTui} from 'DIST/ui/tui/app.js';
import {createModel} from 'DIST/models/client.js';
import {loadProjectInstructions} from 'DIST/project/instructions.js';
import {createMemoryController} from 'DIST/memory/commands.js';
import {discoverSkills,skillPrompt} from 'DIST/skills/catalog.js';
const project=await loadProjectInstructions(),memory=await createMemoryController(project.root),skills=await discoverSkills(project.root);
const adapter=createModel({provider:'openai',apiKey:'fixture-only',model:'fixture',baseURL:'http://127.0.0.1:1'},project,memory,skills);
const stage=STAGE;
let calls=0;
const answer=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:10,outputTokens:4,truncated:false});
const call=(id,name,args)=>answer('',[{id,name,arguments:JSON.stringify(args)}]);
await startTui({...adapter,async generate(messages,signal,onText,options){
 signal.throwIfAborted();calls++;
 assert.equal(options.mode,'plan');
 assert.equal(messages.filter(m=>m.role==='user').length,1,'本地技能命令不得成为用户消息');
 assert.equal(messages.find(m=>m.role==='user').content,'CHECK_SKILL_REQUEST');
 if(stage===2){assert.equal(calls,1);assert.equal(skills.loaded.size,1);assert.match(skillPrompt(skills),/REVIEW_BODY_SECRET/);}
 else{
  if(calls===1){assert.doesNotMatch(skillPrompt(skills),/REVIEW_BODY_SECRET/);await delay(850);return call('auto-load','load_skill',{name:'review'});}
  if(calls===2){assert.match(skillPrompt(skills),/REVIEW_BODY_SECRET/);assert.equal(messages.at(-1).toolCallId,'auto-load');assert.match(messages.at(-1).content,/已加载技能/);return call('resource','read_skill_resource',{name:'review',path:'references/checklist.md'});}
  if(calls===3){assert.equal(messages.at(-1).toolCallId,'resource');assert.match(messages.at(-1).content,/RESOURCE_CHECKLIST/);assert.doesNotMatch(skillPrompt(skills),/RESOURCE_CHECKLIST/);return call('failed-load','load_skill',{name:'missing'});}
  if(calls===4){assert.equal(messages.at(-1).toolCallId,'failed-load');assert.equal(messages.at(-1).isError,true);return call('forbidden','run_command',{command:'touch MUST_NOT_EXECUTE',cwd:'.'});}
  assert.equal(calls,5);assert.equal(messages.at(-1).toolCallId,'forbidden');assert.equal(messages.at(-1).isError,true);assert.match(messages.at(-1).content,/Plan/);
 }
 onText?.('SKILLS_FLOW_COMPLETE');return answer('SKILLS_FLOW_COMPLETE');
}},'plan');
assert(!existsSync('MUST_NOT_EXECUTE'));
writeFileSync('report.json',JSON.stringify({calls,loaded:[...skills.loaded.keys()],memory:!!memory,root:project.root}));
'''
for stage,lesson in [(2,'02-load-on-demand'),(3,'03-model-skill-tools')]:
 src=ROOT/'chapter-19-skills'/lesson/'src';dist=BUILD/f'dist-{stage}';config=BUILD/f'tsconfig-{stage}.json'
 config.write_text(json.dumps({'extends':str(ROOT/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(src),'outDir':str(dist),'typeRoots':[str(ROOT/'node_modules/@types')]},'include':[str(src/'**/*.ts'),str(src/'**/*.tsx')]}))
 subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'-p',str(config)],check=True,timeout=60)
 for rows,cols in [(16,40),(40,110)]:
  with tempfile.TemporaryDirectory(prefix='hello-agent19-pty-') as temporary:
   work=pathlib.Path(temporary);skills=work/'.hello-my-agent/skills/review';(skills/'references').mkdir(parents=True)
   (work/'package.json').write_text('{"name":"skills-fixture","type":"module"}')
   (skills/'SKILL.md').write_text('---\nname: review\ndescription: Review code changes.\n---\nREVIEW_BODY_SECRET\nRead references/checklist.md.')
   (skills/'references/checklist.md').write_text('RESOURCE_CHECKLIST')
   (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('STAGE',str(stage)))
   terminal=Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
   try:
    terminal.until('Hello, My Agent');terminal.read(.2)
    if stage==2:
     terminal.send('/skills');terminal.until('技能读取已结束')
     terminal.send('/skill review');terminal.until('技能读取已结束');terminal.read(.2)
     terminal.send('/reset');terminal.until('对话历史已清空')
    start=terminal.send('CHECK_SKILL_REQUEST')
    if stage==3:
     terminal.until('模型第 1 次决策',start=start);terminal.send('/skills');terminal.until('草稿已保留',start=start)
    terminal.until('状态：已完成',start=start);terminal.read(.2)
    terminal.key(b'\x15');terminal.key(b'KEEP_DRAFT');terminal.read(.2)
    screen=Screen(rows,cols);screen.feed(terminal.output);lines=screen.lines();joined='\n'.join(lines)
    assert lines[0].startswith('Hello, My Agent'),(stage,rows,cols,'header',joined)
    assert '本地估算' in joined and 'KEEP_DRAFT' in joined,(stage,rows,cols,'budget/draft',joined)
    assert lines[-1].startswith('Enter ') or '草稿已保留' in lines[-1],(stage,rows,cols,'footer',joined)
    assert 'REVIEW_BODY_SECRET' not in mod.ANSI.sub('',terminal.output.decode(errors='replace'))
    terminal.key(b'\x15');terminal.send('/exit');terminal.finish()
    report=json.loads((work/'report.json').read_text());assert report['calls']==(1 if stage==2 else 5);assert report['loaded']==['review'] and report['memory']
    print(f'✓ 19.{stage} PTY {rows}×{cols}: skills source/load/results, local command isolation, Plan, draft/budget/footer, terminal restored')
   finally:terminal.close()
