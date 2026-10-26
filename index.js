/** Host half of @local/space-background.
 *
 * 纯客户端插件：星空引擎、面板与全局背景全部运行在 Web 侧
 * （window.__ModuleLoader__.load 加载 client.js）。
 *
 * ── 诊断通道（临时）────────────────────────────────────────────────────
 * 这个插件的效果全在浏览器侧，而它的失败又是静默的（React 吞掉 effect 异常）。
 * 为了不依赖开发者工具就能定位问题，Host 半注册一个只写本地文件的路由：
 *
 *   POST /plugins/space-background/diag   { ...任意 JSON... }
 *   GET  /plugins/space-background/diag   读回最后一次上报
 *
 * 数据落到 `<DSH_HOME>/space-background-diag.json`，模型可直接读文件，
 * 从而看到浏览器里真实的 canvas 数量、层级、CSS 命中情况。
 *
 * 该通道只在诊断期存在，问题定位后会删除。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = '/plugins/space-background/diag';

function diagPath() {
  const home = process.env.DSH_HOME || 'D:/DeepseekHarnessData/.dsh';
  return join(home, 'space-background-diag.json');
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 262144) { req.destroy(); resolve(''); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

/** Cordis 插件导出：诊断通道只需要 webServer，用 ctx.inject 惰性等待它就绪，
 *  这样即使宿主没有这个服务，也不会让整个 bundle 挂掉（插件本体照常工作）。 */
export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    const web = hostCtx.webServer;
    if (!web || typeof web.register !== 'function') {
      try { ctx.logger?.warn('space-background: webServer.register 不可用，诊断通道跳过'); } catch (e) { /* ignore */ }
      return;
    }

    ctx.effect(() => {
      const dispose = web.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'POST') {
              const text = await readBody(req);
              let parsed;
              try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
              const doc = { receivedAt: Date.now(), payload: parsed };
              writeFileSync(diagPath(), JSON.stringify(doc, null, 2), 'utf8');
              json(res, 200, { ok: true });
              return;
            }
            if (req.method === 'GET') {
              if (!existsSync(diagPath())) { json(res, 404, { ok: false, reason: 'no-report-yet' }); return; }
              json(res, 200, JSON.parse(readFileSync(diagPath(), 'utf8')));
              return;
            }
            json(res, 405, { ok: false, reason: 'method' });
          } catch (error) {
            try { json(res, 500, { ok: false, reason: String(error) }); } catch (e) { /* ignore */ }
          }
        },
      });
      return () => { try { dispose(); } catch (e) { /* ignore */ } };
    }, 'space-background: diag route');
  });
}
