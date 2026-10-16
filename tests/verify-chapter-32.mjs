/** Chapter 32: real checks and TypeScript LSP, content evidence, failure cleanup and literal exercise fixtures. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build, root, signal, reply, workspace } from './runtime-fixtures.mjs';
const temporary = workspace('32'), initialCwd = process.cwd();
function directory(name) { const result=join(temporary.directory,name);mkdirSync(result,{recursive:true});return result; }
function write(project,name,value) { const target=join(project,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));return target; }
function gone(pid) { assert.throws(()=>process.kill(process.platform==='win32'?pid:-pid,0),error=>error.code==='ESRCH'); }
async function ready(check) { for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('fixture not ready'); }
const lessons=['01-project-checks','02-lsp-navigation','03-current-diagnostics'];
try {
  for (const [index,lesson] of lessons.entries()) {
    const {load,dist}=build('chapter-32-code-intelligence',lesson,temporary);
    const {prepareCheckProject}=await load('tools/check-project.js');
    const {decideToolPermission}=await load('permissions/policy.js');
    const {executeTool}=await load('tools/registry.js');
    const {agentLoop}=await load('agent/agent-loop.js');
    const project=directory(`project-${index}`), manifest=join(project,'package.json');
    const pass={type:'module',scripts:{pretypecheck:'node -e "console.log(\'PRE_CHECK\')"',typecheck:'node -e "console.log(\'CHECK_OK\')"',posttypecheck:'node -e "console.log(\'POST_CHECK\')"',test:'node -e "console.error(\'CHECK_FAILED\');process.exit(3)"'}};
    write(project,'package.json',pass);
    const call={id:'project-check',name:'check_project',arguments:'{"script":"typecheck"}'};
    assert.equal((await decideToolPermission(call,new Set(),project,'plan')).action,'deny');
    const permission=await decideToolPermission(call,new Set(),project,'execute');assert.equal(permission.action,'ask');assert.equal(permission.remember,false);
    await assert.rejects(prepareCheckProject('{"script":"typecheck","command":"echo bypass"}',project,signal()),/只接受/);
    await assert.rejects(prepareCheckProject('{"script":"install"}',project,signal()),/只接受/);
    write(project,'package.json',{scripts:{}});await assert.rejects(prepareCheckProject(call.arguments,project,signal()),/未声明/);write(project,'package.json',pass);
    const prepared=await prepareCheckProject(call.arguments,project,signal());assert.match(prepared.preview,/PRE_CHECK/);assert.match(prepared.preview,/POST_CHECK/);
    write(project,'package.json',{...pass,description:'changed after preview'});await assert.rejects(prepared.execute(signal()),/预览后变化/);write(project,'package.json',pass);
    assert.match((await (await prepareCheckProject(call.arguments,project,signal())).execute(signal())).content,/CHECK_OK/);
    const failure=await (await prepareCheckProject('{"script":"test"}',project,signal())).execute(signal());assert.equal(failure.isError,true);assert.match(failure.content,/CHECK_FAILED/);
    await assert.rejects(executeTool(call,signal()),/必须先生成预览/);
    // Real command evidence must reach the next model request under its original call id.
    process.chdir(project);let round=0,approvals=0;
    const model={async generate(messages){if(++round===1)return reply('',[{...call,arguments:'{"script":"test"}'}]);const result=messages.find(m=>m.role==='tool'&&m.toolCallId===call.id);assert.match(result.content,/CHECK_FAILED/);return reply('ACTUAL_CHECK_OBSERVED');}};
    assert.equal((await agentLoop(model,[],'Run project test',signal(),undefined,async request=>{approvals++;assert.match(request.preview,/CHECK_FAILED/);return{decision:'allow_once'};},new Set(),{toolResultDirectory:directory(`logs-${index}`)})).text,'ACTUAL_CHECK_OBSERVED');assert.equal(approvals,1);
    let deniedRound=0;
    const denied={async generate(messages){if(++deniedRound===1)return reply('',[call]);assert.match(messages.find(m=>m.role==='tool').content,/Plan/);return reply('PLAN_OBSERVED');}};
    await agentLoop(denied,[],'Inspect',signal(),undefined,async()=>{throw new Error('Plan asked approval');},new Set(),{mode:'plan',toolResultDirectory:directory(`plan-logs-${index}`)});
    process.chdir(initialCwd);
    if(index===0){console.log('✓ 32.1: real npm scripts, manifest recheck, approval, Plan and tool result → next model');continue;}
    write(project,'tsconfig.json',{compilerOptions:{strict:true,noEmit:true,module:'NodeNext',moduleResolution:'NodeNext'}});
    write(project,'lib.ts','export const amount = 1;\n');write(project,'other.ts','export const amount = 99;\n');
    const main=write(project,'main.ts',"import { amount } from './lib.js';\nconsole.log(amount);\nexport const count: number = 'one';\n");
    const {LanguageService}=await load('language-service/client.js'), {codeIntelligenceTool}=await load('tools/code-intelligence.js');
    const service=new LanguageService({root:project});
    try {
      const definition=await service.query('definition','main.ts',2,13,signal());assert.deepEqual(definition.locations,[{path:'lib.ts',line:1,column:14}]);
      const references=await service.query('references','main.ts',2,13,signal());assert.ok(references.locations.some(entry=>entry.path==='main.ts'&&entry.line===2));assert.ok(!references.locations.some(entry=>entry.path==='other.ts'));
      await assert.rejects(service.query('definition','../outside.ts',1,1,signal()),/相对源码路径/);
      await assert.rejects(codeIntelligenceTool('{"action":"definition","path":"main.ts","line":0,"column":1}',service,signal()),/需要/);
      const outside=write(temporary.directory,`outside-${index}.ts`,'export const privateValue=1;');symlinkSync(outside,join(project,'escape.ts'));
      await assert.rejects(service.query('definition','escape.ts',1,14,signal()),/越界/);
      write(project,'.git/secret.ts','export const secret=1;');await assert.rejects(service.query('definition','.git/secret.ts',1,14,signal()),/忽略/);
      const local=execFileSync(process.execPath,[join(dist,'cli.js'),'code','definition','main.ts','2','13'],{cwd:project,encoding:'utf8',env:{PATH:process.env.PATH,HOME:project}});assert.match(local,/lib\.ts/);
      if(index===1){console.log('✓ 32.2: real definition/references, same-name binding, boundaries and key-free CLI');continue;}
      const first=await service.query('diagnostics','main.ts',undefined,undefined,signal());assert.ok(first.diagnostics.some(entry=>entry.code===2322));
      writeFileSync(main,"import { amount } from './lib.js';\nconsole.log(amount);\nexport const count: number = 1;\n");
      const fixed=await service.query('diagnostics','main.ts',undefined,undefined,signal());assert.equal(fixed.version,first.version+1);assert.notEqual(fixed.sha256,first.sha256);assert.deepEqual(fixed.diagnostics,[]);
      writeFileSync(main,'export const broken: = ;\n');const syntax=await service.query('diagnostics','main.ts',undefined,undefined,signal());assert.ok(syntax.diagnostics.some(entry=>entry.code===1110||entry.code===1109));
      writeFileSync(main,'export const count: number = 1;\n');
      // Instrument the actual request boundary, not a fake successful language service.
      const request=service.request.bind(service);let changed=false;
      service.request=async(session,method,params)=>{const result=await request(session,method,params);if(!changed&&method==='workspace/executeCommand'){changed=true;writeFileSync(main,'export const count: number = 2;\n');}return result;};
      await assert.rejects(service.query('diagnostics','main.ts',undefined,undefined,signal()),/查询期间变化/);service.request=request;
      assert.deepEqual((await service.query('diagnostics','main.ts',undefined,undefined,signal())).diagnostics,[]);
      // Service crash: actual process ends; next independent query starts a new owned group.
      const crashed=service.session.child.pid;process.kill(process.platform==='win32'?crashed:-crashed,'SIGTERM');await service.session.closed;
      assert.deepEqual((await service.query('diagnostics','main.ts',undefined,undefined,signal())).diagnostics,[]);gone(crashed);
      assert.notEqual(service.session.child.pid,crashed);
      const currentCli=execFileSync(process.execPath,[join(dist,'cli.js'),'code','diagnostics','main.ts'],{cwd:project,encoding:'utf8',env:{PATH:process.env.PATH,HOME:project}});assert.deepEqual(JSON.parse(currentCli).diagnostics,[]);
      // Cancellation stops the task before another model request, then all owned LSP resources close.
      const controller=new AbortController();let modelCalls=0;
      const cancelled={languageService:service,async generate(){modelCalls++;controller.abort(new Error('USER_CANCEL_32'));return reply('',[{id:'cancel-lsp',name:'code_intelligence',arguments:'{"action":"diagnostics","path":"main.ts"}'}]);}};
      process.chdir(project);await assert.rejects(agentLoop(cancelled,[],'Diagnose',controller.signal,undefined,undefined,new Set(),{toolResultDirectory:directory('cancel-logs')}),/USER_CANCEL_32/);process.chdir(initialCwd);assert.equal(modelCalls,1);
    } finally {await service.close();}
    if(index===2){
      const pidFile=join(project,'waiting.pid'), fixture=write(project,'waiting.mjs',"import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],String(process.pid));process.stdin.resume();setInterval(()=>{},1000);\n");
      const options={root:project,command:process.execPath,args:[fixture,pidFile],timeoutMs:250};const recovering=new LanguageService(options);
      try {await assert.rejects(recovering.query('diagnostics','main.ts',undefined,undefined,signal()),/超时/);gone(Number(readFileSync(pidFile,'utf8')));assert.equal(recovering.session,undefined);
        delete options.command;delete options.args;options.timeoutMs=15000;assert.deepEqual((await recovering.query('diagnostics','main.ts',undefined,undefined,signal())).diagnostics,[]);
      } finally {await recovering.close();}
      const cancelOptions={root:project,command:process.execPath,args:[fixture,pidFile]};const cancelService=new LanguageService(cancelOptions),abort=new AbortController();
      try{const pending=cancelService.query('diagnostics','main.ts',undefined,undefined,abort.signal);await ready(()=>cancelService.session?.child.pid&&Number(readFileSync(pidFile,'utf8'))===cancelService.session.child.pid);const pid=cancelService.session.child.pid;abort.abort(new Error('CANCEL_PENDING_32'));await assert.rejects(pending,/CANCEL_PENDING_32/);gone(pid);}finally{await cancelService.close();}
      // A failed cleanup retains ownership and prevents another spawn until cleanup succeeds.
      const retained=new LanguageService({root:project,command:process.execPath,args:[fixture,pidFile],timeoutMs:100});const dispose=retained.dispose.bind(retained);retained.dispose=async()=>{throw new Error('CLEANUP_UNCONFIRMED_32');};
      try{await assert.rejects(retained.query('diagnostics','main.ts',undefined,undefined,signal()),/CLEANUP_UNCONFIRMED_32/);const firstPid=retained.session.child.pid;await assert.rejects(retained.query('diagnostics','main.ts',undefined,undefined,signal()),/CLEANUP_UNCONFIRMED_32/);assert.equal(retained.session.child.pid,firstPid);}finally{retained.dispose=dispose;await retained.close();}
      // Apply every complete exercise answer file literally, then use the actual service.
      const answerRoot=directory('exercise'),text=readFileSync(join(root,'chapter-32-code-intelligence/EXERCISES.md'),'utf8');const answers=[...text.matchAll(/<!-- answer-file: ([^ ]+) -->\n```[^\n]+\n([\s\S]*?)\n```/g)];assert.equal(answers.length,5);for(const[,name,content]of answers)write(answerRoot,name,content+'\n');
      const exercise=new LanguageService({root:answerRoot});try{const def=await exercise.query('definition','src/main.ts',2,13,signal());assert.equal(def.locations[0].path,'src/lib.ts');const a=await exercise.query('diagnostics','src/main.ts',undefined,undefined,signal());assert.ok(a.diagnostics.some(d=>d.code===2322));const source=join(answerRoot,'src/main.ts');writeFileSync(source,readFileSync(source,'utf8').replace("= 'one'","= 1"));const b=await exercise.query('diagnostics','src/main.ts',undefined,undefined,signal());assert.deepEqual(b.diagnostics,[]);assert.equal(b.version,a.version+1);assert.notEqual(b.sha256,a.sha256);}finally{await exercise.close();}
      console.log('✓ 32.3: actual diagnostics/version/hash, changed-file rejection, crash/timeout/cancel/restart, retained ownership and full exercise fixtures');
    }
  }
} finally {process.chdir(initialCwd);temporary.close();}
