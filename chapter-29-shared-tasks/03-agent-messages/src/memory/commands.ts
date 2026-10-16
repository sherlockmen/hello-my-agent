/**
 * 29.3 Agent 消息与确认 | [KEEP] memory/commands.ts
 * 输入：用户的本地命令和当前模式；输出：来源清单、单条正文或保存回执。
 * 状态：命令写盘不改变本项任务的请求快照；refresh成功才替换模型使用的字符串。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：本地命令 -> 校验 -> 读取/明确保存；新任务 -> 重读 -> 固定prompt。
 * 观察：/memory命令不作为聊天交给模型；同一存储入口供CLI、text和TUI使用。
 */
import type { ExecutionMode } from "../agent/run-options.js";
import { UserFacingError } from "../errors.js";
import { changeMemory, memoryPrompt, memoryText, readMemory } from "./store.js";

// [KEEP 来自 18.1] 本文件以下实现均为本节新增。
export type MemoryController = {
  readonly root: string;
  readonly prompt: string;
  refresh(signal: AbortSignal): Promise<void>;
  command(command: string, mode?: ExecutionMode): Promise<string>;
};

/**
 * 创建一份项目记忆控制器；估算与发送只读prompt，重读只能发生在明确任务边界。
 */
export async function createMemoryController(projectRoot: string): Promise<MemoryController> {
  const initial = await readMemory(projectRoot);
  let prompt = memoryPrompt(initial);
  return {
    root: initial.projectRoot,
    get prompt() { return prompt; },
    async refresh(signal) {
      const next = await readMemory(initial.projectRoot, signal);
      signal.throwIfAborted();
      prompt = memoryPrompt(next);
    },
    async command(command, mode = "execute") {
      try { return await memoryCommand(initial.projectRoot, command, mode); }
      catch (error) { return `记忆操作失败：${error instanceof Error ? error.message : "未知错误"}`; }
    },
  };
}

/**
 * 执行用户显式发起的记忆命令；查询不写入，Plan下拒绝所有记忆变更。
 */
export async function memoryCommand(projectRoot: string, command: string, mode: ExecutionMode = "execute"): Promise<string> {
  const text = command.trim().replace(/^\/memory(?:\s|$)/, "").trim();
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text || "list")!;
  const action = match[1], argument = match[2] ?? "";
  if (action === "list" && !argument) {
    const data = await readMemory(projectRoot);
    return `项目记忆：${JSON.stringify(data.projectRoot)}\n存储：.hello-my-agent/memory.json · 修订 ${data.revision}；每项新任务开始时加载有效条目。\n`
      + (data.entries.map(entry => `${entry.id} · ${entry.status} · ${entry.content}\n来源：${entry.source.kind} · ${entry.source.detail} · 更新 ${entry.updatedAt}`).join("\n") || "没有项目记忆。");
  }
  if (action === "show" && argument) {
    const data = await readMemory(projectRoot), entry = data.entries.find(item => item.id === argument);
    const audit = data.audit.filter(item => item.id === argument);
    if (!entry && !audit.length) throw new UserFacingError("找不到该记忆ID。");
    return JSON.stringify({ projectRoot: data.projectRoot, entry: entry ?? null, audit }, null, 2);
  }
  if (action === "add" && argument) {
    if (mode === "plan") throw new UserFacingError("Plan模式不能保存记忆；请先切换execute。");
    const entry = await changeMemory(projectRoot, { action: "add", content: argument, source: { kind: "user", detail: "用户通过本地记忆命令明确保存" } });
    return `记忆已保存：${entry!.id}。下一项用户任务加载；当前任务的模型请求快照未改变。`;
  }
  // [KEEP 来自 18.3] 对旧记忆的修正、失效或删除均由用户本地命令发起。
  if (["edit", "invalidate", "delete"].includes(action)) {
    if (mode === "plan") throw new UserFacingError("Plan模式不能修改记忆；请先切换execute。");
    const target = /^(\S+)(?:\s+([\s\S]*))?$/.exec(argument);
    if (!target || (action !== "delete" && !target[2]) || (action === "delete" && target[2])) throw new UserFacingError("用法：edit <id> <正文> | invalidate <id> <理由> | delete <id>");
    const id = target[1];
    if (action === "edit") await changeMemory(projectRoot, { action: "edit", id, content: target[2], source: { kind: "user", detail: "用户通过本地命令纠正正文并恢复有效" } });
    else if (action === "invalidate") await changeMemory(projectRoot, { action: "invalidate", id, source: { kind: "user", detail: memoryText(target[2], 300) } });
    else await changeMemory(projectRoot, { action: "delete", id, source: { kind: "user", detail: "用户通过本地命令删除正文，保留操作来源" } });
    return `记忆${action === "edit" ? "已纠正并恢复有效" : action === "invalidate" ? "已失效" : "已删除正文"}：${id}。下一项用户任务加载；历史消息和当前请求快照不改写。`;
  }
  throw new UserFacingError("用法：/memory list | show <id> | add <正文> | edit <id> <正文> | invalidate <id> <理由> | delete <id>");
}
