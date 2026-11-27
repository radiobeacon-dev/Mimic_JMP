/**
 * S1 — webR 在 Node 中能启动并跑 R
 *
 * 通过标准（来自 DEVELOPMENT_PLAN.md §Phase 0）：
 *   - 冷启动 < 5s
 *   - lm() 正常
 *
 * 说明：本脚本刻意在 Node 环境下验证，而非 Tauri WebView2。
 * 目的是把「webR/R 本身能否工作」与「Tauri 壳」两个变量解耦——
 * 若 Node 下失败，则问题在 R/WASM 层，与桌面壳无关。
 * WebView2 的实测属于 S5（联动性能）范畴。
 *
 * 额外采集：R 侧内存、图形设备可用性（S4 控制图 / S5 ggDoE 依赖）、
 *          以及一个可手工核验的回归结果，作为 R8（数值可信度）验证集的起点。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installWorkerShim,
  shimInfo,
  WEBR_BASE_URL,
} from './webr-node-shim.mjs';

// 顺序很关键：webR 在模块加载期会执行
//   globalThis.Worker = require("worker_threads").Worker
// 所以补丁必须在 import('webr') 之后安装，否则会被它覆盖掉。
// webR 直到构造通信 channel 时才读 globalThis.Worker，事后覆盖仍然有效。
const { WebR } = await import('webr');
const shim = installWorkerShim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const BASE_URL = WEBR_BASE_URL;

const results = {
  spike: 'S1',
  title: 'webR 在 Node 中启动并运行 R',
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  windowsShim: {
    installed: shim.installed,
    reason:
      'webR 0.6.1 builds the worker URL as `${baseUrl}webr-worker.js`. On ' +
      'Windows the default baseUrl is a drive-letter path (ERR_UNSUPPORTED_ESM_URL_SCHEME), ' +
      'and even an explicit file:// string is rejected by new Worker() ' +
      '(ERR_WORKER_PATH). Both are fixed by scripts/webr-node-shim.mjs, which ' +
      'must be installed AFTER import("webr").',
    ...shimInfo,
  },
  checks: [],
};

function record(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/** 在 R 中求值并返回字符串 */
async function evalR(code) {
  return await globalThis.webR.evalRString(code);
}

/**
 * 用 base R 做结构化输出，避免依赖 jsonlite。
 *
 * webR 的默认环境只有 base R（jsonlite 等都需先 install.packages，
 * 而那正是 S2 要验证的事）。S1 应当保持纯粹——只验证「能启动并跑 R」，
 * 不引入任何需要联网下载的前置依赖。
 *
 * 约定：R 侧用 sprintf 拼 `key=value` 行，Node 侧解析。仅用于标量，够用。
 */
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

/** 把 R 字段值按布尔解析 */
const asBool = (v) => v === true || v === 'TRUE' || v === 1 || v === '1';

let exitCode = 0;

try {
  // ---------------------------------------------------------------- 冷启动
  console.log('=== S1: webR 启动 ===');
  console.log(`      baseUrl (file URL workaround): ${BASE_URL}`);
  const t0 = Date.now();
  globalThis.webR = new WebR({ baseUrl: BASE_URL });
  await globalThis.webR.init();
  const bootMs = Date.now() - t0;

  const versionString = (await evalR('R.version.string')).trim();
  const platform = (await evalR('R.version$platform')).trim();
  const channelUsed = await evalR('Sys.getenv("WEBR")').then((v) => v.trim());

  // 通过标准 1：冷启动 < 5s
  record(
    '冷启动耗时 < 5000ms',
    bootMs < 5000,
    `${bootMs}ms (${(bootMs / 1000).toFixed(2)}s)`
  );
  results.bootMs = bootMs;
  results.rVersion = versionString;
  results.rPlatform = platform;
  results.webREnvFlag = channelUsed;
  console.log(`      R: ${versionString} / ${platform}`);

  // ------------------------------------------------------------ 基础求值
  // 注意：evalRString 要求 R 返回 character 类型，数值结果必须显式 as.character()
  const arithmetic = (await evalR('as.character(1 + 1)')).trim();
  record('基础求值 1+1 == 2', arithmetic === '2', `得到 "${arithmetic}"`);

  // -------------------------------------------------- 通过标准 2：lm() 正常
  // 2a. 精确可核验：y = 2x + 3，系数必须精确命中
  const exactFit = await evalRFields(`
    local({
      x <- 1:10
      y <- 2 * x + 3
      fit <- lm(y ~ x)
      cf <- coef(fit)
      paste(
        sprintf("intercept=%.10g", unname(cf[1])),
        sprintf("slope=%.10g", unname(cf[2])),
        sprintf("intercept_exact=%s", isTRUE(all.equal(unname(cf[1]), 3))),
        sprintf("slope_exact=%s", isTRUE(all.equal(unname(cf[2]), 2))),
        sep = "\\n"
      )
    })
  `);
  const exactOk =
    asBool(exactFit.intercept_exact) && asBool(exactFit.slope_exact);
  record(
    'lm() 精确解 y=2x+3',
    exactOk,
    `intercept=${exactFit.intercept} (期望 3), slope=${exactFit.slope} (期望 2)`
  );
  results.lmExact = exactFit;

  // 2b. 真实参考值：mtcars 的 lm(mpg ~ wt)
  //     公开参考值 intercept=37.285, wt=-5.344（R 内置数据集，广泛引用）
  //     这是 R8（数值与主流软件一致性）验证集的第一个数据点。
  const mtcarsFit = await evalRFields(`
    local({
      fit <- lm(mpg ~ wt, data = mtcars)
      cf <- coef(fit)
      s <- summary(fit)
      paste(
        sprintf("intercept=%.6f", unname(cf[1])),
        sprintf("wt=%.6f", unname(cf[2])),
        sprintf("r_squared=%.6f", s$r.squared),
        sprintf("df_residual=%d", s$df[2]),
        sep = "\\n"
      )
    })
  `);
  const mtcarsFitRef = { intercept_ref: 37.285126, wt_ref: -5.344472 };
  const mtcarsOk =
    Math.abs(mtcarsFit.intercept - mtcarsFitRef.intercept_ref) < 0.001 &&
    Math.abs(mtcarsFit.wt - mtcarsFitRef.wt_ref) < 0.001;
  record(
    'lm(mpg~wt) 对齐公开参考值',
    mtcarsOk,
    `intercept=${mtcarsFit.intercept} (参考 ${mtcarsFitRef.intercept_ref}), ` +
      `wt=${mtcarsFit.wt} (参考 ${mtcarsFitRef.wt_ref}), ` +
      `R²=${mtcarsFit.r_squared}, df=${mtcarsFit.df_residual}`
  );
  results.lmMtcars = { ...mtcarsFit, ...mtcarsFitRef, matched: mtcarsOk };

  // 2c. 推断统计：t 检验 / ANOVA / 卡方（Phase 1 基础统计模块的核心）
  const inferFit = await evalRFields(`
    local({
      set.seed(42)
      a <- rnorm(30, mean = 5, sd = 1)
      b <- rnorm(30, mean = 5.8, sd = 1)
      tt <- t.test(a, b)
      g <- factor(rep(c("g1","g2","g3"), each = 20))
      y <- c(rnorm(20, 0), rnorm(20, 1), rnorm(20, 2))
      av <- summary(aov(y ~ g))[[1]]
      chisq <- chisq.test(matrix(c(20, 30, 30, 20), nrow = 2))
      paste(
        sprintf("t_stat=%.6f", unname(tt$statistic)),
        sprintf("t_pvalue=%.6f", tt$p.value),
        sprintf("anova_F=%.6f", av[["F value"]][1]),
        sprintf("anova_p=%.6f", av[["Pr(>F)"]][1]),
        sprintf("chisq_stat=%.6f", unname(chisq$statistic)),
        sprintf("chisq_p=%.6f", chisq$p.value),
        sep = "\\n"
      )
    })
  `);
  const inferOk =
    Number.isFinite(inferFit.t_pvalue) &&
    Number.isFinite(inferFit.anova_F) &&
    Number.isFinite(inferFit.chisq_stat);
  record(
    '推断统计 t.test / aov / chisq.test 可用',
    inferOk,
    `t=${inferFit.t_stat} (p=${inferFit.t_pvalue}), ` +
      `ANOVA F=${inferFit.anova_F} (p=${inferFit.anova_p}), ` +
      `χ²=${inferFit.chisq_stat} (p=${inferFit.chisq_p})`
  );
  results.inferential = inferFit;

  // ------------------------------------------- 图形设备（S4/S5 的隐藏依赖）
  // qcc 控制图、ggDoE 图形都需要图形设备。webR 不带 Cairo，
  // 需确认至少有一条可用的出图路径，否则 S4/S5 会卡住。
  const graphics = await evalRFields(`
    local({
      caps <- capabilities()
      dev <- paste(names(which(caps %in% c("png","jpeg","cairo","tiff"))), collapse = ",")
      paste(
        sprintf("png=%s", isTRUE(unname(caps[["png"]]))),
        sprintf("jpeg=%s", isTRUE(unname(caps[["jpeg"]]))),
        sprintf("cairo=%s", isTRUE(unname(caps[["cairo"]]))),
        sprintf("tiff=%s", isTRUE(unname(caps[["tiff"]]))),
        sprintf("svg=%s", exists("svg", mode = "function")),
        sep = "\\n"
      )
    })
  `);

  // 实测能否真的画出一张图（capabilities 报 TRUE 不等于能写出文件）
  // 注意：webR 的虚拟文件系统里 tempfile() 可写，但主线程拿不到该文件，
  // 所以这里只验证「设备能开关且能写入字节数 > 0」。
  const pngProbe = await evalRFields(`
    local({
      tmp <- tempfile(fileext = ".png")
      ok <- tryCatch({
        png(tmp, width = 320, height = 240)
        plot(1:10, main = "S1 probe")
        dev.off()
        TRUE
      }, error = function(e) { try(dev.off(), silent = TRUE); FALSE })
      sz <- if (isTRUE(ok) && file.exists(tmp)) file.info(tmp)$size else 0
      paste(sprintf("ok=%s", isTRUE(ok)), sprintf("bytes=%d", sz), sep = "\\n")
    })
  `);
  const pngWritten = asBool(pngProbe.ok);
  const pngBytes = Number(pngProbe.bytes || 0);

  const graphicsOk =
    asBool(graphics.png) || asBool(graphics.cairo) || pngWritten;
  record(
    '图形设备可用（S4 控制图 / S5 ggDoE 前置条件）',
    graphicsOk,
    `png=${graphics.png} cairo=${graphics.cairo} jpeg=${graphics.jpeg} svg=${graphics.svg}; ` +
      `实际写出 PNG: ${pngWritten ? `是 (${pngBytes} bytes)` : '否'}`
  );
  results.graphics = {
    ...graphics,
    pngWritten,
    pngBytes,
  };

  if (!graphicsOk) {
    console.log(
      '      ⚠️ 无可用图形设备：S4/S5 需改用 webr::canvas() 或 SVG 路径，' +
        '或将绘图交给前端（Vega-Lite）而非 R。这会影响架构选型。'
    );
  }

  // -------------------------------------------------------- 内存与运行时
  const rMem = await evalRFields(`
    local({
      gc(reset = TRUE)
      m <- gc()
      paste(
        sprintf("used_mb=%.2f", sum(m[, 2]) / 1024),
        sprintf("max_used_mb=%.2f", max(m[, 6]) / 1024),
        sep = "\\n"
      )
    })
  `);
  const nodeMem = process.memoryUsage();
  results.memory = {
    rUsedMb: rMem.used_mb,
    rMaxUsedMb: rMem.max_used_mb,
    nodeRssMb: Math.round(nodeMem.rss / 1024 / 1024),
    nodeHeapMb: Math.round(nodeMem.heapUsed / 1024 / 1024),
  };
  record(
    '运行时内存采集',
    true,
    `R used=${rMem.used_mb}MB max=${rMem.max_used_mb}MB; ` +
      `Node rss=${results.memory.nodeRssMb}MB heap=${results.memory.nodeHeapMb}MB ` +
      `(WASM 4GB 上限见风险 R2)`
  );

  // --------------------------------------- 默认已装包（判断 S2 需要下载多少）
  const basePkgs = (
    await evalR('paste(rownames(installed.packages()), collapse = ",")')
  ).trim();
  results.preinstalledPackages = basePkgs
    .split(',')
    .filter(Boolean)
    .sort();
  record(
    '默认已安装包清点（S2 下载量基线）',
    true,
    `${results.preinstalledPackages.length} 个: ${results.preinstalledPackages.join(', ')}`
  );

  const allPassed = results.checks.every((c) => c.ok);
  results.verdict = allPassed ? 'PASS' : 'FAIL';
  results.finishedAt = new Date().toISOString();

  console.log(`\n=== S1 结论: ${results.verdict} ===`);
  if (!allPassed) exitCode = 1;
} catch (err) {
  console.error('\n[S1 ERROR]', err?.message || err);
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  results.verdict = 'ERROR';
  results.error = String(err?.message || err);
  exitCode = 1;
} finally {
  results.finishedAt = results.finishedAt || new Date().toISOString();
  writeFileSync(
    join(RESULTS_DIR, 's1_webr_boot.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log(`\n结果已写入 results/s1_webr_boot.json`);
  try {
    await globalThis.webR?.close();
  } catch {
    /* 忽略关闭异常 */
  }
  process.exit(exitCode);
}
