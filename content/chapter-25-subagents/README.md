# 第 25 章：把局部任务交给独立的只读 Agent

主 Agent 回答一个项目问题时，常常先花很多步骤搜索和读文件。本章让父模型把范围明确的探索或审查交给子任务：子循环在自己的历史里取得材料，再把结论、终态和证据作为工具结果交回父模型。

子 Agent 仍使用已经实现的 Agent Loop。变化在于输入范围更窄、历史独立、工具更少，并且有明确的父任务关联。父模型获得结果后继续判断，用户也能看见子任务正在做什么。

## 从委派到父模型继续判断

父模型提出 `delegate_task`；程序校验角色和任务，创建子会话；子循环通过读取工具获得观察，完成局部推理；程序收齐终态，按委派调用编号把结果加入父历史；父模型再决定补充核对还是回答用户。

本章按顺序执行委派。`explore` 和 `review` 都只允许 `read_file`、`glob`、`grep`，父任务权限继续约束它们。角色提示说明工作目标，程序白名单决定实际动作边界。

## 本章路线

| 小节 | 要弄明白的事 | 完成后的能力 |
| --- | --- | --- |
| [25.1 子会话](/content/chapter-25-subagents/01-child-sessions/README.md) | 独立循环怎样把结果接回主任务 | 新建子历史与父关联，通过工具结果返回 |
| [25.2 只读角色](/content/chapter-25-subagents/02-readonly-roles/README.md) | 为什么提示词不能代替动作限制 | 定义与执行两处收紧工具，保留可核对证据 |
| [25.3 观察与收尾](/content/chapter-25-subagents/03-child-observation/README.md) | 等待时显示什么，取消时确认什么 | 展示子任务活动，传回终态，等待本地取消收尾 |
| [练习与答案](/content/chapter-25-subagents/EXERCISES.md) | 怎样证明子历史与父历史没有混写 | 用模型替身验证返回、越界拒绝及取消链路 |

从 [24.3](/content/chapter-24-attachments/03-attachment-resume/README.md) 的完整 `src/` 继续。各节分别构建：`npm run lesson:25.1`、`npm run lesson:25.2`、`npm run lesson:25.3`，再运行节内给出的观察或断言。

本章状态：已于 2026-10-16 按用户通知确认完成。
