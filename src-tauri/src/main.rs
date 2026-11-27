// SPDX-License-Identifier: AGPL-3.0-or-later
// 发布构建不弹出额外的控制台窗口（Windows）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mimic_jmp_lib::run();
}
