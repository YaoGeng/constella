// SecretParamBinder —— N3 密钥型参数绑定（C-02 §3 组件行；T4-08；02 §3.4 secret:*/§8.3/§12.3）。
//
// 语义：secret 型明文只经 secret:* 通道（set/get/del）往返 safeStorage，nodes.params JSON 只存
// 引用键、零明文（02 §12.3）；读取/展示=掩码 sk-***，明文永不回 renderer 表单值。导出/发布密钥
// 剥离（X-20）执行在 C-08——「params 只存引用键」的语义在此登记（C-02 §3 行原文）。
//
// secret:* 通道 mock 先行（05 区头 a ⚠）：bridge=注入式 IPC 桥（C-M1 preload 面随 T4-15/C-M1
// 接线；本卡测试以 mock bridge 验收——同 storage-client.ts 注入式惯例）。payload 形=X-01
// secret.payload（get 未命中 in-band {value:null}）。
//
// 自拟项留痕：①引用键形＝`secret.param.<scope>.<k>`（scope=节点实例域，装配点传 nodeId——
// 同类型多实例各持各的密钥不串号；缺省 'node'）；②opts.refs=实例 params JSON 中已存的
// secret 引用键初值（编辑既有节点时抽屉直显掩码）。
import type {
  SecretDelReq,
  SecretDelRes,
  SecretGetReq,
  SecretGetRes,
  SecretSetReq,
  SecretSetRes,
} from '@constella/shared/ipc';

/** 展示掩码（02 §12.3：日志/展示全链路脱敏——固定形 sk-***） */
export const SECRET_MASK = 'sk-***';

/** secret:* IPC 桥（C-M1 preload 注入位；测试用 mock——通道 handler 归 T4-15/C-M1） */
export interface SecretBridge {
  set(req: SecretSetReq): Promise<SecretSetRes>;
  get(req: SecretGetReq): Promise<SecretGetRes>;
  del(req: SecretDelReq): Promise<SecretDelRes>;
}

/** 构造选项 */
export interface SecretParamBinderOptions {
  /** 引用键作用域（=节点实例域；装配点传 nodeId——多实例同名字段不串号。缺省 'node'） */
  scope?: string;
  /** 初始引用键（=实例 params JSON 已存的 secret 字段值；缺省空=未绑定） */
  refs?: Record<string, string>;
}

/** 密钥型参数绑定面（§3 组件级接口：bindSecret(k)——复用处 ParamFormRenderer） */
export interface SecretParamBinder {
  /** 绑定展示（C-02 §3 签名）：已存 → {masked:'sk-***', refKey}；未存 → 双空串 */
  bindSecret(k: string): { masked: string; refKey: string };
  /** 写入明文经 secret:set 入 safeStorage → 返回引用键（params JSON 只存此键，零明文） */
  saveSecret(k: string, plaintext: string): Promise<string>;
  /** 读取（secret:get）→ 掩码语义：命中 → sk-***；未命中/未绑定 → 空串（明文不回表单值） */
  readMasked(k: string): Promise<string>;
  /** 删除（secret:del）——参数清空/节点删除时按引用键清理 */
  removeSecret(k: string): Promise<void>;
}

/** 引用键形：secret.param.<scope>.<k> */
function refKeyOf(scope: string, k: string): string {
  return `secret.param.${scope}.${k}`;
}

export function createSecretParamBinder(
  bridge: SecretBridge,
  opts: SecretParamBinderOptions = {},
): SecretParamBinder {
  const scope = opts.scope ?? 'node';
  const refs = new Map<string, string>(Object.entries(opts.refs ?? {}));

  return {
    bindSecret(k: string): { masked: string; refKey: string } {
      const refKey = refs.get(k) ?? '';
      return { masked: refKey === '' ? '' : SECRET_MASK, refKey };
    },

    async saveSecret(k: string, plaintext: string): Promise<string> {
      const refKey = refKeyOf(scope, k);
      await bridge.set({ key: refKey, value: plaintext });
      refs.set(k, refKey);
      return refKey;
    },

    async readMasked(k: string): Promise<string> {
      const refKey = refs.get(k);
      if (refKey === undefined) return '';
      const res = await bridge.get({ key: refKey });
      return res.value == null ? '' : SECRET_MASK;
    },

    async removeSecret(k: string): Promise<void> {
      const refKey = refs.get(k);
      if (refKey === undefined) return;
      await bridge.del({ key: refKey });
      refs.delete(k);
    },
  };
}
