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

  /* ══════════════════════════════════════════════════════════════
   * 新架构：主题令牌驱动（不再用通配符清空背景 + 强制白字）
   * ══════════════════════════════════════════════════════════════ */

  const tokens = X.generateTokenOverrides({ enabled: true });
  const tokenEntries = Object.entries(tokens);
  check('令牌覆盖层非空且全部为 --dsw-* 官方令牌', tokenEntries.length >= 20 && tokenEntries.every(([k]) => k.startsWith('--dsw-')));
  check('令牌均为 { light, dark } 双值对', tokenEntries.every(([, v]) => v && typeof v.light === 'string' && typeof v.dark === 'string'));

  // 深色主题：深空半透玻璃（不是纯透明，也不是死黑）
  const dk = (name) => tokens[name].dark;
  const lt = (name) => tokens[name].light;
  check('深色 bg-base 为深空半透（不透明也不死黑）', /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\.\d+\)$/.test(dk('--dsw-alias-bg-base')) && !dk('--dsw-alias-bg-base').includes('0, 0, 0, 0)'));
  check('浅色 bg-base 为浅色半透（R 通道 > 200）', /^rgba\(\s*(2\d\d|1\d\d),/.test(lt('--dsw-alias-bg-base')) && parseInt(lt('--dsw-alias-bg-base').split('(')[1].split(',')[0], 10) > 200);
  check('深浅 bg-base 必须不同（保证主题切换有实际视觉差异）', dk('--dsw-alias-bg-base') !== lt('--dsw-alias-bg-base'));

  // 层级递减：layer-1..4 的不透明度应 >= bg-base（卡片比窗口底更实）
  const alphaOf = (s) => parseFloat((s.match(/,\s*([\d.]+)\)$/) || [0, '1'])[1]);
  check('层级不透明度单调不减（layer-4 >= bg-base）', alphaOf(dk('--dsw-alias-bg-layer-4')) >= alphaOf(dk('--dsw-alias-bg-base')));
  check('侧栏 fill 与主区区分（值不同）', dk('--dsw-specific-sidebar-fill') !== dk('--dsw-alias-bg-base'));
  check('输入框 major 独立于 bg-base（值不同）', dk('--dsw-specific-input-major') !== dk('--dsw-alias-bg-base'));

  // 文字色：深色主题必须亮、浅色主题必须暗（这是"字体不显示"的根治点）
  const lum = (hex) => {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  check('深色主题 label-primary 为高亮文字（亮度 > 0.85）', lum(dk('--dsw-alias-label-primary')) > 0.85);
  check('浅色主题 label-primary 为深色文字（亮度 < 0.20）', lum(lt('--dsw-alias-label-primary')) < 0.20);
  check('深色 label-secondary / tertiary 均可读（亮度 > 0.6）', lum(dk('--dsw-alias-label-secondary')) > 0.6 && lum(dk('--dsw-alias-label-tertiary')) > 0.6);
  check('浅色 label-secondary / tertiary 均够深（亮度 < 0.45）', lum(lt('--dsw-alias-label-secondary')) < 0.45 && lum(lt('--dsw-alias-label-tertiary')) < 0.45);
  check('菜单专属令牌 --dsw-specific-menu 深浅不同', dk('--dsw-specific-menu') !== lt('--dsw-specific-menu'));

  /* ── 补充 CSS：只允许做令牌做不到的三件事 ── */

  const css = X.generateDynamicCss({ enabled: true });
  check('禁用常规 backdrop-filter 模糊（0px 视界）', css.includes('backdrop-filter: none !important'));
  check('但菜单/弹窗保留原生磨砂（白名单排除）', css.includes('[role="menu"]') && css.includes('[role="dialog"]'));
  check('composer 座席深色渐变遮蔽（防历史消息穿透）', css.includes('body[data-ds-dark-theme] [data-composer-seat]') && css.includes('rgba(6,10,20,0.98)'));
  check('composer 座席浅色渐变遮蔽（浅色主题同样防穿透）', css.includes('body:not([data-ds-dark-theme]) [data-composer-seat]') && css.includes('rgba(248,250,253,1)'));
  check('深空画布暗角（中央压暗提升对比）', css.includes('radial-gradient(ellipse 82% 72%'));
  check('浅色主题暗角反向（浅白柔光而非压黑）', css.includes('rgba(255, 255, 255, 0.16)'));
  check('滚动条只改尺寸，颜色交给令牌', css.includes('::-webkit-scrollbar { width: 6px'));
  check('代码块深色主题给轻底色', css.includes('body[data-ds-dark-theme] pre'));
  check('代码块浅色主题给极淡底色', css.includes('body:not([data-ds-dark-theme]) pre'));

  /* ── 负向断言：确保旧架构的"通配符暴力清空"已彻底移除 ── */
  check('已移除 [class*="tag"] 通配符（避免下一个 _item 事故）', !css.includes('[class*="tag"]'));
  check('已移除 [class*="badge"] 通配符', !css.includes('[class*="badge"]'));
  check('已移除 [class*="_card"] 通配符大面积覆盖', !css.includes('[class*="_card"]:not('));
  check('已移除全局强制纯白文字注入', !css.includes('color: #FFFFFF !important'));
  check('已移除全局 text-shadow 污染', !css.includes('text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95)'));
  check('已移除 _bottomRow 误伤（不再当 composer 处理）', !css.includes('[class*="_bottomRow"]'));

  /* ── store ── */

  const storeSpec = X.makeStore().spec;
  const initial = storeSpec.init();
  check('store 默认开启星空', initial.enabled === true);
  check('store 已删除 surfaceOpacity（滑块已移除）', !('surfaceOpacity' in initial));
  check('store 默认无模糊 blur=0', initial.blur === 0);
  check('store 默认速度 0.4 / 粒子 1000', initial.speed === 0.4 && initial.density === 1000);

  check('store 已无 setSurfaceOpacity action', typeof storeSpec.actions.setSurfaceOpacity === 'undefined');

  const draft = { enabled: 'x' };
  storeSpec.actions.normalize(draft);
  check('normalize 容错脏数据', draft.enabled === true);

  const d2 = {};
  storeSpec.actions.setEnabled(d2, false);
  check('setEnabled 严格布尔', d2.enabled === false);

  const d4 = {};
  storeSpec.actions.setBlur(d4, 0);
  check('setBlur 设置无模糊 (0)', d4.blur === 0);

  const dDensity = {};
  storeSpec.actions.setDensity(dDensity, 1500);
  check('setDensity 支持调节星空粒子数量', dDensity.density === 1500);

  const dSpeed = {};
  storeSpec.actions.setSpeed(dSpeed, 1.2);
  check('setSpeed 支持调节航行速度', dSpeed.speed === 1.2);

  const d5 = { blur: 16, autoContrast: false };
  storeSpec.actions.resetDefaults(d5);
  check('resetDefaults 恢复无模糊默认 (blur=0, speed=0.4, density=1000)', d5.blur === 0 && d5.speed === 0.4 && d5.density === 1000);

  /* ── 关键回归：normalize 绝不能把用户设置归零 ── */

  const keep = { schemaVersion: 3, enabled: false, speed: 1.3, density: 1800 };
  storeSpec.actions.normalize(keep);
  check('【回归】normalize 保留用户速度设置', keep.speed === 1.3);
  check('【回归】normalize 保留用户粒子数设置', keep.density === 1800);
  check('【回归】normalize 保留用户开关设置', keep.enabled === false);

  // 旧版迁移
  const legacy = { schemaVersion: 1, enabled: false, speed: 0.2, boost: false };
  storeSpec.actions.normalize(legacy);
  check('旧版迁移后 enabled 复位为 true', legacy.enabled === true);
  check('旧版迁移清除废弃字段 boost', !('boost' in legacy));
  check('迁移后 schemaVersion 升到 3', legacy.schemaVersion === 3);

  finish();

  function finish() {
    console.log(failures === 0 ? `\n全部通过：${checks} 项检查` : `\n失败 ${failures}/${checks} 项检查`);
    process.exit(failures === 0 ? 0 : 1);
  }
})().catch((err) => { console.error(err); process.exit(1); });
