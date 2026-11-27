/**
 * S2 最小化诊断：定位 installPackages 到底卡在哪一步。
 *
 * 现象：批量安装 DoE.base+conf.design+FrF2+rsm 时，下载在 ~70MB 后内存停住，
 * 5 分钟无进展也不报错。
 *
 * 怀疑点：webR 默认 downloadTimeout=0（无超时），单个请求挂住会永久阻塞。
 *
 * 诊断策略：
 *   1. 显式设 downloadTimeout（60s），让挂住能抛错而非无限等
 *   2. 从最小纯 R 包开始逐个装，每个包独立计时
 *      conf.design（无依赖）→ DoE.base → estimability → rsm → MASS → lattice
 *      → igraph（编译型，最大最可疑）→ FrF2
 *   3. 每个包装完立即 requireNamespace 验证
 *
 * 顺序按「依赖拓扑 + 体积」排，先证明机制可用，再逼近最可疑的编译型包。
 */

import { installWorkerShim, WEBR_BASE_URL } from './webr-node-shim.mjs';

const { WebR } = await import('webr');
installWorkerShim();

const BASE_URL = WEBR_BASE_URL;

// 诊断顺序：由易到难，先纯 R 小包，最后编译型大包
const PROBE_ORDER = [
  'conf.design', // 纯 R，几乎无依赖 —— 机制试金石
  'estimability', // rsm 的唯一硬依赖，纯 R，极小
  'rsm', // 纯 R，响应面核心
  'MASS', // 编译型，DoE.base/qcc 依赖
  'DoE.base', // 纯 R，但依赖 vcd/combinat/numbers/partitions/lattice
  'lattice', // 编译型，DoE.base 依赖
  'igraph', // 编译型，FrF2 硬依赖，最大最可疑
  'FrF2', // 纯 R，筛选设计核心
];

const PER_PKG_TIMEOUT_MS = Number(process.env.DIAG_TIMEOUT_MS ?? 180000); // 3min/包

console.log('=== S2 最小化诊断 ===');
console.log(`downloadTimeout=60s, 单包硬超时=${PER_PKG_TIMEOUT_MS / 1000}s`);
console.log(`探测顺序: ${PROBE_ORDER.join(' → ')}\n`);

const t0 = Date.now();
const webR = new WebR({
  baseUrl: BASE_URL,
  downloadTimeout: 60000, // 关键：给下载设超时，挂住能抛错
});
await webR.init();
console.log(`webR 启动: ${Date.now() - t0}ms\n`);

async function evalRString(code) {
  return await webR.evalRString(code);
}

const summary = [];
for (const pkg of PROBE_ORDER) {
  const tp = Date.now();
  process.stdout.write(`  [....] ${pkg.padEnd(16)} 安装中...`);
  let ok = false;
  let err = null;
  try {
    await Promise.race([
      webR.installPackages([pkg]),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`timeout ${PER_PKG_TIMEOUT_MS / 1000}s`)),
          PER_PKG_TIMEOUT_MS
        )
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
  summary.push({ pkg, ok, ms, err });
  console.log(
    `\r  [${ok ? 'OK  ' : 'FAIL'}] ${pkg.padEnd(16)} ${(ms / 1000).toFixed(1)}s${err ? ` — ${err}` : ''}`
  );
}

console.log('\n=== 诊断小结 ===');
const firstFail = summary.find((s) => !s.ok);
if (!firstFail) {
  console.log('全部成功 —— 之前卡死可能是偶发网络抖动，或某个包的依赖解析问题。');
} else {
  console.log(`首个失败: ${firstFail.pkg}（${firstFail.err || '未知'}）`);
  const before = summary.slice(0, summary.indexOf(firstFail)).map((s) => s.pkg);
  console.log(`失败前成功: ${before.join(', ') || '(无)'}`);
  console.log(`未测试: ${summary.slice(summary.indexOf(firstFail) + 1).map((s) => s.pkg).join(', ') || '(无)'}`);
}

console.log('\n逐包耗时:');
for (const s of summary) {
  console.log(
    `  ${s.ok ? '✓' : '✗'} ${s.pkg.padEnd(16)} ${(s.ms / 1000).toFixed(1)}s${s.err ? '  ' + s.err : ''}`
  );
}

import { writeFileSync } from 'node:fs';
writeFileSync(
  new URL('../results/s2_diag.json', import.meta.url),
  JSON.stringify(
    { order: PROBE_ORDER, downloadTimeout: 60000, results: summary },
    null,
    2
  ),
  'utf8'
);

try {
  await webR.close();
} catch {}
process.exit(0);
