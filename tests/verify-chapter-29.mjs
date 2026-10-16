/** Shared single-process ownership, real readonly child loops, lease cleanup and explicit inbox acknowledgement. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build, reply, signal, workspace } from './runtime-fixtures.mjs';
const temporary=workspace('29'),oldCwd=process.cwd();
let lastDist;
const task=(id,dependsOn=[])=>({id,role:'explore',task:`Inspect source.ts for ${id}`,dependsOn});
const observed={sessionId:'child',parentSessionId:'parent',role:'explore',status:'completed',summary:'observed',evidence:[{kind:'read',path:'source.ts',startLine:1,endLine:1}],usage:{inputTokens:1,outputTokens:1,cachedInputTokens:0,cacheWriteTokens:0},modelCalls:2,requestTokensReserved:10};
const call=(id,name,args={})=>({id,name,arguments:JSON.stringify(args)});
try{
 temporary.file('project/package.json','{"type":"module"}');temporary.file('project/source.ts','export const observed = 29;\n');process.chdir(join(temporary.directory,'project'));
 for(const [index,lesson] of ['01-claim-and-lease','02-dependencies-reclaim','03-agent-messages'].entries()){
  const {load,dist}=build('chapter-29-shared-tasks',lesson,temporary);
  lastDist=dist;
  const {SharedCoordinator}=await load('collaboration/coordinator.js'),{runSharedTasks}=await load('collaboration/runner.js');
  const {executeTool}=await load('tools/registry.js'),{agentLoop}=await load('agent/agent-loop.js');
  const {emptyRunView,updateRunView}=await load('ui/tui/state.js'),{runEntries}=await load('ui/tui/transcript.js');
  const directory=join(temporary.directory,lesson,'sessions');
  let now=0;const coordinator=new SharedCoordinator({leaseMs:100,clock:()=>now});coordinator.create([task('a'),task('b')]);
  assert.throws(()=>coordinator.create([task('c'),task('a')]));assert.equal(coordinator.list().length,2);
  const first=coordinator.claim('worker-1'),second=coordinator.claim('worker-2');assert.notEqual(first.taskId,second.taskId);assert.throws(()=>coordinator.claim('worker-1'));
  const snapshot=coordinator.list();snapshot[0].state='completed';assert.equal(coordinator.list()[0].state,'running');
  now=99;coordinator.heartbeat(first);now=150;assert.equal(coordinator.expired(first),false);now=200;assert.throws(()=>coordinator.finish(first,observed));assert.throws(()=>coordinator.heartbeat(first));
  coordinator.stop(first,'expired');assert.equal(coordinator.list()[0].state,'stopping');assert.throws(()=>coordinator.claim('worker-1'));coordinator.settleStopped(first);
  const next=coordinator.claim('worker-1');assert.equal(next.token,2);assert.throws(()=>coordinator.finish(first,observed));coordinator.finish(next,observed);
  coordinator.stop(second,'cancelled');coordinator.settleStopped(second);assert.equal(coordinator.list()[1].state,'cancelled');
  const noEvidence=new SharedCoordinator();noEvidence.create([task('empty')]);noEvidence.finish(noEvidence.claim('worker-1'),{...observed,summary:'I completed everything',evidence:[]});assert.equal(noEvidence.list()[0].state,'failed');
  if(index){
   const graph=new SharedCoordinator();assert.throws(()=>graph.create([task('a',['b']),task('b',['a'])]));assert.equal(graph.list().length,0);assert.throws(()=>graph.create([task('a',['missing'])]));
   graph.create([task('a'),task('b',['a']),task('c',['b'])]);const lease=graph.claim('worker-1');assert.equal(graph.claim('worker-2'),null);graph.finish(lease,{...observed,status:'failed'});assert.deepEqual(graph.list().map(t=>t.state),['failed','blocked','blocked']);
  }
  let forbiddenStep=0,approvals=0;const forbiddenRegistry=new SharedCoordinator();forbiddenRegistry.create([task('forbidden')]);
  const forbidden={async generate(messages){if(++forbiddenStep===1)return reply('',[call('bad-write','write_file',{path:'must-not-exist.ts',content:'BAD'}),call('bad-run','run_shared_tasks')]);assert.match(JSON.stringify(messages),/子任务不允许工具/);return reply('Denied; no evidence');}};
  await runSharedTasks(forbidden,forbiddenRegistry,signal(),{sessionDirectory:directory,requestApproval:async()=>{approvals++;return{decision:'allow_once'};}});assert.equal(approvals,0);assert.equal(forbiddenRegistry.list()[0].state,'failed');assert.equal(existsSync('must-not-exist.ts'),false);
  let active=0,maximum=0;const working={async generate(messages,_signal,_onText,options){assert.ok(options.allowedTools.includes('read_file'));assert.ok(!options.allowedTools.includes('write_file'));active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return messages.some(m=>m.role==='tool')?reply('CHILD_FACT observed 29'):reply('',[call('read','read_file',{path:'source.ts',offset:1,limit:5})]);}};
  const running=new SharedCoordinator();running.create(index?[task('one'),task('two'),task('three',['one','two'])]:[task('one'),task('two'),task('three')]);const events=[];
  const actual=await runSharedTasks(working,running,signal(),{sessionDirectory:directory,observer:e=>events.push(e)});assert.ok(actual.every(t=>t.state==='completed'));assert.equal(maximum,2);assert.ok(actual.every(t=>t.result.evidence[0].path==='source.ts'));assert.equal(readdirSync(directory).filter(n=>n.endsWith('.jsonl')).length,4);assert.ok(!readdirSync(directory).some(n=>n.endsWith('.lock')));
  let view=emptyRunView();for(const event of events)if(event.type==='shared_task_state')view=updateRunView(view,event);assert.equal(view.sharedTasks.length,3);assert.ok(runEntries(view,1).some(e=>e.text.includes('token 1')));
  // Real child model ignores abort briefly. A new attempt may start only after its generate and session cleanup settle.
  const expiring=new SharedCoordinator({leaseMs:40});expiring.create([task('slow')]);let inFlight=0,overlap=false,starts=0,settled=0;
  const slow={async generate(_messages,childSignal){starts++;inFlight++;if(inFlight>1)overlap=true;await new Promise(resolve=>childSignal.addEventListener('abort',()=>setTimeout(resolve,20),{once:true}));inFlight--;settled++;childSignal.throwIfAborted();return reply('unreachable');}};
  const expired=await runSharedTasks(slow,expiring,signal(),{sessionDirectory:directory});assert.equal(starts,2);assert.equal(settled,2);assert.equal(overlap,false);assert.equal(expired[0].state,'failed');assert.equal(expired[0].token,2);assert.ok(!readdirSync(directory).some(n=>n.endsWith('.lock')));
  const cancelled=new SharedCoordinator();cancelled.create([task('wait'),task('queued'),task('pending')]);const abort=new AbortController();let accepted;const ready=new Promise(resolve=>accepted=resolve);let closed=0;
  const wait={async generate(_m,s){accepted();await new Promise(resolve=>s.addEventListener('abort',()=>setTimeout(resolve,10),{once:true}));closed++;s.throwIfAborted();return reply();}};
  const pending=runSharedTasks(wait,cancelled,abort.signal,{sessionDirectory:directory});await ready;abort.abort(new Error('CANCEL_SHARED'));await assert.rejects(pending,/CANCEL_SHARED/);assert.ok(closed>=1);assert.ok(cancelled.list().filter(t=>t.attempts).every(t=>t.state==='cancelled'));assert.equal(cancelled.list()[2].state,'pending');
  const plan=new SharedCoordinator();let invoked=0;await assert.rejects(executeTool(call('x','run_shared_tasks'),signal(),{mode:'plan',sharedTasks:plan,runSharedTasks:async()=>{invoked++;return[];}}));assert.equal(invoked,0);
  // A parent tools chain must receive structured child observations on the next parent generate.
  let parentCalls=0;const history=[];const parent={sharedTasks:new SharedCoordinator(),async generate(messages,s,onText,options){if(options.allowedTools)return working.generate(messages,s,onText,options);parentCalls++;if(parentCalls===1)return reply('',[call('create','create_shared_tasks',{tasks:[{id:'parent-task',role:'explore',task:'Inspect source.ts'}]})]);if(parentCalls===2)return reply('',[call('run','run_shared_tasks')]);const text=JSON.stringify(messages);assert.match(text,/CHILD_FACT/);assert.match(text,/completed/);assert.match(text,/source.ts/);return reply('PARENT_RESULT_CHECKED');}};
  assert.equal((await agentLoop(parent,history,'Inspect',signal(),undefined,undefined,new Set(),{childSessionDirectory:directory})).text,'PARENT_RESULT_CHECKED');assert.equal(parentCalls,3);assert.equal(history.filter(m=>m.role==='tool').length,2);
  if(index===2){
   const inbox=new SharedCoordinator();inbox.create([task('mail')]);const lease=inbox.claim('worker-1');const message=inbox.sendMessage(lease,'worker-1','parent','finding','source.ts inspected');assert.deepEqual(inbox.sendMessage(lease,'worker-1','parent','finding','source.ts inspected'),message);assert.throws(()=>inbox.sendMessage(lease,'worker-1','parent','finding','different'));assert.throws(()=>inbox.sendMessage(lease,'worker-2','parent','x','forged'));assert.throws(()=>inbox.acknowledgeMessage(lease,'worker-1',message.id));assert.equal(inbox.readMessages(lease,'parent').length,1);assert.equal(inbox.readMessages(lease,'parent').length,1);assert.equal(inbox.list()[0].state,'running');inbox.acknowledgeMessage(lease,'parent',message.id);inbox.acknowledgeMessage(lease,'parent',message.id);assert.equal(inbox.readMessages(lease,'parent').length,0);
   // The actual shared child gets an identity-bound mailbox but cannot self-report completion or write files.
   const mail=new SharedCoordinator();mail.create([task('mail-real')]);let childStep=0,received;
   const messenger={async generate(messages,_s,_t,options){assert.ok(options.rolePrompt.includes('lease_token=1'));childStep++;if(childStep===1)return reply('',[call('e','read_file',{path:'source.ts',offset:1,limit:5})]);if(childStep===2)return reply('',[call('m','send_agent_message',{task_id:'mail-real',lease_token:1,to:'parent',client_id:'finding',body:'MAIL_OBSERVED'})]);assert.match(JSON.stringify(messages),/message-1/);return reply('Mail sent; source checked');}};
   await runSharedTasks(messenger,mail,signal(),{sessionDirectory:directory});received=await executeTool(call('r','read_agent_messages',{task_id:'mail-real',lease_token:1}),signal(),{sharedTasks:mail});assert.match(received.content,/MAIL_OBSERVED/);assert.equal(received.metadata.messages[0].acknowledged,false);await executeTool(call('a','ack_agent_message',{task_id:'mail-real',lease_token:1,message_id:'message-1'}),signal(),{sharedTasks:mail});assert.equal(mail.readMessages({taskId:'mail-real',workerId:'worker-1',token:1},'parent').length,0);
   await assert.rejects(executeTool(call('bad','send_agent_message',{task_id:'mail-real',lease_token:1,to:'parent',client_id:'fake',body:'x',from:'worker-1'}),signal(),{sharedTasks:mail}));
  }
  assert.equal(existsSync('must-not-exist.ts'),false);console.log(`✓ 29 ${lesson}: atomic claim, token rejection, actual two-worker child loops, abort-settle-reclaim, structured parent return, TUI${index?' and dependency blocking':''}${index===2?', identity-bound inbox/dedupe/explicit ack':''}`);
 }
 const exercise=join(temporary.directory,'exercise');temporary.file('exercise/package.json','{"type":"module"}');
 execFileSync(process.execPath,[join(oldCwd,'node_modules/typescript/bin/tsc'),join(oldCwd,'chapter-29-shared-tasks/examples/verify-shared-tasks.ts'),'--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--strict','--types','node','--typeRoots',join(oldCwd,'node_modules/@types'),'--outDir',exercise],{cwd:oldCwd,stdio:'inherit'});
 execFileSync(process.execPath,[join(exercise,'verify-shared-tasks.js'),'all'],{env:{...process.env,HMA_SHARED_DIST:lastDist},stdio:'inherit'});
}finally{process.chdir(oldCwd);temporary.close();}
