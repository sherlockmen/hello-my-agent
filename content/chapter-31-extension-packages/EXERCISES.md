# 第 31 章练习与完整答案

[本章首页](/content/chapter-31-extension-packages/README.md) · [31.3 完整主线](/content/chapter-31-extension-packages/03-disable-and-diagnose/README.md)

这三题都使用 31.3 的管理器，创建真正能安装和启停的本地包。答案的每个文件都完整给出，不修改正式主线源码。将一个题目的文件保存到同一个普通目录；含 TypeScript 程序的题目还要先手动编译，生成配置引用的 `dist/*.js`，再把目录传给 install。安装器不会执行编译器、npm 或下载依赖。验证时先实际编译，再安装并调用这些包。

## 练习一：只携带一个 Skill 的包

给测试准备一套独立的审查说明：包 ID 为 `solo-review`，Skill 在包内仍叫 `review`，公开名称应为 `solo-review:review`。它需要一个 `notes.md`，说明检查空输入和取消。安装不应出现 MCP 服务或 Hook；启用后才出现目录条目，加载和读取资源后应得到答案中的正文。

先解释：为什么不能把公开名称 `solo-review:review` 写进 Skill 的 name？为什么停用时，除了 entries 还必须删 loaded？

### 完整答案

清单使用包 ID，Skill frontmatter 继续使用与包内目录相同的本地名字；发现时由管理器加上前缀。entries 决定以后能否发现这条 Skill，loaded 决定后续模型请求是否仍携带已经加载的正文，两者都要撤下。

保存以下三个文件到一个目录，例如 `/tmp/solo-review-answer/`。

<!-- answer-file: solo-review/extension.json -->
```json
{"id":"solo-review","version":"1.0.0","apiVersion":1,"skills":"skills"}
```

<!-- answer-file: solo-review/skills/review/SKILL.md -->
```markdown
---
name: review
description: 检查输入边界和取消处理
---

先读取用户指定的函数，再检查空输入和取消后资源，最后给出可运行的验证命令。
需要细节时读取 notes.md。
```

<!-- answer-file: solo-review/skills/review/notes.md -->
```markdown
检查空输入是否有明确结果；取消以后等待本地资源真正结束，再报告完成。
```

```bash
hello-my-agent --extension install /tmp/solo-review-answer
hello-my-agent --mode execute
```

在会话中执行：

```text
/extension enable solo-review
/skills
/skill solo-review:review
/extension disable solo-review
/skills
```

启用输出中应有 `Skills=1，Hooks=0，MCP=0`。启用后能加载带前缀的名字；停用后该名字和正文都从当前状态移除。包文件仍保留，直到 uninstall。

## 练习二：依赖已经明确启用的包

创建一个 `review-more`，requires 为 `solo-review`，只提供 before_tool 钩子。脚本在自己的包目录写一行事件名，然后按 Hook 协议允许继续。先直接 enable review-more，应报告依赖尚未启用；启用 solo-review 后再启用它，应成功。此时尝试停用 solo-review，程序应该拒绝，直到依赖者先停用。

### 完整答案

保存下面五个文件到 `/tmp/review-more-answer/`。requires 表达启用顺序，程序不会根据它自动安装或执行依赖。Hook 同样用 TypeScript 编写，运行配置引用编译后的文件。

<!-- answer-file: review-more/extension.json -->
```json
{"id":"review-more","version":"1.0.0","apiVersion":1,"requires":["solo-review"],"hooks":"hooks.json"}
```

<!-- answer-file: review-more/hooks.json -->
```json
{"before_tool":[{"command":"node","args":["./dist/hook.js"],"timeout_ms":1000}]}
```

<!-- answer-file: review-more/src/hook.ts -->
```typescript
/**
 * 练习 Hook：安装前手动编译，真实调用时记录收到的事件名。
 * 输入：stdin JSON；输出：包目录 events.txt 与 Hook 协议反馈。
 * 边界：允许继续不等于授予工具批准。
 */
import { readFileSync, appendFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8')) as { event: string };
appendFileSync('events.txt', input.event + '\n');
console.log(JSON.stringify({ continue: true, message: '依赖检查包已执行。' }));
```

<!-- answer-file: review-more/package.json -->
```json
{"private":true,"type":"module"}
```

<!-- answer-file: review-more/tsconfig.json -->
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmitOnError": true,
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

在课程仓库根目录使用已有编译器和 Node 类型定义，先手动构建：

```bash
./node_modules/.bin/tsc -p /tmp/review-more-answer/tsconfig.json --typeRoots ./node_modules/@types
```

确认出现 `/tmp/review-more-answer/dist/hook.js` 后再安装：

```bash
hello-my-agent --extension install /tmp/review-more-answer
```

再启动会话：

```bash
hello-my-agent --mode execute
```

```text
/extension enable review-more
/extension enable solo-review
/extension enable review-more
请读取当前项目的 README.md。
/extension disable solo-review
/extension disable review-more
/extension disable solo-review
```

第一次 enable review-more 被拒绝时没有执行脚本。两包均启用后，真正工具调用前运行脚本，日志写在 `.hello-my-agent/extensions/review-more/events.txt`。第一次停用 solo-review 被依赖关系挡住；反序停用后成功。脚本输出只是钩子反馈，不能批准工具或完成共享任务。

## 练习三：静态诊断能确认什么

创建 `missing-bin`，声明一个不存在的可执行程序。要求安装成功、diagnose 明确报告程序不可用、enable 在启动之前失败。解释为什么安装没有检查服务可用性，也解释“诊断通过”为什么不能证明服务协议正确。

### 完整答案

保存以下两个文件到 `/tmp/missing-bin-answer/`。这个包不引用包内脚本，命令是 PATH 中的程序名。安装只验证配置结构，当前终端环境检查放在 diagnose 和 enable。

<!-- answer-file: missing-bin/extension.json -->
```json
{"id":"missing-bin","version":"1.0.0","apiVersion":1,"mcp":"mcp.json"}
```

<!-- answer-file: missing-bin/mcp.json -->
```json
{"servers":[{"name":"missing","transport":"stdio","command":"hello_agent_missing_binary_31","args":[]}]}
```

```bash
hello-my-agent --extension install /tmp/missing-bin-answer
hello-my-agent --extension diagnose missing-bin
hello-my-agent --mode execute
```

```text
/extension enable missing-bin
/extension list
```

diagnose 和 enable 应报告 `扩展所需可执行程序不可用`；list 继续显示 installed，工具 Map 中没有这个包的定义。安装包可以在一台机器准备、在另一台机器使用，所以文件格式兼容与当前环境可运行分开判断。即使 PATH 检查通过，程序也可能启动后协议错误；真正握手和工具发现仍要等用户明确 enable。

## 复现答案的验证

```bash
node tests/verify-chapter-31.mjs
```

验证会先编译 TypeScript Hook，再用 31.3 的真实管理器安装答案包。它实际触发依赖缺失、正确启用、钩子执行、依赖阻止停用、反序停用、缺少程序诊断和资源撤下，不手工把预期状态塞入管理器。
