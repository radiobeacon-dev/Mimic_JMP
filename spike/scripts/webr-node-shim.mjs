/**
 * webR 在 Node + Windows 下的启动补丁（Phase 0 spike 专用）。
 *
 * 问题根源（webR 0.6.1，dist/webr.mjs）：
 *
 *   var ur = h ? __dirname + "/" : "https://webr.r-wasm.org/v0.6.1/";
 *   ...
 *   h && (globalThis.Worker = ze("worker_threads").Worker);
 *   ...
 *   new Worker(`${t.baseUrl}webr-worker.js`)
 *
 * webR 假定自己跑在浏览器里，baseUrl 一定是 http(s) URL，因此可以安全地做
 * 字符串拼接。但在 Node 下 baseUrl 退化为 __dirname，在 Windows 上产生
 * `D:\...\dist\webr-worker.js`，连续触发两次失败：
 *
 *   1. 默认 baseUrl（Windows 盘符路径）
 *      -> ERR_UNSUPPORTED_ESM_URL_SCHEME：Node 把 `D:` 当作 URL scheme
 *   2. 显式传 file:// 字符串
 *      -> ERR_WORKER_PATH：Node 的 new Worker() 要求 URL 对象或
 *         绝对/相对路径，不接受 file:// 字符串
 *
 * Linux/macOS 的 __dirname 以 `/` 开头，本身就是合法的绝对路径，两次都不触发，
 * 所以这是 Windows 专有 bug。
 *
 * 【调用顺序很关键】webR 在模块加载期就会执行
 * `globalThis.Worker = require("worker_threads").Worker`，把全局 Worker 覆盖掉。
 * 因此本补丁必须在 `import('webr')` **之后**安装，否则会被 webR 冲掉。
 * webR 直到构造 channel 时才去读 globalThis.Worker，所以事后覆盖依然有效。
 *
 * 生产环境的对应做法：桌面版走 Tauri，webR 跑在 WebView 里，baseUrl 是
 * http(s) 或 tauri:// 自定义协议，不会遇到此问题；此 shim 仅用于 Node 侧
 * 的自动化验证与 CI。
 */

import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** webr 主入口所在目录（即 dist/），R.wasm 与 webr-worker.js 都在这里 */
export const WEBR_ENTRY = require.resolve('webr');
export const WEBR_DIST = dirname(WEBR_ENTRY);

/**
 * webR 的 baseUrl。**刻意使用普通 Windows 路径而非 file:// URL。**
 *
 * 原因：baseUrl 在 webR 里有两类消费者，需求相反——
 *   (a) Emscripten 资源定位 `locateFile = t => baseUrl + t`，
 *       随后交给 fs.readFileSync 读 R.wasm / R.js —— 需要普通路径
 *   (b) `new Worker(`${baseUrl}webr-worker.js`)` 和 worker 内 `import(...)`
 *       —— 需要 file:// URL
 *
 * 若把 baseUrl 设成 file:// URL，(a) 会拿到 `file:/D:/...` 而 readFileSync 失败；
 * 若设成普通路径，(b) 由本 shim 与 worker 补丁在调用点即时转换。
 * 因此统一用普通路径（以分隔符结尾），转换职责下沉到 (b) 的两个调用点。
 */
export const WEBR_BASE_URL = WEBR_DIST.replace(/\\/g, '/') + '/';

/**
 * 把 new Worker() 的第一个参数规范化为 Node 可接受的形式。
 * Node 只接受：URL 对象、以 / 开头的绝对路径、以 ./ 或 ../ 开头的相对路径。
 */
export function normalizeWorkerTarget(target) {
  if (typeof target !== 'string') return target;

  // A. file:// 字符串 -> 转 URL 对象（Node 明确要求这样包一层）
  if (target.startsWith('file://')) {
    return new URL(target);
  }

  // B. 裸 Windows 盘符路径（默认 baseUrl 未修正时）-> 转 file URL
  if (/^[A-Za-z]:[\\/]/.test(target)) {
    return pathToFileURL(resolve(target));
  }

  // C. 其他 URL（http/https/tauri/blob 等）原样交回，由 webR 自己的加载逻辑处理
  if (target.includes('://')) {
    return target;
  }

  // D. 相对路径或裸文件名 -> 基于 dist 目录解析
  return pathToFileURL(resolve(WEBR_DIST, target));
}

/**
 * 安装 Worker 补丁。**必须在 import('webr') 之后调用。**
 * @returns {{installed: boolean, overwrittenByWebr: boolean}}
 */
export function installWorkerShim() {
  // 仅 Windows 需要：POSIX 的绝对路径本身就能被 new Worker() 接受
  if (process.platform !== 'win32') {
    return { installed: false, overwrittenByWebr: false };
  }

  // webR 加载时会把 globalThis.Worker 设为 worker_threads.Worker，
  // 这里拿到的 Original 就是它——正是我们想包装的那个。
  const Original = globalThis.Worker;
  const overwrittenByWebr = typeof Original === 'function';

  if (!overwrittenByWebr) {
    throw new Error(
      'installWorkerShim() must be called AFTER `await import("webr")`. ' +
        'webR assigns globalThis.Worker during module load; patching earlier ' +
        'gets silently overwritten.'
    );
  }

  function PatchedWorker(filename, options) {
    return new Original(normalizeWorkerTarget(filename), options);
  }

  // 保留原型链，使 `instanceof Worker` 与静态属性访问仍然成立
  PatchedWorker.prototype = Original.prototype;
  Object.setPrototypeOf(PatchedWorker, Original);
  globalThis.Worker = PatchedWorker;

  return { installed: true, overwrittenByWebr };
}

export const shimInfo = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  webrEntry: WEBR_ENTRY,
  webrDist: WEBR_DIST,
  baseUrl: WEBR_BASE_URL,
  workerPatchNeeded: process.platform === 'win32',
};
