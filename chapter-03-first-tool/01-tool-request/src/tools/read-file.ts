/**
 * 03.1 识别模型的工具请求 | [NEW] tools/read-file.ts
 *
 * 学习目标：用一份结构化定义告诉模型 read_file 的名称、用途和参数形状。
 * 输入：本节没有直接读取文件；模型只会看到 path 参数的 JSON Schema。
 * 输出：readFileDefinition。真正访问磁盘的函数将在 03.2 加入。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   +--------------------+      +------------------+      +----------------+
 *   | readFileDefinition| ---> | Model API tools  | ---> | model decision |
 *   | name/description  |      | schema in request|      +-------+--------+
 *   | inputSchema       |      +------------------+              |
 *   +--------------------+                              +--------+--------+
 *                                                       | text / tool call|
 *                                                       +-----------------+
 *
 * 关键点：工具定义只是给模型看的“接口说明”，不会自动读取文件。
 * 模型返回工具请求后，仍要由本地程序校验参数并执行；本节先解决请求识别。
 * 运行观察：请求体中出现 read_file；模型可返回名称、调用 ID 和 JSON 参数。
 */

// [NEW 03.1] 这份 JSON Schema 同时适用于 OpenAI 兼容接口和 Anthropic。
export const readFileDefinition = {
  name: "read_file",
  description: "读取当前项目根目录内一个普通文件并按 UTF-8 解码；不读取 .env 系列环境配置文件。",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string" as const,
        description: "相对于当前项目根目录的文件路径，例如 package.json。",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};
