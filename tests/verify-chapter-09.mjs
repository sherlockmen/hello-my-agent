/** 第九章：事件顺序、消费取消、有限缓冲、双协议 JSONL 和输出约定。使用本地模型替身。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli, isolatedEnv } from './verify-chat.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'hello-agent-09-'));
const workspace = join(temp, 'workspace');
mkdirSync(workspace);
writeFileSync(join(workspace, 'package.json'), '{}');
writeFileSync(join(workspace, 'input.txt'), 'alpha\nbeta\n');
const previous = process.cwd();
const delay = ms => new Promise(r => setTimeout(r, ms));
const signal = () => new AbortController().signal;
const reply = (text, toolCalls = []) => ({ text, toolCalls, finishReason: toolCalls.length ? 'tool_calls' : 'stop', inputTokens: 1, outputTokens: 1, truncated: false });
const readCall = { id: 'read_1', name: 'read_file', arguments: JSON.stringify({ path: 'input.txt', offset: 1, limit: 20 }) };
const writeCall = { id: 'write_1', name: 'write_file', arguments: JSON.stringify({ path: 'blocked.txt', content: 'must not be written' }) };
let serve;
const requests = [];
const server = createServer(async (req, res) => {
  try { let raw=''; for await (const part of req) raw += part; const body=JSON.parse(raw); requests.push(body); await serve(body,res); }
  catch (error) { res.destroy(error); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const env = { HOME: temp, OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture', OPENAI_BASE_URL: endpoint,
  ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_MODEL: 'fixture', ANTHROPIC_BASE_URL: endpoint };

function compile(lesson) {
  const base=join(temp,lesson); mkdirSync(base);
  symlinkSync(join(root,'node_modules'),join(base,'node_modules'));
  writeFileSync(join(base,'package.json'),'{"type":"module","version":"0.1.0"}');
  const src=join(root,'chapter-09-observable-runs',lesson,'src');
  writeFileSync(join(base,'tsconfig.json'),JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:false,rootDir:src,outDir:join(base,'dist'),typeRoots:[join(root,'node_modules/@types')]},include:[join(src,'cli.ts')]}));
  execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(base,'tsconfig.json')]);
  chmodSync(join(base,'dist/cli.js'),0o755); return join(base,'dist');
}
function sequence(records) {
  assert.equal(records[0].event.type,'run_start');
  assert.equal(records.at(-1).event.type,'run_finish');
  assert.equal(records.filter(r=>r.event.type==='run_finish').length,1);
  assert.equal(new Set(records.map(r=>r.runId)).size,1);
  assert.ok(records[0].runId);
  records.forEach((r,i)=>{assert.equal(r.version,1);assert.equal(r.sequence,i+1);});
}
function sse(body,res,{text='第一行\n第二行',call,reason,keepOpen=false}={}) {
  const anthropic=Array.isArray(body.tools) && 'input_schema' in body.tools[0];
  res.setHeader('content-type','text/event-stream');
  const send=e=>res.write(`${anthropic?'event: '+e.type+'\n':''}data: ${JSON.stringify(e)}\n\n`);
  if(anthropic) {
    send({type:'message_start',message:{id:'m1',type:'message',role:'assistant',model:'fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
    send({type:'content_block_start',index:0,content_block:call?{type:'tool_use',id:call.id,name:call.name,input:{}}:{type:'text',text:''}});
    send({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:call.arguments}:{type:'text_delta',text}});
    if(keepOpen) return;
    send({type:'content_block_stop',index:0});
    send({type:'message_delta',delta:{stop_reason:reason??(call?'tool_use':'end_turn'),stop_sequence:null},usage:{output_tokens:2}});
    send({type:'message_stop'});
  } else {
    const frame=(delta,finish_reason=null)=>({id:'m1',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
    send(frame(call?{role:'assistant',tool_calls:[{index:0,id:call.id,type:'function',function:{name:call.name,arguments:call.arguments}}]}:{role:'assistant',content:text}));
    if(keepOpen) return;
    send(frame({},reason??(call?'tool_calls':'stop'))); res.write('data: [DONE]\n\n');
  }
  res.end();
}
try {
  process.chdir(workspace);
  let latest;
  for(const [i,lesson] of ['01-run-lifecycle','02-event-stream','03-jsonl-output'].entries()) {
    const dist=compile(lesson);latest=dist;
    const {runAgent}=await import(pathToFileURL(join(dist,'agent/run.js')));
    const events=[]; let calls=0;
    const model={async generate(messages,_signal,onText){
      if(calls++===0) return reply('',[readCall]);
      assert.match(messages.at(-1).content,/alpha/);onText?.('读到两行');return reply('读到两行');
    }};
    const history=[];
    assert.equal((await runAgent(model,history,'读文件',signal(),e=>events.push(e))).text,'读到两行');
    assert.equal(events[0].type,'run_start');assert.equal(events.at(-1).outcome,'completed');
    assert.equal(events.filter(e=>e.type==='model_finish').length,2);
    assert.equal(events.filter(e=>e.type==='run_finish').length,1);
    assert.ok(events.findIndex(e=>e.type==='tool_finish')<events.findLastIndex(e=>e.type==='model_start'));
    const badEvents=[];
    await assert.rejects(runAgent({async generate(){throw new Error('simulated');}},[],'失败',signal(),e=>badEvents.push(e)));
    assert.equal(badEvents.at(-1).outcome,'error');
    const cancelled=[];const ctrl=new AbortController();ctrl.abort();
    await assert.rejects(runAgent(model,[],'取消',ctrl.signal,e=>cancelled.push(e)));
    assert.equal(cancelled.at(-1).outcome,'cancelled');
    await runAgent({async generate(){return reply('original');}},[],'隔离',signal(),e=>{if(e.type==='run_finish')e.reply.text='changed';throw new Error('observer');});
    if(i===0) continue;
    const {streamAgentRun}=await import(pathToFileURL(join(dist,'agent/run-stream.js')));
    const records=[];
    for await(const event of streamAgentRun({async generate(_m,_s,onText){onText?.('一');await delay(2);onText?.('二');return reply('一二');}},[],'顺序',signal())) { records.push(event);await delay(1); }
    sequence(records);assert.equal(records.filter(r=>r.event.type==='text_delta').map(r=>r.event.text).join(''),'一二');
    const other=[];for await(const r of streamAgentRun({async generate(){return reply('ok');}},[],'另一轮',signal()))other.push(r);
    assert.notEqual(other[0].runId,records[0].runId);
    let cleaned=false;
    const waiting={async generate(_m,s){try{await new Promise((_,reject)=>{if(s.aborted)reject(s.reason);else s.addEventListener('abort',()=>reject(s.reason),{once:true});});}finally{await delay(5);cleaned=true;}}};
    for await(const _record of streamAgentRun(waiting,[],'停止接收',signal()))break;
    assert.equal(cleaned,true,'break 必须等待执行清理');
    const flooded=[];const floodedHistory=[];
    await assert.rejects(async()=>{for await(const r of streamAgentRun({async generate(_m,s,onText){for(let j=0;j<500;j++)onText?.('x');s.throwIfAborted();return reply('x');}},floodedHistory,'积压',signal()))flooded.push(r);},/接收速度/);
    assert.ok(flooded.length<=129);sequence(flooded);assert.equal(flooded.at(-1).event.outcome,'error');assert.match(floodedHistory.at(-1).content,/因错误中断/);
    console.log(`✓ 09.${i+1}：真实读取、事件顺序、独立轮次、提前退出与有界积压通过`);
  }
  const cli=join(latest,'cli.js');
  const invoke=(args,prompt='读取')=>runCli(cli,['--prompt',prompt,...args],workspace,env);
  for(const provider of ['openai','anthropic']) {
    requests.length=0;
    serve=(body,res)=>sse(body,res,{call:requests.length===1?readCall:undefined});
    const output=await invoke(['--provider',provider,'--output','jsonl']);
    assert.equal(output.status,0,output.stderr);assert.equal(output.stderr,'');
    const records=output.stdout.trim().split('\n').map(JSON.parse);sequence(records);
    assert.equal(records.at(-1).event.reply.text,'第一行\n第二行');
    assert.ok(records.some(r=>r.event.type==='tool_finish'&&r.event.result.content.includes('alpha')));
    assert.equal(requests.length,2);
    assert.match(JSON.stringify(requests[1].messages),/alpha/);
    requests.length=0;
    serve=(body,res)=>sse(body,res,{call:requests.length===1?writeCall:undefined});
    const denied=await invoke(['--provider',provider,'--output','jsonl'],'创建文件');
    assert.equal(denied.status,0,denied.stderr);assert.equal(existsSync(join(workspace,'blocked.txt')),false);
    const denial=denied.stdout.trim().split('\n').map(JSON.parse);
    assert.ok(denial.some(r=>r.event.type==='approval_finish'&&r.event.response.decision==='deny'));
    assert.ok(!denial.some(r=>r.event.type==='tool_start'));assert.doesNotMatch(denied.stdout,/请选择/);
    serve=(body,res)=>sse(body,res);
    const text=await invoke(['--provider',provider]);
    assert.equal(text.status,0,text.stderr);assert.match(text.stdout,/第一行\n第二行/);
    assert.doesNotMatch(text.stdout,/模型 >|用量：|权限/);assert.match(text.stderr,/模型 >|用量：/);
  }
  requests.length=0;
  assert.equal((await invoke(['--output','invalid'])).status,1);
  assert.equal((await runCli(cli,['--output','jsonl'],workspace,env)).status,1);
  assert.equal(requests.length,0);
  serve=(_b,res)=>{res.writeHead(401,{'content-type':'application/json'});res.end('{"error":{"message":"server-secret-do-not-log"}}');};
  const failed=await invoke(['--output','jsonl']);assert.equal(failed.status,1);
  const failures=failed.stdout.trim().split('\n').map(JSON.parse);sequence(failures);assert.equal(failures.at(-1).event.outcome,'error');
  assert.doesNotMatch(failed.stdout+failed.stderr,/server-secret/);
  // SIGINT 发生在真实网络请求等待中：结束事件与退出码表达同一次取消。
  let child;
  serve=(body,res)=>{sse(body,res,{keepOpen:true});setTimeout(()=>child.kill('SIGINT'),20);};
  const cancel=await runCli(cli,['--prompt','等待','--output','jsonl'],workspace,env,'',c=>{child=c;});
  assert.equal(cancel.status,130,cancel.stderr);const cancelled=cancel.stdout.trim().split('\n').map(JSON.parse);sequence(cancelled);assert.equal(cancelled.at(-1).event.outcome,'cancelled');
  // 模拟下游关闭读取端，检查请求连接随输出失败一起关闭，而不是遗留执行。
  let networkClosed=false;
  serve=(body,res)=>{
    sse(body,res,{keepOpen:true});
    const timer=setInterval(()=>res.write('data: '+JSON.stringify({id:'m1',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:'next'},finish_reason:null}]})+'\n\n'),20);
    res.on('close',()=>{networkClosed=true;clearInterval(timer);});
  };
  const broken=await new Promise((resolve,reject)=>{
    const p=spawn(cli,['--prompt','等待','--output','jsonl'],{cwd:workspace,env:isolatedEnv(env),stdio:['ignore','pipe','pipe']});
    let stderr='';let closed=false;
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('输出断开后没有结束'));},10000);
    p.stdout.on('data',data=>{if(!closed&&data.toString().includes('text_delta')){closed=true;p.stdout.destroy();}});
    p.stderr.on('data',s=>stderr+=s);
    p.on('error',reject);p.on('close',status=>{clearTimeout(timer);resolve({status,stderr});});
  });
  assert.equal(broken.status,1,broken.stderr);assert.equal(networkClosed,true);assert.match(broken.stderr,/标准输出/);
  // 下游保持打开但不读取：待写行也必须响应取消，不能只取消模型。
  const blockedOutputSource = `import {runJsonlPrompt} from ${JSON.stringify(pathToFileURL(join(latest,'ui/jsonl.js')).href)};
    await runJsonlPrompt({async generate(_messages,signal,onText){
      process.stderr.write('ready\\n');
      onText('x'.repeat(1_000_000));
      try { await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})); }
      finally { process.stderr.write('model-cleaned\\n'); }
    }}, '输出阻塞实验');`;
  const blocked=await new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,['--input-type=module','-e',blockedOutputSource],{cwd:workspace,env:isolatedEnv(env),stdio:['ignore','pipe','pipe']});
    let stderr='';let sent=false;
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('取消后仍在等待未读取的输出管道'));},10000);
    p.stderr.on('data',data=>{stderr+=data;if(!sent&&stderr.includes('ready')){sent=true;setTimeout(()=>p.kill('SIGINT'),20);}});
    p.on('error',reject);
    p.on('exit',()=>p.stdout.destroy());
    p.on('close',status=>{clearTimeout(timer);resolve({status,stderr});});
  });
  assert.equal(blocked.status,130,blocked.stderr);assert.match(blocked.stderr,/model-cleaned/);assert.match(blocked.stderr,/已取消/);
  console.log('✓ 09.3：双协议 JSONL、参数换行、stdout/stderr、默认拒绝审批、失败、取消与输出关闭通过');
} finally { process.chdir(previous);server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true}); }
