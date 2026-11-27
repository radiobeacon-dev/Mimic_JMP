/**
 * CI 许可证门禁（路线 A / AGPL-3.0）。
 *
 * 只用 Node 内置模块，无需 npm install、无需外网、跨平台。
 *   node scripts/verify_licenses.mjs               完整模式：需要 local-repo 实物
 *   node scripts/verify_licenses.mjs --lock-only   声明模式：CI checkout 用（预置包二进制不入库）
 *
 * 退出码 0 = 全绿；1 = 任一项失败。结果落 results/license_verify.json。
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  buildLock, renderNotices, parseDcf, scanRuntimeInstallAPIs,
  LOCK_PATH, NOTICES_PATH, LIB_DIR, LICENSE_PATH, SPIKE_ROOT, POLICY,
} from './license_policy.mjs';
import { verifyDeployment, CLA_VERSION } from './cla_policy.mjs';
import { verifyLicenseTexts } from './license_texts.mjs';

const lockOnly = process.argv.includes('--lock-only');
const t0 = Date.now();
const results = {
  gate: 'route-A-license-compliance',
  mode: lockOnly ? 'lock-only' : 'full',
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
};
const checks = results.checks;

function record(name, ok, detail) {
  checks.push({ name, ok, detail: String(detail ?? '') });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/** 返回首个差异路径，相等返回 null。 */
function firstDiff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object')
    return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object 类型不一致`;
  if (Array.isArray(a) && a.length !== b.length) return `${path}: 长度 ${a.length} != ${b.length}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(a, k) || !Object.prototype.hasOwnProperty.call(b, k))
      return `${path}.${k}: 键缺失`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

console.log(`=== 许可证门禁（路线 A / AGPL-3.0）| mode=${results.mode} ===`);

// C1 — lock 存在且可解析
let lock = null;
let parseErr = null;
try { lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')); }
catch (e) { parseErr = String(e?.message || e); }
const c1 = record('C1 packages.lock 存在且可解析', !!lock && !parseErr, parseErr || `${LOCK_PATH}`);

if (!c1) {
  finish();
} else {
  // C2 — lock 版本
  record('C2 lockVersion 与策略一致', lock.lockVersion === POLICY.lockVersion,
    `lock=${lock.lockVersion} / policy=${POLICY.lockVersion}`);

  // C3 — 与实物重建的 lock 完全一致（防止手改 / 忘记重新生成）
  if (lockOnly) {
    const byClass = {};
    for (const p of lock.packages || []) byClass[p.licenseClass] = (byClass[p.licenseClass] || 0) + 1;
    const problems = [];
    if (lock.summary?.packageCount !== (lock.packages || []).length) problems.push('summary.packageCount 不符');
    if (firstDiff(lock.summary?.byClass, byClass)) problems.push('summary.byClass 与 packages 重算不符');
    if (firstDiff(lock.policy?.frozenGpl2Only, POLICY.frozenGpl2Only)) problems.push('policy.frozenGpl2Only 被改动');
    if (firstDiff(lock.policy?.allowedClasses, POLICY.allowedClasses)) problems.push('policy.allowedClasses 被改动');
    // 独立于解析器的格式断言：拦住 DCF 续行污染（例如 Authors@R 被拼进 Version）
    const badVer = (lock.packages || []).filter((p) => !/^[0-9][0-9A-Za-z.\-]*$/.test(p.version || ''));
    if (badVer.length) problems.push(`version 格式异常: ${badVer.map((p) => p.name).join(', ')}`);
    record('C3 lock 内部一致性（lock-only）', problems.length === 0,
      problems.length ? problems.join('；') : `${lock.packages.length} 个包，摘要与策略字段自洽`);
  } else {
    let rebuilt = null;
    let diff = null;
    try { rebuilt = buildLock(); diff = firstDiff(lock, rebuilt); }
    catch (e) { diff = `重建失败: ${String(e?.message || e)}`; }
    record('C3 lock 与实物完全一致', diff === null, diff || `${lock.packages.length} 个包，无漂移`);
  }

  // C4 — library 目录与 lock 包集合一致（仅完整模式）
  if (!lockOnly) {
    const actual = existsSync(LIB_DIR)
      ? readdirSync(LIB_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(join(LIB_DIR, d.name, 'DESCRIPTION')))
          .map((d) => d.name).sort()
      : [];
    const declared = (lock.packages || []).map((p) => p.name).sort();
    const missing = declared.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !declared.includes(n));
    record('C4 library 目录与 lock 包集合一致', missing.length === 0 && extra.length === 0,
      missing.length || extra.length
        ? `lock 多出: ${missing.join(', ') || '无'}；目录多出: ${extra.join(', ') || '无'}`
        : `${actual.length} 个包，双向一致`);
  }

  // C5 — 每个包的 version / license 与随包 DESCRIPTION 一致（仅完整模式）
  if (!lockOnly) {
    const bad = [];
    for (const p of lock.packages || []) {
      const f = join(LIB_DIR, p.name, 'DESCRIPTION');
      if (!existsSync(f)) { bad.push(`${p.name}: 缺 DESCRIPTION`); continue; }
      const d = parseDcf(readFileSync(f, 'utf8'));
      if (d.Version !== p.version) bad.push(`${p.name}: version ${d.Version} != ${p.version}`);
      if (d.License !== p.license) bad.push(`${p.name}: License ${d.License} != ${p.license}`);
    }
    record('C5 版本 / 许可证与随包 DESCRIPTION 一致', bad.length === 0,
      bad.length ? bad.join('；') : `${lock.packages.length} 个包，合规以随包 DESCRIPTION 为准`);
  }

  // C6 — 项目级策略字段
  const policyProblems = [];
  if (lock.projectLicense !== POLICY.projectLicense) policyProblems.push('projectLicense');
  if (lock.policy?.runtimeInstallForbidden !== true) policyProblems.push('runtimeInstallForbidden');
  if (!/aggregate/.test(lock.policy?.distributionModel || '')) policyProblems.push('distributionModel 未声明聚合体');
  if (firstDiff(lock.policy?.frozenGpl2Only, POLICY.frozenGpl2Only)) policyProblems.push('frozenGpl2Only 与策略不符');
  if (firstDiff(lock.policy?.allowedClasses, POLICY.allowedClasses)) policyProblems.push('allowedClasses 与策略不符');
  record('C6 项目许可证 / 聚合体 / 运行时禁令已声明', policyProblems.length === 0,
    policyProblems.length ? `被改动: ${policyProblems.join(', ')}` : `${lock.projectLicense}，运行时零联网装包`);

  // C7 — 逐包许可证策略
  const licBad = [];
  for (const p of lock.packages || []) {
    if (!POLICY.allowedClasses.includes(p.licenseClass))
      licBad.push(`${p.name}: 类别 ${p.licenseClass} 不在白名单`);
    if (p.requiresManualReview)
      licBad.push(`${p.name}: ${p.license} 需人工复核（ambiguous / unknown / 未冻结的纯 GPL-2）`);
    if (p.licenseClass === 'gpl2-only-frozen' && !POLICY.frozenGpl2Only.includes(p.name))
      licBad.push(`${p.name}: 纯 GPL-2 未登记在冻结白名单`);
  }
  for (const n of POLICY.frozenGpl2Only) {
    const p = (lock.packages || []).find((x) => x.name === n);
    if (!p) licBad.push(`${n}: 冻结白名单中的包已不存在（清单陈旧）`);
    else if (p.licenseClass !== 'gpl2-only-frozen')
      licBad.push(`${n}: 已不再是纯 GPL-2，白名单应移除并重新复核`);
  }
  for (const [name, ov] of Object.entries(POLICY.licenseOverrides || {})) {
    const p = (lock.packages || []).find((x) => x.name === name);
    if (!p) { licBad.push(`${name}: 人工复核登记中的包不存在`); continue; }
    if (p.licenseClass !== ov.licenseClass) licBad.push(`${name}: 复核后类别 ${p.licenseClass} != ${ov.licenseClass}`);
    if (!p.licenseOverride?.evidence || !p.licenseOverride?.reviewedAt)
      licBad.push(`${name}: 复核证据 / 日期缺失`);
  }
  const gpl2Count = (lock.packages || []).filter((p) => p.licenseClass === 'gpl2-only-frozen').length;
  record('C7 许可证分类 / 纯 GPL-2 冻结白名单', licBad.length === 0,
    licBad.length ? licBad.join('；') : `${lock.packages.length} 个包，${gpl2Count} 个纯 GPL-2 已冻结，无待复核项`);

  // C8 — tarball 校验和
  if (lockOnly) {
    const bad = (lock.packages || []).filter((p) => !/^[0-9a-f]{64}$/.test(p.sha256 || ''));
    record('C8 tarball sha256 格式（lock-only）', bad.length === 0,
      bad.length ? `缺校验和: ${bad.map((p) => p.name).join(', ')}` : `${lock.packages.length} 个包均有 sha256`);
  } else {
    const bad = [];
    for (const p of lock.packages || []) {
      if (!p.tarball) { bad.push(`${p.name}: 缺 tarball`); continue; }
      const f = join(SPIKE_ROOT, p.tarball);
      if (!existsSync(f)) { bad.push(`${p.name}: ${p.tarball} 不存在`); continue; }
      const actual = createHash('sha256').update(readFileSync(f)).digest('hex');
      if (actual !== p.sha256) bad.push(`${p.name}: sha256 不匹配`);
    }
    record('C8 tarball sha256 实物校验', bad.length === 0,
      bad.length ? bad.join('；') : `${lock.packages.length} 个 tgz 校验和全部匹配`);
  }

  // C9 — NOTICES 与 lock 同步
  const noticesNow = existsSync(NOTICES_PATH) ? readFileSync(NOTICES_PATH, 'utf8') : null;
  const noticesExpected = renderNotices(lock);
  record('C9 THIRD-PARTY-NOTICES 与 lock 同步', noticesNow === noticesExpected,
    noticesNow === null ? '文件缺失' : noticesNow === noticesExpected ? `${Buffer.byteLength(noticesExpected, 'utf8')} 字节，一致` : '文件内容与生成器输出不一致');

  // C10 — 运行时联网装包禁令
  const scan = scanRuntimeInstallAPIs();
  record('C10 运行时联网装包 API 禁令', scan.hits.length === 0,
    scan.hits.length
      ? `${scan.hits.length} 处命中: ${scan.hits.map((h) => `${h.file}:${h.line}`).join(', ')}`
      : `扫描 ${scan.scanned} 个脚本，未发现 installPackages / download.file 等调用`);

  // C11 — 项目 LICENSE 声明 + 三份许可证全文完整性（离线，零外网；两种模式都跑）
  const lic = existsSync(LICENSE_PATH) ? readFileSync(LICENSE_PATH, 'utf8') : '';
  const licTexts = verifyLicenseTexts();
  record('C11 项目 LICENSE 声明与许可证全文完整性',
    /AGPL-3\.0/.test(lic) && /SPDX-License-Identifier/.test(lic) && licTexts.ok,
    licTexts.ok
      ? `${LICENSE_PATH} + licenses/ 3 份逐字全文 sha256 校验通过`
      : licTexts.problems.join('；'));

  // C12 — CLA 部署完整性（路线 A 保留转 Open-core 权利的必要条件）
  // 协议文本、版本、签名表结构与指纹、CONTRIBUTING 引用、PR 门禁 workflow、
  // 以及判定逻辑的内存自测。签名表是入库文本，故 lock-only 模式同样可执行。
  let cla;
  try { cla = verifyDeployment(); }
  catch (e) { cla = { ok: false, problems: [`断言异常: ${String(e?.message || e)}`], selfTest: { passed: 0, total: 0 }, signatureCount: 0 }; }
  record('C12 CLA 部署完整性（协议 / 签名表 / 门禁 / 自测）', cla.ok,
    cla.ok
      ? `CLA v${CLA_VERSION}，${cla.signatureCount} 条签署记录，判定自测 ${cla.selfTest.passed}/${cla.selfTest.total}`
      : cla.problems.join('；'));

  finish();
}

function finish() {
  const failed = checks.filter((c) => !c.ok);
  results.ok = failed.length === 0;
  results.totalMs = Date.now() - t0;
  results.passed = checks.length - failed.length;
  results.total = checks.length;
  mkdirSync(join(SPIKE_ROOT, 'results'), { recursive: true });
  writeFileSync(join(SPIKE_ROOT, 'results', 'license_verify.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n=== license gate: ${results.ok ? 'PASS' : 'FAIL'} | ${results.passed}/${results.total} checks | ${results.totalMs}ms | mode=${results.mode} ===`);
  if (failed.length) for (const f of failed) console.error(`  FAIL: ${f.name} — ${f.detail}`);
  process.exit(results.ok ? 0 : 1);
}
