/**
 * 11.3 浏览历史与工具结果 | [NEW] ui/tui/system-actions.ts
 *
 * 学习目标：按用户的复制快捷键，把当前选中内容交给系统剪贴板。
 * 输入：界面选择的显示文字与取消信号。
 * 输出：复制操作结束通知。失败抛错，由界面说明原因。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   复制 -> 超过 1000000 字节？-- 是 -> 抛错
 *                               +-- 否 -> 系统剪贴板进程 -> 从 stdin 交付文字
 *   启动失败 / 超过 5 秒 / 非零退出 -> 报错；退出码为 0 -> 完成
 *
 * 剪贴板程序只在界面快捷键触发后启动；文本通过 stdin 传入，不作为命令拼接。
 * 运行观察：复制成功后界面显示通知；系统缺少剪贴板命令时显示错误而不改变消息。
 */
import { spawn } from "node:child_process";

// [NEW 11.3] 本文件以下实现均为本节新增；只有用户的复制动作才调用此处。
/**
 * 把用户选中的内容交给本机剪贴板程序。
 *
 * - 输入：要复制的文字与可选取消信号；当前界面传入的是选中消息及其详情。
 * - 输出：进程退出码为 0 时 Promise 完成；不读取或验证粘贴板里的后续内容。
 * - 关键步骤：按系统选择 pbcopy、clip.exe、wl-copy 或 xclip，限制输入在 1000000 字节内，再从 stdin 传入文字。
 * - 失败方式：启动失败、取消或非零退出会拒绝 Promise；5 秒后请求强制终止，仍由进程关闭事件完成收尾。
 * - 职责边界：没有通过 shell 解释复制内容，也不改消息或草稿；模型输出本身不能触发复制。
 */
export async function copyText(text: string, signal?: AbortSignal): Promise<void> {
  const [command, ...args] = process.platform === "darwin" ? ["pbcopy"]
    : process.platform === "win32" ? ["clip.exe"] : process.env.WAYLAND_DISPLAY ? ["wl-copy"] : ["xclip", "-selection", "clipboard"];
  if (Buffer.byteLength(text) > 1_000_000) throw new Error("复制内容超过 1 MB，请缩小范围。");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], signal });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.on("error", () => { clearTimeout(timer); reject(new Error(`无法运行 ${command}，请检查系统剪贴板命令。`)); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("复制未完成。")); });
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}
