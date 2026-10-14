"""第十章真实 PTY 检查。四节各自编译到临时目录，模型使用本地替身。"""
import os, pty, subprocess, select, time, tempfile, pathlib, json, shutil, termios, fcntl, struct, re, signal, sys
root = pathlib.Path(__file__).resolve().parents[1]
temp = pathlib.Path(tempfile.mkdtemp(prefix='hello-agent-tui-'))
lessons = ['01-first-screen', '02-live-progress', '03-tool-approval', '04-cancel-and-restore']
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
import {writeFile} from 'node:fs/promises';
const result=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:1,outputTokens:1,truncated:false});
const call=(name,args)=>result('',[{id:'same-id',name,arguments:JSON.stringify(args)}]);
await startTui({async generate(messages,signal,onText){
 const prompt=messages.filter(m=>m.role==='user').at(-1).content;
 const last=messages.at(-1);
 if(last.role==='tool') {
   if(prompt==='read'&&!last.content.includes('STARTUP'))throw new Error('读取结果未回到模型');
   if(prompt==='test'&&!last.content.includes('EXIT_OK'))throw new Error('命令结果未回到模型');
   const text=last.isError?'DENIED':'RESULT_OK';onText?.(text);return result(text);
 }
 if(prompt==='read')return call('read_file',{path:'README.md',offset:1,limit:20});
 if(prompt==='create'||prompt==='cancel-approval')return call('write_file',{path:prompt+'.txt',content:'safe\n'});
 if(prompt==='edit')return call('edit_file',{path:'create.txt',old_text:'safe',new_text:'edited'});
 if(prompt==='long')return call('write_file',{path:'long.txt',content:Array.from({length:80},(_,i)=>'LINE_'+i).join('\n')});
 if(prompt==='test')return call('run_command',{command:'node -e "console.log(\'EXIT_OK\')"',cwd:'.',timeout_ms:1000});
 if(prompt==='slow-command')return call('run_command',{command:'node -e "require(\'node:fs\').writeFileSync(\'child.pid\',String(process.pid));setInterval(()=>{},1000)"',cwd:'.',timeout_ms:10000});
 if(prompt==='protected')return call('read_file',{path:'.git/HEAD',offset:1,limit:10});
 if(prompt==='wait') {
   onText?.('WAITING');await writeFile('waiting','yes');
   try {await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
   finally {await writeFile('cleaned','yes');}
 }
 if(prompt==='fail')throw new Error('local fixture failure');
 onText?.('HELLO_');await new Promise(r=>setTimeout(r,100));onText?.(prompt);
 return result('HELLO_'+prompt);
}});
'''

try:
    for step, lesson in enumerate(lessons, 1):
        if len(sys.argv)>1 and step!=int(sys.argv[1]): continue
        case=temp/lesson; case.mkdir(); (case/'node_modules').symlink_to(root/'node_modules', target_is_directory=True)
        (case/'package.json').write_text('{"type":"module","version":"0.1.0"}')
        source=root/'chapter-10-terminal-ui'/lesson/'src'
        config={'extends':str(root/'tsconfig.json'),'compilerOptions':{'noEmit':False,'rootDir':str(source),'outDir':str(case/'dist'),'typeRoots':[str(root/'node_modules/@types')]},'include':[str(source/'cli.ts')]}
        (case/'tsconfig.json').write_text(json.dumps(config))
        subprocess.run(['node',str(root/'node_modules/typescript/bin/tsc'),'-p',str(case/'tsconfig.json')],check=True)
        work=case/'workspace';work.mkdir();(work/'package.json').write_text('{}');(work/'README.md').write_text('STARTUP\n');(work/'.git').mkdir();(work/'.git/HEAD').write_text('ref: refs/heads/main\n')
        harness=case/'harness.mjs';harness.write_text('import {startTui} from "./dist/ui/tui/app.js";\n'+model_source)
        t=Terminal(['node',str(harness)],work)
        try:
            t.until('输入问题');s=t.send('hello');t.until('HELLO_hello',s);t.until('已完成',s)
            s=t.send('read');t.until('RESULT_OK',s)
            if step>=2:t.until('read_file',s)
            s=t.send('create')
            if step<3:
                t.until('DENIED',s);assert not (work/'create.txt').exists()
            else:
                t.until('等待批准',s);assert not (work/'create.txt').exists()
                s=t.send('y');t.until('RESULT_OK',s);assert (work/'create.txt').read_text()=='safe\n'
                s=t.send('edit');t.until('等待批准',s);s=t.send('y');t.until('RESULT_OK',s);assert (work/'create.txt').read_text()=='edited\n'
                s=t.send('test');t.until('等待批准',s);s=t.send('y');t.until('RESULT_OK',s)
                s=t.send('long');t.until('等待批准',s);s=t.send('y');t.until('请先逐页查看完整内容',s);assert not (work/'long.txt').exists()
                # 最后一页之前不能批准；调整尺寸后须重新查看完整预览。
                for _ in range(12):
                    segment=ansi.sub('',t.output[s:].decode(errors='replace'))
                    if 'y 批准本次' in segment:break
                    s=t.send('next')
                else:raise AssertionError('未能翻到末页')
                t.resize(90,28);t.read(.2);s=t.send('y');t.until('请先逐页查看完整内容',s)
                s=t.send('n');t.until('DENIED',s);assert not (work/'long.txt').exists()
                s=t.send('protected');t.until('等待批准',s);s=t.send('s');t.until('RESULT_OK',s)
                s=t.send('protected');t.until('RESULT_OK',s);assert '等待批准' not in ansi.sub('',t.output[s:].decode(errors='replace'))
                s=t.send('/permissions reset');t.until('授权已撤销',s)
            if step==4:
                s=t.send('cancel-approval');t.until('等待批准',s);os.write(t.master,b'y');t.read(.1);s=t.key(b'\x03');t.until('已取消本轮',s);assert not (work/'cancel-approval.txt').exists()
                s=t.send('next');t.until('HELLO_next',s);assert 'HELLO_ynext' not in t.output.decode(errors='replace')
                s=t.send('wait');t.until('WAITING',s);s=t.key(b'\x03');t.until('已取消本轮',s);assert (work/'cleaned').exists()
                s=t.send('next');t.until('HELLO_next',s)
                s=t.send('fail');t.until('运行失败',s);s=t.send('next');t.until('HELLO_next',s)
                s=t.send('slow-command');t.until('等待批准',s);s=t.send('y')
                end=time.time()+5
                while not (work/'child.pid').exists() and time.time()<end:t.read()
                assert (work/'child.pid').exists();pid=int((work/'child.pid').read_text())
                s=t.key(b'\x03');t.until('已取消本轮',s)
                try:os.kill(pid,0);raise AssertionError('取消后子进程仍存活')
                except ProcessLookupError:pass
                s=t.send('next');t.until('HELLO_next',s)
                t.send('/exit');t.finish(0)
            else:
                t.send('wait')
                end=time.time()+5
                while not (work/'waiting').exists() and time.time()<end:t.read()
                t.key(b'\x03');t.finish(130);assert (work/'cleaned').exists()
            print(f'✓ 10.{step}：真实TTY、输入回答、实际工具、审批边界、取消清理与终端恢复通过',flush=True)
        finally:t.close()
        if step==4:
            # 通过真实 CLI 检查 auto 选择，不只验证直接调用 startTui 的测试入口。
            for arguments, term, tui in [([], 'xterm-256color', True), (['--output','text'], 'xterm-256color', False), ([], 'dumb', False)]:
                t=Terminal(['node',str(case/'dist/cli.js'),*arguments],work,
                    {'TERM':term,'OPENAI_API_KEY':'local-fixture','OPENAI_MODEL':'fixture','OPENAI_BASE_URL':'http://127.0.0.1:1/v1'})
                try:
                    t.until('输入问题' if tui else '输入消息开始对话')
                    t.send('/exit');t.finish(0,cursor=tui)
                finally:t.close()
            print('✓ 10.4：真实 CLI 自动选择 TUI、显式 text 与 TERM=dumb 降级通过',flush=True)
finally:shutil.rmtree(temp)
