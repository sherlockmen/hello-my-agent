# 第 30 章命令示例

从项目根构建 `npm run lesson:30.3` 后，在准备调查的项目中执行。以下命令分次运行；serve保持占用时，本地控制输入应在它的标准输入中提交。

```bash
hello-my-agent schedule --state-dir .agent-schedules create --id docs --prompt "读取README.md并汇总待办" --every-ms 60000 --max-runs 3 --max-tokens 98304
```

```bash
hello-my-agent schedule --state-dir .agent-schedules list
```

提供本次环境中的模型连接配置，再启动：

```bash
hello-my-agent schedule --state-dir .agent-schedules serve
```

serve内输入示例：

```text
list
pause docs
resume docs
stop docs
```

Ctrl+C等待服务收尾。已有任务若stopped或预算耗尽，请创建新的编号；不要直接把旧计数归零。

[budget-answer/report.ts](/content/chapter-30-scheduled-tasks/examples/budget-answer/report.ts.md) 和 [budget-answer/commands.ts](/content/chapter-30-scheduled-tasks/examples/budget-answer/commands.ts.md) 是[练习](/content/chapter-30-scheduled-tasks/EXERCISES.md)的完整实现，导入路径指向正式 30.3，能在仓库原地参与 typecheck。跟写时按练习中的完整文件保存到 src/schedules/report.ts 与 src/schedules/commands.ts，再构建；练习给出的相对导入适用于该目标目录。
