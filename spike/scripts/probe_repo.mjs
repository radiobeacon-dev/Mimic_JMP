/**
 * S2 前置探测：repo.r-wasm.org 是否可达。
 *
 * S1 完全使用 npm 包内的本地文件，没有访问外网。
 * S2 必须从 webR 的 WASM 包仓库下载 R 包，若该域名不可达，
 * 则需走 Plan B（自建 WASM repo，要装 Emscripten 工具链，成本高）。
 *
 * 注意：本机 curl 被沙箱拦截，但 npm install 走的是 Node 自身的网络栈且可用，
 * 因此这里用 Node 的 fetch 探测，结果才具有参考价值。
 */

const TARGETS = [
  {
    name: 'repo root',
    url: 'https://repo.r-wasm.org/',
  },
  {
    name: 'DoE.base PACKAGES 索引（wasm 路径）',
    url: 'https://repo.r-wasm.org/wasm/4.6/PACKAGES',
  },
  {
    name: 'DoE.base PACKAGES 索引（bin/emscripten 路径）',
    url: 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6/PACKAGES',
  },
];

async function probe(t) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(t.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'mimic-jmp-phase0-spike/0.0.1' },
    });
    clearTimeout(timer);
    const ms = Date.now() - started;
    const body = await res.text();
    const head = body.slice(0, 300).replace(/\s+/g, ' ');

    // 若拿到 PACKAGES 索引，顺便数一下我们关心的包在不在
    let found = null;
    if (t.url.endsWith('PACKAGES')) {
      const names = new Set(
        [...body.matchAll(/^Package:\s*(\S+)/gm)].map((m) => m[1])
      );
      const wanted = [
        'DoE.base',
        'conf.design',
        'FrF2',
        'rsm',
        'ggDoE',
        'igraph',
        'AlgDesign',
        'qcc',
        'jsonlite',
        'MASS',
        'lattice',
        'vcd',
        'combinat',
        'numbers',
        'partitions',
        'sfsmisc',
        'scatterplot3d',
        'estimability',
        'ggplot2',
        'insight',
        'desirability2',
      ];
      found = {
        totalInIndex: names.size,
        wantedPresent: wanted.filter((w) => names.has(w)),
        wantedMissing: wanted.filter((w) => !names.has(w)),
      };
    }

    console.log(`\n[${res.ok ? 'OK' : 'HTTP ' + res.status}] ${t.name}`);
    console.log(`  url: ${t.url}`);
    console.log(`  status: ${res.status}  ${ms}ms  bytes: ${body.length}`);
    console.log(`  head: ${head}`);
    if (found) {
      console.log(`  索引内包总数: ${found.totalInIndex}`);
      console.log(`  我们需要且存在: ${found.wantedPresent.join(', ') || '(无)'}`);
      console.log(`  我们需要但缺失: ${found.wantedMissing.join(', ') || '(无)'}`);
    }
    return { ...t, ok: res.ok, status: res.status, ms, bytes: body.length, found };
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`\n[FAIL] ${t.name}`);
    console.log(`  url: ${t.url}`);
    console.log(`  error: ${err?.name || ''} ${err?.message || err}`);
    console.log(`  elapsed: ${ms}ms`);
    return { ...t, ok: false, error: String(err?.message || err), ms };
  }
}

console.log('=== repo.r-wasm.org 可达性探测（S2 前置）===');
const results = [];
for (const t of TARGETS) results.push(await probe(t));

const anyIndexOk = results.some((r) => r.found);
console.log('\n=== 探测结论 ===');
console.log(
  `可拿到 PACKAGES 索引: ${anyIndexOk ? '是' : '否'}`,
);
console.log(
  anyIndexOk
    ? '→ S2 可以正常走 install.packages() 路径'
    : '→ S2 需改用 Plan B：自建 WASM repo 或离线 tarball（需 Emscripten）'
);

process.exit(0);
