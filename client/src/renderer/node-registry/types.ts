// NodeRegistry 契约类型（C-05 §1 接口签名逐字对齐；T1-09）。
// imports ↓ 仅 X-01 纯类型与常量（§2 P-3）——运行时依赖只有注入的 NodeDefinitionStore。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { PermLabel } from '@constella/shared/dto';

/** C-02 validateDefinition 的字段错误形（03 TDD-C-02 §1 FieldError；本卡仅消费 ok，P4 注入不改此处） */
export interface FieldError {
  field: string;
  message: string;
}

/** 校验结果形（C-05 §1 / C-02 §1 同形：{ ok, errors }；缺省注入＝跳过校验） */
export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
}

/** 校验器注入形（实现归 C-02 validateDefinition，随 P4 波注入——02 §8.2 装载序） */
export type DefinitionValidator = (doc: NodeDefinition) => ValidationResult;

/**
 * 定义持久层注入面（C-05 §1 本卡定义；实现=C-06 IpcDefinitionStore〔T1-08 已落
 * client/src/renderer/storage/，结构同形〕，应用装配点注入——P-3 本模块不 import 它）。
 * async 定稿（✅ M4 P2-7 收口）。
 */
export interface NodeDefinitionStore {
  loadAllDefinitions(): Promise<NodeDefinition[]>;
  upsertDefinition(doc: NodeDefinition): Promise<void>;
}

/** 装载报告（C-05 §1：total=store 载入条数；loaded=注册入表条数〔同名同型合并后〕；broken=校验失败 type 清单） */
export interface LoadReport {
  total: number;
  loaded: number;
  broken: string[];
}

/**
 * 注册表对外接口（C-05 §1 十方法逐字；02 §3.2/§8.1/§8.2/§12.2#1 锚见各方法）。
 * ⚠ 唯一有意偏离：loadAll 返回 Promise<LoadReport>——§1 手写为同步 LoadReport，
 * 但 NodeDefinitionStore.loadAllDefinitions 已 async 定稿（§1 自身注释），装载必须 await。
 */
export interface NodeRegistry {
  /** 02 §3.2 */
  get(type: string): NodeDefinition | undefined;
  /** 运行时 upsert：同名同型覆盖（02 §3.2 + 01 A-11.1） */
  register(doc: NodeDefinition): void;
  /** 供 C-02 type 命名空间检查（02 §8.1） */
  has(type: string): boolean;
  /** 全量（AI 规划选型 02 §8.7/§9.1；导入兜底） */
  list(): readonly NodeDefinition[];
  /** 02 §3.2（类型网格/抽屉类型格） */
  listByCategory(): Record<string, NodeDefinition[]>;
  /** 02 §8.2 校验失败标记（画布 ⚠、运行闸拦截） */
  isBroken(type: string): boolean;
  /** kind 判定（✨角标、perms 推导排除内置） */
  isBuiltin(type: string): boolean;
  /** 发布权限推导（01 A-13.1；02 §12.2#1） */
  derivePerms(types: readonly string[]): PermLabel[];
  /** 时长估计驱动（02 §3.2；DUR 仅进度估计，02 §11 B-2） */
  estimateMs(type: string): number;
  /** 02 §8.2 启动序（store 注入；validate 缺省跳过） */
  loadAll(store: NodeDefinitionStore, validate?: DefinitionValidator): Promise<LoadReport>;
  /** ⚠ 02 未定义变更通知；卡内冻结：注册/覆盖/broken 标记均触发，退订后不再收（01 A-11.1 demo libAdd 后刷新语义） */
  onChange(fn: (type: string) => void): () => void;
}
