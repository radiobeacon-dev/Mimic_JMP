/**
 * 探测 FrF2 / DoE.base 的正确 API，修正开发计划里写错的 S2 通过标准。
 * 用 NODEFS 挂载（已验证可用），纯本地、零外网。
 */
import { installWorkerShim, WEBR_BASE_URL } from './webr-node-shim.mjs';
const { WebR } = await import('webr');
installWorkerShim();

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, '..', 'local-repo', 'library');

const webR = new WebR({ baseUrl: WEBR_BASE_URL });
await webR.init();
await webR.FS.mkdir('/rlib');
await webR.FS.mount('NODEFS', { root: LIB }, '/rlib');
await webR.evalRVoid(`.libPaths(c("/rlib", .libPaths()))`);

async function ev(code) {
  try { return (await webR.evalRString(code)).trim(); }
  catch (e) { return `ERR: ${String(e?.message || e).split('\n')[0]}`; }
}

console.log('=== FrF2 包导出函数 ===');
console.log(await ev(`paste(grep("pb|FrF2|design", getNamespaceExports("FrF2"), value=TRUE), collapse=", ")`));

console.log('\n=== pb() 函数签名 ===');
console.log(await ev(`paste(deparse(args(FrF2::pb)), collapse=" ")`));

console.log('\n=== 12-run Plackett-Burman 设计（对应 JMP 12-run Screening）===');
console.log(await ev(`
  local({
    suppressMessages(library(FrF2))
    d <- pb(nruns = 12, nfactors = 7, randomize = FALSE)
    dm <- as.data.frame(d)
    sprintf("nrow=%d ncol=%d two_level=%s no_na=%s class=%s",
      nrow(dm), ncol(dm),
      all(vapply(dm, function(z) length(unique(z)) == 2, logical(1))),
      !anyNA(dm), paste(class(d)[1], collapse="/"))
  })
`));

console.log('\n=== 16-run regular 部分因子 FrF2(16,7) ===');
console.log(await ev(`
  local({
    suppressMessages(library(FrF2))
    d <- FrF2(nruns = 16, nfactors = 7, randomize = FALSE)
    dm <- as.data.frame(d)
    sprintf("nrow=%d ncol=%d two_level=%s resolution=%s",
      nrow(dm), ncol(dm),
      all(vapply(dm, function(z) length(unique(z)) == 2, logical(1))),
      paste(attr(d, "design.info")$resolution, collapse=","))
  })
`));

console.log('\n=== DoE.base 里 L9 / L18 相关正交表 ID ===');
console.log(await ev(`
  local({
    suppressMessages(library(DoE.base))
    oas <- show.oas()
    ids <- if (is.data.frame(oas)) oas$ID else if (is.character(oas)) oas else names(oas)
    ids <- as.character(ids)
    hit <- grep("^L9|^L18", ids, value = TRUE)
    paste(head(hit, 12), collapse=" | ")
  })
`));

console.log('\n=== show.oas 返回类型 ===');
console.log(await ev(`
  local({
    suppressMessages(library(DoE.base))
    o <- show.oas()
    sprintf("class=%s length=%d", paste(class(o), collapse="/"), length(o))
  })
`));

console.log('\n=== 直接试几个 L9 ID ===');
for (const id of ['L9.3.4', 'L9.3.4.1', 'L9.3.4.1.1', 'L9.3.4.1.1.1']) {
  const r = await ev(`
    local({
      suppressMessages(library(DoE.base))
      d <- tryCatch(oa.design(ID = "${id}", seed = 7), error = function(e) NULL)
      if (is.null(d)) "INVALID" else sprintf("OK nrow=%d ncol=%d", nrow(d), ncol(d))
    })
  `);
  console.log(`  ${id}: ${r}`);
}

console.log('\n=== 用 oa.design(nruns=9, nfactors=4) 自动选表 ===');
console.log(await ev(`
  local({
    suppressMessages(library(DoE.base))
    d <- tryCatch(oa.design(nruns = 9, nfactors = 4, nlevels = 3, seed = 7), error = function(e) NULL)
    if (is.null(d)) "INVALID" else sprintf("OK nrow=%d ncol=%d", nrow(d), ncol(d))
  })
`));

await webR.close();
process.exit(0);
