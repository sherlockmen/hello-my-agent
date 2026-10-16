/** Local extension lifecycle: real files, Hooks, official MCP transport and model request wiring. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, root, sdkServer, signal, reply, workspace } from './runtime-fixtures.mjs';
const temporary = workspace('31'), oldCwd = process.cwd();
function directory(name) { const path = join(temporary.directory, name); mkdirSync(path, { recursive: true }); return path; }
function write(path, name, value) { writeFileSync(join(path, name), typeof value === 'string' ? value : JSON.stringify(value)); }
// Use the same explicit build as the reader; install never invokes a compiler.
function compilePackage(path) {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(path, 'tsconfig.json'), '--typeRoots', join(root, 'node_modules/@types')], { stdio: 'inherit' });
}
async function waitFor(check) { for (let i=0;i<200;i++) { if(check()) return; await new Promise(resolve=>setTimeout(resolve,10)); } throw new Error('fixture not ready'); }
function assertGone(pid) { assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH'); }
const lessons = ['01-install-local-package', '02-enable-capabilities', '03-disable-and-diagnose'];
try {
  for (const [index, lesson] of lessons.entries()) {
    const { load, dist } = build('chapter-31-extension-packages', lesson, temporary);
    const { ExtensionManager } = await load('extensions/manager.js');
    const { extensionCommand } = await load('extensions/commands.js');
    const { discoverSkills, loadSkill, readSkillResource } = await load('skills/catalog.js');
    const { runHooks } = await load('hooks/lifecycle.js');
    const { mcpDefinitions } = await load('mcp/client.js');
    const path = directory(`project-${index}`), source = directory(`package-${index}`);
    cpSync(join(root, 'chapter-31-extension-packages', lesson, 'examples/review-kit'), source, { recursive: true });
    const skills = await discoverSkills(path), manager = new ExtensionManager(path, skills);
    const installed = join(path, '.hello-my-agent/extensions/review-kit');
    try {
      assert.equal(existsSync(join(source, 'dist/server.js')), false);
      await assert.rejects(manager.install(source, signal()), /包内脚本不存在/);
      assert.equal(existsSync(installed), false);
      compilePackage(source);
      assert.equal(existsSync(join(source, 'dist/hook.js')), true); assert.equal(existsSync(join(source, 'dist/server.js')), true);
      assert.equal(existsSync(join(source, 'server.pid')), false); assert.equal(existsSync(join(source, 'hook-ran.txt')), false);
      assert.match(await extensionCommand(['install', source], manager, 'execute', signal()), /当前未启用/);
      assert.equal(readFileSync(join(installed, 'src/hook.ts'), 'utf8'), readFileSync(join(source, 'src/hook.ts'), 'utf8'));
      assert.equal(readFileSync(join(installed, 'dist/server.js'), 'utf8'), readFileSync(join(source, 'dist/server.js'), 'utf8'));
      assert.equal(existsSync(join(installed, 'server.pid')), false); assert.equal(existsSync(join(installed, 'hook-ran.txt')), false);
      assert.equal(skills.entries.length, 0); assert.equal(mcpDefinitions(manager.mcp).length, 0);
      assert.match((await manager.list(signal())).join('\n'), /review-kit@1.0.0.*installed/);
      await assert.rejects(manager.install(source, signal()), /同名/);
      const competitor = new ExtensionManager(path, await discoverSkills(path));
      await assert.rejects(competitor.install(source, signal()), /占用/); await competitor.close();
      const cancelled = new AbortController(); cancelled.abort(new Error('CANCEL_INSTALL'));
      const bad = directory(`bad-${index}`); cpSync(source, bad, { recursive: true }); write(bad, 'extension.json', { id: 'bad', version: '1.0.0', apiVersion: 2, hooks: 'hooks.json' });
      await assert.rejects(manager.install(bad, signal()), /API/); assert.equal(existsSync(join(path, '.hello-my-agent/extensions/bad')), false);
      write(bad, 'extension.json', { id: 'bad', version: '1.0.0', apiVersion: 1, hooks: '../outside' });
      await assert.rejects(manager.install(bad, signal()), /相对路径/);
      write(bad, 'extension.json', { id: 'bad', version: '1.0.0', apiVersion: 1, hooks: 'hooks.json' });
      symlinkSync(join(source, 'hooks.json'), join(bad, 'link.json')); await assert.rejects(manager.install(bad, signal()), /链接/);
      await assert.rejects(manager.install(source, cancelled.signal), /CANCEL_INSTALL/);
      assert.equal((await import('node:fs/promises')).readdir && (await (await import('node:fs/promises')).readdir(join(path, '.hello-my-agent/extensions'))).some(name => name.startsWith('.tmp-')), false);
      const localOutput = execFileSync(process.execPath, [join(dist,'cli.js'),'--extension','list'], { cwd: path, encoding:'utf8', env: { PATH: process.env.PATH, HOME: path } });
      assert.match(localOutput,/review-kit@1.0.0.*installed/);
      if (index === 0) { console.log('✓ 31.1: key-free install, no execution and strict package validation'); continue; }
      await assert.rejects(manager.enable('review-kit', 'plan', signal()), /Plan/);
      const release = manager.beginUse(); await assert.rejects(manager.enable('review-kit', 'execute', signal()), /忙碌/); release(); release();
      const originalHooks = manager.hooks, originalMcp = manager.mcp;
      const service = await sdkServer();
      const { createModel } = await load('models/client.js');
      const model = createModel({ provider: 'openai', apiKey: 'fixture-only', model: 'fixture', baseURL: service.url }, undefined, undefined, skills, manager.hooks, manager.mcp, undefined, manager);
      try {
        await manager.enable('review-kit', 'execute', signal());
        assert.equal(manager.hooks, originalHooks); assert.equal(manager.mcp, originalMcp);
        const pid = Number(readFileSync(join(installed, 'server.pid'), 'utf8'));
        assert.equal(skills.entries[0].name, 'review-kit:review'); await loadSkill(skills, 'review-kit:review', signal());
        assert.match((await readSkillResource(skills, 'review-kit:review', 'notes.md', signal())).text, /空输入/);
        await model.generate([{ role: 'user', content: 'Check input' }], signal());
        const request = service.requests.at(-1).body;
        assert.ok(request.tools.some(tool => tool.function.name === 'mcp__review-kit__notes__checklist'));
        assert.match(request.messages[0].content, /先读取用户指定的函数/);
        await runHooks(manager.hooks, 'before_tool', { call: { id: 'demo', name: 'read_file', arguments: '{}' } }, signal());
        assert.match(readFileSync(join(installed, 'hook-ran.txt'), 'utf8'), /before_tool/);
        const { agentLoop } = await load('agent/agent-loop.js');
        process.chdir(path); let round = 0, approvals = 0;
        const fake = { mcp: manager.mcp, hooks: manager.hooks, skills, beginRun: () => manager.beginUse(), async generate(messages) {
          if (++round === 1) return reply('', [{ id: 'actual-mcp', name: 'mcp__review-kit__notes__checklist', arguments: '{}' }]);
          assert.match(messages.find(message => message.role === 'tool' && message.toolCallId === 'actual-mcp').content, /取消后资源/); return reply('RESULT_OBSERVED');
        } };
        assert.equal((await agentLoop(fake, [], 'Get checklist', signal(), undefined, async () => { approvals++; return { decision: 'allow_once' }; }, new Set())).text, 'RESULT_OBSERVED');
        assert.equal(approvals, 1); process.chdir(oldCwd);
        if (index >= 2) {
          assert.match(await manager.diagnose('review-kit', signal()), /静态检查/);
          // Uninstall must retain files and ownership when actual close cannot be confirmed.
          const server = manager.mcp.servers[0], close = server.close;
          server.close = async () => { throw new Error('fixture close failed'); };
          await assert.rejects(manager.uninstall('review-kit', signal()), /关闭/); assert.equal(existsSync(installed), true);
          assert.match((await manager.list(signal())).join('\n'), /cleanup_failed/);
          assert.equal(mcpDefinitions(manager.mcp).length, 0);
          server.close = close;
          await manager.disable('review-kit'); assertGone(pid);
          assert.equal(skills.entries.length, 0); assert.equal(skills.loaded.size, 0); assert.equal(mcpDefinitions(manager.mcp).length, 0); assert.equal(manager.hooks.hooks.before_tool.length, 0);
          await model.generate([{ role: 'user', content: 'After disable' }], signal());
          const after = service.requests.at(-1).body; assert.equal(after.tools.some(tool => tool.function.name.startsWith('mcp__')), false); assert.doesNotMatch(after.messages[0].content, /先读取用户指定的函数/);
          await manager.uninstall('review-kit', signal()); assert.equal(existsSync(installed), false);
          // A delayed real initialization cannot publish capabilities during a task.
          const slow = directory('slow-package'); cpSync(source, slow, { recursive: true });
          write(slow, 'extension.json', { id: 'slow-kit', version: '1.0.0', apiVersion: 1, mcp: 'mcp.json' });
          const normalServer = readFileSync(join(slow, 'src/server.ts'), 'utf8');
          write(slow, 'src/server.ts', normalServer.replace("if (request.method === 'initialize') result", "if (request.method === 'initialize') await new Promise(resolve => setTimeout(resolve, 250));\n  if (request.method === 'initialize') result"));
          compilePackage(slow);
          await manager.install(slow, signal());
          const enabling = manager.enable('slow-kit', 'execute', signal());
          assert.throws(() => manager.beginUse(), /正在变更/); await enabling;
          const slowInstalled = join(path, '.hello-my-agent/extensions/slow-kit'), slowPid = Number(readFileSync(join(slowInstalled, 'server.pid'), 'utf8'));
          await manager.disable('slow-kit'); assertGone(slowPid);
          const cancelEnable = new AbortController(), pending = manager.enable('slow-kit', 'execute', cancelEnable.signal);
          await waitFor(() => { try { return Number(readFileSync(join(slowInstalled, 'server.pid'), 'utf8')) !== slowPid; } catch { return false; } });
          const cancelledPid = Number(readFileSync(join(slowInstalled, 'server.pid'), 'utf8')); cancelEnable.abort(new Error('CANCEL_ENABLE'));
          await assert.rejects(pending, /CANCEL_ENABLE/); assertGone(cancelledPid); assert.equal(mcpDefinitions(manager.mcp).length, 0);
          assert.match((await manager.list(signal())).join('\n'), /slow-kit@1.0.0.*installed/);
          // One healthy server followed by a protocol failure closes the healthy process too.
          const broken = directory('broken-package'); cpSync(source, broken, { recursive: true });
          write(broken, 'extension.json', { id:'broken-kit', version:'1.0.0', apiVersion:1, mcp:'mcp.json' });
          write(broken, 'mcp.json', { servers:[{name:'good',transport:'stdio',command:'node',args:['./dist/server.js']},{name:'bad',transport:'stdio',command:'node',args:['./dist/broken.js']}] });
          write(broken, 'src/broken.ts', "console.log('invalid JSON'); process.exit(1);\nexport {};\n");
          compilePackage(broken);
          await manager.install(broken, signal()); await assert.rejects(manager.enable('broken-kit','execute',signal()), /连接或发现失败/);
          assertGone(Number(readFileSync(join(path,'.hello-my-agent/extensions/broken-kit/server.pid'),'utf8')));
          assert.equal(mcpDefinitions(manager.mcp).length,0);
          const dependent = directory('dependent-package'); cpSync(source,dependent,{recursive:true});
          write(dependent,'extension.json',{id:'dependent',version:'1.0.0',apiVersion:1,requires:['missing'],hooks:'hooks.json'});
          await manager.install(dependent,signal()); await assert.rejects(manager.enable('dependent','execute',signal()),/依赖 missing/);
          assert.equal(existsSync(join(path,'.hello-my-agent/extensions/dependent/hook-ran.txt')),false);
          // Existing project resources keep their identity, cwd and close ownership.
          const isolated = directory('project-resource-ownership'); let projectClosed = 0;
          const projectHook = {command:'node',args:['-e','console.log(JSON.stringify({continue:true}))'],timeout_ms:1000};
          const projectHooks = {root:isolated,hooks:{before_tool:[projectHook]}};
          const projectServer = {name:'project',status:'ready',client:{},async close(){ projectClosed++; }};
          const projectMcp = {servers:[projectServer],tools:new Map([['mcp__project__keep',{server:projectServer,original:'keep',definition:{name:'mcp__project__keep',description:'project',inputSchema:{type:'object',properties:{}}}}]]),async close(){for(const item of this.servers) await item.close();}};
          const owner = new ExtensionManager(isolated,await discoverSkills(isolated),projectHooks,projectMcp);
          try {
            await owner.install(source,signal()); await owner.enable('review-kit','execute',signal());
            assert.equal(owner.hooks,projectHooks); assert.equal(owner.mcp,projectMcp); assert.equal(projectHooks.hooks.before_tool[0],projectHook);
            await owner.disable('review-kit'); assert.deepEqual(projectMcp.servers,[projectServer]); assert.equal(projectMcp.tools.size,1);
            assert.deepEqual(projectHooks.hooks.before_tool,[projectHook]); assert.equal(projectHooks.root,isolated); assert.equal(projectClosed,0);
          } finally { await owner.close(); }
          assert.equal(projectClosed,0);

          // Exercise answers are the literal complete files in the delivered document.
          const answerRoot = directory('exercise-answers'), exerciseText = readFileSync(join(root,'chapter-31-extension-packages/EXERCISES.md'),'utf8');
          const answers = [...exerciseText.matchAll(/<!-- answer-file: ([^ ]+) -->\n```[^\n]+\n([\s\S]*?)\n```/g)];
          assert.equal(answers.length,10);
          for(const [,relative,content] of answers){ const target=join(answerRoot,relative); mkdirSync((await import('node:path')).dirname(target),{recursive:true}); writeFileSync(target,content+'\n'); }
          compilePackage(join(answerRoot, 'review-more'));
          const exerciseProject=directory('exercise-project'), exerciseSkills=await discoverSkills(exerciseProject), exercises=new ExtensionManager(exerciseProject,exerciseSkills);
          try {
            for(const id of ['solo-review','review-more','missing-bin']) await exercises.install(join(answerRoot,id),signal());
            await assert.rejects(exercises.enable('review-more','execute',signal()),/依赖 solo-review/);
            assert.equal(existsSync(join(exerciseProject,'.hello-my-agent/extensions/review-more/events.txt')),false);
            await exercises.enable('solo-review','execute',signal()); await exercises.enable('review-more','execute',signal());
            await loadSkill(exerciseSkills,'solo-review:review',signal());
            assert.match((await readSkillResource(exerciseSkills,'solo-review:review','notes.md',signal())).text,/等待本地资源真正结束/);
            await runHooks(exercises.hooks,'before_tool',{call:{id:'exercise',name:'read_file',arguments:'{}'}},signal());
            assert.equal(readFileSync(join(exerciseProject,'.hello-my-agent/extensions/review-more/events.txt'),'utf8'),'before_tool\n');
            await assert.rejects(exercises.disable('solo-review'),/仍依赖/);
            await exercises.disable('review-more'); await exercises.disable('solo-review');
            assert.equal(exerciseSkills.entries.length,0); assert.equal(exerciseSkills.loaded.size,0);
            await assert.rejects(exercises.diagnose('missing-bin',signal()),/可执行程序不可用/);
            await assert.rejects(exercises.enable('missing-bin','execute',signal()),/可执行程序不可用/);
            assert.equal(exercises.mcp.tools.size,0);
          } finally { await exercises.close(); }


        }
      } finally { await model.jobs.close(); await service.close(); }
    } finally { process.chdir(oldCwd); await manager.close(); }
    assert.equal(existsSync(join(path, '.hello-my-agent/extensions/.lock')), false);
    if (index === 1) assertGone(Number(readFileSync(join(installed, 'server.pid'), 'utf8')));
    console.log(`✓ 31.${index + 1}: real local package lifecycle`);
  }
} finally { process.chdir(oldCwd); temporary.close(); }
