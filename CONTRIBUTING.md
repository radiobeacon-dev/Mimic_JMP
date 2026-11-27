# 贡献指南（mimic-JMP）

感谢你参与。本项目自有代码采用 **`AGPL-3.0-or-later`**（路线 A，全开源），
依赖的 R 生态组件按其各自许可证作为独立运行时组件分发，
详见 `spike/THIRD-PARTY-NOTICES.md`。

> 本项目的定位、路线决策与合规背景见 `docs/DEVELOPMENT_PLAN.md` §7。

---

## 1. 首次贡献前必须先签 CLA

我们采用 **Contributor License Agreement（贡献者许可协议）**，而不是
`Signed-off-by` / DCO。原因很实际：DCO 1.1 只证明「你有权按文件所示
许可证提交」，**不含可再许可授权、不含换许可证授权、也不含专利授权**；
而本项目明确保留了未来转 Open-core / 双许可商业化的退路，
AGPL 项目要改变许可证通常需要全体版权持有人同意。
CLA 的第一版就把「可再许可」写足，才能不靠日后逐一追认。

- 以**个人**身份贡献 → 签 [`.cla/ICLA.md`](.cla/ICLA.md)
- 代表**公司/组织**贡献 → 由有权签约的代表签 [`.cla/CCLA.md`](.cla/CCLA.md)，
  且员工本人仍应签 ICLA（与 Apache 基金会做法一致）

本项目采用「**保留版权 + 可再许可授权**」而非版权转让（CTA）：
你保留自己贡献的完整版权，只是授予项目维护方永久、可再许可的使用权。

---

## 2. 三步完成签署（零权限、可离线）

**① 生成签名记录**（在项目根目录执行，只需 Node ≥ 17，无需 npm install）：

```bash
node spike/scripts/cla_sign.mjs \
  --login 你的GitHub登录名 \
  --name "姓名或稳定化名" \
  --email "you@example.com" \
  --type individual
```

公司签署追加 `--organization "公司法定全称" --authorized-by "授权代表姓名"`
并把 `--type` 改为 `entity`。脚本会把当前 CLA 文本的 sha256 写进记录，
用于锁定你所同意的条款版本。

**② 把 `.cla/signatures.json` 的改动连同你的代码一起提交进 PR。**
这条 Git 提交（带你的作者身份与 GitHub 账号关联）就是签署凭据，
会被永久保存在公开仓库历史中。

**③ 等门禁通过。** `.github/workflows/cla.yml` 会在每个 PR 上检查
作者登录名是否已在签名表中、字段是否合法、CLA 文本指纹是否匹配。
未通过时请查看 Actions 日志里的引导信息。

本地自查：

```bash
npm run cla:check -- --login 你的GitHub登录名   # 判定某登录名是否已签
npm run cla:list                                # 打印当前签名表
npm run cla:selftest                           # 跑判定逻辑自测（纯内存，无需外网）
```

> 若你不方便运行脚本，也可手工按 `.cla/README.md` 的字段表添加一条记录，
> 但 `agreementSha256` 必须是对应 CLA 文件的真实 sha256，否则门禁会拒绝。

---

## 3. 门禁会检查什么

- 签名表 `schemaVersion` / `claVersion` 与策略一致，字段完整且无重复登录名；
- 每条记录的 `agreementSha256` 与当前 `.cla/ICLA.md` / `.cla/CCLA.md` 一致；
- **CLA 文本改了但版本号没升 → 判定为静默篡改，门禁失败**；
- 实体签署必须有 `organization` 与 `authorizedBy`；
- `bots` 名单中的自动化账号（`dependabot[bot]` 等）豁免——它们无法签 CLA。

`npm run verify` 也包含 CLA 流水线完整性断言（C12），
因此删改 CLA 文件、贡献指南或 workflow 会一起被挡住。

---

## 4. 常见问题

**Q：我提的是错别字/文档修改，也要签吗？**
要。CLAs 按贡献者而非按 PR 签署，一次签署覆盖你在此前后提交的全部贡献。

**Q：公司已经签了 CCLA，我还要签 ICLA 吗？**
要。CCLA 覆盖公司拥有版权的职务贡献，ICLA 覆盖其余部分（Apache 基金会同款规则）。

**Q：姓名和邮箱会公开吗？**
会。签名记录随 Git 历史永久公开并可随项目再分发（DCO 1.1 (d) 的同类约定）。
介意的话可用稳定化名，但邮箱需能联系到你。

**Q：以后 CLA 改版怎么办？**
文本变更必须提升 `CLA Version`；已提交的贡献继续受你签署时那一版约束
（我们不追溯扩张授权），但**新的贡献须签新版**才会被门禁接受。

**Q：托管签署服务（cla-assistant.io）呢？**
它体验更好（PR 内点一下即签、CLA 变更自动要求重签），但需要安装 GitHub App，
且签署者名单存在其 Azure Cosmos DB（欧洲）中。本项目当前选择
「签名表进 Git」以便离线审计与数据自持；切换路径见
`docs/DEVELOPMENT_PLAN.md` §7.7。

---

## 5. 发布前合规

`npm run verify` 会同时跑许可证门禁与 Phase 0 全量回归。
提交代码前建议本地跑一次：

```bash
cd spike && npm run verify
```

⚠️ 当前 `.cla/ICLA.md` / `.cla/CCLA.md` 第 8、9 节含**待律师填写的占位**
（项目维护方法定主体、管辖法、通知邮箱）。在定稿前，本流程仅供
核心团队内部签署使用，不应对外宣传为正式 CLA。
