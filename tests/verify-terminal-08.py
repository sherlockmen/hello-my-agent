"""08.3 真实 PTY 回归：需要 macOS/Linux 与 Python 3，先构建 08.3。"""
import os, pty, subprocess, select, time, tempfile, pathlib, json, shutil, sys
workspace=tempfile.mkdtemp(prefix='hello-agent-pty-')
pathlib.Path(workspace,'package.json').write_text('{}')
harness=pathlib.Path(workspace,'harness.mjs')
module=pathlib.Path(__file__).resolve().parents[1]/'dist/ui/terminal.js'
harness.write_text('''import {startTerminal} from '''+json.dumps(module.as_uri())+''';
await startTerminal({async generate(messages,signal){
 const text=messages.at(-1).content;
 if(text==='approval') return {text:'',toolCalls:[{id:'write1',name:'write_file',arguments:JSON.stringify({path:'never.txt',content:'no'})}],finishReason:'tool_calls',inputTokens:1,outputTokens:1,truncated:false};
 return {text:'RECEIVED:'+text,toolCalls:[],finishReason:'stop',inputTokens:1,outputTokens:1,truncated:false};
}});''')
master,slave=pty.openpty()
p=subprocess.Popen(['node',str(harness)],cwd=workspace,stdin=slave,stdout=slave,stderr=slave,env={'PATH':os.environ['PATH'],'HOME':workspace})
os.close(slave)
output=b''
def until(text):
 global output
 target=text.encode(); start=len(output); end=time.time()+5
 while time.time()<end:
  if target in output[start:]:return
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try:d=os.read(master,65536)
   except OSError:break
   if not d:break
   output+=d
 raise AssertionError('未出现 '+text+'\n'+output.decode(errors='replace'))
try:
 until(' > '); os.write(master,b'approval\r'); until('请选择')
 os.write(master,b'y'); time.sleep(.03); os.write(master,b'\x03'); until('已取消本轮')
 os.write(master,b'next\r'); until('RECEIVED:')
 time.sleep(.1)
 if select.select([master],[],[],0)[0]:output+=os.read(master,65536)
 assert b'RECEIVED:next' in output, output.decode(errors='replace')
 assert not pathlib.Path(workspace,'never.txt').exists()
 os.write(master,b'\x03' if '--idle-sigint' in sys.argv else b'/exit\r')
 end=time.time()+3
 while p.poll() is None and time.time()<end:
  if select.select([master],[],[],0.1)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
 assert p.poll() is not None, output.decode(errors='replace')
 assert p.returncode==(130 if '--idle-sigint' in sys.argv else 0)
 print('PTY验证通过：审批中键入y再取消，新问题仍按next读取，文件未创建。')
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master);shutil.rmtree(workspace)
