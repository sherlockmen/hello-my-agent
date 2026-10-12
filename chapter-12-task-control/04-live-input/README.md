# 12.4 运行中排队补充与打断后发送

[第 12 章首页](../README.md) · [上一节：12.3 澄清问题](../03-clarify-questions/README.md) · [下一节：12.5 队列编辑与撤回](../05-manage-queue/README.md)

## 问题：任务已经开始，新要求怎样让 Agent 知道

上一节让 Agent 缺少条件时主动提问。这次，我们主动补充一个要求：Agent 正在修复 `add.mjs` 的数字加法并运行测试，我们又想起“请测试两个负数相加”。第十一章已经允许运行时编辑草稿，但文字留在输入框里，模型还不知道它。

负数测试可以接着原任务做。我们希望按 Enter 后先保存这个补充，等模型下一次决定做什么时一起考虑，原任务继续运行。

另一种场景是改变方向：原加法任务正在运行，我们改成“先别修改，先说明输入规则”。这时需要先停止原任务，再按新要求开始；否则界面发出了新要求，旧工具却可能还在修改文件。下面分别看这两种操作。

## 解决方案：补充先排队，打断先等旧任务结束

**Enter 排队补充**：任务运行时，Enter 把有效草稿保存到 TUI 的补充队列，记住文字、补充 ID 和所属任务。当前模型响应若提出多个工具调用，核心先逐个处理完它们，让每个调用都有成功或错误结果；准备下一次模型请求时，再收取当前任务的补充，追加为用户消息。因此模型下一次能同时看到工具结果和负数要求。

**Ctrl+S 打断后发送**：程序先校验并保存草稿，再封住提交入口、请求旧任务停止，等待旧任务及事件流清理结束，最后创建新任务。保存文字避免新要求丢失；等待结束避免新旧工具同时操作项目。

本节处理获得焦点的普通草稿，审批和澄清仍由各自面板接收输入。已有按键继续各有用途：运行中 `Ctrl+C` 取消当前任务，空闲时退出；`Ctrl+D` 随时退出，`Ctrl+U` 清空草稿。

## 工作原理

### 方式一：Enter 排队补充

这幅图跟随“请测试两个负数相加”这张卡片，看它怎样从草稿进入本地队列，再交给模型。此时模型已经提出读取 `src/add.mjs` 和 `test/add.test.mjs`；补充到来后，这两次读取仍照常继续。

![Enter 把负数补充存到本地，等两次读取返回后加入下一次模型请求](assets/enter-supplement-c51dcf0bd3.gif)

右侧 TUI 输入框里的**草稿**是正在编辑的文字。左侧的**当前两项读取工具**展示这批正在处理的读取，**本地队列**暂存已经提交、还没交给模型的补充，**下一次模型请求**接收原加法目标、工具结果和补充。卡片进入队列时，“已排队”只说明文字已保存，原任务还在运行。[静态图](assets/enter-supplement-21782bc791.jpg)

补充等的是**当前这批工具调用处理完**。图中两次读取都返回后，程序才从队列取出这张卡片，把原加法目标、工具调用及结果、负数补充一起放入下一次模型请求。“已加入上下文”确认的是这一步本地准备完成；模型下一次据此决定怎样继续修复和测试。

所以，Enter 不会修改已经发出的模型请求，也不用等整个加法任务结束。它让补充赶上同一任务的下一次模型决策。

#### 一次用户任务，可以请求模型多次

本节的 `run` 是**用户任务的数字编号**。用户提交加法修复后，直到它完成、取消或因错误结束，都属于同一个任务。这个任务可以先请求模型读取文件，再请求模型决定怎样修改，最后请求模型总结结果；这些模型请求并不会自动变成新的用户任务。

下面的例子假设会话已经处理过两次任务，这次加法修复的编号为 `3`：

| 编号 | 本例的值 | 用来辨认什么 |
| --- | --- | --- |
| `run` | `3` | 这次加法修复任务，从开始到结束保持不变 |
| `modelCall` | `1`，随后是 `2` | 当前任务第几次请求模型 |
| 工具的 `call.id` | `read_add`、`read_tests` | 一次模型响应提出的两个具体工具调用，结果用同一 ID 对应 |

模型第一次响应提出两个读取，第二次看到结果后继续决定做什么。这时仍是 `run=3`，只是 `modelCall` 从 `1` 变成了 `2`。Enter 补充不会创建新任务。

#### 队列由界面保存，核心用绑定任务的入口收取

补充队列保存在 TUI 会话的 `session.queue` 中。Enter 把负数要求追加到它的 `items`，补充 ID `17` 用来辨认这条文字，`run: 3` 表示只能交给当前加法任务。

下面另看一个**独立的队列过滤变体**：如果队列还留着任务 `2` 未收取的文字，收取时应该怎样区分？这条旧数据只用于下面的 JSON，不在 GIF 中。此时 `session.queue.items` 是：

```json
[
  { "id": 16, "text": "先检查输入规则", "run": 2 },
  { "id": 17, "text": "请测试两个负数相加", "run": 3 }
]
```

核心怎样找到这个界面队列？启动任务的 `startRun` 先固定本次编号，再把两个入口交给核心。下面只摘出这个连接关系，省略模式、问答和界面刷新等部分：

```ts
const run = ++session.run;
const options = {
  takePendingInputs: () => takePendingInputs(session.queue, run),
  hasPendingInputs: () => hasPendingInputs(session.queue, run),
};
```

这两个函数都记住本次启动时的 `run`，这就是闭包在这里的用途。核心调用 `takePendingInputs()` 时，实际取的是队列中 `run=3` 的全部条目，保持入队顺序，并从队列移出；`hasPendingInputs()` 只检查是否还有这些条目，不移出它们。启动入口把 `options` 传入运行流程，核心不需要自己管理 TUI。

所以收取后，`#17` 的文字进入任务消息，`#16` 仍留在队列。任务取消也不会把旧条目的 `run` 改成新编号，因为改变方向后，旧要求未必还适用。队列最多保留 20 条未收取内容，每条原文最多 32,000 个 UTF-16 单元，长度按字符串 `.length` 检查；空白、超长或队列已满时，程序提示原因，保留草稿，队列不变。

运行中按 Enter 提交 `/mode plan`、`/reset` 等已有本地命令时，程序保留草稿，提示等任务结束后再提交，不把命令排队给模型。

#### 当前两次读取返回后，把补充交给下一次模型决策

现在看加法任务第一次请求模型后的变化。模型的完整响应提出两个 `read_file` 调用：`read_add` 读取 `src/add.mjs`，`read_tests` 读取 `test/add.test.mjs`。图中两次读取都正常返回，短路径都位于 `demo-project` 内；这是一段机制示意，不是实测记录。

回到 Enter 图，程序先等待 `read_add` 返回，加入它的结果，才开始 `read_tests`。负数要求在这段时间进入队列，工具继续读取文件。随后 `read_tests` 的内容也加入消息；两项都有结果后，才把 `#17` 从队列移入用户消息，发起同一任务的第 2 次模型请求。模型因此既能继续原加法目标，也能根据读到的文件考虑负数测试。

这里“本批”指**这次完整模型响应里的 `toolCalls` 数组**。`model.generate()` 已经返回完整响应，所以程序知道本次清单就是这两个调用。核心用 `for...of` 按数组顺序处理，逐项 `await executeTool()` 或 `await executePreparedTool()`；前一个处理完成，才继续下一个。数组处理结束，才回到外层循环收取补充。程序依据这个执行过程确认结束，不靠日志是否还在出现、队列长度或猜测模型不会再调用工具。

这次任务积累的消息保存在 `turn`，其中原任务的用户消息一直保留。补充成为 `user` 消息后，核心发出 `input_applied` 事件，TUI 才显示“补充 #17 已加入第 2 次请求的上下文”。随后发送的消息是已有 `history` 加当前 `turn`，所以原目标、工具调用及结果、补充都在其中。提示确认的是本地消息已经改变；远端是否收到、模型是否落实负数测试，还要继续看请求、回答和工具结果。

#### 工具失败时，也要把结果交给模型

另看一个独立变体：如果模型把测试目录 `test` 写成 `tests`，第二次读取就会返回文件不存在或无法访问的错误。Enter 图仍展示正确路径的正常读取；这个变体用来说明失败结果怎样影响下一次决策。

下面截出这个变体随后加入 `turn` 的消息，原任务的用户消息没有展开。JSON 使用本书内部的 `Message` 形状，省略工具 `arguments`，读取内容和错误路径也作了节选；它不是模型 API 的原始消息格式：

```json
[
  {
    "role": "assistant",
    "content": "先读取实现和测试。",
    "toolCalls": [
      { "id": "read_add", "name": "read_file" },
      { "id": "read_tests", "name": "read_file" }
    ]
  },
  { "role": "tool", "toolCallId": "read_add", "content": "add.mjs 内容…", "isError": false },
  { "role": "tool", "toolCallId": "read_tests", "content": "工具执行失败：文件不存在或无法访问：…tests/add.test.mjs", "isError": true },
  { "role": "user", "content": "请测试两个负数相加" }
]
```

先看两个对应关系：调用 `read_add` 对应 `toolCallId: read_add`，调用 `read_tests` 对应 `toolCallId: read_tests`。后者虽然失败，结果仍告诉模型“这次读取没有取得测试内容”。所以“结果配齐”表示每个调用都有交代，**不表示每个操作都成功**。如果第一个结果刚返回就发送补充，第二个调用仍没有结果，模型既缺测试内容，也不知道它是否执行过。

权限拒绝、准备或执行阶段的 `ToolError`，以及命令返回的 `isError: true`，都会形成这种同 ID 的错误结果。核心继续处理清单，随后把真实错误和补充一起交给模型；它不会略掉失败，也不会自行盲目重试。本例模型可以据此决定先找到正确的测试文件，再增加负数用例，实际下一步仍要看模型响应。

下面把正常处理和停止放在同一张分支图里。菱形表示需要判断，箭头上的文字说明走哪条路；“意外异常”指没有被转换成 `ToolError` 的异常。

![完整工具清单按顺序处理；成功与预期错误都配同 ID 的结果，仍有调用则继续。全部配齐后收取当前 run 补充并请求模型；取消、意外异常或模型请求失败会保留已有结果，为未配对调用补中断状态，提交 history 后结束任务。](assets/control-flow-38a8b7be6a.png)

蓝色主线继续处理与模型决策；橙色标出中断收尾。

#### 当前任务什么时候结束或停止

**正常结束，要先确认没有尚未交给模型的要求。** 沿着加法任务继续看：假设模型已经修改 `add.mjs`、取得测试结果，正在生成“加法已修复，测试通过”的回答。这时我们按 Enter 提交“请测试两个负数相加”，文字还在本地队列里。模型的回答依据的是它已经看见的要求，不能覆盖刚收到的负数补充；此时直接结束，就会留下一个已经接收、却没有处理的要求。

所以程序先保留这次回答，再检查本任务是否还有补充。若还有，而且允许的模型请求次数尚未用尽，就把补充交给下一次模型请求，让模型根据已有修改和测试结果继续决定，例如增加 `-2 + -3 = -5` 的测试。若模型不再提出工具调用，本任务也没有待交付的补充，程序就保存本次过程，正常结束。这个条件确认的是运行可以收尾；“测试通过”仍要有对应的工具结果，不能只凭模型这么说。

**工具失败，通常仍有继续决策的依据。** 前面把 `test` 写成 `tests` 的例子已经说明：程序知道这次读取失败，也能把错误交给模型。模型可以据此更正路径，再决定怎样补负数测试。权限拒绝和能转换成工具错误的失败也一样：本批调用各自留下结果后，任务仍可继续；程序不会替模型略掉失败或盲目重试。

**任务被打断，要停止继续工作，留下真实进度。** 用户取消表示不再要求这次任务继续；模型请求失败时，程序没有取得可用的下一步决定；未被转换成工具错误的意外异常，也会终止任务。这些情况不能像一次已知的读取失败那样继续交给模型处理，但此前已经发生的操作仍然存在。若丢掉这段过程，后续任务就可能重复已经做过的修改，或者把尚未验证的加法修复当成已完成。

停止时，程序根据已经取得的结果，区分三种情况。下面仍用两个读取说明，后两行分别对应不同的打断时机：

| 停止时知道什么 | 应留下什么记录 |
| --- | --- |
| `read_add` 已经返回内容 | 保留原结果，说明这一步已做完 |
| `read_tests` 已经开始，但没有返回完整结果 | 说明“操作已开始，结果未知”，不能猜成成功或完全没做 |
| `read_tests` 尚未开始 | 说明“调用未执行”，后续任务知道这一步还没做 |

这些记录让后续任务知道哪些内容可以沿用、哪些还要做、哪些必须先核实。程序保存已有结果，只给尚无结果的调用补上中断状态，再保存本地中断说明，结束当前任务。已经交给模型的补充也保留在本次记录里；未收取的补充继续留在旧任务的队列中，不自动交给下一任务，因为新任务的方向可能已经变了。

停止改变的是**接下来是否继续执行**，不会撤销已经发生的写入。加法任务若已把 `add.mjs` 改好，取消后修改仍在；若写入开始了却没拿到完整结果，就要先查看实际文件。恢复原内容还需要备份和当前文件的核对，直接还原可能覆盖后来的修改；直接重试也可能重复已有操作。下一部分会沿 `Ctrl+S` 说明停止与清理怎样完成。

**实现对应与边界。** 上面的“检查还有没有补充”对应 `hasPendingInputs()`；本次过程先记在 `turn`，收尾时保存到会话内存 `history`。中断记录保留原调用 ID，以 `isError: true` 区别于成功结果；它补的是状态，不执行工具。终止分支保存这些记录后抛出错误，由运行入口收尾，当前任务不再请求模型。

同一任务最多请求模型 **8 次**。第 8 次若给出最终回答，仍可正常返回，未收取补充继续留队列；若还提出工具调用，就不保存或执行这批新调用，因为已没有下一次模型请求接收它们的结果，程序改为记录请求次数用尽并停止。

等待时间集中在各自实现中：模型请求限 60 秒，不自动重试；命令默认 30 秒，可设为 100—60,000 毫秒，超时后先停止进程、等 `close`，再返回日志和停止原因。审批与 `ask_user` 可以等待用户，也可以取消。本章还没有所有工具共用的任务超时，文件 I/O 依靠已有取消检查点；第二十七章会扩展生命周期与超时，第三十四章再讲重试分类、退避和无进展检测。

### 方式二：Ctrl+S 打断后发送

这幅图是独立的加法任务场景。用户输入“先别修改，先说明输入规则”，按 `Ctrl+S`，要的是先停止正在进行的加法任务，再让 Agent 按这份新要求开始。

![Ctrl+S 保存新要求，请求旧加法任务停止，等待结束后再启动新任务](assets/interrupt-and-send-63d3921571.gif)

图中先保存新要求，避免等待时丢失，再请求旧任务停止。此时新要求还没有发给模型；程序等旧任务保存已有消息、结束事件流并完成清理，才用保存的文字启动新任务。已经发生的文件修改仍然保留。[静态图](assets/interrupt-and-send-d8e8c84a97.jpg)

#### 先留下新要求，再请旧任务停止

继续看图中的加法任务：它可能已经读完文件，正在修改 `src/add.mjs`，后面还准备运行测试。我们按 `Ctrl+S`，是想改变接下来的工作方向；这时首先要回答三个问题：旧工具真的停了吗，未完成的操作怎样留在历史里，文件有没有变回原样？

程序先校验草稿，把“先别修改，先说明输入规则”保存在这次发送操作里，再暂停 Enter 和 `Ctrl+S` 提交，避免等待时重复发送。空白、超长文字和已有本地命令没有通过校验时，草稿仍留在输入框，旧任务也不会因此停止。审批或澄清面板占用输入时，`Ctrl+S` 不触发这条发送流程。

随后程序向旧任务发出取消信号。**发出信号只是请求停止，工具退出、保存消息和收尾仍需要时间。** 新要求在这段时间还没有交给模型，程序也不会创建另一个任务去抢同一份文件。

#### 正在执行的命令，怎样确认已经退出

如果我们晚一点按键，旧加法任务可能已经进入测试命令。测试又可能启动子进程，所以只停止直接启动的程序还不够：它退出了，子进程仍可能继续写文件，或者占着输出管道不放。

当前实现针对 macOS / Linux，把一次命令启动到独立的**进程组**，也就是给这次命令和留在组里的子进程一个共同的停止范围。取消到来时，程序先向整组发送 `SIGTERM`，请它们退出；如果还没有等到关闭通知，300 毫秒后再发送 `SIGKILL`，强制终止仍在组里的进程。

发出停止请求后，程序继续等直接子进程的 `close` 通知。它表示直接子进程已经结束，而且它的标准输出、错误输出等管道已经关闭。程序此时移除取消监听、清掉定时器，再向同组残留进程发送一次强制终止信号，才让命令的等待以取消结果结束。若进程提前关闭，就不必等满 300 毫秒。**确认依据是进程与管道关闭，不是日志停止滚动，也不是等够了 300 毫秒。**

这个办法管的是本次进程组。主动脱离组的程序、命令已经发出的远端请求，都不在它的完整控制范围里；最终的 `close` 若一直不到，仍会继续等待。300 毫秒是升级到强制终止的间隔，不是保证停止完成的期限。第二十七章会继续扩展工具生命周期，第三十三章再建立沙箱隔离。

模型请求同样接收取消信号，当前程序据此中断本地 HTTP 请求和流式接收。它能确认本地等待已经结束，不能据此证明服务端的推理也在同一时刻停止。

#### 已完成、结果未知、尚未执行，分别记清楚

回到更早的打断时刻：旧任务读到了加法文件，修改已经开始，但还没有取得完整结果，测试尚未启动。程序不能把三件事统称为“失败”，否则下一次模型既不知道哪些资料还能用，也可能再次执行已经部分发生的修改。

下面是这个时刻的教学摘要，说明旧任务最终应怎样交代各项操作；它不是额外执行一遍工具：

| 旧任务做到了哪里 | 留在消息中的内容 | 新任务据此知道什么 |
| --- | --- | --- |
| 读取 `src/add.mjs` 已返回内容 | 保留这次读取的真实结果 | 旧任务确实读过文件；文件后来可能又被修改 |
| 修改 `src/add.mjs` 已开始，停止时没有完整结果 | 为同一个调用补上“操作已开始，结果未知，可能已有部分修改” | 不能假定修改成功或完全没发生，继续前要核实当前文件 |
| 后面的测试尚未启动 | 为同一个调用补上“调用未执行” | 不能声称测试通过，也不把它误当成已运行的测试 |

程序怎样分得清？它在每个工具真正开始前，记住正在执行的调用 ID。工具正常返回时，先把真实结果加入本次消息，再清掉这个 ID；预期内的工具错误也先留下真实错误结果。取消或意外异常收尾时，程序对照**最近一批工具调用**和已经保存的结果，只给缺结果的调用补状态：缺结果且仍是正在执行的 ID，就记“结果未知”；其余缺结果的调用记“未执行”。已经有结果的调用保持原样。

所以，取消恰好赶在工具返回附近时，要看结果有没有保存。若修改的真实结果已经加入消息，即使马上收到取消，也保留它，不会再写一条“修改结果未知”去覆盖。若工具因取消退出而没有交回完整结果，则保留“可能已发生部分修改”的说明，而不是推测它没有动过文件。

这些消息与 `[本地状态]` 中断说明一起提交到会话历史，旧任务随后结束。新任务继续使用这份历史，既能看到已取得的内容，也知道哪些操作需要重新核实。“开始新任务”不清空上下文；旧任务没有收取的补充仍带原任务编号，不自动交给新任务。这些历史和队列目前都在内存里；第十三章再实现会话的持久保存与恢复。

#### 事件收完、占用解除，才开始新任务

工具的等待结束后，核心才有机会完成上面的消息归档。随后旧任务的事件流收尾，TUI 接完已入队的事件，保存本轮显示内容，清掉控制器、等待面板和忙碌标记；这条等待结束，打断发送操作才会清空草稿，创建 `run=4`，把保存的新要求交给模型。

实现里，`session.done` 保存的 Promise 就代表这段从运行到界面收尾的等待。它覆盖工具执行，是因为每一层都等待内层结束；简短对照如下：

> 工具结束 → 等待工具的 `agentLoop` / `runAgent` 结束 → 事件生成器的 `finally` 等真实任务结束并销毁队列 → TUI 的 `finally` 解除本轮占用 → `session.done` 完成。

`Ctrl+S` 先记住旧的 `session.done`，再发取消信号并等待它。即使事件消费者提前退出，生成器的收尾仍会请求取消、等待实际任务结束，而不是只丢掉事件队列。这就是新旧任务顺序执行的依据。`run_finish` 日志只能报告任务状态；它本身不能代替这条等待。Promise 完成也不表示 React 已经把屏幕重新画好，提交保护依靠会话里的占用状态。

停止后的去向取决于旧任务是否真正结束：

| 旧任务的情况 | 程序接下来怎么做 |
| --- | --- |
| 正常完成，或按取消请求结束 | 消息与事件收尾完成后，发送已保存的新要求 |
| 模型请求失败，或工具返回失败并使任务结束 | 保留真实错误与已有结果；运行入口处理错误并完成收尾后，仍可发送新要求 |
| 底层工具或请求一直不返回 | 继续等待旧任务，保留待发送文字，提交入口仍暂停；不会强开新任务 |

还有一个当前限制：普通任务错误由运行入口处理，但如果错误处理或界面收尾本身意外抛错，旧 Promise 也可能失败。当前打断函数没有单独的 `finally` 解除提交保护，因此可能留下暂停提交的状态，新要求也不会自动重发。保存的新文字只属于这次内存里的发送操作，输入框尚未清空；这不是持久的待发送记录。若等待期间已经退出会话，程序也不再启动新任务。

#### 停止与清理，不会把文件恢复原样

在本例里，即使测试进程已经退出、历史也写好了，`src/add.mjs` 仍可能保留旧任务完成或部分完成的修改。清理处理的是进程、监听、事件队列和界面占用；**文件回滚还需要原内容，以及确认当前内容可以被恢复覆盖的依据。** 停止命令也不能收回它已经发出的网络请求。

第六章的 `edit_file` 已有一层保护：写入前复核目标身份与正文，先把修改前内容保存到系统临时目录，备份成功才清空目标并写入新内容。备份失败时不会开始改文件，但备份成功不等于取消时自动还原；如果取消使工具没有返回完整结果，备份位置也可能没有传到界面。新文件的 `write_file` 还可能留下部分内容，命令造成的修改也没有统一的恢复记录。

第十四章计划把文件检查点与恢复接入会话：记住目标身份、原内容、本次实际修改后的内容或校验值，以及操作是否完成，再在恢复前核对当前文件。当前还没有这套持久索引和恢复入口，临时备份不能当作它的替代品。恢复前先核实文件有没有被后来的人或任务继续修改，才能避免旧备份覆盖新的工作。

下一节会让我们编辑、撤回或明确重新发送尚未收取的文字。

## 本节改动文件

本节增加本地队列与收取回调，再把补充确认和打断操作接到已有运行流程。

| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/agent/run-options.ts](src/agent/run-options.ts) | 声明核心收取补充与检查剩余项的接口 |
| CHANGED | [src/agent/events.ts](src/agent/events.ts) | 用 input_applied 报告补充已加入请求上下文 |
| NEW | [src/ui/tui/input-queue.ts](src/ui/tui/input-queue.ts) | 保存稳定 ID、文字和所属 run，按 run 收取 |
| CHANGED | [src/agent/agent-loop.ts](src/agent/agent-loop.ts) | 请求前收取补充，最终回答边界仍检查剩余项 |
| CHANGED | [src/ui/tui/state.ts](src/ui/tui/state.ts) | 显示补充已加入哪次请求上下文 |
| CHANGED | [src/ui/teaching-trace.ts](src/ui/teaching-trace.ts) | 在过程记录中说明补充的生效位置 |
| CHANGED | [src/ui/tui/app.tsx](src/ui/tui/app.tsx) | Enter 排队，Ctrl+S 等旧轮结束后发送草稿 |

## 动手构建

从 12.3 的完整 `src/` 继续，目标目录为 `chapter-12-task-control/04-live-input/`。先写本地队列与收取接口，再修改核心的模型请求边界，最后连接 TUI 的 Enter 和 Ctrl+S。

以下代码是本节新增文件或明确替换片段。每一步先说明范围，再展开完整代码；没有列出的函数与文件继续沿用。

### 声明核心收取补充与检查剩余项的接口

完整替换 `src/agent/run-options.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：run-options.ts</summary>

<!-- source: src/agent/run-options.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] agent/run-options.ts
 *
 * 学习目标：把本节的运行控制数据交给核心，界面不需要代替核心作决策。
 * 输入：本地入口选定的模式、会话清单、问答 handler 与本轮队列回调。
 * 输出：RunOptions 描述这一轮允许使用的控制入口；这里只定义类型，不执行任务。
 * 状态：模式由启动入口取快照；清单属于会话，补充的收取回调只绑定当前轮。
 * 本文件数据关系（全局主流程见 agent/agent-loop.ts）：
 *   本地界面 -> 本轮选项 -> 核心 / 工具 / 模型请求
 * 缺少可选入口时采用默认模式或不提供对应交互；类型声明不能代替运行时校验。
 * 运行观察：不同界面传入同样的选项，核心仍使用同一条模型与工具循环。
 */
// [KEEP 来自 12.1] 模式由本地运行入口选择，默认继续执行。
/**
 * 本地入口可选的两种运行模式。
 * plan 只调查和制定计划；execute 仍需遵守每次工具的权限与审批。
 */
export type ExecutionMode = "plan" | "execute";

// [KEEP 来自 12.2] 容器由会话持有，切换模式和开始新一轮不会丢失任务清单。
/**
 * 清单中的一个步骤和模型报告的进度。
 * ID 用来辨认条目，状态不是测试证明；数量和字段限制由 todo_write 运行时检查。
 */
export type TaskItem = {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
};
/**
 * 会话持有的可替换清单容器。
 * 工具先校验完整新数组再替换 items，失败时旧数组继续使用。
 */
export type TaskState = { items: TaskItem[] };

// [KEEP 来自 12.3] 答案只交回正在等待的工具调用；null 表示用户未回答。
/**
 * 这次澄清要显示的问题与选项。
 * 选项可为空，用户仍可自由回答；内容约束由 ask_user 检查。
 */
export type UserQuestion = { question: string; choices: string[] };
/**
 * 界面提供的专用问答等待入口。
 * 返回有效答案或表示未回答的 null；取消和显示失败可拒绝 Promise。
 */
export type QuestionHandler = (request: UserQuestion, signal: AbortSignal) => Promise<string | null>;

// [CHANGED 12.4] ID 用于界面确认哪条补充已被核心收取。
// [CHANGED 12.4] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 核心实际收取的一条补充。
 * ID 供界面确认哪条已加入上下文；所属轮由界面回调闭包固定。
 */
export type QueuedInput = { id: number; text: string };

// [CHANGED 12.4] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 把这一轮使用的模式、会话状态和可用控制入口放在一起。
 * 省略可选项时使用默认模式或缺省交互；回调仅负责本轮，不能把旧轮补充带进新轮。
 */
export type RunOptions = {
  // [KEEP 来自 12.1] 本轮模式由本地入口取快照。
  mode?: ExecutionMode;
  // [KEEP 来自 12.2] 清单容器跨模型请求和工具调用共用。
  tasks?: TaskState;
  // [KEEP 来自 12.3] 问答是被工具等待的控制入口，观察事件不能替代它。
  askUser?: QuestionHandler;
  // [CHANGED 12.4] 由核心请求前主动收取，保持当前轮 FIFO 顺序。
  takePendingInputs?: () => QueuedInput[];
  // [CHANGED 12.4] 最终回答后只检查是否待处理，不提前移出队列。
  hasPendingInputs?: () => boolean;
};
```

</details>

### 用 input_applied 报告补充已加入请求上下文

完整替换 `src/agent/events.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：events.ts</summary>

<!-- source: src/agent/events.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] agent/events.ts
 *
 * 学习目标：在任务运行中补充要求，或打断后发送新要求；本文件负责传递已经发生的模型、权限和工具事件。
 * 输入：runAgent 的开始/结束通知，或 Agent Loop 已发生的过程事件。
 * 输出：可选观察者同步收到一份深拷贝；没有观察者或通知失败时直接返回。
 * 状态：复制事件不修改历史；观察者直接抛错被捕获，但耗时和显式取消不由这里隔离。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] run_start / run_finish 与已有过程事件 -> 有观察者？-- 否 -> 返回
 *                                                                +-- 是 -> structuredClone
 *   复制成功？-- 否 -> 捕获异常 -> 返回
 *             +-- 是 -> 调用观察者 -> 成功 / 抛错 -> 返回
 *
 * run_finish 的 completed 带 Reply，cancelled/error 带说明；model_finish 仍只描述一次模型调用。
 * 观察者只接收事件，审批 handler 才是核心等待的控制入口，事件本身不能授予权限。
 * 深拷贝只保护原对象，不隐藏参数或正文里的敏感信息，也不会把同步回调变成独立线程。
 *
 * [CHANGED 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：一个 run_start 到一个 run_finish 之间，可以包含多次 model_start/model_finish。
 */

// [KEEP 来自 08.2] 事件展示统一结束原因。
import type { ModelFinishReason, Reply } from "../models/client.js";
import type { ToolCall } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { ApprovalResponse, PermissionDecision } from "../permissions/policy.js";

// [KEEP 来自 08.1] 原有观察通道增加文字片段，TUI 与文本界面可消费同一种事件。
// [KEEP 来自 09.1] 整轮任务开始与结束也使用事件通知。
// [CHANGED 12.4] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
export type AgentEvent =
  | { type: "run_start" }
  | { type: "run_finish"; outcome: "completed"; reply: Reply }
  | { type: "run_finish"; outcome: "cancelled" | "error"; message: string }
  | { type: "text_delta"; call: number; text: string }
  // [CHANGED 12.4] 核心收取确认带补充 ID、文字和请求次数，不使用工具 sequence。
  | { type: "input_applied"; id: number; text: string; call: number }
  | {
      type: "model_start";
      call: number;
      contextMessages: number;
      trigger: { kind: "user"; content: string } | { kind: "tool_results"; count: number };
    }
  | {
      type: "model_finish";
      call: number;
      // [KEEP 来自 08.2] 停止生成不一定代表回答完成。
      outcome: "tools" | "final" | "empty" | "incomplete";
      finishReason: ModelFinishReason;
      toolRequests: number;
      text: string;
    }
  | { type: "permission_check"; sequence: number; call: ToolCall; decision: PermissionDecision }
  // [KEEP 来自 06.1] 成功事件只额外保存 previewChars，不复制完整预览；原始 call 仍可能包含完整参数。
  // 消费者仍需选择展示字段；不能因为某项只给出字符数，就认为整个事件已经脱敏。
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      previewChars: number;
    }
  | {
      type: "tool_prepare";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    }
  // [KEEP 来自 06.1] 观察者只知道是否有预览；完整文件 diff 或命令预览由审批适配器展示。
  | {
      type: "approval_start";
      sequence: number;
      call: ToolCall;
      scope: string;
      allowSession: boolean;
      hasPreview: boolean;
    }
  | { type: "approval_finish"; sequence: number; call: ToolCall; response: ApprovalResponse }
  | { type: "tool_start"; sequence: number; call: ToolCall }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "success";
      result: ToolExecutionResult;
    }
  | {
      type: "tool_finish";
      sequence: number;
      call: ToolCall;
      outcome: "error";
      error: string;
    };

export type AgentObserver = (event: AgentEvent) => void;

/**
 * 把已经产生的事件副本交给观察者，捕获观察者直接抛出的异常。
 *
 * - 输入：可选观察者，以及 runAgent 或 Agent Loop 刚刚产生的结构化事件。
 * - 输出：观察者存在时同步收到一份深拷贝；不存在时直接返回。
 * - 关键原因：structuredClone 防止观察者通过事件对象修改原工具请求或结果。
 * - 失败方式：拷贝失败或观察者直接抛错时在这里结束通知，不把该异常继续抛给核心。
 * - 职责边界：拷贝不隐藏敏感信息，也不隔离耗时；观察者显式触发取消信号仍会影响本轮执行。
 */
export function emitAgentEvent(observer: AgentObserver | undefined, event: AgentEvent): void {
  try {
    if (observer) observer(structuredClone(event));
  } catch {
    // 这里只捕获通知过程抛出的异常；观察者触发的取消信号仍由执行链正常处理。
  }
}
```

</details>

### 保存稳定 ID、文字和所属 run，按 run 收取

创建 `src/ui/tui/input-queue.ts`。这是本节的新模块，完整实现如下。

<details>
<summary>创建文件：input-queue.ts</summary>

<!-- source: src/ui/tui/input-queue.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [NEW] ui/tui/input-queue.ts
 *
 * 学习目标：把运行中的补充按入队顺序保存，供当前轮在请求模型前取出。
 * 输入：补充文字、所属 run、会话队列。
 * 输出：入队条目带 ID；收取返回当前轮文字，其他轮的条目仍留在队列。
 * 状态：最多 20 项，每项原文最多 32000 个 UTF-16 单元；校验失败不提交修改。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   enqueue -> 文字有效且未满？-- 否 -> 抛错；是 -> 分配递增 ID、追加末尾
 *   take(run) -> 按原顺序选当前轮 -> 从队列移出 -> 返回 ID、文字；其他轮保留
 * 收取与模型请求由核心控制；入队不等于生效，旧轮剩余项不会自动进入新轮。
 * 运行观察：连续补充按原顺序收取，已移出的条目不再出现在待发送队列。
 */
// [NEW 12.4] 本文件以下类型声明均为本节新增。
// [NEW 12.4] 队列由会话持有；run 限定补充只能交给所属轮。
// [NEW 12.4] ID 在会话内递增，run 记录补充所属任务，文字只在未收取时保存在这里。
export type QueueEntry = { id: number; text: string; run: number };
export type InputQueue = { items: QueueEntry[]; nextId: number };
export const MAX_QUEUE_ITEMS = 20;
export const MAX_QUEUE_TEXT = 32_000;

/**
 * 为这次会话创建空的补充队列。
 * 条目按入队顺序保存，ID 从 1 开始递增；新一轮不重新创建这份队列。
 */
export function newInputQueue(): InputQueue { return { items: [], nextId: 1 }; }
/**
 * 检查一份补充或队列编辑稿，返回去掉首尾空白后的文字。
 * 空白和原文超过 32000 个 UTF-16 单元时抛错；长度检查使用原文，队列尚未改变。
 */
export function validateQueuedText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error("补充内容不能为空。");
  if (text.length > MAX_QUEUE_TEXT) throw new Error(`补充内容最多 ${MAX_QUEUE_TEXT} 个 UTF-16 单元。`);
  return value;
}
/**
 * 把有效补充追加到所属轮的队列末尾。
 * 先检查文字和最多 20 项的容量，再分配递增 ID；run 由当前任务入口提供。
 * 返回新条目，入队只表示等待核心收取；失败不占用 ID，也不清调用方草稿。
 */
export function enqueueInput(queue: InputQueue, text: string, run: number): QueueEntry {
  const value = validateQueuedText(text);
  if (queue.items.length >= MAX_QUEUE_ITEMS) throw new Error(`最多保留 ${MAX_QUEUE_ITEMS} 条待发送补充，请先处理队列。`);
  const entry = { id: queue.nextId++, text: value, run };
  queue.items.push(entry);
  return entry;
}
/**
 * 检查指定轮是否仍有未收取的补充。
 * 只返回布尔值，不移出条目；用于最终回答之后决定是否还有一次继续决策的机会。
 */
export function hasPendingInputs(queue: InputQueue, run: number): boolean {
  return queue.items.some((entry) => entry.run === run);
}
/**
 * 一次取走当前轮的全部补充，保持它们原来的入队顺序。
 * 输入是会话队列和绑定的 run；先选出这一轮，再保留其他轮的条目。
 * 返回 ID 与文字；空数组表示本轮没有补充。核心把它们加入请求上下文后才发收取事件。
 * 旧轮条目仍保留，调用方不能换成新轮编号去自动收取。
 */
export function takePendingInputs(queue: InputQueue, run: number): { id: number; text: string }[] {
  // [NEW 12.4] 过滤保留原数组顺序，当前轮按 FIFO 收取，其他轮仍留存。
  const selected = queue.items.filter((entry) => entry.run === run);
  queue.items = queue.items.filter((entry) => entry.run !== run);
  return selected.map(({ id, text }) => ({ id, text }));
}
```

</details>

### 请求前收取补充，最终回答边界仍检查剩余项

在 `src/agent/agent-loop.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `agentLoop()`。

<details>
<summary>agent-loop.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/agent/agent-loop.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] agent/agent-loop.ts
 *
 * 学习目标：在任务运行中补充要求，或打断后发送新要求，并看清这些控制能力接在模型与工具循环的哪里。
 * 输入：问题、已有模型历史、取消信号、观察者、审批入口，以及本轮模式和本地控制选项。
 * 输出：完成时返回回答并提交本轮历史；中断时补齐工具状态、保存中断说明后抛错。
 * 状态：进入前已取消就不新增历史；清单由会话持有，已经发生的工具操作不会随取消撤销。
 *
 * 全局主流程（从这里进入各模块）：
 *   CLI -> 帮助 / 版本 / 诊断？-- 是 -> 显示后结束
 *                            +-- 否 -> 检查输出方式和模式 -- 无效 -> 错误结束
 *                                                         +-- 有效 -> 配置、模型、消费者
 *   [KEEP 来自 10.4] auto：交互连续输入 -> TUI；单次问题或管道 -> text
 *   输入界面 -> 草稿 / 历史浏览 / 外部编辑 -> 等用户提交
 *   [KEEP 来自 12.1] 空闲 /mode plan|execute -> 保存会话模式；新一轮取启动快照
 *   [CHANGED 12.4] TUI Enter -> 正在运行？-- 是 -> 校验补充 -> 记入当前轮 FIFO 队列
 *                                           +-- 否 -> 本地命令或新一轮问题
 *   [CHANGED 12.4] Ctrl+S -> 先保存新要求、锁住提交 -> abort 旧轮 -> 等旧 done
 *                   -> 已退出？-- 是 -> 结束；否 -> 新控制器、新一轮（旧队列留存）
 *   普通问题 -> streamAgentRun -> runAgent -> run_start -> 事件消费者
 *                                       +-> agentLoop -> 进入前已取消？-- 是 -> 抛错结束
 *                                                                   +-- 否 -> 建立本轮消息
 *   [KEEP 来自 12.1] 固定本轮模式 -> A
 *   [KEEP 来自 12.2] 本轮共用会话清单（未提供时创建本轮容器）
 *   A: [CHANGED 12.4] 取出当前轮全部补充，保持入队顺序 -> 加入本轮 user 消息
 *       -> input_applied 确认核心收取并加入上下文 -> 再查取消 -> 请求模型
 *      [KEEP 来自 12.1] models/client 按模式提示、筛选工具；本地策略仍负责真正禁止
 *      文字片段 -> 事件消费者；完整结果 -> 结束原因和工具数量一致？-- 否 -> X
 *                                                                        +-- 是 -> B
 *   B: 有工具请求？-- 否 -> 回答非空且未取消？-- 否 -> X
 *                  |                         +-- 是 -> 保存 assistant 回答
 *                  |  [CHANGED 12.4] 仍有补充且未到第 8 次？-- 是 -> A（继续决策）
 *                  |                                              +-- 否 -> 提交历史、返回回答
 *                  |  次数已用完时不取走剩余补充，界面队列仍保留
 *                  +-- 是 -> 已到第 8 次？-- 是 -> X（不执行这批工具）
 *                                       +-- 否 -> 保存 assistant 调用 -> C
 *   C: [KEEP 来自 12.1] 权限策略 -> Plan 的写入 / 编辑 / 命令？-- 是 -> 拒绝结果 -> D
 *                                                             +-- 否 -> 原有 deny / ask / allow
 *      deny -> 拒绝结果 -> D；ask -> 准备预览 -- 失败 -> 错误结果 -> D
 *                                        +-- 成功 -> 等本次审批 -- 拒绝 -> 拒绝结果 -> D
 *                                                             +-- 批准 -> 执行 -> D
 *      allow -> 注册表找到工具 -> 执行 -> D
 *        [KEEP 来自 12.2] todo_write -> 全部条目校验成功？-- 否 -> ToolError、旧清单不变
 *                                                     +-- 是 -> 一次替换内存清单 -> D
 *        [KEEP 来自 12.3] ask_user -> 校验问题 -> 专用 handler 等回答
 *                            -> 回答有效且未取消？-- 是 -> 原调用的 tool result -> D
 *                                                +-- 否 -> ToolError 或取消 -> D / X
 *                            TUI 面板独占输入；旧请求结束后旧回调失效
 *   D: 保存工具正文与错误标记 -> 发过程事件 -> 本批还有调用？-- 是 -> C
 *                                                                +-- 否 -> A
 *      [KEEP] 一批调用全部有结果后才回到下一次模型请求
 *      清单的 completed 是模型报告的进度；测试是否通过仍要看实际命令结果
 *   X: 错误 / 取消 / 次数耗尽 -> 补齐缺少的工具结果 -> 保存历史与本地说明 -> 抛错
 *   runAgent -> run_finish completed / cancelled / error -> 同一事件流
 *   事件流 -> text：正文 stdout、过程 stderr；jsonl：逐条 JSON、等写入回调
 *          +-> TUI：RunView -> 完整显示条目 -> 历史视口
 *   [KEEP] 审批：交互 text 或 TUI 等明确决定；jsonl / 非交互环境拒绝待确认请求
 *   [KEEP] Ctrl+C：忙碌取消当前轮并等清理；空闲退出；退出先封住提交再等任务清理
 *   [KEEP] 事件队列超限 / 提前停止消费 -> 取消同一轮、等待模型与工具清理
 *
 * 图中带当前编号的是本节增量；KEEP 表示已经建立的能力。
 * 普通事件最多暂存 128 条，结束事件另有位置；这是事件条数限制，不是总字节内存上限。
 * 工具结果仍给模型，界面只处理显示副本；模式选择、澄清答案和聊天文字都不能产生批准。
 * 运行观察：补充先显示排队，下一次请求前才确认核心收取；打断会等旧轮清理。
 */

import { ToolError, UserFacingError } from "../errors.js";
import type { Message, Model, Reply } from "../models/client.js";
import { decideToolPermission, type ApprovalHandler } from "../permissions/policy.js";
import { executePreparedTool, executeTool, prepareTool } from "../tools/registry.js";
import type { PreparedToolCall } from "../tools/types.js";
import { emitAgentEvent, type AgentObserver } from "./events.js";
import type { RunOptions } from "./run-options.js";
```

**替换 agentLoop：**

<!-- source: src/agent/agent-loop.ts -->
```ts
/**
 * 让模型读到问题和真实工具结果，继续决策直到本轮完成或中断。
 * 进入前先检查取消；本轮模式在入口固定，模型提示与权限策略都使用它。
 * 清单容器在这轮工具之间共用；工具完整校验后更新内存，核心不从回答文字推断进度。
 * 每次模型请求前取出当前轮 FIFO 补充，加入本轮消息；上一批工具先全部产生结果。
 * 最终回答后还有补充且未用尽 8 次请求时继续；用尽次数不收取剩余补充。
 * 每个工具先过权限，写入与命令先准备再审批；拒绝和 ToolError 也回给原调用。
 * ask_user 通过注册表等待专用 handler，答案仍是该次工具结果。
 * 成功提交完整本轮消息并返回回答；开始后中断则补齐工具结果、保存说明，再抛出原因。
 * 本函数不会撤销已执行的操作，也不会把聊天、问答或模型承诺当成批准。
 */
// [KEEP 来自 08.3] 本轮中断后保存完整工具状态，下一轮使用新的取消信号继续。
// [CHANGED 12.4] 核心接入本节控制选项；相互分开的新分支在下方另作标记。
export async function agentLoop(
  model: Model,
  history: Message[],
  input: string,
  signal: AbortSignal,
  observer?: AgentObserver,
  requestApproval?: ApprovalHandler,
  // [KEEP 来自 05.3] Set 由终端持有，Agent Loop 在用户输入 s 后写入批准记录。
  sessionGrants: Set<string> = new Set(),
  // [KEEP 来自 12.1] 增加本轮控制选项；调用方把模式快照传到核心。
  options: RunOptions = {},
): Promise<Reply> {
  signal.throwIfAborted();
  // [KEEP 来自 12.1] 本轮模式在循环前固定，后面的请求和策略共用它。
  const mode = options.mode ?? "execute";
  // [KEEP 来自 12.2] 未提供会话容器时，本轮仍能使用同一份任务清单。
  // [KEEP 来自 12.2] 所有清单工具共用同一份容器，未传入时在本轮创建。
  const toolOptions: RunOptions = { ...options, tasks: options.tasks ?? { items: [] } };
  const turn: Message[] = [{ role: "user", content: input }];
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let truncated = false;
  let toolSequence = 0;
  let pendingToolResults = 0;

  // [KEEP 来自 08.3] 中断时区分“已开始但没结果”和“尚未开始”的调用。
  let executingCallId: string | undefined;
  try {
    for (let modelCall = 1; modelCall <= MAX_MODEL_CALLS; modelCall += 1) {
      // 每次请求都由核心主动检查取消，不能依赖具体 Model 实现自行处理 signal。
      signal.throwIfAborted();

      // [CHANGED 12.4] 每次请求前收取当前轮 FIFO 补充；上一批调用已有完整工具结果。
      for (const queued of options.takePendingInputs?.() ?? []) {
        turn.push({ role: "user", content: queued.text });
        // [CHANGED 12.4] 此事件只确认核心已收取并加入本次上下文，不保证远端收到。
        emitAgentEvent(observer, { type: "input_applied", ...queued, call: modelCall });
      }
      signal.throwIfAborted();
      emitAgentEvent(observer, {
        type: "model_start",
        call: modelCall,
        contextMessages: history.length + turn.length,
        trigger: modelCall === 1
          ? { kind: "user", content: input }
          : { kind: "tool_results", count: pendingToolResults },
      });
      pendingToolResults = 0;
      // [KEEP 来自 08.1] 增量成为观察事件，不提前执行工具，也不把半句回答写入历史。
      // [KEEP 来自 12.1] 模型请求也接收本轮模式；工具隐藏只是辅助。
      const result = await model.generate([...history, ...turn], signal, (text) => {
        if (!signal.aborted) emitAgentEvent(observer, { type: "text_delta", call: modelCall, text });

      }, { mode });
      inputTokens = addUsage(inputTokens, result.inputTokens);
      outputTokens = addUsage(outputTokens, result.outputTokens);
      truncated ||= result.truncated;
      emitAgentEvent(observer, {
        type: "model_finish",
        call: modelCall,
        // [KEEP 来自 08.2] 长度上限和拒绝不会伪装成成功回答。
        finishReason: result.finishReason,
        outcome: !["stop", "tool_calls"].includes(result.finishReason) ? "incomplete"
          : result.toolCalls.length > 0 ? "tools" : result.text.trim() ? "final" : "empty",
        toolRequests: result.toolCalls.length,
        text: result.text,
      });

      // [KEEP 来自 08.2] 正常结束与工具数量必须一致，完整响应才允许进入权限判断。
      if (result.finishReason === "length") throw new UserFacingError("回答达到输出上限，本次响应未完成；其中的工具请求不会执行。");
      if (result.finishReason === "refusal") throw new UserFacingError("模型拒绝了本次请求，本次响应中的工具请求不会执行。");
      if (result.finishReason !== (result.toolCalls.length ? "tool_calls" : "stop")) {
        throw new UserFacingError("模型结束原因与内容不一致，或当前接口返回了不支持的结束原因。");
      }
      if (result.toolCalls.length === 0) {
        if (!result.text.trim()) throw new UserFacingError("模型没有返回可用的最终回答。");
        signal.throwIfAborted();
        turn.push({ role: "assistant", content: result.text });

        // [CHANGED 12.4] 最终回答后仍有补充且有请求预算就继续；第 8 次后的剩余条目保留。
        if (modelCall < MAX_MODEL_CALLS && options.takePendingInputs && options.hasPendingInputs?.()) continue;
        history.push(...turn);
        return { text: result.text, inputTokens, outputTokens, truncated };
      }

      // 最后一次模型机会仍要求工具时，结果已不可能再反馈给模型，因此不执行无用操作。
      if (modelCall === MAX_MODEL_CALLS) break;

      turn.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        signal.throwIfAborted();
        toolSequence += 1;
        // [KEEP 来自 12.1] 每次请求仍经过本地模式检查，不能靠模型工具列表保证禁止。
        const permission = await decideToolPermission(call, sessionGrants, undefined, mode);
        emitAgentEvent(observer, {
          type: "permission_check",
          sequence: toolSequence,
          call,
          decision: permission,
        });
        let rejection: string | null = null;
        let prepared: PreparedToolCall | null = null;
        // [KEEP 来自 08.3] 权限检查期间也可能收到取消。
        signal.throwIfAborted();
        if (permission.action === "deny") rejection = `权限拒绝：${permission.reason}`;
        if (permission.action === "ask") {
          try {
            // [KEEP 来自 06.1] prepareTool 只检查并准备预览，不写文件，也不启动命令。
            prepared = await prepareTool(call, signal);
          } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            turn.push({
              role: "tool",
              toolCallId: call.id,
              content: `工具准备失败：${error.message}`,
              isError: true,
            });
            pendingToolResults += 1;
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "error",
              error: error.message,
            });
            continue;
          }
          if (prepared) {
            emitAgentEvent(observer, {
              type: "tool_prepare",
              sequence: toolSequence,
              call,
              outcome: "success",
              previewChars: prepared.preview.length,
            });
          }
          emitAgentEvent(observer, {
            type: "approval_start",
            sequence: toolSequence,
            call,
            scope: permission.scope,
            allowSession: permission.remember,
            hasPreview: prepared !== null,
          });
          const response = requestApproval
            ? await requestApproval({
                call,
                reason: permission.reason,
                resource: permission.resource,
                scope: permission.scope,
                allowSession: permission.remember,
                ...(prepared ? { preview: prepared.preview } : {}),
              }, signal)
            : { decision: "deny" as const, reason: "当前运行方式无法请求用户批准" };
          // [KEEP 来自 08.3] 用户取消不保存刚刚返回的会话授权。
          signal.throwIfAborted();
          emitAgentEvent(observer, {
            type: "approval_finish",
            sequence: toolSequence,
            call,
            response,
          });
          // [KEEP 来自 06.1] 写入和命令批准都不能保存；只有可复用的读取范围进入 Set。
          if (response.decision === "allow_session") {
            if (permission.remember) sessionGrants.add(permission.scope);
            // [KEEP 来自 07.1] 写入与命令都只能批准当前操作。
            else rejection = "当前批准只适用于这一次操作预览";
          }
          if (response.decision === "deny") rejection = `用户未批准工具执行：${response.reason}`;
        }
        if (rejection) {
          turn.push({ role: "tool", toolCallId: call.id, content: rejection, isError: true });
          pendingToolResults += 1;
          continue;
        }
        // [KEEP 来自 08.3] 审批后的取消必须在真实工具启动之前生效。
        signal.throwIfAborted();
        executingCallId = call.id;
        emitAgentEvent(observer, { type: "tool_start", sequence: toolSequence, call });
        try {
          // [KEEP 来自 04.1] 同一个取消信号继续穿过注册表，文件遍历和读取才能响应取消。
          // [KEEP 来自 06.1] 已准备的 execute 保存了用户刚刚审查的文件修改或命令。
          // [KEEP 来自 12.2] 直接工具收到本轮共用选项，清单更新使用同一个容器。
          const result = prepared
            ? await executePreparedTool(prepared, signal)
            : await executeTool(call, signal, toolOptions);
          // [KEEP 来自 07.1] 非零退出码表示本次命令失败，保留输出供模型决定下一步。
          turn.push({ role: "tool", toolCallId: call.id, content: result.content, isError: result.isError ?? false });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallId = undefined;
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "success",
            result,
          });
        } catch (error) {
          // [KEEP 来自 03.3] 预期内的工具错误回到循环；编程错误、系统异常仍交给外层处理。
          if (!(error instanceof ToolError)) throw error;
          turn.push({
            role: "tool",
            toolCallId: call.id,
            content: `工具执行失败：${error.message}`,
            isError: true,
          });
          // [KEEP 来自 08.3] 已经返回的工具结果保留；取消不会撤销真实副作用。
          executingCallId = undefined;
          pendingToolResults += 1;
          emitAgentEvent(observer, {
            type: "tool_finish",
            sequence: toolSequence,
            call,
            outcome: "error",
            error: error.message,
          });
        }
      }
    }

    throw new UserFacingError(`Agent 连续请求模型 ${MAX_MODEL_CALLS} 次仍未得到最终回答，已停止本轮。`);
  } catch (error) {
    // [KEEP 来自 08.3] 保存完整调用及其状态；未收齐的模型输出从未进入 turn。
    // 每个批次单独配对：后续模型请求即使复用同一个 ID，也不能借用前一批的完成记录。
    const lastBatch = turn.map((message) => message.role === "assistant" && Boolean(message.toolCalls?.length)).lastIndexOf(true);
    const completed = new Set(turn.slice(lastBatch + 1).filter((message) => message.role === "tool").map((message) => message.toolCallId));
    for (const message of lastBatch < 0 ? [] : [turn[lastBatch]]) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        if (completed.has(call.id)) continue;
        turn.push({ role: "tool", toolCallId: call.id, isError: true,
          content: call.id === executingCallId
            ? "操作已开始，但本轮中断前没有取得完整结果。可能已发生部分修改，请先核实当前文件或进程状态，不要直接重试。"
            : "本轮在该工具启动前中断，这个调用未执行。" });
        completed.add(call.id);
      }
    }
    // 这条状态由本地程序生成，明确标注来源，不把它冒充模型完成的回答。
    // [KEEP 来自 09.2] 按取消原因写入本地状态；队列或输出故障是错误，普通取消才记为取消。
    const cancelled = signal.aborted && !(signal.reason instanceof UserFacingError);
    turn.push({ role: "assistant", content: cancelled
      ? "[本地状态] 本轮已取消。已执行的操作不会自动撤销；继续前先核实工具结果。"
      : "[本地状态] 本轮因错误中断。已执行的操作不会自动撤销；继续前先核实工具结果。" });
    history.push(...turn);
    throw error;
  }
}
```

</details>

### 显示补充已加入哪次请求上下文

完整替换 `src/ui/tui/state.ts`。本文件较短，下面给出完整替换文件，保留沿用部分。

<details>
<summary>完整替换文件：state.ts</summary>

<!-- source: src/ui/tui/state.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] ui/tui/state.ts
 *
 * 学习目标：在任务运行中补充要求，或打断后发送新要求；本文件负责把已收到的事件累积成界面状态。
 * 输入：上一份 RunView 与下一条 AgentEvent；事件按 streamAgentRun 的顺序送达。
 * 输出：新的显示状态，或本轮结束后留在终端的文字记录；本文件没有终端写入和执行副作用。
 * 状态：更新时返回新对象，不修改传入状态或模型历史；失败与取消只改变显示中的结束状态。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   事件 -> run_start？-- 是 -> 空白本轮状态
 *                      +-- 否 -> 模型事件？-- 是 -> 按 call 更新文字与阶段
 *                                         +-- 否 -> run_finish？-- 是 -> 写结束状态与用量
 *                                                              |       非 completed 时标记未结束工具为已中断
 *                                                              +-- 否 -> 按 sequence 新建或替换工具行
 *   工具完成 -> 保存完整结果的显示副本 -> 历史区折叠或展开；本轮结束 -> 留存记录
 *
 * 模型的 call 和工具的 sequence 各有用途；都不能替代事件外壳中的送达序号。
 * answers 保存本轮已经收到的文字，画面只显示末尾是 app.tsx 的选择，不在这里丢弃文字。
 * 工具完成前 detail 保存过程摘要，完成后保存完整结果的显示副本，供历史区按需展开。
 * 显示副本经过控制字符处理；模型历史仍由核心保存，不能用 RunView 替代。
 *
 * [CHANGED 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：工具批准、执行、完成各有状态；取消后尚未结束的工具不再显示为执行中。
 */
import type { AgentEvent } from "../../agent/events.js";
import { formatTeachingTrace } from "../teaching-trace.js";

// [KEEP 来自 10.2] RunView 继续保存显示数据，不替代模型历史。
export type RunView = {
  status: string;
  answers: { call: number; text: string }[];
  tools: { sequence: number; name: string; status: string; detail: string }[];
  usage: string;
};

/**
 * 为新一轮任务建立独立的显示状态。
 *
 * - 输入：无参数；调用方在开始任务或收到 run_start 时使用。
 * - 输出：状态为“执行中”，文字、工具和用量均为空的全新对象。
 * - 关键原因：每轮模型调用号和工具步骤号会重新计数，旧数组不能带进下一轮。
 */
export function emptyRunView(): RunView {
  return { status: "执行中", answers: [], tools: [], usage: "" };
}

/**
 * 把终端控制字符显示成可见文字，同时保留正文的换行。
 *
 * - 输入：模型、工具或用户提供的显示文本；这些内容不能直接取得终端控制能力。
 * - 输出：被处理的控制字符写成可见的反斜杠 u 加四位十六进制，制表符显示为四个空格。
 * - 关键原因：直接删除字符会让预览看不出原文含有什么；可见转义保留了这项信息。
 * - 职责边界：只生成显示副本，不改模型历史、待写入正文或审批请求，也不做凭据脱敏。
 */
export function screenText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).replace(/\t/g, "    ");
}

/**
 * 根据一条已发生的事件，返回下一份画面数据。
 *
 * - 输入：上一份 RunView 和有序送达的事件；model_start 必须先于该次文字增量。
 * - 输出：保留旧内容并更新相关字段的新对象，调用方再把它交给 React 显示。
 * - 文字处理：按模型 call 追加片段；没有收到片段时，用 model_finish 的完整文字补齐。
 * - 工具处理：按工具 sequence 更新状态；完成前显示摘要，tool_finish 后保存完整结果的显示副本，不从正文猜测成功或失败。
 * - 结束处理：只有 completed 记录用量；错误或取消把尚未结束的工具标为“已中断”。
 * - 职责边界：这里只处理显示副本，不发起网络请求、不执行工具，也不替用户作出审批决定。
 */
// [CHANGED 12.4] 显示状态识别本节新增事件，不从正文猜执行情况。
export function updateRunView(view: RunView, event: AgentEvent): RunView {
  if (event.type === "run_start") return emptyRunView();
  // [CHANGED 12.4] 用户补充没有工具 sequence。
  // [CHANGED 12.4] 补充确认先独立处理，它没有工具 sequence。
  if (event.type === "input_applied") return { ...view, status: `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文` };
  if (event.type === "model_start") return { ...view, status: `模型第 ${event.call} 次决策`, answers: [...view.answers, { call: event.call, text: "" }] };
  if (event.type === "text_delta") return { ...view, answers: view.answers.map((answer) => answer.call === event.call ? { ...answer, text: answer.text + screenText(event.text) } : answer) };
  // 有的 Model 实现不发送文字回调；只在尚无片段时补完整文字，避免重复一遍回答。
  if (event.type === "model_finish") return { ...view,
    status: event.outcome === "tools" ? `收到 ${event.toolRequests} 个工具请求` : "模型已返回，等待本轮结束",
    answers: view.answers.map((answer) => answer.call === event.call && !answer.text ? { ...answer, text: screenText(event.text) } : answer),
  };
  // run_finish 才结束整轮；异常结束后保留已完成的结果，只收束仍在等待或执行的状态。
  if (event.type === "run_finish") return { ...view,
    tools: event.outcome === "completed" ? view.tools : view.tools.map((tool) =>
      ["完成", "失败", "准备失败", "已拒绝"].includes(tool.status) ? tool : { ...tool, status: "已中断" }),
    status: event.outcome === "completed" ? "已完成" : event.outcome === "cancelled" ? "已取消本轮" : `运行失败：${screenText(event.message)}`,
    usage: event.outcome === "completed" ? `输入 ${event.reply.inputTokens ?? "未知"} / 输出 ${event.reply.outputTokens ?? "未知"} token` : "",
  };
  // 前面的分支已经处理整轮与模型事件；剩下的事件都有工具 sequence，可更新同一行。
  const old = view.tools.find((tool) => tool.sequence === event.sequence);
  const status = event.type === "permission_check" ? ({ allow: "允许", ask: "等待确认", deny: "已拒绝" }[event.decision.action])
    : event.type === "tool_prepare" ? event.outcome === "success" ? "预览已准备" : "准备失败"
    : event.type === "approval_start" ? "等待批准"
    : event.type === "approval_finish" ? event.response.decision === "deny" ? "已拒绝" : "已批准"
    : event.type === "tool_start" ? "执行中"
    : event.outcome === "error" || event.result.isError ? "失败" : "完成";
  // [KEEP 来自 11.3] 完成时保留完整工具正文的显示副本，折叠由历史区决定，不能在这里截成摘要。
  const tool = { sequence: event.sequence, name: screenText(event.call.name), status,
    detail: event.type === "tool_finish" ? screenText(event.outcome === "success" ? event.result.content : event.error) : old?.detail ?? formatTeachingTrace(event).join("\n") };
  return { ...view, status: `${tool.name}：${status}`, tools: old
    ? view.tools.map((item) => item.sequence === event.sequence ? tool : item)
    : [...view.tools, tool] };
}

/**
 * 把本轮显示数据整理成一条可留在终端滚动记录中的消息。
 *
 * - 输入：事件消费结束后的 RunView，包括各次模型文字、每个工具的当前详情和结束状态。
 * - 输出：用空行分隔的文字；没有正文的模型调用会跳过，结束状态始终保留。
 * - 关键原因：运行中的区域只显示少量末尾内容，结束后仍需保留本轮已收到的文字供回看。
 * - 职责边界：生成的文字不写入模型历史，也不是完整事件日志；当前界面通过 transcript.tsx 把同一份状态拆成可选择的消息。
 */
export function runTranscript(view: RunView): string {
  return [...view.answers.filter((answer) => answer.text).map((answer) => answer.text),
    ...view.tools.map((tool) => `工具 #${tool.sequence} ${tool.name}：${tool.status}\n${tool.detail}`),
    `状态：${view.status}${view.usage ? ` · ${view.usage}` : ""}`].join("\n\n");
}
```

</details>

### 在过程记录中说明补充的生效位置

在 `src/ui/teaching-trace.ts` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `formatTeachingTrace()`。

<details>
<summary>teaching-trace.ts 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/teaching-trace.ts -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] ui/teaching-trace.ts
 *
 * 学习目标：在任务运行中补充要求，或打断后发送新要求；本文件负责从结构化事件整理过程说明，保留模型正文的用途。
 * 输入：runAgent 与 Agent Loop 的结构化事件；输出：供终端打印的纯文本行数组。
 * 状态：本文件只生成显示字符串，不改变原事件、历史或审批决定。
 *
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   [KEEP] 事件 -> run_start / run_finish？-- 是 -> 空数组，结果由调用方处理
 *                                             +-- 否 -> text_delta？-- 是 -> 空数组，正文由 renderer 追加
 *                                                                   +-- 否 -> 按事件类型选择字段
 *   字段 -> 控制字符清理、常见凭据特征隐藏与长度限制 -> 返回文本行
 *
 * run_finish 只提供整轮结果，不需要再打印一次最终正文；model_finish 仍解释单次决策的结果。
 * 工具状态来自元数据，命令退出码非零是失败，stderr 有字不能单独证明失败。
 * stdout/stderr 摘要各保留前 240 个清理后字符，超出再加省略号，不改变交给模型的工具正文。
 * 常见凭据检测不等于完整脱敏；原始事件仍可能包含敏感内容，不能直接作为公开日志。
 *
 * [CHANGED 12.4] input_applied 表示核心已收取并加入本次请求上下文，不保证远端收到或需求完成。
 * 该事件没有工具 sequence，必须先于通用工具分支处理。
 * 运行观察：连续文字由 renderer 显示，准备、审批和工具结果仍各有简短步骤说明。
 */

import type { AgentEvent } from "../agent/events.js";
import { toolDefinitions, type ToolCall } from "../tools/registry.js";
import type { ToolResultMetadata } from "../tools/types.js";
```

**替换 formatTeachingTrace：**

<!-- source: src/ui/teaching-trace.ts -->
```ts
/**
 * 把一个结构化事件整理成终端能逐行显示的简短说明。
 *
 * - 输入：来自 runAgent 或 Agent Loop 的 AgentEvent。
 * - 输出：模型、权限和工具步骤返回纯文本行；run_start、run_finish 和 text_delta 返回空数组。
 * - 关键原因：整轮结果由调用方处理，文字片段由 renderer 追加，重复排版会把同一回答打印两次。
 * - 显示规则：工具状态来自元数据，参数与摘要经过字段筛选、控制字符处理和长度限制。
 * - 职责边界：常见凭据特征的隐藏不等于完整脱敏；这里只整理显示副本，不改变审批、执行或历史。
 */
// [CHANGED 12.4] 过程说明识别本节新增事件。
export function formatTeachingTrace(event: AgentEvent): string[] {
  // [KEEP 来自 09.1] 整轮事件供界面判断任务状态，不重复打印最终正文。
  if (event.type === "run_start" || event.type === "run_finish") return [];
  // [KEEP 来自 08.1] 连续文字由终端追加，不能每段都包装成一行日志。
  if (event.type === "text_delta") return [];
  // [CHANGED 12.4] 在通用工具分支前处理补充确认。
  // [CHANGED 12.4] 在工具分支前显示核心收取确认，不声称远端收到。
  if (event.type === "input_applied") return [`补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${toTraceText(event.text, 120)}`];
  if (event.type === "model_start") {
    const received = event.trigger.kind === "user"
      ? `新增用户问题「${toTraceText(event.trigger.content, 100)}」`
      : `新增 ${event.trigger.count} 条工具结果`;
    return [
      `模型 > 第 ${event.call} 次决策`,
      `  收到：${received}；Agent Loop 消息链共 ${event.contextMessages} 条。`,
    ];
  }

  if (event.type === "model_finish") {
    const result = event.outcome === "tools"
      ? `${event.toolRequests} 个工具请求。`
      // [KEEP 来自 08.2] 已经看到文字，也可能仍是未完成的响应。
      : event.outcome === "incomplete"
        ? `响应未完成（${event.finishReason}），本次响应中的工具不会执行。`
      : event.outcome === "final"
        ? "最终回答，交给终端显示。"
        : "空结果，本轮将停止并报告错误。";
    return [`模型 < 第 ${event.call} 次决策`, `  返回：${result}`];
  }

  if (event.type === "permission_check") {
    const tool = describeToolCall(event.call);
    const decision = event.decision.action === "allow"
      ? "允许执行"
      : event.decision.action === "ask"
        ? "需要用户确认"
        : "拒绝执行";
    return [
      `权限 < 第 ${event.sequence} 步：${tool.name}`,
      `  判断：${decision}；原因：${toTraceText(event.decision.reason, 100)}。`,
      ...(event.decision.action === "ask"
        ? [`  请求：${toTraceText(event.decision.resource)}；可批准范围：${toTraceText(event.decision.scope)}。`]
        : []),
    ];
  }

  // [KEEP 来自 07.1] 预览不再只代表文件修改，命令也走这个事件。
  if (event.type === "tool_prepare") {
    const tool = describeToolCall(event.call);
    return event.outcome === "success"
      ? [
          `准备 < 第 ${event.sequence} 步：${tool.name} 已生成操作预览`,
          `  结果：完整预览共 ${event.previewChars} 个字符；此时尚未执行。`,
        ]
      : [
          `准备 < 第 ${event.sequence} 步：${tool.name} 无法生成操作预览`,
          `  原因：${toTraceText(event.error, 100)}；错误将交回模型重新决策。`,
        ];
  }

  // [KEEP 来自 07.1] 当前预览可能是命令，也可能是文件 diff。
  if (event.type === "approval_start") {
    return [
      `审批 > 第 ${event.sequence} 步：等待用户决定`,
      event.hasPreview
        ? "  范围：只批准随后显示的这一次完整操作，不保存为会话权限。"
        : `  范围：${toTraceText(event.scope)}${event.allowSession ? "，可选择本次会话复用" : ""}。`,
    ];
  }

  if (event.type === "approval_finish") {
    const result = event.response.decision === "allow_once"
      ? "允许一次"
      // [KEEP 来自 05.3] 终端明确区分单次允许和会话允许。
      : event.response.decision === "allow_session"
        ? "允许本次会话"
        : "拒绝";
    return [
      `审批 < 第 ${event.sequence} 步：${result}`,
    ];
  }

  const tool = describeToolCall(event.call);
  if (event.type === "tool_start") {
    return [
      `工具 > 第 ${event.sequence} 步：${tool.name}`,
      `  执行：${tool.input}。`,
    ];
  }

  // [KEEP 来自 07.1] 测试失败有完整结果，不等于执行器自身抛出异常。
  const failed = event.outcome === "error";
  const commandFailed = !failed && event.result.isError;
  return [
    `工具 < 第 ${event.sequence} 步：${tool.name}${failed || commandFailed ? " 失败" : " 完成"}`,
    `  返回：${failed ? "执行失败" : describeToolResult(event.result.metadata)}。`,
    `  去向：${failed || commandFailed ? "错误与输出" : "结果"}已加入当前回合，下一次模型决策会收到。`,
  ];
}
```

</details>

### Enter 排队，Ctrl+S 等旧轮结束后发送草稿

在 `src/ui/tui/app.tsx` 中，先替换文件开头的教学说明与全部导入，再在原定义位置完整替换 `Session`、`TuiApp()`、`startTui()`。

<details>
<summary>app.tsx 的完整替换范围</summary>

**文件说明与全部导入：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 12.4 运行中补充与打断 | [CHANGED] ui/tui/app.tsx
 *
 * 学习目标：在任务运行中补充要求，或打断后发送新要求，让界面操作和本轮执行有清楚的先后关系。
 * 输入：模型、键盘、终端尺寸与执行事件；普通任务只在用户提交后启动。
 * 输出：草稿、历史、模式、运行状态和审批面板。
 * 状态：Session 持有会话数据和当前任务；React state 保存草稿、焦点与显示内容。
 * 失败：保留已收到的结果，等事件流清理后解除忙碌；取消不会撤销工具操作。
 *
 * 本文件局部流程（界面操作；全局主流程见 agent/agent-loop.ts）：
 *   startTui -> 创建 Session -> 注册监听 -> 挂载 TuiApp
 *   窗口至少 40 列、16 行？-- 否 -> 留存数据、暂停普通操作；是 -> 完整工作区
 *   草稿编辑 / 找回 / 补全 / 外部编辑 -> 更新草稿，尚未发送
 *   [KEEP 来自 12.1] 空闲 /mode -> 保存模式；开始任务 -> 固定本轮模式快照
 *   [CHANGED 12.4] 普通 Enter -> 忙碌？-- 是 -> 本地命令？-- 是 -> 保留草稿、提示等待
 *                                         +-- 否 -> 校验补充、加入当前轮队列、清草稿
 *                              +-- 否 -> 本地命令或 startRun
 *   [CHANGED 12.4] Ctrl+S -> 校验并保存新要求 -> clearing 锁住提交 -> abort 旧任务
 *                   -> await 旧 done -> closing？-- 是 -> 结束；否 -> startRun 新要求
 *   [KEEP 来自 12.2] 任务清单工具结果 -> 会话内清单 -> 摘要和至多三项进度
 *   [KEEP 来自 12.3] ask_user -> waitForAnswer -> 问答面板独占输入 -> 原问答 Promise
 *                   -> 回答 / Esc / 取消 -> 关闭面板，普通草稿继续保留
 *   [CHANGED 12.4] startRun -> 用当前 run 绑定收取回调 -> 事件流 -> input_applied 才显示生效
 *                   -> finally 等清理 -> 保留本轮未收取队列，下一轮不会自动使用它
 *   [KEEP] Ctrl+O -> 草稿 / 历史，审批或问答占用期间不切换
 *   [KEEP] 审批 -> waitForApproval -> 面板独占输入 -> 明确决定交回原调用
 *   [KEEP] Ctrl+C -> 有任务？-- 是 -> 取消、等清理；否 -> quit
 *   [KEEP] quit -> closing=true -> 取消并等待任务与外部编辑 -> 卸载、移除监听
 *
 * 显示条目、已发送问题和模型消息各有用途；编辑草稿不会自动改变模型上下文。
 * 清单进度是模型通过工具报告的状态；实际测试是否成功要看命令的结果。
 * 输入队列最多 20 项，每项最多 32000 个 UTF-16 单元；拒绝入队时保留草稿。
 * 运行观察：Enter 先显示排队；核心收取后才显示送入哪次请求。
 */
import { useState } from "react";
import { Box, Text, render, useInput, usePaste, useWindowSize, useApp } from "ink";
// [KEEP 来自 11.5] 颜色开关统一读取 NO_COLOR，文字状态始终保留。
import { useColor } from "./layout.js";
import { emptyRunView, updateRunView, screenText, type RunView } from "./state.js";
import { approvalPages, waitForApproval, type PendingApproval } from "./approval.js";
import TextInput from "ink-text-input";
import { QuestionPanel, waitForAnswer, type PendingQuestion } from "./questions.js";
// [CHANGED 12.4] 引入 input-queue 的本节类型或实现。
import { newInputQueue, enqueueInput, takePendingInputs, hasPendingInputs, validateQueuedText, type InputQueue } from "./input-queue.js";
import { DraftEditor, newDraft, changeDraft } from "./editor.js";
import { Transcript, runEntries, type Entry } from "./transcript.js";
import { editExternally } from "./system-actions.js";
import type { Message, Model } from "../../models/client.js";
import { streamAgentRun } from "../../agent/run-stream.js";
import { explainError } from "../../errors.js";
import type { ExecutionMode, TaskState } from "../../agent/run-options.js";
```

**替换 Session：**

<!-- source: src/ui/tui/app.tsx -->
```ts
// [KEEP 来自 10.1] Session 属于一次 startTui 调用，不随组件重新绘制而重建。
// [CHANGED 12.4] 类型新增本节使用的控制数据；各字段用途见紧邻说明。
/**
 * 当前 TUI 会话的控制与长期状态。
 * 模式供新一轮取快照；历史和只读授权在各轮之间复用。
 * 清单由会话持有，不因切换模式或取消一轮而重建。
 * 队列跨轮保留，所属轮由条目的 run 与收取回调限定；clearing 保护打断清理期间的提交。
 * controller 与 done 只描述当前轮，closing 阻止退出期间启动新任务。
 */
type Session = {
  // [KEEP 来自 12.1] 会话模式供下一轮启动取快照。
  mode: ExecutionMode;
  // [KEEP 来自 12.2] 会话清单独立于单轮控制器。
  tasks: TaskState;
  // [CHANGED 12.4] 补充队列跨轮保留，条目各自记所属轮。
  queue: InputQueue;
  // [CHANGED 12.4] 打断清理期间锁住提交，防止并发开新轮。
  clearing: boolean;
  history: Message[];
  prompts: string[];
  run: number;
  nextId: number;
  grants: Set<string>;
  controller?: AbortController;
  done?: Promise<void>;
  closing: boolean;
  external?: { controller: AbortController; done: Promise<void> };
};
```

**替换 TuiApp：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 把草稿、会话控制和执行事件连成可操作的终端工作区。
 * 普通任务只由提交 handler 启动；组件重绘不创建模型请求。
 * 焦点决定普通按键由哪一区处理，审批或澄清占用时暂停工作区输入。
 * 忙碌 Enter 入当前轮补充队列；Ctrl+S 先保存要求、取消旧轮并等清理，再开新轮。
 * 局部 current 顺序累积事件；finally 等事件流清理后才解除占用。
 * 显示条目与模型历史分别保存；本组件不直接执行工具、提交历史或撤销副作用。
 */
// [KEEP 来自 10.4] 单独接收 interrupt，让组件触发“取消本轮”而不是直接退出。
// [CHANGED 12.4] 界面接入本节操作；具体状态和按键变化在对应分支标明。
function TuiApp({ model, session, quit, interrupt }: { model: Model; session: Session; quit: (code: number) => void; interrupt: () => void }) {
  // 这些值描述画面；setter 通知 React 重新绘制，不能把模型任务写进组件渲染过程。
  const [draft, setDraft] = useState(newDraft());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<"draft" | "history">("draft");
  const [notice, setNotice] = useState("");
  const [, refreshQueue] = useState(0);
  const [editing, setEditing] = useState(false);
  const { suspendTerminal } = useApp();
  const [approval, setApproval] = useState<PendingApproval>();
  // [KEEP 来自 12.3] 澄清面板保存当前请求，与审批和普通草稿分开。
  const [question, setQuestion] = useState<PendingQuestion>();
  const [view, setView] = useState<RunView>({ ...emptyRunView(), status: "就绪" });
  const { columns, rows } = useWindowSize();
  // [KEEP 来自 11.5] 先判断窗口是否容得下工作区，再决定普通输入是否激活。
  const tooSmall = columns < 40 || rows < 16;
  // 函数式更新接在上一次 entries 后追加，连续事件不依赖某次绘制时捕获的旧数组。
  /**
   * 把本地提示或已提交问题加入显示记录。
   * 分配稳定显示 ID，并以函数式更新追加到旧条目后；这里不提交模型历史。
   */
  const append = (label: Entry["label"], text: string) => {
    const entry = { id: `local:${session.nextId++}`, label, text: screenText(text) };
    setEntries((old) => [...old, entry]);
  };

  // [KEEP 来自 11.4] 暂时把整个终端交给编辑器，结束后只替换草稿。
  /**
   * 在空闲时把终端交给外部编辑器，再取回仍未发送的草稿。
   * 任务、审批、问答或退出正在占用时只提示等待。
   * 编辑成功形成一次草稿修改；失败保留原文，结束后解除外部占用。
   */
  const openEditor = () => {
    if (session.done || session.external || session.closing || session.clearing || approval || question) { setNotice("请在当前任务结束后编辑草稿。"); return; }
    const controller = new AbortController();
    setEditing(true);
    session.external = { controller, done: (async () => {
      try {
        let text = draft.text;
        await suspendTerminal(async () => { text = await editExternally(draft.text, controller.signal); });
        if (!session.closing) { setDraft(changeDraft(draft, text)); setNotice("已取回编辑内容，按 Enter 才会发送。"); }
      } catch (error) { if (!session.closing) setNotice(screenText((error as Error).message)); }
      finally { session.external = undefined; if (!session.closing) setEditing(false); }
    })() };
  };
  // [KEEP 来自 10.4] 先提示正在取消，保持 busy；任务真正结束后才由 finally 恢复输入。
  // [KEEP 来自 11.5] 小窗口保留取消与退出，暂停焦点切换和外部编辑入口。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // [CHANGED 12.4] 忙碌 Enter 进入当前轮补充队列，本地命令仍需空闲处理。
      if (session.done) { setView((current) => ({ ...current, status: "正在取消，等待清理…" })); }
      interrupt();
    }
    if (key.ctrl && input === "d") quit(0);
    // [CHANGED 12.4] Ctrl+S 只从草稿入口打断并发送，不抢审批或问答输入。
    if (!tooSmall && key.ctrl && input === "s" && focus === "draft" && !approval && !question && !editing) void interruptAndSend(draft.text);
    if (!tooSmall && key.ctrl && input === "g" && focus === "draft") openEditor();
    if (!tooSmall && key.ctrl && input === "o" && !approval && !question) setFocus((old) => old === "draft" ? "history" : "draft");
  });

  /**
   * 处理普通草稿 Enter，决定本地命令、排队补充或新任务。
   * 忙碌时普通文字校验后入当前 run 队列，成功才清草稿；本地命令保留到空闲处理。
   * 新任务记录已发送问题，并使用启动时的模式快照；失败提示不会自动重发。
   */
  const submit = (value: string) => {
    // session.done 立即成为并发保护；不必等 React 把输入框换成忙碌画面后才阻止再次发送。
    if (session.closing || session.external || session.clearing) return;
    if (session.done) {
      if (isLocalCommand(value.trim())) { setNotice("本地命令需等待本轮结束；草稿已保留。"); return; }
      try {
        // [CHANGED 12.4] 校验和入队成功才清草稿；入队不表示已加入上下文。
        const entry = enqueueInput(session.queue, value, session.run);
        setDraft(newDraft());
        refreshQueue((old) => old + 1);
        setNotice(`补充 #${entry.id} 已排队，尚未送到模型；Ctrl+S 可打断并发送草稿。`);
      } catch (error) { setNotice((error as Error).message); }
      return;
    }
    setNotice("");
    const prompt = value.trim();
    if (!prompt) return;
    setDraft(newDraft());
    // 本地命令只改本地会话；它们不作为 user 消息送给模型。
    if (prompt === "/exit") { quit(0); return; }
    if (prompt === "/reset") { session.history.length = 0; append("本地", "对话历史已清空；会话授权保留。"); return; }
    if (prompt === "/permissions reset") { session.grants.clear(); append("本地", "本次会话的只读授权已撤销。"); return; }
    if (prompt === "/permissions") { append("本地", session.grants.size ? [...session.grants].join("\n") : "当前没有会话授权。"); return; }
    // [KEEP 来自 12.1] 空闲模式命令只修改会话选择，不修改已启动的一轮。
    if (prompt === "/mode" || prompt.startsWith("/mode ")) {
      const mode = prompt.slice(6).trim();
      if (mode === "plan" || mode === "execute") session.mode = mode;
      append("本地", `当前模式：${session.mode}${mode && mode !== "plan" && mode !== "execute" ? "；用法：/mode plan|execute" : ""}`);
      return;
    }
    startRun(prompt);
  };

  /**
   * 识别必须在空闲时本地处理的命令。
   * 只检查 exit、reset、permissions、mode 的命令前缀，返回布尔值，不执行命令。
   */
  const isLocalCommand = (text: string) => /^\/(exit|reset|permissions|mode)(?:\s|$)/.test(text);
  /**
   * 先结束旧任务，再把已经保存的新要求作为新一轮发送。
   * 先校验并保存 prompt，设置 clearing 封住提交，再取消旧控制器并 await 旧 done。
   * 等待后若已退出就停止；否则解锁、清草稿并 startRun。旧轮未收取队列仍留存。
   */
  const interruptAndSend = async (value: string) => {
    if (session.closing || session.external || session.clearing || approval || question || editing || tooSmall) return;
    let prompt: string;
    try { prompt = validateQueuedText(value); } catch (error) { setNotice((error as Error).message); return; }
    if (isLocalCommand(prompt)) { setNotice("Ctrl+S 需要新的任务要求，本地命令请在空闲时使用。"); return; }
    // [CHANGED 12.4] 先保存 prompt，再锁住提交入口，旧轮清理过程中禁止重入。
    session.clearing = true;
    setNotice("正在打断当前任务，清理完毕后发送草稿…");
    // [CHANGED 12.4] 先记住旧 done；abort 只是请求停止，必须继续等待清理。
    const previous = session.done;
    session.controller?.abort();
    // [CHANGED 12.4] 旧流完成 finally 后才允许新轮；不能让新旧工具同时运行。
    await previous;
    // [CHANGED 12.4] 等待期间若已退出，停止发送已保存的新要求。
    if (session.closing) return;
    session.clearing = false;
    setDraft(newDraft());
    startRun(prompt);
  };

  /**
   * 为空闲提交建立一次任务，并顺序消费它的事件。
   * 立即占住 session.done，创建新控制器、run 编号和模式快照；会话清单与历史继续复用。
   * 队列回调闭包固定当前 run，只能收取这一轮条目；askUser 只展示当前问答。
   * finally 等流清理后解除忙碌、保存显示结果，并提示未收取补充仍保留。
   */
  const startRun = (prompt: string) => {
    if (session.closing || session.external || session.clearing || session.done) return;
    session.prompts = [...session.prompts, prompt].slice(-100);
    append("你", prompt);
    const run = ++session.run;
    setBusy(true);
    setView(emptyRunView());
    // 一轮只对应一个控制器；history 与 grants 比这一轮活得更久，不能一起重新创建。
    const controller = new AbortController();

    // [KEEP 来自 12.1] 一轮取启动模式快照，后续重绘不改变它。
    const options = { mode: session.mode, tasks: session.tasks,
      // [KEEP 来自 12.3] 问答工具等待这次 Promise，面板 key 让旧请求回调失效。
      askUser: (request: import("../../agent/run-options.js").UserQuestion, signal: AbortSignal) => waitForAnswer(request, signal, (pending) => {
        if (!session.closing) setQuestion(pending);
      }),
      // [CHANGED 12.4] 收取闭包绑定 startRun 的 run，旧队列不注入新轮。
      takePendingInputs: () => { const inputs = takePendingInputs(session.queue, run); if (inputs.length && !session.closing) refreshQueue((old) => old + 1); return inputs; },
      // [CHANGED 12.4] 终轮回答后可检查剩余补充，尚不移出条目。
      hasPendingInputs: () => hasPendingInputs(session.queue, run),
    };
    session.controller = controller;
    session.done = (async () => {
      let current = emptyRunView();
      try {
        for await (const { event } of streamAgentRun(model, session.history, prompt, controller.signal, (request, signal) => waitForApproval(request, signal, (pending) => {
          if (!session.closing) setApproval(pending);
        }), session.grants, options)) {
          // [KEEP 来自 10.2] 本地变量保留每条事件；React 可以合并绘制，但不能丢掉已收到的数据。
          // [CHANGED 12.4] 只在核心确认收取并加入本次上下文后显示确认。
          if (event.type === "input_applied" && !session.closing) append("本地", `补充 #${event.id} 已加入第 ${event.call} 次请求的上下文：${event.text}`);
          current = updateRunView(current, event);
          if (!session.closing) setView(current);
        }
      } catch (error) {
        current = { ...current, status: controller.signal.aborted ? "已取消本轮" : `运行失败：${screenText(explainError(error))}` };
      } finally {
        // for await 完成或抛错前会等待生成器的 finally；此时才解除本轮占用。
        session.controller = undefined;
        session.done = undefined;
        if (!session.closing) {
          setEntries((old) => [...old, ...runEntries(current, run)]);
          setView(current);
          setApproval(undefined);
          // [KEEP 来自 12.3] 任务结束清掉当前面板，普通草稿未被改写。
          setQuestion(undefined);
          setBusy(false);
          // [CHANGED 12.4] 本轮剩余补充继续留存，下一轮不会自动使用。
          if (hasPendingInputs(session.queue, run)) setNotice("本轮已结束；未生效的补充仍保留在队列，不会自动进入下一轮。");
        }
      }
    })();
  };

  // [KEEP 来自 11.3] 当前轮与留存消息一起交给历史区，草稿输入由焦点决定。

  // [KEEP 来自 12.2] 按窗口显示摘要和至多三项，不丢弃真实清单。
  const taskLines = session.tasks.items.length === 0 ? 0 : 1 + (rows >= 20 ? Math.min(3, session.tasks.items.length, rows - 18) : 0);
  const display = busy ? [...entries, ...runEntries(view, session.run)] : entries;
  // [KEEP 来自 11.5] 尺寸不足时隐藏工作区并停用输入；放大后沿用原草稿与浏览状态。
  // [KEEP 来自 12.2] 下方清单区域从会话读取进度，显示报告不等于测试通过。
  // [KEEP 来自 12.3] 下方澄清面板用独立 key 挂载，占用时隐藏普通区但保留草稿。
  return <Box flexDirection="column">
    <Text bold={useColor} wrap="truncate">Hello, My Agent · Ctrl+O 切换草稿 / 历史</Text>
    {tooSmall && <Text wrap="truncate">请放大到 40 列、16 行；Ctrl+C 取消任务 · Ctrl+D 退出。</Text>}
    <Box display={tooSmall ? "none" : "flex"} flexDirection="column">
    {approval && <ApprovalPanel key={`${approval.key}:${columns}:${rows}`} pending={approval} columns={columns} rows={rows} />}
    {question && <QuestionPanel key={question.key} pending={question} columns={columns} rows={rows} />}
    <Box display={approval || question ? "none" : "flex"} flexDirection="column">
      {taskLines > 0 && <Box flexDirection="column">
        <Text wrap="truncate">任务：{session.tasks.items.filter((item) => item.status === "completed").length}/{session.tasks.items.length} 已完成 · {session.tasks.items.filter((item) => item.status === "in_progress").length} 进行中 · {session.tasks.items.filter((item) => item.status === "pending").length} 待办</Text>
        {session.tasks.items.slice(0, taskLines - 1).map((item) => <Text key={item.id} wrap="truncate">{item.status === "completed" ? "[完成]" : item.status === "in_progress" ? "[进行]" : "[待办]"} {screenText(item.text).replace(/\n/g, " ")}</Text>)}
      </Box>}
      <Transcript entries={display} active={focus === "history" && !approval && !question && !editing && !session.clearing && !tooSmall} width={columns} height={Math.max(2, rows - 12 - taskLines)} />
      <Text wrap="truncate">模式：{session.mode} · 状态：{view.status} · 待发送补充：{session.queue.items.length}</Text>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text wrap="truncate" color={useColor ? "cyan" : undefined}>草稿 {focus === "draft" ? "[焦点]" : ""}{busy ? " · Enter 排队补充，Ctrl+S 打断并发送" : ""}</Text>
        <DraftEditor value={draft} onChange={setDraft} onSubmit={submit} active={focus === "draft" && !approval && !question && !editing && !session.clearing && !tooSmall} prompts={session.prompts} width={columns - 4} />
      </Box>
      <Text wrap="truncate">{notice || "Enter 发送 / 排队 · Ctrl+S 打断发送 · Ctrl+J 换行 · Ctrl+C 取消 / 退出"}</Text>
    </Box>
    </Box>
  </Box>;
}
```

**替换 startTui：**

<!-- source: src/ui/tui/app.tsx -->
```ts
/**
 * 创建整次 TUI 会话，并在退出前等占用全部清理。
 * 输入是模型和启动模式；会话对象只创建一次，重绘或单轮取消不重建历史和授权。
 * 会话还保存清单与补充队列；它们不会随开始下一轮而重置。
 * Ctrl+C 忙碌时取消本轮，空闲时退出；外部编辑占用期间交给编辑器。
 * 退出先设置 closing 阻止新提交，再取消并等待任务和外部编辑，最后卸载并移除监听。
 */
// [CHANGED 12.4] 会话初始化新增本节状态，退出仍等待任务清理。
export async function startTui(model: Model, initialMode: ExecutionMode = "execute"): Promise<void> {
  // 组件可以多次重新绘制，这个对象只随本次 startTui 创建与销毁。
  const session: Session = { mode: initialMode, tasks: { items: [] }, queue: newInputQueue(), clearing: false, history: [], prompts: [], run: 0, nextId: 0, grants: new Set(), closing: false };
  let instance: ReturnType<typeof render> | undefined;
  /**
   * 开始退出，封住新提交后等待当前任务与外部编辑结束。
   * 取消对应控制器，清理完成才设置退出码并卸载界面；重复退出直接返回。
   */
  const quit = (code: number) => {
    if (session.closing) return;
    // 先封住新的提交和状态更新，再等待当前任务；否则退出期间仍可能继续绘制。
    session.closing = true;
    session.controller?.abort();
    session.external?.controller.abort();
    void Promise.all([session.done, session.external?.done]).then(() => { process.exitCode = code; instance?.unmount(); });
  };
  // [KEEP 来自 10.4] 有任务时只取消它；下一个问题会建立新的控制器。
  /**
   * 让 Ctrl+C 根据当前占用选择取消本轮或退出。
   * 外部编辑占用时留给编辑器；有任务控制器时只取消它，空闲时以 130 退出。
   */
  const interrupt = () => { if (session.external) return; if (session.controller) session.controller.abort(); else quit(130); };
  /**
   * 将 SIGTERM 交给同一退出清理入口，保留退出码 143。
   */
  const terminate = () => quit(143);
  /**
   * 将 SIGHUP 交给同一退出清理入口，保留退出码 129。
   */
  const hangup = () => quit(129);
  /**
   * 输入结束时正常退出，仍等待现有占用清理。
   */
  const endInput = () => quit(0);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", hangup);
  process.stdin.on("end", endInput);
  try {
    // [KEEP 来自 10.4] 界面按键和进程 SIGINT 使用同一个 interrupt 选择取消或退出。
    instance = render(<TuiApp model={model} session={session} quit={quit} interrupt={interrupt} />, { exitOnCtrlC: false, patchConsole: false, alternateScreen: true });
    await instance.waitUntilExit();
  } finally {
    session.closing = true;
    session.controller?.abort();
    session.external?.controller.abort();
    await Promise.all([session.done, session.external?.done]);
    instance?.unmount();
    // 无论正常退出还是挂载失败，只移除本次添加的监听，避免下次进入界面收到重复通知。
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", hangup);
    process.stdin.off("end", endInput);
  }
}
```

</details>

## 运行验证

完成本节构建后，在仓库根目录运行：

```bash
npm run lesson:12.4
```

继续在仓库根目录启动 TUI：

```bash
hello-my-agent --mode execute
```

发送“检查并修复 chapter-12-task-control/demo-project/src/add.mjs 的数字加法；运行 node --test test/add.test.mjs，cwd 为 chapter-12-task-control/demo-project”。任务运行、普通草稿有焦点时，输入“请同时测试两个负数相加”，按 Enter。

先观察“已排队”：这里只是本地记住了文字。再观察“已加入第…次请求的上下文”：本批工具结果齐全后，补充已经成为 user 消息。最后看模型后续是否安排负数测试，以及测试工具返回什么；这才是要求是否落实的结果。

另外启动一轮，运行中输入“先别修改，先说明输入规则”，按 `Ctrl+S`。应先看到旧轮取消，清理结束后新轮才开始。已经完成的文件修改仍在，需继续查看实际文件与测试。窗口太快时可能来不及排队，自动检查用固定模型响应验证同一边界，手动观察不要求模型回答逐字一致。

## 本节完成后的 Agent

Agent 现在能在同一次用户任务中接收补充：界面先排队，核心逐项处理完当前工具清单，再把成功或错误结果与新要求一起交给模型。需要改变方向时，`Ctrl+S` 请求旧任务停止，等消息和事件流清理结束后，再以保存的草稿开始新任务，继续使用已有历史。待发送、已加入上下文与实际完成分别可见。下一节让我们修正或撤回尚未被核心收取的队列文字。
