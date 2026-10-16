/** Independent child sessions, actual SDK return path, runtime allowlist, budgets and cancellation. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build, reply, sdkServer, sendReply, signal, workspace } from './runtime-fixtures.mjs';
const temporary=workspace('25'),oldCwd=process.cwd();
try {
 const project=join(temporary.directory,'project');temporary.file('project/package.json','{"type":"module"}');temporary.file('project/source.ts','export const observed = 7;\n');process.chdir(project);
 for(const lesson of ['01-child-sessions','02-readonly-roles','03-child-observation']) {
  const {load}=build('chapter-25-subagents',lesson,temporary);
  const {createModel}=await load('models/client.js'),{agentLoop}=await load('agent/agent-loop.js'),{runSubagent,parseChildTask}=await load('subagents/runner.js');
  const {createSessionWriter}=await load('sessions/save-session.js'),{readSession}=await load('sessions/read-session.js');
  const directory=join(temporary.directory,lesson,'sessions');
  for(const args of ['{}','{"role":"review","task":"x","tools":["write_file"]}','{"role":"write","task":"x"}']) assert.throws(()=>parseChildTask(args));
  for(const provider of ['openai','anthropic']) {
   let parentCount=0,childCount=0,childPayload;
   const service=await sdkServer((entry,response)=>{
    const names=entry.body.tools.map(tool=>tool.function?.name??tool.name),body=JSON.stringify(entry.body);
    if(names.includes('delegate_task')) {
     parentCount++;
     if(parentCount===1) sendReply(entry,response,reply('',[{id:'parent-delegation',name:'delegate_task',arguments:JSON.stringify({role:'explore',task:'CHILD_SCOPE read source.ts'})}]));
     else { assert.match(body,/parent-delegation/);assert.match(body,/CHILD_OBSERVATION/);assert.match(body,/"status"/);sendReply(entry,response,reply('PARENT_CHECKED_RESULT')); }
    } else {
     assert.deepEqual([...names].sort(),['glob','grep','read_file']);assert.doesNotMatch(body,/PARENT_SECRET/);childCount++;childPayload=entry.body;
     if(childCount===1)sendReply(entry,response,reply('',[{id:'child-read',name:'read_file',arguments:JSON.stringify({path:'source.ts',offset:1,limit:10})}]));
     else{assert.match(body,/observed = 7/);assert.match(body,/child-read/);sendReply(entry,response,reply('CHILD_OBSERVATION; invented.ts:999 is only a model claim'));}
    }
   });
   const model=createModel({provider,model:'fixture',apiKey:'fixture',baseURL:service.url});
   const parent=await createSessionWriter(directory),history=[{role:'user',content:'PARENT_SECRET'}],events=[];
   try {
    const outcome=await agentLoop(model,history,'Inspect a local module',signal(),event=>events.push(event),async()=>({action:'allow',scope:'once'}),new Set(),{sessionId:parent.id,childSessionDirectory:directory});
    assert.equal(outcome.text,'PARENT_CHECKED_RESULT');assert.equal(parentCount,2);assert.equal(childCount,2);
    const tool=history.find(m=>m.role==='tool'&&m.toolCallId==='parent-delegation'),result=JSON.parse(tool.content);
    assert.equal(result.status,'completed');assert.equal(result.parentSessionId,parent.id);assert.notEqual(result.sessionId,parent.id);assert.equal(result.modelCalls,2);
    assert.equal(history.filter(m=>m.role==='tool').length,1,'Child raw tool messages must stay out of parent history');
    if(lesson!=='01-child-sessions')assert.deepEqual(result.evidence,[{kind:'read',path:'source.ts',startLine:1,endLine:1}]);
    assert.ok(!result.evidence.some(item=>item.path==='invented.ts'));
    const saved=await readSession(result.sessionId,directory);assert.equal(saved.header.parent.sessionId,parent.id);assert.equal(saved.header.parent.seq,0);assert.equal(saved.interrupted,false);
    assert.match(JSON.stringify(saved.state.messages),/child-read/);assert.doesNotMatch(JSON.stringify(saved.state.messages),/PARENT_SECRET/);assert.ok(childPayload);
    if(lesson==='03-child-observation'){const states=events.filter(e=>e.type==='child_state');assert.ok(states.length>=3);assert.equal(states.at(-1).status,'completed');}
    await parent.save({messages:history,mode:'execute',tasks:[],pendingInputs:[],run:1,nextInputId:1},'run_end');
   }finally{await parent.close();await service.close();}
  }
  // A model may ask for forbidden tools even if their definitions were hidden.
  for(const name of ['write_file','run_command','delegate_task','web_fetch','mcp__unknown']) {
   let calls=0,approval=0;const seen=[];
   const fake={async generate(messages,_signal,_onText,options){assert.ok(options.allowedTools.includes('read_file'));seen.push(structuredClone(messages));return ++calls===1?reply('',[{id:'forbidden',name,arguments:JSON.stringify({path:'must-not-exist.ts',content:'BAD',command:'touch must-not-exist.ts',role:'review',task:'no recursion'})}]):reply('Denied and stopped');}};
   const result=await runSubagent(fake,JSON.stringify({role:'review',task:'Review source'}),signal(),{sessionDirectory:directory,requestApproval:async()=>{approval++;return {action:'allow',scope:'once'};}});
   assert.equal(result.status,'completed');assert.equal(approval,0);assert.match(JSON.stringify(seen.at(-1)),/子任务不允许工具/);assert.ok(!existsSync(join(project,'must-not-exist.ts')));
  }
  let count=0;const endless={async generate(){count++;return reply('',[{id:`read-${count}`,name:'read_file',arguments:'{"path":"source.ts","offset":1,"limit":5}'}]);}};
  const limited=await runSubagent(endless,'{"role":"explore","task":"Read"}',signal(),{sessionDirectory:directory,maxModelCalls:1});assert.equal(limited.status,'budget_exhausted');assert.equal(limited.modelCalls,1);assert.deepEqual(limited.evidence,[]);
  count=0;const exhausted=await runSubagent(endless,'{"role":"explore","task":"Read"}',signal(),{sessionDirectory:directory,requestTokenBudget:1});assert.equal(exhausted.status,'budget_exhausted');assert.equal(count,0);
  const depth=await runSubagent(endless,'{"role":"explore","task":"Read"}',signal(),{sessionDirectory:directory,depth:1});assert.equal(depth.status,'failed');assert.equal(count,0);
  const cancel=new AbortController();let received;const accepted=new Promise(resolve=>received=resolve);
  const held=await sdkServer((_entry,response)=>{response.writeHead(200,{'content-type':'text/event-stream'});response.write(': hold\n\n');received();});
  try {
   const model=createModel({provider:'openai',model:'fixture',apiKey:'fixture',baseURL:held.url});
   const pending=runSubagent(model,'{"role":"review","task":"Wait"}',cancel.signal,{sessionDirectory:directory});await accepted;cancel.abort(new Error('CANCEL_PARENT'));
   const result=await pending;assert.equal(result.status,'cancelled');assert.equal(result.usage.inputTokens,null);const saved=await readSession(result.sessionId,directory);assert.equal(saved.interrupted,false);assert.ok(!existsSync(join(directory,`${result.sessionId}.lock`)));
  }finally{await held.close();}
  assert.ok(readdirSync(directory).every(name=>!name.endsWith('.lock')));
  console.log(`✓ 25 ${lesson}: actual dual SDK parent→child→read→parent, independent JSONL, readonly deny before approval, evidence, budget, depth and cancellation cleanup`);
 }
}finally{process.chdir(oldCwd);temporary.close();}
