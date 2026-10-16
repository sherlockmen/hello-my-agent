/**
 * 36.3 配置与会话升级 | [NEW] config/migrate-config.ts
 *
 * 学习目标：只迁移已知格式，在替换之前保留经验证的旧内容。
 * 输入：显式连接配置路径；输出：迁移成功 / 已是 v2，失败只给固定原因。
 * 本文件局部流程（全局主流程见 agent/agent-loop.ts）：
 *   验证 v1 -> 取得锁 -> 比较原文 -> 独占备份 -> 写同目录临时文件
 *   -> 再比较原文 -> rename -> 清理锁；v2 已有效 -> 无写入返回
 * 状态：备份排他创建，不覆盖已有备份；失败可能留下备份，不删除用户原件。
 * 边界：锁只约束本命令；外部编辑器和突然断电没有跨文件事务保证。
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { UserFacingError } from "../errors.js";
import { parseProfile, readProfileText, validateConnection, validateProfileV2 } from "./connection-profile.js";

// [NEW 36.3] 使用 wx 和 0600，避免覆盖已有备份，也不继承原件的宽松权限。
/** 写入一个尚不存在的私有文件并同步文件内容；失败由调用方决定保留哪些产物。 */
function writePrivate(path: string, content: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  try { writeFileSync(descriptor, content, "utf8"); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

/**
 * 显式将本章的 v1 连接文件迁移到 v2，返回 true 表示本次替换成功。
 * 先校验后写入；已是有效 v2 时不写备份；未知版本不能猜测或降级。
 * 锁与替换前的原文比较减少合作进程和编辑冲突，不提供对外部写入者的完整隔离。
 */
export function migrateConfig(inputPath: string | undefined): boolean {
  if (!inputPath) throw new UserFacingError("用法：hello-my-agent migrate-config <连接配置路径>。");
  const path = resolve(inputPath);
  const original = readProfileText(path), value = parseProfile(original);
  if (value.version === 2) { validateProfileV2(value); return false; }
  if (value.version !== 1) throw new UserFacingError("连接配置版本不支持，不能迁移未知格式。");
  const connection = validateConnection(value, ["version", "provider", "model", "baseUrl"]);
  const next = `${JSON.stringify({ version: 2, connection }, null, 2)}\n`;
  const lock = `${path}.migrate.lock`, backup = `${path}.v1.bak`;
  const temporary = `${path}.migrate-${randomUUID()}.tmp`;
  let locked = false, createdTemporary = false;
  try {
    try { writePrivate(lock, "migration in progress\n"); locked = true; }
    catch { throw new UserFacingError("无法取得迁移锁；请确认没有其他迁移进程，且目录可写。"); }
    if (readProfileText(path) !== original) throw new UserFacingError("连接配置已变化，迁移停止；请核对原件后再操作。");
    try { writePrivate(backup, original); }
    catch { throw new UserFacingError("无法建立私有备份；已有 .v1.bak 不会被覆盖，请先核对。"); }
    // 先记住临时路径的所有权；随机路径只由这次命令创建。
    createdTemporary = true;
    writePrivate(temporary, next);
    if (readProfileText(path) !== original) throw new UserFacingError("替换前发现配置被修改，已停止；请核对原件和备份。");
    renameSync(temporary, path);
    createdTemporary = false;
    return true;
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("迁移未完成；请保留并核对连接配置与 .v1.bak，确认目录权限后再处理。");
  } finally {
    if (createdTemporary) { try { unlinkSync(temporary); } catch { /* 失败产物留待用户核对。 */ } }
    if (locked) { try { unlinkSync(lock); } catch { /* 异常遗留锁需要用户确认后处理。 */ } }
  }
}
