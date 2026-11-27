// SPDX-License-Identifier: AGPL-3.0-or-later
//! `.mjmp` 单文件容器 —— Phase 1 待实现的格式占位。
//!
//! 设计（见 docs/DEVELOPMENT_PLAN.md §5 Phase 1）：
//! 一个 ZIP 容器，把「数据 + 分析规格 + 结果 + 布局」打包成一个可移植文件：
//!
//! ```text
//! manifest.json          // 格式版本、创建时间、分析节点依赖图
//! data/*.parquet         // 原始表（Arrow / Parquet，DuckDB-Wasm 直接读）
//! analysis/*.json        // 两阶段执行结果（.init() 骨架 + .run() 数值）
//! layout.json            // 窗口 / 图表槽位 / selection store 快照
//! ```
//!
//! Phase 0 的架构红线同样适用：**R 包不进 .mjmp**，运行时由安装包自带的
//! 预置 WASM 包经 NODEFS 挂载，因此文件本身不携带任何 GPL 二进制。

pub const MANIFEST_ENTRY: &str = "manifest.json";
pub const LAYOUT_ENTRY: &str = "layout.json";
pub const DATA_PREFIX: &str = "data/";
pub const ANALYSIS_PREFIX: &str = "analysis/";
pub const FORMAT_VERSION: u32 = 1;
