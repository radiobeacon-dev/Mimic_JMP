// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { fetchAppInfo, isTauriRuntime, type AppInfo } from './lib/tauri';
import { probeRuntime, type RuntimeCapabilities } from './lib/capabilities';

const MODULES = [
  { name: '数据表 / 导入', phase: 'Phase 1', desc: 'CSV / XLSX / Parquet → DuckDB-Wasm', state: '待实现' },
  { name: 'Graph Builder', phase: 'Phase 1', desc: '拖拽变量槽位 → Vega-Lite 即时出图', state: '待实现' },
  { name: 'Linked Brushing', phase: 'Phase 1', desc: '全局单一 selection store，跨视图联动', state: '待实现' },
  { name: 'Distribution / Fit Y by X', phase: 'Phase 1', desc: '描述统计、t 检验、ANOVA、卡方', state: '待实现' },
  { name: 'Profiler（单响应）', phase: 'Phase 1', desc: 'lm() 拟合后拖滑块看预测响应', state: '待实现' },
  { name: '.mjmp 单文件', phase: 'Phase 1', desc: 'ZIP 容器：数据 + 分析规格 + 结果 + 布局', state: '待实现' },
  { name: 'DOE 设计向导', phase: 'Phase 2', desc: 'FrF2 / rsm / AlgDesign', state: '依赖已验证' },
  { name: '质量工程 / SPC', phase: 'Phase 2', desc: 'qcc 控制图与过程能力', state: '依赖已验证' },
];

const PRINCIPLES = [
  ['数据不进 WASM，聚合结果才进', 'DuckDB-Wasm 承担大数据处理，通过 Arrow 把已聚合/已筛选结果送进 R / Pyodide，绕开 WASM 4GB 上限。'],
  ['联动状态是全局单一数据源', '所有图表订阅同一个 selection store（global / union / intersect），框选 → 重查 → 全视图刷新。'],
  ['两阶段执行', '.init() 瞬时搭结果表骨架，.run() 在 Worker 异步重算，保证 UI 永不卡死。'],
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{value}</span>
    </div>
  );
}

function BoolBadge({ ok, text }: { ok: boolean; text: string }) {
  return <span className={ok ? 'badge ok' : 'badge warn'}>{ok ? '✓' : '✗'} {text}</span>;
}

export default function App() {
  const tauri = isTauriRuntime();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [caps, setCaps] = useState<RuntimeCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    probeRuntime()
      .then((c) => { if (!cancelled) setCaps(c); })
      .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    if (tauri) {
      fetchAppInfo()
        .then((i) => { if (!cancelled) setAppInfo(i); })
        .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    }
    return () => { cancelled = true; };
  }, [tauri]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>mimic-JMP</h1>
          <p className="subtitle">面向制造业 / 研发工程师的 DOE + 质量工程交互分析工具</p>
        </div>
        <div className="header-tags">
          <span className="tag">Phase 1 · 骨架</span>
          <span className="tag accent">AGPL-3.0-or-later</span>
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>运行状态</h2>
          <Row label="运行模式" value={tauri ? 'Tauri 2 桌面运行时' : '浏览器预览（npm run dev）'} />
          {appInfo ? (
            <>
              <Row label="产品 / 版本" value={`${appInfo.product} v${appInfo.version}`} />
              <Row label="Rust" value={appInfo.rustc_version} />
              <Row label="Tauri" value={appInfo.tauri_version} />
              <Row label="目标平台" value={appInfo.target} />
              <Row label="预置 WASM R 包" value={`${appInfo.bundled_r_packages} 个（随安装包分发）`} />
              <Row label="运行时联网装包" value={appInfo.runtime_package_install} />
            </>
          ) : (
            <p className="hint">
              {tauri ? '正在读取 Rust 侧 app_info…' : '未接入 Tauri IPC；Rust 侧信息在 tauri dev 中可见。'}
            </p>
          )}
          {error && <p className="error">IPC / 探测异常：{error}</p>}
        </section>

        <section className="card">
          <h2>运行时能力探针 <span className="note">S1 · Tauri WebView2 变体</span></h2>
          {caps ? (
            <>
              <div className="badges">
                <BoolBadge ok={caps.wasm} text="WebAssembly" />
                <BoolBadge ok={caps.sharedArrayBuffer} text="SharedArrayBuffer" />
                <BoolBadge ok={caps.crossOriginIsolated} text="crossOriginIsolated" />
                <BoolBadge ok={caps.webgl2} text="WebGL2" />
              </div>
              <Row label="最小 WASM 模块编译" value={caps.wasmCompileMs === null ? '不可用' : `${caps.wasmCompileMs} ms`} />
              <Row label="WebView2 (UA 提示)" value={caps.webView2Hint ? 'Chromium/Edge 内核' : '未检出（浏览器预览时正常）'} />
              <p className="hint">
                这是能力探测，不是 S5 验收。S5 需接入 DuckDB-Wasm + Vega-Lite 后，
                实测 100 万行框选全视图刷新 &lt; 100ms。
              </p>
            </>
          ) : (
            <p className="hint">探测中…</p>
          )}
        </section>

        <section className="card wide">
          <h2>环境阻塞项</h2>
          <p className="warning">
            Rust 工具链已安装，但本机<strong>缺少 Microsoft C++ Build Tools（MSVC + Windows SDK）</strong>。
            Tauri v2 官方将其列为 Windows 开发的必需前置依赖；WebView2 运行时已存在，无需再装。
            在补齐前，<code>cargo build</code> / <code>tauri dev</code> 的链接阶段会失败，
            <code>cargo check</code> 也会因 build script 需要 linker 而失败；
            但 <code>cargo fetch</code>、前端构建与 Phase 0 回归均可正常验证。
          </p>
        </section>

        <section className="card wide">
          <h2>架构原则（Phase 0 定案）</h2>
          <div className="principles">
            {PRINCIPLES.map(([title, body], i) => (
              <div className="principle" key={title}>
                <span className="index">{String(i + 1).padStart(2, '0')}</span>
                <div><strong>{title}</strong><p>{body}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="card wide">
          <h2>模块路线图</h2>
          <table className="modules">
            <thead><tr><th>模块</th><th>阶段</th><th>说明</th><th>状态</th></tr></thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.phase}</td>
                  <td>{m.desc}</td>
                  <td><span className={m.state === '依赖已验证' ? 'badge ok' : 'badge'}>{m.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <footer className="footer">
        <span>项目自有代码 AGPL-3.0-or-later；随包分发的 R 组件见 spike/THIRD-PARTY-NOTICES.md</span>
        <span>Phase 0：S1/S2/S3/S4/S6 全 GO · 39 项检查</span>
      </footer>
    </div>
  );
}
