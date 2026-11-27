/**
 * CLA 门禁 CLI —— 只使用 Node 内置模块，零依赖、零外网、跨平台。
 *
 *   node scripts/cla_check.mjs --login <github-login>   判定某登录名是否已有效签署（PR 门禁入口）
 *   node scripts/cla_check.mjs --validate               校验签名表格式、版本与 CLA 文本指纹
 *   node scripts/cla_check.mjs --list                  列出全部签署记录
 *   node scripts/cla_check.mjs --self-test             跑判定逻辑内存自测
 *   node scripts/cla_check.mjs --json                  机器可读输出（可与上面的模式叠加）
 *
 * 未显式给 --login 时，也会读取环境变量 CLA_PR_AUTHOR。
 * 退出码：0 = 通过，1 = 失败。
 */

import {
  CLA_VERSION, SIGNATURES_PATH, loadSignatureState, checkContributor,
  selfTest, renderSignatureFile, agreementState,
} from './cla_policy.mjs';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const asJson = flag('--json');
const login = value('--login') || process.env.CLA_PR_AUTHOR || null;
const mode = flag('--self-test') ? 'self-test'
  : flag('--list') ? 'list'
    : flag('--validate') ? 'validate'
      : login ? 'login' : 'validate';

const out = { mode, claVersion: CLA_VERSION, ok: false, checks: [] };
const line = (name, ok, detail) => {
  out.checks.push({ name, ok, detail: String(detail ?? '') });
  if (!asJson) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

if (!asJson) console.log(`=== mimic-JMP CLA 门禁 | CLA v${CLA_VERSION} ===`);

if (mode === 'self-test') {
  const st = selfTest();
  for (const c of st.checks) line(c.name, c.ok);
  out.ok = st.ok;
  out.summary = `${st.passed}/${st.total} 项通过`;
} else {
  const state = loadSignatureState();
  const structural = state.ok;
  line('签名表结构与 CLA 文本指纹', structural,
    structural ? `${state.data.signatures.length} 条记录，ICLA/CCLA 均为 v${CLA_VERSION}` : state.problems.join('；'));

  let contentOk = true;
  if (state.data) {
    const problems = [];
    const expected = renderSignatureFile(state.data);
    const actual = readFileSync(SIGNATURES_PATH, 'utf8');
    if (actual !== expected) problems.push('signatures.json 非确定性渲染（字段顺序/缩进被改）');
    const ag = agreementState();
    if (ag.individual.missing || ag.entity.missing) problems.push('协议文本缺失');
    if (problems.length) { contentOk = false; line('签名表渲染与协议文本', false, problems.join('；')); }
    else line('签名表渲染与协议文本', true, 'ICLA / CCLA 均在位');
  }

  if (mode === 'list') {
    out.signatures = state.data?.signatures || [];
    if (!asJson) {
      if (!out.signatures.length) console.log('  （签名表为空：尚无签署记录）');
      for (const s of out.signatures)
        console.log(`  - ${s.login} | ${s.type} | ${s.name} | ${s.email} | v${s.claVersion} | ${s.signedAt} | ${s.method}`);
      console.log(`  bots: ${(state.data?.bots || []).join(', ') || '（无）'}`);
    }
    out.ok = structural && contentOk;
  } else if (mode === 'login') {
    const verdict = checkContributor(login, state.data || {}, state.hashes || {});
    line(`贡献者 ${login}`, verdict.signed, verdict.reason);
    out.login = login;
    out.signed = verdict.signed;
    out.reason = verdict.reason;
    out.ok = structural && contentOk && verdict.signed;
    if (!out.ok && !asJson) {
      console.log('');
      console.log('  未通过签署检查。请在 PR 分支执行：');
      console.log(`    node spike/scripts/cla_sign.mjs --login ${login} --name "姓名" --email "you@example.com" --type individual`);
      console.log('  然后把 .cla/signatures.json 的改动一并提交进本 PR。详见 CONTRIBUTING.md。');
    }
  } else {
    const st = selfTest();
    line('判定逻辑内存自测', st.ok, `${st.passed}/${st.total} 项通过`);
    out.ok = structural && contentOk && st.ok;
    out.summary = `${state.data?.signatures?.length ?? 0} 条签署记录`;
  }
}

if (asJson) console.log(JSON.stringify(out, null, 2));
else console.log(`\n=== CLA gate: ${out.ok ? 'PASS' : 'FAIL'} | mode=${mode} | ${out.checks.filter((c) => c.ok).length}/${out.checks.length} checks ===`);
process.exit(out.ok ? 0 : 1);
