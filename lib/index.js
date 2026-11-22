/**
 * dsh-plugin-sidebar-groups — Host half.
 *
 * 本包的界面逻辑全部在浏览器端（client.js）：
 *   1) 侧栏分组：面板收纳、工作区折叠、更多菜单拖拽重排、原生滚动接管
 *   2) 星轨协议 2077 外观子系统（由 dsh-plugin-starlight-protocol 并入）：
 *      深空天体背景、赛博朋克 HUD 主题、开机冷启动序列、侧栏隐藏总控
 *
 * Host 半边负责后者需要的三件事：
 *   - 提供 /dsh-starlight 的 splash.css / splash.js / 音频素材静态路由
 *   - 读写统一配置 ~/.dsh/dsh-starlight.json（兼容历史 dsh-startup.json）
 *   - 在 index.html 注入开机冷启动序列的挂载点与引导脚本
 *
 * 所有外部依赖都单独兜住：服务缺失只降级对应功能，绝不中断 DSH 启动。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const name = 'dsh-plugin-sidebar-groups'
const inject = ['webServer']

/**
 * 包根目录。
 *
 * 兼容两种发布布局：
 *   - 根布局（工作区开发版）：index.js 在包根，资源在 ./lib/
 *   - lib 布局（正式发布版）：index.js 在 ./lib/，资源在同级 ./lib/
 *
 * 判据是「上一级是否有 package.json」：有说明 index.js 位于 lib/ 子目录，
 * 包根即上一级；否则 index.js 就在包根。这样两种布局共用同一套路径拼接。
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = fs.existsSync(path.join(MODULE_DIR, '..', 'package.json'))
  ? path.resolve(MODULE_DIR, '..')
  : MODULE_DIR

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-starlight.json')
const LEGACY_CONFIG_FILE = path.join(DSH_HOME, 'dsh-startup.json')

/** 同时保留历史 /dsh-startup 别名，避免旧配置页面或书签失效。 */
const ROUTE_BASES = ['/dsh-starlight', '/dsh-startup']

const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return String(pkg.version || '').trim() || '1.0.0'
  } catch (err) {
    return '1.0.0'
  }
})()

const DEFAULTS = {
  themeEnabled: true,         // 赛博朋克 2077 HUD 终端主题
  spaceEnabled: true,         // 深空全景动态天体背景
  enabled: true,              // 开机冷启动认证序列
  mode: 'always',             // always | session | daily
  theme: 'dark',              // light | dark
  speed: 1,
  requireInteraction: true,
  allowSkip: true,
  sound: true,
  soundVolume: 0.6,
  voice: true,
  voiceLang: 'en',
  voiceName: '',
  voiceRate: 0.88,
  voicePitch: 0.85,
  voiceVolume: 0.9,
  voiceCue: true,
  sfx: 'audio',
  voiceSource: 'asset',
  voiceLead: 240,
  identity: 'Milkly',
  identityId: '0001',
  accessLevel: 'LEVEL 99999',
  brand1: 'DEEPSEEK',
  brand2: 'SYNTHESIZE INTELLIGENCE',
  brand3a: 'HARNESS',
  brand3b: 'OS',
  orgZh: '深度求索',
  orgEn: 'DEEPSEEK',
  orgSub: 'DEEPSEEK HARNESS',
  welcomeBox: 'DEEPSEEK HARNESS',
  footer: 'POWERED BY DEEPSEEK',
  accent: '#FCE300',
  glitchA: '#ff003c',
  glitchB: '#00f0ff',
}

const TEXT_KEYS = [
  'identity', 'identityId', 'accessLevel',
  'brand1', 'brand2', 'brand3a', 'brand3b',
  'orgZh', 'orgEn', 'orgSub', 'welcomeBox', 'footer', 'voiceName',
]
const COLOR_KEYS = ['accent', 'glitchA', 'glitchB']
const ENUMS = {
  mode: ['always', 'session', 'daily'],
  theme: ['light', 'dark'],
  voiceLang: ['en', 'zh', 'both'],
  sfx: ['audio', 'synth'],
  voiceSource: ['asset', 'tts'],
}
const BOOL_KEYS = ['themeEnabled', 'spaceEnabled', 'enabled', 'requireInteraction', 'allowSkip', 'sound', 'voice', 'voiceCue']
const RANGES = {
  speed: [0.35, 3],
  soundVolume: [0, 1],
  voiceRate: [0.5, 2],
  voiceLead: [0, 1200],
  voicePitch: [0, 2],
  voiceVolume: [0, 1],
}

function normalize(input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}

  for (const k of BOOL_KEYS) {
    if (k in src) out[k] = Boolean(src[k])
  }
  for (const k of TEXT_KEYS) {
    if (k in src) out[k] = String(src[k] == null ? '' : src[k]).slice(0, 120)
  }
  for (const k of COLOR_KEYS) {
    if (k in src) {
      const v = String(src[k]).trim()
      if (/^#[0-9a-f]{3,8}$/i.test(v)) out[k] = v
    }
  }
  for (const [k, valid] of Object.entries(ENUMS)) {
    if (k in src && valid.includes(src[k])) out[k] = src[k]
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (k in src) {
      const n = Number(src[k])
      if (Number.isFinite(n)) out[k] = Math.max(lo, Math.min(hi, n))
    }
  }
  return out
}

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
    }
    if (fs.existsSync(LEGACY_CONFIG_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_FILE, 'utf8'))
      const migrated = normalize(legacy)
      writeConfig(migrated)
      return migrated
    }
  } catch (err) {
    // 忽略异常直接退回默认
  }
  return { ...DEFAULTS }
}

function writeConfig(next) {
  const norm = normalize(next)
  try {
    fs.mkdirSync(DSH_HOME, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(norm, null, 2), 'utf8')
    try {
      fs.writeFileSync(LEGACY_CONFIG_FILE, JSON.stringify(norm, null, 2), 'utf8')
    } catch (e2) {}
  } catch (err) {
    console.warn('[sidebar-groups] 写星轨配置文件失败：', err.message)
  }
  return norm
}

function safeJson(val) {
  return JSON.stringify(val).replace(/</g, '\\u003c')
}

function readLibFile(fileName) {
  try {
    return fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', fileName), 'utf8')
  } catch (err) {
    return ''
  }
}

const CRITICAL_CSS = [
  'html.dsu-lock,body.dsu-lock{overflow:hidden!important}',
  '#dsh-startup-root.dsu-boot{position:fixed;inset:0;background:#05070d;z-index:2147483647;display:flex;align-items:center;justify-content:center}',
].join('')

const BOOTSTRAP_JS = `(function(){
  try{
    var c=window.__DSH_STARTUP__||{};
    if(c.enabled===false){
      var r=document.getElementById("dsh-startup-root");
      if(r&&r.parentNode) r.parentNode.removeChild(r);
      return;
    }
    var today=new Date().toISOString().slice(0,10);
    if(c.mode==="session"&&window.sessionStorage.getItem("dsh-startup-screen:shown")==="1") {
      var r=document.getElementById("dsh-startup-root");
      if(r&&r.parentNode) r.parentNode.removeChild(r);
      return;
    }
    if(c.mode==="daily"&&window.localStorage.getItem("dsh-startup-screen:day")===today) {
      var r=document.getElementById("dsh-startup-root");
      if(r&&r.parentNode) r.parentNode.removeChild(r);
      return;
    }
    document.documentElement.classList.add("dsu-lock");
  }catch(e){}
})();`

function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch (err) {}
  return ctx && ctx.webServer
}

function hasRoutes(server) {
  return !!server && typeof server.register === 'function' && typeof server.tapIndex === 'function'
}

/**
 * 插件入口。
 * @param {any} ctx Cordis 上下文。
 * @returns {void}
 */
export function apply(ctx) {
  // 星轨静态资源与配置路由是可选能力：webServer 不存在时安静跳过，
  // 侧栏分组完全不受影响（它只在浏览器端工作）。
  const webServer = resolveWebServer(ctx)
  if (!hasRoutes(webServer)) return

  const disposers = []

  function rejected(req, res) {
    try {
      const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || (ctx && ctx.connection)
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  function registerRoute(route) {
    const inner = route && route.handler
    const wrapped = Object.assign({}, route, {
      handler: async (req, res) => {
        if (rejected(req, res)) return
        return inner(req, res)
      },
    })
    return webServer.register(wrapped)
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    })
    res.end(body)
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  function sendText(res, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    })
    res.end(body)
  }

  try {
    for (const base of ROUTE_BASES) {
      disposers.push(registerRoute({
        kind: 'exact',
        path: base + '/splash.css',
        handler: (req, res) => sendText(res, 'text/css; charset=utf-8', readLibFile('splash.css')),
      }))

      disposers.push(registerRoute({
        kind: 'exact',
        path: base + '/splash.js',
        handler: (req, res) => sendText(res, 'application/javascript; charset=utf-8', readLibFile('splash.js')),
      }))

      disposers.push(registerRoute({
        kind: 'prefix',
        path: base + '/asset',
        handler: (req, res) => {
          const fileName = path.basename(decodeURIComponent((req.url || '').split('?')[0]))
          if (!/^[a-z0-9._-]+\.(mp3|png|jpg)$/i.test(fileName) || fileName.includes('..')) {
            res.writeHead(404)
            res.end()
            return
          }
          const file = path.join(PACKAGE_ROOT, 'lib', 'assets', fileName)
          let bytes
          try {
            bytes = fs.readFileSync(file)
          } catch (err) {
            res.writeHead(404)
            res.end()
            return
          }
          const mime = fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.jpg') ? 'image/jpeg' : 'audio/mpeg'
          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        },
      }))

      disposers.push(registerRoute({
        kind: 'exact',
        path: base + '/config',
        handler: async (req, res) => {
          const method = (req.method || 'GET').toUpperCase()
          if (method === 'GET') {
            sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: readConfig(), defaults: DEFAULTS, file: CONFIG_FILE })
            return
          }
          if (method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          const text = await readBody(req)
          let payload = {}
          try {
            payload = text ? JSON.parse(text) : {}
          } catch (err) {
            sendJson(res, 400, { ok: false, error: 'invalid json' })
            return
          }
          try {
            if (payload && payload.action === 'reset') {
              const cfgNow = writeConfig(DEFAULTS)
              sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: cfgNow, defaults: DEFAULTS })
              return
            }
            const current = readConfig()
            const patch = payload && typeof payload.patch === 'object' && payload.patch ? payload.patch : payload
            const cfgNow = writeConfig({ ...current, ...patch })
            sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: cfgNow, defaults: DEFAULTS })
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
          }
        },
      }))
    }

    // index.html 注入：开机冷启动序列的挂载点与引导脚本
    disposers.push(webServer.tapIndex((html) => {
      if (!html || html.includes('/splash.js')) return html
      const cfg = readConfig()
      if (cfg.enabled === false) return html

      const head =
        '<link rel="stylesheet" href="/dsh-starlight/splash.css">' +
        '<style id="dsh-startup-critical">' + CRITICAL_CSS + '</style>'
      const body =
        '<div id="dsh-startup-root" class="dsu-root dsu-boot"></div>' +
        '<script>window.__DSH_STARTUP_BOOT__="index";window.__DSH_STARTUP_VERSION__=' + safeJson(PLUGIN_VERSION) + ';window.__DSH_STARLIGHT__=' + safeJson(cfg) + ';window.__DSH_STARTUP__=' + safeJson(cfg) + ';' + BOOTSTRAP_JS + '</script>' +
        '<script defer src="/dsh-starlight/splash.js"></script>'

      let out = html
      if (out.includes('</head>')) out = out.replace('</head>', head + '</head>')
      else out = head + out
      if (out.includes('<body>')) out = out.replace('<body>', '<body>' + body)
      else if (out.includes('</body>')) out = out.replace('</body>', body + '</body>')
      else out = out + body
      return out
    }))
  } catch (err) {
    console.warn('[sidebar-groups] 星轨路由注册失败（已降级）：', err && err.message)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (err) {}
    }
  })
}

export { inject, name }
