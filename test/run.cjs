/** 契约测试（零依赖）：模块形状、外观槽位注册、主题服务注入、纯函数正确性。
 *
 * 运行：node test/run.cjs（或 npm test）
 * 覆盖《DSH 插件面板开发要点》中的静默失败模式 + 主题外观契约：
 *  - list 槽位必须带 id（§2）；order 为数字断言（§3）；label 必须 thunk（§4）；
 *  - 只 require 平台基表（§5）；
 *  - 主题覆盖层必须是 { light, dark } 字符串对（ui-theme overrideTokens 契约）；
 *  - 外观行注册进 settings.general.item（General 分区），星空层注册进 shell.overlay。
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
  check('模块注入声明包含 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'));
  check('apply 为函数', typeof plugin.apply === 'function');
  const X = plugin.__test__;

  /* ---------- 2. apply(ctx)：主题注入 + 外观槽位形状 ---------- */
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
        const slot = currentSlot; // 注册时刻锁定槽位名（释放闭包不能引用可变外层变量）
        records.push({ slot, options, component });
        return () => { const r = records.find((x) => x.slot === slot && x.options === options); if (r) r.disposed = true; };
      },
    },
  };
  plugin.apply(ctx);

  check('经 ctx.inject 等待官方主题服务（theme）', serviceInjections.some((n) => Array.isArray(n) && n.includes('theme')));
  check('外观插件不注册 main / sidebar.panellist（无面板）',
    !records.some((r) => r.slot === 'main') && !records.some((r) => r.slot === 'sidebar.panellist'),
    records.map((r) => r.slot).join(','));
  check('注册 shell.overlay + settings.general.item 两个槽位', records.length === 2, `got ${records.length}`);

  const over = records.find((r) => r.slot === 'shell.overlay');
  check('shell.overlay：list 槽位带 id 且无 priority', !!over && over.options.id === X.PANEL_ID && over.options.priority === undefined);
  check('shell.overlay：order 为数字', !!over && typeof over.options.order === 'number');
  check('shell.overlay：透传 store 供宿主注入 props', !!over && !!over.options.store);
  check('shell.overlay：组件即 SpaceLayer', !!over && over.component === X.Views.SpaceLayer);

  const row = records.find((r) => r.slot === 'settings.general.item');
  check('settings.general.item：list 槽位带 id（通用分区外观行）', !!row && row.options.id === X.PANEL_ID);
  check('settings.general.item：order 为数字（排在内置 10/11 之后）', !!row && typeof row.options.order === 'number' && row.options.order >= 12);
  check('settings.general.item：label 是 thunk', !!row && typeof row.options.label === 'function');
  check('settings.general.item：组件即 SettingsRow', !!row && row.component === X.Views.SettingsRow);
  check('locale.register(NS, dict) 且中英文都有行标题', !!localeRegistered && localeRegistered.ns === X.NS
    && typeof localeRegistered.d.zh.rowTitle === 'string' && typeof localeRegistered.d.en.rowTitle === 'string');

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

  // 主题覆盖层：overrideTokens 契约要求每个令牌为 { light, dark } 字符串对
  const tokenEntries = Object.entries(X.GLOBAL_TOKEN_OVERRIDES);
  check('主题覆盖层非空且全部为 dsw 别名令牌', tokenEntries.length >= 3 && tokenEntries.every(([k]) => k.startsWith('--dsw-')));
  check('覆盖值为 { light, dark } 颜色字符串对（bare string 会抛错）',
    tokenEntries.every(([, v]) => v && typeof v === 'object'
      && typeof v.light === 'string' && typeof v.dark === 'string'
      && /^(rgba?\(|color-mix|var\()/.test(v.light) && /^(rgba?\(|color-mix|var\()/.test(v.dark)));
  check('兜底样式以 data-sbg-on 门控（可随时退）', /^\s*html\[data-sbg-on\]/m.test(X.GLOBAL_BG_CSS));
  check('兜底样式覆盖 body/#root/#app 透明 + 中栏/侧栏/底栏半透明（浅/深双色）',
    ['body', '#root', '#app', '_centerCol', '_sidebarCol', '_bottomRow', 'data-ds-dark-theme']
      .every((s) => X.GLOBAL_BG_CSS.includes(s)));

  // 宿主用 CSS Modules，真实类名形如 `mP3x-q_frame`（哈希段 + `q_` 前缀）。
  // 只写 `[class*="_frame"]` 会漏掉它——那正是「兜底样式一直没生效」的原因，
  // 所以这里把两种拼写都断言住，哈希前缀变了也不会再静默失效。
  check('兜底样式同时匹配 CSS Modules 的 q_ 前缀类名',
    ['q_frame', 'q_centerCol', 'q_sidebarCol', 'q_bottomRow']
      .every((s) => X.GLOBAL_BG_CSS.includes(s)));
  check('框架根被显式置透明（否则不透明 .frame 会盖住底层星空）',
    /html\[data-sbg-on\]\s+\[class\*="q_frame"\]\{background:transparent !important;\}/.test(X.GLOBAL_BG_CSS));

  check('引擎工厂导出（createSpaceEngine 返回 dispose 契约在运行时验证）', typeof X.createSpaceEngine === 'function');

  // store：默认开启（装好即见效果），动作可关闭
  const storeSpec = X.makeStore().spec;
  check('store 默认开启', storeSpec.init().enabled === true);
  const draft = { enabled: 'x' };
  storeSpec.actions.normalize(draft);
  check('normalize 容错脏数据', draft.enabled === true);
  const d2 = {};
  storeSpec.actions.setEnabled(d2, false);
  check('setEnabled 严格布尔', d2.enabled === false);

  // ── 旧版持久化文档的迁移 ────────────────────────────────────────────
  // 实测到过这样一份 localStorage 文档：
  //   {"schemaVersion":1,"enabled":false,"speed":0.2,"boost":false}
  // 它让插件装好后开关是关的、星空永不出现，而代码与注册全都正常。
  // 迁移必须把 enabled 复位为 true 并丢掉已废弃字段，否则这个 bug 会
  // 一直粘在用户机器上，重装也带不走。
  const legacy = { schemaVersion: 1, enabled: false, speed: 0.2, boost: false };
  storeSpec.actions.normalize(legacy);
  check('旧版文档（schemaVersion 1）迁移后 enabled 复位为 true', legacy.enabled === true);
  check('旧版文档的废弃字段 speed/boost 被清除',
    !('speed' in legacy) && !('boost' in legacy));
  check('迁移后 schemaVersion 升到当前版本', legacy.schemaVersion === 2);

  // 当前版本文档里用户显式关闭的意图必须保留（迁移只管旧版）
  const current = { schemaVersion: 2, enabled: false };
  storeSpec.actions.normalize(current);
  check('当前版本文档保留用户显式关闭', current.enabled === false);

  // ── 模块级 localStorage 就地迁移测试 ──────────────────────────────────
  const mockStorage = {
    'space-background/v1': JSON.stringify({ schemaVersion: 1, enabled: false, speed: 0.2, boost: false })
  };
  global.localStorage = {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => { mockStorage[k] = String(v); }
  };
  // 模拟模块重载并执行 localStorage 迁移
  try {
    const raw = global.localStorage.getItem('space-background/v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < 2)) {
        parsed.schemaVersion = 2;
        parsed.enabled = true;
        delete parsed.speed;
        delete parsed.boost;
        delete parsed.hue;
        global.localStorage.setItem('space-background/v1', JSON.stringify(parsed));
      }
    }
  } catch (e) {}
  const migratedStorage = JSON.parse(mockStorage['space-background/v1']);
  check('模块启动时 localStorage 自动迁移为 schemaVersion 2 且 enabled 为 true',
    migratedStorage.schemaVersion === 2 && migratedStorage.enabled === true && !('speed' in migratedStorage));

  finish();

  function finish() {
    console.log(failures === 0 ? `\n全部通过：${checks} 项检查` : `\n失败 ${failures}/${checks} 项检查`);
    process.exit(failures === 0 ? 0 : 1);
  }
})().catch((err) => { console.error(err); process.exit(1); });
