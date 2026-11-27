/**
 * Phase 0 spike 公共运行骨架。
 *
 * 封装已经跑通并定型的部分：webR 启动（含 Windows shim）、NODEFS 挂载
 * 预置 library、.libPaths() 注入、结果落盘、进程收尾。
 * S4 / S6 只写各自的验证逻辑，不重复这些样板代码。
 *
 * 【调用顺序】必须先 `await import('webr')` 再 `installWorkerShim()`：
 * webR 在模块加载期会覆盖 globalThis.Worker，提前打的补丁会被冲掉。
 */

import { installWorkerShim, WEBR_BASE_URL, shimInfo } from './webr-node-shim.mjs';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LIB = join(ROOT, 'local-repo', 'library');
export const RESULTS_DIR = join(ROOT, 'results');
export const MOUNTPOINT = '/rlib';

export function libraryPackageCount() {
  if (!existsSync(LIB)) return 0;
  return readdirSync(LIB, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
}

/**
 * @param {object} meta  { spike, title, ... }，spike 同时作为结果文件名
 * @param {(ctx) => Promise<number>} mainFn  返回退出码（0 通过 / 1 失败）
 * @returns {Promise<number>} 退出码
 */
export async function runSpike(meta, mainFn) {
  const { WebR } = await import('webr');
  installWorkerShim();
  mkdirSync(RESULTS_DIR, { recursive: true });

  const results = {
    ...meta,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    windowsShim: shimInfo,
    architecture: '预编译 WASM R 包随安装包分发，NODEFS 挂载，运行时零外网',
    libraryDir: LIB,
    libraryPackageCount: libraryPackageCount(),
    checks: [],
  };
  const outFile = join(RESULTS_DIR, `${meta.spike}.json`);
  const save = () => writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  const log = (m) => console.log(m);
  const record = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    save();
    return ok;
  };

  let webR = null;
  let exitCode = 1;
  try {
    const tBoot = Date.now();
    webR = new WebR({ baseUrl: WEBR_BASE_URL });
    await webR.init();
    results.bootMs = Date.now() - tBoot;
    log(`  webR 启动 ${results.bootMs}ms | library ${results.libraryPackageCount} 个包`);

    await webR.FS.mkdir(MOUNTPOINT);
    const tMount = Date.now();
    await webR.FS.mount('NODEFS', { root: LIB }, MOUNTPOINT);
    results.mountMs = Date.now() - tMount;
    await webR.evalRVoid(`.libPaths(c("${MOUNTPOINT}", .libPaths()))`);
    log(`  NODEFS 挂载 ${results.mountMs}ms -> ${MOUNTPOINT}`);

    const ev = async (code) => (await webR.evalRString(code)).trim();
    const evVoid = async (code) => { await webR.evalRVoid(code); };

    exitCode = await mainFn({ webR, ev, evVoid, record, save, results, log });
    if (!results.verdict) results.verdict = exitCode === 0 ? 'GO' : 'NO-GO';
  } catch (err) {
    results.fatal = String(err?.stack || err);
    results.verdict = 'ERROR';
    log(`\n[FATAL] ${String(err?.message || err)}`);
    exitCode = 1;
  } finally {
    results.finishedAt = new Date().toISOString();
    results.totalMs = Date.now() - Date.parse(results.startedAt);
    save();
    log(`\n=== ${meta.spike} 结论: ${results.verdict} | ${(results.totalMs / 1000).toFixed(1)}s ===`);
    log(`  结果已写入 results/${meta.spike}.json`);
    try { if (webR) await webR.close(); } catch {}
  }
  return exitCode;
}
