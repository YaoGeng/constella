// ParamFormPreview —— schema 实时预览（T6-07；TDD-C-13 §3 ParamFormPreview 行「复用 C-02
// ParamFormRenderer 做 schema 预览（=未来抽屉表单渲染结果，X-8）| {schema: ParamField[]}' +
// 复用处=StepSchema；01 §5.3 PATH1 环节 3「提供 schema 预览（即未来抽屉表单的渲染结果）」）。
//
//   同源红线（X-8 两路径共用同一 schema DSL）：预览=C-02 ParamForm（../definition 合法面）
//   直渲染——非自绘表单；编辑期无实例 params 层，value={} 由模型层回填 default（覆盖序
//   PARAMS←config←params 归抽屉/运行面）。onChange/errors/secretBinder 不注入=纯预览态
//   （secret 控件只读掩码；校验回显归 StepSchema 行内，见 step-schema.tsx）。
import type { ParamField } from '@constella/shared/dsl';
import { ParamForm } from '../definition';

export interface ParamFormPreviewProps {
  /** N3 参数 schema（草稿直读——字段编辑即时反映） */
  schema: ParamField[];
}

export function ParamFormPreview({ schema }: ParamFormPreviewProps) {
  return (
    <div data-param-form-preview className="flex flex-col gap-1.5">
      <ParamForm schema={schema} value={{}} />
    </div>
  );
}
