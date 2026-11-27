/**
 * 离线签署 CLI —— 生成一条带 CLA 文本指纹的签署记录并写回 .cla/signatures.json。
 *
 *   node scripts/cla_sign.mjs --login alice --name "Alice" \
 *       --email alice@example.com --type individual
 *
 *   node scripts/cla_sign.mjs --login acme --name "Acme Inc." \
 *       --email cla@acme.example --type entity \
 *       --organization "Acme Inc." --authorized-by "Carol" \
 *       --contributors alice,bob --evidence "PR #42"
 *
 * 只使用 Node 内置模块。生成的记录必须随 PR 提交（Git 提交身份即签署凭据），
 * 之后由 .github/workflows/cla.yml 门禁校验。
 *
 * ⚠️ 本脚本只登记「已明确同意 CLA」这一事实。请确认签署人确实阅读并同意
 *    .cla/ICLA.md / .cla/CCLA.md；代他人填写姓名与邮箱属于无效签署。
 */

import {
  CLA_VERSION, SCHEMA_VERSION, SIGNATURES_PATH, AGREEMENT_PATHS,
  SIGNATURE_TYPES, SIGNATURE_METHODS, agreementState, buildSignature,
  validateSignatures, renderSignatureFile, loadSignatureState,
  writeSignatureFile, sortSignatures,
} from './cla_policy.mjs';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const a = parseArgs(argv);
const need = (k) => {
  if (typeof a[k] !== 'string' || !a[k].trim()) { console.error(`缺少必填参数 --${k}`); process.exit(1); }
  return a[k].trim();
};

function fail(msg) { console.error(`签署失败：${msg}`); process.exit(1); }

const state = loadSignatureState();
if (!state.data) fail(`无法读取签名表：${state.problems.join('；')}`);
// 已有非法记录时禁止追加，避免把问题扩散；先修表再签。
if (!state.ok) fail(`当前签名表不合法，请先修复：\n  - ${state.problems.join('\n  - ')}`);

const input = {
  login: need('login'),
  type: need('type'),
  name: need('name'),
  email: need('email'),
  organization: a.organization || null,
  authorizedBy: a['authorized-by'] || a.authorizedBy || null,
  method: a.method || 'offline-file',
  evidence: a.evidence || `local CLA signing (${a.method || 'offline-file'})`,
  contributors: a.contributors ? String(a.contributors).split(',').map((s) => s.trim()).filter(Boolean) : [],
};

if (!SIGNATURE_TYPES.includes(input.type)) fail(`--type 只能是 ${SIGNATURE_TYPES.join(' / ')}`);
if (!SIGNATURE_METHODS.includes(input.method)) fail(`--method 只能是 ${SIGNATURE_METHODS.join(' / ')}`);
if (input.type === 'entity') {
  if (!input.organization) fail('实体签署必须给 --organization');
  if (!input.authorizedBy) fail('实体签署必须给 --authorized-by（有权代表公司签约的人）');
  if (input.organization !== input.name) fail('--organization 必须与 --name（公司法定全称）一致');
} else {
  if (input.organization || input.authorizedBy) fail('个人签署不应带 --organization / --authorized-by');
}

const ag = agreementState();
if (ag[input.type].missing) fail(`缺少协议文本 ${AGREEMENT_PATHS[input.type]}`);
if (ag[input.type].version !== CLA_VERSION) fail(`协议文本版本 ${ag[input.type].version} 与策略 ${CLA_VERSION} 不一致`);
const hashes = { individual: ag.individual.hash, entity: ag.entity.hash };

const existing = state.data.signatures.find((s) => s.login.toLowerCase() === input.login.toLowerCase());
if (existing && !a.replace) {
  fail(`${input.login} 已有签署记录（v${existing.claVersion}, ${existing.signedAt}）。\n` +
    '  CLA 版本升级需要重签时，请显式加 --replace 并在 PR 描述中说明；\n' +
    '  否则请先删除旧记录再运行本脚本。');
}

const signature = buildSignature(input, hashes);
const nextSigs = (a.replace
  ? state.data.signatures.filter((s) => s.login.toLowerCase() !== input.login.toLowerCase())
  : [...state.data.signatures]).concat(signature);
const next = {
  ...state.data,
  schemaVersion: SCHEMA_VERSION,
  claVersion: CLA_VERSION,
  signatures: sortSignatures(nextSigs),
};

// 写盘前先用纯逻辑校验一遍（写盘后还会再读回校验）。
const pre = validateSignatures(next, hashes);
if (!pre.ok) fail(`生成的签名表不合法：\n  - ${pre.problems.join('\n  - ')}`);

writeSignatureFile(next);
const after = loadSignatureState();
if (!after.ok) fail(`写盘后校验失败：\n  - ${after.problems.join('\n  - ')}`);
if (readFileSync(SIGNATURES_PATH, 'utf8') !== renderSignatureFile(after.data))
  fail('写盘后文件不是确定性渲染结果');

console.log(`=== CLA 签署登记完成 | CLA v${CLA_VERSION} ===`);
console.log(`  login       : ${signature.login}`);
console.log(`  type        : ${signature.type}（${signature.type === 'individual' ? 'ICLA' : 'CCLA'}）`);
console.log(`  name        : ${signature.name}`);
console.log(`  email       : ${signature.email}`);
console.log(`  signedAt    : ${signature.signedAt}`);
console.log(`  evidence    : ${signature.evidence}`);
console.log(`  agreementSha256 : ${signature.agreementSha256}`);
console.log(`  当前签署记录总数：${after.data.signatures.length}`);
console.log('');
console.log('下一步：把 .cla/signatures.json 的改动连同你的代码一起提交进 PR。');
console.log('本地自查：node spike/scripts/cla_check.mjs --login ' + signature.login);
