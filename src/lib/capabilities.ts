// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 运行时能力探针 —— 对应 Phase 0 遗留的「S1 Tauri WebView2 变体」。
 *
 * 这里只做**能力是否存在**的轻量探测，不是 Phase 1 的 S5 性能验收：
 * S5 要求「100 万行数据框选后全视图刷新 < 100ms」，需要 DuckDB-Wasm +
 * Vega-Lite 联动真正接起来之后才能测。本探针用于尽早发现 WebView2 缺少
 * WASM / SharedArrayBuffer 这类会导致架构返工的问题。
 */

export interface RuntimeCapabilities {
  /** WebAssembly 能否编译一个最小合法模块 */
  wasm: boolean;
  /** 编译该最小模块的耗时（毫秒），仅作纵向对比基线 */
  wasmCompileMs: number | null;
  /** DuckDB-Wasm 多线程需要 SharedArrayBuffer */
  sharedArrayBuffer: boolean;
  /** 跨域隔离状态，影响 SharedArrayBuffer 可用性 */
  crossOriginIsolated: boolean;
  /** Plotly 3D / WebGL 图表需要 */
  webgl2: boolean;
  /** 基于 UA 的 WebView2 提示（非权威判定） */
  webView2Hint: boolean;
  userAgent: string;
}

// 最小合法 WASM 模块：magic(\0asm) + version(1)，无 section。
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export async function probeRuntime(): Promise<RuntimeCapabilities> {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  let wasm = false;
  let wasmCompileMs: number | null = null;

  if (typeof WebAssembly !== 'undefined') {
    try {
      const t0 = performance.now();
      await WebAssembly.compile(EMPTY_WASM_MODULE);
      wasmCompileMs = Math.round((performance.now() - t0) * 100) / 100;
      wasm = true;
    } catch {
      wasm = false;
    }
  }

  let webgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    webgl2 = canvas.getContext('webgl2') !== null;
  } catch {
    webgl2 = false;
  }

  return {
    wasm,
    wasmCompileMs,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean'
      ? globalThis.crossOriginIsolated
      : false,
    webgl2,
    webView2Hint: /Edg\//.test(ua),
    userAgent: ua,
  };
}
