// RegistryCore —— Map<type, NodeDefinition> ＋ broken 集合（C-05 §3 组件行；T1-09）。
// upsert 语义：同名同型覆盖、条目不新增（01 A-11.1；覆盖 paramsSchema 等全维度取代旧值）；
// broken＝装载期校验失败标记（02 §8.2）——标记后 get 仍返回定义（画布 ⚠ 可渲染、运行闸可拦截）。
// register 即四路 upsert 统一入口（手动编辑/AI 现场开发/zip 导入/广场安装，02 §8.2）：
// 新定义取代旧定义时，旧定义的 broken 判定一并清除（修复版覆盖后立即可跑，不待重载）。
import type { NodeDefinition } from '@constella/shared/dsl';
import type { RegistryEvents } from './registry-events';

export class RegistryCore {
  private readonly defs = new Map<string, NodeDefinition>();
  private readonly broken = new Set<string>();

  constructor(private readonly events: RegistryEvents) {}

  get(type: string): NodeDefinition | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  /** 全量（Map 迭代序＝首次注册序；覆盖不改变条目位置——排序稳定性来源） */
  list(): readonly NodeDefinition[] {
    return [...this.defs.values()];
  }

  /** 运行时 upsert：同名同型覆盖（01 A-11.1）＋清旧 broken 判定＋变更通知 */
  register(doc: NodeDefinition): void {
    this.defs.set(doc.type, doc);
    this.broken.delete(doc.type);
    this.events.emit(doc.type);
  }

  /** 校验失败标记（02 §8.2 装载序）——仅对已注册 type 生效；触发变更通知（⚠ ⚠ 标记也刷新画布 ⚠ 角标） */
  markBroken(type: string): void {
    if (!this.defs.has(type)) return;
    this.broken.add(type);
    this.events.emit(type);
  }

  isBroken(type: string): boolean {
    return this.broken.has(type);
  }

  /** kind 判定（✨角标与 perms 推导排除内置共用判据；未注册 → false） */
  isBuiltin(type: string): boolean {
    return this.defs.get(type)?.kind === 'builtin';
  }

  /** 装载前重置（DefinitionLoader 启动序专用：重载幂等——旧定义与旧 broken 判定不残留） */
  reset(): void {
    this.defs.clear();
    this.broken.clear();
  }
}
