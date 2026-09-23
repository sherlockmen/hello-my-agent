/**
 * 02.6 说明错误与显示用量 | [CHANGED] config/load-config.ts
 *
 * 学习目标：先选协议，再按优先级从命令行、环境变量和 .env 选出本次要用的配置。
 * 输入：provider、model、baseUrl 选项，以及 OPENAI_* / ANTHROPIC_* 环境配置。
 * 输出：经过校验的 Config；缺少配置或地址无效时抛出 UserFacingError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +----------+
 *   | provider |
 *   +----+-----+
 *        v
 *    openai？ -- 是 --> 读取 OPENAI_* -----+
 *        | 否                              |
 *        v                                 v
 *   anthropic？ -- 是 --> 读取 ANTHROPIC_* +--> +-------------+
 *        | 否                                   | merge/check |
 *        v                                      +------+------+
 *       报错                                           | 失败 --> UserFacingError
 *                                                      | 成功 --> Config
 *
 * 关键点：错误类型从 errors.ts 导入；配置选择规则与 02.5 相同。
 * API Key 不提供命令行选项，避免它进入 shell 历史和进程参数。
 * 运行观察：选择哪个 provider，缺少配置时就明确提示对应的变量名。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
// [CHANGED 02.6] 错误提示集中管理，配置读取规则沿用 02.5。
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
// 本章没有工具，所以系统说明也明确告诉模型：还不能读取文件或运行命令。
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。当前阶段只能进行文本对话，尚未获得读取文件、修改代码或执行命令的工具；不要声称已经执行这些操作。";

// [KEEP] 配置读取与校验；第一章没有模型配置。
/**
 * 找到当前项目使用的 .env，把文件中的键和值读成普通对象。
 *
 * 从用户启动命令的目录开始，每一层先找 .env，再看是否已到 package.json。
 * 找到文件就返回解析结果；到达项目边界或根目录仍未找到时，返回空对象，
 * 让调用方继续使用命令行和环境变量提供的配置。
 * 读取或解析抛出异常时，改用固定的 UserFacingError，避免回显配置正文。
 * 返回的对象与 process.env 分开，文件内容不会自动覆盖进程环境。
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
 * 先选接口协议，再取得这次请求应使用的一组配置。
 *
 * 选择顺序仍是命令行、进程环境、项目 .env，最后使用内置默认值。
 * provider 选定后，只取对应 OPENAI_* 或 ANTHROPIC_* 字段，不能拿另一组密钥补空缺。
 * 成功返回包含协议、密钥、模型与地址的 Config；不支持的协议、缺项或地址格式错误会抛出提示。
 * 这里检查本地输入，不创建客户端，也不能证明地址归属或账号权限。
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
  // 这里只检查地址结构，不能验证服务商归属；报错不打印原值，以免地址中误填了凭据。
  let url: URL;
  try { url = new URL(baseURL); } catch {
    throw new UserFacingError("接口地址无效，请检查所选协议的 BASE_URL 或 --base-url。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new UserFacingError("接口地址须为 HTTP(S) 基础地址，不能含用户名、密码、查询参数或片段。");
  }
  return { provider, apiKey, model, baseURL };
}
