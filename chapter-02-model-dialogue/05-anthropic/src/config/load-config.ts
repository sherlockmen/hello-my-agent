/**
 * 02.5 接入 Anthropic 接口 | [CHANGED] config/load-config.ts
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
 * 关键点：只读取所选协议的一组凭据，防止把另一服务商的密钥发错地址。
 * API Key 不提供命令行选项，避免它进入 shell 历史和进程参数。
 * 运行观察：选择哪个 provider，缺少配置时就明确提示对应的变量名。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
// [CHANGED 02.5] 增加协议选择，仍沿用配置读取和校验规则。
export class UserFacingError extends Error {}

// [KEEP] 可选字段对应 Commander 的选项；读取后统一转成必填的 Config。
// [CHANGED 02.5] 增加 provider，协议先决定读取哪一组环境变量。
export type Options = { provider?: string; model?: string; baseUrl?: string };
export type Config = {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
  baseURL: string;
};

// [KEEP] 系统提示词约束当前助手的行为，独立于 user/assistant 历史。
// 本章没有工具，不能让助手误以为自己已经能读取文件或运行命令。
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。当前阶段只能进行文本对话，尚未获得读取文件、修改代码或执行命令的工具；不要声称已经执行这些操作。";

// [KEEP] 配置读取与校验；第一章没有模型配置。
/**
 * 从启动目录向上查找当前项目的 `.env`，并把文件内容解析成普通对象。
 *
 * - 输入：无显式参数；查找起点是 `process.cwd()` 返回的当前工作目录。
 * - 输出：找到时返回解析后的键值对象；到达最近的 `package.json` 或文件系统根目录仍未找到时返回空对象。
 * - 关键步骤：每层先检查 `.env`，再检查项目边界，然后继续进入父目录。
 * - 失败方式：文件无法读取或语法无法解析时抛出只含安全文案的 `UserFacingError`。
 * - 职责边界：只返回对象，不把文件中的字段批量写入全局 `process.env`。
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
 * 选择模型协议，再合并并校验该协议专用的运行时配置。
 *
 * - 输入：命令行选项、进程环境变量和项目 `.env`。
 * - 输出：返回包含 `provider`、密钥、模型 ID 和基础地址的完整 `Config`。
 * - 覆盖顺序：命令行选项高于进程环境变量，进程环境变量高于 `.env`，最后才使用内置默认值。
 * - 关键原因：先确定 `openai` 或 `anthropic`，再只读取对应前缀的配置，防止混用密钥。
 * - 失败方式：协议名不支持、必填字段缺失或地址不安全时抛出 `UserFacingError`。
 * - 职责边界：这里只处理配置，不创建 SDK 客户端，也不发送请求。
 */
export function readConfig(options: Options): Config {
  const fileEnv = readProjectEnv();
  // 空字符串视为未配置；trim 去掉复制配置时带入的首尾空格。
  const env = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim();
  // [NEW 02.5] 先选择协议，后面只读取它对应的密钥、模型和地址。
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
