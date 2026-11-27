# 前端 / Rust 依赖许可证登记（2026-11-27）

> 状态：**部分完成**。`spike/THIRD-PARTY-NOTICES.md` 由 `gen_packages_lock.mjs`
> 从 `packages.lock` 确定性渲染，**只覆盖 33 个随包分发的 WASM R 包，禁止手改**
> （C9 断言会逐字节比对）。本文件登记应用壳的 npm / Cargo 依赖，
> 是 `DEVELOPMENT_PLAN.md` §9 第 4 项「合规待办」的第一批落地。
>
> ✅ **2026-11-27 补充**：项目 `LICENSE` 已由 SPDX 占位替换为
> **AGPL-3.0 逐字全文**，`licenses/` 下附 GPLv2 / GPLv3 官方全文，
> 见文末「许可证全文」。
>
> 以下基于 npm 元数据与上游声明，**不构成法律意见**；发行前仍须律师审阅。

## 本轮新增（Phase 1 数据层 / 联动内核）

| 包 | 版本 | 许可证 | 用途 | 与 AGPL-3.0 的关系 |
|---|---|---|---|---|
| `@duckdb/duckdb-wasm` | 1.32.0（**固定**，未用上游 `latest` 的 dev 版 `1.33.1-dev57.0`） | MIT | OLAP 数据引擎、S5 基准 | 兼容 ✅ |
| `apache-arrow` | 17.0.0（duckdb-wasm 传递依赖） | Apache-2.0 | Arrow 零拷贝结果 | 兼容 ✅ |
| `vega-lite` | 6.5.0 | BSD-3-Clause | 图表规格 / `selection` 语义 | 兼容 ✅ |
| `vega-embed` | 7.4.0 | BSD-3-Clause | 浏览器渲染 | 兼容 ✅ |
| `vega` | 6.4.0（vega-embed 传递，deduped） | BSD-3-Clause | 渲染运行时 | 兼容 ✅ |

MIT / Apache-2.0 / BSD-3-Clause 均为宽松许可证，允许并入 AGPL-3.0 项目；
发行时仍须保留各自版权声明与许可证全文。**不要**把 npm 依赖写进
`spike/THIRD-PARTY-NOTICES.md`——那会让生成器的确定性断言失败。

## 既有应用壳依赖（骨架阶段）

| 包 | 版本 | 许可证 |
|---|---|---|
| `react` / `react-dom` | 19.3.1 | MIT |
| `@tauri-apps/api` | 2.12.5 | Apache-2.0 OR MIT |
| `@tauri-apps/cli` | 2.12.6 | Apache-2.0 OR MIT |
| `vite` | 8.4.0 | MIT |
| `typescript` | 7.0.2 | Apache-2.0 |
| `@vitejs/plugin-react` | 6.3.0 | MIT |
| `@types/react` / `@types/react-dom` | 19.3.x | MIT |

## 许可证全文（✅ 已完成，2026-11-27）

| 文件 | 内容 | 字节数 | sha256 |
|---|---|---:|---|
| `LICENSE` | 版权 + SPDX 头 + **AGPL-3.0 逐字全文** | 35586 | 见 `licenses/SOURCES.md` |
| `licenses/AGPL-3.0.txt` | GNU 官方 AGPLv3 逐字副本 | 34523 | `0d96a4ff68ad…` |
| `licenses/GPL-3.0.txt` | GNU 官方 GPLv3 逐字副本 | 35149 | `3972dc9744f6…` |
| `licenses/GPL-2.0.txt` | GNU 官方 GPLv2 逐字副本 | 17984 | `edaef632cbb6…` |

来源 URL、完整 sha256 与「为什么需要三份」见 `licenses/SOURCES.md`。
`spike/scripts/license_texts.mjs` 提供 `--fetch`（维护期联网重建）与
`--check`（离线校验，零外网）；校验结果接入 `verify_licenses.mjs` 的 **C11**，
两种门禁模式（full / `--lock-only`）都会执行。`THIRD-PARTY-NOTICES.md`
的「许可证全文」一节由生成器渲染，已同步更新。

## 仍未完成（正式发行前必须补）

1. **432 个 Rust crate**：`src-tauri/Cargo.lock` 已锁定，但许可证清单未生成。
   需从 Cargo registry 缓存逐包读 `Cargo.toml` 的 `license` 字段并分类。
2. **npm 传递依赖全量扫描**：`package-lock.json` 现含 144 个包，
   当前只登记顶层与直接相关包，需脚本化生成完整清单。
3. **CI 断言**：把上述清单接进 `verify_licenses.mjs`（新增 C13），
   阻止未登记 / 非宽松依赖混入。
4. 发行包交开源合规律师审阅。
5. `AGPL` 与 GPL 组件的关系沿用 `DEVELOPMENT_PLAN.md` §7.1 / §7.5.1：
   GPL-2-only 的 7 个 R 包按「聚合体」独立分发，不合并进自有二进制。

## 校验命令

```bash
npm ls --depth=0
npm run verify:licenses      # 离线校验三份全文 sha256 与 LICENSE 正文
npm run verify:all
node spike/scripts/verify_licenses.mjs
```
