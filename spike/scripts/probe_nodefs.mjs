/**
 * NODEFS 挂载最小探针：确认 webR 在 Node worker 下能把真实目录挂进虚拟 FS。
 * 只做挂载 + 列举 + .libPaths + requireNamespace，不跑任何分析。
 */
import { installWorkerShim, WEBR_BASE_URL } from './webr-node-shim.mjs';
const { WebR } = await import('webr');
installWorkerShim();

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, '..', 'local-repo', 'library');

console.log('=== NODEFS 挂载探针 ===');
console.log('library 目录:', LIB);

const webR = new WebR({ baseUrl: WEBR_BASE_URL });
await webR.init();
console.log('webR 启动 OK');

async function ev(code) {
  return (await webR.evalRString(code)).trim();
}

try {
  await webR.FS.mkdir('/rlib');
  console.log('mkdir /rlib OK');
  await webR.FS.mount('NODEFS', { root: LIB }, '/rlib');
  console.log('mount NODEFS -> /rlib OK');

  // 从 R 侧列举挂载点内容（验证虚拟 FS 真能看到真实目录）
  const dirs = await ev(`paste(head(list.files("/rlib"), 8), collapse=", ")`);
  console.log('R 侧 list.files("/rlib"):', dirs);

  // 检查一个编译型包的 .so 是否可见
  const soSeen = await ev(`as.character(file.exists("/rlib/Matrix/libs/Matrix.so"))`);
  console.log('Matrix.so 可见:', soSeen);

  // 设置 libPaths 并尝试加载一个纯 R 小包
  await ev(`.libPaths(c("/rlib", .libPaths()))`);
  const libs = await ev(`paste(.libPaths(), collapse=" | ")`);
  console.log('.libPaths:', libs);

  for (const p of ['conf.design', 'rsm', 'FrF2', 'DoE.base']) {
    try {
      const r = await ev(`as.character(requireNamespace("${p}", quietly=TRUE))`);
      console.log(`  requireNamespace("${p}") = ${r}`);
    } catch (e) {
      console.log(`  requireNamespace("${p}") 异常: ${String(e?.message || e).split('\n')[0]}`);
    }
  }
  console.log('\n=== NODEFS 探针结论: OK ===');
} catch (e) {
  console.log('\n=== NODEFS 探针结论: FAIL ===');
  console.log(String(e?.message || e));
} finally {
  try { await webR.close(); } catch {}
}
process.exit(0);
