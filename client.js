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
     * 2：丢弃 speed / boost / hue 等已移除字段，并把旧文档的 enabled 复位成
     *    true（旧版本没有可靠的开关写入通道，留下的 false 不可信）。
     */
    const STORE_SCHEMA_VERSION = 2;

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
     * 外观集成：设置行 + 全局星空层 + 主题令牌覆盖
     * ==================================================================== */

    /** 主题服务句柄（apply 内 ctx.inject(['theme']) 就绪后写入）。 */
    let themeApi = null;

    const dict = {
      zh: {
        rowTitle: '深空背景',
        rowDesc: '银河、星座与行星在窗口底层缓缓流动，界面表面保持可读',
      },
      en: {
        rowTitle: 'Deep space background',
        rowDesc: 'Milky Way, constellations and planets drift behind a translucent shell',
      },
    };

    /** 开启时折入活动主题的令牌覆盖层（官方 ctx.theme.overrideTokens 机制）。 */
    const GLOBAL_TOKEN_OVERRIDES = {
      '--dsw-alias-bg-base': { light: 'rgba(243,245,249,0.88)', dark: 'rgba(7,10,19,0.82)' },
      '--dsw-alias-bg-layer-1': { light: 'rgba(249,250,252,0.92)', dark: 'rgba(13,17,29,0.9)' },
      '--dsw-specific-sidebar-fill': { light: 'rgba(235,236,241,0.8)', dark: 'rgba(9,13,24,0.76)' },
    };

    /** 兜底样式：令牌覆盖之外的第二层保险（浅/深双色，数据属性门控，关闭即撤）。 */
    /**
     * 兜底样式：令牌覆盖之外的第二层保险（浅/深双色，数据属性门控，关闭即撤）。
     *
     * 选择器为什么写成 `[class*="_frame"]` 与 `[class*="q_frame"]` 两种：
     * 宿主用 CSS Modules，类名形如 `mP3x-q_frame` / `mP3x-q_centerCol`。
     * 旧写法只匹配 `_frame`（以下划线开头），而真实类名是 `q_frame`——
     * 下划线在哈希段之后，`[class*="_frame"]` 根本命中不了，于是兜底样式
     * 一直没生效。这里同时保留两种拼写，哈希算法换了前缀也不会再断。
     */
    const GLOBAL_BG_CSS = [
      'html[data-sbg-on] body,html[data-sbg-on] #root,html[data-sbg-on] #app{background:transparent !important;}',
      // 框架根：宿主的 .frame 带不透明 background，必须让它透出底层星空
      'html[data-sbg-on] [class*="_frame"],html[data-sbg-on] [class*="q_frame"]{background:transparent !important;}',
      'html[data-sbg-on] [class*="_centerCol"],html[data-sbg-on] [class*="_rightbarCol"],html[data-sbg-on] [class*="q_centerCol"],html[data-sbg-on] [class*="q_rightbarCol"]{background:rgba(243,245,249,0.88) !important;}',
      'html[data-sbg-on] [class*="_sidebarCol"],html[data-sbg-on] [class*="q_sidebarCol"]{background:rgba(235,236,241,0.8) !important;}',
      'html[data-sbg-on] [class*="_bottomRow"],html[data-sbg-on] [class*="q_bottomRow"]{background:rgba(243,245,249,0.9) !important;}',
      'html[data-sbg-on] body[data-ds-dark-theme] [class*="_centerCol"],html[data-sbg-on] body[data-ds-dark-theme] [class*="_rightbarCol"],html[data-sbg-on][data-ds-dark-theme] [class*="_centerCol"],html[data-sbg-on] body[data-ds-dark-theme] [class*="q_centerCol"],html[data-sbg-on] body[data-ds-dark-theme] [class*="q_rightbarCol"],html[data-sbg-on][data-ds-dark-theme] [class*="q_centerCol"]{background:rgba(7,10,19,0.82) !important;}',
      'html[data-sbg-on] body[data-ds-dark-theme] [class*="_sidebarCol"],html[data-sbg-on][data-ds-dark-theme] [class*="_sidebarCol"],html[data-sbg-on] body[data-ds-dark-theme] [class*="q_sidebarCol"],html[data-sbg-on][data-ds-dark-theme] [class*="q_sidebarCol"]{background:rgba(9,13,24,0.76) !important;}',
      'html[data-sbg-on] body[data-ds-dark-theme] [class*="_bottomRow"],html[data-sbg-on][data-ds-dark-theme] [class*="_bottomRow"],html[data-sbg-on] body[data-ds-dark-theme] [class*="q_bottomRow"],html[data-sbg-on][data-ds-dark-theme] [class*="q_bottomRow"]{background:rgba(7,10,19,0.86) !important;}',
    ].join('\n');

    /** 组件样式（一次性注入；设置行使用 DSH token 融入原生外观）。 */
    function ensureStyles() {
      if (document.getElementById('sbg-style')) return;
      const el = document.createElement('style');
      el.id = 'sbg-style';
      el.textContent = [
        '.sbg-cv{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;}',
        '.sbg-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));}',
        '.sbg-row-text{min-width:0;}',
        '.sbg-row-title{color:var(--dsw-alias-label-primary, inherit);font-size:14px;line-height:22px;}',
        '.sbg-row-desc{color:var(--dsw-alias-label-secondary, rgba(0,0,0,.55));font-size:12px;line-height:18px;margin-top:2px;}',
        '.sbg-switch{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:40px;height:22px;border-radius:999px;border-style:solid;border-width:1px;border-color:transparent;background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.12));position:relative;cursor:pointer;transition:background .15s ease;padding:0;}',
        '.sbg-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary, #4176E6);}',
        '.sbg-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb, #fff);transition:left .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.2);}',
        '.sbg-switch[aria-checked="true"] .sbg-switch-thumb{left:20px;}',
      ].join('\n');
      document.head.appendChild(el);
    }

    /** 设置「通用」分区外观行：深空背景开关 + 实时自检面板。 */
    function SettingsRow(props) {
      const useStore = props && props.useStore;
      const t = (props && props.t) || ((k) => k);
      const actions = props && props.actions;
      // 宿主把 `store.actions` 作为 props.actions 传进来；同时注册时也经
      // `inject` 提供了一个确定的 setEnabled，两者取其一即可写入。
      const setEnabled = (props && props.setEnabled) || (actions && actions.setEnabled);
      const enabled = typeof useStore === 'function' ? useStore((s) => s.enabled !== false) : true;
      React.useEffect(ensureStyles, []);

      // ── 自检面板 ─────────────────────────────────────────────────────
      // 为什么把诊断画在界面上：这个插件的效果全部在一个渲染 null 的
      // overlay 组件里，一旦副作用静默失败，用户在界面上得不到任何反馈，
      // 只能靠开发者工具。把状态直接铺在这一行，能一眼看出卡在哪一步。
      const probe = () => {
        const out = {
          overlay: false,
          canvas: 0,
          bgStyle: false,
          bgOn: null,
          steps: 0,
          errors: [],
          debug: null,
        };
        try {
          out.overlay = !!document.querySelector('[data-sbg-host]');
          out.canvas = document.querySelectorAll('canvas.sbg-cv').length;
          out.bgStyle = !!document.getElementById('sbg-global-bg');
          out.bgOn = document.documentElement.getAttribute('data-sbg-on');
          const a = window.__sbgApply;
          if (a) { out.steps = (a.steps || []).length; out.errors = (a.errors || []).slice(-3); }
          out.debug = window.__sbgDebug || null;
        } catch (e) {
          out.errors = ['probe: ' + String((e && e.message) || e)];
        }
        return out;
      };

      const [state, setState] = React.useState(probe);
      React.useEffect(() => {
        // 首帧之后副作用才跑，所以短轮询几次把真实状态收上来
        let n = 0;
        const timer = setInterval(() => {
          setState(probe());
          n += 1;
          if (n >= 8) clearInterval(timer);
        }, 400);
        return () => clearInterval(timer);
      }, [enabled]);

      // ── 从设置行上报一次（诊断期专用）────────────────────────────────
      // SpaceLayer 的副作用若因 enabled=false 提前返回，就永远不会上报；
      // 而设置行总是会被渲染，所以从这里发一份，保证一定能看到真实状态。
      React.useEffect(() => {
        const timer = setTimeout(() => {
          const p = probe();
          const payload = {
            from: 'SettingsRow',
            at: Date.now(),
            url: location.href,
            enabled,
            hasUseStore: typeof useStore === 'function',
            hasActions: !!actions,
            hasSetEnabled: typeof setEnabled === 'function',
            probe: p,
            persistRaw: (() => { try { return localStorage.getItem(PERSIST_KEY); } catch (e) { return 'unreadable'; } })(),
            sbgDebugGlobal: (() => { try { return window.__sbgDebug || null; } catch (e) { return null; } })(),
            sbgApply: (() => { try { const a = window.__sbgApply; return a ? { steps: (a.steps || []).length, errors: (a.errors || []).slice(-5), mount: a.mount || null } : null; } catch (e) { return null; } })(),
          };
          try {
            fetch('/plugins/space-background/diag', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }).catch(() => {});
          } catch (e) { /* ignore */ }
          try { localStorage.setItem('space-background/diag', JSON.stringify(payload)); } catch (e) { /* ignore */ }
          try { window.__sbgDiag = payload; } catch (e) { /* ignore */ }
        }, 900);
        return () => clearTimeout(timer);
      }, [enabled]);

      const ok = state.overlay && state.canvas > 0;
      const rowStyle = { fontSize: '12px', lineHeight: '18px', opacity: 0.85, marginTop: '6px' };
      const lines = [
        `${ok ? '✓' : '✗'} 星空层 ${state.overlay ? '已挂载' : '未挂载'} · canvas ${state.canvas} 个`,
        `${state.bgOn === 'on' ? '✓' : '✗'} data-sbg-on=${state.bgOn ?? 'null'} · 兜底CSS ${state.bgStyle ? '已注入' : '未注入'}`,
        `apply 步骤 ${state.steps}${state.debug && state.debug.tokensApplied ? ' · 令牌已覆盖' : ' · 令牌未覆盖'}`,
      ];
      if (state.errors.length > 0) lines.push('⚠ ' + state.errors.join(' | '));

      return h('div', { className: 'sbg-row' },
        h('div', { className: 'sbg-row-text' },
          h('div', { className: 'sbg-row-title' }, t('rowTitle')),
          h('div', { className: 'sbg-row-desc' }, t('rowDesc')),
          h('div', { className: 'sbg-probe', style: rowStyle },
            lines.map((line, i) => h('div', { key: String(i) }, line)))),
        h('button', {
          type: 'button',
          className: 'sbg-switch',
          role: 'switch',
          'aria-checked': String(enabled),
          'aria-label': t('rowTitle'),
          onClick: () => {
            if (typeof setEnabled === 'function') setEnabled(enabled !== true);
            else if (typeof window.__sbgToggle === 'function') window.__sbgToggle(enabled !== true);
          },
        }, h('span', { className: 'sbg-switch-thumb' })));
    }

    /** 全局星空层（shell.overlay）：渲染 null，效果全部在副作用里。 */
    function SpaceLayer(props) {
      const useStore = props && props.useStore;
      const enabled = typeof useStore === 'function' ? useStore((s) => s.enabled !== false) : true;
      try {
        const d = (window.__sbgApply = window.__sbgApply || { steps: [], errors: [], ok: false });
        d.steps.push('SpaceLayer:render hasUseStore=' + (typeof useStore === 'function') + ' enabled=' + enabled);
      } catch (e) { /* ignore */ }
      React.useEffect(() => {
        if (!enabled) return undefined;

        const diag = (() => {
          try { return (window.__sbgApply = window.__sbgApply || { steps: [], errors: [], ok: false }); }
          catch (e) { return null; }
        })();
        const mark = (s) => { try { diag && diag.steps.push(s); } catch (e) { /* ignore */ } };
        const fail = (where, e) => {
          const msg = where + ': ' + String((e && e.message) || e);
          try { diag && diag.errors.push(msg); } catch (_) { /* ignore */ }
          try { if (window.__sbgDebug) window.__sbgDebug.error = msg; } catch (_) { /* ignore */ }
          try { console.error('[space-background]', msg); } catch (_) { /* ignore */ }
        };

        mark('SpaceLayer:effect:start');

        // ── 整个副作用体包在 try 里 ──────────────────────────────────────
        // React 会静默吞掉 effect 里抛出的异常：没有这层保护，任何一步失败
        // （canvas 不可用、引擎初始化异常、主题服务未就绪……）都会让星空
        // 永远不出现，而界面上看不到任何错误——这正是「装了却没效果」的
        // 最难排查的一类失败。捕获后至少把原因写进 __sbgApply.errors。
        const cleanupParts = [];
        try {
          ensureStyles();
          mark('ensureStyles:ok');

          const debug = { canvas: false, themeReady: !!themeApi, tokensApplied: false, retries: 0, error: '' };
          try { window.__sbgDebug = debug; } catch (e) { /* 页面限制时忽略诊断 */ }

          const host = document.createElement('div');
          host.setAttribute('data-sbg-host', '');
          // ── 为什么挂到 body 而不是留在这个 overlay 组件里 ───────────────
          // `shell.overlay` 的容器是宿主的 `.overlayLayer`：
          //   .mP3x-q_overlayLayer { z-index:20; position:absolute; inset:0; }
          // 它是**最上层**的覆盖层。星空画布若挂在这层内部并给 `z-index:-1`，
          // 只会沉到该容器背景之后——而容器本身没有背景，真正的 `.frame`
          // 背景（`background:var(--dsw-alias-bg-base)`，完全不透明）在更外层，
          // 于是画布被彻底盖住：canvas 在、引擎在跑、就是看不见。
          //
          // 挂到 body 下并给 `z-index:-1` 才是「位于所有内容之后」的正确位置。
          // 同时也解释了为什么此前只有「运行中」而没有视觉效果。
          host.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;';
          if (document.body && document.body.firstChild !== undefined) {
            document.body.insertBefore(host, document.body.firstChild);
          } else if (document.body) {
            document.body.appendChild(host);
          } else {
            throw new Error('document.body unavailable');
          }
          cleanupParts.push(() => { try { host.remove(); } catch (e) { /* ignore */ } });
          mark('host:inserted');
          // 记录实际挂载位置，自检面板与 __sbgApply 都能看到
          try {
            if (diag) diag.mount = { parent: host.parentElement && host.parentElement.tagName, zIndex: host.style.zIndex };
          } catch (e) { /* ignore */ }

          const engine = createSpaceEngine(host, {
            interactive: false,
            hud: false,
            fpsCap: 30,
            autoDrift: 0.012,
            density: 1000,
            speed: 0.4,
          });
          cleanupParts.push(() => { try { engine.dispose(); } catch (e) { /* ignore */ } });
          debug.canvas = true;
          mark('engine:created');

          const style = document.createElement('style');
          style.id = 'sbg-global-bg';
          style.textContent = GLOBAL_BG_CSS;
          document.head.appendChild(style);
          cleanupParts.push(() => { try { style.remove(); } catch (e) { /* ignore */ } });

          document.documentElement.setAttribute('data-sbg-on', 'on');
          cleanupParts.push(() => { try { document.documentElement.removeAttribute('data-sbg-on'); } catch (e) { /* ignore */ } });
          mark('css:applied');

          // 主题令牌覆盖：服务就绪即套用；未就绪则短间隔重试（最多 60 次）
          let disposeTokens = null;
          let retryTimer = null;
          let tries = 0;
          const applyTokens = () => {
            if (disposeTokens) return true;
            if (themeApi && typeof themeApi.overrideTokens === 'function') {
              try {
                disposeTokens = themeApi.overrideTokens(PANEL_ID, GLOBAL_TOKEN_OVERRIDES);
                debug.themeReady = true;
                debug.tokensApplied = true;
                mark('tokens:applied');
                return true;
              } catch (e) {
                fail('theme.overrideTokens', e);
                return false;
              }
            }
            return false;
          };
          if (!applyTokens()) {
            retryTimer = setInterval(() => {
              debug.retries = ++tries;
              if (applyTokens() || tries >= 60) {
                if (retryTimer) clearInterval(retryTimer);
                retryTimer = null;
              }
            }, 1000);
          }
          cleanupParts.push(() => { if (retryTimer) clearInterval(retryTimer); });
          cleanupParts.push(() => {
            try { if (typeof disposeTokens === 'function') disposeTokens(); } catch (e) { /* ignore */ }
          });

          // 兜底 CSS 独立生效，所以令牌覆盖失败也仍有半透明效果
          mark('SpaceLayer:effect:done');

          // ── 上报真实测量结果给 Host（诊断期专用）─────────────────────
          // 浏览器侧无法被模型直接观察，所以把「到底渲染出了什么」量出来
          // 发回 Host 落盘：canvas 数量与尺寸、层级、CSS 是否命中、是否被遮挡。
          scheduleDiagReport(host, debug, diag);
        } catch (e) {
          fail('SpaceLayer:effect', e);
          scheduleDiagReport(null, null, diag);
        }

        return () => {
          for (const fn of cleanupParts.reverse()) { try { fn(); } catch (e) { /* ignore */ } }
        };
      }, [enabled]);
      return null;
    }

    /* ======================================================================
     * 诊断上报（诊断期专用；问题定位后删除）
     * ==================================================================== */

    /**
     * 测量当前页面真实状态并发给 Host。
     *
     * 为什么需要它：这个插件的效果全在浏览器侧，而失败又是静默的。模型看不到
     * 浏览器，只能靠把「实际渲染出了什么」量下来回传——canvas 数量与尺寸、
     * 画布所在层级、兜底 CSS 是否命中、框架背景是否已透明。
     */
    function scheduleDiagReport(host, debug, diag) {
      const report = () => {
        const out = { at: Date.now(), url: location.href };
        try {
          const canvases = [...document.querySelectorAll('canvas.sbg-cv')];
          out.canvasCount = canvases.length;
          out.canvases = canvases.map((c) => ({
            w: c.width, h: c.height,
            cssW: c.clientWidth, cssH: c.clientHeight,
          }));
          const hostEl = document.querySelector('[data-sbg-host]');
          out.hostPresent = !!hostEl;
          if (hostEl) {
            const cs = getComputedStyle(hostEl);
            out.hostStyle = {
              parent: hostEl.parentElement ? hostEl.parentElement.tagName : null,
              position: cs.position, zIndex: cs.zIndex, opacity: cs.opacity,
              display: cs.display, visibility: cs.visibility,
              rect: (() => { try { const r = hostEl.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; } catch (e) { return null; } })(),
            };
            out.hostInViewport = (() => {
              try {
                const r = hostEl.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              } catch (e) { return null; }
            })();
          }
          out.dataSbgOn = document.documentElement.getAttribute('data-sbg-on');
          out.bgStyleInjected = !!document.getElementById('sbg-global-bg');
          out.componentStyleInjected = !!document.getElementById('sbg-style');

          // 框架根是否已透明（兜底 CSS 的关键目标）
          const frame = document.querySelector('[class*="q_frame"],[class*="_frame"]');
          out.frameFound = !!frame;
          if (frame) {
            const cs = getComputedStyle(frame);
            out.frame = {
              cls: frame.className,
              backgroundColor: cs.backgroundColor,
              backgroundImage: cs.backgroundImage,
              isTransparent: /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/.test(cs.backgroundColor),
            };
          }

          // 中点处最上层元素是谁——判断画布是否被别的元素盖住
          try {
            const el = document.elementFromPoint(
              Math.floor(innerWidth / 2), Math.floor(innerHeight / 2),
            );
            out.topElementAtCenter = el ? (el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')) : null;
          } catch (e) { /* ignore */ }

          out.applySteps = diag ? (diag.steps || []).length : 0;
          out.applyErrors = diag ? (diag.errors || []) : [];
          out.applyMount = diag ? diag.mount || null : null;
          out.debug = debug || null;
          out.sbgDebugGlobal = window.__sbgDebug || null;
        } catch (e) {
          out.probeError = String((e && e.message) || e);
        }

        // POST 给 Host 落盘；失败就退到 localStorage 便于用户手动查看
        try {
          fetch('/plugins/space-background/diag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(out),
          }).catch(() => {});
        } catch (e) { /* ignore */ }
        try { localStorage.setItem('space-background/diag', JSON.stringify(out)); } catch (e) { /* ignore */ }
        try { window.__sbgDiag = out; } catch (e) { /* ignore */ }
      };

      // 首帧后立刻报一次，再等 1.5s 报一次（让引擎完成首次绘制）
      setTimeout(report, 300);
      setTimeout(report, 1800);
    }

    /* ======================================================================
     * 插件装配
     * ==================================================================== */

    function makeStore() {
      return defineStore({
        init: () => ({ schemaVersion: STORE_SCHEMA_VERSION, enabled: true }),
        persist: PERSIST_KEY,
        actions: {
          /**
           * 把持久化文档归一成当前 schema。
           *
           * 这里必须做**真正的迁移**，而不只是「补默认值」：
           * 早期版本写过 `speed` / `boost` 两个字段，它们后来被移除，
           * 但旧文档会一直留在 localStorage 里。实测到的一份是
           *   {"schemaVersion":1,"enabled":false,"speed":0.2,"boost":false}
           * —— 带着 `enabled:false`，于是插件装好后开关是关的、星空永不出现，
           * 而代码、包名、槽位注册全都正常，排查方向被彻底带偏。
           *
           * 规则：schemaVersion 低于当前值的文档视为旧版，**保留用户显式
           * 关闭的意图没有意义**（旧版本根本没提供可用的开关交互），因此
           * 迁移时把 enabled 复位成默认的 true，并丢弃已废弃字段。
           */
          normalize(draft) {
            const previous = typeof draft.schemaVersion === 'number' ? draft.schemaVersion : 0;
            const isLegacy = previous < STORE_SCHEMA_VERSION;
            // 丢弃已废弃字段（旧版本遗留）
            delete draft.speed;
            delete draft.boost;
            delete draft.hue;
            if (isLegacy) {
              // 旧文档不可信：开关曾因没有可靠写入通道而被写成 false
              draft.enabled = true;
            } else {
              draft.enabled = draft.enabled !== false;
            }
            draft.schemaVersion = STORE_SCHEMA_VERSION;
          },
          setEnabled(draft, on) { draft.enabled = on === true; },
        },
      });
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        // ── 诊断标记：把每一步写进 window.__sbgApply，用于定位加载停在何处 ──
        const diag = (window.__sbgApply = window.__sbgApply || { steps: [], errors: [], ok: false });
        const mark = (step) => { diag.steps.push(step); };
        mark('apply:enter');

        ctx.effect(() => ctx.locale.register(NS, dict), 'space-background: dictionaries');
        mark('locale:register:ok');
        const t = ctx.locale.bind(NS);
        mark('locale:bind:ok');
        // 主题服务句柄：能立即拿到就直接用，拿不到就异步等待——都不阻塞槽位注册
        try {
          const direct = typeof ctx.get === 'function' ? ctx.get('theme') : null;
          if (direct) themeApi = direct;
        } catch (e) { /* 服务未就绪时 get 返回空/抛错，交给 inject 等待 */ }
        if (!themeApi && typeof ctx.inject === 'function') {
          try {
            ctx.inject(['theme'], (scope) => { themeApi = (scope && scope.theme) || themeApi; });
          } catch (e) { /* 注入失败时令牌覆盖走兜底 CSS */ }
        }
        ctx.effect(() => {
          const store = makeStore();
          mark('store:created');

          // ── 开关写入通道 ──────────────────────────────────────────────
          // 宿主渲染槽位时把 `store.actions` 作为 props.actions 传给组件
          // （app.asar: `return { kit, standard, actions: store?.actions }`）。
          // 组件因此用 props.actions.setEnabled(...) 写回。这里额外挂一个
          // 显式句柄，避免宿主实现变化时开关静默失效。
          const toggle = (next) => {
            try { store.actions.setEnabled(next); } catch (e) { diag.errors.push('toggle:' + e); }
            try { if (window.__sbgToggle) window.__sbgToggle(next); } catch (e) { /* ignore */ }
          };
          try { window.__sbgToggle = (next) => store.actions.setEnabled(next); } catch (e) { /* ignore */ }
          mark('toggle:ready');

          const disposeOverlay = ctx.slots.inject('shell.overlay', () => {
            mark('shell.overlay:injected');
            const d = ctx.slots.register(
              { name: 'shell.overlay', id: PANEL_ID, order: 100, store, locale: NS }, SpaceLayer);
            mark('shell.overlay:registered');
            return d;
          });
          const disposeRow = ctx.slots.inject('settings.general.item', () => {
            mark('settings.general.item:injected');
            // `label` 由宿主在渲染列表时调用；`inject` 提供稳定的动作面，
            // 与宿主官方 `language` / `link-opening` 行的写法一致。
            const d = ctx.slots.register({
              name: 'settings.general.item',
              id: PANEL_ID,
              order: 12,
              store,
              locale: NS,
              label: () => t('rowTitle'),
              inject: () => ({
                // 让组件拿到确定的写入函数，而不是依赖宿主是否透传 actions
                setEnabled: toggle,
                hooks: {
                  // 只暴露一个只读快照函数；不依赖 store 上是否存在 .get()
                  enabled: () => {
                    try {
                      const snap = typeof store.getSnapshot === 'function'
                        ? store.getSnapshot()
                        : (typeof store.get === 'function' ? store.get() : undefined);
                      return snap === undefined ? true : snap.enabled !== false;
                    } catch (e) { return true; }
                  },
                },
              }),
            }, SettingsRow);
            mark('settings.general.item:registered');
            return d;
          });
          diag.ok = true;
          mark('apply:done');
          return () => { disposeOverlay(); disposeRow(); };
        }, 'space-background: overlay + settings row');
      },
      /** 仅供 test/run.cjs 与 preview.html 使用的内部面；运行时不被加载器读取。 */
      __test__: {
        PANEL_ID, NS, PERSIST_KEY,
        TINTS, DOT_STYLES, GLOBAL_TOKEN_OVERRIDES, GLOBAL_BG_CSS,
        clamp, pickTint, bandYFor, buildBasis, makeConstellations,
        makeStore, ensureStyles, createSpaceEngine,
        Views: { SettingsRow, SpaceLayer },
      },
    };
  },
});
