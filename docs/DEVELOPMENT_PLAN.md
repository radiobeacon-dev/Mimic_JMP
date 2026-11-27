# mimic-JMP 开发计划 v2

> 版本：v2（基于开源生态调研修订）
> 日期：2026-11-25
> 状态：待评审

---

## 0. 执行摘要

v1 计划假设「以 Python 统计栈为核心自建全部算法」。调研后**该假设需要修正**，理由是一个决定性发现：

> **JMP 最核心、最难替代的两个 niche——DOE（实验设计）与质量工程（SPC/MSA/Capability）——在 R 生态里有成熟且绝大多数为「纯 R」的实现，而 webR 已能把 R 编译成 WebAssembly 在浏览器/Tauri 内直接运行。**

这把项目性质从「重写统计内核」变成了「做一个高质量的交互外壳 + 编排层」。工作量、风险、周期都显著下降，且统计正确性由 CRAN 上游背书，不需要我们自己证明。

**修订后的三条核心判断：**

1. **计算引擎改为双栈**：webR（统计推断 / DOE / 质量 / 多元）+ Pyodide（机器学习 / 可靠性工程）。不再自建统计算法。
2. **UI 与交互层是唯一真正的护城河**，也是唯一必须从零写的部分。JMP 的价值不在算法（算法都是公开的），而在 linked brushing + Graph Builder + Profiler 这套交互范式。
3. **Phase 0 必须先做技术验证（Spike）**，验证 webR 中 DOE 包链路的实际可用性，再决定是否投入。这是全项目最大的单点风险。

---

## 1. 技术可行性验证结果

### 1.1 关键包编译属性核查

已逐个核对 CRAN 官方元数据的 `NeedsCompilation` 字段。纯 R 包（`no`）在 webR 中可用性最高，因为不需要 Emscripten 交叉编译。

| 包 | 用途 | 对应 JMP 平台 | NeedsCompilation | webR 可行性 |
|---|---|---|---|---|
| `DoE.base` | 全因子 / 正交表 | DOE 基础 | **no** | 高 |
| `conf.design` | 因子设计构造（DoE.base 依赖） | DOE 基础 | **no** | 高 |
| `FrF2` | 2 水平部分因子设计 + 别名结构 + 半正态图 | Screening Design | **no** | 高 |
| `rsm` | 响应面（CCD / Box-Behnken / 最陡上升 / 典型分析） | Response Surface | **no** | 高 |
| `qcc` | Shewhart 控制图 / CUSUM / EWMA / OC 曲线 / Pareto | Control Chart Builder | **no** | 高 |
| `ggDoE` | DOE 图形（别名矩阵 / 半正态图 / 主效应交互效应 / 等高线） | DOE 可视化 | **no** | 高 |
| `desirability2` | Derringer-Suich 期望函数多目标优化 | Profiler 期望值优化 | **no** | 高 |
| `AlgDesign` | D-/A-/I-optimal 算法设计（Federov 交换） | **Custom Design** | yes | ✅ **S6 实测通过**（WASM 二进制含 `AlgDesign.so`） |
| `igraph` | 图算法（FrF2 的硬依赖） | — | yes | ✅ **S3 实测通过**；r-wasm 官方维护 webr 分支 |

### 1.2 两个曾需重点说明的风险点（2026-11-26 均已实测解除）

**风险 A：`AlgDesign` 需要编译 —— 已解除。**
JMP 的招牌功能是 **Custom Design**（按用户约束生成 I-optimal 设计），对应开源实现是 `AlgDesign`，CRAN 上 `NeedsCompilation: yes`。

- **实测（S6，GO 11/11）**：`repo.r-wasm.org` 已提供编译好的 WASM 二进制
  （`Built: wasm32-unknown-emscripten`，含 `AlgDesign.so` 37KB），经 NODEFS 挂载可正常 `dyn.load`。
  D/I-optimal 生成、混合水平+交互+类别因子、256 点候选集、`eval.design()` 评估、
  以及「设计 → `lm()` 二阶模型」闭环全部通过（rank=10/10，R²=0.9978）。
- **结论**：**Custom Design 可复用现成算法，无需自研 Federov 交换算法**，Phase 2 排期确定。
- 原缓解方案（自行 Emscripten 编译 / Python `DoEgen` Plan B / MVP 先不做）已不再需要。

**风险 B：`igraph` 是 `FrF2` 的硬依赖，且需编译 —— 已解除。**
这不是未知风险——`igraph/rigraph` issue #1284「Ensure igraph can be installed in webR」中，webR 核心维护者 georgestagg 已明确：

> "I have updated the igraph package on the webR binary Wasm package repository, so you can try this version out for yourself at https://webr.r-wasm.org/latest/ now using `webr::install("igraph")`."

且 r-wasm 组织维护着 `github.com/r-wasm/rigraph` 的 `webr` 分支（LAPACK 符号 `int` → `void` 返回类型、Fortran 隐藏字符长度参数等坑已被解决）。
**实测（S2/S3）**：`igraph.so`（3.4MB）/ `Matrix.so`（1.3MB）通过 NODEFS 正常加载，
15/15 包可 `requireNamespace`，`library(FrF2)` 及别名结构相关路径可用。

### 1.3 webR 生态规模

- webR 0.2.0（2023-08）起，公开 WASM 仓库 `repo.r-wasm.org` 提供 **10,324 个包（约 51% CRAN）**。
  **2026-11-26 实测**：`bin/emscripten/contrib/4.6` 索引已增至 **24,640 个包**（7.29MB）
- 判定标准：Emscripten 成功编译该包及其全部前置依赖即为「available」，**官方明确说明这些包未经详细测试**
- 因此 Phase 0 必须实测，不能只看仓库有没有（实测结论见 `PHASE0_SPIKE_REPORT.md`：33 个包全部可用）

### 1.4 webR 已知限制（直接影响架构设计）

| 限制 | 影响 | 应对 |
|---|---|---|
| 不能从源码安装包，只能用预编译 WASM 二进制 | 缺包时需自建仓库 | 搭建私有 WASM repo（r-universe.dev 或 GitHub Pages） |
| `system()` 不可用 | 无法调用外部进程 | 无需，纯计算场景 |
| WASM 内存上限 4GB（浏览器可能更严） | 大数据集受限 | DuckDB-Wasm 承担数据层，只把聚合结果送进 R |
| 首次加载运行时 ~10MB（gzip 后） | 冷启动慢 | 包随应用打包到本地，不走 CDN |
| 移动端 RAM 受限 | 不影响 | 本项目为 PC 软件 |
| 每个 session 需重新 attach 包 | 启动流程 | 启动时批量 `library()`，包体本地化后无网络开销 |

---

## 2. GitHub 可借鉴开源项目清单

按「能直接拿来用」到「只能参考思路」分四档。

### 2.1 A 档：可直接作为依赖或深度复用

| 项目 | Star | 许可证 | 用途 | 借鉴方式 |
|---|---|---|---|---|
| **r-wasm/webr** | — | **JS 库 MIT；R WASM 二进制 GPL-3** ⚠️ | R 编译到 WASM，浏览器内跑 R | **直接依赖**。统计计算主引擎。**注意分发合规，见 §7.0** |
| **pyodide/pyodide** | — | MPL-2.0 | Python 编译到 WASM | **直接依赖**。ML / 可靠性引擎 |
| **duckdb/duckdb-wasm** | — | MIT | 浏览器内 OLAP，TPC-H 比 JS 方案快 10–100×，支持 Parquet/CSV/JSON，2.0 支持溢出到磁盘跑超内存查询 | **直接依赖**。数据层引擎 |
| **finos/perspective** | 11.2k | Apache-2.0 | C++/WASM 流式查询引擎 + 虚拟滚动数据网格 + WebGL 图表 + Web Components + Apache Arrow | **直接依赖或深度参考**。数据表格与实时联动 |
| **vega/vega-lite** | — | BSD-3 | 交互式图形语法，`selection` + 条件编码原生支持 linked brushing / cross-filtering（InfoVis 2016 最佳论文） | **直接依赖**。图表联动语义层 |
| **MatthewReid854/reliability** | 440 | LGPL-3.0 | Weibull 混合 / 竞争风险 / DS / ZI 模型、24 种加速寿命测试模型、应力-强度干涉、可靠性增长、可修复系统 MCF/ROCOF | **直接依赖**。可靠性模块 |
| **CamDavidsonPilon/lifelines** | 2,619 | MIT | 纯 Python 生存分析，支持右/左/区间删失 | **直接依赖**。生存分析 |

### 2.2 B 档：架构与交互范式的最佳参考

| 项目 | 许可证 | 值得学什么 |
|---|---|---|
| **jamovi/jamovi** | AGPL-3.0 | **最重要**。① 两阶段执行模型：`.init()` 只搭结果表骨架（必须近乎瞬时），`.run()` 才做重计算——这是「改选项即时响应」不卡顿的核心机制，直接照搬。② `.omv` 单文件格式（数据 + 分析选项 + 结果一体），对应 JMP 的 `.jmp`。③ 模块系统 `jmv`/`jmvcore`（R6 类 + YAML 定义 UI 与结果结构）。④ 原生读 SPSS `.sav` / SAS `.sas7bdat` / Stata `.dta`。**注意 AGPL，不要 fork 代码，只借鉴设计** |
| **jasp-stats/jasp-desktop** | AGPL-3.0 | ① C++ 壳 + Qt/QML 界面 + R 计算 + **JSON-RPC 通信**的清晰分层。② 数据懒加载（只在需要时加载子集）。③ 结果缓存系统——调参时不重算整条链路。④ QML 声明式界面描述分析选项面板。**同样 AGPL，只借鉴不 fork** |
| **dollodart/graph-builder** | GPL-3.0 | **直接对标 JMP Graph Builder 的开源实现**（Python + Dash + Plotly）。虽然只有 6 star、17 commits，但概念验证价值极高：多 X/Y 共享子图、类别变量复合轴、图例分组平滑拟合、连续变量按分位数离散化着色、动态筛选器（连续变量范围 + 离散变量集合）。用 Dash 的 pattern-matching callbacks 实现动态 UI 元素。**建议通读源码，然后自己重写**（GPL + 代码质量一般） |
| **rushadnihal/myco-rsm** | — | **几乎就是 JMP 的 DOE + Profiler 流程**（R Shiny）：随机化/分块/可旋转 CCD 与 BBD 设计生成 → 二阶多项式拟合 → 对纯误差做 lack-of-fit F 检验 → 典型分析（驻点、二次型矩阵特征值、曲面分类 max/min/saddle/ridge、检查最优是否在试验域内）→ 一阶拟合时给最陡上升路径 → **Derringer-Suich 期望函数多目标优化（max/min/target + 权重）返回带 95% 预测区间的最优点** → plotly 交互式等高线与 3D 曲面。**这是我们 Profiler 模块的完整蓝本** |
| **jpch26/DOE-Maker** | GPL-3.0 | Shiny DOE 设计生成器，封装 `fac.design()` / `FrF2()` / `bbd()` / `ccd()`。参考价值在于 UI 流程：选设计类型 → 设参数 → 右侧表格自动更新 → 导出 CSV |
| **DailyDana/process-capability-analyzer** | Apache-2.0 | **质量模块的金矿**。SPC + Capability + Gage R&R 三合一，且**每个方法都对已发表结果验证到小数位**（对 Minitab / SAS / BPI 的两个参考研究）。含：Type-1 量具研究（Cg/Cgk，Bosch Booklet 10 / VDA 5，含偏差 t 检验、分辨率检查、置信区间）、交叉 Gage R&R（ANOVA 随机效应 F 检验 + AIAG 均值极差法，交互项按惯例 p>0.25 时合并，输出 EV/AV/GRR/PV/%Contribution/%StudyVar/%Tolerance(k=6 或 5.15)/ndc）、X̄-R / X̄-S / I-MR（用标准控制图常数算 3σ 限，**不是**简单 ±3·stdev）、p/np/c/u 属性图（样本量变化时逐样本算限）、Phase I / Phase II（从稳定基期定限、剔除已记录可指定原因、用冻结限判后续数据）、lag-1 自相关独立性检查（相关时警告限过窄）、完整 Western Electric 4 规则 + Nelson 8 规则（严格区分 WE4=8连 ≠ Nelson N2=9连，结构化输出违规：规则 ID/名称/受影响观测/方向/解释，保留重叠违规）、Cp/Cpk（组内 σ）vs Pp/Ppk（整体 σ）严格不混用、非正态能力指数、每个指标可展开成公式 + 代入数字 + 出处。**Apache-2.0，可直接复用代码** |
| **j4ggr/DaSPi** | — | Python 六西格玛四大工作流：Gage R&R（MSA Type-1 + Type-2）、Capability（Cp/Cpk/Pp/Ppk）、Root Cause（ANOVA/回归 + 递归消除自动选因子）、SPC。设计哲学值得学：**每个工作流 <20 行代码出「可视化 + 文字解读」**，解读是工程结论而非只是图（例："Cpk = 1.09 基于组内 σ，但 I 图显示 N1 离群点和 N2 连串——在过程稳定前这个 Cpk 不是未来性能的可信证据"） |

### 2.3 C 档：单点算法参考

| 项目 | Star | 许可证 | 用途 |
|---|---|---|---|
| `carlosqsilva/pyspc` | 244 | GPL-3.0 | SPC 图表库，变量型/属性型/多变量 |
| `petermgates/py-qcc` | — | — | R `qcc` 的 Python 移植，含 Nelson + Western Electric 规则 |
| `EarthByte/DoEgen` | — | — | 基于 `OApackage` 的 DOE 最优设计生成 + 效率评估 + **最优 runsize 查找器** + 实验结果分析（因子重要性排序、RMSE 加权 top-N 因子值）。文档里有与 JMP/pyDOE2/OApackage 的横向对比表 |
| `sebp/scikit-survival` | 1,330 | — | sklearn 风格的生存分析，与 ML pipeline 集成好 |
| `havakv/pycox` | 1,006 | — | PyTorch 深度生存分析 |
| `tomliptrot/predictshine` | 9 | — | R Shiny 交互式预测（线性/逻辑/Cox），拖动自变量看预测变化——**Profiler 的极简版**，思路可参考 |
| `topepo/desirability` | — | GPL-2 | Derringer-Suich 期望函数原始实现（`dMax`/`dMin`/`dTarget`/`dBox`/`dArb`/`dOverall`），Max Kuhn 出品 |
| `huft-jonathan/pyshewhart` | 34 | — | Shewhart 控制图 |
| `KensoBI/spc-chart` | 13 | — | Grafana 面板插件，Xbar-R/Xbar-S/XmR 自动算控制限（TypeScript） |
| `cnicholas/processbehavior` | 4 | — | Bishop 方差分析系统，XmR/Xbar-S/直方图/能力/Taguchi 损失，对已发表参考结果验证 |

### 2.4 D 档：R 包生态（通过 webR 调用）

DOE 与质量的实际计算全部走这些包，**不需要移植代码**：

- **DOE**：`DoE.base`、`FrF2`、`FrF2.catlg128`、`rsm`、`conf.design`、`AlgDesign`、`lhs`、`DoE.wrapper`、`mixexp`、`planor`、`SOAs`、`CAs`
- **质量/SPC**：`qcc`、`IQCC`、`SixSigma`、`qicharts2`、`AcceptanceSampling`
- **建模**：`lme4`、`glmmTMB`、`car`、`multcomp`、`emmeans`、`MASS`、`nlme`
- **多元**：`FactoMineR`、`cluster`、`mclust`、`pls`
- **时间序列**：`forecast`、`fable`、`tsibble`
- **可视化**：`ggplot2`、`ggDoE`、`plotly`、`htmlwidgets`、`DT`
- **生存**：`survival`、`survminer`

---

## 3. 修订后的技术选型

| 层 | v1 方案 | **v2 方案（修订）** | 修订理由 |
|---|---|---|---|
| 桌面壳 | Tauri（首选）/ Electron | **Tauri 2** | 壳 3–15MB vs Electron 85–200MB；空闲内存 30–80MB vs 100–300MB；冷启动 0.2–0.5s vs 1–2s。**但注意**：Tauri 用系统 WebView（Win 上 WebView2），渲染一致性弱于 Electron。因为我们重度依赖 WASM + WebGL，**需要 Phase 0 实测 WebView2 的 WASM 性能与 memory64 支持**；若不达标则回退 Electron |
| 前端 | React + TS | **React + TypeScript + Vite** | 不变 |
| 数据表格 | 未定 | **FINOS Perspective**（Apache-2.0） | 虚拟滚动可编辑数据网格 + WASM 查询引擎 + Apache Arrow，JMP 数据表的直接对应物 |
| 数据引擎 | SQLite + Parquet | **DuckDB-Wasm**（MIT）+ 本地 Parquet | 比 SQLite 更适合 OLAP；2.0 支持溢出磁盘跑超内存查询；原生读 Parquet/CSV/JSON |
| 图表 | D3/Plotly/ECharts | **Vega-Lite**（BSD-3）为主 + Plotly.js 补充 3D | Vega-Lite 的 `selection` 语义是 linked brushing 的正解，声明式规格便于序列化进 `.mjmp` 文件；3D 曲面/等高线用 Plotly |
| **统计引擎** | **Python scipy/statsmodels** | **webR（主）+ Pyodide（辅）** | **重大修订**。R 在 DOE/质量工程上远比 Python 成熟，且关键包均为纯 R |
| DOE | pyDOE2 / 自建 | **R: `DoE.base`+`FrF2`+`rsm`+`AlgDesign`** | 不自建，直接用 CRAN 实现，统计正确性有上游背书 |
| 质量工程 | 自建 | **R: `qcc` + 复用 `process-capability-analyzer`** | Apache-2.0 可直接复用，且已对 Minitab/SAS 验证到小数位 |
| ML | sklearn/xgboost | **Pyodide: sklearn**（xgboost/lightgbm 需 WASM 构建，Phase 3 再评估） | sklearn 在 Pyodide 完整可用；xgboost 有 C++ 扩展，需确认 WASM 构建 |
| 可靠性 | 自建 | **Pyodide: `reliability` + `lifelines`** | 不自建。`reliability` 覆盖 24 种加速寿命模型，正是 JMP Reliability 平台的核心 |
| 脚本系统 | JS / Python DSL | **R 脚本（主）+ JS 宏（辅）** | 学 jamovi：分析可导出对应 R 代码。**这比自造 DSL 好得多**——用户能直接拿去 RStudio 复现，且我们零维护成本 |
| 文件格式 | 未定 | `.mjmp`（ZIP 容器：数据 + 分析规格 + 结果 + 布局） | 学 jamovi `.omv` 单文件可复现 |

### 3.1 为什么双引擎而不是纯 R 或纯 Python

- **纯 R 不够**：`reliability`（Weibull 混合/加速寿命 24 模型）和 sklearn 生态在 Python 侧更强；`process-capability-analyzer` 的 Python 实现已验证到小数位，重写不划算。
- **纯 Python 不够**：DOE 是 JMP 的命脉，Python 侧 `pyDOE3` 只做**设计生成**，缺**分析**（别名结构、半正态图、GWLP、典型分析、最陡上升）。R 的 `FrF2`/`rsm` 是完整的。
- **双引擎成本可控**：两者都是 WASM，都通过 Arrow/JSON 交换数据，共享同一个数据层。真正的成本是两个运行时各 ~10MB 的包体和内存占用。

---

## 4. 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                    Tauri 2 桌面壳（Rust）                     │
│      窗口 / 文件系统 / 菜单 / 自动更新 / 本地包资源托管         │
├──────────────────────────────────────────────────────────────┤
│                  UI 层  React + TypeScript                    │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Graph      │ │ Profiler   │ │ DOE      │ │ 脚本编辑器   │  │
│  │ Builder    │ │ (期望值/   │ │ 设计向导 │ │ (R / JS)    │  │
│  │            │ │  蒙特卡洛) │ │          │ │             │  │
│  └────────────┘ └────────────┘ └──────────┘ └─────────────┘  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 数据表格 (Perspective) │ 结果面板 │ 联动状态管理       │    │
│  └──────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│           可视化引擎  Vega-Lite (selection/联动) + Plotly (3D) │
├──────────────────────────────────────────────────────────────┤
│              分析编排层  Platform Router + 两阶段执行           │
│         .init() 搭骨架（瞬时） / .run() 重计算（异步）          │
│              结果缓存 · 增量更新 · 依赖图追踪                   │
├───────────────────────────┬──────────────────────────────────┤
│   webR (WASM)  主统计引擎  │   Pyodide (WASM)  ML / 可靠性     │
│  DoE.base FrF2 rsm qcc     │  sklearn  reliability  lifelines │
│  lme4 car MASS survival    │  scipy  statsmodels              │
│  ggplot2 ggDoE desirability│                                  │
├───────────────────────────┴──────────────────────────────────┤
│           数据层  DuckDB-Wasm + Apache Arrow + Parquet        │
│      CSV/XLSX/SAS/SPSS/Stata 导入 · ODBC · 聚合下推           │
└──────────────────────────────────────────────────────────────┘
```

**三条架构原则：**

1. **数据不进 WASM，聚合结果才进。** DuckDB-Wasm 承担全部大数据处理，通过 Arrow 零拷贝把**已聚合/已筛选**的结果送进 R/Python。这样绕开 WASM 4GB 内存上限，也是 JMP 处理百万级数据的等效策略。
2. **联动状态是全局单一数据源。** 所有图表订阅同一个 selection store（学 Vega-Lite 的 `resolve='global'/'union'/'intersect'` 语义）。框选 → 更新 store → DuckDB 重查 → 所有视图刷新。这是 JMP 灵魂的技术实现。
3. **两阶段执行保证 UI 永不卡死。** 照搬 jamovi：改选项时 `.init()` 立刻渲染表格骨架和正确表头，`.run()` 在 Worker 里异步算完再填数字。

---

## 5. 分阶段开发计划

### Phase 0 — 技术验证 Spike（**必须先做**，1–2 周）

不写产品代码，只验证「如果不成立就要换路线」的假设（S7 为条件项）。

> **进度（2026-11-26，Phase 0 完整放行）**：S1 / S2 / S3 / S4 / S6 **全部 GO**，
> 4 个验证脚本共 **39 项检查全绿**（`npm run verify`，约 7 秒，无需 Rust / R / 外网）。
> 详见 `docs/PHASE0_SPIKE_REPORT.md` 与 `spike/results/*.json`。
> 下表通过标准已按实测修正（见报告 §5「原计划的三处错误」及 §6.4 / §6.5）。
> **仅剩 S5、S1 的 Tauri 变体、S7（条件项）未做**——它们属于 Phase 1 或仅在
> 选择商业闭源路线时才需要，不构成 Phase 1 的启动阻塞。

| # | 验证项 | 通过标准（已按实测修正） | 实测结论 | 失败的 Plan B |
|---|---|---|---|---|
| S1 | webR 能启动并跑 R | 冷启动 < 5s，`lm()` 正常，图形设备可用 | **PASS** 8/8：500ms、`lm(mpg~wt)` 对齐小数 6 位、cairo/png/svg 可用 | 回退 Electron |
| S2 | **DOE 包链路可用** | 预置 WASM 包挂载后 `pb(nruns=12, nfactors=7)` / `FrF2(16,7)` / `rsm::ccd()` 均能出设计矩阵 | **GO** 7/7：PB、FrF2、CCD、L9 正交表全产出 | 自建私有 WASM repo 编译；或 Python `DoEgen`+`pyDOE3` |
| S3 | **igraph 依赖不炸** | `library(FrF2)` 加载成功，编译型 `igraph.so` / `Matrix.so` 动态库可加载 | **GO**：15/15 包可加载（含两个编译型 `.so`） | patch FrF2 去掉 igraph 路径 |
| S4 | **qcc 质量链路可用** | 用 `qcc.groups()` 构造分组矩阵（**`qcc()` 的 `sample=` 参数无效**）出 X̄-R 图；控制限用 AIAG/ASTM 公开常数跨语言独立复算比对 | **GO** 13/13：控制限偏差 2.3e-6、Cp/Cpk 偏差 <3.4e-10、WE 判异命中、真实写出 20KB 控制图 PNG | 复用 Python `process-capability-analyzer` |
| S5 | **联动性能达标** | 100 万行数据，框选后全视图刷新 < 100ms | **GO（2026-11-27）7/7**：DuckDB-Wasm 1.32.0 / 100 万行 / 3 视图，全链路 p50 35.56ms、p95 49.37ms；SQL 谓词与纯 JS 匹配独立复算一致。**已知缺口**：精确 union 双框选 p50 141.46ms 超标 → 2 单位分箱预聚合降到 3.46ms（边界计数误差 9.32%，近似）。见 `docs/PHASE1_SKELETON.md` §9 | 降低联动粒度 / 预聚合（**已验证可行**） |
| S6 | `AlgDesign` 可用性（决定 Custom Design 排期） | 能生成 D/I-optimal 设计、处理混合水平+交互、评估设计、并完成「设计→`lm()` 建模」闭环 | **GO** 11/11：I-optimal、256 点候选集、10 个系数全部可估（rank=10/10，R²=0.9978）⇒ **Custom Design 可复用现成算法，无需自研** | Custom Design 推迟到 Phase 3+ |
| S7 | **架构隔离可行性**（⚠️ **仅当选择商业闭源路线时必做**，见 §7.4） | Tauri sidecar 独立 R 进程 + Arrow IPC 下，Profiler 拖动滑块单次往返 < 16ms（60fps） | 条件项，未做（选路线 A 则不需要） | 隔离不达标 ⇒ 商业闭源路线在技术上不成立，必须回到路线 A/B |

> S7 的必要性：GPL 合规要求「真实进程隔离」，而 Profiler 的实时交互需要每帧往返。这两件事可能物理上冲突——**必须在写第一行业务代码前测出来**，否则架构选定后再改成本极高。选择路线 A（AGPL + 同地址空间 `evalR()`）则不需要 S7。

**⚠️ 架构结论（实测推翻原假设）**：**不要在运行时联网安装 R 包**。
`repo.r-wasm.org` 实测仅 0.08MB/s，且 webR 默认 `downloadTimeout=0`（同步 XHR 无超时）
会永久挂死；即便改用本地 HTTP repo，连续装到第 20+ 个包后 `download.file` 仍会失效。
正确做法是把预编译 WASM 包**随安装包分发**，运行时用 `NODEFS` 挂载到虚拟 FS
（挂载耗时 < 1ms，全链路 2.7s）。这同时消除运行时外网依赖——与 JMP 的行为一致。

**交付物**：一份验证报告 + 一个能跑的最小 demo（Tauri 窗口里嵌 webR，输入 CSV，出一张联动散点图 + 一个 FrF2 设计表）。

**这一步是整个项目的 go/no-go 关口。**

---

### Phase 1 — MVP：交互探索（3–4 个月）

> **进度（2026-11-26）：骨架已起，桌面窗口尚未跑通。**
> Rust 1.100.0 与 Tauri 2 骨架（前端 + Rust 侧 + `Cargo.lock` 432 包）已落地，
> `vite build` / `tsc` / `cargo metadata` / `cargo fetch` / Phase 0 回归全绿；
> **缺 Microsoft C++ Build Tools（MSVC + Windows SDK）** 导致
> `cargo check` / `tauri dev` 的链接阶段失败（已用最小 `rustc` 探针确认），
> WebView2 下的 S1 变体 / memory64 探测因此尚未实测。
> 环境实测、目录结构、踩坑与命令速查见 **`docs/PHASE1_SKELETON.md`**。
>
> **进度追加（2026-11-27）**：在不依赖 MSVC 的前端 / Node 侧完成了
> **联动内核 + S5 百万行基准**。`src/lib/selection.ts` 是全局单一数据源
> （global / union / intersect + SQL 谓词编译 + 纯 JS 交叉验证），
> `spike/scripts/s5_linked_brushing.mjs` 用 DuckDB-Wasm 1.32.0 实测
> **GO**：100 万行 / 3 视图，p50 35.56ms、p95 49.37ms（验收线 100ms）；
> 前端 `LinkedBrushingDemo` 已可运行（SSR 冒烟 7/7）。
> `npm run verify:all` 全绿。精确 union 多框选仍超 100ms，
> 已验证「预聚合」对策可降到 3.46ms，代价是边界近似误差 9.32%。
> 详见 `docs/PHASE1_SKELETON.md` §9 与 `docs/DEPENDENCY_LICENSES.md`。
> **注意**：S5 是 Node / WASM 侧实测，真实 WebView2 窗口内的性能仍待 MSVC 补齐后验证。

目标：做出「一用就知道是 JMP 那味儿」的东西。只做交互，不做深度统计。

- **数据层**：CSV / XLSX / Parquet 导入 → DuckDB-Wasm；数据表格（Perspective）含虚拟滚动、列类型推断、排序筛选、计算列
- **数据清洗**：缺失值/离群值/重复值检测面板，一键批量处理（学 JMP 的 Screen data）
- **Graph Builder**（核心）：拖拽变量到 X/Y/Color/Size/Group/Overlay 槽位 → 即时出图。支持散点、箱线、直方、条形、线、热力、散点图矩阵
- **Linked Brushing**（灵魂）：任意图框选 → 数据表高亮 + 所有其他图同步高亮/筛选。支持 global / union / intersect 三种解析模式
- **基础统计**：Distribution（描述统计 + 直方 + 分位数 + 正态性检验）、Fit Y by X（t 检验 / 单因素 ANOVA / 卡方）、相关矩阵
- **单响应 Profiler**：拟合线性模型后拖动因子滑块看预测响应变化
- **`.mjmp` 单文件保存**：数据 + 分析规格 + 结果 + 布局
- **导出**：交互式 HTML 报告（无需装本软件即可查看筛选）、PNG/SVG

**验收**：拿一个真实工业数据集（如半导体封装工艺参数 vs 良率），10 分钟内完成十几个参数的关联探索——这是 JMP 中文官网宣称的标杆场景。

---

### Phase 2 — DOE 与质量工程（3–4 个月）

**这是 JMP 用户真正付费的理由，也是竞品最弱的地方。**

- **DOE 设计向导**
  - 筛选设计：全因子 / 2 水平部分因子（`FrF2`）/ Plackett-Burman / Definitive Screening
  - 响应面：CCD / Box-Behnken（`rsm`），支持随机化、分块、可旋转
  - 混合设计、Taguchi 参数设计（`DoE.base::param.design`）
  - **Custom Design**（✅ S6 已放行：`AlgDesign` 的 D/I-optimal 可直接复用，无需自研交换算法）
  - 设计诊断：别名结构表、广义字长模式 GWLP、模型矩阵相关性图（`ggDoE`）
  - 运行表导出 CSV（给车间/实验室用）
- **DOE 分析**
  - 主效应图 / 交互效应图（全因子同时显示）
  - 半正态图 / 全正态图 + 显著性判定（`FrF2::DanielSemiLenth`）
  - Pareto 效应图、立方体图（三因子联合效应）
  - 二阶模型拟合 + **lack-of-fit F 检验**（对纯误差，需重复中心点）
  - **典型分析**：驻点、二次型矩阵特征值、曲面分类（max/min/saddle/ridge）、最优是否在试验域内
  - **最陡上升路径**（一阶拟合且最优在域外时）
- **多响应 Profiler + 优化**
  - Derringer-Suich 期望函数（max/min/target/box + 权重）→ 综合期望值最优点 + 95% 预测区间
  - 蒙特卡洛模拟（含噪声因子随机输入）→ 稳健参数设计
  - What-if 场景分析
- **质量工程**（大量复用 `process-capability-analyzer`，Apache-2.0）
  - Control Chart Builder：X̄-R / X̄-S / I-MR（用标准控制图常数算 3σ 限）、p / np / c / u
  - 判异规则引擎：完整 Western Electric 4 规则 + Nelson 8 规则，结构化输出违规详情
  - Phase I / Phase II：从稳定基期定限 → 冻结 → 判后续数据
  - 过程能力：Cp/Cpk（组内 σ）vs Pp/Ppk（整体 σ）严格区分，非正态能力指数
  - **MSA**：Type-1 量具研究（Cg/Cgk，Bosch/VDA 5）、交叉 Gage R&R（ANOVA + AIAG 均值极差法，输出 EV/AV/GRR/PV/%Contribution/%StudyVar/%Tolerance/ndc）
  - Pareto 图、因果图、规格限管理
- **多元方法**：PCA、因子分析、聚类（层次/K-Means/正态混合）、判别分析、PLS

**验收**：`process-capability-analyzer` 的 AIAG 参考研究数据，我们的 Gage R&R 输出与其发表结果**小数位一致**。

---

### Phase 3 — 预测建模与可靠性（2–3 个月）

- **ML 平台**（Pyodide + sklearn）：决策树、Bootstrap Forest、Boosted Tree、KNN、Naive Bayes、神经网络
- **模型比较**：交叉验证、验证集、ROC/AUC、混淆矩阵、模型筛选（Response/Predictor Screening）
- **时间序列**：ARIMA / 季节性 ARIMA / 传递函数（R `forecast`/`fable`），自动模型选择 + 预测
- **可靠性与生存**（Pyodide + `reliability` + `lifelines`）：
  - 寿命分布拟合（Weibull / 对数正态 / 指数 / Gamma，含右删失）
  - Weibull 混合模型、竞争风险、缺陷子群 DS/ZI/DSZI
  - 概率图（各分布专用概率纸）、QQ/PP 图、拟合优度（AICc/BIC/AD/对数似然）
  - 加速寿命测试 24 种模型（4 分布 × 6 寿命-应力模型）
  - 应力-强度干涉失效概率
  - 可靠性增长、最优更换时间、序贯抽样图
  - 可修复系统 MCF / ROCOF
  - Kaplan-Meier / Nelson-Aalen、Cox 比例风险、参数生存模型
- **高级建模**：非线性回归（自定义损失函数）、函数型数据探索（B 样条 / P 样条 / Fourier 基）、高斯过程、混合效应模型（`lme4`）

---

### Phase 4 — 脚本、扩展与打磨（2–3 个月）

- **脚本自动化**：每个分析可导出对应 R 代码（学 jamovi 的 syntax mode）；内置 R 编辑器，数据已加载可直接跑；分析流程可存为脚本一键重放
- **文本探索**：分词、词频、词云、文本聚类（对应 JMP Text Explorer）
- **消费者研究**：Choice / MaxDiff / Uplift / Categorical
- **插件系统**：允许第三方用 R 或 JS 扩展分析平台（学 jamovi module library）
- **外部引擎互通**：连接 SAS / R / Python / MATLAB（对应 JMP Analytics Hub）
- **协作分享**：交互式 HTML/Web 报告，接收方无需装软件即可筛选查看
- **性能与稳定性打磨**、国际化（中/英）、文档与教程

---

## 6. 风险登记册

| # | 风险 | 等级 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | webR 中 DOE 包链路不可用 | ~~高~~ → **已解除** | 动摇整个技术路线 | **2026-11-26 实测 GO**：33 个预置 WASM 包经 NODEFS 挂载全部可加载（含 igraph/Matrix/AlgDesign 编译型动态库），FrF2/rsm/DoE.base/qcc/AlgDesign 全部可用。见 `docs/PHASE0_SPIKE_REPORT.md` |
| R2 | WASM 双运行时包体过大、内存吃紧 | **高** | 冷启动慢、大项目崩溃 | 按需懒加载引擎（只做 EDA 时不加载 Pyodide）；包体本地化；DuckDB 承担数据层避免大数据进 R |
| R3 | WebView2 的 WASM/WebGL 性能不达标 | 中 | 联动卡顿，丢失核心体验 | S1 的 Tauri 变体 + S5 归入 Phase 1 实测；回退 Electron（代价：包体 +150MB）。**2026-11-27**：S5 已在 Node / DuckDB-Wasm 侧 GO（p95 49.37ms），证明数据链路不是瓶颈；但桌面窗口因缺 MSVC Build Tools 未跑通，**WebView2 内的 S1 变体 / memory64 实测仍待补** |
| R4 | `AlgDesign` 不可用 → 没有 Custom Design | ~~中~~ → **已解除** | 缺失 JMP 招牌功能 | **2026-11-26 S6 实测 GO（11/11）**：含 `AlgDesign.so` 的 WASM 二进制可直接挂载；D/I-optimal、混合水平、256 点候选集、建模闭环全通过 ⇒ **无需自研交换算法** |
| R5 | xgboost/lightgbm 无 WASM 构建 | 中 | ML 能力弱于竞品 | sklearn 的 `GradientBoosting`/`HistGradientBoosting` 已够；或走 Tauri sidecar 跑原生 Python |
| R6 | **AGPL/GPL 传染** | **高** | 若采用同地址空间耦合又想闭源，被迫开源全部产品，商业模式不成立 | 见 §7。**首选路线 A（AGPL）**彻底规避；若坚持闭源，必须先做 S7 隔离验证 |
| R7 | 已核实：R 本体 GPL-2\|3、webR `r.wasm` **GPL-3**、DOE/质量包全 GPL（详见 §7.1 实测清单） | **高** | 分发合规；宽松许可证只覆盖数据层与图表层，核心价值模块无法闭源保护 | 按 §7.4 合规动作清单执行；`reliability` 为 LGPL 动态链接可用 |
| R8 | 统计结果与 JMP/Minitab 不一致 → 用户不信任 | **高** | 工业用户拒绝采用 | **已有 4 组可复现基准点**：`lm(mpg~wt)` 小数 6 位、X̄-R 控制限偏差 2.3e-6、Cp/Cpk 偏差 <3.4e-10、DOE→建模 R²=0.9978（见报告 §6.4/§6.5）。下一步固化进 CI 回归集，并补 `process-capability-analyzer` 的 Minitab 逐位比对 |
| R9 | 一人/小团队范围失控 | **高** | 做不完 | 严格 Phase 门禁；Phase 1 只做交互不做深度统计；Custom Design 已由 S6 放行，不再是「可砍的高风险项」 |
| R10 | 商业化路径不明 | 中 | 无收入 | JMP 年订阅报价制（未公开，业界约 $1000+/seat）。定位选择见 §8 |
| R11 | **运行时联网安装 R 包** | **高** | 首次启动挂死、外网依赖、不可分发 | repo.r-wasm.org 实测 0.08MB/s；webR `downloadTimeout=0` 同步 XHR 无超时会永久阻塞；本地 HTTP repo 也会在连续 20+ 包后失效。**对策：预编译 WASM 包随安装包分发 + NODEFS 挂载，运行时零外网**（挂载 <1ms） |
| R12 | **预置 WASM 包裁剪内置数据集**（实测 `qcc` 无 `pistonrings`） | 低–中 | 示例/演示数据缺失 | 产品自备示例工程与数据集；构建期把「包内 data/ 清单」纳入 `packages.lock` 校验 |

---

## 7. 许可证与商业模式

> **✅ 决策已定（2026-11-26）：路线 A —— `AGPL-3.0-or-later` + 先部署 CLA。**
> Phase 1 前唯一硬阻塞解除。架构确定为**同地址空间 `evalR()`**，
> **S7（独立 R 进程 + Arrow IPC 隔离验证）取消**。产品可免费提供，但合规靠
> 「全开源」而非「免费」——见 §7.5。决策依据见 §7.3–§7.5，
> 合规流水线见 §7.6，**CLA 签署流程已落地见 §7.7**（待律师定稿 + 远端首跑确认）。

### 7.0 概念澄清：这是两件不同的事，但被同一个约束绑在一起

**许可证（License）** = 法律条款，规定「别人拿到我的软件后，能做什么、必须做什么」。选 AGPL 意味着任何人分发衍生版本都必须同样开源；选 MIT 意味着别人可以闭源商用。

**商业模式（Business model）** = 怎么赚钱。**开源不等于不赚钱**，这是最容易误解的一点：

| 模式 | 含义 | 代表 |
|---|---|---|
| 纯闭源商业 | 不公开源码，按 seat 卖授权 | JMP、Minitab |
| 纯开源 | 全开源，靠捐赠/基金会/公司赞助活 | jamovi、JASP、Orange |
| **Open-core（开放核心）** | **核心开源免费，高级功能闭源收费** | GitLab、Grafana、Supabase |
| 开源 + 商业服务 | 软件免费，卖支持/托管/咨询 | Red Hat、Moodle |

**为什么这两个问题在本项目必须一起定**：因为我们打算复用的 DOE / 质量工程 R 包，本体就是 GPL（见 §7.1 实测清单）。GPL 会「传染」——如果我们的代码被认定与 GPL 代码构成「同一个程序」，那整个产品都必须以 GPL 发布，**闭源收费的商业模式在法律上就不成立了**。所以商业模式的选择反过来被许可证约束死了。

### 7.1 实测依赖链许可证清单（2026-11 逐个核对 CRAN 官方元数据）

| 组件 | 对应 JMP 能力 | 许可证 | 性质 |
|---|---|---|---|
| **R 本体** | 计算引擎 | **GPL-2 \| GPL-3** | 强 copyleft |
| **webR JS 库** | 浏览器内跑 R | MIT | 宽松 |
| **webR `r.wasm` 二进制** ⚠️ | 同上 | **GPL-3** | 强 copyleft。官方声明原文："To remain compatible with the GPL, the webR binaries are distributed under the GNU GPL Version 3" |
| `DoE.base` | DOE 基础 | **GPL (>= 2)** | 纯 R |
| `conf.design` | DOE 基础 | **GPL-2**（纯，见 §7.5.1）⚠️ | 纯 R |
| `FrF2` | Screening Design | **GPL-2 \| GPL-3** | 纯 R |
| `rsm` | Response Surface | **GPL-2 \| GPL-3** | 纯 R |
| `AlgDesign` | Custom Design | **GPL-2 \| GPL-3** | 需编译 |
| `igraph`（FrF2 硬依赖） | — | **GPL-2 \| GPL-3** | 需编译 |
| `qcc` | Control Chart Builder | **GPL-2 \| GPL-3** | 纯 R |
| `ggDoE` | DOE 图形 | MIT | 宽松 ✅ |
| DuckDB-Wasm / Vega-Lite / lifelines | 数据层 / 图表 / 生存 | MIT / BSD-3 / MIT | 宽松 ✅ |
| Perspective | 数据网格 | Apache-2.0 | 宽松 ✅ |
| Pyodide | Python 引擎 | MPL-2.0 | 宽松（文件级 copyleft）✅ |
| `reliability` | 可靠性 / ALT | LGPL-3.0 | 弱 copyleft |

> ⚠️ **v2 版本文档曾把 webR 标为 MIT，这是错的，已在本版修正。** 结论：**DOE 和质量工程这两条产品线，依赖链从 R 解释器到算法包，全部是 GPL。** 宽松许可证只覆盖数据层和前端图表层。

### 7.2 GPL 传染的判定标准：看耦合方式，不看用不用

FSF 官方 GPL FAQ 的原文标准（这是唯一权威依据）：

> 判断两个模块是一个程序还是两个程序，取决于**通信机制**（exec、pipes、rpc、共享地址空间内的函数调用等）和**通信语义**（交换了什么信息）。如果两个模块运行时在**共享地址空间**连接在一起，它们几乎构成一个组合软件。反过来，**pipes、sockets 和命令行参数**通常是两个不同程序通信的机制，因此这些模块正常应该是独立的程序。**但如果通信语义非常密切、交换复杂的内部数据结构，它们也会被认定为一个大程序的两个组合部分。**

对应到我们的架构，差别在于 webR 跑在哪：

| 耦合方式 | 事实描述 | GPL 判定倾向 |
|---|---|---|
| **同一 WASM 实例内 `evalR()`** | 我们的 JS/TS 代码与 R 在同一个地址空间，通过 `Shelter` 直接传递 R 对象引用 | **争议较大**：FSF 可能认定为「一个程序」，则整个产品须 GPL |
| **独立子进程 / Worker + IPC** | R 引擎跑在隔离进程或独立 Web Worker，双方只交换 JSON / Arrow 序列化数据 | **业界通行**：倾向认定为「两个独立程序」，自有代码可闭源 |

FSF 还明确说过：**包一层 wrapper 不解决问题**——"组合的整体仍必须按 GPL 授权"。所以不能靠写个「R 适配器类」规避，必须是真实的进程/内存隔离。

**注意一个例外**：JASP 的做法（C++ 壳 + R 子进程 + JSON-RPC）就是上表第二行的教科书实现。它虽然自己选了 AGPL，但那个分层本身是为隔离设计的。

### 7.3 三条可选路线

| | **路线 A：全开源 AGPL** | **路线 B：Open-core** | **路线 C：纯闭源商业** |
|---|---|---|---|
| 自有核心代码 | AGPL-3.0 全公开 | 核心 AGPL，高级模块闭源 | 全部闭源 |
| GPL 依赖处理 | 无风险（AGPL 与 GPL 兼容） | 需严格进程隔离 + 划定开/闭源边界 | **必须做到真实进程隔离**，否则有法律风险 |
| 能直接打包分发 `r.wasm` | ✅ | ✅（核心部分） | ⚠️ 只能作为独立组件分发并附 GPL 源码获取方式 |
| 赚钱方式 | 支持 / 咨询 / 企业托管版 | 高级功能订阅（协作、报告、行业模板、批量引擎） | Seat 授权 |
| 获客与信任 | 最快，工业用户敢用、能自己验证统计结果 | 中等 | 最慢，需销售团队，要对标 JMP/Minitab 的品牌 |
| 主要风险 | 竞对可白嫖全部代码 | 边界设计复杂，容易越界 | **法律风险 + 与 R 生态天然冲突** |
| 参考先例 | jamovi、JASP | GitLab、Grafana | JMP、Minitab |

**路线 C 的现实障碍**：想卖闭源授权，就得让用户完全感知不到 GPL 组件的存在——但我们最重要的差异化能力（DOE、质量工程）恰恰全部来自 GPL 的 R 包。这意味着商业价值最高的部分，法律上最难保护。而且 R 的 `r.wasm` 必须随产品分发，用户有权获得其源码，这在商业包装上很难解释。

### 7.4 建议

**推荐路线 A（AGPL-3.0）作为 Phase 1–3 的起点，并明确保留后续转 Open-core 的权利。** 理由：

1. **技术上最省事**——AGPL 与 GPL 兼容，R 生态可以随意整合，不用为进程隔离牺牲性能（`evalR()` 直传 R 对象比序列化 JSON 快得多，这对 Profiler 实时交互很关键）。
2. **对工业用户是最强卖点**——R8 风险（统计结果与 JMP/Minitab 不一致导致拒绝采用）的最佳解药就是「源码可审计」。制造业 QA 工程师对黑盒工具天然警惕，开源反而是信任背书。
3. **保留了商业化退路**——只要部署 **CLA（贡献者许可协议）**，未来可以把新增模块改成闭源授权转 Open-core；反之若一开始闭源，再想开源就要逐个找贡献者授权，几乎不可能。
   > 术语更正（§7.7）：本项目用的是**「保留版权 + 可再许可授权」的 CLA**，不是版权转让
   > （CTA, Copyright Transfer Agreement）。前者对贡献者更友好，且第 2 条的
   > sublicense / 换许可证授权已足以支撑转 Open-core，无需转让所有权。
4. **AGPL 而非 GPL 的原因**——如果做 Web 版（见 §附录 B 第 4 点），GPL 对「网络提供服务」不产生源码义务（SaaS 漏洞），AGPL 会。选 AGPL 才能防止竞对拿我们的代码开白嫖 SaaS。

**若最终要走商业闭源，则 Phase 0 必须新增一个验证项**：S7 — 架构隔离验证。即实测「Tauri sidecar 跑独立 R 进程 + Arrow IPC」的性能是否可接受。若 Profiler 拖动滑块需要每帧往返 IPC，性能可能不够，那时商业路线在技术上就已经不成立了。**这个必须在写第一行业务代码前测。**

**明确红线（无论选哪条路线都适用）：**

- ❌ **不 fork、不复制** `jamovi`、`jasp-desktop`（均 AGPL-3.0）的任何代码。只读文档和源码学设计模式（两阶段执行、模块系统、JSON-RPC 分层、单文件格式）。
- ❌ **不复制** `dollodart/graph-builder`（GPL-3.0）、`myco-rsm`、`DOE-Maker`（GPL-3.0）代码。通读思路后自己重写。
- ✅ **可直接复用代码**：`process-capability-analyzer`（Apache-2.0）、Perspective（Apache-2.0）、DuckDB-Wasm（MIT）、Vega-Lite（BSD-3）、lifelines（MIT）、`ggDoE`（MIT）、Pyodide（MPL-2.0，文件级隔离即可）。
- ⚠️ **必须作为运行时组件分发、不得静态整合进自有代码**：webR `r.wasm`（GPL-3）、全部 DOE/质量 R 包（GPL-2|3）。
- 📋 **合规动作清单**：① 每个发行包附 `THIRD-PARTY-NOTICES`，列全部 GPL 组件及源码获取 URL；② CI 里加 license 扫描（如 `license-checker` / `pip-licenses`），阻止 MIT/Apache 之外未登记的依赖混入；③ 若接受外部贡献，上线前先部署 CLA；④ **正式发布前请开源合规律师审一次**，本节内容基于 FSF 官方 FAQ 与 CRAN 元数据，不构成法律意见。

### 7.5 常见误解：做成「免费软件」就没有许可证问题吗？

**答：有，而且「免费」本身既不触发、也不豁免任何 GPL 义务。**

先分清两个词：**免费（free as in price）是定价**，**开源 / 自由（free as in freedom）是许可证**。GNU GPL FAQ 的立场很明确：GPL 允许你「不收费、收十块、五十块，甚至数百万」，同样允许免费分发；但**只要发生分发（convey）**，无论价格多少，以下义务全部触发：

| 情形 | 结论 |
|---|---|
| 仅自己 / 本公司内部使用，不对外分发 | GPL 基本未触发，无源码义务 |
| 对外分发 + 公开完整源码（AGPL-3.0 全开源） | **无冲突，即路线 A，最省事** |
| 对外分发 + 闭源（freeware，不给源码） | **冲突最大**：仍须提供全部 GPL 组件的对应源码（或三年书面要约）、保留版权声明、**不得用 EULA / NDA 限制用户再分发**；且若 UI 壳与 R 被认定「同一程序」，自有代码也被迫 GPL，闭源在法律上不成立 → 只能走 S7 真实进程隔离 |
| 只做 Web / SaaS，不分发二进制 | GPL 不因网络服务触发；但 **AGPL §13** 要求向网络用户提供源码，开源项目加个源码入口即可满足 |

> FSF 原文：「你可以不收费、收取十块、五十块，或甚至是数百万」；「GPL 是否允许使用保密协议发行软件？不」；「如果我收费发行 GPL 软件，我是否被要求同时也要免费公布该软件？不，但收到拷贝的人有权公开再发布」。**GPL 从不禁止收费，也从不因为免费而免除源码义务。**

**所以「做成免费软件」≈ 直接选路线 A**：免费只是定价，真正让它合规的是「AGPL-3.0 全开源」。反直觉的是，免费**闭源**反而是四条路里最麻烦的一条。若未来想收费，AGPL 照样可以卖拷贝 / 支持 / 托管，不需要改许可证。

#### 7.5.1 对本节前文的更正（2026-11-26 扫描随包 DESCRIPTION 后发现）

扫描 `spike/local-repo/library/*/DESCRIPTION`（33 个随安装包实际分发的 WASM 包）：

- `GPL (>= 2)` → 可升级到 GPLv3，与 AGPLv3 可组合：`FrF2` `rsm` `qcc` `DoE.base` `AlgDesign` `igraph` `Matrix` `lattice` `sfsmisc` `Rdpack` `gmp`；`numbers` / `estimability` 为 `GPL (>= 3)`
- `GPL-2 | GPL-3` 双许可 → 可选 GPLv3：`zoo` `lmtest` `MASS`
- **纯 `GPL-2`（无 or-later、无双许可）共 7 个**：`conf.design` `combinat` `sets` `polynom` `vcd` `scatterplot3d` `rbibutils`；`partitions` 只写 `GPL`（版本未注明，需人工确认）
- MIT / BSD-3：`magrittr` `glue` `vctrs` `rlang` `cpp11` `cli` `lifecycle` `pkgconfig` `colorspace`

⚠️ **FSF 明确「GNU AGPL 和 GPLv2 不兼容」**（gnu.org/licenses/license-list）；AGPLv3 与 GPLv3 则可按两证 §13 组合为单一项目（FAQ #AGPLGPL）。因此：

1. **§7.1 表格把 `conf.design` 标为 `GPL-2 | GPL-3` 不准确**——随包分发的是纯 GPL-2。
2. **§7.3「AGPL 与 GPL 兼容」应更正为「与 GPLv3 兼容、与 GPLv2 不兼容」**。
3. **路线 A 仍然成立**，依据是 GPLv2 §2 的 *mere aggregation* 例外与 FSF FAQ「只是把两个程序安装到同一系统，许可证不必兼容，因为安装不等于合成一个大程序」。我们的 Phase 0 架构天然符合：33 个 R 包是 `library/` 下**独立的标准 R 包目录**，运行时由 R 自己 `library()` 动态加载，**不链接进自有二进制**（webR 官方 repo 亦如此分发）。合规要求就是 §7.4 已写的那条红线：作为**独立运行时组件**分发、不得静态整合。
4. 新增动作：`packages.lock` 记录每个包的 **License 字段**并纳入 CI 断言，**阻止新引入 GPL-2-only 包**（或强制人工复核）；`THIRD-PARTY-NOTICES` 逐包列出许可证、版本、校验和与源码获取 URL，GPL-2-only 包单独标注「独立组件，未与自有代码合并」。**合规以随包分发的 DESCRIPTION 为准，不以 CRAN 网页表述为准。**

> 以上基于 FSF 官方 FAQ / 许可证列表与随包 DESCRIPTION，**不构成法律意见**；正式发布前仍须按 §7.4 请开源合规律师审阅。

### 7.6 合规流水线（2026-11-26 已落地）

| 资产 | 位置 | 作用 |
|---|---|---|
| 策略单一事实来源 | `spike/scripts/license_policy.mjs` | 许可证分类、纯 GPL-2 冻结白名单、人工复核登记、运行时装包禁令、NOTICES 渲染 |
| 生成器 | `spike/scripts/gen_packages_lock.mjs` | 从随包 `DESCRIPTION` + `tgz` 确定性生成 lock（含 sha256 / 编译型 `.so` / `data/` 清单），支持 `--check` |
| **锁文件** | `spike/packages.lock` | 33 个包：版本、许可证、类别、上游源码 URL、tarball sha256、是否编译型、是否含 `data/` |
| 第三方声明 | `spike/THIRD-PARTY-NOTICES.md` | 由 lock 确定性渲染，CI 断言不允许手改 |
| **CI 断言** | `spike/scripts/verify_licenses.mjs` | **12 项（完整模式）/ 10 项（`--lock-only`）**，含 CLA 部署完整性 C12 |
| 工作流 | `.github/workflows/license-compliance.yml` | 每次 push / PR 跑 `--lock-only`，纯 Node 内置模块、零依赖、零外网 |
| **CLA 门禁** | `.github/workflows/cla.yml` + `spike/scripts/cla_*.mjs` | 贡献者 CLA 签署检查，见 §7.7 |
| 项目声明 | `LICENSE` | SPDX `AGPL-3.0-or-later`（发布前替换为全文，见文件内 PRE-RELEASE NOTICE） |
| 入库边界 | `.gitignore` | 预置包二进制不入库；CI 走 `--lock-only`，本地 `npm run verify` 做实物校验 |

`npm run verify` 已把 `lock:check` 设为前置门禁；2026-11-26 实测：**完整门禁 12/12 +
CI 模式 10/10 + S1/S2/S4/S6 全量回归全绿（退出码 0）**。

断言覆盖：lock 漂移 / 手改、library 双向一致、随包 `DESCRIPTION` 一致、
许可证类别白名单、**纯 GPL-2 冻结白名单（新增即失败）**、含糊许可证必须走人工复核登记、
tarball sha256、NOTICES 同步、运行时 `installPackages` / `download.file` 禁令、
项目 LICENSE 声明，**以及 C12 CLA 部署完整性**（协议文本基线指纹、签名表格式、
版本一致性、CONTRIBUTING 引用、门禁 workflow、判定逻辑 17 项内存自测）。

**实测发现并已处理**：
- `partitions` 随包 `DESCRIPTION` 只写 `GPL` → CI 阻断 → 查 CRAN 确认为
  `GPL-2 | GPL-3 [expanded from: GPL]`（双许可，可选 GPLv3）→ 登记到
  `POLICY.licenseOverrides`，证据与复核日期写进 lock 与 NOTICES。
- DCF 解析漏掉 `Authors@R` 的 `@`，曾把 igraph 版本号污染成人名列表；已修解析器，
  并新增独立于解析器的 `version` 格式断言防回归（生成与校验共用解析器会互相印证错误）。

**仍待办（不阻塞 Phase 1）**：① ✅ **CLA 签署流程已落地**（见 §7.7，待律师定稿 +
真实 GitHub 首跑确认）；② 发布前以 AGPL-3.0 全文替换 `LICENSE` 占位并附
GPLv2 / GPLv3 全文；③ 把 `s2_offline.mjs` 的 P1–P4 与 `fetch_extra_packages.mjs`
合并成由 `packages.lock` 驱动的正式构建脚本；④ 正式发布前请开源合规律师审阅发行包。

---

### 7.7 CLA 部署流程（2026-11-26 已落地）

> 路线 A 决策里的「先部署 CLA」不是一句口号：**它决定了未来能否转 Open-core**。
> 本节记录方案选择、落地资产、安全边界与启用步骤。

#### 7.7.1 为什么必须是 CLA，而不是 DCO / 版权转让

- AGPL 项目要改变许可证（例如新增闭源模块做 Open-core），原则上需要**全体版权
  持有人同意**。外部贡献一多，逐一追认事实上不可行；因此必须在第一份贡献进来前，
  就让每位贡献者提前授予「可再许可」的权利。
- **DCO 1.1 不够**（`developercertificate.org` 原文核对）：它只有 (a)–(d)，
  核心是「我有权**按文件中标明的开源许可证**提交」与「记录公开且永久保存」，
  **不含 sublicense 授权、不含换许可证授权、也不含专利授权**。
  `Signed-off-by` 适合许可证固定不变的项目（Linux / Git），不适合本项目。
- **不采用 CTA（版权转让）**：本项目用「**保留版权 + 永久、可再许可的授权**」，
  贡献者门槛更低，且已足够支撑改许可证（更正 §7.4 第 3 点的旧表述）。
- ICLA §2 明确写入「允许以任何许可证（含商业 / 专有许可证）再许可」，
  §3 采用 Apache-2.0 §3 的专利授权 + 诉讼终止条款，§4 是原创性与第三方材料保证。
  ⚠️ **不能指望日后靠改 CLA 追认历史贡献**：协议 §6.3/§6.4 已写明旧版不追溯扩张授权，
  所以第一版就必须把再许可权写足。

#### 7.7.2 方案选择：自建仓库内签名表 vs cla-assistant.io

| | cla-assistant.io（SAP 托管） | **本项目选择：签名表进 Git + 自建门禁** |
|---|---|---|
| 签署数据 | Azure Cosmos DB（欧洲），由第三方持有 | `.cla/signatures.json`，随 Git 历史公开、可离线审计 |
| 依赖 | 需安装 GitHub App / OAuth；自建实例需 MongoDB + 公网回调 | 零依赖、零外网、纯 Node 内置模块 |
| 国内可用性 | 依赖境外服务 | 无境外依赖 |
| 体验 | PR 内点一下即签，CLA 文本变更自动要求重签 | 贡献者跑一条命令、把签名记录随 PR 提交 |
| 与现有流水线 | 独立系统，与 `npm run verify` 不通 | 同一套断言（C12），可直接本地复现 |

cla-assistant 的「CLA 变更自动要求重签」是好设计，本项目用**签署记录锁定
CLA 文本 sha256 + 版本升级**实现了等价约束；其 `github-action` lite 版仍为 Alpha。
切换路径：若日后要更好的签署体验，可保留现有 ICLA/CCLA 文本，改用托管服务，
但需接受签署数据出境，并同步调整 `verifyDeployment()` 的断言。

#### 7.7.3 落地资产

| 资产 | 作用 |
|---|---|
| `.cla/ICLA.md` / `.cla/CCLA.md` | 个体 / 实体协议全文 v1.0（中文正文，关键授权条款附 Apache-2.0 英文原句） |
| `.cla/signatures.json` | 唯一签名数据（初始为空）；字段含 `agreementSha256`、`claVersion`、`type` 等 |
| `.cla/README.md` | 维护者手册：字段表、审核清单、吊销、**版本升级顺序**、安全边界 |
| `CONTRIBUTING.md` | 贡献者三步签署流程、FAQ、隐私告知 |
| `spike/scripts/cla_policy.mjs` | 策略单一事实来源 + 纯逻辑校验 / 判定 + 17 项内存自测 |
| `spike/scripts/cla_check.mjs` | 门禁 CLI：`--login` / `--validate` / `--list` / `--self-test` / `--json` |
| `spike/scripts/cla_sign.mjs` | 离线签署：生成带文本指纹的记录，防重复、支持 `--replace` 重签 |
| `.github/workflows/cla.yml` | PR 门禁（只读权限、fork 安全） |
| `verify_licenses.mjs` **C12** | CLA 部署完整性断言，纳入 `npm run verify` 与 CI |

#### 7.7.4 四个关键机制

1. **文本指纹锁定**：每条签署记录写入签署时 ICLA/CCLA 的 sha256；文本一变，
   旧签名立即判为 `agreement-mismatch`，必须重签。
2. **双基线防静默改条款**：只有「记录 vs 当前文本」比对还不够——**签名表为空时
   没有记录可比**。`cla_policy.mjs` 的 `AGREEMENT_BASELINE` 存 v1.0 定稿指纹，
   C12 断言当前两份文本与之相等。实测：往 ICLA 加一行注释且不升版本 →
   C12 立即 FAIL（9/10），还原后恢复 10/10。
3. **版本升级必须重签**：改文本 → 升 `CLA Version` → 更新 `signatures.json` 顶层版本、
   `AGREEMENT_BASELINE`、`CONTRIBUTING` 与文档；旧贡献仍按签署时版本授权，
   新贡献必须签新版。顺序见 `.cla/README.md` §4。
4. **安全边界（防伪造签署）**：门禁用 `pull_request` 事件（**不用
   `pull_request_target`**），`permissions: contents: read`，不接触 secrets；
   **脚本与协议文本从 base checkout 读取，签名表从 PR checkout 读取**
   （通过 `CLA_SIGNATURES_FILE` 环境变量指向）。否则贡献者可以改脚本，
   或同时改 CLA 文本与签名表指纹来伪造「已签署」。
   C12 把这些不变量固化成断言：禁止 `pull_request_target`、禁止引用 `secrets.`、
   必须出现 `contents: read` 与 `CLA_SIGNATURES_FILE`（检查时剔除注释行，
   避免说明文字被误判为配置）。

补充：`bots` 白名单豁免 `dependabot[bot]` / `renovate[bot]`（它们无法签 CLA，
与 cla-assistant 的做法一致），但校验器禁止把真人塞进该名单。

#### 7.7.5 启用步骤（部署手册）

1. **律师定稿**：填 `.cla/ICLA.md` §8 与 `.cla/CCLA.md` §9 的占位
   （项目维护方法定主体、通知邮箱、管辖法 / 争议解决）。定稿即产生新文本 sha256，
   必须按 §7.7.4 第 3 点走一次完整的版本升级流程（建议升到 v1.1）。
   **定稿前，本流程仅供核心团队内部签署，不对外宣传为正式 CLA。**
2. 推送到 GitHub 后，在 Settings → Branches 把 **`CLA gate (route A / AGPL-3.0)`**
   设为 required status check（与 `License compliance` 并列）。
3. 核心团队先各自 `npm run cla:sign -- --login ...` 并把 `.cla/signatures.json` 提交，
   避免自己的 PR 被自己的门禁挡住。
4. 用一个测试 PR 验证：未签 → FAIL 且 job summary 给出签署命令；
   补上签名记录 → PASS。
5. 之后每次 PR 自动检查；`npm run cla:list` 可随时审计签署名单。

#### 7.7.6 实测结果（本地，零外网）

- 判定逻辑内存自测 **17/17**：正常/异常签署、大小写归一化、bot 豁免、
  重复 / 缺字段 / 未来时间 / 未排序 / 指纹变化 / 旧版本等场景。
- 端到端演练：个人签署 → 门禁 PASS；实体签署（含 `contributors`）→ PASS；
  重复签署被拒；`--replace` 重签成功；模拟 CI 的 `CLA_SIGNATURES_FILE`
  指向 PR 签名表 → 已签 PASS / 未签 FAIL；演练后签名表已恢复为空。
- 静默改条款演练：C12 FAIL（9/10）→ 还原后 10/10。
- `npm run verify`：**完整门禁 12/12、CI 模式 10/10、S1/S2/S4/S6 共 39 项全绿**。

> ⚠️ 本节的协议文本与流程是**工程部署模板，不构成法律意见**；
> 正式开放外部贡献前须由开源合规律师审阅（§7.4 合规清单第 ④ 项）。
> GitHub Actions 的真实运行尚未在远端验证，本地只做了静态断言与逻辑自测。

---

## 8. 定位与差异化建议

调研结论很明确：**没有任何单一开源项目复现了 JMP 的完整组合**（交互可视化 + 统计建模 + DOE + 质量控制 + Profiler + 脚本）。现有替代品都是「换个工具，换个流程」：

- jamovi/JASP：教学与常规检验好，**DOE 和工业质量工程几乎为零**
- Orange：可视化 ML 好，**经典统计和质量工具弱**
- KNIME：流水线好，**探索性分析笨重**
- R/Python：能力最强，**但要写代码，非统计师用不了**

**这就是机会窗口。** 我们的差异化定位应该是：

> **面向制造业/研发工程师的、无需写代码的 DOE + 质量工程交互分析工具。**

理由：
1. 这是 JMP 最强也最贵的 niche，用户付费意愿明确（半导体、制药、化工）
2. 这是所有开源替代品最弱的地方——**没有竞品**
3. R 生态在这块最成熟，我们复用成本最低
4. 用户画像清晰：工艺工程师、质量工程师、六西格玛黑带——他们要的是「拖几下就出 Minitab 级别的结论」，不是「学 Python」

**不做什么**（至少前两个 Phase）：不做通用 BI，不做大数据平台，不做深度学习，不和 Tableau/PowerBI 竞争。

---

## 9. 立即可执行的下一步

> **Phase 0 已完整放行（2026-11-26）**：S1 / S2 / S3 / S4 / S6 全部 GO，
> 4 个验证脚本共 **39 项检查全绿**（`npm run verify` 约 7 秒，无需 Rust / R / 外网）。
> 报告见 `docs/PHASE0_SPIKE_REPORT.md`，可复跑工程在 `spike/`。

1. ✅ **Phase 0 验证环境 + DOE 链路（S1/S2/S3）** —— 已完成
   - Windows 下 webR 0.6.1 的 3 处真实 bug 已用 shim + 幂等补丁解决
   - 决定性架构结论：**R 包随安装包分发、运行时 NODEFS 挂载、零外网**
   - 正确 API（实测修正，勿运行时 `install`，改为 NODEFS 挂载）：
     `FrF2::pb(nruns=12, nfactors=7)`（12-run Plackett-Burman）、
     `FrF2::FrF2(nruns=16, nfactors=7)`（regular FF，runs 须 2 的幂）、
     `rsm::ccd(2, n0=c(4,4), alpha="rotatable")`、
     `DoE.base::oa.design(nruns=9, nfactors=4, nlevels=3)`
2. ✅ **S4 qcc 质量链路** —— GO 13/13（控制限跨语言独立复算、Cp/Cpk、WE 判异、真实出图）
3. ✅ **S6 AlgDesign / Custom Design** —— GO 11/11，**排期确定，无需自研交换算法**
4. ✅ **Phase 1 已启动：Rust 工具链 + Tauri 2 骨架**（2026-11-26，完整记录见
   `docs/PHASE1_SKELETON.md`）：
   - Rust 1.100.0 已装；根 `package.json` / `src/` / `src-tauri/` 骨架落地，
     `Cargo.lock` 锁定 432 个 crate（tauri 2.12.7）；WebView2 Runtime 已在
   - `vite build` / `tsc --noEmit` / `cargo metadata` / Phase 0 回归全绿
   - ⚠️ **硬阻塞：缺 Microsoft C++ Build Tools（MSVC + Windows SDK）**，
     `cargo check` / `tauri dev` 的链接阶段无法完成（已用最小 `rustc` 探针坐实）；
     WebView2 下的 S1 变体 / memory64 探测要等桌面窗口真跑起来
   - 下一步：装 VS Build Tools → `cargo check` → `tauri dev` →
     WebView2 内 S1 变体 / memory64 实测 → Perspective 表格 → Graph Builder → `.mjmp` 读写
   - ✅ **联动内核 + S5 已落地（2026-11-27，不依赖 MSVC）**：
     `src/lib/selection.ts`（global/union/intersect + 谓词编译 + 纯 JS 交叉验证，单测 31/31）、
     `spike/scripts/duckdb-harness.mjs`（DuckDB-Wasm 数据层）、
     `s5_linked_brushing.mjs`（100 万行 / 3 视图，p95 49.37ms，**GO** 7/7）、
     `LinkedBrushingDemo`（前端可运行，SSR 冒烟 7/7）；`npm run verify:all` 全绿。
     精确 union 多框选 141.46ms 超标 → 预聚合 3.46ms 的对策已验证（近似，误差 9.32%）
   - 分析编排层：学 jamovi 的两阶段执行（`.init()` 搭骨架 / `.run()` 才重算）；
     联动状态全局单一数据源（已由 `selection.ts` 实现）
   - 新增合规待办：432 个 Rust/npm 依赖的许可证**部分登记**于
     `docs/DEPENDENCY_LICENSES.md`（本轮 5 个数据层 npm 包 + 8 个壳依赖已列）；
     全量清单与 C13 CI 断言仍待做（当前 `THIRD-PARTY-NOTICES.md` 只覆盖 33 个 R 包）
5. ✅ **`packages.lock` + CI 许可证门禁**（2026-11-26 已完成，见 §7.6 / §7.7）：
   生成器、`packages.lock`、`THIRD-PARTY-NOTICES.md`、**12 项断言（含 CLA C12）**、
   GitHub Actions 工作流全部落地，`npm run verify` 前置门禁全绿。
   仍待办：把 `s2_offline.mjs` 的 P1–P4 与 `fetch_extra_packages.mjs` 合并成由
   `packages.lock` 驱动的正式构建期补包脚本（含 sha256 校验与 `data/` 清单）。
6. **R8 回归验证集进 CI**：把报告里 4 组数值基准固化成自动断言
7. **拉取并研读四个关键参考项目**
   - `jamovi/jamovi` → 两阶段执行、模块系统、`.omv` 格式
   - `DailyDana/process-capability-analyzer` → 质量模块（可直接复用）
   - `rushadnihal/myco-rsm` → Profiler + DOE 优化流程蓝本
   - `dollodart/graph-builder` → Graph Builder 交互设计
8. ✅ **许可证与商业模式 —— 硬阻塞已解除**（见 §7 决策记录）：2026-11-26 定案
   **路线 A（AGPL-3.0-or-later + 先部署 CLA）**，架构确定为同地址空间 `evalR()`，
   **S7 取消**；合规流水线（§7.6）与 **CLA 签署流程（§7.7）** 均已落地。
   发布前仍须：律师定稿 ICLA/CCLA 第 8/9 节占位、在真实 GitHub 上首跑确认、
   以 AGPL / GPL 全文替换 `LICENSE` 占位。

---

## 附录 A：v1 → v2 主要变更

| 项 | v1 | v2 |
|---|---|---|
| 统计引擎 | Python 为主，自建 DOE 算法 | **webR 为主 + Pyodide 为辅，不自建** |
| DOE | pyDOE2 / 自研 | **R: DoE.base + FrF2 + rsm + AlgDesign** |
| 质量工程 | 自建 | **R: qcc + 复用 process-capability-analyzer** |
| 可靠性 | 自建 | **Pyodide: reliability + lifelines** |
| 数据表格 | 未定 | **FINOS Perspective** |
| 数据引擎 | SQLite + Parquet | **DuckDB-Wasm + Parquet** |
| 图表 | D3/Plotly/ECharts 待定 | **Vega-Lite 为主 + Plotly 补 3D** |
| 脚本 | JS / 自造 DSL | **R 脚本（可导出复现）** |
| Phase 0 | 无 | **新增技术验证 Spike** — ✅ 2026-11-26 已完整放行（S1/S2/S3/S4/S6 全 GO） |
| 定位 | 通用 JMP 替代 | **聚焦制造业 DOE + 质量工程** |
| 工期 | 10–14 个月 | **10–14 个月（含 Phase 0），但风险显著降低** |

---

## 附录 B：待确认事项（需你决策）

1. **团队规模与工期**：本计划按 1–2 名全栈 + 懂统计的人估算。如果是单人，建议 Phase 1 后先发布，收集反馈再定 Phase 2 范围。
2. ✅ **许可证与商业模式 —— 已定（2026-11-26）**：采用**路线 A（AGPL-3.0-or-later +
   部署 CLA 保留转 Open-core 权利）**。架构定为同地址空间 `evalR()`，**S7 取消**；
   合规流水线见 §7.6，**CLA 签署流程已落地见 §7.7**，Phase 1 硬阻塞解除。
   发布前仍须：律师定稿协议占位、远端首跑确认、AGPL / GPL 许可证全文与律师审阅。
3. **目标行业**：默认按半导体/制造业质量工程。如果实际目标是制药（临床/可靠性）或消费品（市场调研），Phase 2/3 的优先级要调整。
4. **是否要 Web 版**：Tauri 桌面为主，但因为整个栈都是 WASM，**同一套代码几乎零成本能出纯浏览器版**（对应 JMP Live 的分享场景）。这是个很大的加分项，建议 Phase 1 就保持这个可能性。
