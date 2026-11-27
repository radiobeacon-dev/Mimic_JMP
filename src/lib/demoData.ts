// SPDX-License-Identifier: AGPL-3.0-or-later
// 前端联动演示用的确定性模拟数据（半导体封装工艺参数 vs 良率）。
// 与 S5 基准的生成公式一致，便于肉眼核对交互结果；不依赖 DuckDB。

export interface DemoPoint {
  id: number;
  temp: number;
  yield: number;
  tool: number;
}

export const X_DOMAIN: [number, number] = [120, 180];
export const Y_DOMAIN: [number, number] = [40, 105];

/** 线性同余伪随机，保证每次渲染数据完全一致（可复现）。 */
export function makeDemoData(n = 2000): DemoPoint[] {
  let seed = 20261127;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: DemoPoint[] = [];
  for (let i = 0; i < n; i++) {
    const temp = 120 + rnd() * 60;
    const pressure = 2 + rnd() * 8;
    const u = rnd();
    out.push({
      id: i,
      temp,
      yield: 72 + 0.18 * (temp - 150) - 1.6 * (pressure - 6) + (u - 0.5) * 12,
      tool: i % 8,
    });
  }
  return out;
}

export interface HistBin {
  label: number;
  all: number;
  hit: number;
}

/** 全量淡色柱 + 选中深色柱（JMP Distribution 的典型画法）。 */
export function buildHistogram(points: DemoPoint[], hits: Set<number>, binWidth = 5): HistBin[] {
  const count = Math.round((X_DOMAIN[1] - X_DOMAIN[0]) / binWidth);
  const bins: HistBin[] = Array.from({ length: count }, (_, i) => ({
    label: X_DOMAIN[0] + i * binWidth, all: 0, hit: 0,
  }));
  for (const p of points) {
    const idx = Math.min(count - 1, Math.max(0, Math.floor((p.temp - X_DOMAIN[0]) / binWidth)));
    bins[idx].all += 1;
    if (hits.has(p.id)) bins[idx].hit += 1;
  }
  return bins;
}
