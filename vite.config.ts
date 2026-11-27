// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 2 官方推荐的 Vite 配置：端口固定 1420、不监听 src-tauri、
// 暴露 TAURI_ENV_* 环境变量。前端产物输出到 dist/，由 tauri.conf.json
// 的 frontendDist 指向 ../dist。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 (Chromium) 与主流浏览器都支持 ES2022；
    // 不用 legacy 目标，避免为 WASM 引入额外 polyfill。
    target: 'es2022',
    sourcemap: true,
  },
});
