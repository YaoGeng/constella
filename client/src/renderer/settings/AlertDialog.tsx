// AlertDialog —— 应用内二次确认弹窗（T6-12；02 §13.3 v1.0b 勘误「应用内二次确认弹窗」＋
// 01 A-14.3「二次确认弹窗保留」语义锚；TDD-C-11 §1 冻结=shadcn AlertDialog 语义）。
//
// ⚠ 实现注记：components.json 已配 shadcn（D-9 copy-in 基线），但 `renderer/components/ui/`
// 目录与 @radix-ui 依赖尚未落库（本卡领地限 settings/**＋任务纪律「不引入新依赖」）——故此处
// 为语义等价的自持受控实现（open/onCancel/onAction 两步确认），T6-16 walk/后续卡如统一 copy-in
// shadcn 组件可原位替换（props 面已按 AlertDialog 语义命名）。UI=LoginDialog.tsx 先例同源
// （tailwind＋全局 CSS 变量）。
import type { ReactNode } from 'react';

export interface AlertDialogProps {
  /** 受控开关（DangerZoneSection 持有——trigger 模式由调用方组合） */
  open: boolean;
  title: string;
  description?: ReactNode;
  /** 取消钮文案（缺省「取消」） */
  cancelText?: string;
  /** 确认钮文案（缺省「确认」） */
  actionText?: string;
  /** 破坏性动作样式（红） */
  destructive?: boolean;
  /** 确认中（禁用双钮防双发） */
  busy?: boolean;
  onCancel(): void;
  onAction(): void;
}

export function AlertDialog({
  open,
  title,
  description,
  cancelText = '取消',
  actionText = '确认',
  destructive = false,
  busy = false,
  onCancel,
  onAction,
}: AlertDialogProps) {
  if (!open) return null;
  return (
    <div
      data-danger="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(3,6,16,0.72)]"
    >
      <div className="flex w-80 flex-col gap-3 rounded-lg border border-[var(--line-2)] bg-[rgba(9,14,28,0.96)] p-4 shadow-2xl">
        <b className="text-sm font-semibold text-[var(--tx)]">{title}</b>
        {description != null && <div className="text-xs leading-5 text-[var(--tx-2)]">{description}</div>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            data-danger="cancel"
            disabled={busy}
            className="rounded-md border border-[var(--line-2)] px-3 py-1.5 text-sm text-[var(--tx-2)] hover:bg-[var(--accent-tint)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            data-danger="confirm"
            disabled={busy}
            className={
              destructive
                ? 'rounded-md bg-[rgba(160,30,50,0.9)] px-3 py-1.5 text-sm font-semibold text-[#ffd7de] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
                : 'rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[#04101f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
            }
            onClick={onAction}
          >
            {busy ? '执行中…' : actionText}
          </button>
        </div>
      </div>
    </div>
  );
}
