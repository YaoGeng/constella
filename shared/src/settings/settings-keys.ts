// 设置键形（X-01 §1 settings 行；01 A-14.1/A-14.2；02 §7.1 settings 表「key TEXT PK; value JSON」）。
// settings 表为 KV：每行一个键；apiKey 明文只存 safeStorage（02 §12.3），此处只存引用键
// （ai.apiKeyRef）。键名＝demo 设置面板惯例键（01 A-14.1/A-14.2 验收锚；demo L766-778/L733-746/L1064-1073
// 参照非权威）；M4 收口增补键＝market.baseUrl（#8⑥，默认空＋首次使用引导——⚠ 默认执行可推翻：
// B1 部署卡可把构建期默认改指 constella.aim8848.com）与 ai.route（#8⑤，V1.1——B2 前生效）。

/** 场景路由四场景键（✅ M4 #8⑤；C-18 §1 权威清单「工坊规划/流程规划（双工坊两类规划调用，计一场景）、
 * 节点内 ai.llm、图判（多模态）、子代理」；键集合封闭，新场景走扩展点） */
export type SceneKey = 'workshop' | 'node-llm' | 'vision' | 'subagent';

/** 模型 profile（✅ M4 #8⑤；C-18 §1 冻结形——02 §7.1「AI 配置引用键」单配置口径的多 profile 叠加形收口） */
export interface ModelProfile {
  /** profile id（bindings 引用键） */
  id: string;
  /** OpenAI 兼容自配（D-4 ⚠；02 §9.1 LlmGateway） */
  baseUrl: string;
  /** safeStorage 引用键——明文不入 SQLite/日志（02 §7.1 settings 行、§12.3） */
  apiKeyRef: string;
  /** 候选模型（形如 glm-5 / deepseek-v4 / kimi-k2，02 §9.1，D-4 ⚠） */
  model: string;
  /** 图判场景要求（02 §14 llm 多模态） */
  multimodal: boolean;
}

/** ai.route 值形（V1.1，B2 前生效；✅ M4 #8⑤；C-18 §4：settings 表键名='ai.route'，
 * value={profiles, bindings, defaultProfileId}；resolve 未绑定/绑定失效回退默认 profile） */
export interface RouteConfig {
  profiles: ModelProfile[];
  /** scene → profileId 绑定（可部分绑定） */
  bindings: Partial<Record<SceneKey, string>>;
  defaultProfileId: string;
}

/** V1.0 单 AI 配置（D-4 ⚠：OpenAI 兼容协议＋用户自配 baseUrl/apiKey；02 §9.1/§12.3。
 * 键名 'ai'——X-01 §1 只写「AI 配置引用键」未定键名，本包取名 'ai'（V1.1 后与 ai.route 并存，
 * 为 C-18 resolve 回退默认的迁移承接位）；⚠ 若 C-11/C-07 施工卡另定键名，以会签回改本形。） */
export interface AiSettings {
  baseUrl: string;
  /** safeStorage 引用键（明文只经 secret:* 通道解引用） */
  apiKeyRef: string;
}

export interface SettingsSchema {
  // —— 交互三开关（01 A-14.1；默认：开/开/关——demo L758-760 与默认值 L1071-1073）——
  /** 网格吸附（20px），默认开 */
  snap: boolean;
  /** 运行连线动画，默认开 */
  edgeAnim: boolean;
  /** 自动保存（800ms 防抖），默认关 */
  autoSave: boolean;
  // —— 背景与星野（01 A-14.2）——
  /** 背景样式：星空 | 纯黑（纯黑隐藏星空 canvas 省电） */
  bg: 'sky' | 'black';
  /** 鼠标视差，默认开 */
  parallax: boolean;
  // —— 11 星野元素独立开关（01 A-14.2；demo L766-778 键名参照）——
  /** M31 星系（大/小） */
  disk: boolean;
  /** 迷你 M31 星系 */
  minis: boolean;
  /** 红·青星云 */
  mega: boolean;
  /** 银心暖流 */
  gas: boolean;
  /** 动态星团 */
  clusters: boolean;
  /** 亮星与星芒 */
  heroes: boolean;
  /** 恒星 */
  stars: boolean;
  /** 银道微星 */
  band: boolean;
  /** 星河辉光 */
  pulse: boolean;
  /** 流星 */
  meteor: boolean;
  /** 卫星 */
  sat: boolean;
  // —— 7 密度滑杆（01 A-14.2；10%–100% 步进 10%；demo L733-746 键名参照）——
  /** 恒星密度（%） */
  dens_stars: number;
  /** 银道微星密度（%） */
  dens_band: number;
  /** 亮星数量（%） */
  dens_heroes: number;
  /** 动态星团数量（%） */
  dens_clusters: number;
  /** 迷你 M31 数量（%） */
  dens_minis: number;
  /** 红·青星云密度（%） */
  dens_mega: number;
  /** 银心暖流密度（%） */
  dens_gas: number;
  // —— AI 配置引用键（02 §7.1 settings 行；apiKey 只存 safeStorage 引用键）——
  ai: AiSettings;
  // —— M4 收口增补键 ——
  /** 广场服务基址（✅ M4 #8⑥/C-1 部署默认裁决：默认空＋首次使用引导；⚠ 默认执行可推翻） */
  'market.baseUrl': string;
  /** 场景路由（✅ M4 #8⑤；V1.1——B2 前生效） */
  'ai.route': RouteConfig;
}

/** settings 表合法键集合（key TEXT PK 的值域） */
export type SettingsKey = keyof SettingsSchema;
