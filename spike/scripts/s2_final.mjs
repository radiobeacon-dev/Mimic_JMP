/**
 * S2 最终决定性验证（Phase 0 go/no-go 关口）
 *
 * 结论脉络：
 *   - S1 全项 PASS：webR 在 Windows/Node 下经 3 处补丁成功启动（500ms），
 *     lm() 对齐公开参考值到小数 6 位，t.test/aov/chisq 可用，
 *     cairo/png/svg 图形设备可用（实际写出 PNG）。
 *   - S2 诊断：conf.design/estimability/rsm/MASS/DoE.base/lattice 逐个秒装；
 *     igraph 在「提前备好依赖 + 给足超时」下 46s 成功。
 *   - 外网 repo.r-wasm.org 实测仅 0.08MB/s，叠加默认 downloadTimeout=0
 *     （同步 XHR 无超时）→ FrF2 请求挂死 600s。非兼容性问题。
 *   - 本地 repo 实验：31 个 tgz 并发预下载 22.9s 全部成功、gzip 校验 OK；
 *     但 server 与 webR 同进程时，连续同步 XHR 下载到第 22 个包开始
 *     download.file failed（自请求 event-loop 竞态）。
 *
 * 本脚本的修法：HTTP server 独立进程 + 失败重试。
 *   server 见 scripts/local-repo-server.mjs（预置 31 个包，零外网）。
 *
 * 硬标准（来自 DEVELOPMENT_PLAN.md Phase 0 / S2）：
 *   H1  FrF2(nruns=12, nfactors=7) 产出 12x7 二水平筛选设计矩阵
 *   H2  rsm::ccd() 产出含轴点的中心复合设计
 *   附加 DoE.base::oa.design() 正交表、包版本清点
 *
 * 运行：node scripts/s2_final.mjs
 */

import { installWorkerShim, WEBR_BASE_URL, shimInfo } from './webr-node-shim.mjs';

// 顺序：先 import('webr')，再装 shim（webR 模块加载期会覆盖 globalThis.Worker）
const { WebR } = await import('webr');
installWorkerShim();

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(ROOT, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const BASE_URL = WEBR_BASE_URL;
const PORT = 18765;
const LOCAL_REPO = `http://127.0.0.1:${PORT}`;

const results = {
  spike: 'S2-final',
  title: 'Phase 0 go/no-go：DOE 包链路 + 设计矩阵',
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  windowsShim: shimInfo,
  arch: '独立进程本地 repo + 预置 31 个 WASM R 包，运行时零外网',
  checks: [],
};

function save() {
  writeFileSync(join(RESULTS_DIR, 's2_final.json'), JSON.stringify(results, null, 2), 'utf8');
}
function log(msg) { console.log(msg); }
function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  save();
  return ok;
}

let serverProc = null;
let webR = null;
let exitCode = 0;

/** 启动独立 server 进程，等待 stdout 出现 READY */
async function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [join(__dirname, 'local-repo-server.mjs')], {
      env: { ...process.env, REPO_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server READY timeout 15s')), 15000);
    serverProc.stdout.on('data', (d) => {
      out += d.toString();
      const line = out.split('\n').find((l) => l.startsWith('READY'));
      if (line) {
        clearTimeout(timer);
        log(`  独立 server 就绪: ${LOCAL_REPO} (${line.trim()})`);
        resolve();
      }
    });
    serverProc.stderr.on('data', (d) => log(`  [server!] ${String(d).trim()}`));
    serverProc.on('error', (e) => { clearTimeout(timer); reject(e); });
    serverProc.on('exit', (code) => {
      if (code !== 0 && code !== null) log(`  [server] 退出 code=${code}`);
    });
    // 后续输出（MISSING 等）持续转发，便于诊断
    serverProc.stdout.on('data', (d) => {
      const s = String(d).trim();
      if (s && !s.startsWith('READY')) log(`  [server] ${s}`);
    });
  });
}

async function evalR(code) {
  return (await webR.evalRString(code)).trim();
}

/** 安装（带重试）。返回 {ok, err, attempts} */
async function installWithRetry(packages, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        webR.installPackages(packages, { mount: false, quiet: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 180s')), 180000)),
      ]);
      return { ok: true, attempts: attempt };
    } catch (e) {
      const err = String(e?.message || e).split('\n')[0];
      log(`    ${label} 第 ${attempt} 次失败: ${err}`);
      if (attempt === maxAttempts) return { ok: false, err, attempts: attempt };
      // 让独立 server 与 webR 之间的连接状态复位
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

try {
  // ------------------------------------------------------------ 前置检查
  log('=== 前置：确认预置包已就位 ===');
  const tgzDir = join(ROOT, 'local-repo', 'tgz');
  const idxPath = join(ROOT, 'local-repo', 'PACKAGES');
  const ready = existsSync(tgzDir) && existsSync(idxPath);
  log(`  local-repo/PACKAGES: ${existsSync(idxPath) ? 'OK' : '缺失'}`);
  log(`  local-repo/tgz/: ${existsSync(tgzDir) ? 'OK' : '缺失'}`);
  if (!ready) throw new Error('预置包未就绪，请先跑 s2_offline.mjs 的 P1-P4');

  // ------------------------------------------------------------ 启动
  log('\n=== 启动独立 server + webR ===');
  await startServer();

  const tBoot = Date.now();
  webR = new WebR({
    baseUrl: BASE_URL,
    repoUrl: LOCAL_REPO,
    downloadTimeout: 30000,
  });
  await webR.init();
  results.bootMs = Date.now() - tBoot;
  log(`  webR 启动 ${results.bootMs}ms`);

  // ------------------------------------------------------------ 安装
  // 先一次性装全部根包（webr::install 会自动展开依赖树）。
  // 独立进程已消除同进程竞态，这是最接近产品形态的路径。
  const ROOT_PKGS = ['FrF2', 'rsm', 'DoE.base', 'conf.design'];
  log(`\n=== 安装根包（自动展开依赖）: ${ROOT_PKGS.join(', ')} ===`);
  const tInst = Date.now();
  let inst = await installWithRetry(ROOT_PKGS, '批量安装');

  // 兜底：若批量仍失败，改逐包安装（复用已验证的单包路径）
  if (!inst.ok) {
    log('  批量安装失败，切换逐包安装兜底...');
    const TOPO = [
      'conf.design', 'MASS', 'colorspace', 'lattice', 'zoo', 'lmtest', 'vcd',
      'combinat', 'numbers', 'gmp', 'polynom', 'sets', 'rbibutils', 'Rdpack',
      'partitions', 'DoE.base', 'sfsmisc', 'scatterplot3d', 'cli', 'rlang',
      'lifecycle', 'magrittr', 'Matrix', 'pkgconfig', 'glue', 'vctrs', 'cpp11',
      'igraph', 'FrF2', 'estimability', 'rsm',
    ];
    const failList = [];
    for (const pkg of TOPO) {
      const r = await installWithRetry([pkg], pkg, 3);
      if (!r.ok) failList.push(pkg);
      else log(`    [OK] ${pkg}`);
    }
    inst = {
      ok: failList.length === 0,
      err: failList.length ? `逐包仍失败: ${failList.join(', ')}` : null,
      fallback: true,
    };
  }
  results.installMs = Date.now() - tInst;
  results.install = inst;
  log(`  安装耗时 ${(results.installMs / 1000).toFixed(1)}s, 结果 ${inst.ok ? 'OK' : 'FAIL'}`);
  record('DOE 包链路从预置 repo 安装成功', inst.ok,
    `${inst.attempts ?? '-'} 次尝试${inst.fallback ? '（逐包兜底）' : ''}${inst.err ? ` ${inst.err}` : ''}`);

  // ------------------------------------------------------------ H1: FrF2
  log('\n=== 硬标准验证 ===');
  let h1 = false;
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
          sprintf("two_level=%s", all(vapply(dm, function(z) length(unique(z)) == 2, logical(1)))),
          sprintf("no_na=%s", !anyNA(dm)),
          sprintf("balance=%s", all(vapply(dm, function(z) sum(z == levels(factor(z))[1]) == 6L, logical(1)))),
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
    record('H1: FrF2 产出 12×7 二水平筛选设计矩阵', h1,
      `nrow=${f.nrow} ncol=${f.ncol} 二水平=${f.two_level} 无缺失=${f.no_na} 每水平6次=${f.balance}`);
  } catch (e) {
    results.h1Error = String(e?.message || e);
    record('H1: FrF2 产出 12×7 二水平筛选设计矩阵', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ H2: rsm::ccd
  let h2 = false;
  try {
    const out = await evalR(`
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
  let oa = false;
  try {
    const out = await evalR(`
      local({
        suppressMessages(library(DoE.base))
        d <- oa.design(ID = "L9.3.4", seed = 7)
        paste(sprintf("nrow=%d", nrow(d)), sprintf("ncol=%d", ncol(d)), sep="\\n")
      })
    `);
    const f = Object.fromEntries(out.split('\n').map((l) => {
      const k = l.indexOf('=');
      return [l.slice(0, k), l.slice(k + 1)];
    }));
    oa = Number(f.nrow) === 9 && Number(f.ncol) === 4;
    results.oa = f;
    record('附加: DoE.base 正交表 L9.3.4 可用', oa,
      `nrow=${f.nrow}(期望9) ncol=${f.ncol}(期望4)`);
  } catch (e) {
    record('附加: DoE.base 正交表 L9.3.4 可用', false,
      `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ------------------------------------------------------------ 版本清点
  try {
    const vers = await evalR(`
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
  const goNoGo = h1 && h2 && inst.ok;
  results.verdict = goNoGo ? 'GO' : 'NO-GO';
  results.finishedAt = new Date().toISOString();
  results.totalMs = Date.now() - Date.parse(results.startedAt);
  save();

  log('\n============================================');
  log(`  S2 go/no-go 结论: ${results.verdict}`);
  log(`  H1 FrF2 12x7 设计矩阵: ${h1 ? 'PASS' : 'FAIL'}`);
  log(`  H2 rsm::ccd 中心复合设计: ${h2 ? 'PASS' : 'FAIL'}`);
  log(`  DoE.base 正交表: ${oa ? 'PASS' : 'FAIL'}`);
  log(`  总耗时 ${(results.totalMs / 1000).toFixed(1)}s`);
  log('============================================');
  log('  结果已写入 results/s2_final.json');
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
  try { if (serverProc && !serverProc.killed) serverProc.kill(); } catch {}
}

process.exit(exitCode);
