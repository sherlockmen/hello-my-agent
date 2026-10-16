# 第 26 章：命令还在运行，Agent 怎样继续工作

测试命令结束后才能知道结果，开发服务器却通常不会主动结束。还有些命令会停在交互提示，等待用户输入。本章为这些进程建立独立的作业身份：Agent 可以继续聊天，用户可以查看日志、停止作业，并在需要时把终端交给交互程序。

第 25 章的子 Agent 等待的是局部推理结果；本章管理的是当前 CLI 实际创建的操作系统进程。我们先保留进程与输出，再建立终端输入的归属，最后区分“启动了”“可以使用”和“已经结束”，让模型依据真实观察继续判断。

## 从启动到下一次判断

模型提出后台命令，程序展示本次操作预览，用户批准后才启动。管理器等到进程创建成功，返回 JobID；输出监听继续工作，后续读取用同一个 JobID 找到当前状态和有界日志。需要用户操作时，真实 PTY 承接终端输入与尺寸；停止或退出时，程序等待自己创建的进程完成清理。

后台运行没有改变命令的文件和网络权限。归属依据是当前进程内的登记表，不是模型给出的 PID，也不是从聊天记录读出的旧编号。

## 本章路线

| 小节 | 要弄明白的事 | 完成后的能力 |
| --- | --- | --- |
| [26.1 后台作业](/content/chapter-26-interactive-jobs/01-background-jobs/README.md) | 工具何时返回，之后谁持有进程和日志 | 按 JobID 启动、查询、停止自有 pipe 作业 |
| [26.2 真实 PTY 与人工接管](/content/chapter-26-interactive-jobs/02-pty-takeover/README.md) | 为什么交互程序需要终端，谁读取键盘 | 交接 stdin、EOF 与窗口尺寸，并返回 Agent |
| [26.3 作业生命周期](/content/chapter-26-interactive-jobs/03-job-lifecycle/README.md) | 启动、就绪与退出分别由什么证明 | 保留就绪证据、终态通知与退出清理边界 |
| [练习与答案](/content/chapter-26-interactive-jobs/EXERCISES.md) | 怎样独立验证后台进程没有变成失控资源 | 检查真实启动、输入、观察与清理 |

从 [25.3](/content/chapter-25-subagents/03-child-observation/README.md) 的完整 `src/` 继续。26.1 使用 Node 内置 pipe；26.2 起还需按[环境准备](/content/docs/SETUP.md?id=%E7%AC%AC%E4%BA%8C%E5%8D%81%E5%85%AD%E7%AB%A0%E9%9C%80%E8%A6%81%E7%9A%84%E7%9C%9F%E5%AE%9E-pty-%E4%BE%9D%E8%B5%96)准备 `node-pty` 的原生构建工具。本书命令管理采用 `/bin/sh` 与 POSIX 进程组，在 macOS / Linux 上运行。

本章状态：已于 2026-10-16 按用户通知标记为已完成。
