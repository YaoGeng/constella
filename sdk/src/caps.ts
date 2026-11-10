// @constella/sdk caps —— 七能力接口面（成员集=02 §14 逐字冻结）＋未绑定 stub 工厂（T4-10）。
//
// V1.0 冻结面：本卡仅交付「未绑定 stub」——任一能力成员访问即抛 code=SDK_CAP_UNAVAILABLE。
// 绑定实装按 T0-06 会签结论随后续卡落位（browser=CONSTELLA_CDP_WS ws 客户端直连 lane 桥；
// net=CONSTELLA_NET_WS 独立 NetProxyBridge；llm=LLM_BASE_URL/API_KEY env 直连；file/vault=本地
// 无桥），届时仅替换 caps 实现、能力接口形不变（K-01 §8① 替换点）。
// net 绑定已随 T5-12b 落位（NetCap.fetch 载荷定形=NetFetchResponse，客户端=net.ts）。
// 注：§14 未标注返回形细目的成员以 unknown 系占位（Session[] 等载荷形未冻结，绑定卡定形）。

/** browser 能力（02 §14：open/click/type/visible/extract/scrollCollect/scrollComments/extractNote/openChat/confirm/comment） */
export interface BrowserCap {
  open(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  visible(selector: string): Promise<boolean>;
  extract(selector: string, attr: string): Promise<string | null>;
  scrollCollect(kw: string, limit: number, sort?: string, dedupe?: boolean): Promise<unknown[]>;
  scrollComments(url: string): Promise<unknown[]>;
  extractNote(url: string, fields: string[]): Promise<Record<string, unknown>>;
  openChat(uid: string): Promise<void>;
  confirm(sec: number): Promise<void>;
  comment(text: string, rate?: number): Promise<void>;
}

/** llm 多模态消息（02 §14 G-2 裁定：messages 支持 image 输入——OpenAI 兼容 image_url 内容块；图像来源=CDP 提取的媒体直链/URL，≤3 张·640px 压缩由脚本侧约束） */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string | LlmContentPart[] };

/** llm 能力（02 §14：json(prompt,temperature)->object / fill(template,who,tone,avoid)->string ＋多模态 messages） */
export interface LlmCap {
  messages(messages: LlmMessage[], opts?: { temperature?: number }): Promise<string>;
  json(prompt: string, temperature?: number): Promise<Record<string, unknown>>;
  fill(template: string, who: string, tone: string, avoid?: string): Promise<string>;
}

/**
 * net fetch 成功载荷（T5-12b 载荷定形——caps.ts「载荷形未冻结，绑定卡定形」注兑现）：
 * body＝桥线形 bodyB64 解码后的 utf8 文本（非法序列替换字符，ts/py 同构口径）；
 * 非 2xx＝in-band 成功（status 真值原样返回，宿主 net-proxy-bridge 冻结语义）；
 * 网络层失败不在本形（宿主 status=0 → 客户端抛 SdkNetError NET-FAILED，见 net.ts）。
 * 二进制 body（bytes 原文）留 V1.1 注记（02 §14 未冻结二进制面）。
 */
export interface NetFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** net 能力（02 §14 G-2 裁定新增：fetch(url,{headers}) 经 main 进程网络代理执行；域名白名单=节点 N1「网络」权限类目，白名单外默认拒绝——12.1/T0-06 会签 NET-DENIED） */
export interface NetCap {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<NetFetchResponse>;
}

/** file 能力（02 §14 G-2 裁定新增：read/write/list 限该节点运行的沙箱工作目录，路径逃逸拒绝——12.1） */
export interface FileCap {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  list(path?: string): Promise<string[]>;
}

/** im 能力（02 §14：pollUnread({cooldownMin,limit})->Session[] / send(convId,text)；Session 载荷形未冻结，先 unknown[]） */
export interface ImCap {
  pollUnread(o: { cooldownMin?: number; limit?: number }): Promise<unknown[]>;
  send(convId: string, text: string): Promise<void>;
}

/** vault 能力（02 §14：exec(op,input,cursor) / upsertNotes / recentSent(uid,n) / logChat） */
export interface VaultCap {
  exec(op: string, input: unknown, cursor?: unknown): Promise<unknown>;
  upsertNotes(notes: unknown[]): Promise<void>;
  recentSent(uid: string, n: number): Promise<unknown[]>;
  logChat(c: unknown): Promise<void>;
}

/** agent 能力（02 §14：reply(session,persona)->string|null） */
export interface AgentCap {
  reply(session: string, persona: string): Promise<string | null>;
}

/** 未绑定能力访问错误（错误帧 code=SDK_CAP_UNAVAILABLE，K-01 §6.1 三态之「unbound」） */
export class SdkCapUnavailableError extends Error {
  readonly code = 'SDK_CAP_UNAVAILABLE';

  constructor(cap: string, member: string) {
    super(`SDK_CAP_UNAVAILABLE:${cap}.${member}（能力未绑定；运行时绑定注入见 02 §14/§12.1）`);
    this.name = 'SdkCapUnavailableError';
  }
}

/** 未绑定能力 stub：任一成员访问即抛 SdkCapUnavailableError（V1.0 冻结面；绑定实装不在本卡） */
export function unboundCap<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      throw new SdkCapUnavailableError(name, String(prop));
    },
  });
}
