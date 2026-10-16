/**
 * 32.1 把检查结果交回模型 | [KEEP] tools/skill-tools.ts
 *
 * 学习目标：接纳带包前缀的 Skill 名称，把正文和资源交回原工具调用。
 * 输入：未经信任的JSON、同一份会话技能状态、取消信号。
 * 输出：load_skill返回接纳摘要；read_skill_resource返回完整文字与结构化来源。
 * 状态：正文完整读取后一次提交；资源不常驻system，不执行脚本或授予批准。
 * 流程：解析全部字段 -> 按名加载/按相对路径读取 -> 返回原调用结果；失败抛ToolError。
 */
import { ToolError } from "../errors.js";
import { loadSkill, readSkillResource, type SkillState } from "../skills/catalog.js";
import type { ToolExecutionResult } from "./types.js";

// [KEEP 来自 19.3] Schema帮助模型选择，下面仍会检查真实JSON及全部字段。
export const loadSkillDefinition = {
  name: "load_skill", description: "按任务需要加载技能目录中的完整正文。返回接纳摘要，下一次请求携带正文；不执行脚本或授予权限。",
  inputSchema: { type: "object" as const, properties: { name: { type: "string" as const, minLength: 1, maxLength: 77 } }, required: ["name"], additionalProperties: false },
};
export const readSkillResourceDefinition = {
  name: "read_skill_resource", description: "读取已加载技能的一份文字资源。path相对该技能目录，不是项目根；不执行脚本。正文作为本次工具结果交回模型。",
  inputSchema: { type: "object" as const, properties: { name: { type: "string" as const, minLength: 1, maxLength: 77 }, path: { type: "string" as const, minLength: 1, maxLength: 512 } }, required: ["name", "path"], additionalProperties: false },
};

/**
 * 在磁盘读取前检查顶层对象、确切字段及字符串长度。
 * 未知字段不悄悄丢弃，模型声明的额外权限也不能进入执行参数。
 */
function parseArguments(json: string, resource: boolean): { name: string; path?: string } {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ToolError("技能工具参数不是有效JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError("技能工具参数必须是对象。");
  const input = value as Record<string, unknown>, keys = resource ? ["name", "path"] : ["name"];
  if (Object.keys(input).length !== keys.length || keys.some(key => typeof input[key] !== "string" || !(input[key] as string).trim())
    || Object.keys(input).some(key => !keys.includes(key))) throw new ToolError(`技能工具必须且只能包含${keys.join("、")}非空字符串。`);
  if ((input.name as string).length > 77 || !/^(?:[a-z][a-z0-9-]{0,11}:)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name as string)
    || (resource && (input.path as string).length > 512)) throw new ToolError("技能名或资源路径格式/长度无效。");
  return { name: input.name as string, ...(resource ? { path: input.path as string } : {}) };
}

/**
 * 等待真实加载或读取，返回与本次调用对应的内容及来源。
 * 加载成功时只返回摘要，避免同一正文同时进入system和工具消息；资源正文只走工具消息。
 */
export async function skillTool(name: string, json: string, state: SkillState | undefined, signal: AbortSignal): Promise<ToolExecutionResult> {
  signal.throwIfAborted();
  const resource = name === "read_skill_resource", input = parseArguments(json, resource);
  if (!state) throw new ToolError("本次会话没有技能目录。");
  if (resource) {
    const source = await readSkillResource(state, input.name, input.path!, signal);
    return { content: `技能资源：${JSON.stringify(source.path)}；${source.bytes} 字节；SHA256=${source.sha256}\n${source.text}`,
      metadata: { kind: "read_skill_resource", name: input.name, path: source.path, bytes: source.bytes, sha256: source.sha256 } };
  }
  const skill = await loadSkill(state, input.name, signal);
  return { content: `已加载技能 ${skill.name}；来源=${JSON.stringify(skill.path)}；${skill.bytes} 字节；SHA256=${skill.sha256}。下一次模型请求携带完整正文。`,
    metadata: { kind: "load_skill", name: skill.name, path: skill.path, bytes: skill.bytes, sha256: skill.sha256 } };
}
