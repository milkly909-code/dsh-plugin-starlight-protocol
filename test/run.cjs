/** 契约测试（零依赖）：模块形状、外观槽位注册、主题服务注入、纯函数正确性。
 *
 * 运行：node test/run.cjs（或 npm test）
 * 覆盖契约：
 *  - 严格移除侧边栏按钮：不向 sidebar.panellist / main 注册任何槽位（保持侧栏干净）；
 *  - 纯粹嵌入插件管理页：注册 plugins.detail.section，进入插件详情页即展现项目全景与调控面板；
 *  - 星空层注册进 shell.overlay；
 *  - 全域穿透：各级容器、设置与详情页彻底全透（0% 不透明度），底层星空无遮挡展现；
 *  - 太空 HUD 全息文字防晕散与双层阴影保护。
 */
'use strict';

const { pathToFileURL } = require('url');
const path = require('path');

let checks = 0;
let failures = 0;
function check(name, cond, why) {
  checks++;
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${why ? ` — ${why}` : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);

(async function main() {
  /* ---------- 1. 桩加载器捕获模块 ---------- */
  let captured = null;
  global.window = { __ModuleLoader__: { load(mod) { captured = mod; } } };

  const requires = [];
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: () => [null, () => {}],
  };
  const storeStub = { defineStore: (spec) => ({ spec }) };
  const PLATFORM = new Set(['react', '@deepseek-ai/dsh-client-store']);
  function platformRequire(name) {
    requires.push(name);
    if (name === 'react') return reactStub;
    if (name === '@deepseek-ai/dsh-client-store') return storeStub;
    throw new Error(`non-platform require: ${name}`);
  }

  await import(pathToFileURL(path.join(__dirname, '..', 'client.js')).href);
  check('client.js 注册到 window.__ModuleLoader__', captured && typeof captured.factory === 'function');
  if (!captured) return finish();

  const plugin = captured.factory(platformRequire);
  check('仅 require 平台基表（react / dsh-client-store）', requires.every((r) => PLATFORM.has(r)), requires.join(','));
  check('模块注入声明包含 slots, locale',
    Array.isArray(plugin.inject) && ['slots', 'locale'].every((k) => plugin.inject.includes(k)));
  check('apply 为函数', typeof plugin.apply === 'function');
  const X = plugin.__test__;

  /* ---------- 2. apply(ctx)：槽位注册契约 ---------- */
  const records = [];
  const effectCleanups = [];
  let currentSlot = null;
  let localeRegistered = null;
  const serviceInjections = [];
  const overrideCalls = [];
  const fakeTheme = {
    overrideTokens(source, tokens) {
      overrideCalls.push({ source, tokens });
      return () => { overrideCalls.push({ disposed: source }); };
    },
  };
  const ctx = {
    effect(fn) { const d = fn(); effectCleanups.push(typeof d === 'function' ? d : null); return d; },
    inject(names, cb) { serviceInjections.push(names); cb({ theme: fakeTheme, effect: (fn) => { const d = fn(); effectCleanups.push(typeof d === 'function' ? d : null); return d; } }); },
    locale: {
      register(ns, d) { localeRegistered = { ns, d }; },
      bind() { return (k) => k; },
    },
    slots: {
      inject(name, cb) {
        currentSlot = name;
        const dispose = cb();
        return () => { if (typeof dispose === 'function') dispose(); };
      },
      register(options, component) {
        const slot = currentSlot;
        records.push({ slot, options, component });
        return () => { const r = records.find((x) => x.slot === slot && x.options === options); if (r) r.disposed = true; };
      },
    },
  };
  plugin.apply(ctx);

  check('经 ctx.inject 等待官方主题服务（theme）', serviceInjections.some((n) => Array.isArray(n) && n.includes('theme')));
  check('严格移除侧边栏按钮：不注册 sidebar.panellist', !records.some((r) => r.slot === 'sidebar.panellist'));
  check('严格移除独立主工作区页面：不注册 main 槽位', !records.some((r) => r.slot === 'main'));
  check('不注册 settings.general.item（通用设置保持纯净）', !records.some((r) => r.slot === 'settings.general.item'));
  check('仅注册 shell.overlay 与 plugins.detail.section 两个槽位', records.length === 2, `got ${records.length}`);

  const over = records.find((r) => r.slot === 'shell.overlay');
  check('shell.overlay：list 槽位带 id', !!over && over.options.id === X.PANEL_ID);
  check('shell.overlay：order 为数字', !!over && typeof over.options.order === 'number');
  check('shell.overlay：透传 store 供宿主注入 props', !!over && !!over.options.store);
  check('shell.overlay：组件即 SpaceLayer', !!over && over.component === X.Views.SpaceLayer);

  const detailSec = records.find((r) => r.slot === 'plugins.detail.section');
  check('plugins.detail.section：注册在插件详情页专属槽位', !!detailSec);
  check('plugins.detail.section：带 id 与 order', !!detailSec && detailSec.options.id === X.PANEL_ID && typeof detailSec.options.order === 'number');
  check('plugins.detail.section：透传 store 与 locale', !!detailSec && !!detailSec.options.store && detailSec.options.locale === X.NS);
  check('plugins.detail.section：组件即 PluginDetailSection', !!detailSec && detailSec.component === X.Views.PluginDetailSection);

  // 验证 PluginDetailSection 仅对本插件生效
  const otherResult = X.Views.PluginDetailSection({ subject: { kind: 'bundle', pkg: { name: 'other-pkg' } } });
  check('PluginDetailSection：非本插件详情页静默返回 null', otherResult === null);
  const matchedResult = X.Views.PluginDetailSection({ subject: { kind: 'bundle', pkg: { name: '@local/space-background' } } });
  check('PluginDetailSection：本插件详情页正确渲染 SpaceBackgroundPage', !!matchedResult && matchedResult.type === X.Views.SpaceBackgroundPage);

  check('locale.register(NS, dict) 且中英文都有项目全景说明文案', !!localeRegistered && localeRegistered.ns === X.NS
    && typeof localeRegistered.d.zh.projectOverviewTitle === 'string' && typeof localeRegistered.d.en.projectOverviewTitle === 'string'
    && typeof localeRegistered.d.zh.cardPhilosophyTitle === 'string' && typeof localeRegistered.d.zh.cardEngineTitle === 'string');

  effectCleanups.filter(Boolean).forEach((d) => d());
  check('释放函数能注销全部槽位（无泄漏）', records.every((r) => r.disposed));

  /* ---------- 3. 纯函数与全透外观契约 ---------- */
  check('clamp 边界', X.clamp(5, 0, 3) === 3 && X.clamp(-1, 0, 3) === 0 && X.clamp(1.5, 0, 3) === 1.5);

  const amp = 137.2, phase = 2.31, w = 1870;
  check('bandYFor 周期性（x=0 与 x=w 对齐 → 环绕无缝）', near(X.bandYFor(amp, phase, w, 0), X.bandYFor(amp, phase, w, w), 1e-6));
  check('bandYFor 值域 |y| ≤ amp', Math.abs(X.bandYFor(amp, phase, w, w * 0.37)) <= amp + 1e-9);

  let basisOk = true;
  for (let i = 0; i < 8; i++) {
    const yaw = i * 0.9 - 2.8, pitch = (i % 3) * 0.6 - 0.6;
    const { f, r, u } = X.buildBasis(yaw, pitch);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (!near(dot(f, r), 0, 1e-12) || !near(dot(f, u), 0, 1e-12) || !near(dot(r, u), 0, 1e-12) || !near(dot(f, f), 1, 1e-12)) basisOk = false;
  }
  check('buildBasis 正交单位（8 组 yaw/pitch）', basisOk);

  const cons = X.makeConstellations();
  check('星座数量 5–7', cons.length >= 5 && cons.length <= 7, String(cons.length));
  check('星座点与连线索引合法、亮度/色温对齐',
    cons.every((k) => k.pts.length >= 4
      && k.edges.every((e) => e[0] >= 0 && e[1] >= 0 && e[0] < k.pts.length && e[1] < k.pts.length)
      && k.br.length === k.pts.length && k.ti.length === k.pts.length));

  check('DOT_STYLES 共 28 档（4 带 + 6 色 × 4 等）', X.DOT_STYLES.length === 28);
  check('色温表 6 档均为 rgb 串', X.TINTS.length === 6 && X.TINTS.every((s) => /^\d+,\d+,\d+$/.test(s)));

  // 主题覆盖层：全透 (0%) 下令牌全部为纯透明 rgba(0, 0, 0, 0)
  const zeroTokens = X.generateTokenOverrides({ enabled: true });
  const tokenEntries = Object.entries(zeroTokens);
  check('全透模式主题覆盖层非空且全部为 dsw 别名令牌', tokenEntries.length >= 5 && tokenEntries.every(([k]) => k.startsWith('--dsw-')));
  check('全透模式背景令牌被清空为透明 (0, 0, 0, 0)', zeroTokens['--dsw-alias-bg-base'].light === 'rgba(0, 0, 0, 0)' && zeroTokens['--dsw-alias-bg-base'].dark === 'rgba(0, 0, 0, 0)');
  check('输入框 major 背景令牌被清空为透明', zeroTokens['--dsw-specific-input-major'].light === 'rgba(0, 0, 0, 0)');

  // 动态 CSS 引擎全域穿透检查（无模糊 + 聊天框全透一致性）
  const fullCss = X.generateDynamicCss({ enabled: true });
  check('无模糊纯净视界：彻底禁用全局 backdrop-filter 模糊', fullCss.includes('html[data-sbg-on] * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'));
  check('全域穿透：html/body/#root/#app 彻底全透明', fullCss.includes('html[data-sbg-on], html[data-sbg-on] body, html[data-sbg-on] #root, html[data-sbg-on] #app { background: transparent !important;'));
  check('全域穿透：frame/panel/page/settings/detail 全透明',
    ['_frame', 'q_frame', '_content', '_panel', '_page', '_settings', 'detail'].every((s) => fullCss.includes(s)));
  check('聊天框与底栏全透：与其它页面保持一致的全透无模糊',
    ['_bottomRow', 'q_bottomRow', '_dock', 'q_dock', 'composer', 'Composer'].every((s) => fullCss.includes(s)));
  check('聊天框卡片线框：无模糊轻量深色透明底 + 细微边框', fullCss.includes('rgba(10, 15, 26, 0.45)'));
  check('文字 HUD 保护：标题白色且注入抗晕散立体阴影', fullCss.includes('text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95)'));
  check('文字 HUD 保护：代码路径标签样式优化', fullCss.includes('background: rgba(0, 0, 0, 0.4)'));

  check('引擎工厂导出（createSpaceEngine 返回 dispose 契约在运行时验证）', typeof X.createSpaceEngine === 'function');

  // store：默认开启，纯净无模糊全透（surfaceOpacity: 0.0, blur: 0）
  const storeSpec = X.makeStore().spec;
  const initial = storeSpec.init();
  check('store 默认开启且通透度推荐为 0.0（纯粹全景）', initial.enabled === true && initial.surfaceOpacity === 0.0);
  check('store 默认无模糊（blur: 0）且智能对比度默认开启', initial.blur === 0 && initial.autoContrast === true && initial.textShadow === true);

  const draft = { enabled: 'x' };
  storeSpec.actions.normalize(draft);
  check('normalize 容错脏数据', draft.enabled === true);

  const d2 = {};
  storeSpec.actions.setEnabled(d2, false);
  check('setEnabled 严格布尔', d2.enabled === false);

  const d3 = {};
  storeSpec.actions.setSurfaceOpacity(d3, 0.0);
  check('setSurfaceOpacity 支持 0.0 纯粹全透', d3.surfaceOpacity === 0.0);

  const d4 = {};
  storeSpec.actions.setBlur(d4, 0);
  check('setBlur 设置无模糊 (0)', d4.blur === 0);

  const d5 = { surfaceOpacity: 0.8, blur: 16, autoContrast: false };
  storeSpec.actions.resetDefaults(d5);
  check('resetDefaults 恢复官方推荐无模糊全透状态 (0.0, blur: 0)', d5.surfaceOpacity === 0.0 && d5.blur === 0 && d5.autoContrast === true);

  // ── 旧版持久化文档迁移至 Schema 3 ────────────────────────────────────
  const legacy = { schemaVersion: 1, enabled: false, speed: 0.2, boost: false };
  storeSpec.actions.normalize(legacy);
  check('旧版文档迁移后 enabled 复位为 true', legacy.enabled === true);
  check('旧版文档的废弃字段 boost 被清除', !('boost' in legacy));
  check('旧版文档迁移后默认 surfaceOpacity 为 0.0 且 blur 为 0', legacy.surfaceOpacity === 0.0 && legacy.blur === 0);
  check('迁移后 schemaVersion 升到当前版本 3', legacy.schemaVersion === 3);

  // 当前版本文档保留用户个性化设置
  const current = { schemaVersion: 3, enabled: false };
  storeSpec.actions.normalize(current);
  check('当前版本文档保留用户显式开关设置（enabled: false）', current.enabled === false);

  finish();

  function finish() {
    console.log(failures === 0 ? `\n全部通过：${checks} 项检查` : `\n失败 ${failures}/${checks} 项检查`);
    process.exit(failures === 0 ? 0 : 1);
  }
})().catch((err) => { console.error(err); process.exit(1); });
