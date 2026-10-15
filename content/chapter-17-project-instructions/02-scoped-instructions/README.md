# 17.2 区分不同目录的适用范围

[第 17 章首页](/content/chapter-17-project-instructions/README.md) · [上一节：17.1 从项目根读取说明](/content/chapter-17-project-instructions/01-project-root/README.md) · [下一节：17.3 检查实际加载了哪些规则](/content/chapter-17-project-instructions/03-inspect-loading/README.md)

## 问题：子目录的约定不能被当作全项目约定

根说明要求所有代码使用 TypeScript；`src/api` 还有更具体的约定：API 层修改后要增加参数校验测试。若只读根说明，模型看不到后者；若把仓库里所有 `AGENTS.md` 都读进来，又会把无关目录的要求混进本次任务。

本节先明确“这次从哪里开始工作”，只加载项目根到启动目录这条路径上的说明。每份文字都带着作用范围，模型才知道哪些要求适用于整个项目，哪些只适用于一个子树。

## 解决方案：沿一条目录链加载，从宽到窄排列

程序保留上一节确定的项目根和真实启动目录，在两者之间列出目录链：先根，再逐层走向启动位置。每层只检查自己的 `AGENTS.md`，按这个顺序加载；不递归扫描兄弟或后代目录。

请求中的每份说明标明来源和适用路径。根说明适用于整个项目；较深说明只适用于它所在目录及后代。同一范围内的约定冲突时，要求模型优先参考更具体的说明，但本地权限检查仍保持独立。

## 工作原理

### 目录链决定本次能够加载哪些文件

看一个包含不同工作区域的项目：

```text
adder-demo/
├── package.json
├── AGENTS.md            ← 全项目：使用 TypeScript、npm test
├── src/
│   ├── AGENTS.md        ← src 子树：保留公开 API
│   ├── api/
│   │   └── AGENTS.md    ← api 子树：增加参数校验测试
│   └── core/
│       └── AGENTS.md    ← 不在 api 的启动链上
└── test/
    └── AGENTS.md        ← 不在 api 的启动链上
```

从 `src/api` 启动，链是项目根、`src`、`src/api`，因此依次检查三份。`src/core` 和 `test` 不在这条链上，不会被顺手读进来。

从 `src` 启动则只检查根和 `src`，不会向下探索 `api`。这让加载范围有一个明确依据：真实启动位置。它也有明确限度：本节不是“工具将要访问哪个路径，就自动发现那里的规则”。

### 来源告诉模型文字从哪来，范围告诉模型该用于哪里

如果只是把三份文字拼成一段，模型可能把“API 层增加参数校验测试”误用到所有文件。程序因此在每份正文前附上来源与范围，例如：

| 来源 | 作用范围 | 在请求中的位置 |
| --- | --- | --- |
| `AGENTS.md` | `.`，整个项目 | 第一份 |
| `src/AGENTS.md` | `src` 及后代 | 第二份 |
| `src/api/AGENTS.md` | `src/api` 及后代 | 第三份 |

这里的相对路径以本次项目根为起点。顺序从宽到窄，表示先了解共同约定，再看当前区域的补充。

假如根说明要求统一使用某种错误返回方式，API 说明给自己的范围规定了更具体形式，模型应在 API 范围内优先参考后者。它不应把 API 的例外带到 `src/core`，也不能让任何一份项目说明覆盖当前用户要求或系统硬规则。

这种关系是请求里给模型的解释约定。程序没有一个能证明所有自然语言冲突都被正确理解的裁判；我们仍要看模型提出的调用与实际结果。权限则由本地执行器强制，不依赖这套自然语言优先顺序。

### 为什么不每次工具访问新路径都重新加载

一次修复可能先读取 `src/api`，再读取 `test`，随后读取根 `package.json`。如果每一步都改变说明集合，同一个任务的约定会随着工具路径变化，读者也难以判断模型这一步究竟依据哪一版。

本节选择启动时加载一次。后来读取 `test/add.test.ts`，不会自动触发 `test/AGENTS.md`；修改说明文件也不会中途替换已经加载的文字。需要另一范围的启动说明时，结束并从相应位置重新启动，再观察新的加载报告。

这是一项范围取舍，不代表未加载目录不重要。当前模型只能参考已明确交给它的内容，不能声称“仓库里的规则都知道了”。

### 多份说明仍遵守完整读取与总量上限

每份文件沿用上一节的普通文件、真实范围、UTF-8 和 8 KiB 限制；整条链累计不超过 32 KiB，最多加载 32 份。前面已经接纳的文件会占用后面的总量，因此根到深层的顺序也决定了预算使用顺序。

某一份无效或超限时，程序记录这份未加载，继续处理目录链上的后续位置。它不会偷偷裁掉最后几行再声称整份生效，也不会因为后面的文件更深，就绕过总量限制。

取消会结束整个加载过程并交回取消，不发布半份结果。正常加载完成后，报告中的每个来源都有明确状态，后续模型请求才能使用这次确定下来的集合。

### 每次请求重附同一份规则，压缩与估算也必须看见它

项目说明不是普通会话消息。第 16 章概括旧对话时，它们不会被摘要替代；后续普通请求仍通过统一系统说明重新附上启动时加载的集合。

这也意味着项目文字要参与预算。只在发送时拼上、估算时漏掉，会使本地认为“能放下”，实际却多出几份说明。程序让估算和发送使用同一套系统组装方法，项目参考才能与用户要求、工具定义一起纳入空间判断。

<!-- generated:media:start -->
下面从 src/api 启动，按顺序接纳根、src、api 三份说明；每份来源和范围跟着文字进入请求。后半段让模型读取 test 路径，观察工具结果增加时，启动时的说明集合为何保持原样。

<img src="./content/chapter-17-project-instructions/02-scoped-instructions/assets/project-scoped-chain-cover-e2f55e6485.png" data-gif-src="./content/chapter-17-project-instructions/02-scoped-instructions/assets/project-scoped-chain-82faa7dc94.gif" data-cover="./content/chapter-17-project-instructions/02-scoped-instructions/assets/project-scoped-chain-cover-e2f55e6485.png" data-no-zoom alt="沿根到src到api加载带范围的说明，跳过兄弟和后代，工具后来读取test也不会重载项目说明">

[静态封面](/content/chapter-17-project-instructions/02-scoped-instructions/assets/project-scoped-chain-cover-e2f55e6485.png.md) · [查看完整静态分镜](/content/chapter-17-project-instructions/02-scoped-instructions/assets/project-scoped-chain-storyboard-ee791a35ca.jpg.md)
<!-- generated:media:end -->

## 本节改动文件

<!-- generated:files:start -->
| 状态 | 文件 | 本节变化 |
| --- | --- | --- |
| CHANGED | [src/project/instructions.ts](/content/chapter-17-project-instructions/02-scoped-instructions/src/project/instructions.ts.md) | 按根到真实启动目录的祖先链加载，为各份说明标注作用范围 |

未列出的既有实现继续沿用（KEEP）；本节不重复展开。
<!-- generated:files:end -->

## 动手构建

从 17.1 的完整 `src/` 继续，目标目录是 `chapter-17-project-instructions/02-scoped-instructions/`。保留根的确定方式，把单份读取扩展为明确目录链，给每份结果附来源和范围，再统一格式化为项目参考。

<!-- generated:build:start -->
### 1. 按根到真实启动目录的祖先链加载，为各份说明标注作用范围

在上一节的 `src/project/instructions.ts` 上应用以下完整增量。`-` 是删除，`+` 是加入，其他行用于定位。

<details>
<summary>精确增量：src/project/instructions.ts（CHANGED）</summary>

<!-- source: src/project/instructions.ts -->
```diff
--- a/src/project/instructions.ts
+++ b/src/project/instructions.ts
@@ -1,11 +1,11 @@
 /**
- * 17.1 从子目录找到项目根并加载说明 | [NEW] project/instructions.ts
+ * 17.2 按目录范围组合项目规则 | [CHANGED] project/instructions.ts
  *
  * 学习目标：把启动位置、工具使用的根目录和项目说明的来源分开记录。
  * 输入：真实启动目录、取消信号；只读取固定名称 AGENTS.md。
  * 输出：已加载文本、来源、范围与未加载原因；内容只是模型参考，不是本地授权。
  * 状态：启动时读取一次，不改目录、不写文件；完整读取和校验后才接纳一份说明。
- * 本文件流程：启动目录 -> 最近项目标记 -> 有界读取根 AGENTS.md -> 来源标签与模型参考。
+ * 本文件流程：启动目录 -> 最近项目标记 -> 按祖先链有界读取 AGENTS.md -> 来源标签与模型参考。
  * 运行观察：从 src/api 启动仍找到项目根；目录或符号链接不能被当作说明正文。
  */
 import { createHash } from "node:crypto";
@@ -13,7 +13,7 @@
 import { lstat, open, realpath } from "node:fs/promises";
 import { dirname, join, relative, resolve, sep } from "node:path";

-// [NEW 17.1] 固定文件名与上限属于程序策略，项目文字不能提高它们。
+// [KEEP 来自 17.1] 固定文件名与上限属于程序策略，项目文字不能提高它们。
 export const INSTRUCTION_LIMITS = { fileBytes: 8_192, totalBytes: 32_768, files: 32 } as const;
 export type InstructionSource = { path: string; scope: string; text: string; bytes: number; sha256: string };
 export type InstructionNotice = { path: string; reason: string };
@@ -92,7 +92,12 @@
   const origin = await realpath(resolve(start));
   const root = findProjectRoot(origin);
   const result: ProjectInstructions = { root, start: origin, sources: [], notices: [], bytes: 0 };
-  const directories = [root];
+  // [CHANGED 17.2] 只加载根到真实启动目录的祖先链；不扫兄弟、后代或工具目标路径。
+  const directories: string[] = [];
+  for (let directory = origin; ; directory = dirname(directory)) {
+    directories.unshift(directory);
+    if (directory === root) break;
+  }
   for (const directory of directories) {
     signal.throwIfAborted();
     const path = join(directory, "AGENTS.md");
```

</details>
<!-- generated:build:end -->

## 运行验证

在仓库根目录编译并注册本节。

```bash
npm run lesson:17.2
```

按上面的目录示意创建三份说明，分别从项目根、`src`、`src/api` 启动，比较报告中加载集合。再放一份兄弟目录说明，确认它没有混入。用固定加载实验检查范围，比只看模型某次回答是否提到规则更可靠。

## 本节完成后的 Agent

Agent 能解释本次加载了哪条目录链，并把每份项目说明的来源与适用范围交给模型。下一节提供一个不请求模型的检查入口，直接查看加载结果与版本，定位“没加载”还是“模型没有照做”。
