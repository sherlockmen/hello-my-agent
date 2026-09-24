"""第十一章真实 PTY 检查。每节独立编译，键盘与模型调用数量都实际验证。"""
import os, pty, subprocess, select, time, tempfile, pathlib, json, shutil, termios, fcntl, struct, re, signal, sys
root = pathlib.Path(__file__).resolve().parents[1]
temp = pathlib.Path(tempfile.mkdtemp(prefix='hello-agent-tui-'))
lessons = ['01-editable-draft', '02-recall-and-complete', '03-browse-results', '04-external-editor', '05-terminal-layout']
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')

class Terminal:
    def __init__(self, command, cwd, env=None):
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        self.resize(100, 30)
        self.output = b''
        self.process = subprocess.Popen(command, cwd=cwd, stdin=self.slave, stdout=self.slave, stderr=self.slave,
            env={'PATH': os.environ['PATH'], 'HOME': str(temp), 'TERM': 'xterm-256color', **(env or {})})
    def resize(self, columns, rows):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        if hasattr(self, 'process'): self.process.send_signal(signal.SIGWINCH)
    def read(self, seconds=.1):
        until = time.time() + seconds
        while time.time() < until:
            if select.select([self.master], [], [], .03)[0]:
                try: self.output += os.read(self.master, 65536)
                except OSError: return
    def until(self, text, start=0, timeout=8):
        until = time.time() + timeout
        while time.time() < until:
            clean = ansi.sub('', self.output[start:].decode(errors='replace'))
            if text in clean: return
            self.read()
        raise AssertionError('未出现：' + text + '\n' + ansi.sub('', self.output[-8000:].decode(errors='replace')))
    def send(self, text):
        start = len(self.output)
        os.write(self.master, text.encode()); self.read(.07); os.write(self.master, b'\r'); self.read(.08)
        return start
    def key(self, key):
        start = len(self.output); os.write(self.master, key); self.read(.12); return start
    def finish(self, status, cursor=True):
        end = time.time() + 8
        while self.process.poll() is None and time.time() < end: self.read()
        assert self.process.poll() == status, (self.process.poll(), self.output[-2000:])
        self.read(.1)
        after = termios.tcgetattr(self.slave)
        mask = termios.ECHO | termios.ICANON
        assert after[3] & mask == self.before[3] & mask, '终端回显/规范输入没有恢复'
        if cursor: assert b'\x1b[?25h' in self.output, '退出后没有恢复光标'
    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try: self.process.wait(timeout=4)
            except subprocess.TimeoutExpired: self.process.kill(); self.process.wait()
        os.close(self.master); os.close(self.slave)

model_source=r'''
import {appendFile,writeFile} from 'node:fs/promises';
const result=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:1,outputTokens:1,truncated:false});
await startTui({async generate(messages,signal,onText){
 const prompt=messages.filter(m=>m.role==='user').at(-1).content;
 if(messages.at(-1).role==='tool'){onText?.('TOOL_DONE');return result('TOOL_DONE');}
 await appendFile('requests.jsonl',JSON.stringify(prompt)+'\n');
 if(prompt==='scroll') {
   const text=Array.from({length:70},(_,i)=>'SCROLL_'+String(i).padStart(2,'0')).join('\n');
   onText?.(text);return result(text);
 }
 if(prompt==='approve') {
   await new Promise(r=>setTimeout(r,350));
   return result('',[{id:'write',name:'write_file',arguments:JSON.stringify({path:'never.txt',content:'not approved'})}]);
 }
 if(prompt==='read')return result('',[{id:'read',name:'read_file',arguments:JSON.stringify({path:'README.md',offset:1,limit:30})}]);
 if(prompt==='wait') {
   onText?.('WAITING');
   await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 }
 const text='REPLY_'+prompt.replaceAll('\n','|');onText?.(text);return result(text);
}});
'''
try:
 for step,lesson in enumerate(lessons,1):
  if len(sys.argv)>1 and step!=int(sys.argv[1]):continue
  case=temp/lesson;case.mkdir();(case/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
  (case/'package.json').write_text('{"type":"module"}')
  source=root/'chapter-11-terminal-workbench'/lesson/'src'
  (case/'tsconfig.json').write_text(json.dumps({'extends':str(root/'tsconfig.json'),'compilerOptions':{'noEmit':False,'rootDir':str(source),'outDir':str(case/'dist'),'typeRoots':[str(root/'node_modules/@types')]},'include':[str(source/'cli.ts')]}))
  subprocess.run(['node',str(root/'node_modules/typescript/bin/tsc'),'-p',str(case/'tsconfig.json')],check=True)
  work=case/'workspace';work.mkdir();(work/'package.json').write_text('{}');(work/'README.md').write_text('FULL_TOOL_RESULT\n'+'tail\n'*20)
  harness=case/'harness.mjs';harness.write_text('import {startTui} from "./dist/ui/tui/app.js";\n'+model_source)
  requests=lambda: [json.loads(s) for s in (work/'requests.jsonl').read_text().splitlines()] if (work/'requests.jsonl').exists() else []
  fake=case/'commands';fake.mkdir()
  for name in ['pbcopy','wl-copy','xclip','clip.exe']:
   p=fake/name;p.write_text('#!/bin/sh\ncat > "$COPY_TARGET"\n');p.chmod(0o755)
  editor=case/'editor.mjs';editor.write_text("import{writeFileSync,readFileSync}from'node:fs';writeFileSync(process.env.EDITOR_SEEN,readFileSync(process.argv[2]));writeFileSync(process.argv[2],'EDITOR_TEXT\\nSECOND');console.log('EDITOR_RUNNING');await new Promise(r=>setTimeout(r,200));")
  env={'PATH':str(fake)+':'+os.environ['PATH'],'COPY_TARGET':str(case/'copied'),'EDITOR':f'node {editor}','VISUAL':'','EDITOR_SEEN':str(case/'editor-seen')}
  if step==5:env.update({'NO_COLOR':'1','FORCE_COLOR':'3'})
  t=Terminal(['node',str(harness)],work,env)
  try:
   t.until('草稿' if step>=3 else '你 >')
   if step>=3:
    assert 'Ctrl+O 进入历史区后，↑↓/PgUp/PgDn 才用于滚动' in ansi.sub('',t.output.decode(errors='replace')),'草稿焦点下必须说明滚动键的启用方式'
   # 真实 bracketed paste：带换行的代码只能进入草稿。
   t.key('\x1b[200~中文\r\n🙂é\x1b[201~'.encode());assert requests()==[]
   t.key(b'\x1b[D');t.key(b'\x7f');t.key(b'\x1b[C')
   t.key(b'\x1a');t.key(b'\x19') # undo/redo
   s=t.key(b'\r');t.until('已完成',s);assert requests()==['中文\né'],requests()
   count=len(requests());t.key(b'first');t.key(b'\n');t.key(b'second');assert len(requests())==count
   s=t.key(b'\r');t.until('REPLY_first|second',s);assert requests()[-1]=='first\nsecond'
   s=t.send('alpha');t.until('REPLY_alpha',s)
   if step>=2:
    t.key(b'\x12');t.key(b'alp');count=len(requests());t.key(b'\r');assert len(requests())==count
    s=t.key(b'\r');t.until('REPLY_alpha',s)
    t.key(b'/res');t.key(b'\t');s=t.key(b'\r');t.until('历史已清空',s)
    t.key(b'@READ');t.key(b'\t');t.until('@README.md');t.key(b'\x15')
   if step>=3:
    # 默认焦点编辑草稿；明确切到历史以后，四个导航键必须实际改变可见记录。
    s=t.send('scroll');t.until('SCROLL_69',s);t.key(b'kept input');count=len(requests())
    t.key(b'\x1b[A');t.key(b'\x1b[B');t.key(b'\x1b[5~');t.key(b'\x1b[6~');assert len(requests())==count
    t.key(b'\x0f');t.until('历史区 [焦点]')
    s=t.key(b'\x1b[5~');t.until('SCROLL_36',s)
    s=t.key(b'\x1b[A');t.until('SCROLL_35',s)
    s=t.key(b'\x1b[B');t.until('SCROLL_36',s)
    s=t.key(b'\x1b[6~');t.until('SCROLL_69',s)
    t.key(b'\x1b[F');s=t.key(b'\x0f');t.until('kept input▏',s);t.key(b'\x15')
    s=t.send('wait');t.until('WAITING',s);t.key(b'kept draft');count=len(requests());t.key(b'\r');assert len(requests())==count
    t.key(b'\x0f');t.until('历史区 [焦点]');t.key(b'\x1b[H');t.key(b'\x03');t.until('已取消本轮')
    t.key(b'\x1b[F');t.key(b'\x0f');s=t.key(b'\r');t.until('REPLY_kept draft',s)
    s=t.send('approve');t.key(b'saved');t.until('等待批准',s)
    t.key(b'\x1b[200~y\n\x1b[201~');t.key(b'\r');assert not (work/'never.txt').exists()
    s=t.send('n');t.until('TOOL_DONE',s);s=t.key(b'\r');t.until('REPLY_saved',s)
    s=t.send('read');t.until('TOOL_DONE',s);t.key(b'\x0f');t.key(b'k');t.key(b'k');t.key(b'\r');t.until('FULL_TOOL_RESULT');t.key(b'\x19')
    end=time.time()+3
    while not (case/'copied').exists() and time.time()<end:t.read()
    assert 'FULL_TOOL_RESULT' in (case/'copied').read_text()
    t.key(b'\x1b[F');t.key(b'\x0f')
   if step>=4:
    t.key(b'original');count=len(requests());s=t.key(b'\x07');t.until('EDITOR_RUNNING',s);t.until('已取回编辑内容',s)
    assert len(requests())==count
    assert (case/'editor-seen').read_text()=='original'
    t.key(b'\x1a');s=t.key(b'\r');t.until('REPLY_original',s)
    s=t.key(b'\x07');t.until('已取回编辑内容',s);s=t.key(b'\r');t.until('REPLY_EDITOR_TEXT|SECOND',s)
   if step==5:
    t.key('窗口🙂'.encode());t.resize(28,9);t.until('请放大');t.key(b'\r');count=len(requests());t.resize(80,24);t.read(.3)
    s=t.key(b'\r');t.until('REPLY_窗口🙂',s);assert len(requests())==count+1
    assert not re.search(rb'\x1b\[[0-9;]*m',t.output),'NO_COLOR仍输出颜色/反色'
   t.key(b'\x04');t.finish(0)
   assert b'\x1b[?2004l' in t.output,'粘贴模式未恢复'
   if step>=3:assert b'\x1b[?1049l' in t.output,'备用屏幕未恢复'
   print(f'✓ 11.{step}：真实按键、粘贴、阶段交互、模型提交边界与终端恢复通过',flush=True)
  finally:t.close()
  if step==5:
   # 编辑器失败也必须恢复可输入的 TUI，并留下原草稿。
   t=Terminal(['node',str(harness)],work,{**env,'EDITOR':'false'})
   try:
    t.until('草稿');t.key(b'preserved');s=t.key(b'\x07');t.until('原草稿已保留',s)
    s=t.key(b'\r');t.until('REPLY_preserved',s);t.key(b'\x04');t.finish(0)
   finally:t.close()
   # 关闭整个 TUI 时，要等待外部编辑器结束，再删除交换文件。
   editor.write_text("import{writeFileSync}from'node:fs';writeFileSync(process.env.EDITOR_SEEN,JSON.stringify({pid:process.pid,path:process.argv[2]}));setInterval(()=>{},1000);")
   (case/'editor-seen').unlink()
   t=Terminal(['node',str(harness)],work,env)
   try:
    t.until('草稿');t.key(b'\x07');end=time.time()+5
    while not (case/'editor-seen').exists() and time.time()<end:t.read()
    child=json.loads((case/'editor-seen').read_text())
    t.process.send_signal(signal.SIGTERM);t.finish(143)
    assert not pathlib.Path(child['path']).exists(),'临时文件未清理'
    try:os.kill(child['pid'],0);raise AssertionError('外部编辑器未停止')
    except ProcessLookupError:pass
   finally:t.close()
   print('✓ 11.5：外部编辑失败恢复草稿、退出时停止编辑器与清理临时文件通过',flush=True)
finally:shutil.rmtree(temp)
