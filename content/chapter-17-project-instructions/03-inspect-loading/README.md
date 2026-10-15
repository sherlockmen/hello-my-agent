# 17.3 检查实际加载了哪些规则

[第 17 章首页](/content/chapter-17-project-instructions/README.md) · [上一节：17.2 区分不同目录的适用范围](/content/chapter-17-project-instructions/02-scoped-instructions/README.md) · [下一节：18.1 显式保存项目记忆](/content/chapter-18-long-term-memory/01-save-memory/README.md) · [练习与答案](/content/chapter-17-project-instructions/EXERCISES.md)

## 问题：模型没有按约定做，原因可能发生在不同位置

我们在 `AGENTS.md` 写了“使用 npm test”，模型却没有提出测试。可能是从另一个目录启动，根本没加载这份文件；也可能文件超限被跳过，或者运行中的 Agent 仍用编辑之前的版本。即使确实带进请求，模型也可能没有遵守。

只问模型“你读到规则了吗”，无法区分这些情况。它的回答不能替本地加载器作证，更不能说明执行器已经运行测试。

本节增加一个只检查本地状态的入口：先把项目根、范围、来源、版本和跳过原因摆清楚，再去分析模型的后续决策。

## 解决方案：沿用同一加载器，输出可核对的报告

运行 `hello-my-agent --project-info`，程序使用与正常启动相同的根判断、目录链和读取规则，列出每份候选文件的处理结果。这个命令不需要模型密钥，不发送模型请求，也不创建会话。

报告还显示每份已加载文件的字节数和 SHA-256，以及本次读取预算。这样可以核对“从哪里读、读了哪版、为何没读”，再决定是否更换启动位置、缩短说明或重新启动。

## 工作原理

### 检查命令与正常启动必须使用同一套读取规则

如果检查命令自己递归扫描仓库，而正常启动只走目录链，就会出现“检查说已发现，实际却没发送”的误导。因此，检查入口复用相同加载器，只把原本用于组装请求的结果转换成报告。

处理顺序仍是：解析真实启动目录，确定最近项目根，列出根到启动位置的候选，逐份完成检查与读取，再汇总状态。检查过程中不运行 `AGENTS.md` 里写的命令，也不会为了补齐说明而请求模型。

普通文本模式与 TUI 启动也显示本次根、启动范围和加载概况；详细检查命令方便在排查时单独核对。看到某份“已加载”，只能确认程序接纳了完整文字，不能把它读成“模型已经执行约定”。

### 路径和字节说明对象，摘要值说明这次读到的版本

报告中的来源使用项目根相对路径，范围说明它适用于哪个子树。字节数是实际读取的 UTF-8 文件大小，不是 Token，也不能直接等同模型输入费用。

SHA-256 根据加载时的原始字节计算。同一路径编辑后可能内容变化；比较摘要值，可以发现两次检查读到的版本不同。它不判断文字好坏，也不证明模型理解正确，只帮助辨认这次取得的内容。

如果先启动 Agent，随后编辑文件，再运行检查命令，检查会看到新文件；正在运行的 Agent 仍保留旧版本。要让后者使用新文字，需要重新启动。不能用新检查结果，倒推旧进程已经自动更新。

### 未加载原因帮助定位到具体一步

| 报告状态 | 它说明什么 | 接下来检查什么 |
| --- | --- | --- |
| 预期文件未列入已加载清单，也没有读取错误 | 可能不存在，或根本不在启动链上 | 文件名、项目根和实际启动链是否正确 |
| 非普通文件、链接或越过范围 | 本地读取边界不允许接纳 | 是否放在项目内的普通文件，是否经过链接 |
| UTF-8 无效 | 无法作为完整有效文本读取 | 文件编码，而不是模型提示词 |
| 单份过大、总量或数量达到限制 | 本次读取预算不允许继续接纳 | 缩短相关说明，或调整启动范围 |
| 已加载且版本符合预期 | 本地加载这一段完成 | 继续看请求组装、模型决策和真实工具结果 |

表中是原因类别；以实际命令输出为准。没有错误并不保证模型遵循，出现跳过也不等于整个项目不能启动。加载器给出明确交代，避免把缺失文字当成已经生效。

### 从本地加载一路核对到工具结果

仍以“增加两个负数相加的测试”为例。先确认报告中根说明已加载，内容版本正确；再正常启动并提交任务。请求会携带这份参考，但之后需要分别观察：

1. 模型是否提出读取、修改与测试调用。
2. 本地执行器是否按权限允许这些调用。
3. 测试进程是否实际结束，返回了什么退出码与日志。
4. 模型是否据此说明负数测试结果，或继续修复。

这四步能把问题定位到具体位置。若说明已加载、模型却没提测试，不能说是工具执行失败；若提出测试但权限拒绝，也不能说测试已经通过。项目说明只是决策的依据，完成依据仍来自真实结果。

### 不持久化规则，不代表运行时会丢失它们

当前进程持有启动时加载的集合，每次请求按同一方法重附。普通会话保存的是对话与任务状态，不把项目规则当成用户历史永久复制进去。恢复会话时重新启动并重新加载，使用的是当时项目中的版本。

这避免把一份旧说明默默带进新项目状态，也意味着规则变更会改变后续请求依据。项目根与真实启动目录仍分别核对；从同一根的另一个子目录启动，不能借此放宽会话恢复要求。

<!-- generated:media:start -->
下面把两个进程放在同一张图里：先前启动的 Agent 持有版本 A，编辑磁盘后运行检查会读到版本 B。检查只汇报本地加载事实，不请求模型；超限文件整份跳过，也不会更新旧进程中的副本。

<img src="./content/chapter-17-project-instructions/03-inspect-loading/assets/project-loading-inspection-cover-7e1de202df.png" data-gif-src="./content/chapter-17-project-instructions/03-inspect-loading/assets/project-loading-inspection-e41035951b.gif" data-cover="./content/chapter-17-project-instructions/03-inspect-loading/assets/project-loading-inspection-cover-7e1de202df.png" data-no-zoom alt="本地检查显示根范围来源字节散列与跳过原因，新检查读到B而旧Agent仍持有A，没有模型请求或会话创建">

[静态封面](/content/chapter-17-project-instructions/03-inspect-loading/assets/project-loading-inspection-cover-7e1de202df.png.md) · [查看完整静态分镜](/content/chapter-17-project-instructions/03-inspect-loading/assets/project-loading-inspection-storyboard-c3c9be6a02.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/project/instructions.ts](/content/chapter-17-project-instructions/03-inspect-loading/src/project/instructions.ts.md) | 报告固定加载预算、来源、字节与加载时版本摘要 |
| CHANGED | [src/cli.ts](/content/chapter-17-project-instructions/03-inspect-loading/src/cli.ts.md) | 提前处理本地 --project-info，跳过密钥、模型请求和会话创建 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 17.2 的完整 `src/` 继续，目标目录是 `chapter-17-project-instructions/03-inspect-loading/`。为既有加载报告增加本地命令出口，提前处理它，避免无模型检查也要求密钥或创建会话。

<!-- generated:build:start -->
### 1. 报告固定加载预算、来源、字节与加载时版本摘要

在上一节的 `src/project/instructions.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/project/instructions.ts（CHANGED）</summary>

<!-- source: src/project/instructions.ts -->
```diff
--- a/src/project/instructions.ts
+++ b/src/project/instructions.ts
@@ -1,9 +1,9 @@
 /**
- * 17.2 按目录范围组合项目规则 | [CHANGED] project/instructions.ts
+ * 17.3 查看加载来源与预算 | [CHANGED] project/instructions.ts
  *
  * 学习目标：把启动位置、工具使用的根目录和项目说明的来源分开记录。
  * 输入：真实启动目录、取消信号；只读取固定名称 AGENTS.md。
- * 输出：已加载文本、来源、范围与未加载原因；内容只是模型参考，不是本地授权。
+ * 输出：模型参考与本地加载报告；来源、范围、字节和SHA256不证明模型已经收到。
  * 状态：启动时读取一次，不改目录、不写文件；完整读取和校验后才接纳一份说明。
  * 本文件流程：启动目录 -> 最近项目标记 -> 按祖先链有界读取 AGENTS.md -> 来源标签与模型参考。
  * 运行观察：从 src/api 启动仍找到项目根；目录或符号链接不能被当作说明正文。
@@ -92,7 +92,7 @@
   const origin = await realpath(resolve(start));
   const root = findProjectRoot(origin);
   const result: ProjectInstructions = { root, start: origin, sources: [], notices: [], bytes: 0 };
-  // [CHANGED 17.2] 只加载根到真实启动目录的祖先链；不扫兄弟、后代或工具目标路径。
+  // [KEEP 来自 17.2] 只加载根到真实启动目录的祖先链；不扫兄弟、后代或工具目标路径。
   const directories: string[] = [];
   for (let directory = origin; ; directory = dirname(directory)) {
     directories.unshift(directory);
@@ -127,10 +127,12 @@
 /** 只显示来源与加载结果，不把正文直接写到终端，也不声称模型已经收到。 */
 export function projectInstructionInfo(project: ProjectInstructions): string[] {
   return [
+    // [NEW 17.3] 固定上限与版本散列说明本次加载的范围，不输出说明正文。
+    `加载预算：单文件 ${INSTRUCTION_LIMITS.fileBytes} 字节；合计 ${INSTRUCTION_LIMITS.totalBytes} 字节；最多 ${INSTRUCTION_LIMITS.files} 份。`,
     `项目根：${JSON.stringify(project.root)}`,
     `启动范围：${JSON.stringify(portable(relative(project.root, project.start)))}`,
     `项目说明：已在本地加载 ${project.sources.length} 份，共 ${project.bytes} 字节；新请求会携带这些参考。`,
-    ...project.sources.map((source) => `已加载 ${JSON.stringify(source.path)} · 范围 ${JSON.stringify(source.scope)} · ${source.bytes} 字节`),
+    ...project.sources.map((source) => `已加载 ${JSON.stringify(source.path)} · 范围 ${JSON.stringify(source.scope)} · ${source.bytes} 字节 · SHA256 ${source.sha256}`),
     ...project.notices.map((notice) => `未加载 ${JSON.stringify(notice.path)}：${notice.reason}`),
   ];
 }
```

</details>

### 2. 提前处理本地 --project-info，跳过密钥、模型请求和会话创建

在上一节的 `src/cli.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/cli.ts（CHANGED）</summary>

<!-- source: src/cli.ts -->
```diff
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,6 +1,6 @@
 #!/usr/bin/env node
 /**
- * 17.1 从子目录找到项目根并加载说明 | [CHANGED] cli.ts
+ * 17.3 查看加载来源与预算 | [CHANGED] cli.ts
  *
  * 学习目标：在选择消费者前加载本次项目说明，再把固定快照交给模型；会话仍由原入口管理。
  * 输入：命令行模型选项、--prompt 与 --output；输出格式默认是 auto。
@@ -35,7 +35,7 @@
  */

 import { dirname } from "node:path";
-// [NEW 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
+// [KEEP 来自 17.1] 启动时完成项目说明快照，进入模型与界面前只读一次。
 import { loadProjectInstructions, projectInstructionInfo } from "./project/instructions.js";
 import { createFileCheckpointStore } from "./sessions/file-checkpoints.js";
 import { readFileSync } from "node:fs";
@@ -74,7 +74,7 @@
 }
 // [KEEP 来自 09.3] output 只供入口选择消费者，不并入模型连接配置。
 // [KEEP 来自 13.1] 会话目录只属于本地持久化，不属于模型配置。
-type CliOptions = Options & { prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
+type CliOptions = Options & { projectInfo?: boolean; prompt?: string; doctor?: boolean; output?: string; mode?: string; sessionDir?: string; resume?: string; recover?: boolean; sessions?: boolean; search?: string; rename?: string; name?: string; export?: string; exportTo?: string; fork?: string };
 const program = new Command();
 program
   // [KEEP 第 01 章] 帮助、版本无需配置模型，也不会发送请求。
@@ -84,6 +84,8 @@
   .helpOption("-h, --help", "显示帮助")
   // [KEEP 来自第 01 章练习] --doctor 在读取模型配置前结束，因此没有 API Key 也能使用。
   .option("--doctor", "显示当前运行环境")
+  // [NEW 17.3] 本地检查在读取模型配置和创建会话之前完成。
+  .option("--project-info", "显示项目说明来源、范围、版本和加载预算")
   // [KEEP 来自 02.1] 允许本次启动覆盖模型和基础地址，不在参数中传密钥。
   .option("--model <id>", "本次使用的模型 ID")
   .option("--base-url <url>", "本次使用的接口基础地址")
@@ -112,6 +114,17 @@
   // [KEEP 来自 09.3] 默认动作先检查输出约定，再装配模型并选择对应消费者。
   .action(async () => {
     const options = program.opts<CliOptions>();
+    // [NEW 17.3] 本地检查是单独动作，拒绝会让用户误以为发送了任务的选项组合。
+    if (options.projectInfo) {
+      if (options.prompt !== undefined || options.doctor || options.model !== undefined || options.baseUrl !== undefined
+        || options.provider !== undefined || options.mode !== undefined || options.output !== "auto"
+        || options.sessionDir !== undefined || options.resume !== undefined || options.recover || options.fork !== undefined
+        || options.sessions || options.search !== undefined || options.rename !== undefined || options.name !== undefined
+        || options.export !== undefined || options.exportTo !== undefined) throw new UserFacingError("--project-info 请单独使用，不与提问、模型、模式、会话或输出选项混用。 ");
+      const project = await loadProjectInstructions();
+      for (const line of projectInstructionInfo(project)) console.log(line);
+      return;
+    }
     // [KEEP 来自 13.4] 先排除含糊组合，再执行一个本地动作；没有 API Key 也可以管理。
     const management = Number(Boolean(options.sessions)) + Number(options.rename !== undefined) + Number(options.export !== undefined);
     if (management > 1) throw new UserFacingError("--sessions、--rename、--export 每次只能选择一个。");
@@ -169,7 +182,7 @@
     if (options.prompt !== undefined && !options.prompt.trim()) throw new UserFacingError("提问内容不能为空。");
     // [KEEP 来自 14.1] 含糊组合在创建模型或新文件之前拒绝。
     if (options.fork !== undefined && (options.resume !== undefined || options.recover || options.output === "jsonl")) throw new UserFacingError("--fork 不与 --resume、--recover 或 JSONL 混用。");
-    // [NEW 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
+    // [KEEP 来自 17.1] 不改 cwd，不把项目说明当作审批或脚本运行入口。
     const project = await loadProjectInstructions();
     const config = readConfig(options);
     const model = createModel(config, project);
```

</details>
<!-- generated:build:end -->

## 运行验证

先在仓库根目录编译并注册本节。

```bash
npm run lesson:17.3
```

进入演示项目的目标启动目录，执行检查。

```bash
hello-my-agent --project-info
```

核对项目根、启动范围、来源、字节数、摘要值和未加载原因。改变启动位置或编辑说明后重新运行，比较报告；再用正常启动验证当次会话使用的集合。章末实验还会构造超限文件和兄弟目录，检查报告能否区分它们。

## 本节完成后的 Agent

Agent 已能从启动位置确定项目、加载有作用范围的说明，并提供不依赖模型的检查依据。它能确认请求准备所用的本地参考，工具是否允许执行、测试是否成功与模型是否遵守，仍分别由后续环节证明。

接下来进入 [18.1 显式保存项目记忆](/content/chapter-18-long-term-memory/01-save-memory/README.md)：把用户选择保留的少量事实保存到独立文件，并在下一项任务开始时重新读取。
