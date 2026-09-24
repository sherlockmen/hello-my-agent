# 第 11 章练习：检查草稿与浏览状态

[第 11 章首页](README.md) · [先完成 11.5](05-terminal-layout/README.md) · [完整答案](#完整答案)

## 问题：怎样确认界面保留了用户的操作

本章的大部分能力不需要模型参与就能检查。插入一段文字以后，光标应该移动到哪里；撤销以后，原草稿是否回来；结果增加以后，用户主动选择的阅读位置是否保持——这些都有确定的输入与结果。

这次练习把一段连续操作写成可重复运行的实验。实验调用正式的草稿和显示辅助函数，让状态经过与界面相同的变换；不调用模型，不改动用户项目，也不需要真实剪贴板。

## 练习要求

新增 `chapter-11-terminal-workbench/exercises/workbench-state.mjs`，正式源码保持不变。实验按下面的使用顺序进行：

1. 从一份短草稿开始，整段插入文件路径和第二行要求，检查正文与光标；撤销一次再重做，应整段恢复。
2. 输入中文、emoji 和组合音标，调用正式按键处理删除末尾字符，检查没有把一个可见字符拆开。
3. 从几条已提交的问题中搜索 `README`，检查最近优先与相同文本去重；补全 `/per`，检查只得到新草稿，不发生执行。
4. 让一项工具结果分别经过折叠与展开，确认显示行变化，但原结果正文没有改动。
5. 在较早的显示行上留下浏览位置，再追加新回答，确认当前阅读位置保持；取消停留后，窗口应回到末尾。
6. 按固定列宽排版 `中文🙂é`，检查中文、emoji 和组合音标完整保留。

## 提示：检查变换过程，不直接写出最终状态

草稿检查应从 `newDraft()` 开始，经过 `insertText()` 和 `editKey()`，再读结果。直接构造一个带正确文字的对象，只能证明断言会通过，不能证明插入与撤销实现正确。

浏览检查也要先调用正式的排版函数，拿到一条真实显示行作为停留位置，再追加内容并重新排版。这样才能观察“记录继续增长”与“当前窗口继续停留”是否同时成立。

## 完整答案

创建 `exercises/` 目录，把下面的完整代码保存为 `chapter-11-terminal-workbench/exercises/workbench-state.mjs`。它导入根目录 `dist/` 中已经构建好的 11.5，不需要 API Key。

<!-- solution: exercises/workbench-state.mjs -->
```js
/**
 * 第 11 章练习：检查草稿与浏览状态 | [NEW 练习]
 *
 * 学习目标：用连续操作验证输入编辑与结果浏览，没有模型请求和系统剪贴板副作用。
 * 输入：固定草稿、已提交问题列表和工具结果；全部由本实验在内存中创建。
 * 输出：草稿、撤销、搜索、补全、折叠、浏览位置与显示宽度的断言结果。
 *
 * 练习验证流程（产品全局主流程见 11.5 的 agent/agent-loop.ts）：
 *   新草稿 -> 插入两行 -> 撤销与重做 -> 按可见字符删除
 *   已提交问题 -> 搜索 -> 最近匹配；命令前缀 -> 补入草稿
 *   工具结果 -> 折叠 / 展开 -> 选择一条显示行 -> 追加回答 -> 检查停留位置
 *   中文与 emoji -> 按列宽排版 -> 每项符合预期？-- 否 -> 断言失败
 *                                             +-- 是 -> 打印练习通过
 *
 * 本实验不启动 React 组件；真实按键通道、粘贴标记和终端恢复由交互检查覆盖。
 */
import assert from "node:assert/strict";
import { newDraft, insertText, editKey } from "../../dist/ui/tui/editor.js";
import { searchPrompts, completeInput } from "../../dist/ui/tui/input-assist.js";
import { transcriptLines, visibleStart } from "../../dist/ui/tui/transcript.js";
import { wrapLines } from "../../dist/ui/tui/layout.js";

// [NEW 练习] 本文件以下实现均为独立实验，不改变正式草稿和模型历史。
/**
 * 让固定输入经过正式变换函数，分别检查文字编辑与阅读位置。
 *
 * 各断言跟在对应操作之后，避免只检查最后状态而漏掉撤销、折叠等中间行为。
 * 工具项是本地显示样本，不伪装成真实工具执行；它只验证本章新增的排版与浏览。
 */
async function main() {
  const initial = newDraft("请读取 ");
  const inserted = "@README.md\n把启动和检查步骤分开说明。";
  let draft = insertText(initial, inserted);
  assert.equal(draft.text, initial.text + inserted);
  assert.equal(draft.cursor, draft.text.length);

  draft = editKey(draft, "z", { ctrl: true });
  assert.equal(draft.text, initial.text);
  assert.equal(draft.cursor, initial.cursor);
  draft = editKey(draft, "y", { ctrl: true });
  assert.equal(draft.text, initial.text + inserted);

  let unicode = newDraft("中文🙂e\u0301");
  unicode = editKey(unicode, "", { backspace: true });
  assert.equal(unicode.text, "中文🙂");
  unicode = editKey(unicode, "", { backspace: true });
  assert.equal(unicode.text, "中文");

  const first = "读取 README.md，说明启动方法。";
  const latest = "读取 README.md，说明检查命令。";
  assert.deepEqual(searchPrompts([first, "说明 package.json 的用途。", latest, latest], "readme"), [latest, first]);
  const completion = await completeInput("/per", 4);
  assert.equal(completion.text, "/permissions");
  assert.equal(completion.cursor, completion.text.length);

  const result = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行：固定工具结果`).join("\n");
  const entries = [
    { id: "question", label: "你", text: first },
    { id: "read", label: "工具", text: "read_file：完成", details: result },
    { id: "answer", label: "Agent", text: "已经读完，下面整理步骤。" },
  ];
  const folded = transcriptLines(entries, 24, new Set());
  const expanded = transcriptLines(entries, 24, new Set(["read"]));
  assert.ok(expanded.length > folded.length);
  assert.equal(entries[1].details, result);

  const height = 4;
  const anchor = expanded.find((line) => line.id === "read");
  assert.ok(anchor);
  const oldStart = visibleStart(expanded, height, anchor);
  const moreEntries = [...entries, {
    id: "later", label: "Agent",
    text: Array.from({ length: 8 }, (_, index) => `新回答第 ${index + 1} 行`).join("\n"),
  }];
  const moreLines = transcriptLines(moreEntries, 24, new Set(["read"]));
  const stayed = visibleStart(moreLines, height, anchor);
  assert.equal(moreLines[stayed].id, expanded[oldStart].id);
  assert.equal(moreLines[stayed].text, expanded[oldStart].text);
  assert.equal(visibleStart(moreLines, height, undefined), moreLines.length - height);

  assert.deepEqual(wrapLines("中文🙂e\u0301", 4).map((line) => line.text), ["中文", "🙂e\u0301"]);
  console.log("练习通过：编辑、撤销、输入辅助、结果浏览与中文排版符合预期。");
}

await main();
```

## 运行验证

完成 11.5 和练习文件以后，在仓库根目录构建：

```bash
npm run lesson:11.5
```

再单独运行实验：

```bash
node chapter-11-terminal-workbench/exercises/workbench-state.mjs
```

通过时，应显示：

```text
练习通过：编辑、撤销、输入辅助、结果浏览与中文排版符合预期。
```

使用完整配套仓库并已经创建练习文件时，也可以单独检查这份练习：

```bash
npm run exercise:11
```

## 这次练习验证了什么

固定输入让我们能精确检查草稿和显示状态，但它不能替代真正坐在终端里操作。粘贴标记、终端按键、外部编辑器和退出后的输入模式，仍由各节的交互实验与终端检查覆盖。

练习只新增独立实验，不改变正式界面能力。第十二章从 11.5 的完整实现继续，在已有草稿与执行状态之上加入运行中干预和排队。
