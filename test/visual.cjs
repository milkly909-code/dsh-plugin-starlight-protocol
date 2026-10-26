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

  // 关键：圆角必须是 DSH 原生（非 0，非夸张）
  const rOk = (r) => r && parseFloat(r) > 0 && parseFloat(r) <= 20;
  if (!rOk(detail.dark.radiusCard)) problems.push(`DARK 卡片圆角异常: ${detail.dark.radiusCard}`);
  if (!rOk(detail.light.radiusCard)) problems.push(`LIGHT 卡片圆角异常: ${detail.light.radiusCard}`);
  if (!rOk(detail.dark.radiusMenu)) problems.push(`DARK 菜单圆角异常: ${detail.dark.radiusMenu}`);
  if (!rOk(detail.light.radiusMenu)) problems.push(`LIGHT 菜单圆角异常: ${detail.light.radiusMenu}`);

  // 关键：深浅主题必须有差异
  if (detail.dark.bgBase === detail.light.bgBase) problems.push('深浅主题 bg-base 相同（主题切换无效）');
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
