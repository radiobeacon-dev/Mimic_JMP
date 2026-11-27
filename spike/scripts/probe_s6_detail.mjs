/**
 * S6 细节探针 —— 确认 eval.design() 返回字段、optMonteCarlo() 正确调用方式。
 */

import { installWorkerShim, WEBR_BASE_URL } from './webr-node-shim.mjs';
const { WebR } = await import('webr');
installWorkerShim();

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'local-repo', 'library');
const MP = '/rlib';
const OUT = join(ROOT, 'results', 'probe_s6_detail.log');
mkdirSync(join(ROOT, 'results'), { recursive: true });

const lines = [];
function line(s = '') { lines.push(s); console.log(s); }
let webR;
async function ev(code) { return (await webR.evalRString(code)).trim(); }
async function probe(label, code) {
  line(`\n--- ${label} ---`);
  try { line(await ev(`paste(capture.output({ ${code} }), collapse = "\\n")`)); }
  catch (e) { line(`ERR: ${String(e?.message || e).split('\n')[0]}`); }
}

try {
  line('=== S6 细节探针 ===');
  webR = new WebR({ baseUrl: WEBR_BASE_URL });
  await webR.init();
  await webR.FS.mkdir(MP);
  await webR.FS.mount('NODEFS', { root: LIB }, MP);
  await webR.evalRVoid(`.libPaths(c("${MP}", .libPaths()))`);

  await probe('函数签名', `
    suppressMessages(library(AlgDesign))
    cat("optMonteCarlo:\\n"); print(args(optMonteCarlo))
    cat("\\neval.design:\\n"); print(args(eval.design))
    cat("\\noptFederov:\\n"); print(args(optFederov))
  `);

  await probe('eval.design 返回内容', `
    suppressMessages(library(AlgDesign))
    set.seed(2)
    cand <- gen.factorial(levels=c(3,3,3), nVars=3, varNames=c("A","B","C"))
    des <- optFederov(~ quad(A,B,C), cand, nTrials=14, criterion="D")
    ev <- eval.design(~ quad(A,B,C), des$design)
    str(ev)
  `);

  await probe('optMonteCarlo 多种写法', `
    suppressMessages(library(AlgDesign))
    set.seed(4)
    cand <- gen.factorial(levels=c(4,4,4,4), nVars=4, varNames=c("A","B","C","D"))
    cat("cand dim:", paste(dim(cand), collapse="x"), " classes:",
        paste(vapply(cand, function(z) class(z)[1], character(1)), collapse=","), "\\n")
    trials <- list(
      a = function() optMonteCarlo(~ quad(A,B,C,D), cand, nTrials=20),
      b = function() optMonteCarlo(~ ., cand, nTrials=20),
      c = function() optMonteCarlo(~ A+B+C+D, cand, nTrials=20),
      d = function() optMonteCarlo(~ ., cand, nTrials=20, nRepeats=3),
      e = function() optMonteCarlo(~ ., cand, nTrials=20, criterion="D"),
      f = function() optMonteCarlo(~ quad(A,B,C,D), cand, nTrials=20, nRepeats=5)
    )
    for (nm in names(trials)) {
      r <- tryCatch({
        des <- trials[[nm]]()
        paste("OK", "dim=", paste(dim(des$design), collapse="x"),
              "names=", paste(names(des), collapse=","))
      }, error = function(e) paste("ERR:", conditionMessage(e)))
      cat(nm, ":", r, "\\n")
    }
  `);

  await probe('optMonteCarlo 用 expand.grid 数值候选集', `
    suppressMessages(library(AlgDesign))
    set.seed(5)
    cand <- expand.grid(A=c(-1,0,1), B=c(-1,0,1), C=c(-1,0,1), D=c(-1,0,1))
    r <- tryCatch({
      des <- optMonteCarlo(~ quad(A,B,C,D), cand, nTrials=20, nRepeats=3)
      paste("OK dim=", paste(dim(des$design), collapse="x"),
            "names=", paste(names(des), collapse=","))
    }, error = function(e) paste("ERR:", conditionMessage(e)))
    cat(r)
  `);

  await probe('optMonteCarlo 函数体内含 [ 选择的部分', `
    b <- deparse(body(AlgDesign::optMonteCarlo))
    hits <- grep("\\\\[|nCand|columns|space|data", b, value = TRUE)
    cat(paste(head(hits, 45), collapse = "\\n"))
  `);

  await probe('optMonteCarlo 用正确的 7 列变量规格表', `
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
    r <- tryCatch({
      des <- optMonteCarlo(~ quad(A,B,C,D), spec, nTrials=20, nRepeats=3)
      paste("OK dim=", paste(dim(des$design), collapse="x"),
            " names=", paste(names(des), collapse=","))
    }, error = function(e) paste("ERR:", conditionMessage(e)))
    cat(r)
  `);

  await probe('optFederov 直接处理 256 点候选集（大候选集替代路径）', `
    suppressMessages(library(AlgDesign))
    set.seed(6)
    cand <- gen.factorial(levels=c(4,4,4,4), nVars=4, varNames=c("A","B","C","D"))
    r <- tryCatch({
      des <- optFederov(~ quad(A,B,C,D), cand, nTrials=20, criterion="D")
      paste("OK dim=", paste(dim(des$design), collapse="x"),
            " D=", sprintf("%.6f", des$D), " Ge=", sprintf("%.6f", des$Ge))
    }, error = function(e) paste("ERR:", conditionMessage(e)))
    cat(r)
  `);

  line('\n=== 探针结束 ===');
} catch (e) {
  line(`[FATAL] ${String(e?.stack || e)}`);
} finally {
  try { if (webR) await webR.close(); } catch {}
  writeFileSync(OUT, lines.join('\n'), 'utf8');
}
