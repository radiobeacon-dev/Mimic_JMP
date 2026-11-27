/**
 * 生成 packages.lock + THIRD-PARTY-NOTICES.md（路线 A 合规资产）。
 *
 * 输入全部来自本地实物：
 *   spike/local-repo/library/<pkg>/DESCRIPTION   → 包名 / 版本 / License / 编译型 / data/
 *   spike/local-repo/tgz/<pkg>_<ver>.tgz         → sha256 / 字节数
 * 确定性输出，不含时间戳，便于 git diff 与 CI 复现校验。
 *
 * 用法：
 *   node scripts/gen_packages_lock.mjs            重新生成（写入）
 *   node scripts/gen_packages_lock.mjs --check   只校验是否最新，不写文件
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildLock, renderNotices, LOCK_PATH, NOTICES_PATH } from './license_policy.mjs';

const check = process.argv.includes('--check');
const lock = buildLock();
const lockText = JSON.stringify(lock, null, 2) + '\n';
const noticesText = renderNotices(lock);

function readOrNull(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

if (check) {
  const problems = [];
  if (readOrNull(LOCK_PATH) !== lockText) problems.push('packages.lock 与实物不一致');
  if (readOrNull(NOTICES_PATH) !== noticesText) problems.push('THIRD-PARTY-NOTICES.md 与 lock 不一致');
  if (problems.length) {
    console.error('[FAIL] ' + problems.join('；'));
    console.error('       运行 npm run lock:gen 重新生成');
    process.exit(1);
  }
  console.log(`[OK] lock 与 NOTICES 均为最新（${lock.summary.packageCount} 个包）`);
  process.exit(0);
}

writeFileSync(LOCK_PATH, lockText, 'utf8');
writeFileSync(NOTICES_PATH, noticesText, 'utf8');
console.log('=== 已生成 packages.lock / THIRD-PARTY-NOTICES.md ===');
console.log(`    ${lock.summary.packageCount} 个包 | ${lock.summary.compiledCount} 个含编译型 .so | ${lock.summary.gpl2OnlyCount} 个纯 GPL-2（冻结）`);
console.log(`    许可证类别：${JSON.stringify(lock.summary.byClass)}`);
console.log(`    含内置 data/ 的包：${lock.summary.dataBearing.length ? lock.summary.dataBearing.join(', ') : '无（产品须自备示例数据）'}`);
if (lock.summary.missingTarball.length) {
  console.warn(`    [WARN] 缺 tarball: ${lock.summary.missingTarball.join(', ')}`);
}
