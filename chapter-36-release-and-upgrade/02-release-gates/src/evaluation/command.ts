/**
 * 36.2 发布门禁 | [KEEP] evaluation/command.ts
 * 学习目标：在任何模型配置读取之前完成离线实验，拒绝混用其他动作
 * 输入：明确选择的固定样本；输出：结构化事实，不以最终文字判成功。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：校验独占选项 -> 离线评测 -> 报告位置与退出状态。
 * 状态：只操作评测器自建样本；异常保留文件供核对，调用者等待收尾。
 */
// [KEEP 来自 35.1] 评测专用入口，不向普通聊天注册新工具或自动批准。
import { resolve } from "node:path";
import { runEvaluation } from "./runner.js";
import { UserFacingError } from "../errors.js";
// [KEEP 来自 35.3] 只有live分支读取已有模型配置，离线入口不触碰密钥。
import { readConfig } from "../config/load-config.js";
import { createModel } from "../models/client.js";

/** 校验整组选项后才创建样本；不存在的suite不能悄悄变成在线请求。 */
export async function runEvaluationCommand(options: Record<string, unknown>): Promise<void> {
  const live = options.evaluate === "live";
  // [KEEP 来自 36.1] live 复用同一显式连接配置；离线入口仍不读配置。
  const allowed = new Set(["evaluate", "evaluationDir", "output", ...(live ? ["provider", "model", "baseUrl", "config"] : [])]);
  if (Object.entries(options).some(([key, value]) => value !== undefined && value !== false
    && (!allowed.has(key) || (key === "output" && value !== "auto")))) {
    throw new UserFacingError("--evaluate 请单独使用，可配合 --evaluation-dir。");
  }
  // [KEEP 来自 35.2] 两种入口都不创建真实模型。
  if (options.evaluate !== "offline" && options.evaluate !== "regression" && !live) throw new UserFacingError("评测类型必须为 offline、regression 或 live。");
  const directory = resolve(typeof options.evaluationDir === "string" ? options.evaluationDir : "evaluation-results");
  const model = live ? createModel(readConfig({ provider: typeof options.provider === "string" ? options.provider : undefined,
    model: typeof options.model === "string" ? options.model : undefined, baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : undefined, config: typeof options.config === "string" ? options.config : undefined })) : undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("评测已取消。"));
  process.on("SIGINT", cancel);
  try {
  const report = await runEvaluation(live ? "live" : options.evaluate as "offline" | "regression", directory, model, controller.signal);
  for (const item of report.cases) console.log(`${item.expectationPassed ? "通过" : "失败"} ${item.scenario}；报告：${item.reportPath}`);
  for (const item of report.terminal) console.log(`${item.passed ? "通过" : "失败"} terminal/${item.name}`);
  if (!report.passed) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    try { await model?.jobs?.close(); } finally { await model?.languageService?.close(); }
  }
}
