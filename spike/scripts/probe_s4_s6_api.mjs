/**
 * S4 / S6 API 探针 —— 在写正式验证前，先确认 qcc 与 AlgDesign 的真实函数签名、
 * 内置数据集结构、返回对象字段。避免在验证脚本里把 API 写错（FrF2 的教训）。
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
const OUT = join(ROOT, 'results', 'probe_s4_s6_api.log');
mkdirSync(join(ROOT, 'results'), { recursive: true });

const lines = [];
function line(s = '') { lines.push(s); console.log(s); }

let webR;
async function ev(code) { return (await webR.evalRString(code)).trim(); }

async function probe(label, code) {
  line(`\n--- ${label} ---`);
  try {
    line(await ev(`paste(capture.output({ ${code} }), collapse = "\\n")`));
  } catch (e) {
    line(`ERR: ${String(e?.message || e).split('\n')[0]}`);
  }
}

try {
  line('=== S4 / S6 API 探针 ===');
  webR = new WebR({ baseUrl: WEBR_BASE_URL });
  await webR.init();
  await webR.FS.mkdir(MP);
  await webR.FS.mount('NODEFS', { root: LIB }, MP);
  await webR.evalRVoid(`.libPaths(c("${MP}", .libPaths()))`);
  line('NODEFS 挂载 OK');

  await probe('包版本', `
    cat("qcc =", as.character(packageVersion("qcc")), "\\n")
    cat("AlgDesign =", as.character(packageVersion("AlgDesign")))
  `);

  await probe('qcc 导出函数（含 rule / capability / cusum / ewma）', `
    cat(grep("rule|capability|cusum|ewma|groups|shewhart|qcc",
        getNamespaceExports("qcc"), value = TRUE, ignore.case = TRUE), sep = "\\n")
  `);

  await probe('pistonrings 数据集结构', `
    data(pistonrings, package = "qcc")
    str(pistonrings)
    cat("table(sample):", paste(table(pistonrings$sample), collapse = ","), "\\n")
    cat("diameter range:", paste(range(pistonrings$diameter), collapse = " .. "))
  `);

  await probe('qcc xbar 写法 A: sample= 参数', `
    suppressMessages(library(qcc))
    data(pistonrings, package = "qcc")
    obj <- qcc(pistonrings$diameter, sample = pistonrings$sample,
               type = "xbar", plot = FALSE)
    cat("class:", paste(class(obj), collapse=","), "\\n")
    cat("center:", sprintf("%.8f", obj$center), "\\n")
    cat("limits:", paste(sprintf("%.8f", obj$limits), collapse=" , "), "\\n")
    cat("std.dev:", sprintf("%.8f", obj$std.dev), "\\n")
    cat("names:", paste(names(obj), collapse=","), "\\n")
    cat("n.violations:", length(obj$violations))
  `);

  await probe('qcc xbar 写法 B: qcc.groups 矩阵', `
    suppressMessages(library(qcc))
    data(pistonrings, package = "qcc")
    g <- qcc.groups(pistonrings$diameter, pistonrings$sample)
    cat("dim(qcc.groups):", paste(dim(g), collapse=" x "), "\\n")
    obj <- qcc(g, type = "xbar", plot = FALSE)
    cat("center:", sprintf("%.8f", obj$center), "\\n")
    cat("limits:", paste(sprintf("%.8f", obj$limits), collapse=" , "), "\\n")
    cat("std.dev:", sprintf("%.8f", obj$std.dev))
  `);

  await probe('qcc R 图（同数据）', `
    suppressMessages(library(qcc))
    data(pistonrings, package = "qcc")
    obj <- qcc(pistonrings$diameter, sample = pistonrings$sample,
               type = "R", plot = FALSE)
    cat("center:", sprintf("%.8f", obj$center), "\\n")
    cat("limits:", paste(sprintf("%.8f", obj$limits), collapse=" , "), "\\n")
    cat("std.dev:", sprintf("%.8f", obj$std.dev))
  `);

  await probe('process.capability 返回字段', `
    suppressMessages(library(qcc))
    data(pistonrings, package = "qcc")
    obj <- qcc(pistonrings$diameter, sample = pistonrings$sample,
               type = "xbar", plot = FALSE)
    pc <- process.capability(obj, spec.limits = c(73.99, 74.01), print = FALSE)
    cat("names:", paste(names(pc), collapse=","), "\\n")
    cat("Cp/Cpk/Cpm:", sprintf("%.6f", pc$Cp), sprintf("%.6f", pc$Cpk),
        sprintf("%.6f", pc$Cpm), "\\n")
    cat("center:", sprintf("%.8f", pc$center), " std.dev:", sprintf("%.8f", pc$std.dev))
  `);

  await probe('shewhart.rules 与违规检测', `
    suppressMessages(library(qcc))
    cat("shewhart.rules exists:", exists("shewhart.rules", where = asNamespace("qcc")), "\\n")
    cat("rules count:", length(shewhart.rules), "\\n")
    set.seed(11)
    x <- c(rnorm(20, 0, 1), 4.5)
    obj <- qcc(x, type = "xbar.one", plot = FALSE, rules = 1:4)
    cat("violations:", paste(names(obj$violations), collapse=","), "\\n")
    cat("beyond.limits count:", length(obj$violations$beyond.limits))
  `);

  await probe('AlgDesign 导出函数', `
    cat(getNamespaceExports("AlgDesign"), sep = "\\n")
  `);

  await probe('AlgDesign optFederov D-optimal 返回值', `
    suppressMessages(library(AlgDesign))
    set.seed(1)
    cand <- gen.factorial(levels = c(2,2,2), nVars = 3, varNames = c("A","B","C"))
    cat("candidate dim:", paste(dim(cand), collapse=" x "), "\\n")
    des <- optFederov(~ ., cand, nTrials = 8, criterion = "D")
    cat("return names:", paste(names(des), collapse=","), "\\n")
    cat("design dim:", paste(dim(des$design), collapse=" x "), "\\n")
    cat("criteria:", paste(names(des$criteria), collapse=","), "\\n")
    cat("criteria values:", paste(sprintf("%.4f", unlist(des$criteria)), collapse=","), "\\n")
    cat("rows:", paste(des$rows, collapse=","))
  `);

  await probe('AlgDesign I-optimal（JMP Custom Design 常用）', `
    suppressMessages(library(AlgDesign))
    set.seed(2)
    cand <- gen.factorial(levels = c(3,3,3), nVars = 3, varNames = c("A","B","C"))
    res <- tryCatch({
      des <- optFederov(~ quad(A,B,C), cand, nTrials = 14, criterion = "I")
      paste("OK dim=", paste(dim(des$design), collapse="x"),
            " criteria=", paste(sprintf("%.3f", unlist(des$criteria)), collapse=","))
    }, error = function(e) paste("ERR:", conditionMessage(e)))
    cat(res)
  `);

  await probe('AlgDesign 混合水平 + 交互（Custom Design 场景）', `
    suppressMessages(library(AlgDesign))
    set.seed(3)
    cand <- expand.grid(A = c(-1,1), B = c(-1,0,1), C = factor(c("L","M","H")))
    res <- tryCatch({
      des <- optFederov(~ A + B + C + A:B, cand, nTrials = 12, criterion = "D")
      paste("OK dim=", paste(dim(des$design), collapse="x"), " D=", sprintf("%.4f", des$D))
    }, error = function(e) paste("ERR:", conditionMessage(e)))
    cat(res)
  `);

  line('\n=== 探针结束 ===');
} catch (e) {
  line(`[FATAL] ${String(e?.stack || e)}`);
} finally {
  try { if (webR) await webR.close(); } catch {}
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`\n完整输出已写入 ${OUT}`);
}
