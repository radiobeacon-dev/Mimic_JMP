# THIRD-PARTY-NOTICES

> 本文件由 `scripts/gen_packages_lock.mjs` 从 `packages.lock` 自动生成，**请勿手改**。
> 改动预置包后运行 `npm run lock:gen` 重新生成；CI 会断言两者一致。

项目自有代码采用 **AGPL-3.0-or-later**。以下第三方组件随安装包分发，
全部作为**独立运行时组件**（标准 R library 目录，运行时由 webR NODEFS 挂载、
由 R 自身 `library()` 动态加载）分发，**未与自有代码静态整合**。
按 GPLv2 §2 *mere aggregation* 例外与 FSF FAQ「安装到同一系统不等于合成一个程序」，
各组件分别遵守其各自许可证。

分发通道：https://repo.r-wasm.org/bin/emscripten/contrib/4.6（R 4.6 / wasm32-unknown-emscripten）；
运行时禁止联网安装 R 包。完整对应源码（含本项目自有代码与 WASM 包构建脚本）
随发行版同址提供。

## 强 copyleft（GPL 系，与 AGPLv3 可组合）

共 17 个组件。

- **AlgDesign** v1.2.1.2 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=AlgDesign；构建产物：local-repo/tgz/AlgDesign_1.2.1.2.tgz · sha256 `55faf85d0288d00d65c7e995eff5c2156649fa6f6a9812d036738bc29880f63b`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合；含编译型 .so
- **DoE.base** v1.2-5 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=DoE.base；构建产物：local-repo/tgz/DoE.base_1.2-5.tgz · sha256 `2bb055ab41e5c2dfd2f21c0196f02fa9d2161f87b8692dd35108d6cfcfa19cf3`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **estimability** v2.0.0 — `GPL (>= 3)` → `gpl3-or-later`
  - 上游源码：https://cran.r-project.org/package=estimability；构建产物：local-repo/tgz/estimability_2.0.0.tgz · sha256 `5669be6b04beacd52f4e526661718abbbe741db5187366a8db8f408f96449c1d`
  - 判定：与 AGPLv3 可按 §13 组合
- **FrF2** v2.3-5 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=FrF2；构建产物：local-repo/tgz/FrF2_2.3-5.tgz · sha256 `01c78f4e7664980cac3723ca60aaae42324c6f179d69f85e851bf3fffd917e56`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **gmp** v0.7-5.1 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=gmp；构建产物：local-repo/tgz/gmp_0.7-5.1.tgz · sha256 `f77debd5614d030a07a9660b266af9104dbdaa389988f444b7e091c93cfa524f`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合；含编译型 .so
- **igraph** v2.3.1 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=igraph；构建产物：local-repo/tgz/igraph_2.3.1.tgz · sha256 `7abfc0d384d47d64a0d58d37a6b3d6af1b577c11acf8224feff4c686e858a806`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合；含编译型 .so
- **lattice** v0.23-1 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=lattice；构建产物：local-repo/tgz/lattice_0.23-1.tgz · sha256 `b1f6c45be57330e13595bfeb87550c21e3b09d6ee2a58551c19911d345a72722`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合；含编译型 .so
- **lmtest** v0.9-40 — `GPL-2 | GPL-3` → `gpl2-or-gpl3`
  - 上游源码：https://cran.r-project.org/package=lmtest；构建产物：local-repo/tgz/lmtest_0.9-40.tgz · sha256 `ed0c0ff0caa1cab87b420102ea80cc515f35228c6e17d80ac515cbab8f62653e`
  - 判定：双许可，可选 GPLv3；含编译型 .so
- **MASS** v7.3-66 — `GPL-2 | GPL-3` → `gpl2-or-gpl3`
  - 上游源码：https://cran.r-project.org/package=MASS；构建产物：local-repo/tgz/MASS_7.3-66.tgz · sha256 `2abe66de8f442fdc0cd221bdb0e774ea17f56ff963dc0275bcfcd2add27ee3b5`
  - 判定：双许可，可选 GPLv3；含编译型 .so
- **Matrix** v1.7-6 — `GPL (>= 2) | file LICENCE` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=Matrix；构建产物：local-repo/tgz/Matrix_1.7-6.tgz · sha256 `a6caf93b993de359eab932fff8ac0c39d7e2f372b885458f0f98051a9be82237`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合；含编译型 .so
- **numbers** v0.9-2 — `GPL (>= 3)` → `gpl3-or-later`
  - 上游源码：https://cran.r-project.org/package=numbers；构建产物：local-repo/tgz/numbers_0.9-2.tgz · sha256 `f9395321fcdb0377b866425ae173e107b87b22e728f3d385e9e5f9d0a41ab66a`
  - 判定：与 AGPLv3 可按 §13 组合
- **partitions** v1.11-1 — `GPL` → `gpl2-or-gpl3`
  - 上游源码：https://cran.r-project.org/package=partitions；构建产物：local-repo/tgz/partitions_1.11-1.tgz · sha256 `48fc5778e655dd3f51466a38f3e10106aba6894150790b911780b41d7626faa0`
  - 判定：已人工复核并登记：CRAN https://cran.r-project.org/package=partitions 显示 "GPL-2 | GPL-3 [expanded from: GPL]"：DESCRIPTION 中的 GPL 是双许可简写，可选 GPLv3，与 AGPLv3 兼容；含编译型 .so
- **qcc** v2.7 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=qcc；构建产物：local-repo/tgz/qcc_2.7.tgz · sha256 `6d6bcdfcc0b145cf78463a513ca16a3f06f542f0bd9fb5c0818a653cda4f6c87`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **Rdpack** v2.6.6 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=Rdpack；构建产物：local-repo/tgz/Rdpack_2.6.6.tgz · sha256 `98a070922d7ffc9036152a73f8a0e5feb0915105b3384eb6f777eb2235f7baf0`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **rsm** v2.10.6 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=rsm；构建产物：local-repo/tgz/rsm_2.10.6.tgz · sha256 `6bf6dc13a2cc13e97a8cdd8b9ad08b9f2eaae90bdfcee4fdee792956825c3f44`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **sfsmisc** v1.1-26 — `GPL (>= 2)` → `gpl2-or-later`
  - 上游源码：https://cran.r-project.org/package=sfsmisc；构建产物：local-repo/tgz/sfsmisc_1.1-26.tgz · sha256 `811a4271ccbe64749a8c1c6e4bbb019b3f0bf80e88690a8dd5c79d4daf34648a`
  - 判定：可升级到 GPLv3，与 AGPLv3 组合
- **zoo** v1.9-1 — `GPL-2 | GPL-3` → `gpl2-or-gpl3`
  - 上游源码：https://cran.r-project.org/package=zoo；构建产物：local-repo/tgz/zoo_1.9-1.tgz · sha256 `c3dd43342691e817161b98de107c71b89b647af2a04d3b083f80c1c52bca949b`
  - 判定：双许可，可选 GPLv3；含编译型 .so

## 纯 GPL-2（与 AGPLv3 严格不兼容，已人工复核并冻结）

共 7 个组件。

- **combinat** v0.0-9 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=combinat；构建产物：local-repo/tgz/combinat_0.0-9.tgz · sha256 `ede58ae9870c16c420dbc52f798c4b97679f44cd5b5c4089199dc49fe6bbbc99`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容
- **conf.design** v2.0.0 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=conf.design；构建产物：local-repo/tgz/conf.design_2.0.0.tgz · sha256 `35616746714dd53841b3d1cb65a2496c814eb0ddcc2555c54a5b515ec5e16a2f`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容
- **polynom** v1.4-1 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=polynom；构建产物：local-repo/tgz/polynom_1.4-1.tgz · sha256 `25c211331d267266d3c3d48b07c2901c3cd01035dfcd470ce6b8760f4ef1b291`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容
- **rbibutils** v2.4.1 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=rbibutils；构建产物：local-repo/tgz/rbibutils_2.4.1.tgz · sha256 `f9be998342d3075d87254c78c968a45ea018bbf9c7d7c9de8b57d4554f0f0143`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容；含编译型 .so
- **scatterplot3d** v0.3-45 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=scatterplot3d；构建产物：local-repo/tgz/scatterplot3d_0.3-45.tgz · sha256 `ef964632faeb26600137a86fd8827a9ec5ca7e7bd7148e693343824428e23a68`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容
- **sets** v1.0-25 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=sets；构建产物：local-repo/tgz/sets_1.0-25.tgz · sha256 `a86b4a3bd9f62617585d964f697c882dd8a6453a1b0d80f7baf98fe282618362`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容；含编译型 .so
- **vcd** v1.4-14 — `GPL-2` → `gpl2-only-frozen`
  - 上游源码：https://cran.r-project.org/package=vcd；构建产物：local-repo/tgz/vcd_1.4-14.tgz · sha256 `8a9b38691a0cda0f2c5313b3e84cf372bf8971b73963eb8990e0fbcc569ef26e`
  - 判定：纯 GPL-2，FSF 判定与 AGPLv3 不兼容

## 宽松 / 弱 copyleft 许可证

共 9 个组件。

- **cli** v3.6.6 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=cli；构建产物：local-repo/tgz/cli_3.6.6.tgz · sha256 `efa9c2b12c2da09cccb0a27d2e7a079ebd4c38fc1d03560d599f7634eb7f9932`
  - 判定：宽松许可证；含编译型 .so
- **colorspace** v2.1-4 — `BSD_3_clause + file LICENSE` → `bsd`
  - 上游源码：https://cran.r-project.org/package=colorspace；构建产物：local-repo/tgz/colorspace_2.1-4.tgz · sha256 `a5fd2e78564f1d7dd9f2b72a14b01ee82a24442f596437b471097a714e1226ba`
  - 判定：宽松许可证；含编译型 .so
- **cpp11** v0.5.5 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=cpp11；构建产物：local-repo/tgz/cpp11_0.5.5.tgz · sha256 `101b838c116c78bb0f8fe9a8aafb38a74ecd7eef8645212ea6968de275509c6e`
  - 判定：宽松许可证
- **glue** v1.8.1 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=glue；构建产物：local-repo/tgz/glue_1.8.1.tgz · sha256 `3b025aa5fd067ad9b87fecd219e561d4537d488b33581af8beabe2b06024d44d`
  - 判定：宽松许可证；含编译型 .so
- **lifecycle** v1.0.5 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=lifecycle；构建产物：local-repo/tgz/lifecycle_1.0.5.tgz · sha256 `c2f8c5905f58b4526c3b68c6163f891b9a12f81d7e50347ad49a70b1f6592527`
  - 判定：宽松许可证
- **magrittr** v2.0.5 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=magrittr；构建产物：local-repo/tgz/magrittr_2.0.5.tgz · sha256 `ff7c81a6839f611a9a7d16b2e03ba6e99859992128012f8e9d3d7a8ef1ad5588`
  - 判定：宽松许可证；含编译型 .so
- **pkgconfig** v2.0.3 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=pkgconfig；构建产物：local-repo/tgz/pkgconfig_2.0.3.tgz · sha256 `fc97bdb16f209e9e79fc8e64234a1bb1263035f5f244ea8b748885b28e3c5d97`
  - 判定：宽松许可证
- **rlang** v1.3.0 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=rlang；构建产物：local-repo/tgz/rlang_1.3.0.tgz · sha256 `c5562dc07b5d3c62fb85ee856a670b83105ba7793c778a30c1d9512d914e208a`
  - 判定：宽松许可证；含编译型 .so
- **vctrs** v0.7.3 — `MIT + file LICENSE` → `mit`
  - 上游源码：https://cran.r-project.org/package=vctrs；构建产物：local-repo/tgz/vctrs_0.7.3.tgz · sha256 `42cc19d325e7de2160490273d97099049f261e8b6c3e6736391d96e43923798d`
  - 判定：宽松许可证；含编译型 .so

## 数据集裁剪提示（R12）

随包分发的 WASM R 包中有 22 个不含 `data/` 目录，
含内置数据集的仅 11 个。产品必须自备示例数据，
不得假定预置包带有上游内置数据集（例如 qcc 2.7 的 WASM 构建无 `pistonrings`）。

## 人工复核登记（简写许可证）

以下包的随包 `DESCRIPTION` 使用了未注明版本的简写，CI 默认会阻断；
经上游权威页面核实后按下表登记，证据与复核日期同时写入 `packages.lock`：

- **partitions**：`GPL` → `GPL-2 | GPL-3`（`gpl2-or-gpl3`），复核于 2026-11-26
  - 证据：CRAN https://cran.r-project.org/package=partitions 显示 "GPL-2 | GPL-3 [expanded from: GPL]"：DESCRIPTION 中的 GPL 是双许可简写，可选 GPLv3，与 AGPLv3 兼容

## 特别提示：纯 GPL-2 组件

以下 7 个包是纯 GPL-2（无 or-later、无双许可），FSF 明确与 AGPLv3 不兼容：

`conf.design`、`combinat`、`sets`、`polynom`、`vcd`、`scatterplot3d`、`rbibutils`。

它们**只能作为独立组件分发**，不得静态整合进自有代码；新增任何纯 GPL-2 包都会触发 CI 失败，
必须先做人工合规复核并显式加入 `packages.lock` 的 `policy.frozenGpl2Only`。

## 免责声明

本清单基于 FSF 官方 FAQ / 许可证列表与随包 `DESCRIPTION`，**不构成法律意见**；
正式发布前须由开源合规律师审阅，并附 AGPL-3.0 与 GPL 各版本许可证全文。
