// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 联动状态的全局单一数据源（架构原则 ②）。
// 所有视图订阅同一个 store：框选 → 更新 → DuckDB 重查 → 全视图刷新。
//
// resolve 语义对齐 Vega-Lite 的 selection resolve：
//   global    —— 所有视图共享「一个」选择集，取最新一次框选（旧的被覆盖）
//   union     —— 多个视图各自框选，命中任一即选中（并集 / OR）
//   intersect —— 必须同时落在所有框选内（交集 / AND）
//
// 本文件不使用 enum / namespace / 参数属性 / private 修饰符，
// 因此可被 Node 22 的类型擦除直接执行（前端与 S5 基准共用同一份实现）。

export type ResolveMode = 'global' | 'union' | 'intersect';

export interface NumericRange {
  min: number;
  max: number;
}

export interface Brush {
  id: string;
  /** 发起框选的视图 id，仅用于诊断与去重 */
  source: string;
  x?: NumericRange;
  y?: NumericRange;
  /** 该视图绑定的数值列；缺省时回退到 compile() 传入的 columnMap */
  columns?: { x?: string; y?: string };
  createdAt: number;
}

export interface SelectionSnapshot {
  revision: number;
  resolveMode: ResolveMode;
  brushes: Brush[];
}

export interface SelectionPredicate {
  /** 不含 WHERE 关键字；空串表示无筛选（全量） */
  sql: string;
  mode: ResolveMode;
  brushCount: number;
  /** 真正参与合并的 brush 数（global 恒为 1） */
  effectiveBrushes: number;
}

export type ColumnMap = { x?: string; y?: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODES: ResolveMode[] = ['global', 'union', 'intersect'];

function assertRange(r: NumericRange, label: string): void {
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) {
    throw new Error(`${label} 必须是有限数值`);
  }
  if (r.min > r.max) throw new Error(`${label} min 不能大于 max`);
}

/** 列名走白名单 + 双引号包裹，杜绝 SQL 注入。 */
function quoteCol(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`非法列名（只接受 [A-Za-z_][A-Za-z0-9_]*）：${name}`);
  }
  return `"${name}"`;
}

/** 数值来自内部计算且已校验有限，直接内联为字面量（DuckDB blocking 无参数绑定）。 */
function num(n: number): string {
  return String(n);
}

function brushClause(b: Brush, fallback: ColumnMap): string {
  const cx = quoteCol(b.columns?.x ?? fallback.x ?? 'x');
  const cy = quoteCol(b.columns?.y ?? fallback.y ?? 'y');
  const parts: string[] = [];
  if (b.x) {
    assertRange(b.x, 'x');
    parts.push(`${cx} BETWEEN ${num(b.x.min)} AND ${num(b.x.max)}`);
  }
  if (b.y) {
    assertRange(b.y, 'y');
    parts.push(`${cy} BETWEEN ${num(b.y.min)} AND ${num(b.y.max)}`);
  }
  if (parts.length === 0) throw new Error(`brush ${b.id} 没有任何数值区间`);
  return `(${parts.join(' AND ')})`;
}

function effectiveBrushes(snapshot: SelectionSnapshot): Brush[] {
  const bs = snapshot.brushes;
  if (bs.length === 0) return [];
  // global：所有视图共享单一选择集，只有最新一次框选生效
  return snapshot.resolveMode === 'global' ? [bs[bs.length - 1]] : bs;
}

/**
 * union 模式的外接矩形预筛选（性能优化，语义严格等价）。
 * 行若命中任一 OR 子句，必然落在所有子句区间的外接矩形内，
 * 因此 `bbox AND (c1 OR c2) ≡ (c1 OR c2)`。
 * 目的：给 DuckDB 一个简单范围谓词用于 zonemap 裁剪，避免对每行反复求值复杂 OR。
 * 仅当所有 brush 都绑定同样的 x/y 列且都含双区间时才启用，否则保守跳过。
 */
function boundingClause(used: Brush[], columns: ColumnMap): string | null {
  if (used.length < 2) return null;
  const xCols = used.map((b) => b.columns?.x ?? columns.x ?? 'x');
  const yCols = used.map((b) => b.columns?.y ?? columns.y ?? 'y');
  if (new Set(xCols).size !== 1 || new Set(yCols).size !== 1) return null;
  const xs: NumericRange[] = [];
  const ys: NumericRange[] = [];
  for (const b of used) {
    if (!b.x || !b.y) return null;
    xs.push(b.x);
    ys.push(b.y);
  }
  const minX = Math.min(...xs.map((r) => r.min));
  const maxX = Math.max(...xs.map((r) => r.max));
  const minY = Math.min(...ys.map((r) => r.min));
  const maxY = Math.max(...ys.map((r) => r.max));
  return `${quoteCol(xCols[0])} BETWEEN ${num(minX)} AND ${num(maxX)} AND ${quoteCol(yCols[0])} BETWEEN ${num(minY)} AND ${num(maxY)}`;
}

/** 把联动状态编译成 DuckDB 的 WHERE 条件。 */
export function compilePredicate(
  snapshot: SelectionSnapshot,
  columns: ColumnMap = {},
): SelectionPredicate {
  const used = effectiveBrushes(snapshot);
  const clauses = used.map((b) => brushClause(b, columns));
  let sql: string;
  if (snapshot.resolveMode === 'intersect') {
    sql = clauses.join(' AND ');
  } else if (snapshot.resolveMode === 'union' && clauses.length > 1) {
    const bbox = boundingClause(used, columns);
    sql = bbox ? `(${bbox}) AND (${clauses.join(' OR ')})` : clauses.join(' OR ');
  } else {
    sql = clauses.join(' OR '); // global 恒为 1 个；union 单 brush
  }
  return {
    sql,
    mode: snapshot.resolveMode,
    brushCount: snapshot.brushes.length,
    effectiveBrushes: used.length,
  };
}

/** 便捷拼接：无筛选时返回空串，不会留下孤立的 WHERE。 */
export function whereClause(pred: SelectionPredicate): string {
  return pred.sql ? ` WHERE ${pred.sql}` : '';
}

function brushMatches(b: Brush, row: Record<string, number>, columns: ColumnMap): boolean {
  const cx = b.columns?.x ?? columns.x ?? 'x';
  const cy = b.columns?.y ?? columns.y ?? 'y';
  if (b.x) {
    const v = row[cx];
    if (typeof v !== 'number' || v < b.x.min || v > b.x.max) return false;
  }
  if (b.y) {
    const v = row[cy];
    if (typeof v !== 'number' || v < b.y.min || v > b.y.max) return false;
  }
  return true;
}

/**
 * 纯 JS 版命中判定，与 compilePredicate 语义严格一致。
 * 用途：① 单测里与 SQL 结果交叉验证；② 前端演示在不加载 DuckDB 时高亮数据点。
 */
export function matchesSelection(
  row: Record<string, number>,
  snapshot: SelectionSnapshot,
  columns: ColumnMap = {},
): boolean {
  const used = effectiveBrushes(snapshot);
  if (used.length === 0) return true;
  if (snapshot.resolveMode === 'intersect') {
    return used.every((b) => brushMatches(b, row, columns));
  }
  return used.some((b) => brushMatches(b, row, columns));
}

type Listener = (snapshot: SelectionSnapshot) => void;

/** 全局单一数据源。同一时刻只应存在一个实例（应用入口创建后由各视图共享）。 */
export class SelectionStore {
  _mode: ResolveMode = 'global';
  _brushes: Brush[] = [];
  _revision = 0;
  _listeners = new Set<Listener>();

  getSnapshot(): SelectionSnapshot {
    return {
      revision: this._revision,
      resolveMode: this._mode,
      brushes: [...this._brushes],
    };
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  }

  addBrush(brush: Brush): void {
    if (!brush.id) throw new Error('brush.id 不能为空');
    if (this._brushes.some((b) => b.id === brush.id)) {
      throw new Error(`brush.id 重复：${brush.id}`);
    }
    if (!brush.x && !brush.y) throw new Error(`brush ${brush.id} 没有任何数值区间`);
    if (brush.x) assertRange(brush.x, 'x');
    if (brush.y) assertRange(brush.y, 'y');
    this._brushes.push(brush);
    this._emit();
  }

  removeBrush(id: string): boolean {
    const next = this._brushes.filter((b) => b.id !== id);
    if (next.length === this._brushes.length) return false;
    this._brushes = next;
    this._emit();
    return true;
  }

  setResolveMode(mode: ResolveMode): void {
    if (!MODES.includes(mode)) throw new Error(`未知 resolve 模式：${mode}`);
    if (this._mode === mode) return;
    this._mode = mode;
    this._emit();
  }

  clear(): void {
    if (this._brushes.length === 0) return;
    this._brushes = [];
    this._emit();
  }

  compile(columns: ColumnMap = {}): SelectionPredicate {
    return compilePredicate(this.getSnapshot(), columns);
  }

  _emit(): void {
    this._revision += 1;
    const snap = this.getSnapshot();
    for (const fn of this._listeners) fn(snap);
  }
}
