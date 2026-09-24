/**
 * 11.3 浏览历史与工具结果 | [KEEP 来自 10.3] ui/tui/approval.ts
 *
 * 学习目标：让界面把一次明确决定交回原来的审批等待，而不是用显示事件代替授权。
 * 输入：Agent Loop 传来的 ApprovalRequest、同轮取消信号，以及显示或清除面板的函数。
 * 输出：完整分页文字和一个最终批准或拒绝结果；取消或显示失败会让等待抛错。
 * 状态：每次等待独立持有 settled；结束后清理监听和面板，旧 respond 不能再批准任何调用。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   预览 -> 可见转义 -> 按终端列宽折行 -> 按可用行数分成全部页面
 *   请求 -> 信号已取消？-- 是 -> 抛出取消原因
 *                        +-- 否 -> 创建 Promise、登记取消监听 -> 显示 pending
 *   输入 -> 已结束或已取消？-- 是 -> 返回 false
 *                          +-- 否 -> y / n / 合法的 s？-- 否 -> false，继续等待
 *                                                     +-- 是 -> 清理 -> 返回决定
 *   abort / 显示失败 -> 清理 -> Promise 拒绝；清理面板失败也拒绝
 *
 * 分页只改变显示布局，完整 preview 仍来自已准备的操作；这里不重新解析参数或执行工具。
 * s 只在请求允许会话授权且没有操作预览时有效，写入和命令仍只能批准一次。
 * key 让 app.tsx 为新请求重建输入框；settled 则保证旧输入回调永远不能二次提交。
 * 运行观察：等待批准时工具还未启动；拒绝返回原核心，取消会立即解除这次审批等待。
 */
import { randomUUID } from "node:crypto";
import wrapAnsi from "wrap-ansi";
import type { ApprovalRequest, ApprovalResponse } from "../../permissions/policy.js";
import { screenText } from "./state.js";

// [KEEP 来自 10.3] 本文件以下实现沿用 10.3；key 仍用来区分每次审批。
export type PendingApproval = {
  key: string;
  request: ApprovalRequest;
  respond: (choice: string) => boolean;
};

/**
 * 把完整审批内容分成终端能逐页显示的文字。
 *
 * - 输入：原审批请求和当前终端列数、行数；尺寸来自 app.tsx 的窗口状态。
 * - 输出：包含工具、目标、原因和完整预览的页面数组；没有预览时显示对应说明。
 * - 关键步骤：先把控制字符写成可见文字，再按显示宽度折行，最后给边框和输入提示预留行数。
 * - 职责边界：这里只分页，不截去后续页面；是否已看到最后一页由审批组件检查。
 */
export function approvalPages(request: ApprovalRequest, columns: number, rows: number): string[] {
  const content = `工具：${request.call.name}\n目标：${request.resource}\n原因：${request.reason}\n\n${request.preview ?? "本次请求没有文件修改。"}`;
  const lines = wrapAnsi(screenText(content), Math.max(10, columns - 4), { hard: true, trim: false }).split("\n");
  const size = Math.max(1, rows - 11);
  return Array.from({ length: Math.ceil(lines.length / size) }, (_, page) => lines.slice(page * size, (page + 1) * size).join("\n"));
}

/**
 * 保持原审批调用等待，直到界面返回一次决定或本轮被取消。
 *
 * - 输入：核心的审批请求、同轮取消信号，以及接收 pending 或 undefined 的显示函数。
 * - 输出：Promise 只返回一次 ApprovalResponse；respond 的 false 表示输入无效或等待已经结束。
 * - 生命周期：每次调用单独保存 settled 和取消监听，结束时先禁止后续输入，再移除监听、清除面板。
 * - 失败方式：取消使用 signal.reason 拒绝；显示或清除面板抛错也拒绝，不能当作已经获得批准。
 * - 授权范围：y 只允许本次，s 还需本地请求允许且没有预览；本函数不扩大 scope，也不执行工具。
 * - 职责边界：这是核心会等待的控制通道；与只报告已发生事件的观察者不同，失败会结束本轮。
 */
export function waitForApproval(
  request: ApprovalRequest, signal: AbortSignal,
  show: (pending: PendingApproval | undefined) => void,
): Promise<ApprovalResponse> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // 这个变量属于本次 Promise；面板消失后旧 respond 仍可能被引用，但不能再次产生决定。
    let settled = false;
    const finish = (response?: ApprovalResponse, error?: unknown) => {
      if (settled) return;
      // 先锁定结束状态，防止清理面板的过程中又收到输入或取消。
      settled = true;
      signal.removeEventListener("abort", abort);
      try { show(undefined); } catch (displayError) { reject(displayError); return; }
      if (response) resolve(response); else reject(error);
    };
    const abort = () => finish(undefined, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const pending: PendingApproval = { key: randomUUID(), request, respond(choice) {
      if (settled || signal.aborted) return false;
      if (choice === "y") finish({ decision: "allow_once" });
      else if (choice === "s" && request.allowSession && request.preview === undefined) finish({ decision: "allow_session" });
      else if (choice === "n") finish({ decision: "deny", reason: "用户拒绝了本次操作" });
      else return false;
      return true;
    } };
    try { show(pending); } catch (error) { finish(undefined, error); }
    // 显示函数也可能同步触发取消；补查一次，避免留下永远等不到结果的 Promise。
    if (signal.aborted) abort();
  });
}
