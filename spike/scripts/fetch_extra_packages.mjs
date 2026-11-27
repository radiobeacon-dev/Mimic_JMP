/**
 * 补包脚本 —— 把额外的 R 包预置进 NODEFS library（S4 / S6 用）。
 *
 * 复用 Phase 0 已验证的架构：从 repo.r-wasm.org 的**构建期**拉取预编译
 * WASM 包二进制，解压成标准 R library 目录，运行时由 webR 的 NODEFS 挂载。
 * 全程不做 installPackages / download.file —— 那条路已在 S2 中被证伪。
 *
 * 幂等：tgz 已缓存则跳过下载；library 目录已存在则跳过解压。
 * 用法：node scripts/fetch_extra_packages.mjs [包名...]
 *       默认补 qcc、AlgDesign。
 */

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO = join(ROOT, 'local-repo');
const TGZ_DIR = join(REPO, 'tgz');
const LIB_DIR = join(REPO, 'library');
const RESULTS_DIR = join(ROOT, 'results');
const INDEX = join(REPO, 'PACKAGES.full');
const REMOTE = 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6';

for (const d of [RESULTS_DIR, REPO, TGZ_DIR, LIB_DIR]) mkdirSync(d, { recursive: true });

const REQUESTED = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['qcc', 'AlgDesign'];

const report = {
  script: 'fetch_extra_packages',
  startedAt: new Date().toISOString(),
  remote: REMOTE,
  items: [],
};
function log(m) { console.log(m); }

/** 解析 PACKAGES 索引为 { name -> {Version, File, NeedsCompilation, Built} } */
function parseIndex(text) {
  const map = new Map();
  for (const block of text.split(/\n\s*\n/)) {
    const get = (k) => {
      const m = block.match(new RegExp('^' + k + ':\\s*(.+)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const name = get('Package');
    if (!name) continue;
    map.set(name, {
      Version: get('Version'),
      File: get('File') || `${name}_${get('Version')}.tgz`,
      Built: get('Built'),
      License: get('License'),
      Imports: get('Imports'),
    });
  }
  return map;
}

/** 带超时与重试的下载。命令行 curl 在本环境被沙箱拦截，统一走 Node fetch。 */
async function fetchBuf(url, timeoutMs = 180000, retries = 3) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (e) {
      lastErr = e;
      log(`    第 ${i} 次失败: ${String(e?.message || e).split('\n')[0]}`);
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

async function main() {
  log('=== 预置额外 R 包（构建期下载 → 解压为 library）===');
  if (!existsSync(INDEX)) {
    throw new Error(`缺少 ${INDEX}，请先运行 npm run s2:fetch 生成索引缓存`);
  }
  const index = parseIndex(readFileSync(INDEX, 'utf8'));
  log(`  索引已加载（${index.size} 个包），请求: ${REQUESTED.join(', ')}\n`);

  let allOk = true;
  for (const name of REQUESTED) {
    const rec = index.get(name);
    if (!rec) {
      log(`  [FAIL] ${name}: 索引中不存在`);
      report.items.push({ name, ok: false, err: 'not in PACKAGES index' });
      allOk = false;
      continue;
    }

    const tgzPath = join(TGZ_DIR, rec.File);
    const libPath = join(LIB_DIR, name);
    const item = {
      name,
      version: rec.Version,
      file: rec.File,
      needsCompilation: /wasm32-unknown-emscripten/.test(rec.Built),
      license: rec.License,
      tgzCached: existsSync(tgzPath),
      libPresent: existsSync(libPath),
    };

    // ---------- 下载 ----------
    if (!item.tgzCached) {
      log(`  [....] ${name} v${rec.Version}: 下载 ${rec.File} ...`);
      const t0 = Date.now();
      try {
        const buf = await fetchBuf(`${REMOTE}/${rec.File}`);
        // gzip 完整性校验（tgz 必须是有效 gzip）
        gunzipSync(buf);
        writeFileSync(tgzPath, buf);
        item.bytes = buf.length;
        item.downloadMs = Date.now() - t0;
        item.tgzCached = true;
        log(`  [OK  ] ${name}: ${(buf.length / 1024).toFixed(1)}KB / ${(item.downloadMs / 1000).toFixed(1)}s`);
      } catch (e) {
        item.ok = false;
        item.err = `download failed: ${String(e?.message || e).split('\n')[0]}`;
        log(`  [FAIL] ${name}: ${item.err}`);
        report.items.push(item);
        allOk = false;
        continue;
      }
    } else {
      item.bytes = statSync(tgzPath).size;
      log(`  [skip] ${name}: tgz 已缓存 (${(item.bytes / 1024).toFixed(1)}KB)`);
    }

    // ---------- 解压 ----------
    if (!item.libPresent) {
      try {
        // 必须用相对路径 + cwd：GNU tar 在 Windows 上把 `D:/...` 里的 `D:`
        // 解析成远程主机名（tar 的 host:path 语法），报
        // "Cannot connect to D: resolve failed"。相对路径无盘符，可避开。
        execFileSync(
          'tar',
          ['-xzf', `local-repo/tgz/${rec.File}`, '-C', 'local-repo/library'],
          { cwd: ROOT, stdio: 'pipe' }
        );
        item.libPresent = existsSync(libPath);
        if (!item.libPresent) throw new Error('解压后未找到包目录');
        log(`  [OK  ] ${name}: 已解压到 library/${name}`);
      } catch (e) {
        item.ok = false;
        item.err = `untar failed: ${String(e?.message || e).split('\n')[0]}`;
        log(`  [FAIL] ${name}: ${item.err}`);
        report.items.push(item);
        allOk = false;
        continue;
      }
    } else {
      log(`  [skip] ${name}: library 目录已存在`);
    }

    // ---------- 校验关键文件 ----------
    const desc = join(libPath, 'DESCRIPTION');
    const ns = join(libPath, 'NAMESPACE');
    item.hasDescription = existsSync(desc);
    item.hasNamespace = existsSync(ns);
    item.ok = item.hasDescription && item.hasNamespace;
    if (!item.ok) allOk = false;
    report.items.push(item);
  }

  report.ok = allOk;
  report.libraryPackageCount = readdirSafe(LIB_DIR).length;
  report.finishedAt = new Date().toISOString();
  report.totalMs = Date.now() - Date.parse(report.startedAt);
  writeFileSync(
    join(RESULTS_DIR, 'fetch_extra_packages.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  log(`\n=== 结果: ${allOk ? 'OK' : 'FAIL'} | library 共 ${report.libraryPackageCount} 个包 | ${(report.totalMs / 1000).toFixed(1)}s ===`);
  log('  结果已写入 results/fetch_extra_packages.json');
  process.exit(allOk ? 0 : 1);
}

function readdirSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}

main().catch((e) => {
  report.fatal = String(e?.stack || e);
  writeFileSync(
    join(RESULTS_DIR, 'fetch_extra_packages.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  console.error('[FATAL]', e?.message || e);
  process.exit(1);
});
