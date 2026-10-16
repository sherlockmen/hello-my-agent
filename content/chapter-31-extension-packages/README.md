# 第 31 章：本地扩展包

[上一章：定时与持续任务](/content/chapter-30-scheduled-tasks/README.md) · [课程进度](/content/docs/PROGRESS.md) · [练习与完整答案](/content/chapter-31-extension-packages/EXERCISES.md)

Skills 说明如何处理任务，Hooks 在生命周期事件中执行本地处理，MCP 提供外部工具。这些能力已经分别可用，现在我们把相关文件装进一个本地目录，让用户在项目里安装、明确启用、停用和卸载整套能力。

本章始终使用 review-kit 包。安装完成只是把校验过的副本保存到项目；启用才允许本次进程启动声明的程序，并把真实能力接到已有 Agent。用户能在同一个运行中的 Agent 看到 Skill 目录变化、Hook 执行和 MCP 工具调用，也能在停用后核对入口撤下与直接子进程退出。

| 小节 | 我们要得到什么 | 关键判断 |
| --- | --- | --- |
| [31.1 安装本地扩展包](/content/chapter-31-extension-packages/01-install-local-package/README.md) | 保存一个完整、可检查且尚未执行的副本 | 清单兼容、包内路径有效，复制品校验后 rename 提交 |
| [31.2 显式启用扩展能力](/content/chapter-31-extension-packages/02-enable-capabilities/README.md) | 在当前 Agent 中接上 Skills、Hooks 和 MCP | 本地用户明确选择、所有连接成功、空闲边界原地发布 |
| [31.3 停用、卸载与诊断](/content/chapter-31-extension-packages/03-disable-and-diagnose/README.md) | 撤下能力、确认资源结束，再按需删除包 | 按 owner 清理，关闭失败保留拥有记录和文件 |

三个小节各自保留完整 TypeScript 快照，累计继承 30.3 的共享任务、消息和本地定时服务，不跨章节 import。包的安装文件保存在项目 `.hello-my-agent/extensions/`，启用状态只存在于当前进程，不会随会话恢复自动执行。

这是本地目录扩展机制。它没有网络下载、依赖安装、版本范围求解、自动升级或沙箱；显式启用的本地代码拥有当前用户的程序权限。处理失败时只报告实际确认的完成事实，不把取消描述成副作用撤销。
