# 第 05 章练习：撤销本次运行的批准

[第五章首页](README.md) · [先完成 05.3](03-session-grants/README.md) · [终端源码](03-session-grants/src/ui/terminal.ts) · [完整答案](#完整答案)

05.3 可以用 `/permissions` 查看已经批准的读取，但想撤销时，还得退出整个 Agent。接下来，我们增加一个单独的清空命令，让用户不用结束会话就能重新要求审批。

不能把这件事顺手并入 `/reset`。那个命令表示重新开始对话，如果同时撤销权限，用户就很难判断它究竟改变了什么。因此保留三种明确的动作：

```text
/permissions        -> 只查看 sessionGrants
/permissions clear  -> 清空 sessionGrants
/reset              -> 只清空 history
```

它们都由终端在调用 Agent Loop 之前处理，不会发给模型。

## 练习要求

修改 `chapter-05-permission-gate/03-session-grants/src/ui/terminal.ts` 中的 `handlePermissionCommand()`，并同步函数说明：

1. 识别 `/permissions clear`，清空 `sessionGrants`。
2. 输出 `已清空本次会话的权限范围。`，再返回 `true`。
3. 保留 `/permissions` 的查看功能，普通聊天仍返回 `false`。
4. 不修改 `/reset` 的处理，不清空对话历史。

原参数类型是 `ReadonlySet<string>`，因为函数只负责查看。现在要调用 `clear()`，也需要把参数类型改为 `Set<string>`。

## 提示：让已有的终端循环继续负责分流

终端已经通过 `handlePermissionCommand()` 的布尔返回值判断是否执行 `continue`。新命令只要处理后返回 `true`，这一行就不会进入模型消息，不需要再给 Agent Loop 增加命令判断。

可以把清空分支放在查看分支之前。清空之后，再次读取刚才批准过的目录时，请求仍照常经过权限策略；它查不到之前的记录，就会重新返回 `ask`。

## 完整答案

找到原来的函数：

```ts
export function handlePermissionCommand(
  text: string,
  sessionGrants: ReadonlySet<string>,
): boolean {
  if (text !== "/permissions") return false;
  printSessionGrants(sessionGrants);
  return true;
}
```

将它连同前面的函数说明替换为：

<!-- solution: handlePermissionCommand -->
```ts
/**
 * 处理只属于本地终端的权限命令。
 *
 * - 接收一行用户文字和当前运行共用的 sessionGrants。
 * - 查看或清空记录后返回 true，普通文字返回 false。
 * - 终端据此 continue，已处理的命令不会再进入模型消息。
 *
 * [CHANGED 练习] 现在需要清空 Set，所以参数不再使用 ReadonlySet；对话历史保持不变。
 */
export function handlePermissionCommand(
  text: string,
  sessionGrants: Set<string>,
): boolean {
  // [NEW 练习] 撤销权限使用独立命令，不改变对话历史。
  if (text === "/permissions clear") {
    sessionGrants.clear();
    console.log("已清空本次会话的权限范围。");
    return true;
  }
  if (text !== "/permissions") return false;
  printSessionGrants(sessionGrants);
  return true;
}
```

这里清空的是终端与 Agent Loop 共用的同一个 Set，没有创建新集合，也没有修改 `history`。所以后续请求能立刻看到记录已经移除，而原来的对话还在。

## 为什么下一次会重新询问

```text
sessionGrants.clear()
        |
        v
下一次 read_file(.git/HEAD)
        |
        v
deny 规则未命中 -> 计算 scope -> Set 中不存在 -> ask
```

权限策略每次都查询当前 Set，不保存“上次已经允许”的额外缓存。记录消失后，原本需要确认的读取自然恢复为 `ask`。普通源码仍可直接读取，`.env` 等禁止请求仍然被拒绝，清空批准不会改变这两类规则。

## 运行验证

完成修改后，在仓库根目录运行：

```bash
npm run exercise:05
```

预期输出：

```text
✓ 第 05 章练习：会话授权可以被明确撤销
```

检查重点是命令清空了批准记录、没有修改历史，并且仍被识别为本地命令。实际会话中，也可以先批准一次 `.git` 读取，再执行 `/permissions clear`，随后重新请求读取 `.git/HEAD`，观察审批是否再次出现。
