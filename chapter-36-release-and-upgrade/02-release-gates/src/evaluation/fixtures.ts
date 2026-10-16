/**
 * 36.2 发布门禁 | [KEEP] evaluation/fixtures.ts
 * 学习目标：固定起点、要求、版本和允许改动，使每次比较面对相同实验
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：版本化定义 -> 全新项目 -> 独立检查。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
export const TASK_VERSION = "add-v1";
export const TASK_INPUT = "修复 add 的加法错误。只修改 src/add.mjs，保留其他文件，运行已有 test 脚本确认。";
export const ALLOWED_TOOLS = ["read_file", "edit_file", "check_project"] as const;
export const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "agent-evaluation-fixture", private: true, type: "module", scripts: { test: "node --test test/add.test.mjs" } }, null, 2) + "\n",
  "src/add.mjs": "export function add(a, b) { return a - b; }\n",
  "test/add.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/add.mjs";\ntest("positive", () => assert.equal(add(2, 3), 5));\ntest("negative", () => assert.equal(add(-2, -3), -5));\ntest("zero", () => assert.equal(add(0, 0), 0));\n',
};
