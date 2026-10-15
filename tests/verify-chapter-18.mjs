/** 第十八章：独立临时编译、真实存储故障、实际审批循环和双协议本地SSE；不改dist、不用在线密钥。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=realpathSync(mkdtempSync(join(tmpdir(),'hello-my-agent-18-'))), previousCwd=process.cwd();
const lessons=['01-save-memory','02-propose-memory','03-manage-memory'];
const fresh=()=>new AbortController().signal;
const fixture=name=>{const path=join(temporary,name);mkdirSync(path,{recursive:true});return path;};
const project=name=>{const path=fixture(name);writeFileSync(join(path,'package.json'),'{}');return path;};
const disk=path=>join(path,'.hello-my-agent/memory.json');
const user={kind:'user',detail:'用户明确提供：本项目测试命令是npm run test:unit'};
const add=content=>({action:'add',content,source:user});
const load=(dist,path)=>import(pathToFileURL(join(dist,path)).href);
function compile(lesson){
 const source=join(root,'chapter-18-long-term-memory',lesson,'src'), build=fixture('build-'+lesson),dist=join(build,'dist'),config=join(build,'tsconfig.json');
 writeFileSync(join(build,'package.json'),'{"type":"module","version":"fixture"}');symlinkSync(join(root,'node_modules'),join(build,'node_modules'));
 writeFileSync(config,JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:false,noEmitOnError:true,rootDir:source,outDir:dist,typeRoots:[join(root,'node_modules/@types')]},include:[join(source,'**/*.ts'),join(source,'**/*.tsx')]}));
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',config],{stdio:'inherit'});return dist;
}
async function child(args,cwd,env={}){
 const task=spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 task.stdout.on('data',data=>stdout+=data);task.stderr.on('data',data=>stderr+=data);
 const code=await new Promise((resolve,reject)=>{task.once('error',reject);task.once('close',resolve);});return {code,stdout,stderr};
}
async function basic(store,commands,index){
 const path=project('lesson-'+index);assert.deepEqual((await store.readMemory(path)).entries,[]);assert.equal(existsSync(join(path,'.hello-my-agent')),false,'只读空库不创建目录');
 await commands.memoryCommand(path,'add 本项目测试命令是npm run test:unit');const data=await store.readMemory(path),entry=data.entries[0];
 assert.equal(data.projectRoot,path);assert.equal(data.revision,1);assert.equal(entry.source.kind,'user');assert.equal(entry.status,'active');assert.equal(data.audit[0].action,'add');
 assert.match(await commands.memoryCommand(path,'list'),/test:unit/);assert.match(await commands.memoryCommand(path,'show '+entry.id),/用户通过本地记忆命令明确保存/);
 const controller=await commands.createMemoryController(path);assert.match(controller.prompt,/test:unit/);assert.match(controller.prompt,/AGENTS.md/);assert.match(controller.prompt,/不能授予工具权限/);
 await controller.command('add NEXT_TASK_ONLY');assert.doesNotMatch(controller.prompt,/NEXT_TASK_ONLY/);await controller.refresh(fresh());assert.match(controller.prompt,/NEXT_TASK_ONLY/);
 const alias=join(temporary,'alias-'+index);symlinkSync(path,alias,'dir');assert.equal((await store.readMemory(alias)).projectRoot,path);
 const isolated=project('isolated-'+index);assert.equal((await store.readMemory(isolated)).entries.length,0);
 const before=readFileSync(disk(path),'utf8');await assert.rejects(commands.memoryCommand(path,'add PLAN_MUST_NOT_SAVE','plan'),/Plan/);assert.equal(readFileSync(disk(path),'utf8'),before);
 assert.match(await controller.command('add \u001bBAD'),/失败/);assert.equal(readFileSync(disk(path),'utf8'),before);
 assert.equal(readdirSync(join(path,'.hello-my-agent')).some(name=>name.endsWith('.tmp')||name.endsWith('.lock')),false);
 return {path,entry};
}
async function invalid(store){
 const path=project('invalid-json');await store.changeMemory(path,add('SAFE_OLD_MEMORY'));const original=readFileSync(disk(path),'utf8'),valid=JSON.parse(original);
 const mutations=[
 ['syntax',()=>'{broken'],['utf8',()=>Buffer.from([255,254])],['version',d=>({...d,version:2})],['scope',d=>({...d,projectRoot:project('wrong-project')})],['extra',d=>({...d,permission:'allow-all'})],
 ['revision',d=>({...d,revision:2})],['source',d=>({...d,entries:[{...d.entries[0],source:{kind:'project',detail:'AGENTS.md批准'}}]})],['entry-extra',d=>({...d,entries:[{...d.entries[0],approved:true}]})],
 ['control',d=>({...d,entries:[{...d.entries[0],content:'\u001b[2J'}]})],['blank',d=>({...d,entries:[{...d.entries[0],content:'  '}]})],['time',d=>({...d,entries:[{...d.entries[0],createdAt:'yesterday'}]})],
 ['id',d=>({...d,entries:[{...d.entries[0],id:'model-said-approved'}]})],['duplicate',d=>({...d,entries:[d.entries[0],d.entries[0]]})],['audit',d=>({...d,audit:[{...d.audit[0],action:'grant'}]})],
 ['large',()=> 'x'.repeat(store.MEMORY_LIMITS.fileBytes+1)],
 ];
 for(const [name,mutate]of mutations){const candidate=mutate(structuredClone(valid)),raw=typeof candidate==='object'&&!Buffer.isBuffer(candidate)?JSON.stringify(candidate):candidate;writeFileSync(disk(path),raw);const before=readFileSync(disk(path));
  await assert.rejects(store.readMemory(path),undefined,name);await assert.rejects(store.changeMemory(path,add('NEVER_OVERWRITE')),undefined,name);assert.deepEqual(readFileSync(disk(path)),before,name+'拒绝后保留原字节');assert.equal(existsSync(join(path,'.hello-my-agent/memory.lock')),false);
 }
 writeFileSync(disk(path),original);
 const controller=(await load(builds[2],'memory/commands.js')).createMemoryController;const loaded=await controller(path),prompt=loaded.prompt;writeFileSync(disk(path),'{bad');await assert.rejects(loaded.refresh(fresh()));assert.equal(loaded.prompt,prompt,'刷新失败不能半更新快照');
 for(const kind of ['directory','link','fifo']){const other=project('invalid-file-'+kind);mkdirSync(join(other,'.hello-my-agent'));const target=disk(other);
  if(kind==='directory')mkdirSync(target);else if(kind==='link')symlinkSync(disk(path),target);else execFileSync('mkfifo',[target]);
  await assert.rejects(store.readMemory(other),/普通文件|链接|目录/);await assert.rejects(store.changeMemory(other,add('NEVER_WRITE')),/普通文件|链接|目录/);
 }
 const linked=project('linked-directory'),outside=fixture('outside-memory');symlinkSync(outside,join(linked,'.hello-my-agent'),'dir');await assert.rejects(store.readMemory(linked),/真实目录/);await assert.rejects(store.changeMemory(linked,add('NEVER_ESCAPE')),/真实目录/);assert.deepEqual(readdirSync(outside),[]);
}
async function failures(store){
 const path=project('atomic-failures');await store.changeMemory(path,add('BEFORE_ATOMIC_CHANGE'));const initial=readFileSync(disk(path),'utf8'),lockPath=join(path,'.hello-my-agent/memory.lock');
 writeFileSync(lockPath,'other writer');await assert.rejects(store.changeMemory(path,add('LOCKED_WRITE')),/memory.lock/);assert.equal(readFileSync(disk(path),'utf8'),initial);assert.equal(readFileSync(lockPath,'utf8'),'other writer');rmSync(lockPath);
 const originalRename=fsPromises.rename,originalOpen=fsPromises.open,originalUnlink=fsPromises.unlink;
 try{
  fsPromises.rename=async()=>{throw new Error('RENAME_FAILED');};syncBuiltinESMExports();await assert.rejects(store.changeMemory(path,add('RENAME_NEVER_COMMITTED')),/RENAME_FAILED/);assert.equal(readFileSync(disk(path),'utf8'),initial);
  fsPromises.rename=originalRename;syncBuiltinESMExports();
  const beforeCommit=new AbortController();fsPromises.open=async(...args)=>{const handle=await originalOpen(...args);if(String(args[0]).endsWith('.tmp')){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();beforeCommit.abort(new Error('CANCEL_BEFORE_RENAME'));};}return handle;};syncBuiltinESMExports();
  await assert.rejects(store.changeMemory(path,add('CANCELLED_CANDIDATE'),beforeCommit.signal),/CANCEL_BEFORE_RENAME/);assert.equal(readFileSync(disk(path),'utf8'),initial);
  fsPromises.open=originalOpen;syncBuiltinESMExports();
  const afterCommit=new AbortController();fsPromises.rename=async(...args)=>{await originalRename(...args);afterCommit.abort(new Error('CANCEL_AFTER_RENAME'));};syncBuiltinESMExports();
  const committed=await store.changeMemory(path,add('ALREADY_COMMITTED'),afterCommit.signal);assert.equal(afterCommit.signal.aborted,true);assert.equal(committed.content,'ALREADY_COMMITTED');assert.match(readFileSync(disk(path),'utf8'),/ALREADY_COMMITTED/);
  fsPromises.rename=originalRename;syncBuiltinESMExports();
  fsPromises.unlink=async(...args)=>{if(args[0]===lockPath)throw new Error('LOCK_CLEANUP_FAILED');return originalUnlink(...args);};syncBuiltinESMExports();
  await assert.rejects(store.changeMemory(path,add('COMMITTED_WITH_CLEANUP_WARNING')),/已保存.*清理失败/);assert.match(readFileSync(disk(path),'utf8'),/COMMITTED_WITH_CLEANUP_WARNING/);assert.equal(existsSync(lockPath),true);
 }finally{fsPromises.rename=originalRename;fsPromises.open=originalOpen;fsPromises.unlink=originalUnlink;syncBuiltinESMExports();rmSync(lockPath,{force:true});}
 assert.equal(readdirSync(join(path,'.hello-my-agent')).some(name=>name.endsWith('.tmp')||name.endsWith('.lock')),false);
 let release,started;const locked=new Promise(done=>started=done),continueWrite=new Promise(done=>release=done);
 fsPromises.rename=async(...args)=>{started();await continueWrite;return originalRename(...args);};syncBuiltinESMExports();
 try{const first=store.changeMemory(path,add('CONCURRENT_FIRST'));await locked;await assert.rejects(store.changeMemory(path,add('CONCURRENT_SECOND')),/正在写入/);release();await first;}finally{release();fsPromises.rename=originalRename;syncBuiltinESMExports();}
 const contents=(await store.readMemory(path)).entries.map(entry=>entry.content);assert.ok(contents.includes('CONCURRENT_FIRST'));assert.ok(!contents.includes('CONCURRENT_SECOND'));
 const cancelled=new AbortController();let closed=false;fsPromises.open=async(...args)=>{const handle=await originalOpen(...args),read=handle.read.bind(handle),close=handle.close.bind(handle);handle.read=async(...a)=>{const result=await read(...a);cancelled.abort(new Error('CANCEL_READ'));return result;};handle.close=async()=>{closed=true;return close();};return handle;};syncBuiltinESMExports();
 try{await assert.rejects(store.readMemory(path,cancelled.signal),/CANCEL_READ/);assert.equal(closed,true);}finally{fsPromises.open=originalOpen;syncBuiltinESMExports();}
}
async function management(store,commands){
 const path=project('management');const first=await store.changeMemory(path,add('OLD_TEST_COMMAND'));const id=first.id;await commands.memoryCommand(path,`invalidate ${id} 已改用npm run test:unit`);
 let data=await store.readMemory(path);assert.equal(data.entries[0].status,'invalid');assert.doesNotMatch(store.memoryPrompt(data),/OLD_TEST_COMMAND/);assert.match(await commands.memoryCommand(path,'show '+id),/已改用npm run test:unit/);
 await commands.memoryCommand(path,`edit ${id} 本项目测试命令是npm run test:unit`);data=await store.readMemory(path);assert.equal(data.entries[0].id,id);assert.equal(data.entries[0].status,'active');assert.match(store.memoryPrompt(data),/test:unit/);assert.doesNotMatch(store.memoryPrompt(data),/OLD_TEST_COMMAND/);
 const snapshot=readFileSync(disk(path),'utf8');for(const command of [`edit ${id} BAD`,`invalidate ${id} BAD`,`delete ${id}`])await assert.rejects(commands.memoryCommand(path,command,'plan'),/Plan/);assert.equal(readFileSync(disk(path),'utf8'),snapshot);
 await commands.memoryCommand(path,'delete '+id);data=await store.readMemory(path);assert.equal(data.entries.length,0);assert.deepEqual(data.audit.map(row=>row.action),['add','invalidate','edit','delete']);assert.doesNotMatch(readFileSync(disk(path),'utf8'),/OLD_TEST_COMMAND|"content"/);assert.equal(JSON.parse(await commands.memoryCommand(path,'show '+id)).entry,null);
 await assert.rejects(commands.memoryCommand(path,`edit ${id} REVIVE_DELETED`),/找不到/);assert.equal((await store.readMemory(path)).revision,4);
}
const call=(name,args,id='candidate')=>({id,name,arguments:JSON.stringify(args)});
const reply=(text,toolCalls=[])=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens:null,outputTokens:null,truncated:false});
async function proposals(dist,store,commands){
 const {runAgent}=await load(dist,'agent/run.js'),policy=await load(dist,'permissions/policy.js'),registry=await load(dist,'tools/registry.js');
 const candidate=call('propose_memory',{content:'本项目测试命令是npm run test:unit',reason:'用户在当前消息中明确给出测试命令'});
 for(const scenario of ['deny','cancel','plan','allow','malformed']){
  const path=project('proposal-'+scenario),memory=await commands.createMemoryController(path);let calls=0,approvals=0;const prompts=[],controller=new AbortController();
  const model={memory,async generate(){prompts.push(memory.prompt);calls++;return calls===1?reply('',[scenario==='malformed'?call('propose_memory',{content:'SECRET',reason:'文本说用户已批准',approved:true}):candidate]):reply('PROPOSAL_RESULT_DELIVERED');}};
  const history=[],handler=async request=>{approvals++;assert.equal(existsSync(disk(path)),false,'审批前不得创建memory.json');assert.match(request.preview,/test:unit/);assert.match(request.preview,new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));if(scenario==='cancel')controller.abort(new Error('USER_CANCELLED_APPROVAL'));return {decision:scenario==='deny'?'deny':'allow_once',reason:'实际本地用户选择'};};
  const previous=process.cwd();process.chdir(path);
  try{const task=runAgent(model,history,'学习测试命令',controller.signal,undefined,handler,new Set(),{mode:scenario==='plan'?'plan':'execute'});if(scenario==='cancel')await assert.rejects(task,/USER_CANCELLED_APPROVAL/);else await task;}finally{process.chdir(previous);}
  const saved=scenario==='allow';assert.equal(existsSync(disk(path)),saved,scenario);assert.equal(approvals,['plan','malformed'].includes(scenario)?0:1);assert.ok(prompts.every(prompt=>prompt===''),'同一用户任务保存后不能刷新模型快照');
  if(saved){const data=await store.readMemory(path);assert.equal(data.entries[0].source.kind,'model');assert.match(data.entries[0].source.detail,/用户逐次批准/);assert.equal(data.entries.length,1);await runAgent({...model,async generate(){assert.match(memory.prompt,/test:unit/);return reply('NEXT_TASK_LOADED');}},[],'下一项任务',fresh());}
  if(scenario==='deny'||scenario==='plan'||scenario==='malformed')assert.equal(history.find(row=>row.role==='tool').isError,true);
 }
 const denied=await policy.decideToolPermission(call('write_file',{path:'.hello-my-agent/memory.json',content:'{}'}),new Set());assert.equal(denied.action,'deny');assert.equal((await policy.decideToolPermission(call('read_file',{path:'.env'}),new Set())).action,'deny');
 assert.equal((await policy.decideToolPermission(candidate,new Set(['propose_memory:local-project-memory']))).action,'ask');assert.equal((await policy.decideToolPermission(candidate,new Set(),undefined,'plan')).action,'deny');
 await assert.rejects(registry.executeTool(candidate,fresh()),/预览|批准/);
}
const requests=[];
const server=createServer(async(request,response)=>{
 let raw='';for await(const chunk of request)raw+=chunk;const data=JSON.parse(raw);requests.push(data);response.setHeader('content-type','text/event-stream');
 if(request.url.includes('messages')){const send=event=>response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);send({type:'message_start',message:{id:'m',type:'message',role:'assistant',model:'fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:20,output_tokens:0}}});send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'MEMORY_MODEL_REPLY'}});send({type:'content_block_stop',index:0});send({type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}});send({type:'message_stop'});response.end();}
 else{const frame=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'m',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`;response.write(frame({role:'assistant',content:'MEMORY_MODEL_REPLY'}));response.write(frame({},'stop'));response.end('data: [DONE]\n\n');}
});
let builds=[];
try{
 for(const [index,lesson]of lessons.entries()){const dist=compile(lesson);builds.push(dist);await basic(await load(dist,'memory/store.js'),await load(dist,'memory/commands.js'),index);console.log(`✓ 18.${index+1} 独立构建、本地显式保存、来源、真实项目隔离与固定快照`);}
 const dist=builds[2],store=await load(dist,'memory/store.js'),commands=await load(dist,'memory/commands.js');
 await invalid(store);await failures(store);await management(store,commands);console.log('✓ 严格磁盘JSON/UTF-8/链接/FIFO边界，锁冲突/并发/原子失败/提交前后取消/清理回执，编辑失效删除与来源');
 await proposals(dist,store,commands);console.log('✓ 实际Agent审批：明确允许才保存，拒绝/取消/Plan/伪造批准不落盘，同任务快照不变与下一任务加载');
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const baseURL=`http://127.0.0.1:${server.address().port}`;
 const {createModel}=await load(dist,'models/client.js'),{runAgent}=await load(dist,'agent/run.js'),{loadProjectInstructions}=await load(dist,'project/instructions.js');
 const path=project('providers'),start=fixture('providers/src/api');writeFileSync(join(path,'AGENTS.md'),'PROJECT_RULE_USE_TYPESCRIPT');await commands.memoryCommand(path,'add MEMORY_SCOPE_TEST_UNIT');const memory=await commands.createMemoryController(path),state=await loadProjectInstructions(start);
 for(const provider of ['openai','anthropic']){const config={provider,apiKey:'fixture-only',model:'fixture',baseURL,contextLimits:{windowTokens:32768,outputReserve:2048}},history=[{role:'user',content:'检查记忆来源'}],plain=createModel(config,state),model=createModel(config,state,memory);
  assert.ok(model.inspectContext(history).systemEstimate>plain.inspectContext(history).systemEstimate);const before=requests.length;await model.generate(history,fresh());const sent=requests.at(-1),prompt=provider==='openai'?sent.messages[0].content:sent.system;assert.match(prompt,/MEMORY_SCOPE_TEST_UNIT/);assert.match(prompt,/PROJECT_RULE_USE_TYPESCRIPT/);assert.match(prompt,/用户通过本地记忆命令明确保存/);
  const tight=createModel({...config,contextLimits:{windowTokens:plain.inspectContext(history).inputEstimate+2048,outputReserve:2048}},state,memory);await assert.rejects(tight.generate(history,fresh()),/预算/);assert.equal(requests.length,before+1);
  await commands.memoryCommand(path,'add '+provider.toUpperCase()+'_NEXT_TASK');assert.doesNotMatch(memory.prompt,new RegExp(provider.toUpperCase()+'_NEXT_TASK'));await runAgent(model,[],'新用户任务',fresh());assert.match(provider==='openai'?requests.at(-1).messages[0].content:requests.at(-1).system,new RegExp(provider.toUpperCase()+'_NEXT_TASK'));
 }
 const env={HOME:fixture('cli-home'),OPENAI_API_KEY:'',OPENAI_MODEL:'',ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:''};const before=requests.length;
 for(const command of ['list','add CLI_NO_KEY_MEMORY']){const result=await child([join(dist,'cli.js'),'--memory',command],start,env);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/MEMORY_SCOPE_TEST_UNIT|记忆已保存/);}
 const cliData=await store.readMemory(path),id=cliData.entries.find(row=>row.content==='CLI_NO_KEY_MEMORY').id;for(const command of ['show '+id,`edit ${id} CLI_EDITED`,`invalidate ${id} OLD_COMMAND`,`delete ${id}`]){const result=await child([join(dist,'cli.js'),'--memory',command],start,env);assert.equal(result.code,0,result.stderr);}
 const denied=await child([join(dist,'cli.js'),'--memory','add NEVER_PLAN','--mode','plan'],start,env);assert.equal(denied.code,1);assert.match(denied.stderr,/Plan/);const mixed=await child([join(dist,'cli.js'),'--memory','list','--prompt','DO_NOT_SEND'],start,env);assert.equal(mixed.code,1);assert.match(mixed.stderr,/单独/);assert.equal(requests.length,before);assert.equal(existsSync(join(env.HOME,'.hello-my-agent/sessions')),false);
 const normal=await child([join(dist,'cli.js'),'--output','jsonl','--prompt','CROSS_PROCESS_MEMORY'],start,{...env,AGENT_PROVIDER:'openai',OPENAI_API_KEY:'fixture-only',OPENAI_MODEL:'fixture',OPENAI_BASE_URL:baseURL});assert.equal(normal.code,0,normal.stderr);assert.match(requests.at(-1).messages[0].content,/MEMORY_SCOPE_TEST_UNIT/);for(const line of normal.stdout.trim().split('\n'))JSON.parse(line);
 console.log('✓ 双协议真实SSE含来源与项目规则、记忆参加预算，跨进程加载；离线CLI无密钥/请求/会话且管理全命令可用');
}finally{process.chdir(previousCwd);if(server.listening)await new Promise(done=>server.close(done));rmSync(temporary,{recursive:true,force:true});}
