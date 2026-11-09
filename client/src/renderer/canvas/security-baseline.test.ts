// S-1 ③ 安全基线静态断言（T3-01；C-01 §8 替换点③本卡侧断言——node 环境，file:// 定位可靠）。
// 断言对象=main 侧最小壳现状（T0-08 交付物）：app:// 特权协议加载、webSecurity 恒 true、
// 无 file:// 直载构建产物。main 生命周期演进（C-M1 AppRuntime）后本断言持续守恒。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSrc = readFileSync(
  fileURLToPath(new URL('../../main/index.ts', import.meta.url)),
  'utf8',
);

describe('S-1 ③ 安全基线（T3-01 核对项）', () => {
  it('webSecurity 恒 true（不关闭安全策略）', () => {
    expect(mainSrc).toContain('webSecurity: true');
    expect(mainSrc).not.toMatch(/webSecurity:\s*false/);
  });

  it('renderer 经 app:// 协议加载、无 file:// 直载', () => {
    expect(mainSrc).toContain("loadURL('app://./index.html')");
    expect(mainSrc).not.toMatch(/loadFile\s*\(/);
  });
});
