// SPDX-License-Identifier: AGPL-3.0-or-later
import { invoke } from '@tauri-apps/api/core';

/** Rust 侧 `app_info` 命令的返回类型（src-tauri/src/lib.rs）。 */
export interface AppInfo {
  product: string;
  version: string;
  license: string;
  phase: string;
  rustc_version: string;
  tauri_version: string;
  target: string;
  /** 运行时是否允许联网安装 R 包 —— 架构红线：恒为 "forbidden" */
  runtime_package_install: string;
  /** 预置 WASM R 包数量（Phase 0 实测值，构建期由 packages.lock 驱动） */
  bundled_r_packages: number;
}

/** 纯浏览器预览（npm run dev）与 Tauri 运行时用同一套前端代码。 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function fetchAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}
