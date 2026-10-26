/** 引擎热更新契约验证（零依赖，纯 Node 桩） */
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('F:\\05-DeepseekHarness\\04-DSH插件\\01-深空背景\\client.js', 'utf8');
const win = { __ModuleLoader__: { load(s) { this.spec = s; } } };
const noop = () => {};

function mkCtx() {
  const grad = { addColorStop: noop };
  return new Proxy({}, {
    get(_, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'createImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'canvas') return { width: 800, height: 600 };
      return noop;
    },
    set() { return true; },
  });
}

const mkCanvas = () => ({
  className: '', width: 0, height: 0, style: {},
  getContext: mkCtx,
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
  remove: noop, parentNode: null,
});

const root = {
  appendChild: noop, removeChild: noop, style: {}, setAttribute: noop,
  addEventListener: noop, removeEventListener: noop,
  clientWidth: 800, clientHeight: 600, offsetWidth: 800, offsetHeight: 600,
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
};

const documentStub = {
  createElement: () => mkCanvas(),
  addEventListener: noop, removeEventListener: noop,
  body: { prepend: noop, appendChild: noop, removeChild: noop, style: { setProperty: noop, removeProperty: noop }, setAttribute: noop, removeAttribute: noop },
  documentElement: { style: {}, setAttribute: noop, removeAttribute: noop },
  head: { appendChild: noop },
  getElementById: () => null,
  querySelector: () => null,
};

const sandbox = {
  window: win, document: documentStub,
  localStorage: { getItem: () => null, setItem: noop },
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  ResizeObserver: function () { this.observe = noop; this.disconnect = noop; },
  Math, Date, JSON, Set, Map, WeakMap, Object, Array, String, Number, Boolean,
  parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, Uint8ClampedArray,
};
sandbox.globalThis = sandbox;

vm.runInNewContext(code, sandbox);

const mod = win.__ModuleLoader__.spec.factory(() => ({
  defineStore: (spec) => ({ spec }),
}));

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.error(`  ✗ ${name}`); fail++; }
};

console.log('\n=== 引擎热更新契约 ===');
const eng = mod.__test__.createSpaceEngine(root, { density: 1000, interactive: false, showHud: false });
check('createSpaceEngine 返回 setDensity', typeof eng.setDensity === 'function');
check('createSpaceEngine 返回 dispose', typeof eng.dispose === 'function');
check('setDensity(1500) 扩容不抛错', (() => { try { eng.setDensity(1500); return true; } catch { return false; } })());
check('setDensity(300) 缩容不抛错', (() => { try { eng.setDensity(300); return true; } catch { return false; } })());
check('setDensity(超出范围) 被 clamp 不抛错', (() => { try { eng.setDensity(99999); return true; } catch { return false; } })());
check('dispose() 不抛错', (() => { try { eng.dispose(); return true; } catch { return false; } })());

console.log('\n=== 主题令牌完整性 ===');
const T = mod.__test__;
const tok = T.generateTokenOverrides({ enabled: true });
const REQUIRED = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3', '--dsw-alias-bg-layer-4',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-specific-menu',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-state-business-primary',
];
check(`必需令牌齐全（${REQUIRED.length} 个）`, REQUIRED.every((k) => tok[k] && tok[k].light && tok[k].dark));
check('令牌总数 >= 25', Object.keys(tok).length >= 25);

console.log('\n=== 主题切换视觉差异 ===');
const lum = (c) => {
  c = c.trim();
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0.5;
  const p = m[1].split(',').map(Number);
  return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
};
check('深色 primary 文字亮（>0.85）', lum(tok['--dsw-alias-label-primary'].dark) > 0.85);
check('浅色 primary 文字暗（<0.20）', lum(tok['--dsw-alias-label-primary'].light) < 0.20);
check('深色 secondary 文字亮（>0.75）', lum(tok['--dsw-alias-label-secondary'].dark) > 0.75);
check('浅色 secondary 文字暗（<0.30）', lum(tok['--dsw-alias-label-secondary'].light) < 0.30);
check('深色 tertiary 文字亮（>0.70）', lum(tok['--dsw-alias-label-tertiary'].dark) > 0.70);
check('浅色 tertiary 文字暗（<0.45）', lum(tok['--dsw-alias-label-tertiary'].light) < 0.45);

/* ══════════════════════════════════════════════════════════════
 * 【BUG-010 回归】星空必须可见
 *
 * --dsw-alias-bg-base 被 DSH 嵌套使用 3 次：
 *   .mP3x-q_frame → .mP3x-q_centerCol → .an3WzG_root
 * 任何非零不透明度都会累加（0.58 三层 = 92.6% → 星空消失）。
 * 所以 bg-base 必须完全透明，界面色调由独立的单层 tint 负责。
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 星空可见性（BUG-010 回归）===');

const alphaOf = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const p = m[1].split(',').map(Number);
  return p.length > 3 ? p[3] : 1;
};

check('深色 bg-base 必须完全透明（否则嵌套 3 层会盖住星空）', alphaOf(tok['--dsw-alias-bg-base'].dark) === 0);
check('浅色 bg-base 必须完全透明', alphaOf(tok['--dsw-alias-bg-base'].light) === 0);

// 模拟 3 层嵌套后的实际不透明度，必须 < 0.5 才算星空可辨
const CASCADE_DEPTH = 3;
const cascadedAlpha = (a) => 1 - Math.pow(1 - a, CASCADE_DEPTH);
check('深色 bg-base 三层叠加后仍透明（=0）', cascadedAlpha(alphaOf(tok['--dsw-alias-bg-base'].dark)) === 0);
check('浅色 bg-base 三层叠加后仍透明（=0）', cascadedAlpha(alphaOf(tok['--dsw-alias-bg-base'].light)) === 0);

// layer-1..4 也会嵌套（卡片套卡片），不透明度必须足够低
const maxLayerAlpha = Math.max(
  ...['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-layer-4']
    .map((k) => alphaOf(tok[k].dark))
);
check('深色 layer 最大不透明度 <= 0.55（两层叠加后仍可控）', maxLayerAlpha <= 0.55);
const maxLayerAlphaL = Math.max(
  ...['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-layer-4']
    .map((k) => alphaOf(tok[k].light))
);
check('浅色 layer 最大不透明度 <= 0.75', maxLayerAlphaL <= 0.75);

// 单层 tint 必须存在（这是唯一的界面着色来源）
const cssForTint = T.generateDynamicCss({ enabled: true });
const tintMatch = cssForTint.match(/#sbg-canvas-root::before\s*\{[^}]*background:\s*rgba\(([^)]+)\)/);
check('存在单层 tint（#sbg-canvas-root::before）作为界面唯一着色', !!tintMatch);
if (tintMatch) {
  const p = tintMatch[1].split(',').map(Number);
  const tintAlpha = p.length > 3 ? p[3] : 1;
  check(`单层 tint 不透明度合理（0.3~0.7，实测 ${tintAlpha}）`, tintAlpha >= 0.3 && tintAlpha <= 0.7);
}
check('深浅主题各有独立 tint 值', cssForTint.includes('body:not([data-ds-dark-theme]) #sbg-canvas-root::before'));

console.log('\n=== 无障碍对比度（WCAG AA >= 4.5:1）===');
function contrast(fg, bg) {
  const rel = (c) => { const v = lum(c); return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L1 = rel(fg), L2 = rel(bg);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
// 背景是半透的，取实际合成后的近似色（深色星空 #04060E 上叠加 rgba）
const DEEP_SPACE = '#04060E';
const LIGHT_BASE = '#F8FAFD';
check('深色 primary on 深空底 >= 4.5', contrast(tok['--dsw-alias-label-primary'].dark, DEEP_SPACE) >= 4.5);
check('深色 secondary on 深空底 >= 4.5', contrast(tok['--dsw-alias-label-secondary'].dark, DEEP_SPACE) >= 4.5);
check('深色 tertiary on 深空底 >= 4.5', contrast(tok['--dsw-alias-label-tertiary'].dark, DEEP_SPACE) >= 4.5);
check('浅色 primary on 浅底 >= 4.5', contrast(tok['--dsw-alias-label-primary'].light, LIGHT_BASE) >= 4.5);
check('浅色 secondary on 浅底 >= 4.5', contrast(tok['--dsw-alias-label-secondary'].light, LIGHT_BASE) >= 4.5);
check('浅色 tertiary on 浅底 >= 4.5', contrast(tok['--dsw-alias-label-tertiary'].light, LIGHT_BASE) >= 4.5);

console.log('\n=== 层级不透明度单调性 ===');
const alpha = (s) => parseFloat((s.match(/,\s*([\d.]+)\)$/) || [0, '1'])[1]);
check('深色 layer-1 >= bg-base', alpha(tok['--dsw-alias-bg-layer-1'].dark) >= alpha(tok['--dsw-alias-bg-base'].dark));
check('深色 layer-2 >= layer-1', alpha(tok['--dsw-alias-bg-layer-2'].dark) >= alpha(tok['--dsw-alias-bg-layer-1'].dark));
check('深色 layer-4 >= layer-3', alpha(tok['--dsw-alias-bg-layer-4'].dark) >= alpha(tok['--dsw-alias-bg-layer-3'].dark));
check('浅色 layer-1 >= bg-base', alpha(tok['--dsw-alias-bg-layer-1'].light) >= alpha(tok['--dsw-alias-bg-base'].light));
check('浅色 layer-4 >= layer-3', alpha(tok['--dsw-alias-bg-layer-4'].light) >= alpha(tok['--dsw-alias-bg-layer-3'].light));

console.log('\n=== 旧架构彻底移除 ===');
const css = T.generateDynamicCss({ enabled: true });
const FORBIDDEN = [
  ['[class*="tag"]', 'tag 通配符'],
  ['[class*="badge"]', 'badge 通配符'],
  ['[class*="_item"]', '_item 通配符'],
  ['[class*="_bottomRow"]', '_bottomRow 误伤'],
  ['color: #FFFFFF !important', '全局强制白字'],
  ['text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95)', '全局文字阴影'],
  ['background: transparent !important', '全局背景清空'],
];
FORBIDDEN.forEach(([needle, label]) => check(`已移除：${label}`, !css.includes(needle)));

console.log('\n=== 必要 CSS 保留 ===');
check('0px 模糊规则存在', css.includes('backdrop-filter: none !important'));
check('菜单磨砂白名单存在', css.includes('[role="menu"]'));
check('深色 composer 遮蔽存在', css.includes('body[data-ds-dark-theme] [data-composer-seat]'));
check('浅色 composer 遮蔽存在', css.includes('body:not([data-ds-dark-theme]) [data-composer-seat]'));
check('深色暗角存在', css.includes('rgba(4, 8, 16, 0.26)'));
check('浅色暗角存在', css.includes('rgba(255, 255, 255, 0.14)'));

console.log('\n=== store 契约 ===');
const spec = T.makeStore().spec;
const init = spec.init();
check('init 无 surfaceOpacity 字段', !('surfaceOpacity' in init));
check('无 setSurfaceOpacity action', typeof spec.actions.setSurfaceOpacity === 'undefined');
check('保留 setSpeed', typeof spec.actions.setSpeed === 'function');
check('保留 setDensity', typeof spec.actions.setDensity === 'function');
const k = { schemaVersion: 3, enabled: false, speed: 1.3, density: 1800 };
spec.actions.normalize(k);
check('【关键回归】normalize 不重置 speed', k.speed === 1.3);
check('【关键回归】normalize 不重置 density', k.density === 1800);

console.log('\n=== 预览与运行时一致性（PIT-002 回归）===');
const previewHtml = fs.readFileSync(
  require('path').join(__dirname, '..', 'preview.html'), 'utf8'
);
const runtimeTok = mod.__test__.generateTokenOverrides({ enabled: true });
// preview.html 内联了一份 PALETTE 副本（file:// 下 fetch 被拦截），必须与 client.js 保持一致
const missing = [];
for (const [name, pair] of Object.entries(runtimeTok)) {
  if (!previewHtml.includes(pair.dark.replace(/\s+/g, ' ').replace(/,\s*/g, ','))) {
    // 允许空格差异，做宽松匹配
    const loose = pair.dark.replace(/\s/g, '');
    const normalized = previewHtml.replace(/\s/g, '');
    if (!normalized.includes(loose)) missing.push(name + ' (dark)');
  }
}
check('preview.html 内联 PALETTE 与运行时一致（不允许漂移）', missing.length === 0);
if (missing.length) console.error('   漂移的令牌:', missing.join(', '));

console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} 项通过，${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
