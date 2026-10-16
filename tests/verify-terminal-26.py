"""Real outer PTY → Ink suspension → native inner PTY → restored chat ownership."""
import fcntl,importlib.util,json,os,pathlib,signal,struct,tempfile,termios,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixtures',ROOT/'tests/terminal-fixtures.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
HARNESS=r'''
import assert from 'node:assert/strict';import {writeFileSync,readFileSync} from 'node:fs';
import {startTui} from 'DIST/ui/tui/app.js';import {JobManager} from 'DIST/processes/jobs.js';
import {reply} from 'FIXTURES';
const shutdownOnly=SHUTDOWN_ONLY;
const lifecycle=LIFECYCLE;
writeFileSync('child.mjs',`import fs from 'node:fs';console.log('NATIVE_TTY:'+process.stdin.isTTY+':'+process.stdout.isTTY);process.stdin.on('data',d=>{fs.appendFileSync('human-data',d);console.log('CHILD_RECEIVED:'+d.toString().trim())});process.stdin.on('end',()=>{fs.writeFileSync('child-eof','yes');console.log('CHILD_EOF');process.exit(0)});process.on('SIGINT',()=>{fs.writeFileSync('child-int','yes');console.log('CHILD_INT')});process.stdout.on('resize',()=>{fs.writeFileSync('child-size',JSON.stringify([process.stdout.columns,process.stdout.rows]));console.log('CHILD_SIZE:'+process.stdout.columns+':'+process.stdout.rows)});`);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const jobs=new JobManager();let subscriptions=0;
if(lifecycle){const subscribe=jobs.subscribe.bind(jobs);jobs.subscribe=listener=>{subscriptions++;const remove=subscribe(listener);let active=true;return()=>{if(active){active=false;subscriptions--;remove()}}}}
const child=await jobs.start({transport:'pty',command:`exec ${quote(process.execPath)} child.mjs`,cwd:process.cwd(),timeoutMs:20000});
const keeper=await jobs.start({command:`exec ${quote(process.execPath)} -e 'setInterval(()=>{},1000)'`,cwd:process.cwd(),timeoutMs:20000});
let noticeJob;
if(lifecycle&&!shutdownOnly){writeFileSync('notice-child.mjs',`import fs from 'node:fs';import {setTimeout as wait} from 'node:timers/promises';while(!fs.existsSync('ready-trigger'))await wait(10);console.log('DECLARED_READY');while(!fs.existsSync('end-trigger'))await wait(10);`);noticeJob=await jobs.start({command:`exec ${quote(process.execPath)} notice-child.mjs`,cwd:process.cwd(),timeoutMs:20000,readyText:'DECLARED_READY'});writeFileSync('notice-id',noticeJob.id)}
writeFileSync('job-id',child.id);writeFileSync('owned-pids',JSON.stringify([child.pid,keeper.pid,...(noticeJob?[noticeJob.pid]:[])]));
let calls=0;const model={jobs,async generate(messages){calls++;assert.equal(messages.at(-1).content,'NEXT_TASK');assert.doesNotMatch(JSON.stringify(messages),/HUMAN_TYPED|CHILD_RECEIVED|NATIVE_TTY|DECLARED_READY|作业输出就绪|作业已结束/);return reply('FRESH_CHAT_COMPLETE')}};
await startTui(model);
assert.equal(calls,shutdownOnly?0:1);assert.ok(jobs.list().every(job=>job.state==='exited'));assert.equal(jobs.get(keeper.id).stopReason,'shutdown');
if(lifecycle)assert.equal(subscriptions,0,'TUI must remove its job listener on unmount');
if(!shutdownOnly){assert.match(readFileSync('human-data','utf8'),/HUMAN_TYPED/);assert.doesNotMatch(readFileSync('human-data','utf8'),/\x1d|NEXT_TASK|DISCARDED_AFTER_DETACH/)}
writeFileSync('report.json',JSON.stringify({exclusive:true,closed:true}));
'''
def wait_file(terminal,path):
 end=time.monotonic()+8
 while not path.exists() and time.monotonic()<end:
  assert terminal.process.poll() is None,terminal.output[-4000:];terminal.read()
 assert path.exists(),str(path)+'\n'+f.ANSI.sub('',terminal.output.decode(errors='replace'))[-6000:]
lessons=[os.environ['LESSON_26']] if 'LESSON_26' in os.environ else ['02-pty-takeover','03-job-lifecycle']
for lesson in lessons:
 dist=f.compile_snapshot('chapter-26-interactive-jobs',lesson)
 for rows,cols in [(16,40),(40,110)]:
  with tempfile.TemporaryDirectory(prefix='hello-agent26-pty-') as temporary:
   work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"type":"module"}')
   (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('FIXTURES',(ROOT/'tests/runtime-fixtures.mjs').as_posix()).replace('SHUTDOWN_ONLY','false').replace('LIFECYCLE',str(lesson=='03-job-lifecycle').lower()))
   terminal=f.Terminal(['node',str(work/'harness.mjs')],work,work,rows,cols)
   try:
    terminal.until('Hello, My Agent');wait_file(terminal,work/'job-id');job=(work/'job-id').read_text();terminal.read(.3)
    if lesson=='03-job-lifecycle':
     # 窄窗口仅能显示历史末尾两行；检查通知携带的证据和终态。
     start=len(terminal.output);(work/'ready-trigger').touch();terminal.until('DECLARED_READY' if rows==16 else '作业输出就绪',start=start)
     start=len(terminal.output);(work/'end-trigger').touch();terminal.until('exited readiness' if rows==16 else '作业已结束',start=start)
    start=terminal.send('/fg '+job);terminal.until('NATIVE_TTY:true:true',start=start)
    terminal.send('HUMAN_TYPED');wait_file(terminal,work/'human-data');assert (work/'human-data').read_text()=='HUMAN_TYPED\n'
    fcntl.ioctl(terminal.slave,termios.TIOCSWINSZ,struct.pack('HHHH',31,93,0,0));terminal.process.send_signal(signal.SIGWINCH)
    wait_file(terminal,work/'child-size');end=time.monotonic()+4
    while json.loads((work/'child-size').read_text())!=[93,31] and time.monotonic()<end:terminal.read()
    assert json.loads((work/'child-size').read_text())==[93,31]
    terminal.key(b'\x03');wait_file(terminal,work/'child-int');assert terminal.process.poll() is None
    start=terminal.key(b'\x1dDISCARDED_AFTER_DETACH');terminal.until('已收回终端；/job核对状态',start=start)
    start=terminal.send('NEXT_TASK');terminal.until('状态：已完成',start=start)
    start=terminal.send('/fg '+job);terminal.until('Ctrl+] 分离',start=start);terminal.key(b'\x04');wait_file(terminal,work/'child-eof');terminal.until('已收回终端',start=start)
    terminal.send('/exit');terminal.finish();assert json.loads((work/'report.json').read_text())['closed']
    for pid in json.loads((work/'owned-pids').read_text()):
     try:os.kill(pid,0);raise AssertionError('owned process survived exit: '+str(pid))
     except ProcessLookupError:pass
    print(f'✓ 26 {lesson} PTY {rows}×{cols}: native child TTY, exclusive stdin, actual resize, Ctrl-C child signal, Ctrl+] detach without kill, canonical EOF, fresh chat, session cleanup and raw/cursor restoration'+('; unsolicited ready/ended notices stay local and unsubscribe on exit' if lesson=='03-job-lifecycle' else ''))
   finally:terminal.close()
 with tempfile.TemporaryDirectory(prefix='hello-agent26-pty-shutdown-') as temporary:
  work=pathlib.Path(temporary).resolve();(work/'package.json').write_text('{"type":"module"}')
  (work/'harness.mjs').write_text(HARNESS.replace('DIST',dist.as_posix()).replace('FIXTURES',(ROOT/'tests/runtime-fixtures.mjs').as_posix()).replace('SHUTDOWN_ONLY','true').replace('LIFECYCLE',str(lesson=='03-job-lifecycle').lower()))
  terminal=f.Terminal(['node',str(work/'harness.mjs')],work,work,40,110)
  try:
   terminal.until('Hello, My Agent');wait_file(terminal,work/'job-id');terminal.read(.2)
   terminal.send('/fg '+(work/'job-id').read_text());terminal.until('NATIVE_TTY:true:true')
   terminal.process.send_signal(signal.SIGTERM);end=time.monotonic()+8
   while terminal.process.poll() is None and time.monotonic()<end:terminal.read()
   terminal.read();assert terminal.process.poll()==143,(terminal.process.poll(),terminal.output[-4000:])
   assert json.loads((work/'report.json').read_text())['closed']
   mask=termios.ECHO|termios.ICANON;assert termios.tcgetattr(terminal.slave)[3]&mask==terminal.before[3]&mask
   assert b'\x1b[?25h' in terminal.output and b'\x1b[?1049l' in terminal.output
   for pid in json.loads((work/'owned-pids').read_text()):
    try:os.kill(pid,0);raise AssertionError('owned process survived SIGTERM: '+str(pid))
    except ProcessLookupError:pass
   print(f'✓ 26 {lesson}: SIGTERM during foreground takeover returns terminal ownership, awaits all owned jobs and exits 143 with raw/cursor/screen restored')
  finally:terminal.close()
