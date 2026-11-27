# Phase 1 骨架交付说明（2026-11-26）

> 承接 Phase 0 完整放行与路线 A（AGPL-3.0-or-later）定案。
> 本次只做两件事：**装 Rust 工具链** + **起 Tauri 2 骨架**，不写业务代码。
> 本文是环境结论与可复跑记录；总体计划见 `DEVELOPMENT_PLAN.md` §4 / §5 / §9。

---

## 1. 环境实测

| 项 | 结果 | 说明 |
|---|---|---|
| Rust | ✅ `rustc` / `cargo` **1.100.0**，rustup 1.29.3 | host `x86_64-pc-windows-msvc`，minimal profile |
| MSVC C++ Build Tools | ❌ **缺失** | 无 `cl.exe`、无 Visual Studio、无 Windows SDK |
| WebView2 Runtime | ✅ 已装 `158.0.4370.33` | Tauri v2 的 Windows 前置之一，无需再装 |
| Node / npm | ✅ v22.22.2 / 10.9.7 | 前端 Vite 8 需要 Node ≥ 22.12 |
| 网络通道 | ✅ static.rust-lang.org、npm registry、rsproxy 均可达 | `curl` 被沙箱拦，下载一律走 Node fetch |
| 磁盘 | C: 282G 可用 / D: 652G 可用 | 充足 |

> Tauri v2 官方前置（https://v2.tauri.app/start/prerequisites/）明确：
> **Windows 开发必须安装 Microsoft C++ Build Tools（"Desktop development with C++"）+
> WebView2**，GNU/MinGW 不是官方支持路径。本机只缺前者。

## 2. 目录结构（新增部分）

```text
mimic-JMP/
├── package.json              # 根：前端 + tauri 脚本（license: AGPL-3.0-or-later）
├── package-lock.json          # 入库，保证前端可复现
├── index.html
├── vite.config.ts             # 固定端口 1420、忽略 src-tauri、TAURI_ENV_* 前缀
├── tsconfig.json / src/vite-env.d.ts
├── src/
│   ├── main.tsx / App.tsx / styles.css
│   └── lib/
│       ├── tauri.ts            # app_info IPC 封装 + isTauriRuntime()（浏览器预览降级）
│       └── capabilities.ts    # WASM / SAB / crossOriginIsolated / WebGL2 探针
├── src-tauri/
│   ├── Cargo.toml             # tauri 2 + tauri-build 2 + serde；AGPL 声明
│   ├── Cargo.lock             # 入库，锁定 432 个 crate
│   ├── build.rs               # 注入 rustc 版本、TARGET、packages.lock 包数
│   ├── tauri.conf.json         # 主窗口 1280×800、CSP 放行 'wasm-unsafe-eval'
│   ├── capabilities/default.json
│   ├── src/{main.rs,lib.rs,mjmp.rs}
│   └── icons/README.md        # 图标占位说明（bundle.icon 暂为空数组）
├── spike/                     # Phase 0 验证工程（独立 package.json，未改动）
└── docs/DEVELOPMENT_PLAN.md / PHASE0_SPIKE_REPORT.md / PHASE1_SKELETON.md
```

`spike/` 与根工程**互不干扰**：`npm run verify:phase0` 会进入 `spike/` 跑原有 39 项回归。

## 3. 骨架的设计意图（不是空窗口）

- **前端状态看板**：显示 Tauri/Rust 版本、目标平台、预置 WASM R 包数、
  「运行时联网装包 = forbidden」这条 Phase 0 红线；浏览器预览（`npm run dev`）
  与 Tauri 运行时共用同一套代码，无 IPC 时自动降级。
- **运行时能力探针**（`src/lib/capabilities.ts`）：对应 Phase 0 遗留的
  **S1 Tauri WebView2 变体**。只探测能力是否存在（WASM 可编译、
  SharedArrayBuffer、crossOriginIsolated、WebGL2），**不是 S5 性能验收** ——
  S5 要求 100 万行框选全视图刷新 < 100ms，必须等 DuckDB-Wasm + Vega-Lite 接通后再测。
- **Rust 侧保持薄壳**：只做窗口 + `app_info` IPC，不做任何数值算法（符合 §4 分层）。
  `build.rs` 从 `../spike/packages.lock` 读 `packageCount` 注入前端，
  把 Phase 0 的预置包清单与桌面壳连起来；`mjmp.rs` 是 `.mjmp`（ZIP 容器）的格式占位。
- **三条架构原则**写在 UI 与代码注释里，作为后续实现的约束：
  数据不进 WASM、联动单一 selection store、两阶段 `.init()`/`.run()`。
- **CSP 已放行 `'wasm-unsafe-eval'`** —— webR / DuckDB-Wasm / Pyodide 都需要它，
  否则后续接入时会被 Tauri 默认 CSP 挡住。

## 4. 验证结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `rustc --version` / `cargo --version` | ✅ 1.100.0 | 后台重装后正常 |
| `npm install`（根） | ✅ 0 | 7 个顶层依赖，audit 0 漏洞 |
| `npm run build`（vite build） | ✅ 0 | 20 modules，JS 226.87 kB / gzip 72.15 kB |
| `npm run typecheck`（tsc --noEmit） | ✅ 0 | 补装 `@types/react` 19.3.3 / `@types/react-dom` 19.3.0 后通过 |
| `npm run verify:phase0` | ✅ 0 | S1/S2/S4/S6 共 39 项 + 许可证门禁 12/12 + CLA C12，全绿 |
| `cargo metadata --no-deps` | ✅ 0 | `mimic-jmp v0.1.0`、3 个 target、4 个直接依赖、AGPL 声明 |
| `cargo fetch`（rsproxy sparse） | ✅ **0（1m32s 完成）** | 锁定 **432 个 crate**：tauri 2.12.7 / tauri-build 2.7.6 / serde 1.0.229；`Cargo.lock` 111 KB 入库 |
| `rustc` 最小程序编译探针 | ❌ **预期失败** | `linking with link.exe failed` → 确认缺 MSVC linker |
| `cargo check` / `npm run tauri dev` | ⛔ **未跑通** | 依赖已下载，但 build script 编译需要 MSVC linker；见 §6 |

> `cargo check` 无法完成不是代码问题：`cargo check` 要编译并**运行 build script**，
> 而 build script 是可执行文件，链接阶段同样需要 MSVC linker。
> 已用独立的最小 `rustc` 探针把这一点坐实，避免在依赖树里误判错误来源。

## 5. 三个真实发现（踩坑记录）

1. **rustup 首次安装被前台超时打断** → `~/.cargo/bin` 代理齐全、
   `~/.rustup/toolchains/` 目录存在，但 `missing manifest in toolchain`、
   `rustup show` 显示 `installed targets:` 为空。
   `rustup default stable` 会复用这个残缺安装（只设 default，不重下）。
   必须 `rustup toolchain uninstall … && rustup toolchain install … --profile minimal`
   **放进后台任务**重跑（耗时 7m37s）才修好。
2. **crates.io sparse index 在本机挂住**：原始索引下 `cargo fetch` 跑 12 分钟，
   `Cargo.lock` 未生成、registry cache 为空；但 Node 直连
   `index.crates.io/config.json` 仅 294ms。改为 **`cargo --config` 临时切 rsproxy
   sparse 索引**（不改任何全局/仓库配置）后立即解析并下载。
   复现命令见 §8。
3. **Git Bash 的 GNU `link` 会冒充 MSVC linker**：`rustc` 报
   `link: extra operand … Try 'link --help'`，看起来像参数错误，
   实际是 PATH 里没有 MSVC 的 `link.exe`，命中了 coreutils 的 `link`。
   即使装好 VS Build Tools，也应在 **"x64 Native Tools Command Prompt"
   或 PowerShell** 里跑 cargo/tauri，避免 Git Bash 的 PATH 顺序干扰。

## 6. 明确阻塞与下一步（按顺序）

1. **装 Microsoft C++ Build Tools**（唯一硬阻塞）：
   https://visualstudio.microsoft.com/visual-cpp-build-tools/ ，
   勾选 "Desktop development with C++"（含 MSVC 编译器 + Windows 10/11 SDK）。
   装完重启终端，在 x64 Native Tools 环境里执行：
   ```bash
   cd src-tauri && cargo check
   npm run tauri dev
   ```
2. **S1 的 Tauri WebView2 变体**：在真实 WebView2 窗口里跑 `capabilities.ts` 探针，
   确认 WASM / memory64 / SharedArrayBuffer 可用（当前只是浏览器侧探测）。
3. **补齐应用图标**：`npm run tauri icon <source.png>`，并更新
   `tauri.conf.json` 的 `bundle.icon`（见 `src-tauri/icons/README.md`）。
4. **Phase 1 功能**：DuckDB-Wasm 数据层 → Perspective 表格 → Graph Builder →
   Linked Brushing（S5 百万行 <100ms 基准）→ `.mjmp` 读写。
5. **预置 WASM R 包的产品化打包**：把 `spike/local-repo/library/`（33 包）
   打进应用资源，运行时 NODEFS 挂载（Phase 0 已验证，尚未接入骨架）。
6. **合规待办（新增）**：本次引入 432 个 Rust crate 与若干 npm 包，
   其许可证尚未登记。当前 `spike/THIRD-PARTY-NOTICES.md` **只覆盖 33 个 R 包**；
   正式发行前需把 Rust/npm 依赖清单纳入第三方声明与 CI 扫描
   （AGPL 与 MIT/Apache-2.0 兼容，但需履行署名与源码提供义务）。
   另外前端依赖的 `packages.lock` 驱动构建脚本仍待做（§9 第 5 项）。

## 7. 尚未验证 / 不要误判为完成

- ❌ 桌面窗口**没有真正跑起来**（缺 MSVC），`tauri dev` / `tauri build` 均未验证。
- ❌ S5 联动性能、S1 的 WebView2 变体：只写了探针，未出结论。
- ❌ `.mjmp` 只是格式常量占位，未实现 ZIP 读写。
- ✅ 可确认：Rust 工具链可用、Cargo.toml 合法、依赖树可解析并已锁定、
   前端可构建且类型检查通过、Phase 0 回归未受破坏、CLA 与许可证门禁仍全绿。

## 8. 命令速查

```bash
# 前端（浏览器预览，无需 Rust）
npm install
npm run dev                 # http://localhost:1420
npm run build
npm run typecheck

# Phase 0 回归（不要因为起骨架就跳过）
npm run verify:phase0

# Rust 侧（当前环境需先装 MSVC Build Tools）
cd src-tauri
cargo metadata --no-deps --format-version 1
cargo fetch
cargo check

# 若 crates.io 索引再次挂住，临时切国内稀疏索引（不落盘、不改配置）
cargo --config 'source.crates-io.replace-with="rsproxy-sparse"' \
      --config 'source.rsproxy-sparse.registry="sparse+https://rsproxy.cn/index/"' \
      --config 'registries.crates-io.protocol="sparse"' fetch

# 桌面运行（装完 MSVC 后，建议用 x64 Native Tools 终端）
npm run tauri dev

# Phase 1 数据层 / 联动 / 全量回归（不需要 Rust）
npm run test:selection      # 联动内核 31 项
npm run test:demo           # 前端演示 SSR 冒烟 7 项
npm run verify:s5           # 100 万行 S5 基准
npm run verify:all          # 全流水线（含 Phase 0 回归）
```

---

## 9. Phase 1 数据层与 S5 基准（2026-11-27）

### 9.1 为什么缺 MSVC 也能继续

MSVC 只阻塞 Rust 侧的链接（`cargo check` / `tauri dev`）。数据层、联动内核与
性能基准全部跑在 **Node 22 + DuckDB-Wasm** 上，前端用 Vite 构建与 SSR 冒烟验证，
因此这部分可以独立推进并给出可复现结论，不占用桌面窗口。

### 9.2 新增代码

| 文件 | 作用 |
|---|---|
| `src/lib/selection.ts` | 全局单一 selection store；global / union / intersect；SQL 谓词编译（列名白名单 + 数值校验防注入）、`matchesSelection` 纯 JS 交叉验证、订阅通知 |
| `src/lib/demoData.ts` · `src/components/LinkedBrushingDemo.tsx` | 可运行联动演示：散点框选 → store → 直方图高亮；三种模式切换；实时显示编译出的 SQL 谓词 |
| `src/lib/s5Result.ts` | S5 展示值（`spike/results/` 不入库，故固化结论） |
| `spike/scripts/duckdb-harness.mjs` | DuckDB-Wasm Node 数据层：本机 bundle、instantiate、Arrow 结果物化、按 selection 刷新多视图 |
| `spike/scripts/test_selection.mjs` | 联动内核单测 31/31 |
| `spike/scripts/s5_linked_brushing.mjs` | S5 百万行基准，结果写 `spike/results/s5_linked_brushing.json` |
| `spike/scripts/test_demo_ssr.mjs` | 前端演示 SSR 冒烟 7/7 |
| `spike/scripts/probe_duckdb_node.mjs` | DuckDB-Wasm Node 入口探针（保留作回归依据） |

### 9.3 依赖与关键 API 结论（实测踩坑）

- 上游 `latest` 指向 **dev 版** `1.33.1-dev57.0`，故固定 `@duckdb/duckdb-wasm@1.32.0`。
- `package.json` 未列进 exports，不能用 `require.resolve('@duckdb/duckdb-wasm/package.json')`；
  改用已导出的 `dist/duckdb-mvp.wasm` 子路径反推 dist 目录。
- **`createDuckDB()` 只构造对象，必须再 `await db.instantiate()`** 才真正加载 WASM；
  漏掉会报 `Cannot read properties of null (reading 'ccall')`。
- Node blocking 入口是 `@duckdb/duckdb-wasm/blocking`（`NODE_RUNTIME` + `VoidLogger`），
  `conn.query()` 同步返回 Arrow Table；BIGINT 需转 Number 才能 JSON 序列化。
- Node 22 默认支持 TS 类型擦除，`.mjs` 可直接 `import '../../src/lib/selection.ts'`，
  前端与基准共用同一份实现（前提：不用 enum / namespace / 参数属性 / private 修饰符）。
- `spike/node_modules` 里另有一份 `react-dom`，SSR 测试必须从项目根用
  `createRequire(ROOT/package.json)` 解析并配 `resolve.dedupe`，否则双 React 实例
  触发 `Invalid hook call`。

### 9.4 S5 实测结果（验收线 100ms）

| 指标 | 值 |
|---|---|
| 数据集 | 100 万行，温度 / 压力 / 机台 / 良率（含真实相关性） |
| 引擎 | DuckDB-Wasm 1.32.0，node blocking，零外网 |
| WASM 实例化 | ~443ms（一次性，不计入交互延迟） |
| 全链路 p50 / p95 | **35.56 / 49.37 ms**（30 次测量 + 5 次预热） |
| 视图 | 3 个：温度直方 / 机台均值 / temp-yield 相关系数 |
| 跨实现一致性 | SQL 谓词命中数 = 纯 JS `matchesSelection` 命中数（575 = 575） |
| 结论 | **GO 7/7** |

**已知缺口**：精确 `union` 双框选 p50 **141.46ms > 100ms**；
`intersect` 26.16ms、`global` 34.03ms 正常。原因是 OR 谓词对 100 万行逐行求值，
外接矩形预筛选（`bbox AND (c1 OR c2)`，语义严格等价）只降到约 143ms，帮助有限。

**对策已验证**：2 单位分箱预聚合立方体（3161 行，构建 35ms）把 union 降到
**3.46ms**（约 40×），代价是边界 bin 整箱计入导致 9.32% 计数误差（近似路径）。
这正是 Phase 0 表里给 S5 写的 Plan B「降低联动粒度 / 预聚合」。
产品层可在大结果集的 union 模式下启用降级；分箱粒度可调。

### 9.5 不要误判为完成

- ❌ 桌面窗口仍未跑起来（缺 MSVC），**WebView2 内的 WASM 性能 / S1 变体 / memory64 未实测**。
- ❌ Perspective 数据表格、Graph Builder 拖拽、`.mjmp` 读写、Vega-Lite 实际渲染均未做
  （vega 依赖已装，但本轮只在 Node 侧验证数据链路）。
- ❌ 预聚合是**近似**路径，尚未接进产品数据层；精确 union 超标仍是待解决项。
- ✅ `npm run verify:all` 退出码 0：typecheck / build / Phase 0 39 项 + 许可证 12 项
  + CLA C12 / selection 31 项 / SSR 7 项 / S5 7 项全绿。

---

> 本文件中的许可证与合规判断沿用 `DEVELOPMENT_PLAN.md` §7，**不构成法律意见**；
> 正式发布前须由开源合规律师审阅发行包。
