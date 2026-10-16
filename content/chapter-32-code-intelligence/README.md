# 第 32 章：接入代码诊断与语言服务

[上一章：本地扩展包](/content/chapter-31-extension-packages/README.md) · [下一章：命令隔离](/content/chapter-33-execution-sandbox/README.md) · [课程进度](/content/docs/PROGRESS.md) · [练习与完整答案](/content/chapter-32-code-intelligence/EXERCISES.md)

模型读过一段代码，能解释它看起来在做什么。要确认它是否通过类型检查、一个名字指向哪里、修改以后原来的错误是否消失，我们还需要程序给出的证据。本章为已有 Agent 接上两条证据来源：项目自己的检查脚本，以及真正运行的 TypeScript 语言服务器。

| 小节 | 我们要得到什么 | 关键判断 |
| --- | --- | --- |
| [32.1 把检查结果交回模型](/content/chapter-32-code-intelligence/01-project-checks/README.md) | 运行项目声明的 test 或 typecheck | 固定入口仍然执行项目代码，必须逐次批准 |
| [32.2 用语言服务定位符号](/content/chapter-32-code-intelligence/02-lsp-navigation/README.md) | 从具体位置查询定义和引用 | 初始化、同步文档、发请求、按编号接回结果 |
| [32.3 只报告当前文件的诊断](/content/chapter-32-code-intelligence/03-current-diagnostics/README.md) | 文件修改后取得新诊断；服务失败后仍能继续 | 内容同步、请求关联、返回前复核、超时清理与下次重启 |

三个快照累计继承31.3的全部能力，各自带完整 TypeScript 源码。本章使用精确版本 `typescript-language-server@5.1.3`，其后端使用课程已经安装的 `typescript@5.9.3`。它是实际包装 tsserver 的社区语言服务器，和模型供应商无关。定义与引用走标准 LSP；本章诊断采用该服务器提供的 tsserver 扩展，不能直接换一个语言服务器就照搬。

最终新增 `check_project` 和 `code_intelligence` 两个工具。前者继续走命令审批；后者只提供固定的读操作，不把服务器的编辑请求变成工作区写入。语言服务按需启动，CLI退出时关闭。无模型密钥时也能通过 `hello-my-agent code ...` 单独核对语言服务。

本章保证所报告的诊断对应本次读取、同步并在返回前复核的目标文件内容；它不把整个项目冻结为一个事务，也不代替项目测试。一个文件没有类型错误，不等于业务行为正确。
