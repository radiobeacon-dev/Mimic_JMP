/**
 * 许可证全文的下载 / 生成 / 离线校验（路线 A / AGPL-3.0-or-later）。
 *
 * 这是**维护期**工具，不进产品运行时；产品运行时零外网这条红线不变。
 * 三份 GNU 官方逐字文本入库，CI 用 --check 离线校验 sha256，无需联网。
 * 上游文本若发生变化，--check 会失败并要求人工复核后再更新常量，
 * 避免「悄悄换了许可证正文」。
 *
 * 用法：
 *   node spike/scripts/license_texts.mjs --fetch   # 联网重建（维护时手动跑）
 *   node spike/scripts/license_texts.mjs --write   # 离线由 txt 重建 LICENSE / SOURCES.md
 *   node spike/scripts/license_texts.mjs --check   # 离线校验（默认，CI 用）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LICENSES_DIR = join(ROOT, 'licenses');
export const LICENSE_PATH = join(ROOT, 'LICENSE');
export const SOURCES_PATH = join(LICENSES_DIR, 'SOURCES.md');
const RETRIEVED_AT = '2026-11-27';

/** 上游 GNU 官方逐字文本的期望指纹；改动必须人工复核后同步更新。 */
export const LICENSE_TEXTS = [
  {
    id: 'AGPL-3.0', file: 'AGPL-3.0.txt',
    url: 'https://www.gnu.org/licenses/agpl-3.0.txt',
    title: 'GNU AFFERO GENERAL PUBLIC LICENSE',
    sha256: '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
    bytes: 34523,
    why: '项目自有代码许可证；LICENSE 正文即本文件的逐字副本',
  },
  {
    id: 'GPL-3.0', file: 'GPL-3.0.txt',
    url: 'https://www.gnu.org/licenses/gpl-3.0.txt',
    title: 'GNU GENERAL PUBLIC LICENSE',
    sha256: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
    bytes: 35149,
    why: 'GPLv3-or-later 组件，可按 AGPLv3 §13 与自有代码组合',
  },
  {
    id: 'GPL-2.0', file: 'GPL-2.0.txt',
    url: 'https://www.gnu.org/licenses/gpl-2.0.txt',
    title: 'GNU GENERAL PUBLIC LICENSE',
    sha256: 'edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6',
    bytes: 17984,
    why: '7 个纯 GPL-2 独立组件（FSF 判定与 AGPLv3 不兼容，按 mere aggregation 独立分发）',
  },
];

const GPL2_ONLY = ['conf.design', 'combinat', 'sets', 'polynom', 'vcd', 'scatterplot3d', 'rbibutils'];

const LICENSE_HEADER = `mimic-JMP
Copyright (C) 2026 mimic-JMP contributors

SPDX-License-Identifier: AGPL-3.0-or-later

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your
option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see https://www.gnu.org/licenses/.

The complete, verbatim text of the GNU Affero General Public License
version 3 follows below. Full texts of the licenses covering bundled
third-party components (GPLv2 and GPLv3) are in licenses/ —
see licenses/SOURCES.md and spike/THIRD-PARTY-NOTICES.md.

--------------------------------------------------------------------------

`;

function renderSources() {
  const L = [];
  L.push('# 许可证全文来源与校验');
  L.push('');
  L.push(`本项目采用 **AGPL-3.0-or-later**（路线 A）。以下三份文本是 GNU 官方发布的`);
  L.push(`逐字副本，获取于 ${RETRIEVED_AT}，随发行版一同分发。`);
  L.push('');
  L.push('| 许可证 | 文件 | 字节数 | sha256 | 用途 |');
  L.push('|---|---|---:|---|---|');
  for (const t of LICENSE_TEXTS) {
    L.push(`| ${t.id} | \`licenses/${t.file}\` | ${t.bytes} | \`${t.sha256}\` | ${t.why} |`);
  }
  L.push('');
  L.push('上游原文地址：');
  L.push('');
  for (const t of LICENSE_TEXTS) L.push(`- ${t.id}: ${t.url}`);
  L.push('');
  L.push('## 为什么需要三份');
  L.push('');
  L.push('- **AGPL-3.0**：项目自有代码的许可证；根 `LICENSE` 的正文即本文件的逐字副本。');
  L.push('- **GPL-3.0**：`gpl3-or-later` / `gpl2-or-gpl3` 组件，按 AGPLv3 §13 可组合。');
  L.push(`- **GPL-2.0**：以下 ${GPL2_ONLY.length} 个包是纯 GPL-2（无 or-later、无双许可），`);
  L.push('  FSF 明确与 AGPLv3 不兼容：' + GPL2_ONLY.map((n) => `\`${n}\``).join('、') + '。');
  L.push('  它们只能作为**独立运行时组件**分发（标准 R library 目录、由 R 自身动态加载），');
  L.push('  不得静态整合进自有代码；合规依据是 GPLv2 §2 *mere aggregation* 例外。');
  L.push('');
  L.push('## 复跑与校验');
  L.push('');
  L.push('```bash');
  L.push('node spike/scripts/license_texts.mjs --fetch   # 联网重建（维护期，手动）');
  L.push('node spike/scripts/license_texts.mjs --check   # 离线校验（CI，零外网）');
  L.push('```');
  L.push('');
  L.push('`--check` 会校验三个文件的 sha256、标题行、字节数，以及 `LICENSE` 是否包含');
  L.push('逐字 AGPL 全文与 SPDX 声明；结果同时接入 `verify_licenses.mjs` 的 C11 断言。');
  L.push('上游文本一旦变化，校验会失败并阻止静默替换。');
  L.push('');
  L.push('> 本文件是工程合规记录，**不构成法律意见**；正式发布前须由开源合规律师审阅发行包。');
  L.push('');
  return L.join('\n');
}

/** 由已入库的逐字文本重建 LICENSE 与 SOURCES.md。 */
export function writeLicenseFiles() {
  const agpl = readFileSync(join(LICENSES_DIR, 'AGPL-3.0.txt'), 'utf8');
  writeFileSync(LICENSE_PATH, LICENSE_HEADER + agpl, 'utf8');
  writeFileSync(SOURCES_PATH, renderSources(), 'utf8');
}

/** 离线校验：零外网，CI 与本地门禁共用。 */
export function verifyLicenseTexts() {
  const problems = [];
  const texts = new Map();
  for (const t of LICENSE_TEXTS) {
    const p = join(LICENSES_DIR, t.file);
    if (!existsSync(p)) { problems.push(`缺少 licenses/${t.file}`); continue; }
    const buf = readFileSync(p);
    const s = buf.toString('utf8');
    const h = createHash('sha256').update(buf).digest('hex');
    if (h !== t.sha256) problems.push(`${t.file} sha256 不匹配（期望 ${t.sha256.slice(0, 12)}…，实际 ${h.slice(0, 12)}…）`);
    if (!s.includes(t.title)) problems.push(`${t.file} 缺少标题行 ${t.title}`);
    if (buf.length !== t.bytes) problems.push(`${t.file} 字节数 ${buf.length} != ${t.bytes}`);
    texts.set(t.id, s);
  }
  const lic = existsSync(LICENSE_PATH) ? readFileSync(LICENSE_PATH, 'utf8') : '';
  if (!/SPDX-License-Identifier:\s*AGPL-3\.0-or-later/.test(lic)) problems.push('LICENSE 缺少 SPDX-License-Identifier: AGPL-3.0-or-later');
  const agpl = texts.get('AGPL-3.0');
  if (agpl && !lic.includes(agpl)) problems.push('LICENSE 未包含逐字 AGPL-3.0 全文');
  if (!existsSync(SOURCES_PATH)) problems.push('缺少 licenses/SOURCES.md');
  else {
    const src = readFileSync(SOURCES_PATH, 'utf8');
    for (const t of LICENSE_TEXTS)
      if (!src.includes(t.sha256)) problems.push(`SOURCES.md 未登记 ${t.file} 的 sha256`);
  }
  return { ok: problems.length === 0, problems, checked: LICENSE_TEXTS.length };
}

async function fetchAll() {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; mimic-jmp-license-setup/1.0)' };
  mkdirSync(LICENSES_DIR, { recursive: true });
  for (const t of LICENSE_TEXTS) {
    const r = await fetch(t.url, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${t.url}`);
    const text = (await r.text()).replace(/\r\n/g, '\n');
    if (!text.includes(t.title)) throw new Error(`${t.file} 缺少标题行`);
    if (Buffer.byteLength(text, 'utf8') < 15000) throw new Error(`${t.file} 文本异常过短`);
    const h = createHash('sha256').update(text, 'utf8').digest('hex');
    if (h !== t.sha256) throw new Error(`${t.file} 上游文本已变化（${h}），需人工复核后更新常量`);
    writeFileSync(join(LICENSES_DIR, t.file), text, 'utf8');
    console.log(`[fetch] ${t.file} ${Buffer.byteLength(text, 'utf8')} bytes sha256=${h.slice(0, 16)}…`);
  }
  writeLicenseFiles();
  console.log('[write] LICENSE + licenses/SOURCES.md');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2] || '--check';
  try {
    if (arg === '--fetch') { await fetchAll(); }
    else if (arg === '--write') { writeLicenseFiles(); console.log('[write] LICENSE + licenses/SOURCES.md'); }
    const v = verifyLicenseTexts();
    console.log(`[check] ${v.ok ? 'PASS' : 'FAIL'} | ${v.checked} texts | ${v.problems.length} problems`);
    for (const p of v.problems) console.log('  - ' + p);
    if (!v.ok) process.exit(1);
  } catch (e) {
    console.error('ERR ' + (e?.message || e));
    process.exit(1);
  }
}
