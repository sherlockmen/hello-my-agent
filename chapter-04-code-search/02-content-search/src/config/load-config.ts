/**
 * 04.2 把文本目标变成代码位置 | [CHANGED] config/load-config.ts
 *
 * 学习目标：让系统提示词准确声明新增的 grep 内容搜索能力。
 * 输入：provider、model、baseUrl 选项，以及所选协议对应的环境配置。
 * 输出：经过校验的 Config 和只声明真实能力的 systemPrompt。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   provider --> 选择 OPENAI_* 或 ANTHROPIC_* --> 合并配置 --> 校验 --> Config
 *   当前工具能力 -----------------------------------------------> systemPrompt
 *
 * 关键点：glob 查找路径，grep 返回代码位置，read_file 读取内容；提示词不把三者混成一个动作。
 * 运行观察：模型遇到未知函数位置时可以调用 grep，而不是猜测文件名。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
// [KEEP 来自 02.6] 错误提示集中管理，配置读取规则沿用 02.5。
import { UserFacingError } from "../errors.js";

// [KEEP] 可选字段对应 Commander 的选项；读取后统一转成必填的 Config。
export type Options = { provider?: string; model?: string; baseUrl?: string };
export type Config = {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
  baseURL: string;
};

// [KEEP] 系统提示词约束当前助手的行为，独立于 user/assistant 历史。
// [KEEP 来自 03.2] 工具执行已经接通，提示词准确声明真实读取能力。
// [CHANGED 04.2] 系统提示词新增 grep，并说明三个只读工具的分工。
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。你可以调用 glob 查找文件、grep 搜索代码位置，再调用 read_file 读取不超过 64 KiB 的普通文件；.env 系列环境配置文件不可读取。你不能修改文件或执行命令，也不要声称已经完成这些操作。需要项目信息时必须调用工具，不要猜测。";

// [KEEP] 配置读取与校验；第一章没有模型配置。
/**
 * 从启动位置向上找 .env，让子目录启动也能找到项目配置。
 *
 * 每层先看 .env，再看 package.json；找到 .env 就解析并返回其中的键值。
 * 到最近的 package.json 或文件系统根目录仍没找到时，返回空对象。
 * 这里只读取配置，不把整份文件写进 process.env；读取或解析失败时抛出 UserFacingError。
 */
function readProjectEnv(): Record<string, string | undefined> {
  let directory = process.cwd();
  while (true) {
    const envPath = join(directory, ".env");
    if (existsSync(envPath)) {
      try {
        // parseEnv 只把文本解析为对象，不把 .env 的所有字段注入进程环境。
        return parseEnv(readFileSync(envPath, "utf8"));
      } catch {
        throw new UserFacingError("无法读取项目的 .env，请检查文件格式和读取权限。");
      }
    }
    if (existsSync(join(directory, "package.json"))) return {};
    const parent = dirname(directory);
    if (parent === directory) return {};
    directory = parent;
  }
}

/**
 * 选择要连接的模型服务，并把不同来源的配置合成一个 Config。
 *
 * 先确定 provider，再只读取对应的 OPENAI_* 或 ANTHROPIC_*，避免混用密钥。
 * 同一项按命令行选项、进程环境变量、项目 .env、内置默认值的顺序取第一个可用值。
 * 协议、必填项和基础地址检查失败时抛出 UserFacingError；成功只返回配置，不发送请求。
 */
export function readConfig(options: Options): Config {
  const fileEnv = readProjectEnv();
  // 空字符串视为未配置；trim 去掉复制配置时带入的首尾空格。
  const env = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim();
  const provider = options.provider?.trim() || env("AGENT_PROVIDER") || "openai";
  if (provider !== "openai" && provider !== "anthropic") {
    throw new UserFacingError("AGENT_PROVIDER 或 --provider 只能是 openai 或 anthropic。");
  }
  // 不提供 --api-key 选项，避免把密钥留在命令历史和进程参数中。
  // 先选协议，再读取这一组配置，避免切换协议时把另一组密钥发给错误的服务。
  const prefix = provider === "openai" ? "OPENAI" : "ANTHROPIC";
  const apiKey = env(`${prefix}_API_KEY`);
  const model = options.model?.trim() || env(`${prefix}_MODEL`);
  if (!apiKey) throw new UserFacingError(`缺少 ${prefix}_API_KEY。请在当前目录、项目根目录的 .env 或环境变量中配置。`);
  if (!model) throw new UserFacingError(`缺少 ${prefix}_MODEL。请填写服务商提供的模型 ID，或使用 --model。`);
  const baseURL = options.baseUrl?.trim() || env(`${prefix}_BASE_URL`) ||
    (provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com");
  // 只验证地址结构，不打印原值；地址中也可能误填凭据。
  let url: URL;
  try { url = new URL(baseURL); } catch {
    throw new UserFacingError("接口地址无效，请检查所选协议的 BASE_URL 或 --base-url。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new UserFacingError("接口地址须为 HTTP(S) 基础地址，不能含用户名、密码、查询参数或片段。");
  }
  return { provider, apiKey, model, baseURL };
}
