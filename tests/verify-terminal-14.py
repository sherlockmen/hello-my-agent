# -*- coding: utf-8 -*-
"""第14章真实PTY验证，复用13章终端夹具，不访问真实模型。"""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import tempfile
import time
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('terminal13', ROOT / 'tests/verify-terminal-13.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Terminal = module.Terminal
HARNESS = r'''
import assert from 'node:assert/strict';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
import {resolve} from 'node:path';
import {startTui} from './dist/ui/tui/app.js';
import {createSessionWriter} from './dist/sessions/save-session.js';
import {readSession} from './dist/sessions/read-session.js';
import {createFileCheckpointStore} from './dist/sessions/file-checkpoints.js';
const directory=resolve('sessions'), writer=await createSessionWriter(directory);
const store=createFileCheckpointStore(writer.id,directory);
await writeFile('add.ts','BEFORE_CONTENT');
const point=await store.record('add.ts','BEFORE_CONTENT','AFTER_CONTENT',process.cwd());
await writeFile('add.ts','AFTER_CONTENT');
await writeFile('initial.json',JSON.stringify({point,id:writer.id}));
const delayed={...writer,async save(state,reason){
 if(reason==='file_restore'){await writeFile('restore-held','1');await setTimeout(900);}
 const result=await writer.save(state,reason);
 if(reason==='file_restore') await writeFile('restore-done','1');
 return result;
}};
let calls=0;
try {
 await startTui({async generate(messages,signal,onText){
  calls++; await appendFile('requests.jsonl',JSON.stringify(messages)+'\n');
  assert(messages.some(x=>x.role==='user'&&x.content.includes('[本地文件恢复通知]')));
  assert.equal(await readFile('add.ts','utf8'),'BEFORE_CONTENT');
  assert.equal(messages.at(-1).content,'NEXT_REQUIREMENT');
  await setTimeout(800);onText?.('MODEL_READY');
  return {text:'MODEL_READY',toolCalls:[],finishReason:'stop',inputTokens:1,outputTokens:1,truncated:false};
 }},'execute',delayed,undefined,store);
 assert.equal(calls,1);
} finally {await writer.close();}
await writeFile('final.json',JSON.stringify(await readSession(writer.id,directory)));
'''

def main():
    temp = pathlib.Path(tempfile.mkdtemp(prefix='hello-agent-14-pty-'))
    terminal = None
    try:
        (temp / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        (temp / 'package.json').write_text('{"type":"module"}')
        src = ROOT / 'chapter-14-session-checkpoints/03-review-and-restore/src'
        config = temp / 'tsconfig.json'
        config.write_text(json.dumps({'extends': str(ROOT / 'tsconfig.json'), 'compilerOptions': {'noEmit': False, 'noEmitOnError': True, 'rootDir': str(src), 'outDir': str(temp / 'dist'), 'typeRoots': [str(ROOT / 'node_modules/@types')]}, 'include': [str(src / 'cli.ts')]}))
        subprocess.run(['node', str(ROOT / 'node_modules/typescript/bin/tsc'), '-p', str(config)], check=True, timeout=60)
        work = temp / 'workspace'; work.mkdir(); (work / 'package.json').write_text('{}')
        harness = temp / 'harness.mjs'; harness.write_text(HARNESS)
        terminal = Terminal(['node', str(harness)], work, temp)
        terminal.until('Hello, My Agent')
        data = json.loads((work / 'initial.json').read_text())
        requests = lambda: (work / 'requests.jsonl').read_text().splitlines() if (work / 'requests.jsonl').exists() else []
        start = terminal.send('/changes'); terminal.until('add.ts', start)
        assert requests() == []
        start = terminal.send('/restore ' + data['point']); terminal.until('写回修改前的完整原文', start)
        assert (work / 'add.ts').read_text() == 'AFTER_CONTENT'
        start = terminal.send('/restore ' + data['point'] + ' confirm')
        terminal.send('MUST_NOT_RUN_DURING_RESTORE')
        terminal.read(.15)
        assert requests() == [], '恢复及通知保存占用期间启动了模型'
        deadline=time.monotonic()+8
        while not (work / 'restore-done').exists() and time.monotonic()<deadline: terminal.read(.05)
        assert (work / 'restore-done').exists(), '恢复通知未保存'
        terminal.read(.2)
        assert (work / 'restore-held').exists()
        assert (work / 'add.ts').read_text() == 'BEFORE_CONTENT'
        start = terminal.send('NEXT_REQUIREMENT')
        deadline=time.monotonic()+8
        while not requests() and time.monotonic()<deadline: terminal.read(.05)
        assert requests(), '未启动新任务：' + terminal.output[-5000:].decode(errors='replace')
        busy = terminal.send('/changes'); terminal.until('本地命令需等待本轮结束', busy)
        terminal.until('MODEL_READY', start)
        terminal.read(.25)
        # 忙碌时本地命令保留草稿，空闲再按Enter才执行。
        later = terminal.key(b'\r'); terminal.until('add.ts', later)
        assert len(requests()) == 1
        terminal.send('/exit'); terminal.finish()
        final = json.loads((work / 'final.json').read_text())
        assert any(x['content'].startswith('[本地文件恢复通知]') for x in final['state']['messages'] if x['role'] == 'user')
        assert not list((work / 'sessions').glob('*.lock'))
        print('✓ 14.3 真实PTY：查看/预览/确认；恢复保存期间阻止新输入；忙碌本地命令保留；通知进入下一请求与历史；退出释放锁/恢复终端')
    finally:
        if terminal: terminal.close()
        shutil.rmtree(temp, ignore_errors=True)
if __name__ == '__main__': main()
