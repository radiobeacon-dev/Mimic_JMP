/**
 * 给 webR 0.6.1 打 Windows 兼容补丁。
 *
 * webR 假设自己跑在浏览器里，全链路都用「字符串拼接 URL」的方式定位资源。
 * 在 Node + Windows 下这套假设全线失效，共有 3 处需要修：
 *
 *   [1] dist/webr.mjs  — 默认 baseUrl
 *       var ur = h ? __dirname + "/" : "https://webr.r-wasm.org/v0.6.1/";
 *       → Windows 上得到 `D:\...\dist\`
 *       修法：不改文件，构造 WebR 时显式传 file:// baseUrl（见 s1 脚本）
 *
 *   [2] dist/webr.mjs  — 主线程创建 Worker
 *       new Worker(`${t.baseUrl}webr-worker.js`)
 *       → 即使 baseUrl 是合法 file:// 字符串，Node 也要求 URL 对象
 *       修法：不改文件，运行时包一层 globalThis.Worker（webr-node-shim.mjs）
 *
 *   [3] dist/webr-worker.js — worker 内部动态加载 Emscripten 库
 *       await import((await import("path")).default.resolve(e))
 *       → path.resolve() 产出 `D:\...\libRblas.so`，import() 拒绝 d: 协议
 *       修法：**必须改文件**，因为 worker 运行在独立线程，外部无法注入
 *
 * 只有 [3] 需要真正落盘修改。本脚本幂等：可反复运行，已打过则跳过。
 *
 * 影响范围说明：这 3 个问题都只出现在 **Node + Windows**。生产环境走 Tauri，
 * webR 跑在 WebView 里，baseUrl 是 http(s):// 或 tauri:// 协议，[1][2][3] 均不触发。
 * 打这个补丁的目的是让 S1/S2 能在 Node 里快速自动化验证（含 CI），
 * 不必为此先装 Rust 工具链。
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WEBR_DIST = dirname(require.resolve('webr'));
const WORKER_FILE = join(WEBR_DIST, 'webr-worker.js');
const BACKUP_FILE = WORKER_FILE + '.orig-backup';

/** [3] 的原始片段与替换片段 */
const PATCH = {
  id: 'worker-dynamic-import-windows-path',
  find: 'await import((await import("path")).default.resolve(e))',
  // 只转换「裸 Windows 盘符路径」，其余（file:// URL、POSIX 绝对路径、
  // http(s)）原样传回。
  // 关键点：不能无条件包 pathToFileURL(path.resolve(e))——
  // 当 e 已经是 file:// URL 时，path.resolve() 会把它当相对路径拼到 cwd 上，
  // 产生 `D:\...\spike\file:\D:\...\R.js` 这种畸形路径。
  replace:
    'await import(/^[A-Za-z]:[\\\\/]/.test(e)?(await import("url")).pathToFileURL((await import("path")).default.resolve(e)).href:e)',
};

/**
 * 上一版补丁（无条件 pathToFileURL）会把 file:// URL 交给 path.resolve()，
 * 导致路径被拼坏。若检测到它，先从备份还原再打新补丁。
 */
const OBSOLETE_PATCH_MARKER =
  'await import((await import("url")).pathToFileURL((await import("path")).default.resolve(e)).href)';

function main() {
  console.log('=== webR Windows 兼容补丁 ===');
  console.log(`目标: ${WORKER_FILE}`);

  if (!existsSync(WORKER_FILE)) {
    console.error(`[ERROR] 找不到 ${WORKER_FILE}，请先 npm install webr`);
    process.exit(1);
  }

  // 若曾打过旧版补丁，先还原到原始文件，保证下面的替换基于已知起点
  if (existsSync(BACKUP_FILE)) {
    const current = readFileSync(WORKER_FILE, 'utf8');
    if (current.includes(OBSOLETE_PATCH_MARKER)) {
      copyFileSync(BACKUP_FILE, WORKER_FILE);
      console.log('[restore] 检测到旧版补丁，已从备份还原');
    }
  }

  const src = readFileSync(WORKER_FILE, 'utf8');

  // 幂等：已打过补丁则直接返回
  if (src.includes(PATCH.replace)) {
    console.log(`[${PATCH.id}] 已应用，跳过`);
    reportDone(true);
    return;
  }

  const occurrences = src.split(PATCH.find).length - 1;
  if (occurrences === 0) {
    // webR 升级后可能改了实现——这时不能盲目继续
    console.error(
      `[ERROR] 未找到待补丁片段，webR 实现可能已变化。\n` +
        `        期望片段: ${PATCH.find}\n` +
        `        请检查 webr 版本并更新本脚本。`
    );
    process.exit(2);
  }
  if (occurrences > 1) {
    console.error(
      `[ERROR] 待补丁片段出现 ${occurrences} 次（预期 1 次），为避免误伤已中止。`
    );
    process.exit(2);
  }

  // 备份（仅首次）
  if (!existsSync(BACKUP_FILE)) {
    copyFileSync(WORKER_FILE, BACKUP_FILE);
    console.log(`[backup] 原文件已备份到 ${BACKUP_FILE}`);
  }

  const patched = src.replace(PATCH.find, PATCH.replace);
  writeFileSync(WORKER_FILE, patched, 'utf8');

  // 回读校验
  const verify = readFileSync(WORKER_FILE, 'utf8');
  if (!verify.includes(PATCH.replace)) {
    console.error('[ERROR] 写入后校验失败');
    process.exit(3);
  }

  console.log(`[${PATCH.id}] 已应用 (size ${src.length} -> ${patched.length})`);
  reportDone(false);
}

function reportDone(wasAlreadyPatched) {
  console.log('');
  console.log(wasAlreadyPatched ? '补丁状态: 无需变更' : '补丁状态: 已写入');
  console.log('');
  console.log('提醒: 另两处问题（默认 baseUrl / new Worker 字符串）由运行时解决，');
  console.log('      见 scripts/webr-node-shim.mjs 与各 spike 脚本，无需改文件。');
}

main();
