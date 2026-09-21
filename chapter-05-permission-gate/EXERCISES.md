# 第 05 章练习：主动撤销本次会话授权

[第五章首页](README.md) · [先完成 05.3](03-session-grants/README.md) · [终端源码](03-session-grants/src/ui/terminal.ts) · [完整答案](#完整答案)

**本练习只解决一个问题：会话授权保存在内存中以后，用户怎样在不退出 Agent 的情况下明确撤销它？**

05.3 已经提供 `/permissions` 查看当前范围，但删除权限只能退出整个进程。把撤销并入 `/reset` 会混淆对话状态和权限状态，因此增加一个含义明确的本地命令：

```text
/permissions        -> 只查看 sessionGrants
/permissions clear  -> 清空 sessionGrants
/reset              -> 只清空 history
```

这三个命令都由终端在调用 Agent Loop 前处理，不会发送给模型。

## 练习要求

修改 `chapter-05-permission-gate/03-session-grants/src/ui/terminal.ts` 中的 `handlePermissionCommand()`：

1. 在查看分支之前识别 `/permissions clear`。
2. 调用 `sessionGrants.clear()`，输出 `已清空本次会话的权限范围。`。
3. 返回 `true`，让终端循环使用已有的 `continue`，保证命令不会进入 Agent Loop。
4. 保持 `/permissions` 和 `/reset` 的原有含义不变。

完成后在仓库根目录运行：

```bash
npm run exercise:05
```

预期输出：

```text
✓ 第 05 章练习：会话授权可以被明确撤销
```

## 完整答案

找到原来的 `handlePermissionCommand()`：

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

替换为：

<!-- solution: handlePermissionCommand -->
```ts
/**
 * 处理只属于本地终端的权限命令。
 *
 * - 输入：一行用户文字和当前进程共享的 sessionGrants。
 * - 输出：识别查看或清空命令时返回 `true`；普通文字返回 `false`。
 * - 关键原因：调用方根据布尔值 `continue`，本地命令不会进入模型消息。
 * - 职责边界：只管理当前进程的权限范围，不修改对话历史。
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

## 为什么 `clear()` 之后会重新询问

下一次工具请求仍从权限策略开始：

```text
sessionGrants.clear()
        |
        v
下一次 read_file(.git/HEAD)
        |
        v
deny 规则未命中 -> 计算 scope -> Set 中不存在 -> ask
```

撤销不需要通知模型，也不需要修改 Agent Loop。`handlePermissionCommand()` 返回 `true`，`startTerminal()` 使用已有的 `continue` 跳过 Agent Loop；集合清空后，同一个请求自然恢复为待审批状态。这也说明把权限状态放在终端会话、把权限判断放在策略层的价值：界面管理生命周期，策略解释当前请求，工具保持不变。
