/**
 * 星轨协议融合专项测试。
 *
 * 验证 dsh-plugin-starlight-protocol 并入 dsh-plugin-sidebar-groups 后：
 *   1) 两套子系统共用同一个 client bundle，且互不污染
 *   2) starlight.apply(ctx) 被调用，__DSH_STARLIGHT_API__ 正确暴露
 *   3) starlight 任何异常都被兜住，不影响侧栏分组
 *   4) Host 端 index.js 正确导出 apply/inject/name，且缺 webServer 时安静跳过
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const clientSource = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const hostSource = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log('  ok  ' + name)
}
function eq(actual, expected, message) {
  assert.equal(actual, expected, message)
}

console.log('\n[1] 融合结构完整性')
check('client bundle 中同时包含两套子系统的入口标记', () => {
  eq(clientSource.includes("id: 'dsh-plugin-starlight-protocol'"), true, 'client bundle id 与包名一致')
  eq(clientSource.includes('var starlight = (function (react, h) {'), true, '星轨子系统包裹在独立 IIFE 中')
  eq(clientSource.includes('return { apply: apply };'), true, '星轨子系统仅导出 apply')
})

check('星轨子系统被侧栏分组的 apply() 调用，且外层再兜一层', () => {
  eq(clientSource.includes('starlight.apply(ctx);'), true, 'apply() 中调用星轨子系统')
  const idx = clientSource.indexOf('starlight.apply(ctx);')
  const before = clientSource.slice(Math.max(0, idx - 400), idx)
  eq(before.includes('try {'), true, '调用前有 try 兜底')
  const after = clientSource.slice(idx, idx + 400)
  eq(after.includes('catch (error)'), true, '调用后有 catch 降级')
})

check('星轨子系统的 166 个顶层标识符不外泄（IIFE 隔离）', () => {
  // 抽查同名冲突标识符：外层不应重复声明
  const outer = clientSource.slice(0, clientSource.indexOf('var starlight = (function'))
  for (const name of ['SpaceManager', 'CyberThemeManager', 'SidebarToggleManager', 'StarlightPanel', 'THEME_ID', 'TOKENS']) {
    const re = new RegExp('^\\s{0,6}(?:var|const|let|function)\\s+' + name + '\\b', 'm')
    eq(re.test(outer), false, '外层不应声明 ' + name)
  }
})

console.log('\n[2] 星轨运行时接口契约')
check('保留 __DSH_STARLIGHT_API__ 全局接口（透明思维屏插件依赖）', () => {
  eq(clientSource.includes('window.__DSH_STARLIGHT_API__'), true, '暴露星轨 API')
  for (const fn of ['setThinking', 'getBoost', 'isRunning']) {
    eq(clientSource.includes(fn + ':'), true, 'API 提供 ' + fn)
  }
})

check('配置端点与路由常量保留', () => {
  eq(clientSource.includes("var API = '/dsh-starlight/config';"), true, '主配置端点')
  eq(clientSource.includes("var LEGACY_API = '/dsh-startup/config';"), true, '兼容旧端点')
  eq(clientSource.includes("var BOOT_ROUTE = '/dsh-starlight';"), true, '开机资源根路径')
})

check('设置面板注册使用独立 slot id，不与侧栏分组冲突', () => {
  eq(clientSource.includes("id: 'starlight-protocol'"), true, '设置分区 id 唯一')
  eq(clientSource.includes('slots.inject(\'settings.section\''), true, '注册到 settings.section')
})

console.log('\n[3] Host 端融合')
check('index.js 导出 apply / inject / name', () => {
  eq(/export function apply\s*\(/.test(hostSource), true, '导出 apply')
  eq(/const inject = \[/.test(hostSource), true, '声明 inject')
  eq(/const name = 'dsh-plugin-sidebar-groups'/.test(hostSource), true, '声明 name')
  eq(/export \{ inject, name \}/.test(hostSource), true, '统一导出')
})

check('Host 端承载星轨的路由与注入能力', () => {
  for (const route of ['/splash.css', '/splash.js', '/asset', '/config']) {
    eq(hostSource.includes(route), true, '提供 ' + route + ' 路由')
  }
  eq(hostSource.includes('webServer.tapIndex'), true, '注入 index.html')
  eq(hostSource.includes('dsh-starlight.json'), true, '配置落盘路径')
})

check('webServer 缺失时安静跳过（不注册路由、不抛异常）', () => {
  eq(hostSource.includes('if (!hasRoutes(webServer)) return'), true, '缺服务直接返回')
  eq(hostSource.includes('function hasRoutes(server)'), true, '能力探测函数存在')
})

check('路由注册包裹在 try/catch 中，失败只降级', () => {
  eq(hostSource.includes("console.warn('[sidebar-groups] 星轨路由注册失败（已降级）：'"), true, '降级日志')
})

console.log('\n[4] 侧边栏折叠可用性（回归防护）')
check('不注入与宿主重叠的战术悬浮按钮', () => {
  // 曾因同时启用战术按钮（z-index 10050）并隐藏原生按钮，
  // 导致 layout 服务缺失时完全没有折叠入口
  const activeCall = clientSource
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .some((line) => /safe\('侧边栏总控',\s*function\s*\(\)\s*\{\s*SidebarToggleManager\.init/.test(line))
  eq(activeCall, false, '不得启用 SidebarToggleManager.init（与原生按钮位置重叠）')
})

check('宿主原生折叠按钮不被 CSS 隐藏', () => {
  const hideNative = /\.wtg9ga_toggle[^{]*\{[^}]*display\s*:\s*none/.test(clientSource)
  eq(hideNative, false, '不得用 CSS 隐藏宿主原生折叠按钮')
  eq(
    clientSource.includes('宿主原生折叠按钮始终保留'),
    true,
    '保留说明性注释，防止后续改动再次引入该回归',
  )
})

check('SidebarToggleManager 定义保留，便于内核回归时重新启用', () => {
  eq(clientSource.includes('var SidebarToggleManager = (function ()'), true, '定义仍在')
  eq(clientSource.includes('function playChime()'), true, '音效逻辑仍在')
  const hasRestoreHint = clientSource
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith('//') && line.includes('SidebarToggleManager.init(ctx)'))
  eq(hasRestoreHint, true, '保留可一键恢复的注释行')
})

check('不把 layout 列为必需依赖（缺失时不应拖垮整个插件）', () => {
  const m = clientSource.match(/exports\.inject\s*=\s*\[([^\]]*)\]/)
  eq(m !== null, true, '存在 exports.inject 声明')
  const deps = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  eq(deps.includes('locale'), true, 'locale 为必需依赖')
  eq(deps.includes('layout'), false, 'layout 不是必需依赖（避免缺服务时插件整体不激活）')
})

console.log('\n[5] 运行时资源齐备')
check('splash 资源与音频素材随包发布', () => {
  const libDir = path.join(root, 'lib')
  eq(fs.existsSync(path.join(libDir, 'splash.css')), true, 'splash.css 存在')
  eq(fs.existsSync(path.join(libDir, 'splash.js')), true, 'splash.js 存在')
  for (const n of ['line-1', 'line-2', 'line-3', 'line-4', 'line-5', 'line-6', 'sfx-tick', 'sfx-ticks-run']) {
    eq(fs.existsSync(path.join(libDir, 'assets', n + '.mp3')), true, n + '.mp3 存在')
  }
})

check('package.json 声明了合并后的入口、资源与 client 注入', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  eq(pkg.name, 'dsh-plugin-starlight-protocol', '包名与仓库一致')
  eq(pkg.main, 'lib/index.js', 'Host 入口')
  eq(pkg.exports['./client'], './lib/client.js', 'Client 入口')
  eq(pkg.files.includes('lib'), true, 'files 包含 lib 目录')
  eq(pkg.files.includes('NOTICE'), true, 'files 包含 NOTICE')
  eq(pkg.cordis.bundles.includes('lib/client.js'), true, 'cordis 声明 client bundle')
  const injects = pkg.dsh.client.inject
  for (const need of ['@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-workspace', '@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-settings']) {
    eq(injects.includes(need), true, 'inject 声明 ' + need)
  }
})

console.log('\n通过 ' + passed + ' 项断言。\n')
