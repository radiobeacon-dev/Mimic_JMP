// SPDX-License-Identifier: AGPL-3.0-or-later
//
// S5 基准展示值（2026-11-27 多次复跑的代表值），来源：
//   npm run verify:s5 → spike/results/s5_linked_brushing.json
// 该 JSON 属本地验证产物（spike/results/ 不入库），故此处固化展示结论。
// 随机数据会让每次复跑有 ±2ms 波动：p95 稳定在 49–51ms；
// 精确 union 稳定在 140–145ms；预聚合稳定在 3.4–3.5ms。以结果文件为准。

export const S5_RESULT = {
  verdict: 'GO',
  date: '2026-11-27',
  engine: 'DuckDB-Wasm 1.32.0 (node blocking)',
  rows: 1_000_000,
  views: 3,
  thresholdMs: 100,
  p50Ms: 35.56,
  p95Ms: 49.37,
  exactUnionP50Ms: 141.46,
  preaggUnionP50Ms: 3.46,
  boundaryErrorPct: 9.32,
} as const;
