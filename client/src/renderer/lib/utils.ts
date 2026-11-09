// shadcn copy-in 基线工具（T3-01）：cn = clsx + tailwind-merge——后续 shadcn 组件
// copy-in（`pnpm -F ./client exec shadcn add …`）统一经此合并类名。D-9 拍板（copy-in 源码模式）。
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
