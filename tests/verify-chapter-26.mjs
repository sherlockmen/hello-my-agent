/** Real background process ownership, bounded logs, approval gates and terminal transport. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build, reply, signal, workspace } from './runtime-fixtures.mjs';
const temporary=workspace('26'),oldCwd=process.cwd();
const quote=value=>`'${value.replaceAll("'", "'\\''")}'`;
const node=code=>`${quote(process.execPath)} -e ${quote(code)}`;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(check,label){for(let i=0;i<150;i++){const value=await check();if(value)return value;await delay(20);}throw new Error(`Timed out: ${label}`);}
try {
 temporary.file('project/package.json','{"type":"module"}');const project=join(temporary.directory,'project');process.chdir(project);
 const lessons=process.env.LESSON_26?[process.env.LESSON_26]:['01-background-jobs','02-pty-takeover','03-job-lifecycle'];
 for(const lesson of lessons) {
  const {load}=build('chapter-26-interactive-jobs',lesson,temporary);
  const {JobManager,jobCommand}=await load('processes/jobs.js'),{prepareJob,readJob}=await load('tools/job-tools.js');
  const {executeTool}=await load('tools/registry.js'),{decideToolPermission}=await load('permissions/policy.js'),{agentLoop}=await load('agent/agent-loop.js');
  const jobs=new JobManager({active:2,history:3,logBytes:256});
  const outside=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{outside.once('spawn',resolve);outside.once('error',reject);});
  try {
   for(const input of [{command:'',cwd:project,timeoutMs:1000},{command:'true',cwd:project,timeoutMs:0}])await assert.rejects(jobs.start(input));
   const cancelled=new AbortController();cancelled.abort(new Error('PRE_START_CANCELLED'));await assert.rejects(jobs.start({command:'touch prestart-bad',cwd:project,timeoutMs:1000},cancelled.signal),/PRE_START_CANCELLED/);assert.ok(!existsSync(join(project,'prestart-bad')));
   const noDir=await jobs.start({command:'true',cwd:join(project,'absent'),timeoutMs:1000}).then(()=>null,error=>error);assert.ok(noDir);assert.ok(jobs.list().every(job=>job.state==='failed'));
   const controller=new AbortController();
   const live=await jobs.start({command:node('console.log("STARTED");setInterval(()=>{},1000)'),cwd:project,timeoutMs:3000},controller.signal);
   assert.equal(live.state,'running');assert.ok(live.pid>0);assert.ok(alive(live.pid));
   controller.abort(new Error('ONLY_THIS_MODEL_TURN'));await delay(40);assert.equal(jobs.get(live.id).state,'running','A registered background job belongs to the session, not the completed/cancelled turn');
   const copy=jobs.get(live.id);copy.state='failed';assert.equal(jobs.get(live.id).state,'running');
   const flood=await jobs.start({command:node('process.stdout.write("x".repeat(20000));process.stderr.write("TAIL");'),cwd:project,timeoutMs:3000});
   await assert.rejects(jobs.start({command:'true',cwd:project,timeoutMs:1000}),/上限/);
   const ended=await jobs.wait(flood.id);assert.equal(ended.exitCode,0);assert.ok(ended.retainedBytes<=256);assert.ok(ended.droppedBytes>19000);assert.match(ended.log,/TAIL/);
   const stopped=await jobs.stop(live.id);assert.equal(stopped.state,'exited');assert.equal(stopped.stopReason,'user');assert.ok(!alive(live.pid));
   assert.equal((await jobs.stop(live.id)).stopReason,'user');
   await assert.rejects(jobs.stop(String(outside.pid)),/未知 JobID/);assert.ok(alive(outside.pid));
   assert.match(await jobCommand(`/job ${live.id}`,jobs),/JobID:/);await assert.rejects(jobCommand(`/stop ${outside.pid}`,jobs));
   const eof=await jobs.start({command:node('process.stdin.resume();process.stdin.on("end",()=>console.log("PIPE_EOF"));'),cwd:project,timeoutMs:1000});assert.match((await jobs.wait(eof.id)).log,/PIPE_EOF/);
   const startCancel=new AbortController();const pendingStart=jobs.start({command:node('setInterval(()=>{},1000)'),cwd:project,timeoutMs:2000},startCancel.signal);startCancel.abort(new Error('START_WINDOW_CANCELLED'));await assert.rejects(pendingStart,/START_WINDOW_CANCELLED/);assert.ok(jobs.list().every(job=>job.state==='exited'||job.state==='failed'));
   const lateMarker=join(project,`${lesson}-late`);
   const timed=await jobs.start({command:node(`process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(lateMarker)},'BAD'),1200);setInterval(()=>{},1000)`),cwd:project,timeoutMs:150});
   const started=Date.now();const timeout=await jobs.wait(timed.id);assert.equal(timeout.stopReason,'timeout');assert.ok(Date.now()-started>=300,'Timeout waits for cleanup rather than returning a race winner');assert.ok(!alive(timed.pid));
   await delay(850);assert.ok(!existsSync(lateMarker));
   const childFile=join(project,`${lesson}-descendant`);
   const descendant=await jobs.start({command:node(`const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(childFile)},String(c.pid));setInterval(()=>{},1000);`),cwd:project,timeoutMs:3000});
   await until(()=>existsSync(childFile),'descendant PID');const childPid=Number(readFileSync(childFile,'utf8'));assert.ok(alive(childPid));await jobs.stop(descendant.id);await until(()=>!alive(childPid),'owned descendant stopped');
   const heldPipe=join(project,`${lesson}-held-pipe`);
   const held=await jobs.start({command:node(`const fs=require('fs');require('child_process').spawn(process.execPath,['-e',${JSON.stringify(`process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(heldPipe)},String(process.pid));setInterval(()=>{},1000)`)}],{stdio:['ignore',1,2]});const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(heldPipe)})){clearInterval(t);process.exit(0)}},10)`),cwd:project,timeoutMs:3000});
   await until(()=>existsSync(heldPipe),'inherited pipe child ready');const heldPid=Number(readFileSync(heldPipe,'utf8')),pipeStarted=Date.now();const heldEnd=await jobs.wait(held.id);assert.equal(heldEnd.exitCode,0);assert.ok(Date.now()-pipeStarted>=200,'Leader exit is not pipe close; wait must retain the child-held pipe through escalation');await until(()=>!alive(heldPid),'held pipe child cleaned');
   // Preparation cannot start or stop. Plan and child restrictions precede approval.
   const prepared=await prepareJob('start_job',JSON.stringify({command:node('setInterval(()=>{},1000)'),cwd:'.',timeout_ms:2000}),jobs,signal());
   assert.match(prepared.preview,/不会等待退出/);assert.ok(!jobs.list().some(job=>job.state==='running'));
   for(const name of ['start_job','stop_job'])assert.equal((await decideToolPermission({id:'p',name,arguments:'{}'},new Set(),project,'plan')).action,'deny');
   for(const name of ['start_job','stop_job'])assert.equal((await decideToolPermission({id:'p',name,arguments:'{}'})).action,'ask');
   await assert.rejects(executeTool({id:'unsafe',name:'start_job',arguments:'{}'},signal(),{jobs}),/先生成预览/);
   await assert.rejects(executeTool({id:'child',name:'read_job',arguments:'{}'},signal(),{jobs,allowedTools:['read_file']}),/子任务不允许/);
   await assert.rejects(prepareJob('start_job','{"command":"true","cwd":".."}',jobs,signal()));
   const result=await prepared.execute(signal());assert.equal(result.metadata.kind,'job');assert.equal(result.metadata.job.state,'running');const owned=result.metadata.job.id;
   assert.match((await readJob(JSON.stringify({job_id:owned}),jobs,signal())).content,new RegExp(owned));
   await assert.rejects(readJob(JSON.stringify({job_id:'00000000-0000-0000-0000-000000000000'}),jobs,signal()),/未知 JobID/);
   const stop=await prepareJob('stop_job',JSON.stringify({job_id:owned}),jobs,signal());assert.equal(jobs.get(owned).state,'running');await stop.execute(signal());
   // The agent returns every tool result under the original call ID; denial launches nothing.
   let count=0;const history=[];const model={jobs,async generate(messages){if(++count===1)return reply('',[{id:'background-original',name:'start_job',arguments:'{"command":"touch must-not-run","cwd":"."}'}]);assert.match(JSON.stringify(messages),/background-original/);assert.match(JSON.stringify(messages),/拒绝|denied|批准/);return reply('DECLINED');}};
   await agentLoop(model,history,'Request a background job',signal(),()=>{},async()=>({decision:'deny',reason:'denied'}));assert.ok(!existsSync(join(project,'must-not-run')));assert.equal(history.find(m=>m.role==='tool').toolCallId,'background-original');
   if(lesson!=='01-background-jobs') {
    if(!process.stdin.isTTY||!process.stdout.isTTY){const {takeoverJob}=await load('processes/takeover.js');await assert.rejects(takeoverJob(jobs,'not-a-job',signal()),/真实TTY/);}
    const ptyJob=await jobs.start({transport:'pty',command:node('console.log("REAL_TTY:"+process.stdin.isTTY+":"+process.stdout.isTTY);process.stdin.on("data",d=>console.log("HUMAN:"+d.toString().trim()));process.stdin.on("end",()=>{console.log("PTY_EOF");process.exit(0)});process.on("SIGINT",()=>console.log("CHILD_SIGINT"));process.stdout.on("resize",()=>console.log("SIZE:"+process.stdout.columns+":"+process.stdout.rows));'),cwd:project,timeoutMs:4000});
    await until(()=>jobs.get(ptyJob.id).log.includes('REAL_TTY:true:true'),'actual forkpty tty flags');
    const owner=jobs.attach(ptyJob.id,()=>{});assert.throws(()=>jobs.attach(ptyJob.id,()=>{}),/所有者/);owner.write('HUMAN_INPUT\n');await until(()=>jobs.get(ptyJob.id).log.includes('HUMAN:HUMAN_INPUT'),'human stdin');
    owner.resize(93,31);await until(()=>jobs.get(ptyJob.id).log.includes('SIZE:93:31'),'real ioctl resize');owner.write('\x03');await until(()=>jobs.get(ptyJob.id).log.includes('CHILD_SIGINT'),'terminal Ctrl-C signal');
    owner.detach();assert.throws(()=>owner.write('STALE_OWNER'),/接管已结束/);assert.equal(jobs.get(ptyJob.id).state,'running');
    const next=jobs.attach(ptyJob.id,()=>{});next.eof();const eof=await jobs.wait(ptyJob.id);next.detach();assert.match(eof.log,/PTY_EOF/);assert.equal(eof.exitCode,0);
    const nonTTY=await jobs.start({command:node('console.log("PIPE_TTY:"+Boolean(process.stdin.isTTY));'),cwd:project,timeoutMs:1000});assert.match((await jobs.wait(nonTTY.id)).log,/PIPE_TTY:false/);assert.throws(()=>jobs.attach(nonTTY.id,()=>{}),/只有PTY/);
    const invalidCwd=await jobs.start({transport:'pty',command:'true',cwd:join(project,'missing'),timeoutMs:1000});assert.equal((await jobs.wait(invalidCwd.id)).exitCode,1);
    const signalled=await jobs.start({transport:'pty',command:node('process.kill(process.pid,"SIGTERM")'),cwd:project,timeoutMs:1000});const terminated=await jobs.wait(signalled.id);assert.equal(terminated.signal,'SIGTERM');assert.equal((await readJob(JSON.stringify({job_id:signalled.id}),jobs,signal())).isError,true,'Native PTY may report code 0 with a termination signal; it is still an error');
    console.log(`✓ 26 ${lesson}: native forkpty tty flags, human input, actual SIGWINCH/cols/rows, Ctrl-C signal, canonical EOF, exclusive ownership, detach/reclaim, native child launch failure`);
   }
   if(lesson==='03-job-lifecycle') {
    const notices=[];const off=jobs.subscribe(notice=>notices.push(notice));
    const throwing=jobs.subscribe(()=>{throw new Error('observer does not own lifecycle')});
    for(const readyText of ['', 'two\nlines', 'x'.repeat(201)])await assert.rejects(jobs.start({command:'true',cwd:project,timeoutMs:1000,readyText}));
    await assert.rejects(prepareJob('start_job',JSON.stringify({command:'true',cwd:'.',ready_text:'a\nb'}),jobs,signal()));
    const notReady=await jobs.start({command:node('setInterval(()=>{},1000)'),cwd:project,timeoutMs:2000,readyText:'LISTENING'});
    assert.equal(notReady.readiness,'waiting');assert.equal(notReady.readyAt,null);await jobs.stop(notReady.id);assert.equal(jobs.get(notReady.id).readiness,'ended_before_ready');
    const marker='SERVER_LISTENING 127.0.0.1';
    const declared=await prepareJob('start_job',JSON.stringify({command:node('process.stdout.write("SERVER_LIST");setTimeout(()=>{process.stdout.write("ENING 127.0.0.1\\n");setTimeout(()=>{process.stdout.write("x".repeat(1000));},20)},30);setInterval(()=>{},1000)'),cwd:'.',ready_text:marker,timeout_ms:2000}),jobs,signal());
    assert.match(declared.preview,/SERVER_LISTENING/);assert.match(declared.preview,/HTTP/);
    const running=(await declared.execute(signal())).metadata.job;await until(()=>jobs.get(running.id).readiness==='ready','explicit readiness marker across chunks');
    await until(()=>jobs.get(running.id).droppedBytes>0,'ready evidence survives log tail eviction');
    const ready=jobs.get(running.id);assert.equal(ready.evidence,marker);assert.ok(ready.readyAt);assert.ok(!ready.log.includes(marker));
    await jobs.stop(running.id);assert.equal(jobs.get(running.id).readiness,'ready');
    assert.equal(notices.filter(n=>n.job.id===running.id&&n.type==='ready').length,1);assert.equal(notices.filter(n=>n.job.id===running.id&&n.type==='ended').length,1);
    const endNotice=notices.find(n=>n.job.id===running.id&&n.type==='ended');assert.equal(endNotice.job.state,'exited');assert.ok(!alive(endNotice.job.pid));
    throwing();off();const noticeCount=notices.length;const quick=await jobs.start({command:'true',cwd:project,timeoutMs:1000,readyText:'never'});await jobs.wait(quick.id);assert.equal(jobs.get(quick.id).readiness,'ended_before_ready');assert.equal(notices.length,noticeCount);
    console.log('✓ 26.3 lifecycle: explicit approved marker, split output, PID is not ready, exit before ready, retained evidence, isolated notices and unsubscribe');
   }
   await jobs.close();assert.ok(alive(outside.pid),'Shutdown must not kill a user-owned process');await assert.rejects(jobs.start({command:'true',cwd:project,timeoutMs:1000}),/已关闭/);
   console.log(`✓ 26 ${lesson}: real spawn/JobID, session lifetime, bounded draining, limits, timeout waits, group cleanup, outside ownership, approval/Plan/child gates`);
  } finally {await jobs.close();outside.kill('SIGKILL');await new Promise(resolve=>outside.once('close',resolve));}
 }
}finally{process.chdir(oldCwd);temporary.close();}
