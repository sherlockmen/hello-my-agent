# Hello, My Agent｜课程进度

更新：2026-10-16。

本表根据最新确认的 **6 部分、36 章 CLI + TUI Agent 课程目录**建立，是后续章节内容与完成状态的记录入口。[初版大纲](/content/docs/planning/COURSE.md)保留原规划；本表已合入 [CLI + TUI 补充内容](/content/docs/CODING-AGENT-GAP-REVIEW.md)。

## 当前进度

- **已确认完成：31 / 36 章（86.1%）。**
- **第 01—12、14—17、20—34 章已确认完成。** 第 13 章已整理，等待阅读确认。
- 第 14—17、20—22 章已于 2026-10-15 确认完成，第 23—34 章已于 2026-10-16 确认完成；第 13 章四节、第 18、19 章各三节待确认；第 32—34 章正文、完整 TypeScript 实现、练习与配图已按先正文后配图整理，公开连续跟写、安装、运行及桌面／手机网页检查通过，现按用户通知标记已完成；第 35、36 章尚未编写。
- 章节完成状态由你的明确通知更新；已有代码或检查通过不自动计入已完成。

## 第 02 章小节进度

小节编号不增加大章总数。你已明确确认第二章完成，因此六个小节一并标记为已完成。

各小节的源码放在自己的 `src/` 中，按配置、Agent 核心、模型接入和终端交互组织；目录随小节逐步增加。[本章练习](/content/chapter-02-model-dialogue/EXERCISES.md) 位于第二章目录，不属于最后一个小节。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 02.1 | [读取模型配置](/content/chapter-02-model-dialogue/01-configuration/README.md) | 2 | 已完成 |
| 02.2 | [向模型提问一次](/content/chapter-02-model-dialogue/02-first-reply/README.md) | 3 | 已完成 |
| 02.3 | [建立 Agent Loop 核心](/content/chapter-02-model-dialogue/03-agent-loop/README.md) | 4 | 已完成 |
| 02.4 | [连续输入与会话历史](/content/chapter-02-model-dialogue/04-conversation/README.md) | 5 | 已完成 |
| 02.5 | [接入 Anthropic 接口](/content/chapter-02-model-dialogue/05-anthropic/README.md) | 5 | 已完成 |
| 02.6 | [说明错误与显示用量](/content/chapter-02-model-dialogue/06-errors-and-usage/README.md) | 6 | 已完成 |

## 更新规则

你可以直接说“第 01 章已完成，标记一下”，也可以一次指定多章。收到明确通知后，在本文件更新该章状态、完成日期、总进度、阶段计数和完成记录。默认使用通知当日的日期；你提供具体完成日期时，以你提供的日期为准。重复通知同一章不重复计数。

状态含义：**未开始**表示尚未进入该章；**进行中**表示正在学习或编写；**待确认**表示已有章节成果、尚未收到你的完成通知；**已完成**表示你已明确通知标记完成。验收项用于学习和核对，实际测试证据另行记录；完成标记不自动宣称尚未运行的测试已经通过。

## 第 03 章小节进度

第三章拆成三个递进快照，主线从“识别请求”走到“成功执行”，最后补齐失败反馈和停止边界。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 03.1 | [识别模型的工具请求](/content/chapter-03-first-tool/01-tool-request/README.md) | 8 | 已完成 |
| 03.2 | [执行 read_file 并回传结果](/content/chapter-03-first-tool/02-read-file-loop/README.md) | 8 | 已完成 |
| 03.3 | [把工具失败反馈给模型](/content/chapter-03-first-tool/03-error-boundary/README.md) | 8 | 已完成 |

## 第 04 章小节进度

第四章沿用第三章的 Agent Loop，只按“发现路径、定位内容、读取上下文”逐步扩展工具层。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 04.1 | [控制文件搜索范围](/content/chapter-04-code-search/01-file-discovery/README.md) | 13 | 已完成 |
| 04.2 | [把文本目标变成代码位置](/content/chapter-04-code-search/02-content-search/README.md) | 14 | 已完成 |
| 04.3 | [把代码位置变成上下文](/content/chapter-04-code-search/03-chunked-reading/README.md) | 14 | 已完成 |

## 第 05 章小节进度

第五章在工具请求与注册表之间加入统一权限门，再依次接入一次审批和会话范围复用。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 05.1 | [让工具调用先经过权限策略](/content/chapter-05-permission-gate/01-policy-decision/README.md) | 15 | 已完成 |
| 05.2 | [在终端中完成一次审批](/content/chapter-05-permission-gate/02-terminal-approval/README.md) | 15 | 已完成 |
| 05.3 | [让 Agent 记住本次运行的批准](/content/chapter-05-permission-gate/03-session-grants/README.md) | 15 | 已完成 |

## 第 06 章小节进度

第六章沿用第五章的权限入口，先保存尚未执行的修改并展示差异，再为已有文件补上精确定位、变化检测和备份。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 06.1 | [先预览，再创建文件](/content/chapter-06-precise-edit/01-create-with-preview/README.md) | 17 | 已完成 |
| 06.2 | [找到原文，只替换这一处](/content/chapter-06-precise-edit/02-exact-replacement/README.md) | 18 | 已完成 |
| 06.3 | [保存之前，检查文件有没有变化](/content/chapter-06-precise-edit/03-change-guard/README.md) | 18 | 已完成 |

## 第 07 章小节进度

第七章从执行测试开始，再补齐进程停止与清理，最后将代码搜索迁移到受控的 `rg` 进程。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 07.1 | [执行测试并读懂结果](/content/chapter-07-command-feedback/01-run-command/README.md) | 19 | 已完成 |
| 07.2 | [停止卡住或输出过多的命令](/content/chapter-07-command-feedback/02-process-lifecycle/README.md) | 20 | 已完成 |
| 07.3 | [让搜索也使用受控子进程](/content/chapter-07-command-feedback/03-ripgrep-search/README.md) | 21 | 已完成 |

## 第 08 章小节进度

第八章先显示文字增量，再检查完整工具请求，最后把取消范围缩小到当前回合并保留已发生的操作。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 08.1 | [让回答逐段显示](/content/chapter-08-streaming-turns/01-text-stream/README.md) | 21 | 已完成 |
| 08.2 | [收齐工具参数，再执行](/content/chapter-08-streaming-turns/02-complete-tool-calls/README.md) | 21 | 已完成 |
| 08.3 | [中断当前任务，继续对话](/content/chapter-08-streaming-turns/03-cancel-and-continue/README.md) | 22 | 已完成 |

## 第 09 章小节进度

第九章先补齐一轮任务的开始和结束，再按顺序交付执行事件，最后增加供脚本读取的 JSONL 输出。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 09.1 | [让界面知道任务何时结束](/content/chapter-09-observable-runs/01-run-lifecycle/README.md) | 23 | 已完成 |
| 09.2 | [按顺序接收执行事件](/content/chapter-09-observable-runs/02-event-stream/README.md) | 24 | 已完成 |
| 09.3 | [让脚本读懂执行过程](/content/chapter-09-observable-runs/03-jsonl-output/README.md) | 25 | 已完成 |

## 第 10 章小节进度

第十章按输入与回答、实时进展、工具审批、取消与终端恢复拆成四节。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 10.1 | [把对话放进一个界面](/content/chapter-10-terminal-ui/01-first-screen/README.md) | 26 | 已完成 |
| 10.2 | [让界面跟着执行变化](/content/chapter-10-terminal-ui/02-live-progress/README.md) | 27 | 已完成 |
| 10.3 | [在界面中批准工具调用](/content/chapter-10-terminal-ui/03-tool-approval/README.md) | 28 | 已完成 |
| 10.4 | [取消以后，继续留在对话里](/content/chapter-10-terminal-ui/04-cancel-and-restore/README.md) | 28 | 已完成 |

## 第 11 章小节进度

第十一章把对话界面扩展成可编辑、可浏览的终端工作区。已于 2026-10-09 确认完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 11.1 | [让多行输入成为可编辑的草稿](/content/chapter-11-terminal-workbench/01-editable-draft/README.md) | 29 | 已完成 |
| 11.2 | [取回旧问题，补全当前文字](/content/chapter-11-terminal-workbench/02-recall-and-complete/README.md) | 30 | 已完成 |
| 11.3 | [在输出继续时，停下来浏览结果](/content/chapter-11-terminal-workbench/03-browse-results/README.md) | 32 | 已完成 |
| 11.4 | [把长草稿交给外部编辑器](/content/chapter-11-terminal-workbench/04-external-editor/README.md) | 32 | 已完成 |
| 11.5 | [按终端列宽排版，保留阅读位置](/content/chapter-11-terminal-workbench/05-terminal-layout/README.md) | 33 | 已完成 |

## 第 12 章小节进度

第十二章从计划模式开始，再接入任务清单、澄清问答、运行中补充与打断，最后管理尚未生效的队列。

12.4 的新版讲解正文已于 2026-10-14 确认。同日按确认的写作方法重写章首页、五节正文与练习，先完成正文，再补四张原理图并检查全章十段动图；配图与播放控件的最终检查已通过，详见验证记录。用户于 2026-10-14 明确要求将第十二章标记为已完成，五节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 12.1 | [计划与执行模式](/content/chapter-12-task-control/01-plan-mode/README.md) | 34 | 已完成 |
| 12.2 | [任务清单](/content/chapter-12-task-control/02-task-list/README.md) | 35 | 已完成 |
| 12.3 | [澄清问题](/content/chapter-12-task-control/03-clarify-questions/README.md) | 37 | 已完成 |
| 12.4 | [运行中补充与打断](/content/chapter-12-task-control/04-live-input/README.md) | 38 | 已完成 |
| 12.5 | [队列编辑与撤回](/content/chapter-12-task-control/05-manage-queue/README.md) | 39 | 已完成 |

## 第 13 章小节进度

第十三章从 12.5 的完整 TypeScript 快照继续，沿“保存 → 读取可信记录 → 恢复 → 查找与导出”串起四节。先写原理正文，再补配图；保留 13.1 已有图文，并为读取、恢复、锁与管理补充图解。实际检查证据见验证记录。本章等待阅读确认；全书确认完成数见本表开头。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 13.1 | [会话保存](/content/chapter-13-session-persistence/01-save-session/README.md) | 40 | 待确认 |
| 13.2 | [读取可信记录](/content/chapter-13-session-persistence/02-read-records/README.md) | 41 | 待确认 |
| 13.3 | [恢复会话](/content/chapter-13-session-persistence/03-resume-session/README.md) | 41 | 待确认 |
| 13.4 | [查找与导出会话](/content/chapter-13-session-persistence/04-manage-sessions/README.md) | 42 | 待确认 |

## 第 14 章小节进度

本章从 13.4 的独立快照继续。实际检查证据见验证记录，本章已于 2026-10-15 按用户通知标记为已完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 14.1 | [从已有会话创建分支](/content/chapter-14-session-checkpoints/01-fork-session/README.md) | 43 | 已完成 |
| 14.2 | [为工具写入保存文件检查点](/content/chapter-14-session-checkpoints/02-file-checkpoints/README.md) | 44 | 已完成 |
| 14.3 | [查看改动并按条件恢复](/content/chapter-14-session-checkpoints/03-review-and-restore/README.md) | 44 | 已完成 |

## 第 15 章小节进度

本章从 14.3 的独立快照继续。实际检查证据见验证记录，本章已于 2026-10-15 按用户通知标记为已完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 15.1 | [估算请求大小并预留输出](/content/chapter-15-context-budget/01-estimate-tokens/README.md) | 45 | 已完成 |
| 15.2 | [缩短工具结果并保留完整日志](/content/chapter-15-context-budget/02-bound-tool-results/README.md) | 47 | 已完成 |
| 15.3 | [显示预算并在超限时停止](/content/chapter-15-context-budget/03-enforce-budget/README.md) | 47 | 已完成 |

## 第 16 章小节进度

本章从 15.3 的独立快照继续，先区分完整记录与请求视图，再生成临时摘要候选，最后在普通请求能放下时采用候选并继续原任务。检查证据见验证记录。本章已于 2026-10-15 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 16.1 | [选择可以压缩的历史](/content/chapter-16-context-compaction/01-select-history/README.md) | 48 | 已完成 |
| 16.2 | [生成摘要并核对替换结果](/content/chapter-16-context-compaction/02-generate-summary/README.md) | 48 | 已完成 |
| 16.3 | [超限时压缩，再继续原任务](/content/chapter-16-context-compaction/03-compact-and-continue/README.md) | 48 | 已完成 |

## 第 17 章小节进度

本章从 16.3 的独立快照继续，先找到项目根，再沿启动目录的祖先链加载说明，最后提供可核对来源与版本的本地报告。检查证据见验证记录。本章已于 2026-10-15 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 17.1 | [从项目根读取说明](/content/chapter-17-project-instructions/01-project-root/README.md) | 49 | 已完成 |
| 17.2 | [区分不同目录的适用范围](/content/chapter-17-project-instructions/02-scoped-instructions/README.md) | 49 | 已完成 |
| 17.3 | [检查实际加载了哪些规则](/content/chapter-17-project-instructions/03-inspect-loading/README.md) | 49 | 已完成 |

## 第 18 章小节进度

本章从 17.3 的完整快照继续，依次实现显式保存、模型候选审批和旧记忆管理。每项任务读取固定记忆快照；来源记录、有效状态与会话历史分别管理。正文冷读、连续跟写、练习、核心与真实终端检查通过，见验证记录。本章等待用户确认。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 18.1 | [显式保存项目记忆](/content/chapter-18-long-term-memory/01-save-memory/README.md) | 51 | 待确认 |
| 18.2 | [让模型提出记忆候选](/content/chapter-18-long-term-memory/02-propose-memory/README.md) | 52 | 待确认 |
| 18.3 | [检查与纠正记忆](/content/chapter-18-long-term-memory/03-manage-memory/README.md) | 52 | 待确认 |

## 第 19 章小节进度

本章完整继承 18.3，依次提供技能目录、用户手动加载和模型按需读取工具。元信息、正文与资源逐步取得，技能文字不能改变工具权限。正文冷读、连续跟写、练习、核心与真实终端检查通过，见验证记录。本章等待用户确认。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 19.1 | [发现技能目录](/content/chapter-19-skills/01-discover-skills/README.md) | 53 | 待确认 |
| 19.2 | [按需加载技能正文](/content/chapter-19-skills/02-load-on-demand/README.md) | 53 | 待确认 |
| 19.3 | [让模型选择技能与资源](/content/chapter-19-skills/03-model-skill-tools/README.md) | 54 | 待确认 |

## 第 20 章小节进度

本章从 19.3 继续，在原有权限检查之后加入执行前检查，把执行后的诊断随工具结果送回模型；任务收尾检查只向用户补充本地报告。脚本显式启用，取消与超时等待进程关闭；已经发生的副作用不会自动撤销。检查证据见验证记录。本章已于 2026-10-15 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 20.1 | [在工具启动前检查项目规则](/content/chapter-20-hooks/01-before-tool/README.md) | 55 | 已完成 |
| 20.2 | [在工具完成后补充检查结果](/content/chapter-20-hooks/02-after-tool/README.md) | 55 | 已完成 |
| 20.3 | [在任务收尾时运行检查](/content/chapter-20-hooks/03-stop-hooks/README.md) | 55 | 已完成 |

## 第 21 章小节进度

本章从 20.3 继续，先接入本地 stdio，再连接 Streamable HTTP 服务，最后管理工具定义快照、连接状态和关闭。远端工具仍逐次经过本地审批，连接成功不等于调用获准。 检查证据见验证记录。本章已于 2026-10-15 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 21.1 | [连接本地服务并发现工具](/content/chapter-21-mcp/01-stdio-tools/README.md) | 56 | 已完成 |
| 21.2 | [连接远端 HTTP 服务](/content/chapter-21-mcp/02-streamable-http/README.md) | 56 | 已完成 |
| 21.3 | [管理连接、取消与定义变化](/content/chapter-21-mcp/03-connection-lifecycle/README.md) | 56 | 已完成 |

## 第 22 章小节进度

本章从 21.3 继续，先有界读取明确 URL，再取得搜索候选，最后登记资料编号并让模型据此引用。网页内容、来源记录与本地权限分别管理；读取失败同样保留明确结果。 检查证据见验证记录。本章已于 2026-10-15 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 22.1 | [读取网页并保留来源](/content/chapter-22-web/01-fetch-page/README.md) | 57 | 已完成 |
| 22.2 | [先搜索，再读取原文](/content/chapter-22-web/02-search-sources/README.md) | 57 | 已完成 |
| 22.3 | [让回答带上可核对的依据](/content/chapter-22-web/03-grounded-answers/README.md) | 57 | 已完成 |

## 第 23 章小节进度

本章从 22.3 继续，讲解协议契约、完整配置切换与未知用量。正文先经独立审读，再补齐三套动图、流程图、封面和完整分镜；独立 TypeScript 快照、公开连续跟写与工程验证已通过。检查证据见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 23.1 | [统一两种协议的消息契约](/content/chapter-23-model-adapters/01-adapter-contract/README.md) | 58 | 已完成 |
| 23.2 | [空闲时切换完整模型配置](/content/chapter-23-model-adapters/02-model-switching/README.md) | 58 | 已完成 |
| 23.3 | [明确能力、错误与未知用量](/content/chapter-23-model-adapters/03-capabilities-errors/README.md) | 59 | 已完成 |

## 第 24 章小节进度

本章从 23.3 继续，讲解附件引用、实际请求内容与恢复后的显式重新附加。正文先经独立审读，再补齐三套动图、流程图、封面和完整分镜；独立 TypeScript 快照、公开连续跟写与工程验证已通过。检查证据见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 24.1 | [把文本附件关联到消息](/content/chapter-24-attachments/01-attachment-references/README.md) | 60 | 已完成 |
| 24.2 | [把图片字节转换成模型输入](/content/chapter-24-attachments/02-image-protocol/README.md) | 61 | 已完成 |
| 24.3 | [恢复引用并显式重新附加](/content/chapter-24-attachments/03-attachment-resume/README.md) | 61 | 已完成 |

## 第 25 章小节进度

本章从 24.3 继续，讲解独立子会话、只读执行边界与取消后的保存收尾。正文先经独立审读，再补齐三套动图、流程图、封面和完整分镜；独立 TypeScript 快照、公开连续跟写与工程验证已通过。检查证据见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 25.1 | [创建子会话并回传结果](/content/chapter-25-subagents/01-child-sessions/README.md) | 63 | 已完成 |
| 25.2 | [限制只读动作并保留证据](/content/chapter-25-subagents/02-readonly-roles/README.md) | 63 | 已完成 |
| 25.3 | [观察子任务并等待取消收尾](/content/chapter-25-subagents/03-child-observation/README.md) | 63 | 已完成 |

## 第 26 章小节进度

从 25.3 继续，先保存自有进程与日志，再交接真实终端输入，最后以输出证据和实际进程关闭区分启动、就绪与结束。正文先经独立冷读，公开代码连续重建、练习与真实终端检查通过，再补齐三套配图。见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 26.1 | [后台作业](/content/chapter-26-interactive-jobs/01-background-jobs/README.md) | 65 | 已完成 |
| 26.2 | [真实 PTY 与人工接管](/content/chapter-26-interactive-jobs/02-pty-takeover/README.md) | 67 | 已完成 |
| 26.3 | [作业生命周期](/content/chapter-26-interactive-jobs/03-job-lifecycle/README.md) | 67 | 已完成 |

## 第 27 章小节进度

从 26.3 继续，明确本地只读工具的并发范围，区分排队与执行期限，并按原调用编号收齐整批结果后再请求模型。正文先经独立冷读，公开连续重建、练习和运行检查通过，再补齐三套配图。见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 27.1 | [有界只读并发](/content/chapter-27-tool-concurrency/01-bounded-reads/README.md) | 68 | 已完成 |
| 27.2 | [超时与清理](/content/chapter-27-tool-concurrency/02-cancel-and-cleanup/README.md) | 68 | 已完成 |
| 27.3 | [结果屏障](/content/chapter-27-tool-concurrency/03-batch-results/README.md) | 68 | 已完成 |

## 第 28 章小节进度

从 27.3 继续，把修改留在独立 Git 工作区，将评审绑定到确定版本，再检查实际合并结果与删除条件。正文先经独立冷读，公开连续重建、练习与真实 Git 检查通过，再补齐三套配图。见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 28.1 | [独立工作区](/content/chapter-28-isolated-workspaces/01-worktree-base/README.md) | 70 | 已完成 |
| 28.2 | [评审固定版本](/content/chapter-28-isolated-workspaces/02-versioned-review/README.md) | 70 | 已完成 |
| 28.3 | [整合与清理](/content/chapter-28-isolated-workspaces/03-integrate-and-cleanup/README.md) | 70 | 已完成 |

## 第 29 章小节进度

从 28.3 继续，以进程内协调者管理认领、租约、依赖与收件箱。worker 仍为独立只读子会话；回收等待实际清理，读消息与确认都不代替任务完成。正文先经独立冷读，再补齐三套动图、流程图和分镜；公开连续跟写、练习、运行及网页检查通过，见验证记录。本章已于 2026-10-16 按用户通知标记为已完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 29.1 | [认领与租约](/content/chapter-29-shared-tasks/01-claim-and-lease/README.md) | 73 | 已完成 |
| 29.2 | [依赖与失联回收](/content/chapter-29-shared-tasks/02-dependencies-reclaim/README.md) | 73 | 已完成 |
| 29.3 | [消息与确认](/content/chapter-29-shared-tasks/03-agent-messages/README.md) | 73 | 已完成 |

## 第 30 章小节进度

从 29.3 继续，先保存调度规则，再由持有独占锁的本地服务预留预算并启动真实只读任务。暂停、停止、崩溃恢复分别说明；达到期限不会省略实际收尾。正文先经独立冷读，再补齐三套动图、流程图和分镜；公开连续跟写、练习、运行及网页检查通过，见验证记录。本章已于 2026-10-16 按用户通知标记为已完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 30.1 | [持久任务定义](/content/chapter-30-scheduled-tasks/01-persistent-schedules/README.md) | 75 | 已完成 |
| 30.2 | [到期与真实执行](/content/chapter-30-scheduled-tasks/02-runtime-dispatch/README.md) | 76 | 已完成 |
| 30.3 | [停止与恢复](/content/chapter-30-scheduled-tasks/03-stop-and-recover/README.md) | 76 | 已完成 |

## 第 31 章小节进度

从 30.3 继续，先校验和复制本地包，再在空闲边界显式接入已有 Skills、Hooks 与 MCP。停用先撤入口，按 owner 等待连接结束；清理失败时保留文件与诊断记录。正文先经独立冷读，再补齐三套动图、流程图和分镜；公开连续跟写、练习、运行及网页检查通过，见验证记录。本章已于 2026-10-16 按用户通知标记为已完成。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 31.1 | [安装本地扩展包](/content/chapter-31-extension-packages/01-install-local-package/README.md) | 79 | 已完成 |
| 31.2 | [显式启用扩展能力](/content/chapter-31-extension-packages/02-enable-capabilities/README.md) | 79 | 已完成 |
| 31.3 | [停用、卸载与诊断](/content/chapter-31-extension-packages/03-disable-and-diagnose/README.md) | 79 | 已完成 |

## 第 32 章小节进度

从 31.3 继续，把项目检查作为真实工具结果交回模型，再连接固定 TypeScript 语言服务进行定义、引用和当前文件诊断。请求编号、UTF-16 坐标、版本与内容复核各自承担明确职责；服务异常先收尾再允许重启。正文先经独立冷读，再补齐三套动图、流程图和分镜；验证范围见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 32.1 | [把检查结果交回模型](/content/chapter-32-code-intelligence/01-project-checks/README.md) | 80 | 已完成 |
| 32.2 | [用语言服务定位符号](/content/chapter-32-code-intelligence/02-lsp-navigation/README.md) | 83 | 已完成 |
| 32.3 | [让诊断对应当前文件](/content/chapter-32-code-intelligence/03-current-diagnostics/README.md) | 83 | 已完成 |

## 第 33 章小节进度

从 32.3 继续，在实际 shell 启动入口接入现成操作系统沙箱，并连接前台命令、项目检查、pipe 与 PTY。用宿主对照、真实读写和网络实验验证限制，分别说明依赖就绪、隔离生效与其他工具通道的范围。正文先经独立冷读，再补齐三套动图、流程图和分镜；验证范围见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 33.1 | [让命令真正进入沙箱](/content/chapter-33-execution-sandbox/01-sandbox-runtime/README.md) | 85 | 已完成 |
| 33.2 | [连接后台执行](/content/chapter-33-execution-sandbox/02-connect-execution/README.md) | 85 | 已完成 |
| 33.3 | [诊断与边界实验](/content/chapter-33-execution-sandbox/03-diagnose-boundaries/README.md) | 86 | 已完成 |

## 第 34 章小节进度

从 33.3 继续，以白名单 JSONL 串起本轮阶段，只在明确条件下重发单次模型请求，再加入无进展取消与本地诊断。取消先发出请求，原任务实际收尾后才结束；工具、历史和已修改文件不因重试或取消自动重放或回滚。正文先经独立冷读，再补齐三套动图、流程图和分镜；验证范围见验证记录。本章已于 2026-10-16 按用户通知标记为已完成，三个小节一并更新。

| 小节 | 内容 | 正式源码数 | 状态 |
| --- | --- | --- | --- |
| 34.1 | [关联一次运行的日志](/content/chapter-34-reliability/01-correlated-logs/README.md) | 87 | 已完成 |
| 34.2 | [只重试可以安全重发的请求](/content/chapter-34-reliability/02-safe-retries/README.md) | 88 | 已完成 |
| 34.3 | [停止无进展任务并保留成果](/content/chapter-34-reliability/03-stop-and-diagnose/README.md) | 90 | 已完成 |

## 阶段总览

| 部分 | 章节 | 阶段成果 | 已完成 |
| --- | --- | --- | --- |
| 第一部分：先让 Agent 完成一次编码任务 | 01—08 | 普通终端中的读取、搜索、权限、修改、测试与取消。 | 8 / 8 |
| 第二部分：把 Agent 做成真正可用的 TUI | 09—12 | 可观察执行、审批操作、补充要求与打断任务的终端界面。 | 4 / 4 |
| 第三部分：管理会话、上下文与项目知识 | 13—18 | 查找和恢复任务，管理分支、检查点、上下文与记忆。 | 4 / 6 |
| 第四部分：扩展工具、知识与模型能力 | 19—24 | Skills、Hooks、MCP、资料查询、多模型与附件。 | 5 / 6 |
| 第五部分：子 Agent、交互进程与任务协作 | 25—30 | 可跟进、接管、取消和整合的子任务、命令进程与协作。 | 6 / 6 |
| 第六部分：把项目做成可以安装和长期使用的产品 | 31—36 | 扩展分发、诊断、隔离、故障恢复、评测与 npm 发布。 | 1 / 6 |

## 第一部分：先让 Agent 完成一次编码任务（01—08）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 01 | **[从空目录到自己的命令](/content/chapter-01-first-command/README.md)**：TypeScript 工程、命令入口、帮助与版本、npm bin、打包和本地安装。 | 离开源码目录后仍可运行；安装包不依赖源码或开发依赖。 | 已完成 | 2026-09-16 |
| 02 | **[接通模型并持续对话](/content/chapter-02-model-dialogue/README.md)**：OpenAI 兼容与 Anthropic 双接口、配置/模型/终端分离、Agent Loop 无工具路径、多轮消息、配置优先级、认证错误和基础用量。 | 第二轮能引用第一轮；缺少配置有明确提示；日志不泄露密钥。 | 已完成 | 2026-09-17 |
| 03 | **[第一个工具与 Agent Loop](/content/chapter-03-first-tool/README.md)**：在第 02 章 agent-loop.ts 上增加实际工具循环；read_file、工具参数校验、调用 ID、执行与结果回传、循环与轮次上限。 | 读取真实文件；`.env` 与越界路径被拒绝；文件不存在、参数错误和未知工具均有反馈；循环有界结束。 | 已完成 | 2026-09-20 |
| 04 | **[让 Agent 找到代码](/content/chapter-04-code-search/README.md)**：文件列表、路径匹配、内容搜索、分段读取、忽略规则和结果上限。 | 定位练习仓库中的目标逻辑；返回有界；引用真实文件位置。 | 已完成 | 2026-09-21 |
| 05 | **[工具执行之前，先检查权限](/content/chapter-05-permission-gate/README.md)**：allow/ask/deny、项目边界、受保护路径、终端审批、单次与会话范围授权。 | 拒绝后无副作用；授权范围明确；模型文本不能绕过执行入口。 | 已完成 | 2026-09-23 |
| 06 | **[让 Agent 先预览，再修改文件](/content/chapter-06-precise-edit/README.md)**：创建与编辑、明确匹配、重复匹配检查、外部修改检测、diff、备份。 | 预览与写入一致；文件变化后重新核对；保护用户原有修改。 | 已完成 | 2026-09-23 |
| 07 | **[执行测试并读取结果](/content/chapter-07-command-feedback/README.md)**：shell 子进程、cwd、stdout/stderr、退出码、输出上限、超时、EOF 和基础取消；把第四章的 Node.js 文件发现与 JavaScript 正则搜索迁移到可超时、可取消的受控 `rg` 后端。 | 测试失败可进入下一轮修复；卡住的命令或搜索可停止；病态正则不能无限占用主进程；区分命令成功与任务完成。 | 已完成 | 2026-09-23 |
| 08 | **[流式输出与任务中断](/content/chapter-08-streaming-turns/README.md)**：文本增量、工具参数分片组装、取消传播、断流处理、不同结束原因。 | 参数完整后才执行；中断后可继续输入；断流不盲目重做已执行操作。 | 已完成 | 2026-09-24 |

## 第二部分：把 Agent 做成真正可用的 TUI（09—12）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 09 | **[让执行过程可以被界面观察](/content/chapter-09-observable-runs/README.md)**：文本/工具/审批/状态/结束事件、执行与显示分离、JSONL、stdout/stderr 和退出状态。 | 日志与程序消费者观察同一过程；JSON 不混入提示；核心不依赖 React。 | 已完成 | 2026-09-24 |
| 10 | **[第一个真正可用的 TUI](/content/chapter-10-terminal-ui/README.md)**：React 与 Ink、消息区、输入区、工具状态、审批、状态栏、组件清理和 TTY 检测。 | TUI 完成同样的读改测；无终端时按约定运行；退出后终端可用。 | 已完成 | 2026-09-24 |
| 11 | **[把终端变成可以编辑和浏览的工作区](/content/chapter-11-terminal-workbench/README.md)**：多行粘贴、撤销、历史搜索、文件与命令补全、外部编辑器、焦点、滚动、折叠、复制、中文宽度、resize 和无颜色显示。 | 审批不误提交草稿；历史滚动不被新输出打断；长日志下仍可输入；中文、emoji 和窄窗口可读。 | 已完成 | 2026-10-09 |
| 12 | **[计划、执行与运行中干预](/content/chapter-12-task-control/README.md)**：Plan/执行模式、任务清单、澄清问题、立即打断与排队、队列编辑和撤回、生效边界。 | Plan 禁止写入；补充要求不丢失或重复；取消、清空输入和退出含义明确。 | 已完成 | 2026-10-14 |

第 11 章按“多行草稿、历史与补全、结果浏览、外部编辑器、终端尺寸适配”五节展开。小节数量按学习问题确定，当前仍为 36 章。

## 第三部分：管理会话、上下文与项目知识（13—18）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 13 | **[保存、查找与恢复会话](/content/chapter-13-session-persistence/README.md)**：会话 ID、JSONL、格式版本、锁、中断标记、列表、命名、搜索、恢复、导出与工作区信息。 | 崩溃后读取有效记录；识别目录/工作区变化；恢复不重复执行工具。 | 待确认 | — |
| 14 | **[会话分支与文件检查点](/content/chapter-14-session-checkpoints/README.md)**：会话分支、文件检查点、TUI 改动查看与恢复范围、对话恢复和文件恢复的区别。 | 分支不改变原会话；外部修改导致的恢复冲突可见；说明不可撤销的副作用。 | 已完成 | 2026-10-15 |
| 15 | **[计算与控制上下文预算](/content/chapter-15-context-budget/README.md)**：上下文窗口、Token 估计与实际用量、输出预留、大结果裁剪、完整日志引用和预算显示。 | 大日志不挤满上下文；原始结果可定位；区分估算、实际用量和费用估计。 | 已完成 | 2026-10-15 |
| 16 | **[自动压缩并继续任务](/content/chapter-16-context-compaction/README.md)**：历史摘要、近期消息、任务与约束保留、工具消息配对、失败回退、取消与压缩状态。 | 压缩后继续原任务；关键约束保留；失败保留原记录且界面可操作。 | 已完成 | 2026-10-15 |
| 17 | **[加载项目说明与规则](/content/chapter-17-project-instructions/README.md)**：项目根、目录范围、来源顺序、加载预算、固定快照与工具权限。 | 子目录启动仍加载适用规则；来源可查；项目文字不能扩大权限或自行启用脚本。 | 已完成 | 2026-10-15 |
| 18 | **[保存可检查的长期记忆](/content/chapter-18-long-term-memory/README.md)**：显式保存、模型提出建议、来源与范围、查看、编辑、删除和失效。 | 新会话能用有效知识；过期内容可纠正；重要写入可见、受控、可追溯。 | 待确认 | — |

## 第四部分：扩展工具、知识与模型能力（19—24）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 19 | **[按需加载 Skills](/content/chapter-19-skills/README.md)**：技能发现、元信息、正文和资源按需加载、手动调用、TUI 展示来源。 | 不在启动时灌入全部正文；按任务加载；技能文字不自动获得额外权限。 | 待确认 | — |
| 20 | **[用 Hooks 扩展生命周期](/content/chapter-20-hooks/README.md)**：执行前后与结束钩子、输入输出、阻止、超时、错误和项目脚本显式启用。 | 检查结果进入反馈；失败可诊断；超时不挂死主循环。 | 已完成 | 2026-10-15 |
| 21 | **[接入并管理 MCP 工具](/content/chapter-21-mcp/README.md)**：MCP SDK、本地 stdio/远端 HTTP、命名、认证、发现、断线、关闭、工具定义按需加载和连接状态。 | 调用经过统一权限入口；同名工具不混淆；处理定义变化；认证错误明确。 | 已完成 | 2026-10-15 |
| 22 | **[查询和引用外部资料](/content/chapter-22-web/README.md)**：Web Fetch、搜索接口或 MCP、来源信息、大小/时间/重定向限制和不可信网页指令。 | 根据真实资料修正代码并引用；失败可诊断；网页不能改变执行权限。 | 已完成 | 2026-10-15 |
| 23 | **[让模型切换遵守同一套执行规则](/content/chapter-23-model-adapters/README.md)**：在第二章双接口基础上，统一工具/流事件/附件转换、能力描述、错误分类、运行中切换、凭据归属和缓存用量。 | 两种协议完成同一工具任务；能力不支持时明确提示；凭据不误用；未知用量如实显示。 | 已完成 | 2026-10-16 |
| 24 | **[让附件以可核对的身份进入上下文](/content/chapter-24-attachments/README.md)**：附件引用、格式/大小/路径检查、模型能力判断、请求转换和会话关联。 | 支持时可分析截图；不支持时保留输入并提示；恢复时识别丢失附件。 | 已完成 | 2026-10-16 |

## 第五部分：子 Agent、交互进程与任务协作（25—30）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 25 | **[把局部任务交给独立的只读 Agent](/content/chapter-25-subagents/README.md)**：独立子会话、父子关系、角色与工具限制、结果回传、探索与只读评审、文件位置和问题证据。 | 主 Agent 核验成果；只读评审不写文件；工具不越权；TUI 展示子任务状态。 | 已完成 | 2026-10-16 |
| 26 | **[交互命令、人工接管与后台任务](/content/chapter-26-interactive-jobs/README.md)**：Job ID、状态/日志/通知、管道与 PTY、stdin/EOF/resize、人工接管、前后台切换、服务就绪和进程清理。 | 可接管等待输入的命令；后台不阻塞 TUI；日志可查、任务可停；保留用户原有服务。 | 已完成 | 2026-10-16 |
| 27 | **[工具并发、受控并行与任务生命周期](/content/chapter-27-tool-concurrency/README.md)**：判断工具依赖与副作用；只读工具受控并发；写入工具串行或隔离执行；队列、信号量、接口限流、并发与资源上限、结果配对、超时、嵌套深度、父子取消、失败汇总、重试边界和完整任务状态。 | 并发完成顺序不同仍按调用 ID 正确配对；单项失败不掩盖其他结果；写入工具不会竞争同一资源；并发数受限；取消传播；重试不重复副作用；预算耗尽保留成果与状态。 | 已完成 | 2026-10-16 |
| 28 | **[并行修改的工作区隔离与审查](/content/chapter-28-isolated-workspaces/README.md)**：Git worktree、起点与未提交改动、任务 diff、工作区/提交/基准分支审查、整合与冲突。 | 任务独立修改；整合保护用户改动；冲突可见；评审与实际版本对应。 | 已完成 | 2026-10-16 |
| 29 | **[共享任务与 Agent 间消息](/content/chapter-29-shared-tasks/README.md)**：协调者任务表、认领、租约、依赖与回收、收件箱、关联与去重、归属与阻塞状态。 | 不重复认领或执行；失联可回收；收到消息不等于任务完成。 | 已完成 | 2026-10-16 |
| 30 | **[定时与持续任务](/content/chapter-30-scheduled-tasks/README.md)**：本地运行时调度、任务定义持久化、重启与错过触发、防重叠、停止条件、开销和记录。 | 按约定触发并可暂停/停止；说明程序关闭后的行为；不会无限消耗。 | 已完成 | 2026-10-16 |

## 第六部分：把项目做成可以安装和长期使用的产品（31—36）

| 章 | 章节与主要内容 | 验收项 | 状态 | 完成日期 |
| --- | --- | --- | --- | --- |
| 31 | **[把扩展打成可安装的包](/content/chapter-31-extension-packages/README.md)**：manifest、命名空间、版本与兼容、Skills/Hooks/MCP 组合、安装、启停、卸载与诊断。 | 示例扩展可用；冲突和缺依赖可诊断；卸载释放资源。 | 已完成 | 2026-10-16 |
| 32 | **[接入代码诊断与语言服务](/content/chapter-32-code-intelligence/README.md)**：测试/类型检查、LSP 客户端、定义/引用/诊断、文件变化、超时与重启。 | 诊断对应当前文件；服务失败仍可搜索检查；错误不无声阻塞任务。 | 已完成 | 2026-10-16 |
| 33 | **[接入真实执行隔离](/content/chapter-33-execution-sandbox/README.md)**：现成沙箱运行时、文件与网络边界、权限/工作区/进程连接、隔离状态与依赖诊断。 | 实际越界实验验证限制；不可用时明确失败；不同工具通道的边界清楚。 | 已完成 | 2026-10-16 |
| 34 | **[让故障可定位、可恢复](/content/chapter-34-reliability/README.md)**：结构化日志、关联 ID、耗时/用量、重试分类与退避、取消、无进展检测、配置诊断和简洁输出。 | 限流/断线/大输出可定位；重试不重复副作用；日志不泄密；失败保留成果。 | 已完成 | 2026-10-16 |
| 35 | **用固定任务验证 Agent 能力**：离线回放、临时仓库、故障注入、TUI 输入/焦点/resize/退出/PTY 测试、真实模型评测、平台与性能记录。 | 任务可重复验证；记录成功、失败、误改与成本；实际验证终端行为。 | 未开始 | — |
| 36 | **安装、发布与升级**：发布白名单、tarball 安装、帮助/诊断/shell 补全、发布 CI、npm 版本、配置/会话迁移和课程标签。 | 干净安装完成读改测；升级可读旧数据；章节可复现；安装包不夹带敏感或开发产物。 | 未开始 | — |

## 每章交付内容

各章按 编写规范持续完善以下内容；本节列出统一要求，不单独计入章节完成数。

1. 本章目标、上一章起点与效果演示。
2. 必要概念，以及输入、状态、工具与输出的执行流程。
3. 小步实现说明：涉及文件、修改原因、运行方法和预期结果。
4. 本章完整可运行代码，包含流程、参数、状态变化与失败处理的中文教学注释；正文与源码同步。
5. 失败实验与验收证据。
6. 练习、完整参考答案、运行步骤与易错点。
7. 下一章的正式代码起点与版本关系。

每章独立保存当时的完整实现，下一章从前章正式代码继续；章节之间不导入彼此实现。根目录统一依赖、构建和测试，目录沿用 chapter-编号-主题，源码按职责命名。

## 已有成果与配套工作

以下记录编写和工程事实，与“你已确认完成的章节”分开统计。

| 内容 | 当前状态 | 入口或说明 |
| --- | --- | --- |
| 第一章正文 | 已确认完成 | [教学正文](/content/chapter-01-first-command/README.md) |
| 第一章完整实现 | 已有代码 | [命令入口](/content/chapter-01-first-command/cli.ts.md) |
| 第一章练习与答案 | 已有完整答案 | [练习说明](/content/chapter-01-first-command/EXERCISES.md)、[诊断练习代码](/content/chapter-01-first-command/cli-with-doctor.ts.md) |
| 第一章教学注释与正文代码同步 | 已补齐 | 后续章节沿同一规范编写 |
| 第一章安装与运行验证 | 已有记录，平台为 macOS arm64 | 验证记录；其他平台待验证 |
| 第二章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-02-model-dialogue/README.md)、[Agent 核心](/content/chapter-02-model-dialogue/03-agent-loop/src/agent/agent-loop.ts.md)、[命令入口](/content/chapter-02-model-dialogue/01-configuration/src/cli.ts.md)、[练习](/content/chapter-02-model-dialogue/EXERCISES.md) |
| 第二章双接口验证 | 本地 HTTP 模拟与安装验收通过；真实模型待配置后验证 | 验证记录 |
| 第三章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-03-first-tool/README.md)、[完成版核心](/content/chapter-03-first-tool/03-error-boundary/src/agent/agent-loop.ts.md)、[练习](/content/chapter-03-first-tool/EXERCISES.md) |
| 第三章工具循环验证 | 临时文件、内存模型和本地双协议接口通过；真实模型待配置后验证 | 验证记录 |
| 第四章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-04-code-search/README.md)、[完成版工具](/content/chapter-04-code-search/03-chunked-reading/src/tools/_index.md)、[练习](/content/chapter-04-code-search/EXERCISES.md) |
| 第四章代码搜索验证 | 临时项目、忽略规则、结果上限与完整工具链检查通过；真实模型待配置后验证 | 验证记录 |
| 第五章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-05-permission-gate/README.md)、[完成版权限策略](/content/chapter-05-permission-gate/03-session-grants/src/permissions/policy.ts.md)、[练习](/content/chapter-05-permission-gate/EXERCISES.md) |
| 第五章权限链验证 | 临时项目、内存模型、审批事件和会话范围检查通过；真实模型待配置后验证 | 验证记录 |
| 第六章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-06-precise-edit/README.md)、[完成版编辑工具](/content/chapter-06-precise-edit/03-change-guard/src/tools/edit-file.ts.md)、[练习](/content/chapter-06-precise-edit/EXERCISES.md) |
| 第六章精确修改验证 | 临时项目、差异预览、唯一匹配、变化检测与备份检查通过；真实模型待配置后验证 | 验证记录 |
| 第七章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-07-command-feedback/README.md)、[命令与进程实现](/content/chapter-07-command-feedback/03-ripgrep-search/src/_index.md)、[练习](/content/chapter-07-command-feedback/EXERCISES.md) |
| 第七章命令与搜索验证 | 实际子进程、临时项目与内存模型验收通过；真实模型尚未实测 | 验证记录 |
| 第八章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-08-streaming-turns/README.md)、[完成版源码](/content/chapter-08-streaming-turns/03-cancel-and-continue/src/_index.md)、[练习](/content/chapter-08-streaming-turns/EXERCISES.md) |
| 第八章流式与中断验证 | 本地双协议 SSE、工具完整性、中断历史、续聊与真实 PTY 检查通过；未调用真实模型 | 验证记录 |
| 第九章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-09-observable-runs/README.md)、[完成版源码](/content/chapter-09-observable-runs/03-jsonl-output/src/_index.md)、[练习](/content/chapter-09-observable-runs/EXERCISES.md) |
| 第九章事件与输出验证 | 本地双协议 SSE、真实读取、事件顺序、取消清理、输出管道与安装检查通过；未调用真实模型 | 验证记录 |
| 第十章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-10-terminal-ui/README.md)、[完成版源码](/content/chapter-10-terminal-ui/04-cancel-and-restore/src/_index.md)、[练习](/content/chapter-10-terminal-ui/EXERCISES.md) |
| 第十章 TUI 验证与审读 | 显示状态、真实终端审批、取消续聊、输出选择、安装与独立读者审读通过；未调用真实模型 | 验证记录 |
| 第十一章正文、代码与练习 | 已确认完成 | [正文](/content/chapter-11-terminal-workbench/README.md)、[完成版源码](/content/chapter-11-terminal-workbench/05-terminal-layout/src/_index.md)、[练习](/content/chapter-11-terminal-workbench/EXERCISES.md) |
| 第十二章正文、代码、动图与练习 | 已确认完成 | [正文](/content/chapter-12-task-control/README.md)、[完成版源码](/content/chapter-12-task-control/05-manage-queue/src/_index.md)、[练习](/content/chapter-12-task-control/EXERCISES.md) |
| 第十二章任务控制验证与审读 | 核心、终端、双协议、安装和练习检查通过；未调用真实模型 | 验证记录 |
| 第十三章正文、代码、配图与练习 | 四节完整快照与练习已整理，原理和新增配图通过独立冷读；待用户确认 | [章节首页](/content/chapter-13-session-persistence/README.md)、[读取](/content/chapter-13-session-persistence/02-read-records/README.md)、[恢复](/content/chapter-13-session-persistence/03-resume-session/README.md)、[管理](/content/chapter-13-session-persistence/04-manage-sessions/README.md)、[练习](/content/chapter-13-session-persistence/EXERCISES.md) |
| 第十三章工程验证 | 类型、教程标记、保存顺序、85 项记录与锁检查、恢复和管理 CLI、真实 PTY 及临时安装检查通过；未调用真实模型 | 验证记录 |
| 第十四章正文、代码、配图与练习 | 三个独立快照、练习与三套动图／完整分镜已整理，正文通过独立冷读；已确认完成 | [章节首页](/content/chapter-14-session-checkpoints/README.md)、[练习](/content/chapter-14-session-checkpoints/EXERCISES.md)、验证记录 |
| 第十五章正文、代码、配图与练习 | 三个独立快照、练习与三套动图／完整分镜已整理，正文通过独立冷读；已确认完成 | [章节首页](/content/chapter-15-context-budget/README.md)、[练习](/content/chapter-15-context-budget/EXERCISES.md)、验证记录 |
| 第十六章正文、代码、配图与练习 | 三节正文、独立 TypeScript 快照、三套动图与练习已整理；已确认完成 | [章节首页](/content/chapter-16-context-compaction/README.md)、[练习](/content/chapter-16-context-compaction/EXERCISES.md)、验证记录 |
| 第十七章正文、代码、配图与练习 | 三节正文、独立 TypeScript 快照、三套动图与练习已整理；已确认完成 | [章节首页](/content/chapter-17-project-instructions/README.md)、[练习](/content/chapter-17-project-instructions/EXERCISES.md)、验证记录 |
| 第十八章正文、代码、练习与配图 | 三节正文、独立 TypeScript 快照与练习，以及三套动图、流程图和完整分镜已整理；正文冷读、连续跟写、工程与终端检查通过，待用户确认 | [章节首页](/content/chapter-18-long-term-memory/README.md)、[练习](/content/chapter-18-long-term-memory/EXERCISES.md)、验证记录 |
| 第十九章正文、代码、练习与配图 | 三节正文、独立 TypeScript 快照与练习，以及三套动图、流程图和完整分镜已整理；正文冷读、连续跟写、工程与终端检查通过，待用户确认 | [章节首页](/content/chapter-19-skills/README.md)、[练习](/content/chapter-19-skills/EXERCISES.md)、验证记录 |
| 第二十章正文、代码、练习与配图 | 三节正文、独立 TypeScript 快照、练习与配图已整理；2026-10-15 按用户通知确认完成 | [章节首页](/content/chapter-20-hooks/README.md)、[练习](/content/chapter-20-hooks/EXERCISES.md)、验证记录 |
| 第二十一章正文、代码、练习与配图 | 三节正文、独立 TypeScript 快照、练习与配图已整理；2026-10-15 按用户通知确认完成 | [章节首页](/content/chapter-21-mcp/README.md)、[练习](/content/chapter-21-mcp/EXERCISES.md)、验证记录 |
| 第二十二章正文、代码、练习与配图 | 三节正文、独立 TypeScript 快照、练习与配图已整理；2026-10-15 按用户通知确认完成 | [章节首页](/content/chapter-22-web/README.md)、[练习](/content/chapter-22-web/EXERCISES.md)、验证记录 |
| 第二十三章正文、代码、练习与配图 | 三节正文先经独立审读，再补齐三套配图；独立 TypeScript 快照、连续跟写、全仓与终端检查通过，2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-23-model-adapters/README.md)、[练习](/content/chapter-23-model-adapters/EXERCISES.md)、验证记录 |
| 第二十四章正文、代码、练习与配图 | 三节正文先经独立审读，再补齐三套配图；独立 TypeScript 快照、连续跟写、全仓与终端检查通过，2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-24-attachments/README.md)、[练习](/content/chapter-24-attachments/EXERCISES.md)、验证记录 |
| 第二十五章正文、代码、练习与配图 | 三节正文先经独立审读，再补齐三套配图；独立 TypeScript 快照、连续跟写、全仓与终端检查通过，2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-25-subagents/README.md)、[练习](/content/chapter-25-subagents/EXERCISES.md)、验证记录 |
| 第二十六章正文、代码、练习与配图 | 三节正文先经独立冷读，完整 TypeScript 快照、公开连续跟写、练习与全仓回归通过，三套配图已补齐；2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-26-interactive-jobs/README.md)、[练习](/content/chapter-26-interactive-jobs/EXERCISES.md)、验证记录 |
| 第二十七章正文、代码、练习与配图 | 三节正文先经独立冷读，完整 TypeScript 快照、公开连续跟写、练习与全仓回归通过，三套配图已补齐；2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-27-tool-concurrency/README.md)、[练习](/content/chapter-27-tool-concurrency/EXERCISES.md)、验证记录 |
| 第二十八章正文、代码、练习与配图 | 三节正文先经独立冷读，完整 TypeScript 快照、公开连续跟写、练习与全仓回归通过，三套配图已补齐；2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-28-isolated-workspaces/README.md)、[练习](/content/chapter-28-isolated-workspaces/EXERCISES.md)、验证记录 |
| 第二十九章正文、代码、练习与配图 | 三节正文先经独立冷读，再补齐三套配图；完整 TypeScript 快照、练习、公开连续跟写、运行与网页检查通过，已于 2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-29-shared-tasks/README.md)、[练习](/content/chapter-29-shared-tasks/EXERCISES.md)、验证记录 |
| 第三十章正文、代码、练习与配图 | 三节正文先经独立冷读，再补齐三套配图；完整 TypeScript 快照、练习、公开连续跟写、运行与网页检查通过，已于 2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-30-scheduled-tasks/README.md)、[练习](/content/chapter-30-scheduled-tasks/EXERCISES.md)、验证记录 |
| 第三十一章正文、代码、练习与配图 | 三节正文先经独立冷读，再补齐三套配图；示例先编译再安装，完整 TypeScript 快照、练习、公开连续跟写、运行与网页检查通过，已于 2026-10-16 按用户通知确认完成 | [章节首页](/content/chapter-31-extension-packages/README.md)、[练习](/content/chapter-31-extension-packages/EXERCISES.md)、验证记录 |
| 根目录依赖、构建与测试 | 已建立 | [包配置](/content/package.json.md)、[安装验收脚本](/content/tests/verify-install.mjs.md) |
| 原规划与验收场景 | 已保留 | 规划索引、[21 个验收场景](/content/docs/planning/CAPABILITIES.md) |
| CLI + TUI 能力复核 | 已整理并纳入本表的章节内容 | [复核文档](/content/docs/CODING-AGENT-GAP-REVIEW.md)；相关能力仍待实现 |
| 第三十二章正文、代码、练习与配图 | 已按先正文后配图整理；完整快照、跟写与运行检查的实际范围见验证记录，已按用户通知标记完成 | [章节首页](/content/chapter-32-code-intelligence/README.md)、[练习](/content/chapter-32-code-intelligence/EXERCISES.md)、验证记录 |
| 第三十三章正文、代码、练习与配图 | 已按先正文后配图整理；完整快照、跟写与运行检查的实际范围见验证记录，已按用户通知标记完成 | [章节首页](/content/chapter-33-execution-sandbox/README.md)、[练习](/content/chapter-33-execution-sandbox/EXERCISES.md)、验证记录 |
| 第三十四章正文、代码、练习与配图 | 已按先正文后配图整理；完整快照、跟写与运行检查的实际范围见验证记录，已按用户通知标记完成 | [章节首页](/content/chapter-34-reliability/README.md)、[练习](/content/chapter-34-reliability/EXERCISES.md)、验证记录 |
| GitHub 分支职责 | `master` 保留源码、原生 Markdown 和配图；`codex/teaching-site` 维护完整教学网站；`gh-pages` 发布生成站点 | [源码分支](https://github.com/sherlockmen/hello-my-agent/tree/master)、[网站分支](https://github.com/sherlockmen/hello-my-agent/tree/codex/teaching-site) |
| 章节标签、npm 发布 | 尚未执行 | 随交付阶段更新 |

默认构建入口为第三十四章 34.3 停止无进展任务并保留成果 `chapter-34-reliability/03-stop-and-diagnose/src/cli.ts`，安装入口仍为 `dist/cli.js`。每个小节通过自己的 `npm run lesson:章节.小节` 命令选择、编译并注册，不自动调用模型，也不再手动修改构建配置。第一章目录独立保留。本地包暂用 `@sherlockmen/hello-my-agent` 并保留 `private: true`；公开发布时核对包名与最终构建入口。两种协议的流式模型响应和工具消息，`glob`、`grep`、分段 `read_file`、执行前权限策略、终端审批、会话范围、差异预览、创建和精确编辑、受控命令执行、rg 搜索、任务中断与继续对话、整轮状态事件、异步事件交付、JSONL 输出和 React / Ink TUI 已经实现，真实模型调用尚未实测；多行编辑、历史搜索与补全、结果浏览、外部编辑器、Unicode 列宽与 resize 已进入第十一章，后续能力按章节继续实现。

2026-09-16：按你的明确要求，将 OpenAI 兼容与 Anthropic 两种接口一并放入第二章；第 23 章调整为在此基础上完善协议适配与运行中模型切换，章数保持 36。

## 配套附录与可选扩展

这些内容不计入 36 章完成数，编写状态单独记录。

| 内容 | 状态 |
| --- | --- |
| 环境准备与从空目录跟写 | [已有说明](/content/docs/SETUP.md)，随章节维护 |
| TypeScript 必要语法 | 待整理，随首次使用讲解 |
| 命令、快捷键、配置项与状态说明 | 待随实现汇总 |
| 常见故障与终端恢复 | 待随失败实验汇总 |
| 平台兼容与已验证范围 | 第一章已有 macOS arm64 记录，后续持续补充 |
| 浏览器工具、PR/CI 工作流、主题与键位定制 | 可选扩展示例，尚未编写 |

## 章节完成记录

按你的明确通知记录章节完成，不自动将新章节标记为已完成。

| 完成日期 | 章节 | 确认依据 | 备注或已有证据 |
| --- | --- | --- | --- |
| 2026-09-16 | 第 01 章：从空目录到自己的命令 | 你明确要求“第一节标记已完成” | 已有正文、完整代码、练习及安装验证记录 |
| 2026-09-17 | 第 02 章：接通模型并持续对话 | 你明确要求“第二章标记一下已完成” | 六个递进小节、完整代码、练习及安装验证均已具备 |
| 2026-09-20 | 第 03 章：第一个工具与 Agent Loop | 你明确要求“第三章标记已完成” | 三个递进小节、完整代码、练习及工具循环验证均已具备 |
| 2026-09-21 | 第 04 章：让 Agent 找到代码 | 你明确要求“将第四章标记为已完成” | 三个递进小节、完整代码、练习、代码搜索验证及读者审阅均已具备 |
| 2026-09-23 | 第 06 章：让 Agent 先预览，再修改文件 | 用户明确要求“将第六章标记已完成” | 三个递进小节、完整代码、练习与审读已具备 |
| 2026-09-23 | 第 05 章：工具执行之前，先检查权限 | 用户明确要求“将第五章 第七章标记为已完成” | 三个递进小节、完整代码、练习及权限链验证记录已具备 |
| 2026-09-23 | 第 07 章：执行测试并读取结果 | 用户明确要求“将第五章 第七章标记为已完成” | 三个递进小节、完整代码、练习、本地验证与独立读者审阅已具备 |
| 2026-09-24 | 第 08 章：流式输出与任务中断 | 用户明确要求“将第八章标记为已完成 然后开始第九章” | 三个递进小节、完整代码、练习与本地验证记录已具备 |
| 2026-09-24 | 第 09 章：让执行过程可以被界面观察 | 用户明确要求“将第九章标记为已完成 开始第十章” | 三个小节、完整代码、练习、验证与独立读者审阅已具备 |
| 2026-09-24 | 第 10 章：第一个真正可用的 TUI | 用户明确要求“第十章标记已完成 开始第十一章” | 四个小节、完整代码、练习、验证与独立读者审阅已具备 |
| 2026-10-09 | 第 11 章：把终端变成可以编辑和浏览的工作区 | 用户明确要求“将第11章标记为已完成 并开始下一章” | 五个递进小节、手绘动图、完整代码与练习已具备 |
| 2026-10-14 | 第 12 章：计划、执行与运行中干预 | 用户明确要求“将第十二章标记为已完成 开始第十三章” | 五节正文、TypeScript 快照、动图、练习与验证记录已具备 |
| 2026-10-15 | 第 14 章：会话分支与文件检查点 | 用户要求“将这些章节标记为已完成”，承接第 14、15 章交付 | 三节正文、独立快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 15 章：计算与控制上下文预算 | 同上 | 三节正文、独立快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 16 章：自动压缩并继续任务 | 用户要求“将这两章标记为已完成”，承接第 16、17 章交付 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 17 章：加载项目说明与规则 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 20 章：用 Hooks 扩展生命周期 | 用户明确确认第 20、21、22 章完成并要求提交推送 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 21 章：接入并管理 MCP 工具 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-15 | 第 22 章：查询和引用外部资料 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 23 章：让模型切换遵守同一套执行规则 | 用户明确要求“标记已完成并提交 同时开始接下来三章”，承接第 23—25 章交付 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 24 章：让附件以可核对的身份进入上下文 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 25 章：把局部任务交给独立的只读 Agent | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 26 章：命令还在运行，Agent 怎样继续工作 | 用户明确要求“将26、27、28章标记为已完成并提交上去” | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 27 章：让互不依赖的工具同时工作 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 28 章：把并行修改放进独立工作区 | 同上 | 三节正文、独立 TypeScript 快照、动图、练习及本地验证已具备 |
| 2026-10-16 | 第 29 章：共享任务与 Agent 消息 | 用户明确要求“将29、30、31章标记为已完成并提交上去” | 三节正文、独立 TypeScript 快照、配图、练习、公开跟写与网页检查已具备，已推送 |
| 2026-10-16 | 第 30 章：定时任务——保存规则，让运行中的程序按时调查 | 同上 | 三节正文、独立 TypeScript 快照、配图、练习、公开跟写与网页检查已具备，已推送 |
| 2026-10-16 | 第 31 章：本地扩展包 | 同上 | 三节正文、独立 TypeScript 快照、配图、练习、公开跟写与网页检查已具备，已推送 |
| 2026-10-16 | 第 32 章：接入代码诊断与语言服务 | 用户明确要求“将32、33、34章标记为已完成并提交上去” | 三节正文、独立 TypeScript 快照、配图、练习、公开跟写、安装与网页检查已具备 |
| 2026-10-16 | 第 33 章：接入真实执行隔离 | 同上 | 三节正文、独立 TypeScript 快照、配图、练习、真实隔离实验与网页检查已具备 |
| 2026-10-16 | 第 34 章：让故障可定位、可恢复 | 同上 | 三节正文、独立 TypeScript 快照、配图、练习、公开跟写、安装与网页检查已具备 |

2026-09-16：第二章按配置、模型、Agent Loop、终端与错误职责拆分，入口保留第一章的命令规则。源码与教程标明沿用、新增和修改；第 03 章在同一核心上补入工具循环。此调整不改变章节完成状态。

2026-09-16：按你的要求，将第二章拆成六个渐进小节，默认构建从 02.1 开始。每个快照提供多行教学注释和 ASCII 流程图；章数与已完成状态不变。

- 2026-09-23：根据用户明确通知，第 06 章及三个小节标记已完成；开始第 07 章。

- 2026-10-16：根据用户明确通知，第 23—25 章及各三个小节标记已完成；开始第 26—28 章。

- 2026-10-16：第 26—28 章按“先写正文、再补图”整理九节内容；保留待确认状态，不增加已确认完成章数。

- 2026-10-16：根据用户明确通知，第 26—28 章及九个小节标记已完成；开始第 29—31 章，仍先写正文，再补图。

- 2026-10-16：第 26—28 章已分别提交并推送源码、教学网站与 Pages 分支，master 保留原生 Markdown 与配图，不包含 Docsify。第 29—31 章已按“先正文、再配图”整理九节内容、完整 TypeScript 快照、练习及九套配图，连续跟写和网页检查通过；保留待确认状态，尚未提交或发布这三章。

- 2026-10-16：根据用户明确通知，第 29—31 章及九个小节标记已完成；本次提交保留原生 Markdown、配图和源码，Docsify 源码与生成网站分别发布至教学网站和 Pages 分支。开始第 32—34 章，仍先正文、后配图。
- 2026-10-16：第 32—34 章九节正文、完整 TypeScript 快照和练习已整理，再补齐九组可控动图、流程图与分镜；等待用户阅读确认，尚未提交这三章。

- 2026-10-16：根据用户明确通知，第 32—34 章及九个小节标记已完成；master 保留原生 Markdown、配图与源码，Docsify 与生成网站分别发布至教学网站和 Pages 分支。接着编写第 35、36 章，仍先正文、后配图。
