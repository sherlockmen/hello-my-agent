/** Bounded local reads, serial barriers, cleanup deadlines and complete model observations. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { build, reply, signal, workspace } from './runtime-fixtures.mjs';
const temporary=workspace('27'),oldCwd=process.cwd();
const call=(id,name='read_file',args={path:'source.ts',offset:1,limit:10})=>({id,name,arguments:JSON.stringify(args)});
const item=(id,name='read_file')=>({call:call(id,name),sequence:Number(id.replace(/\D/g,''))||1});
try {
 temporary.file('project/package.json','{"type":"module"}');temporary.file('project/source.ts','export const observed = 7;\n');process.chdir(join(temporary.directory,'project'));
 const lessons=process.env.LESSON_27?[process.env.LESSON_27]:['01-bounded-reads','02-cancel-and-cleanup','03-batch-results'];
 for(const lesson of lessons) {
  const {load}=build('chapter-27-tool-concurrency',lesson,temporary);
  const {runToolBatch,batchConcurrency,isParallelRead}=await load('agent/tool-batch.js');
  const {agentLoop}=await load('agent/agent-loop.js');
  for(const value of [0,5,-1,1.5,NaN])assert.throws(()=>batchConcurrency(value));
  assert.equal(batchConcurrency(),2);
  for(const name of ['read_file','glob','grep','read_tool_result','read_job','read_skill_resource'])assert.ok(isParallelRead(call('a',name)));
  for(const name of ['load_skill','write_file','run_command','start_job','delegate_task','mcp_fixture','web_search','unknown'])assert.ok(!isParallelRead(call('a',name)));
  const order=[],states=[];let active=0,maxActive=0;
  await runToolBatch([item('r1'),item('r2'),item('r3'),item('w4','write_file'),item('r5'),item('s6','load_skill'),item('r7','read_skill_resource')],signal(),async({call})=>{
   active++;maxActive=Math.max(maxActive,active);order.push('start:'+call.id);await delay(call.id==='r1'?55:15);order.push('end:'+call.id);active--;return true;
  },(entry,state)=>states.push([entry.call.id,state]),{concurrency:2});
  assert.equal(maxActive,2);assert.ok(order.indexOf('start:r3')<order.indexOf('end:r1'));assert.ok(order.indexOf('start:w4')>order.indexOf('end:r1'));assert.ok(order.indexOf('start:r5')>order.indexOf('end:w4'));assert.ok(order.indexOf('start:r7')>order.indexOf('end:s6'));
  for(const id of ['r1','r2','r3','w4','r5','s6','r7'])assert.deepEqual(states.filter(e=>e[0]===id).map(e=>e[1]),['queued','running','succeeded']);
  active=0;maxActive=0;
  await runToolBatch([item('r1'),item('r2')],signal(),async()=>{active++;maxActive=Math.max(maxActive,active);await delay(10);active--;return true;},()=>{},{concurrency:4,serial:true});assert.equal(maxActive,1,'Hook scripts retain serial ordering');
  const history=[],events=[],calls=[call('one'),call('bad','read_file',{path:'missing.ts',offset:1,limit:10}),call('two')];let requests=0;
  const model={async generate(messages){if(++requests===1)return reply('',calls);const observations=messages.filter(m=>m.role==='tool');assert.equal(observations.length,3);assert.equal(observations.find(m=>m.toolCallId==='bad').isError,true);for(const id of ['one','two'])assert.match(observations.find(m=>m.toolCallId===id).content,/observed = 7/);return reply('ALL_OBSERVED');}};
  await agentLoop(model,history,'Read independent files',signal(),event=>events.push(event));assert.equal(requests,2);assert.equal(history.filter(m=>m.role==='tool').length,3);
  assert.deepEqual(events.filter(e=>e.type==='tool_state'&&e.state==='queued').map(e=>[e.sequence,e.call.id]),[[1,'one'],[2,'bad'],[3,'two']]);
  // A returned tool result can itself be an error; scheduler state must preserve it.
  const {JobManager}=await load('processes/jobs.js');const jobs=new JobManager(),failedJobHistory=[],failedJobEvents=[];let jobRequests=0;
  try {
   const job=await jobs.start({command:'exit 3',cwd:process.cwd(),timeoutMs:1000});await jobs.wait(job.id);
   await agentLoop({async generate(){return ++jobRequests===1?reply('',[call('failed-job','read_job',{job_id:job.id})]):reply('FAILURE_OBSERVED');}},failedJobHistory,'Observe failed job',signal(),e=>failedJobEvents.push(e),undefined,new Set(),{jobs});
   assert.equal(failedJobHistory.find(m=>m.role==='tool').isError,true);assert.equal(failedJobEvents.filter(e=>e.type==='tool_state').at(-1).state,'failed');
  } finally {await jobs.close();}
  // Independent protected reads may share slots, but the interactive approval handler stays exclusive.
  temporary.file('project/.agents/one.ts','export const first = 1;');temporary.file('project/.agents/two.ts','export const second = 2;');
  let approvalActive=0,approvalMax=0,approvalCount=0,approvalRequests=0;
  await agentLoop({async generate(){return ++approvalRequests===1?reply('',[call('approval-one','read_file',{path:'.agents/one.ts',offset:1,limit:2}),call('approval-two','read_file',{path:'.agents/two.ts',offset:1,limit:2})]):reply('APPROVALS_OBSERVED');}},[],'Read metadata',signal(),()=>{},async()=>{approvalCount++;approvalActive++;approvalMax=Math.max(approvalMax,approvalActive);await delay(15);approvalActive--;return {decision:'allow_once'};});
  assert.equal(approvalCount,2);assert.equal(approvalMax,1,'Only one interactive approval handler owns input at once');
  const denied=[],deniedHistory=[];let denialRequests=0;
  await agentLoop({async generate(){return ++denialRequests===1?reply('',[call('forbidden','write_file',{path:'never.ts',content:'BAD'})]):reply('DENIED');}},deniedHistory,'Plan',signal(),e=>denied.push(e),async()=>{throw Error('Plan must not ask');},new Set(),{mode:'plan'});
  assert.match(deniedHistory.find(m=>m.role==='tool').content,/权限拒绝/);assert.equal(denied.some(e=>e.type==='tool_start'),false);
  if(lesson!=='01-bounded-reads') {
   const failures=[],started=[];const began=Date.now();
   await runToolBatch([item('r1'),item('r2'),item('r3')],signal(),async({call},inner)=>{started.push(call.id);await delay(65);assert.equal(inner.aborted,true);return true;},()=>{},{concurrency:1,queueTimeoutMs:20,executionTimeoutMs:10,onFailure:(entry,failure)=>failures.push([entry.call.id,failure.state])});
   assert.ok(Date.now()-began>=60,'Uncooperative underlying request retains capacity until true settlement');assert.deepEqual(started,['r1']);assert.deepEqual(failures.map(e=>e.join(':')).sort(),['r1:execution_timeout','r2:queue_timeout','r3:queue_timeout']);
   let cleaned=false;const order2=[];
   await runToolBatch([item('r1'),item('r2')],signal(),async({call},inner)=>{order2.push(call.id);if(call.id==='r1'){await new Promise(resolve=>inner.addEventListener('abort',resolve,{once:true}));await delay(35);cleaned=true;}else assert.ok(cleaned,'Next read starts only after cleanup');return true;},()=>{},{concurrency:1,queueTimeoutMs:500,executionTimeoutMs:10});assert.deepEqual(order2,['r1','r2']);
   const parent=new AbortController(),cancelled=[];let settled=0;
   const batch=runToolBatch([item('r1'),item('r2'),item('r3'),item('w4','write_file')],parent.signal,async(entry,inner)=>{await new Promise(resolve=>inner.addEventListener('abort',resolve,{once:true}));await delay(25);settled++;inner.throwIfAborted();},()=>{},{onFailure:(entry,failure)=>cancelled.push([entry.call.id,failure.started,failure.state])});
   setTimeout(()=>parent.abort(new Error('PARENT_CANCEL')),10);await assert.rejects(batch,/PARENT_CANCEL/);assert.equal(settled,2);assert.equal(cancelled.length,4);assert.equal(cancelled.find(e=>e[0]==='w4')[1],false);
   // A real process ignores TERM, so returning capacity must await the existing hard-kill/close path.
   const {runProcess}=await load('processes/run-process.js');const pidFile=join(process.cwd(),lesson+'-pid'),lateFile=join(process.cwd(),lesson+'-late');let beganProcess=0;
   await runToolBatch([item('r1'),item('r2')],signal(),async({call},inner)=>{
    if(call.id==='r1'){beganProcess=Date.now();await runProcess(process.execPath,['-e',`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(lateFile)},'BAD'),700);setInterval(()=>{},1000)`],{cwd:process.cwd(),signal:inner});}
    else{assert.ok(Date.now()-beganProcess>=300);const pid=Number(readFileSync(pidFile,'utf8'));assert.throws(()=>process.kill(pid,0));}return true;
   },()=>{},{concurrency:1,queueTimeoutMs:2000,executionTimeoutMs:100});await delay(420);assert.equal(existsSync(lateFile),false);
   console.log(`✓ 27 ${lesson}: separate queue/execution clocks, no early slot release, parent cancellation, queued-call terminal states, real TERM/KILL/close cleanup`);
  }
  if(lesson==='03-batch-results') {
   const duplicate=[item('r1'),item('r1')];let executed=false;await assert.rejects(runToolBatch(duplicate,signal(),async()=>{executed=true;return true;},()=>{}),/ID/);assert.equal(executed,false);
   temporary.file('project/slow.ts',('const row = "'+ 'x'.repeat(20)+'";\n').repeat(160000));
   const ordered=[call('slow','read_file',{path:'slow.ts',offset:150000,limit:3}),call('missing','read_file',{path:'absent.ts',offset:1,limit:1}),call('fast')],trace=[],orderedHistory=[];let count=0;
   await agentLoop({async generate(messages){count++;trace.push('model:'+count);if(count===1)return reply('',ordered);const tool=messages.filter(m=>m.role==='tool');assert.deepEqual(tool.map(m=>m.toolCallId),['slow','missing','fast']);assert.match(tool[0].content,/150000:/);assert.equal(tool[1].isError,true);assert.match(tool[2].content,/observed = 7/);return reply('BARRIER_OK');}},orderedHistory,'Read',signal(),e=>{if(e.type==='tool_finish')trace.push('finish:'+e.call.id);if(e.type==='tool_batch_finish')trace.push('barrier:'+e.results);});
   assert.ok(trace.indexOf('finish:fast')<trace.indexOf('finish:slow'),'Real long offset read finishes after its independent sibling');assert.ok(trace.indexOf('model:2')>trace.indexOf('barrier:3'));assert.equal(orderedHistory.filter(m=>m.role==='tool').length,3);
   // Cancel while two calls are admitted; queued calls and a later side-effect barrier still get one clear observation each.
   const parent=new AbortController(),cancelHistory=[],cancelEvents=[];const cancelledCalls=[call('c1'),call('c2'),call('c3'),call('w4','write_file',{path:'must-not-write.ts',content:'BAD'})];
   await assert.rejects(agentLoop({async generate(){return reply('',cancelledCalls);}},cancelHistory,'Cancel',parent.signal,e=>{cancelEvents.push(e);if(e.type==='tool_start'&&e.call.id==='c2')parent.abort(new Error('TURN_CANCEL'));}),/TURN_CANCEL/);
   assert.deepEqual(cancelHistory.filter(m=>m.role==='tool').map(m=>m.toolCallId),cancelledCalls.map(c=>c.id));assert.match(cancelHistory.find(m=>m.role==='tool'&&m.toolCallId==='w4').content,/未执行/);assert.equal(existsSync(join(process.cwd(),'must-not-write.ts')),false);assert.match(cancelHistory.at(-1).content,/本轮已取消/);assert.equal(cancelEvents.filter(e=>e.type==='tool_batch_finish').length,1);
   // A real local log failure keeps the already-returned tool evidence while cancelling/settling siblings.
   temporary.file('project/long-result.ts',('x'.repeat(100)+'\n').repeat(400));const notDirectory=temporary.file('project/not-a-directory','file');const fatalHistory=[];
   await assert.rejects(agentLoop({async generate(){return reply('',[call('returned'),call('log-failed','read_file',{path:'long-result.ts',offset:1,limit:400}),call('sibling','read_file',{path:'slow.ts',offset:150000,limit:3})]);}},fatalHistory,'Read large output',signal(),()=>{},undefined,new Set(),{toolResultDirectory:notDirectory}),/完整工具结果日志无法保存/);
   const fatalTools=fatalHistory.filter(m=>m.role==='tool');assert.deepEqual(fatalTools.map(m=>m.toolCallId),['returned','log-failed','sibling']);assert.match(fatalTools[0].content,/observed = 7/);assert.match(fatalTools[1].content,/工具已返回.*完整日志未保存/);assert.equal(new Set(fatalTools.map(m=>m.toolCallId)).size,3);
   console.log('✓ 27 03-batch-results: real reverse completion, original-ID ordered barrier, duplicate-ID rejection, parent-cancel history repair, retained actual result after log failure');
  }
  console.log(`✓ 27 ${lesson}: capacity, adjacent-read whitelist, write/load-skill barriers, serial Hooks, stable IDs, ordinary-error siblings, failed-job terminal state, exclusive approvals, Plan gate`);
 }
}finally{process.chdir(oldCwd);temporary.close();}
