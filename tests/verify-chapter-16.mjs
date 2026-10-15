/** 第十六章：独立快照、双协议摘要、自动继续/回滚与会话恢复；全部使用本地模拟。 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)), temporary=mkdtempSync(join(tmpdir(),'hello-agent16-'));
const previousCwd=process.cwd();
const signal=()=>new AbortController().signal;
const result=(text,toolCalls=[],inputTokens=3,outputTokens=2)=>({text,toolCalls,finishReason:toolCalls.length?'tool_calls':'stop',inputTokens,outputTokens,truncated:false});
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const call=(id,name,args)=>({id,name,arguments:JSON.stringify(args)});
const history=()=>[...Array.from({length:6},(_,i)=>({role:'assistant',content:`OLD_${i} `+'x'.repeat(1000)})),...Array.from({length:4},(_,i)=>({role:i%2?'assistant':'user',content:`RECENT_${i}`}))];
const budget=(input,limit=1000)=>({inputEstimate:input,systemEstimate:20,toolsEstimate:20,messagesEstimate:input-40,windowTokens:limit+50,outputReserve:50,remainingEstimate:limit-input,withinBudget:input<=limit});
const mock=(extra={},limit=1000)=>({inspectContext(messages){return budget(JSON.stringify(messages).length+100,limit);},inspectSummary(){return budget(50);},async summarize(){return result('已读取旧文件，测试尚待执行。');},async generate(){return result('DONE');},...extra});
function compile(lesson){const source=join(root,'chapter-16-context-compaction',lesson,'src'),p=join(temporary,lesson);mkdirSync(p);symlinkSync(join(root,'node_modules'),join(p,'node_modules'));writeFileSync(join(p,'package.json'),'{"type":"module"}');const config=join(p,'tsconfig.json');writeFileSync(config,JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:false,noEmitOnError:true,rootDir:source,outDir:join(p,'dist'),typeRoots:[join(root,'node_modules/@types')]},include:[source+'/**/*.ts',source+'/**/*.tsx']}));execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',config],{stdio:'inherit'});return join(p,'dist');}
async function load(dist,path){return import(pathToFileURL(join(dist,path+'.js')).href);}
let server;
try{
 const first=compile('01-select-history'),second=compile('02-generate-summary'),dist=compile('03-compact-and-continue');
 const compaction=await load(dist,'context/compaction'),{agentLoop}=await load(dist,'agent/agent-loop');
 const {messageGroupEnds,requestMessages,selectCompaction,prepareCompaction,emptyCompaction}=compaction;
 const a=call('read-a','read_file',{path:'src/add.ts'}),b=call('read-b','read_file',{path:'test/add.test.ts'});
 const group=[{role:'assistant',content:'读取两份文件',toolCalls:[a,b]},{role:'tool',toolCallId:'read-a',content:'source'},{role:'tool',toolCallId:'read-b',content:'ENOENT',isError:true}];
 assert.deepEqual(messageGroupEnds(group),[3]);
 assert.throws(()=>messageGroupEnds(group.slice(0,2)),/未完整配对/);
 assert.throws(()=>messageGroupEnds([group[2]]),/没有对应/);
 assert.throws(()=>compaction.validateCompaction({summary:'x',through:1},group),/覆盖位置/);
 const originals=[{role:'user',content:'请修复加法，保留负数测试。'},...group,{role:'user',content:'也测试零加零'},...history().slice(-4)];
 const selected=selectCompaction(originals,emptyCompaction(),()=>true,[{id:'task',text:'尚待测试',status:'pending'}]);
 assert.equal(selected.through,5);assert.equal(JSON.parse(selected.source).messages[3].isError,true);
 const state={summary:'旧读取报错，尚未执行测试。',through:5},view=requestMessages(originals,state,[{id:'task',text:'测试',status:'pending'}]);
 assert.ok(view.some(m=>m.content==='请修复加法，保留负数测试。'));assert.ok(view.some(m=>m.content==='也测试零加零'));
 assert.deepEqual(view.slice(-4),originals.slice(-4));assert.ok(view.some(m=>m.content.includes('当前任务清单')));
 assert.equal(selectCompaction(originals,state,()=>true),null);
 assert.equal(selectCompaction(originals,emptyCompaction(),()=>false),null);
 const before=structuredClone(originals);requestMessages(originals,state);assert.deepEqual(originals,before);
 console.log('✓ 完整工具组、错误结果、近期四组、原文约束、清单与严格前进游标');
 // 16.1/16.2 不偷偷启用自动摘要，16.2只提供有副作用隔离的候选入口。
 for(const build of[first,second]){const {agentLoop:loop}=await load(build,'agent/agent-loop');let summaries=0;await assert.rejects(loop(mock({async summarize(){summaries++;return result('summary');}}),history(),'修复',signal()),/预算不足/);assert.equal(summaries,0);}
 const stage2=await load(second,'context/compaction'),old=history(),stable=emptyCompaction();let usage=0;
 const candidate=await stage2.prepareCompaction(mock(),old,stable,signal(),'execute',[],()=>usage++);assert.ok(candidate.after<candidate.before);assert.deepEqual(stable,emptyCompaction());assert.equal(usage,1);
 for(const bad of[result(''),{...result('text'),finishReason:'length'},{...result('text'),toolCalls:[a]},result('x'.repeat(24001))]){usage=0;await assert.rejects(prepareCompaction(mock({async summarize(){return bad;}}),old,stable,signal(),'execute',[],()=>usage++),/摘要未完整结束/);assert.equal(usage,1);assert.deepEqual(stable,emptyCompaction());}
 await assert.rejects(prepareCompaction(mock({async summarize(){return result('x'.repeat(22000));}}),old,stable,signal(),'execute'),/没有减少/);
 console.log('✓ 前两节阶段边界、有效候选隔离、无效/过长/无节省摘要拒绝且已知usage保留');
 // 一次自动压缩继续，原始证据仍在canonical history；实际普通请求与最后预算相同。
 const canonical=history(),context=emptyCompaction(),events=[],sent=[],sources=[];
 const reply=await agentLoop(mock({async summarize(source){sources.push(JSON.parse(source));return result('旧文件已经读过；测试仍待执行。',[],11,7);},async generate(messages){sent.push(structuredClone(messages));return result('DONE',[],5,2);}}),canonical,'请修复加法并测试负数',signal(),e=>events.push(e),undefined,new Set(),{context,tasks:{items:[{id:'t',text:'测试负数',status:'in_progress'}]}});
 assert.equal(reply.inputTokens,16);assert.equal(reply.outputTokens,9);assert.equal(sources.length,1);assert.ok(context.through>0);assert.ok(canonical[0].content.startsWith('OLD_0'));assert.ok(sent[0].some(m=>m.content==='请修复加法并测试负数'));assert.equal(events.at(-2)?.type==='run_finish',false);
 assert.equal(events.filter(e=>e.type==='compaction_finish')[0].outcome,'applied');assert.ok(events.filter(e=>e.type==='context_budget').at(-1).budget.withinBudget);
 assert.equal(events.find(e=>e.type==='model_start').contextMessages,sent[0].length);
 // 摘要自身装不下全部旧消息时，两次源前缀不同，第二次包含上一候选摘要。
 let rounds=0;const twoSources=[],twoContext=emptyCompaction(),twoHistory=history().slice(2);
 const chunked=mock({inspectSummary(source){return budget(source.length,2200);},async summarize(source){rounds++;twoSources.push(JSON.parse(source));return result(`摘要${rounds}`);}});
 await agentLoop(chunked,twoHistory,'继续',signal(),undefined,undefined,new Set(),{context:twoContext});
 assert.equal(rounds,2);assert.equal(twoSources[1].previousSummary,'摘要1');assert.ok(!twoSources[1].messages.some(m=>m.content.startsWith('OLD_2')));assert.ok(twoContext.through>0);
 const rollback=emptyCompaction(),over=history();let ordinary=0,attempts=0;
 await assert.rejects(agentLoop(mock({...chunked,async summarize(source){attempts++;return result('摘要');},async generate(){ordinary++;return result('BAD');}}),over,'继续',signal(),undefined,undefined,new Set(),{context:rollback}),/次数已用尽/);
 assert.equal(attempts,2);assert.equal(ordinary,0);assert.deepEqual(rollback,emptyCompaction());assert.ok(over[0].content.startsWith('OLD_0'));
 console.log('✓ 自动压缩继续、摘要usage计费、两次不同前缀、两次仍不足整笔回滚');
 // 一次有效旧摘要已经提交后，随后新候选失败，只保留之前那份成功状态。
 let stage=0,later=false;const persisted=emptyCompaction(),continued=history(),normalInspection=mock().inspectContext;
 await assert.rejects(agentLoop(mock({inspectContext(messages){return later?budget(99999):normalInspection(messages);},async summarize(){stage++;if(stage>1)throw new Error('fixture');return result('旧摘要');},async generate(){later=true;return result('',[call('r','read_file',{path:'large.txt'})]);}}),continued,'读取',signal(),undefined,undefined,new Set(),{context:persisted}),/./);
 assert.ok(persisted.through>0);assert.equal(persisted.summary,'旧摘要');assert.equal(stage,2);
 // 压缩期间到达的补充留到下一次既有收取点，当前已准备请求不会追改。
 const entered=gate(),release=gate(),queued=[],seen=[],queueContext=emptyCompaction();
 const running=agentLoop(mock({async summarize(){entered.resolve();await release.promise;return result('摘要');},async generate(messages){seen.push(messages);return result('FINAL');}}),history(),'原任务',signal(),undefined,undefined,new Set(),{context:queueContext,takePendingInputs:()=>queued.splice(0),hasPendingInputs:()=>queued.length>0});
 await entered.promise;queued.push({id:1,text:'ENTER_DURING_SUMMARY'});release.resolve();await running;
 assert.equal(seen.length,2);assert.ok(!seen[0].some(m=>m.content==='ENTER_DURING_SUMMARY'));assert.ok(seen[1].some(m=>m.content==='ENTER_DURING_SUMMARY'));
 const controller=new AbortController(),started=gate(),done=gate(),cancelState=emptyCompaction(),cancelHistory=history();let cancelGenerate=0;
 const cancel=agentLoop(mock({async summarize(){started.resolve();await done.promise;return result('迟到摘要');},async generate(){cancelGenerate++;return result('BAD');}}),cancelHistory,'旧任务',controller.signal,undefined,undefined,new Set(),{context:cancelState});
 await started.promise;controller.abort();done.resolve();await assert.rejects(cancel);assert.deepEqual(cancelState,emptyCompaction());assert.equal(cancelGenerate,0);assert.ok(cancelHistory.some(m=>m.role==='user'&&m.content==='旧任务'));
 const allUser=[...Array.from({length:8},()=>({role:'user',content:'x'.repeat(1000)}))];let forbidden=0;
 await assert.rejects(agentLoop(mock({async summarize(){forbidden++;return result('x');}}),allUser,'continue',signal()),/没有能放入/);assert.equal(forbidden,0);
 console.log('✓ 先前成功视图保留、Enter迟到补充时点、取消等返回后拒绝提交、全受保护原文不能强压');
 // 真正读取本地文件，完整工具组再进入下一决策；普通8次上限不被摘要次数重置。
 const workspace=join(temporary,'workspace');mkdirSync(workspace);writeFileSync(join(workspace,'package.json'),'{}');writeFileSync(join(workspace,'large.txt'),'L'.repeat(7000));writeFileSync(join(workspace,'add.ts'),'export const add=(a:number,b:number)=>a+b;');process.chdir(workspace);
 let decisions=0;const toolHistory=history(),toolContext=emptyCompaction();
 await agentLoop(mock({async generate(messages){decisions++;if(decisions===1)return result('',[call('read','read_file',{path:'add.ts',offset:1,limit:20})]);assert.ok(messages.some(m=>m.role==='tool'&&m.toolCallId==='read'&&m.content.includes('a+b')));return result('工具读取后回答');}}),toolHistory,'读取代码',signal(),undefined,undefined,new Set(),{context:toolContext});assert.equal(decisions,2);assert.ok(messageGroupEnds(toolHistory).length>0);
 decisions=0;const bound=[];await assert.rejects(agentLoop(mock({inspectContext:undefined,async generate(){decisions++;return result('',[call('r'+decisions,'read_file',{path:'add.ts',offset:1,limit:20})]);}}),bound,'读取',signal()),/8/);assert.equal(decisions,8);assert.ok(messageGroupEnds(bound).length>0);
 // 可选context字段兼容旧会话；写、恢复、fork保留完整历史和同一游标，reset能够清空。
 const {createSessionWriter,resumeSessionWriter}=await load(dist,'sessions/save-session'),{readSession,validateSessionState}=await load(dist,'sessions/read-session'),{forkSessionWriter}=await load(dist,'sessions/fork-session');
 const sessionState={messages:canonical,context,mode:'execute',tasks:[],pendingInputs:[],run:1,nextInputId:1};
 const legacy={...sessionState};delete legacy.context;assert.equal(validateSessionState(legacy).context,undefined);
 const directory=join(temporary,'sessions'),writer=await createSessionWriter(directory),id=writer.id;await writer.save(sessionState,'run_end');await writer.close();
 const loaded=await readSession(id,directory);assert.deepEqual(loaded.state.context,context);assert.deepEqual(loaded.state.messages,canonical);
 const resumed=await resumeSessionWriter(id,directory);assert.deepEqual(resumed.restored.state.context,context);await resumed.close();
 const fork=await forkSessionWriter(id,directory);assert.deepEqual(fork.restored.state.context,context);assert.deepEqual(fork.restored.state.messages,canonical);await fork.close();
 const reset=await resumeSessionWriter(id,directory);await reset.save({...sessionState,messages:[],context:emptyCompaction()},'reset');await reset.close();assert.deepEqual((await readSession(id,directory)).state.context,emptyCompaction());
 assert.throws(()=>validateSessionState({...sessionState,context:{summary:'oops',through:999999}}));
 console.log('✓ 真实文件工具继续、8次决策上限、旧会话兼容、JSONL恢复/fork与清空摘要');
 // SDK真实本地HTTP：两个服务商的摘要都无工具/无stream，普通请求带真实工具、原文及摘要。
 const {createModel}=await load(dist,'models/client');const frames=[];let provider='openai';
 server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);frames.push(body);
  if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify(provider==='openai'?{id:'s',object:'chat.completion',created:1,model:'fixture',choices:[{index:0,message:{role:'assistant',content:'历史摘要，测试尚待执行。'},finish_reason:'stop'}],usage:{prompt_tokens:17,completion_tokens:4,total_tokens:21}}:{id:'s',type:'message',role:'assistant',model:'fixture',content:[{type:'text',text:'历史摘要，测试尚待执行。'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:17,output_tokens:4}}));return;}
  res.setHeader('content-type','text/event-stream');const send=e=>res.write(`${provider==='anthropic'?`event: ${e.type}\n`:''}data: ${JSON.stringify(e)}\n\n`);
  if(provider==='openai'){send({id:'r',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'正常继续'},finish_reason:null}]});send({id:'r',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}});res.end('data: [DONE]\n\n');}
  else{send({type:'message_start',message:{id:'r',type:'message',role:'assistant',model:'fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:5,output_tokens:0}}});send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'正常继续'}});send({type:'content_block_stop',index:0});send({type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}});send({type:'message_stop'});res.end();}
 });await new Promise(done=>server.listen(0,'127.0.0.1',done));
 for(provider of['openai','anthropic']){frames.length=0;const config={provider,apiKey:'fixture-only',model:'fixture',baseURL:`http://127.0.0.1:${server.address().port}`,contextLimits:{windowTokens:5000,outputReserve:777}},model=createModel(config),old=Array.from({length:16},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'x'.repeat(1500):`要求${i}`})),ctx=emptyCompaction();
  assert.ok(!model.inspectContext([...old,{role:'user',content:'FINAL_REQUIREMENT'}]).withinBudget);
  const outcome=await agentLoop(model,old,'FINAL_REQUIREMENT',signal(),undefined,undefined,new Set(),{context:ctx});assert.equal(outcome.text,'正常继续');assert.equal(outcome.inputTokens,22);assert.equal(outcome.outputTokens,6);assert.equal(frames.length,2);assert.equal(frames[0].stream,undefined);assert.equal(frames[0].tools,undefined);assert.equal(frames[0].max_completion_tokens??frames[0].max_tokens,777);assert.ok(frames[1].tools.length>0);assert.equal(frames[1].stream,true);assert.ok(JSON.stringify(frames[1]).includes('FINAL_REQUIREMENT'));assert.ok(JSON.stringify(frames[1]).includes('历史摘要'));assert.ok(ctx.through>0);
  const count=frames.length;await assert.rejects(model.summarize('x'.repeat(30000),signal()),/摘要请求本身/);assert.equal(frames.length,count);
 }
 console.log('✓ OpenAI/Anthropic真实SDK：无工具有界摘要→带工具普通请求，实际usage与原要求保留');
 console.log('✓ 第十六章全部工程检查通过（3 × 48模块，零在线模型请求）');
}finally{process.chdir(previousCwd);if(server)await new Promise(done=>server.close(done));rmSync(temporary,{recursive:true,force:true});}
