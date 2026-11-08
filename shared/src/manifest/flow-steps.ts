// flow 发布 BFS 拓扑序 steps 序列化形（X-01 §1 manifest 行；01 A-13.2「flow 发布=BFS 拓扑序
// steps 序列化上传（安装端回放成流程）」；demo L2952-2953 序列化形参照非权威：
// steps = BFS 序 [type, name, params] 三元组数组）。
export type FlowStep = readonly [type: string, name: string, params: Record<string, unknown>];

export type FlowSteps = readonly FlowStep[];
