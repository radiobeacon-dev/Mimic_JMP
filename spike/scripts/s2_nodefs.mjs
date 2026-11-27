/**
 * S2 最终决定性验证 —— NODEFS 预置 library 方案（Phase 0 go/no-go 关口）
 *
 * 架构说明（这也是产品该采用的形态）：
 *   把预编译的 WASM R 包解压成标准 R library 目录，随安装包分发；
 *   运行时用 webR 的 NODEFS 把该目录挂进虚拟 FS，R 侧 .libPaths() 指过去，
 *   直接 library() 加载。全程零 download.file、零 XHR、零外网。
 *
 * 为什么放弃 installPackages / HTTP repo 路线：
 *   webR 在 Node 下把 download.file 实现为同步 XHR（Atomics 代理）。实测
 *   连续安装到约第 20+ 个包后必然 download.file failed（无论 server 是否
 *   独立进程、无论 Connection 是否 close、无论批量还是逐包）。这是传输机制
 *   的资源累积问题，与具体包无关 —— 第二次断在 218KB 的 magrittr 即为证。
 *   该产品形态本就不该运行时下载组件（JMP 从不这么做），故直接改用挂载。
 *
 * 硬标准（DEVELOPMENT_PLAN.md Phase 0 / S2）：
 *   H1  FrF2(nruns=12, nfactors=7) 产出 12x7 二水平筛选设计矩阵
 *   H2  rsm::ccd() 产出含轴点的中心复合设计
 *   附加 DoE.base::oa.design() 正交表、编译型包动态库加载（igraph/Matrix）
 */

import { installWorkerShim, WEBR_BASE_URL, shimInfo } from './webr-node-shim.mjs';
const { WebR } = await import('webr');
installWorkerShim();

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const LIB = join(ROOT, 'local-repo', 'library');
const MOUNTPOINT = '/rlib';

const results = {
  spike: 'S2-nodefs',
  title: 'Phase 0 go/no-go：NODEFS 预置 library + 设计矩阵硬验证',
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  windowsShim: shimInfo,
  architecture: '预编译 WASM R 包随安装包分发，NODEFS 挂载，运行时零外网',
  libraryDir: LIB,
  checks: [],
};

function save() {
  writeFileSync(join(RESULTS_DIR, 's2_nodefs.json'), JSON.stringify(results, null, 2), 'utf8');
}
function log(msg) { console.log(msg); }
function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  save();
  return ok;
}

let webR = null;
let exitCode = 0;

async function ev(code) {
  return (await webR.evalRString(code)).trim();
}
async function evVoid(code) {
  await webR.evalRVoid(code);
}

try {
  log('=== 前置检查 ===');
  const pkgCount = existsSync(LIB) ? (await import('node:fs')).readdirSync(LIB).length : 0;
  log(`  预置 library: ${existsSync(LIB) ? 'OK' : '缺失'} (${pkgCount} 个包目录)`);
  if (pkgCount < 25) throw new Error(`预置包不足（${pkgCount}），请先解压 tgz`);

  // ------------------------------------------------------------ 启动 + 挂载
  log('\n=== 启动 webR 并挂载 NODEFS ===');
  const tBoot = Date.now();
  webR = new WebR({ baseUrl: WEBR_BASE_URL });
  await webR.init();
  results.bootMs = Date.now() - tBoot;
  log(`  webR 启动 ${results.bootMs}ms`);

  await webR.FS.mkdir(MOUNTPOINT);
  const tMount = Date.now();
  await webR.FS.mount('NODEFS', { root: LIB }, MOUNTPOINT);
  results.mountMs = Date.now() - tMount;
  log(`  NODEFS 挂载 ${results.mountMs}ms -> ${MOUNTPOINT}`);

  const dirs = await ev(`paste(head(sort(list.files("${MOUNTPOINT}")), 6), collapse=", ")`);
  const soSeen = await ev(`as.character(file.exists("${MOUNTPOINT}/Matrix/libs/Matrix.so"))`);
  record('NODEFS 挂载成功且编译型动态库可见', dirs.includes('Matrix') && soSeen === 'TRUE',
    `可见包: ${dirs}... / Matrix.so=${soSeen}`);

  // 关键：把挂载点加入 libPaths。用 evalRVoid 避免返回多元素向量
  await evVoid(`.libPaths(c("${MOUNTPOINT}", .libPaths()))`);
  const libPaths = await ev(`paste(.libPaths(), collapse=" | ")`);
  log(`  .libPaths(): ${libPaths}`);

  // ------------------------------------------------------------ 包加载清点
  log('\n=== 包加载清点（含编译型依赖）===');
  const LOAD_LIST = [
    'conf.design', 'estimability', 'rsm', 'MASS', 'DoE.base', 'lattice',
    'Matrix', 'magrittr', 'rlang', 'cli', 'vctrs', 'igraph',
    'sfsmisc', 'scatterplot3d', 'FrF2',
  ];
  const loadResults = [];
  for (const p of LOAD_LIST) {
    try {
      const r = await ev(`as.character(requireNamespace("${p}", quietly=TRUE))`);
      loadResults.push({ pkg: p, ok: r === 'TRUE' });
      log(`  [${r === 'TRUE' ? 'OK  ' : 'FAIL'}] ${p.padEnd(16)} ${r}`);
    } catch (e) {
      loadResults.push({ pkg: p, ok: false, err: String(e?.message || e).split('\n')[0] });
      log(`  [FAIL] ${p.padEnd(16)} ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  const loadFailed = loadResults.filter((x) => !x.ok);
  results.loadResults = loadResults;
  record('全部包（含 igraph/Matrix 编译型动态库）可加载', loadFailed.length === 0,
    `${loadResults.length - loadFailed.length}/${loadResults.length}` +
    (loadFailed.length ? ` 失败: ${loadFailed.map((x) => x.pkg).join(', ')}` : ''));

  // ------------------------------------------------------------ H1: 筛选设计
  // 修正：原计划写 FrF2(nruns=12, nfactors=7) 是错的 —— FrF2() 只做 regular
  // 2 的幂次设计（实测报 "nruns must be a power of 2"）。12-run 筛选设计
  // 的正确 API 是 FrF2::pb()（Plackett-Burman），即 JMP 的 12-run Screening。
  // 因此 H1 拆成两条：12-run PB（对应原计划意图）+ 16-run regular FF。
  log('\n=== 硬标准验证 ===');
  let h1 = false;
  try {
    const out = await ev(`
      local({
        suppressMessages(library(FrF2))
        set.seed(42)
        d <- pb(nruns = 12, nfactors = 7, randomize = FALSE)
        dm <- as.data.frame(d)
        paste(
          sprintf("nrow=%d", nrow(dm)),
          sprintf("ncol=%d", ncol(dm)),
          sprintf("two_level=%s", all(vapply(dm, function(z) length(unique(z)) == 2, logical(1)))),
          sprintf("no_na=%s", !anyNA(dm)),
          sprintf("class=%s", class(d)[1]),
          sep = "\\n"
        )
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    h1 = Number(f.nrow) === 12 && Number(f.ncol) === 7 &&
         f.two_level === 'TRUE' && f.no_na === 'TRUE';
    results.h1 = f;
    record('H1: 12-run × 7 因子 Plackett-Burman 筛选设计（JMP Screening）', h1,
      `nrow=${f.nrow} ncol=${f.ncol} 二水平=${f.two_level} 无缺失=${f.no_na} class=${f.class}`);
  } catch (e) {
    results.h1Error = String(e?.message || e);
    record('H1: 12-run × 7 因子 Plackett-Burman 筛选设计（JMP Screening）', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // H1b: 16-run regular 部分因子设计（补上原计划误写的 FrF2() 正确用法）
  let h1b = false;
  try {
    const out = await ev(`
      local({
        suppressMessages(library(FrF2))
        d <- FrF2(nruns = 16, nfactors = 7, randomize = FALSE)
        dm <- as.data.frame(d)
        sprintf("nrow=%d ncol=%d two_level=%s",
          nrow(dm), ncol(dm),
          all(vapply(dm, function(z) length(unique(z)) == 2, logical(1))))
      })
    `);
    const f = Object.fromEntries(out.split(/[ \n]+/).map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    h1b = Number(f.nrow) === 16 && Number(f.ncol) === 7 && f.two_level === 'TRUE';
    results.h1b = f;
    record('H1b: FrF2(16,7) regular 部分因子设计', h1b,
      `nrow=${f.nrow} ncol=${f.ncol} 二水平=${f.two_level}`);
  } catch (e) {
    record('H1b: FrF2(16,7) regular 部分因子设计', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ H2: rsm::ccd
  let h2 = false;
  try {
    const out = await ev(`
      local({
        suppressMessages(library(rsm))
        d <- ccd(2, n0 = c(4, 4), alpha = "rotatable", randomize = FALSE, oneblock = TRUE)
        dm <- as.data.frame(d)
        paste(sprintf("nrow=%d", nrow(dm)), sprintf("ncol=%d", ncol(dm)),
              sprintf("has_axial=%s", any(abs(dm[,1]) > 1.0001)),
              sep = "\\n")
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    h2 = Number(f.nrow) > 0 && Number(f.ncol) >= 2 && f.has_axial === 'TRUE';
    results.h2 = f;
    record('H2: rsm::ccd() 产出含轴点的中心复合设计', h2,
      `nrow=${f.nrow} ncol=${f.ncol} 含轴点=${f.has_axial}`);
  } catch (e) {
    results.h2Error = String(e?.message || e);
    record('H2: rsm::ccd() 产出含轴点的中心复合设计', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ 附加: 正交表
  // 修正：oa.design 不接受 ID="L9.3.4" 这种字面量（show.oas() 里的 name 列
  // 需配合 name= 参数），正确用法是给 nruns/nfactors/nlevels 让它自动选表。
  let oa = false;
  try {
    const out = await ev(`
      local({
        suppressMessages(library(DoE.base))
        d <- oa.design(nruns = 9, nfactors = 4, nlevels = 3, seed = 7)
        paste(sprintf("nrow=%d", nrow(d)), sprintf("ncol=%d", ncol(d)), sep="\\n")
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    oa = Number(f.nrow) === 9 && Number(f.ncol) === 4;
    results.oa = f;
    record('附加: DoE.base 正交表 L9(3^4) 可用', oa,
      `nrow=${f.nrow}(期望9) ncol=${f.ncol}(期望4)`);
  } catch (e) {
    record('附加: DoE.base 正交表 L9(3^4) 可用', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ 数值基准（R8）
  // 沿用 S1 的 mtcars 参考值，确认挂载方案下数值引擎一致
  try {
    const out = await ev(`
      local({
        fit <- lm(mpg ~ wt, data = mtcars)
        cf <- coef(fit)
        sprintf("%.6f,%.6f,%.6f", unname(cf[1]), unname(cf[2]), summary(fit)$r.squared)
      })
    `);
    const [intercept, slope, r2] = out.split(',').map(Number);
    const ok = Math.abs(intercept - 37.285126) < 1e-5 && Math.abs(slope - (-5.344472)) < 1e-5;
    results.numericBaseline = { intercept, slope, r2, reference: '37.285126 / -5.344472', matched: ok };
    record('数值基准 lm(mpg~wt) 对齐公开参考值（R8）', ok,
      `${intercept} / ${slope} / R²=${r2}`);
  } catch (e) {
    record('数值基准 lm(mpg~wt) 对齐公开参考值（R8）', false,
      String(e?.message || e).split('\n')[0]);
  }

  // ------------------------------------------------------------ 版本清点
  try {
    const vers = await ev(`
      paste(vapply(c("FrF2","rsm","DoE.base","conf.design","igraph","Matrix"),
        function(p) sprintf("%s=%s", p, as.character(packageVersion(p))), character(1)),
        collapse = ", ")
    `);
    results.packageVersions = vers;
    log(`\n  包版本: ${vers}`);
  } catch (e) {
    log(`  版本清点失败: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ 结论
  const allLoaded = loadFailed.length === 0;
  const goNoGo = h1 && h1b && h2 && oa && allLoaded;
  results.verdict = goNoGo ? 'GO' : 'NO-GO';
  results.finishedAt = new Date().toISOString();
  results.totalMs = Date.now() - Date.parse(results.startedAt);
  save();

  log('\n============================================');
  log(`  S2 go/no-go 结论: ${results.verdict}`);
  log(`  预置包加载: ${loadResults.length - loadFailed.length}/${loadResults.length}`);
  log(`  H1  12-run PB 筛选设计: ${h1 ? 'PASS' : 'FAIL'}`);
  log(`  H1b FrF2(16,7) 部分因子: ${h1b ? 'PASS' : 'FAIL'}`);
  log(`  H2  rsm::ccd 中心复合设计: ${h2 ? 'PASS' : 'FAIL'}`);
  log(`  附加 DoE.base 正交表: ${oa ? 'PASS' : 'FAIL'}`);
  log(`  总耗时 ${(results.totalMs / 1000).toFixed(1)}s`);
  log('============================================');
  log('  结果已写入 results/s2_nodefs.json');
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
}

process.exit(exitCode);
