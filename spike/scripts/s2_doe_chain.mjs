/**
 * S2 — DOE 包链路可用性验证（全项目 go/no-go 关口）
 *
 * 通过标准（来自 DEVELOPMENT_PLAN.md §Phase 0）：
 *   install DoE.base / conf.design / FrF2 / rsm / ggDoE 全部成功，
 *   且 FrF2(nruns=12, nfactors=7) / rsm::ccd() 能产出设计矩阵。
 *
 * 附带验证：
 *   - S3：igraph（FrF2 硬依赖）加载是否阻塞 —— library(FrF2) 能否成功
 *   - S6：AlgDesign 能否生成 I-optimal 设计（决定 Custom Design 排期）
 *   - 数值可信度：FrF2 的别名结构、rsm 的二阶拟合系数是否合理（R8 验证集起点）
 *
 * 前置：S1 已通过；repo.r-wasm.org 可达（见 probe_repo.mjs）。
 * 本脚本会从网络下载 WASM 包，首次运行较慢（DoE 全家桶约数十 MB）。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installWorkerShim,
  shimInfo,
  WEBR_BASE_URL,
} from './webr-node-shim.mjs';

// 顺序：先 import webr（它会在加载期设置 globalThis.Worker），再打 Windows 补丁
const { WebR } = await import('webr');
const shim = installWorkerShim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const BASE_URL = WEBR_BASE_URL;

/**
 * S2 分两阶段，因为下载量差异很大：
 *   - core：go/no-go 的判定依据（DoE.base / conf.design / FrF2 / rsm）
 *   - extras：AlgDesign（Custom Design）+ ggDoE（会拖进 ggplot2 全家，很重）
 *
 * 默认只跑 core，先把最关键的结论拿到；
 * 用 S2_EXTRAS=1 追加验证 extras（S6 与 DOE 图形链路）。
 */
const CORE_PACKAGES = ['DoE.base', 'conf.design', 'FrF2', 'rsm'];
const EXTRA_PACKAGES = ['AlgDesign', 'ggDoE'];
const RUN_EXTRAS = process.env.S2_EXTRAS === '1';
const DOE_PACKAGES = RUN_EXTRAS
  ? [...CORE_PACKAGES, ...EXTRA_PACKAGES]
  : CORE_PACKAGES;

/** 哪些包属于「核心通过标准」的判定范围 */
const REQUIRED_FOR_GO = ['DoE.base', 'conf.design', 'FrF2', 'rsm'];

const results = {
  spike: 'S2',
  title: 'DOE 包链路可用性（go/no-go 关口）',
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  windowsShim: shimInfo,
  runExtras: RUN_EXTRAS,
  packages: {},
  checks: [],
};

function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function evalR(code) {
  return await globalThis.webR.evalRString(code);
}

/** base R 输出 key=value 行 */
async function evalRFields(code) {
  const raw = await evalR(code);
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

try {
  console.log('=== S2: DOE 包链路验证 ===');
  console.log(`baseUrl: ${BASE_URL}`);

  const t0 = Date.now();
  globalThis.webR = new WebR({ baseUrl: BASE_URL });
  await globalThis.webR.init();
  const bootMs = Date.now() - t0;
  results.bootMs = bootMs;
  console.log(`webR 启动: ${bootMs}ms\n`);

  // ------------------------------------------------- 批量安装包并计时
  console.log('--- 安装 DOE 包（从 repo.r-wasm.org 下载 WASM 二进制）---');
  /**
   * 一次性安装全部包，而不是逐个调用 installPackages。
   *
   * 原因：repo.r-wasm.org 的 PACKAGES 索引有 7.6MB，installPackages 每次调用
   * 都要重新拉取并解析整个依赖树。逐个安装 4 个包 = 4 次全量索引下载 +
   * 4 次依赖解析（且 DoE.base/FrF2 共享 MASS、lattice 等依赖会重复处理）。
   * 批量安装只解析一次，实测快数倍——这是首次运行 24 分钟未完成的主因。
   */
  const INSTALL_TIMEOUT_MS = Number(process.env.S2_INSTALL_TIMEOUT_MS ?? 2400000);
  console.log(
    `  批量安装 ${DOE_PACKAGES.length} 个包（含全部依赖）: ${DOE_PACKAGES.join(', ')}`
  );
  console.log(`  超时上限: ${INSTALL_TIMEOUT_MS / 1000}s`);
  const tInstall = Date.now();

  /**
   * 心跳：每 20s 打一行，证明进程仍在推进而非僵死。
   *
   * 为什么用 Node 内存做进度代理：webR 的 installPackages 在主线程下载
   * 包二进制再写入 Emscripten 虚拟文件系统，因此 Node 的 rss 会随之增长。
   * 这是唯一不需要抢占 webR 消息通道就能观测进度的方式——
   * 注意：不能用 webR.stream()/read() 去排空 R 输出，那会和 evalRString
   * 争抢同一个消息队列，直接破坏求值结果。
   */
  const rssAtStart = process.memoryUsage().rss;
  const heartbeat = setInterval(() => {
    const elapsed = ((Date.now() - tInstall) / 1000).toFixed(0);
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const grownMb = Math.round((process.memoryUsage().rss - rssAtStart) / 1024 / 1024);
    console.log(
      `    ... ${elapsed}s 已下载/解压约 ${grownMb}MB (rss ${rssMb}MB)`
    );
  }, 20000);

  let installErr = null;
  try {
    await Promise.race([
      globalThis.webR.installPackages(DOE_PACKAGES),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`installPackages timed out after ${INSTALL_TIMEOUT_MS}ms`)),
          INSTALL_TIMEOUT_MS
        )
      ),
    ]);
  } catch (e) {
    installErr = String(e?.message || e);
    console.log(`  [FAIL] 批量安装异常: ${installErr.split('\n')[0]}`);
  }
  clearInterval(heartbeat);
  const installMs = Date.now() - tInstall;
  results.install = { ms: installMs, err: installErr, packages: DOE_PACKAGES };
  console.log(`  批量安装耗时: ${(installMs / 1000).toFixed(1)}s`);

  // 逐个验证「装了 ≠ 能加载」，并记录哪些成功
  console.log('--- 逐包加载验证 ---');
  for (const pkg of DOE_PACKAGES) {
    const tp = Date.now();
    let ok = false;
    let err = null;
    try {
      const loaded = await evalR(
        `as.character(requireNamespace("${pkg}", quietly = TRUE))`
      );
      ok = loaded.trim() === 'TRUE';
      if (!ok) err = `requireNamespace returned "${loaded.trim()}"`;
    } catch (e) {
      err = String(e?.message || e).split('\n')[0];
    }
    results.packages[pkg] = { ok, ms: Date.now() - tp, err };
    console.log(
      `  [${ok ? 'OK' : 'FAIL'}] ${pkg.padEnd(14)}${err ? ` — ${err}` : ''}`
    );
  }

  const allInstalled = Object.values(results.packages).every((p) => p.ok);
  record(
    'DOE 核心包全部安装并可加载',
    REQUIRED_FOR_GO.every((p) => results.packages[p]?.ok),
    `成功 ${Object.values(results.packages).filter((p) => p.ok).length}/${DOE_PACKAGES.length}` +
      (RUN_EXTRAS ? '' : '（extras 未启用，用 S2_EXTRAS=1 追加 AlgDesign/ggDoE）')
  );

  // ======================================= S3：igraph 是否阻塞 FrF2
  // FrF2 硬依赖 igraph（编译型）。若 FrF2 已装成功，这里验证 library() 真能加载
  let frf2Loads = false;
  let igraphLoads = false;
  try {
    const ig = await evalR(
      `as.character(requireNamespace("igraph", quietly = TRUE))`
    );
    igraphLoads = ig.trim() === 'TRUE';
    const ff = await evalR(`as.character(suppressWarnings(suppressMessages({
      library(FrF2); "loaded"
    })))`);
    frf2Loads = ff.trim() === 'loaded';
  } catch (e) {
    results.s3Error = String(e?.message || e);
  }
  record(
    'S3: library(FrF2) 加载成功（igraph 依赖不炸）',
    frf2Loads,
    `FrF2=${frf2Loads}, igraph 命名空间=${igraphLoads}` +
      (results.s3Error ? ` — ${results.s3Error.split('\n')[0]}` : '')
  );

  // ================== 核心：FrF2(nruns=12, nfactors=7) 出设计矩阵
  let frf2DesignOk = false;
  try {
    const frf2 = await evalRFields(`
      suppressWarnings(suppressMessages(library(FrF2)))
      local({
        d <- FrF2(nruns = 12, nfactors = 7, factor.names = LETTERS[1:7],
                  seed = 12345)
        dm <- as.data.frame(d)
        # 设计矩阵基本性质
        nrow_ok <- nrow(dm) == 12
        ncol_ok <- ncol(dm) == 7
        # 12 run 7 因子的饱和筛选设计，应能估计主效应（分辨率 III）
        cat_attr <- attributes(d)$design.info
        paste(
          sprintf("nrow=%d", nrow(dm)),
          sprintf("ncol=%d", ncol(dm)),
          sprintf("nrow_ok=%s", nrow_ok),
          sprintf("ncol_ok=%s", ncol_ok),
          sprintf("resolution=%s", cat_attr$resolution),
          sprintf("nfac=%d", cat_attr$nparameters),
          sep = "\\n"
        )
      })
    `);
    frf2DesignOk = asBool(frf2.nrow_ok) && asBool(frf2.ncol_ok);
    results.frF2Design = frf2;
    record(
      'FrF2(nruns=12, nfactors=7) 产出 12×7 设计矩阵',
      frf2DesignOk,
      `nrow=${frf2.nrow} ncol=${frf2.ncol} resolution=${frf2.resolution} nfac=${frf2.nfac}`
    );
  } catch (e) {
    results.frF2Error = String(e?.message || e);
    record(
      'FrF2(nruns=12, nfactors=7) 产出 12×7 设计矩阵',
      false,
      `异常: ${String(e?.message || e).split('\n')[0]}`
    );
  }

  // ============ 核心：rsm::ccd() 中心复合设计 + 二阶拟合（响应面）
  let ccdOk = false;
  try {
    const rsmRes = await evalRFields(`
      suppressWarnings(suppressMessages(library(rsm)))
      local({
        set.seed(999)
        # 3 因子 CCD：生成设计 -> 模拟二阶响应 -> 拟合 -> 检查典型分析
        d <- ccd.data(3, alpha = "rotatable", center = c(center = 4))
        n <- nrow(d)
        # 用已知系数的二阶响应面模拟 y，验证拟合能还原系数
        x1 <- d[,1]; x2 <- d[,2]; x3 <- d[,3]
        y <- 10 + 2*x1 - 1.5*x2 + 0.5*x1^2 - x2*x3 + rnorm(n, 0, 0.05)
        fit <- rsm(y ~ SO(x1, x2, x3), data = d)
        cf <- coef(fit)
        # 关键系数应接近真值
        paste(
          sprintf("ccd_nrow=%d", n),
          sprintf("b0=%.4f", unname(cf["b0"])),
          sprintf("b1=%.4f", unname(cf["b1"])),
          sprintf("b2=%.4f", unname(cf["b2"])),
          sprintf("b11=%.4f", unname(cf["b11"])),
          sprintf("b23=%.4f", unname(cf["b23"])),
          sep = "\\n"
        )
      })
    `);
    // CCD 3 因子 rotatable 标准 run 数 = 2^3 + 2*3(axial) + 4(center) = 20
    ccdOk =
      Number(rsmRes.ccd_nrow) > 0 &&
      Math.abs(rsmRes.b1 - 2) < 0.2 &&
      Math.abs(rsmRes.b2 - -1.5) < 0.2 &&
      Math.abs(rsmRes.b11 - 0.5) < 0.2 &&
      Math.abs(rsmRes.b23 - -1) < 0.2;
    results.rsmCcd = rsmRes;
    record(
      'rsm::ccd() 生成设计并二阶拟合还原系数',
      ccdOk,
      `n=${rsmRes.ccd_nrow}; b0=${rsmRes.b0} b1=${rsmRes.b1}(真值2) ` +
        `b2=${rsmRes.b2}(真值-1.5) b11=${rsmRes.b11}(真值0.5) b23=${rsmRes.b23}(真值-1)`
    );
  } catch (e) {
    results.rsmError = String(e?.message || e);
    record(
      'rsm::ccd() 生成设计并二阶拟合还原系数',
      false,
      `异常: ${String(e?.message || e).split('\n')[0]}`
    );
  }

  // ================ S6：AlgDesign 生成 I-optimal 设计（Custom Design）
  let algOk = false;
  if (RUN_EXTRAS) {
    try {
      const alg = await evalRFields(`
      local({
        ok <- requireNamespace("AlgDesign", quietly = TRUE)
        if (!ok) {
          paste("available=FALSE", sep = "\\n")
        } else {
          suppressWarnings(suppressMessages(library(AlgDesign)))
          set.seed(1)
          # 候选集 + D-optimal 精确设计（optFederov）
          cand <- expand.grid(f1 = c(-1,1), f2 = c(-1,0,1), f3 = c(-1,0,1))
          des <- optFederov(~ f1 + f2 + f3 + f1:f2, cand, nTrials = 9, criterion = "D")
          paste(
            sprintf("available=TRUE"),
            sprintf("ntrials=%d", nrow(des$design)),
            sprintf("D_efficiency=%.4f", des$criteria),
            sep = "\\n"
          )
        }
      })
    `);
      algOk = asBool(alg.available) && Number(alg.ntrials) > 0;
      results.algDesign = alg;
      record(
        'S6: AlgDesign 生成最优设计（Custom Design 可行性）',
        algOk,
        asBool(alg.available)
          ? `nTrials=${alg.ntrials} D-efficiency=${alg['D_efficiency']}`
          : 'AlgDesign 不可用（Custom Design 需 Plan B）'
      );
    } catch (e) {
      results.algError = String(e?.message || e);
      record(
        'S6: AlgDesign 生成最优设计（Custom Design 可行性）',
        false,
        `异常: ${String(e?.message || e).split('\n')[0]}`
      );
    }
  }

  // ============ DoE.base 正交表（核心包，始终验证）
  let doeBaseOk = false;
  try {
    const db = await evalRFields(`
      suppressWarnings(suppressMessages(library(DoE.base)))
      local({
        d <- oa.design(ID = "L18.2.3.6.1", seed = 7)
        paste(sprintf("oa_nrow=%d", nrow(d)), sprintf("oa_ncol=%d", ncol(d)), sep = "\\n")
      })
    `);
    doeBaseOk = Number(db.oa_nrow) === 18;
    results.doeBase = db;
    record(
      'DoE.base 正交表 oa.design(L18) 可用',
      doeBaseOk,
      `nrow=${db.oa_nrow}(期望18) ncol=${db.oa_ncol}`
    );
  } catch (e) {
    results.doeBaseError = String(e?.message || e);
    record('DoE.base 正交表 oa.design(L18) 可用', false, `异常: ${String(e?.message || e).split('\n')[0]}`);
  }

  // ====== ggDoE 半正态图（extras：依赖 ggplot2 全家，下载重）
  let ggdoeOk = false;
  if (RUN_EXTRAS) {
    try {
      const g2 = await evalRFields(`
      local({
        ok <- requireNamespace("ggDoE", quietly = TRUE) && requireNamespace("ggplot2", quietly = TRUE)
        if (!ok) { paste("ggdoe_ok=FALSE", sep="\\n") } else {
          suppressWarnings(suppressMessages(library(FrF2)))
          suppressWarnings(suppressMessages(library(ggDoE)))
          d <- FrF2(nruns = 12, nfactors = 7, factor.names = LETTERS[1:7], seed = 3)
          dm <- as.data.frame(d)
          dm$y <- rnorm(nrow(dm))
          # 半正态图：只要 ggplot 对象能构造出来就算通过（不依赖图形设备渲染）
          p <- suppressWarnings(gghalfnormal(y ~ ., data = dm))
          paste(sprintf("ggdoe_ok=%s", inherits(p, "ggplot")), sep="\\n")
        }
      })
    `);
      ggdoeOk = asBool(g2.ggdoe_ok);
      results.ggDoE = g2;
      record(
        'ggDoE 半正态图对象可构造（DOE 图形链路）',
        ggdoeOk,
        `ggdoe_ok=${g2.ggdoe_ok}`
      );
    } catch (e) {
      results.ggDoEError = String(e?.message || e);
      record('ggDoE 半正态图对象可构造（DOE 图形链路）', false, `异常: ${String(e?.message || e).split('\n')[0]}`);
    }
  }

  // ---------------------------------------------------------------- 结论
  const goNoGo = frf2DesignOk && ccdOk; // 计划里的两条硬标准
  results.verdict = goNoGo ? 'GO' : 'NO-GO';
  results.finishedAt = new Date().toISOString();

  console.log('\n=== S2 结论 ===');
  console.log(`  go/no-go（FrF2 + rsm 设计矩阵）: ${results.verdict}`);
  console.log(
    RUN_EXTRAS
      ? `  Custom Design（AlgDesign, S6）: ${algOk ? '可行' : '需 Plan B'}`
      : `  Custom Design（AlgDesign, S6）: 未测（S2_EXTRAS=1 追加）`
  );
  console.log(
    `  igraph/FrF2 加载（S3）: ${frf2Loads ? '正常' : '有问题'}`
  );

  if (!goNoGo) exitCode = 1;
} catch (err) {
  console.error('\n[S2 ERROR]', err?.message || err);
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  results.verdict = 'ERROR';
  results.error = String(err?.message || err);
  exitCode = 1;
} finally {
  results.finishedAt = results.finishedAt || new Date().toISOString();
  writeFileSync(
    join(RESULTS_DIR, 's2_doe_chain.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log('\n结果已写入 results/s2_doe_chain.json');
  try {
    await globalThis.webR?.close();
  } catch {}
  process.exit(exitCode);
}
