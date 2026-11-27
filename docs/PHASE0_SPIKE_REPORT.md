# mimic-JMP Phase 0 技术验证报告

**日期**：2026-11-26（上午 S1–S3，下午补测 S4 / S6）
**范围**：S1（webR 启动与 R 运行）、S2（DOE 包链路与设计矩阵）、S3（igraph 编译型依赖）、
S4（qcc 控制图 / 控制限独立复算 / 过程能力）、S6（AlgDesign 最优设计与建模闭环）
**结论**：**GO — Phase 0 完整放行**。S1 / S2 / S3 / S4 / S6 全部实测通过，
4 个验证脚本共 **39 项检查全绿**。
**验证工程**：`spike/`（`npm run verify`，约 7 秒，无需 Rust / R / 外网）
**原始数据**：`spike/results/*.json`（`s1_webr_boot` / `s2_nodefs` / `s4_qcc` / `s6_algdesign`）

---

## 1. 一句话结论

> **JMP 最难替代的两条产品线——DOE 与工业质量工程——在 webR 里完整跑通了。**
> 而且正确架构不是「运行时联网装 R 包」，而是**把预编译 WASM 包随安装包分发、运行时用 NODEFS 挂载**：
> 挂载耗时 < 1ms，全链路（启动 R + 加载包 + 出设计矩阵 / 控制图 + 数值校验）**数秒级**，零外网。

| 验证项 | 结论 | 关键数据 | 检查项 |
|---|---|---|---|
| S1 | **PASS** | 冷启动 500ms；R 4.6.0 / wasm32；`lm(mpg~wt)` 对齐公开参考值到小数 6 位；cairo/png/svg 图形设备可用 | 8/8 |
| S2 | **GO** | 12-run Plackett-Burman、FrF2(16,7) 部分因子、`rsm::ccd()`、L9 正交表全部产出 | 7/7 |
| S3 | **GO** | `igraph.so` / `Matrix.so` 等编译型 WASM 动态库正常加载，15/15 包可 `requireNamespace` | 并入 S2 |
| S4 | **GO** | qcc X̄-R 控制限与 AIAG 常数跨语言独立复算偏差 **2.3e-6**；Cp/Cpk 偏差 <3.4e-10；WE 判异命中；真实写出 20KB 控制图 PNG | 13/13 |
| S6 | **GO** | AlgDesign D/I-optimal、混合水平+交互、256 点候选集、设计→`lm()` 闭环（rank=10/10, R²=0.9978）⇒ **Custom Design 无需自研交换算法** | 11/11 |

**合计 39 项检查全绿**，`npm run verify` 退出码 0。

---

## 2. 环境与方法

| 项目 | 实测 |
|---|---|
| OS / Node | Windows x64 / Node v22.22.2（Git Bash） |
| Rust / R | **均未安装** —— 有意剥离：S1/S2 的生死关口与 Tauri 壳无关 |
| webR | npm `webr@0.6.1`（**已是最新版**），R 4.6.0，`webr-worker.js` / `R.wasm` 18MB |
| 包仓库 | `https://repo.r-wasm.org/bin/emscripten/contrib/4.6`，索引 **7.29MB / 24,640 个包** |
| 网络 | npm registry 可达（PONG 935ms）；repo.r-wasm.org 可达但**仅 0.08MB/s** |

**策略调整**：原计划 S1 写的是「webR 在 Tauri WebView2 中启动」。实测时把 Tauri 变量剥离——
S1/S2 的真正风险是「webR 能否跑起 DOE 包」，这用 Node 就能验证，不必先装 Rust 工具链。
结果证明这个判断是对的：真正的坑全在 webR 自身，与桌面壳无关。

---

## 3. S1 结果（全项 PASS）

`spike/results/s1_webr_boot.json`

| 检查 | 结果 |
|---|---|
| 冷启动 < 5000ms | **500ms** |
| `1+1` | 2 |
| `lm(y~x)` 精确解 y=2x+3 | intercept=3, slope=2 |
| `lm(mpg~wt, mtcars)` | 37.285126 / -5.344472 / R²=0.752833 / df=30，**与公开参考值完全一致** |
| 推断统计 | t.test t=-2.040119(p=0.046044)、aov F=19.980699、chisq χ²=3.24 |
| 图形设备 | png/jpeg/cairo/tiff/svg **全部 TRUE**，实际写出 3805 字节 PNG |
| 默认包 | 16 个 base R 包（不含 jsonlite） |

**意外收获**：原本担心的「webR 不带 Cairo → qcc 控制图 / ggDoE 无法出图」风险**不存在**，
`cairo=TRUE` 且能真写出 PNG。S4/S5 的前置条件已满足。

### Windows 专有的 3 处 webR bug（已修复）

这是本轮最耗时的部分，且**只在 Windows 触发**（Linux/macOS 的 `__dirname` 不含盘符）：

1. **默认 `baseUrl` 是盘符路径** — webR 源码 `var ur = h ? __dirname + "/" : "https://..."`，
   在 Windows 产生 `D:\...\dist\`，被 `new Worker()` 当成 `d:` 协议 → `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
2. **显式传 `file://` 字符串也不行** — Node 的 `new Worker()` 要求 URL **对象**或普通路径，
   传 `file://` 字符串 → `ERR_WORKER_PATH`。
3. **worker 内部动态 import 同样缺 `pathToFileURL`** — `await import(path.resolve(e))` 产出
   `D:\...` 再喂给 `import()` → 炸。且 Emscripten 的 `locateFile = t => baseUrl + t` 用
   `fs.readFileSync` 读 `R.wasm`，**需要普通路径**而非 file URL。

解法（`spike/scripts/`）：
- `webr-node-shim.mjs`：**先 `import('webr')` 再装 shim**（webR 模块加载期会覆盖 `globalThis.Worker`，
  顺序反了补丁会被冲掉），把 Worker 目标规范化为 URL 对象；`baseUrl` 保持普通路径。
- `apply-webr-windows-patch.mjs`：**幂等**补丁，只在 worker 内部那一处 `import()` 前加
  `pathToFileURL(...).href`；带备份、带校验、带版本变化检测，不直接手改 node_modules。
- 生产环境走 Tauri WebView 时 `baseUrl` 是 http(s)/tauri 协议，**不会遇到这些问题**，
  这些 shim 仅用于 Node 侧自动化验证与 CI。

---

## 4. S2 过程：三次失败路线与最终解法

这是本轮的核心。**不要跳过这一段**——三次失败各自排除了一个错误假设，最终才找到正确架构。

### 4.1 路线一：外网直装（失败）

`repo.r-wasm.org` 实测吞吐 **0.08MB/s**（igraph 4.16MB 耗时 52.5s；7.29MB 索引耗时 23.7s）。
webR 默认 `downloadTimeout = 0`（同步 `XMLHttpRequest` 无超时），**任一请求挂住即永久阻塞、永不报错**。

- `s2_diag.mjs`（逐包 + 60s 下载超时）：conf.design 11s、estimability 3.9s、rsm 5.9s、
  MASS 6.1s、DoE.base 78.9s、lattice 0.4s 全部成功；**igraph / FrF2 各 180s 超时**。
- `s2_retry_frf2.mjs`（提前备好 igraph 依赖链、每包 600s）：Matrix 18.7s、cli 6.6s、
  lifecycle 10.1s、magrittr 3.9s、**igraph 46.4s ✓**、sfsmisc 4.6s、scatterplot3d 4.3s，
  但 **FrF2 卡 600s 且日志连一行 "Downloading" 都没有**。

判定：FrF2 是纯 R 包（`NeedsCompilation: no`），依赖全部实装成功、索引中确认存在
（FrF2 2.3-5）。卡在**下载请求挂起**而非包不兼容 WASM。

### 4.2 路线二：本地 HTTP repo（失败，但排除了网络变量）

`s2_offline.mjs`：Node 并发预下载闭包内 **31 个 tgz（24.48MB）仅用 22.9s**（gzip 校验全部 OK），
生成精简 PACKAGES 索引，起本地 server，webR 用 `repoUrl=http://127.0.0.1:18765`。

- P3 最小探针（单装 conf.design）**成功** → 路径规则确认：webR 请求
  `/bin/emscripten/contrib/4.6/PACKAGES.rds`、`PACKAGES.gz`、`conf.design_2.0.0.tgz`。
- P5 批量装 4 个根包：server 记录到 24 个包依次下载后，在 `Matrix_1.7-6.tgz` 报
  `utils::download.file(...) failed`。

### 4.3 路线三：独立 server 进程（仍失败，推翻假设）

假设是「HTTP server 与 webR 同处一个 Node 进程，同步 XHR 由主线程代理执行、
目标却是主线程自己的 server → event-loop 自请求竞态」。于是把 server 拆到独立进程
（`local-repo-server.mjs` + `s2_final.mjs`），并加失败重试。

**结果：仍然恰好卡在 Matrix**。而且回头看路线二的逐包实验，
失败点是 218KB 的 `magrittr`（第 22 个包）而非 2.9MB 的 Matrix。

> **关键推理**：失败点始终在「累积下载约 20+ 个包之后」，与具体包、包大小、
> server 是否独立进程、`Connection: close` 与否、批量还是逐包**都无关**。
> 这是 webR `download.file`（同步 XHR）连续调用的资源累积问题。
> 继续调这条传输机制没有意义——**产品本来就不该在运行时联网装组件**。

### 4.4 最终方案：NODEFS 挂载预置 library（成功）

`tgz` 解压后就是标准 R 包目录（含 `libs/*.so` WASM 动态库）。把 31 个包解压到
`spike/local-repo/library/`（42MB；后续 S4/S6 补入 `qcc`、`AlgDesign` 后为 **33 个包**），
然后用 webR 的 FS API：

```js
await webR.FS.mkdir('/rlib');
await webR.FS.mount('NODEFS', { root: LIB }, '/rlib');   // < 1ms
await webR.evalRVoid(`.libPaths(c("/rlib", .libPaths()))`);
// 之后直接 library(FrF2)，全程零 download.file、零 XHR、零外网
```

`s2_nodefs.mjs` 实测结果（`spike/results/s2_nodefs.json`）：

```
NODEFS 挂载 0ms -> /rlib
.libPaths(): /rlib | /usr/lib/R/library
[PASS] 编译型动态库可见 — Matrix.so=TRUE
[PASS] 全部包（含 igraph/Matrix 编译型动态库）可加载 — 15/15
[PASS] H1  12-run × 7 因子 Plackett-Burman 筛选设计 — nrow=12 ncol=7 二水平=TRUE
[PASS] H1b FrF2(16,7) regular 部分因子设计 — nrow=16 ncol=7 二水平=TRUE
[PASS] H2  rsm::ccd() 中心复合设计 — nrow=16 ncol=4 含轴点=TRUE
[PASS] 附加 DoE.base 正交表 L9(3^4) — nrow=9 ncol=4
[PASS] 数值基准 lm(mpg~wt) 对齐公开参考值（R8） — 37.285126 / -5.344472 / R²=0.752833
包版本: FrF2=2.3.5, rsm=2.10.6, DoE.base=1.2.5, conf.design=2.0.0, igraph=2.3.1, Matrix=1.7.6
S2 go/no-go 结论: GO        总耗时 2.7s
```

**S3 一并解决**：`igraph.so`（3.4MB）与 `Matrix.so`（1.3MB）通过 NODEFS 正常
`dyn.load`，`library(FrF2)` 及别名结构相关路径可用。原计划里「igraph 是 FrF2 硬依赖且需编译、
可能要 patch 掉」的风险**不成立**——r-wasm 已提供编译好的二进制。

---

## 5. 原计划的三处错误（已修正 `DEVELOPMENT_PLAN.md`）

| # | 原计划 | 实测 | 修正 |
|---|---|---|---|
| 1 | `FrF2(nruns=12, nfactors=7)` 作为 12-run 筛选设计 | **报错** `nruns must be a power of 2`。`FrF2()` 只做 regular 2 的幂次设计 | 12-run 筛选用 **`FrF2::pb(nruns=12, nfactors=7)`**（Plackett-Burman，对应 JMP Screening）；`FrF2(16,7)` 另作 regular FF 验证 |
| 2 | `oa.design(ID="L9.3.4")` | **报错** `ID does not specify an orthogonal array` | 改用 `oa.design(nruns=9, nfactors=4, nlevels=3)` 自动选表；`L9.3.4` 是 `show.oas()` 里的 `name`，不是 `ID` 参数 |
| 3 | `webr::install(...)` 运行时装包 | 外网 0.08MB/s + 无超时 → 挂死；本地 HTTP repo 连续 20+ 包后失效 | **预置 WASM 包 + NODEFS 挂载**，运行时零外网 |

另外 S1 原写「在 Tauri WebView2 中启动」，实测剥离 Tauri 变量用 Node 验证，
避免被 Rust 工具链和网络策略卡住——这个策略是对的，坑全在 webR 自身。

---

## 6. 对架构与计划的影响

### 6.1 新增架构原则（已写入 DEVELOPMENT_PLAN.md §4 / §6）

> **R 包必须随安装包分发，运行时不联网。**
> 构建期从 `repo.r-wasm.org` 拉取所需 WASM 包 → 解压成标准 R library 目录 →
> 打进应用资源 → 运行时 NODEFS 挂载到 `/rlib` → `.libPaths()` 指过去。

好处：零外网依赖、首次启动 2.7s（而非几十分钟）、可离线分发、
与 JMP/Minitab 的交付形态一致。**代价**：安装包增加约 42MB（当前 DOE 子集），
需要为构建期加一个「包清单 → 下载 → 解压 → 打包」的脚本（可复用 `s2_offline.mjs` 的 P1–P4）。

### 6.2 风险状态更新

- **R1（DOE 包链路不可用）→ 已解除**（S2/S3 实测 GO）
- **R8（数值与 JMP/Minitab 不一致）→ 大幅缓解**：新增 3 组可复现的数值基准点——
  S1/S2 的 `lm(mpg~wt)`（小数 6 位）、S4 的 X̄-R 控制限（偏差 2.3e-6）与 Cp/Cpk
  （偏差 <3.4e-10）、S6 的 DOE→建模闭环（R²=0.9978）。建议把这些直接固化进 CI 回归集
- **Custom Design 排期风险 → 解除**：S6 证明 `AlgDesign` 可复用，无需自研交换算法
- **新增 R9（运行时联网装包）→ 高**，已给出对策（预置 + NODEFS）
- **原「webR 不带 Cairo」顾虑 → 解除**（`cairo=TRUE`，S4 实际写出 20KB 控制图 PNG）
- **新观察项：预置 WASM 包可能裁剪数据集**（qcc 无内置 `pistonrings`），
  产品需自备示例数据；建议纳入构建期包清单校验
- **S7（进程隔离性能）仍只在选商业闭源路线时才需要**；本次验证用的是
  同地址空间 `evalR()`，与推荐的路线 A（AGPL）一致，不受影响

### 6.3 剩余项（不要误判为已完成）

| 项 | 状态 | 下一步 |
|---|---|---|
| S4 qcc 控制图 + 控制限比对 | ✅ **已完成（GO，13/13）** | 见 §6.4 |
| S6 `AlgDesign` / I-optimal | ✅ **已完成（GO，11/11）** | 见 §6.5；Custom Design 排期已确定 |
| S5 100 万行联动刷新 < 100ms | 未做 | 需要前端可视化层（DuckDB-Wasm + Vega-Lite），归入 Phase 1 |
| S1 的 Tauri WebView2 变体 | 未做 | 装 Rust 工具链后补测；Node 侧已放行，风险低（生产 baseUrl 为 http/tauri 协议，不触发 Windows 盘符 bug） |
| S7 进程隔离 | 条件项 | 仅商业闭源路线需要；选路线 A（AGPL）则不需要 |

---

### 6.4 S4 结果：qcc 质量工程链路（GO，13/13）

`spike/scripts/s4_qcc.mjs` → `spike/results/s4_qcc.json`，耗时 0.9s。

**验证方法（对应原计划「控制限与 Minitab 参考值一致」）**：不依赖任何外部截图或不可核验的
参考值，而是做**跨语言独立复算**——R 侧生成确定性数据（`set.seed(2026)`，25 组 × 5 观测
的 `rnorm(74, 0.005)`），把 125 个原始值回传 Node；Node 侧用 **AIAG SPC-2 / ASTM STP-15D
公开查表常数**（n=5：d₂=2.326、A₂=0.577、D₃=0、D₄=2.114）独立算 X̄ 图与 R 图控制限，
再与 `qcc` 输出比对。Minitab / JMP / qcc 用的是同一套常数，因此这是可核验的独立基准。

| 检查 | qcc 输出 | 独立复算 | 偏差 |
|---|---|---|---|
| 中心线 X̄̄ | 73.999639131 | 73.999639131 | 3.69e-13 |
| 标准差 σ = R̄/d₂ | 0.005073174 | 0.005073174 | 2.43e-14 |
| X̄ 图 LCL / UCL | 73.992832754 / 74.006445508 | A₂ 公式 | **2.34e-6** |
| R 图 UCL（D₄·R̄） | — | D₄ 公式 | 5.54e-6 |
| Cp | 0.657050884 | 0.657051 | 2.77e-10 |
| Cpk | 0.633339956 | 0.633340 | 3.34e-10 |

> 查表常数为三位小数，qcc 内部使用更高精度 d₂，故存在 <1e-4 的可解释偏差；
> 另有一项 `center ± 3σ/√n` 的**内部自洽检查**偏差仅 ~3e-13。
> 正式发布前仍应再用 `process-capability-analyzer` 的 Minitab 验证集做逐位比对（R8）。

其余通过项：Western Electric 判异（人为注入 6σ 越界点被 `violations$beyond.limits` 检出）、
EWMA / CUSUM 对象可构造、`process.capability()` 可用、以及**R 侧控制图真的渲染出 20606 字节 PNG**
（复用 S1 已验证的 cairo/png 设备）。

**三个 API 陷阱（写产品代码前必须知道）**：

1. `qcc()` 的 `sample=` 参数**无效**（会被 `...` 吞掉，报 `group sizes must be larger than one`）。
   必须先用 `qcc.groups(y, sample)` 构造 25×5 矩阵，再 `qcc(g, type="xbar")`。
2. `process.capability()` 的能力指数在 **`pc$indices` 矩阵**里（行名 `Cp / Cp_l / Cp_u / Cp_k / Cpm`），
   不是 `pc$Cpk`。返回对象顶层只有 `nobs, center, std.dev, target, spec.limits, indices, exp, obs`。
3. `shewhart.rules` 是**函数**而非规则列表；违规结果在 `qcc` 对象的 `$violations` 里。

**产品注意点（新发现）**：预置的 WASM `qcc` 包里 `data(package="qcc")` 返回 **0 个数据集**，
CRAN 原版自带的 `pistonrings` 等示例数据被构建裁剪了（算法函数不受影响）。
→ **产品不能依赖包内置示例数据，需自备数据集 / 示例工程**。建议构建期把裁剪情况纳入包清单校验。

---

### 6.5 S6 结果：AlgDesign 与 Custom Design 排期（GO，11/11）

`spike/scripts/s6_algdesign.mjs` → `spike/results/s6_algdesign.json`，耗时 0.7s。

预置包从 31 → **33 个**（新增 `qcc`、`AlgDesign`，由幂等脚本 `fetch_extra_packages.mjs` 补入）。
`AlgDesign` 的 `Built` 字段为 `wasm32-unknown-emscripten`，含 `AlgDesign.so`（37KB）——
**再次验证编译型包通过 NODEFS 挂载可正常 `dyn.load`**。

| 能力 | 实测 |
|---|---|
| D-optimal（2³ 候选集，8 trials） | 8×3，D=Ge=Dea=1.0 |
| **I-optimal**（JMP Custom Design 默认准则） | 14×3，D=0.4557 ✅ |
| 混合水平 + 交互 + 类别因子 | 候选 18×3 → 设计 12×3 ✅ |
| `eval.design()` 设计评估 | determinant=0.4627、几何平均方差=2.427 ✅ |
| `optMonteCarlo()` 连续/混合因子 | 规格表 4×7 → 设计 20×4 ✅ |
| 大候选集（4⁴=256 点） | `optFederov` 直接产出 20×4，D=14.94 ✅ |
| 可复现性 | 同 seed 两次 `rows` 完全一致 ✅ |
| **建模闭环** | 设计 → 注入响应 → `lm()` 二阶模型：10 个系数全部可估、rank=10/10、R²=0.9978，Â=1.948（真值 2）、B̂=-1.585（真值 -1.5） |

**排期结论**：`AlgDesign` 已覆盖 D/I-optimal 生成、混合水平、交互项、设计评估与
「设计 → 建模」闭环。**Phase 2 的 Custom Design 可复用现成算法，重点放在交互外壳与
结果呈现，无需自研 Federov 交换算法**——原计划里「Custom Design 可能推迟到 Phase 3+」
的风险**解除**。

**两个 API 陷阱**：

1. `optFederov()` 返回 `D / A / Ge / Dea / design / rows`，**没有 `criteria` 字段**；
   效率指标直接读 `des$D`、`des$Ge`。
2. `optMonteCarlo()` 的 `data` 参数是 **7 列变量规格表**
   （`varName / low / high / center / nLevels / roundD / isFactor`），内部读 `data[,7]`、
   `data[,5]`、`data[,1]`。**传候选点矩阵会报 `undefined columns selected`**——
   这不是 WASM 缺陷，是参数类型不同。

---

## 7. 复现方式

```bash
cd spike
npm install                          # webr@0.6.1（含 R.wasm 18MB）
npm run patch                         # 幂等的 Windows 补丁（仅 Windows/Node 需要）
npm run s2:fetch                      # 构建期：索引解析 → 依赖闭包 → 预下载 31 个 tgz（本次已缓存）
npm run fetch:extra                   # 补 qcc / AlgDesign 两个 tgz（幂等，已缓存则跳过）
tar -xzf local-repo/tgz/*.tgz -C local-repo/library   # 若需重建 library（用相对路径，勿带盘符）
npm run verify                        # S1 + S2 + S4 + S6，约 7 秒，退出码 0
```

结果落盘：`spike/results/s1_webr_boot.json`、`s2_nodefs.json`、`s4_qcc.json`、`s6_algdesign.json`。

> **Windows 解压注意**：GNU tar 会把 `D:/...` 里的 `D:` 当成远程主机名
> （`Cannot connect to D: resolve failed`）。`fetch_extra_packages.mjs` 已改用相对路径 +
> `cwd` 规避；手工解压时也要在 `spike/` 目录下用相对路径。

**关键脚本清单**

| 脚本 | 作用 |
|---|---|
| `webr-node-shim.mjs` | Windows/Node 下 Worker 与 baseUrl 修正（生产不需要） |
| `apply-webr-windows-patch.mjs` | worker 内部动态 import 的 `pathToFileURL` 幂等补丁 |
| `spike-harness.mjs` | 公共骨架：启动 + NODEFS 挂载 + 结果落盘（S4/S6 复用） |
| `fetch_extra_packages.mjs` | **新增**：构建期补包，幂等下载 + gzip 校验 + 解压 |
| `s1_webr_boot.mjs` | S1：启动、基础统计、图形设备、内存、默认包清点 |
| `s2_offline.mjs` | 构建期：索引解析 → 依赖闭包 → 并发预下载 → 精简 PACKAGES |
| `s2_nodefs.mjs` | **S2 最终验证**：NODEFS 挂载 + 设计矩阵 go/no-go |
| `s4_qcc.mjs` | **S4**：qcc 控制图 + 跨语言独立复算控制限 + 过程能力 + 判异 + 出图 |
| `s6_algdesign.mjs` | **S6**：D/I-optimal + 混合水平 + 设计评估 + 建模闭环 |
| `probe_doe_api.mjs` / `probe_s4_s6_api.mjs` / `probe_s4_detail.mjs` / `probe_s6_detail.mjs` | API 探针（修正计划错误与 API 陷阱的依据） |
| `probe_repo.mjs` / `s2_diag.mjs` / `s2_retry_frf2.mjs` / `probe_igraph.mjs` / `s2_final.mjs` | 失败路线诊断记录，保留供追溯 |

---

## 8. 建议的下一步

1. **Phase 1 已完整放行**：S1 / S2 / S3 / S4 / S6 全部 GO。剩下的 S5（联动性能）和
   S1 的 Tauri WebView2 变体属于 Phase 1 工作，不必再等 Rust 工具链即可开始
   前端 / 分析编排层设计。
2. **把「预置包流水线」正式化**：把 `s2_offline.mjs` 的 P1–P4 与 `fetch_extra_packages.mjs`
   合并成一份构建脚本，输出固定的 `packages.lock`（包名 + 版本 + 校验和），纳入 CI；
   同时校验包内数据集是否被裁剪（见 §6.4）。
3. **R8 回归验证集进 CI**：把本报告里 4 组数值基准（`lm(mpg~wt)`、X̄-R 控制限、
   Cp/Cpk、DOE→建模闭环）固化成自动断言，每次构建都跑。
4. **⚠️ 许可证与商业模式是 Phase 1 前唯一的硬阻塞**（见 `DEVELOPMENT_PLAN.md` §7）：
   它决定架构是「同地址空间 `evalR()`」还是「独立 R 进程 + Arrow IPC」，事后改代价极高。
   推荐路线 A（AGPL-3.0）。选定路线 A 后 S7 可跳过；若选商业闭源，必须先做 S7。
5. **合规动作**：预置包分发会**实际分发 GPL 二进制**（R 本体、`r.wasm`、全部 DOE/质量包），
   正式发布前需按 §7.4 清单过一遍（THIRD-PARTY-NOTICES、CI license 扫描、CLA、律师审阅）。
   本报告不构成法律意见。
