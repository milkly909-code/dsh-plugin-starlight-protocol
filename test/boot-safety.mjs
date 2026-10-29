/**
 * 启动安全测试
 *
 * 验证 apply() 在任何 ctx 形态下都不会向外抛异常。
 *
 * 为什么这条最重要：DSH 在 boot 期收集所有插件的装载失败，只要有一个
 * 抛错就抛 ClientPackageCompositionError → process.exit(1) → 恢复对话框。
 * 用户看到的就是「DSH 打不开了」。而 apply() 读到的服务（slots / theme /
 * layout）并不保证存在，裸调用就会炸掉整个启动。
 *
 * 运行：node test/boot-safety.mjs
 * 需要：playwright（可选；缺失时跳过）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CLIENT = readFileSync(resolve(ROOT, 'lib', 'client.js'), 'utf8')

const results = []
const ok = (n, p, d) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

async function loadPlaywright() {
  for (const c of ['playwright',
    'file:///F:/05-DeepseekHarness/04-DSH%E6%8F%92%E4%BB%B6/01-%E5%A4%96%E8%A7%82%E6%8F%92%E4%BB%B6/archive/dsh-space-background/node_modules/playwright/index.mjs']) {
    try { return await import(c) } catch (e) {}
  }
  return null
}

const pw = await loadPlaywright()
if (!pw) {
  console.log('SKIP  playwright 不可用，跳过启动安全测试')
  process.exit(0)
}

const browser = await pw.chromium.launch()

async function tryApply(ctxKind) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errs = []
  page.on('pageerror', e => {
    // 过滤测试桩自身的噪声：fetch 返回 HTML 导致的解析错误
    const m = String(e.message || '')
    if (m.indexOf("Unexpected token '<'") !== -1) return
    errs.push(m)
  })

  await page.route('http://local.test/**', r => r.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!DOCTYPE html><html><body style="margin:0"><div id="root"></div></body></html>'
  }))
  await page.goto('http://local.test/')

  await page.addScriptTag({ content: [
    'window.__loaded={};',
    'window.__ModuleLoader__={load({id,factory}){window.__loaded[id]=factory;}};',
    'window.fetch=function(){return Promise.resolve({json:()=>Promise.resolve({ok:true,config:{enabled:true,spaceEnabled:true,themeEnabled:true}})})};',
    'window.matchMedia=function(){return{matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}};'
  ].join('\n') })
  await page.addScriptTag({ content: CLIENT })

  const outcome = await page.evaluate((kind) => {
    const id = Object.keys(window.__loaded).find(k => k.indexOf('starlight') >= 0)
    if (!id) return { loaded: false }
    let mod
    try {
      mod = window.__loaded[id](function req() { return {} })
    } catch (e) {
      return { loaded: true, factoryThrew: e.message }
    }

    const base = {
      theme: { overrideTokens: () => () => {}, setTheme: () => {} },
      layout: null, get: () => null, effect: () => () => {}
    }
    let ctx
    if (kind === 'full') ctx = Object.assign({}, base, { slots: { inject: (k, cb) => cb(), register: () => () => {} } })
    else if (kind === 'no-slots') ctx = Object.assign({}, base)
    else if (kind === 'slots-no-inject') ctx = Object.assign({}, base, { slots: {} })
    else if (kind === 'inject-throws') ctx = Object.assign({}, base, { slots: { inject: () => { throw new Error('slot not declared') }, register: () => () => {} } })
    else if (kind === 'register-throws') ctx = Object.assign({}, base, { slots: { inject: (k, cb) => cb(), register: () => { throw new Error('duplicate') } } })
    else if (kind === 'null-ctx') ctx = null
    else if (kind === 'empty-ctx') ctx = {}

    try {
      mod.apply(ctx)
      return { loaded: true, threw: null }
    } catch (e) {
      return { loaded: true, threw: e.message }
    }
  }, ctxKind)

  await page.waitForTimeout(150)
  const pageErrs = errs.slice()
  await page.close()
  return { ...outcome, pageErrs }
}

const cases = [
  ['full', '正常 ctx'],
  ['no-slots', '缺少 slots 服务'],
  ['slots-no-inject', 'slots 无 inject'],
  ['inject-throws', 'inject 抛异常（槽位未声明）'],
  ['register-throws', 'register 抛异常（重复注册）'],
  ['null-ctx', 'ctx 为 null'],
  ['empty-ctx', '空 ctx']
]

for (const [kind, label] of cases) {
  const r = await tryApply(kind)
  ok(`${label}：apply 不抛异常`, r.threw === null, r.threw || '')
  ok(`${label}：无未捕获页面错误`, r.pageErrs.length === 0, r.pageErrs.join('; ') || '')
}

await browser.close()
const failed = results.filter(x => !x.p)
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`)
process.exit(failed.length === 0 ? 0 : 1)
