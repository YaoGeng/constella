// DefinitionLoader —— 启动装载序（C-05 §3 组件行；T1-10；02 §8.2）。
//
// 序：store 载入（NodeDefinitionStore 注入——测试内存实现/生产 IpcDefinitionStore 装配注入）
// → validate（C-02 注入式，缺省跳过）→ 失败标 broken → 批量注册 → LoadReport。
// ⚠ 实现序说明（有意偏离 §3 箭头序的调用次、观测等价）：先 register 后 markBroken——
// register 语义＝四路 upsert 统一入口、会清旧 broken 判定（RegistryCore），若先标后注册
// 则装载期 broken 判定被随后的 register 清空；§6.1c 观测面（isBroken true＋get 仍返回定义）不变。
// 种子先于校验（momus 观察2，03 §7.4#2）——本侧只消费注入校验器的 broken 标记，
// 不做种子质量校验；C-02 validateDefinition 随 P4 波注入，届时零改本文件（缺省跳过语义已留）。
// 重载幂等：装载前 reset——旧定义与旧 broken 判定不残留（启动序语义＝全量替换）。
import type { RegistryCore } from './registry-core';
import type { DefinitionValidator, LoadReport, NodeDefinitionStore } from './types';

export class DefinitionLoader {
  constructor(private readonly core: RegistryCore) {}

  async loadAll(
    store: NodeDefinitionStore,
    validate?: DefinitionValidator,
  ): Promise<LoadReport> {
    const docs = await store.loadAllDefinitions();
    this.core.reset();

    const broken: string[] = [];
    for (const doc of docs) {
      const result = validate?.(doc); // 缺省 → undefined → 跳过校验
      this.core.register(doc); // 批量注册（同名同型覆盖合并）
      if (result !== undefined && !result.ok) {
        this.core.markBroken(doc.type); // get 仍返回定义（画布 ⚠、运行闸拦截）
        if (!broken.includes(doc.type)) broken.push(doc.type);
      }
    }

    return { total: docs.length, loaded: this.core.list().length, broken };
  }
}
