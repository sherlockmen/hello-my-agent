/** 第19章：临时独立构建、真实技能文件与本地模型SSE；不读真实.env，不改dist，不调用在线模型。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)), temporary=realpathSync(mkdtempSync(join(tmpdir(),'hello-agent19-'))), cwd=process.cwd();
const lessons=['01-discover-skills','02-load-on-demand','03-model-skill-tools'];
const signal=()=>new AbortController().signal;
const fixture=name=>{const path=join(temporary,name);mkdirSync(path,{recursive:true});return path;};
const file=(dir,name,body)=>{const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);return path;};
const skill=(dir,name,body='REVIEW_BODY_SECRET\nRead references/checklist.md.',header=`name: ${name}\ndescription: Review code changes using a checklist.`)=>file(dir,`.hello-my-agent/skills/${name}/SKILL.md`,`---\n${header}\n---\n${body}`);
const load=(dist,path)=>import(pathToFileURL(join(dist,path)).href);
function compile(lesson){
 const src=join(root,'chapter-19-skills',lesson,'src'),build=fixture(`build-${lesson}`),dist=join(build,'dist');
 file(build,'package.json','{"type":"module"}');symlinkSync(join(root,'node_modules'),join(build,'node_modules'));
 file(build,'tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{noEmit:false,noEmitOnError:true,rootDir:src,outDir:dist,typeRoots:[join(root,'node_modules/@types')]},include:[join(src,'**/*.ts'),join(src,'**/*.tsx')]}));
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(build,'tsconfig.json')],{stdio:'inherit'});return dist;
}
async function discovery(api,label){
 const project=fixture(`${label}-catalog`);file(project,'package.json','{}');skill(project,'review');
 skill(project,'folded','FOLDED_BODY','name: folded\ndescription: >\n  Review folded descriptions\n  when changes need checking.');
 skill(project,'quoted','QUOTED_BODY',`name: 'quoted'\ndescription: "Review: changes with # markers"`);
 const state=await api.discoverSkills(project);
 assert.deepEqual(state.entries.map(x=>x.name),['folded','quoted','review']);assert.equal(state.loaded.size,0);
 assert.match(state.entries[0].description,/descriptions when/);assert.equal(state.entries[2].path,'.hello-my-agent/skills/review/SKILL.md');
 assert.doesNotMatch(api.skillPrompt(state),/REVIEW_BODY_SECRET|FOLDED_BODY/);assert.match(api.skillPrompt(state),/不能授予/);
 assert.doesNotMatch(api.skillInfo(state).join('\n'),/REVIEW_BODY_SECRET/);
 assert.deepEqual((await api.discoverSkills(fixture(`${label}-empty`))).notices,[]);
 const invalid=fixture(`${label}-invalid`);
 for(const [name,header] of [['unknown','name: unknown\ndescription: text\nallowed-tools: run_command'],['duplicate','name: duplicate\nname: duplicate\ndescription: text'],['wrong','name: review\ndescription: text'],['empty','name: empty\ndescription: ""'],['type','name: type\ndescription: true'],['complex','name: complex\ndescription: [text]'],['long','name: long\ndescription: '+ 'x'.repeat(1025)]])skill(invalid,name,'DO_NOT_LOAD',header);
 skill(invalid,'large','x'.repeat(32769));skill(invalid,'header','body','name: header\ndescription: '+ 'x'.repeat(4096));
 const bad=await api.discoverSkills(invalid);assert.equal(bad.entries.length,0);assert.equal(bad.notices.length,9);
 const links=fixture(`${label}-links`);skill(links,'real');symlinkSync(join(links,'.hello-my-agent/skills/real'),join(links,'.hello-my-agent/skills/alias'),'dir');
 const linkSkill=fixture(`${label}-links/.hello-my-agent/skills/linked`);symlinkSync(join(links,'.hello-my-agent/skills/real/SKILL.md'),join(linkSkill,'SKILL.md'));
 assert.equal((await api.discoverSkills(links)).notices.length,2);
 const rootLink=fixture(`${label}-root-link`);fixture(`${label}-root-link/.hello-my-agent`);symlinkSync(join(links,'.hello-my-agent/skills'),join(rootLink,'.hello-my-agent/skills'),'dir');
 assert.equal((await api.discoverSkills(rootLink)).entries.length,0);
 const many=fixture(`${label}-many`);for(let i=0;i<65;i++)skill(many,`skill-${i}`);
 const bounded=await api.discoverSkills(many);assert.equal(bounded.entries.length,0);assert.match(bounded.notices[0].reason,/64/);
 const aborted=new AbortController();aborted.abort(new Error('cancel-discovery'));await assert.rejects(api.discoverSkills(project,aborted.signal),/cancel-discovery/);
 return {project,state};
}
async function loading(api,label){
 const project=fixture(`${label}-loading`);const path=skill(project,'review'),state=await api.discoverSkills(project);
 assert.equal(await api.skillCommand('ordinary question',state,signal()),null);
 assert.match(await api.skillCommand('/skill missing',state,signal()),/加载失败/);assert.equal(state.loaded.size,0);
 const result=await api.loadSkill(state,'review',signal());assert.equal(state.loaded.size,1);assert.match(api.skillPrompt(state),/REVIEW_BODY_SECRET/);
 assert.equal(result.sha256,createHash('sha256').update(readFileSync(path)).digest('hex'));
 file(project,'.hello-my-agent/skills/review/SKILL.md','changed after first load');assert.equal((await api.loadSkill(state,'review',signal())).sha256,result.sha256,'重复加载复用已经完整接纳的快照');
 assert.doesNotMatch((await api.skillCommand('/skills',state,signal())),/REVIEW_BODY_SECRET/);
 const changed=fixture(`${label}-changed`);const changedFile=skill(changed,'review');const changedState=await api.discoverSkills(changed);writeFileSync(changedFile,'---\nname: review\ndescription: altered\n---\nBODY');
 await assert.rejects(api.loadSkill(changedState,'review',signal()),/元信息已变化/);assert.equal(changedState.loaded.size,0);
 for(const [name,body,reason] of [['empty','   ',/为空/],['nul','bad\0body',/NUL/],['utf','ok',/UTF-8/]]){
  const project=fixture(`${label}-${name}`),path=skill(project,'review',body),state=await api.discoverSkills(project);
  if(name==='utf'){const header='---\nname: review\ndescription: text\n---\n';writeFileSync(path,Buffer.concat([Buffer.from(header),Buffer.from([255])]));const updated=await api.discoverSkills(project);await assert.rejects(api.loadSkill(updated,'review',signal()),reason);assert.equal(updated.loaded.size,0);}
  else{await assert.rejects(api.loadSkill(state,'review',signal()),reason);assert.equal(state.loaded.size,0);}
 }
 const budget=fixture(`${label}-budget`);for(const name of ['a','b','c']){const prefix=`---\nname: ${name}\ndescription: text\n---\n`;skill(budget,name,'x'.repeat(32768-Buffer.byteLength(prefix)),'name: '+name+'\ndescription: text');}
 const limited=await api.discoverSkills(budget);await api.loadSkill(limited,'a',signal());await api.loadSkill(limited,'b',signal());await assert.rejects(api.loadSkill(limited,'c',signal()),/总预算/);assert.equal(limited.loaded.size,2);
 const cancelled=fixture(`${label}-cancel`);skill(cancelled,'review');const cancelledState=await api.discoverSkills(cancelled),controller=new AbortController();
 const originalOpen=fsPromises.open;let closed=false;
 fsPromises.open=async(...args)=>{const handle=await originalOpen(...args),read=handle.read.bind(handle),close=handle.close.bind(handle);handle.read=async(...values)=>{const result=await read(...values);controller.abort(new Error('cancel-body-read'));return result;};handle.close=async()=>{closed=true;return close();};return handle;};syncBuiltinESMExports();
 try{await assert.rejects(api.loadSkill(cancelledState,'review',controller.signal),/cancel-body-read/);assert.equal(closed,true);assert.equal(cancelledState.loaded.size,0);}finally{fsPromises.open=originalOpen;syncBuiltinESMExports();}
 return {project,state};
}
async function resources(api,dist){
 const project=fixture('resources');skill(project,'review');const state=await api.discoverSkills(project);file(project,'.hello-my-agent/skills/review/references/checklist.md','RESOURCE_CHECKLIST');
 await assert.rejects(api.readSkillResource(state,'review','references/checklist.md',signal()),/先load_skill/);await api.loadSkill(state,'review',signal());
 const resource=await api.readSkillResource(state,'review','references/checklist.md',signal());assert.equal(resource.text,'RESOURCE_CHECKLIST');assert.match(resource.path,/review\/references\/checklist.md$/);assert.doesNotMatch(api.skillPrompt(state),/RESOURCE_CHECKLIST/);
 for(const path of ['../outside','/etc/passwd','C:\\secret','references\\checklist.md','.env','references/../SKILL.md','references//checklist.md','.git/config','./SKILL.md'])await assert.rejects(api.readSkillResource(state,'review',path,signal()),/相对路径/);
 symlinkSync(file(project,'outside.md','OUTSIDE'),join(project,'.hello-my-agent/skills/review/references/link.md'));await assert.rejects(api.readSkillResource(state,'review','references/link.md',signal()),/符号链接/);
 file(project,'.hello-my-agent/skills/review/references/large.md','x'.repeat(32769));await assert.rejects(api.readSkillResource(state,'review','references/large.md',signal()),/32768/);
 file(project,'.hello-my-agent/skills/review/scripts/check.sh','touch MUST_NOT_EXECUTE');await api.readSkillResource(state,'review','scripts/check.sh',signal());
 const tools=await load(dist,'tools/skill-tools.js');for(const input of ['{','[]','{"name":"review","allow":true}','{"name":1}'])await assert.rejects(tools.skillTool('load_skill',input,state,signal()));
 const policy=await load(dist,'permissions/policy.js');for(const name of ['load_skill','read_skill_resource'])assert.equal((await policy.decideToolPermission({id:'test',name,arguments:'{"name":"review","path":"references/checklist.md"}'},new Set(),project,'plan')).action,'allow');
 assert.equal((await policy.decideToolPermission({id:'test',name:'run_command',arguments:'{"command":"true"}'},new Set(),project,'plan')).action,'deny');
 return project;
}
let current;
const requests=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);const step=current.steps.shift();assert.ok(step,'unexpected model request');
 res.setHeader('content-type','text/event-stream');const anthropic=req.url.includes('messages');
 if(anthropic){const send=e=>res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);send({type:'message_start',message:{id:'m1',type:'message',role:'assistant',model:'fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
 if(step.name){send({type:'content_block_start',index:0,content_block:{type:'tool_use',id:step.id,name:step.name,input:{}}});send({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(step.args)}});send({type:'content_block_stop',index:0});}
 else{send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SKILL_FLOW_COMPLETE'}});send({type:'content_block_stop',index:0});}
 send({type:'message_delta',delta:{stop_reason:step.name?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}});send({type:'message_stop'});
 }else{const send=delta=>res.write(`data: ${JSON.stringify({id:'c1',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
 send(step.name?{role:'assistant',tool_calls:[{index:0,id:step.id,type:'function',function:{name:step.name,arguments:JSON.stringify(step.args)}}]}:{role:'assistant',content:'SKILL_FLOW_COMPLETE'});
 res.write(`data: ${JSON.stringify({id:'c1',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:step.name?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);}
 res.end();
});
try{
 const builds=[];for(let i=0;i<lessons.length;i++){const dist=compile(lessons[i]),api=await load(dist,'skills/catalog.js');await discovery(api,lessons[i]);if(i>0)await loading(api,lessons[i]);builds.push({dist,api});console.log(`✓ 19.${i+1}: discovery${i>0?', atomic loading, cancellation and budget':''}`);}
 const {dist,api}=builds[2];await resources(api,dist);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseURL=`http://127.0.0.1:${server.address().port}`;
 for(const provider of ['openai','anthropic']){
  const project=fixture(`flow-${provider}`);file(project,'package.json','{}');skill(project,'review');file(project,'.hello-my-agent/skills/review/references/checklist.md','RESOURCE_CHECKLIST');
  const state=await api.discoverSkills(project),{createModel}=await load(dist,'models/client.js'),{loadProjectInstructions}=await load(dist,'project/instructions.js'),{runAgent}=await load(dist,'agent/run.js');
  const {createMemoryController}=await load(dist,'memory/commands.js');
  const memory=await createMemoryController(project);const adapter=createModel({provider,apiKey:'fixture-only',model:'fixture',baseURL},await loadProjectInstructions(project),memory,state);
  const sent=[];const model={...adapter,async generate(messages,...args){sent.push(structuredClone(messages));return adapter.generate(messages,...args);}};
  current={steps:[{id:'load-review',name:'load_skill',args:{name:'review'}},{id:'read-checklist',name:'read_skill_resource',args:{name:'review',path:'references/checklist.md'}},{id:'forbidden-command',name:'run_command',args:{command:'touch MUST_NOT_EXECUTE',cwd:'.'}},{}]};requests.length=0;process.chdir(project);
  const history=[],events=[];await runAgent(model,history,'Review this change.',signal(),e=>events.push(e),undefined,new Set(),{mode:'plan'});
  assert.equal(current.steps.length,0);assert.equal(requests.length,4);const system=request=>provider==='openai'?request.messages[0].content:request.system;
  assert.doesNotMatch(system(requests[0]),/REVIEW_BODY_SECRET/);assert.match(system(requests[1]),/REVIEW_BODY_SECRET/);assert.doesNotMatch(system(requests[1]),/RESOURCE_CHECKLIST/);
  assert.match(JSON.stringify(requests[2].messages),/RESOURCE_CHECKLIST/);assert.match(JSON.stringify(requests[3].messages),/Plan/);
  assert.equal(history.find(x=>x.role==='tool'&&x.toolCallId==='forbidden-command').isError,true);assert.ok(events.some(e=>e.type==='tool_finish'&&e.outcome==='success'&&e.result.metadata.kind==='load_skill'));
  const {estimateContext,DEFAULT_CONTEXT_LIMITS}=await load(dist,'context/budget.js'),{toolDefinitions}=await load(dist,'tools/registry.js');
  const definitions=toolDefinitions.filter(tool=>['read_file','read_tool_result','glob','grep','todo_write','ask_user','load_skill','read_skill_resource'].includes(tool.name));
  const budgets=events.filter(e=>e.type==='context_budget');assert.equal(budgets.length,4);
  for(let i=0;i<4;i++)assert.equal(budgets[i].budget.inputEstimate,estimateContext(sent[i],system(requests[i]),definitions,DEFAULT_CONTEXT_LIMITS).inputEstimate,'真实发送的system与Agent Loop预算完全同源');
  process.chdir(cwd);console.log(`✓ 19.3 ${provider}: catalog → load → system body → resource tool result → Plan denial → final answer`);
 }
 console.log('✓ Chapter 19 independent snapshots, files, tools and local SSE passed.');
}finally{process.chdir(cwd);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(temporary,{recursive:true,force:true});}
