// SPDX-License-Identifier: AGPL-3.0-or-later
// 联动内核纯逻辑单测（不依赖 DuckDB / 浏览器，Node 直接跑 .ts）。
// 与 Phase 0 各 spike 同风格：逐项断言 + 退出码，可进 CI。
import {
  SelectionStore, compilePredicate, whereClause, matchesSelection,
} from '../../src/lib/selection.ts';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
const brush = (id, x, y, extra = {}) => ({
  id, source: 'view-a', createdAt: Date.now(),
  ...(x ? { x } : {}), ...(y ? { y } : {}), ...extra,
});

console.log('\n=== selection store 单测 ===\n');

// 1. 空状态
const s0 = new SelectionStore();
check('空 store 谓词为空串', s0.compile().sql === '', `sql=${JSON.stringify(s0.compile().sql)}`);
check('空 store effectiveBrushes=0', s0.compile().effectiveBrushes === 0);
check('空 store whereClause 不产生孤立 WHERE', whereClause(s0.compile()) === '');
check('空 store 命中所有行', matchesSelection({ x: 1, y: 2 }, s0.getSnapshot()));

// 2. 单区间与双区间
const s1 = new SelectionStore();
s1.addBrush(brush('b1', { min: 10, max: 20 }));
const p1 = s1.compile({ x: 'temp', y: 'yield' });
check('单区间使用 columnMap 列名', p1.sql === '("temp" BETWEEN 10 AND 20)', p1.sql);
check('单区间 whereClause 带 WHERE', whereClause(p1) === ' WHERE ("temp" BETWEEN 10 AND 20)');

const s2 = new SelectionStore();
s2.addBrush(brush('b2', { min: 10, max: 20 }, { min: 60, max: 90 }));
const p2 = s2.compile({ x: 'temp', y: 'yield' });
check('双区间用 AND 连接', p2.sql === '("temp" BETWEEN 10 AND 20 AND "yield" BETWEEN 60 AND 90)', p2.sql);

// 3. 三种 resolve 语义
const s3 = new SelectionStore();
s3.addBrush(brush('b1', { min: 1, max: 2 }));
s3.addBrush(brush('b2', { min: 100, max: 200 }));
const pg = s3.compile();
check('global 取最新框选', pg.sql === '("x" BETWEEN 100 AND 200)' && pg.effectiveBrushes === 1, pg.sql);
check('global brushCount 仍为 2', pg.brushCount === 2);

s3.setResolveMode('union');
const pu = s3.compile();
check('union 用 OR 连接', pu.sql === '("x" BETWEEN 1 AND 2) OR ("x" BETWEEN 100 AND 200)', pu.sql);
check('union effectiveBrushes=2', pu.effectiveBrushes === 2);

s3.setResolveMode('intersect');
const pi = s3.compile();
check('intersect 用 AND 连接', pi.sql === '("x" BETWEEN 1 AND 2) AND ("x" BETWEEN 100 AND 200)', pi.sql);

// 4. 纯 JS 匹配与 SQL 语义一致
const snap = s3.getSnapshot();
check('intersect 无行能同时落在两个不相交区间', !matchesSelection({ x: 1.5 }, snap) && !matchesSelection({ x: 150 }, snap));
s3.setResolveMode('union');
check('union 命中任一区间', matchesSelection({ x: 1.5 }, s3.getSnapshot()) && matchesSelection({ x: 150 }, s3.getSnapshot()));
check('union 不命中区间外', !matchesSelection({ x: 50 }, s3.getSnapshot()));
s3.setResolveMode('global');
check('global 只命中最新区间', !matchesSelection({ x: 1.5 }, s3.getSnapshot()) && matchesSelection({ x: 150 }, s3.getSnapshot()));

// 5. brush 自带 columns 优先于 columnMap
const s4 = new SelectionStore();
s4.addBrush(brush('b4', { min: 0, max: 5 }, undefined, { columns: { x: 'pressure' } }));
check('brush.columns 覆盖 columnMap', s4.compile({ x: 'temp' }).sql === '("pressure" BETWEEN 0 AND 5)', s4.compile({ x: 'temp' }).sql);

// 6. 快照隔离与订阅
const s5 = new SelectionStore();
const seen = [];
const unsub = s5.subscribe((snap) => seen.push({ rev: snap.revision, n: snap.brushes.length }));
s5.addBrush(brush('b1', { min: 1, max: 2 }));
s5.addBrush(brush('b2', { min: 3, max: 4 }));
s5.setResolveMode('union');
s5.removeBrush('b1');
s5.clear();
check('5 次状态变更都通知订阅者', seen.length === 5, `notifications=${seen.length}`);
check('revision 单调递增', seen.every((v, i) => v.rev === i + 1), JSON.stringify(seen.map((v) => v.rev)));
check('clear 后 brushes 为空', s5.getSnapshot().brushes.length === 0);
const before = seen.length;
unsub();
s5.addBrush(brush('b3', { min: 1, max: 2 }));
check('取消订阅后不再通知', seen.length === before);
const snapCopy = s5.getSnapshot();
snapCopy.brushes.push(brush('injected', { min: 9, max: 9 }));
check('快照是副本，外部修改不污染 store', s5.getSnapshot().brushes.length === 1);

// 6b. union 外接矩形预筛选（性能优化，语义必须等价）
const s7 = new SelectionStore();
s7.setResolveMode('union');
s7.addBrush(brush('u1', { min: 1, max: 10 }, { min: 1, max: 10 }));
s7.addBrush(brush('u2', { min: 20, max: 30 }, { min: 20, max: 30 }));
const pb = s7.compile();
check('union 双区间生成外接矩形预筛选',
  pb.sql === '("x" BETWEEN 1 AND 30 AND "y" BETWEEN 1 AND 30) AND (("x" BETWEEN 1 AND 10 AND "y" BETWEEN 1 AND 10) OR ("x" BETWEEN 20 AND 30 AND "y" BETWEEN 20 AND 30))',
  pb.sql);
const snap7 = s7.getSnapshot();
const probes = [
  { x: 5, y: 5 }, { x: 25, y: 25 }, { x: 15, y: 15 }, { x: 5, y: 25 }, { x: -1, y: 5 },
];
const expected = [true, true, false, false, false];
check('bbox 不改变 union 命中语义',
  probes.every((p, i) => matchesSelection(p, snap7) === expected[i]),
  JSON.stringify(probes.map((p) => matchesSelection(p, snap7))));

// 7. 输入校验（防止 SQL 注入 / 脏状态）
const s6 = new SelectionStore();
s6.addBrush(brush('dup', { min: 1, max: 2 }));
check('拒绝重复 brush.id', throws(() => s6.addBrush(brush('dup', { min: 3, max: 4 }))));
check('拒绝无区间的 brush', throws(() => s6.addBrush(brush('empty'))));
check('拒绝 NaN 区间', throws(() => s6.addBrush(brush('nan', { min: NaN, max: 1 }))));
check('拒绝 min > max', throws(() => s6.addBrush(brush('rev', { min: 5, max: 1 }))));
check('拒绝非法列名注入', throws(() => compilePredicate(
  { revision: 1, resolveMode: 'global', brushes: [brush('inj', { min: 1, max: 2 }, undefined, { columns: { x: 'x; DROP TABLE wafer' } })] },
)));
check('拒绝未知 resolve 模式', throws(() => s6.setResolveMode('nonsense')));
check('removeBrush 不存在时返回 false', s6.removeBrush('missing') === false);

console.log(`\n  检查项 ${pass}/${pass + fail} 通过\n`);
process.exit(fail === 0 ? 0 : 1);
