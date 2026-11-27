// SPDX-License-Identifier: AGPL-3.0-or-later
// 前端联动演示的 SSR 冒烟测试：构建通过 ≠ 运行时不抛错。
// 借 Vite 的 ssrLoadModule 直接加载 .tsx，验证 React 渲染与 store 初始化。
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// spike/node_modules 下另有一份 react-dom；必须从项目根解析，否则两份 React 实例
// 会触发 "Invalid hook call"。createRequire 以根 package.json 为基准。
const rootRequire = createRequire(join(ROOT, 'package.json'));
const React = rootRequire('react');
const { renderToString } = rootRequire('react-dom/server');
let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== Linked Brushing 演示 SSR 冒烟测试 ===\n');
const server = await createServer({
  root: ROOT,
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const mod = await server.ssrLoadModule('/src/components/LinkedBrushingDemo.tsx');
  const html = renderToString(React.createElement(mod.default));
  const circles = (html.match(/<circle/g) || []).length;
  const bars = (html.match(/class="bar/g) || []).length;
  check('组件渲染无异常', html.length > 1000, `html=${html.length} 字符`);
  check('渲染出演示标题', html.includes('Linked Brushing 演示'));
  check('散点图渲染 1600 个点', circles === 1600, `circles=${circles}`);
  check('直方图渲染双色柱', bars === 24, `bars=${bars}`);
  check('三种 resolve 模式按钮齐全',
    html.includes('>global<') && html.includes('>union<') && html.includes('>intersect<'));
  check('显示编译谓词（初始为全量）', html.includes('无筛选'));
  check('显示 S5 基准结论', html.includes('S5 百万行基准') && html.includes('GO'));
} finally {
  await server.close();
}
console.log(`\n  检查项 ${pass}/${pass + fail} 通过\n`);
process.exit(fail === 0 ? 0 : 1);
