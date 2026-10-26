/**
 * 真实浏览器渲染验证（Playwright）
 *
 * 为什么需要它：之前的 65 项测试全是字符串 includes()，
 * 无法发现"细节丑"这类视觉问题。本脚本在真实 Chromium 里
 * 渲染 preview.html，读取 getComputedStyle 计算实际对比度。
 */
const path = require('path');
const { chromium } = require('playwright');

const PREVIEW = 'file:///' + path.resolve(__dirname, '..', 'preview.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(PREVIEW, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });

  const result = await page.evaluate(() => window.__auditResult);

  // 抓取两个主题的实际计算值，做二次断言
  const detail = await page.evaluate(() => {
    const grab = (paneId) => {
      const pane = document.getElementById(paneId);
      const frame = pane.querySelector('[data-mock]');
      // 注意：menu / composer 是 .frame 的兄弟节点（模拟真实浮层），必须在 pane 内查
      const cs = (sel, prop) => {
        const el = pane.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      return {
        bgBase: getComputedStyle(frame).backgroundColor,
        sidebar: cs('.sidebar', 'backgroundColor'),
        card: cs('.card', 'backgroundColor'),
        inner: cs('.inner', 'backgroundColor'),
        title: cs('.card-title', 'color'),
        desc: cs('.card-desc', 'color'),
        nav: cs('.nav-item.on', 'color'),
        dock: cs('.dock span', 'color'),
        trigger: cs('.trigger', 'backgroundColor'),
        triggerColor: cs('.trigger', 'color'),
        menu: cs('.menu', 'backgroundColor'),
        menuItemBorder: cs('.menu-item', 'borderTopWidth'),
        composer: cs('.composer', 'backgroundColor'),
        radiusCard: cs('.card', 'borderRadius'),
        radiusMenu: cs('.menu', 'borderRadius'),
      };
    };
    return { dark: grab('pane-dark'), light: grab('pane-light') };
  });

  /* ══════════════════════════════════════════════════════════════
   * 【BUG-010 回归】星空必须真实可见 —— 必须在 browser.close() 之前采样
   *
   * 在浏览器里真的去采样 canvas 像素 + 读取 bg-base 的 computed alpha。
   * 这比任何 CSS 字符串断言都可靠 —— bg-base 曾经是 rgba(...,0.58)，
   * 三层嵌套后 92.6% 不透明，星空肉眼完全看不见，但旧测试全绿。
   * ══════════════════════════════════════════════════════════════ */
  const starfieldProbe = await page.evaluate(() => {
    const probe = (paneId) => {
      const pane = document.getElementById(paneId);
      const cv = pane.querySelector('.space');
      const tintEl = pane.querySelector('.tint');
      const frame = pane.querySelector('[data-mock]');

      const ctx = cv.getContext('2d');
      const px = ctx.getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
      const canvasLum = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;

      const alpha = (s) => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return 1;
        const p = m[1].split(',').map(Number);
        return p.length > 3 ? p[3] : 1;
      };

      const tintAlpha = alpha(getComputedStyle(tintEl).backgroundColor);
      const frameAlpha = alpha(getComputedStyle(frame).backgroundColor);

      return {
        canvasLum, tintAlpha, frameAlpha,
        simulatedCascade: 1 - Math.pow(1 - frameAlpha, 3),
      };
    };
    return { dark: probe('pane-dark'), light: probe('pane-light') };
  });

  await page.screenshot({ path: path.join(__dirname, '..', '_diagnostics', 'preview-dual-theme.png'), fullPage: false });
  await browser.close();

  /* ── 输出报告 ── */
  const fmt = (o) => JSON.stringify(o, null, 2);
  console.log('\n════════ 浏览器内自动审计 ════════');
  console.log(`DARK  失败项: ${result.dark}`);
  console.log(`LIGHT 失败项: ${result.light}`);
  console.log('\n════════ 实际计算样式 ════════');
  console.log('DARK :', fmt(detail.dark));
  console.log('LIGHT:', fmt(detail.light));

  const problems = [];

  if (errors.length) problems.push(`页面报错: ${errors.join(' | ')}`);
  if (result.dark > 0) problems.push(`DARK 主题 ${result.dark} 项审计失败`);
  if (result.light > 0) problems.push(`LIGHT 主题 ${result.light} 项审计失败`);

  // 关键：菜单项必须无边框
  if (detail.dark.menuItemBorder !== '0px') problems.push(`DARK 菜单项有边框: ${detail.dark.menuItemBorder}`);
  if (detail.light.menuItemBorder !== '0px') problems.push(`LIGHT 菜单项有边框: ${detail.light.menuItemBorder}`);

  /* ══════════════════════════════════════════════════════════════
   * 【BUG-010 回归】星空必须真实可见 —— starfieldProbe 已在 close 前采样
   * ══════════════════════════════════════════════════════════════ */

  // canvas 必须真的画了东西（不是全黑空白）
  if (starfieldProbe.dark.canvasLum < 0.01) problems.push('DARK canvas 疑似空白（未绘制星点）');
  if (starfieldProbe.light.canvasLum < 0.01) problems.push('LIGHT canvas 疑似空白');

  // bg-base 必须透明（frame 的 computed backgroundColor 应该是 rgba(0,0,0,0)）
  if (starfieldProbe.dark.frameAlpha !== 0) {
    problems.push(`DARK bg-base 不透明（alpha=${starfieldProbe.dark.frameAlpha}），三层嵌套后会盖住星空`);
  }
  if (starfieldProbe.light.frameAlpha !== 0) {
    problems.push(`LIGHT bg-base 不透明（alpha=${starfieldProbe.light.frameAlpha}），三层嵌套后会盖住星空`);
  }

  // 模拟三层叠加后的总不透明度必须足够低（<0.5 才看得到星空）
  if (starfieldProbe.dark.simulatedCascade >= 0.5) {
    problems.push(`DARK 三层叠加不透明度 ${(starfieldProbe.dark.simulatedCascade * 100).toFixed(1)}% 过高，星空会消失`);
  }
  if (starfieldProbe.light.simulatedCascade >= 0.5) {
    problems.push(`LIGHT 三层叠加不透明度 ${(starfieldProbe.light.simulatedCascade * 100).toFixed(1)}% 过高，星空会消失`);
  }

  // tint 层必须存在且有合理不透明度
  if (starfieldProbe.dark.tintAlpha < 0.3 || starfieldProbe.dark.tintAlpha > 0.7) {
    problems.push(`DARK tint 不透明度异常: ${starfieldProbe.dark.tintAlpha}`);
  }
  if (starfieldProbe.light.tintAlpha < 0.3 || starfieldProbe.light.tintAlpha > 0.7) {
    problems.push(`LIGHT tint 不透明度异常: ${starfieldProbe.light.tintAlpha}`);
  }

  // 关键：圆角必须是 DSH 原生（非 0，非夸张）
  const rOk = (r) => r && parseFloat(r) > 0 && parseFloat(r) <= 20;
  if (!rOk(detail.dark.radiusCard)) problems.push(`DARK 卡片圆角异常: ${detail.dark.radiusCard}`);
  if (!rOk(detail.light.radiusCard)) problems.push(`LIGHT 卡片圆角异常: ${detail.light.radiusCard}`);
  if (!rOk(detail.dark.radiusMenu)) problems.push(`DARK 菜单圆角异常: ${detail.dark.radiusMenu}`);
  if (!rOk(detail.light.radiusMenu)) problems.push(`LIGHT 菜单圆角异常: ${detail.light.radiusMenu}`);

  // 关键：深浅主题必须有差异
  // 注意：bg-base 现在两边都是 rgba(0,0,0,0)（必须透明，见 BUG-010），
  // 主题差异体现在 tint 层与文字色上，所以这里只能比对 tint 与文字色。
  if (starfieldProbe.dark.tintAlpha === starfieldProbe.light.tintAlpha &&
      detail.dark.title === detail.light.title) {
    problems.push('深浅主题无任何差异（主题切换无效）');
  }
  if (detail.dark.title === detail.light.title) problems.push('深浅主题标题色相同（文字色未随主题切换）');

  console.log('\n════════ 结论 ════════');
  if (problems.length === 0) {
    console.log('✅ 浏览器渲染验证全部通过');
    process.exit(0);
  } else {
    console.log('❌ 发现问题:');
    problems.forEach((p) => console.log('   - ' + p));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
