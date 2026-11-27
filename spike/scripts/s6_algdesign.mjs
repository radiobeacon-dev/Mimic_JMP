/**
 * S6 —— AlgDesign 最优设计验证（Phase 0，决定 Custom Design 排期）
 *
 * JMP 的 Custom Design 平台以 I-optimal / D-optimal 设计为核心。若 AlgDesign
 * 能生成并评估这类设计，Phase 2 的 Custom Design 就无需自研交换算法，
 * 只需做交互外壳；否则必须自研或大幅砍功能。
 *
 * 验证链路：
 *   包加载（含编译型 .so）→ D/I-optimal 生成 → 混合水平+交互 →
 *   eval.design() 评估 → optMonteCarlo() 大候选集 → 可复现性 →
 *   **闭环：生成设计 → 注入响应 → lm() 二阶模型拟合且系数全部可估**
 */

import { runSpike, LIB } from './spike-harness.mjs';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fields(text) {
  return Object.fromEntries(
    text.split('\n').filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );
}
const num = (v) => Number(v);

const exitCode = await runSpike(
  { spike: 's6_algdesign', title: 'S6: AlgDesign 最优设计（Custom Design 排期决定项）' },
  async ({ ev, record, results, log }) => {
    let pass = true;
    const must = (ok) => { if (!ok) pass = false; return ok; };

    // ---------------------------------------------------------- 1 包与动态库
    log('\n=== 包与编译型动态库 ===');
    const soPath = join(LIB, 'AlgDesign', 'libs', 'AlgDesign.so');
    const soOk = existsSync(soPath);
    const soBytes = soOk ? statSync(soPath).size : 0;
    const pkg = fields(await ev(`
      paste(
        sprintf("ver=%s", as.character(packageVersion("AlgDesign"))),
        sprintf("loaded=%s", requireNamespace("AlgDesign", quietly = TRUE)),
        sprintf("n_export=%d", length(getNamespaceExports("AlgDesign"))),
        sprintf("fns=%s", paste(intersect(
          c("optFederov","optMonteCarlo","optBlock","gen.factorial",
            "gen.mixture","eval.design","expand.formula","actuals"),
          getNamespaceExports("AlgDesign")), collapse = ",")),
        sprintf("so_loaded=%s", is.loaded("FederovOpt", PACKAGE = "AlgDesign") ||
                                is.loaded("optFederov", PACKAGE = "AlgDesign") ||
                                !is.null(getLoadedDLLs()[["AlgDesign"]])),
        sep = "\\n"
      )
    `));
    results.algDesign = pkg;
    results.compiledLibrary = { path: soPath, present: soOk, bytes: soBytes };
    must(record('AlgDesign 可加载且编译型 WASM 动态库随包分发',
      pkg.loaded === 'TRUE' && soOk,
      `v${pkg.ver}, AlgDesign.so ${soBytes} bytes, DLL 已加载=${pkg.so_loaded}`));
    const fns = (pkg.fns || '').split(',').filter(Boolean);
    must(record('最优设计关键函数齐全', fns.length >= 7, `${fns.length}/8: ${fns.join(', ')}`));

    // ---------------------------------------------------------- 2 D-optimal
    log('\n=== D-optimal 设计（2 水平全因子候选集）===');
    const d1 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(1)
      cand <- gen.factorial(levels = c(2,2,2), nVars = 3, varNames = c("A","B","C"))
      des <- optFederov(~ ., cand, nTrials = 8, criterion = "D")
      paste(
        sprintf("cand_dim=%s", paste(dim(cand), collapse="x")),
        sprintf("design_dim=%s", paste(dim(des$design), collapse="x")),
        sprintf("n_rows=%d", length(des$rows)),
        sprintf("D=%.9f", des$D),
        sprintf("Ge=%.9f", des$Ge),
        sprintf("Dea=%.9f", des$Dea),
        sprintf("A=%.9f", des$A),
        sprintf("ret_names=%s", paste(names(des), collapse=",")),
        sprintf("no_na=%s", !anyNA(des$design)),
        sep = "\\n"
      )
    `));
    results.dOptimal = d1;
    must(record('optFederov() 生成 D-optimal 设计并给出效率指标',
      d1.design_dim === '8x3' && d1.no_na === 'TRUE' &&
      Number.isFinite(num(d1.D)) && num(d1.D) > 0,
      `design=${d1.design_dim}, D=${d1.D}, Ge=${d1.Ge}, Dea=${d1.Dea}, 字段=${d1.ret_names}`));

    // ---------------------------------------------------------- 3 I-optimal
    // JMP Custom Design 默认 I-optimal（最小化平均预测方差）
    log('\n=== I-optimal 设计（JMP Custom Design 默认准则）===');
    const d2 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(2)
      cand <- gen.factorial(levels = c(3,3,3), nVars = 3, varNames = c("A","B","C"))
      res <- tryCatch({
        des <- optFederov(~ quad(A,B,C), cand, nTrials = 14, criterion = "I")
        paste(sprintf("ok=TRUE"), sprintf("design_dim=%s", paste(dim(des$design), collapse="x")),
              sprintf("D=%.9f", des$D), sprintf("Ge=%.9f", des$Ge),
              sprintf("no_na=%s", !anyNA(des$design)), sep = "\\n")
      }, error = function(e) paste("ok=FALSE", sprintf("err=%s", conditionMessage(e)), sep="\\n"))
      res
    `));
    results.iOptimal = d2;
    must(record('I-optimal 设计可用（决定 Custom Design 能否复用现成算法）',
      d2.ok === 'TRUE' && d2.design_dim === '14x3',
      `ok=${d2.ok}, design=${d2.design_dim || '-'}, D=${d2.D || '-'}${d2.err ? `, err=${d2.err}` : ''}`));

    // ---------------------------------------------------------- 4 混合水平
    log('\n=== 混合水平 + 交互 + 类别因子（真实 Custom Design 场景）===');
    const d3 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(3)
      cand <- expand.grid(A = c(-1, 1), B = c(-1, 0, 1), C = factor(c("L","M","H")))
      res <- tryCatch({
        des <- optFederov(~ A + B + C + A:B, cand, nTrials = 12, criterion = "D")
        paste(sprintf("ok=TRUE"), sprintf("cand_dim=%s", paste(dim(cand), collapse="x")),
              sprintf("design_dim=%s", paste(dim(des$design), collapse="x")),
              sprintf("D=%.9f", des$D),
              sprintf("levels_C=%s", paste(levels(des$design$C), collapse=",")),
              sprintf("no_na=%s", !anyNA(des$design)), sep = "\\n")
      }, error = function(e) paste("ok=FALSE", sprintf("err=%s", conditionMessage(e)), sep="\\n"))
      res
    `));
    results.mixedLevel = d3;
    must(record('混合水平 + 交互 + 类别因子设计可用',
      d3.ok === 'TRUE' && d3.design_dim === '12x3' && d3.no_na === 'TRUE',
      `ok=${d3.ok}, 候选=${d3.cand_dim || '-'}, design=${d3.design_dim || '-'}, C 水平=${d3.levels_C || '-'}${d3.err ? `, err=${d3.err}` : ''}`));

    // ---------------------------------------------------------- 5 设计评估
    log('\n=== eval.design() 设计评估（G-efficiency / 预测方差）===');
    const d4 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(2)
      cand <- gen.factorial(levels = c(3,3,3), nVars = 3, varNames = c("A","B","C"))
      des <- optFederov(~ quad(A,B,C), cand, nTrials = 14, criterion = "D")
      res <- tryCatch({
        ev <- eval.design(~ quad(A,B,C), des$design)
        paste(sprintf("ok=TRUE"), sprintf("names=%s", paste(names(ev), collapse=",")),
              sprintf("determinant=%.9f", ev$determinant),
              sprintf("A=%.9f", ev$A),
              sprintf("diagonality=%.9f", ev$diagonality),
              sprintf("gmean_var=%.9f", ev$gmean.variances), sep = "\\n")
      }, error = function(e) paste("ok=FALSE", sprintf("err=%s", conditionMessage(e)), sep="\\n"))
      res
    `));
    results.designEvaluation = d4;
    must(record('eval.design() 可对生成的设计做效率评估',
      d4.ok === 'TRUE' && Number.isFinite(num(d4.determinant)) && num(d4.determinant) > 0,
      `ok=${d4.ok}, 字段=${d4.names || '-'}, determinant=${d4.determinant || '-'}, ` +
      `几何平均方差=${d4.gmean_var || '-'}${d4.err ? `, err=${d4.err}` : ''}`));

    // ---------------------------------------------------------- 6 大候选集
    // 注意：optMonteCarlo 的 data 参数是 7 列「变量规格表」而非候选点矩阵
    //（内部读取 data[,7]=isFactor、data[,5]=nLevels、data[,1]=varNames），
    // 传候选点矩阵会报 "undefined columns selected"。
    const d5 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(8)
      spec <- data.frame(
        varName = c("A","B","C","D"),
        low     = c(-1,-1,-1,-1),
        high    = c( 1, 1, 1, 1),
        center  = c( 0, 0, 0, 0),
        nLevels = c( 3, 3, 3, 3),
        roundD  = c( 2, 2, 2, 2),
        isFactor= c( 0, 0, 0, 0),
        stringsAsFactors = FALSE
      )
      res <- tryCatch({
        des <- optMonteCarlo(~ quad(A,B,C,D), spec, nTrials = 20, nRepeats = 3)
        paste(sprintf("ok=TRUE"), sprintf("spec_dim=%s", paste(dim(spec), collapse="x")),
              sprintf("design_dim=%s", paste(dim(des$design), collapse="x")),
              sprintf("D=%.9f", des$D), sep = "\\n")
      }, error = function(e) paste("ok=FALSE", sprintf("err=%s", conditionMessage(e)), sep="\\n"))
      res
    `));
    results.monteCarlo = d5;
    must(record('optMonteCarlo() 可从变量规格表生成设计（连续/混合因子场景）',
      d5.ok === 'TRUE' && /^20x4$/.test(d5.design_dim || ''),
      `ok=${d5.ok}, 规格表=${d5.spec_dim || '-'}, design=${d5.design_dim || '-'}, D=${d5.D || '-'}${d5.err ? `, err=${d5.err}` : ''}`));

    // 补：optFederov 直接处理 256 点候选集，覆盖「大候选集」能力
    const d5b = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(6)
      cand <- gen.factorial(levels = c(4,4,4,4), nVars = 4,
                            varNames = c("A","B","C","D"))
      res <- tryCatch({
        des <- optFederov(~ quad(A,B,C,D), cand, nTrials = 20, criterion = "D")
        paste(sprintf("ok=TRUE"), sprintf("cand_dim=%s", paste(dim(cand), collapse="x")),
              sprintf("design_dim=%s", paste(dim(des$design), collapse="x")),
              sprintf("D=%.9f", des$D), sprintf("Ge=%.9f", des$Ge), sep = "\\n")
      }, error = function(e) paste("ok=FALSE", sprintf("err=%s", conditionMessage(e)), sep="\\n"))
      res
    `));
    results.largeCandidateSet = d5b;
    must(record('optFederov() 可处理 256 点候选集（4⁴ 全因子）',
      d5b.ok === 'TRUE' && d5b.cand_dim === '256x4' && /^20x4$/.test(d5b.design_dim || ''),
      `ok=${d5b.ok}, 候选=${d5b.cand_dim || '-'}, design=${d5b.design_dim || '-'}, ` +
      `D=${d5b.D || '-'}${d5b.err ? `, err=${d5b.err}` : ''}`));

    // ---------------------------------------------------------- 7 可复现性
    log('\n=== 可复现性（工业用户要求同 seed 同设计）===');
    const d6 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      run <- function() {
        set.seed(99)
        cand <- gen.factorial(levels = c(3,3,3), nVars = 3, varNames = c("A","B","C"))
        des <- optFederov(~ quad(A,B,C), cand, nTrials = 12, criterion = "D")
        paste(des$rows, collapse = ":")
      }
      a <- run(); b <- run()
      paste(sprintf("identical=%s", identical(a, b)), sprintf("rows=%s", a), sep = "\\n")
    `));
    results.reproducibility = d6;
    must(record('同 seed 两次生成的设计完全一致',
      d6.identical === 'TRUE' && (d6.rows || '').split(':').length === 12,
      `identical=${d6.identical}, rows=${d6.rows}`));

    // ---------------------------------------------------------- 8 闭环建模
    // Custom Design 的核心闭环：生成设计 → 采集响应 → 拟合二阶模型。
    // 若设计矩阵秩不足（别名/退化），lm() 会出现 NA 系数 —— 这比只看
    // 「设计矩阵能生成」更能证明设计可真正用于分析。
    log('\n=== 闭环：AlgDesign 设计 → lm() 二阶模型拟合 ===');
    const d7 = fields(await ev(`
      suppressMessages(library(AlgDesign))
      set.seed(42)
      cand <- gen.factorial(levels = c(3,3,3), nVars = 3, varNames = c("A","B","C"))
      des <- optFederov(~ quad(A,B,C), cand, nTrials = 14, criterion = "D")
      d <- des$design
      d$y <- 10 + 2*d$A - 1.5*d$B + 0.8*d$A*d$B - 0.6*d$C^2 +
             rnorm(nrow(d), 0, 0.3)
      fit <- lm(y ~ A + B + C + A:B + A:C + B:C + I(A^2) + I(B^2) + I(C^2), data = d)
      cf <- coef(fit)
      paste(
        sprintf("n_coef=%d", length(cf)),
        sprintf("n_na=%d", sum(is.na(cf))),
        sprintf("rank=%d", fit$rank),
        sprintf("r2=%.6f", summary(fit)$r.squared),
        sprintf("resid_sd=%.6f", summary(fit)$sigma),
        sprintf("intercept=%.6f", unname(cf[1])),
        sprintf("A_slope=%.6f", unname(cf["A"])),
        sprintf("B_slope=%.6f", unname(cf["B"])),
        sep = "\\n"
      )
    `));
    results.closedLoop = d7;
    must(record('生成的设计可直接拟合二阶模型，系数全部可估（无别名退化）',
      num(d7.n_na) === 0 && num(d7.rank) === num(d7.n_coef) && num(d7.r2) > 0.9,
      `系数 ${d7.n_coef} 个, NA=${d7.n_na}, rank=${d7.rank}/${d7.n_coef}, R²=${d7.r2}`));
    // 回归系数应接近注入的真值（2 / -1.5），这是 R8 数值一致性的延伸
    const coefOk = Math.abs(num(d7.A_slope) - 2) < 0.3 &&
                   Math.abs(num(d7.B_slope) + 1.5) < 0.3;
    must(record('拟合系数接近注入的真实模型（DOE→建模链路数值正确）',
      coefOk,
      `Â=${d7.A_slope} (真值 2), B̂=${d7.B_slope} (真值 -1.5)`));

    // ---------------------------------------------------------- 结论
    results.verdict = pass ? 'GO' : 'NO-GO';
    results.customDesignImplication = pass
      ? 'AlgDesign 可覆盖 D/I-optimal 设计生成、混合水平、交互项、设计评估与建模闭环。' +
        'Phase 2 的 Custom Design 可复用现成算法，重点放在交互外壳与结果呈现，无需自研交换算法。'
      : 'AlgDesign 链路存在缺口，Custom Design 需推迟或改为自研/移植。';
    log(`\n  检查项 ${results.checks.filter((c) => c.ok).length}/${results.checks.length} 通过`);
    log(`  排期结论: ${results.customDesignImplication}`);
    return pass ? 0 : 1;
  }
);

process.exit(exitCode);
