/**
 * Client half of @local/space-background — 深空背景（主题与外观插件）。
 *
 * 外观插件（无侧边栏、无面板）：
 *  - settings.general.item（list）：设置「通用」分区新增「深空背景」开关行，
 *    排在外观（10）/字号（11）之后（order 12）；
 *  - shell.overlay（list）：开关开启时把星空画布挂到窗口底层（z-index:-1、
 *    pointer-events:none、30fps 环境漂移），并通过官方主题服务
 *    ctx.theme.overrideTokens() 折入半透明表面令牌——银河、随机星座、行星、
 *    流星从底层透出，文字保持可读；关闭即撤销全部效果。
 *  - 状态本地持久化（defineStore persist），默认开启。
 *
 * 引擎 createSpaceEngine(root, opts)：无缝天幕（整周期正弦银河带 + 天体越界
 * 补画）、随机星域交叉淡入、流星与掠过行星、分帧星点填充、降级动效支持。
 *
 * 纯函数与组件通过 __test__ 导出，供 test/run.cjs 零依赖契约测试。
 * 免构建：仅 require 平台基表（react / @deepseek-ai/dsh-client-store），无 JSX。
 */
window.__ModuleLoader__.load({
  id: '@local/space-background',
  factory(require) {
    const React = require('react');
    const { defineStore } = require('@deepseek-ai/dsh-client-store');
    const h = React.createElement;

    /** 插件唯一 id，槽位注册保持一致。 */
    const PANEL_ID = 'space-background';
    const NS = 'space-background';
    const PERSIST_KEY = 'space-background/v1';
    /**
     * 持久化文档的 schema 版本。
     *
     * 3：升级为独立控制台页面，支持界面通透度 (surfaceOpacity)、毛玻璃磨砂度 (blur)、
     *    智能文字对比度保护 (autoContrast) 与轮廓微阴影 (textShadow)。
     */
    const STORE_SCHEMA_VERSION = 3;

    // ── 早期版本脏数据迁移 ────────────────────────────────────────────────
    // defineStore 的 rehydration 只是直接 JSON.parse(localStorage.getItem(...))
    // 并不会自动调用 actions.normalize。在模块加载时提前就地迁移 localStorage，
    // 确保 defineStore 初始化读取时拿到已升级的 schemaVersion: 3 与推荐通透度。
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < STORE_SCHEMA_VERSION)) {
            parsed.schemaVersion = STORE_SCHEMA_VERSION;
            parsed.enabled = true;
            if (typeof parsed.surfaceOpacity !== 'number') parsed.surfaceOpacity = 0.45;
            if (typeof parsed.blur !== 'number') parsed.blur = 16;
            if (typeof parsed.autoContrast !== 'boolean') parsed.autoContrast = true;
            if (typeof parsed.textShadow !== 'boolean') parsed.textShadow = true;
            if (typeof parsed.speed !== 'number') parsed.speed = 0.4;
            delete parsed.speed_legacy;
            delete parsed.boost;
            delete parsed.hue;
            localStorage.setItem(PERSIST_KEY, JSON.stringify(parsed));
          }
        }
      }
    } catch (e) { /* ignore */ }

    /* ======================================================================
     * 共享常量与纯函数
     * ==================================================================== */

    /** 真实恒星色温：白、蓝白、暖白、金黄、橙、红。 */
    const TINTS = ['255,250,242', '205,220,255', '255,241,214', '255,224,168', '255,196,148', '255,166,140'];

    /** 天幕星点的量化样式（带内微星 0-3，全天恒星 4+）。 */
    const DOT_STYLES = [];
    (function () {
      const bandA = [0.08, 0.14, 0.2, 0.28];
      for (let i = 0; i < 4; i++) DOT_STYLES.push(`rgba(235,232,225,${bandA[i]})`);
      const magA = [0.15, 0.35, 0.55, 0.8];
      for (let t = 0; t < 6; t++) for (let a = 0; a < 4; a++) DOT_STYLES.push(`rgba(${TINTS[t]},${magA[a]})`);
    })();

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function pickTint() {
      const r = Math.random();
      if (r < 0.5) return 0;
      if (r < 0.65) return 1;
      if (r < 0.8) return 2;
      if (r < 0.9) return 3;
      if (r < 0.96) return 4;
      return 5;
    }

    /** 整周期正弦银河带：bandYFor(a,p,w,0) === bandYFor(a,p,w,w)，环绕天然无缝。 */
    function bandYFor(amp, phase, w, x) {
      return amp * Math.sin((x / w) * 6.283185307179586 + phase);
    }

    /** 相机正交基（前/右/上），yaw 任意、pitch ∈ [-π/2, π/2]。 */
    function buildBasis(yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const f = [sy * cp, sp, cy * cp];
      const r = [cy, 0, -sy];
      const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
      return { f, r, u };
    }

    /** 随机星座：4-8 星的随机链 + 偶发分叉，每个星域不同。 */
    function makeConstellations() {
      const list = [];
      const count = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const n = 4 + Math.floor(Math.random() * 5);
        const pts = [], edges = [];
        let x = 0.3 + Math.random() * 0.4, y = 0.3 + Math.random() * 0.4;
        pts.push([x, y]);
        for (let p = 1; p < n; p++) {
          const ang = Math.random() * Math.PI * 2;
          const step = 0.14 + Math.random() * 0.16;
          x = clamp(x + Math.cos(ang) * step, 0.02, 0.98);
          y = clamp(y + Math.sin(ang) * step, 0.02, 0.98);
          pts.push([x, y]);
          edges.push([p - 1, p]);
          if (Math.random() < 0.18 && pts.length < n + 2) {
            const bAng = Math.random() * Math.PI * 2;
            pts.push([clamp(x + Math.cos(bAng) * (0.1 + Math.random() * 0.12), 0.02, 0.98),
                      clamp(y + Math.sin(bAng) * (0.1 + Math.random() * 0.12), 0.02, 0.98)]);
            edges.push([p, pts.length - 1]);
          }
        }
        const br = pts.map(() => 0.55 + Math.random() * 0.4);
        const hot = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < hot; k++) br[Math.floor(Math.random() * br.length)] = 0.95;
        const ti = pts.map(() => (Math.random() < 0.7 ? 0 : pickTint()));
        list.push({
          fx: 0.05 + Math.random() * 0.75, fy: 0.08 + Math.random() * 0.62,
          fw: 0.09 + Math.random() * 0.09, fh: 0.12 + Math.random() * 0.14,
          pts, edges, br, ti,
        });
      }
      return list;
    }

    /* ======================================================================
     * 星空引擎（实例闭包状态；全局背景一个实例常驻）
     * ==================================================================== */

    /**
     * @param {HTMLElement} root 引擎宿主（引擎在其内创建画布层）
     * @param {object} opts
     *   interactive  指针/键盘自由视角（外观背景固定 false）
     *   hud          座舱准星与舷窗括框
     *   autoDrift    自动偏航漂移 rad/s
     *   fpsCap       帧率上限（0 = 不限）
     *   density      穿越层恒星数
     *   speed/boost  固定航速/跃迁
     * @returns {{ dispose(): void }}
     */
    function createSpaceEngine(root, opts) {
      opts = opts || {};
      const interactive = opts.interactive !== false;
      const showHud = opts.hud !== false;
      const autoDrift = opts.autoDrift || 0;
      const fpsCap = opts.fpsCap || 0;
      const density = Math.round(clamp(opts.density || 1000, 50, 4000));

      const Z_FAR = 1.6, Z_NEAR = 0.03, SPREAD = 1.05;
      const YAW_RATE = 1.6, PITCH_RATE = 1.15, PITCH_MAX = 1.48;
      const widths = [0.7, 1.4, 2.4];
      const DOT_R = [0.6, 1.0, 1.7];
      const alphaTable = [0.14, 0.34, 0.55, 0.8];
      const NB = 72; // 6 色 × 3 尺寸 × 4 亮度

      const bucketStyle = [];
      for (let ci = 0; ci < 6; ci++)
        for (let wb = 0; wb < 3; wb++)
          for (let ab = 0; ab < 4; ab++)
            bucketStyle[(ci * 3 + wb) * 4 + ab] = `rgba(${TINTS[ci]},${alphaTable[ab]})`;
      const lineBuckets = [], dotBuckets = [];
      for (let i = 0; i < NB; i++) { lineBuckets.push([]); dotBuckets.push([]); }
      const coreDots = [];

      let reducedMotion = false;
      try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 无障碍探测失败按常规模拟 */ }

      /* ---------- 画布层 ---------- */
      const skyCanvasEl = document.createElement('canvas');
      const canvas = document.createElement('canvas');
      skyCanvasEl.className = canvas.className = 'sbg-cv';
      root.appendChild(skyCanvasEl);
      root.appendChild(canvas);
      const ctxSky = skyCanvasEl.getContext('2d');
      const ctx = canvas.getContext('2d');
      let hudCanvasEl = null, ctxHud = null;
      if (showHud) {
        hudCanvasEl = document.createElement('canvas');
        hudCanvasEl.className = 'sbg-cv';
        root.appendChild(hudCanvasEl);
        ctxHud = hudCanvasEl.getContext('2d');
      }

      /* ---------- 状态 ---------- */
      let W = 0, H = 0;
      let sky = null, skyNext = null, skyTrans = 0, transStartT = 0, nextSectorAt = 0;
      let vig = null;
      let skyRebuildPending = false, lastSkyBuildAt = 0, lastSkyKey = '';
      const cam = { yaw: Math.random() * 6.2832, pitch: 0 };
      const steer = { x: 0, y: 0 }, steerTarget = { x: 0, y: 0 }, kbOffset = { x: 0, y: 0 };
      const keys = {};
      let boostEase = 0, skyZoom = 0;
      let cancelled = false, rafId = 0, lastT = 0, lastDrawT = 0;
      const stars = [];
      const skyFillJobs = [];
      let meteor = null, nextMeteorAt = 6000;
      let planetSprites = null;
      const flyby = { active: false, x: 0, y: 0, z: 0, sprite: null, r: 0.2, nextAt: 9000 };

      function newStar(randomZ) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * SPREAD;
        return {
          x: Math.cos(ang) * r, y: Math.sin(ang) * r,
          z: randomZ ? Z_NEAR + Math.random() * (Z_FAR - Z_NEAR) : Z_FAR - Math.random() * 0.1,
          px: NaN, py: NaN,
          ci: pickTint(),
          m: Math.pow(Math.random(), 2.2),
          tw: Math.random() * 6.2832,
        };
      }
      while (stars.length < density) stars.push(newStar(true));

      /* ---------- 天体绘制 ---------- */

      function drawPlanetBody(c, x, y, r, type) {
        const palettes = [
          ['255,228,185', '212,158,108', '108,72,50'],
          ['255,195,155', '208,105,75', '82,40,36'],
          ['225,242,255', '150,186,232', '66,96,148'],
          ['255,236,200', '202,172,132', '108,84,64'],
        ];
        const p = palettes[type] || palettes[0];
        const g = c.createRadialGradient(x - r * 0.42, y - r * 0.42, r * 0.12, x, y, r * 1.02);
        g.addColorStop(0, `rgba(${p[0]},0.96)`);
        g.addColorStop(0.55, `rgba(${p[1]},0.94)`);
        g.addColorStop(1, `rgba(${p[2]},0.94)`);
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
        if (type === 0 || type === 3) {
          c.save();
          c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.clip();
          c.globalAlpha = 0.16;
          for (let b = 0; b < 4; b++) {
            c.fillStyle = b % 2 ? 'rgb(90,60,40)' : 'rgb(255,240,220)';
            c.fillRect(x - r, y - r * 0.6 + b * r * 0.32, r * 2, r * 0.15);
          }
          c.restore();
        }
        if (type === 3) {
          c.save();
          c.translate(x, y);
          c.rotate(-0.35);
          c.strokeStyle = 'rgba(230,216,186,0.5)';
          c.lineWidth = Math.max(1.5, r * 0.15);
          c.beginPath(); c.ellipse(0, 0, r * 1.8, r * 0.52, 0, 0, 6.2832); c.stroke();
          c.strokeStyle = 'rgba(230,216,186,0.22)';
          c.lineWidth = Math.max(1, r * 0.07);
          c.beginPath(); c.ellipse(0, 0, r * 2.1, r * 0.64, 0, 0, 6.2832); c.stroke();
          c.restore();
        }
      }

      function buildPlanetSprites() {
        planetSprites = [];
        for (let t = 0; t < 3; t++) {
          const s = document.createElement('canvas');
          s.width = 360; s.height = 260;
          drawPlanetBody(s.getContext('2d'), 180, 130, 70, t === 2 ? 3 : t);
          planetSprites.push(s);
        }
      }

      function drawNebula(c, x, y, r, hue, k) {
        const blobs = 4 + Math.floor(Math.random() * 3);
        const dir = Math.random() * Math.PI * 2;
        for (let i = 0; i < blobs; i++) {
          const bx = x + Math.cos(dir + i * 0.9) * r * 0.35 * Math.random();
          const by = y + Math.sin(dir + i * 1.1) * r * 0.3 * Math.random();
          const br = r * (0.35 + Math.random() * 0.45);
          const a = (0.05 + Math.random() * 0.05) * k;
          const g = c.createRadialGradient(bx, by, 0, bx, by, br);
          g.addColorStop(0, `rgba(${hue},${a.toFixed(3)})`);
          g.addColorStop(0.6, `rgba(${hue},${(a * 0.45).toFixed(3)})`);
          g.addColorStop(1, `rgba(${hue},0)`);
          c.fillStyle = g;
          c.fillRect(bx - br, by - br, br * 2, br * 2);
        }
        for (let d = 0; d < 2; d++) {
          const dx = x + (Math.random() - 0.5) * r * 0.6, dy = y + (Math.random() - 0.5) * r * 0.5;
          const dr = r * (0.15 + Math.random() * 0.2);
          const g2 = c.createRadialGradient(dx, dy, 0, dx, dy, dr);
          g2.addColorStop(0, 'rgba(5,6,12,0.4)');
          g2.addColorStop(1, 'rgba(5,6,12,0)');
          c.fillStyle = g2;
          c.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
        }
      }

      function drawGalaxy(c, x, y, r, tilt, k) {
        c.save();
        c.translate(x, y);
        c.rotate(tilt);
        c.scale(2.3, 1);
        const layers = [
          [r, `rgba(255,243,220,${(0.34 * k).toFixed(3)})`],
          [r * 1.9, `rgba(210,220,250,${(0.15 * k).toFixed(3)})`],
          [r * 3.1, `rgba(185,200,245,${(0.07 * k).toFixed(3)})`],
        ];
        for (let i = 0; i < layers.length; i++) {
          const g = c.createRadialGradient(0, 0, 0, 0, 0, layers[i][0]);
          g.addColorStop(0, layers[i][1]);
          g.addColorStop(1, 'rgba(160,180,240,0)');
          c.fillStyle = g;
          c.beginPath();
          c.arc(0, 0, layers[i][0], 0, 6.2832);
          c.fill();
        }
        c.restore();
      }

      /** 水平环绕无缝：越界内容在对侧补画。 */
      function wrapDraw(c, skyW, x, y, r, fn) {
        fn(c, x, y);
        if (x - r < 0) fn(c, x + skyW, y);
        if (x + r > skyW) fn(c, x - skyW, y);
      }

      /** 预渲染精灵（保证对侧补画与本体逐像素一致）。 */
      function makeSprite(w, h, fn) {
        const s = document.createElement('canvas');
        s.width = Math.max(2, Math.ceil(w * 0.6));
        s.height = Math.max(2, Math.ceil(h * 0.6));
        const c2 = s.getContext('2d');
        c2.scale(0.6, 0.6);
        fn(c2);
        return { cv: s, w, h };
      }

      function drawConstellationAt(c, ox, oy, K, bw, bh) {
        c.strokeStyle = 'rgba(150,170,210,0.28)';
        c.lineWidth = 0.9;
        c.beginPath();
        for (let e = 0; e < K.edges.length; e++) {
          const a = K.pts[K.edges[e][0]], b = K.pts[K.edges[e][1]];
          c.moveTo(ox + a[0] * bw, oy + a[1] * bh);
          c.lineTo(ox + b[0] * bw, oy + b[1] * bh);
        }
        c.stroke();
        for (let p = 0; p < K.pts.length; p++) {
          const px = ox + K.pts[p][0] * bw, py = oy + K.pts[p][1] * bh;
          const br = K.br[p];
          const tint = TINTS[K.ti[p] || 0];
          if (br >= 0.9) {
            const g = c.createRadialGradient(px, py, 0, px, py, 6 + br * 6);
            g.addColorStop(0, `rgba(${tint},${(0.22 * br).toFixed(3)})`);
            g.addColorStop(1, `rgba(${tint},0)`);
            c.fillStyle = g;
            c.fillRect(px - 14, py - 14, 28, 28);
          }
          c.fillStyle = `rgba(${tint},${(0.55 + 0.4 * br).toFixed(3)})`;
          c.beginPath();
          c.arc(px, py, 0.9 + br * 1.1, 0, 6.2832);
          c.fill();
        }
      }

      function drawConstellations(c, skyW, skyH, list) {
        for (let i = 0; i < list.length; i++) {
          const K = list[i];
          const bw = K.fw * skyW, bh = K.fh * skyH;
          const ox = K.fx * skyW, oy = K.fy * skyH;
          wrapDraw(c, skyW, ox + bw / 2, oy + bh / 2, Math.max(bw, bh) / 2 + 16, (cc, x2, y2) => {
            drawConstellationAt(cc, x2 - bw / 2, y2 - bh / 2, K, bw, bh);
          });
        }
      }

      /** 每个星域随机生成的天幕（0.6 倍分辨率绘制，水平无缝环绕）。 */
      function buildSkyCanvas() {
        const skyW = Math.max(1400, Math.ceil(W * 1.7));
        const skyH = Math.max(1000, Math.ceil(H * 2.6));
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(skyW * 0.6); cv.height = Math.ceil(skyH * 0.6);
        const c = cv.getContext('2d');
        c.scale(0.6, 0.6);

        // 银河带：整周期正弦弯曲，环绕无缝
        const bandPairs = [['235,228,210', '205,215,240'], ['225,215,235', '190,210,250'], ['235,222,200', '210,200,230']];
        const pair = bandPairs[Math.floor(Math.random() * bandPairs.length)];
        const amp = skyH * (0.05 + Math.random() * 0.07);
        const phase = Math.random() * 6.2832;
        const bandY = (x) => skyH * 0.5 + bandYFor(amp, phase, skyW, x);
        for (let i = 0; i < 8; i++) {
          const bx0 = ((i + 0.5) / 8) * skyW;
          const px = bx0 + (Math.random() - 0.5) * skyW * 0.05;
          const py = bandY(bx0) + (Math.random() - 0.5) * skyH * 0.03;
          const r = skyH * (0.18 + Math.random() * 0.1);
          const col = Math.random() < 0.5 ? pair[0] : pair[1];
          wrapDraw(c, skyW, px, py, r, (cc, x2, y2) => {
            const g = cc.createRadialGradient(x2, y2, 0, x2, y2, r);
            g.addColorStop(0, `rgba(${col},0.09)`);
            g.addColorStop(0.55, `rgba(${col},0.04)`);
            g.addColorStop(1, `rgba(${col},0)`);
            cc.fillStyle = g;
            cc.fillRect(x2 - r, y2 - r, r * 2, r * 2);
          });
        }
        // 尘埃暗纹（沿银河带）
        for (let d = 0; d < 12; d++) {
          const dxx = Math.random() * skyW;
          const dyy = bandY(dxx) + (Math.random() - 0.5) * skyH * 0.07;
          const dr = skyH * (0.05 + Math.random() * 0.09);
          wrapDraw(c, skyW, dxx, dyy, dr, (cc, x2, y2) => {
            const g2 = cc.createRadialGradient(x2, y2, 0, x2, y2, dr);
            g2.addColorStop(0, 'rgba(6,7,12,0.5)');
            g2.addColorStop(1, 'rgba(6,7,12,0)');
            cc.fillStyle = g2;
            cc.fillRect(x2 - dr, y2 - dr, dr * 2, dr * 2);
          });
        }
        // 随机星云（不规则团块）
        const nebHues = ['255,110,150', '70,180,190', '140,110,220', '230,140,90'];
        const nebN = 1 + Math.floor(Math.random() * 3);
        for (let nb = 0; nb < nebN; nb++) {
          const nbr = skyH * (0.06 + Math.random() * 0.08);
          const nbHue = nebHues[Math.floor(Math.random() * nebHues.length)];
          const nbK = 0.7 + Math.random() * 0.5;
          const nbSize = Math.ceil(nbr * 2.6);
          const nbSpr = makeSprite(nbSize, nbSize, (cc) => drawNebula(cc, nbSize / 2, nbSize / 2, nbr, nbHue, nbK));
          const nbx = skyW * (0.08 + Math.random() * 0.84), nby = skyH * (0.08 + Math.random() * 0.84);
          wrapDraw(c, skyW, nbx, nby, nbSize / 2, (cc, x2, y2) => {
            cc.drawImage(nbSpr.cv, x2 - nbSpr.w / 2, y2 - nbSpr.h / 2, nbSpr.w, nbSpr.h);
          });
        }
        // 星点收集（延后分帧绘制；边缘点对侧补画）
        const dots = [];
        function pushDot(x, y, sz, st) {
          dots.push(x, y, sz, st);
          if (x < 2) dots.push(x + skyW, y, sz, st);
          else if (x > skyW - 2) dots.push(x - skyW, y, sz, st);
        }
        const bandStars = Math.round((skyW * skyH) / 240);
        for (let b = 0; b < bandStars; b++) {
          const sx = Math.random() * skyW;
          const gauss = (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
          const sy = bandY(sx) + gauss * skyH * 0.075;
          if (sy < -4 || sy > skyH + 4) continue;
          pushDot(sx, sy, Math.random() < 0.85 ? 0.6 : 1.0, Math.floor(Math.random() * 4));
        }
        const fieldStars = Math.round((skyW * skyH) / 2000);
        for (let f = 0; f < fieldStars; f++) {
          const fx = Math.random() * skyW, fy = Math.random() * skyH;
          const mag = Math.pow(Math.random(), 2.4);
          pushDot(fx, fy, 0.5 + mag * 1.1, 4 + pickTint() * 4 + Math.min(3, Math.floor(mag * 4)));
        }
        // 亮星衍射十字
        for (let s2 = 0; s2 < 7; s2++) {
          const gx = Math.random() * skyW, gy = Math.random() * skyH;
          const tint2 = TINTS[pickTint()];
          const r2 = 1.1 + Math.random() * 1.2;
          const L = r2 * (5 + Math.random() * 4);
          wrapDraw(c, skyW, gx, gy, L, (cc, x2, y2) => {
            cc.fillStyle = `rgba(${tint2},0.95)`;
            cc.beginPath(); cc.arc(x2, y2, r2, 0, 6.2832); cc.fill();
            cc.strokeStyle = `rgba(${tint2},0.3)`;
            cc.lineWidth = 0.8;
            cc.beginPath();
            cc.moveTo(x2 - L, y2); cc.lineTo(x2 + L, y2);
            cc.moveTo(x2, y2 - L); cc.lineTo(x2, y2 + L);
            cc.stroke();
          });
        }
        // 星系
        const gal = 2 + Math.floor(Math.random() * 3);
        for (let gl = 0; gl < gal; gl++) {
          const ggr = skyH * (0.012 + Math.random() * 0.024);
          const ggx = skyW * (0.1 + Math.random() * 0.8), ggy = skyH * (0.1 + Math.random() * 0.8);
          const ggt = (Math.random() - 0.5) * 1.6, ggk = 0.5 + Math.random() * 0.5;
          wrapDraw(c, skyW, ggx, ggy, ggr * 8, (cc, x2, y2) => drawGalaxy(cc, x2, y2, ggr, ggt, ggk));
        }
        if (Math.random() < 0.35) {
          const bgr = skyH * (0.03 + Math.random() * 0.02);
          const bgx = skyW * (0.2 + Math.random() * 0.6), bgy = skyH * (0.2 + Math.random() * 0.6);
          const bgt = (Math.random() - 0.5) * 1.2;
          wrapDraw(c, skyW, bgx, bgy, bgr * 8, (cc, x2, y2) => drawGalaxy(cc, x2, y2, bgr, bgt, 1));
        }
        // 疏散星团（六成星域）
        if (Math.random() < 0.6) {
          const clR = skyH * 0.04;
          const clSize = Math.ceil(clR * 2.4);
          const clSpr = makeSprite(clSize, clSize, (cc) => {
            for (let q = 0; q < 46; q++) {
              const a2 = Math.random() * 6.2832;
              const rr2 = Math.pow(Math.random(), 1.6) * clR * 0.85;
              cc.fillStyle = `rgba(215,225,250,${(0.15 + Math.random() * 0.4).toFixed(3)})`;
              cc.beginPath();
              cc.arc(clSize / 2 + Math.cos(a2) * rr2, clSize / 2 + Math.sin(a2) * rr2 * 0.8, 0.4 + Math.random() * 0.8, 0, 6.2832);
              cc.fill();
            }
          });
          const clx = skyW * (0.15 + Math.random() * 0.7), cly = skyH * (0.15 + Math.random() * 0.7);
          wrapDraw(c, skyW, clx, cly, clSize / 2, (cc, x2, y2) => {
            cc.drawImage(clSpr.cv, x2 - clSpr.w / 2, y2 - clSpr.h / 2, clSpr.w, clSpr.h);
          });
        }
        // 远景行星（0-2 颗，含带环）
        const pl = Math.floor(Math.random() * 3);
        for (let pl2 = 0; pl2 < pl; pl2++) {
          const plr = H * (0.025 + Math.random() * 0.03);
          const pt = Math.random();
          const ptype = pt < 0.2 ? 3 : pt < 0.55 ? 0 : pt < 0.85 ? 1 : 2;
          const plSpr = makeSprite(Math.ceil(plr * 4.4), Math.ceil(plr * 3), (cc) => drawPlanetBody(cc, plr * 2.2, plr * 1.5, plr, ptype));
          const plx = skyW * (0.1 + Math.random() * 0.8), ply = skyH * (0.1 + Math.random() * 0.8);
          wrapDraw(c, skyW, plx, ply, Math.max(plSpr.w, plSpr.h) / 2, (cc, x2, y2) => {
            cc.drawImage(plSpr.cv, x2 - plSpr.w / 2, y2 - plSpr.h / 2, plSpr.w, plSpr.h);
          });
        }
        drawConstellations(c, skyW, skyH, makeConstellations());
        return { cv, c, w: skyW, h: skyH, dots };
      }

      function newSky() {
        const s = buildSkyCanvas();
        skyFillJobs.push({ c: s.c, dots: s.dots, i: 0 });
        return s;
      }

      function buildVignette() {
        vig = document.createElement('canvas');
        vig.width = Math.max(2, Math.ceil(W));
        vig.height = Math.max(2, Math.ceil(H));
        const c = vig.getContext('2d');
        const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
        g.addColorStop(0, 'rgba(2,3,8,0)');
        g.addColorStop(1, 'rgba(2,3,8,0.5)');
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        // 舷窗四角括框
        c.strokeStyle = 'rgba(160,190,230,0.28)';
        c.lineWidth = 1;
        const o = 14, L = 22;
        c.beginPath();
        c.moveTo(o, o + L); c.lineTo(o, o); c.lineTo(o + L, o);
        c.moveTo(W - o - L, o); c.lineTo(W - o, o); c.lineTo(W - o, o + L);
        c.moveTo(o, H - o - L); c.lineTo(o, H - o); c.lineTo(o + L, H - o);
        c.moveTo(W - o - L, H - o); c.lineTo(W - o, H - o); c.lineTo(W - o, H - o - L);
        c.stroke();
        lastSkyKey = '';
      }

      /** 天幕随偏航/俯仰旋转；随速度整体缩放；星域切换交叉淡入。 */
      function drawSkyFrame() {
        const slw = sky.w, slh = sky.h;
        const zs = 1 + skyZoom;
        ctxSky.globalCompositeOperation = 'source-over';
        ctxSky.fillStyle = '#04060e';
        ctxSky.fillRect(0, 0, W, H);
        const cx = W / 2, cy = H / 2;
        const xo = -(cam.yaw / 6.2832) * slw;
        const vppr = ((slh - H) / 2) / 1.5708;
        const yo = (H - slh) / 2 + cam.pitch * vppr;
        const x0 = ((xo % slw) + slw) % slw - slw;
        const zx0 = cx + (x0 - cx) * zs;
        const zy0 = cy + (yo - cy) * zs;
        const zw = slw * zs, zh = slh * zs;
        ctxSky.drawImage(sky.cv, zx0, zy0, zw, zh);
        ctxSky.drawImage(sky.cv, zx0 + zw, zy0, zw, zh);
        if (skyNext) {
          ctxSky.globalAlpha = Math.min(1, skyTrans);
          ctxSky.drawImage(skyNext.cv, zx0, zy0, zw, zh);
          ctxSky.drawImage(skyNext.cv, zx0 + zw, zy0, zw, zh);
          ctxSky.globalAlpha = 1;
        }
        if (vig) ctxSky.drawImage(vig, 0, 0, W, H);
      }

      function resize() {
        const rect = root.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = Math.max(1, rect.width); H = Math.max(1, rect.height);
        skyCanvasEl.width = Math.round(W * dpr); skyCanvasEl.height = Math.round(H * dpr);
        ctxSky.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (hudCanvasEl) {
          hudCanvasEl.width = Math.round(W * dpr); hudCanvasEl.height = Math.round(H * dpr);
          ctxHud.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        skyRebuildPending = true;
        skyNext = null;
        nextSectorAt = performance.now() + 12000;
      }

      /* ---------- 交互（仅 interactive 实例） ---------- */

      function deadzone(v) {
        const a = Math.abs(v);
        if (a < 0.07) return 0;
        return (v - (v < 0 ? -0.07 : 0.07)) / 0.93;
      }
      function pointSteer(e) {
        const r = root.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        if (py > H - Math.max(70, H * 0.15)) { steerTarget.x = 0; steerTarget.y = 0; return; }
        steerTarget.x = deadzone(clamp((px - W / 2) / (W / 2), -1, 1));
        steerTarget.y = deadzone(clamp((py - H / 2) / (H / 2), -1, 1));
      }
      function onPointerMove(e) { pointSteer(e); }
      function onPointerDown(e) {
        if (e.pointerType !== 'mouse') { try { root.setPointerCapture(e.pointerId); } catch (err) { /* 捕获失败按普通移动处理 */ } }
        pointSteer(e);
      }
      function onPointerLeave(e) {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        steerTarget.x = 0; steerTarget.y = 0;
      }
      function onKeyDown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && e.target.closest && e.target.closest('button,input,select,textarea,[contenteditable]')) return;
        if (e.key === 'ArrowLeft') { keys.l = true; e.preventDefault(); }
        else if (e.key === 'ArrowRight') { keys.r = true; e.preventDefault(); }
        else if (e.key === 'ArrowUp') { keys.u = true; e.preventDefault(); }
        else if (e.key === 'ArrowDown') { keys.d = true; e.preventDefault(); }
      }
      function onKeyUp(e) {
        if (e.key === 'ArrowLeft') keys.l = false;
        else if (e.key === 'ArrowRight') keys.r = false;
        else if (e.key === 'ArrowUp') keys.u = false;
        else if (e.key === 'ArrowDown') keys.d = false;
      }
      function onContextMenu(e) { e.preventDefault(); }
      function onVisibility() {
        if (document.hidden || cancelled) return;
        const now = performance.now();
        if (nextSectorAt < now) nextSectorAt = now + 6000;
        if (flyby.nextAt < now) flyby.nextAt = now + 8000;
        if (nextMeteorAt < now) nextMeteorAt = now + 4000;
      }

      /* ---------- 主循环 ---------- */

      function frame(t) {
        if (cancelled) return;
        rafId = requestAnimationFrame(frame);
        if (fpsCap > 0 && t - lastDrawT < 1000 / fpsCap - 2) return;
        lastDrawT = t;
        const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
        lastT = t;
        if (!W || !H || document.hidden) return;

        // 尺寸变化后重建天幕（节流；无 hud 模式仅重建天幕）
        if (!sky || (skyRebuildPending && t - lastSkyBuildAt > 200)) {
          skyFillJobs.length = 0;
          sky = newSky();
          if (showHud) buildVignette();
          skyRebuildPending = false;
          lastSkyBuildAt = t;
        }

        // 星域演化
        if (!skyNext && t >= nextSectorAt) {
          skyNext = newSky();
          transStartT = t;
          skyTrans = 0;
        }
        if (skyNext) {
          skyTrans = (t - transStartT) / 2500;
          if (skyTrans >= 1) {
            sky = skyNext; skyNext = null; lastSkyKey = '';
            nextSectorAt = t + 16000 + Math.random() * 12000;
          }
        }

        // 分帧填充天幕星点
        if (skyFillJobs.length) {
          const job = skyFillJobs[0];
          const jd = job.dots, jc = job.c;
          const jEnd = Math.min(jd.length, job.i + 9600);
          for (let ji = job.i; ji < jEnd; ji += 4) {
            const jst = jd[ji + 3];
            jc.fillStyle = DOT_STYLES[jst];
            if (jst < 4) {
              jc.fillRect(jd[ji], jd[ji + 1], jd[ji + 2], jd[ji + 2]);
            } else {
              jc.beginPath();
              jc.arc(jd[ji], jd[ji + 1], jd[ji + 2], 0, 6.2832);
              jc.fill();
            }
          }
          job.i = jEnd;
          if (job.i >= jd.length) skyFillJobs.shift();
        }

        // 航速 / 缩放脉动（外观背景为恒速巡航，无跃迁）
        const speedNow = typeof opts.getSpeed === 'function' ? clamp(opts.getSpeed() || 0.4, 0.2, 3) : (opts.speed || 0.4);
        const bt = 0;
        const spdC = speedNow * (1 + 2.8 * boostEase);
        const zoomTarget = Math.min(0.18, 0.05 * spdC) + (reducedMotion ? 0 : boostEase * 0.03 * Math.sin(t * 0.0012));
        skyZoom += (zoomTarget - skyZoom) * Math.min(1, dt * 1.4);

        // 视角：自由转向（interactive）或环境漂移（外观背景）
        const kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
        const ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
        if (kx || ky) {
          kbOffset.x = clamp(kbOffset.x + kx * dt * 1.6, -1, 1);
          kbOffset.y = clamp(kbOffset.y + ky * dt * 1.6, -1, 1);
        } else {
          const decay = Math.pow(0.12, dt);
          kbOffset.x *= decay; kbOffset.y *= decay;
        }
        const tx = clamp(steerTarget.x + kbOffset.x, -1, 1);
        const ty = clamp(steerTarget.y + kbOffset.y, -1, 1);
        const st = Math.min(1, dt * 6.5);
        steer.x += (tx - steer.x) * st;
        steer.y += (ty - steer.y) * st;
        cam.yaw += steer.x * YAW_RATE * dt + (reducedMotion ? 0 : autoDrift * dt);
        cam.pitch = clamp(cam.pitch - steer.y * PITCH_RATE * dt, -PITCH_MAX, PITCH_MAX);

        const { f, r, u } = buildBasis(cam.yaw, cam.pitch);

        // 天幕重绘（旋转 / 过渡 / 缩放期间）
        if (skyNext) {
          drawSkyFrame();
        } else {
          const skyKey = `${W}x${H}:${Math.round(cam.yaw * 60)},${Math.round(cam.pitch * 60)},${Math.round(skyZoom * 400)}`;
          if (skyKey !== lastSkyKey) { drawSkyFrame(); lastSkyKey = skyKey; }
        }

        const minDim = Math.min(W, H);
        const cx = W / 2, cy = H / 2;
        const focal = minDim * (0.92 - 0.2 * boostEase);
        const f2 = focal * (1 + 0.08 * boostEase);
        const v = speedNow * (1 + 2.8 * boostEase) * 0.9;
        const mv = v * dt;

        for (let i = 0; i < NB; i++) { lineBuckets[i].length = 0; dotBuckets[i].length = 0; }
        coreDots.length = 0;

        const m = 40;
        for (let i2 = 0; i2 < stars.length; i2++) {
          const s = stars[i2];
          s.x -= f[0] * mv; s.y -= f[1] * mv; s.z -= f[2] * mv;
          let cz = s.x * f[0] + s.y * f[1] + s.z * f[2];
          if (cz <= Z_NEAR) {
            const ang = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * SPREAD;
            const dz = Z_FAR - Math.random() * 0.15;
            const ox2 = Math.cos(ang) * rad, oy2 = Math.sin(ang) * rad;
            s.x = f[0] * dz + r[0] * ox2 + u[0] * oy2;
            s.y = f[1] * dz + r[1] * ox2 + u[1] * oy2;
            s.z = f[2] * dz + r[2] * ox2 + u[2] * oy2;
            cz = dz;
            s.px = NaN; s.py = NaN;
          }
          const cxr = s.x * r[0] + s.y * r[1] + s.z * r[2];
          const cyu = s.x * u[0] + s.y * u[1] + s.z * u[2];
          const x = cx + (cxr / cz) * f2;
          const y = cy - (cyu / cz) * f2;
          if (x < -m || x > W + m || y < -m || y > H + m) { s.px = x; s.py = y; continue; }
          if (isFinite(s.px)) {
            const wb = cz > 0.55 ? 0 : cz > 0.16 ? 1 : 2;
            const fade = Math.min(1, Math.max(0, (Z_FAR - cz) / (Z_FAR - 0.55)));
            let eff = fade * (0.35 + 0.65 * s.m);
            if (!reducedMotion) eff *= 1 + 0.07 * Math.sin(t * 0.004 + s.tw);
            const ab = Math.min(3, Math.floor(eff * 4));
            const key = (s.ci * 3 + wb) * 4 + ab;
            const ddx = x - s.px, ddy = y - s.py;
            if (ddx * ddx + ddy * ddy < 2.25) {
              dotBuckets[key].push(x, y, DOT_R[wb] * (0.65 + 0.7 * s.m));
            } else {
              lineBuckets[key].push(s.px, s.py, x, y);
            }
          }
          s.px = x; s.py = y;
          if (cz < 0.14) coreDots.push(x, y, cz);
        }

        // 1) 运动模糊
        const fa = reducedMotion ? 0.75 : 0.38 - 0.16 * boostEase;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${fa})`;
        ctx.fillRect(0, 0, W, H);

        // 2) 掠过的大行星
        if (!flyby.active && t >= flyby.nextAt && planetSprites) {
          const fAng = Math.random() * 6.2832;
          const fLat = 0.55 + Math.random() * 0.8;
          const fOx = Math.cos(fAng) * fLat, fOy = Math.sin(fAng) * fLat;
          const fDz = Z_FAR * 1.35;
          flyby.x = f[0] * fDz + r[0] * fOx + u[0] * fOy;
          flyby.y = f[1] * fDz + r[1] * fOx + u[1] * fOy;
          flyby.z = f[2] * fDz + r[2] * fOx + u[2] * fOy;
          flyby.sprite = planetSprites[Math.floor(Math.random() * planetSprites.length)];
          flyby.r = 0.15 + Math.random() * 0.13;
          flyby.active = true;
        }
        if (flyby.active) {
          flyby.x -= f[0] * mv; flyby.y -= f[1] * mv; flyby.z -= f[2] * mv;
          const fcz = flyby.x * f[0] + flyby.y * f[1] + flyby.z * f[2];
          if (fcz < 0.06) {
            flyby.active = false;
            flyby.nextAt = t + 25000 + Math.random() * 35000;
          } else {
            const fcx = flyby.x * r[0] + flyby.y * r[1] + flyby.z * r[2];
            const fcy = flyby.x * u[0] + flyby.y * u[1] + flyby.z * u[2];
            const pr = (f2 * flyby.r) / fcz;
            const nx2 = fcx / fcz, ny2 = fcy / fcz;
            if (Math.abs(nx2) < 1.7 && Math.abs(ny2) < 1.3 && pr < H * 0.8) {
              const ppx = cx + nx2 * f2, ppy = cy - ny2 * f2;
              const psc = pr / 70;
              const farFade = fcz > 1.1 ? Math.min(1, (Z_FAR * 1.35 - fcz) / 0.45) : 1;
              const nearFade = pr > H * 0.45 ? Math.max(0, (H * 0.8 - pr) / (H * 0.35)) : 1;
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = farFade * nearFade;
              ctx.drawImage(flyby.sprite, ppx - 180 * psc, ppy - 130 * psc, 360 * psc, 260 * psc);
              ctx.globalAlpha = 1;
            }
          }
        }

        // 3) 星点与光轨
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let k = 0; k < NB; k++) {
          const dots = dotBuckets[k];
          if (dots.length) {
            ctx.fillStyle = bucketStyle[k];
            for (let q = 0; q < dots.length; q += 3) {
              const r3 = dots[q + 2];
              ctx.fillRect(dots[q] - r3, dots[q + 1] - r3, r3 * 2, r3 * 2);
            }
          }
          const segs = lineBuckets[k];
          if (segs.length) {
            ctx.strokeStyle = bucketStyle[k];
            ctx.lineWidth = widths[Math.floor(k / 4) % 3];
            ctx.beginPath();
            for (let q2 = 0; q2 < segs.length; q2 += 4) {
              ctx.moveTo(segs[q2], segs[q2 + 1]);
              ctx.lineTo(segs[q2 + 2], segs[q2 + 3]);
            }
            ctx.stroke();
          }
        }

        // 4) 近处恒星光核
        if (coreDots.length) {
          ctx.fillStyle = 'rgba(255,250,242,0.85)';
          for (let d2 = 0; d2 < coreDots.length; d2 += 3) {
            const cr = Math.min(3.2, (focal * 0.0026) / coreDots[d2 + 2]);
            ctx.beginPath();
            ctx.arc(coreDots[d2], coreDots[d2 + 1], cr, 0, 6.2832);
            ctx.fill();
          }
        }

        // 5) 流星
        if (!meteor && !reducedMotion && t >= nextMeteorAt) {
          const mAng = Math.random() * 6.2832;
          const mLen = 140 + Math.random() * 160;
          meteor = {
            x: W * (0.1 + Math.random() * 0.8), y: H * (0.05 + Math.random() * 0.55),
            dx: Math.cos(mAng) * mLen, dy: Math.sin(mAng) * mLen,
            t0: t, dur: 650 + Math.random() * 450,
          };
        }
        if (meteor) {
          const pm = (t - meteor.t0) / meteor.dur;
          if (pm >= 1) { meteor = null; nextMeteorAt = t + 5000 + Math.random() * 11000; }
          else {
            const mhx = meteor.x + meteor.dx * pm, mhy = meteor.y + meteor.dy * pm;
            const mAlpha = Math.sin(Math.PI * pm) * 0.6;
            ctx.strokeStyle = `rgba(255,250,240,${mAlpha.toFixed(3)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(mhx - meteor.dx * 0.22, mhy - meteor.dy * 0.22);
            ctx.lineTo(mhx, mhy);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,255,255,${(mAlpha * 0.9).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(mhx, mhy, 1.4, 0, 6.2832);
            ctx.fill();
          }
        }
      }

      /* ---------- 启动 / 释放 ---------- */

      buildPlanetSprites();
      resize();
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(root);
      } else {
        window.addEventListener('resize', resize);
      }
      sky = newSky();
      if (showHud) buildVignette();
      skyRebuildPending = false;
      nextSectorAt = performance.now() + 14000 + Math.random() * 10000;

      if (interactive) {
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointerleave', onPointerLeave);
        root.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
      }
      document.addEventListener('visibilitychange', onVisibility);
      rafId = requestAnimationFrame(frame);

      return {
        dispose() {
          cancelled = true;
          cancelAnimationFrame(rafId);
          if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
          if (interactive) {
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointerleave', onPointerLeave);
            root.removeEventListener('contextmenu', onContextMenu);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
          }
          document.removeEventListener('visibilitychange', onVisibility);
          skyCanvasEl.remove(); canvas.remove();
          if (hudCanvasEl) hudCanvasEl.remove();
        },
      };
    }

    /* ======================================================================
     * 外观集成：插件详情页专属板块 (plugins.detail.section) + 全局星空层 (overlay)
     * 注：不向侧边栏 (sidebar.panellist) 注册任何按钮，保持侧栏干净无杂物
     * ==================================================================== */

    /** 主题服务句柄（apply 内 ctx.inject(['theme']) 就绪后写入）。 */
    let themeApi = null;
    let boundDoc = null;
    let boundActions = null;

    const dict = {
      zh: {
        title: '深空背景',
        studioTitle: '深空背景控制中心',
        studioSubtitle: '全域通透宇宙视界 · 界面全透、毛玻璃磨砂与太空 HUD 全息文字保护',
        statusRunning: '星空运行中',
        statusDisabled: '背景已关闭',
        masterSwitch: '启用深空背景',
        masterSwitchDesc: '在整个应用底层渲染 360° 无缝流动银河、随机星座、带环行星与穿梭流星',
        transparencySection: '界面全透度与通透调节 (Surface Transparency)',
        transparencyDesc: '直接将界面各层背景置为全透以完整展现深空宇宙。数值越低越透，0% 为极致全透。',
        presetPure: '纯粹全景 (0%)',
        presetDeep: '深空通透 (25%)',
        presetBalanced: '毛玻璃适中 (45%)',
        presetSubtle: '轻透微澜 (75%)',
        sliderLabel: '界面表面不透明度',
        blurSection: '毛玻璃磨砂度 (Backdrop Blur)',
        blurDesc: '在前景卡片与底层星空之间形成磨砂柔化过渡，保证信息层级与立体质感。',
        blurNone: '无模糊 (0px)',
        blurSoft: '轻柔 (8px)',
        blurMedium: '经典 (12px)',
        blurDeep: '深度 (20px)',
        readabilitySection: '太空全息 HUD 文字防晕散与高对比度保护',
        readabilityDesc: '全透明模式下深邃星空成为主背景，智能算法自动提亮文字并增加微阴影，防止暗色字在黑夜星空下难以辨别。',
        autoContrast: '文字智能增亮与反转',
        autoContrastDesc: '在通透度较高时自动将正文、标题与边框增强为高对比度银白色',
        textShadow: '抗晕散双层文字轮廓阴影',
        textShadowDesc: '为文字边缘注入深色抗晕光分界线，无论明亮恒星或行星划过，字迹清晰立现',
        dynamicsSection: '天体动力学运行节奏',
        speedLabel: '漂移航速',
        speedSlow: '沉静缓速 (0.2x)',
        speedNormal: '自然流转 (0.4x)',
        speedFast: '快速巡航 (0.8x)',
        previewSection: '透光与文字辨识度实测预览',
        previewTitle: '标题：DeepSeek Harness 专业级会话',
        previewBody: '星汉灿烂，若出其里；日月之行，若出其中。在当前全景通透度与高对比度 HUD 保护下，正文无论在浅色还是深色星空背景上都具有卓越的可读性。',
        previewCode: 'const space = new CosmicBackdrop({ opacity: 0.0, blur: 12, hud: true });',
        resetDefaults: '恢复默认全透配置',
        // 项目全景说明文案
        projectOverviewTitle: '深空背景 · 项目全景说明与技术架构',
        projectOverviewSubtitle: '专为 DeepSeek Harness 打造的全域穿透宇宙视界引擎',
        cardPhilosophyTitle: '🌟 项目设计理念 (Design Philosophy)',
        cardPhilosophyDesc: '彻底打破传统软件封闭沉闷的纯黑/深灰死板界面，将整个 DSH 窗口化身为太空飞船的「全景舷窗」。通过全域穿透技术将各层阻挡背景一扫而空，让日常代码编写与智能交互轻盈地悬浮在浩瀚深邃的宇宙星空之中。',
        cardEngineTitle: '🌌 天体动力学引擎 (Celestial Engine)',
        cardEngineDesc: '• 360° 正弦无缝银河：采用 bandYFor 连续周期曲面算法，星际尘埃自然闭合无缝对接\n• 3D 正交投影星座：随机生成 4~8 节点星链与分支星群，随相机正交基三维旋转投影\n• 行星与星云：多层漫反射星云与掠过视界的带环气态巨行星\n• 瞬态高光流星：随机划破天际的高速流星轨迹引擎',
        cardHudTitle: '🛡️ 太空全息 HUD 文字防晕散 (HUD Readability)',
        cardHudDesc: '界面彻底全透后，文字直接叠在星空之上。引擎搭载智能对比度增强与双层抗晕散微阴影（Text Shadow），配合极轻量磨砂毛玻璃卡片，保证任何高亮恒星与星云划过时文字依然锐利分明、丝毫不受干扰。',
        cardPerfTitle: '⚡ 超低能耗节能架构 (High Performance)',
        cardPerfDesc: '• 30fps 节能帧率锁定，避免无谓 GPU 负载\n• 0.6x 离屏双缓冲降采样天幕，1.2 万星点分帧填充\n• Page Visibility 页面隐藏自动休眠挂起\n• 纯净生命周期：关闭或卸载即彻底释放全部 Canvas 与定时器，零后台开销',
      },
      en: {
        title: 'Deep Space',
        studioTitle: 'Deep Space Studio',
        studioSubtitle: 'Full-Surface Panoramic Viewport · Zero Opacity, Glass Blur & Holographic HUD Text',
        statusRunning: 'Engine Running',
        statusDisabled: 'Background Off',
        masterSwitch: 'Enable Deep Space',
        masterSwitchDesc: 'Renders 360° seamless drifting Milky Way, constellations, planets, and meteors in background',
        transparencySection: 'Surface Transparency & Pure Cosmic View',
        transparencyDesc: 'Punctures opaque backgrounds to fully expose the cosmos. 0% is pure complete transparency.',
        presetPure: 'Pure Cosmic (0%)',
        presetDeep: 'Deep Space (25%)',
        presetBalanced: 'Balanced Glass (45%)',
        presetSubtle: 'Subtle Breeze (75%)',
        sliderLabel: 'Surface Opacity',
        blurSection: 'Backdrop Blur',
        blurDesc: 'Softens the starry backdrop to create elegant frosted glass depth.',
        blurNone: 'None (0px)',
        blurSoft: 'Soft (8px)',
        blurMedium: 'Classic (12px)',
        blurDeep: 'Deep (20px)',
        readabilitySection: 'Smart HUD Text Contrast & Anti-Glare Shield',
        readabilityDesc: 'Under high transparency, text automatically shifts to crisp contrast with subtle drop shadows.',
        autoContrast: 'Smart Text Brightening',
        autoContrastDesc: 'Enhances text to high-contrast crisp white when surface opacity is low',
        textShadow: 'Dual-Layer Anti-Glare Text Shadow',
        textShadowDesc: 'Adds protective shadows behind text to prevent bright stars from washing out words',
        dynamicsSection: 'Stellar Dynamics',
        speedLabel: 'Drift Speed',
        speedSlow: 'Calm (0.2x)',
        speedNormal: 'Natural (0.4x)',
        speedFast: 'Cruise (0.8x)',
        previewSection: 'Live Readability & Transparency Preview',
        previewTitle: 'Title: DeepSeek Harness Studio Session',
        previewBody: 'The stars shine brilliant across the vast cosmos. With holographic HUD readability active, text remains exceptionally crisp and readable over any starry background.',
        previewCode: 'const space = new CosmicBackdrop({ opacity: 0.0, blur: 12, hud: true });',
        resetDefaults: 'Reset to Default (0% Pure)',
        projectOverviewTitle: 'Deep Space Background · Architecture & Overview',
        projectOverviewSubtitle: 'An Immersive Cosmic Viewport Engine for DeepSeek Harness',
        cardPhilosophyTitle: '🌟 Design Philosophy',
        cardPhilosophyDesc: 'Transforms the entire DSH window into a spacecraft panoramic viewport. Code and chats float seamlessly over the vast cosmic horizon without heavy opaque panels.',
        cardEngineTitle: '🌌 Celestial Dynamics Engine',
        cardEngineDesc: '• 360° Seamless Milky Way: Continuous periodic sine algorithm with zero visible seams\n• 3D Constellations: Procedural 4-8 star chains with 3D camera orthogonal projection\n• Ringed Planets & Nebulae: Ambient nebular clouds and drifting ringed gas giants\n• High-velocity meteors slicing across the cosmic sky',
        cardHudTitle: '🛡️ Holographic HUD Readability',
        cardHudDesc: 'When fully transparent, text is guarded by high-contrast illumination and dual-layer drop shadows, ensuring perfect legibility across moving stars and bright planetary bodies.',
        cardPerfTitle: '⚡ High Performance & Zero Waste',
        cardPerfDesc: '• 30fps energy-saving cap\n• 0.6x offscreen downscaled double-buffer sky rendering\n• Automatic tab visibility pause\n• Clean disposal: releases all canvases and intervals immediately on close',
      },
    };

    /** 动态根据配置生成全局 CSS 规则（全域穿透 + 各列半透/全透 + 毛玻璃 + 文字太空 HUD 保护）。 */
    function generateDynamicCss(options) {
      const {
        enabled = true,
        surfaceOpacity = 0.0,
        blur = 12,
        autoContrast = true,
        textShadow = true,
      } = options || {};

      if (!enabled) return '';

      const op = clamp(surfaceOpacity, 0.0, 0.95);
      const blurPx = clamp(blur, 0, 32);
      const isPureTransparent = op === 0;

      // 浅色模式各列背景色
      const lightCenter = isPureTransparent ? 'transparent' : `rgba(243, 245, 249, ${op})`;
      const lightSidebar = isPureTransparent ? 'transparent' : `rgba(235, 236, 241, ${Math.min(op + 0.06, 0.98)})`;
      const lightBottom = isPureTransparent ? 'transparent' : `rgba(243, 245, 249, ${Math.min(op + 0.1, 0.98)})`;

      // 深色模式各列背景色
      const darkCenter = isPureTransparent ? 'transparent' : `rgba(7, 10, 19, ${op * 0.9})`;
      const darkSidebar = isPureTransparent ? 'transparent' : `rgba(9, 13, 24, ${Math.min(op * 0.9 + 0.06, 0.95)})`;
      const darkBottom = isPureTransparent ? 'transparent' : `rgba(7, 10, 19, ${Math.min(op * 0.9 + 0.1, 0.95)})`;

      const blurRule = blurPx > 0
        ? `backdrop-filter: blur(${blurPx}px) saturate(180%) !important; -webkit-backdrop-filter: blur(${blurPx}px) saturate(180%) !important;`
        : '';

      const textShadowRule = textShadow
        ? 'text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95) !important;'
        : '';

      return [
        // 1. 全窗口容器全透化（击穿 body, #root, #app, frame, content, panel, page, settings, detail）
        'html[data-sbg-on], html[data-sbg-on] body, html[data-sbg-on] #root, html[data-sbg-on] #app { background: transparent !important; background-color: transparent !important; }',
        'html[data-sbg-on] [class*="_frame"], html[data-sbg-on] [class*="q_frame"], html[data-sbg-on] [class*="_content"], html[data-sbg-on] [class*="q_content"] { background: transparent !important; background-color: transparent !important; }',
        'html[data-sbg-on] [class*="_panel"], html[data-sbg-on] [class*="q_panel"], html[data-sbg-on] [class*="_container"], html[data-sbg-on] [class*="q_container"] { background: transparent !important; background-color: transparent !important; }',
        'html[data-sbg-on] [class*="_page"], html[data-sbg-on] [class*="q_page"], html[data-sbg-on] [class*="_settings"], html[data-sbg-on] [class*="q_settings"] { background: transparent !important; background-color: transparent !important; }',
        'html[data-sbg-on] [class*="_main"], html[data-sbg-on] [class*="q_main"], html[data-sbg-on] [class*="detail"], html[data-sbg-on] [class*="Detail"] { background: transparent !important; background-color: transparent !important; }',
        'html[data-sbg-on] [class*="view"], html[data-sbg-on] [class*="View"], html[data-sbg-on] [class*="section"], html[data-sbg-on] [class*="Section"] { background: transparent !important; background-color: transparent !important; }',

        // 2. 主聊天栏、侧边栏、底栏透光
        `html[data-sbg-on] [class*="_centerCol"], html[data-sbg-on] [class*="q_centerCol"], html[data-sbg-on] [class*="_rightbarCol"], html[data-sbg-on] [class*="q_rightbarCol"] { background: ${lightCenter} !important; ${blurRule} }`,
        `html[data-sbg-on] [class*="_sidebarCol"], html[data-sbg-on] [class*="q_sidebarCol"] { background: ${lightSidebar} !important; ${blurRule} }`,
        `html[data-sbg-on] [class*="_bottomRow"], html[data-sbg-on] [class*="q_bottomRow"] { background: ${lightBottom} !important; ${blurRule} }`,

        // 3. 深色模式各列适配
        `html[data-sbg-on] body[data-ds-dark-theme] [class*="_centerCol"], html[data-sbg-on][data-ds-dark-theme] [class*="_centerCol"], html[data-sbg-on] body[data-ds-dark-theme] [class*="q_centerCol"], html[data-sbg-on][data-ds-dark-theme] [class*="q_centerCol"] { background: ${darkCenter} !important; ${blurRule} }`,
        `html[data-sbg-on] body[data-ds-dark-theme] [class*="_sidebarCol"], html[data-sbg-on][data-ds-dark-theme] [class*="_sidebarCol"], html[data-sbg-on] body[data-ds-dark-theme] [class*="q_sidebarCol"], html[data-sbg-on][data-ds-dark-theme] [class*="q_sidebarCol"] { background: ${darkSidebar} !important; ${blurRule} }`,
        `html[data-sbg-on] body[data-ds-dark-theme] [class*="_bottomRow"], html[data-sbg-on][data-ds-dark-theme] [class*="_bottomRow"], html[data-sbg-on] body[data-ds-dark-theme] [class*="q_bottomRow"], html[data-sbg-on][data-ds-dark-theme] [class*="q_bottomRow"] { background: ${darkBottom} !important; ${blurRule} }`,

        // 4. 插件详情页与设置内部的卡片项（变成精致通透的毛玻璃卡片，消灭死黑厚重块）
        `html[data-sbg-on] [class*="_card"], html[data-sbg-on] [class*="q_card"], html[data-sbg-on] [class*="_item"], html[data-sbg-on] [class*="q_item"], html[data-sbg-on] [class*="bubble"], html[data-sbg-on] [class*="composer"] {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: rgba(255, 255, 255, 0.12) !important;
          ${blurRule || 'backdrop-filter: blur(12px) saturate(180%) !important; -webkit-backdrop-filter: blur(12px) saturate(180%) !important;'}
        }`,
        `html[data-sbg-on][data-ds-dark-theme] [class*="_card"], html[data-sbg-on] body[data-ds-dark-theme] [class*="_card"], html[data-sbg-on][data-ds-dark-theme] [class*="q_card"], html[data-sbg-on] body[data-ds-dark-theme] [class*="q_card"], html[data-sbg-on][data-ds-dark-theme] [class*="_item"], html[data-sbg-on] body[data-ds-dark-theme] [class*="_item"] {
          background: rgba(15, 20, 32, 0.35) !important;
          border-color: rgba(255, 255, 255, 0.1) !important;
        }`,

        // 5. 太空全息 HUD 文字防晕散与高对比度保护（确保全透明下所有内容绝对看得见）
        autoContrast ? `
        html[data-sbg-on] {
          --dsw-alias-label-primary: #FFFFFF !important;
          --dsw-alias-label-secondary: rgba(235, 242, 255, 0.88) !important;
          --dsw-alias-label-tertiary: rgba(215, 230, 255, 0.72) !important;
          --dsw-alias-label-quaternary: rgba(200, 220, 255, 0.55) !important;
          --dsw-alias-border-l1: rgba(255, 255, 255, 0.14) !important;
          --dsw-alias-border-l2: rgba(255, 255, 255, 0.22) !important;
          --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.12) !important;
        }
        html[data-sbg-on] h1, html[data-sbg-on] h2, html[data-sbg-on] h3, html[data-sbg-on] h4,
        html[data-sbg-on] [class*="title"], html[data-sbg-on] [class*="Title"],
        html[data-sbg-on] [class*="heading"], html[data-sbg-on] strong, html[data-sbg-on] b {
          color: #FFFFFF !important;
          ${textShadowRule}
        }
        html[data-sbg-on] p, html[data-sbg-on] span, html[data-sbg-on] label, html[data-sbg-on] li,
        html[data-sbg-on] button, html[data-sbg-on] a {
          ${textShadowRule}
        }
        html[data-sbg-on] [class*="desc"], html[data-sbg-on] [class*="Desc"],
        html[data-sbg-on] [class*="secondary"], html[data-sbg-on] [class*="subtitle"],
        html[data-sbg-on] [class*="Subtitle"], html[data-sbg-on] [class*="caption"] {
          color: rgba(235, 242, 255, 0.88) !important;
          ${textShadowRule}
        }
        html[data-sbg-on] code, html[data-sbg-on] pre, html[data-sbg-on] [class*="tag"],
        html[data-sbg-on] [class*="badge"], html[data-sbg-on] [class*="path"] {
          background: rgba(0, 0, 0, 0.4) !important;
          color: #7dd3fc !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          ${textShadowRule}
        }
        ` : '',

        // 6. 深色模式下阴影兜底
        textShadow ? `
        html[data-sbg-on][data-ds-dark-theme] p, html[data-sbg-on] body[data-ds-dark-theme] p,
        html[data-sbg-on][data-ds-dark-theme] span, html[data-sbg-on] body[data-ds-dark-theme] span {
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
        }
        ` : ''
      ].join('\n');
    }

    /** 动态根据配置生成官方主题令牌覆盖。 */
    function generateTokenOverrides(options) {
      const opts = typeof options === 'number' ? { surfaceOpacity: options } : (options || {});
      const { enabled = true, surfaceOpacity = 0.0 } = opts;
      if (!enabled) return {};
      const op = clamp(surfaceOpacity, 0.0, 0.95);
      const isZero = op === 0;
      const zeroColor = 'rgba(0, 0, 0, 0)';

      return {
        '--dsw-alias-bg-base': {
          light: isZero ? zeroColor : `rgba(243, 245, 249, ${op})`,
          dark: isZero ? zeroColor : `rgba(7, 10, 19, ${op * 0.9})`,
        },
        '--dsw-alias-bg-layer-1': {
          light: isZero ? zeroColor : `rgba(249, 250, 252, ${Math.min(op + 0.08, 0.98)})`,
          dark: isZero ? zeroColor : `rgba(13, 17, 29, ${Math.min(op * 0.9 + 0.08, 0.95)})`,
        },
        '--dsw-alias-bg-layer-2': {
          light: isZero ? zeroColor : `rgba(243, 245, 249, ${Math.min(op + 0.05, 0.98)})`,
          dark: isZero ? zeroColor : `rgba(9, 13, 24, ${Math.min(op * 0.9 + 0.05, 0.95)})`,
        },
        '--dsw-alias-bg-layer-3': {
          light: isZero ? zeroColor : `rgba(249, 250, 252, ${Math.min(op + 0.1, 0.98)})`,
          dark: isZero ? zeroColor : `rgba(15, 20, 32, ${Math.min(op * 0.9 + 0.1, 0.95)})`,
        },
        '--dsw-alias-bg-layer-4': {
          light: isZero ? zeroColor : `rgba(249, 250, 252, ${Math.min(op + 0.12, 0.98)})`,
          dark: isZero ? zeroColor : `rgba(18, 24, 38, ${Math.min(op * 0.9 + 0.12, 0.95)})`,
        },
        '--dsw-alias-settings-card-fill': {
          light: isZero ? 'rgba(255, 255, 255, 0.05)' : `rgba(255, 255, 255, ${Math.min(op + 0.1, 0.9)})`,
          dark: isZero ? 'rgba(255, 255, 255, 0.04)' : `rgba(18, 24, 38, ${Math.min(op * 0.9 + 0.1, 0.9)})`,
        },
        '--dsw-specific-sidebar-fill': {
          light: isZero ? zeroColor : `rgba(235, 236, 241, ${Math.min(op + 0.06, 0.98)})`,
          dark: isZero ? zeroColor : `rgba(9, 13, 24, ${Math.min(op * 0.9 + 0.06, 0.95)})`,
        },
      };
    }

    /** 静态兜底兼容导出（供旧单测与外部引用）。 */
    const GLOBAL_TOKEN_OVERRIDES = generateTokenOverrides({ enabled: true, surfaceOpacity: 0.0 });
    const GLOBAL_BG_CSS = generateDynamicCss({ enabled: true, surfaceOpacity: 0.0, blur: 12, autoContrast: true, textShadow: true });

    function updateDynamicStyles(options) {
      if (!options || options.enabled === false) {
        document.documentElement.removeAttribute('data-sbg-on');
        const el = document.getElementById('sbg-dynamic-style');
        if (el) el.textContent = '';
        return;
      }
      document.documentElement.setAttribute('data-sbg-on', 'on');
      let el = document.getElementById('sbg-dynamic-style');
      if (!el) {
        el = document.createElement('style');
        el.id = 'sbg-dynamic-style';
        document.head.appendChild(el);
      }
      el.textContent = generateDynamicCss(options);
    }

    /** 组件与独立控制面板样式。 */
    function ensureStyles() {
      if (document.getElementById('sbg-style')) return;
      const el = document.createElement('style');
      el.id = 'sbg-style';
      el.textContent = [
        '.sbg-cv{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;}',
        '.sbg-page{display:flex;flex-direction:column;width:100%;box-sizing:border-box;background:transparent;margin-top:16px;}',
        '.sbg-page-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(15,20,32,0.35);backdrop-filter:blur(16px);}',
        '.sbg-brand{display:flex;align-items:center;gap:12px;min-width:0;}',
        '.sbg-brand-mark{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.12);color:#7dd3fc;display:grid;place-items:center;flex-shrink:0;}',
        '.sbg-brand-title{font-size:16px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;text-shadow:0 1px 3px rgba(0,0,0,0.9);}',
        '.sbg-brand-subtitle{font-size:12px;color:rgba(235,242,255,0.85);margin-top:2px;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-brand-tag{font-size:11px;font-weight:600;color:#7dd3fc;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.1);margin-left:8px;border:1px solid rgba(255,255,255,0.15);}',
        '.sbg-topbar-actions{display:flex;align-items:center;gap:12px;flex-shrink:0;}',
        '.sbg-page-content{padding:16px 0 32px;width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;}',
        '.sbg-card{background:rgba(15,20,32,0.35);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:18px 22px;display:flex;flex-direction:column;gap:14px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}',
        '.sbg-card-header{display:flex;align-items:center;justify-content:space-between;gap:16px;}',
        '.sbg-card-title{font-size:15px;font-weight:600;color:#FFFFFF;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-card-desc{font-size:13px;color:rgba(235,242,255,0.88);line-height:1.5;margin-top:4px;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}',
        '.sbg-preset-btn{border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);border-radius:8px;padding:10px 8px;font-size:12px;text-align:center;color:#FFFFFF;cursor:pointer;transition:all .15s ease;display:flex;flex-direction:column;align-items:center;gap:4px;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-preset-btn:hover{border-color:#38bdf8;background:rgba(56,189,248,0.15);}',
        '.sbg-preset-btn.active{border-color:#38bdf8;background:#0284c7;color:#fff;font-weight:600;box-shadow:0 0 12px rgba(2,132,199,0.5);}',
        '.sbg-preset-tag{font-size:10px;font-weight:500;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.22);}',
        '.sbg-slider-row{display:flex;align-items:center;gap:16px;margin-top:8px;}',
        '.sbg-slider{flex:1;accent-color:#38bdf8;height:6px;border-radius:3px;cursor:pointer;}',
        '.sbg-slider-val{font-size:13px;font-weight:600;color:#7dd3fc;min-width:140px;text-align:right;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-chips{display:flex;flex-wrap:wrap;gap:8px;}',
        '.sbg-chip{border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);border-radius:6px;padding:7px 14px;font-size:12px;color:rgba(235,242,255,0.88);cursor:pointer;transition:all .15s ease;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-chip:hover{border-color:#38bdf8;color:#FFFFFF;background:rgba(56,189,248,0.15);}',
        '.sbg-chip.active{border-color:#38bdf8;color:#FFFFFF;background:#0284c7;font-weight:600;box-shadow:0 0 10px rgba(2,132,199,0.4);}',
        '.sbg-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:16px;}',
        '.sbg-preview-card{border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;margin-top:6px;}',
        '.sbg-btn{border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);border-radius:7px;color:#FFFFFF;padding:6px 12px;font-size:12px;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:6px;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-btn:hover{background:rgba(255,255,255,0.16);border-color:#38bdf8;}',
        '.sbg-switch{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:42px;height:24px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.15);position:relative;cursor:pointer;transition:background .15s ease;padding:0;}',
        '.sbg-switch[aria-checked="true"]{background:#0284c7;border-color:#38bdf8;}',
        '.sbg-switch-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s ease;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
        '.sbg-switch[aria-checked="true"] .sbg-switch-thumb{left:20px;}',
        '.sbg-status-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,0.1);color:#FFFFFF;border:1px solid rgba(255,255,255,0.15);}',
        '.sbg-status-dot{width:8px;height:8px;border-radius:50%;}',
        '.sbg-status-dot.on{background:#10B981;box-shadow:0 0 8px #10B981;}',
        '.sbg-status-dot.off{background:#9CA3AF;}',
        // 项目全景说明专属栅格
        '.sbg-doc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:6px;}',
        '.sbg-doc-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;}',
        '.sbg-doc-card-title{font-size:13.5px;font-weight:600;color:#7dd3fc;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '.sbg-doc-card-body{font-size:12px;color:rgba(235,242,255,0.88);line-height:1.6;white-space:pre-line;text-shadow:0 1px 2px rgba(0,0,0,0.8);}',
        '@media (max-width:768px){.sbg-presets{grid-template-columns:repeat(2,1fr);}.sbg-page-topbar{padding:14px 16px;}.sbg-doc-grid{grid-template-columns:1fr;}}',
      ].join('\n');
      document.head.appendChild(el);
    }

    /** 独立控制面板组件（嵌入在插件详情页）。 */
    function SpaceBackgroundPage({ useStore, actions, t }) {
      const doc = typeof useStore === 'function' ? useStore((s) => s) : {};
      React.useEffect(() => {
        if (actions && typeof actions.normalize === 'function') {
          actions.normalize();
        }
        if (actions) boundActions = actions;
      }, [actions]);
      React.useEffect(ensureStyles, []);

      const enabled = doc.enabled !== false;
      const surfaceOpacity = typeof doc.surfaceOpacity === 'number' ? doc.surfaceOpacity : 0.0;
      const blur = typeof doc.blur === 'number' ? doc.blur : 12;
      const autoContrast = doc.autoContrast !== false;
      const textShadow = doc.textShadow !== false;
      const speed = typeof doc.speed === 'number' ? doc.speed : 0.4;

      const pct = Math.round(surfaceOpacity * 100);
      const transparencyPct = 100 - pct;

      const presets = [
        { label: (t && t('presetPure')) || '纯粹全景 (0%)', op: 0.0, tag: '强烈推荐·全透' },
        { label: (t && t('presetDeep')) || '深空通透 (25%)', op: 0.25 },
        { label: (t && t('presetBalanced')) || '毛玻璃适中 (45%)', op: 0.45 },
        { label: (t && t('presetSubtle')) || '轻透微澜 (75%)', op: 0.75 },
      ];

      const blurs = [
        { label: (t && t('blurNone')) || '无模糊 (0px)', val: 0 },
        { label: (t && t('blurSoft')) || '轻柔 (8px)', val: 8 },
        { label: (t && t('blurMedium')) || '经典 (12px)', val: 12 },
        { label: (t && t('blurDeep')) || '深度 (20px)', val: 20 },
      ];

      const speeds = [
        { label: (t && t('speedSlow')) || '沉静缓速 (0.2x)', val: 0.2 },
        { label: (t && t('speedNormal')) || '自然流转 (0.4x)', val: 0.4 },
        { label: (t && t('speedFast')) || '快速巡航 (0.8x)', val: 0.8 },
      ];

      return h('div', { className: 'sbg-page' },
        h('header', { className: 'sbg-page-topbar' },
          h('div', { className: 'sbg-brand' },
            h('div', null,
              h('div', { className: 'sbg-brand-title' }, (t && t('studioTitle')) || '深空背景控制中心'),
              h('div', { className: 'sbg-brand-subtitle' }, (t && t('studioSubtitle')) || '全域通透宇宙视界 · 界面全透、毛玻璃磨砂与太空 HUD 全息文字保护')),
            h('span', { className: 'sbg-brand-tag' }, 'v1.2.0')),
          h('div', { className: 'sbg-topbar-actions' },
            h('span', { className: 'sbg-status-badge' },
              h('span', { className: 'sbg-status-dot ' + (enabled ? 'on' : 'off') }),
              enabled ? ((t && t('statusRunning')) || '星空运行中') : ((t && t('statusDisabled')) || '背景已关闭')),
            h('button', {
              type: 'button',
              className: 'sbg-btn',
              onClick: () => actions && actions.resetDefaults && actions.resetDefaults(),
            }, (t && t('resetDefaults')) || '恢复默认全透配置'))),
        h('main', { className: 'sbg-page-content' },
          // 卡片 1: 界面全透度与毛玻璃
          h('section', { className: 'sbg-card' },
            h('div', null,
              h('div', { className: 'sbg-card-title' }, (t && t('transparencySection')) || '界面全透度与通透调节 (Surface Transparency)'),
              h('div', { className: 'sbg-card-desc' }, (t && t('transparencyDesc')) || '直接将界面各层背景置为全透以完整展现深空宇宙。数值越低越透，0% 为极致全透。')),
            h('div', { className: 'sbg-presets' },
              presets.map((p) => h('button', {
                key: String(p.op),
                type: 'button',
                className: 'sbg-preset-btn ' + (Math.abs(surfaceOpacity - p.op) < 0.03 ? 'active' : ''),
                onClick: () => actions && actions.setSurfaceOpacity && actions.setSurfaceOpacity(p.op),
              },
                h('div', { style: { fontWeight: 600 } }, p.label),
                p.tag ? h('span', { className: 'sbg-preset-tag' }, p.tag) : null))),
            h('div', { className: 'sbg-slider-row' },
              h('span', { style: { fontSize: '13px', color: 'rgba(235,242,255,0.85)' } }, (t && t('sliderLabel')) || '界面表面不透明度'),
              h('input', {
                type: 'range',
                className: 'sbg-slider',
                min: 0,
                max: 95,
                step: 1,
                value: pct,
                onChange: (e) => actions && actions.setSurfaceOpacity && actions.setSurfaceOpacity(Number(e.target.value) / 100),
              }),
              h('span', { className: 'sbg-slider-val' }, `${pct}% (透光 ${transparencyPct}%)`)),
            h('div', { style: { marginTop: '12px' } },
              h('div', { style: { fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: '8px' } }, (t && t('blurSection')) || '毛玻璃磨砂度 (Backdrop Blur)'),
              h('div', { className: 'sbg-chips' },
                blurs.map((b) => h('button', {
                  key: String(b.val),
                  type: 'button',
                  className: 'sbg-chip ' + (blur === b.val ? 'active' : ''),
                  onClick: () => actions && actions.setBlur && actions.setBlur(b.val),
                }, b.label))))),

          // 卡片 2: 太空 HUD 全息文字可读性与防晕散保护
          h('section', { className: 'sbg-card' },
            h('div', null,
              h('div', { className: 'sbg-card-title' }, (t && t('readabilitySection')) || '太空全息 HUD 文字防晕散与高对比度保护'),
              h('div', { className: 'sbg-card-desc' }, (t && t('readabilityDesc')) || '全透明模式下深邃星空成为主背景，智能算法自动提亮文字并增加微阴影，防止暗色字在黑夜星空下难以辨别。')),
            h('div', { className: 'sbg-toggle-row' },
              h('div', null,
                h('div', { style: { fontSize: '13px', fontWeight: 600, color: '#FFFFFF' } }, (t && t('autoContrast')) || '文字智能增亮与反转'),
                h('div', { style: { fontSize: '12px', color: 'rgba(235,242,255,0.82)', marginTop: '2px' } }, (t && t('autoContrastDesc')) || '在通透度较高时自动将主文字提升为高对比度银白色')),
              h('button', {
                type: 'button',
                className: 'sbg-switch',
                role: 'switch',
                'aria-checked': String(autoContrast),
                onClick: () => actions && actions.setAutoContrast && actions.setAutoContrast(!autoContrast),
              }, h('span', { className: 'sbg-switch-thumb' }))),
            h('div', { className: 'sbg-toggle-row', style: { borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '12px' } },
              h('div', null,
                h('div', { style: { fontSize: '13px', fontWeight: 600, color: '#FFFFFF' } }, (t && t('textShadow')) || '抗晕散双层文字轮廓阴影'),
                h('div', { style: { fontSize: '12px', color: 'rgba(235,242,255,0.82)', marginTop: '2px' } }, (t && t('textShadowDesc')) || '为文字边缘注入深色抗晕光分界线，无论明亮恒星或行星划过，字迹清晰立现')),
              h('button', {
                type: 'button',
                className: 'sbg-switch',
                role: 'switch',
                'aria-checked': String(textShadow),
                onClick: () => actions && actions.setTextShadow && actions.setTextShadow(!textShadow),
              }, h('span', { className: 'sbg-switch-thumb' })))),

          // 卡片 3: 实时效果透视预览
          h('section', { className: 'sbg-card' },
            h('div', null,
              h('div', { className: 'sbg-card-title' }, (t && t('previewSection')) || '透光与文字辨识度实测预览'),
              h('div', { className: 'sbg-card-desc' }, '本卡片模拟在当前全透度与对比度设置下，正文、标题与代码的视觉呈现：')),
            h('div', {
              className: 'sbg-preview-card',
              style: {
                background: surfaceOpacity === 0 ? 'rgba(255, 255, 255, 0.04)' : `rgba(243, 245, 249, ${surfaceOpacity})`,
                backdropFilter: blur > 0 ? `blur(${blur}px) saturate(180%)` : 'none',
                WebkitBackdropFilter: blur > 0 ? `blur(${blur}px) saturate(180%)` : 'none',
              },
            },
              h('div', {
                style: {
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  textShadow: textShadow ? '0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)' : 'none',
                },
              }, (t && t('previewTitle')) || '标题：DeepSeek Harness 专业级会话'),
              h('div', {
                style: {
                  fontSize: '13px',
                  lineHeight: 1.6,
                  color: 'rgba(235,242,255,0.92)',
                  textShadow: textShadow ? '0 1px 2px rgba(0,0,0,0.9)' : 'none',
                },
              }, (t && t('previewBody')) || '星汉灿烂，若出其里；日月之行，若出其中。在当前全景通透度与高对比度 HUD 保护下，正文无论在浅色还是深色星空背景上都具有卓越的可读性。'),
              h('code', {
                style: {
                  fontSize: '12px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: 'rgba(0,0,0,0.4)',
                  color: '#7dd3fc',
                  display: 'inline-block',
                  border: '1px solid rgba(255,255,255,0.16)',
                },
              }, (t && t('previewCode')) || `const space = new CosmicBackdrop({ opacity: ${surfaceOpacity}, blur: ${blur}, hud: true });`))),

          // 卡片 4: 天体动力学运行节奏
          h('section', { className: 'sbg-card' },
            h('div', null,
              h('div', { className: 'sbg-card-title' }, (t && t('dynamicsSection')) || '天体动力学运行节奏'),
              h('div', { className: 'sbg-card-desc' }, '调整银河旋转与全天天幕的漂移速度：')),
            h('div', { className: 'sbg-chips' },
              speeds.map((s) => h('button', {
                key: String(s.val),
                type: 'button',
                className: 'sbg-chip ' + (speed === s.val ? 'active' : ''),
                onClick: () => actions && actions.setSpeed && actions.setSpeed(s.val),
              }, s.label)))),

          // 卡片 5: 项目全景说明与技术架构 (Project Overview & Cosmic Guide)
          h('section', { className: 'sbg-card' },
            h('div', null,
              h('div', { className: 'sbg-card-title', style: { fontSize: '16px', color: '#38bdf8' } },
                (t && t('projectOverviewTitle')) || '深空背景 · 项目全景说明与技术架构'),
              h('div', { className: 'sbg-card-desc' },
                (t && t('projectOverviewSubtitle')) || '专为 DeepSeek Harness 打造的全域穿透宇宙视界引擎')),
            h('div', { className: 'sbg-doc-grid' },
              h('div', { className: 'sbg-doc-card' },
                h('div', { className: 'sbg-doc-card-title' }, (t && t('cardPhilosophyTitle')) || '🌟 项目设计理念'),
                h('div', { className: 'sbg-doc-card-body' }, (t && t('cardPhilosophyDesc')) || '彻底打破传统软件封闭沉闷的纯黑/深灰死板界面，将整个 DSH 窗口化身为太空飞船的「全景舷窗」。通过全域穿透技术将各层阻挡背景一扫而空，让日常代码编写与智能交互轻盈地悬浮在浩瀚深邃的宇宙星空之中。')),
              h('div', { className: 'sbg-doc-card' },
                h('div', { className: 'sbg-doc-card-title' }, (t && t('cardEngineTitle')) || '🌌 天体动力学引擎'),
                h('div', { className: 'sbg-doc-card-body' }, (t && t('cardEngineDesc')) || '• 360° 正弦无缝银河：采用 bandYFor 连续周期曲面算法，星际尘埃自然闭合无缝对接\n• 3D 正交投影星座：随机生成 4~8 节点星链与分支星群，随相机正交基三维旋转投影\n• 行星与星云：多层漫反射星云与掠过视界的带环气态巨行星\n• 瞬态高光流星：随机划破天际的高速流星轨迹引擎')),
              h('div', { className: 'sbg-doc-card' },
                h('div', { className: 'sbg-doc-card-title' }, (t && t('cardHudTitle')) || '🛡️ 太空全息 HUD 文字防晕散'),
                h('div', { className: 'sbg-doc-card-body' }, (t && t('cardHudDesc')) || '界面彻底全透后，文字直接叠在星空之上。引擎搭载智能对比度增强与双层抗晕散微阴影（Text Shadow），配合极轻量磨砂毛玻璃卡片，保证任何高亮恒星与星云划过时文字依然锐利分明、丝毫不受干扰。')),
              h('div', { className: 'sbg-doc-card' },
                h('div', { className: 'sbg-doc-card-title' }, (t && t('cardPerfTitle')) || '⚡ 超低能耗节能架构'),
                h('div', { className: 'sbg-doc-card-body' }, (t && t('cardPerfDesc')) || '• 30fps 节能帧率锁定，避免无谓 GPU 负载\n• 0.6x 离屏双缓冲降采样天幕，1.2 万星点分帧填充\n• Page Visibility 页面隐藏自动休眠挂起\n• 纯净生命周期：关闭或卸载即彻底释放全部 Canvas 与定时器，零后台开销')))
          )
        )
      );
    }

    /** 插件详情页面槽位组件（plugins.detail.section）。 */
    function PluginDetailSection(props) {
      const subject = props && props.subject;
      const pkgName = subject && subject.pkg && subject.pkg.name;
      const id = subject && subject.id;
      // 仅当用户在「深空背景」插件详情页时展示专属项目说明与调控面板
      if (pkgName !== '@local/space-background' && id !== '@local/space-background' && id !== PANEL_ID) {
        return null;
      }
      return h(SpaceBackgroundPage, props);
    }

    /** 兼容保留：设置行视图（供单测与可选挂载）。 */
    function SettingsRow(props) {
      const useStore = props && props.useStore;
      const t = (props && props.t) || ((k) => k);
      const actions = props && props.actions;
      React.useEffect(() => {
        if (actions && typeof actions.normalize === 'function') actions.normalize();
        if (actions) boundActions = actions;
      }, [actions]);
      const setEnabled = (actions && actions.setEnabled) || (props && props.setEnabled);
      const enabled = typeof useStore === 'function' ? useStore((s) => s.enabled !== false) : true;
      React.useEffect(ensureStyles, []);

      return h('div', { className: 'sbg-card', style: { padding: '16px' } },
        h('div', { className: 'sbg-card-header' },
          h('div', null,
            h('div', { className: 'sbg-card-title' }, (t && t('title')) || '深空背景'),
            h('div', { className: 'sbg-card-desc' }, '请在插件管理「深空背景」详情页进行全功能调节')),
          h('button', {
            type: 'button',
            className: 'sbg-switch',
            role: 'switch',
            'aria-checked': String(enabled),
            onClick: () => {
              if (typeof setEnabled === 'function') setEnabled(enabled !== true);
            },
          }, h('span', { className: 'sbg-switch-thumb' }))));
    }

    /** 全局星空层（shell.overlay）：渲染 null，效果全部在副作用里。 */
    function SpaceLayer(props) {
      const useStore = props && props.useStore;
      const actions = props && props.actions;
      const doc = typeof useStore === 'function' ? useStore((s) => s) : {};
      const enabled = doc.enabled !== false;
      const speed = typeof doc.speed === 'number' ? doc.speed : 0.4;
      const density = typeof doc.density === 'number' ? doc.density : 1000;
      const surfaceOpacity = typeof doc.surfaceOpacity === 'number' ? doc.surfaceOpacity : 0.0;
      const blur = typeof doc.blur === 'number' ? doc.blur : 12;
      const autoContrast = doc.autoContrast !== false;
      const textShadow = doc.textShadow !== false;

      React.useEffect(() => {
        boundDoc = doc;
        if (actions && typeof actions.normalize === 'function') actions.normalize();
        if (actions) boundActions = actions;
      }, [doc, actions]);

      React.useEffect(ensureStyles, []);

      React.useEffect(() => {
        const diag = (window.__sbgApply = window.__sbgApply || { steps: [], errors: [], ok: false });
        diag.steps.push(`SpaceLayer:effect:start: enabled=${enabled} op=${surfaceOpacity}`);

        // 1. 动态生成并注入全局全域穿透 CSS
        updateDynamicStyles({ enabled, surfaceOpacity, blur, autoContrast, textShadow });

        // 2. 官方主题服务令牌动态覆盖
        let disposeThemeOverride = null;
        if (themeApi && typeof themeApi.overrideTokens === 'function') {
          try {
            if (enabled) {
              const tokens = generateTokenOverrides({ enabled, surfaceOpacity });
              disposeThemeOverride = themeApi.overrideTokens(PANEL_ID, tokens);
            }
          } catch (e) {
            diag.errors.push(`themeApi.overrideTokens:${e.message}`);
          }
        }

        if (!enabled) {
          diag.steps.push('SpaceLayer:effect:disabled');
          return () => {
            if (disposeThemeOverride) disposeThemeOverride();
            updateDynamicStyles({ enabled: false });
          };
        }

        // 3. 挂载星空 Canvas 到窗口根
        let engine = null;
        let root = null;
        try {
          root = document.createElement('div');
          root.id = 'sbg-canvas-root';
          root.setAttribute('data-sbg-root', '1');
          root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:0;overflow:hidden;';
          document.body.prepend(root);

          engine = createSpaceEngine(root, {
            density,
            speed,
            interactive: false,
            showHud: false,
            getSpeed: () => (boundDoc ? (typeof boundDoc.speed === 'number' ? boundDoc.speed : 0.4) : speed),
          });
          diag.steps.push('SpaceLayer:engine:running');
        } catch (e) {
          diag.errors.push(`createSpaceEngine:${e.message}`);
        }

        return () => {
          if (disposeThemeOverride) disposeThemeOverride();
          updateDynamicStyles({ enabled: false });
          if (engine) engine.dispose();
          if (root && root.parentNode) root.parentNode.removeChild(root);
          diag.steps.push('SpaceLayer:effect:cleanup');
        };
      }, [enabled, surfaceOpacity, blur, autoContrast, textShadow, density]);

      return null;
    }

    function makeStore() {
      return defineStore({
        init: () => ({
          schemaVersion: STORE_SCHEMA_VERSION,
          enabled: true,
          surfaceOpacity: 0.0, // 默认 0.0 极致纯粹全透，彻底展示整个星空背景！
          blur: 12,
          autoContrast: true,
          textShadow: true,
          speed: 0.4,
          density: 1000,
        }),
        persist: PERSIST_KEY,
        actions: {
          normalize(draft) {
            const previous = typeof draft.schemaVersion === 'number' ? draft.schemaVersion : 0;
            const isLegacy = previous < STORE_SCHEMA_VERSION;
            delete draft.speed_legacy;
            delete draft.boost;
            delete draft.hue;
            if (isLegacy) {
              draft.enabled = true;
              draft.surfaceOpacity = 0.0;
              if (typeof draft.blur !== 'number') draft.blur = 12;
              if (typeof draft.autoContrast !== 'boolean') draft.autoContrast = true;
              if (typeof draft.textShadow !== 'boolean') draft.textShadow = true;
              if (typeof draft.speed !== 'number') draft.speed = 0.4;
              if (typeof draft.density !== 'number') draft.density = 1000;
            } else {
              draft.enabled = draft.enabled !== false;
              draft.surfaceOpacity = clamp(typeof draft.surfaceOpacity === 'number' ? draft.surfaceOpacity : 0.0, 0.0, 0.95);
              draft.blur = clamp(typeof draft.blur === 'number' ? draft.blur : 12, 0, 32);
              draft.autoContrast = draft.autoContrast !== false;
              draft.textShadow = draft.textShadow !== false;
              draft.speed = clamp(typeof draft.speed === 'number' ? draft.speed : 0.4, 0.1, 1.5);
              draft.density = clamp(typeof draft.density === 'number' ? draft.density : 1000, 300, 2000);
            }
            draft.schemaVersion = STORE_SCHEMA_VERSION;
          },
          setEnabled(draft, on) { draft.enabled = on === true; },
          setSurfaceOpacity(draft, val) { draft.surfaceOpacity = clamp(Number(val) || 0, 0.0, 0.95); },
          setBlur(draft, val) { draft.blur = clamp(Number(val) || 0, 0, 32); },
          setAutoContrast(draft, on) { draft.autoContrast = on === true; },
          setTextShadow(draft, on) { draft.textShadow = on === true; },
          setSpeed(draft, val) { draft.speed = clamp(Number(val) || 0.4, 0.1, 1.5); },
          resetDefaults(draft) {
            draft.enabled = true;
            draft.surfaceOpacity = 0.0;
            draft.blur = 12;
            draft.autoContrast = true;
            draft.textShadow = true;
            draft.speed = 0.4;
            draft.density = 1000;
          },
        },
      });
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const diag = (window.__sbgApply = window.__sbgApply || { steps: [], errors: [], ok: false });
        const mark = (step) => { diag.steps.push(step); };
        mark('apply:enter');

        ctx.effect(() => ctx.locale.register(NS, dict), 'space-background: dictionaries');
        mark('locale:register:ok');
        const t = ctx.locale.bind(NS);
        mark('locale:bind:ok');

        try {
          const direct = typeof ctx.get === 'function' ? ctx.get('theme') : null;
          if (direct) themeApi = direct;
        } catch (e) { /* ignore */ }
        if (!themeApi && typeof ctx.inject === 'function') {
          try {
            ctx.inject(['theme'], (scope) => { themeApi = (scope && scope.theme) || themeApi; });
          } catch (e) { /* ignore */ }
        }

        ctx.effect(() => {
          const store = makeStore();
          mark('store:created');

          const toggle = (next) => {
            try {
              if (boundActions && typeof boundActions.setEnabled === 'function') {
                boundActions.setEnabled(next);
                return;
              }
              const d = store.get ? store.get() : (store.getSnapshot ? store.getSnapshot() : null);
              if (d && typeof d === 'object') {
                d.enabled = next;
                if (typeof store.set === 'function') store.set(d);
              }
            } catch (e) { /* ignore */ }
          };
          try { window.__sbgToggle = toggle; } catch (e) { /* ignore */ }
          mark('toggle:ready');

          // 1. 全局星空层（shell.overlay）
          const disposeOverlay = ctx.slots.inject('shell.overlay', () => {
            mark('shell.overlay:injected');
            const d = ctx.slots.register(
              { name: 'shell.overlay', id: PANEL_ID, order: 0, store }, SpaceLayer);
            mark('shell.overlay:registered');
            return d;
          });

          // 2. 插件详情页专属板块（plugins.detail.section）——无侧边栏按钮，纯粹嵌入插件自身页面！
          const disposeDetail = ctx.slots.inject('plugins.detail.section', () => {
            mark('plugins.detail.section:injected');
            const d = ctx.slots.register(
              { name: 'plugins.detail.section', id: PANEL_ID, order: 10, store, locale: NS }, PluginDetailSection);
            mark('plugins.detail.section:registered');
            return d;
          });

          diag.ok = true;
          mark('apply:done');
          return () => { disposeOverlay(); disposeDetail(); };
        }, 'space-background: overlay + plugin detail section');
      },
      /** 仅供 test/run.cjs 与 preview.html 使用的内部面。 */
      __test__: {
        PANEL_ID, NS, PERSIST_KEY, STORE_SCHEMA_VERSION,
        TINTS, DOT_STYLES, GLOBAL_TOKEN_OVERRIDES, GLOBAL_BG_CSS,
        clamp, pickTint, bandYFor, buildBasis, makeConstellations,
        makeStore, ensureStyles, createSpaceEngine,
        generateDynamicCss, generateTokenOverrides,
        Views: { SpaceBackgroundPage, SpaceLayer, PluginDetailSection, SettingsRow },
      },
    };
  },
});
