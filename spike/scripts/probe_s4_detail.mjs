/**
 * S4 细节探针 —— 确认 qcc 2.7 的内置数据集名、qcc() 的分组参数、
 * shewhart.rules 结构、process.capability 返回字段。
 * 结论用于写 S4 正式验证脚本，避免 API 猜测错误。
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
const OUT = join(ROOT, 'results', 'probe_s4_detail.log');
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
  line('=== S4 细节探针 ===');
  webR = new WebR({ baseUrl: WEBR_BASE_URL });
  await webR.init();
  await webR.FS.mkdir(MP);
  await webR.FS.mount('NODEFS', { root: LIB }, MP);
  await webR.evalRVoid(`.libPaths(c("${MP}", .libPaths()))`);

  await probe('qcc 内置数据集清单', `
    print(data(package = "qcc")$results[, c("Item", "Title")])
  `);

  await probe('qcc 命名空间里所有 data 对象', `
    cat(ls(asNamespace("qcc")), sep = "\\n")
  `);

  await probe('尝试 qcc::pistonrings / orangejuice / circuit', `
    suppressMessages(library(qcc))
    for (nm in c("pistonrings", "orangejuice", "circuit", "dyestuff", "boiler")) {
      ok <- exists(nm, where = asNamespace("qcc"), inherits = FALSE)
      cat(nm, ":", ok, "\\n")
    }
  `);

  await probe('shewhart.rules 结构', `
    suppressMessages(library(qcc))
    cat("class:", paste(class(shewhart.rules), collapse=","), "\\n")
    cat("length:", length(shewhart.rules), "\\n")
    str(shewhart.rules)
    cat("qcc.options() names:", paste(names(qcc.options()), collapse=","))
  `);

  await probe('qcc() 用自造分组数据 + sample 参数', `
    suppressMessages(library(qcc))
    set.seed(2026)
    y <- rnorm(125, mean = 74, sd = 0.005)
    grp <- rep(1:25, each = 5)
    obj <- tryCatch(qcc(y, sample = grp, type = "xbar", plot = FALSE),
                    error = function(e) structure(list(err = conditionMessage(e)), class="err"))
    if (inherits(obj, "err")) cat("ERR:", obj$err) else {
      cat("class:", paste(class(obj), collapse=","), "\\n")
      cat("center:", sprintf("%.9f", obj$center), "\\n")
      cat("limits:", paste(sprintf("%.9f", obj$limits), collapse=" , "), "\\n")
      cat("std.dev:", sprintf("%.9f", obj$std.dev), "\\n")
      cat("data.name:", obj$data.name, "\\n")
      cat("names:", paste(names(obj), collapse=","))
    }
  `);

  await probe('qcc() 用 qcc.groups 矩阵（自造数据）', `
    suppressMessages(library(qcc))
    set.seed(2026)
    y <- rnorm(125, mean = 74, sd = 0.005)
    g <- qcc.groups(y, rep(1:25, each = 5))
    cat("dim groups:", paste(dim(g), collapse=" x "), "\\n")
    obj <- qcc(g, type = "xbar", plot = FALSE)
    cat("center:", sprintf("%.9f", obj$center), "\\n")
    cat("limits:", paste(sprintf("%.9f", obj$limits), collapse=" , "), "\\n")
    cat("std.dev:", sprintf("%.9f", obj$std.dev))
  `);

  await probe('R 图（自造分组数据）', `
    suppressMessages(library(qcc))
    set.seed(2026)
    y <- rnorm(125, mean = 74, sd = 0.005)
    obj <- qcc(y, sample = rep(1:25, each = 5), type = "R", plot = FALSE)
    cat("center:", sprintf("%.9f", obj$center), "\\n")
    cat("limits:", paste(sprintf("%.9f", obj$limits), collapse=" , "), "\\n")
    cat("std.dev:", sprintf("%.9f", obj$std.dev))
  `);

  await probe('process.capability 字段名与值', `
    suppressMessages(library(qcc))
    set.seed(2026)
    y <- rnorm(125, mean = 74, sd = 0.005)
    obj <- qcc(y, sample = rep(1:25, each = 5), type = "xbar", plot = FALSE)
    pc <- tryCatch(process.capability(obj, spec.limits = c(73.99, 74.01), print = FALSE),
                   error = function(e) structure(list(err=conditionMessage(e)), class="err"))
    if (inherits(pc, "err")) cat("ERR:", pc$err) else {
      cat("names:", paste(names(pc), collapse=","), "\\n")
      for (nm in intersect(c("Cp","Cpk","Cpm","Cpu","Cpl","center","std.dev","USL","LSL"), names(pc)))
        cat(nm, "=", sprintf("%.8f", pc[[nm]]), "\\n")
    }
  `);

  await probe('规则检测：构造越界点', `
    suppressMessages(library(qcc))
    set.seed(7)
    x <- c(rnorm(24, 0, 1), 6)
    obj <- qcc(x, type = "xbar.one", plot = FALSE)
    cat("names:", paste(names(obj), collapse=","), "\\n")
    cat("violations names:", paste(names(obj$violations), collapse=","), "\\n")
    cat("beyond.limits:", paste(obj$violations$beyond.limits, collapse=","), "\\n")
    cat("limits:", paste(sprintf("%.6f", obj$limits), collapse=" , "))
  `);

  line('\n=== 探针结束 ===');
} catch (e) {
  line(`[FATAL] ${String(e?.stack || e)}`);
} finally {
  try { if (webR) await webR.close(); } catch {}
  writeFileSync(OUT, lines.join('\n'), 'utf8');
}
