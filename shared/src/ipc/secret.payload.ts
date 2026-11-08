// secret 域 payload（X-01 §1 ipc 行；02 §3.4 secret:set/get/del；C-M1 §1 SecretVault 行：
// safeStorage 往返；apiKey 引用键语义（settings 只存引用键，02 §12.3）；错误码 SECRET-UNAVAILABLE；
// in-band：get 未命中→{value:null}）。明文仅 reveal() 供 env 注密，不落盘不打日志（02 §12.3/§12.4）。

/** secret:set（r→m）：{key,value?} → {ok}（02 §3.4） */
export interface SecretSetReq {
  key: string;
  value?: string;
}

export interface SecretSetRes {
  ok: boolean;
}

/** secret:get（r→m）：{key} → {value}（02 §3.4；未命中 in-band {value:null}） */
export interface SecretGetReq {
  key: string;
}

export interface SecretGetRes {
  value: string | null;
}

/** secret:del（r→m）：{key} → {ok}（02 §3.4 三通道同面） */
export interface SecretDelReq {
  key: string;
}

export interface SecretDelRes {
  ok: boolean;
}
