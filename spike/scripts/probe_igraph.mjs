/**
 * igraph 卡点定位：分离「网络吞吐」与「webR 安装路径」两个变量。
 *
 * 诊断脚本显示 conf.design/rsm/DoE.base/MASS 等均秒级安装成功，
 * 唯独 igraph 超时 180s，FrF2 因硬依赖 igraph 被连带拖死。
 *
 * 需要回答三个问题：
 *   Q1 igraph 的二进制到底多大？（若数百 MB，慢是合理的）
 *   Q2 用 Node 原生 fetch 下载要多久？（Node 网络栈与 webR 的不同）
 *   Q3 igraph 自己还依赖哪些包？（依赖树可能才是真正体积来源）
 *
 * 若 Q2 显示 Node 下载很快，则说明瓶颈在 webR 的安装/解压/挂载路径，
 * 对策是「预下载 + 本地挂载」——这也正是桌面产品应有的做法：
 * JMP 不会在运行时联网下载组件，我们也应把 R 包打进安装包。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const REPO = 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6';
const PACKAGES_URL = `${REPO}/PACKAGES`;
const UA = 'mimic-jmp-phase0-spike/0.0.1';

/** 解析 CRAN PACKAGES 索引（段落以空行分隔，字段为 Key: Value） */
function parsePackages(text) {
  const out = new Map();
  for (const block of text.split(/\n\s*\n/)) {
    const entry = {};
    for (const line of block.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (m) entry[m[1]] = m[2].trim();
    }
    if (entry.Package) out.set(entry.Package, entry);
  }
  return out;
}

/** 从 Depends/Imports 字符串解析包名 */
function parseDeps(field) {
  if (!field) return [];
  return field
    .split(',')
    .map((s) => s.replace(/\(.*?\)/g, '').trim())
    .filter((s) => s && !['R', 'base', 'stats', 'utils', 'graphics', 'grDevices', 'methods'].includes(s));
}

const results = { repo: REPO, startedAt: new Date().toISOString() };

// ------------------------------------------------------------------ Q1/Q3
console.log('=== 下载 PACKAGES 索引 ===');
const tIdx = Date.now();
const idxRes = await fetch(PACKAGES_URL, { headers: { 'user-agent': UA } });
const idxText = await idxRes.text();
console.log(
  `索引: ${idxRes.status}, ${(idxText.length / 1024 / 1024).toFixed(2)}MB, ${Date.now() - tIdx}ms`
);

const pkgs = parsePackages(idxText);
console.log(`索引内包数: ${pkgs.size}\n`);

const TARGETS = ['igraph', 'FrF2', 'sfsmisc', 'scatterplot3d'];
const report = [];

for (const name of TARGETS) {
  const e = pkgs.get(name);
  if (!e) {
    console.log(`[缺失] ${name} 不在索引中`);
    report.push({ name, inIndex: false });
    continue;
  }
  const deps = [...new Set([...parseDeps(e.Depends), ...parseDeps(e.Imports)])];
  const file = e.File ?? `${name}_${e.Version}.tgz`;
  const sizeBytes = Number(e.Size ?? 0);
  const needsCompilation = e.NeedsCompilation;

  console.log(`--- ${name} v${e.Version} ---`);
  console.log(`  License: ${e.License ?? '?'}`);
  console.log(`  NeedsCompilation: ${needsCompilation}`);
  console.log(`  Size: ${sizeBytes ? (sizeBytes / 1024 / 1024).toFixed(2) + 'MB' : '(索引未给出)'}`);
  console.log(`  Depends/Imports(${deps.length}): ${deps.join(', ') || '(无)'}`);
  console.log(`  Built: ${e.Built ?? '?'}`);

  // 依赖各自的体积
  let depTotal = 0;
  const depSizes = [];
  for (const d of deps) {
    const de = pkgs.get(d);
    const ds = Number(de?.Size ?? 0);
    depTotal += ds;
    if (ds) depSizes.push(`${d}=${(ds / 1024 / 1024).toFixed(1)}MB`);
  }
  console.log(
    `  依赖体积合计: ${(depTotal / 1024 / 1024).toFixed(2)}MB` +
      (depSizes.length ? ` (${depSizes.sort().reverse().slice(0, 8).join(', ')})` : '')
  );
  console.log('');

  report.push({
    name,
    inIndex: true,
    version: e.Version,
    license: e.License,
    needsCompilation,
    sizeBytes,
    sizeMB: +(sizeBytes / 1024 / 1024).toFixed(2),
    file,
    deps,
    depTotalMB: +(depTotal / 1024 / 1024).toFixed(2),
  });
}
results.packages = report;

// ---------------------------------------------------------------------- Q2
// 直接用 Node fetch 下载 igraph 二进制，测原始吞吐
const ig = pkgs.get('igraph');
if (ig) {
  const file = ig.File ?? `igraph_${ig.Version}.tgz`;
  const url = `${REPO}/${file}`;
  console.log('=== Node 原生 fetch 直接下载 igraph 二进制 ===');
  console.log(`url: ${url}`);

  const tDl = Date.now();
  let bytes = 0;
  let status = 0;
  let err = null;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    status = res.status;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf.byteLength;
    }
  } catch (e) {
    err = String(e?.message || e);
  }
  const dlMs = Date.now() - tDl;
  const mbps = bytes / 1024 / 1024 / (dlMs / 1000);

  console.log(
    `  status=${status} bytes=${(bytes / 1024 / 1024).toFixed(2)}MB ` +
      `耗时=${(dlMs / 1000).toFixed(1)}s 吞吐=${mbps.toFixed(2)}MB/s` +
      (err ? ` err=${err}` : '')
  );
  results.nodeFetchIgraph = {
    url,
    status,
    bytes,
    mb: +(bytes / 1024 / 1024).toFixed(2),
    ms: dlMs,
    mbps: +mbps.toFixed(2),
    err,
  };
}

results.finishedAt = new Date().toISOString();
writeFileSync(
  join(RESULTS_DIR, 's2_igraph_probe.json'),
  JSON.stringify(results, null, 2),
  'utf8'
);
console.log('\n结果已写入 results/s2_igraph_probe.json');
process.exit(0);
