import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PATHS, abs} from '../core/paths.js';
import {ensureDir, readJson} from '../core/fsutil.js';
import {loadPipelineConfig} from '../core/config.js';
import {CandidateStore} from '../core/store.js';
import {RUBRIC} from '../scoring/rubric.js';
import * as P from '../pipeline/pipeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, 'public', 'index.html');

export function dashboardData(): Record<string, unknown> {
  const store = new CandidateStore();
  const cfg = loadPipelineConfig();
  const lastDiscovery = fs.existsSync(path.join(PATHS.data, 'last-discovery.json')) ? readJson(path.join(PATHS.data, 'last-discovery.json')) : null;
  return {
    generatedAt: new Date().toISOString(),
    threshold: cfg.scoring.threshold,
    rubric: RUBRIC,
    summary: P.summary(store),
    candidates: store.all(),
    productions: store.productions(),
    lastDiscovery,
  };
}

const ACTIONS = new Set(['favorite', 'unfavorite', 'select', 'reject', 'archive', 'restore', 'approve']);

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json'): void {
  res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
    fs.createReadStream(file, {start, end}).pipe(res);
  } else {
    res.writeHead(200, {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size});
    fs.createReadStream(file).pipe(res);
  }
}

/** Local dashboard: lists candidates and lets you favourite / select / reject / approve. Binds to localhost only. */
export async function startDashboard(port: number): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, fs.readFileSync(INDEX, 'utf8').replace('/*__DATA__*/null', 'null'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/data') return send(res, 200, dashboardData());
      const act = url.pathname.match(/^\/api\/candidates\/([^/]+)\/([a-z]+)$/);
      if (req.method === 'POST' && act) {
        const [, id, action] = act;
        if (!ACTIONS.has(action)) return send(res, 400, {error: 'unknown action'});
        const store = new CandidateStore();
        const c = store.require(decodeURIComponent(id));
        if (action === 'select') P.select(store, c, 'selected in dashboard');
        else if (action === 'approve') P.approve(store, c);
        else P.setStatus(store, c, action as 'favorite');
        return send(res, 200, {ok: true, state: c.state, favorite: c.favorite});
      }
      const vid = url.pathname.match(/^\/video\/(.+\.mp4)$/);
      if (req.method === 'GET' && vid) {
        const file = abs(path.join('output', decodeURIComponent(vid[1])));
        if (!file.startsWith(PATHS.output) || !fs.existsSync(file)) return send(res, 404, {error: 'not found'});
        return serveVideo(req, res, file);
      }
      send(res, 404, {error: 'not found'});
    } catch (e) {
      send(res, 500, {error: (e as Error).message});
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  console.log(`Dashboard: http://localhost:${port}  (Ctrl+C to stop)`);
}

/** Self-contained HTML snapshot (data inlined). Actions are stored in the browser and can be exported as JSON. */
export function buildStaticDashboard(outDir = path.join(PATHS.root, 'dashboard-dist')): string {
  ensureDir(outDir);
  const html = fs.readFileSync(INDEX, 'utf8').replace('/*__DATA__*/null', JSON.stringify(dashboardData()).replace(/</g, '\\u003c'));
  const out = path.join(outDir, 'index.html');
  fs.writeFileSync(out, html);
  return out;
}
