"""第十三章真实 PTY 检查：恢复后待机、沿用上下文、重新审批和退出保存。"""
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time


ROOT = pathlib.Path(__file__).resolve().parents[1]
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')


class Terminal:
    def __init__(self, command, cwd, home):
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 110, 0, 0))
        self.output = b''
        try:
            self.process = subprocess.Popen(command, cwd=cwd, stdin=self.slave,
                stdout=self.slave, stderr=self.slave, env={
                    'PATH': os.environ['PATH'], 'HOME': str(home),
                    'TERM': 'xterm-256color', 'NO_COLOR': '1',
                })
        except BaseException:
            os.close(self.master)
            os.close(self.slave)
            raise

    def read(self, seconds=.1):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([self.master], [], [], .03)[0]:
                try:
                    self.output += os.read(self.master, 65536)
                except OSError:
                    return

    def until(self, text, start=0, timeout=8):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            if text in ANSI.sub('', self.output[start:].decode(errors='replace')):
                return
            if self.process.poll() is not None:
                self.read()
                break
            self.read()
        raise AssertionError('未出现：' + text + '\n' +
            ANSI.sub('', self.output[-10000:].decode(errors='replace')))

    def key(self, key):
        start = len(self.output)
        os.write(self.master, key)
        self.read(.12)
        return start

    def send(self, text):
        start = self.key(text.encode())
        self.key(b'\r')
        return start

    def finish(self):
        until = time.monotonic() + 8
        while self.process.poll() is None and time.monotonic() < until:
            self.read()
        assert self.process.poll() == 0, (self.process.poll(), self.output[-4000:])
        self.read()
        after = termios.tcgetattr(self.slave)
        mask = termios.ECHO | termios.ICANON
        assert after[3] & mask == self.before[3] & mask, '退出后终端回显/规范输入没有恢复'
        assert b'\x1b[?25h' in self.output, '退出后没有恢复光标'
        assert b'\x1b[?1049l' in self.output, '退出后没有恢复原屏幕'

    def close(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        os.close(self.master)
        os.close(self.slave)


HARNESS = r'''
import assert from 'node:assert/strict';
import {appendFile, mkdir, readdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startTui} from './dist/ui/tui/app.js';
import {createSessionWriter, resumeSessionWriter} from './dist/sessions/save-session.js';
import {readSession} from './dist/sessions/read-session.js';

const directory = resolve('sessions');
const oldCall = {id:'old-read',name:'read_file',arguments:JSON.stringify({path:'.agents/recovery.txt',offset:1,limit:1})};
const oldWrite = {id:'old-write',name:'write_file',arguments:JSON.stringify({path:'old-replay-must-not-exist.txt',content:'REPLAYED_OLD_TOOL'})};
const seed = {
  messages:[
    {role:'user',content:'OLD_USER_REQUIREMENT'},
    {role:'assistant',content:'OLD_ASSISTANT_INVESTIGATION',toolCalls:[oldCall,oldWrite]},
    {role:'tool',toolCallId:oldCall.id,content:'1: OLD_TOOL_RESULT',isError:false},
    {role:'tool',toolCallId:oldWrite.id,content:'OLD_WRITE_COMPLETED',isError:false},
    {role:'assistant',content:'OLD_ASSISTANT_DONE'},
  ],
  mode:'plan',
  tasks:[{id:'inspect',text:'恢复前的调查清单',status:'in_progress'},{id:'verify',text:'恢复前的验证清单',status:'pending'}],
  pendingInputs:[{id:7,text:'OLD_QUEUE_MUST_STAY',run:3}],
  run:3,
  nextInputId:8,
};
await mkdir('.agents');
await writeFile('.agents/recovery.txt', 'FRESH_READ_AFTER_APPROVAL\n');
const original = await createSessionWriter(directory);
try {
  // 模拟曾持有只读授权的进程；writer 必须只复制约定的持久状态。
  await original.save({...seed,grants:['read_file:.agents/**']}, 'run_end');
} finally { await original.close(); }
assert.equal((await readdir(directory)).filter(name=>name.endsWith('.lock')).length,0);
assert.deepEqual((await readSession(original.id,directory)).state,seed);
const writer = await resumeSessionWriter(original.id,directory);
try {
  const initial = writer.restored?.state;
  assert.deepEqual(initial,seed);
  const locks = (await readdir(directory)).filter(name=>name.endsWith('.lock'));
  assert.equal(locks.length,1,'恢复期间必须独占一个进程锁');
  await writeFile('initial.json',JSON.stringify({id:writer.id,path:writer.path,locks,seed}));
  let calls = 0;
  const result = (text,toolCalls=[]) => ({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:1,outputTokens:1,truncated:false});
  await startTui({async generate(messages,signal,onText,options){
    signal.throwIfAborted();
    calls++;
    await appendFile('requests.jsonl',JSON.stringify({messages,mode:options?.mode})+'\n');
    assert.deepEqual(messages.slice(0,seed.messages.length),seed.messages);
    assert.equal(messages.filter(message=>message.role==='user').at(-1).content,'NEW_REQUIREMENT');
    assert.equal(options?.mode,'plan');
    assert(!JSON.stringify(messages).includes('OLD_QUEUE_MUST_STAY'));
    if(calls===1) return result('',[{id:'fresh-read',name:'read_file',arguments:oldCall.arguments}]);
    assert.equal(calls,2,'恢复或旧队列不得自动增加模型请求');
    assert.equal(messages.at(-1).role,'tool');
    assert.equal(messages.at(-1).toolCallId,'fresh-read');
    assert.equal(messages.at(-1).isError,false);
    assert(messages.at(-1).content.includes('FRESH_READ_AFTER_APPROVAL'));
    onText?.('RESUMED_REPLY');
    return result('RESUMED_REPLY');
  }},initial.mode,writer,initial);
  assert.equal(calls,2);
} finally { await writer.close(); }
assert.equal((await readdir(directory)).filter(name=>name.endsWith('.lock')).length,0);
await writeFile('final.json',JSON.stringify(await readSession(original.id,directory)));
'''


QUEUE_HARNESS = r"""
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';
import {resolve} from 'node:path';
import {startTui} from './dist/ui/tui/app.js';
import {createSessionWriter,resumeSessionWriter} from './dist/sessions/save-session.js';
const scenario = process.argv[2];
const directory = resolve('sessions');
const state = {messages:[],mode:'plan',tasks:[],pendingInputs:[{id:7,text:'RESEND_SAVED_TEXT',run:3}],run:3,nextInputId:8};
const original = await createSessionWriter(directory);
await original.save(state,'run_end'); await original.close();
const writer = await resumeSessionWriter(original.id,directory);
await writeFile('session-path.txt',writer.path);
const uiWriter = scenario === 'failed-start' ? {...writer, async save(state,reason) {
  if(reason === 'run_start') throw new Error('START_SAVE_FAILED');
  return writer.save(state,reason);
}} : writer;
try {
  await startTui({async generate(messages,signal) {
    await writeFile('model-started.txt',JSON.stringify(messages));
    if(scenario === 'edited') while(!existsSync('release-model.txt')) { signal.throwIfAborted(); await setTimeout(20); }
    if(scenario === 'crash') await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    return {text:'RESENT_DONE',toolCalls:[],finishReason:'stop',inputTokens:1,outputTokens:1,truncated:false};
  }},state.mode,uiWriter,state);
} finally { await writer.close(); }
"""


def verify_queue_resend(temp):
    harness = temp / 'queue-harness.mjs'
    harness.write_text(QUEUE_HARNESS)
    for scenario in ['crash', 'failed-start', 'success', 'edited']:
        work = temp / ('queue-' + scenario)
        work.mkdir()
        terminal = Terminal(['node', str(harness), scenario], work, temp)
        try:
            terminal.until('会话已恢复；等待新要求')
            terminal.key(b'\x0f')
            terminal.key(b'\x0f')
            terminal.until('#7 [第3轮] RESEND_SAVED_TEXT')
            terminal.key(b'\r')
            if scenario == 'crash':
                deadline = time.monotonic() + 8
                while not (work / 'model-started.txt').exists() and time.monotonic() < deadline:
                    terminal.read()
                assert (work / 'model-started.txt').exists(), '重发没有进入新任务'
                terminal.process.kill()
                terminal.process.wait(timeout=4)
            else:
                if scenario == 'edited':
                    terminal.key(b'e')
                    terminal.until('Enter 保存原条目')
                    terminal.key(b'\x15')
                    terminal.send('RESEND_EDITED_TEXT')
                    terminal.until('会话已保存：检查点 #3')
                    (work / 'release-model.txt').write_text('continue')
                terminal.until('会话已保存：检查点 #' + ('2' if scenario == 'failed-start' else '4' if scenario == 'edited' else '3'))
                if scenario == 'failed-start':
                    assert not (work / 'model-started.txt').exists(), '开始检查点失败后仍调用模型'
                terminal.key(b'\x04')
                terminal.finish()
            path = pathlib.Path((work / 'session-path.txt').read_text())
            records = [json.loads(line) for line in path.read_text().splitlines()]
            checkpoints = [row for row in records if row['type'] == 'checkpoint']
            start = next((row for row in checkpoints if row['reason'] == 'run_start'), None)
            if start:
                assert start['state']['pendingInputs'] == [{'id': 7, 'text': 'RESEND_SAVED_TEXT', 'run': 3}], '新任务开始前丢掉了已保存补充'
            last = checkpoints[-1]['state']
            if scenario == 'success':
                assert last['pendingInputs'] == [], '进入历史后旧队列应移出'
                assert last['messages'].count({'role': 'user', 'content': 'RESEND_SAVED_TEXT'}) == 1
            elif scenario == 'edited':
                assert last['pendingInputs'] == [{'id': 7, 'text': 'RESEND_EDITED_TEXT', 'run': 3}], '重发期间修改的旧补充不能被误删'
                assert last['messages'].count({'role': 'user', 'content': 'RESEND_SAVED_TEXT'}) == 1
            else:
                assert last['pendingInputs'] == [{'id': 7, 'text': 'RESEND_SAVED_TEXT', 'run': 3}], '崩溃/开始保存失败不能丢已保存文字'
        finally:
            terminal.close()
    print('✓ 13.3 真实PTY重发：开始检查点保留原补充，崩溃/开始失败不丢文字，进入历史后再移出，运行中修改仍保留', flush=True)


def main():
    temp = pathlib.Path(tempfile.mkdtemp(prefix='hello-agent-session-tui-'))
    terminal = None
    try:
        (temp / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        (temp / 'package.json').write_text('{"type":"module"}')
        source = ROOT / 'chapter-13-session-persistence/03-resume-session/src'
        (temp / 'tsconfig.json').write_text(json.dumps({
            'extends': str(ROOT / 'tsconfig.json'),
            'compilerOptions': {
                'noEmit': False, 'noEmitOnError': True, 'rootDir': str(source),
                'outDir': str(temp / 'dist'), 'typeRoots': [str(ROOT / 'node_modules/@types')],
            },
            'include': [str(source / 'cli.ts')],
        }))
        subprocess.run(['node', str(ROOT / 'node_modules/typescript/bin/tsc'),
            '-p', str(temp / 'tsconfig.json')], check=True, timeout=60)
        work = temp / 'workspace'
        work.mkdir()
        (work / 'package.json').write_text('{}')
        harness = temp / 'harness.mjs'
        harness.write_text(HARNESS)

        def requests():
            path = work / 'requests.jsonl'
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

        terminal = Terminal(['node', str(harness)], work, temp)
        terminal.until('会话已恢复；等待新要求')
        terminal.until('OLD_USER_REQUIREMENT')
        terminal.until('OLD_ASSISTANT_DONE')
        terminal.until('恢复前的调查清单')
        terminal.until('0/2 已完成')
        terminal.until('模式：plan')
        initial = json.loads((work / 'initial.json').read_text())
        assert all((work / 'sessions' / lock).exists() for lock in initial['locks']), '恢复锁没有保持到界面运行'
        assert requests() == [], '进入恢复界面就请求了模型'
        assert not (work / 'old-replay-must-not-exist.txt').exists(), '恢复时重放了历史写工具'
        terminal.key(b'\x0f')
        start = terminal.key(b'\x0f')
        terminal.until('待发送队列 [焦点]', start)
        terminal.until('#7 [第3轮] OLD_QUEUE_MUST_STAY', start)
        terminal.key(b'\x0f')
        start = terminal.send('/permissions')
        terminal.until('当前没有会话授权。', start)
        assert requests() == [], '查看恢复状态或本地授权触发了模型'
        print('✓ 13.3 真实PTY恢复旧消息/清单/队列，首次进入零请求且不恢复授权', flush=True)

        start = terminal.send('NEW_REQUIREMENT')
        terminal.until('等待批准', start)
        assert len(requests()) == 1, '审批前只应发送一次新请求'
        assert 'FRESH_READ_AFTER_APPROVAL' not in json.dumps(requests()), '审批前已执行受保护读取'
        start = terminal.send('s')
        terminal.until('RESUMED_REPLY', start)
        terminal.until('会话已保存：检查点 #3', start)
        assert len(requests()) == 2, '同一轮应只有工具请求和结果后的回答两次调用'
        assert requests()[0]['messages'] == initial['seed']['messages'] + [{'role': 'user', 'content': 'NEW_REQUIREMENT'}]
        assert all(row['mode'] == 'plan' for row in requests())
        assert all('OLD_QUEUE_MUST_STAY' not in json.dumps(row['messages']) for row in requests())
        start = terminal.send('/permissions')
        terminal.until('read_file:.agents/**', start)
        assert len(requests()) == 2, '本地权限查询触发了额外模型请求'
        print('✓ 13.3 新要求沿用旧上下文与Plan模式，真实审批后读文件，旧队列不跨轮投递', flush=True)

        terminal.key(b'\x04')
        terminal.finish()
        final = json.loads((work / 'final.json').read_text())
        records = [json.loads(line) for line in pathlib.Path(initial['path']).read_text().splitlines()]
        checkpoints = [record for record in records if record['type'] == 'checkpoint']
        assert [record['reason'] for record in checkpoints] == ['run_end', 'run_start', 'run_end', 'exit']
        assert [record['seq'] for record in checkpoints] == [1, 2, 3, 4], '恢复追加应沿用原序号'
        assert [record['state']['run'] for record in checkpoints] == [3, 4, 4, 4], '一条新要求必须只创建一个递增的新run'
        assert final['seq'] == 4 and final['lastReason'] == 'exit' and not final['interrupted']
        state = final['state']
        assert state['pendingInputs'] == initial['seed']['pendingInputs'], '旧队列ID、内容或任务归属被改写'
        assert state['nextInputId'] == 8 and state['run'] == 4
        assert state['mode'] == 'plan' and state['tasks'] == initial['seed']['tasks']
        assert state['messages'][:len(initial['seed']['messages'])] == initial['seed']['messages']
        assert state['messages'][-1] == {'role': 'assistant', 'content': 'RESUMED_REPLY'}
        assert state['messages'].count({'role': 'user', 'content': 'NEW_REQUIREMENT'}) == 1
        assert all('grants' not in record.get('state', {}) for record in checkpoints)
        assert not list((work / 'sessions').glob('*.lock')), '正常退出后锁没有释放'
        assert not (work / 'old-replay-must-not-exist.txt').exists(), '新任务期间重放了历史写工具'
        print('✓ 13.3 Ctrl+D追加run_end/exit，队列归属与编号不变，锁/终端/光标/原屏幕恢复', flush=True)
        terminal.close()
        terminal = None
        verify_queue_resend(temp)
    finally:
        if terminal is not None:
            terminal.close()
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == '__main__':
    main()
