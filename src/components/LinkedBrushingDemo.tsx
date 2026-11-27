// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Linked Brushing 可运行演示：散点图框选 → 全局 selection store → 直方图联动。
// 与 S5 基准共用同一份 src/lib/selection.ts，因此这里显示的 SQL 谓词
// 就是 DuckDB 数据层真正会执行的条件。
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { SelectionStore, matchesSelection, type ResolveMode } from '../lib/selection';
import { makeDemoData, buildHistogram, X_DOMAIN, Y_DOMAIN } from '../lib/demoData';
import { S5_RESULT } from '../lib/s5Result';

const W = 440;
const H = 250;
const PAD = 30;
const PLOT_W = W - 2 * PAD;
const PLOT_H = H - 2 * PAD;

const sx = (v: number) => PAD + ((v - X_DOMAIN[0]) / (X_DOMAIN[1] - X_DOMAIN[0])) * PLOT_W;
const sy = (v: number) => H - PAD - ((v - Y_DOMAIN[0]) / (Y_DOMAIN[1] - Y_DOMAIN[0])) * PLOT_H;
const invX = (px: number) => X_DOMAIN[0] + ((px - PAD) / PLOT_W) * (X_DOMAIN[1] - X_DOMAIN[0]);
const invY = (py: number) => Y_DOMAIN[0] + ((H - PAD - py) / PLOT_H) * (Y_DOMAIN[1] - Y_DOMAIN[0]);

interface DragState { x0: number; y0: number; x1: number; y1: number }

function localPoint(e: MouseEvent<SVGSVGElement>): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (W / r.width),
    y: (e.clientY - r.top) * (H / r.height),
  };
}

const MODES: ResolveMode[] = ['global', 'union', 'intersect'];

export default function LinkedBrushingDemo() {
  const data = useMemo(() => makeDemoData(1600), []);
  const store = useMemo(() => new SelectionStore(), []);
  const [snap, setSnap] = useState(() => store.getSnapshot());
  const [drag, setDrag] = useState<DragState | null>(null);
  const brushSeq = useRef(0);

  useEffect(() => store.subscribe(setSnap), [store]);

  const hits = useMemo(() => {
    const ids = new Set<number>();
    for (const p of data) {
      const row: Record<string, number> = { temp: p.temp, yield: p.yield };
      if (matchesSelection(row, snap, { x: 'temp', y: 'yield' })) ids.add(p.id);
    }
    return ids;
  }, [data, snap]);

  const bins = useMemo(() => buildHistogram(data, hits), [data, hits]);
  const maxAll = Math.max(1, ...bins.map((b) => b.all));
  const predicate = store.compile({ x: 'temp', y: 'yield' });

  function onDown(e: MouseEvent<SVGSVGElement>) {
    const p = localPoint(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onMove(e: MouseEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = localPoint(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }
  function onUp(e: MouseEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = localPoint(e);
    const x0 = Math.min(drag.x0, p.x);
    const x1 = Math.max(drag.x0, p.x);
    const y0 = Math.min(drag.y0, p.y);
    const y1 = Math.max(drag.y0, p.y);
    if (x1 - x0 > 4 && y1 - y0 > 4) {
      brushSeq.current += 1;
      store.addBrush({
        id: `brush-${brushSeq.current}`,
        source: 'scatter',
        x: { min: invX(x0), max: invX(x1) },
        y: { min: invY(y1), max: invY(y0) },
        createdAt: Date.now(),
      });
    }
    setDrag(null);
  }

  return (
    <section className="card wide demo">
      <h2>Linked Brushing 演示 <span className="note">全局单一 selection store · 拖拽框选</span></h2>

      <div className="demo-controls">
        <span className="demo-label">resolve</span>
        {MODES.map((m) => (
          <button
            key={m}
            className={snap.resolveMode === m ? 'seg active' : 'seg'}
            onClick={() => store.setResolveMode(m)}
          >{m}</button>
        ))}
        <button className="seg ghost" onClick={() => store.clear()}>清空框选</button>
        <span className="demo-hits">{hits.size} / {data.length} 行命中</span>
      </div>

      <div className="demo-charts">
        <div className="demo-chart">
          <div className="chart-title">散点 · 温度 × 良率</div>
          <svg
            className="demo-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onMouseLeave={() => setDrag(null)}
          >
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="axis" />
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="axis" />
            {[120, 140, 160, 180].map((v) => (
              <text key={v} x={sx(v)} y={H - PAD + 15} className="tick" textAnchor="middle">{v}</text>
            ))}
            {[40, 60, 80, 100].map((v) => (
              <text key={v} x={PAD - 6} y={sy(v) + 4} className="tick" textAnchor="end">{v}</text>
            ))}
            {data.map((p) => (
              <circle
                key={p.id}
                cx={sx(p.temp)} cy={sy(p.yield)} r={2}
                className={hits.has(p.id) ? 'pt hit' : 'pt'}
              />
            ))}
            {drag && (
              <rect
                x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)}
                width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)}
                className="brush-rect"
              />
            )}
          </svg>
          <p className="hint">在图上按住鼠标拖拽框选；切换模式后再框选，可观察 union / intersect 的合并效果。</p>
        </div>

        <div className="demo-chart">
          <div className="chart-title">Distribution · 温度分布（淡=全量，深=选中）</div>
          <svg className="demo-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="axis" />
            {bins.map((b, i) => {
              const bw = PLOT_W / bins.length;
              const ha = (b.all / maxAll) * PLOT_H;
              const hh = (b.hit / maxAll) * PLOT_H;
              return (
                <g key={b.label}>
                  <rect x={PAD + i * bw + 1} y={H - PAD - ha} width={bw - 2} height={ha} className="bar all" />
                  <rect x={PAD + i * bw + 1} y={H - PAD - hh} width={bw - 2} height={hh} className="bar hit" />
                </g>
              );
            })}
            <text x={PAD} y={H - PAD + 15} className="tick">120</text>
            <text x={W - PAD} y={H - PAD + 15} className="tick" textAnchor="end">180</text>
          </svg>
          <p className="hint">直方图直接订阅同一个 store；框选后全量柱保持淡色，选中部分叠加高亮。</p>
        </div>
      </div>

      <div className="predicate">
        <strong>编译出的 SQL 谓词</strong>
        <code>{predicate.sql || '（无筛选 · 全量）'}</code>
        <span>revision {snap.revision} · {snap.brushes.length} 个 brush · 生效 {predicate.effectiveBrushes} 个</span>
      </div>

      <div className="s5-card">
        <strong>S5 百万行基准 · {S5_RESULT.verdict}</strong>
        <span>{S5_RESULT.rows.toLocaleString()} 行 / {S5_RESULT.views} 视图 · p50 {S5_RESULT.p50Ms}ms · p95 {S5_RESULT.p95Ms}ms &lt; {S5_RESULT.thresholdMs}ms</span>
        <span>精确 union 双框选 {S5_RESULT.exactUnionP50Ms}ms 超标 → 预聚合 {S5_RESULT.preaggUnionP50Ms}ms（边界误差 {S5_RESULT.boundaryErrorPct}%）</span>
        <span className="s5-note">复跑：npm run verify:s5 · 引擎 {S5_RESULT.engine}</span>
      </div>
    </section>
  );
}
