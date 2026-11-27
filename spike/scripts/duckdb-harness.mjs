// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DuckDB-Wasm 数据层（Node / S5 基准用）。
// 对应架构原则 ①：数据留在 DuckDB 里，只把「已聚合」的结果交给视图 / R。
// 浏览器侧（AsyncDuckDB + Web Worker）待桌面窗口跑通后接入，接口保持一致。
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import path from 'node:path';
import { createRequire } from 'node:module';
import { whereClause } from '../../src/lib/selection.ts';

const require = createRequire(import.meta.url);
// package.json 未列入 exports，用已导出的 wasm 子路径反推 dist 目录。
const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'));

export const DUCKDB_WASM_VERSION = '1.32.0';

/** 本机 bundle，零外网（与 Phase 0「运行时禁止联网」红线一致）。 */
export function nodeBundles() {
  return {
    mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: null },
    eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: null },
  };
}

/** createDuckDB 只构造对象，必须再 instantiate() 才真正加载 WASM。 */
export async function createNodeDuckDB() {
  const t0 = performance.now();
  const db = await duckdb.createDuckDB(nodeBundles(), new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  const conn = db.connect();
  return { db, conn, instantiateMs: performance.now() - t0 };
}

/**
 * 执行查询并物化 Arrow 结果（真实读取列数据，模拟视图刷新）。
 * BIGINT 转 Number，避免 JSON 序列化报错。
 */
export function queryJson(conn, sql) {
  const table = conn.query(sql);
  const columns = table.schema.fields.map((f) => f.name);
  const first = table.schema.fields.map((_, i) => {
    const v = table.getChildAt(i)?.get(0);
    return typeof v === 'bigint' ? Number(v) : v;
  });
  return { numRows: table.numRows, columns, first };
}

/**
 * 按全局 selection store 编译谓词，刷新所有视图。
 * viewBuilders: (where: string) => string —— WHERE 必须在 GROUP BY / ORDER BY 之前。
 */
export function refreshViews(conn, viewBuilders, store, columns) {
  const where = whereClause(store.compile(columns));
  const results = viewBuilders.map((build) => queryJson(conn, build(where)));
  return { where, results };
}
