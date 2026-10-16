# 第 32 章练习与完整答案

[本章首页](/content/chapter-32-code-intelligence/README.md) · [32.3：当前文件诊断](/content/chapter-32-code-intelligence/03-current-diagnostics/README.md)

这些练习训练证据判断，不再增加工具。我们使用同一个独立项目，答案中的五个文件就是全部项目内容；它们不修改32.3的Agent源码。第33章从32.3继续，保留本章所有工具与生命周期。

## 练习一：同名文字，为什么只有一处是定义

建立一个ESM TypeScript项目：lib.ts导出amount，other.ts也导出同名amount，main.ts导入lib.ts中的amount并输出它。先用grep找amount，再在main.ts的使用位置查询definition和references。

要交付的不是“找到了amount”，而是：定义结果指向哪个文件，为什么other.ts没有进入这次符号的引用结果，以及拿到坐标以后还应该读取什么。

## 练习二：证明报错确实随当前内容消失

在main.ts加入把字符串赋给number的声明。让同一个Agent会话先查询diagnostics，再批准修改这行，随后再次查询。比较两次version、sha256和诊断列表。最后批准check_project的typecheck检查。

解释这两个边界：为什么单独运行两次本地code命令，version可能都是1；为什么目标文件无诊断仍不能代替项目测试。

## 练习三：失败不等于没有错误

无需破坏全局安装。阅读本章验收中“不响应初始化”的测试专用进程，以及真实请求返回后保存文件的测试。分别说明每种情况下工具应该交回什么、模型下一步能做什么。再在本地项目把typecheck脚本暂时改成退出1，观察模型如何读取实际检查结果。

这是一道故障推演题：测试替身只能制造失败；成功诊断仍必须来自真正的语言服务器。不要把故障进程输出的自定义JSON当成TypeScript分析结果。

<details>
<summary>完整答案：五个文件、执行步骤与判断依据</summary>

把以下五个文件放入任意新的练习目录。源码没有引用课程快照，因此它是普通项目，可以用自己的编辑器打开。

<!-- answer-file: package.json -->
```json
{
  "name": "chapter-32-diagnosis-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

<!-- answer-file: tsconfig.json -->
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

<!-- answer-file: src/lib.ts -->
```typescript
/** 输入：无；输出：供主模块导入的固定数值；无可变状态。 */
export const amount = 1;
```

<!-- answer-file: src/other.ts -->
```typescript
/** 输入：无；输出：另一个模块中同名但独立的声明；无可变状态。 */
export const amount = 99;
```

<!-- answer-file: src/main.ts -->
```typescript
import { amount } from './lib.js';
console.log(amount);
export const count: number = 'one';
```

在练习目录安装这个项目的检查器。安装只属于练习项目，不是模型批准执行检查的替代品。

```bash
npm install
```

在课程仓库构建本章最终快照：

```bash
npm run lesson:32.3
```

回到练习目录查询符号：

```bash
hello-my-agent code definition src/main.ts 2 13
hello-my-agent code references src/main.ts 2 13
```

定义应指向src/lib.ts第二行的amount；注释占据第一行，不能照搬没有注释时的行号。引用应包含src/main.ts第二行，other.ts不属于这次导入绑定。grep会返回other.ts里的同名文字，是因为grep查文字；服务器查作用域与模块解析后的符号。下一步读取lib.ts声明及main.ts调用附近的代码，才能判断这条依赖是否符合任务意图。

本地查看当前错误：

```bash
hello-my-agent code diagnostics src/main.ts
```

应有2322，说明string不能赋给number。通过模型演示同一会话中的更新：

```bash
hello-my-agent --prompt '先读 src/main.ts，再查 diagnostics。把 count 的字符串值改成数字 1，修改前让我批准。完成后再次查 diagnostics，比较内容版本与摘要，最后提出运行 typecheck 并取得本次批准。'
```

第一次查询返回的正文摘要属于错误文本。edit_file获批后磁盘内容变化；第二次查询先发送didChange，文档版本增加，返回前还要复核文本。语法和语义请求都成功，且内容没再变化，空诊断才成立。把main.ts最后一行改成下面这一行即可完成修复，前两行不变：

```typescript
export const count: number = 1;
```

单独运行两次本地code命令会创建两个客户端，两个version都从1开始。sha256仍可区分内容；版本号只能说明同一客户端内的同步先后。目标文件无诊断只覆盖本次所查文件和所选检查；项目自己的typecheck可以发现其他文件的问题，测试还能检查实际行为。最终回答应分别报告实际拿到的诊断、项目检查退出状态以及尚未执行的测试。

故障推演的完整判断如下：

| 观察 | 本地程序交回什么 | 模型能据此做什么 |
| --- | --- | --- |
| 服务不响应初始化，超过总期限 | 清理自有进程；确认退出后交回超时工具错误 | 改用grep/read_file，提出check_project，或在下一次独立调用重试。 |
| 清理无法确认 | 保留拥有者，交回清理错误，禁止新建第二组 | 报告本地清理问题，继续可用的搜索；不能声称已经重启。 |
| 真实响应回来之前文件从A变成B | 返回前复核失败，本次诊断作废 | 重新读B，再发起查询；不能用A的诊断评价B。 |
| 用户取消 | 清理后向整轮抛出取消，不再请求模型 | 本轮停止；下次由用户发起新任务。 |
| typecheck实际退出1 | 真实输出与非零退出进入同工具ID的消息 | 根据报错继续调查；没有输出证据时不能编造类型错误。 |

故意让项目检查失败，可以临时把package.json中的typecheck脚本改为`node -e "console.error('LAB_CHECK_FAILED');process.exit(1)"`，再次让模型提出check_project并批准。它应看到LAB_CHECK_FAILED和非零退出。演示后把完整package.json恢复为上面的答案。不要把“脚本执行成功结束”和“脚本退出码为0”混为一谈：检查进程确实运行完毕，检查结论却是失败。

验收脚本逐个写出以上五个完整文件，再调用实际TypeScript语言服务器验证定义、2322以及修复后的新版本与空诊断。故障分支另行验证，故障替身从不承担成功能力证明。

</details>
