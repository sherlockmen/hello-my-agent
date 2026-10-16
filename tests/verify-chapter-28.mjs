/** Real temporary Git repositories: session identity, review versions, integration and conservative cleanup. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build, reply, signal, workspace } from './runtime-fixtures.mjs';

const temporary = workspace('28'), oldCwd = process.cwd(), roots = new Set();
const gitBinary = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
let fixtureNumber = 0;
function git(directory, ...args) { return execFileSync(gitBinary, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function repository(label) {
  const path = join(temporary.directory, `${++fixtureNumber}-${label}`); mkdirSync(path);
  git(path, 'init', '-b', 'main'); git(path, 'config', 'user.name', 'Fixture'); git(path, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(path, 'shared.txt'), 'base\n'); writeFileSync(join(path, '.gitignore'), 'ignored/\n');
  git(path, 'add', '--', 'shared.txt', '.gitignore'); git(path, 'commit', '-m', 'base'); return realpathSync(path);
}
async function create(manager) {
  const prepared = await manager.prepareCreate(signal());
  assert.match(prepared.preview, /base SHA/);
  const result = await prepared.execute(signal()); assert.ok(!result.isError, result.content);
  const item = result.metadata.worktree; roots.add(dirname(item.path)); return item;
}
async function command(manager, id, value, executionSignal = signal()) {
  const prepared = await manager.prepareCommand(id, JSON.stringify({ command: value, cwd: '.' }), signal());
  return prepared.execute(executionSignal);
}
function commit(directory, value, file = 'shared.txt') {
  writeFileSync(join(directory, file), value); git(directory, 'add', '--', file); git(directory, 'commit', '-m', `change ${file}`);
}
async function review(manager, id) { const prepared = await manager.prepareReview(id, signal()); assert.match(prepared.preview, /diff SHA256/); const result = await prepared.execute(signal()); assert.equal(result.metadata.worktree.reviewValid, true); return result.metadata.worktree; }
async function waitFor(check) { for (let i = 0; i < 150; i++) { if (check()) return; await delay(20); } throw new Error('Timed out waiting for fixture process'); }

try {
  for (const [index, lesson] of ['01-worktree-base', '02-versioned-review', '03-integrate-and-cleanup'].entries()) {
    const { load } = build('chapter-28-isolated-workspaces', lesson, temporary);
    const { WorktreeManager } = await load('workspaces/worktrees.js');
    const { prepareTool, executeTool, executePreparedTool, toolDefinitions } = await load('tools/registry.js');
    const { decideToolPermission } = await load('permissions/policy.js');
    const { agentLoop } = await load('agent/agent-loop.js');
    const { runSubagent } = await load('subagents/runner.js');
    const { formatTeachingTrace } = await load('ui/teaching-trace.js');
    const { updateRunView, emptyRunView } = await load('ui/tui/state.js');
    const available = ['create_worktree', 'run_worktree_command', ...(index >= 1 ? ['review_worktree'] : []), ...(index >= 2 ? ['integrate_worktree', 'remove_worktree'] : [])];
    assert.ok(toolDefinitions.some(tool => tool.name === 'read_worktree'));
    for (const name of available) {
      assert.ok(toolDefinitions.some(tool => tool.name === name));
      const call = { id: 'gate', name, arguments: '{}' };
      assert.equal((await decideToolPermission(call, new Set(), temporary.directory, 'plan')).action, 'deny');
      const policy = await decideToolPermission(call, new Set([`${name}:once`]), temporary.directory, 'execute');
      assert.equal(policy.action, 'ask'); assert.equal(policy.remember, false);
      await assert.rejects(executeTool(call, signal()), /预览.*批准/);
      await assert.rejects(prepareTool(call, signal(), { allowedTools: ['glob', 'grep', 'read_file'] }), /子任务不允许/);
    }
    assert.equal((await decideToolPermission({ id: 'read', name: 'read_worktree', arguments: '{}' }, new Set(), temporary.directory, 'plan')).action, 'allow');

    // Creation starts at the fixed commit. Existing tracked, untracked and ignored content stays untouched.
    const path = repository(lesson), base = git(path, 'rev-parse', 'HEAD'), manager = new WorktreeManager(path);
    writeFileSync(join(path, 'shared.txt'), 'USER_DIRTY\n'); writeFileSync(join(path, 'untracked.txt'), 'USER_UNTRACKED\n');
    mkdirSync(join(path, 'ignored')); writeFileSync(join(path, 'ignored', 'secret.txt'), 'USER_IGNORED\n');
    const created = await create(manager); assert.equal(created.baseSha, base); assert.equal(created.headSha, base); assert.equal(created.targetDirty, true);
    assert.equal(created.currentTargetBranch, 'main'); assert.match(created.branch, /^codex\/hello-agent-/); assert.notEqual(created.path, path);
    assert.equal(readFileSync(join(created.path, 'shared.txt'), 'utf8'), 'base\n'); assert.ok(!existsSync(join(created.path, 'untracked.txt'))); assert.ok(!existsSync(join(created.path, 'ignored')));
    assert.equal(readFileSync(join(path, 'shared.txt'), 'utf8'), 'USER_DIRTY\n'); assert.equal(readFileSync(join(path, 'untracked.txt'), 'utf8'), 'USER_UNTRACKED\n');
    const second = new WorktreeManager(path); await assert.rejects(second.get(created.id), /未知WorktreeID/);
    const held = `${created.path}.held`, foreign = repository('foreign'); renameSync(created.path, held); symlinkSync(foreign, created.path);
    try { await assert.rejects(manager.get(created.id), /真实路径/); } finally { unlinkSync(created.path); renameSync(held, created.path); }
    for (const args of [{ worktree_id: '../../escape' }, { worktree_id: created.id, path: path }, { worktree_id: '00000000-0000-4000-8000-000000000000' }]) {
      await assert.rejects(executeTool({ id: 'bad', name: 'read_worktree', arguments: JSON.stringify(args) }, signal(), { worktrees: manager }), /WorktreeID|未知字段/);
    }
    const preparedCreate = await manager.prepareCreate(signal()); git(path, 'switch', '-c', 'moved'); await assert.rejects(preparedCreate.execute(signal()), /HEAD变化/); git(path, 'switch', 'main');
    const result = await command(manager, created.id, 'printf TASK_ONLY > task.txt'); assert.equal(result.metadata.worktree.dirty, true); assert.ok(!existsSync(join(path, 'task.txt')));
    const childPrepared = await manager.prepareCommand(created.id, '{"command":"true","cwd":"."}', signal());
    assert.throws(() => executePreparedTool(childPrepared, signal(), { allowedTools: ['read_file'] }), /子任务不允许/);

    // Cancellation stops this command but does not erase files it wrote before cancellation.
    const cancel = new AbortController();
    const slow = command(manager, created.id, `node -e 'require("node:fs").writeFileSync("cancelled.txt","saved-before-cancel");setInterval(()=>{},1000)'`, cancel.signal);
    await waitFor(() => existsSync(join(created.path, 'cancelled.txt'))); cancel.abort(new Error('CANCEL_WORKTREE_COMMAND'));
    await assert.rejects(slow, /CANCEL_WORKTREE_COMMAND/); assert.equal(readFileSync(join(created.path, 'cancelled.txt'), 'utf8'), 'saved-before-cancel');
    assert.equal((await manager.get(created.id)).dirty, true);

    // Fake model still traverses the real registry and approval gate; the next decision receives the actual identity.
    process.chdir(path); const events = [], history = []; let calls = 0, approvals = 0;
    const model = { worktrees: manager, async generate(messages) {
      if (++calls === 1) return reply('', [{ id: 'inspect-owned', name: 'read_worktree', arguments: JSON.stringify({ worktree_id: created.id }) }]);
      const tool = messages.find(message => message.role === 'tool' && message.toolCallId === 'inspect-owned'); assert.match(tool.content, new RegExp(created.id)); assert.match(tool.content, new RegExp(base)); return reply('WORKTREE_STATE_OBSERVED');
    } };
    assert.equal((await agentLoop(model, history, 'Inspect own worktree', signal(), event => events.push(event), async () => { approvals++; return { decision: 'allow_once' }; }, new Set())).text, 'WORKTREE_STATE_OBSERVED');
    assert.equal(approvals, 0); const finish = events.find(event => event.type === 'tool_finish' && event.outcome === 'success');
    assert.equal(finish.result.metadata.worktree.id, created.id); assert.match(formatTeachingTrace(finish).join('\n'), new RegExp(created.id));
    const view = updateRunView(emptyRunView(), finish); assert.match(view.tools[0].detail, new RegExp(base)); assert.match(view.tools[0].detail, new RegExp(created.id));
    // A nonzero approved command remains a failed scheduler state; the next model still receives its observation.
    let failedRound = 0; const failedEvents = [];
    const failedCommand = { worktrees: manager, async generate(messages) {
      if (++failedRound === 1) return reply('', [{ id: 'failed-owned-command', name: 'run_worktree_command', arguments: JSON.stringify({ worktree_id: created.id, command: 'exit 17' }) }]);
      const observed = messages.find(message => message.role === 'tool' && message.toolCallId === 'failed-owned-command'); assert.match(observed.content, /17/); return reply('FAILED_COMMAND_OBSERVED');
    } };
    await agentLoop(failedCommand, [], 'Run fixed failing fixture', signal(), event => failedEvents.push(event), async () => ({ decision: 'allow_once' }), new Set());
    const failedFinish = failedEvents.find(event => event.type === 'tool_finish'); assert.equal(failedFinish.result.isError, true);
    assert.equal(failedEvents.filter(event => event.type === 'tool_state').at(-1).state, 'failed');
    assert.equal(updateRunView(emptyRunView(), failedFinish).tools[0].status, '失败');
    for (const mode of ['plan', 'execute']) {
      let round = 0, asked = 0; const beforeCount = (await manager.list()).length;
      const denied = { worktrees: manager, async generate() { return ++round === 1 ? reply('', [{ id: 'denied-create', name: 'create_worktree', arguments: '{}' }]) : reply('DENIAL_OBSERVED'); } };
      await agentLoop(denied, [], 'Create only if approved', signal(), () => {}, async () => { asked++; return { decision: 'deny', reason: 'fixture denies' }; }, new Set(), { mode });
      assert.equal(asked, mode === 'plan' ? 0 : 1); assert.equal((await manager.list()).length, beforeCount);
    }
    for (const name of available) {
      let round = 0; const child = { worktrees: manager, async generate() { return ++round === 1 ? reply('', [{ id: 'forbidden-child', name, arguments: '{}' }]) : reply('CHILD_DENIAL_OBSERVED'); } };
      const result = await runSubagent(child, '{"role":"review","task":"Read only"}', signal(), { sessionDirectory: join(temporary.directory, lesson, 'child-sessions'), requestApproval: async () => { throw new Error('child must not ask for mutation'); } });
      assert.equal(result.status, 'completed'); assert.equal((await manager.list()).length, 1);
    }

    if (index >= 1) {
      // Restore only this disposable fixture, then save the task commit through the approved command interface.
      writeFileSync(join(path, 'shared.txt'), 'base\n'); unlinkSync(join(path, 'untracked.txt'));
      await assert.rejects(manager.prepareReview(created.id, signal()), /clean/);
      assert.ok(!(await command(manager, created.id, 'git add -- shared.txt task.txt cancelled.txt && git -c core.hooksPath=/dev/null commit -m task')).isError);
      let reviewed = await review(manager, created.id); assert.equal(reviewed.review.targetSha, base); assert.equal(reviewed.review.reviewedSha, git(created.path, 'rev-parse', 'HEAD'));
      const pendingReview = await manager.prepareReview(created.id, signal()); commit(created.path, 'next task\n', 'extra.txt');
      await assert.rejects(pendingReview.execute(signal()), /失效/); assert.equal((await manager.get(created.id)).reviewValid, false);
      reviewed = await review(manager, created.id); commit(path, 'target moved\n', 'target.txt'); assert.equal((await manager.get(created.id)).reviewValid, false);
      reviewed = await review(manager, created.id); git(path, 'switch', '-c', 'other-target'); const moved = await manager.get(created.id);
      assert.equal(moved.reviewValid, false); assert.equal(moved.currentTargetBranch, 'other-target'); await assert.rejects(manager.prepareReview(created.id, signal()), /分支/); git(path, 'switch', 'main');
      // Porcelain can be clean while an unfinished operation exists. It must invalidate the reviewed version.
      writeFileSync(join(path, '.git', 'MERGE_HEAD'), `${base}\n`); assert.equal(git(path, 'status', '--porcelain'), '');
      assert.equal((await manager.get(created.id)).targetOperation, 'MERGE_HEAD'); assert.equal((await manager.get(created.id)).reviewValid, false);
      await assert.rejects(manager.prepareReview(created.id, signal()), /未结束Git操作/); unlinkSync(join(path, '.git', 'MERGE_HEAD'));
      reviewed = await review(manager, created.id); const dirtyVersion = reviewed.headSha; writeFileSync(join(created.path, 'shared.txt'), 'DIRTY_AFTER_REVIEW'); assert.equal((await manager.get(created.id)).reviewValid, false);
      writeFileSync(join(created.path, 'shared.txt'), 'base\n'); assert.equal((await manager.get(created.id)).headSha, dirtyVersion);

      if (index >= 2) {
        // Recheck both approved SHAs after the integration approval, then test actual merge and branch retention.
        await review(manager, created.id); const stale = await manager.prepareIntegrate(created.id, signal()); commit(path, 'another target commit\n', 'later.txt');
        await assert.rejects(stale.execute(signal()), /状态变化/); await assert.rejects(manager.prepareRemove(created.id, signal()), /尚未包含/);
        await review(manager, created.id);
        // A deliberately failing hook proves that this Git operation disables hooks rather than merely --no-verify.
        const hook = join(path, '.git', 'hooks', 'pre-merge-commit'); writeFileSync(hook, '#!/bin/sh\nexit 87\n'); chmodSync(hook, 0o755);
        const merged = await (await manager.prepareIntegrate(created.id, signal())).execute(signal()); assert.ok(!merged.isError, merged.content); assert.equal(merged.metadata.worktree.integratedSha, git(path, 'rev-parse', 'HEAD'));
        git(path, 'merge-base', '--is-ancestor', reviewed.review.reviewedSha, 'HEAD');
        mkdirSync(join(created.path, 'ignored')); writeFileSync(join(created.path, 'ignored', 'build.out'), 'KEEP');
        await assert.rejects(manager.prepareRemove(created.id, signal()), /ignored/); unlinkSync(join(created.path, 'ignored', 'build.out')); rmdirSync(join(created.path, 'ignored'));
        writeFileSync(join(created.path, 'unsaved.txt'), 'KEEP'); await assert.rejects(manager.prepareRemove(created.id, signal()), /未保存/); unlinkSync(join(created.path, 'unsaved.txt'));
        const clean = await manager.prepareRemove(created.id, signal()), removed = await clean.execute(signal()); assert.ok(!removed.isError, removed.content); assert.equal(removed.metadata.worktree.state, 'removed'); assert.ok(!existsSync(created.path)); git(path, 'show-ref', '--verify', `refs/heads/${created.branch}`);
        await assert.rejects(clean.execute(signal()), /已经执行/);

        // A real content conflict leaves MERGE_HEAD and both versions available. No reset or abort runs.
        const conflictPath = repository('conflict'), conflicting = new WorktreeManager(conflictPath), task = await create(conflicting);
        commit(task.path, 'task-side\n'); commit(conflictPath, 'target-side\n'); await review(conflicting, task.id);
        const conflict = await (await conflicting.prepareIntegrate(task.id, signal())).execute(signal()); assert.equal(conflict.isError, true); assert.equal(conflict.metadata.worktree.targetOperation, 'MERGE_HEAD');
        assert.match(readFileSync(join(conflictPath, 'shared.txt'), 'utf8'), /<<<<<<<.*\n/s); assert.equal(readFileSync(join(task.path, 'shared.txt'), 'utf8'), 'task-side\n');
        assert.ok(existsSync(join(conflictPath, '.git', 'MERGE_HEAD'))); await assert.rejects(conflicting.prepareRemove(task.id, signal()), /冲突/);

        // Git can create a path and still fail or be cancelled. Registration must survive with a traceable identity.
        const wrapperPath = join(temporary.directory, 'git-wrapper'); mkdirSync(wrapperPath);
        const oldPath = process.env.PATH;
        try {
          for (const cancelAfterCreation of [false, true]) {
            const partialPath = repository('partial'), partial = new WorktreeManager(partialPath), marker = join(partialPath, 'created-marker');
            const source = `#!${process.execPath}\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';const args=process.argv.slice(2);const result=spawnSync(${JSON.stringify(gitBinary)},args,{stdio:'inherit'});if(args.includes('worktree')&&args[args.indexOf('worktree')+1]==='add'&&result.status===0){fs.writeFileSync(${JSON.stringify(marker)},'created');${cancelAfterCreation ? 'setInterval(()=>{},1000)' : 'process.exit(19)'}}else process.exit(result.status??1);\n`;
            // .mjs is not required: this executable has an explicit Node shebang and runs as CommonJS on Node 22.
            writeFileSync(join(wrapperPath, 'git'), source.replace("import fs from 'node:fs';import{spawnSync}from'node:child_process';", "const fs=require('node:fs'),{spawnSync}=require('node:child_process');")); chmodSync(join(wrapperPath, 'git'), 0o755);
            process.env.PATH = `${wrapperPath}:${oldPath ?? '/usr/bin:/bin'}`;
            const prepared = await partial.prepareCreate(signal()), control = new AbortController(), pending = prepared.execute(control.signal);
            if (cancelAfterCreation) { await waitFor(() => existsSync(marker)); control.abort(new Error('CANCEL_PARTIAL_CREATE')); await assert.rejects(pending, /CANCEL_PARTIAL_CREATE/); }
            else assert.equal((await pending).isError, true);
            const records = await partial.list(); assert.equal(records.length, 1); assert.equal(records[0].state, 'failed'); assert.ok(records[0].failure); assert.ok(existsSync(records[0].path)); roots.add(dirname(records[0].path));
            assert.equal(git(records[0].path, 'rev-parse', 'HEAD'), records[0].baseSha); git(partialPath, 'show-ref', '--verify', `refs/heads/${records[0].branch}`);
            process.env.PATH = oldPath;
          }
        } finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; }
      }
    }
    console.log(`✓ 28 ${lesson}: isolated build, real Git identity/dirty preservation, approvals/Plan/child, cancellation, model/event/TUI state${index >= 1 ? ', exact-version review invalidation' : ''}${index >= 2 ? ', merge/conflict preservation and conservative cleanup' : ''}`);
    process.chdir(oldCwd);
  }
} finally {
  process.chdir(oldCwd);
  // Every path here was returned by a manager created in these disposable tests, never supplied by a user.
  for (const path of roots) { assert.match(path, /hello-agent-worktrees-[^/]+$/); rmSync(path, { recursive: true, force: true }); }
  temporary.close();
}
