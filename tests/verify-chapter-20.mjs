/** 第20章：临时独立构建、假模型与真实本地钩子进程；不读真实.env、不调用在线模型。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {createServer} from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'chapter-20-hooks');
const temporary=realpathSync(mkdtempSync(join(tmpdir(),'hello-agent20-'))),cwd=process.cwd();
const lessons=['01-before-tool','02-after-tool','03-stop-hooks'];
const fixture=name=>{const path=join(temporary,name);mkdirSync(path,{recursive:true});return path;};
const file=(dir,name,body)=>{const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);return path;};
const load=(dist,path)=>import(pathToFileURL(join(dist,path)).href);
const freshSignal=()=>new AbortController().signal;
const answer=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:10,outputTokens:4,truncated:false});
const call=(id,name,args)=>({id,name,arguments:JSON.stringify(args)});
const script=(project,name,body)=>({command:process.execPath,args:[file(project,name,`import assert from 'node:assert/strict';\nimport {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';\nlet raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw);\n${body}\n`)]});
function compile(lesson){
 const src=join(source,lesson,'src'),build=fixture(`build-${lesson}`),dist=join(build,'dist');
 file(build,'package.json','{"type":"module"}');symlinkSync(join(root,'node_modules'),join(build,'node_modules'));
 file(build,'tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:false,noEmitOnError:true,rootDir:src,outDir:dist,typeRoots:[join(root,'node_modules/@types')]},include:[join(src,'**/*.ts'),join(src,'**/*.tsx')]}));
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(build,'tsconfig.json')],{stdio:'inherit'});return dist;
}
async function configured(api,project,hooks){file(project,'package.json','{}');file(project,'.hello-my-agent/hooks.json',JSON.stringify(hooks));return api.loadHooks(project,true);}
async function waitFile(path){const end=Date.now()+5000;while(!existsSync(path)&&Date.now()<end)await delay(10);assert.ok(existsSync(path),`没有收到进程握手：${path}`);}
function gone(pid){assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH',`钩子进程 ${pid} 仍然存活`);}
async function configTests(api,stage){
 const project=fixture(`config-${stage}`);file(project,'.hello-my-agent/hooks.json','invalid');
 assert.equal(await api.loadHooks(project,false),undefined,'未显式启用不得读取坏配置');
 await assert.rejects(api.loadHooks(project,true),/配置/);
 const hooks=await configured(api,project,{before_tool:[{command:process.execPath,args:[]}]});assert.equal(hooks.hooks.before_tool[0].timeout_ms,5000);
 for(const bad of [[],{unknown:[]},{before_tool:[{command:'',args:[]}]},{before_tool:[{command:'node',args:[],env:{TOKEN:'fixture'}}]},{before_tool:[{command:'node',args:[],timeout_ms:30001}]}]){
  file(project,'.hello-my-agent/hooks.json',JSON.stringify(bad));await assert.rejects(api.loadHooks(project,true),/配置/);
 }
 if(stage<3){file(project,'.hello-my-agent/hooks.json',JSON.stringify({stop:[]}));await assert.rejects(api.loadHooks(project,true),/配置/);}
 if(stage===1){file(project,'.hello-my-agent/hooks.json',JSON.stringify({after_tool:[]}));await assert.rejects(api.loadHooks(project,true),/配置/);}
 file(project,'.hello-my-agent/hooks.json',' '.repeat(32769));await assert.rejects(api.loadHooks(project,true),/32768/);
}
async function beforeFlow(api,runAgent,stage){
 const project=fixture(`before-${stage}`);process.chdir(project);let approvals=0,calls=0;
 const before=script(project,'before.mjs',`assert.equal(input.event,'before_tool');assert.equal(input.call.id,'blocked');assert.ok(existsSync('approved'));writeFileSync('hook-ran','yes');console.log(JSON.stringify({continue:false,message:'BLOCKED_BY_HOOK'}));`);
 const hooks=await configured(api,project,{before_tool:[before]}),history=[];
 const model={hooks,async generate(messages){calls++;if(calls===1)return answer('',[call('blocked','write_file',{path:'must-not-exist.txt',content:'SIDE_EFFECT'})]);const result=messages.at(-1);assert.equal(result.toolCallId,'blocked');assert.equal(result.isError,true);assert.match(result.content,/BLOCKED_BY_HOOK/);assert.ok(!existsSync('must-not-exist.txt'));return answer('BLOCK_FLOW_COMPLETE');}};
 await runAgent(model,history,'block write',freshSignal(),undefined,async()=>{approvals++;assert.ok(!existsSync('hook-ran'));file(project,'approved','yes');return{decision:'allow_once'};});
 assert.equal(calls,2);assert.equal(approvals,1);assert.ok(existsSync('hook-ran'));assert.ok(!existsSync('must-not-exist.txt'));
 // 原审批拒绝时，before_tool也不能开始，更不能用钩子代替授权。
 rmSync(join(project,'hook-ran'));calls=0;
 await runAgent({hooks,async generate(messages){calls++;if(calls===1)return answer('',[call('denied','write_file',{path:'denied.txt',content:'NO'})]);assert.equal(messages.at(-1).isError,true);return answer('DENIAL_COMPLETE');}},[],'deny write',freshSignal(),undefined,async()=>({decision:'deny',reason:'fixture rejection'}));
 assert.ok(!existsSync('hook-ran'));assert.ok(!existsSync('denied.txt'));
}
async function planFlow(api,runAgent,stage){
 const project=fixture(`plan-${stage}`);process.chdir(project);file(project,'notes.txt','PLAN_READ_BODY');
 const marker=script(project,'marker.mjs',`writeFileSync('must-not-run',input.event);console.log('{}');`),config={before_tool:[marker]};
 if(stage>1)config.after_tool=[marker];if(stage>2)config.stop=[marker];
 const hooks=await configured(api,project,config);let calls=0;
 await runAgent({hooks,async generate(messages,_signal,_onText,options){assert.equal(options.mode,'plan');calls++;if(calls===1)return answer('',[call('read','read_file',{path:'notes.txt',offset:1,limit:1}),call('write','write_file',{path:'forbidden.txt',content:'NO'})]);const results=messages.filter(m=>m.role==='tool');assert.match(results[0].content,/PLAN_READ_BODY/);assert.equal(results[0].isError,false);assert.equal(results[1].isError,true);assert.match(results[1].content,/Plan/);return answer('PLAN_COMPLETE');}},[],'inspect',freshSignal(),undefined,async()=>{throw new Error('Plan不能请求写入审批');},new Set(),{mode:'plan'});
 assert.equal(calls,2);assert.ok(!existsSync('must-not-run'));assert.ok(!existsSync('forbidden.txt'));
}
async function afterFlow(api,runAgent,stage){
 for(const failed of [false,true]){
  const project=fixture(`after-${stage}-${failed}`);process.chdir(project);let calls=0;
  const after=script(project,'after.mjs',`assert.equal(input.event,'after_tool');assert.equal(input.call.id,'written');assert.equal(input.outcome,'success');assert.match(input.result,/output.txt/);assert.equal(readFileSync('output.txt','utf8'),'REAL_TOOL_BODY');writeFileSync('after-input.json',JSON.stringify(input));${failed?"process.exit(7);":"appendFileSync('output.txt','_FORMATTED');console.log(JSON.stringify({message:'AFTER_FEEDBACK'}));"}`);
  const hooks=await configured(api,project,{after_tool:[after]});
  await runAgent({hooks,async generate(messages){calls++;if(calls===1)return answer('',[call('written','write_file',{path:'output.txt',content:'REAL_TOOL_BODY'})]);const result=messages.at(-1);assert.equal(result.toolCallId,'written');assert.equal(result.isError,false,'后置失败不得改写真实工具成功');assert.match(result.content,/output.txt/);assert.match(result.content,failed?/执行后钩子失败/:/AFTER_FEEDBACK/);assert.equal(readFileSync('output.txt','utf8'),failed?'REAL_TOOL_BODY':'REAL_TOOL_BODY_FORMATTED');return answer('AFTER_FLOW_COMPLETE');}},[],'write',freshSignal(),undefined,async()=>({decision:'allow_once'}));
  assert.equal(calls,2);assert.equal(JSON.parse(readFileSync(join(project,'after-input.json'))).call.id,'written');
 }
}
async function processBoundaries(api){
 for(const [name,body,pattern] of [
  ['invalid',"console.log('[]');",/单个 JSON/],['multiple',"console.log('{}\\n{}');",/单个 JSON/],['authority',"console.log(JSON.stringify({allow:true}));",/单个 JSON/],
  ['wrong-type',"console.log(JSON.stringify({continue:'yes'}));",/单个 JSON/],['message-limit',"console.log(JSON.stringify({message:'x'.repeat(4097)}));",/单个 JSON/],
  ['nonzero',"process.exit(9);",/退出码 9/],['output-limit',"process.stdout.write('x'.repeat(9000));setInterval(()=>{},1000);",/output_limit/]]){
  const project=fixture(`process-${name}`),hook=script(project,'hook.mjs',body),hooks=await configured(api,project,{before_tool:[hook]});
  await assert.rejects(api.runHooks(hooks,'before_tool',{call:call('boundary','read_file',{})},freshSignal()),pattern);
 }
 const project=fixture('process-timeout'),hook=script(project,'hook.mjs',"writeFileSync('pid',String(process.pid));setInterval(()=>{},1000);");hook.timeout_ms=500;
 const hooks=await configured(api,project,{before_tool:[hook]});await assert.rejects(api.runHooks(hooks,'before_tool',{},freshSignal()),/timeout/);gone(Number(readFileSync(join(project,'pid'))));
}
async function cancelFlow(api,runAgent,event){
 const project=fixture(`cancel-${event}`);process.chdir(project);let calls=0;
 const hook=script(project,'wait.mjs',`process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync('closed','yes');process.exit(0);},100));writeFileSync('pid',String(process.pid));writeFileSync('ready','yes');setInterval(()=>{},1000);`);
 const hooks=await configured(api,project,{[event]:[hook],stop:[script(project,'stop.mjs',"writeFileSync('stop-ran','bad');console.log('{}');")]}),controller=new AbortController(),history=[],events=[];
 const pending=runAgent({hooks,async generate(){calls++;assert.equal(calls,1,'取消后不得再请求模型');return answer('',[call('cancelled','write_file',{path:'output.txt',content:'KNOWN_SIDE_EFFECT'})]);}},history,'cancel',controller.signal,e=>events.push(e),async()=>({decision:'allow_once'}));
 const settled=pending.then(value=>({value}),error=>({error}));
 try{
  await waitFile(join(project,'ready'));const reason=new Error(`cancel-${event}`);controller.abort(reason);const result=await settled;assert.equal(result.error,reason);
  assert.ok(existsSync('closed'),'取消返回前必须等钩子进程close');gone(Number(readFileSync('pid')));assert.equal(calls,1);assert.ok(!existsSync('stop-ran'));
  assert.equal(existsSync('output.txt'),event==='after_tool');const resultMessage=history.find(m=>m.role==='tool'&&m.toolCallId==='cancelled');assert.ok(resultMessage);
  if(event==='after_tool'){assert.equal(resultMessage.isError,false);assert.match(resultMessage.content,/工具已返回/);assert.equal(readFileSync('output.txt','utf8'),'KNOWN_SIDE_EFFECT');}
  assert.equal(events.filter(e=>e.type==='run_finish').length,1);assert.equal(events.at(-1).outcome,'cancelled');
 }finally{if(!controller.signal.aborted)controller.abort(new Error('fixture cleanup'));await settled;}
}

async function textCliFlow(dist){
 const sockets=new Set(),service=createServer(async(req,res)=>{for await(const chunk of req){}res.setHeader('content-type','text/event-stream');
 for(const [delta,finish_reason]of[[{role:'assistant',content:'CLI_MODEL_BODY'},null],[{},'stop']])res.write(`data: ${JSON.stringify({id:'c1',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`);res.end('data: [DONE]\n\n');});service.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const run=(args,p)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:p,env:{PATH:process.env.PATH,HOME:p,OPENAI_API_KEY:'fixture-only',OPENAI_MODEL:'fixture'}});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`CLI exit ${code}: ${stderr}`)));});
 try{await new Promise(r=>service.listen(0,'127.0.0.1',r));file(dirname(dist),'package.json','{"name":"fixture","version":"0.0.0","type":"module"}');
 const p=fixture('actual-text-cli');file(p,'package.json','{"type":"module"}');const stop=script(p,'stop.mjs',"console.log(JSON.stringify({message:'CLI_STOP_FEEDBACK'}));");file(p,'.hello-my-agent/hooks.json',JSON.stringify({stop:[stop]}));
 const output=await run([join(dist,'cli.js'),'--prompt','check stop','--output','text','--base-url',`http://127.0.0.1:${service.address().port}`,'--enable-project-hooks','--session-dir',join(p,'sessions')],p);
 assert.equal(output.stdout.split('CLI_MODEL_BODY').length-1,1);assert.equal(output.stdout.split('CLI_STOP_FEEDBACK').length-1,1);assert.match(output.stdout,/本地结束钩子/);assert.doesNotMatch(output.stdout,/用量/);
 const harness=file(p,'fallback.mjs',`import{runSinglePrompt}from${JSON.stringify(pathToFileURL(join(dist,'ui/terminal.js')).href)};import{loadHooks}from${JSON.stringify(pathToFileURL(join(dist,'hooks/lifecycle.js')).href)};const hooks=await loadHooks(process.cwd(),true);await runSinglePrompt({hooks,async generate(){return{text:'FALLBACK_BODY',toolCalls:[],finishReason:'stop',inputTokens:1,outputTokens:1,truncated:false};}},'fallback');`);
 const fallback=await run([harness],p);assert.equal(fallback.stdout.split('FALLBACK_BODY').length-1,1);assert.equal(fallback.stdout.split('CLI_STOP_FEEDBACK').length-1,1);
 console.log('✓ text CLI: real streamed model and non-streaming consumer append stop feedback once without repeating body');
 }finally{for(const socket of sockets)socket.destroy();await new Promise(r=>service.listening?service.close(r):r());}
}

async function stopFlow(api,runAgent){
 for(const outcome of ['completed','error','hook-failure']){
  const project=fixture(`stop-${outcome}`);process.chdir(project);let calls=0;const original=new Error('MODEL_FAILURE');
  const hook=script(project,'stop.mjs',`assert.equal(input.event,'stop');appendFileSync('stop-events.jsonl',JSON.stringify(input)+'\\n');${outcome==='hook-failure'?"process.exit(8);":"console.log(JSON.stringify({continue:false,message:'STOP_LOCAL_FEEDBACK'}));"}`);
  const hooks=await configured(api,project,{stop:[hook]}),history=[],events=[];
  const model={hooks,async generate(){calls++;if(outcome==='error')throw original;return answer('MODEL_FINAL');}};
  if(outcome==='error')await assert.rejects(runAgent(model,history,'finish',freshSignal(),e=>events.push(e)),error=>error===original);
  else{const reply=await runAgent(model,history,'finish',freshSignal(),e=>events.push(e));assert.match(reply.text,outcome==='hook-failure'?/结束钩子失败/:/STOP_LOCAL_FEEDBACK/);}
  assert.equal(calls,1,'stop反馈不得再次交给模型');const recorded=readFileSync('stop-events.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(recorded.length,1);assert.equal(recorded[0].outcome,outcome==='error'?'error':'completed');
  assert.equal(events.filter(e=>e.type==='run_finish').length,1);assert.ok(history.some(m=>/本地结束钩子/.test(m.content)));
 }
}
try{
 for(let i=0;i<lessons.length;i++){
  const stage=i+1,dist=compile(lessons[i]),api=await load(dist,'hooks/lifecycle.js'),{runAgent}=await load(dist,'agent/run.js');
  await configTests(api,stage);await beforeFlow(api,runAgent,stage);await planFlow(api,runAgent,stage);
  if(stage>1)await afterFlow(api,runAgent,stage);
  if(stage===3){await processBoundaries(api);await cancelFlow(api,runAgent,'before_tool');await cancelFlow(api,runAgent,'after_tool');await stopFlow(api,runAgent);await textCliFlow(dist);}
  process.chdir(cwd);console.log(`✓ 20.${stage}: independent build, opt-in config, approval → before block → model result, Plan${stage>1?', real tool → after feedback/failure → next decision':''}${stage===3?', bounded processes, cancellation waits close, stop once':''}`);
 }
 console.log('✓ Chapter 20 snapshots, real hook processes and fake-model flows passed.');
}finally{process.chdir(cwd);rmSync(temporary,{recursive:true,force:true});}
