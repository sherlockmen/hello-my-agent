/**
 * 02.2 向模型提问一次 | [CHANGED] config/load-config.ts
 *
 * 学习目标：从三个来源读取配置，按固定优先级合并，并在返回前完成校验。
 * 输入：--model / --base-url、process.env，以及当前项目最近的 .env。
 * 输出：包含 apiKey、model、baseURL 的 Config；无效输入抛出 UserFacingError。
 *
 * 执行流程：
 *   +-----------+   +-------------+   +--------------+   +--------+
 *   | CLI options |-->|             |   | required     |   |        |
 *   | process.env|->| first value |-->| fields + URL |-->| Config |
 *   | .env      |-->|             |   | validation   |   |        |
 *   | defaults  |-->|             |   +------+-------+   +--------+
 *   +-----------+   +-------------+          |
 *                                           +-- 失败 --> UserFacingError
 *   优先级：CLI options > process.env > .env > defaults
 *
 * 关键点：优先级是 CLI options > process.env > .env > defaults；查找 .env 时不越过最近的 package.json。
 * 系统提示词也定义在这里，模型模块会把它转换成服务商需要的字段。 配置对象含有 API Key，不能整体写入日志。
 * 运行观察：命令行模型名可以临时覆盖 .env，但不会修改文件。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

// [KEEP 来自 02.1] Options 是外部可选输入，Config 是检查完成后可以直接使用的配置。
export type Options = { model?: string; baseUrl?: string };
export type Config = { apiKey: string; model: string; baseURL: string };
// 只允许这种由我们自己编写的安全提示直接显示；后续 SDK 错误不能原样打印。
export class UserFacingError extends Error {}

// [NEW 02.2] 系统提示词描述助手身份与当前能力，独立于问答历史。
export const systemPrompt = "你是 Hello, My Agent，一个帮助用户学习编程的助手。请用中文清楚回答。当前没有文件或命令工具，不要声称已经操作用户的项目。";

// [KEEP 来自 02.1] 从当前目录向上寻找最近项目的 .env；遇到 package.json 后不再越过项目边界。
function readProjectEnv(): Record<string, string | undefined> {
  let directory = process.cwd();
  while (true) {
    const envPath = join(directory, ".env");
    if (existsSync(envPath)) {
      try {
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

export function readConfig(options: Options): Config {
  const fileEnv = readProjectEnv();
  // 空值视为没填。优先级：命令行 > 环境变量 > .env > 默认值。
  const env = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim();
  const apiKey = env("OPENAI_API_KEY");
  const model = options.model?.trim() || env("OPENAI_MODEL");
  if (!apiKey) throw new UserFacingError("缺少 OPENAI_API_KEY。请在当前目录、项目根目录的 .env 或环境变量中配置。");
  if (!model) throw new UserFacingError("缺少 OPENAI_MODEL。请填写服务商提供的模型 ID，或使用 --model。");
  const baseURL = options.baseUrl?.trim() || env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  let url: URL;
  try { url = new URL(baseURL); } catch {
    throw new UserFacingError("接口地址无效，请检查 OPENAI_BASE_URL 或 --base-url。");
  }
  // 地址可能误带凭据，报错时只说明规则，不回显原值。
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new UserFacingError("接口地址须为 HTTP(S) 基础地址，不能含用户名、密码、查询参数或片段。");
  }
  return { apiKey, model, baseURL };
}
