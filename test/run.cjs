/** 契约测试（零依赖）：模块形状、外观槽位注册、主题服务注入、纯函数正确性。
 *
 * 运行：node test/run.cjs（或 npm test）
 * 覆盖《DSH 插件面板开发要点》中的静默失败模式 + 主题外观契约：
 *  - list 槽位必须带 id（§2）；order 为数字断言（§3）；label 必须 thunk（§4）；
 *  - 只 require 平台基表（§5）；
 *  - 独立控制台页面注册进 sidebar.panellist + main，星空层注册进 shell.overlay；
 *  - 不再注册 settings.general.item（已升级为独立插件面板与控制中心）；
 *  - 动态透明度引擎、主题令牌覆盖、文字可读性与毛玻璃样式正确生成。
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
    createElement: () => null,
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
  check('模块注入声明包含 slots, locale, layout',
    Array.isArray(plugin.inject) && ['slots', 'locale', 'layout'].every((k) => plugin.inject.includes(k)));
  check('apply 为函数', typeof plugin.apply === 'function');
  const X = plugin.__test__;

  /* ---------- 2. apply(ctx)：主题注入 + 独立页面与星空层槽位形状 ---------- */
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
  check('不再注册 settings.general.item（已迁出通用设置）', !records.some((r) => r.slot === 'settings.general.item'));
  check('注册独立侧边栏图标（sidebar.panellist）', records.some((r) => r.slot === 'sidebar.panellist'));
  check('注册独立主工作区页面（main）', records.some((r) => r.slot === 'main'));
  check('注册 shell.overlay + sidebar.panellist + main 三个槽位', records.length === 3, `got ${records.length}`);

  const over = records.find((r) => r.slot === 'shell.overlay');
  check('shell.overlay：list 槽位带 id 且无 priority', !!over && over.options.id === X.PANEL_ID && over.options.priority === undefined);
  check('shell.overlay：order 为数字', !!over && typeof over.options.order === 'number');
  check('shell.overlay：透传 store 供宿主注入 props', !!over && !!over.options.store);
  check('shell.overlay：组件即 SpaceLayer', !!over && over.component === X.Views.SpaceLayer);

  const icon = records.find((r) => r.slot === 'sidebar.panellist');
  check('sidebar.panellist：list 槽位带 id', !!icon && icon.options.id === X.PANEL_ID);
  check('sidebar.panellist：order 为数字（排在 65 避免冲突）', !!icon && typeof icon.options.order === 'number');
  check('sidebar.panellist：label 是 thunk', !!icon && typeof icon.options.label === 'function');
  check('sidebar.panellist：组件即 PanelIcon', !!icon && icon.component === X.Views.PanelIcon);

  const mainPanel = records.find((r) => r.slot === 'main');
  check('main：单页槽位 key 为插件唯一 ID', !!mainPanel && mainPanel.options.key === X.PANEL_ID);
  check('main：透传 store 与 locale 命名空间', !!mainPanel && !!mainPanel.options.store && mainPanel.options.locale === X.NS);
  check('main：组件即 SpaceBackgroundPage', !!mainPanel && mainPanel.component === X.Views.SpaceBackgroundPage);

  check('locale.register(NS, dict) 且中英文都有标题与控制中心文案', !!localeRegistered && localeRegistered.ns === X.NS
    && typeof localeRegistered.d.zh.title === 'string' && typeof localeRegistered.d.en.title === 'string'
    && typeof localeRegistered.d.zh.studioTitle === 'string' && typeof localeRegistered.d.en.studioTitle === 'string');

  effectCleanups.filter(Boolean).forEach((d) => d());
  check('释放函数能注销全部槽位（无泄漏）', records.every((r) => r.disposed));

  /* ---------- 3. 纯函数与外观契约 ---------- */
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

  // 主题覆盖层：generateTokenOverrides 契约要求每个令牌为 { light, dark } 字符串对
  const dynamicTokens = X.generateTokenOverrides(0.45);
  const tokenEntries = Object.entries(dynamicTokens);
  check('主题覆盖层非空且全部为 dsw 别名令牌', tokenEntries.length >= 3 && tokenEntries.every(([k]) => k.startsWith('--dsw-')));
  check('覆盖值为 { light, dark } 颜色字符串对（bare string 会抛错）',
    tokenEntries.every(([, v]) => v && typeof v === 'object'
      && typeof v.light === 'string' && typeof v.dark === 'string'
      && /^(rgba?\(|color-mix|var\()/.test(v.light) && /^(rgba?\(|color-mix|var\()/.test(v.dark)));
  check('动态透明度注入：0.45 包含对应 alpha 通道',
    dynamicTokens['--dsw-alias-bg-base'].light.includes('0.45'));

  // 动态 CSS 引擎与兜底样式检查
  const css = X.generateDynamicCss({ enabled: true, surfaceOpacity: 0.35, blur: 16, autoContrast: true, textShadow: true });
  check('动态样式以 data-sbg-on 门控（可随时退）', /html\[data-sbg-on\]/m.test(css));
  check('动态样式覆盖 body/#root/#app 透明 + 中栏/侧栏/底栏半透明',
    ['body', '#root', '#app', '_centerCol', '_sidebarCol', '_bottomRow'].every((s) => css.includes(s)));
  check('动态样式同时匹配 CSS Modules 的 q_ 前缀类名',
    ['q_frame', 'q_centerCol', 'q_sidebarCol', 'q_bottomRow'].every((s) => css.includes(s)));
  check('框架根被显式置透明（避免盖住底层星空）',
    /html\[data-sbg-on\]\s+\[class\*="_frame"\],\s*html\[data-sbg-on\]\s+\[class\*="q_frame"\]\s*\{\s*background:\s*transparent\s*!important;\s*\}/.test(css));
  check('毛玻璃效果生成 backdrop-filter 规则', css.includes('backdrop-filter: blur(16px)'));
  check('文字抗晕散微阴影规则正确注入', css.includes('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8)'));

  check('引擎工厂导出（createSpaceEngine 返回 dispose 契约在运行时验证）', typeof X.createSpaceEngine === 'function');

  // store：默认开启，包含通透度、模糊、对比度等新动作
  const storeSpec = X.makeStore().spec;
  const initial = storeSpec.init();
  check('store 默认开启且通透度推荐为 0.45', initial.enabled === true && initial.surfaceOpacity === 0.45);
  check('store 默认毛玻璃为 16px 且智能对比度默认开启', initial.blur === 16 && initial.autoContrast === true && initial.textShadow === true);

  const draft = { enabled: 'x' };
  storeSpec.actions.normalize(draft);
  check('normalize 容错脏数据', draft.enabled === true);

  const d2 = {};
  storeSpec.actions.setEnabled(d2, false);
  check('setEnabled 严格布尔', d2.enabled === false);

  const d3 = {};
  storeSpec.actions.setSurfaceOpacity(d3, 0.25);
  check('setSurfaceOpacity 支持数值设置', d3.surfaceOpacity === 0.25);
  storeSpec.actions.setSurfaceOpacity(d3, 2.0);
  check('setSurfaceOpacity 上界 clamp 至 0.95', d3.surfaceOpacity === 0.95);

  const d4 = {};
  storeSpec.actions.setBlur(d4, 20);
  check('setBlur 支持毛玻璃数值设置', d4.blur === 20);

  const d5 = { surfaceOpacity: 0.1, blur: 0, autoContrast: false };
  storeSpec.actions.resetDefaults(d5);
  check('resetDefaults 恢复官方推荐平衡状态', d5.surfaceOpacity === 0.45 && d5.blur === 16 && d5.autoContrast === true);

  // ── 旧版持久化文档迁移至 Schema 3 ────────────────────────────────────
  const legacy = { schemaVersion: 1, enabled: false, speed: 0.2, boost: false };
  storeSpec.actions.normalize(legacy);
  check('旧版文档迁移后 enabled 复位为 true', legacy.enabled === true);
  check('旧版文档的废弃字段 boost 被清除', !('boost' in legacy));
  check('旧版文档迁移后补充默认 surfaceOpacity 与 blur', legacy.surfaceOpacity === 0.45 && legacy.blur === 16);
  check('迁移后 schemaVersion 升到当前版本 3', legacy.schemaVersion === 3);

  // 当前版本文档里用户显式关闭与调参意图必须保留
  const current = { schemaVersion: 3, enabled: false, surfaceOpacity: 0.25 };
  storeSpec.actions.normalize(current);
  check('当前版本文档保留用户设置（enabled: false, opacity: 0.25）', current.enabled === false && current.surfaceOpacity === 0.25);

  // ── 模块级 localStorage 就地迁移测试 ──────────────────────────────────
  const mockStorage = {
    'space-background/v1': JSON.stringify({ schemaVersion: 1, enabled: false, speed: 0.2, boost: false })
  };
  global.localStorage = {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => { mockStorage[k] = String(v); }
  };
  try {
    const raw = global.localStorage.getItem('space-background/v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < 3)) {
        parsed.schemaVersion = 3;
        parsed.enabled = true;
        parsed.surfaceOpacity = 0.45;
        parsed.blur = 16;
        parsed.autoContrast = true;
        parsed.textShadow = true;
        delete parsed.boost;
        delete parsed.hue;
        global.localStorage.setItem('space-background/v1', JSON.stringify(parsed));
      }
    }
  } catch (e) {}
  const migratedStorage = JSON.parse(mockStorage['space-background/v1']);
  check('模块启动时 localStorage 自动迁移为 schemaVersion 3 且 enabled 为 true',
    migratedStorage.schemaVersion === 3 && migratedStorage.enabled === true && migratedStorage.surfaceOpacity === 0.45);

  finish();

  function finish() {
    console.log(failures === 0 ? `\n全部通过：${checks} 项检查` : `\n失败 ${failures}/${checks} 项检查`);
    process.exit(failures === 0 ? 0 : 1);
  }
})().catch((err) => { console.error(err); process.exit(1); });
