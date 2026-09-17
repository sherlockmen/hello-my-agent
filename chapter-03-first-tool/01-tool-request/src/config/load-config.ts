/**
 * 03.1 识别模型的工具请求 | [CHANGED] config/load-config.ts
 *
 * 学习目标：先确定协议，再把命令行、环境变量和 .env 合并成可用配置。
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
// 本节只允许模型提出 read_file 请求；本地执行要到 03.2 才接入，提示词不能提前声称已能读取。
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。需要文件内容时，请提出 read_file 工具请求，不要猜测。当前示例只识别工具请求，尚不能把文件内容返回给你；你也不能修改文件或执行命令，不要声称已经完成这些操作。";

// [KEEP] 配置读取与校验；第一章没有模型配置。
/** 从当前目录向上读取最近项目的 .env；遇到 package.json 后不再越过项目边界。 */
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

/** 合并配置：命令行选项 > 进程环境变量 > 项目 .env > 内置默认值。 */
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
