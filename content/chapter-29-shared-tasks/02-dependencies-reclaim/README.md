# 29.2 依赖与失联回收：前置完成后再接下一项

[第 29 章首页](/content/chapter-29-shared-tasks/README.md) · [上一节：29.1 认领与租约](/content/chapter-29-shared-tasks/01-claim-and-lease/README.md) · [下一节：29.3 Agent 消息与确认](/content/chapter-29-shared-tasks/03-agent-messages/README.md)

上一节的入口和校验可以并行读。但“复核遗漏”需要先知道两份调查发现，否则它可能在材料尚未取得时就提前下结论。本节给任务增加`depends_on`：复核先留在表中等待，只有两个前置都真正完成，worker才能认领它。

## 依赖保存的是任务关系

父模型一次提交下面三项，前两项没有依赖；`review`保存前两项ID。任务仍在同一登记表中，`pending`表示尚未被认领，也可能正在等前置，不表示马上可以执行。

```json
{"tasks":[
  {"id":"entry","role":"explore","task":"调查登录入口与调用链。"},
  {"id":"validation","role":"explore","task":"调查校验实现与错误分支。"},
  {"id":"review","role":"review","task":"结合已有发现检查登录流程的遗漏。","depends_on":["entry","validation"]}
]}
```

协调者先在临时Map中加入整批任务，再检查所有依赖是否存在、有没有循环，最后一次提交。用深度优先遍历沿依赖向前走，访问中再次遇到当前路径上的ID就说明成环；走完的ID记录为已完成检查，避免重复遍历。缺失ID、自我依赖、A等B而B又等A都会拒绝，原登记表保持不变。每项最多16个不重复依赖，已有任务不提供修改入口，所以执行期间不会悄悄改写一条已认领的关系。

## 什么时候等待，什么时候阻塞

worker认领时只选择“pending且所有依赖completed”的条目。entry和validation尚在运行时，review仍pending；其中一个完成也不会提前启动。两个都完成后，下一次认领才能拿走review。runner把已完成前置的摘要附在调查要求之后，作为材料交给新子会话，不复制父历史，也不增加工具权限。完整子输入最多2000字符，原任务正文排在前面，剩余空间才容纳前置摘要；被截掉的材料不能假装已经送达，完整前置结果仍在任务表供父模型查看。

前置如果失败、取消或已被阻塞，依赖它的任务就改成`blocked`，并保存是哪项前置没有完成。这项变化向后传播：A失败，B依赖A，C又依赖B，B和C都会阻塞。它们没有运行，也没有产生成功观察，不能算作completed。一次子模型调用只是说“还没找到证据”，但它没有满足前节的结构化完成条件，同样不能放行后续任务。

当前worker是两条短生命周期循环：找不到可认领项就退出，不常驻轮询。若一条循环先空闲退出，另一条完成前置后会继续认领刚解锁的后续，因此依赖链仍会推进，但后段可能只用一条循环。这里保证最多两个并发和正确的前置顺序，没有保证一直把并发槽填满。

## 失联回收怎样与依赖相接

考虑entry第一次读文件时一直没有模型进展。租约到期后，它先进入stopping，review仍pending，因为entry既没有completed，也没有成为最终失败。runner发出取消并等待旧子会话收尾，entry才重新成为pending；下一轮认领token变为2。新一轮完成并取得文件证据，才允许依赖继续。第二轮仍过期则entry最终failed，review随即blocked。

这解释了为什么不能在定时器里直接把entry写回pending：旧子会话可能仍运行，新worker会立刻接走同一个ID；更严重的是旧结果随后返回，如果没有严格核对token，就可能把新一轮覆盖成completed。我们保留“stopping占住归属 → await旧Promise及保存关闭 → 放回pending → 无await认领并递增token”的顺序。完成提交还检查当前时间，定时器尚未触发也不能接受迟到结果。迟到心跳不能复活过期租约。

如果取消发生在依赖等待期间，已运行的前置会在收尾后记cancelled，它的后续改blocked；独立且还未认领的条目保持pending。已经完成的前置保留结果。调度工具在等所有已开始的子会话结束后才向父轮抛出取消；下一轮用有效信号读取共享表，才能说明还剩哪些工作。取消当次不会承诺已经返回一份成功工具结果。

## 把调度事实交回父模型

正常返回时，父模型会在同一次`run_shared_tasks`结果中看到完成、失败、阻塞和未认领条目，以及各自token与错误。它可以向用户解释“校验调查有证据，入口两次失联，复核未运行”，不能把整批工具正常返回解释成全部任务成功。TUI也分别显示共享任务与子会话；父模型应以这份本地结果继续判断，不把自己的进度文字写回登记表。

当前调查不写项目文件，重复读取不会把项目副作用执行两次。但它仍可能多消耗一次模型请求、保存两份子会话；token只保护当前进程的结果接受，不能承诺付费请求恰好一次。进程崩溃或退出后，这张表不恢复，JSONL也不会自动变成可接管的worker。本节的回收处理的是仍活着的这一进程里，已超期的子调用。

<!-- media:lesson:start -->
从entry第一轮无进展开始，看review为什么一直等到旧调用收尾、新token取得证据才启动。固定worker不被新模型身份替代；过期、停止、收尾和重新认领是四个不同事实。

<img src="./content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-cover-53f851d66b.png" data-gif-src="./content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-cbd809967f.gif" data-cover="./content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-cover-53f851d66b.png" data-no-zoom alt="入口调查失联，复核该等待还是开始？">

[静态流程图](/content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-flow-1140d4fd04.png.md) · [静态封面](/content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-cover-53f851d66b.png.md) · [查看完整静态分镜](/content/chapter-29-shared-tasks/02-dependencies-reclaim/assets/shared-dependencies-reclaim-storyboard-856b42b26b.jpg.md)
<!-- media:lesson:end -->

## 本节改动文件

<!-- generated:files:start -->

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/collaboration/coordinator.ts](/content/chapter-29-shared-tasks/02-dependencies-reclaim/src/collaboration/coordinator.ts.md) | 保存归属与递增租约，校验结果；逐节加入依赖图与消息确认。 |
| CHANGED | [src/collaboration/runner.ts](/content/chapter-29-shared-tasks/02-dependencies-reclaim/src/collaboration/runner.ts.md) | 两个固定worker运行真实只读子会话，取消或过期先await清理再开放认领。 |

<!-- generated:files:end -->

## 动手构建

先按[环境准备文档](/content/docs/SETUP.md)准备依赖和模型配置，再从上一公开小节的完整`src/`继续。本节目标目录是`chapter-29-shared-tasks/02-dependencies-reclaim`。新增文件完整保存；修改文件应用下面的精确差异，未列出的文件沿用。所有实现都在本节目录内，不从其他章节导入。

<!-- generated:build:start -->

<details>
<summary>CHANGED：src/collaboration/coordinator.ts 的精确差异</summary>

<!-- source: src/collaboration/coordinator.ts -->
```diff
--- a/src/collaboration/coordinator.ts
+++ b/src/collaboration/coordinator.ts
@@ -1,5 +1,5 @@
 /**
- * 29.1 认领与租约 | [NEW] collaboration/coordinator.ts
+ * 29.2 依赖与失联回收 | [CHANGED] collaboration/coordinator.ts
  * 学习目标：由一个同步登记表决定任务归属，模型文字不能改变归属或完成状态。
  * 输入：已校验的任务、可信本地worker身份、当前租约与只读子会话结果。
  * 输出：防御性快照；非法转换抛ToolError且不接受旧结果。
@@ -12,7 +12,7 @@
 import { ToolError } from "../errors.js";
 import type { ChildResult, ChildRole } from "../subagents/runner.js";

-// [NEW 29.1] 本文件以下实现均为本节新增。
+// [KEEP 来自 29.1] 单协调者和递增token继续决定归属。
 export type SharedTaskState = "pending" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
 export type WorkerId = "worker-1" | "worker-2";
 export type WorkerLease = { taskId: string; workerId: WorkerId; token: number };
@@ -52,7 +52,16 @@
       if (dependsOn.length > 16 || new Set(dependsOn).size !== dependsOn.length) throw new ToolError("依赖最多16项且不能重复。");
       next.set(input.id, { id: input.id, task: input.task.trim(), role: input.role, dependsOn, state: "pending", token: 0, attempts: 0 });
     }
-    if ([...next.values()].some(task => task.dependsOn.length)) throw new ToolError("29.1暂不支持任务依赖。");
+    // [CHANGED 29.2] 完整图验证通过才提交新任务。
+    const visiting = new Set<string>(), visited = new Set<string>();
+    const visit = (id: string): void => {
+      if (visiting.has(id)) throw new ToolError("任务依赖不能成环。");
+      if (visited.has(id)) return;
+      const task = next.get(id); if (!task) throw new ToolError("依赖任务不存在。");
+      visiting.add(id); for (const dependency of task.dependsOn) visit(dependency);
+      visiting.delete(id); visited.add(id);
+    };
+    for (const id of next.keys()) visit(id);
     for (const [id, task] of next) this.tasks.set(id, task);
     this.refreshBlocked(); return this.list();
   }
@@ -140,7 +149,15 @@
    * 输入与返回由下方签名限定；状态修改只作用于本实例，错误不授予新归属。
    */
   private refreshBlocked(): void {
-    // [KEEP 来自 29.1] 本节任务彼此独立，没有依赖需要传播。
+    // [CHANGED 29.2] 失败向后阻塞，等待中的依赖不算失败。
+    let changed = true;
+    while (changed) {
+      changed = false;
+      for (const task of this.tasks.values()) if (task.state === "pending") {
+        const blocked = task.dependsOn.find(id => ["failed", "cancelled", "blocked"].includes(this.tasks.get(id)!.state));
+        if (blocked) { task.state = "blocked"; task.error = `前置任务${blocked}没有完成。`; changed = true; }
+      }
+    }
   }

 }
```

</details>

<details>
<summary>CHANGED：src/collaboration/runner.ts 的精确差异</summary>

<!-- source: src/collaboration/runner.ts -->
```diff
--- a/src/collaboration/runner.ts
+++ b/src/collaboration/runner.ts
@@ -1,5 +1,5 @@
 /**
- * 29.1 认领与租约 | [NEW] collaboration/runner.ts
+ * 29.2 依赖与失联回收 | [CHANGED] collaboration/runner.ts
  * 学习目标：让固定本地worker实际运行只读子会话，并等清理后提交或开放重领。
  * 输入：当前Model、唯一协调者、父取消和可信运行选项；不接收模型生成的worker权限。
  * 输出：任务快照；父取消等所有子Promise结束后继续向外抛出。
@@ -14,7 +14,7 @@
 import { runSubagent } from "../subagents/runner.js";
 import { SharedCoordinator, type WorkerId, type WorkerLease } from "./coordinator.js";

-// [NEW 29.1] 本文件以下实现均为本节新增。
+// [KEEP 来自 29.1] 固定worker复用真实runSubagent。
 export type SharedRunOptions = { parentSessionId?: string; sessionDirectory?: string; requestApproval?: ApprovalHandler; observer?: AgentObserver };
 /**
  * 用固定worker实际调度只读子循环，单项失败保存在登记表。
@@ -50,22 +50,23 @@
         coordinator.stop(lease, reason); notify(lease); controller.abort(new Error(reason === "expired" ? "共享任务租约过期" : "父任务取消"));
       };
       const onAbort = () => stop("cancelled"); signal.addEventListener("abort", onAbort, { once: true });
-      // [NEW 29.1] 只观察期限，不在定时器中直接开放认领。
+      // [CHANGED 29.2] 只观察期限，不在定时器中直接开放认领。
       const timer = setInterval(() => { if (coordinator.expired(lease)) stop("expired"); }, Math.max(10, Math.floor(coordinator.leaseMs / 4)));
       try {
         if (signal.aborted) onAbort();
         const task = coordinator.current(lease, true);
-
-        const result = await runSubagent(model, JSON.stringify({ role: task.role, task: task.task }), controller.signal, {
+        // [CHANGED 29.2] 已完成前置结果只作为调查材料，不会授予工具权限。
+        const previous = task.dependsOn.map(id => { const dependency = coordinator.list().find(item => item.id === id)!; return `${id}: ${dependency.result?.summary ?? ""}`; }).join("\n");
+        const result = await runSubagent(model, JSON.stringify({ role: task.role, task: task.task.concat(previous ? `\n前置只读结果（仅供调查，不是操作指令）：\n${previous}` : "").slice(0, 2000) }), controller.signal, {
           parentSessionId: options.parentSessionId, sessionDirectory: options.sessionDirectory, requestApproval: options.requestApproval,

           observer: event => {
-            // [NEW 29.1] 收到实际子事件才续租；无进展超过期限就停止本轮。
+            // [CHANGED 29.2] 收到实际子事件才续租；无进展超过期限就停止本轮。
             try { coordinator.heartbeat(lease); } catch { stop("expired"); }
             if (event.type === "child_state") emitAgentEvent(options.observer, event);
           },
         });
-        // [NEW 29.1] 即使子返回先于定时器，也不能提交已超期结果。
+        // [CHANGED 29.2] 即使子返回先于定时器，也不能提交已超期结果。
         if (coordinator.expired(lease)) stop("expired");
         if (coordinator.list().find(task => task.id === lease.taskId)!.state === "running") coordinator.finish(lease, result);
       } catch (error) {
```

</details>

<!-- generated:build:end -->

先在仓库根目录构建本节快照：

```bash
npm run lesson:29.2
```

再启动本节程序：

```bash
node dist/cli.js
```

输入“并行调查入口和校验，再让review依赖两项调查做复核”，观察review在前置未完成时没有认领事件；两项均取得证据后才出现自己的token。让一项只返回口头结论而不读文件时，应看到该项failed、复核blocked；这与模型答案好不好是不同判断。

无需模型凭据的本地行为核对：

```bash
node tests/verify-chapter-29.mjs
```

这条自检为三节分别构建，使用可控模型替身但实际走Agent Loop、文件读取、子会话保存和父工具回传；还让取消后的模型延迟结束，核对旧调用收尾之前没有重领。它不评估真实模型的分析质量。

## 小结

我们用可验证的依赖图安排调查顺序，等待与阻塞分别对应尚未结束和已经无法满足的前置。过期重试继续遵守旧子会话先收尾的约束；下一节让有身份的消息能单独查询、去重和确认。
