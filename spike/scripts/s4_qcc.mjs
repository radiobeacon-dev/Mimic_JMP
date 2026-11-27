/**
 * S4 —— qcc 质量工程链路验证（Phase 0）
 *
 * 对应 JMP 的 Control Chart Builder / Process Capability 平台，是本项目
 * 「DOE + 质量工程」差异化定位的另一半。
 *
 * 核心验证方法（对应开发计划里「控制限与 Minitab 参考值一致」）：
 *   R 侧生成确定性分组数据 → 把 125 个原始值回传 Node →
 *   Node 侧用**公开标准常数**（AIAG SPC-2 / ASTM STP-15D 查表值）
 *   独立复算 X̄ 图与 R 图控制限 → 与 qcc 输出比对。
 *   Minitab / JMP / qcc 用的是同一套常数，因此这是可核验的独立基准，
 *   且跨语言复算避免了「同一实现自证」。
 *
 * 说明：qcc 内部使用更高精度的 d2（非查表三位小数），故查表常数会有
 * 微小偏差；容差按此设定，并在结果里记录实际偏差。
 */

import { runSpike, LIB } from './spike-harness.mjs';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ---- AIAG / ASTM 标准控制图常数（子组容量 n = 5）----
const CONST = { n: 5, d2: 2.326, A2: 0.577, D3: 0, D4: 2.114, nsigmas: 3 };
const SPEC = { lsl: 73.99, usl: 74.01 };

/** 把 R 回传的 "k=v\nk=v" 文本解析成对象 */
function fields(text) {
  return Object.fromEntries(
    text.split('\n').filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );
}

/** Node 侧独立复算：分组 → 组均值/极差 → 控制限 → 能力指数 */
function independentCalc(values) {
  const { n, d2, A2, D3, D4, nsigmas } = CONST;
  if (values.length % n !== 0) throw new Error(`数据长度 ${values.length} 不能被 ${n} 整除`);
  const k = values.length / n;
  const groups = [];
  for (let i = 0; i < k; i++) groups.push(values.slice(i * n, (i + 1) * n));
  const xbars = groups.map((g) => g.reduce((a, b) => a + b, 0) / n);
  const ranges = groups.map((g) => Math.max(...g) - Math.min(...g));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const xbb = mean(xbars);
  const rb = mean(ranges);
  const sigma = rb / d2;                       // UWAVE-R 估计
  const half = (nsigmas * sigma) / Math.sqrt(n);
  return {
    k, xbb, rb, sigma,
    xbar: { cl: xbb, lcl: xbb - A2 * rb, ucl: xbb + A2 * rb },
    r: { cl: rb, lcl: D3 * rb, ucl: D4 * rb },
    // qcc 内部自洽公式（用其自身 sigma，不含查表误差）
    xbarExact: { lcl: xbb - half, ucl: xbb + half },
    cp: (SPEC.usl - SPEC.lsl) / (6 * sigma),
    cpu: (SPEC.usl - xbb) / (3 * sigma),
    cpl: (xbb - SPEC.lsl) / (3 * sigma),
  };
}

const exitCode = await runSpike(
  { spike: 's4_qcc', title: 'S4: qcc 控制图 / 控制限独立复算 / 过程能力' },
  async ({ ev, evVoid, record, results, log }) => {
    let pass = true;
    const must = (ok) => { if (!ok) pass = false; return ok; };

    // ---------------------------------------------------------- 1 包与依赖
    log('\n=== 包与函数清点 ===');
    const pkg = fields(await ev(`
      paste(
        sprintf("qcc_ver=%s", as.character(packageVersion("qcc"))),
        sprintf("mass_ok=%s", requireNamespace("MASS", quietly = TRUE)),
        sprintf("n_export=%d", length(getNamespaceExports("qcc"))),
        sprintf("key_fns=%s", paste(intersect(
          c("qcc","qcc.groups","process.capability","ewma","cusum",
            "mqcc","pareto.chart","shewhart.rules","qcc.options"),
          getNamespaceExports("qcc")), collapse = ",")),
        sprintf("n_datasets=%d", nrow(data(package = "qcc")$results)),
        sep = "\\n"
      )
    `));
    results.qcc = pkg;
    must(record('qcc 可加载且 MASS 依赖可用', pkg.mass_ok === 'TRUE',
      `qcc v${pkg.qcc_ver}, MASS=${pkg.mass_ok}, 导出 ${pkg.n_export} 个函数`));

    const keyFns = (pkg.key_fns || '').split(',').filter(Boolean);
    must(record('质量工程关键函数齐全', keyFns.length >= 8,
      `${keyFns.length}/9: ${keyFns.join(', ')}`));

    // 预置 WASM 包的观察项：数据集被裁剪（不作 fail，记录为产品注意点）
    results.observations = [
      {
        id: 'prebuilt-package-datasets',
        note: `qcc 预置 WASM 包内 data(package="qcc") 返回 ${pkg.n_datasets} 个数据集；` +
          'CRAN 原版自带 pistonrings 等示例数据，说明 WASM 构建裁剪了 data/。' +
          '算法函数不受影响，但产品不能依赖包内置示例数据，需自备数据集。',
      },
    ];
    log(`  [INFO] 预置包内置数据集数: ${pkg.n_datasets}（CRAN 原版有 pistonrings 等，WASM 版被裁剪）`);

    // ---------------------------------------------------------- 2 数据生成
    // 用确定性数据而非包内置数据集：可跨语言复算，且不受裁剪影响
    log('\n=== 生成确定性分组数据（25 组 × 5 观测）===');
    const raw = await ev(`
      suppressMessages(library(qcc))
      set.seed(2026)
      y <- rnorm(125, mean = 74, sd = 0.005)
      g <- qcc.groups(y, rep(1:25, each = 5))
      paste(sprintf("%.12f", y), collapse = ",")
    `);
    const values = raw.split(',').map(Number);
    const ind = independentCalc(values);
    results.independent = {
      constants: CONST, specLimits: SPEC,
      nObservations: values.length, nGroups: ind.k,
      xbarBar: ind.xbb, rBar: ind.rb, sigma: ind.sigma,
      xbarLimits: ind.xbar, rLimits: ind.r,
    };
    must(record('确定性数据可被 Node 侧独立解析并分组',
      values.length === 125 && values.every(Number.isFinite),
      `${values.length} 个观测 → ${ind.k} 组, R̄=${ind.rb.toFixed(9)}`));

    // ---------------------------------------------------------- 3 X̄ 图
    log('\n=== qcc X̄ 图 vs 独立复算 ===');
    const xb = fields(await ev(`
      suppressMessages(library(qcc))
      set.seed(2026)
      y <- rnorm(125, mean = 74, sd = 0.005)
      g <- qcc.groups(y, rep(1:25, each = 5))
      obj <- qcc(g, type = "xbar", plot = FALSE)
      paste(
        sprintf("center=%.12f", obj$center),
        sprintf("lcl=%.12f", obj$limits[1]),
        sprintf("ucl=%.12f", obj$limits[2]),
        sprintf("stddev=%.12f", obj$std.dev),
        sprintf("nsigmas=%.0f", obj$nsigmas),
        sprintf("nstats=%d", length(obj$statistics)),
        sprintf("type=%s", obj$type),
        sep = "\\n"
      )
    `));
    results.qccXbar = xb;
    const xCenter = Number(xb.center), xLcl = Number(xb.lcl), xUcl = Number(xb.ucl);
    const xSd = Number(xb.stddev);
    must(record('qcc X̄ 图输出完整（25 个组统计量 + 双侧控制限）',
      Number(xb.nstats) === 25 && xLcl < xCenter && xUcl > xCenter,
      `center=${xCenter.toFixed(9)} LCL=${xLcl.toFixed(9)} UCL=${xUcl.toFixed(9)} σ=${xSd.toFixed(9)}`));

    // 中心线 = 全体均值（与分组无关，精度可做到极高）
    must(record('中心线 X̄̄ 与独立复算一致（1e-9）',
      Math.abs(xCenter - ind.xbb) < 1e-9,
      `qcc=${xCenter.toFixed(9)} vs Node=${ind.xbb.toFixed(9)} Δ=${Math.abs(xCenter - ind.xbb).toExponential(2)}`));

    // σ = R̄/d2：这条同时验证了 Node 对分组方式的理解与 qcc 一致
    const sdDelta = Math.abs(xSd - ind.sigma);
    results.sigmaDelta = sdDelta;
    must(record('标准差 σ = R̄/d₂ 与独立复算一致（分组理解交叉验证）',
      sdDelta < 1e-5,
      `qcc=${xSd.toFixed(9)} vs Node=${ind.sigma.toFixed(9)} Δ=${sdDelta.toExponential(2)}`));

    // 控制限：AIAG 查表常数（A2=0.577）独立复算
    const dLcl = Math.abs(xLcl - ind.xbar.lcl);
    const dUcl = Math.abs(xUcl - ind.xbar.ucl);
    results.xbarLimitDelta = { lcl: dLcl, ucl: dUcl };
    must(record('X̄ 图控制限与 AIAG 常数独立复算一致（Minitab/JMP 同套常数）',
      dLcl < 1e-4 && dUcl < 1e-4,
      `LCL Δ=${dLcl.toExponential(2)}, UCL Δ=${dUcl.toExponential(2)} (容差 1e-4)`));

    // qcc 内部自洽：limits = center ± 3σ/√n（无查表误差，可严格比对）
    const selfL = Math.abs(xLcl - ind.xbarExact.lcl);
    const selfU = Math.abs(xUcl - ind.xbarExact.ucl);
    must(record('qcc 控制限内部自洽（center ± 3σ/√n，1e-9）',
      selfL < 1e-9 && selfU < 1e-9,
      `ΔLCL=${selfL.toExponential(2)}, ΔUCL=${selfU.toExponential(2)}`));

    // ---------------------------------------------------------- 4 R 图
    log('\n=== qcc R 图 vs 独立复算 ===');
    const rr = fields(await ev(`
      suppressMessages(library(qcc))
      set.seed(2026)
      y <- rnorm(125, mean = 74, sd = 0.005)
      g <- qcc.groups(y, rep(1:25, each = 5))
      objR <- qcc(g, type = "R", plot = FALSE)
      paste(
        sprintf("center=%.12f", objR$center),
        sprintf("lcl=%.12f", objR$limits[1]),
        sprintf("ucl=%.12f", objR$limits[2]),
        sep = "\\n"
      )
    `));
    results.qccR = rr;
    const rDr = Math.abs(Number(rr.center) - ind.rb);
    const rDu = Math.abs(Number(rr.ucl) - ind.r.ucl);
    const rDl = Math.abs(Number(rr.lcl) - ind.r.lcl);
    must(record('R 图控制限与 D₃/D₄ 常数独立复算一致',
      rDr < 1e-9 && rDl < 1e-4 && rDu < 1e-4,
      `中心 Δ=${rDr.toExponential(2)}, LCL Δ=${rDl.toExponential(2)}, UCL Δ=${rDu.toExponential(2)}`));

    // ---------------------------------------------------------- 5 判异规则
    log('\n=== Western Electric 判异 / 其他控制图类型 ===');
    const rules = fields(await ev(`
      suppressMessages(library(qcc))
      set.seed(7)
      x <- c(rnorm(24, 0, 1), 6)
      o <- qcc(x, type = "xbar.one", plot = FALSE)
      e <- tryCatch({ z <- ewma(x, lambda = 0.2, plot = FALSE); "TRUE" },
                    error = function(e) "FALSE")
      cObj <- tryCatch({ z <- cusum(x, plot = FALSE); "TRUE" },
                       error = function(e) "FALSE")
      paste(
        sprintf("beyond=%s", paste(o$violations$beyond.limits, collapse = ":")),
        sprintf("runs=%s", paste(o$violations$violating.runs, collapse = ":")),
        sprintf("n_violation_kinds=%d", length(o$violations)),
        sprintf("ewma_ok=%s", e),
        sprintf("cusum_ok=%s", cObj),
        sprintf("rules_is_fn=%s", is.function(shewhart.rules)),
        sep = "\\n"
      )
    `));
    results.qccRules = rules;
    must(record('Western Electric 判异：6σ 越界点被检出',
      (rules.beyond || '').split(':').includes('25'),
      `beyond.limits=${rules.beyond}, 违规类别数=${rules.n_violation_kinds}`));
    must(record('EWMA / CUSUM 控制图对象可构造',
      rules.ewma_ok === 'TRUE' && rules.cusum_ok === 'TRUE',
      `ewma=${rules.ewma_ok} cusum=${rules.cusum_ok}`));

    // ---------------------------------------------------------- 6 过程能力
    log('\n=== 过程能力 Cp / Cpk vs 独立复算 ===');
    let capOk = false;
    try {
      const pc = fields(await ev(`
        suppressMessages(library(qcc))
        set.seed(2026)
        y <- rnorm(125, mean = 74, sd = 0.005)
        g <- qcc.groups(y, rep(1:25, each = 5))
        obj <- qcc(g, type = "xbar", plot = FALSE)
        invisible(capture.output(
          pc <- process.capability(obj, spec.limits = c(${SPEC.lsl}, ${SPEC.usl}))
        ))
        idx <- pc$indices
        rn <- rownames(idx)
        pick <- function(pat) as.numeric(idx[grep(pat, rn)[1], "Value"])
        paste(
          sprintf("names=%s", paste(names(pc), collapse = ",")),
          sprintf("index_rows=%s", paste(rn, collapse = ",")),
          sprintf("cp=%.9f", pick("^Cp$")),
          sprintf("cpk=%.9f", pick("Cp_k|Cpk")),
          sprintf("cpu=%.9f", pick("Cp_u|Cpu")),
          sprintf("cpl=%.9f", pick("Cp_l|Cpl")),
          sprintf("cpm=%.9f", pick("^Cpm$")),
          sep = "\\n"
        )
      `));
      results.processCapability = pc;
      const indCpk = Math.min(ind.cpu, ind.cpl);
      const dCp = Math.abs(Number(pc.cp) - ind.cp);
      const dCpk = Math.abs(Number(pc.cpk) - indCpk);
      capOk = dCp < 1e-4 && dCpk < 1e-4;
      must(record('Cp / Cpk 与独立公式复算一致',
        capOk,
        `Cp qcc=${pc.cp} vs Node=${ind.cp.toFixed(6)} (Δ=${dCp.toExponential(2)}); ` +
        `Cpk qcc=${pc.cpk} vs Node=${indCpk.toFixed(6)} (Δ=${dCpk.toExponential(2)})`));
    } catch (e) {
      results.processCapabilityError = String(e?.message || e);
      must(record('Cp / Cpk 与独立公式复算一致', false,
        `异常: ${String(e?.message || e).split('\n')[0]}`));
    }

    // ---------------------------------------------------------- 7 图形渲染
    // 控制图必须能真的出图（前端要给工程师看）。R 侧写 PNG 到 NODEFS 挂载点，
    // Node 侧直接 stat 校验并清理 —— 复用 S1 验证过的 cairo/png 设备。
    log('\n=== 控制图实际渲染（PNG）===');
    const pngPath = join(LIB, '_s4_control_chart.png');
    let pngOk = false, pngBytes = 0;
    try {
      await evVoid(`
        suppressMessages(library(qcc))
        set.seed(2026)
        y <- rnorm(125, mean = 74, sd = 0.005)
        g <- qcc.groups(y, rep(1:25, each = 5))
        obj <- qcc(g, type = "xbar", plot = FALSE)
        png("/rlib/_s4_control_chart.png", width = 900, height = 600)
        plot(obj, main = "S4 X-bar Control Chart")
        dev.off()
      `);
      if (existsSync(pngPath)) {
        pngBytes = statSync(pngPath).size;
        pngOk = pngBytes > 3000;
        unlinkSync(pngPath);
      }
      results.controlChartPng = { written: pngOk, bytes: pngBytes };
      must(record('R 侧控制图可渲染为 PNG（S4 出图路径可用）', pngOk,
        `${pngBytes} bytes (cairo/png 设备)`));
    } catch (e) {
      results.controlChartPngError = String(e?.message || e);
      must(record('R 侧控制图可渲染为 PNG（S4 出图路径可用）', false,
        `异常: ${String(e?.message || e).split('\n')[0]}`));
    }

    // ---------------------------------------------------------- 结论
    results.verdict = pass ? 'GO' : 'NO-GO';
    results.summary = {
      independentConstants: CONST,
      xbarControlLimits: { lcl: xLcl, cl: xCenter, ucl: xUcl },
      deviationFromTableConstants: results.xbarLimitDelta,
      note: '控制限独立基准来自 AIAG/ASTM 公开查表常数（Minitab、JMP、qcc 共用同一套）；' +
            '查表值为三位小数，qcc 内部使用更高精度 d2，故存在 <1e-4 的可解释偏差。' +
            '正式发布前应再用 process-capability-analyzer 的 Minitab 验证集做逐位比对。',
    };
    log(`\n  检查项 ${results.checks.filter((c) => c.ok).length}/${results.checks.length} 通过`);
    return pass ? 0 : 1;
  }
);

process.exit(exitCode);
