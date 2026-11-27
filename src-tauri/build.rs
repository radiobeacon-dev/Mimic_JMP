// SPDX-License-Identifier: AGPL-3.0-or-later
use std::{env, fs, process::Command};

fn main() {
    // 把构建环境信息注入 Rust 侧 app_info，让 UI 能显示真实工具链版本。
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let rustc_version = Command::new(&rustc)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=MIMIC_RUSTC_VERSION={rustc_version}");

    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=MIMIC_TARGET={target}");

    // 与 Phase 0 的预置包清单联动：不引入 JSON 依赖，只提取 summary.packageCount。
    // 正式构建脚本上线后，这里改为由 packages.lock 驱动的资源打包校验。
    let lock = fs::read_to_string("../spike/packages.lock").unwrap_or_default();
    let count = lock
        .split("\"packageCount\":")
        .nth(1)
        .and_then(|s| s.trim().split(|c: char| !c.is_ascii_digit()).next())
        .filter(|s| !s.is_empty())
        .unwrap_or("0");
    println!("cargo:rustc-env=MIMIC_BUNDLED_R_PACKAGES={count}");
    println!("cargo:rerun-if-changed=../spike/packages.lock");

    tauri_build::build()
}
