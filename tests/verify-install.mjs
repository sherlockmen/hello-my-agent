/**
 * 第一章安装验收：验证读者真正安装后拿到的命令。
 *
 * 开发时有源码、tsx 和 TypeScript，启动成功不等于安装包也能运行。
 * 检查流程：已有构建产物 -> 打包 -> 检查文件 -> 临时安装 -> 离开源码运行 -> 清理。
 * 在仓库根目录运行 npm run verify；该命令先检查类型、构建，再执行本脚本。
 *
 * assert 断言表示“这个结果必须成立”；不成立就抛错，让验收以非零状态结束。
 * tarball 是 npm pack 生成的 .tgz 安装包；prefix 是本次测试使用的安装位置。
 * 本脚本只安装到自己创建的临时目录。当前已实测 macOS，Windows 分支仍待实测。
 */

// 1. 全部使用 Node 内置模块：断言、启动子进程、操作文件和处理路径。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 从脚本位置定位仓库，避免依赖启动脚本时的工作目录；fileURLToPath 将文件 URL 转成路径。
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// mkdtempSync 在系统临时目录下生成唯一位置，重复运行也不会复用读者已有的目录。
const sandbox = mkdtempSync(join(tmpdir(), "hello-my-agent-install-"));
// Windows 通过 npm.cmd 启动；其他平台直接调用 npm。
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * 启动一个命令并检查退出码，返回包含 stdout、stderr 等字段的子进程结果。
 * command 是程序名，args 是参数列表，cwd 指定在哪里执行，expectedStatus 默认是成功码 0。
 * 故意输入错误选项时传入 1，验证程序正确拒绝输入；不是所有非零退出都代表测试失败。
 */
function run(command, args, cwd, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd,
    // 将标准输出和标准错误解码为字符串，方便后面比较文本。
    encoding: "utf8",
    // 单次命令最多等待 120,000 毫秒；同步执行让“打包后安装”的顺序清楚可见。
    timeout: 120_000,
    // Windows 的 .cmd 文件需要 shell 启动；本脚本只传入自己构造的验收参数。
    shell: process.platform === "win32",
  });
  // 无法启动或超时等错误与“程序已启动但退出码不符”分别检查，保留实际失败原因。
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result;
}

try {
  // 2. 验证真实包内容。verify 已先构建，--ignore-scripts 避免 pack 再触发一次 prepack。
  // --json 返回结构化打包结果，--pack-destination 把 .tgz 放入自己的临时目录。
  const packed = run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", sandbox], root);
  // npm 11 返回数组，npm 12 返回以包名为键的对象。
  const packResult = JSON.parse(packed.stdout);
  const archive = Array.isArray(packResult) ? packResult[0] : packResult[pkg.name];
  assert.ok(archive, "npm pack 未返回当前包的信息");
  // 排序后比较完整列表，同时发现缺失的入口和误打入的源码、练习或旧构建文件。
  const entries = archive.files.map((file) => file.path).sort();
  assert.deepEqual(entries, ["LICENSE", "README.md", "dist/cli.js", "package.json"]);
  console.log("✓ 安装包只包含运行代码、包说明和许可证");

  // 3. 安装到临时 prefix。虽然使用 --global 布局，目标仍是本次测试的目录。
  // --omit=dev 不安装开发依赖；--ignore-scripts 防止安装时临时编译，掩盖缺少产物的问题。
  const prefix = join(sandbox, "installed");
  run(npm, ["install", "--global", "--prefix", prefix, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", join(sandbox, archive.filename)], sandbox);
  const modules = run(npm, ["root", "--global", "--prefix", prefix], sandbox).stdout.trim();
  // 向 npm 查询模块目录，适应平台的布局；带 scope 的包名会拆成 @sherlockmen 和 hello-my-agent。
  const installed = join(modules, ...pkg.name.split("/"));
  assert.ok(!existsSync(join(installed, "chapter-01-first-command")));
  for (const dep of ["tsx", "typescript", "@types/node"]) {
    assert.ok(!existsSync(join(installed, "node_modules", dep)), `安装包不应包含 ${dep}`);
  }
  console.log("✓ 在临时前缀安装 tarball，不包含源码或开发依赖");

  // 4. 到没有源码的目录里调用安装出来的命令；目录名含空格，也能暴露路径处理问题。
  const cwd = join(sandbox, "unrelated project");
  mkdirSync(cwd);
  const cli = resolve(prefix, process.platform === "win32" ? "hello-my-agent.cmd" : "bin/hello-my-agent");
  // 欢迎语和帮助检查关键内容；版本必须等于包清单，验证没有误读用户工作目录。
  assert.match(run(cli, [], cwd).stdout, /你好，我的 Agent！/);
  const help = run(cli, ["--help"], cwd).stdout;
  assert.match(help, /--version/);
  assert.match(help, /--help/);
  assert.equal(run(cli, ["--version"], cwd).stdout.trim(), pkg.version);
  assert.equal(run(cli, ["-v"], cwd).stdout.trim(), pkg.version);
  // 错误应该写到 stderr 并以状态 1 结束，方便其他程序判断调用失败。
  assert.match(run(cli, ["--unknown"], cwd, 1).stderr, /unknown option/);
  assert.match(run(cli, ["unexpected-argument"], cwd, 1).stderr, /too many arguments/);
  console.log("✓ 在源码之外、含空格的目录中，安装命令、帮助、版本和错误退出码均正确");
} finally {
  // 5. 无论断言成功还是抛错，finally 都会执行，只清理本脚本创建的临时目录。
  // recursive 删除其中的安装文件，force 允许目录已不存在；不删除读者项目或已有全局安装。
  rmSync(sandbox, { recursive: true, force: true });
}
