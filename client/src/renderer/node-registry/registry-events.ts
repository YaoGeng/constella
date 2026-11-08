// RegistryEvents —— 注册表变更通知（C-05 §3 组件行；T1-09）。
// ⚠ 02 未定义变更通知——卡内冻结语义：注册（新注册/同名同型覆盖）与 broken 标记均触发，
// 消费方（类型网格/画布/节点库）收到后自行重读注册表；退订后不再收（demo libAdd 后刷新，01 A-11.1）。
export type RegistryChangeListener = (type: string) => void;

export class RegistryEvents {
  private readonly listeners = new Set<RegistryChangeListener>();

  /** 订阅变更；返回退订函数 */
  onChange(fn: RegistryChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 广播一条变更（type 粒度）；快照遍历——回调内退订/再订阅不炸迭代 */
  emit(type: string): void {
    for (const fn of [...this.listeners]) fn(type);
  }
}
