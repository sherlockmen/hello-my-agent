"""第十二章真实 PTY 检查：本地内存模型、独占问答、排队、打断和撤回。"""
import os, pty, subprocess, select, time, tempfile, pathlib, json, shutil, termios, fcntl, struct, re, signal, sys
root = pathlib.Path(__file__).resolve().parents[1]
temp = pathlib.Path(tempfile.mkdtemp(prefix='hello-agent-tui-'))
lessons = ['01-plan-mode', '02-task-list', '03-clarify-questions', '04-live-input', '05-manage-queue']
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

model_source = r'''
import {appendFile} from 'node:fs/promises';
const result=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:1,outputTokens:1,truncated:false});
let active=0;
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
await startTui({async generate(messages,signal,onText,options){
 const prompt=messages.filter(m=>m.role==='user').at(-1).content;
 active++;if(active!==1)throw new Error('OVERLAPPING_MODEL_CALLS');
 await appendFile('requests.jsonl',JSON.stringify({prompt,mode:options?.mode,messages})+'\n');
 try {
  const last=messages.at(-1);
  if(last.role==='tool'){onText?.('TOOL_DONE');return result('TOOL_DONE');}
  if(prompt==='plan-write')return result('',[{id:'write',name:'write_file',arguments:JSON.stringify({path:'forbidden.txt',content:'forbidden'})}]);
  if(prompt==='make-list')return result('',[{id:'todo',name:'todo_write',arguments:JSON.stringify({items:[{id:'read',text:'检查加法',status:'in_progress'},{id:'test',text:'运行测试',status:'pending'}]})}]);
  if(prompt==='ask'||prompt==='ask-cancel'){await delay(350,signal);return result('',[{id:'ask',name:'ask_user',arguments:JSON.stringify({question:'遇到无效数字字符串怎么办？',choices:['报错','返回0']})}]);}
  if(prompt==='slow'){onText?.('SLOW_STARTED');await delay(1600,signal);onText?.('SLOW_FINAL');return result('SLOW_FINAL');}
  if(prompt==='hold'){onText?.('HOLD_STARTED');try{await delay(10000,signal);}finally{await new Promise(r=>setTimeout(r,180));await appendFile('cleanup.jsonl','HOLD_CLEANED\n');}}
  const answer='REPLY_'+prompt.replaceAll('\n','|');onText?.(answer);return result(answer);
 } finally {active--;}
}});
'''
try:
 for step, lesson in enumerate(lessons,1):
  if len(sys.argv)>1 and step!=int(sys.argv[1]):continue
  case=temp/lesson;case.mkdir();(case/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
  (case/'package.json').write_text('{"type":"module"}')
  source=root/'chapter-12-task-control'/lesson/'src'
  (case/'tsconfig.json').write_text(json.dumps({'extends':str(root/'tsconfig.json'),'compilerOptions':{'noEmit':False,'noEmitOnError':True,'rootDir':str(source),'outDir':str(case/'dist'),'typeRoots':[str(root/'node_modules/@types')]},'include':[str(source/'cli.ts')]}))
  subprocess.run(['node',str(root/'node_modules/typescript/bin/tsc'),'-p',str(case/'tsconfig.json')],check=True)
  work=case/'workspace';work.mkdir();(work/'package.json').write_text('{}')
  harness=case/'harness.mjs';harness.write_text('import {startTui} from "./dist/ui/tui/app.js";\n'+model_source)
  requests=lambda: [json.loads(line) for line in (work/'requests.jsonl').read_text().splitlines()] if (work/'requests.jsonl').exists() else []
  t=Terminal(['node',str(harness)],work,{'NO_COLOR':'1'})
  try:
   t.until('草稿');assert requests()==[]
   s=t.send('/mode plan');t.until('当前模式：plan',s)
   s=t.send('plan-write');t.until('TOOL_DONE',s);assert not (work/'forbidden.txt').exists()
   assert all(row['mode']=='plan' for row in requests())
   assert not any('等待批准' in ansi.sub('',t.output.decode(errors='replace')) for _ in [0])
   s=t.send('/mode execute');t.until('当前模式：execute',s)
   if step>=2:
    s=t.send('make-list');t.until('TOOL_DONE',s);t.until('0/2 已完成');t.until('检查加法');assert requests()[-1]['mode']=='execute'
   if step>=3:
    s=t.send('ask');t.key(b'kept-draft');t.until('等待澄清',s)
    count=len(requests());t.key(b'\x0f');assert len(requests())==count
    s=t.send('1');t.until('TOOL_DONE',s)
    assert '报错' in requests()[-1]['messages'][-1]['content']
    s=t.key(b'\r');t.until('REPLY_kept-draft',s)
    s=t.send('ask-cancel');t.until('等待澄清',s);s=t.key(b'\x03');t.until('已取消本轮',s)
    s=t.send('after-question-cancel');t.until('REPLY_after-question-cancel',s)
   if step>=4:
    s=t.send('slow');t.until('SLOW_STARTED',s)
    s=t.send('queue-first');t.until('已排队',s)
    assert not any(row['prompt']=='queue-first' for row in requests())
    t.until('REPLY_queue-first',s)
    assert requests()[-1]['prompt']=='queue-first'
    assert '已加入第 2 次请求的上下文' in ansi.sub('',t.output[s:].decode(errors='replace'))
    s=t.send('hold');t.until('HOLD_STARTED',s);t.key(b'urgent-new')
    s=t.key(b'\x13');t.until('REPLY_urgent-new',s)
    assert (work/'cleanup.jsonl').read_text().count('HOLD_CLEANED')==1
    assert requests()[-1]['prompt']=='urgent-new'
    assert 'OVERLAPPING_MODEL_CALLS' not in t.output.decode(errors='replace')
   if step==5:
    s=t.send('hold');t.until('HOLD_STARTED',s)
    s=t.send('edit-me');t.until('已排队',s)
    s=t.send('withdraw-me');t.until('已排队',s)
    t.key(b'\x0f');s=t.key(b'\x0f');t.until('待发送队列 [焦点]',s)
    s=t.key(b'e');t.until('编辑 #',s);t.key(b'\x15');t.key(b'edited-in-queue')
    s=t.key(b'\r');t.until('已保存，仍未生效',s)
    t.key(b'j');s=t.key(b'x');t.until('已撤回',s)
    t.key(b'\x0f');s=t.key(b'\x03');t.until('已取消本轮',s)
    t.key(b'\x0f');t.key(b'\x0f');s=t.key(b'\r');t.key(b'\x0f');t.until('REPLY_edited-in-queue',s)
    assert not any(row['prompt']=='withdraw-me' for row in requests())
    t.resize(30,10);t.until('请放大');t.resize(100,30);t.until('待发送队列')
   t.key(b'\x04');t.finish(0)
   print(f'✓ 12.{step} 真实PTY模式/交互/取消与恢复通过',flush=True)
  finally:t.close()
finally:shutil.rmtree(temp,ignore_errors=True)
