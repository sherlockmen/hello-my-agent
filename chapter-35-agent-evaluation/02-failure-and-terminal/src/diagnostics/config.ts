/**
 * 35.2 故障与终端回归 | [KEEP] diagnostics/config.ts
 *
 * 学习目标：无需网络、SDK或密钥展示，诊断所选协议的本地配置。
 * 输入：与正常启动相同的命令行选项、环境和项目.env；输出：安全的状态行。
 * 本文件局部流程：原环境信息 -> readConfig校验 -> 通过摘要 / 本地缺项说明。
 * 状态：不创建客户端、不修改环境、不启动服务；失败不输出原始配置或异常对象。
 * 观察：本地通过不证明接口可达、密钥有权限或远端模型支持工具。
 */
// [KEEP 来自 34.3] 复用同一校验规则；只输出受控协议名与本地安全错误。
import { readConfig, type Options } from "../config/load-config.js";
import { UserFacingError } from "../errors.js";

/**
 * 返回已有Node/平台/目录信息及模型配置检查；缺凭据也能正常执行。
 * readConfig会解析.env，但不会把键值注入环境；这里只采用其安全的UserFacingError。
 * 未知异常只给固定文案，不串联原始message、URL或密钥。
 */
export function diagnoseConfiguration(options: Options): string[] {
  const lines = [`Node: ${process.version}`, `Platform: ${process.platform} ${process.arch}`, `Working directory: ${process.cwd()}`];
  try {
    const config = readConfig(options);
    lines.push(`模型配置：本地检查通过（${config.provider}；密钥、模型、基础地址和预算已校验）`);
  } catch (error) {
    lines.push(`模型配置：${error instanceof UserFacingError ? error.message : "本地检查失败，请核对配置文件和读取权限。"}`);
  }
  lines.push("没有发送网络请求；本地检查不证明服务可达或账户权限有效。");
  return lines;
}
