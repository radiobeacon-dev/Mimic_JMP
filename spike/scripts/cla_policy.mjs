/**
 * CLA 部署流程 —— 策略单一事实来源 + 纯逻辑判定。
 *
 * 设计目标：与项目既有的许可证门禁同风格（Node 内置模块、零依赖、零外网、
 * 可离线复跑），签名表全部是仓库内的文本文件，不依赖任何托管数据库。
 *
 * 三个关键不变量：
 *   1. 每条签署记录锁定签署时 CLA 文本的 sha256 —— 防止静默改条款；
 *   2. CLA 版本提升后旧签名对新贡献无效 —— 改版必须走重签流程；
 *   3. 判定逻辑可脱离文件做内存自测 —— 避免「生成/校验共用同一解析器」
 *      互相印证错误（Phase 0 里 DCF 解析已经踩过一次）。
 *
 * 决策依据：docs/DEVELOPMENT_PLAN.md §7.7；协议全文见 .cla/{ICLA,CCLA}.md。
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLA_DIR = join(PROJECT_ROOT, '.cla');
// CI 中脚本与协议文本来自可信的 base checkout，签名表来自 PR checkout，
// 用环境变量指向后者，避免贡献者通过修改脚本 / CLA 文本伪造签署。
export const SIGNATURES_PATH = process.env.CLA_SIGNATURES_FILE
  ? resolve(process.env.CLA_SIGNATURES_FILE)
  : join(CLA_DIR, 'signatures.json');
export const AGREEMENT_PATHS = {
  individual: join(CLA_DIR, 'ICLA.md'),
  entity: join(CLA_DIR, 'CCLA.md'),
};
export const README_PATH = join(CLA_DIR, 'README.md');
export const CONTRIBUTING_PATH = join(PROJECT_ROOT, 'CONTRIBUTING.md');
export const WORKFLOW_PATH = join(PROJECT_ROOT, '.github', 'workflows', 'cla.yml');

/** ⚠️ 升版本时必须同步更新：两份 CLA 文本头部、signatures.json、CONTRIBUTING、文档。 */
export const CLA_VERSION = '1.0';
export const SCHEMA_VERSION = 1;

/**
 * CLA 文本基线指纹（v1.0 定稿时的 sha256）。
 * 作用：堵住「签名表为空 / 无人签署时，偷偷改条款且不升版本」的缺口——
 * 此时没有签署记录可供比对，只能靠基线拦。改文本必须升 CLA Version
 * 并同步更新本常量与 .cla/README.md §4 的升级流程，否则 C12 与 PR 门禁同时失败。
 */
export const AGREEMENT_BASELINE = {
  individual: '8c68b78e14d668a2080b0d66747d39f614594fca8be759e881204ef40174b820',
  entity: 'cf1504942b73c254ce643591a9269320bddb4e381532164b8e57d82b55daa095',
};

export const SIGNATURE_KEYS = [
  'login', 'type', 'name', 'email', 'organization', 'authorizedBy',
  'contributors', 'claVersion', 'signedAt', 'method', 'evidence', 'agreementSha256',
];
export const REQUIRED_SIGNATURE_KEYS = SIGNATURE_KEYS.filter((k) => k !== 'contributors');
export const TOP_LEVEL_KEYS = ['schemaVersion', 'claVersion', 'signatures', 'bots'];
export const SIGNATURE_TYPES = ['individual', 'entity'];
export const SIGNATURE_METHODS = ['offline-file', 'pr-comment', 'manual'];

const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function sha256(textOrBuffer) {
  return createHash('sha256').update(textOrBuffer).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

/** 从 CLA 文本头部提取 `> **CLA Version: 1.0**`。 */
export function readAgreementVersion(text) {
  const m = text.match(/CLA Version:\s*\*?\*?\s*([0-9]+(?:\.[0-9]+)*)/);
  return m ? m[1] : null;
}

/** 当前仓库中两份 CLA 文本的真实指纹与版本号。 */
export function agreementState() {
  const state = {};
  for (const [type, path] of Object.entries(AGREEMENT_PATHS)) {
    if (!existsSync(path)) { state[type] = { missing: true, hash: null, version: null }; continue; }
    const text = readFileSync(path, 'utf8');
    state[type] = { missing: false, hash: sha256(text), version: readAgreementVersion(text), path };
  }
  return state;
}

/**
 * 纯逻辑：校验签名表结构与指纹，不读文件、不产生副作用。
 * @param {object} data 签名表对象
 * @param {{individual:string, entity:string}} hashes 当前 CLA 文本 sha256
 * @param {{claVersion?:string, now?:number}} opts
 */
export function validateSignatures(data, hashes, opts = {}) {
  const claVersion = opts.claVersion ?? CLA_VERSION;
  const now = opts.now ?? Date.now();
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, problems: ['签名表不是对象'] };
  }

  const topKeys = Object.keys(data);
  for (const k of topKeys) if (!TOP_LEVEL_KEYS.includes(k)) problems.push(`顶层未知字段: ${k}`);
  for (const k of TOP_LEVEL_KEYS) if (!(k in data)) problems.push(`顶层缺字段: ${k}`);
  if (data.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion 应为 ${SCHEMA_VERSION}`);
  if (data.claVersion !== claVersion) problems.push(`claVersion ${data.claVersion} != 策略 ${claVersion}`);
  if (!Array.isArray(data.signatures)) problems.push('signatures 不是数组');
  if (!Array.isArray(data.bots)) problems.push('bots 不是数组');

  const bots = Array.isArray(data.bots) ? data.bots : [];
  for (const b of bots) {
    if (typeof b !== 'string' || !LOGIN_RE.test(b)) problems.push(`bot 登录名非法: ${JSON.stringify(b)}`);
    else if (!/\[bot\]$/.test(b)) problems.push(`bots 只能放自动化账号（需以 [bot] 结尾）: ${b}`);
  }
  if (new Set(bots.map((b) => String(b).toLowerCase())).size !== bots.length)
    problems.push('bots 存在重复项');

  const seen = new Set();
  const logins = [];
  const sigs = Array.isArray(data.signatures) ? data.signatures : [];
  sigs.forEach((s, i) => {
    const at = `signatures[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { problems.push(`${at} 不是对象`); return; }
    for (const k of Object.keys(s)) if (!SIGNATURE_KEYS.includes(k)) problems.push(`${at} 未知字段: ${k}`);
    for (const k of REQUIRED_SIGNATURE_KEYS) if (!(k in s)) problems.push(`${at} 缺字段: ${k}`);

    if (typeof s.login !== 'string' || !LOGIN_RE.test(s.login)) problems.push(`${at}.login 非法`);
    else {
      const key = s.login.toLowerCase();
      if (seen.has(key)) problems.push(`${at}.login 重复: ${s.login}`);
      seen.add(key);
      logins.push(s.login);
      if (bots.some((b) => String(b).toLowerCase() === key)) problems.push(`${at}.login 与 bots 冲突: ${s.login}`);
    }
    if (!SIGNATURE_TYPES.includes(s.type)) problems.push(`${at}.type 必须是 individual/entity`);
    if (typeof s.name !== 'string' || !s.name.trim()) problems.push(`${at}.name 不能为空`);
    if (typeof s.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) problems.push(`${at}.email 非法`);
    if (!SIGNATURE_METHODS.includes(s.method)) problems.push(`${at}.method 非法`);
    if (typeof s.evidence !== 'string' || !s.evidence.trim()) problems.push(`${at}.evidence 不能为空`);
    if (typeof s.claVersion !== 'string' || s.claVersion !== claVersion)
      problems.push(`${at}.claVersion ${s.claVersion} != ${claVersion}`);
    if (typeof s.signedAt !== 'string' || !ISO_RE.test(s.signedAt) || Number.isNaN(Date.parse(s.signedAt)))
      problems.push(`${at}.signedAt 必须是 ISO 8601 UTC`);
    else if (Date.parse(s.signedAt) > now + 5 * 60 * 1000) problems.push(`${at}.signedAt 是未来时间`);
    if (typeof s.agreementSha256 !== 'string' || !SHA_RE.test(s.agreementSha256))
      problems.push(`${at}.agreementSha256 必须是 64 位小写 sha256`);
    else if (s.type === 'individual' || s.type === 'entity') {
      const expected = hashes?.[s.type];
      if (expected && s.agreementSha256 !== expected)
        problems.push(`${at}.agreementSha256 与当前 ${s.type === 'individual' ? 'ICLA' : 'CCLA'} 文本不符（疑似静默改条款或需重签）`);
    }

    if (s.type === 'entity') {
      if (typeof s.organization !== 'string' || !s.organization.trim()) problems.push(`${at}.organization 实体签署必填`);
      else if (s.organization !== s.name) problems.push(`${at}.organization 必须与 name 一致`);
      if (typeof s.authorizedBy !== 'string' || !s.authorizedBy.trim()) problems.push(`${at}.authorizedBy 实体签署必填`);
    } else if (s.type === 'individual') {
      if (s.organization !== null && s.organization !== undefined) problems.push(`${at}.organization 个人签署必须为 null`);
      if (s.authorizedBy !== null && s.authorizedBy !== undefined) problems.push(`${at}.authorizedBy 个人签署必须为 null`);
    }
    if ('contributors' in s) {
      if (!Array.isArray(s.contributors)) problems.push(`${at}.contributors 必须是数组`);
      else for (const c of s.contributors)
        if (typeof c !== 'string' || !LOGIN_RE.test(c)) problems.push(`${at}.contributors 含非法登录名: ${JSON.stringify(c)}`);
    }
  });

  const sorted = [...logins].sort((a, b) => a.localeCompare(b, 'en'));
  if (firstDifference(logins, sorted)) problems.push('signatures 必须按 login 字典序排列');

  return { ok: problems.length === 0, problems };
}

function firstDifference(a, b) {
  if (a.length !== b.length) return true;
  return a.some((v, i) => v !== b[i]);
}

/**
 * 纯逻辑：判定某个 GitHub 登录名是否已有效签署。
 * @returns {{ok:boolean, signed:boolean, reason:string, signature:object|null}}
 */
export function checkContributor(login, data, hashes, opts = {}) {
  const claVersion = opts.claVersion ?? CLA_VERSION;
  if (typeof login !== 'string' || !LOGIN_RE.test(login.trim()))
    return { ok: false, signed: false, reason: '登录名非法', signature: null };
  const key = login.trim().toLowerCase();
  if ((data?.bots || []).some((b) => String(b).toLowerCase() === key))
    return { ok: true, signed: true, reason: 'bot-exempt（自动化账号豁免）', signature: null };
  const sig = (data?.signatures || []).find((s) => s?.login?.toLowerCase() === key);
  if (!sig) return { ok: false, signed: false, reason: 'unsigned（未签署 CLA）', signature: null };
  if (sig.claVersion !== claVersion)
    return { ok: false, signed: false, reason: `outdated（签署的是 CLA v${sig.claVersion}，当前 v${claVersion}，需重签）`, signature: sig };
  const expected = hashes?.[sig.type];
  if (expected && sig.agreementSha256 !== expected)
    return { ok: false, signed: false, reason: 'agreement-mismatch（CLA 文本指纹与签署时不一致，疑似静默改条款）', signature: sig };
  return { ok: true, signed: true, reason: `${sig.type} @ CLA v${sig.claVersion}`, signature: sig };
}

/** 确定性渲染签名表（2 空格缩进 + 尾换行），便于 diff 与 CI 比对。 */
export function renderSignatureFile(data) {
  const ordered = {
    schemaVersion: data.schemaVersion,
    claVersion: data.claVersion,
    signatures: (data.signatures || []).map((s) => {
      const row = {};
      for (const k of SIGNATURE_KEYS) if (k in s) row[k] = s[k];
      return row;
    }),
    bots: data.bots || [],
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** 生成一条签署记录（供 cla_sign.mjs 使用）。 */
export function buildSignature(input, hashes) {
  const s = {
    login: input.login,
    type: input.type,
    name: input.name,
    email: input.email,
    organization: input.type === 'entity' ? input.organization : null,
    authorizedBy: input.type === 'entity' ? input.authorizedBy : null,
    claVersion: CLA_VERSION,
    signedAt: new Date().toISOString(),
    method: input.method || 'offline-file',
    evidence: input.evidence || 'local CLA signing (offline-file)',
    agreementSha256: hashes[input.type],
  };
  if (input.contributors?.length) s.contributors = input.contributors;
  return s;
}

/** 读取真实签名表 + 当前 CLA 指纹，返回校验结果。 */
export function loadSignatureState() {
  if (!existsSync(SIGNATURES_PATH)) return { ok: false, problems: [`缺少 ${SIGNATURES_PATH}`], data: null, hashes: null };
  let data = null;
  try { data = JSON.parse(readFileSync(SIGNATURES_PATH, 'utf8')); }
  catch (e) { return { ok: false, problems: [`signatures.json 无法解析: ${e.message}`], data: null, hashes: null }; }
  const ag = agreementState();
  const hashes = { individual: ag.individual.hash, entity: ag.entity.hash };
  const result = validateSignatures(data, hashes);
  const problems = [...result.problems];
  for (const type of SIGNATURE_TYPES) {
    if (ag[type].missing) problems.push(`缺少 ${AGREEMENT_PATHS[type]}`);
    else if (ag[type].version !== CLA_VERSION) problems.push(`${type === 'individual' ? 'ICLA' : 'CCLA'} 版本号 ${ag[type].version} != 策略 ${CLA_VERSION}`);
  }
  return { ok: problems.length === 0, problems, data, hashes, agreements: ag };
}

/** 按 login 字典序排序（签名表要求有序，便于 diff 与审计）。 */
export function sortSignatures(signatures) {
  return [...signatures].sort((a, b) => String(a.login).localeCompare(String(b.login), 'en'));
}

/** 写回签名表（已排序、确定性渲染）。 */
export function writeSignatureFile(data) {
  const next = { ...data, signatures: sortSignatures(data.signatures) };
  writeFileSync(SIGNATURES_PATH, renderSignatureFile(next), 'utf8');
  return next;
}

/**
 * 部署完整性：文件齐全、版本一致、文档引用、签名表合法、判定逻辑自测通过。
 * 供 verify_licenses.mjs 的 C12 使用。
 */
export function verifyDeployment() {
  const problems = [];
  for (const [label, path] of Object.entries({
    ICLA: AGREEMENT_PATHS.individual, CCLA: AGREEMENT_PATHS.entity,
    'signatures.json': SIGNATURES_PATH, '.cla/README.md': README_PATH,
    'CONTRIBUTING.md': CONTRIBUTING_PATH, 'cla.yml': WORKFLOW_PATH,
  })) if (!existsSync(path)) problems.push(`${label} 缺失`);

  const ag = agreementState();
  for (const type of SIGNATURE_TYPES) {
    if (ag[type].missing) continue;
    if (ag[type].version !== CLA_VERSION)
      problems.push(`${type} 的 CLA Version ${ag[type].version} != ${CLA_VERSION}`);
    if (ag[type].hash !== AGREEMENT_BASELINE[type])
      problems.push(`${type === 'individual' ? 'ICLA' : 'CCLA'} 文本与基线指纹不符（改条款必须升 CLA Version 并同步更新 AGREEMENT_BASELINE）`);
  }

  if (existsSync(CONTRIBUTING_PATH)) {
    const c = readFileSync(CONTRIBUTING_PATH, 'utf8');
    for (const token of ['ICLA.md', 'CCLA.md', 'cla_sign.mjs'])
      if (!c.includes(token)) problems.push(`CONTRIBUTING.md 未引用 ${token}`);
  }
  if (existsSync(WORKFLOW_PATH)) {
    // 先剔除注释行：说明文字里会提到 pull_request_target，不能被当成实际配置。
    const code = readFileSync(WORKFLOW_PATH, 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
    // 安全边界固化成断言，防止后人图方便改成不安全的写法。
    for (const token of ['pull_request', 'cla_check.mjs', 'permissions', 'CLA_SIGNATURES_FILE', 'contents: read'])
      if (!code.includes(token)) problems.push(`cla.yml 缺少 ${token}`);
    if (code.includes('pull_request_target'))
      problems.push('cla.yml 不得使用 pull_request_target（会把 secrets 暴露给 fork PR）');
    if (/secrets\./.test(code)) problems.push('cla.yml 不得引用 secrets');
  }
  const state = loadSignatureState();
  problems.push(...state.problems);
  const st = selfTest();
  if (!st.ok) problems.push(`判定逻辑自测失败: ${st.failed} 项`);
  return { ok: problems.length === 0, problems, selfTest: st, signatureCount: state.data?.signatures?.length ?? 0 };
}

/**
 * 内存自测：不读写任何文件，用固定假指纹覆盖正常/异常场景。
 * 目的之一是防止「生成与校验共用同一段逻辑」时互相印证错误。
 */
export function selfTest() {
  const H = {
    individual: 'a'.repeat(64),
    entity: 'b'.repeat(64),
  };
  const base = (over = {}) => ({
    login: 'alice', type: 'individual', name: 'Alice', email: 'alice@example.com',
    organization: null, authorizedBy: null, claVersion: CLA_VERSION,
    signedAt: '2026-11-26T10:00:00Z', method: 'offline-file',
    evidence: 'PR #1', agreementSha256: H.individual, ...over,
  });
  const data = (sigs, bots = ['dependabot[bot]']) => ({ schemaVersion: SCHEMA_VERSION, claVersion: CLA_VERSION, signatures: sigs, bots });
  const checks = [];
  const t = (name, cond) => checks.push({ name, ok: !!cond });
  const now = Date.parse('2026-11-26T12:00:00Z');

  t('空签名表格式合法', validateSignatures(data([]), H, { now }).ok);
  t('未签署登录名 -> unsigned', !checkContributor('nobody', data([]), H).signed);
  t('有效个人签署 -> signed', checkContributor('alice', data([base()]), H).signed);
  t('登录名大小写归一化', checkContributor('ALICE', data([base()]), H).signed);
  t('bot 账号豁免', checkContributor('dependabot[bot]', data([]), H).reason.startsWith('bot-exempt'));
  t('有效实体签署 -> signed', checkContributor('acme', data([base({
    login: 'acme', type: 'entity', name: 'Acme Inc.', organization: 'Acme Inc.',
    authorizedBy: 'Carol', agreementSha256: H.entity, contributors: ['alice', 'bob'],
  })]), H).signed);
  t('缺 email -> 校验失败', !validateSignatures(data([base({ email: undefined })]), H, { now }).ok);
  t('重复 login -> 校验失败', !validateSignatures(data([base(), base()]), H, { now }).ok);
  t('实体缺 authorizedBy -> 校验失败', !validateSignatures(data([base({
    type: 'entity', name: 'Acme', organization: 'Acme', agreementSha256: H.entity,
  })]), H, { now }).ok);
  t('未知字段 -> 校验失败', !validateSignatures(data([base({ extra: 1 })]), H, { now }).ok);
  t('未来签署时间 -> 校验失败', !validateSignatures(data([base({ signedAt: '2099-01-01T00:00:00Z' })]), H, { now }).ok);
  t('未排序 -> 校验失败', !validateSignatures(data([base({ login: 'zoe' }), base({ login: 'alice' })]), H, { now }).ok);
  t('bots 混入真人 -> 校验失败', !validateSignatures(data([], ['real-human']), H, { now }).ok);
  t('CLA 文本指纹变化 -> agreement-mismatch',
    checkContributor('alice', data([base()]), { ...H, individual: 'c'.repeat(64) }).reason.startsWith('agreement-mismatch'));
  t('旧 CLA 版本 -> outdated',
    checkContributor('alice', data([base({ claVersion: '0.9' })]), H, { claVersion: '1.1' }).reason.startsWith('outdated'));
  t('渲染结果确定性', renderSignatureFile(data([base()])) === renderSignatureFile(data([base()])));
  t('渲染包含尾换行', renderSignatureFile(data([])).endsWith('\n'));

  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
}
