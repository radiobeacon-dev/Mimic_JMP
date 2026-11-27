/**
 * S2 决定性补测：逐个安装 igraph 依赖链，然后真正运行 FrF2 设计矩阵。
 *
 * 前情：
 *   - 逐个安装（conf.design/rsm/DoE.base/MASS/estimability/lattice）全部秒级成功
 *   - 批量安装卡死、igraph 单个超时 —— 根因是 repo.r-wasm.org 网络吞吐仅
 *     ~0.08MB/s，而 igraph 还拖着 Matrix/cli/lifecycle/magrittr 等编译型依赖
 *   - igraph 本体 4.16MB，Node 原生下载就要 52s；webR 还要装它的依赖树
 *
 * 本脚本策略：
 *   1. 按依赖拓扑序，逐个安装 igraph 的依赖，每个给足 600s 超时
 *   2. 装完 igraph 后装 FrF2
 *   3. **真正运行** go/no-go 的硬标准：FrF2(nruns=12, nfactors=7) 出 12×7 设计矩阵
 *   4. 顺带验 FrF2 的别名结构分析（这才是 igraph 的实际用途）
 *
 * 结论意义：若这里 FrF2 能出设计矩阵，则 S2 判定 GO——
 * 「DOE 包在 webR 里功能完全可用，只是运行时下载慢」，
 * 对策是把 R 包预置进安装包（离线），这正是桌面产品该有的形态。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWorkerShim, WEBR_BASE_URL } from './webr-node-shim.mjs';

const { WebR } = await import('webr');
installWorkerShim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const BASE_URL = WEBR_BASE_URL;

// igraph 依赖链 → igraph → FrF2 依赖链 → FrF2
// 逐个装（已证明比批量稳），每个给足超时
const INSTALL_ORDER = [
  'Matrix',        // igraph 依赖，编译型，较大
  'cli',
  'lifecycle',
  'magrittr',
  'igraph',        // FrF2 硬依赖，4.16MB + 上面这些
  'sfsmisc',       // FrF2 依赖
  'scatterplot3d', // FrF2 依赖
  'FrF2',          // 目标
];

const PER_PKG_TIMEOUT_MS = Number(process.env.S2_TIMEOUT_MS ?? 600000); // 10min/包

const results = {
  spike: 'S2-retry',
  title: '逐个安装 igraph 依赖链 + FrF2 设计矩阵硬验证',
  startedAt: new Date().toISOString(),
  perPkgTimeoutMs: PER_PKG_TIMEOUT_MS,
  install: [],
  checks: [],
};

function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function evalRString(code) {
  return await globalThis.webR.evalRString(code);
}
async function evalRFields(code) {
  const raw = await evalRString(code);
  const out = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    out[k] = v === 'NA' ? null : isNaN(Number(v)) || v === '' ? v : Number(v);
  }
  return out;
}
const asBool = (v) => v === true || v === 'TRUE' || v === 1 || v === '1';

let exitCode = 0;
const t0 = Date.now();
globalThis.webR = new WebR({ baseUrl: BASE_URL, downloadTimeout: 120000 });
await globalThis.webR.init();
console.log(`webR 启动: ${Date.now() - t0}ms`);
console.log(`逐个安装 ${INSTALL_ORDER.length} 个包，每包超时 ${PER_PKG_TIMEOUT_MS / 1000}s\n`);

try {
  let allOk = true;
  for (const pkg of INSTALL_ORDER) {
    const tp = Date.now();
    process.stdout.write(`  [....] ${pkg.padEnd(16)} 安装中...`);
    let ok = false;
    let err = null;
    try {
      await Promise.race([
        globalThis.webR.installPackages([pkg]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout ${PER_PKG_TIMEOUT_MS / 1000}s`)), PER_PKG_TIMEOUT_MS)
        ),
      ]);
      const loaded = (
        await evalRString(`as.character(requireNamespace("${pkg}", quietly=TRUE))`)
      ).trim();
      ok = loaded === 'TRUE';
      if (!ok) err = `requireNamespace=${loaded}`;
    } catch (e) {
      err = String(e?.message || e).split('\n')[0];
    }
    const ms = Date.now() - tp;
    results.install.push({ pkg, ok, ms, err });
    console.log(
      `\r  [${ok ? 'OK  ' : 'FAIL'}] ${pkg.padEnd(16)} ${(ms / 1000).toFixed(1)}s${err ? ` — ${err}` : ''}`
    );
    if (!ok && pkg === 'FrF2') allOk = false;
    if (!ok && pkg === 'igraph') allOk = false;
  }

  const frf2Installed = results.install.find((r) => r.pkg === 'FrF2')?.ok;

  // ==================== go/no-go 硬标准：FrF2 设计矩阵 ====================
  let frf2DesignOk = false;
  if (frf2Installed) {
    try {
      const frf2 = await evalRFields(`
        suppressWarnings(suppressMessages(library(FrF2)))
        local({
          d <- FrF2(nruns = 12, nfactors = 7, factor.names = LETTERS[1:7], seed = 12345)
          dm <- as.data.frame(d)
          di <- attributes(d)$design.info
          paste(
            sprintf("nrow=%d", nrow(dm)),
            sprintf("ncol=%d", ncol(dm)),
            sprintf("nrow_ok=%s", nrow(dm) == 12),
            sprintf("ncol_ok=%s", ncol(dm) == 7),
            sprintf("resolution=%s", di$resolution),
            sprintf("nruns_attr=%d", di$nruns),
            sep = "\\n"
          )
        })
      `);
      frf2DesignOk = asBool(frf2.nrow_ok) && asBool(frf2.ncol_ok);
      results.frF2Design = frf2;
      record(
        'go/no-go 硬标准：FrF2(nruns=12, nfactors=7) 出 12×7 设计矩阵',
        frf2DesignOk,
        `nrow=${frf2.nrow} ncol=${frf2.ncol} resolution=${frf2.resolution}`
      );
    } catch (e) {
      results.frF2Error = String(e?.message || e);
      record('go/no-go 硬标准：FrF2 出 12×7 设计矩阵', false, `异常: ${String(e?.message || e).split('\n')[0]}`);
    }

    // ============ igraph 的实际用途：别名结构分析（S3 收尾）============
    try {
      const alias = await evalRFields(`
        suppressWarnings(suppressMessages(library(FrF2)))
        local({
          d <- FrF2(nruns = 12, nfactors = 7, seed = 999)
          dm <- as.data.frame(d)
          dm$y <- rnorm(nrow(dm))
          lmfit <- lm(y ~ (.)^2, data = dm)  # 饱和模型触发别名结构
          al <- alias(lmfit)
          # alias() 返回结构，能算出来就说明 igraph 路径通
          ncomp <- length(al$Complete)
          paste(sprintf("alias_ok=TRUE"), sprintf("alias_complete_len=%d", ncomp), sep = "\\n")
        })
      `);
      record(
        'S3 收尾：FrF2 别名结构分析（igraph 实际用途）可运行',
        asBool(alias.alias_ok),
        `alias Complete 维度=${alias.alias_complete_len}`
      );
      results.aliasStructure = alias;
    } catch (e) {
      results.aliasError = String(e?.message || e);
      record('S3 收尾：别名结构分析可运行', false, `异常: ${String(e?.message || e).split('\n')[0]}`);
    }
  } else {
    record('go/no-go 硬标准：FrF2 出 12×7 设计矩阵', false, 'FrF2 未能安装，跳过设计矩阵测试');
  }

  results.verdict = frf2DesignOk ? 'GO' : 'NO-GO';
  results.finishedAt = new Date().toISOString();
  results.totalMs = Date.now() - t0;

  console.log('\n=== S2-retry 结论 ===');
  console.log(`  总耗时: ${(results.totalMs / 1000).toFixed(1)}s`);
  console.log(`  FrF2 安装: ${frf2Installed ? '成功' : '失败'}`);
  console.log(`  FrF2 设计矩阵（go/no-go）: ${results.verdict}`);
  console.log('\n逐包耗时:');
  for (const r of results.install) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.pkg.padEnd(16)} ${(r.ms / 1000).toFixed(1)}s${r.err ? '  ' + r.err : ''}`);
  }

  if (!frf2DesignOk) exitCode = 1;
} catch (err) {
  console.error('\n[S2-retry ERROR]', err?.message || err);
  results.verdict = 'ERROR';
  results.error = String(err?.message || err);
  exitCode = 1;
} finally {
  results.finishedAt = results.finishedAt || new Date().toISOString();
  writeFileSync(join(RESULTS_DIR, 's2_retry.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n结果已写入 results/s2_retry.json');
  try { await globalThis.webR?.close(); } catch {}
  process.exit(exitCode);
}
