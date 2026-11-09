// S-1 ③ 安全基线静态断言（T3-01；C-01 §8 替换点③本卡侧断言——node 环境，file:// 定位可靠）。
// 断言对象=main 侧装配源：T0-08 最小壳（index.ts 单文件）→ T4-13 AppRuntime 收口后＝
// src/main 生产源全集（递归读取，含 runtime/**）。app:// 特权协议加载、webSecurity 恒 true、
// 无 file:// 直载构建产物。main 生命周期演进（T4-14~T4-20）后本断言持续守恒。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** 递归收集 src/main 生产源（排除 *.spec.ts/*.test.ts 测试文件） */
function readMainProductionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readMainProductionSources(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(entry.name)) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}

const mainSrc = readMainProductionSources(
  fileURLToPath(new URL('../../main', import.meta.url)),
).join('\n');

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
