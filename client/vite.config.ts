// Constella client — renderer 构建配置（T0-08；TDD-C-M1 §3 AppRuntime 行：app:// 加载 ESM 产物）。
//
// - root 固定 src/renderer（index.html 即构建入口）；产物输出 dist/renderer
// - base './'：产物内资源引用为相对路径，在 app://./index.html 标准特权协议下正确解析
//   （S-1 结论③：file:// 直载 ESM 会被 CORS 拦截，产品化沿自定义协议，无需关 webSecurity）
// - target es2022：与仓库 tsconfig.base.json target 对齐
// - renderer 框架依赖（react/@xyflow 等）随 P3 波 C-01 引入时在此增补插件与别名
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
});
