/**
 * 路线 A（AGPL-3.0）许可证策略 —— 单一事实来源。
 *
 * gen_packages_lock.mjs / verify_licenses.mjs / CI 都只依赖本文件，
 * 避免「生成用的策略」与「校验用的策略」漂移。
 *
 * 决策依据：docs/DEVELOPMENT_PLAN.md §7 / §7.5.1
 *   - 项目自有代码 AGPL-3.0-or-later，先部署 CLA 保留转 Open-core 的权利
 *   - 预置 WASM R 包作为「聚合体」独立组件分发（NODEFS 挂载，不静态链接）
 *   - FSF：AGPLv3 与 GPLv2 不兼容，仅与 GPLv3 可按 §13 组合
 *   - 因此纯 GPL-2 包必须冻结白名单，新增需人工合规复核
 *   - 运行时禁止联网安装 R 包（R11）
 *
 * 本文件只使用 Node 内置模块，无需 npm install、无需外网。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = join(SPIKE_ROOT, '..');
export const LIB_DIR = join(SPIKE_ROOT, 'local-repo', 'library');
export const TGZ_DIR = join(SPIKE_ROOT, 'local-repo', 'tgz');
export const SCRIPTS_DIR = join(SPIKE_ROOT, 'scripts');
export const LOCK_PATH = join(SPIKE_ROOT, 'packages.lock');
export const NOTICES_PATH = join(SPIKE_ROOT, 'THIRD-PARTY-NOTICES.md');
export const LICENSE_PATH = join(PROJECT_ROOT, 'LICENSE');

export const REMOTE_REPO = 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6';

export const POLICY = {
  projectLicense: 'AGPL-3.0-or-later',
  lockVersion: 1,
  runtimeInstallForbidden: true,
  distributionModel: 'aggregate: independent R library dirs mounted via NODEFS, never statically linked',
  allowedClasses: [
    'gpl2-or-later', 'gpl3-or-later', 'gpl2-or-gpl3', 'lgpl',
    'mit', 'bsd', 'apache-2.0', 'mpl-2.0', 'gpl2-only-frozen',
  ],
  // 纯 GPL-2（无 or-later / 双许可）：FSF 明确与 AGPLv3 不兼容。
  // 已按「聚合体 / 独立组件」人工复核并冻结；新增任何一个必须先人工复核并显式加入。
  frozenGpl2Only: [
    'conf.design', 'combinat', 'sets', 'polynom',
    'vcd', 'scatterplot3d', 'rbibutils',
  ],
  // 许可证写法含糊（如只写 "GPL"），必须人工确认版本后才能进 lock
  ambiguousLicenses: ['GPL'],
  // 人工复核登记：随包 DESCRIPTION 用了简写，经上游权威页面核实后的正式许可证。
  // 新增条目必须附 evidence 与 reviewedAt；CI 会断言证据完整、原字段仍是含糊写法，
  // 且复核后的类别必须与此处一致。禁止靠放宽 ambiguousLicenses 来绕过门禁。
  licenseOverrides: {
    partitions: {
      resolvedLicense: 'GPL-2 | GPL-3',
      licenseClass: 'gpl2-or-gpl3',
      evidence: 'CRAN https://cran.r-project.org/package=partitions 显示 "GPL-2 | GPL-3 [expanded from: GPL]"：DESCRIPTION 中的 GPL 是双许可简写，可选 GPLv3，与 AGPLv3 兼容',
      reviewedAt: '2026-11-26',
    },
  },
  // 运行时禁止出现的联网装包 API（正则源字符串）
  forbiddenRuntimeAPIs: [
    'installPackages\\s*\\(',
    '\\binstall\\.packages\\s*\\(',
    '\\bdownload\\.file\\s*\\(',
    'webr::install\\s*\\(',
    '\\binstall_packages\\s*\\(',
  ],
  // 扫描豁免：① 策略/校验脚本自身持有被检测的模式；② S2 失败路线的历史诊断脚本
  // （仅用于复现 2026-11 的联网装包失败，不进产品构建 / 运行时）
  runtimeInstallScanExempt: [
    'license_policy.mjs', 'verify_licenses.mjs', 'gen_packages_lock.mjs',
    's2_offline.mjs', 's2_doe_chain.mjs', 's2_diag.mjs',
    's2_retry_frf2.mjs', 's2_final.mjs', 'probe_repo.mjs',
    'probe_igraph.mjs', 'probe_nodefs.mjs', 'probe_doe_api.mjs',
    'probe_s4_s6_api.mjs', 'probe_s4_detail.mjs',
    'probe_s6_detail.mjs', 'local-repo-server.mjs',
  ],
};

/** 解析 R 的 DCF（Debian Control File）格式，支持续行。 */
export function parseDcf(text) {
  const out = {};
  let key = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s+/.test(line) && key && line.trim()) {
      out[key] += ' ' + line.trim();
      continue;
    }
    // 字段名允许 @（R 的 Authors@R 等字段），否则该行会被误判为上一字段的续行
    const m = line.match(/^([A-Za-z][A-Za-z0-9._@/-]*):\s*(.*)$/);
    if (m) { key = m[1]; out[key] = m[2]; continue; }
    if (!line.trim()) key = null;
  }
  return out;
}

/** 去掉 " + file LICENSE" / " | file LICENCE" 之类的附加说明。 */
function normalizeLicense(raw) {
  return String(raw || '')
    .replace(/\s*\|\s*file\s+\S+.*$/i, '')
    .replace(/\s*\+\s*file\s+\S+.*$/i, '')
    .trim();
}

/** 把 DESCRIPTION 的 License 字段归入策略类别。 */
export function classifyLicense(raw) {
  const s = normalizeLicense(raw);
  if (!s) return { cls: 'unknown', normalized: s, reason: 'License 字段为空' };
  if (/^MIT\b/i.test(s)) return { cls: 'mit', normalized: s, reason: '宽松许可证' };
  if (/BSD[_ -]?[23][_ -]?[Cc]lause|^BSD\b/i.test(s)) return { cls: 'bsd', normalized: s, reason: '宽松许可证' };
  if (/Apache-?2\.0/i.test(s)) return { cls: 'apache-2.0', normalized: s, reason: '宽松许可证' };
  if (/MPL-?2/i.test(s)) return { cls: 'mpl-2.0', normalized: s, reason: '文件级弱 copyleft' };
  if (/^LGPL/i.test(s)) return { cls: 'lgpl', normalized: s, reason: '弱 copyleft，动态链接可用' };
  if (/^GPL\s*\(>=\s*3\)/i.test(s) || /^GPL-3(\s|$)/i.test(s))
    return { cls: 'gpl3-or-later', normalized: s, reason: '与 AGPLv3 可按 §13 组合' };
  if (/^GPL\s*\(>=\s*2\)/i.test(s))
    return { cls: 'gpl2-or-later', normalized: s, reason: '可升级到 GPLv3，与 AGPLv3 组合' };
  if (/^GPL-2\s*\|\s*GPL-3$/i.test(s))
    return { cls: 'gpl2-or-gpl3', normalized: s, reason: '双许可，可选 GPLv3' };
  if (/^GPL-2\b/i.test(s))
    return { cls: 'gpl2-only', normalized: s, reason: '纯 GPL-2，FSF 判定与 AGPLv3 不兼容' };
  if (POLICY.ambiguousLicenses.includes(s))
    return { cls: 'ambiguous', normalized: s, reason: '未注明版本，需人工确认' };
  return { cls: 'unknown', normalized: s, reason: '未登记的许可证写法' };
}

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function hasFilesRecursively(dir, predicate) {
  if (!existsSync(dir)) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (hasFilesRecursively(p, predicate)) return true; }
    else if (predicate(e.name)) return true;
  }
  return false;
}

/** 从 local-repo 的实物文件重建 lock 对象（确定性，不含时间戳，便于 diff）。 */
export function buildLock() {
  if (!existsSync(LIB_DIR)) throw new Error(`缺少预置 library 目录: ${LIB_DIR}`);
  const tgzFiles = existsSync(TGZ_DIR)
    ? readdirSync(TGZ_DIR).filter((f) => f.endsWith('.tgz'))
    : [];
  const dirs = readdirSync(LIB_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(LIB_DIR, d.name, 'DESCRIPTION')))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const packages = dirs.map((name) => {
    const d = parseDcf(readFileSync(join(LIB_DIR, name, 'DESCRIPTION'), 'utf8'));
    const version = d.Version || '';
    const license = d.License || '';
    const { cls, normalized, reason } = classifyLicense(license);
    const tgz = tgzFiles.find((f) => f === `${name}_${version}.tgz`)
      || tgzFiles.find((f) => f.startsWith(`${name}_`));
    const tgzPath = tgz ? join(TGZ_DIR, tgz) : null;
    const buf = tgzPath && existsSync(tgzPath) ? readFileSync(tgzPath) : null;
    const hasSharedLib = hasFilesRecursively(join(LIB_DIR, name, 'libs'), (f) => f.endsWith('.so'));
    const hasData = hasFilesRecursively(join(LIB_DIR, name, 'data'), () => true);
    const gpl2Frozen = POLICY.frozenGpl2Only.includes(name);
    const override = POLICY.licenseOverrides[name];
    let licenseClass = cls === 'gpl2-only' && gpl2Frozen ? 'gpl2-only-frozen' : cls;
    let licenseNormalized = normalized;
    let licenseReason = reason;
    if (override) {
      licenseClass = override.licenseClass;
      licenseNormalized = override.resolvedLicense;
      licenseReason = `已人工复核并登记：${override.evidence}`;
    }
    return {
      name,
      version,
      license,
      licenseNormalized,
      licenseClass,
      licenseReason,
      requiresManualReview:
        !override && ((cls === 'gpl2-only' && !gpl2Frozen) || cls === 'ambiguous' || cls === 'unknown'),
      licenseOverride: override
        ? {
            resolvedLicense: override.resolvedLicense,
            evidence: override.evidence,
            reviewedAt: override.reviewedAt,
          }
        : null,
      sourceUrl: tgz ? `${REMOTE_REPO}/${tgz}` : null,
      cranUrl: `https://cran.r-project.org/package=${name}`,
      tarball: tgz ? `local-repo/tgz/${tgz}` : null,
      sha256: buf ? sha256(buf) : null,
      bytes: buf ? buf.length : null,
      compiled: hasSharedLib,
      needsCompilation: d.NeedsCompilation === 'yes',
      hasSharedLib,
      hasData,
      notes: '',
    };
  });

  const byClass = {};
  for (const p of packages) byClass[p.licenseClass] = (byClass[p.licenseClass] || 0) + 1;
  return {
    lockVersion: POLICY.lockVersion,
    generatedBy: 'scripts/gen_packages_lock.mjs',
    projectLicense: POLICY.projectLicense,
    policy: {
      runtimeInstallForbidden: POLICY.runtimeInstallForbidden,
      distributionModel: POLICY.distributionModel,
      remoteRepo: REMOTE_REPO,
      rVersion: '4.6',
      wasmTarget: 'wasm32-unknown-emscripten',
      allowedClasses: POLICY.allowedClasses,
      frozenGpl2Only: POLICY.frozenGpl2Only,
      runtimeInstallScanExempt: POLICY.runtimeInstallScanExempt,
    },
    summary: {
      packageCount: packages.length,
      byClass,
      gpl2OnlyCount: packages.filter((p) => p.licenseClass === 'gpl2-only-frozen').length,
      compiledCount: packages.filter((p) => p.compiled).length,
      missingTarball: packages.filter((p) => !p.tarball).map((p) => p.name),
      // R12：预置 WASM 包可能裁剪内置数据集，产品须自备示例数据
      dataBearing: packages.filter((p) => p.hasData).map((p) => p.name),
      withoutDataCount: packages.filter((p) => !p.hasData).length,
    },
    packages,
  };
}

/** 由 lock 确定性地渲染 THIRD-PARTY-NOTICES（不含时间戳，便于 CI 比对）。 */
export function renderNotices(lock) {
  const L = [];
  L.push('# THIRD-PARTY-NOTICES');
  L.push('');
  L.push('> 本文件由 `scripts/gen_packages_lock.mjs` 从 `packages.lock` 自动生成，**请勿手改**。');
  L.push('> 改动预置包后运行 `npm run lock:gen` 重新生成；CI 会断言两者一致。');
  L.push('');
  L.push(`项目自有代码采用 **${lock.projectLicense}**。以下第三方组件随安装包分发，`);
  L.push('全部作为**独立运行时组件**（标准 R library 目录，运行时由 webR NODEFS 挂载、');
  L.push('由 R 自身 `library()` 动态加载）分发，**未与自有代码静态整合**。');
  L.push('按 GPLv2 §2 *mere aggregation* 例外与 FSF FAQ「安装到同一系统不等于合成一个程序」，');
  L.push('各组件分别遵守其各自许可证。');
  L.push('');
  L.push(`分发通道：${lock.policy.remoteRepo}（R ${lock.policy.rVersion} / ${lock.policy.wasmTarget}）；`);
  L.push('运行时禁止联网安装 R 包。完整对应源码（含本项目自有代码与 WASM 包构建脚本）');
  L.push('随发行版同址提供。');
  L.push('');

  const groups = [
    ['强 copyleft（GPL 系，与 AGPLv3 可组合）',
      (p) => p.licenseClass.startsWith('gpl') && p.licenseClass !== 'gpl2-only-frozen'],
    ['纯 GPL-2（与 AGPLv3 严格不兼容，已人工复核并冻结）',
      (p) => p.licenseClass === 'gpl2-only-frozen'],
    ['宽松 / 弱 copyleft 许可证',
      (p) => !p.licenseClass.startsWith('gpl')],
  ];
  for (const [title, test] of groups) {
    const items = lock.packages.filter(test);
    if (!items.length) continue;
    L.push(`## ${title}`);
    L.push('');
    L.push(`共 ${items.length} 个组件。`);
    L.push('');
    for (const p of items) {
      const sum = p.sha256 ? ` · sha256 \`${p.sha256}\`` : ' · **缺少 tarball 校验和**';
      L.push(`- **${p.name}** v${p.version} — \`${p.license}\` → \`${p.licenseClass}\``);
      L.push(`  - 上游源码：${p.cranUrl}；构建产物：${p.tarball || '（缺失）'}${sum}`);
      L.push(`  - 判定：${p.licenseReason}${p.hasSharedLib ? '；含编译型 .so' : ''}`);
    }
    L.push('');
  }
  L.push('## 数据集裁剪提示（R12）');
  L.push('');
  L.push(`随包分发的 WASM R 包中有 ${lock.summary.withoutDataCount} 个不含 \`data/\` 目录，`);
  L.push(`含内置数据集的仅 ${lock.summary.dataBearing.length} 个。产品必须自备示例数据，`);
  L.push('不得假定预置包带有上游内置数据集（例如 qcc 2.7 的 WASM 构建无 `pistonrings`）。');
  L.push('');
  const overrides = lock.packages.filter((p) => p.licenseOverride);
  if (overrides.length) {
    L.push('## 人工复核登记（简写许可证）');
    L.push('');
    L.push('以下包的随包 `DESCRIPTION` 使用了未注明版本的简写，CI 默认会阻断；');
    L.push('经上游权威页面核实后按下表登记，证据与复核日期同时写入 `packages.lock`：');
    L.push('');
    for (const p of overrides) {
      L.push(`- **${p.name}**：\`${p.license}\` → \`${p.licenseOverride.resolvedLicense}\`（\`${p.licenseClass}\`），复核于 ${p.licenseOverride.reviewedAt}`);
      L.push(`  - 证据：${p.licenseOverride.evidence}`);
    }
    L.push('');
  }
  L.push('## 特别提示：纯 GPL-2 组件');
  L.push('');
  L.push(`以下 ${lock.policy.frozenGpl2Only.length} 个包是纯 GPL-2（无 or-later、无双许可），FSF 明确与 AGPLv3 不兼容：`);
  L.push('');
  L.push(lock.policy.frozenGpl2Only.map((n) => `\`${n}\``).join('、') + '。');
  L.push('');
  L.push('它们**只能作为独立组件分发**，不得静态整合进自有代码；新增任何纯 GPL-2 包都会触发 CI 失败，');
  L.push('必须先做人工合规复核并显式加入 `packages.lock` 的 `policy.frozenGpl2Only`。');
  L.push('');
  L.push('## 免责声明');
  L.push('');
  L.push('本清单基于 FSF 官方 FAQ / 许可证列表与随包 `DESCRIPTION`，**不构成法律意见**；');
  L.push('正式发布前须由开源合规律师审阅，并附 AGPL-3.0 与 GPL 各版本许可证全文。');
  L.push('');
  return L.join('\n');
}

/** 扫描 scripts/*.mjs 是否出现运行时联网装包 API。 */
export function scanRuntimeInstallAPIs() {
  const patterns = POLICY.forbiddenRuntimeAPIs.map((s) => new RegExp(s));
  const hits = [];
  const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'));
  const exempt = POLICY.runtimeInstallScanExempt;
  for (const file of files) {
    if (exempt.includes(file)) continue;
    const text = readFileSync(join(SCRIPTS_DIR, file), 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      for (const re of patterns) {
        if (re.test(line)) { hits.push({ file, line: i + 1, text: line.trim() }); break; }
      }
    });
  }
  return { scanned: files.filter((f) => !exempt.includes(f)).length, hits };
}
