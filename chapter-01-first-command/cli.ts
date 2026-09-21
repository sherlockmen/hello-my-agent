#!/usr/bin/env node

/**
 * 第 01 章：从空目录到自己的命令。
 *
 * 要解决的问题：别人安装这个包后，怎样在自己的项目里启动命令、查看帮助和版本？
 * 本章实现命令入口、帮助和版本查询；下一章在这个入口接入模型。
 *
 * 启动主流程（Agent Loop 尚未建立）：
 *   读取本包版本 -> 登记命令规则 -> 解析用户参数
 *                                  | 无参数        -> 显示欢迎语
 *                                  | --help / -h   -> 显示帮助，结束
 *                                  | --version / -v -> 显示版本，结束
 *                                  | 不支持的参数  -> 报错，结束
 *
 * 两个概念：CLI 是命令行界面；入口文件是 Node 开始执行程序的文件。
 * 构建脚本会自动注册命令；npm 根据 package.json 的 bin 将命令名连接到入口文件。
 * 第一行的 #!/usr/bin/env node 让类 Unix 系统通过 PATH 找到 Node 执行它。
 *
 * 在项目根目录执行 npm run lesson:01，一次完成依赖安装、编译与本地命令注册。
 * 准备完成后直接运行以下命令；修改源码后重新执行本节命令即可：
 *   hello-my-agent           -> 显示欢迎语
 *   hello-my-agent --help    -> 显示帮助
 *   hello-my-agent --version -> 显示 package.json 中的版本；-v 是它的简写
 */

// 1. 准备依赖：Node 负责读本地文件，Commander 负责解析命令参数。
// node:fs 是 Node 自带的文件模块，无需安装；commander 是本项目的运行依赖。
import { readFileSync } from "node:fs";
import { Command } from "commander";

// 2. 读取 Agent 自己的版本，避免在代码里再维护一份版本字符串。
// import.meta.url 是当前文件的 URL；new URL("../package.json", ...) 据此定位包清单。
// 源码在 chapter-01-first-command/，编译后在 dist/；从这两个目录向上一层都能找到清单。
// 例如用户在 /work/demo 启动已安装的命令，这里仍读取 Agent 安装目录的清单。
// 若只写 readFileSync("package.json")，就会从当前工作目录查找，可能读错文件或找不到。
// "utf8" 指定文本编码；JSON.parse 把读到的 JSON 文本转成对象，供后面读取 version。
// 这里在启动时同步读取一次小文件；文件缺失或 JSON 无效时直接报错，便于发现安装问题。
// [NEW 01] 下面是本章新增的完整命令入口：读取版本、登记规则并解析参数。
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// 3. 创建命令对象并登记规则；此时还没有开始解析用户输入。
// 下面的方法返回同一个命令对象，所以可以用 .name().description() 连续配置。
const program = new Command();

program
  // 设置帮助中显示的命令名；本机的命令入口由 npm 根据 bin 字段创建。
  .name("hello-my-agent")
  // 设置帮助中的简介，让使用者知道命令的用途。
  .description("你好，我的 Agent：从 0 到 npm 发布")
  // 三个参数依次是版本号、等价选项、帮助文字；-v 与 --version 都会显示版本并结束。
  .version(packageJson.version, "-v, --version", "显示版本号")
  // -h 与 --help 都会显示帮助并结束；Commander 根据已登记的规则生成帮助内容。
  .helpOption("-h, --help", "显示帮助")
  // 把 () => { ... } 这个函数交给 Commander，等解析参数后再决定是否调用。
  // 按本章规则，无参数启动时执行这里；请求帮助或版本时不会执行。下一章在此接入模型。
  .action(() => {
    console.log("Hello，My Agent！");
    console.log("命令已启动。下一章，我们会给它接上模型。");
  });

// 4. 开始解析：不传参数时，parse() 默认读取 Node 提供的命令行参数数组 process.argv。
// 数组前两项是 Node 和入口文件的路径，Commander 跳过它们，再处理用户输入的参数。
// 例如运行 hello-my-agent --help，这里解析的用户参数就是 --help。
// 必须先登记规则再调用 parse()；未知选项或多余的位置参数会报错，并以退出码 1 结束。
program.parse();
