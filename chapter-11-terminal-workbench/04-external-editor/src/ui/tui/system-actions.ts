/**
 * 11.4 把草稿交给外部编辑器 | [CHANGED] ui/tui/system-actions.ts
 *
 * 学习目标：由用户把草稿交给外部编辑器，完成后取回仍待发送的文字。
 * 输入：界面选择的显示文字或当前草稿与取消信号。
 * 输出：复制操作结束通知，或外部编辑后的草稿。失败抛错，由界面说明原因。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   复制 -> 超过 1000000 字节？-- 是 -> 抛错
 *                               +-- 否 -> 系统剪贴板进程 -> 从 stdin 交付文字
 *   启动失败 / 超过 5 秒 / 非零退出 -> 报错；退出码为 0 -> 完成
 *   外部编辑 -> 创建临时目录与草稿文件 -> 启动本地配置的编辑器
 *   编辑器正常结束？-- 否 -> 抛错，界面保留原草稿
 *                      +-- 是 -> 普通文件且长度允许？-- 否 -> 抛错
 *                                                    +-- 是 -> 读回文字并返回
 *   成功 / 失败 -> finally 删除临时目录
 *
 * VISUAL / EDITOR 来自本地用户配置，允许携带参数；它会交给本机 shell，不是模型可以设置的工具参数。
 * 编辑器运行期间的终端让出与恢复由 app.tsx 负责；这里只管理进程和临时草稿。
 * 运行观察：外部编辑器保存退出后草稿更新，仍要手动发送；编辑器失败时原草稿保留。
 */
import { spawn } from "node:child_process";
// [NEW 11.4] 临时目录和草稿长度限制只服务外部编辑，不改变复制路径。
import { mkdtemp, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DRAFT } from "./editor.js";

// [KEEP 来自 11.3] 仅在用户明确按复制键时写系统剪贴板；模型输出不能触发这里。
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

// [NEW 11.4] 外部编辑器由本地用户选择；只交换草稿，返回后仍需手动发送。
/**
 * 把草稿暂存在文件中，等待本地编辑器结束后取回文字。
 *
 * - 输入：当前草稿与本次编辑专用的取消信号；调用方先暂停 Ink 对终端的占用。
 * - 输出：正常保存退出后的完整草稿，换行统一成 LF；这里不会调用发送函数。
 * - 关键步骤：创建私有临时草稿，依次选择 VISUAL、EDITOR 或 vi；文件路径作为单独参数交给 shell。
 * - 校验：编辑器成功退出后检查普通文件与字节大小，再读回并检查 MAX_DRAFT 个 UTF-16 单元的长度限制。
 * - 失败与清理：取消先请求 SIGTERM，再用 SIGKILL 兜底并等待 close；任何结果都清理临时目录，错误交给界面保留原草稿。
 * - 职责边界：本地编辑器配置是可信配置；路径检查和读取并非同一个原子操作，这不是隔离恶意编辑器的文件系统沙箱。
 */
export async function editExternally(text: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "hello-agent-draft-"));
  const file = join(directory, "prompt.md");
  try {
    await writeFile(file, text, { mode: 0o600 });
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      // 用户的编辑器配置可以带 --wait；文件名作为独立参数，不拼入 shell 命令正文。
      const child = spawn("/bin/sh", ["-c", `exec ${editor} "$1"`, "hello-agent-editor", file], { stdio: "inherit" });
      let failure: Error | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { child.kill("SIGTERM"); timer = setTimeout(() => child.kill("SIGKILL"), 1000); timer.unref(); };
      signal.addEventListener("abort", stop, { once: true });
      child.on("error", (error) => { failure = error; });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (signal.aborted) reject(signal.reason);
        else if (failure || code !== 0) reject(new Error("编辑器未正常结束，原草稿已保留。"));
        else resolve();
      });
      if (signal.aborted) stop();
    });
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > MAX_DRAFT * 4) throw new Error("编辑结果不是普通文件或过大，原草稿已保留。");
    const next = (await readFile(file, "utf8")).replace(/\r\n?/g, "\n");
    if (next.length > MAX_DRAFT) throw new Error("编辑结果超过草稿上限，原草稿已保留。");
    return next;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
