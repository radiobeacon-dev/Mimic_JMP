# mimic-JMP 个体贡献者许可协议（Individual CLA）

> **CLA Version: 1.0**
> 生效日期：2026-11-26
> 项目自有代码许可证：`AGPL-3.0-or-later`
> 本文件的内容指纹（sha256）由 `.cla/signatures.json` 中每条签署记录的
> `agreementSha256` 锁定。**任何文字改动都必须升 CLA 版本并要求重新签署**，
> 不允许在不升版本的情况下静默修改条款。
>
> ⚠️ **本文为工程部署模板，不构成法律意见。** 正式对外开放贡献前，
> 必须由开源合规律师审阅定稿（尤其第 8 节管辖法与争议解决）。
> 决策背景见 `docs/DEVELOPMENT_PLAN.md` §7.7。

---

## 0. 当事方与定义

- **「项目」**：mimic-JMP 及其官方代码仓库、文档、示例数据与构建脚本。
- **「项目维护方」**（下称「我们」）：负责本项目发布与许可决策的主体。
  在正式定稿时须填写法定名称与地址，见第 8 节占位。
- **「贡献」**（Contribution）：你有意提交给项目、供其纳入的任何原创作品，
  包括但不限于源代码、文档、测试用例、示例数据、构建脚本与翻译，
  以及对该作品的修改或增补。定义参照 Apache License 2.0 §1 的
   *"Contribution"*；标注为 *"Not a Contribution"* 的通信不在此列。
- **「你」**：以个人身份签署本协议、且不以任何雇主名义代为提交的自然人。
  若你是代表雇主提交，请改用 `.cla/CCLA.md`；若你的雇主已签 CCLA，
  你个人仍应签署本 ICLA（与 Apache 基金会的做法一致）。
- **「项目许可证」**：当前 `AGPL-3.0-or-later`，以及我们未来可能采用的
  任何许可证（含商业／专有许可证）。

## 1. 签署与适用范围

1.1 你在 Pull Request 中提交签署记录（`.cla/signatures.json` 中一条包含你
GitHub 登录名的记录），或以我们认可的其他明确方式表示同意，即视为签署本协议。

1.2 本协议适用于**你在本协议签署之前与之后提交的全部贡献**，并可由我们
在项目的任何发行版、任何分发渠道中使用。

1.3 你签署的是**许可授权**，不是版权转让：你保留对贡献的完整版权，
仍可将同样的作品用于任何其他用途（包括你自己的商业项目）。
本项目采用此模式而非 Copyright Transfer Agreement（CTA），
以降低贡献者门槛；第 2 条的授权范围已足以支持未来转换商业模式。

## 2. 版权许可授权（核心条款）

2.1 你在此向我们授予一项**永久的、全球性的、非独占的、免费的、
免版税的、不可撤销的、可再许可的**版权许可，允许我们及我们授权的第三方
以源码或目标码形式，对你的贡献进行使用、复制、修改、创作演绎作品、
公开显示、公开表演、分发、**再许可（sublicense）**，
并允许我们**以任何许可证（包括但不限于项目许可证、其他开源许可证、
商业或专有许可证）分发或授权包含该贡献的作品或其演绎作品**。

> English reference wording (Apache-2.0 §2, extended):
> *"each Contributor hereby grants to You a perpetual, worldwide,
> non-exclusive, no-charge, royalty-free, irrevocable copyright license
> to reproduce, prepare Derivative Works of, publicly display,
> publicly perform, sublicense, and distribute the Work and such
> Derivative Works in Source or Object form"* —
> 本协议在此基础上**明确追加**：该许可可由项目维护方再许可，
> 且不限制于任何特定许可证。

2.2 第 2.1 条的「可再许可」是本项目选择 CLA 的根本原因：它使得项目在
未来需要采用 Open-core / 双许可 / 商业授权时，无需逐一追溯取得每一位
贡献者的重新同意。**若缺少该条款，AGPL 项目改变许可证通常需要全体
版权持有人同意，实际上不可行。**

2.3 你保留署名权。我们将按项目许可证的要求保留贡献中的版权声明，
不得移除你对贡献的原有版权与归属声明。

## 3. 专利许可授权

3.1 你在此向我们及项目的使用者授予一项永久的、全球性的、非独占的、
免费的、免版税的、不可撤销的（**除本条 3.2 规定外**）专利许可，
允许制造、委托制造、使用、许诺销售、销售、进口及以其他方式转移项目作品；
该许可仅覆盖你有权许可的、且因你的贡献单独或与所提交作品结合而
必然被侵犯的专利权利要求。

> English reference wording (Apache-2.0 §3, verbatim):
> *"If You institute patent litigation against any entity (including a
> cross-claim or counterclaim in a lawsuit) alleging that the Work
> or a Contribution incorporated within the Work constitutes direct
> or contributory patent infringement, then any patent licenses
> granted to You under this License for that Work shall terminate
> as of the date such litigation is filed."*

3.2 **专利诉讼终止**：若你对任何实体提起专利诉讼（含反诉），
主张项目作品或其中纳入的贡献构成直接或间接专利侵权，
则依据本协议授予你的专利许可自起诉之日起终止。

## 4. 陈述与保证

你声明并保证：

4.1 你的贡献全部或部分由你原创，或你依据适当的开源许可证有权提交并按
本协议授权；你拥有授予第 2、3 条许可所需的全部权利。

4.2 若你的贡献包含第三方材料或基于他人作品，你已在提交时明确标注其
来源、版权声明与许可证，且该许可证允许按本协议使用与再许可。

4.3 若你的贡献是在受雇期间完成、或使用了雇主的资源，你已获得雇主
必要的授权（此时雇主应另行签署 CCLA）；你提交贡献不违反任何雇佣、
保密或竞业约定。

4.4 你理解并同意：项目与贡献是公开的；你的签署记录（包括你提交的
姓名、邮箱、GitHub 登录名等个人信息）会被**永久保存在公开的 Git 历史中**，
并可随项目或其许可证一同再分发（参照 DCO 1.1 (d) 的公开性约定）。
如不希望公开真实姓名，可使用稳定的化名，但邮箱须能联系到你。

## 5. 无支持义务与免责

5.1 贡献按「现状」（AS IS）提供，你无义务提供支持、维护或更新；
我们对贡献亦不作任何明示或默示担保，包括所有权、不侵权、适销性
及特定用途适用性。

5.2 在法律允许的最大范围内，双方均不就贡献承担间接、附带或后果性
损害赔偿（参照 Apache-2.0 §7、§8 的措辞）。

## 6. 生效、期限与版本

6.1 本协议自你签署之日起生效，授权为永久且不可撤销。

6.2 **版本锁定**：每条签署记录必须包含所签 CLA 版本的文本 sha256。
我们修改 CLA 文本时必须提升 `CLA Version`；文本变更而版本未提升，
会被 `spike/scripts/cla_check.mjs` 判定为**静默篡改并使门禁失败**。

6.3 版本升级后，你已作出的贡献继续受签署时那一版协议约束（我们不追溯
扩张已取得的授权）；但**新的贡献须签署新版 CLA** 才会被 PR 门禁接受。

6.4 因第 6.3 条的限制，**第 2 条的再许可授权必须在第一版就写足**，
不能指望日后靠改 CLA 追认历史贡献。

## 7. 其他

7.1 本协议不授予使用项目名称、商标、服务标记的权利，
但为合理描述贡献来源所必需的使用除外。

7.2 若本协议的任何条款被认定无效，其余条款继续有效；
无效条款按最接近双方原意的有效条款解释。

## 8. 管辖法与争议解决（待律师定稿）

> ⚠️ **占位**：`[适用法律与管辖法院 / 仲裁机构]`、
> `[项目维护方法定名称与地址]`、`[通知邮箱]`。
> 正式启用前由开源合规律师填写。未填写前，本流程仅用于
> 内部贡献者（核心团队）签署，不对外宣传为正式 CLA。

---

## 附录 A：为什么本项目用 CLA 而不用 DCO

DCO 1.1（`https://developercertificate.org/`）只有 (a)–(d) 四项，
核心是「我有权**按文件中标明的开源许可证**提交该贡献」，以及
(d) 关于记录公开与永久保存的约定。它**不包含可再许可授权、
不包含换许可证授权、也不包含专利授权**。

因此对本项目而言：

- AGPL 项目若未来要转 Open-core / 双许可，DCO **不足以**授权改许可证；
- DCO 的 `Signed-off-by` 适合许可证固定不变的项目（Linux 内核、Git 等），
  不适合把「保留商业模式退路」写进决策的路线 A；
- CLA 还能一并解决专利授权与第三方材料保证，DCO 均不覆盖。

本项目因此采用「保留版权 + 可再许可授权」的 CLA，而非 DCO，
也非版权转让（CTA）。

## 附录 B：标准签署语句（供未来托管版 / 评论签署使用）

```
I have read the mimic-JMP Individual Contributor License Agreement
(ICLA v1.0) and I hereby sign it as an individual contributor.
```

或中文：

```
我已阅读 mimic-JMP 个体贡献者许可协议（ICLA v1.0），
并以个人身份签署该协议。
```

当前部署采用「签名记录随 PR 提交」通道，见 `CONTRIBUTING.md`。
上述语句保留用于将来切换到 cla-assistant.io 等托管签署服务。
