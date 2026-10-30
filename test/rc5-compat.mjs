/**
 * rc.5 兼容性验证：用真实的 DSH 0.2.1-rc.5 内核结构驱动插件。
 *
 * 重点验证 rc.5 引入的变化：
 *   - theme.register() 在 id 已注册时抛错 → 插件必须能容忍
 *   - toggleSidebar() 仍是公开无参接口
 *   - settings.section / shell.overlay 槽位仍在
 */
import { chromium } from 'file:///F:/05-DeepseekHarness/04-DSH%E6%8F%92%E4%BB%B6/01-%E5%A4%96%E8%A7%82%E6%8F%92%E4%BB%B6/archive/dsh-space-background/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = resolve(HERE, '..', '..') + '\\'
const SL = readFileSync(BASE + 'dsh-plugin-starlight-protocol\\lib\\client.js', 'utf8')
let HZ = null
try { HZ = readFileSync(BASE + 'dsh-plugin-thought-horizon\\lib\\client.js', 'utf8') } catch (e) { /* 可选依赖 */ }

const results = []
const ok = (n, p, d) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch()

async function makePage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errs = []
  page.on('pageerror', e => { const m = String(e.message||''); if (m.indexOf("Unexpected token '<'") === -1) errs.push(m) })
  await page.route('http://local.test/**', r => r.fulfill({ status: 200, contentType: 'text/html',
    body: '<!DOCTYPE html><html data-ds-dark-theme><body style="margin:0"><div id="root"></div></body></html>' }))
  await page.goto('http://local.test/')
  await page.addScriptTag({ content: [
    'window.__loaded={};',
    'window.__ModuleLoader__={load({id,factory}){window.__loaded[id]=factory;}};',
    'window.fetch=function(){return Promise.resolve({json:()=>Promise.resolve({ok:true,config:{enabled:true,spaceEnabled:true,themeEnabled:true}})})};',
    'window.matchMedia=function(){return{matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}};'
  ].join('\n') })
  return { page, errs }
}

// ── 场景 1：theme.register 重复注册抛错（rc.5 的真实行为）─────────────
{
  const { page, errs } = await makePage()
  await page.addScriptTag({ content: SL })
  const r = await page.evaluate(async () => {
    const id = Object.keys(window.__loaded).find(k => k.indexOf('starlight') >= 0)
    const mod = window.__loaded[id](function () { return {} })

    // 模拟 rc.5：第一次 register 成功，第二次抛 "already registered"
    let registered = 0, setThemeCalls = 0, logged = []
    const theme = {
      register(def) {
        if (registered > 0) throw new Error(`theme "${def.id}" is already registered`)
        registered++
        return () => {}
      },
      setTheme(t) { setThemeCalls++; return t }
    }
    const origErr = console.error
    console.error = (...a) => { logged.push(a.join(' ')) }

    const ctx = { theme, layout: null, get: () => null, slots: { inject: (k,cb)=>cb(), register: ()=>()=>{} } }
    // 连跑两次 apply（模拟热重载）
    mod.apply(ctx)
    mod.apply(ctx)
    // 配置是异步 fetch 的，等它 resolve 后 CyberThemeManager.start 才会跑
    await new Promise(r => setTimeout(r, 300))
    console.error = origErr

    return { registered, setThemeCalls, logged }
  })
  ok('theme.register 重复注册时不崩', r.registered === 1, `register 成功 ${r.registered} 次`)
  ok('重复注册后仍调用 setTheme', r.setThemeCalls > 0, `setTheme ${r.setThemeCalls} 次`)
  ok('未把 already registered 当成错误打印',
     !r.logged.some(x => x.indexOf('already registered') !== -1), r.logged.join('; ').slice(0, 120))
  ok('无未捕获页面错误', errs.length === 0, errs.join('; '))
  await page.close()
}

// ── 场景 2：layout.toggleSidebar 公开无参接口 ─────────────────────────
{
  const { page, errs } = await makePage()
  await page.addScriptTag({ content: SL })
  const r = await page.evaluate(() => {
    const id = Object.keys(window.__loaded).find(k => k.indexOf('starlight') >= 0)
    const mod = window.__loaded[id](function () { return {} })
    let toggled = 0
    const layout = { toggleSidebar() { toggled++; } }
    mod.apply({ theme: { register: () => () => {}, setTheme: () => {} }, layout,
                get: (n) => (n === 'layout' ? layout : null),
                slots: { inject: (k,cb)=>cb(), register: ()=>()=>{} } })
    // 找到侧栏按钮并点击
    const btn = document.getElementById('starlight-sidebar-toggle')
    if (btn) btn.click()
    return { toggled, hasBtn: !!btn }
  })
  ok('侧栏按钮已挂载', r.hasBtn)
  ok('toggleSidebar 被调用（无参接口可用）', r.toggled > 0, `调用 ${r.toggled} 次`)
  ok('无未捕获页面错误', errs.length === 0, errs.join('; '))
  await page.close()
}

// ── 场景 3：thought-horizon 在 rc.5 的 slots/settings 下可用 ──────────
{
  const { page, errs } = await makePage()
  await page.addScriptTag({ content: HZ })
  const r = await page.evaluate(() => {
    const id = Object.keys(window.__loaded).find(k => k.indexOf('thought-horizon') >= 0)
    if (!id) return { ok: false }
    const mod = window.__loaded[id](function (n) {
      if (n === 'react') return { createElement: () => ({}), useState: v => [v, () => {}], useEffect: fn => { (window.__fx = window.__fx || []).push(fn) } }
      return {}
    })
    const regs = []
    mod.apply({ slots: { inject: (k, cb) => cb(), register: (d, c) => { regs.push(d.name); return () => {} } }, effect: () => {} })
    return { ok: true, regs }
  })
  ok('thought-horizon 可加载', r.ok, JSON.stringify(r.regs))
  ok('注册了 shell.overlay', (r.regs || []).includes('shell.overlay'))
  ok('注册了 settings.section', (r.regs || []).includes('settings.section'))
  ok('无未捕获页面错误', errs.length === 0, errs.join('; '))
  await page.close()
}

await browser.close()
const failed = results.filter(x => !x.p)
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`)
process.exit(failed.length === 0 ? 0 : 1)
