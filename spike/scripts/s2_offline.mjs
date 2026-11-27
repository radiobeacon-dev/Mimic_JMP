/**
 * S2 决定性收口：本地离线 repo + FrF2 / rsm / DoE.base 设计矩阵硬验证
 *
 * 背景
 * ----
 * 前几轮已证明：
 *   - S1 全项 PASS（webR 启动 500ms、lm 对齐公开参考值、图形设备可用）
 *   - conf.design / estimability / rsm / MASS / DoE.base / lattice /
 *     Matrix / cli / lifecycle / magrittr / igraph / sfsmisc /
 *     scatterplot3d 全部能从 repo.r-wasm.org 装上并 requireNamespace 成功
 *   - 唯独 FrF2 卡 600s 超时，且日志连 "Downloading" 都没打出
 *
 * 根因判断：不是 FrF2 不兼容 WASM（它是纯 R 包 NeedsCompilation:no，
 * 且 4 个依赖全部实装成功），而是 repo.r-wasm.org 在本机链路上实测
 * 仅 0.08MB/s，叠加 webR 默认 downloadTimeout=0（同步 XHR 无超时），
 * 单个请求挂住就永久阻塞。
 *
 * 本脚本的做法（也是产品应有的架构）
 * ----------------------------------
 *   1. Node 侧预下载完整 PACKAGES 索引（带超时重试）
 *   2. 解析索引，自动计算目标包的完整依赖闭包
 *   3. 并发下载闭包内所有 .tgz 到 spike/local-repo/tgz/（带超时重试）
 *   4. 生成只含闭包条目的精简 PACKAGES 索引
 *   5. 起本地 HTTP server；扁平文件名匹配，忽略 webR 拼的子路径
 *   6. webR 用 repoUrl=http://127.0.0.1:PORT + downloadTimeout=30s
 *   7. 跑 go/no-go 硬标准：FrF2(nruns=12,nfactors=7) 出 12x7 设计矩阵、
 *      rsm::ccd() 出响应面设计、DoE.base::oa.design() 出正交表
 *
 * 这一步同时验证：桌面产品「把 R 包预置进安装包、运行时零联网」，
 * 而不是像 spike 这样每次启动都去外网拉组件。JMP 从不运行时下载组件。
 *
 * 运行：node scripts/s2_offline.mjs
 * 可调：S2_EXTRAS=1 追加 qcc / AlgDesign / ggDoE（会拖进 ggplot2 全家，较重）
 */

import { installWorkerShim, WEBR_BASE_URL, shimInfo } from './webr-node-shim.mjs';

// 顺序要求：先 import('webr')，再装 shim（webR 在模块加载期会覆盖 globalThis.Worker）
const { WebR } = await import('webr');
installWorkerShim();

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'results');
const REPO_DIR = join(ROOT, 'local-repo');
const TGZ_DIR = join(REPO_DIR, 'tgz');
for (const d of [RESULTS_DIR, REPO_DIR, TGZ_DIR]) mkdirSync(d, { recursive: true });

const BASE_URL = WEBR_BASE_URL;
const REMOTE_REPO = 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6';
const PACKAGES_URL = `${REMOTE_REPO}/PACKAGES`;
const UA = 'mimic-jmp-phase0-spike/0.0.1';
const RUN_EXTRAS = process.env.S2_EXTRAS === '1';

// go/no-go 核心根集合；extras 为附加能力探测，不参与 verdict
const ROOT_PKGS = ['FrF2', 'rsm', 'DoE.base', 'conf.design'];
if (RUN_EXTRAS) ROOT_PKGS.push('qcc', 'AlgDesign', 'ggDoE');

// S1 实测 webR 默认自带的 16 个包，无需下载
const BUILTIN = new Set([
  'R', 'base', 'compiler', 'datasets', 'grDevices', 'graphics', 'grid',
  'methods', 'parallel', 'splines', 'stats', 'stats4', 'tcltk', 'tools',
  'translations', 'utils', 'webr',
]);

const results = {
  spike: 'S2-offline',
  title: '本地离线 repo：DOE 包链路 + 设计矩阵 go/no-go 硬验证',
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  windowsShim: shimInfo,
  rootPackages: ROOT_PKGS,
  runExtras: RUN_EXTRAS,
  stages: {},
  checks: [],
};

function save() {
  writeFileSync(
    join(RESULTS_DIR, 's2_offline.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
}
function log(msg) {
  console.log(msg);
}
function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  save();
  return ok;
}

/** 下载到 Buffer，带超时与重试 */
async function fetchBuf(url, timeoutMs = 90000, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': UA },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      return buf;
    } catch (e) {
      lastErr = String(e?.message || e);
      if (attempt < retries) {
        log(`      重试 ${attempt}/${retries}: ${url.split('/').pop()} (${lastErr})`);
      }
    }
  }
  throw new Error(lastErr);
}

/** 解析 PACKAGES（DCF），保留每个包的原始段落文本用于生成精简索引 */
function parsePackages(text) {
  const map = new Map();
  let raw = [];
  let cur = null;
  let lastKey = null;
  const flush = () => {
    if (cur && cur.Package) map.set(cur.Package, { entry: cur, raw: raw.join('\n') });
    cur = null;
    raw = [];
    lastKey = null;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    raw.push(line);
    if (!cur) cur = {};
    if (/^[ \t]/.test(line)) {
      if (lastKey) cur[lastKey] = (cur[lastKey] || '') + ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (m) {
      lastKey = m[1];
      cur[lastKey] = m[2].trim();
    }
  }
  flush();
  return map;
}

/** 从 Depends / Imports / LinkingTo 解析依赖名，剔除 base 包与版本约束 */
function depsOf(entry) {
  const fields = [entry.Depends, entry.Imports, entry.LinkingTo]
    .filter(Boolean)
    .join(',');
  return fields
    .split(',')
    .map((s) => s.replace(/\(.*?\)/g, '').trim())
    .filter((s) => s && !BUILTIN.has(s));
}

let server = null;
let webR = null;
let exitCode = 0;

try {
  // ================================================================ P1 索引
  log('=== P1 下载 PACKAGES 索引 ===');
  const tIdx = Date.now();
  let indexText;
  if (existsSync(join(REPO_DIR, 'PACKAGES.full')) &&
      readFileSync(join(REPO_DIR, 'PACKAGES.full'), 'utf8').length > 100000) {
    indexText = readFileSync(join(REPO_DIR, 'PACKAGES.full'), 'utf8');
    log(`  使用本地缓存索引 (${(indexText.length / 1024 / 1024).toFixed(2)}MB)`);
  } else {
    const buf = await fetchBuf(PACKAGES_URL, 120000, 4);
    indexText = buf.toString('utf8');
    writeFileSync(join(REPO_DIR, 'PACKAGES.full'), indexText, 'utf8');
    log(`  下载 ${(indexText.length / 1024 / 1024).toFixed(2)}MB / ${Date.now() - tIdx}ms`);
  }
  const pkgs = parsePackages(indexText);
  log(`  索引内包数: ${pkgs.size}`);
  results.stages.P1 = { ms: Date.now() - tIdx, indexBytes: indexText.length, packageCount: pkgs.size };
  save();

  // ================================================================ P2 闭包
  log('\n=== P2 计算依赖闭包 ===');
  const closure = new Set();
  const queue = [...ROOT_PKGS];
  const missing = [];
  while (queue.length) {
    const name = queue.shift();
    if (closure.has(name) || BUILTIN.has(name)) continue;
    const rec = pkgs.get(name);
    if (!rec) {
      missing.push(name);
      continue;
    }
    closure.add(name);
    for (const d of depsOf(rec.entry)) {
      if (!closure.has(d) && !BUILTIN.has(d)) queue.push(d);
    }
  }
  const closureList = [...closure].sort();
  log(`  闭包共 ${closureList.length} 个包${missing.length ? `，索引缺失: ${missing.join(', ')}` : ''}`);
  log(`  ${closureList.join(', ')}`);
  results.stages.P2 = { closure: closureList, missing };
  save();

  /** 索引里的 tgz 文件名 */
  const tgzName = (name) => {
    const rec = pkgs.get(name);
    return rec?.entry.File ?? `${name}_${rec?.entry.Version}.tgz`;
  };

  // ==================================================== P3 最小连通性探针
  // 先只下载一个极小的纯 R 包 conf.design，验证 localhost + repoUrl 路径规则
  // 是否真的可用，避免下载几十个 tgz 后才发现连不上。
  log('\n=== P3 本地 HTTP server + 最小连通性探针 ===');
  const requests = [];
  const compactIndex = closureList
    .map((n) => pkgs.get(n).raw)
    .join('\n\n') + '\n';
  writeFileSync(join(REPO_DIR, 'PACKAGES'), compactIndex, 'utf8');
  log(`  精简 PACKAGES 索引: ${closureList.length} 条 / ${(compactIndex.length / 1024).toFixed(1)}KB`);

  // 先下载 conf.design（纯 R，无外部依赖，体积最小）
  const probeFile = tgzName('conf.design');
  if (!existsSync(join(TGZ_DIR, probeFile))) {
    log(`  预下载探针包 ${probeFile} ...`);
    const b = await fetchBuf(`${REMOTE_REPO}/${probeFile}`, 120000, 4);
    writeFileSync(join(TGZ_DIR, probeFile), b);
    log(`  ${probeFile} ${(b.length / 1024).toFixed(1)}KB`);
  }

  const PORT = 18765;
  // webR 的 download.file 映射到「同步 XHR」。连续几十个同步请求复用同一
  // keep-alive 连接会累积状态错乱（实测第 24 个包 Matrix 开始报下载失败）。
  // 强制每个响应 Connection: close，让每次下载走全新连接。
  const COMMON_HEADERS = {
    'access-control-allow-origin': '*',
    connection: 'close',
  };
  server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const fname = urlPath.split('/').pop();
    requests.push(urlPath);
    // 扁平匹配：不管 webR 拼什么子路径，PACKAGES* 返索引，*.tgz 从缓存取。
    // P3 已证明给 .rds/.gz 返纯文本 DCF 也能被 webr::install 正确消费，
    // 保持这套响应不变，避免引入新变量。
    if (/^PACKAGES(\..*)?$/.test(fname) || urlPath.endsWith('/PACKAGES')) {
      res.writeHead(200, {
        ...COMMON_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      });
      res.end(compactIndex);
      return;
    }
    if (fname.endsWith('.tgz')) {
      const p = join(TGZ_DIR, fname);
      if (existsSync(p)) {
        const buf = readFileSync(p);
        res.writeHead(200, {
          ...COMMON_HEADERS,
          'content-type': 'application/octet-stream',
          'content-length': buf.length,
        });
        res.end(buf);
        return;
      }
      log(`  [server] 404 缺失 tgz: ${fname}`);
      res.writeHead(404, COMMON_HEADERS);
      res.end('not found');
      return;
    }
    res.writeHead(404, COMMON_HEADERS);
    res.end('not found');
  });
  server.keepAliveTimeout = 0;
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const LOCAL_REPO = `http://127.0.0.1:${PORT}`;
  log(`  server 已启动: ${LOCAL_REPO}`);

  const tBoot = Date.now();
  webR = new WebR({
    baseUrl: BASE_URL,
    repoUrl: LOCAL_REPO,
    downloadTimeout: 30000, // 关键：不再无超时挂死
  });
  await webR.init();
  results.bootMs = Date.now() - tBoot;
  log(`  webR 启动 ${results.bootMs}ms (repoUrl=本地)`);

  let probeOk = false;
  try {
    await Promise.race([
      webR.installPackages(['conf.design'], { mount: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout 120s')), 120000)),
    ]);
    const loaded = (await webR.evalRString(
      'as.character(requireNamespace("conf.design", quietly=TRUE))'
    )).trim();
    probeOk = loaded === 'TRUE';
  } catch (e) {
    log(`  探针异常: ${String(e?.message || e).split('\n')[0]}`);
  }
  log(`  webR 实际请求路径: ${[...new Set(requests)].slice(0, 10).join(' | ')}`);
  results.stages.P3 = { probeOk, requests: [...new Set(requests)], localRepo: LOCAL_REPO };
  save();
  record('本地离线 repo 连通性（conf.design 装上并可加载）', probeOk,
    probeOk ? `请求 ${requests.length} 次，路径规则已确认` : 'server 未被正确访问');

  if (!probeOk) throw new Error('P3 探针失败，无需继续下载闭包');

  // ======================================================== P4 并发下载闭包
  log('\n=== P4 并发下载闭包内全部 .tgz ===');
  const toDownload = closureList
    .map((n) => ({ name: n, file: tgzName(n) }))
    .filter(({ file }) => !existsSync(join(TGZ_DIR, file)));
  log(`  需下载 ${toDownload.length} 个（缓存命中 ${closureList.length - toDownload.length} 个）`);

  const dlResults = [];
  const tDl = Date.now();
  let cursor = 0;
  const CONCURRENCY = 8;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < toDownload.length) {
        const i = cursor++;
        const { name, file } = toDownload[i];
        const tp = Date.now();
        try {
          const buf = await fetchBuf(`${REMOTE_REPO}/${file}`, 120000, 4);
          writeFileSync(join(TGZ_DIR, file), buf);
          dlResults.push({ name, file, ok: true, bytes: buf.length, ms: Date.now() - tp });
          log(`  [OK  ] ${file.padEnd(34)} ${(buf.length / 1024).toFixed(0).padStart(6)}KB ${((Date.now() - tp) / 1000).toFixed(1)}s`);
        } catch (e) {
          dlResults.push({ name, file, ok: false, err: String(e?.message || e) });
          log(`  [FAIL] ${file.padEnd(34)} ${String(e?.message || e).split('\n')[0]}`);
        }
        // 每完成一个就落盘，进程被杀也能保留进度
        results.stages.P4 = { done: dlResults.length, total: toDownload.length, items: dlResults };
        save();
      }
    })
  );
  const dlFailed = dlResults.filter((d) => !d.ok);
  const totalBytes = dlResults.filter((d) => d.ok).reduce((a, d) => a + d.bytes, 0);
  log(`  下载完成: ${dlResults.length - dlFailed.length}/${toDownload.length}, ` +
      `合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB / ${((Date.now() - tDl) / 1000).toFixed(1)}s`);
  results.stages.P4 = {
    done: dlResults.length, total: toDownload.length,
    totalMB: +(totalBytes / 1024 / 1024).toFixed(2),
    ms: Date.now() - tDl, items: dlResults,
  };
  save();
  record('闭包内 .tgz 全部预下载成功', dlFailed.length === 0,
    `${dlResults.length - dlFailed.length}/${toDownload.length}${dlFailed.length ? ` 失败: ${dlFailed.map((d) => d.file).join(', ')}` : ''}`);

  // ======================================================== P5 正式装包 + 硬验证
  log('\n=== P5 从本地 repo 安装并跑设计矩阵 ===');

  // 依赖拓扑排序：叶子依赖先装，根包最后装。
  // 逐包调用 installPackages 而非一次性传 4 个根包 —— P3 已证明单包路径
  // 可靠，一次性批量会在同步 XHR 连续请求下断链（实测第 24 个包 Matrix 失败）。
  const topo = [];
  const seen = new Set();
  function visit(name) {
    if (seen.has(name) || BUILTIN.has(name)) return;
    seen.add(name);
    const e = pkgs.get(name)?.entry;
    if (e) for (const d of depsOf(e)) visit(d);
    topo.push(name);
  }
  for (const n of ROOT_PKGS) visit(n);
  log(`  拓扑安装顺序(${topo.length}): ${topo.join(' → ')}`);

  const tInst = Date.now();
  const installLog = [];
  for (const pkg of topo) {
    const tp = Date.now();
    let ok = false;
    let err = null;
    try {
      await Promise.race([
        webR.installPackages([pkg], { mount: false, quiet: true }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`timeout 90s`)), 90000)
        ),
      ]);
      const loaded = (
        await webR.evalRString(
          `as.character(requireNamespace("${pkg}", quietly=TRUE))`
        )
      ).trim();
      ok = loaded === 'TRUE';
      if (!ok) err = `requireNamespace=${loaded}`;
    } catch (e) {
      err = String(e?.message || e).split('\n')[0];
    }
    const ms = Date.now() - tp;
    installLog.push({ pkg, ok, ms, err });
    log(`  [${ok ? 'OK  ' : 'FAIL'}] ${pkg.padEnd(16)} ${(ms / 1000).toFixed(1)}s${err ? ` — ${err}` : ''}`);
    // 逐包落盘，保留进度
    results.stages.P5 = { installLog };
    save();
  }
  results.installMs = Date.now() - tInst;
  const instFailed = installLog.filter((x) => !x.ok);
  log(`  安装完成: ${installLog.length - instFailed.length}/${installLog.length}, ` +
      `耗时 ${(results.installMs / 1000).toFixed(1)}s`);
  record('全部闭包包从本地 repo 安装并可加载', instFailed.length === 0,
    `${installLog.length - instFailed.length}/${installLog.length}` +
    (instFailed.length ? ` 失败: ${instFailed.map((x) => x.pkg).join(', ')}` : ''));

  async function evalR(code) {
    return (await webR.evalRString(code)).trim();
  }

  // ---- 硬标准 1：FrF2 12x7 设计矩阵
  let frf2Ok = false;
  try {
    const out = await evalR(`
      local({
        suppressMessages(library(FrF2))
        set.seed(42)
        d <- FrF2(nruns = 12, nfactors = 7, randomize = FALSE)
        dm <- as.data.frame(d)
        paste(
          sprintf("nrow=%d", nrow(dm)),
          sprintf("ncol=%d", ncol(dm)),
          sprintf("levels_unique=%s", all(vapply(dm, function(z) length(unique(z)) == 2, logical(1)))),
          sprintf("no_na=%s", !anyNA(dm)),
          sprintf("alias_resolution=%s", paste(attr(d, "design.info")$resolution, collapse=",")),
          sep = "\\\\n"
        )
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    frf2Ok = Number(f.nrow) === 12 && Number(f.ncol) === 7 &&
             f.levels_unique === 'TRUE' && f.no_na === 'TRUE';
    results.frf2 = f;
    record('go/no-go 硬标准①：FrF2 产出 12×7 筛选设计矩阵', frf2Ok,
      `nrow=${f.nrow} ncol=${f.ncol} 二水平=${f.levels_unique} 无缺失=${f.no_na} 分辨度=${f.alias_resolution}`);
  } catch (e) {
    results.frf2Error = String(e?.message || e);
    record('go/no-go 硬标准①：FrF2 产出 12×7 筛选设计矩阵', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ---- 硬标准 2：rsm::ccd() 响应面设计
  let ccdOk = false;
  try {
    const out = await evalR(`
      local({
        suppressMessages(library(rsm))
        d <- ccd(2, n0 = c(4, 4), alpha = "rotatable", randomize = FALSE, oneblock = TRUE)
        dm <- as.data.frame(d)
        paste(sprintf("nrow=%d", nrow(dm)), sprintf("ncol=%d", ncol(dm)),
              sprintf("has_axial=%s", any(abs(dm[,1]) > 1.0001)),
              sep = "\\\\n")
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    ccdOk = Number(f.nrow) > 0 && Number(f.ncol) >= 2 && f.has_axial === 'TRUE';
    results.ccd = f;
    record('go/no-go 硬标准②：rsm::ccd() 产出中心复合设计', ccdOk,
      `nrow=${f.nrow} ncol=${f.ncol} 含轴点=${f.has_axial}`);
  } catch (e) {
    results.ccdError = String(e?.message || e);
    record('go/no-go 硬标准②：rsm::ccd() 产出中心复合设计', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ---- 附加：DoE.base 正交表（L9.3.4 = 9 runs / 4 个三水平因子，Taguchi 标准表）
  let oaOk = false;
  try {
    const out = await evalR(`
      local({
        suppressMessages(library(DoE.base))
        d <- oa.design(ID = "L9.3.4", seed = 7)
        paste(sprintf("nrow=%d", nrow(d)), sprintf("ncol=%d", ncol(d)), sep="\\\\n")
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    oaOk = Number(f.nrow) === 9 && Number(f.ncol) === 4;
    results.oa = f;
    record('DoE.base 正交表 oa.design(L9.3.4) 可用', oaOk,
      `nrow=${f.nrow}(期望9) ncol=${f.ncol}(期望4)`);
  } catch (e) {
    record('DoE.base 正交表 oa.design(L9.3.4) 可用', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ---- 附加：全部包版本清点
  try {
    const vers = await evalR(`
      paste(vapply(c("FrF2","rsm","DoE.base","conf.design","igraph"),
        function(p) sprintf("%s=%s", p, as.character(packageVersion(p))), character(1)),
        collapse = ", ")
    `);
    results.packageVersions = vers;
    log(`  包版本: ${vers}`);
  } catch {}

  // ---- extras（可选）
  if (RUN_EXTRAS) {
    for (const extra of ['qcc', 'AlgDesign', 'ggDoE']) {
      try {
        const v = await evalR(`as.character(requireNamespace("${extra}", quietly=TRUE))`);
        record(`extras: ${extra} 可加载`, v.trim() === 'TRUE', `requireNamespace=${v.trim()}`);
      } catch (e) {
        record(`extras: ${extra} 可加载`, false, String(e?.message || e).split('\n')[0]);
      }
    }
  }

  // ================================================================ 结论
  const goNoGo = frf2Ok && ccdOk;
  results.verdict = goNoGo ? 'GO' : 'NO-GO';
  results.finishedAt = new Date().toISOString();
  results.totalMs = Date.now() - Date.parse(results.startedAt);
  results.serverRequests = [...new Set(requests)];
  save();

  log('\n=== S2-offline 结论 ===');
  log(`  go/no-go（FrF2 12×7 + rsm::ccd）: ${results.verdict}`);
  log(`  本地 server 请求路径: ${results.serverRequests.slice(0, 8).join(' | ')}`);
  log(`  结果已写入 results/s2_offline.json`);
  if (!goNoGo) exitCode = 1;
} catch (err) {
  results.fatal = String(err?.stack || err);
  results.verdict = 'ERROR';
  results.finishedAt = new Date().toISOString();
  save();
  log(`\n[FATAL] ${String(err?.message || err)}`);
  exitCode = 1;
} finally {
  try { if (webR) await webR.close(); } catch {}
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
}

process.exit(exitCode);
