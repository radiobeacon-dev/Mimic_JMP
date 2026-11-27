/**
 * 独立进程的本地 R 包 repo（webR 的 contrib-style 仓库镜像）。
 *
 * 为什么必须独立进程：
 *   webR 在 Node 下把 utils::download.file 实现为「同步 XHR」，由主线程
 *   通过 Atomics/SharedArrayBuffer 代理执行。若 HTTP server 与 webR 同处
 *   一个进程，同步请求会与目标 server 争抢同一个 event loop，高频调用时
 *   出现自请求竞态（实测连续装到第 22 个包开始 download.file failed）。
 *   把 server 放到独立进程，代理请求发往另一个进程，彻底消除该竞态。
 *
 * 目录约定（由 s2_offline.mjs 的 P1-P4 生成）：
 *   local-repo/PACKAGES     精简 DCF 索引（只含目标闭包条目）
 *   local-repo/tgz/*.tgz    预下载的 WASM R 包二进制
 *
 * 扁平文件名匹配：不关心 webR 拼出的 `/bin/emscripten/contrib/4.6/` 子路径，
 * 只看最后一段文件名，因此 repoUrl 可以直接指向根。
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..', 'local-repo');
const TGZ_DIR = join(REPO_DIR, 'tgz');
const PORT = Number(process.env.REPO_PORT || 18765);

const compactIndex = readFileSync(join(REPO_DIR, 'PACKAGES'), 'utf8');
let served = 0;
let missing = 0;

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const fname = urlPath.split('/').pop();

  if (/^PACKAGES(\..*)?$/.test(fname) || urlPath.endsWith('/PACKAGES')) {
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(compactIndex);
    return;
  }

  if (fname.endsWith('.tgz')) {
    const p = join(TGZ_DIR, fname);
    if (existsSync(p)) {
      const buf = readFileSync(p);
      served++;
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': buf.length,
        'access-control-allow-origin': '*',
      });
      res.end(buf);
      return;
    }
    missing++;
    console.log(`MISSING ${fname}`);
  }

  res.writeHead(404, { 'access-control-allow-origin': '*' });
  res.end('not found');
});

// 不主动关闭连接：webR 的 XHR 代理依赖 keep-alive 复用，强制 close 反而
// 会让它更早失败（第二次实验加 Connection: close 后提前到第 22 个包断）。
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`READY ${PORT}`);
});

process.on('message', (msg) => {
  if (msg === 'stats') {
    process.send?.({ type: 'stats', served, missing });
  }
  if (msg === 'shutdown') {
    server.close(() => process.exit(0));
  }
});

// 父进程退出时自行收尾
process.on('disconnect', () => {
  server.close(() => process.exit(0));
});
