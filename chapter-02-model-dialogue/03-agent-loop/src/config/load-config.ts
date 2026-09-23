/**
 * 02.3 建立 Agent Loop 核心 | [KEEP] config/load-config.ts
 *
 * 学习目标：从三个来源读取配置，按固定优先级合并，并在返回前完成校验。
 * 输入：--model / --base-url、process.env，以及当前项目最近的 .env。
 * 输出：包含 apiKey、model、baseURL 的 Config；无效输入抛出 UserFacingError。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
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
// 这个错误使用程序预先编写的提示；创建时不放密钥，显示时也不展开外部异常。
export class UserFacingError extends Error {}

// [KEEP 来自 02.2] 系统提示词描述助手身份与当前能力，独立于问答历史。
export const systemPrompt = "你是一个运行在命令行中的个人编程 Agent。请使用中文准确、清楚地回答编程问题。当前阶段只能进行文本对话，尚未获得读取文件、修改代码或执行命令的工具；不要声称已经执行这些操作。";

// [KEEP 来自 02.1] 从当前目录向上寻找最近项目的 .env；遇到 package.json 后不再越过项目边界。
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
 * 为这次启动选出完整的模型配置，并在发送请求前检查它。
 *
 * options 来自命令行；其余值从进程环境和项目 .env 取得。
 * 每个字段先用命令行选项，再用环境变量和文件值，最后才考虑默认地址。
 * 去除空白后仍为空的值视为未填写；缺少密钥或模型、地址格式不符合要求时抛出提示。
 * 成功返回 apiKey、model 和 baseURL，但不验证远端是否接受它们，也不发送请求。
 */
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
