// SecretMasker —— `sk-***` 掩码纯函数（T4-16 / TDD-C-M1 §3 SecretMasker 组件行）。
//
// 语义冻结（§3 组件行＋02 §12.3/§12.4）：run:scriptEvent 转发前统一过本函数——脚本
// stdout/stderr 中出现的明文 apiKey 形 token（`sk-` 前缀）替换为固定形 `sk-***`
// （与 C-02 SecretParamBinder 展示掩码同字面量，02 §12.3 全链路脱敏）。
//
// 掩码规则（自拟细化留痕——02/03 未细化 token 判据）：
//   - token 形＝词边界后的 `sk-` + 至少 1 个密钥字符（[A-Za-z0-9] 起，后随 [A-Za-z0-9_-]*）；
//   - 整 token（含后续密钥字符）替换为 `sk-***`（§6.1f：脚本打明文 `sk-test-123xyz` →
//     事件收 `sk-***`）；
//   - 纯函数、按 chunk 独立作用——跨 stdout 分片切断的 token 不保证掩码（分片粒度=协议帧
//     之外的极端形态；帧行以 \n 分隔、JSON 行内 token 不跨行）。

/** 固定掩码字面量（02 §12.3；与 renderer definition/form/secret-param-binder 同形） */
export const SECRET_MASK = 'sk-***';

/** 明文 apiKey 形 token（词边界 + sk- 前缀 + 密钥字符序列） */
const SK_TOKEN = /\bsk-[A-Za-z0-9][A-Za-z0-9_-]*/g;

/** 掩码纯函数（§3 组件级接口 `mask(text): string`） */
export function mask(text: string): string {
  return text.replace(SK_TOKEN, SECRET_MASK);
}
