// SPDX-License-Identifier: AGPL-3.0-or-later
//! Tauri 2 桌面壳。职责边界（见 docs/DEVELOPMENT_PLAN.md §4）：
//! 窗口 / 文件系统 / 菜单 / 自动更新 / **本地资源托管**（预置 WASM R 包）。
//! 统计计算全部在前端 WASM 里完成，Rust 侧不做任何数值算法。

mod mjmp;

use serde::Serialize;

/// 前端 `src/lib/tauri.ts` 中 `AppInfo` 对应的返回结构。
#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub product: &'static str,
    pub version: &'static str,
    pub license: &'static str,
    pub phase: &'static str,
    pub rustc_version: String,
    /// 精确版本见 Cargo.lock；这里只锁大版本，避免与依赖解析耦合。
    pub tauri_version: &'static str,
    pub target: &'static str,
    /// 架构红线：运行时不允许联网安装 R 包（Phase 0 实测结论）。
    pub runtime_package_install: &'static str,
    /// 由 spike/packages.lock 的 summary.packageCount 注入（build.rs）。
    pub bundled_r_packages: usize,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        product: "mimic-JMP",
        version: env!("CARGO_PKG_VERSION"),
        license: "AGPL-3.0-or-later",
        phase: "Phase 1 / skeleton",
        rustc_version: env!("MIMIC_RUSTC_VERSION").to_string(),
        tauri_version: "2",
        target: env!("MIMIC_TARGET"),
        runtime_package_install: "forbidden — WASM R packages are bundled and mounted via NODEFS",
        bundled_r_packages: env!("MIMIC_BUNDLED_R_PACKAGES").parse().unwrap_or(0),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("failed to launch mimic-JMP");
}
