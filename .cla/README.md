# `.cla/` 签名库维护说明

本目录是 CLA 签署流程的**唯一事实来源**，全部文本文件入库、可离线审计，
不依赖任何第三方数据库或托管服务。

| 文件 | 职责 |
|---|---|
| `ICLA.md` | 个体贡献者许可协议全文（v1.0） |
| `CCLA.md` | 实体／公司贡献者许可协议全文（v1.0） |
| `signatures.json` | 签署登记表（**唯一可变的签名数据**） |
| `README.md` | 本维护说明 |

策略常量与判定逻辑在 `spike/scripts/cla_policy.mjs`，
PR 门禁在 `.github/workflows/cla.yml`，
完整性断言在 `spike/scripts/verify_licenses.mjs` 的 **C12**。

---

## 1. `signatures.json` 格式

顶层字段（**只允许这 4 个**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | number | 当前固定为 `1` |
| `claVersion` | string | 必须与 `cla_policy.mjs` 的 `CLA_VERSION` 一致（当前 `"1.0"`） |
| `signatures` | array | 签署记录数组，按 `login` 唯一、字典序排列 |
| `bots` | array | 无法签 CLA 的自动化账号白名单 |

每条签署记录（**只允许这些字段**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `login` | string | GitHub 登录名，小写、唯一；实体签署用组织名或授权代表登录名 |
| `type` | `"individual"` \| `"entity"` | 决定用 ICLA 还是 CCLA 校验文本指纹 |
| `name` | string | 签署人姓名，或公司法定全称 |
| `email` | string | 可联系邮箱 |
| `organization` | string \| null | `entity` 必填且与 `name` 一致；`individual` 必须为 null |
| `authorizedBy` | string \| null | `entity` 必填（授权代表）；`individual` 必须为 null |
| `contributors` | string[] | 可选，CCLA 附录 A 员工登录名；每项须为合法登录名 |
| `claVersion` | string | 签署时的 CLA 版本 |
| `signedAt` | string | ISO 8601 UTC（如 `2026-11-26T11:00:00Z`） |
| `method` | `"offline-file"` \| `"pr-comment"` \| `"manual"` | 签署通道 |
| `evidence` | string | PR 编号 / commit SHA / 线下凭据链接 |
| `agreementSha256` | string | 签署时对应 CLA 文件的 sha256（64 位小写十六进制） |

校验器会拒绝：未知字段、重复 `login`、缺字段、类型错误、
`agreementSha256` 与当前 CLA 文件不一致、`claVersion` 与顶层／策略不一致、
实体记录缺公司信息、`signedAt` 非 ISO 8601。

---

## 2. 维护者审核清单（合并签名 PR 前）

- [ ] `login` 与 PR 作者在 GitHub 上的登录名一致（大小写归一化后比对）；
- [ ] `signedAt` 合理，非未来时间；
- [ ] `evidence` 指向可查的 PR / commit / 线下签署凭据；
- [ ] 实体签署：确认 `organization` 与 `authorizedBy` 真实、代表有签约权；
- [ ] `agreementSha256` 与仓库中当前 CLA 文件一致（脚本自动算，不必手填）；
- [ ] `npm run cla:check -- --login <login>` 返回 PASS；
- [ ] `cd spike && npm run verify` 全绿。

**不要**为了「让某人的 PR 过」而放宽校验器或把登录名加进 `bots`。
`bots` 只放自动化账号，且有完整审计记录。

---

## 3. 吊销 / 移除签名

删除记录只影响**未来的贡献**，不撤销已提交贡献的授权（授权永久且不可撤销，
ICLA §6.1 / CCLA §6.1）。移除时：

1. 提交一个只删该条记录的 PR，说明原因；
2. 若涉及公司签署，同步清理其 `contributors` 名单；
3. 在 PR 描述里记录依据，保留 Git 历史供审计。

---

## 4. 升级 CLA 版本（必须按顺序，否则会被判为静默篡改）

1. 修改 `ICLA.md` / `CCLA.md` 正文，并把两份文件顶部的 `CLA Version` 一起提升；
   **两份文件的版本号必须相同**。
2. 修改 `spike/scripts/cla_policy.mjs`：把 `CLA_VERSION` 提升，并把
   `AGREEMENT_BASELINE` 更新为新文本的 sha256（两份文件分别对应
   `individual` / `entity`）。计算方式：
   ```bash
   node -e "const fs=require('fs'),c=require('crypto');for(const f of ['.cla/ICLA.md','.cla/CCLA.md'])console.log(f,c.createHash('sha256').update(fs.readFileSync(f)).digest('hex'))"
   ```
   基线用于拦住「改条款却不升版本」；**只升版本不更新基线，C12 同样会失败**。
3. 更新签名表顶层 `claVersion`；旧记录保留（不追溯扩张授权），
   但 `cla_check.mjs` 会判定旧版本签名**对新贡献无效**，需重新签署。
4. 更新 `CONTRIBUTING.md` 与 `docs/DEVELOPMENT_PLAN.md` §7.7 中的版本号引用。
5. 跑 `cd spike && npm run verify` 确认 C12 全绿，再合并。

> ⚠️ **严禁**在不升版本的情况下修改 CLA 正文：当前文本 sha256 变了、
> 版本没变，会被判定为静默篡改，C12 与 PR 门禁同时失败。
> ⚠️ **严禁**指望靠改 CLA 追认历史贡献：ICLA/CCLA §6.3/§6.4 已写明，
> 第一版就包含完整的可再许可授权。

---

## 5. 审计命令

```bash
node spike/scripts/cla_check.mjs --validate          # 只校验签名表格式与指纹
node spike/scripts/cla_check.mjs --list               # 打印全部签署记录
node spike/scripts/cla_check.mjs --login <name>      # 判定某登录名是否已有效签署
node spike/scripts/cla_check.mjs --self-test         # 跑 12 组内存自测场景
cd spike && npm run verify                          # 含 C12 的全量回归
```

---

## 6. 安全边界

- PR 门禁使用 `pull_request` 事件（不是 `pull_request_target`），
  `permissions: contents: read`，**不接触 secrets、不写仓库、不执行 PR 中的代码**，
  只 `JSON.parse` 读取 `.cla/signatures.json`，对 fork PR 同样安全。
- 签署记录随 PR 提交，因此门禁能读到贡献者自己新增的那条记录。
- 签名表是公开 Git 历史的一部分，不要在其中放机密信息。
- 上述边界由 `verify_licenses.mjs` 的 **C12** 固化断言：禁止 `pull_request_target`、
  禁止引用 `secrets.`、必须声明 `contents: read` 与 `CLA_SIGNATURES_FILE`。
