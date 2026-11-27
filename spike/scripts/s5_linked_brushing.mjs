// SPDX-License-Identifier: AGPL-3.0-or-later
//
// S5：100 万行数据下的 Linked Brushing 全链路性能基准。
// 验收线（DEVELOPMENT_PLAN.md §Phase 0 表）：框选后全视图刷新 < 100ms。
//
// 链路：框选 → 更新全局 selection store → 编译 SQL 谓词 → DuckDB 重查 3 个视图
//       → 物化 Arrow 结果。与 Phase 0 的 S1/S2/S4/S6 同风格：可复跑、零外网、退出码即结论。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SelectionStore, whereClause, matchesSelection,
} from '../../src/lib/selection.ts';
import {
  createNodeDuckDB, queryJson, refreshViews, DUCKDB_WASM_VERSION,
} from './duckdb-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'results');
const OUT = join(RESULTS, 's5_linked_brushing.json');
const ROWS = 1_000_000;
const THRESHOLD_MS = 100;
const WARMUP = 5;
const RUNS = 30;

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))];
}
const round = (n, d = 2) => Number(n.toFixed(d));
const brush = (id, x, y) => ({ id, source: 'scatter-view', x, y, createdAt: Date.now() });

console.log(`\n=== S5 · 100 万行 Linked Brushing 基准 (DuckDB-Wasm ${DUCKDB_WASM_VERSION}) ===\n`);

const { db, conn, instantiateMs } = await createNodeDuckDB();
console.log(`  WASM 实例化: ${round(instantiateMs)} ms`);

// 1. 生成具有真实相关性的工业数据（温度 / 压力 / 机台 / 良率 / 膜厚）
const tGen = performance.now();
conn.query(`
CREATE TABLE wafer AS
WITH base AS (
  SELECT i::BIGINT AS id,
         (120 + random() * 60)::DOUBLE AS temp,
         (2 + random() * 8)::DOUBLE AS pressure,
         (i % 8)::INTEGER AS tool,
         random()::DOUBLE AS u
  FROM range(${ROWS}) t(i)
)
SELECT id, temp, pressure, tool,
       (72 + 0.18 * (temp - 150) - 1.6 * (pressure - 6) + (u - 0.5) * 12)::DOUBLE AS yield,
       (20 + u * 30)::DOUBLE AS thickness
FROM base
`);
const dataGenMs = performance.now() - tGen;
const rowCount = Number(queryJson(conn, 'SELECT count(*) AS n FROM wafer').first[0]);
check('生成 100 万行工业数据', rowCount === ROWS, `rows=${rowCount}, ${round(dataGenMs)} ms`);

// 三个视图：直方图 / 机台条形图 / 散点相关系数（WHERE 必须在 GROUP BY 前）
const VIEWS = [
  (w) => `SELECT floor(temp/5)*5 AS bin, count(*) AS n FROM wafer${w} GROUP BY 1 ORDER BY 1`,
  (w) => `SELECT tool, avg(yield) AS mean_yield, count(*) AS n FROM wafer${w} GROUP BY tool ORDER BY tool`,
  (w) => `SELECT corr(temp, yield) AS r, count(*) AS n FROM wafer${w}`,
];
const COLUMNS = { x: 'temp', y: 'yield' };

// 2. 无筛选基线
const store = new SelectionStore();
const baseline = refreshViews(conn, VIEWS, store, COLUMNS);
check('3 个视图均返回聚合结果', baseline.results.every((r) => r.numRows > 0),
  baseline.results.map((r) => r.numRows).join('/'));
const baselineRows = Number(baseline.results[2].first[1]);

// 3. 谓词生效 + 跨实现一致性（JS 匹配 vs SQL 谓词，呼应 R8 的独立复算思路）
const crossStore = new SelectionStore();
crossStore.addBrush(brush('cross', { min: 140, max: 160 }, { min: 60, max: 80 }));
const crossPred = crossStore.compile(COLUMNS);
conn.query('CREATE TABLE sample AS SELECT temp, yield FROM wafer LIMIT 2000');
const sqlHits = Number(queryJson(conn, `SELECT count(*) AS n FROM sample${whereClause(crossPred)}`).first[0]);
const sampleTable = conn.query('SELECT temp, yield FROM sample');
const sampleRows = sampleTable.toArray().map((r) => {
  const o = r.toJSON();
  return { temp: Number(o.temp), yield: Number(o.yield) };
});
const jsHits = sampleRows.filter((r) => matchesSelection(r, crossStore.getSnapshot(), COLUMNS)).length;
check('SQL 谓词与纯 JS 匹配结果一致', sqlHits === jsHits,
  `sqlHits=${sqlHits}, jsHits=${jsHits}, pred=${crossPred.sql}`);
const filteredRows = Number(queryJson(conn, `SELECT count(*) AS n FROM wafer${whereClause(crossPred)}`).first[0]);
check('框选确实缩小了数据集', filteredRows > 0 && filteredRows < rowCount,
  `filtered=${filteredRows} / ${rowCount}`);

// 4. 全链路计时（含 addBrush + 谓词编译 + 3 次查询 + Arrow 物化）
for (let i = 0; i < WARMUP; i++) {
  store.clear();
  store.addBrush(brush(`warm-${i}`, { min: 130 + i, max: 170 + i }, { min: 55 + i, max: 85 + i }));
  refreshViews(conn, VIEWS, store, COLUMNS);
}
const latencies = [];
for (let i = 0; i < RUNS; i++) {
  store.clear(); // 复位不计入：模拟开始一次新框选
  const t0 = performance.now();
  store.addBrush(brush(`run-${i}`, { min: 125 + i * 1.5, max: 165 + i * 1.5 }, { min: 50 + i, max: 90 + i }));
  refreshViews(conn, VIEWS, store, COLUMNS);
  latencies.push(performance.now() - t0);
}
const stats = {
  min: round(pct(latencies, 0)),
  p50: round(pct(latencies, 50)),
  p95: round(pct(latencies, 95)),
  max: round(pct(latencies, 100)),
  mean: round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
};
console.log(`  全链路延迟: min=${stats.min} p50=${stats.p50} p95=${stats.p95} max=${stats.max} mean=${stats.mean} ms`);
check(`p95 全视图刷新 < ${THRESHOLD_MS}ms`, stats.p95 < THRESHOLD_MS, `p95=${stats.p95} ms`);

// 5. 三种 resolve 模式都能跑通（各 10 次，记录 p50）
const modeStats = {};
for (const mode of ['global', 'union', 'intersect']) {
  const ms = new SelectionStore();
  ms.setResolveMode(mode);
  const l = [];
  for (let i = 0; i < 10; i++) {
    ms.clear();
    ms.setResolveMode(mode);
    const t0 = performance.now();
    ms.addBrush(brush(`${mode}-a-${i}`, { min: 130 + i, max: 155 + i }, { min: 55, max: 80 }));
    ms.addBrush(brush(`${mode}-b-${i}`, { min: 150, max: 175 }, { min: 65 + i, max: 88 }));
    refreshViews(conn, VIEWS, ms, COLUMNS);
    l.push(performance.now() - t0);
  }
  modeStats[mode] = round(pct(l, 50));
}
check('global / union / intersect 三种模式均可用',
  Object.values(modeStats).every((v) => v > 0 && Number.isFinite(v)),
  Object.entries(modeStats).map(([k, v]) => `${k}=${v}ms`).join(', '));

// 6. 预聚合立方体：union 超标的对策验证（计划里 S5 的 fallback = 降低联动粒度 / 预聚合）
//    按 2 单位分箱，只把「已聚合」的箱子送进视图；代价是边界 bin 的近似误差。
const tCube = performance.now();
conn.query(`
CREATE TABLE wafer_cube AS
SELECT floor(temp/2)::INTEGER AS tb,
       floor(yield/2)::INTEGER AS yb,
       tool,
       count(*)::BIGINT AS n,
       sum(temp)::DOUBLE AS sx,
       sum(yield)::DOUBLE AS sy,
       sum(temp*yield)::DOUBLE AS sxy,
       sum(temp*temp)::DOUBLE AS sxx,
       sum(yield*yield)::DOUBLE AS syy
FROM wafer GROUP BY 1, 2, 3
`);
const cubeBuildMs = performance.now() - tCube;
const cubeRows = Number(queryJson(conn, 'SELECT count(*) AS n FROM wafer_cube').first[0]);
const CUBE_VIEWS = [
  (w) => `SELECT tb*2 AS bin, sum(n) AS cnt FROM wafer_cube${w} GROUP BY 1 ORDER BY 1`,
  (w) => `SELECT tool, sum(sy)/sum(n) AS mean_yield, sum(n) AS cnt FROM wafer_cube${w} GROUP BY tool ORDER BY tool`,
  (w) => `SELECT (sum(sxy)-sum(sx)*sum(sy)/sum(n))/sqrt((sum(sxx)-sum(sx)*sum(sx)/sum(n))*(sum(syy)-sum(sy)*sum(sy)/sum(n))) AS r, sum(n) AS cnt FROM wafer_cube${w}`,
];
const binRange = (r) => `BETWEEN ${Math.floor(r.min / 2)} AND ${Math.floor(r.max / 2)}`;
function cubeWhere(bs) {
  const clauses = bs.map((b) => `(tb ${binRange(b.x)} AND yb ${binRange(b.y)})`);
  const bbox = `tb BETWEEN ${Math.floor(Math.min(...bs.map((b) => b.x.min)) / 2)} AND ${Math.floor(Math.max(...bs.map((b) => b.x.max)) / 2)} AND yb BETWEEN ${Math.floor(Math.min(...bs.map((b) => b.y.min)) / 2)} AND ${Math.floor(Math.max(...bs.map((b) => b.y.max)) / 2)}`;
  return ` WHERE (${bbox}) AND (${clauses.join(' OR ')})`;
}
const preaggLatencies = [];
let lastBs = [];
for (let i = 0; i < 10; i++) {
  lastBs = [
    { x: { min: 130 + i, max: 155 + i }, y: { min: 55, max: 80 } },
    { x: { min: 150, max: 175 }, y: { min: 65 + i, max: 88 } },
  ];
  const w = cubeWhere(lastBs);
  const t0 = performance.now();
  for (const build of CUBE_VIEWS) queryJson(conn, build(w));
  preaggLatencies.push(performance.now() - t0);
}
const preaggP50 = round(pct(preaggLatencies, 50));
const cubeCount = Number(queryJson(conn, `SELECT sum(n) AS n FROM wafer_cube${cubeWhere(lastBs)}`).first[0]);
const cmpStore = new SelectionStore();
cmpStore.setResolveMode('union');
cmpStore.addBrush(brush('c-a', lastBs[0].x, lastBs[0].y));
cmpStore.addBrush(brush('c-b', lastBs[1].x, lastBs[1].y));
const exactCount = Number(queryJson(conn, `SELECT count(*) AS n FROM wafer${whereClause(cmpStore.compile(COLUMNS))}`).first[0]);
const countErrorPct = round(Math.abs(cubeCount - exactCount) / exactCount * 100);
check('预聚合把 union 多框选拉回 <100ms', preaggP50 < THRESHOLD_MS,
  `cube=${cubeRows} 行, 构建 ${round(cubeBuildMs)}ms, p50=${preaggP50}ms`);
console.log(`  ⚠ 已知缺口：精确 union 双框选 p50=${modeStats.union}ms > ${THRESHOLD_MS}ms；`);
console.log(`    预聚合对策 p50=${preaggP50}ms，边界分箱计数误差 ${countErrorPct}%（近似，非精确）`);

const verdict = stats.p95 < THRESHOLD_MS && fail === 0 ? 'GO' : 'NO-GO';
console.log(`\n  检查项 ${pass}/${pass + fail} 通过`);
console.log(`  === s5_linked_brushing 结论: ${verdict} | ${round((performance.now() - tGen) / 1000, 1)}s ===\n`);

mkdirSync(RESULTS, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  spike: 'S5',
  verdict,
  timestamp: new Date().toISOString(),
  engine: `DuckDB-Wasm ${DUCKDB_WASM_VERSION} (node blocking, wasm32)`,
  rows: rowCount,
  views: VIEWS.length,
  thresholdMs: THRESHOLD_MS,
  warmupRuns: WARMUP,
  measuredRuns: RUNS,
  instantiateMs: round(instantiateMs),
  dataGenMs: round(dataGenMs),
  baselineRows,
  filteredRows,
  latencyMs: stats,
  resolveModesP50Ms: modeStats,
  crossCheck: { sqlHits, jsHits, consistent: sqlHits === jsHits },
  knownGap: {
    exactUnionP50Ms: modeStats.union,
    overThreshold: modeStats.union >= THRESHOLD_MS,
    mitigation: '2-unit bin pre-aggregation cube (lower linkage granularity)',
    cubeRows,
    cubeBuildMs: round(cubeBuildMs),
    preaggUnionP50Ms: preaggP50,
    boundaryCountErrorPct: countErrorPct,
    note: '预聚合是近似路径，边界 bin 整箱计入；产品层可在大结果集的 union 模式下启用降级。',
  },
  checks: { passed: pass, failed: fail },
  notes: '数据留在 DuckDB，只把 3 个视图的聚合结果物化；零外网；WEBR/Pyodide 未参与。',
}, null, 2) + '\n', 'utf8');
console.log(`  结果已写入 ${OUT}`);

conn.close();
db.close?.();
process.exit(verdict === 'GO' ? 0 : 1);
