// 一次性探针：确认 @duckdb/duckdb-wasm 的 Node blocking 入口可用。
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// package.json 未列在 exports 中，改用已导出的 wasm 子路径反推 dist 目录。
const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'));
console.log('distDir =', distDir);
console.log('relevant exports =', Object.keys(duckdb).filter((k) => /Logger|Runtime|createDuckDB|selectBundle|DuckDB/.test(k)).sort().join(', '));

const bundles = {
  mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: null },
  eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: null },
};
const Logger = duckdb.VoidLogger ?? duckdb.ConsoleLogger;
const logger = new Logger();
const t0 = performance.now();
const db = await duckdb.createDuckDB(bundles, logger, duckdb.NODE_RUNTIME);
await db.instantiate();
console.log('createDuckDB + instantiate ok, ms =', (performance.now() - t0).toFixed(1));
const conn = db.connect();
const table = conn.query('SELECT 42::INTEGER AS answer, 3.14::DOUBLE AS pi, 1_000_000::BIGINT AS n');
console.log('numRows =', table.numRows, 'cols =', table.schema.fields.map((f) => f.name).join(','));
console.log('rows =', JSON.stringify(table.toArray().map((r) => r.toJSON())));
conn.close();
db.close?.();
console.log('PROBE_OK');
